import { describe, expect, it } from "vitest";

import {
  CAMERA_BUSY,
  CAMERA_DENIED,
  CAMERA_FAILED,
  CAMERA_INSECURE,
  CAMERA_MISSING,
  cameraAttempts,
  cameraErrorCopy,
} from "@/lib/booth/camera";

describe("camera setup", () => {
  it("never asks for the microphone", () => {
    for (const attempt of cameraAttempts("user")) {
      expect(attempt.audio).toBe(false);
    }
    expect(cameraAttempts("environment")[0]?.video).toMatchObject({
      facingMode: "environment",
    });
  });

  it("explains a denied camera, including the Home Screen settings path", () => {
    const copy = cameraErrorCopy(new DOMException("denied", "NotAllowedError"));
    expect(copy).toBe(CAMERA_DENIED);
    expect(copy).toMatch(/Home Screen/);
    expect(copy).toMatch(/library/);
    expect(
      cameraErrorCopy(new DOMException("no device", "NotFoundError")),
    ).toBe(CAMERA_MISSING);
    expect(cameraErrorCopy(new DOMException("busy", "NotReadableError"))).toBe(
      CAMERA_BUSY,
    );
    expect(cameraErrorCopy(new DOMException("http", "SecurityError"))).toBe(
      CAMERA_INSECURE,
    );
    expect(cameraErrorCopy(new Error("nope"))).toBe(CAMERA_FAILED);
  });
});
