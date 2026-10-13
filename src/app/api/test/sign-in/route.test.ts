import { afterEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/test/sign-in/route";

const KEYS = [
  "E2E_TEST_AUTH",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const original = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of KEYS) {
    const previous = original.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  original.clear();
});

function rememberEnv() {
  for (const key of KEYS) original.set(key, process.env[key]);
}

function request(body: unknown) {
  return new Request("http://127.0.0.1:3000/api/test/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/test/sign-in", () => {
  it("stays closed when the flag is missing", async () => {
    rememberEnv();
    delete process.env.E2E_TEST_AUTH;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "local-anon-key";

    const response = await POST(
      request({ email: "a@example.com", displayName: "Ada" }),
    );
    expect(response.status).toBe(404);
  });

  it("stays closed for a hosted project even when the flag is set", async () => {
    rememberEnv();
    process.env.E2E_TEST_AUTH = "1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcd.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "local-anon-key";
    process.env.SUPABASE_SECRET_KEY = "local-service-key-not-a-placeholder";

    const response = await POST(
      request({ email: "a@example.com", displayName: "Ada" }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a real email address before it talks to Supabase", async () => {
    rememberEnv();
    process.env.E2E_TEST_AUTH = "1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "local-anon-key";
    process.env.SUPABASE_SECRET_KEY = "local-service-key-not-a-placeholder";

    const response = await POST(
      request({ email: "summer@school.edu", displayName: "Summer" }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/example\.com/i);
  });

  it("explains that the local secret key is missing", async () => {
    rememberEnv();
    process.env.E2E_TEST_AUTH = "1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "local-anon-key";
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const response = await POST(
      request({ email: "ada@example.com", displayName: "Ada" }),
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/isn't configured/i);
  });
});
