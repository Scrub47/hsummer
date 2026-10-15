export async function onRequestError(
  error: unknown,
  request: { path: string },
): Promise<void> {
  const { reportServerError } = await import("@/lib/monitor/sentry");
  await reportServerError(error, { path: request.path });
}
