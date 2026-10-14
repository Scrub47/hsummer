import { inviteStorageKey } from "@/lib/circles/fields";

/**
 * The raw invite token is shown once. It has to survive an iPhone killing
 * the installed app, which drops sessionStorage. localStorage keeps the
 * link so "Make a new link" is not the only way back (that revokes the
 * link already sent). A token saved by an older build is still read from
 * sessionStorage.
 */
export function readInviteToken(inviteId: string): string | null {
  const key = inviteStorageKey(inviteId);
  const saved = readStorage(localStorage, key);
  if (saved) return saved;
  return readStorage(sessionStorage, key);
}

export function writeInviteToken(inviteId: string, token: string): void {
  const key = inviteStorageKey(inviteId);
  if (writeStorage(localStorage, key, token)) return;
  writeStorage(sessionStorage, key, token);
}

function readStorage(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(
  storage: Storage | undefined,
  key: string,
  value: string,
): boolean {
  try {
    storage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
