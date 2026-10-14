import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appDir = path.join(process.cwd(), "src", "app");

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
      continue;
    }
    if (name === "route.ts" || name.endsWith("actions.ts")) found.push(full);
  }
  return found;
}

function usesZod(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const text = readFileSync(file, "utf8");
  if (text.includes('from "zod"')) return true;

  const imports = text.matchAll(/from "(@\/[^"]+|(\.\.?\/[^"]+))"/g);
  for (const match of imports) {
    const specifier = match[1];
    if (!specifier) continue;
    const resolved = resolveImport(file, specifier);
    if (resolved && usesZod(resolved, seen)) return true;
  }
  return false;
}

function resolveImport(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(process.cwd(), "src", specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next suffix.
    }
  }
  return null;
}

describe("server entry points", () => {
  it("validates input with zod, directly or through a module they import", () => {
    const entries = walk(appDir);
    expect(entries.length).toBeGreaterThan(5);
    const missing = entries
      .filter((file) => !usesZod(file))
      .map((file) => path.relative(process.cwd(), file));
    expect(missing).toEqual([]);
  });
});
