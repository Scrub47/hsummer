import { assertDumpConnection } from "./backup-lib.mjs";

const result = assertDumpConnection(process.env.SUPABASE_DB_URL ?? "");
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

console.log(
  `Session pooler ${result.host}:${result.port} is the Northern California (us-west-1) connection pg_dump can use.`,
);
