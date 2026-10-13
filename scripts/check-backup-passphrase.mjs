import { assertPassphrase } from "./backup-lib.mjs";

const result = assertPassphrase(process.env.BACKUP_PASSPHRASE ?? "");
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
