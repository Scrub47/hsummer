import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Prints the local Supabase URL and keys for the Playwright circle flow.
 *
 * Refuses to print anything unless `supabase status` reports an http API on
 * localhost or 127.0.0.1. This script never reads a hosted project.
 *
 *   node scripts/print-local-supabase-env.mjs
 * writes shell `export` lines.
 *
 *   node scripts/print-local-supabase-env.mjs --github-env
 * writes KEY=value lines for $GITHUB_ENV.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const githubEnv = process.argv.includes("--github-env");

let output = "";
try {
  output = execFileSync(
    "npx",
    ["--no-install", "supabase", "status", "-o", "env"],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "status failed";
  console.error(
    `Local Supabase is not running. Start it with \`npx supabase start\`, then run this again.\n${message}`,
  );
  process.exit(1);
}

const env = parseEnv(output);
const apiUrl = env.API_URL ?? "";
const anonKey = env.ANON_KEY ?? env.PUBLISHABLE_KEY ?? "";
const serviceRoleKey = env.SERVICE_ROLE_KEY ?? env.SECRET_KEY ?? "";

if (!isLocalApi(apiUrl) || !anonKey || !serviceRoleKey) {
  console.error(
    "Refusing to export keys. supabase status did not report an http API on 127.0.0.1 or localhost. This script does not talk to production.",
  );
  process.exit(1);
}

const lines = {
  NEXT_PUBLIC_SUPABASE_URL: apiUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey,
  SUPABASE_SECRET_KEY: serviceRoleKey,
};

for (const [key, value] of Object.entries(lines)) {
  if (githubEnv) {
    if (value.includes("\n")) {
      console.error(`${key} contains a newline.`);
      process.exit(1);
    }
    process.stdout.write(`${key}=${value}\n`);
  } else {
    process.stdout.write(`export ${key}=${shellQuote(value)}\n`);
  }
}

function isLocalApi(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "::1" ||
        url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function parseEnv(text) {
  const entries = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match?.[1]) continue;
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[match[1]] = value;
  }
  return entries;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
