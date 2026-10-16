import { CalibrationBaseline, MotionSample, Vec3 } from './calibration.js';
import { ComplementaryFilter, ExponentialSmoother } from './filters.js';
import { applyDeadzone, applySensitivity, orientTilt, pitchToThrottleBrake, TiltAxes } from './mapping.js';
import { ShakeDetector, ShakeDetectorOptions } from './shake.js';

export interface PipelineOptions {
  /** Dead zone as a fraction of the tilt range (0 – 0.4). */
  deadzone?: number;
  /** Steering/throttle gain (0.25 – 3). */
  sensitivity?: number;
  /** 0 – 0.95; higher = smoother, slightly laggier. */
  smoothing?: number;
  /** Flip forward/backward pitch mapping. */
  invertPitch?: boolean;
  /** Full-lock tilt in degrees: reaching it (relative to baseline) = steering 1. */
  steerRangeDeg?: number;
  /** Full throttle tilt in degrees. */
  pitchRangeDeg?: number;
  shake?: ShakeDetectorOptions;
}

export interface NormalizedControl {
  /** -1 (full left) … +1 (full right) */
  steering: number;
  /** 0 … 1 */
  throttle: number;
  /** 0 … 1 */
  brake: number;
  /** True only for the sample window in which a shake gesture completed. */
  boost: boolean;
  /** Current fused orientation estimate relative to baseline, degrees. */
  tilt: TiltAxes;
  /** |acceleration − gravity| in m/s² — the shake classifier input. */
  deviation: number;
}

const DEFAULTS = {
  deadzone: 0.08,
  sensitivity: 1,
  smoothing: 0.35,
  steerRangeDeg: 40,
  pitchRangeDeg: 35,
};

