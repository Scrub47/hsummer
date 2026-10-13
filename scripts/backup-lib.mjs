/**
 * Rules for the weekly pg_dump workflow. The GitHub Action imports this
 * file. Vitest covers the same functions so a bad connection string fails
 * here, in plain language, before pg_dump runs.
 *
 * GitHub-hosted runners are IPv4-only. On the free plan the direct database
 * host is IPv6-only, so the dump has to use the Session pooler (port 5432)
 * in us-west-2. The transaction pooler (port 6543) cannot run pg_dump.
 */

export const BACKUP_KEEP = 8;

const DUMP_NAME = /^hsummer-\d{8}T\d{6}Z-[0-9a-f]{8}\.tgz\.gpg$/;

const SESSION_HOST = /^aws-\d+-us-west-2\.pooler\.supabase\.com$/;

export function backupObjectName(date, nonce) {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `hsummer-${stamp}-${nonce}.tgz.gpg`;
}

/** Oldest names beyond the keep window. Names that are not dumps are ignored. */
export function backupObjectsToDelete(names, keep = BACKUP_KEEP) {
  const dumps = names.filter((name) => DUMP_NAME.test(name)).sort();
  if (dumps.length <= keep) return [];
  return dumps.slice(0, dumps.length - keep);
}

export function assertDumpConnection(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return {
      ok: false,
      error:
        "SUPABASE_DB_URL is empty. In the Supabase dashboard click Connect at the top, choose Session pooler, and copy that URI. The host must contain us-west-2 and the port must be 5432.",
    };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      error:
        "SUPABASE_DB_URL is not a valid URI. If the database password contains @, #, ?, &, or a space, percent-encode that character and paste the URI again.",
    };
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return {
      ok: false,
      error:
        "SUPABASE_DB_URL has to start with postgresql://. Copy the Session pooler string from Connect.",
    };
  }

  const host = url.hostname;
  const port = url.port || "5432";
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);

  if (port === "6543") {
    return {
      ok: false,
      error:
        "This is the transaction pooler (port 6543). pg_dump cannot use it. In the Supabase dashboard click Connect, choose Session pooler, and copy the string whose port is 5432.",
    };
  }

  if (host.startsWith("db.") && host.endsWith(".supabase.co")) {
    return {
      ok: false,
      error:
        "This is the direct connection. On the free plan that host is IPv6-only, and GitHub Actions is IPv4-only, so the dump will not connect. Click Connect, choose Session pooler, and copy the string whose host contains us-west-2 and whose port is 5432.",
    };
  }

  if (!SESSION_HOST.test(host) || port !== "5432") {
    return {
      ok: false,
      error: `The Session pooler for this project is in Oregon (us-west-2), port 5432. The host in this secret is "${host}" port ${port}. Click Connect, choose Session pooler, and copy the string again. Do not use the Transaction pooler.`,
    };
  }

  if (!username.startsWith("postgres.")) {
    return {
      ok: false,
      error:
        "The Session pooler username looks like postgres.<project-ref>, not postgres. Copy the Session pooler string from Connect rather than typing it.",
    };
  }

  if (
    !password ||
    password === "[YOUR-PASSWORD]" ||
    password === "YOUR-PASSWORD"
  ) {
    return {
      ok: false,
      error:
        "The connection string still has the password placeholder. Open Project Settings → Database, copy the database password (reset it there if you don't know it), and replace [YOUR-PASSWORD] in the Session pooler URI.",
    };
  }

  if (url.pathname !== "/postgres") {
    return {
      ok: false,
      error:
        "The database name in the URI should be /postgres. Copy the Session pooler string from Connect.",
    };
  }

  return { ok: true, host, port: Number(port) };
}

/** pg_dump should encrypt the connection. Does not print or rebuild the URI. */
export function ensureSslMode(value) {
  if (/[?&]sslmode=/.test(value)) return value;
  return `${value}${value.includes("?") ? "&" : "?"}sslmode=require`;
}

export function assertBackupProjectUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      error:
        "SUPABASE_URL is missing. In Project Settings → API keys, copy the Project URL (https://<project-ref>.supabase.co). That is not the database connection string.",
    };
  }
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)
  ) {
    return {
      ok: false,
      error:
        "SUPABASE_URL has to be https://<project-ref>.supabase.co from Project Settings → API keys. Do not put the database connection string in this secret.",
    };
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    return {
      ok: false,
      error:
        "SUPABASE_URL should be the project origin only, with no path. Copy the Project URL from Project Settings → API keys.",
    };
  }
  return { ok: true, url: url.origin };
}

export function assertPassphrase(value) {
  const raw = typeof value === "string" ? value : "";
  if (raw.length < 16) {
    return {
      ok: false,
      error:
        "BACKUP_PASSPHRASE needs at least 16 characters. Invent one, store it in a password manager, and add it under GitHub Settings → Secrets and variables → Actions. The dump cannot be restored without it.",
    };
  }
  return { ok: true };
}

export function backupUploadFailure(message) {
  const text = message ?? "";
  if (/bucket not found/i.test(text) || /does not exist/i.test(text)) {
    return "The private backups bucket is missing. In the Supabase dashboard open SQL Editor → New query, paste supabase/migrations/20261116120000_backup_bucket.sql, and run it once.";
  }
  if (/mime|content.type|invalid mime/i.test(text)) {
    return "Storage rejected the file type. The backups bucket only accepts application/octet-stream.";
  }
  return "The backup upload failed. The private backups bucket has to exist, and SUPABASE_SECRET_KEY has to be the secret key from Project Settings → API keys.";
}
