import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = path.join(process.cwd(), "src");

const SECRET_NAMES = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VAPID_PRIVATE_KEY",
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "TURNSTILE_SECRET_KEY",
];

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
      continue;
    }
    if (name.endsWith(".ts") || name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

function isUseServer(text: string): boolean {
  return /^["']use server["'];/m.test(text);
}

function localImports(text: string): string[] {
  return [...text.matchAll(/from "(@\/[^"]+|\.\.?\/[^"]+)"/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
}

function resolveImport(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(srcDir, specifier.slice(2))
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

function reachableFromClient(start: string): string[] {
  const reached: string[] = [];
  const seen = new Set<string>();
  const queue = [start];

  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    if (file !== start && isUseServer(text)) continue;
    reached.push(file);
    for (const specifier of localImports(text)) {
      const resolved = resolveImport(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }

  return reached;
}

describe("client bundle", () => {
  it("does not reach server secrets from a client component", () => {
    const clients = walk(srcDir).filter((file) =>
      /^["']use client["'];/m.test(readFileSync(file, "utf8")),
    );
    expect(clients.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const client of clients) {
      for (const file of reachableFromClient(client)) {
        const text = readFileSync(file, "utf8");
        const relative = path.relative(process.cwd(), file);
        if (
          text.includes('from "server-only"') ||
          text.includes("@/lib/env.server") ||
          text.includes("@/lib/supabase/admin")
        ) {
          problems.push(
            `${path.relative(process.cwd(), client)} -> ${relative}`,
          );
        }
        for (const name of SECRET_NAMES) {
          if (text.includes(name)) {
            problems.push(`${relative} mentions ${name}`);
          }
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
