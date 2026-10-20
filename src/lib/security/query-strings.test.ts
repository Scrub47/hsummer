import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function walk(dir: string, suffixes: string[]): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full, suffixes));
      continue;
    }
    if (suffixes.some((suffix) => name.endsWith(suffix))) found.push(full);
  }
  return found;
}

const FILTER_LITERAL =
  /(?:\.eq\.|\.neq\.|\.gt\.|\.gte\.|\.lt\.|\.lte\.|\.like\.|\.ilike\.|circle_id=eq\.)/;

describe("query strings", () => {
  it("does not build PostgREST filters or SQL from raw text", () => {
    const files = walk(path.join(root, "src"), [".ts", ".tsx"]).filter(
      (file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
    );
    const problems: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const relative = path.relative(root, file);
      if (/\.rpc\(\s*`/.test(text) || /\bsql\s*`/.test(text)) {
        problems.push(`${relative} builds a query with a template`);
      }
      if (/\.or\(\s*`/.test(text)) {
        problems.push(`${relative} passes a template to .or()`);
      }

      const templates = text.matchAll(/`[^`]*`/g);
      for (const match of templates) {
        const literal = match[0];
        if (!literal.includes("${") || !FILTER_LITERAL.test(literal)) continue;
        const before = text.slice(
          Math.max(0, (match.index ?? 0) - 700),
          match.index,
        );
        const guarded =
          /isCircleId\(/.test(before) ||
          /POSTGREST_TIMESTAMP\.test\(/.test(before);
        if (!guarded) {
          problems.push(`${relative} interpolates a filter: ${literal}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("quotes dynamic SQL identifiers in migrations", () => {
    const files = walk(path.join(root, "supabase/migrations"), [".sql"]);
    const problems: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const relative = path.relative(root, file);
      for (const match of text.matchAll(/execute\s+format\(\s*'([^']*)'/g)) {
        const format = match[1] ?? "";
        if (format.includes("%s") || !format.includes("%I")) {
          problems.push(`${relative} format(${format})`);
        }
      }
      if (/execute\s+[^'"$]*\|\|/.test(text)) {
        problems.push(`${relative} concatenates into execute`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("uploads", () => {
  it("sniffs type and refuses files over the byte cap before storing them", () => {
    const memory = readFileSync(
      path.join(root, "src/app/circles/memory-actions.ts"),
      "utf8",
    );
    const photo = readFileSync(
      path.join(root, "src/lib/memories/photo.ts"),
      "utf8",
    );
    const booth = readFileSync(
      path.join(root, "src/app/circles/booth-actions.ts"),
      "utf8",
    );
    const profile = readFileSync(
      path.join(root, "src/app/profile/actions.ts"),
      "utf8",
    );
    const avatar = readFileSync(
      path.join(root, "src/lib/profile/fields.ts"),
      "utf8",
    );
    const stored = readFileSync(
      path.join(root, "src/lib/profile/stored-avatar.ts"),
      "utf8",
    );

    expect(memory).toContain("MEMORY_MAX_BYTES");
    expect(memory).toContain("sniffMemoryPhoto");
    expect(photo).toContain("MEMORY_MAX_BYTES");
    expect(photo).toContain('contentType: "image/jpeg"');
    expect(photo).toContain('contentType: "image/png"');
    expect(photo).toContain('contentType: "image/webp"');

    expect(booth).toContain("file.size > MEMORY_MAX_BYTES");
    expect(booth).toContain('sniffed.value.contentType !== "image/jpeg"');
    expect(booth).toContain("BOOTH_TOTAL_MAX_BYTES");

    expect(profile).toContain("AVATAR_MAX_BYTES");
    expect(profile).toContain("avatarForStorage");
    expect(avatar).toContain("AVATAR_MAX_BYTES");
    expect(avatar).toContain("sniffAvatar");
    expect(stored).toContain("AVATAR_MAX_BYTES");
    expect(stored).toContain("stripImageMetadata");
  });
});
