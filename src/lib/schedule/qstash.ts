import "server-only";

import { Receiver } from "@upstash/qstash";

import { getQstashConfig } from "@/lib/env.server";

/**
 * Upstash QStash. The product is global: there is no region in the URL or
 * in the client. Redis rate limits are a different Upstash product and stay
 * in us-west-2.
 *
 * When the token or either signing key is missing, callers skip QStash.
 * The letter stays scheduled and deliver_due_letters sends it the next time
 * someone in the circle opens the app after that time.
 */

const QSTASH_URL = "https://qstash.upstash.io";

const MESSAGE_ID = /^[A-Za-z0-9_-]{8,200}$/;

export function isQstashMessageId(value: string): boolean {
  return MESSAGE_ID.test(value);
}

/** HTTPS origin QStash can call back. Loopback is not one of those. */
export function publicDeliverUrl(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    return null;
  }
  return new URL("/api/letters/deliver", url.origin).toString();
}

export async function publishLetterMessage(input: {
  letterId: string;
  notBefore: number;
  callbackUrl: string;
}): Promise<string | null> {
  const config = getQstashConfig();
  if (!config) return null;

  const response = await fetch(
    `${QSTASH_URL}/v2/publish/${input.callbackUrl}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "Upstash-Not-Before": String(input.notBefore),
        "Upstash-Retries": "5",
      },
      body: JSON.stringify({ letterId: input.letterId }),
    },
  );

  if (!response.ok) {
    console.error("QStash did not accept the letter.", response.status);
    return null;
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !("messageId" in payload)) {
    return null;
  }
  const messageId = payload.messageId;
  return typeof messageId === "string" ? messageId : null;
}

export async function deleteLetterMessage(messageId: string): Promise<void> {
  const config = getQstashConfig();
  if (!config || !isQstashMessageId(messageId)) return;

  try {
    const response = await fetch(`${QSTASH_URL}/v2/messages/${messageId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.token}` },
    });
    if (!response.ok && response.status !== 404) {
      console.error("QStash did not cancel the letter.", response.status);
    }
  } catch (error) {
    console.error(
      "QStash cancel failed.",
      error instanceof Error ? error.name : "error",
    );
  }
}

export async function verifyQstashRequest(input: {
  signature: string | null;
  body: string;
}): Promise<boolean> {
  const config = getQstashConfig();
  if (!config || !input.signature) return false;

  const receiver = new Receiver({
    currentSigningKey: config.currentSigningKey,
    nextSigningKey: config.nextSigningKey,
  });

  try {
    return await receiver.verify({
      signature: input.signature,
      body: input.body,
    });
  } catch {
    return false;
  }
}
