/**
 * Lightweight smoothing primitives. Intentionally small: an EMA for command
 * values and a complementary filter for fusing accelerometer angle with
 * gyroscopic rate. Neither introduces perceptible input delay at the rates
 * the controller runs at.
 */

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Exponential moving average driven by elapsed time. */
export class ExponentialSmoother {
  private value: number | null = null;
  private readonly alphaMs: number;

  /**
   * @param smoothing 0 = no smoothing, 1 = maximum smoothing. Converted to a
   * time constant so behaviour is independent of update rate.
   */
  constructor(smoothing: number) {
    const s = clamp(smoothing, 0, 0.95);
    this.alphaMs = 4 + s * 90; // time constant in ms
  }

  reset(value?: number): void {
    this.value = value ?? null;
  }

  get settled(): boolean {
    return this.value !== null;
  }

  push(next: number, dtMs: number): number {
    if (this.value === null) {
      this.value = next;
      return next;
    }
    const dt = clamp(Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 16, 1, 250);
    const alpha = 1 - Math.exp(-dt / this.alphaMs);
    this.value = this.value + alpha * (next - this.value);
    return this.value;
  }

  read(): number {
    return this.value ?? 0;
  }
}

/**
 * Complementary filter: fuses an angle derived from the accelerometer with an
 * angle integrated from the gyroscope. Fast gyro response, slow drift correction.
 *
 * Accel-only attitude is NOT an absolute orientation measurement — gravity is
 * the only reference available — so the gyro carries short-term changes and
 * the accelerometer pulls the estimate back to level over time.
 */
export class ComplementaryFilter {
  private angle: number | null = null;

  constructor(private readonly alpha = 0.98) {}

  reset(angle?: number): void {
    this.angle = angle ?? null;
  }

  get settled(): boolean {
    return this.angle !== null;
  }

  /**
   * @param gyroRateDegPerSec angular rate about the axis (deg/s)
   * @param accelAngleDeg     angle derived from the accelerometer (deg)
   * @param dtMs              elapsed time since the previous update
   */
  update(gyroRateDegPerSec: number, accelAngleDeg: number, dtMs: number): number {
    const dt = clamp(Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 16, 1, 250) / 1000;
    const a = clamp(this.alpha, 0, 0.999);
    if (this.angle === null) {
      this.angle = accelAngleDeg;
      return this.angle;
    }
    const predicted = this.angle + gyroRateDegPerSec * dt;
    this.angle = a * predicted + (1 - a) * accelAngleDeg;
    return this.angle;
  }

  read(): number {
    return this.angle ?? 0;
  }
}
