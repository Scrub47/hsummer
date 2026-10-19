import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ENVELOPE_MS,
  ENVELOPE_REDUCED_MS,
  envelopeMs,
} from "@/lib/letters/envelope";

describe("letter envelope", () => {
  it("stays inside the noticeable window", () => {
    expect(envelopeMs(false)).toBe(ENVELOPE_MS);
    expect(envelopeMs(true)).toBe(ENVELOPE_REDUCED_MS);
    expect(ENVELOPE_MS).toBeGreaterThanOrEqual(1200);
    expect(ENVELOPE_MS).toBeLessThanOrEqual(1800);
    expect(ENVELOPE_REDUCED_MS).toBeGreaterThanOrEqual(1200);
    expect(ENVELOPE_REDUCED_MS).toBeLessThanOrEqual(1800);
  });

  it("plays a real sequence, and reduced motion fades instead of jumping", () => {
    const css = readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const component = readFileSync(
      path.join(process.cwd(), "src/components/letter-envelope.tsx"),
      "utf8",
    );
    const letters = readFileSync(
      path.join(process.cwd(), "src/components/letters.tsx"),
      "utf8",
    );
    const e2e = readFileSync(
      path.join(process.cwd(), "e2e/circle-flow.spec.ts"),
      "utf8",
    );

    expect(css).toContain("hsummer-send-fold");
    expect(css).toContain("hsummer-send-seal");
    expect(css).toContain("hsummer-send-fly");
    expect(css).toContain("hsummer-open-arrive");
    expect(css).toContain("hsummer-open-unseal");
    expect(css).toContain("hsummer-open-slide");
    expect(css).toContain("hsummer-envelope-fade");
    expect(component).toContain('document.getElementById("letter-stage-root")');
    expect(component).toContain("createPortal");
    expect(component).toContain('data-testid="letter-envelope"');
    expect(letters).toContain("<LetterEnvelope");
    expect(e2e).toContain('getByTestId("letter-envelope")');

    const reducedAt = css.indexOf("@media (prefers-reduced-motion: reduce)");
    const reduced = css.slice(reducedAt);
    expect(reduced).toContain("hsummer-envelope-fade");
    expect(reduced).not.toMatch(
      /\.letter-envelope[^{]*\{[^}]*animation:\s*none/,
    );
  });
});
