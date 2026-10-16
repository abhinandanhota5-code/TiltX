/**
 * Pure mapping helpers: dead zone, sensitivity, and orientation-aware axis
 * selection. All functions are deterministic and unit-tested.
 */

export interface SteerOptions {
  /** Fraction of output range that maps to zero (0 – 0.4). */
  deadzone: number;
  /** Gain applied after the dead zone (0.25 – 3). */
  sensitivity: number;
}

export const DEFAULT_STEER_OPTIONS: SteerOptions = { deadzone: 0.08, sensitivity: 1 };

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Remove a dead zone around zero and rescale so output still reaches ±1.
 *
 *   applyDeadzone(0.04, 0.1)  → 0
 *   applyDeadzone(0.1, 0.1)   → 0
 *   applyDeadzone(0.55, 0.1)  → 0.5
 */
export function applyDeadzone(value: number, deadzone: number): number {
  const dz = clamp(Math.abs(deadzone), 0, 0.9);
  const v = clamp(value, -1, 1);
  const sign = v < 0 ? -1 : 1;
  const mag = Math.abs(v);
  if (mag <= dz) return 0;
  return sign * ((mag - dz) / (1 - dz));
}

/** Apply gain and clamp back into [-1, 1]. */
export function applySensitivity(value: number, sensitivity: number): number {
  const gain = clamp(sensitivity, 0.25, 3);
  return clamp(value * gain, -1, 1);
}

/** Dead zone → sensitivity → clamp, the canonical steering transform. */
export function mapSteering(raw: number, opts: SteerOptions = DEFAULT_STEER_OPTIONS): number {
  return applySensitivity(applyDeadzone(raw, opts.deadzone), opts.sensitivity);
}

/**
 * Map a normalized lateral tilt to steering.
 *
 * Convention: positive `lateral` means the LEFT edge of the device is down
 * (computed from the accelerometer, x axis positive when the left edge is
 * raised). Positive steering turns the car right — the view from behind the
 * vehicle — so a left tilt yields a negative steering value.
 */
export function lateralTiltToSteering(
  lateral: number,
  opts: SteerOptions = DEFAULT_STEER_OPTIONS,
): number {
  return -mapSteering(clamp(lateral, -1, 1), opts);
}

export interface PitchOptions {
  /** Tilt (normalized) that must be exceeded before anything happens. */
  deadzone: number;
  /** Gain applied to the pitch command (0.25 – 3). */
  sensitivity: number;
  /** Flip forward/backward mapping for players who hold the phone differently. */
  invert?: boolean;
}

export interface ThrottleBrake {
  throttle: number;
  brake: number;
}

/**
 * Map a normalized forward/backward tilt to throttle and brake.
 * Negative delta (top of the phone tipping forward) accelerates, positive
 * delta (tipping back) brakes. The two never overlap.
 */
export function pitchToThrottleBrake(
  delta: number,
  opts: PitchOptions = { deadzone: 0.1, sensitivity: 1 },
): ThrottleBrake {
  const d = clamp(opts.invert ? -delta : delta, -1, 1);
  const dz = clamp(Math.abs(opts.deadzone), 0, 0.8);
  const gain = clamp(opts.sensitivity, 0.25, 3);
  if (Math.abs(d) <= dz) return { throttle: 0, brake: 0 };
  const mag = clamp(((Math.abs(d) - dz) / (1 - dz)) * gain, 0, 1);
  return d < 0 ? { throttle: mag, brake: 0 } : { throttle: 0, brake: mag };
}

export interface TiltAxes {
  /** Lateral tilt: negative = left. */
  lateral: number;
  /** Forward/backward tilt: negative = forward. */
  pitch: number;
}

/**
 * Rotate the raw tilt axes according to the current screen orientation so
 * steering stays "left is left" in portrait and both landscapes.
 *
 * `beta` is front/back tilt, `gamma` is left/right tilt (W3C convention).
 * Orientation is 0 (portrait), 90 (landscape-left) or 270 (landscape-right).
 */
export function orientTilt(beta: number, gamma: number, orientationDeg: number): TiltAxes {
  const o = ((Math.round(orientationDeg / 90) * 90) % 360 + 360) % 360;
  switch (o) {
    case 90:
      // Rotated 90° counter-clockwise: the device's +x axis points up and
      // +y points left, so lateral tilt is read off beta and pitch off gamma.
      return { lateral: -beta, pitch: gamma };
    case 180:
      return { lateral: -gamma, pitch: -beta };
    case 270:
      return { lateral: beta, pitch: -gamma };
    default:
      return { lateral: gamma, pitch: beta };
  }
}

/** Normalize an orientation angle into [0, 360). */
export function normalizeOrientation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}
