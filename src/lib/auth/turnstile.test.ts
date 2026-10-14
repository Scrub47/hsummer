import { describe, expect, it } from "vitest";

import { turnstileAccepted } from "@/lib/auth/turnstile";

describe("turnstileAccepted", () => {
  it("accepts only a success flag", () => {
    expect(turnstileAccepted({ success: true })).toBe(true);
    expect(turnstileAccepted({ success: false })).toBe(false);
    expect(turnstileAccepted(null)).toBe(false);
    expect(turnstileAccepted("true")).toBe(false);
  });
});
