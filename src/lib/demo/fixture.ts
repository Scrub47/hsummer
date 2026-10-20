import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import {
  DEMO_ALEX_AVATAR,
  DEMO_ALEX_ID,
  DEMO_BOOTH_SESSION_ID,
  DEMO_CHECKPOINT_HIT_ID,
  DEMO_CHECKPOINT_NEXT_ID,
  DEMO_CIRCLE_ID,
  DEMO_COUNTDOWN_ID,
  DEMO_JORDAN_AVATAR,
  DEMO_JORDAN_ID,
  DEMO_LETTER_ID,
  DEMO_PHOTO_KITCHEN_ID,
  DEMO_PHOTO_RAMEN_ID,
  DEMO_PHOTO_TRAIN_ID,
  DEMO_REPLY_LETTER_ID,
  DEMO_SCHEDULED_LETTER_ID,
  DEMO_SEALED_LETTER_ID,
} from "@/lib/demo/ids";
import type { Session } from "@/lib/supabase/session";

/**
 * In-memory stand-in for the seeded Alex & Jordan circle.
 * Used only when this machine has no Supabase project. Inserts fail with
 * the same error the database raises, and a row from any other circle id
 * is not in the tables this client can see.
 */

const READONLY = {
  message: "hsummer_demo_readonly",
  code: "P0001",
};

type Row = Record<string, unknown>;

const OTHER_CIRCLE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export function createDemoFixtureSession(origin: string): Session {
  return {
    userId: DEMO_ALEX_ID,
    supabase: createFixtureClient(
      origin,
    ) as unknown as SupabaseClient<Database>,
  };
}

function createFixtureClient(origin: string) {
  const tables = demoTables();
  return {
    from(table: string) {
      return new FixtureQuery(tables[table] ?? []);
    },
    rpc(name: string, args?: { target?: string }) {
      if (name === "circle_memory_bytes") {
        const bytes = (tables.memories ?? [])
          .filter((row) => row.circle_id === args?.target)
          .reduce((sum, row) => {
            const size = row.photo_bytes;
            return sum + (typeof size === "number" ? size : 0);
          }, 0);
        return Promise.resolve({ data: bytes, error: null, count: null });
      }
      return Promise.resolve({ data: [], error: null, count: null });
    },
    storage: {
      from() {
        return {
          createSignedUrl(path: string) {
            const file = mediaForPath(path);
            if (!file) {
              return Promise.resolve({
                data: null,
                error: { message: "missing" },
              });
            }
            const base = origin.replace(/\/$/, "");
            return Promise.resolve({
              data: { signedUrl: `${base}/demo-media/${file}` },
              error: null,
            });
          },
          upload() {
            return Promise.resolve({ data: null, error: READONLY });
          },
          remove() {
            return Promise.resolve({ data: null, error: READONLY });
          },
        };
      },
    },
  };
}

