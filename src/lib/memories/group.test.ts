import { describe, expect, it } from "vitest";

import {
  audienceLabel,
  groupMemories,
  memoryTagList,
  type MemoryCard,
} from "@/lib/memories/group";

function card(overrides: Partial<MemoryCard> = {}): MemoryCard {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "note",
    body: "Ferry",
    photoUrl: null,
    photoPath: null,
    tags: ["summer"],
    visibility: "circle",
    viewerNames: [],
    occurredOn: "2026-10-14",
    createdAt: "2026-10-14T18:00:00.000Z",
    author: "you",
    mine: true,
    letterId: null,
    ...overrides,
  };
}

describe("memory grouping", () => {
  it("groups by month, newest first, and newest inside the month", () => {
    const groups = groupMemories(
      [
        card({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          occurredOn: "2026-01-02",
          createdAt: "2026-01-02T12:00:00.000Z",
          tags: ["winter"],
          body: "January",
        }),
        card({
          body: "Later in October",
          createdAt: "2026-10-20T12:00:00.000Z",
        }),
        card(),
      ],
      null,
    );

    expect(groups.map((group) => group.label)).toEqual([
      "October 2026",
      "January 2026",
    ]);
    expect(groups[0]?.memories.map((memory) => memory.body)).toEqual([
      "Later in October",
      "Ferry",
    ]);
  });

  it("narrows to one tag and lists the tags that exist", () => {
    const memories = [
      card(),
      card({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        tags: ["winter"],
        occurredOn: "2026-01-02",
        body: "January",
      }),
    ];
    expect(memoryTagList(memories)).toEqual(["summer", "winter"]);
    const winter = groupMemories(memories, "winter");
    expect(winter).toHaveLength(1);
    expect(winter[0]?.label).toBe("January 2026");
    expect(groupMemories(memories, "missing")).toEqual([]);
  });

  it("describes who can see a row", () => {
    expect(audienceLabel(card())).toBe("Everyone in the circle");
    expect(
      audienceLabel(
        card({ visibility: "selected", viewerNames: [], mine: true }),
      ),
    ).toBe("Only you");
    expect(
      audienceLabel(
        card({ visibility: "selected", viewerNames: ["Summer"], mine: true }),
      ),
    ).toBe("Shared with Summer");
    expect(audienceLabel(card({ visibility: "selected", mine: false }))).toBe(
      "Shared with you",
    );
  });
});
