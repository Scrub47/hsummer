import { describe, expect, it } from "vitest";

import {
  isLocalSupabaseUrl,
  testSignInAllowed,
} from "@/lib/auth/local-supabase";

describe("local Supabase URL", () => {
  it("accepts the local API over http", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321/")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://[::1]:54321")).toBe(true);
  });

  it("rejects hosted, preview, and lookalike URLs", () => {
    expect(isLocalSupabaseUrl("https://abcd.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("https://hsummer.vercel.app")).toBe(false);
    expect(isLocalSupabaseUrl("https://127.0.0.1:54321")).toBe(false);
    expect(isLocalSupabaseUrl("http://127.0.0.1.example.com:54321")).toBe(
      false,
    );
    expect(isLocalSupabaseUrl("http://localhost.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("http://user:secret@127.0.0.1:54321")).toBe(
      false,
    );
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321/auth/v1")).toBe(false);
    expect(
      isLocalSupabaseUrl("http://127.0.0.1:54321?next=https://evil.example"),
    ).toBe(false);
    expect(isLocalSupabaseUrl("http://0.0.0.0:54321")).toBe(false);
    expect(isLocalSupabaseUrl("not a url")).toBe(false);
    expect(isLocalSupabaseUrl("")).toBe(false);
  });
});

describe("test sign-in gate", () => {
  it("opens only when the flag is exactly 1 and the URL is local", () => {
    expect(
      testSignInAllowed({
        flag: "1",
        supabaseUrl: "http://127.0.0.1:54321",
      }),
    ).toBe(true);
    expect(
      testSignInAllowed({
        flag: "1",
        supabaseUrl: "https://abcd.supabase.co",
      }),
    ).toBe(false);
    expect(
      testSignInAllowed({
        flag: "true",
        supabaseUrl: "http://127.0.0.1:54321",
      }),
    ).toBe(false);
    expect(
      testSignInAllowed({
        flag: undefined,
        supabaseUrl: "http://127.0.0.1:54321",
      }),
    ).toBe(false);
    expect(testSignInAllowed({ flag: "1", supabaseUrl: null })).toBe(false);
  });
});
