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

    // Created directly. The product UI does not offer a group circle.
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
