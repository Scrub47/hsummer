/** Friendlier names than Active / Open / Pending on circle cards. */
export function circleStatusLabel(
  status: "pending" | "active" | "archived",
): string {
  if (status === "active") return "Together";
  if (status === "archived") return "Archived";
  return "Waiting";
}
