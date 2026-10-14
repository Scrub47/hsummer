import { beforeEach, describe, expect, it, vi } from "vitest";

import { inviteStorageKey } from "@/lib/circles/fields";
import { readInviteToken, writeInviteToken } from "@/lib/circles/invite-token";

const INVITE_ID = "11111111-1111-4111-8111-111111111111";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe("invite token storage", () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();

  beforeEach(() => {
    local.clear();
    session.clear();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);
  });

  it("keeps the token in localStorage so a closed phone can still share it", () => {
    writeInviteToken(INVITE_ID, "abc");
    expect(local.getItem(inviteStorageKey(INVITE_ID))).toBe("abc");
    expect(readInviteToken(INVITE_ID)).toBe("abc");
  });

  it("still reads a token an older page left in sessionStorage", () => {
    session.setItem(inviteStorageKey(INVITE_ID), "legacy");
    expect(readInviteToken(INVITE_ID)).toBe("legacy");
  });
});
