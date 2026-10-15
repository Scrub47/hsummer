/**
 * Camera setup for the Solo Booth.
 *
 * The preview element has to be playsinline and muted, including on an
 * iPhone Home Screen app, or iOS will not play the stream. Audio stays off:
 * the permissions policy allows the camera and blocks the microphone, and a
 * request that asks for both is refused. The preview is mirrored with CSS.
 * The captured frame is not.
 */

export type CameraFacing = "user" | "environment";

export const CAMERA_DENIED =
  "Hsummer can't use the camera. If you added Hsummer to your iPhone Home Screen, open Settings, then Hsummer, then Camera, and allow it. In Safari, open Settings, then Safari, then Camera. You can still pick photos from your library.";

export const CAMERA_MISSING =
  "This device doesn't have a camera Hsummer can use. Pick photos from your library instead.";

export const CAMERA_BUSY =
  "The camera is in use by another app. Close that app, or pick photos from your library.";

export const CAMERA_INSECURE =
  "The camera needs a secure page. Open Hsummer from the Home Screen icon over HTTPS, or pick photos from your library.";

export const CAMERA_FAILED =
  "The camera didn't start. Try again, or pick photos from your library.";

export function cameraAttempts(facing: CameraFacing): MediaStreamConstraints[] {
  return [
    {
      audio: false,
      video: {
        facingMode: facing,
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
    },
    { audio: false, video: { facingMode: facing } },
    { audio: false, video: true },
  ];
}

export function cameraErrorCopy(error: unknown): string {
  const name =
    error instanceof DOMException
      ? error.name
      : error instanceof Error
        ? error.name
        : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return CAMERA_DENIED;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return CAMERA_MISSING;
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return CAMERA_BUSY;
  }
  if (name === "SecurityError") return CAMERA_INSECURE;
  return CAMERA_FAILED;
}
