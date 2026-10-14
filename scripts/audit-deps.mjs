/**
 * Fails CI when a production dependency has a high or critical advisory.
 *
 * `npm audit` also reports braces (GHSA-vfj7-8cjw-p6xm) through
 * eslint-config-next → fast-glob → micromatch. That package is dev-only,
 * braces 3.0.3 is the latest release, and the advisory range is <=3.0.3, so
 * there is no patched version to install. Downgrading eslint-config-next to
 * 14.x would break the Next.js 16 lint config. A new high that is not this
 * chain still fails the script.
 */
import { execFileSync } from "node:child_process";

const BRACES_ADVISORY = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const BRACES_CHAIN = new Set([
  "braces",
  "micromatch",
  "fast-glob",
  "@next/eslint-plugin-next",
  "eslint-config-next",
]);

function audit(args) {
  try {
    return JSON.parse(
      execFileSync("npm", ["audit", "--json", ...args], {
        encoding: "utf8",
      }),
    );
  } catch (error) {
    const stdout = error && typeof error === "object" ? error.stdout : "";
    if (typeof stdout === "string" && stdout.startsWith("{")) {
      return JSON.parse(stdout);
    }
    throw error;
  }
}

const production = audit(["--omit=dev"]);
const productionHigh =
  (production.metadata?.vulnerabilities?.high ?? 0) +
  (production.metadata?.vulnerabilities?.critical ?? 0);
if (productionHigh > 0) {
  console.error(
    "Production dependencies have a high or critical advisory. Run npm audit --omit=dev.",
  );
  process.exit(1);
}

const all = audit([]);
const highs = Object.values(all.vulnerabilities ?? {}).filter(
  (item) => item.severity === "high" || item.severity === "critical",
);

if (highs.length === 0) {
  console.log("npm audit: no high or critical advisories.");
  process.exit(0);
}

for (const item of highs) {
  if (!BRACES_CHAIN.has(item.name)) {
    console.error(`Unexpected high advisory: ${item.name}`);
    process.exit(1);
  }
}

const braces = all.vulnerabilities?.braces;
const via = (braces?.via ?? []).find((entry) => typeof entry === "object");
if (!via || via.url !== BRACES_ADVISORY) {
  console.error("The braces advisory changed. Look at it before ignoring it.");
  process.exit(1);
}

console.log(
  "Production audit is clean. The only high is dev-only braces via eslint, with no patched release.",
);
