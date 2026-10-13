import { assertDumpConnection, ensureSslMode } from "./backup-lib.mjs";

const result = assertDumpConnection(process.env.SUPABASE_DB_URL ?? "");
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

process.stdout.write(ensureSslMode(process.env.SUPABASE_DB_URL.trim()));
