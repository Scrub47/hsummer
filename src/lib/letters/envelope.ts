/**
 * One window for the letter envelope, in milliseconds.
 * Full motion is fold / seal / fly, or arrive / unseal / slide.
 * Reduced motion is a fade and scale of the same length band.
 */
export const ENVELOPE_MS = 1500;
export const ENVELOPE_REDUCED_MS = 1200;

export function envelopeMs(reduced: boolean): number {
  return reduced ? ENVELOPE_REDUCED_MS : ENVELOPE_MS;
}
