import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tabBarTopPx } from "@/lib/chrome/tab-bar";

describe("tab bar pin", () => {
  it("sits on the visual bottom, including while that viewport is offset", () => {
    expect(
      tabBarTopPx({ offsetTop: 0, viewportHeight: 844, barHeight: 64 }),
    ).toBe(780);
    expect(
      tabBarTopPx({ offsetTop: 120, viewportHeight: 700, barHeight: 64 }),
    ).toBe(756);
    expect(
      tabBarTopPx({ offsetTop: 0, viewportHeight: 40, barHeight: 80 }),
    ).toBe(0);
  });

  it("is portaled to the layout root and painted as a solid bar", () => {
    const component = readFileSync(
      path.join(process.cwd(), "src/components/tab-bar.tsx"),
      "utf8",
    );
    const css = readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    expect(component).toContain('document.getElementById("tab-bar-root")');
    expect(component).toContain("createPortal");
    const start = css.indexOf("#tab-bar-root .tab-bar");
    const block = css.slice(start, css.indexOf(".tab-bar a {", start));
    expect(block).toContain("background: var(--card)");
    expect(block).not.toContain("transparent");
    expect(block).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("--tab-bar-offset");
  });
});
