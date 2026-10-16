export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MotionSample {
  /** Client monotonic timestamp in ms. */
  t: number;
  /** Accelerometer reading including gravity (m/s²). */
  acceleration: Vec3;
  /** Optional device orientation in degrees. */
  orientation?: number;
}

export interface CalibrationBaseline {
  /** Median gravity vector captured while the device was at rest. */
  gravity: Vec3;
  /** Median screen orientation during calibration (deg). */
  orientation: number;
  /** Number of samples kept after outlier rejection. */
  samples: number;
  /** Mean absolute deviation of the kept samples (m/s²) — a jitter figure. */
  spread: number;
  calibratedAt: number;
}

export const MIN_CALIBRATION_SAMPLES = 15;

/**
 * If the device moves more than this (m/s², mean absolute deviation per axis)
 * during the capture window the baseline is refused — the player was not
 * holding still and a neutral estimate would be wrong.
 */
export const MAX_BASELINE_SPREAD = 1.5;

function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return (((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

function meanAbsDev(values: readonly number[], center: number): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += Math.abs(v - center);
  return sum / values.length;
}

/**
 * Estimate the neutral orientation from a short capture window.
 *
 * Uses per-axis medians (robust to spikes), then rejects samples that deviate
 * from the median by more than `outlierSigma` scaled median absolute
 * deviations, and recomputes the median over the survivors. Returns null when
 * the window is too small or the device moved too much to be trusted.
 */
export function computeBaseline(
  samples: readonly MotionSample[],
  now: number,
  outlierSigma = 3,
): CalibrationBaseline | null {
  if (samples.length < MIN_CALIBRATION_SAMPLES) return null;

  const xs = samples.map((s) => s.acceleration.x);
  const ys = samples.map((s) => s.acceleration.y);
  const zs = samples.map((s) => s.acceleration.z);

  const mx = median(xs);
  const my = median(ys);
  const mz = median(zs);

  // Robust scale estimate: 1.4826 * MAD ≈ standard deviation for Gaussian noise.
  const scale = (axis: readonly number[], center: number) =>
    Math.max(1e-6, 1.4826 * meanAbsDev(axis, center));

  const sx = scale(xs, mx);
  const sy = scale(ys, my);
  const sz = scale(zs, mz);

  const kept: MotionSample[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] as MotionSample;
    const dx = Math.abs((s.acceleration.x - mx) / sx);
    const dy = Math.abs((s.acceleration.y - my) / sy);
    const dz = Math.abs((s.acceleration.z - mz) / sz);
    const deviation = Math.max(dx, dy, dz);
    if (deviation <= outlierSigma) kept.push(s);
  }

  // A window dominated by movement leaves too few quiet samples to trust.
  if (kept.length < MIN_CALIBRATION_SAMPLES) return null;

  const kx = kept.map((s) => s.acceleration.x);
  const ky = kept.map((s) => s.acceleration.y);
  const kz = kept.map((s) => s.acceleration.z);
  const gx = median(kx);
  const gy = median(ky);
  const gz = median(kz);

  const orientations = samples
    .map((s) => s.orientation)
    .filter((o): o is number => typeof o === 'number');

  const spread =
    (meanAbsDev(kx, gx) + meanAbsDev(ky, gy) + meanAbsDev(kz, gz)) / 3;

  // The device was clearly being moved: refuse rather than store a bad centre.
  if (!Number.isFinite(spread) || spread > MAX_BASELINE_SPREAD) return null;

  return {
    gravity: { x: gx, y: gy, z: gz },
    orientation: orientations.length > 0 ? median(orientations) : 0,
    samples: kept.length,
    spread,
    calibratedAt: now,
  };
}
