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
