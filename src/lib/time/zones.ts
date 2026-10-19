/**
 * "America/Los_Angeles" is what the database stores. People should see
 * "Los Angeles (PT)". The value submitted by the form stays the IANA id.
 */

const SHORT_ABBR = new Set(["PT", "ET", "CT", "MT", "AT", "HT", "GMT", "UTC"]);

export function friendlyZoneLabel(timeZone: string, now = new Date()): string {
  if (timeZone === "UTC") return "UTC";
  const city = zoneCity(timeZone);
  const abbr = zoneAbbreviation(timeZone, now);
  if (!abbr || abbr.toLowerCase() === city.toLowerCase()) return city;
  return `${city} (${abbr})`;
}

export function zoneCity(timeZone: string): string {
  const city = timeZone.split("/").at(-1) ?? timeZone;
  return city.replaceAll("_", " ");
}

function zoneAbbreviation(timeZone: string, now: Date): string | null {
  const generic = zoneName(timeZone, now, "shortGeneric");
  if (generic && isCompact(generic)) return generic;
  const short = zoneName(timeZone, now, "short");
  if (short && isCompact(short)) return short;
  return null;
}

function isCompact(value: string): boolean {
  if (SHORT_ABBR.has(value)) return true;
  return value.length <= 6 && !value.includes(" ");
}

function zoneName(
  timeZone: string,
  now: Date,
  name: "short" | "shortGeneric",
): string | null {
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: name,
      })
        .formatToParts(now)
        .find((part) => part.type === "timeZoneName")?.value ?? null
    );
  } catch {
    return null;
  }
}

export function formatLocalTime(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(now);
  } catch {
    return "";
  }
}