function norm3(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Turns raw device motion into normalized game controls.
 *
 * Pipeline: baseline subtraction → orientation-aware axis selection →
 * complementary filter (accelerometer angle + gyro rate) → dead zone →
 * sensitivity → EMA smoothing. Shake detection runs on the raw deviation from
 * the calibrated gravity vector, with its own threshold/cooldown.
 *
 * Until a baseline is set every output is neutral — no fake readings.
 */
export class MotionPipeline {
  private baseline: CalibrationBaseline | null = null;

  private readonly steerFilter: ExponentialSmoother;
  private readonly pitchFilter: ExponentialSmoother;
  private readonly lateralFilter: ComplementaryFilter;
  private readonly pitchAngleFilter: ComplementaryFilter;
  private readonly shake: ShakeDetector;

  private opts: Required<Omit<PipelineOptions, 'shake'>>;
  private lastSampleTime: number | null = null;
  private usingGyro = false;
  private lastTilt: TiltAxes = { lateral: 0, pitch: 0 };
  private lastControl: NormalizedControl = {
    steering: 0,
    throttle: 0,
    brake: 0,
    boost: false,
    tilt: { lateral: 0, pitch: 0 },
    deviation: 0,
  };

  constructor(options: PipelineOptions = {}) {
    this.opts = {
      deadzone: options.deadzone ?? DEFAULTS.deadzone,
      sensitivity: options.sensitivity ?? DEFAULTS.sensitivity,
      smoothing: options.smoothing ?? DEFAULTS.smoothing,
      invertPitch: options.invertPitch ?? false,
      steerRangeDeg: options.steerRangeDeg ?? DEFAULTS.steerRangeDeg,
      pitchRangeDeg: options.pitchRangeDeg ?? DEFAULTS.pitchRangeDeg,
    };
    this.steerFilter = new ExponentialSmoother(this.opts.smoothing);
    this.pitchFilter = new ExponentialSmoother(this.opts.smoothing);
    this.lateralFilter = new ComplementaryFilter(0.985);
    this.pitchAngleFilter = new ComplementaryFilter(0.985);
    this.shake = new ShakeDetector(options.shake);
  }

  get calibrated(): boolean {
    return this.baseline !== null;
  }

  setOptions(options: PipelineOptions): void {
    this.opts.deadzone = options.deadzone ?? this.opts.deadzone;
    this.opts.sensitivity = options.sensitivity ?? this.opts.sensitivity;
    this.opts.smoothing = options.smoothing ?? this.opts.smoothing;
    this.opts.invertPitch = options.invertPitch ?? this.opts.invertPitch;
    const smoothingChanged = (options.smoothing ?? this.opts.smoothing) !== this.opts.smoothing;
    if (smoothingChanged) {
      this.steerFilter.reset();
      this.pitchFilter.reset();
    }
  }

  setBaseline(baseline: CalibrationBaseline | null): void {
    this.baseline = baseline;
    this.lastSampleTime = null;
    this.usingGyro = false;
    this.lateralFilter.reset();
    this.pitchAngleFilter.reset();
    this.steerFilter.reset();
    this.pitchFilter.reset();
    this.shake.reset();
    this.lastTilt = { lateral: 0, pitch: 0 };
    this.lastControl = {
      steering: 0,
      throttle: 0,
      brake: 0,
      boost: false,
      tilt: { lateral: 0, pitch: 0 },
      deviation: 0,
    };
  }

  getBaseline(): CalibrationBaseline | null {
    return this.baseline;
  }

  /** Re-arm the shake detector (e.g. when the player re-centers). */
  resetGestureState(): void {
    this.shake.reset();
  }

  /** Milliseconds until a shake can trigger boost again (0 when ready). */
  shakeCooldownRemaining(now: number): number {
    return this.shake.cooldownRemaining(now);
  }

  /**
   * Feed one raw sample; returns the control state for this sample.
   * Safe to call at the device's native rate — all outputs are bounded.
   */
  push(sample: MotionSample, gyro?: Vec3): NormalizedControl {
    const now = sample.t;
    const dt = this.lastSampleTime === null ? 16 : now - this.lastSampleTime;
    this.lastSampleTime = now;

    const deviation = this.baseline
      ? norm3(sub(sample.acceleration, this.baseline.gravity))
      : norm3(sample.acceleration);

    const boost = this.baseline !== null && this.shake.update(deviation, now);

    if (!this.baseline) {
      const neutral: NormalizedControl = {
        steering: 0,
        throttle: 0,
        brake: 0,
        boost: false,
        tilt: { lateral: 0, pitch: 0 },
        deviation,
      };
      this.lastControl = neutral;
      return neutral;
    }

    // Angle of the gravity vector relative to the device frame (deg).
    const accelLateral = (Math.atan2(sample.acceleration.x, sample.acceleration.z) * 180) / Math.PI;
    const accelPitch = (Math.atan2(sample.acceleration.y, sample.acceleration.z) * 180) / Math.PI;

    const baseLateral =
      (Math.atan2(this.baseline.gravity.x, this.baseline.gravity.z) * 180) / Math.PI;
    const basePitch =
      (Math.atan2(this.baseline.gravity.y, this.baseline.gravity.z) * 180) / Math.PI;

    // Fuse gyroscope rate with the accelerometer when the device provides a
    // rotation rate (fast response, no long-term drift). Without a gyro the
    // accelerometer angle is used directly so input stays responsive.
    const hasGyro =
      gyro !== undefined &&
      Number.isFinite(gyro.x) &&
      Number.isFinite(gyro.y) &&
      Number.isFinite(gyro.z);
    if (hasGyro !== this.usingGyro) {
      this.lateralFilter.reset();
      this.pitchAngleFilter.reset();
      this.usingGyro = hasGyro;
    }

    let rawLateral: number;
    let rawPitch: number;
    if (hasGyro && gyro) {
      rawLateral = this.lateralFilter.update(gyro.z, accelLateral, dt) - baseLateral;
      rawPitch = this.pitchAngleFilter.update(gyro.y, accelPitch, dt) - basePitch;
    } else {
      rawLateral = accelLateral - baseLateral;
      rawPitch = accelPitch - basePitch;
    }

    const orientation = sample.orientation ?? this.baseline.orientation;
    const axes = orientTilt(rawPitch, rawLateral, orientation);
    this.lastTilt = axes;

    // axes.lateral > 0 means the device's left edge is down; positive
    // steering turns the car right, so the command is negated here.
    const steerNorm = applySensitivity(
      applyDeadzone(-clamp(axes.lateral / this.opts.steerRangeDeg, -1, 1), this.opts.deadzone),
      this.opts.sensitivity,
    );
    const pitchNorm = clamp(axes.pitch / this.opts.pitchRangeDeg, -1, 1);

    const steering = this.steerFilter.push(steerNorm, dt);
    // Throttle and brake are derived from ONE smoothed pitch command so they
    // can never be requested at the same time.
    const pitchCommand = this.pitchFilter.push(pitchNorm, dt);
    const { throttle, brake } = pitchToThrottleBrake(pitchCommand, {
      deadzone: this.opts.deadzone,
      sensitivity: this.opts.sensitivity,
      invert: this.opts.invertPitch,
    });

    const control: NormalizedControl = {
      steering: clamp(steering, -1, 1),
      throttle: clamp(throttle, 0, 1),
      brake: clamp(brake, 0, 1),
      boost,
      tilt: axes,
      deviation,
    };
    this.lastControl = control;
    return control;
  }

  read(): NormalizedControl {
    return this.lastControl;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
