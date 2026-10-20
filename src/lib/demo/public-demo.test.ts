import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEMO_ALEX_ID,
  DEMO_CIRCLE_ID,
  DEMO_JORDAN_ID,
  DEMO_SCHEDULED_LETTER_ID,
} from "@/lib/demo/ids";
import { demoFrameAncestors, allowsDemoFraming } from "@/lib/demo/frame";
import { createDemoFixtureSession } from "@/lib/demo/fixture";
import { demoPreviewEnabled } from "@/lib/demo/preview-env";

describe("demo framing", () => {
  it("allows the portfolio to frame the demo and denies everyone else", () => {
    expect(
      demoFrameAncestors({ demoFrame: false, developmentOrigin: null }),
    ).toBe("'none'");
    expect(
      demoFrameAncestors({
        demoFrame: true,
        developmentOrigin: "http://127.0.0.1:3000",
      }),
    ).toContain("https://portfolio-isaac-hsu.vercel.app");
    expect(
      demoFrameAncestors({
        demoFrame: true,
        developmentOrigin: "http://127.0.0.1:3000",
      }),
    ).toContain("http://127.0.0.1:3000");
    expect(
      allowsDemoFraming({ pathname: "/demo", userId: null, preview: false }),
    ).toBe(true);
    expect(
      allowsDemoFraming({
        pathname: "/home",
        userId: "11111111-1111-4111-8111-111111111111",
        preview: false,
      }),
    ).toBe(false);
    expect(
      allowsDemoFraming({
        pathname: "/home",
        userId: DEMO_ALEX_ID,
        preview: false,
      }),
    ).toBe(true);
  });
});

describe("demo preview flag", () => {
  it("stays off on Vercel and when Supabase is configured", () => {
    const previous = {
      preview: process.env.HSUMMER_DEMO_PREVIEW,
      vercel: process.env.VERCEL,
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    };
    process.env.HSUMMER_DEMO_PREVIEW = "1";
    delete process.env.VERCEL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(demoPreviewEnabled()).toBe(true);

    process.env.VERCEL = "1";
    expect(demoPreviewEnabled()).toBe(false);

    delete process.env.VERCEL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcd.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    expect(demoPreviewEnabled()).toBe(false);

    restore("HSUMMER_DEMO_PREVIEW", previous.preview);
    restore("VERCEL", previous.vercel);
    restore("NEXT_PUBLIC_SUPABASE_URL", previous.url);
    restore("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", previous.key);
  });
});

describe("demo fixture", () => {
  it("hides another circle and refuses writes", async () => {
    const session = createDemoFixtureSession("http://127.0.0.1:3000");
    const circles = await session.supabase
      .from("circle_members")
      .select("circle_id")
      .eq("user_id", session.userId)
      .is("left_at", null);
    expect(circles.error).toBeNull();
    expect(circles.data?.map((row) => row.circle_id)).toEqual([DEMO_CIRCLE_ID]);

    const foreign = await session.supabase
      .from("memories")
      .select("id")
      .eq("circle_id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(foreign.data).toHaveLength(1);

    const demoMemories = await session.supabase
      .from("memories")
      .select("id, body")
      .eq("circle_id", DEMO_CIRCLE_ID);
    expect(
      (demoMemories.data ?? []).some((row) =>
        String(row.body).includes("ramen"),
      ),
    ).toBe(true);
    expect(
      (demoMemories.data ?? []).some((row) =>
        String(row.body).includes("must stay hidden"),
      ),
    ).toBe(false);

    const write = await session.supabase.from("memories").insert({
      circle_id: DEMO_CIRCLE_ID,
      kind: "note",
      body: "nope",
      occurred_on: "2026-10-01",
    });
    expect(write.error?.message).toContain("hsummer_demo_readonly");

    const letter = await session.supabase
      .from("letters")
      .select("title, status")
      .eq("id", DEMO_SCHEDULED_LETTER_ID)
      .maybeSingle();
    expect(letter.data?.title).toBe("Read this Friday");
    expect(letter.data?.status).toBe("scheduled");

    const signed = await session.supabase.storage
      .from("memories")
      .createSignedUrl(
        `${DEMO_CIRCLE_ID}/${"a11ce000-0000-4000-8000-0000000000d4"}.png`,
        60,
      );
    expect(signed.data?.signedUrl).toBe(
      "http://127.0.0.1:3000/demo-media/kitchen.png",
    );
    expect(session.userId).toBe(DEMO_ALEX_ID);
    expect(DEMO_JORDAN_ID).not.toBe(session.userId);
  });
});

describe("public demo migration", () => {
  it("keeps the seed on service_role and includes the sample story", () => {
    const sql = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20271021120000_public_demo.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("Try the ramen shop on Pine");
    expect(sql).toContain("Read this Friday");
    expect(sql).toContain("For a long week");
    expect(sql).toContain("When the week feels long");
    expect(sql).toContain("The kitchen light");
    expect(sql).toContain("A made-up strip");
    expect(sql).toContain("interval '21 days'");
    expect(sql).toContain(
      "grant execute on function public.seed_demo_circle(integer) to service_role",
    );
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).not.toContain(
      "grant execute on function public.seed_demo_circle(integer) to authenticated",
    );
  });

  it("resets through a script that names the same accounts", () => {
    const script = readFileSync(
      path.join(process.cwd(), "scripts/reset-demo.mjs"),
      "utf8",
    );
    expect(script).toContain(DEMO_ALEX_ID);
    expect(script).toContain(DEMO_JORDAN_ID);
    expect(script).toContain(DEMO_CIRCLE_ID);
    expect(script).toContain("seed_demo_circle");
  });
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
