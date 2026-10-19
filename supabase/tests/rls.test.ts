import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../src/lib/database.types";

/**
 * Proves the week 2 access rules against a local Supabase stack.
 *
 * Start it first: `npx supabase start`
 * Then: `npm run test:rls`
 *
 * The app has no password form. These tests create users with the Auth admin
 * API and sign in with a password so they can act as two different people.
 * That does not add password sign-in to the product.
 */

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const password = "rls-test-password";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

type Client = SupabaseClient<Database>;

const createdUserIds: string[] = [];

let apiUrl = "";
let anonKey = "";
let admin: Client;
let owner: Client;
let other: Client;
let otherToken = "";
let ownerToken = "";
let ownerId = "";
let otherId = "";
let ownerEmail = "";
let otherEmail = "";

beforeAll(async () => {
  const env = localSupabaseEnv();
  apiUrl = env.apiUrl;
  anonKey = env.anonKey;
  admin = createClient<Database>(apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const nonce = crypto.randomUUID();
  ownerEmail = `rls-owner-${nonce}@example.com`;
  otherEmail = `rls-other-${nonce}@example.com`;

  ownerId = await createUser(admin, {
    email: ownerEmail,
    displayName: "Ada Owner",
    timezone: "America/Los_Angeles",
  });
  otherId = await createUser(admin, {
    email: otherEmail,
    displayName: "Grace Other",
    timezone: "Europe/Paris",
  });

  const sneakyEmail = `rls-sneaky-${nonce}@example.com`;
  const sneakyId = await createUser(admin, {
    email: sneakyEmail,
    displayName: sneakyEmail,
    timezone: "UTC",
  });
  const { data: sneakyProfile, error: sneakyError } = await admin
    .from("profiles")
    .select("*")
    .eq("id", sneakyId)
    .single();
  if (sneakyError) throw sneakyError;
  expect(sneakyProfile.display_name).toBe("New member");
  expect(JSON.stringify(sneakyProfile)).not.toContain(sneakyEmail);
  expect(sneakyProfile).not.toHaveProperty("email");

  const ownerSession = await signIn(apiUrl, anonKey, ownerEmail);
  owner = ownerSession.client;
  ownerToken = ownerSession.token;
  const otherSession = await signIn(apiUrl, anonKey, otherEmail);
  other = otherSession.client;
  otherToken = otherSession.token;
});

afterAll(async () => {
  if (!admin) return;
  const folders = createdUserIds.map((id) => id);
  for (const folder of folders) {
    const { data } = await admin.storage.from("avatars").list(folder);
    const paths = (data ?? []).map((object) => `${folder}/${object.name}`);
    if (paths.length > 0) {
      await admin.storage.from("avatars").remove(paths);
    }
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe("account_private stays with its owner", () => {
  it("gives the other account an empty result and no email column", async () => {
    const { data, error } = await other
      .from("account_private")
      .select("*")
      .eq("user_id", ownerId);

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const own = await other.from("account_private").select("*").single();
    expect(own.error).toBeNull();
    expect(own.data?.user_id).toBe(otherId);
    expect(own.data).not.toHaveProperty("email");
    expect(JSON.stringify(own.data)).not.toContain(ownerEmail);
    expect(JSON.stringify(own.data)).not.toContain(otherEmail);
  });

  it("does not let the other account update or insert a private row", async () => {
    const update = await other
      .from("account_private")
      .update({ notification_prefs: { leaked: true } })
      .eq("user_id", ownerId)
      .select("user_id");
    expect(update.error).toBeNull();
    expect(update.data).toEqual([]);

    const insert = await other
      .from("account_private")
      .insert({ user_id: ownerId });
    expect(insert.error).toBeTruthy();

    const { data, error } = await admin
      .from("account_private")
      .select("notification_prefs")
      .eq("user_id", ownerId)
      .single();
    expect(error).toBeNull();
    expect(data?.notification_prefs).toEqual({});
  });
});

describe("profiles hide email and reject cross-account writes", () => {
  it("returns no email column from the Data API", async () => {
    const { data, error } = await other.from("profiles").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(otherId);
    expect(data?.[0]).not.toHaveProperty("email");
    expect(JSON.stringify(data)).not.toContain(ownerEmail);
    expect(JSON.stringify(data)).not.toContain(otherEmail);

    const hidden = await other
      .from("profiles")
      .select("display_name")
      .eq("id", ownerId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);

    const emailColumn = await fetch(`${apiUrl}/rest/v1/profiles?select=email`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${otherToken}`,
        Accept: "application/json",
      },
    });
    expect(emailColumn.ok).toBe(false);

    // The spec is generated for the role in the JWT. anon cannot see these
    // tables, so this request uses the other account's session.
    const specResponse = await fetch(`${apiUrl}/rest/v1/`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${otherToken}`,
        Accept: "application/openapi+json",
      },
    });
    expect(specResponse.ok).toBe(true);
    const spec: unknown = await specResponse.json();
    const emailColumns = columnNames(spec).filter(
      (name) => name === "email" || name.endsWith(".email"),
    );
    expect(emailColumns).toEqual([]);
    expect(columnNames(spec)).toContain("profiles.display_name");
    expect(columnNames(spec)).toContain("account_private.user_id");

    const adminList = await fetch(`${apiUrl}/auth/v1/admin/users`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${otherToken}`,
      },
    });
    expect(adminList.ok).toBe(false);
    expect(await adminList.text()).not.toContain(ownerEmail);

    const { data: authUser, error: authError } =
      await admin.auth.admin.getUserById(ownerId);
    expect(authError).toBeNull();
    expect(authUser.user?.email).toBe(ownerEmail);

    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("*");
    expect(profilesError).toBeNull();
    for (const row of profiles ?? []) {
      expect(row).not.toHaveProperty("email");
      expect(JSON.stringify(row)).not.toContain(ownerEmail);
    }
  });

  it("does not let the other account change the owner's profile", async () => {
    const renamed = await owner
      .from("profiles")
      .update({ display_name: "Ada Updated" })
      .eq("id", ownerId)
      .select("display_name")
      .single();
    expect(renamed.error).toBeNull();
    expect(renamed.data?.display_name).toBe("Ada Updated");

    const attack = await other
      .from("profiles")
      .update({ display_name: "Stolen Name" })
      .eq("id", ownerId)
      .select("display_name");
    expect(attack.error).toBeNull();
    expect(attack.data).toEqual([]);

    const sweep = await other
      .from("profiles")
      .update({ display_name: "Stolen Name" })
      .neq("id", otherId)
      .select("id");
    expect(sweep.error).toBeNull();
    expect(sweep.data).toEqual([]);

    const { data, error } = await owner
      .from("profiles")
      .select("display_name")
      .eq("id", ownerId)
      .single();
    expect(error).toBeNull();
    expect(data?.display_name).toBe("Ada Updated");
  });

  it("rejects storing an email as a display name or a new external avatar URL", async () => {
    const emailName = await owner
      .from("profiles")
      .update({ display_name: ownerEmail })
      .eq("id", ownerId);
    expect(emailName.error).toBeTruthy();

    const trackingPixel = await owner
      .from("profiles")
      .update({ avatar_path: "https://evil.example/pixel.png" })
      .eq("id", ownerId);
    expect(trackingPixel.error).toBeTruthy();

    const { data, error } = await owner
      .from("profiles")
      .select("display_name, avatar_path")
      .eq("id", ownerId)
      .single();
    expect(error).toBeNull();
    expect(data?.display_name).toBe("Ada Updated");
    expect(data?.avatar_path).toBeNull();
  });
});

describe("avatar objects are private to the owner", () => {
  it("lets the owner upload and sign a URL, and hides that object from the other account", async () => {
    const objectPath = `${ownerId}/${crypto.randomUUID()}.png`;
    const upload = await owner.storage.from("avatars").upload(objectPath, png, {
      contentType: "image/png",
      upsert: false,
    });
    expect(upload.error).toBeNull();

    const signed = await owner.storage
      .from("avatars")
      .createSignedUrl(objectPath, 60);
    expect(signed.error).toBeNull();
    expect(signed.data?.signedUrl).toBeTruthy();
    const downloaded = await fetch(signed.data!.signedUrl);
    expect(downloaded.ok).toBe(true);

    const otherSigned = await other.storage
      .from("avatars")
      .createSignedUrl(objectPath, 60);
    expect(otherSigned.data?.signedUrl ?? null).toBeNull();
    expect(otherSigned.error).toBeTruthy();

    const otherDownload = await other.storage
      .from("avatars")
      .download(objectPath);
    expect(otherDownload.data).toBeNull();
    expect(otherDownload.error).toBeTruthy();

    const planted = await other.storage
      .from("avatars")
      .upload(`${ownerId}/${crypto.randomUUID()}.png`, png, {
        contentType: "image/png",
      });
    expect(planted.error).toBeTruthy();

    const html = await owner.storage
      .from("avatars")
      .upload(`${ownerId}/not-an-image.html`, png, {
        contentType: "image/png",
      });
    expect(html.error).toBeTruthy();
  });
});

describe("anonymous clients", () => {
  it("cannot read profiles", async () => {
    const anon = createClient<Database>(apiUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.from("profiles").select("*");
    expect(error).toBeTruthy();
    expect(JSON.stringify(data)).not.toContain("Ada Updated");
    expect(JSON.stringify(data)).not.toContain(ownerEmail);
  });
});

describe("circles, invites, and co-member profiles", () => {
  let third: Client;
  let leaver: Client;
  let leaverId = "";
  let limiter: Client;
  const objectPath = () => `${ownerId}/${crypto.randomUUID()}.png`;

  beforeAll(async () => {
    const nonce = crypto.randomUUID();
    await createUser(admin, {
      email: `rls-third-${nonce}@example.com`,
      displayName: "Lin Third",
      timezone: "America/Chicago",
    });
    leaverId = await createUser(admin, {
      email: `rls-leaver-${nonce}@example.com`,
      displayName: "Lea Ver",
      timezone: "UTC",
    });
    const limiterId = await createUser(admin, {
      email: `rls-limit-${nonce}@example.com`,
      displayName: "Limited",
      timezone: "UTC",
    });
    third = (await signIn(apiUrl, anonKey, `rls-third-${nonce}@example.com`))
      .client;
    leaver = (await signIn(apiUrl, anonKey, `rls-leaver-${nonce}@example.com`))
      .client;
    limiter = (await signIn(apiUrl, anonKey, `rls-limit-${nonce}@example.com`))
      .client;
    expect(limiterId).toBeTruthy();
  });

  it("lets a couple join, hides email, and refuses a third person on the same link", async () => {
    const created = await rpc(owner, "create_circle", {
      circle_name: "Me & Summer",
      circle_type: "couple",
    });
    const circleId = created.circle_id as string;
    const token = created.token as string;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(created.invite_id).toBeTruthy();

    const pending = await owner
      .from("circles")
      .select("status, circle_type, name")
      .eq("id", circleId)
      .single();
    expect(pending.error).toBeNull();
    expect(pending.data).toMatchObject({
      status: "pending",
      circle_type: "couple",
      name: "Me & Summer",
    });

    const hidden = await third.from("circles").select("id").eq("id", circleId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);

    const planted = await third.from("circles").insert({
      circle_type: "couple",
    });
    expect(planted.error).toBeTruthy();

    const preview = await rpc(other, "preview_invite", { raw_token: token });
    expect(preview.invite_state).toBe("ready");
    expect(preview.circle_name).toBe("Me & Summer");

    const joined = await rpc(other, "redeem_invite", {
      raw_token: token,
      ip_hash: freshIp(),
    });
    expect(joined.invite_state).toBe("joined");
    expect(joined.circle_id).toBe(circleId);

    const active = await other
      .from("circles")
      .select("status")
      .eq("id", circleId)
      .single();
    expect(active.data?.status).toBe("active");

    const members = await other
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circleId)
      .is("left_at", null);
    expect(members.data).toHaveLength(2);

    const profile = await other
      .from("profiles")
      .select("*")
      .eq("id", ownerId)
      .single();
    expect(profile.error).toBeNull();
    expect(profile.data?.display_name).toBe("Ada Updated");
    expect(profile.data).not.toHaveProperty("email");
    expect(JSON.stringify(profile.data)).not.toContain(ownerEmail);

    const privateRow = await other
      .from("account_private")
      .select("*")
      .eq("user_id", ownerId);
    expect(privateRow.error).toBeNull();
    expect(privateRow.data).toEqual([]);

    const attack = await other
      .from("profiles")
      .update({ display_name: "Stolen Name" })
      .eq("id", ownerId)
      .select("id");
    expect(attack.error).toBeNull();
    expect(attack.data).toEqual([]);

    const path = objectPath();
    const upload = await owner.storage.from("avatars").upload(path, png, {
      contentType: "image/png",
    });
    expect(upload.error).toBeNull();
    const signed = await other.storage
      .from("avatars")
      .createSignedUrl(path, 60);
    expect(signed.error).toBeNull();
    expect(signed.data?.signedUrl).toBeTruthy();
    const outsiderSigned = await third.storage
      .from("avatars")
      .createSignedUrl(path, 60);
    expect(outsiderSigned.data?.signedUrl ?? null).toBeNull();

    const refused = await rpc(third, "redeem_invite", {
      raw_token: token,
      ip_hash: freshIp(),
    });
    expect(refused.invite_state).toBe("full");
    const stillTwo = await owner
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circleId)
      .is("left_at", null);
    expect(stillTwo.data).toHaveLength(2);

    const regenerated = await rpc(owner, "regenerate_invite", {
      target_circle: circleId,
    });
    const oldLink = await rpc(third, "redeem_invite", {
      raw_token: token,
      ip_hash: freshIp(),
    });
    expect(oldLink.invite_state).toBe("revoked");
    const stillFull = await rpc(third, "redeem_invite", {
      raw_token: regenerated.token as string,
      ip_hash: freshIp(),
    });
    expect(stillFull.invite_state).toBe("full");

    const hashLookup = await fetch(
      `${apiUrl}/rest/v1/circle_invites?select=token_hash`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${ownerToken}`,
          Accept: "application/json",
        },
      },
    );
    expect(hashLookup.ok).toBe(false);
  });

  it("refuses a revoked or expired link and lets a group take a third member", async () => {
    const expired = await rpc(owner, "create_circle", {
      circle_name: null,
      circle_type: "couple",
    });
    const stamped = await admin
      .from("circle_invites")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", expired.invite_id as string);
    expect(stamped.error).toBeNull();
    const late = await rpc(third, "redeem_invite", {
      raw_token: expired.token as string,
      ip_hash: freshIp(),
    });
    expect(late.invite_state).toBe("expired");

    const revoked = await rpc(owner, "create_circle", {
      circle_name: "Revoked",
      circle_type: "couple",
    });
    const turnedOff = await admin
      .from("circle_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", revoked.invite_id as string);
    expect(turnedOff.error).toBeNull();
    const afterRevoke = await rpc(third, "redeem_invite", {
      raw_token: revoked.token as string,
      ip_hash: freshIp(),
    });
    expect(afterRevoke.invite_state).toBe("revoked");

    const group = await rpc(owner, "create_circle", {
      circle_name: "The Group Chat",
      circle_type: "group",
    });
    const groupInvite = await owner
      .from("circle_invites")
      .select("max_uses, use_count")
      .eq("id", group.invite_id as string)
      .single();
    expect(groupInvite.data?.max_uses).toBeNull();
    const second = await rpc(other, "redeem_invite", {
      raw_token: group.token as string,
      ip_hash: freshIp(),
    });
    expect(second.invite_state).toBe("joined");
    const fourthSeat = await rpc(third, "redeem_invite", {
      raw_token: group.token as string,
      ip_hash: freshIp(),
    });
    expect(fourthSeat.invite_state).toBe("joined");
    const count = await owner
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", group.circle_id as string)
      .is("left_at", null);
    expect(count.data).toHaveLength(3);
  });

  it("drops access the moment someone leaves", async () => {
    const created = await rpc(owner, "create_circle", {
      circle_name: "Leaving",
      circle_type: "couple",
    });
    const circleId = created.circle_id as string;
    const joined = await rpc(leaver, "redeem_invite", {
      raw_token: created.token as string,
      ip_hash: freshIp(),
    });
    expect(joined.invite_state).toBe("joined");

    const goodbye = await leaver
      .from("circle_members")
      .update({ left_at: new Date().toISOString() })
      .eq("circle_id", circleId)
      .eq("user_id", leaverId)
      .select("left_at");
    expect(goodbye.error).toBeNull();
    expect(goodbye.data?.[0]?.left_at).toBeTruthy();

    const gone = await leaver.from("circles").select("id").eq("id", circleId);
    expect(gone.data).toEqual([]);
    const profile = await leaver
      .from("profiles")
      .select("id")
      .eq("id", ownerId);
    expect(profile.data).toEqual([]);

    const pending = await owner
      .from("circles")
      .select("status")
      .eq("id", circleId)
      .single();
    expect(pending.data?.status).toBe("pending");

    const ownerLeaves = await owner
      .from("circle_members")
      .update({ left_at: new Date().toISOString() })
      .eq("circle_id", circleId)
      .eq("user_id", ownerId);
    expect(ownerLeaves.error).toBeNull();

    const archived = await admin
      .from("circles")
      .select("status")
      .eq("id", circleId)
      .single();
    expect(archived.data?.status).toBe("archived");
    const ownerGone = await owner
      .from("circles")
      .select("id")
      .eq("id", circleId);
    expect(ownerGone.data).toEqual([]);
  });

  it("rate-limits redeem attempts for one user", async () => {
    const token = "ab".repeat(32);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const row = await rpc(limiter, "redeem_invite", {
        raw_token: token,
        ip_hash: freshIp(),
      });
      expect(row.invite_state).toBe("missing");
    }
    const blocked = await rpc(limiter, "redeem_invite", {
      raw_token: token,
      ip_hash: freshIp(),
    });
    expect(blocked.invite_state).toBe("rate_limited");
  });
});

