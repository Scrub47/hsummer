const ENDPOINT_MAX = 2048;
const KEY_MAX = 200;

/**
 * The browser posts `PushSubscription.toJSON()`. We keep endpoint + the two
 * encryption keys and drop everything else (including expirationTime).
 */
export type ParsedPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function parsePushSubscription(
  body: unknown,
): ParsedPushSubscription | null {
  if (typeof body !== "object" || body === null) return null;

  const record = body as Record<string, unknown>;
  const endpoint = record.endpoint;
  const keys = record.keys;
  if (
    typeof endpoint !== "string" ||
    typeof keys !== "object" ||
    keys === null
  ) {
    return null;
  }

  const keyRecord = keys as Record<string, unknown>;
  const p256dh = keyRecord.p256dh;
  const auth = keyRecord.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (
    !isHttpsEndpoint(endpoint) ||
    !isSubscriptionKey(p256dh) ||
    !isSubscriptionKey(auth)
  ) {
    return null;
  }

  return { endpoint, p256dh, auth };
}

function isHttpsEndpoint(endpoint: string): boolean {
  if (endpoint.length < 12 || endpoint.length > ENDPOINT_MAX) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Base64url, with or without padding, as produced by PushSubscription.toJSON(). */
function isSubscriptionKey(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= KEY_MAX &&
    /^[A-Za-z0-9_-]+={0,2}$/.test(value)
  );
}

/**
 * `pushManager.subscribe` wants the VAPID public key as raw bytes, not the
 * base64url string we store in env.
 */
export function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}
