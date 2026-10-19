/**
 * The bear icons are drawn by scripts/export-brand.py.
 * This file used to paint two circles. It now forwards so an old command
 * cannot overwrite the logo.
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("python3", ["scripts/export-brand.py"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
