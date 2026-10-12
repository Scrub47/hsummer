/**
 * Push services tell us a subscription is gone with 404 or 410.
 * Any other status (including a network failure, which has no status) keeps
 * the row so a temporary outage does not wipe a working device.
 */
const DEAD_SUBSCRIPTION_STATUSES = new Set([404, 410]);

export function isDeadPushSubscription(statusCode: number | null): boolean {
  return statusCode !== null && DEAD_SUBSCRIPTION_STATUSES.has(statusCode);
}

export function pushStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return null;
  }
  const statusCode = error.statusCode;
  return typeof statusCode === "number" && Number.isInteger(statusCode)
    ? statusCode
    : null;
}

export function subscriptionsToPrune(
  results: readonly { id: string; statusCode: number | null }[],
): string[] {
  return results
    .filter((result) => isDeadPushSubscription(result.statusCode))
    .map((result) => result.id);
}

export type PushDeliveryResult = {
  id: string;
  statusCode: number | null;
};

/**
 * Sends one test payload to each subscription.
 *
 * `send` resolves with the push service's HTTP status, or throws an error
 * that may carry `statusCode` (that is what the `web-push` package does).
 * Devices are contacted one at a time: a person has a handful of them, and
 * a failure on one must not skip the rest.
 */
export async function deliverTestPushes(
  rows: readonly {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[],
  payload: string,
  send: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ) => Promise<number>,
): Promise<PushDeliveryResult[]> {
  const results: PushDeliveryResult[] = [];

  for (const row of rows) {
    try {
      const statusCode = await send(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        payload,
      );
      results.push({ id: row.id, statusCode });
    } catch (error) {
      results.push({ id: row.id, statusCode: pushStatusCode(error) });
    }
  }

  return results;
}