describe("1:1 pings stay between the sender and the recipient", () => {
  let third: Client;
  let outsider: Client;
  let leaver: Client;
  let rapid: Client;
  let thirdId = "";
  let outsiderId = "";
  let leaverId = "";
  let rapidId = "";
  let rapidPartnerId = "";
  let groupId = "";

  beforeAll(async () => {
    const nonce = crypto.randomUUID();
    thirdId = await createUser(admin, {
      email: `rls-ping-third-${nonce}@example.com`,
      displayName: "Ping Third",
      timezone: "America/Chicago",
    });
    outsiderId = await createUser(admin, {
      email: `rls-ping-out-${nonce}@example.com`,
      displayName: "Ping Outsider",
      timezone: "UTC",
    });
    leaverId = await createUser(admin, {
      email: `rls-ping-leaver-${nonce}@example.com`,
      displayName: "Ping Leaver",
      timezone: "UTC",
    });
    rapidId = await createUser(admin, {
      email: `rls-ping-rapid-${nonce}@example.com`,
      displayName: "Ping Rapid",
      timezone: "UTC",
    });
    rapidPartnerId = await createUser(admin, {
      email: `rls-ping-partner-${nonce}@example.com`,
      displayName: "Ping Partner",
      timezone: "UTC",
    });
    third = (
      await signIn(apiUrl, anonKey, `rls-ping-third-${nonce}@example.com`)
    ).client;
    outsider = (
      await signIn(apiUrl, anonKey, `rls-ping-out-${nonce}@example.com`)
    ).client;
    leaver = (
      await signIn(apiUrl, anonKey, `rls-ping-leaver-${nonce}@example.com`)
    ).client;
    rapid = (
      await signIn(apiUrl, anonKey, `rls-ping-rapid-${nonce}@example.com`)
    ).client;

    // Created directly so this case does not depend on the create form.
    const group = await admin
      .from("circles")
      .insert({
        name: "Ping trio",
        circle_type: "group",
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (group.error || !group.data) throw group.error ?? new Error("no group");
    groupId = group.data.id;
    const members = await admin.from("circle_members").insert([
      { circle_id: groupId, user_id: ownerId },
      { circle_id: groupId, user_id: otherId },
      { circle_id: groupId, user_id: thirdId },
    ]);
    if (members.error) throw members.error;
    expect(outsiderId).toBeTruthy();
    expect(rapidPartnerId).toBeTruthy();
  });

  it("hides a 1:1 ping from an outsider and from another member of the circle", async () => {
    const ping = await owner
      .from("pings")
      .insert({
        circle_id: groupId,
        from_user_id: ownerId,
        to_user_id: otherId,
        ping_type: "thinking-of-you",
        secret_variant: true,
      })
      .select("id, secret_variant, to_user_id")
      .single();
    expect(ping.error).toBeNull();
    expect(ping.data?.secret_variant).toBe(true);
    const pingId = ping.data?.id ?? "";

    const stored = await admin
      .from("pings")
      .select("id")
      .eq("id", pingId)
      .single();
    expect(stored.data?.id).toBe(pingId);

    const recipient = await other
      .from("pings")
      .select("id, secret_variant")
      .eq("id", pingId)
      .single();
    expect(recipient.error).toBeNull();
    expect(recipient.data?.secret_variant).toBe(true);

    const thirdView = await third
      .from("pings")
      .select("*")
      .eq("circle_id", groupId);
    expect(thirdView.error).toBeNull();
    expect(thirdView.data).toEqual([]);

    const outside = await outsider.from("pings").select("*").eq("id", pingId);
    expect(outside.error).toBeNull();
    expect(outside.data).toEqual([]);
    expect(JSON.stringify(outside.data)).not.toContain(pingId);

    const spoof = await third.from("pings").insert({
      circle_id: groupId,
      from_user_id: ownerId,
      to_user_id: otherId,
      ping_type: "thinking-of-you",
    });
    expect(spoof.error).toBeTruthy();

    const edited = await third
      .from("pings")
      .update({ secret_variant: false })
      .eq("id", pingId)
      .select("id");
    expect(edited.data ?? []).toEqual([]);
    const stillSecret = await owner
      .from("pings")
      .select("secret_variant")
      .eq("id", pingId)
      .single();
    expect(stillSecret.data?.secret_variant).toBe(true);

    const removed = await outsider
      .from("pings")
      .delete()
      .eq("id", pingId)
      .select("id");
    expect(removed.data ?? []).toEqual([]);
    const stillThere = await owner
      .from("pings")
      .select("id")
      .eq("id", pingId)
      .single();
    expect(stillThere.data?.id).toBe(pingId);

    const side = await third
      .from("pings")
      .insert({
        circle_id: groupId,
        from_user_id: thirdId,
        to_user_id: ownerId,
        ping_type: "thinking-of-you",
      })
      .select("id")
      .single();
    expect(side.error).toBeNull();
    const notTheirs = await other
      .from("pings")
      .select("id")
      .eq("id", side.data?.id ?? "");
    expect(notTheirs.data).toEqual([]);

    const broadcast = await owner
      .from("pings")
      .insert({
        circle_id: groupId,
        from_user_id: ownerId,
        to_user_id: null,
        ping_type: "thinking-of-you",
      })
      .select("id")
      .single();
    expect(broadcast.error).toBeNull();

    const thirdAfter = await third
      .from("pings")
      .select("id, to_user_id")
      .eq("circle_id", groupId);
    expect(thirdAfter.error).toBeNull();
    const thirdIds = (thirdAfter.data ?? []).map((row) => row.id);
    expect(thirdIds).toContain(broadcast.data?.id);
    expect(thirdIds).toContain(side.data?.id);
    expect(thirdIds).not.toContain(pingId);
    expect(
      thirdAfter.data?.find((row) => row.id === broadcast.data?.id)?.to_user_id,
    ).toBeNull();

    const outsiderAfter = await outsider
      .from("pings")
      .select("id")
      .eq("circle_id", groupId);
    expect(outsiderAfter.data).toEqual([]);

    const anon = createClient<Database>(apiUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anonRead = await anon.from("pings").select("*");
    expect(anonRead.error).toBeTruthy();
    expect(JSON.stringify(anonRead.data)).not.toContain(pingId);
  });

  it("rejects a whole-circle ping in a couple", async () => {
    const couple = await admin
      .from("circles")
      .insert({
        name: "Ping couple",
        circle_type: "couple",
        created_by: ownerId,
      })
      .select("id")
      .single();
    expect(couple.error).toBeNull();
    const coupleId = couple.data?.id ?? "";
    const seat = await admin
      .from("circle_members")
      .insert({ circle_id: coupleId, user_id: ownerId });
    expect(seat.error).toBeNull();

    const broadcast = await owner.from("pings").insert({
      circle_id: coupleId,
      from_user_id: ownerId,
      to_user_id: null,
      ping_type: "thinking-of-you",
    });
    expect(broadcast.error?.message ?? "").toContain(
      "hsummer_couple_needs_recipient",
    );

    const stored = await admin
      .from("pings")
      .select("id")
      .eq("circle_id", coupleId);
    expect(stored.data).toEqual([]);
  });

  it("drops the ping from someone the moment they leave", async () => {
    const couple = await admin
      .from("circles")
      .insert({
        name: "Ping goodbye",
        circle_type: "couple",
        created_by: ownerId,
      })
      .select("id")
      .single();
    expect(couple.error).toBeNull();
    const coupleId = couple.data?.id ?? "";
    const seats = await admin.from("circle_members").insert([
      { circle_id: coupleId, user_id: ownerId },
      { circle_id: coupleId, user_id: leaverId },
    ]);
    expect(seats.error).toBeNull();

    const ping = await owner
      .from("pings")
      .insert({
        circle_id: coupleId,
        from_user_id: ownerId,
        to_user_id: leaverId,
        ping_type: "thinking-of-you",
      })
      .select("id")
      .single();
    expect(ping.error).toBeNull();
    const visible = await leaver
      .from("pings")
      .select("id")
      .eq("id", ping.data?.id ?? "");
    expect(visible.data).toHaveLength(1);

    const goodbye = await leaver
      .from("circle_members")
      .update({ left_at: new Date().toISOString() })
      .eq("circle_id", coupleId)
      .eq("user_id", leaverId);
    expect(goodbye.error).toBeNull();

    const gone = await leaver
      .from("pings")
      .select("id")
      .eq("circle_id", coupleId);
    expect(gone.data).toEqual([]);
    const senderStill = await owner
      .from("pings")
      .select("id")
      .eq("id", ping.data?.id ?? "")
      .single();
    expect(senderStill.data?.id).toBe(ping.data?.id);

    const again = await owner.from("pings").insert({
      circle_id: coupleId,
      from_user_id: ownerId,
      to_user_id: leaverId,
      ping_type: "thinking-of-you",
    });
    expect(again.error).toBeTruthy();
  });

  it("stops a burst of pings and allows another after the window", async () => {
    const couple = await admin
      .from("circles")
      .insert({
        name: "Ping limit",
        circle_type: "couple",
        created_by: rapidId,
      })
      .select("id")
      .single();
    expect(couple.error).toBeNull();
    const coupleId = couple.data?.id ?? "";
    const seats = await admin.from("circle_members").insert([
      { circle_id: coupleId, user_id: rapidId },
      { circle_id: coupleId, user_id: rapidPartnerId },
    ]);
    expect(seats.error).toBeNull();

    for (let sent = 0; sent < 10; sent += 1) {
      const row = await rapid
        .from("pings")
        .insert({
          circle_id: coupleId,
          from_user_id: rapidId,
          to_user_id: rapidPartnerId,
          ping_type: "thinking-of-you",
        })
        .select("id")
        .single();
      expect(row.error).toBeNull();
    }

    const blocked = await rapid.from("pings").insert({
      circle_id: coupleId,
      from_user_id: rapidId,
      to_user_id: rapidPartnerId,
      ping_type: "thinking-of-you",
    });
    expect(blocked.error?.message ?? "").toContain("hsummer_rate_limited");

    const backdated = await admin
      .from("pings")
      .update({
        sent_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      })
      .eq("from_user_id", rapidId);
    expect(backdated.error).toBeNull();

    const again = await rapid
      .from("pings")
      .insert({
        circle_id: coupleId,
        from_user_id: rapidId,
        to_user_id: rapidPartnerId,
        ping_type: "thinking-of-you",
      })
      .select("id")
      .single();
    expect(again.error).toBeNull();
  }, 60_000);
});

describe("bucket list stays inside the circle", () => {
  let partner: Client;
  let third: Client;
  let outsider: Client;
  let leaver: Client;
  let partnerId = "";
  let thirdId = "";
  let leaverId = "";
  let circleId = "";

  beforeAll(async () => {
    const nonce = crypto.randomUUID();
    partnerId = await createUser(admin, {
      email: `rls-bucket-partner-${nonce}@example.com`,
      displayName: "Bucket Partner",
      timezone: "America/Los_Angeles",
    });
    thirdId = await createUser(admin, {
      email: `rls-bucket-third-${nonce}@example.com`,
      displayName: "Bucket Third",
      timezone: "America/Chicago",
    });
    leaverId = await createUser(admin, {
      email: `rls-bucket-leaver-${nonce}@example.com`,
      displayName: "Bucket Leaver",
      timezone: "UTC",
    });
    const outsiderId = await createUser(admin, {
      email: `rls-bucket-out-${nonce}@example.com`,
      displayName: "Bucket Outsider",
      timezone: "UTC",
    });
    partner = (
      await signIn(apiUrl, anonKey, `rls-bucket-partner-${nonce}@example.com`)
    ).client;
    third = (
      await signIn(apiUrl, anonKey, `rls-bucket-third-${nonce}@example.com`)
    ).client;
    leaver = (
      await signIn(apiUrl, anonKey, `rls-bucket-leaver-${nonce}@example.com`)
    ).client;
    outsider = (
      await signIn(apiUrl, anonKey, `rls-bucket-out-${nonce}@example.com`)
    ).client;
    expect(outsiderId).toBeTruthy();

    const circle = await admin
      .from("circles")
      .insert({
        name: "Bucket circle",
        circle_type: "group",
        created_by: ownerId,
      })
      .select("id")
      .single();
    expect(circle.error).toBeNull();
    circleId = circle.data?.id ?? "";
    const seats = await admin.from("circle_members").insert([
      { circle_id: circleId, user_id: ownerId },
      { circle_id: circleId, user_id: partnerId },
      { circle_id: circleId, user_id: thirdId },
      { circle_id: circleId, user_id: leaverId },
    ]);
    expect(seats.error).toBeNull();
  });

  it("lets active members read and write, and gives an outsider nothing", async () => {
    const inserted = await partner
      .from("bucket_items")
      .insert({
        circle_id: circleId,
        title: "Night market",
        category: "restaurant",
        status: "idea",
        notes: "The one with the mango rice",
        link: "https://example.com/menu",
        planned_date: "2026-12-01",
      })
      .select("id, created_by, completed_at, title")
      .single();
    expect(inserted.error).toBeNull();
    expect(inserted.data?.created_by).toBe(partnerId);
    expect(inserted.data?.completed_at).toBeNull();
    const itemId = inserted.data?.id ?? "";

    const ownerRead = await owner
      .from("bucket_items")
      .select("title, notes, link, planned_date, category")
      .eq("id", itemId)
      .single();
    expect(ownerRead.data).toMatchObject({
      title: "Night market",
      notes: "The one with the mango rice",
      link: "https://example.com/menu",
      planned_date: "2026-12-01",
      category: "restaurant",
    });

    const thirdRead = await third
      .from("bucket_items")
      .select("id")
      .eq("id", itemId);
    expect(thirdRead.data).toHaveLength(1);

    const renamed = await owner
      .from("bucket_items")
      .update({ title: "Night market, Taipei" })
      .eq("id", itemId)
      .select("title")
      .single();
    expect(renamed.error).toBeNull();
    expect(renamed.data?.title).toBe("Night market, Taipei");

    const done = await third
      .from("bucket_items")
      .update({ status: "done" })
      .eq("id", itemId)
      .select("status, completed_at")
      .single();
    expect(done.error).toBeNull();
    expect(done.data?.status).toBe("done");
    expect(done.data?.completed_at).toBeTruthy();

    const reopened = await partner
      .from("bucket_items")
      .update({ status: "planned", planned_date: "2027-01-02" })
      .eq("id", itemId)
      .select("status, completed_at, planned_date")
      .single();
    expect(reopened.data).toMatchObject({
      status: "planned",
      completed_at: null,
      planned_date: "2027-01-02",
    });

    const hidden = await outsider
      .from("bucket_items")
      .select("id, title")
      .eq("circle_id", circleId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);

    const planted = await outsider.from("bucket_items").insert({
      circle_id: circleId,
      title: "Stolen idea",
      category: "movie",
      status: "idea",
    });
    expect(planted.error).toBeTruthy();

    const attacked = await outsider
      .from("bucket_items")
      .update({ title: "Stolen title" })
      .eq("id", itemId)
      .select("id");
    expect(attacked.error).toBeNull();
    expect(attacked.data).toEqual([]);

    const removed = await outsider
      .from("bucket_items")
      .delete()
      .eq("id", itemId)
      .select("id");
    expect(removed.error).toBeNull();
    expect(removed.data).toEqual([]);

    const still = await owner
      .from("bucket_items")
      .select("title")
      .eq("id", itemId)
      .single();
    expect(still.data?.title).toBe("Night market, Taipei");

    const script = await partner.from("bucket_items").insert({
      circle_id: circleId,
      title: "Bad link",
      category: "activity",
      link: "javascript:alert(1)",
    });
    expect(script.error).toBeTruthy();

    const pendingCircle = await admin
      .from("circles")
      .insert({
        name: "Pending list",
        circle_type: "couple",
        created_by: ownerId,
      })
      .select("id")
      .single();
    expect(pendingCircle.error).toBeNull();
    const pendingId = pendingCircle.data?.id ?? "";
    const seat = await admin
      .from("circle_members")
      .insert({ circle_id: pendingId, user_id: ownerId });
    expect(seat.error).toBeNull();
    const early = await owner
      .from("bucket_items")
      .insert({
        circle_id: pendingId,
        title: "Call on Sunday",
        category: "ldr-idea",
        status: "idea",
      })
      .select("id")
      .single();
    expect(early.error).toBeNull();

    const gone = await third
      .from("bucket_items")
      .delete()
      .eq("id", itemId)
      .select("id");
    expect(gone.error).toBeNull();
    expect(gone.data).toHaveLength(1);
    const after = await partner
      .from("bucket_items")
      .select("id")
      .eq("id", itemId);
    expect(after.data).toEqual([]);
  });

  it("drops the list the moment someone leaves", async () => {
    const inserted = await leaver
      .from("bucket_items")
      .insert({
        circle_id: circleId,
        title: "Train to the coast",
        category: "date-idea",
        status: "idea",
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    const itemId = inserted.data?.id ?? "";

    const goodbye = await leaver
      .from("circle_members")
      .update({ left_at: new Date().toISOString() })
      .eq("circle_id", circleId)
      .eq("user_id", leaverId);
    expect(goodbye.error).toBeNull();

    const hidden = await leaver
      .from("bucket_items")
      .select("id")
      .eq("circle_id", circleId);
    expect(hidden.data).toEqual([]);

    const still = await owner
      .from("bucket_items")
      .select("id")
      .eq("id", itemId);
    expect(still.data).toHaveLength(1);

    const again = await leaver.from("bucket_items").insert({
      circle_id: circleId,
      title: "After leaving",
      category: "movie",
    });
    expect(again.error).toBeTruthy();
  });
});

describe("current moods stay inside the circle", () => {
  let partner: Client;
  let third: Client;
  let outsider: Client;
  let leaver: Client;
  let partnerId = "";
  let thirdId = "";
  let leaverId = "";
  let circleId = "";

  beforeAll(async () => {
    const nonce = crypto.randomUUID();
    partnerId = await createUser(admin, {
      email: `rls-mood-partner-${nonce}@example.com`,
      displayName: "Mood Partner",
      timezone: "America/Los_Angeles",
    });
    thirdId = await createUser(admin, {
      email: `rls-mood-third-${nonce}@example.com`,
      displayName: "Mood Third",
      timezone: "America/Chicago",
    });
    leaverId = await createUser(admin, {
      email: `rls-mood-leaver-${nonce}@example.com`,
      displayName: "Mood Leaver",
      timezone: "UTC",
    });
    const outsiderId = await createUser(admin, {
      email: `rls-mood-out-${nonce}@example.com`,
      displayName: "Mood Outsider",
      timezone: "UTC",
    });
    partner = (
      await signIn(apiUrl, anonKey, `rls-mood-partner-${nonce}@example.com`)
    ).client;
    third = (
      await signIn(apiUrl, anonKey, `rls-mood-third-${nonce}@example.com`)
    ).client;
    leaver = (
      await signIn(apiUrl, anonKey, `rls-mood-leaver-${nonce}@example.com`)
    ).client;
    outsider = (
      await signIn(apiUrl, anonKey, `rls-mood-out-${nonce}@example.com`)
    ).client;
    expect(outsiderId).toBeTruthy();

    const circle = await admin
      .from("circles")
      .insert({
        name: "Mood circle",
        circle_type: "group",
        created_by: ownerId,
      })
      .select("id")
      .single();
    expect(circle.error).toBeNull();
    circleId = circle.data?.id ?? "";
    const seats = await admin.from("circle_members").insert([
      { circle_id: circleId, user_id: ownerId },
      { circle_id: circleId, user_id: partnerId },
      { circle_id: circleId, user_id: thirdId },
      { circle_id: circleId, user_id: leaverId },
    ]);
    expect(seats.error).toBeNull();
  });

  it("lets members read, lets only the owner upsert, and hides an outsider", async () => {
    const first = await partner
      .from("current_moods")
      .upsert(
        { user_id: partnerId, circle_id: circleId, emoji: "😊" },
        { onConflict: "user_id,circle_id" },
      )
      .select("user_id, emoji, circle_id")
      .single();
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({
      user_id: partnerId,
      emoji: "😊",
      circle_id: circleId,
    });

    const again = await partner
      .from("current_moods")
      .upsert(
        { user_id: partnerId, circle_id: circleId, emoji: "😌" },
        { onConflict: "user_id,circle_id" },
      )
      .select("emoji")
      .single();
    expect(again.error).toBeNull();
    expect(again.data?.emoji).toBe("😌");

    const rows = await owner
      .from("current_moods")
      .select("user_id, emoji")
      .eq("circle_id", circleId)
      .eq("user_id", partnerId);
    expect(rows.data).toEqual([{ user_id: partnerId, emoji: "😌" }]);

    const thirdRead = await third
      .from("current_moods")
      .select("emoji")
      .eq("user_id", partnerId)
      .eq("circle_id", circleId);
    expect(thirdRead.data).toEqual([{ emoji: "😌" }]);

    const hidden = await outsider
      .from("current_moods")
      .select("emoji")
      .eq("circle_id", circleId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);

    const planted = await outsider
      .from("current_moods")
      .upsert(
        { user_id: partnerId, circle_id: circleId, emoji: "✨" },
        { onConflict: "user_id,circle_id" },
      );
    expect(planted.error).toBeTruthy();

    const spoofed = await third
      .from("current_moods")
      .upsert(
        { user_id: partnerId, circle_id: circleId, emoji: "✨" },
        { onConflict: "user_id,circle_id" },
      );
    expect(spoofed.error).toBeTruthy();

    const attacked = await third
      .from("current_moods")
      .update({ emoji: "✨" })
      .eq("user_id", partnerId)
      .eq("circle_id", circleId)
      .select("emoji");
    expect(attacked.error).toBeNull();
    expect(attacked.data).toEqual([]);

    const moved = await partner
      .from("current_moods")
      .update({ user_id: thirdId })
      .eq("user_id", partnerId)
      .eq("circle_id", circleId);
    expect(moved.error).toBeTruthy();

    const still = await owner
      .from("current_moods")
      .select("emoji")
      .eq("user_id", partnerId)
      .eq("circle_id", circleId)
      .single();
    expect(still.data?.emoji).toBe("😌");

    const email = await partner.from("current_moods").upsert(
      {
        user_id: partnerId,
        circle_id: circleId,
        emoji: "a@example.com",
      },
      { onConflict: "user_id,circle_id" },
    );
    expect(email.error).toBeTruthy();

    const removed = await third
      .from("current_moods")
      .delete()
      .eq("user_id", partnerId)
      .eq("circle_id", circleId)
      .select("user_id");
    expect(removed.error).toBeNull();
    expect(removed.data).toEqual([]);
    const kept = await partner
      .from("current_moods")
      .select("emoji")
      .eq("user_id", partnerId)
      .single();
    expect(kept.data?.emoji).toBe("😌");
  });

  it("hides a mood-share ping from a third member of the circle", async () => {
    const ping = await partner
      .from("pings")
      .insert({
        circle_id: circleId,
        from_user_id: partnerId,
        to_user_id: ownerId,
        ping_type: "mood-share",
        mood_emoji: "😌",
        secret_variant: false,
      })
      .select("id, mood_emoji, ping_type")
      .single();
    expect(ping.error).toBeNull();
    expect(ping.data?.ping_type).toBe("mood-share");
    const pingId = ping.data?.id ?? "";

    const ownerRead = await owner
      .from("pings")
      .select("mood_emoji")
      .eq("id", pingId)
      .single();
    expect(ownerRead.data?.mood_emoji).toBe("😌");

    const thirdView = await third.from("pings").select("id").eq("id", pingId);
    expect(thirdView.data).toEqual([]);

    const outside = await outsider.from("pings").select("id").eq("id", pingId);
    expect(outside.data).toEqual([]);
  });

  it("drops the mood the moment someone leaves", async () => {
    const inserted = await leaver
      .from("current_moods")
      .upsert(
        { user_id: leaverId, circle_id: circleId, emoji: "😔" },
        { onConflict: "user_id,circle_id" },
      )
      .select("emoji")
      .single();
    expect(inserted.error).toBeNull();

    const goodbye = await leaver
      .from("circle_members")
      .update({ left_at: new Date().toISOString() })
      .eq("circle_id", circleId)
      .eq("user_id", leaverId);
    expect(goodbye.error).toBeNull();

    const hidden = await leaver
      .from("current_moods")
      .select("emoji")
      .eq("circle_id", circleId);
    expect(hidden.data).toEqual([]);

    const fromOwner = await owner
      .from("current_moods")
      .select("emoji")
      .eq("circle_id", circleId)
      .eq("user_id", leaverId);
    expect(fromOwner.data).toEqual([]);

    const again = await leaver
      .from("current_moods")
      .upsert(
        { user_id: leaverId, circle_id: circleId, emoji: "✨" },
        { onConflict: "user_id,circle_id" },
      );
    expect(again.error).toBeTruthy();

    const stored = await admin
      .from("current_moods")
      .select("emoji")
      .eq("circle_id", circleId)
      .eq("user_id", leaverId)
      .single();
    expect(stored.data?.emoji).toBe("😔");
  });
});

describe("the backups bucket stays private", () => {
  it("lets the secret key upload a dump and hides it from a signed-in user", async () => {
    const object = `weekly/rls-${crypto.randomUUID()}.bin`;
    const payload = Buffer.from("not a real dump");
    const uploaded = await admin.storage
      .from("backups")
      .upload(object, payload, {
        contentType: "application/octet-stream",
        upsert: false,
      });
    expect(uploaded.error).toBeNull();

    try {
      const listed = await owner.storage.from("backups").list("weekly");
      const names = (listed.data ?? []).map((file) => file.name);
      expect(names).not.toContain(object.slice("weekly/".length));

      const downloaded = await owner.storage.from("backups").download(object);
      expect(downloaded.data).toBeNull();
      expect(downloaded.error).toBeTruthy();

      const planted = await owner.storage
        .from("backups")
        .upload(`weekly/nope-${crypto.randomUUID()}.bin`, payload, {
          contentType: "application/octet-stream",
        });
      expect(planted.error).toBeTruthy();

      const pub = await fetch(
        `${apiUrl}/storage/v1/object/public/backups/${object}`,
      );
      expect(pub.ok).toBe(false);
    } finally {
      await admin.storage.from("backups").remove([object]);
    }
  });
});

describe("the memory wall stays inside its visibility", () => {
  let author: Client;
  let partner: Client;
  let third: Client;
  let outsider: Client;
  let leaver: Client;
  let authorId = "";
  let partnerId = "";
  let thirdId = "";
  let leaverId = "";
  let circleId = "";

  beforeAll(async () => {
    const nonce = crypto.randomUUID();
    authorId = await createUser(admin, {
      email: `rls-memory-author-${nonce}@example.com`,
      displayName: "Memory Author",
      timezone: "America/Los_Angeles",
    });
    partnerId = await createUser(admin, {
      email: `rls-memory-partner-${nonce}@example.com`,
      displayName: "Memory Partner",
      timezone: "America/Los_Angeles",
    });
    thirdId = await createUser(admin, {
      email: `rls-memory-third-${nonce}@example.com`,
      displayName: "Memory Third",
      timezone: "UTC",
    });
    leaverId = await createUser(admin, {
      email: `rls-memory-leaver-${nonce}@example.com`,
      displayName: "Memory Leaver",
      timezone: "UTC",
    });
    await createUser(admin, {
      email: `rls-memory-out-${nonce}@example.com`,
      displayName: "Memory Outsider",
      timezone: "UTC",
    });
    author = (
      await signIn(apiUrl, anonKey, `rls-memory-author-${nonce}@example.com`)
    ).client;
    partner = (
      await signIn(apiUrl, anonKey, `rls-memory-partner-${nonce}@example.com`)
    ).client;
    third = (
      await signIn(apiUrl, anonKey, `rls-memory-third-${nonce}@example.com`)
    ).client;
    outsider = (
      await signIn(apiUrl, anonKey, `rls-memory-out-${nonce}@example.com`)
    ).client;
    leaver = (
      await signIn(apiUrl, anonKey, `rls-memory-leaver-${nonce}@example.com`)
    ).client;

    const created = await rpc(author, "create_circle", {
      circle_name: "Memory group",
      circle_type: "group",
    });
    circleId = created.circle_id as string;
    const token = created.token as string;
    for (const member of [partner, third, leaver]) {
      const joined = await rpc(member, "redeem_invite", {
        raw_token: token,
        ip_hash: freshIp(),
      });
      expect(joined.invite_state).toBe("joined");
    }
  });

  it("lets members read a circle memory and hides it from an outsider", async () => {
    const inserted = await author
      .from("memories")
      .insert({
        circle_id: circleId,
        kind: "note",
        body: "The ferry was late",
        visibility: "circle",
        occurred_on: utcDay(0),
        tags: ["Summer", "ferry"],
      })
      .select("id, created_by, tags, body")
      .single();
    expect(inserted.error).toBeNull();
    expect(inserted.data?.created_by).toBe(authorId);
    expect([...(inserted.data?.tags ?? [])].sort()).toEqual([
      "ferry",
      "summer",
    ]);
    expect(inserted.data).not.toHaveProperty("email");

    const seen = await partner
      .from("memories")
      .select("id, body")
      .eq("id", inserted.data!.id);
    expect(seen.data).toEqual([
      { id: inserted.data!.id, body: "The ferry was late" },
    ]);

    const also = await third
      .from("memories")
      .select("id")
      .eq("id", inserted.data!.id);
    expect(also.data).toHaveLength(1);

    const hidden = await outsider
      .from("memories")
      .select("id")
      .eq("circle_id", circleId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);

    const edited = await partner
      .from("memories")
      .update({ body: "Stolen" })
      .eq("id", inserted.data!.id)
      .select("id");
    expect(edited.error).toBeNull();
    expect(edited.data).toEqual([]);

    const removed = await partner
      .from("memories")
      .delete()
      .eq("id", inserted.data!.id)
      .select("id");
    expect(removed.data).toEqual([]);
  });

  it("shows a selected memory only to the author and the people they picked", async () => {
    const inserted = await author
      .from("memories")
      .insert({
        circle_id: circleId,
        kind: "note",
        body: "Just us",
        visibility: "selected",
        occurred_on: utcDay(0),
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    const memoryId = inserted.data!.id;

    const self = await author.from("memory_viewers").insert({
      memory_id: memoryId,
      circle_id: circleId,
      user_id: authorId,
    });
    expect(self.error).toBeTruthy();

    const listed = await author.from("memory_viewers").insert({
      memory_id: memoryId,
      circle_id: circleId,
      user_id: partnerId,
    });
    expect(listed.error).toBeNull();

    const partnerSees = await partner
      .from("memories")
      .select("body")
      .eq("id", memoryId);
    expect(partnerSees.data).toEqual([{ body: "Just us" }]);

    const thirdSees = await third
      .from("memories")
      .select("id")
      .eq("id", memoryId);
    expect(thirdSees.data).toEqual([]);

    const list = await partner
      .from("memory_viewers")
      .select("user_id")
      .eq("memory_id", memoryId);
    expect(list.data).toEqual([{ user_id: partnerId }]);

    const authorList = await author
      .from("memory_viewers")
      .select("user_id")
      .eq("memory_id", memoryId);
    expect(authorList.data).toEqual([{ user_id: partnerId }]);

    const planted = await partner.from("memory_viewers").insert({
      memory_id: memoryId,
      circle_id: circleId,
      user_id: thirdId,
    });
    expect(planted.error).toBeTruthy();
  });

  it("serves a photo with a signed URL that stops working, and not a public one", async () => {
    const memoryId = crypto.randomUUID();
    const objectPath = `${circleId}/${memoryId}.png`;
    const inserted = await author
      .from("memories")
      .insert({
        id: memoryId,
        circle_id: circleId,
        kind: "photo",
        photo_path: objectPath,
        photo_bytes: png.byteLength,
        visibility: "circle",
        occurred_on: utcDay(0),
        body: "Pixel",
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();

    const uploaded = await author.storage
      .from("memories")
      .upload(objectPath, png, { contentType: "image/png", upsert: false });
    expect(uploaded.error).toBeNull();

    const orphan = await author.storage
      .from("memories")
      .upload(`${circleId}/${crypto.randomUUID()}.png`, png, {
        contentType: "image/png",
      });
    expect(orphan.error).toBeTruthy();

    const planted = await partner.storage
      .from("memories")
      .upload(objectPath, png, { contentType: "image/png", upsert: true });
    expect(planted.error).toBeTruthy();

    const signed = await partner.storage
      .from("memories")
      .createSignedUrl(objectPath, 60);
    expect(signed.error).toBeNull();
    expect(signed.data?.signedUrl).toBeTruthy();
    const downloaded = await fetch(signed.data!.signedUrl);
    expect(downloaded.status).toBe(200);

    const outsiderSigned = await outsider.storage
      .from("memories")
      .createSignedUrl(objectPath, 60);
    expect(outsiderSigned.data?.signedUrl ?? null).toBeNull();

    const pub = await fetch(
      `${apiUrl}/storage/v1/object/public/memories/${objectPath}`,
    );
    expect(pub.ok).toBe(false);

    const brief = await author.storage
      .from("memories")
      .createSignedUrl(objectPath, 2);
    expect(brief.data?.signedUrl).toBeTruthy();
    const fresh = await fetch(brief.data!.signedUrl);
    expect(fresh.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 8000));
    const stale = await fetch(brief.data!.signedUrl);
    expect(stale.ok).toBe(false);

    const removed = await author
      .from("memories")
      .delete()
      .eq("id", memoryId)
      .select("id");
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
    const after = await partner.storage
      .from("memories")
      .createSignedUrl(objectPath, 60);
    expect(after.data?.signedUrl ?? null).toBeNull();
    const leftover = await admin.storage.from("memories").download(objectPath);
    expect(leftover.data).toBeNull();
    expect(leftover.error).toBeTruthy();
  });

  it("drops a member who leaves and still allows a note when photo space is full", async () => {
    const before = await leaver
      .from("memories")
      .select("id")
      .eq("circle_id", circleId);
    expect(before.error).toBeNull();
    expect((before.data ?? []).length).toBeGreaterThan(0);

    const goodbye = await leaver
      .from("circle_members")
      .update({ left_at: new Date().toISOString() })
      .eq("circle_id", circleId)
      .eq("user_id", leaverId);
    expect(goodbye.error).toBeNull();

    const hidden = await leaver
      .from("memories")
      .select("id")
      .eq("circle_id", circleId);
    expect(hidden.data).toEqual([]);

    const again = await leaver.from("memories").insert({
      circle_id: circleId,
      kind: "note",
      body: "After leaving",
      occurred_on: utcDay(0),
    });
    expect(again.error).toBeTruthy();
  });

  it("stops the 11th memory inside 10 minutes", async () => {
    const nonce = crypto.randomUUID();
    const limiterId = await createUser(admin, {
      email: `rls-memory-limit-${nonce}@example.com`,
      displayName: "Memory Limit",
      timezone: "UTC",
    });
    const limiter = (
      await signIn(apiUrl, anonKey, `rls-memory-limit-${nonce}@example.com`)
    ).client;
    const created = await rpc(limiter, "create_circle", {
      circle_name: "Limit wall",
      circle_type: "group",
    });
    const limitedCircle = created.circle_id as string;
    expect(limiterId).toBeTruthy();

    for (let index = 0; index < 10; index += 1) {
      const inserted = await limiter.from("memories").insert({
        circle_id: limitedCircle,
        kind: "note",
        body: `Note ${index}`,
        occurred_on: utcDay(0),
      });
      expect(inserted.error, `note ${index}`).toBeNull();
    }

    const blocked = await limiter.from("memories").insert({
      circle_id: limitedCircle,
      kind: "note",
      body: "One too many",
      occurred_on: utcDay(0),
    });
    expect(blocked.error?.message).toContain("hsummer_rate_limited");
  });

  it("refuses another photo when the circle is at 100 MB and still takes a note", async () => {
    const nonce = crypto.randomUUID();
    const quotaId = await createUser(admin, {
      email: `rls-memory-quota-${nonce}@example.com`,
      displayName: "Memory Quota",
      timezone: "UTC",
    });
    const quota = (
      await signIn(apiUrl, anonKey, `rls-memory-quota-${nonce}@example.com`)
    ).client;
    const created = await rpc(quota, "create_circle", {
      circle_name: "Full wall",
      circle_type: "group",
    });
    const fullCircle = created.circle_id as string;
    const ago = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const seeded = await admin.from("memories").insert(
      Array.from({ length: 50 }, () => {
        const id = crypto.randomUUID();
        return {
          id,
          circle_id: fullCircle,
          created_by: quotaId,
          kind: "photo" as const,
          photo_path: `${fullCircle}/${id}.jpg`,
          photo_bytes: 2 * 1024 * 1024,
          visibility: "circle" as const,
          occurred_on: utcDay(0),
          created_at: ago,
        };
      }),
    );
    expect(seeded.error).toBeNull();

    const photoId = crypto.randomUUID();
    const blocked = await quota.from("memories").insert({
      id: photoId,
      circle_id: fullCircle,
      kind: "photo",
      photo_path: `${fullCircle}/${photoId}.jpg`,
      photo_bytes: 1,
      occurred_on: utcDay(0),
    });
    expect(blocked.error?.message).toContain("hsummer_storage_quota");

    const note = await quota.from("memories").insert({
      circle_id: fullCircle,
      kind: "note",
      body: "Still room for words",
      occurred_on: utcDay(0),
    });
    expect(note.error).toBeNull();

    const usage = await quota.rpc("circle_memory_bytes", {
      target: fullCircle,
    });
    expect(usage.error).toBeNull();
    expect(Number(usage.data)).toBe(100 * 1024 * 1024);

    const outsiderUsage = await outsider.rpc("circle_memory_bytes", {
      target: fullCircle,
    });
    expect(outsiderUsage.data).toBeNull();
  });
});

function utcDay(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

describe("invite creation is rate limited", () => {
  it("stops the 11th new link and allows one after the window", async () => {
    const nonce = crypto.randomUUID();
    const userId = await createUser(admin, {
      email: `rls-invite-limit-${nonce}@example.com`,
      displayName: "Invite Limit",
      timezone: "UTC",
    });
    const client = (
      await signIn(apiUrl, anonKey, `rls-invite-limit-${nonce}@example.com`)
    ).client;

    let firstCircle = "";
    for (let made = 0; made < 10; made += 1) {
      const created = await rpc(client, "create_circle", {
        circle_name: `Limit ${made}`,
        circle_type: "couple",
      });
      if (made === 0) firstCircle = created.circle_id ?? "";
    }

    const blocked = await client.rpc("create_circle", {
      circle_name: "One too many",
      circle_type: "couple",
    });
    expect(blocked.error?.message ?? "").toContain("hsummer_rate_limited");
    expect(blocked.data).toBeNull();

    const circles = await client.from("circles").select("id");
    expect(circles.data).toHaveLength(10);

    const regenerated = await client.rpc("regenerate_invite", {
      target_circle: firstCircle,
    });
    expect(regenerated.error?.message ?? "").toContain("hsummer_rate_limited");

    const backdated = await admin
      .from("circle_invites")
      .update({
        created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      })
      .eq("created_by", userId);
    expect(backdated.error).toBeNull();

    const again = await rpc(client, "regenerate_invite", {
      target_circle: firstCircle,
    });
    expect(again.token).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});

describe("security catalog", () => {
  it("finds no public table without RLS, no public bucket, and no anon grant", async () => {
    const { data, error } = await admin.rpc("security_audit_gaps");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("does not let a signed-in user call the service-role counters", async () => {
    const bucket = `auth:test:${crypto.randomUUID().replaceAll("-", "")}`;
    const allowed = await admin.rpc("consume_auth_attempt", {
      attempt_bucket: bucket,
      attempt_limit: 1,
      attempt_window: 60,
    });
    expect(allowed.error).toBeNull();
    expect(allowed.data).toBe(true);

    const blocked = await admin.rpc("consume_auth_attempt", {
      attempt_bucket: bucket,
      attempt_limit: 1,
      attempt_window: 60,
    });
    expect(blocked.data).toBe(false);

    const asUser = await owner.rpc("consume_auth_attempt", {
      attempt_bucket: bucket,
      attempt_limit: 1,
      attempt_window: 60,
    });
    expect(asUser.error).not.toBeNull();
    expect(asUser.data).toBeNull();
  });

  it("rejects moving a push device onto someone else", async () => {
    const endpoint = `https://push.example/device/${crypto.randomUUID()}`;
    const inserted = await owner.from("push_subscriptions").insert({
      user_id: ownerId,
      endpoint,
      p256dh: "abc",
      auth: "def",
    });
    expect(inserted.error).toBeNull();

    const moved = await owner
      .from("push_subscriptions")
      .update({ user_id: otherId })
      .eq("endpoint", endpoint);
    expect(moved.error).not.toBeNull();

    const spoofed = await other.from("push_subscriptions").insert({
      user_id: ownerId,
      endpoint: `https://push.example/spoof/${crypto.randomUUID()}`,
      p256dh: "abc",
      auth: "def",
    });
    expect(spoofed.error).not.toBeNull();

    const stolen = await other
      .from("push_subscriptions")
      .select("endpoint")
      .eq("endpoint", endpoint);
    expect(stolen.data).toEqual([]);
  });
});

describe("letters stay between the sender and the recipient", () => {
  let third: Client;
  let outsider: Client;
  let leaver: Client;
  let rapid: Client;
  let thirdId = "";
  let leaverId = "";
  let rapidId = "";
  let groupId = "";

  beforeAll(async () => {
    const nonce = crypto.randomUUID();
    thirdId = await createUser(admin, {
      email: `rls-letter-third-${nonce}@example.com`,
      displayName: "Letter Third",
      timezone: "America/Chicago",
    });
    await createUser(admin, {
      email: `rls-letter-out-${nonce}@example.com`,
      displayName: "Letter Outsider",
      timezone: "UTC",
    });
    leaverId = await createUser(admin, {
      email: `rls-letter-leaver-${nonce}@example.com`,
      displayName: "Letter Leaver",
      timezone: "UTC",
    });
    rapidId = await createUser(admin, {
      email: `rls-letter-rapid-${nonce}@example.com`,
      displayName: "Letter Rapid",
      timezone: "UTC",
    });
    third = (
      await signIn(apiUrl, anonKey, `rls-letter-third-${nonce}@example.com`)
    ).client;
    outsider = (
      await signIn(apiUrl, anonKey, `rls-letter-out-${nonce}@example.com`)
    ).client;
    leaver = (
      await signIn(apiUrl, anonKey, `rls-letter-leaver-${nonce}@example.com`)
    ).client;
    rapid = (
      await signIn(apiUrl, anonKey, `rls-letter-rapid-${nonce}@example.com`)
    ).client;

    const group = await admin
      .from("circles")
      .insert({
        name: "Letter trio",
        circle_type: "group",
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (group.error || !group.data) throw group.error ?? new Error("no group");
    groupId = group.data.id;
    const members = await admin.from("circle_members").insert([
      { circle_id: groupId, user_id: ownerId },
      { circle_id: groupId, user_id: otherId },
      { circle_id: groupId, user_id: thirdId },
      { circle_id: groupId, user_id: leaverId },
      { circle_id: groupId, user_id: rapidId },
    ]);
    if (members.error) throw members.error;
  });

  it("hides a letter from a third member until it is delivered, then still hides it", async () => {
    const sealed = await admin
      .from("letters")
      .insert({
        circle_id: groupId,
        from_user_id: ownerId,
        to_user_id: otherId,
        category: "feeling-sad",
        title: "Not yet",
        body: "sealed until delivered",
        design: "minimal",
        scheduled_for: "2030-01-01T16:00:00.000Z",
      })
      .select("id, status, delivered_at")
      .single();
    expect(sealed.error).toBeNull();
    expect(sealed.data?.status).toBe("scheduled");
    expect(sealed.data?.delivered_at).toBeNull();
    const sealedId = sealed.data?.id ?? "";

    const early = await other.from("letters").select("body").eq("id", sealedId);
    expect(early.error).toBeNull();
    expect(early.data).toEqual([]);
    expect(JSON.stringify(early.data)).not.toContain("sealed until delivered");

    const senderSees = await owner
      .from("letters")
      .select("body")
      .eq("id", sealedId);
    expect(senderSees.data?.[0]?.body).toBe("sealed until delivered");

    const thirdEarly = await third
      .from("letters")
      .select("id, body")
      .eq("id", sealedId);
    expect(thirdEarly.error).toBeNull();
    expect(thirdEarly.data).toEqual([]);
    const outside = await outsider
      .from("letters")
      .select("id, body")
      .eq("id", sealedId);
    expect(outside.error).toBeNull();
    expect(outside.data).toEqual([]);

    const forgedDelivery = await owner
      .from("letters")
      .update({ delivered_at: new Date().toISOString(), status: "delivered" })
      .eq("id", sealedId);
    expect(forgedDelivery.error).not.toBeNull();

    const cancelled = await owner
      .from("letters")
      .update({ status: "cancelled" })
      .eq("id", sealedId)
      .select("status, delivered_at");
    expect(cancelled.error).toBeNull();
    expect(cancelled.data?.[0]?.status).toBe("cancelled");
    expect(cancelled.data?.[0]?.delivered_at).toBeNull();

    const stillHidden = await other
      .from("letters")
      .select("id")
      .eq("id", sealedId);
    expect(stillHidden.data).toEqual([]);
  });

  it("delivers a letter written now, and opening makes one members-only memory", async () => {
    const planted = await owner.from("letters").insert({
      circle_id: groupId,
      from_user_id: ownerId,
      to_user_id: ownerId,
      category: "need-motivation",
      body: "to myself",
      design: "minimal",
    });
    expect(planted.error).not.toBeNull();

    const tamper = await owner.from("letters").insert({
      circle_id: groupId,
      from_user_id: ownerId,
      to_user_id: otherId,
      category: "need-motivation",
      body: "backdated",
      design: "minimal",
      delivered_at: "2000-01-01T00:00:00.000Z",
    });
    expect(tamper.error).not.toBeNull();

    const sent = await owner
      .from("letters")
      .insert({
        circle_id: groupId,
        from_user_id: ownerId,
        to_user_id: otherId,
        category: "need-motivation",
        title: "Quiet title",
        body: "The secret sentence stays between us.",
        design: "kawaii",
      })
      .select("id, status, delivered_at, opened_at")
      .single();
    expect(sent.error).toBeNull();
    expect(sent.data?.status).toBe("delivered");
    expect(sent.data?.delivered_at).toBeTruthy();
    expect(sent.data?.opened_at).toBeNull();
    const letterId = sent.data?.id ?? "";

    const thirdView = await third
      .from("letters")
      .select("body, title")
      .eq("id", letterId);
    expect(thirdView.data).toEqual([]);
    expect(JSON.stringify(thirdView.data)).not.toContain(
      "The secret sentence stays between us.",
    );

    const recipient = await other
      .from("letters")
      .select("body")
      .eq("id", letterId)
      .single();
    expect(recipient.data?.body).toBe("The secret sentence stays between us.");

    const edited = await owner
      .from("letters")
      .update({ body: "rewritten" })
      .eq("id", letterId)
      .select("body");
    expect(edited.data ?? []).toEqual([]);
    const stored = await owner
      .from("letters")
      .select("body")
      .eq("id", letterId)
      .single();
    expect(stored.data?.body).toBe("The secret sentence stays between us.");

    const senderOpens = await owner.rpc("open_letter", { target: letterId });
    expect(senderOpens.error).not.toBeNull();
    const strangerOpens = await third.rpc("open_letter", { target: letterId });
    expect(strangerOpens.error).not.toBeNull();

    const opened = await other.rpc("open_letter", { target: letterId });
    expect(opened.error).toBeNull();
    expect(typeof opened.data).toBe("string");
    const again = await other.rpc("open_letter", { target: letterId });
    expect(again.error).toBeNull();
    expect(again.data).toBe(opened.data);

    const memory = await owner
      .from("memories")
      .select("id, kind, visibility, body, letter_id, created_by")
      .eq("letter_id", letterId);
    expect(memory.data).toHaveLength(1);
    expect(memory.data?.[0]).toMatchObject({
      kind: "letter",
      visibility: "selected",
      body: "Quiet title",
      letter_id: letterId,
      created_by: ownerId,
    });
    expect(memory.data?.[0]?.body).not.toContain("secret sentence");
    const memoryId = memory.data?.[0]?.id ?? "";

    const recipientMemory = await other
      .from("memories")
      .select("id")
      .eq("id", memoryId);
    expect(recipientMemory.data).toHaveLength(1);

    const thirdMemory = await third
      .from("memories")
      .select("id, body, letter_id")
      .eq("circle_id", groupId);
    expect(thirdMemory.error).toBeNull();
    expect(
      (thirdMemory.data ?? []).some((row) => row.letter_id === letterId),
    ).toBe(false);
    expect(JSON.stringify(thirdMemory.data)).not.toContain("Quiet title");
    expect(JSON.stringify(thirdMemory.data)).not.toContain("secret sentence");

    const extraViewer = await owner.from("memory_viewers").insert({
      memory_id: memoryId,
      circle_id: groupId,
      user_id: thirdId,
    });
    expect(extraViewer.error).not.toBeNull();

    const droppedViewer = await owner
      .from("memory_viewers")
      .delete()
      .eq("memory_id", memoryId);
    expect(droppedViewer.error).not.toBeNull();

    const widened = await owner
      .from("memories")
      .update({ visibility: "circle" })
      .eq("id", memoryId);
    expect(widened.error).not.toBeNull();
    const stillSelected = await admin
      .from("memories")
      .select("visibility")
      .eq("id", memoryId)
      .single();
    expect(stillSelected.data?.visibility).toBe("selected");
  });

  it("lets a third member see a custom category and not the letter that uses it", async () => {
    const added = await owner
      .from("letter_categories")
      .insert({
        circle_id: groupId,
        label: "Rainy days",
        created_by: ownerId,
      })
      .select("id, label")
      .single();
    expect(added.error).toBeNull();

    const seen = await third
      .from("letter_categories")
      .select("label")
      .eq("id", added.data?.id ?? "");
    expect(seen.data?.[0]?.label).toBe("Rainy days");

    const outside = await outsider.from("letter_categories").insert({
      circle_id: groupId,
      label: "Sneaky",
    });
    expect(outside.error).not.toBeNull();

    const builtin = await owner.from("letter_categories").insert({
      circle_id: groupId,
      label: "Need motivation",
      created_by: ownerId,
    });
    expect(builtin.error).not.toBeNull();

    const letter = await owner
      .from("letters")
      .insert({
        circle_id: groupId,
        from_user_id: ownerId,
        to_user_id: otherId,
        category: "Rainy days",
        body: "Bring the grey sweater.",
        design: "retro-film",
      })
      .select("id")
      .single();
    expect(letter.error).toBeNull();
    const hidden = await third
      .from("letters")
      .select("body")
      .eq("id", letter.data?.id ?? "");
    expect(hidden.data).toEqual([]);
    expect(JSON.stringify(hidden.data)).not.toContain("grey sweater");
  });

  it("drops a letter from someone who left", async () => {
    const sent = await owner
      .from("letters")
      .insert({
        circle_id: groupId,
        from_user_id: ownerId,
        to_user_id: leaverId,
        category: "when-you-miss-me",
        body: "Come back to the circle, not to this row.",
        design: "minimal",
      })
      .select("id")
      .single();
    expect(sent.error).toBeNull();
    const visible = await leaver
      .from("letters")
      .select("id")
      .eq("id", sent.data?.id ?? "");
    expect(visible.data).toHaveLength(1);

    const left = await leaver
      .from("circle_members")
      .update({ left_at: new Date().toISOString() })
      .eq("circle_id", groupId)
      .eq("user_id", leaverId)
      .select("left_at");
    expect(left.error).toBeNull();
    expect(left.data?.[0]?.left_at).toBeTruthy();

    const gone = await leaver
      .from("letters")
      .select("id")
      .eq("circle_id", groupId);
    expect(gone.data).toEqual([]);
    const goneMemory = await leaver
      .from("memories")
      .select("id")
      .eq("circle_id", groupId);
    expect(goneMemory.data).toEqual([]);
  });

  it("stops an eleventh letter inside ten minutes", async () => {
    const bodies: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const sent = await rapid.from("letters").insert({
        circle_id: groupId,
        from_user_id: rapidId,
        to_user_id: ownerId,
        category: "need-help",
        body: `Rapid letter ${index} ${crypto.randomUUID()}`,
        design: "minimal",
      });
      bodies.push(sent.error?.message ?? "");
      expect(sent.error).toBeNull();
    }

    const blocked = await rapid.from("letters").insert({
      circle_id: groupId,
      from_user_id: rapidId,
      to_user_id: ownerId,
      category: "need-help",
      body: "This one should wait.",
      design: "minimal",
    });
    expect(blocked.error?.message ?? "").toContain("hsummer_rate_limited");
    expect(bodies.every((message) => message === "")).toBe(true);
  });

  it("keeps a future letter scheduled and hidden, and delivers one that is due", async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const scheduled = await owner
      .from("letters")
      .insert({
        circle_id: groupId,
        from_user_id: ownerId,
        to_user_id: otherId,
        category: "when-you-miss-me",
        body: "Open this next week.",
        design: "minimal",
        scheduled_for: future,
      })
      .select("id, status, delivered_at, scheduled_for")
      .single();
    expect(scheduled.error).toBeNull();
    expect(scheduled.data?.status).toBe("scheduled");
    expect(scheduled.data?.delivered_at).toBeNull();
    const scheduledId = scheduled.data?.id ?? "";

    const hidden = await other
      .from("letters")
      .select("body")
      .eq("id", scheduledId);
    expect(hidden.data).toEqual([]);
    expect(JSON.stringify(hidden.data)).not.toContain("next week");

    const thirdView = await third
      .from("letters")
      .select("id")
      .eq("id", scheduledId);
    expect(thirdView.data).toEqual([]);

    const tooSoon = await owner.from("letters").insert({
      circle_id: groupId,
      from_user_id: ownerId,
      to_user_id: otherId,
      category: "need-help",
      body: "This minute is too soon.",
      design: "minimal",
      scheduled_for: new Date(Date.now() + 5_000).toISOString(),
    });
    expect(tooSoon.error?.message ?? "").toContain("hsummer_letter_schedule");

    const qstashColumn = await owner
      .from("letters")
      .select("qstash_message_id")
      .eq("id", scheduledId);
    expect(qstashColumn.error).not.toBeNull();

    const forgedQueue = await owner
      .from("letters")
      .update({ qstash_message_id: "msg_test_queue" })
      .eq("id", scheduledId);
    expect(forgedQueue.error).not.toBeNull();

    const callerDelivers = await owner.rpc("deliver_scheduled_letter", {
      target: scheduledId,
    });
    expect(callerDelivers.error).not.toBeNull();

    const early = await admin.rpc("deliver_scheduled_letter", {
      target: scheduledId,
    });
    expect(early.error).toBeNull();
    expect(early.data).toBe("early");
    const stillHidden = await other
      .from("letters")
      .select("id")
      .eq("id", scheduledId);
    expect(stillHidden.data).toEqual([]);

    const due = await admin
      .from("letters")
      .insert({
        circle_id: groupId,
        from_user_id: ownerId,
        to_user_id: otherId,
        category: "feeling-lonely",
        body: "The morning letter is here.",
        design: "minimal",
        scheduled_for: new Date(Date.now() - 60_000).toISOString(),
      })
      .select("id, status")
      .single();
    expect(due.error).toBeNull();
    expect(due.data?.status).toBe("scheduled");
    const dueId = due.data?.id ?? "";

    const arrived = await admin.rpc("deliver_scheduled_letter", {
      target: dueId,
    });
    expect(arrived.error).toBeNull();
    expect(arrived.data).toBe("delivered");
    const again = await admin.rpc("deliver_scheduled_letter", {
      target: dueId,
    });
    expect(again.data).toBe("already");

    const recipient = await other
      .from("letters")
      .select("body")
      .eq("id", dueId);
    expect(recipient.data?.[0]?.body).toBe("The morning letter is here.");
    const thirdAfter = await third
      .from("letters")
      .select("body")
      .eq("id", dueId);
    expect(thirdAfter.data).toEqual([]);
    expect(JSON.stringify(thirdAfter.data)).not.toContain("morning letter");

    const leftBehind = await admin
      .from("letters")
      .insert({
        circle_id: groupId,
        from_user_id: ownerId,
        to_user_id: leaverId,
        category: "need-help",
        body: "Do not deliver this to someone who left.",
        design: "minimal",
        scheduled_for: new Date(Date.now() - 60_000).toISOString(),
      })
      .select("id")
      .single();
    expect(leftBehind.error).toBeNull();
    const cancelled = await admin.rpc("deliver_scheduled_letter", {
      target: leftBehind.data?.id ?? "",
    });
    expect(cancelled.data).toBe("cancelled");
    const leaverView = await leaver
      .from("letters")
      .select("id")
      .eq("id", leftBehind.data?.id ?? "");
    expect(leaverView.data).toEqual([]);
  });
});

describe("Still Us stays inside the circle and hits once", () => {
  it("gives a couple one countdown and one memory when two people sync", async () => {
    const created = await owner.rpc("create_circle", {
      circle_name: "Still Us",
      circle_type: "couple",
    });
    expect(created.error).toBeNull();
    const circleId = created.data?.[0]?.circle_id ?? "";
    expect(circleId).toMatch(/^[0-9a-f-]{36}$/i);

    const seeded = await owner
      .from("countdowns")
      .select("id, label, target_date")
      .eq("circle_id", circleId);
    expect(seeded.data).toHaveLength(1);
    expect(seeded.data?.[0]?.label).toBe("Still Us");
    expect(seeded.data?.[0]?.target_date).toBeNull();
    const countdownId = seeded.data?.[0]?.id ?? "";

    const nonce = crypto.randomUUID();
    const outsiderId = await createUser(admin, {
      email: `rls-still-out-${nonce}@example.com`,
      displayName: "Still Out",
      timezone: "UTC",
    });
    const outsider = await signIn(
      apiUrl,
      anonKey,
      `rls-still-out-${nonce}@example.com`,
    );
    const outside = await outsider.client
      .from("countdowns")
      .select("id")
      .eq("circle_id", circleId);
    expect(outside.data).toEqual([]);
    const sneaky = await outsider.client.from("countdowns").insert({
      circle_id: circleId,
      label: "Nope",
      created_by: outsiderId,
    });
    expect(sneaky.error).not.toBeNull();

    const second = await owner.from("countdowns").insert({
      circle_id: circleId,
      label: "Another reunion",
      target_date: "2027-06-01",
      created_by: ownerId,
    });
    expect(second.error?.message ?? "").toContain("hsummer_countdown_couple");

    const removed = await owner
      .from("countdowns")
      .delete()
      .eq("id", countdownId)
      .select("id");
    expect(removed.error?.message ?? "").toContain("hsummer_countdown_couple");

    const dated = await owner
      .from("countdowns")
      .update({ target_date: "2027-02-14", label: "Winter" })
      .eq("id", countdownId)
      .select("target_date, label");
    expect(dated.error).toBeNull();
    expect(dated.data?.[0]?.target_date).toBe("2027-02-14");

    const joined = await admin.from("circle_members").insert({
      circle_id: circleId,
      user_id: otherId,
    });
    expect(joined.error).toBeNull();

    const partnerSees = await other
      .from("countdowns")
      .select("label")
      .eq("id", countdownId);
    expect(partnerSees.data?.[0]?.label).toBe("Winter");

    const auto = await owner
      .from("checkpoints")
      .insert({
        countdown_id: countdownId,
        circle_id: circleId,
        label: "100 days",
        date: "2020-01-01",
        trigger: "auto-by-date",
        created_by: ownerId,
      })
      .select("id")
      .single();
    expect(auto.error).toBeNull();
    const autoId = auto.data?.id ?? "";

    const [first, secondSync] = await Promise.all([
      owner.rpc("sync_auto_checkpoints", { target_circle: circleId }),
      other.rpc("sync_auto_checkpoints", { target_circle: circleId }),
    ]);
    expect(first.error).toBeNull();
    expect(secondSync.error).toBeNull();

    const memories = await owner
      .from("memories")
      .select("id, kind, visibility, body, checkpoint_id")
      .eq("checkpoint_id", autoId);
    expect(memories.data).toHaveLength(1);
    expect(memories.data?.[0]).toMatchObject({
      kind: "milestone",
      visibility: "circle",
      body: "100 days",
      checkpoint_id: autoId,
    });
    const memoryId = memories.data?.[0]?.id ?? "";

    const partnerMemory = await other
      .from("memories")
      .select("id, body")
      .eq("id", memoryId);
    expect(partnerMemory.data?.[0]?.body).toBe("100 days");

    const outsiderMemory = await outsider.client
      .from("memories")
      .select("id, body")
      .eq("circle_id", circleId);
    expect(outsiderMemory.data).toEqual([]);
    expect(JSON.stringify(outsiderMemory.data)).not.toContain("100 days");

    const again = await owner.rpc("sync_auto_checkpoints", {
      target_circle: circleId,
    });
    expect(again.error).toBeNull();
    expect(again.data ?? []).toEqual([]);
    const stillOne = await owner
      .from("memories")
      .select("id")
      .eq("checkpoint_id", autoId);
    expect(stillOne.data).toHaveLength(1);

    const manual = await other
      .from("checkpoints")
      .insert({
        countdown_id: countdownId,
        circle_id: circleId,
        label: "Flight booked",
        date: "2027-03-01",
        trigger: "manual",
        created_by: otherId,
      })
      .select("id")
      .single();
    expect(manual.error).toBeNull();
    const manualId = manual.data?.id ?? "";

    const forgedHit = await other
      .from("checkpoints")
      .update({ hit_at: new Date().toISOString() })
      .eq("id", manualId);
    expect(forgedHit.error).not.toBeNull();

    const hit = await other.rpc("hit_checkpoint", { target: manualId });
    expect(hit.error).toBeNull();
    const hitAgain = await owner.rpc("hit_checkpoint", { target: manualId });
    expect(hitAgain.error).toBeNull();
    expect(hitAgain.data).toBe(hit.data);

    const manualMemories = await owner
      .from("memories")
      .select("id")
      .eq("checkpoint_id", manualId);
    expect(manualMemories.data).toHaveLength(1);

    const autoHit = await owner.rpc("hit_checkpoint", { target: autoId });
    expect(autoHit.error).not.toBeNull();

    const planted = await owner.from("memories").insert({
      circle_id: circleId,
      kind: "milestone",
      body: "Forged milestone",
      visibility: "circle",
      occurred_on: "2026-10-14",
    });
    expect(planted.error).not.toBeNull();
  });
});

describe("a solo booth strip is visible to the circle and nobody else", () => {
  let author: Client;
  let partner: Client;
  let third: Client;
  let outsider: Client;
  let leaver: Client;
  let leaverId = "";
  let circleId = "";

  beforeAll(async () => {
    const nonce = crypto.randomUUID();
    await createUser(admin, {
      email: `rls-booth-author-${nonce}@example.com`,
      displayName: "Booth Author",
      timezone: "America/Los_Angeles",
    });
    await createUser(admin, {
      email: `rls-booth-partner-${nonce}@example.com`,
      displayName: "Booth Partner",
      timezone: "America/Los_Angeles",
    });
    await createUser(admin, {
      email: `rls-booth-third-${nonce}@example.com`,
      displayName: "Booth Third",
      timezone: "UTC",
    });
    leaverId = await createUser(admin, {
      email: `rls-booth-leaver-${nonce}@example.com`,
      displayName: "Booth Leaver",
      timezone: "UTC",
    });
    await createUser(admin, {
      email: `rls-booth-out-${nonce}@example.com`,
      displayName: "Booth Outsider",
      timezone: "UTC",
    });
    author = (
      await signIn(apiUrl, anonKey, `rls-booth-author-${nonce}@example.com`)
    ).client;
    partner = (
      await signIn(apiUrl, anonKey, `rls-booth-partner-${nonce}@example.com`)
    ).client;
    third = (
      await signIn(apiUrl, anonKey, `rls-booth-third-${nonce}@example.com`)
    ).client;
    outsider = (
      await signIn(apiUrl, anonKey, `rls-booth-out-${nonce}@example.com`)
    ).client;
    leaver = (
      await signIn(apiUrl, anonKey, `rls-booth-leaver-${nonce}@example.com`)
    ).client;

    const created = await rpc(author, "create_circle", {
      circle_name: "Booth group",
      circle_type: "group",
    });
    circleId = created.circle_id as string;
    const token = created.token as string;
    for (const member of [partner, third, leaver]) {
      const joined = await rpc(member, "redeem_invite", {
        raw_token: token,
        ip_hash: freshIp(),
      });
      expect(joined.invite_state).toBe("joined");
    }
  });

  it("refuses a direct insert and saves one circle-visible strip", async () => {
    const planted = await author.from("booth_sessions").insert({
      circle_id: circleId,
      mode: "solo",
      theme: "kawaii",
      frame_layout: "4-cut",
    });
    expect(planted.error).not.toBeNull();

    const forged = await author.from("memories").insert({
      circle_id: circleId,
      kind: "photo-strip",
      visibility: "circle",
      occurred_on: utcDay(0),
      photo_bytes: 12,
    });
    expect(forged.error).not.toBeNull();

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const saved = await author.rpc("save_solo_booth", {
      target_circle: circleId,
      target_theme: "kawaii",
      target_layout: "4-cut",
      target_filter: "warm",
      target_caption: "Ferry lights",
      shot_sizes: [jpeg.length, jpeg.length, jpeg.length, jpeg.length],
    });
    expect(saved.error).toBeNull();
    const payload = saved.data;
    expect(payload?.paths).toHaveLength(4);
    const memoryId = payload?.memory_id ?? "";
    const sessionId = payload?.session_id ?? "";

    for (const path of payload?.paths ?? []) {
      const uploaded = await author.storage
        .from("memories")
        .upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
      expect(uploaded.error).toBeNull();
    }

    const seen = await partner
      .from("memories")
      .select("id, kind, visibility, body, booth_session_id")
      .eq("id", memoryId);
    expect(seen.data).toEqual([
      expect.objectContaining({
        kind: "photo-strip",
        visibility: "circle",
        body: "Ferry lights",
        booth_session_id: sessionId,
      }),
    ]);

    const thirdSees = await third
      .from("booth_shots")
      .select("position")
      .eq("session_id", sessionId);
    expect(thirdSees.data).toHaveLength(4);

    const outside = await outsider
      .from("memories")
      .select("id")
      .eq("id", memoryId);
    expect(outside.data).toEqual([]);
    const outsideShot = await outsider
      .from("booth_shots")
      .select("storage_path")
      .eq("session_id", sessionId);
    expect(outsideShot.data).toEqual([]);

    const path = payload?.paths[0] ?? "";
    const stolen = await outsider.storage
      .from("memories")
      .createSignedUrl(path, 60);
    expect(stolen.data?.signedUrl ?? null).toBeNull();
    const signed = await partner.storage
      .from("memories")
      .createSignedUrl(path, 60);
    expect(signed.data?.signedUrl).toBeTruthy();
    const downloaded = await fetch(signed.data!.signedUrl);
    expect(downloaded.status).toBe(200);
    const pub = await fetch(
      `${apiUrl}/storage/v1/object/public/memories/${path}`,
    );
    expect(pub.ok).toBe(false);

    const left = await leaver
      .from("circle_members")
      .update({ left_at: new Date().toISOString() })
      .eq("circle_id", circleId)
      .eq("user_id", leaverId)
      .select("left_at");
    expect(left.data?.[0]?.left_at).toBeTruthy();
    const afterLeave = await leaver
      .from("memories")
      .select("id")
      .eq("id", memoryId);
    expect(afterLeave.data).toEqual([]);

    const removed = await author
      .from("memories")
      .delete()
      .eq("id", memoryId)
      .select("id");
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
    const gone = await partner
      .from("booth_sessions")
      .select("id")
      .eq("id", sessionId);
    expect(gone.data).toEqual([]);
    const leftover = await admin.storage.from("memories").download(path);
    expect(leftover.data).toBeNull();
  });

  it("refuses a non-member and a strip with the wrong number of frames", async () => {
    const outsiderSave = await outsider.rpc("save_solo_booth", {
      target_circle: circleId,
      target_theme: "minimal",
      target_layout: "2-cut",
      target_filter: "none",
      target_caption: "",
      shot_sizes: [10, 10],
    });
    expect(outsiderSave.error).not.toBeNull();
    expect(outsiderSave.data).toBeNull();

    const short = await author.rpc("save_solo_booth", {
      target_circle: circleId,
      target_theme: "kawaii",
      target_layout: "4-cut",
      target_filter: "none",
      target_caption: "",
      shot_sizes: [10, 10, 10],
    });
    expect(short.error).not.toBeNull();
  });

  it("stops the 11th strip for one person", async () => {
    const nonce = crypto.randomUUID();
    const rapidId = await createUser(admin, {
      email: `rls-booth-rapid-${nonce}@example.com`,
      displayName: "Booth Rapid",
      timezone: "UTC",
    });
    const rapid = (
      await signIn(apiUrl, anonKey, `rls-booth-rapid-${nonce}@example.com`)
    ).client;
    const created = await rpc(rapid, "create_circle", {
      circle_name: "Booth rapid",
      circle_type: "couple",
    });
    expect(rapidId).toBeTruthy();
    for (let count = 0; count < 10; count += 1) {
      const saved = await rapid.rpc("save_solo_booth", {
        target_circle: created.circle_id as string,
        target_theme: "minimal",
        target_layout: "2-cut",
        target_filter: "none",
        target_caption: "",
        shot_sizes: [8, 8],
      });
      expect(saved.error).toBeNull();
    }
    const blocked = await rapid.rpc("save_solo_booth", {
      target_circle: created.circle_id as string,
      target_theme: "minimal",
      target_layout: "2-cut",
      target_filter: "none",
      target_caption: "",
      shot_sizes: [8, 8],
    });
    expect(blocked.error?.message).toContain("hsummer_rate_limited");
  });
});

describe("a pass booth stays between its two people until the strip is finished", () => {
  let author: Client;
  let partner: Client;
  let third: Client;
  let outsider: Client;
  let authorId = "";
  let partnerId = "";
  let thirdId = "";
  let circleId = "";

  beforeAll(async () => {
    const nonce = crypto.randomUUID();
    authorId = await createUser(admin, {
      email: `rls-pass-author-${nonce}@example.com`,
      displayName: "Pass Author",
      timezone: "America/Los_Angeles",
    });
    partnerId = await createUser(admin, {
      email: `rls-pass-partner-${nonce}@example.com`,
      displayName: "Pass Partner",
      timezone: "America/Los_Angeles",
    });
    thirdId = await createUser(admin, {
      email: `rls-pass-third-${nonce}@example.com`,
      displayName: "Pass Third",
      timezone: "UTC",
    });
    await createUser(admin, {
      email: `rls-pass-out-${nonce}@example.com`,
      displayName: "Pass Outsider",
      timezone: "UTC",
    });
    author = (
      await signIn(apiUrl, anonKey, `rls-pass-author-${nonce}@example.com`)
    ).client;
    partner = (
      await signIn(apiUrl, anonKey, `rls-pass-partner-${nonce}@example.com`)
    ).client;
    third = (
      await signIn(apiUrl, anonKey, `rls-pass-third-${nonce}@example.com`)
    ).client;
    outsider = (
      await signIn(apiUrl, anonKey, `rls-pass-out-${nonce}@example.com`)
    ).client;

    const created = await rpc(author, "create_circle", {
      circle_name: "Pass group",
      circle_type: "group",
    });
    circleId = created.circle_id as string;
    const token = created.token as string;
    for (const member of [partner, third]) {
      const joined = await rpc(member, "redeem_invite", {
        raw_token: token,
        ip_hash: freshIp(),
      });
      expect(joined.invite_state).toBe("joined");
    }
  });

  it("hides an open pass from a third member, then shows the finished strip", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const started = await author.rpc("create_pass_booth", {
      target_circle: circleId,
      partner_id: partnerId,
      target_theme: "kawaii",
      target_layout: "4-cut",
      target_filter: "warm",
      target_caption: "Night ferry",
      shot_sizes: [jpeg.length, jpeg.length],
    });
    expect(started.error).toBeNull();
    const sessionId = started.data?.session_id ?? "";
    const paths = started.data?.paths ?? [];
    expect(paths).toHaveLength(2);
    expect(authorId).toBeTruthy();

    const contributors = await author
      .from("booth_contributors")
      .select("user_id, assigned_positions")
      .eq("session_id", sessionId);
    expect(contributors.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: authorId,
          assigned_positions: [0, 1],
        }),
        expect.objectContaining({
          user_id: partnerId,
          assigned_positions: [2, 3],
        }),
      ]),
    );

    const hidden = await third
      .from("booth_sessions")
      .select("id")
      .eq("id", sessionId);
    expect(hidden.data).toEqual([]);
    const hiddenShots = await third
      .from("booth_shots")
      .select("position")
      .eq("session_id", sessionId);
    expect(hiddenShots.data).toEqual([]);

    const outsiderStart = await outsider.rpc("create_pass_booth", {
      target_circle: circleId,
      partner_id: partnerId,
      target_theme: "minimal",
      target_layout: "2-cut",
      target_filter: "none",
      target_caption: "",
      shot_sizes: [jpeg.length],
    });
    expect(outsiderStart.error).not.toBeNull();

    const selfPartner = await author.rpc("create_pass_booth", {
      target_circle: circleId,
      partner_id: authorId,
      target_theme: "kawaii",
      target_layout: "2-cut",
      target_filter: "none",
      target_caption: "",
      shot_sizes: [jpeg.length],
    });
    expect(selfPartner.error).not.toBeNull();

    const tamper = await partner
      .from("booth_sessions")
      .update({ status: "complete" })
      .eq("id", sessionId);
    expect(tamper.error).not.toBeNull();

    for (const path of paths) {
      const uploaded = await author.storage
        .from("memories")
        .upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
      expect(uploaded.error).toBeNull();
    }

    const stolen = await third.storage
      .from("memories")
      .createSignedUrl(paths[0] ?? "", 60);
    expect(stolen.data?.signedUrl ?? null).toBeNull();
    const signed = await partner.storage
      .from("memories")
      .createSignedUrl(paths[0] ?? "", 60);
    expect(signed.data?.signedUrl).toBeTruthy();

    const wrongFrame = await partner.storage
      .from("memories")
      .upload(paths[0] ?? "", jpeg, {
        contentType: "image/jpeg",
        upsert: false,
      });
    expect(wrongFrame.error).not.toBeNull();

    const thirdSubmit = await third.rpc("submit_pass_shots", {
      target_session: sessionId,
      target_filter: "cool",
      shot_sizes: [jpeg.length, jpeg.length],
    });
    expect(thirdSubmit.error).not.toBeNull();
    const thirdFinish = await third.rpc("finish_pass_booth", {
      target_session: sessionId,
    });
    expect(thirdFinish.error).not.toBeNull();
    const thirdCancel = await third.rpc("cancel_pass_booth", {
      target_session: sessionId,
    });
    expect(thirdCancel.error).not.toBeNull();

    const early = await author.rpc("finish_pass_booth", {
      target_session: sessionId,
    });
    expect(early.error).toBeNull();
    expect(early.data?.status).toBe("open");
    expect(early.data?.memory_id).toBeNull();

    const submitted = await partner.rpc("submit_pass_shots", {
      target_session: sessionId,
      target_filter: "cool",
      shot_sizes: [jpeg.length, jpeg.length],
    });
    expect(submitted.error).toBeNull();
    expect(submitted.data?.status).toBe("open");
    expect(submitted.data?.paths).toHaveLength(2);
    for (const path of submitted.data?.paths ?? []) {
      const uploaded = await partner.storage
        .from("memories")
        .upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
      expect(uploaded.error).toBeNull();
    }

    const finished = await partner.rpc("finish_pass_booth", {
      target_session: sessionId,
    });
    expect(finished.error).toBeNull();
    expect(finished.data?.status).toBe("complete");
    const memoryId = finished.data?.memory_id ?? "";
    expect(memoryId).toMatch(/^[0-9a-f-]{36}$/);

    const seen = await third
      .from("memories")
      .select("id, kind, visibility, body")
      .eq("id", memoryId);
    expect(seen.data).toEqual([
      expect.objectContaining({
        kind: "photo-strip",
        visibility: "circle",
        body: "Night ferry",
      }),
    ]);
    const frames = await third
      .from("booth_shots")
      .select("position")
      .eq("session_id", sessionId);
    expect(frames.data).toHaveLength(4);
    const outside = await outsider
      .from("memories")
      .select("id")
      .eq("id", memoryId);
    expect(outside.data).toEqual([]);
  });

  it("lets a named third member finish, and refuses everyone else", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const started = await author.rpc("create_pass_booth", {
      target_circle: circleId,
      partner_id: thirdId,
      target_theme: "minimal",
      target_layout: "2-cut",
      target_filter: "none",
      target_caption: "",
      shot_sizes: [jpeg.length],
    });
    expect(started.error).toBeNull();
    const sessionId = started.data?.session_id ?? "";
    const path = started.data?.paths?.[0] ?? "";
    const uploaded = await author.storage
      .from("memories")
      .upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
    expect(uploaded.error).toBeNull();

    const partnerBlind = await partner
      .from("booth_sessions")
      .select("id")
      .eq("id", sessionId);
    expect(partnerBlind.data).toEqual([]);

    const seen = await third
      .from("booth_sessions")
      .select("id, status")
      .eq("id", sessionId);
    expect(seen.data).toEqual([
      expect.objectContaining({ id: sessionId, status: "open" }),
    ]);

    const submitted = await third.rpc("submit_pass_shots", {
      target_session: sessionId,
      target_filter: "bw",
      shot_sizes: [jpeg.length],
    });
    expect(submitted.error).toBeNull();
    const theirPath = submitted.data?.paths?.[0] ?? "";
    const theirUpload = await third.storage
      .from("memories")
      .upload(theirPath, jpeg, { contentType: "image/jpeg", upsert: false });
    expect(theirUpload.error).toBeNull();
    const finished = await third.rpc("finish_pass_booth", {
      target_session: sessionId,
    });
    expect(finished.data?.status).toBe("complete");
  });

  it("lets the starter cancel, and closes an expired pass without a memory", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const started = await author.rpc("create_pass_booth", {
      target_circle: circleId,
      partner_id: partnerId,
      target_theme: "kawaii",
      target_layout: "2-cut",
      target_filter: "none",
      target_caption: "",
      shot_sizes: [jpeg.length],
    });
    expect(started.error).toBeNull();
    const sessionId = started.data?.session_id ?? "";

    const partnerCancel = await partner.rpc("cancel_pass_booth", {
      target_session: sessionId,
    });
    expect(partnerCancel.error).not.toBeNull();

    const cancelled = await author.rpc("cancel_pass_booth", {
      target_session: sessionId,
    });
    expect(cancelled.error).toBeNull();
    expect(cancelled.data?.status).toBe("cancelled");
    const shots = await author
      .from("booth_shots")
      .select("position")
      .eq("session_id", sessionId);
    expect(shots.data).toEqual([]);
    const memory = await author
      .from("memories")
      .select("id")
      .eq("booth_session_id", sessionId);
    expect(memory.data).toEqual([]);

    const expiring = await author.rpc("create_pass_booth", {
      target_circle: circleId,
      partner_id: partnerId,
      target_theme: "minimal",
      target_layout: "2-cut",
      target_filter: "sepia",
      target_caption: "",
      shot_sizes: [jpeg.length],
    });
    expect(expiring.error).toBeNull();
    const expiredId = expiring.data?.session_id ?? "";
    const moved = await admin
      .from("booth_sessions")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", expiredId)
      .select("id");
    expect(moved.error).toBeNull();

    const closed = await partner.rpc("expire_pass_booths", {
      target_circle: circleId,
    });
    expect(closed.error).toBeNull();
    expect(closed.data).toBeGreaterThanOrEqual(1);

    const row = await partner
      .from("booth_sessions")
      .select("status")
      .eq("id", expiredId);
    expect(row.data).toEqual([expect.objectContaining({ status: "expired" })]);
    const leftover = await partner
      .from("booth_shots")
      .select("position")
      .eq("session_id", expiredId);
    expect(leftover.data).toEqual([]);
    const stillHidden = await third
      .from("booth_sessions")
      .select("id")
      .eq("id", expiredId);
    expect(stillHidden.data).toEqual([]);

    const late = await partner.rpc("submit_pass_shots", {
      target_session: expiredId,
      target_filter: "none",
      shot_sizes: [jpeg.length],
    });
    expect(late.error).toBeNull();
    expect(late.data?.status).toBe("expired");
  });

  it("stops a fourth open pass in one circle", async () => {
    const nonce = crypto.randomUUID();
    const starterId = await createUser(admin, {
      email: `rls-pass-cap-${nonce}@example.com`,
      displayName: "Pass Cap",
      timezone: "UTC",
    });
    const friendId = await createUser(admin, {
      email: `rls-pass-cap-friend-${nonce}@example.com`,
      displayName: "Pass Friend",
      timezone: "UTC",
    });
    const starter = (
      await signIn(apiUrl, anonKey, `rls-pass-cap-${nonce}@example.com`)
    ).client;
    const friend = (
      await signIn(apiUrl, anonKey, `rls-pass-cap-friend-${nonce}@example.com`)
    ).client;
    const created = await rpc(starter, "create_circle", {
      circle_name: "Pass cap",
      circle_type: "group",
    });
    const joined = await rpc(friend, "redeem_invite", {
      raw_token: created.token as string,
      ip_hash: freshIp(),
    });
    expect(joined.invite_state).toBe("joined");
    expect(starterId).toBeTruthy();
    expect(friendId).toBeTruthy();

    for (let count = 0; count < 3; count += 1) {
      const started = await starter.rpc("create_pass_booth", {
        target_circle: created.circle_id as string,
        partner_id: friendId,
        target_theme: "kawaii",
        target_layout: "2-cut",
        target_filter: "none",
        target_caption: "",
        shot_sizes: [8],
      });
      expect(started.error).toBeNull();
    }
    const blocked = await starter.rpc("create_pass_booth", {
      target_circle: created.circle_id as string,
      partner_id: friendId,
      target_theme: "kawaii",
      target_layout: "2-cut",
      target_filter: "none",
      target_caption: "",
      shot_sizes: [8],
    });
    expect(blocked.error?.message).toContain("hsummer_booth_open");
  });
});

describe("leaving, deletion, export storage, and the demo circle", () => {
  it("keeps a note when someone leaves, and removes it when they ask", async () => {
    const nonce = crypto.randomUUID();
    const keeperEmail = `rls-keep-${nonce}@example.com`;
    const removerEmail = `rls-remove-${nonce}@example.com`;
    await createUser(admin, {
      email: keeperEmail,
      displayName: "Keep Person",
      timezone: "UTC",
    });
    const removerId = await createUser(admin, {
      email: removerEmail,
      displayName: "Remove Person",
      timezone: "UTC",
    });
    const keeper = (await signIn(apiUrl, anonKey, keeperEmail)).client;
    const remover = (await signIn(apiUrl, anonKey, removerEmail)).client;

    const kept = await rpc(keeper, "create_circle", {
      circle_name: "Keep notes",
      circle_type: "couple",
    });
    await rpc(remover, "redeem_invite", {
      raw_token: kept.token,
      ip_hash: freshIp(),
    });
    const note = await keeper
      .from("memories")
      .insert({
        circle_id: kept.circle_id as string,
        kind: "note",
        body: "Stay after I leave",
        occurred_on: utcDay(0),
      })
      .select("id")
      .single();
    expect(note.error).toBeNull();

    const stayed = await keeper.rpc("leave_circle", {
      target_circle: kept.circle_id as string,
      remove_content: false,
    });
    expect(stayed.error).toBeNull();
    const stillThere = await remover
      .from("memories")
      .select("body")
      .eq("id", note.data?.id ?? "");
    expect(stillThere.data).toEqual([{ body: "Stay after I leave" }]);

    const removedCircle = await rpc(remover, "create_circle", {
      circle_name: "Remove notes",
      circle_type: "group",
    });
    const gone = await remover
      .from("memories")
      .insert({
        circle_id: removedCircle.circle_id as string,
        kind: "note",
        body: "Delete me",
        occurred_on: utcDay(0),
      })
      .select("id")
      .single();
    expect(gone.error).toBeNull();
    const wiped = await remover.rpc("leave_circle", {
      target_circle: removedCircle.circle_id as string,
      remove_content: true,
    });
    expect(wiped.error).toBeNull();
    const leftover = await admin
      .from("memories")
      .select("id")
      .eq("id", gone.data?.id ?? "");
    expect(leftover.data).toEqual([]);
    expect(removerId).toBeTruthy();
  });

  it("cancels a scheduled letter when its sender leaves", async () => {
    const nonce = crypto.randomUUID();
    const senderEmail = `rls-letter-leave-${nonce}@example.com`;
    const recipientEmail = `rls-letter-stay-${nonce}@example.com`;
    const senderId = await createUser(admin, {
      email: senderEmail,
      displayName: "Letter Sender",
      timezone: "UTC",
    });
    const recipientId = await createUser(admin, {
      email: recipientEmail,
      displayName: "Letter Stay",
      timezone: "UTC",
    });
    const sender = (await signIn(apiUrl, anonKey, senderEmail)).client;
    const recipient = (await signIn(apiUrl, anonKey, recipientEmail)).client;
    const created = await rpc(sender, "create_circle", {
      circle_name: "Scheduled goodbye",
      circle_type: "couple",
    });
    await rpc(recipient, "redeem_invite", {
      raw_token: created.token,
      ip_hash: freshIp(),
    });
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const letter = await admin
      .from("letters")
      .insert({
        circle_id: created.circle_id as string,
        from_user_id: senderId,
        to_user_id: recipientId,
        category: "when-you-miss-me",
        body: "Open this next week",
        design: "minimal",
        scheduled_for: later,
      })
      .select("id, status")
      .single();
    expect(letter.error).toBeNull();
    expect(letter.data?.status).toBe("scheduled");

    const left = await sender.rpc("leave_circle", {
      target_circle: created.circle_id as string,
      remove_content: false,
    });
    expect(left.error).toBeNull();
    const after = await admin
      .from("letters")
      .select("status")
      .eq("id", letter.data?.id ?? "")
      .single();
    expect(after.data?.status).toBe("cancelled");
  });

  it("refuses a new couple invite after one person has left", async () => {
    const nonce = crypto.randomUUID();
    const hostEmail = `rls-closed-host-${nonce}@example.com`;
    const guestEmail = `rls-closed-guest-${nonce}@example.com`;
    await createUser(admin, {
      email: hostEmail,
      displayName: "Closed Host",
      timezone: "UTC",
    });
    await createUser(admin, {
      email: guestEmail,
      displayName: "Closed Guest",
      timezone: "UTC",
    });
    const host = (await signIn(apiUrl, anonKey, hostEmail)).client;
    const guest = (await signIn(apiUrl, anonKey, guestEmail)).client;
    const created = await rpc(host, "create_circle", {
      circle_name: "Closed couple",
      circle_type: "couple",
    });
    await rpc(guest, "redeem_invite", {
      raw_token: created.token,
      ip_hash: freshIp(),
    });
    const left = await guest.rpc("leave_circle", {
      target_circle: created.circle_id as string,
      remove_content: false,
    });
    expect(left.error).toBeNull();
    const again = await host.rpc("regenerate_invite", {
      target_circle: created.circle_id as string,
    });
    expect(again.error?.message).toContain("hsummer_couple_closed");
  });

  it("deletes the login, push row, and avatar, and keeps a note as Former member", async () => {
    const nonce = crypto.randomUUID();
    const email = `rls-delete-${nonce}@example.com`;
    const userId = await createUser(admin, {
      email,
      displayName: "Delete Me",
      timezone: "UTC",
    });
    const client = (await signIn(apiUrl, anonKey, email)).client;
    const created = await rpc(client, "create_circle", {
      circle_name: "Leaving forever",
      circle_type: "couple",
    });
    const note = await client
      .from("memories")
      .insert({
        circle_id: created.circle_id as string,
        kind: "note",
        body: "Former member wrote this",
        occurred_on: utcDay(0),
      })
      .select("id")
      .single();
    expect(note.error).toBeNull();

    const endpoint = `https://push.example/delete/${nonce}`;
    const device = await client.from("push_subscriptions").insert({
      user_id: userId,
      endpoint,
      p256dh: "abc",
      auth: "def",
    });
    expect(device.error).toBeNull();

    const objectPath = `${userId}/${crypto.randomUUID()}.png`;
    const upload = await client.storage
      .from("avatars")
      .upload(objectPath, png, {
        contentType: "image/png",
        upsert: false,
      });
    expect(upload.error).toBeNull();

    const deleted = await client.rpc("delete_own_account", {
      remove_content: false,
    });
    expect(deleted.error).toBeNull();

    const memory = await admin
      .from("memories")
      .select("created_by, body")
      .eq("id", note.data?.id ?? "")
      .single();
    expect(memory.data).toMatchObject({
      created_by: null,
      body: "Former member wrote this",
    });

    const pushes = await admin
      .from("push_subscriptions")
      .select("endpoint")
      .eq("endpoint", endpoint);
    expect(pushes.data).toEqual([]);

    const file = await admin.storage.from("avatars").download(objectPath);
    expect(file.data).toBeNull();

    const account = await admin.auth.admin.getUserById(userId);
    expect(account.data.user).toBeNull();
  });

  it("hides the demo circle from an outsider and refuses a demo write", async () => {
    const alex = "a11ce000-0000-4000-8000-0000000000a1";
    const jordan = "a11ce000-0000-4000-8000-0000000000b2";
    const circleId = "a11ce000-0000-4000-8000-0000000000c3";
    await admin.auth.admin.deleteUser(alex);
    await admin.auth.admin.deleteUser(jordan);
    const alexEmail = "alex.demo.rls@example.com";
    const jordanEmail = "jordan.demo.rls@example.com";
    const alexCreated = await admin.auth.admin.createUser({
      id: alex,
      email: alexEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Alex", timezone: "America/Los_Angeles" },
    });
    const jordanCreated = await admin.auth.admin.createUser({
      id: jordan,
      email: jordanEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Jordan", timezone: "America/New_York" },
    });
    expect(alexCreated.error).toBeNull();
    expect(jordanCreated.error).toBeNull();
    createdUserIds.push(alex, jordan);

    const seeded = await admin.rpc("seed_demo_circle", { photo_bytes: 128 });
    expect(seeded.error).toBeNull();
    expect(seeded.data?.circleId).toBe(circleId);

    const hidden = await owner.from("circles").select("id").eq("id", circleId);
    expect(hidden.data).toEqual([]);

    const alexClient = (await signIn(apiUrl, anonKey, alexEmail)).client;
    const write = await alexClient.from("memories").insert({
      circle_id: circleId,
      kind: "note",
      body: "A reviewer should not save this",
      occurred_on: utcDay(0),
    });
    expect(write.error?.message).toContain("hsummer_demo_readonly");

    const purge = await owner.rpc("purge_archived_circles");
    expect(purge.error).not.toBeNull();
    const seedAsUser = await owner.rpc("seed_demo_circle", { photo_bytes: 8 });
    expect(seedAsUser.error).not.toBeNull();

    const listed = await owner.storage.from("exports").list("pending");
    expect(listed.data ?? []).toEqual([]);
    const download = await fetch(
      `${apiUrl}/storage/v1/object/public/exports/pending/nope.zip`,
    );
    expect(download.ok).toBe(false);
  });
});

describe("phase 4 keeps a third member out of what they were not picked for", () => {
  let host: Client;
  let guest: Client;
  let third: Client;
  let outsider: Client;
  let hostId = "";
  let guestId = "";
  let thirdId = "";
  let groupId = "";
  let coupleId = "";

  beforeAll(async () => {
    const nonce = crypto.randomUUID();
    hostId = await createUser(admin, {
      email: `rls-p4-host-${nonce}@example.com`,
      displayName: "Phase Host",
      timezone: "America/Los_Angeles",
    });
    guestId = await createUser(admin, {
      email: `rls-p4-guest-${nonce}@example.com`,
      displayName: "Phase Guest",
      timezone: "America/New_York",
    });
    thirdId = await createUser(admin, {
      email: `rls-p4-third-${nonce}@example.com`,
      displayName: "Phase Third",
      timezone: "UTC",
    });
    const outsiderId = await createUser(admin, {
      email: `rls-p4-out-${nonce}@example.com`,
      displayName: "Phase Out",
      timezone: "UTC",
    });
    host = (await signIn(apiUrl, anonKey, `rls-p4-host-${nonce}@example.com`))
      .client;
    guest = (await signIn(apiUrl, anonKey, `rls-p4-guest-${nonce}@example.com`))
      .client;
    third = (await signIn(apiUrl, anonKey, `rls-p4-third-${nonce}@example.com`))
      .client;
    outsider = (
      await signIn(apiUrl, anonKey, `rls-p4-out-${nonce}@example.com`)
    ).client;
    expect(outsiderId).toBeTruthy();

    const group = await rpc(host, "create_circle", {
      circle_name: "Phase 4",
      circle_type: "group",
    });
    groupId = group.circle_id ?? "";
    const token = group.token ?? "";
    await rpc(guest, "redeem_invite", { raw_token: token, ip_hash: freshIp() });
    await rpc(third, "redeem_invite", { raw_token: token, ip_hash: freshIp() });

    const couple = await rpc(host, "create_circle", {
      circle_name: "Phase couple",
      circle_type: "couple",
    });
    coupleId = couple.circle_id ?? "";
  });

  it("lets a person mute only their own membership", async () => {
    const muted = await host
      .from("circle_members")
      .update({ muted_until: "9999-12-31T00:00:00.000Z" })
      .eq("circle_id", groupId)
      .eq("user_id", hostId)
      .select("muted_until");
    expect(muted.error).toBeNull();
    expect(muted.data?.[0]?.muted_until).toContain("9999");

    const spoof = await guest
      .from("circle_members")
      .update({ muted_until: "9999-12-31T00:00:00.000Z" })
      .eq("circle_id", groupId)
      .eq("user_id", hostId)
      .select("user_id");
    expect(spoof.data ?? []).toEqual([]);

    const ping = await guest
      .from("pings")
      .insert({
        circle_id: groupId,
        from_user_id: guestId,
        to_user_id: hostId,
        ping_type: "thinking-of-you",
      })
      .select("id")
      .single();
    expect(ping.error).toBeNull();
    const stillVisible = await host
      .from("pings")
      .select("id")
      .eq("id", ping.data?.id ?? "");
    expect(stillVisible.data?.[0]?.id).toBe(ping.data?.id);
  });

  it("hides a letter and a selected memory from the person who was not chosen", async () => {
    const letter = await host
      .from("letters")
      .insert({
        circle_id: groupId,
        from_user_id: hostId,
        to_user_id: guestId,
        category: "need-motivation",
        title: "For you",
        body: "Only the guest",
        design: "minimal",
      })
      .select("id")
      .single();
    expect(letter.error).toBeNull();
    const hiddenLetter = await third
      .from("letters")
      .select("id")
      .eq("id", letter.data?.id ?? "");
    expect(hiddenLetter.data ?? []).toEqual([]);

    const memory = await host
      .from("memories")
      .insert({
        circle_id: groupId,
        kind: "note",
        body: "Only the guest can read this",
        visibility: "selected",
        occurred_on: utcDay(0),
      })
      .select("id")
      .single();
    expect(memory.error).toBeNull();
    const viewer = await host.from("memory_viewers").insert({
      memory_id: memory.data?.id ?? "",
      circle_id: groupId,
      user_id: guestId,
    });
    expect(viewer.error).toBeNull();

    const guestView = await guest
      .from("memories")
      .select("body")
      .eq("id", memory.data?.id ?? "")
      .single();
    expect(guestView.data?.body).toBe("Only the guest can read this");
    const thirdView = await third
      .from("memories")
      .select("id")
      .eq("id", memory.data?.id ?? "");
    expect(thirdView.data ?? []).toEqual([]);
  });

  it("lets every member read a ping that was sent to the circle", async () => {
    const ping = await host
      .from("pings")
      .insert({
        circle_id: groupId,
        from_user_id: hostId,
        to_user_id: null,
        ping_type: "thinking-of-you",
      })
      .select("id")
      .single();
    expect(ping.error).toBeNull();
    const seen = await third
      .from("pings")
      .select("id")
      .eq("id", ping.data?.id ?? "");
    expect(seen.data?.[0]?.id).toBe(ping.data?.id);
    const outside = await outsider
      .from("pings")
      .select("id")
      .eq("id", ping.data?.id ?? "");
    expect(outside.data ?? []).toEqual([]);
  });

  it("splits pass frames across the people who were picked", async () => {
    const started = await host.rpc("create_pass_booth_picked", {
      target_circle: groupId,
      participant_ids: [hostId, guestId, thirdId],
      target_theme: "minimal",
      target_layout: "4-cut",
      target_filter: "none",
      target_caption: "",
      shot_sizes: [120, 120],
    });
    expect(started.error).toBeNull();
    const sessionId = started.data?.session_id ?? "";
    const contributors = await host
      .from("booth_contributors")
      .select("assigned_positions")
      .eq("session_id", sessionId);
    const positions = (contributors.data ?? [])
      .flatMap((row) => row.assigned_positions)
      .sort((a, b) => a - b);
    expect(positions).toEqual([0, 1, 2, 3]);

    const refused = await host.rpc("create_pass_booth_picked", {
      target_circle: groupId,
      participant_ids: [
        hostId,
        guestId,
        "99999999-9999-4999-8999-999999999999",
      ],
      target_theme: "minimal",
      target_layout: "4-cut",
      target_filter: "none",
      target_caption: "",
      shot_sizes: [120, 120],
    });
    expect(refused.error?.message).toContain("hsummer_booth_memory");
  });

  it("opens the shutter only when every chosen person is ready", async () => {
    const opened = await host.rpc("open_together_booth", {
      target_circle: groupId,
      participant_ids: [hostId, guestId],
      target_theme: "kawaii",
      target_layout: "2-cut",
    });
    expect(opened.error).toBeNull();
    const sessionId = opened.data?.session_id ?? "";

    const thirdSession = await third
      .from("booth_sessions")
      .select("id")
      .eq("id", sessionId);
    expect(thirdSession.data ?? []).toEqual([]);
    const thirdPeople = await third
      .from("booth_contributors")
      .select("user_id")
      .eq("session_id", sessionId);
    expect(thirdPeople.data ?? []).toEqual([]);
    const outsideSession = await outsider
      .from("booth_sessions")
      .select("id")
      .eq("id", sessionId);
    expect(outsideSession.data ?? []).toEqual([]);
    const hostSession = await host
      .from("booth_sessions")
      .select("id")
      .eq("id", sessionId);
    expect(hostSession.data?.[0]?.id).toBe(sessionId);

    const one = await host.rpc("mark_together_ready", {
      target_session: sessionId,
      offset_ms: 12,
      rtt_ms: 40,
    });
    expect(one.error).toBeNull();
    expect(one.data?.capture_at).toBeNull();
    expect(one.data?.waiting_ids).toContain(guestId);

    const notPicked = await third.rpc("mark_together_ready", {
      target_session: sessionId,
      offset_ms: 1,
      rtt_ms: 10,
    });
    expect(notPicked.error?.message).toContain("hsummer_booth_memory");

    const outside = await outsider.rpc("mark_together_ready", {
      target_session: sessionId,
    });
    expect(outside.error).toBeTruthy();

    const two = await guest.rpc("mark_together_ready", {
      target_session: sessionId,
      offset_ms: -8,
      rtt_ms: 30,
    });
    expect(two.error).toBeNull();
    expect(two.data?.capture_at).toBeTruthy();

    const thirdSamples = await third
      .from("booth_clock_samples")
      .select("id")
      .eq("session_id", sessionId);
    expect(thirdSamples.data ?? []).toEqual([]);
    const hostSamples = await host
      .from("booth_clock_samples")
      .select("offset_ms")
      .eq("session_id", sessionId);
    expect(hostSamples.data?.some((row) => row.offset_ms === 12)).toBe(true);
  });

  it("refuses a couple invite cap and accepts one on a group", async () => {
    const coupleCap = await host.rpc("set_invite_max_uses", {
      target_circle: coupleId,
      next_max: 5,
    });
    expect(coupleCap.error?.message).toContain("hsummer_couple_invite");

    const groupCap = await host.rpc("set_invite_max_uses", {
      target_circle: groupId,
      next_max: 4,
    });
    expect(groupCap.error).toBeNull();
    const invite = await host
      .from("circle_invites")
      .select("max_uses")
      .eq("circle_id", groupId)
      .is("revoked_at", null)
      .single();
    expect(invite.data?.max_uses).toBe(4);
  });

  it("hides an open live booth from a person who left", async () => {
    const nonce = crypto.randomUUID();
    const leaverId = await createUser(admin, {
      email: `rls-p4-left-${nonce}@example.com`,
      displayName: "Phase Left",
      timezone: "UTC",
    });
    const leaver = (
      await signIn(apiUrl, anonKey, `rls-p4-left-${nonce}@example.com`)
    ).client;
    const created = await rpc(host, "create_circle", {
      circle_name: "Leave the booth",
      circle_type: "group",
    });
    const circleId = created.circle_id ?? "";
    await rpc(leaver, "redeem_invite", {
      raw_token: created.token ?? "",
      ip_hash: freshIp(),
    });
    const opened = await host.rpc("open_together_booth", {
      target_circle: circleId,
      participant_ids: [hostId, leaverId],
      target_theme: "minimal",
      target_layout: "2-cut",
    });
    expect(opened.error).toBeNull();
    const sessionId = opened.data?.session_id ?? "";
    const left = await leaver.rpc("leave_circle", {
      target_circle: circleId,
      remove_content: false,
    });
    expect(left.error).toBeNull();
    const hidden = await leaver
      .from("booth_sessions")
      .select("id")
      .eq("id", sessionId);
    expect(hidden.data ?? []).toEqual([]);
    const shots = await leaver
      .from("booth_shots")
      .select("session_id")
      .eq("session_id", sessionId);
    expect(shots.data ?? []).toEqual([]);
  });

  it("does not expose the together-channel helper through the Data API", async () => {
    const untyped = third as unknown as {
      rpc: (
        name: string,
        args: { topic: string },
      ) => Promise<{ error: { message: string } | null }>;
    };
    const probed = await untyped.rpc("can_join_together_topic", {
      topic: "together:00000000-0000-4000-8000-000000000000",
    });
    expect(probed.error).toBeTruthy();
    const circleProbe = await untyped.rpc("can_join_circle_topic", {
      topic: "memories:00000000-0000-4000-8000-000000000000",
    });
    expect(circleProbe.error).toBeTruthy();
  });
});

describe("part 2 keeps reactions, replies, and pins with the people who can see the item", () => {
  let third: Client;
  let leaver: Client;
  let outsider: Client;
  let rapid: Client;
  let thirdId = "";
  let leaverId = "";
  let rapidId = "";
  let groupId = "";
  let letterId = "";
  let sharedNoteId = "";
  let privateNoteId = "";

  beforeAll(async () => {
    const nonce = crypto.randomUUID();
    thirdId = await createUser(admin, {
      email: `rls-part2-third-${nonce}@example.com`,
      displayName: "Part Two Third",
      timezone: "UTC",
    });
    leaverId = await createUser(admin, {
      email: `rls-part2-left-${nonce}@example.com`,
      displayName: "Part Two Leaver",
      timezone: "UTC",
    });
    rapidId = await createUser(admin, {
      email: `rls-part2-rapid-${nonce}@example.com`,
      displayName: "Part Two Rapid",
      timezone: "UTC",
    });
    await createUser(admin, {
      email: `rls-part2-out-${nonce}@example.com`,
      displayName: "Part Two Outsider",
      timezone: "UTC",
    });
    third = (
      await signIn(apiUrl, anonKey, `rls-part2-third-${nonce}@example.com`)
    ).client;
    leaver = (
      await signIn(apiUrl, anonKey, `rls-part2-left-${nonce}@example.com`)
    ).client;
    outsider = (
      await signIn(apiUrl, anonKey, `rls-part2-out-${nonce}@example.com`)
    ).client;
    rapid = (
      await signIn(apiUrl, anonKey, `rls-part2-rapid-${nonce}@example.com`)
    ).client;

    const group = await admin
      .from("circles")
      .insert({
        name: "Part two",
        circle_type: "group",
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (group.error || !group.data) throw group.error ?? new Error("no group");
    groupId = group.data.id;
    const members = await admin.from("circle_members").insert([
      { circle_id: groupId, user_id: ownerId },
      { circle_id: groupId, user_id: otherId },
      { circle_id: groupId, user_id: thirdId },
      { circle_id: groupId, user_id: leaverId },
      { circle_id: groupId, user_id: rapidId },
    ]);
    if (members.error) throw members.error;

    const letter = await owner
      .from("letters")
      .insert({
        circle_id: groupId,
        from_user_id: ownerId,
        to_user_id: otherId,
        category: "feeling-sad",
        body: "only for the two of us",
        design: "minimal",
      })
      .select("id, status, delivered_at")
      .single();
    if (letter.error || !letter.data)
      throw letter.error ?? new Error("no letter");
    expect(letter.data.status).toBe("delivered");
    expect(letter.data.delivered_at).toBeTruthy();
    letterId = letter.data.id;

    const shared = await owner
      .from("memories")
      .insert({
        circle_id: groupId,
        kind: "note",
        body: "everyone can see this",
        occurred_on: utcDay(0),
        visibility: "circle",
      })
      .select("id")
      .single();
    if (shared.error || !shared.data)
      throw shared.error ?? new Error("no note");
    sharedNoteId = shared.data.id;

    const hidden = await owner
      .from("memories")
      .insert({
        circle_id: groupId,
        kind: "note",
        body: "only the author",
        occurred_on: utcDay(0),
        visibility: "selected",
      })
      .select("id")
      .single();
    if (hidden.error || !hidden.data)
      throw hidden.error ?? new Error("no private note");
    privateNoteId = hidden.data.id;

    const goodbye = await leaver
      .from("circle_members")
      .update({ left_at: new Date().toISOString() })
      .eq("circle_id", groupId)
      .eq("user_id", leaverId)
      .select("left_at");
    if (goodbye.error || !goodbye.data?.[0]?.left_at) {
      throw goodbye.error ?? new Error("could not leave");
    }
  });

  it("lets the recipient react and reply, and denies a third member and a former member", async () => {
    const reacted = await other
      .from("reactions")
      .insert({
        circle_id: groupId,
        user_id: otherId,
        target_kind: "letter",
        target_id: letterId,
        emoji: "heart",
      })
      .select("id");
    expect(reacted.error).toBeNull();
    expect(reacted.data?.length).toBe(1);

    const replied = await other
      .from("replies")
      .insert({
        circle_id: groupId,
        user_id: otherId,
        target_kind: "letter",
        target_id: letterId,
        body: "I kept this.",
      })
      .select("id, body");
    expect(replied.error).toBeNull();
    expect(replied.data?.[0]?.body).toBe("I kept this.");

    const senderSees = await owner
      .from("reactions")
      .select("emoji")
      .eq("target_id", letterId);
    expect(senderSees.data?.map((row) => row.emoji)).toContain("heart");

    const thirdRead = await third
      .from("reactions")
      .select("emoji")
      .eq("target_id", letterId);
    expect(thirdRead.error).toBeNull();
    expect(thirdRead.data).toEqual([]);
    const thirdReply = await third
      .from("replies")
      .select("body")
      .eq("target_id", letterId);
    expect(thirdReply.data).toEqual([]);
    expect(JSON.stringify(thirdReply.data)).not.toContain("I kept this.");

    const thirdWrite = await third.from("reactions").insert({
      circle_id: groupId,
      user_id: thirdId,
      target_kind: "letter",
      target_id: letterId,
      emoji: "hug",
    });
    expect(thirdWrite.error).toBeTruthy();

    const formerRead = await leaver
      .from("replies")
      .select("body")
      .eq("target_id", letterId);
    expect(formerRead.data).toEqual([]);
    const formerWrite = await leaver.from("reactions").insert({
      circle_id: groupId,
      user_id: leaverId,
      target_kind: "letter",
      target_id: letterId,
      emoji: "spark",
    });
    expect(formerWrite.error).toBeTruthy();

    const address = await other.from("replies").insert({
      circle_id: groupId,
      user_id: otherId,
      target_kind: "letter",
      target_id: letterId,
      body: "reach me at summer@example.com",
    });
    expect(address.error).toBeTruthy();
  });

  it("hides a selected memory from a third member and a former member, and shows a circle memory to the third", async () => {
    const denied = await third.from("reactions").insert({
      circle_id: groupId,
      user_id: thirdId,
      target_kind: "memory",
      target_id: privateNoteId,
      emoji: "heart",
    });
    expect(denied.error).toBeTruthy();

    const former = await leaver.from("reactions").insert({
      circle_id: groupId,
      user_id: leaverId,
      target_kind: "memory",
      target_id: sharedNoteId,
      emoji: "heart",
    });
    expect(former.error).toBeTruthy();

    const allowed = await third
      .from("reactions")
      .insert({
        circle_id: groupId,
        user_id: thirdId,
        target_kind: "memory",
        target_id: sharedNoteId,
        emoji: "spark",
      })
      .select("id");
    expect(allowed.error).toBeNull();
    expect(allowed.data?.length).toBe(1);

    const authorSees = await owner
      .from("reactions")
      .select("emoji")
      .eq("target_id", sharedNoteId);
    expect(authorSees.data?.map((row) => row.emoji)).toContain("spark");
  });

  it("lets someone pin a letter they can read, and refuses a third member and a former member", async () => {
    const pinned = await owner
      .from("letter_pins")
      .insert({
        letter_id: letterId,
        circle_id: groupId,
        user_id: ownerId,
      })
      .select("id");
    expect(pinned.error).toBeNull();

    const thirdPin = await third.from("letter_pins").insert({
      letter_id: letterId,
      circle_id: groupId,
      user_id: thirdId,
    });
    expect(thirdPin.error).toBeTruthy();
    const thirdShelf = await third
      .from("letter_pins")
      .select("id")
      .eq("letter_id", letterId);
    expect(thirdShelf.data).toEqual([]);

    const formerPin = await leaver.from("letter_pins").insert({
      letter_id: letterId,
      circle_id: groupId,
      user_id: leaverId,
    });
    expect(formerPin.error).toBeTruthy();

    const shelf = await owner
      .from("letter_pins")
      .select("letter_id")
      .eq("letter_id", letterId);
    expect(shelf.data?.map((row) => row.letter_id)).toContain(letterId);
  });

  it("stops the 31st reaction inside 10 minutes", async () => {
    const notes = [];
    for (let index = 0; index < 7; index += 1) {
      const note = await rapid
        .from("memories")
        .insert({
          circle_id: groupId,
          kind: "note",
          body: `Rate note ${index}`,
          occurred_on: utcDay(0),
        })
        .select("id")
        .single();
      expect(note.error, `note ${index}`).toBeNull();
      notes.push(note.data?.id ?? "");
    }
    const emojis = ["heart", "adore", "hug", "spark", "letter"] as const;
    let count = 0;
    for (const noteId of notes) {
      for (const emoji of emojis) {
        if (count >= 30) break;
        const inserted = await rapid.from("reactions").insert({
          circle_id: groupId,
          user_id: rapidId,
          target_kind: "memory",
          target_id: noteId,
          emoji,
        });
        expect(inserted.error, `${count}`).toBeNull();
        count += 1;
      }
    }
    expect(count).toBe(30);
    const extra = await rapid
      .from("memories")
      .insert({
        circle_id: groupId,
        kind: "note",
        body: "One past the cap",
        occurred_on: utcDay(0),
      })
      .select("id")
      .single();
    expect(extra.error).toBeNull();
    const blocked = await rapid.from("reactions").insert({
      circle_id: groupId,
      user_id: rapidId,
      target_kind: "memory",
      target_id: extra.data?.id ?? "",
      emoji: "heart",
    });
    expect(blocked.error?.message).toContain("hsummer_rate_limited");
  });

  it("tells a circle member about quiet hours and tells an outsider and a former member nothing", async () => {
    const now = new Date();
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const start = (minutes + 24 * 60 - 30) % (24 * 60);
    const end = (minutes + 31) % (24 * 60);
    const fmt = (value: number) =>
      `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    const saved = await other
      .from("account_private")
      .update({
        notification_prefs: {
          pings: true,
          quiet: { enabled: true, start: fmt(start), end: fmt(end) },
        },
      })
      .eq("user_id", otherId)
      .select("user_id");
    expect(saved.error).toBeNull();
    expect(saved.data?.length).toBe(1);

    const partner = await owner.rpc("recipient_quiet_status", {
      target: otherId,
    });
    expect(partner.error).toBeNull();
    expect(partner.data?.[0]?.in_quiet).toBe(true);
    expect(partner.data?.[0]?.pings_enabled).toBe(true);
    expect(partner.data?.[0]?.resume_label).toMatch(/AM|PM/);

    const outside = await outsider.rpc("recipient_quiet_status", {
      target: otherId,
    });
    expect(outside.data ?? []).toEqual([]);

    const former = await leaver.rpc("recipient_quiet_status", {
      target: otherId,
    });
    expect(former.data ?? []).toEqual([]);

    const held = await owner.from("held_notifications").select("id");
    expect(held.data ?? []).toEqual([]);
    const planted = await owner.from("held_notifications").insert({
      user_id: otherId,
      circle_id: groupId,
      kind: "ping",
      ref_id: letterId,
      deliver_at: new Date().toISOString(),
    });
    expect(planted.error).toBeTruthy();
  });
});

async function rpc(
  client: Client,
  fn:
    "create_circle" | "preview_invite" | "redeem_invite" | "regenerate_invite",
  args: Record<string, string | null>,
): Promise<Record<string, string | null>> {
  const untyped = client as unknown as {
    rpc: (
      name: string,
      args: Record<string, string | null>,
    ) => Promise<{
      data: Record<string, string | null>[] | null;
      error: { message: string } | null;
    }>;
  };
  const { data, error } = await untyped.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error(`${fn} returned no row`);
  }
  return row as Record<string, string | null>;
}

function freshIp(): string {
  return (crypto.randomUUID() + crypto.randomUUID())
    .replaceAll("-", "")
    .slice(0, 64);
}

async function createUser(
  client: Client,
  input: { email: string; displayName: string; timezone: string },
): Promise<string> {
  const { data, error } = await client.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: input.displayName,
      timezone: input.timezone,
    },
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "createUser failed");
  }
  createdUserIds.push(data.user.id);
  return data.user.id;
}

async function signIn(
  url: string,
  key: string,
  email: string,
): Promise<{ client: Client; token: string }> {
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  const token = data.session?.access_token;
  if (error || !token) throw new Error(error?.message ?? "sign-in failed");
  return { client, token };
}

function columnNames(spec: unknown): string[] {
  if (!spec || typeof spec !== "object") return [];
  const root = spec as {
    definitions?: Record<string, { properties?: Record<string, unknown> }>;
    components?: {
      schemas?: Record<string, { properties?: Record<string, unknown> }>;
    };
  };
  const tables = {
    ...(root.definitions ?? {}),
    ...(root.components?.schemas ?? {}),
  };
  const names: string[] = [];
  for (const [table, definition] of Object.entries(tables)) {
    for (const column of Object.keys(definition.properties ?? {})) {
      names.push(`${table}.${column}`);
    }
  }
  return names;
}

function localSupabaseEnv(): {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
} {
  let output = "";
  try {
    output = execFileSync(supabaseBin(), ["status", "-o", "env"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "status failed";
    throw new Error(
      `Local Supabase is not running. Start it with \`npx supabase start\`, then rerun \`npm run test:rls\`.\n${message}`,
    );
  }

  const env = parseEnv(output);
  const apiUrl = env.API_URL;
  const anonKey = env.ANON_KEY ?? env.PUBLISHABLE_KEY;
  const serviceRoleKey = env.SERVICE_ROLE_KEY ?? env.SECRET_KEY;
  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error(
      `supabase status did not print API_URL and the API keys. Saw: ${Object.keys(env).join(", ")}`,
    );
  }
  return { apiUrl, anonKey, serviceRoleKey };
}

function parseEnv(text: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match?.[1]) continue;
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[match[1]] = value;
  }
  return entries;
}

function supabaseBin(): string {
  const require = createRequire(path.join(root, "package.json"));
  const arch = os.arch();
  const platform = os.platform();
  const suffixes =
    platform === "linux" && arch === "x64"
      ? ["linux-x64", "linux-x64-musl"]
      : platform === "linux" && arch === "arm64"
        ? ["linux-arm64", "linux-arm64-musl"]
        : platform === "darwin" && arch === "arm64"
          ? ["darwin-arm64"]
          : platform === "darwin" && arch === "x64"
            ? ["darwin-x64"]
            : [];

  for (const suffix of suffixes) {
    try {
      const pkg = path.dirname(
        require.resolve(`@supabase/cli-${suffix}/package.json`),
      );
      return path.join(pkg, "bin", "supabase");
    } catch {
      // Try the next packaged binary.
    }
  }
  throw new Error("Supabase CLI binary not found. Run npm ci.");
}
