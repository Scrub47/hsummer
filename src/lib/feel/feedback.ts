/**
 * A short vibration, where the phone actually supports it, and an optional
 * soft tone. iOS Safari has no vibrate API. This does not invent one.
 *
 * Sounds stay off until Settings writes hsummer-sounds=1. The tone is made
 * with the Web Audio oscillator, so no audio file is fetched.
 */

export type FeelKind = "ping" | "seal" | "mood" | "milestone";

const SOUND_KEY = "hsummer-sounds";

export function soundsEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberSounds(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    // Private mode can refuse the write. The toggle still saves on the account.
  }
}

type VibrateFn = (pattern: number | number[]) => boolean;

export function vibrate(pattern: number | number[]): boolean {
  if (typeof navigator === "undefined") return false;
  const vibrateFn = (navigator as { vibrate?: VibrateFn }).vibrate;
  if (typeof vibrateFn !== "function") return false;
  try {
    return vibrateFn(pattern) !== false;
  } catch {
    return false;
  }
}

export function tapFeedback(kind: FeelKind): void {
  if (kind === "milestone") vibrate([12, 40, 18]);
  else vibrate(12);
  if (soundsEnabled()) playSoft(kind);
}

function playSoft(kind: FeelKind): void {
  const Context =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Context) return;
  try {
    const context = new Context();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value =
      kind === "milestone" ? 520 : kind === "seal" ? 440 : 360;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.stop(context.currentTime + 0.2);
    oscillator.onended = () => {
      void context.close();
    };
  } catch {
    // Autoplay rules and a missing audio device stay silent.
  }
}
