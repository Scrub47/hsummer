import { assertDumpConnection } from "./backup-lib.mjs";

const result = assertDumpConnection(process.env.SUPABASE_DB_URL ?? "");
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

const region = result.host.includes("us-west-2")
  ? "Oregon (us-west-2)"
  : "Northern California (us-west-1)";
console.log(
  `Session pooler ${result.host}:${result.port} is the ${region} connection pg_dump can use.`,
);
