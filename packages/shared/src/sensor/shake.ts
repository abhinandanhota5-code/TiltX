/**
 * Deliberate-shake detection with a magnitude threshold, a sustain window, a
 * re-arm debounce and a cooldown — ordinary handling motion must not fire it.
 */

export interface ShakeDetectorOptions {
  /** Deviation from gravity (m/s²) required to count as a shake. */
  threshold?: number;
  /** How long the deviation must be sustained, in ms. */
  sustainMs?: number;
  /** Minimum quiet time after a firing before another can trigger. */
  cooldownMs?: number;
  /** Deviation must fall below threshold × this to re-arm. */
  releaseRatio?: number;
}

const DEFAULTS = {
  threshold: 14,
  sustainMs: 90,
  cooldownMs: 2000,
  releaseRatio: 0.6,
};

export class ShakeDetector {
  private readonly threshold: number;
  private readonly sustainMs: number;
  private readonly cooldownMs: number;
  private readonly releaseRatio: number;

  private aboveSince: number | null = null;
  private lastFiredAt = -Infinity;
  private armed = true;

  constructor(options: ShakeDetectorOptions = {}) {
    this.threshold = Math.max(1, options.threshold ?? DEFAULTS.threshold);
    this.sustainMs = Math.max(0, options.sustainMs ?? DEFAULTS.sustainMs);
    this.cooldownMs = Math.max(0, options.cooldownMs ?? DEFAULTS.cooldownMs);
    this.releaseRatio = Math.min(1, Math.max(0.1, options.releaseRatio ?? DEFAULTS.releaseRatio));
  }

  reset(): void {
    this.aboveSince = null;
    this.lastFiredAt = -Infinity;
    this.armed = true;
  }

  /** Milliseconds until another shake may fire (0 when ready). */
  cooldownRemaining(now: number): number {
    const left = this.lastFiredAt + this.cooldownMs - now;
    return left > 0 ? left : 0;
  }

  /**
   * Feed the current deviation-from-gravity magnitude.
   * @returns true exactly once per accepted shake gesture.
   */
  update(magnitude: number, now: number): boolean {
    if (!Number.isFinite(magnitude)) return false;

    const releaseLevel = this.threshold * this.releaseRatio;
    if (magnitude < releaseLevel) this.armed = true;

    if (!this.armed) return false;
    if (this.cooldownRemaining(now) > 0) return false;

    if (magnitude >= this.threshold) {
      if (this.aboveSince === null) this.aboveSince = now;
      if (now - this.aboveSince >= this.sustainMs) {
        this.aboveSince = null;
        this.armed = false;
        this.lastFiredAt = now;
        return true;
      }
    } else {
      this.aboveSince = null;
    }
    return false;
  }
}
