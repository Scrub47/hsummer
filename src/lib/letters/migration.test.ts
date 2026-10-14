import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_LETTER_CATEGORIES,
  LETTER_BODY_MAX,
  LETTER_LIMIT,
  LETTER_WINDOW_MINUTES,
} from "@/lib/letters/fields";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const week11 = readFileSync(
  path.join(root, "supabase/migrations/20261221120000_letters.sql"),
  "utf8",
);

const week12 = readFileSync(
  path.join(root, "supabase/migrations/20261228120000_still_us.sql"),
  "utf8",
);

describe("week 11 migration", () => {
  it("adds letters and custom categories without dropping earlier tables", () => {
    expect(week11).toContain("create table public.letters");
    expect(week11).toContain("create table public.letter_categories");
    expect(week11).toContain(
      "alter table public.letters enable row level security",
    );
    expect(week11).toContain(
      "alter table public.letter_categories enable row level security",
    );
    expect(week11).toContain("public.open_letter");
    expect(week11).toContain("kind in ('photo', 'note', 'letter')");
    expect(week11).toContain(String(LETTER_BODY_MAX));
    expect(week11).toContain(`recent >= ${LETTER_LIMIT}`);
    expect(week11).toContain(`interval '${LETTER_WINDOW_MINUTES} minutes'`);
    expect(week11).not.toMatch(/drop table/i);
    expect(week11).not.toMatch(/truncate/i);
    expect(week11).not.toMatch(/alter table public\.profiles/i);
    expect(week11).not.toMatch(/alter table public\.pings/i);
    expect(week11).not.toContain("circle_type");
    for (const category of DEFAULT_LETTER_CATEGORIES) {
      expect(week11).toContain(`'${category.slug}'`);
    }
  });

  it("replaces the memory checks so a letter can be stored, and does not delete rows", () => {
    expect(week11).toContain(
      "alter table public.memories drop constraint memories_kind_known",
    );
    expect(week11).toContain(
      "alter table public.memories drop constraint memories_photo_shape",
    );
    expect(week11).toContain("add column letter_id");
    expect(week11).toContain("memories_one_letter_idx");
    expect(week11).not.toMatch(/drop column/i);
    expect(week11).not.toMatch(/delete from public\.memories/i);
  });

  it("lets the sender read, and the recipient only after delivery", () => {
    const policy = week11.slice(week11.indexOf("letters_select_parties"));
    expect(policy).toContain("from_user_id = (select auth.uid())");
    expect(policy).toContain("to_user_id = (select auth.uid())");
    expect(policy).toContain("delivered_at is not null");
    expect(policy).toContain("private.is_active_member(circle_id)");
    expect(policy).not.toContain("circle_type");
  });

  it("does not grant delivery, open, or schedule columns to signed-in writers", () => {
    const start = week11.indexOf(
      "grant insert (\n  circle_id,\n  from_user_id,",
    );
    const insert = week11.slice(
      start,
      week11.indexOf(") on table public.letters to authenticated", start),
    );
    expect(insert).toContain("circle_id");
    expect(insert).toContain("body");
    expect(insert).not.toContain("delivered_at");
    expect(insert).not.toContain("opened_at");
    expect(insert).not.toContain("status");
    expect(insert).not.toContain("scheduled_for");
    expect(insert).not.toContain("qstash_message_id");

    const selectStart = week11.lastIndexOf("grant select (", start);
    const select = week11.slice(
      selectStart,
      week11.indexOf(") on table public.letters to authenticated", selectStart),
    );
    expect(select).toContain("body");
    expect(select).not.toContain("qstash_message_id");
  });
});

describe("week 12 migration", () => {
  it("adds countdowns and checkpoints without dropping tables", () => {
    expect(week12).toContain("create table public.countdowns");
    expect(week12).toContain("create table public.checkpoints");
    expect(week12).toContain(
      "alter table public.countdowns enable row level security",
    );
    expect(week12).toContain(
      "alter table public.checkpoints enable row level security",
    );
    expect(week12).toContain("public.sync_auto_checkpoints");
    expect(week12).toContain("public.hit_checkpoint");
    expect(week12).toContain("public.deliver_scheduled_letter");
    expect(week12).toContain("public.deliver_due_letters");
    expect(week12).toContain("memories_one_checkpoint_idx");
    expect(week12).toContain(
      "kind in ('photo', 'note', 'letter', 'milestone')",
    );
    expect(week12).not.toMatch(/drop table/i);
    expect(week12).not.toMatch(/truncate/i);
    expect(week12).not.toMatch(/delete from public\./i);
  });

  it("grants a future schedule and still hides the QStash id", () => {
    expect(week12).toContain(
      "grant insert (scheduled_for) on table public.letters to authenticated",
    );
    expect(week12).toContain(
      "grant update (scheduled_for) on table public.letters to authenticated",
    );
    expect(week12).not.toContain("grant insert (qstash_message_id)");
    expect(week12).not.toContain("grant update (qstash_message_id)");
    expect(week12).not.toContain("grant select (qstash_message_id)");
    expect(week12).toContain("alter policy letters_insert_sender");
    expect(week12).not.toMatch(/drop policy/i);
  });

  it("keeps circle type out of the access policies", () => {
    const policies = week12.slice(
      week12.indexOf("create policy countdowns_select_member"),
      week12.indexOf("create function private.countdowns_guard"),
    );
    expect(policies).not.toContain("circle_type");
    expect(policies).toContain("private.is_active_member(circle_id)");
    expect(week12).toContain("hsummer_countdown_couple");
  });

  it("explains the constraint replace and does not delete memory rows", () => {
    expect(week12).toContain("drop constraint memories_kind_known");
    expect(week12).toContain("drop constraint memories_photo_shape");
    expect(week12).toContain("add column checkpoint_id");
    expect(week12).not.toMatch(/drop column/i);
    expect(week12).toContain("No row, policy, or bucket is");
  });
});