export function demoTables(now = new Date()): Record<string, Row[]> {
  const at = now.toISOString();
  const day = (daysAgo: number) => isoDate(now, daysAgo);
  const kitchen = `${DEMO_CIRCLE_ID}/${DEMO_PHOTO_KITCHEN_ID}.png`;
  const ramen = `${DEMO_CIRCLE_ID}/${DEMO_PHOTO_RAMEN_ID}.png`;
  const train = `${DEMO_CIRCLE_ID}/${DEMO_PHOTO_TRAIN_ID}.png`;
  const booth = (index: number) =>
    `${DEMO_CIRCLE_ID}/${DEMO_BOOTH_SESSION_ID}/${index}.jpg`;

  return {
    account_private: [account(DEMO_ALEX_ID, at), account(DEMO_JORDAN_ID, at)],
    profiles: [
      profile(DEMO_ALEX_ID, "Alex", "America/Los_Angeles", DEMO_ALEX_AVATAR),
      profile(DEMO_JORDAN_ID, "Jordan", "America/New_York", DEMO_JORDAN_AVATAR),
    ],
    circles: [
      {
        id: DEMO_CIRCLE_ID,
        name: "Alex & Jordan",
        circle_type: "couple",
        status: "active",
        created_at: at,
        created_by: DEMO_ALEX_ID,
        is_demo: true,
      },
    ],
    circle_members: [
      member(DEMO_CIRCLE_ID, DEMO_ALEX_ID, at),
      member(DEMO_CIRCLE_ID, DEMO_JORDAN_ID, at),
    ],
    circle_invites: [],
    countdowns: [
      {
        id: DEMO_COUNTDOWN_ID,
        circle_id: DEMO_CIRCLE_ID,
        label: "Next visit",
        target_date: "2027-06-12",
        created_at: at,
      },
    ],
    checkpoints: [
      {
        id: DEMO_CHECKPOINT_HIT_ID,
        circle_id: DEMO_CIRCLE_ID,
        countdown_id: DEMO_COUNTDOWN_ID,
        label: "Booked the visit",
        date: "2026-08-02",
        trigger: "manual",
        hit_at: at,
      },
      {
        id: DEMO_CHECKPOINT_NEXT_ID,
        circle_id: DEMO_CIRCLE_ID,
        countdown_id: DEMO_COUNTDOWN_ID,
        label: "Pick the weekend",
        date: "2027-03-14",
        trigger: "manual",
        hit_at: null,
      },
    ],
    bucket_items: [
      bucket(
        "a11ce000-0000-4000-8000-000000000101",
        "Try the ramen shop on Pine",
        "restaurant",
        "idea",
        null,
        "A fictional plan for the demo. Not a real reservation.",
        at,
      ),
      bucket(
        "a11ce000-0000-4000-8000-000000000102",
        "Watch the same film on a call",
        "movie",
        "planned",
        "2026-11-08",
        "Fictional. They press play at the same minute.",
        at,
      ),
      bucket(
        "a11ce000-0000-4000-8000-000000000103",
        "Walk the waterfront",
        "activity",
        "done",
        null,
        "A made-up afternoon. Nothing here is a real place.",
        at,
      ),
      bucket(
        "a11ce000-0000-4000-8000-000000000104",
        "Picnic with the good peaches",
        "date-idea",
        "idea",
        null,
        "Fictional. The peaches are not a recommendation.",
        at,
      ),
      bucket(
        "a11ce000-0000-4000-8000-000000000105",
        "Cook the same dinner on a call",
        "ldr-idea",
        "planned",
        null,
        "Fictional. Two kitchens, one recipe.",
        at,
      ),
    ],
    current_moods: [
      {
        user_id: DEMO_ALEX_ID,
        circle_id: DEMO_CIRCLE_ID,
        emoji: "🥰",
        updated_at: at,
      },
      {
        user_id: DEMO_JORDAN_ID,
        circle_id: DEMO_CIRCLE_ID,
        emoji: "😌",
        updated_at: at,
      },
    ],
    memories: [
      photo(
        DEMO_PHOTO_KITCHEN_ID,
        "Kitchen light. A drawing for the demo, not a photograph.",
        kitchen,
        ["home"],
        day(2),
        at,
      ),
      photo(
        DEMO_PHOTO_RAMEN_ID,
        "The ramen we keep meaning to try. Fictional.",
        ramen,
        ["food"],
        day(6),
        at,
      ),
      photo(
        DEMO_PHOTO_TRAIN_ID,
        "Night train between the two cities. Drawn, not photographed.",
        train,
        ["travel"],
        day(20),
        at,
      ),
      note(
        "a11ce000-0000-4000-8000-0000000000d7",
        DEMO_ALEX_ID,
        "First week in the new city. The light in the kitchen is nice. This note is fictional.",
        ["week-one"],
        day(12),
        at,
      ),
      note(
        "a11ce000-0000-4000-8000-0000000000d8",
        DEMO_JORDAN_ID,
        "Left the porch light on. Also fictional.",
        ["home"],
        day(1),
        at,
      ),
      {
        id: "a11ce000-0000-4000-8000-0000000000d9",
        circle_id: DEMO_CIRCLE_ID,
        created_by: DEMO_ALEX_ID,
        kind: "photo-strip",
        body: "A made-up strip. These frames are drawings, not photographs.",
        photo_path: null,
        photo_bytes: 4096,
        tags: ["photo-booth"],
        visibility: "circle",
        occurred_on: day(0),
        created_at: at,
        letter_id: null,
        checkpoint_id: null,
        booth_session_id: DEMO_BOOTH_SESSION_ID,
      },
      note(
        "a11ce000-0000-4000-8000-0000000000da",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "This note belongs to a real circle and must stay hidden.",
        ["private"],
        day(1),
        at,
        OTHER_CIRCLE_ID,
      ),
    ],
    memory_viewers: [],
    booth_sessions: [
      {
        id: DEMO_BOOTH_SESSION_ID,
        circle_id: DEMO_CIRCLE_ID,
        created_by: DEMO_ALEX_ID,
        mode: "solo",
        theme: "kawaii",
        frame_layout: "4-cut",
        status: "complete",
        caption: "A made-up strip. These frames are drawings, not photographs.",
        expires_at: null,
        capture_at: null,
        created_at: at,
      },
    ],
    booth_contributors: [
      {
        session_id: DEMO_BOOTH_SESSION_ID,
        user_id: DEMO_ALEX_ID,
        filter_id: "warm",
        assigned_positions: [0, 1, 2, 3],
        ready_at: at,
      },
    ],
    booth_shots: [0, 1, 2, 3].map((position) => ({
      session_id: DEMO_BOOTH_SESSION_ID,
      user_id: DEMO_ALEX_ID,
      position,
      storage_path: booth(position),
      byte_size: 1024,
    })),
    letters: [
      letter({
        id: DEMO_LETTER_ID,
        from: DEMO_ALEX_ID,
        to: DEMO_JORDAN_ID,
        category: "when-you-miss-me",
        title: "For a long week",
        body: "The train was late and I thought of you. This letter is fictional, for the demo circle only.",
        design: "minimal",
        status: "delivered",
        scheduled_for: null,
        opened_at: at,
        at,
      }),
      letter({
        id: DEMO_SCHEDULED_LETTER_ID,
        from: DEMO_ALEX_ID,
        to: DEMO_JORDAN_ID,
        category: "feeling-lonely",
        title: "Read this Friday",
        body: "This one is waiting. It is fictional, for the demo circle only, and it arrives later on purpose.",
        design: "kawaii",
        status: "scheduled",
        scheduled_for: new Date(
          now.getTime() + 21 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        opened_at: null,
        at,
      }),
      letter({
        id: DEMO_SEALED_LETTER_ID,
        from: DEMO_JORDAN_ID,
        to: DEMO_ALEX_ID,
        category: "need-motivation",
        title: "When the week feels long",
        body: "The seal is still on this one. The words are fictional, for the demo only.",
        design: "retro-film",
        status: "delivered",
        scheduled_for: null,
        opened_at: null,
        at,
      }),
      letter({
        id: DEMO_REPLY_LETTER_ID,
        from: DEMO_JORDAN_ID,
        to: DEMO_ALEX_ID,
        category: "distance-is-too-hard",
        title: "The kitchen light",
        body: "I read your letter on the train. None of this happened. It is sample text for the demo.",
        design: "minimal",
        status: "delivered",
        scheduled_for: null,
        opened_at: at,
        at,
      }),
    ],
    letter_categories: [],
    letter_pins: [],
    reactions: [],
    replies: [],
    pings: [
      ping(
        "a11ce000-0000-4000-8000-000000000201",
        DEMO_ALEX_ID,
        DEMO_JORDAN_ID,
        false,
        at,
      ),
      ping(
        "a11ce000-0000-4000-8000-000000000202",
        DEMO_JORDAN_ID,
        DEMO_ALEX_ID,
        false,
        at,
      ),
      ping(
        "a11ce000-0000-4000-8000-000000000203",
        DEMO_JORDAN_ID,
        DEMO_ALEX_ID,
        true,
        at,
      ),
    ],
  };
}

class FixtureQuery implements PromiseLike<{
  data: unknown;
  error: { message: string; code?: string } | null;
  count: number | null;
}> {
  private filters: Array<(row: Row) => boolean> = [];
  private ordering: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private mode: "rows" | "single" | "maybe" | "head" = "rows";

  constructor(private rows: Row[]) {}

  select(_columns?: string, options?: { head?: boolean; count?: string }) {
    if (options?.head) this.mode = "head";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    const allowed = new Set(values);
    this.filters.push((row) => allowed.has(row[column]));
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push((row) => compare(row[column], value) > 0);
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push((row) => compare(row[column], value) >= 0);
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push((row) => compare(row[column], value) < 0);
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push((row) => compare(row[column], value) <= 0);
    return this;
  }

  or() {
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.ordering = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(count: number) {
    this.max = count;
    return this;
  }

  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  single() {
    this.mode = "single";
    return this;
  }

  insert() {
    return Promise.resolve({ data: null, error: READONLY, count: null });
  }

  upsert() {
    return Promise.resolve({ data: null, error: READONLY, count: null });
  }

  update() {
    return new ReadonlyWrite();
  }

  delete() {
    return new ReadonlyWrite();
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): Result {
    let rows = this.rows.filter((row) =>
      this.filters.every((filter) => filter(row)),
    );
    if (this.ordering) {
      const { column, ascending } = this.ordering;
      rows = [...rows].sort((left, right) => {
        const diff = compare(left[column], right[column]);
        return ascending ? diff : -diff;
      });
    }
    const count = rows.length;
    if (this.max != null) rows = rows.slice(0, this.max);
    if (this.mode === "head") return { data: null, error: null, count };
    if (this.mode === "maybe") {
      if (rows.length > 1) {
        return {
          data: null,
          error: { message: "multiple", code: "PGRST116" },
          count,
        };
      }
      return { data: rows[0] ? { ...rows[0] } : null, error: null, count };
    }
    if (this.mode === "single") {
      if (rows.length !== 1) {
        return {
          data: null,
          error: { message: "missing", code: "PGRST116" },
          count,
        };
      }
      return { data: { ...rows[0] }, error: null, count };
    }
    return {
      data: rows.map((row) => ({ ...row })),
      error: null,
      count,
    };
  }
}

type Result = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count: number | null;
};

class ReadonlyWrite implements PromiseLike<Result> {
  eq() {
    return this;
  }
  in() {
    return this;
  }
  is() {
    return this;
  }
  select() {
    return this;
  }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: null, error: READONLY, count: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

function account(userId: string, at: string): Row {
  return {
    user_id: userId,
    is_demo: true,
    age_confirmed_at: at,
    analytics_opt_out: false,
    created_at: at,
    feedback_prompt_dismissed_at: null,
    notification_prefs: {},
  };
}

function profile(
  id: string,
  displayName: string,
  timezone: string,
  avatarPath: string,
): Row {
  return {
    id,
    display_name: displayName,
    timezone,
    avatar_path: avatarPath,
  };
}

function member(circleId: string, userId: string, at: string): Row {
  return {
    circle_id: circleId,
    user_id: userId,
    joined_at: at,
    left_at: null,
    muted_until: null,
  };
}

function bucket(
  id: string,
  title: string,
  category: string,
  status: string,
  plannedDate: string | null,
  notes: string,
  at: string,
): Row {
  return {
    id,
    circle_id: DEMO_CIRCLE_ID,
    title,
    category,
    status,
    planned_date: plannedDate,
    completed_at: status === "done" ? at : null,
    notes,
    link: null,
    created_by: DEMO_ALEX_ID,
    created_at: at,
    updated_at: at,
  };
}

function photo(
  id: string,
  body: string,
  path: string,
  tags: string[],
  occurredOn: string,
  at: string,
): Row {
  return {
    id,
    circle_id: DEMO_CIRCLE_ID,
    created_by: DEMO_ALEX_ID,
    kind: "photo",
    body,
    photo_path: path,
    photo_bytes: 2048,
    tags,
    visibility: "circle",
    occurred_on: occurredOn,
    created_at: at,
    letter_id: null,
    checkpoint_id: null,
    booth_session_id: null,
  };
}

function note(
  id: string,
  author: string,
  body: string,
  tags: string[],
  occurredOn: string,
  at: string,
  circleId = DEMO_CIRCLE_ID,
): Row {
  return {
    id,
    circle_id: circleId,
    created_by: author,
    kind: "note",
    body,
    photo_path: null,
    photo_bytes: 0,
    tags,
    visibility: "circle",
    occurred_on: occurredOn,
    created_at: at,
    letter_id: null,
    checkpoint_id: null,
    booth_session_id: null,
  };
}

function letter(input: {
  id: string;
  from: string;
  to: string;
  category: string;
  title: string;
  body: string;
  design: string;
  status: string;
  scheduled_for: string | null;
  opened_at: string | null;
  at: string;
}): Row {
  return {
    id: input.id,
    circle_id: DEMO_CIRCLE_ID,
    from_user_id: input.from,
    to_user_id: input.to,
    category: input.category,
    title: input.title,
    body: input.body,
    design: input.design,
    scheduled_for: input.scheduled_for,
    status: input.status,
    delivered_at: input.status === "delivered" ? input.at : null,
    opened_at: input.opened_at,
    created_at: input.at,
  };
}

function ping(
  id: string,
  from: string,
  to: string,
  secret: boolean,
  at: string,
): Row {
  return {
    id,
    circle_id: DEMO_CIRCLE_ID,
    from_user_id: from,
    to_user_id: to,
    ping_type: "thinking-of-you",
    mood_emoji: null,
    secret_variant: secret,
    sent_at: at,
  };
}

function isoDate(now: Date, daysAgo: number): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function compare(left: unknown, right: unknown): number {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  return String(left) < String(right)
    ? -1
    : String(left) > String(right)
      ? 1
      : 0;
}

function mediaForPath(path: string): string | null {
  if (path === DEMO_ALEX_AVATAR) return "avatar-alex.png";
  if (path === DEMO_JORDAN_AVATAR) return "avatar-jordan.png";
  if (path.endsWith(`/${DEMO_PHOTO_KITCHEN_ID}.png`)) return "kitchen.png";
  if (path.endsWith(`/${DEMO_PHOTO_RAMEN_ID}.png`)) return "ramen.png";
  if (path.endsWith(`/${DEMO_PHOTO_TRAIN_ID}.png`)) return "train.png";
  const frame = path.match(/\/([0-3])\.jpg$/);
  if (frame && path.includes(DEMO_BOOTH_SESSION_ID)) {
    return `booth-${frame[1]}.png`;
  }
  return null;
}
