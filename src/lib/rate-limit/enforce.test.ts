import { afterEach, describe, expect, it, vi } from "vitest";

import { PING_RATE_LIMIT_MESSAGE } from "@/lib/pings/fields";
import {
  enforceSharedLimit,
  type SharedLimiter,
} from "@/lib/rate-limit/enforce";

afterEach(() => {
  vi.useRealTimers();
});

describe("shared rate limit", () => {
  it("returns 429 and the friendly sentence when the window is full", async () => {
    const limiter: SharedLimiter = async () => false;
    await expect(
      enforceSharedLimit({
        key: "ping:user",
        limit: 10,
        window: "10 m",
        error: PING_RATE_LIMIT_MESSAGE,
        limiter,
      }),
    ).resolves.toEqual({
      ok: false,
      status: 429,
      error: PING_RATE_LIMIT_MESSAGE,
    });
  });

  it("skips to the database when Upstash is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    await expect(
      enforceSharedLimit({
        key: "invite:user",
        limit: 10,
        window: "15 m",
        error: "wait",
      }),
    ).resolves.toEqual({ ok: true, source: "database" });
  });

  it("falls back to the database when the limiter throws or times out", async () => {
    const broken: SharedLimiter = async () => {
      throw new Error("redis down");
    };
    await expect(
      enforceSharedLimit({
        key: "redeem-user:user",
        limit: 8,
        window: "15 m",
        error: "wait",
        limiter: broken,
      }),
    ).resolves.toEqual({ ok: true, source: "database" });

    vi.useFakeTimers();
    const hanging: SharedLimiter = () => new Promise(() => undefined);
    const pending = enforceSharedLimit({
      key: "ping:user",
      limit: 10,
      window: "10 m",
      error: PING_RATE_LIMIT_MESSAGE,
      limiter: hanging,
    });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toEqual({ ok: true, source: "database" });
  });
});
