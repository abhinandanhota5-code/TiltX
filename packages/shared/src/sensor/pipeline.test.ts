import { describe, expect, it } from 'vitest';
import { CalibrationBaseline, MotionSample } from './calibration.js';
import { MotionPipeline, PipelineOptions } from './pipeline.js';

const GRAVITY = { x: 0, y: 0, z: 9.81 };

function baseline(): CalibrationBaseline {
  return {
    gravity: { ...GRAVITY },
    orientation: 0,
    samples: 40,
    spread: 0.05,
    calibratedAt: 0,
  };
}

function quiet(t: number): MotionSample {
  return { t, acceleration: { ...GRAVITY }, orientation: 0 };
}

/**
 * Synthetic accelerometer reading for a device rotated by `rollDeg`
 * (positive = left edge raised → x reading positive) and `pitchDeg`
 * (negative = top edge tipped forward → y reading negative).
 */
function tilted(t: number, rollDeg: number, pitchDeg = 0): MotionSample {
  const r = (rollDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  return {
    t,
    acceleration: {
      x: 9.81 * Math.sin(r),
      y: 9.81 * Math.sin(p),
      z: 9.81 * Math.cos(r) * Math.cos(p),
    },
    orientation: 0,
  };
}

function makePipeline(options: PipelineOptions = {}): MotionPipeline {
  const pipeline = new MotionPipeline(options);
  pipeline.setBaseline(baseline());
  return pipeline;
}

/** Run `n` identical samples so filters settle. */
function settle(
  pipeline: MotionPipeline,
  sample: MotionSample,
  n = 60,
  gyro?: { x: number; y: number; z: number },
): void {
  for (let i = 0; i < n; i++) {
    pipeline.push({ ...sample, t: sample.t + i * 16 }, gyro);
  }
}

describe('MotionPipeline — uncalibrated behaviour', () => {
  it('outputs neutral values until a baseline exists', () => {
    const pipeline = new MotionPipeline();
    expect(pipeline.calibrated).toBe(false);
    const control = pipeline.push(quiet(0));
    expect(control.steering).toBe(0);
    expect(control.throttle).toBe(0);
    expect(control.brake).toBe(0);
    expect(control.boost).toBe(false);
  });

  it('does not detect shakes before calibration', () => {
    const pipeline = new MotionPipeline();
    for (let i = 0; i < 30; i++) {
      const control = pipeline.push({
        t: i * 16,
        acceleration: { x: 40, y: 40, z: 40 },
        orientation: 0,
      });
      expect(control.boost).toBe(false);
    }
  });

  it('returns to neutral when the baseline is cleared', () => {
    const pipeline = makePipeline();
    settle(pipeline, tilted(0, 35));
    expect(pipeline.read().steering).not.toBe(0);
    pipeline.setBaseline(null);
    expect(pipeline.read().steering).toBe(0);
    expect(pipeline.read().throttle).toBe(0);
  });
});

describe('MotionPipeline — steering', () => {
  it('steers with the sign convention left = negative', () => {
    const pipeline = makePipeline({ deadzone: 0, smoothing: 0.2 });
    settle(pipeline, tilted(0, -35));
    expect(pipeline.read().steering).toBeGreaterThan(0.5);

    const pipeline2 = makePipeline({ deadzone: 0, smoothing: 0.2 });
    settle(pipeline2, tilted(0, 35));
    expect(pipeline2.read().steering).toBeLessThan(-0.5);
  });

  it('applies the dead zone around the calibrated centre', () => {
    const pipeline = makePipeline({ deadzone: 0.2, smoothing: 0 });
    settle(pipeline, tilted(0, 4)); // ~0.1 of the 40° range
    expect(pipeline.read().steering).toBe(0);
    settle(pipeline, tilted(1000, 36));
    expect(Math.abs(pipeline.read().steering)).toBeGreaterThan(0.5);
  });

  it('scales output with sensitivity', () => {
    const soft = makePipeline({ deadzone: 0, sensitivity: 0.5, smoothing: 0 });
    const hard = makePipeline({ deadzone: 0, sensitivity: 2, smoothing: 0 });
    settle(soft, tilted(0, 15));
    settle(hard, tilted(0, 15));
    expect(Math.abs(hard.read().steering)).toBeGreaterThan(Math.abs(soft.read().steering));
    expect(Math.abs(hard.read().steering)).toBeLessThanOrEqual(1);
  });

  it('clamps to [-1, 1] beyond the full-lock tilt', () => {
    const pipeline = makePipeline({ deadzone: 0, smoothing: 0 });
    settle(pipeline, tilted(0, 85));
    expect(pipeline.read().steering).toBeGreaterThanOrEqual(-1);
    expect(pipeline.read().steering).toBeLessThanOrEqual(1);
    expect(Math.abs(pipeline.read().steering)).toBeCloseTo(1, 1);
  });

  it('keeps a neutral baseline as neutral', () => {
    const pipeline = makePipeline({ deadzone: 0.1, smoothing: 0 });
    settle(pipeline, quiet(0));
    expect(pipeline.read().steering).toBe(0);
    expect(pipeline.read().throttle).toBe(0);
    expect(pipeline.read().brake).toBe(0);
  });
});

describe('MotionPipeline — throttle and brake', () => {
  it('accelerates when tilting forward and brakes when tilting back', () => {
    const fwd = makePipeline({ deadzone: 0.05, smoothing: 0 });
    settle(fwd, tilted(0, 0, -30));
    expect(fwd.read().throttle).toBeGreaterThan(0.7);
    expect(fwd.read().brake).toBe(0);

    const back = makePipeline({ deadzone: 0.05, smoothing: 0 });
    settle(back, tilted(0, 0, 30));
    expect(back.read().brake).toBeGreaterThan(0.7);
    expect(back.read().throttle).toBe(0);
  });

  it('never commands throttle and brake together', () => {
    const pipeline = makePipeline({ deadzone: 0, smoothing: 0 });
    for (const deg of [-40, -20, 0, 20, 40]) {
      settle(pipeline, tilted(0, 0, deg), 20);
      const { throttle, brake } = pipeline.read();
      expect(Math.min(throttle, brake)).toBe(0);
    }
  });
});

describe('MotionPipeline — shake boost', () => {
  it('fires boost on a sustained sharp movement, then cools down', () => {
    const pipeline = new MotionPipeline({
      shake: { threshold: 14, sustainMs: 80, cooldownMs: 1500 },
    });
    pipeline.setBaseline(baseline());

    let fired = 0;
    let t = 0;
    // Sharp oscillating movement: deviation far above 14 m/s².
    for (let i = 0; i < 40; i++) {
      const amplitude = i % 2 === 0 ? 35 : -35;
      const control = pipeline.push({
        t,
        acceleration: { x: amplitude, y: 0, z: 9.81 },
        orientation: 0,
      });
      if (control.boost) fired++;
      t += 16;
    }
    expect(fired).toBe(1);

    // Settle back to rest, then shake again inside the cooldown: blocked.
    for (let i = 0; i < 20; i++) pipeline.push(quiet(t), undefined), (t += 16);
    fired = 0;
    for (let i = 0; i < 40; i++) {
      const amplitude = i % 2 === 0 ? 35 : -35;
      const control = pipeline.push({
        t,
        acceleration: { x: amplitude, y: 0, z: 9.81 },
        orientation: 0,
      });
      if (control.boost) fired++;
      t += 16;
    }
    expect(fired).toBe(0);
  });

  it('does not fire on steady tilt or gentle handling', () => {
    const pipeline = makePipeline({ shake: { threshold: 14, sustainMs: 60 } });
    let fired = false;
    let t = 0;
    for (let i = 0; i < 100; i++) {
      const control = pipeline.push(tilted(t, i % 20), undefined);
      if (control.boost) fired = true;
      t += 16;
    }
    expect(fired).toBe(false);
  });

  it('reports deviation from gravity for diagnostics', () => {
    const pipeline = makePipeline();
    const control = pipeline.push(quiet(0));
    expect(control.deviation).toBeLessThan(0.5);
    const shaken = pipeline.push({ t: 16, acceleration: { x: 30, y: 0, z: 9.81 } });
    expect(shaken.deviation).toBeGreaterThan(20);
  });
});

describe('MotionPipeline — orientation awareness', () => {
  it('steers the same direction in landscape as in portrait', () => {
    // Portrait, left tilt: gravity reading moves onto +x (left edge raised).
    const portrait = makePipeline({ deadzone: 0, smoothing: 0 });
    settle(portrait, { t: 0, acceleration: { x: 6, y: 0, z: 7.6 }, orientation: 0 });
    const portraitSteer = portrait.read().steering;
    expect(portraitSteer).toBeLessThan(-0.5); // left tilt ⇒ left steer

    // Same physical action after rotating to landscape: the reading moves
    // onto −y and orientation reports 90.
    const landscape = makePipeline({ deadzone: 0, smoothing: 0 });
    settle(landscape, { t: 0, acceleration: { x: 0, y: -6, z: 7.6 }, orientation: 90 });
    const landscapeSteer = landscape.read().steering;
    expect(landscapeSteer).toBeLessThan(-0.5);
    expect(Math.sign(landscapeSteer)).toBe(Math.sign(portraitSteer));
  });

  it('keeps forward tilt mapped to throttle in landscape', () => {
    // Landscape: the visually upper edge is device +x; tipping it forward
    // (down) makes the x reading go negative ⇒ negative pitch ⇒ throttle.
    const landscape = makePipeline({ deadzone: 0.05, smoothing: 0 });
    settle(landscape, { t: 0, acceleration: { x: -6, y: 0, z: 7.6 }, orientation: 90 });
    expect(landscape.read().throttle).toBeGreaterThan(0.5);
    expect(landscape.read().brake).toBe(0);
  });

  it('stays neutral when the device is level in any orientation', () => {
    for (const orientation of [0, 90, 180, 270]) {
      const pipeline = makePipeline({ deadzone: 0.05, smoothing: 0 });
      settle(pipeline, { t: 0, acceleration: { x: 0, y: 0, z: 9.81 }, orientation });
      expect(pipeline.read().steering).toBe(0);
      expect(pipeline.read().throttle).toBe(0);
      expect(pipeline.read().brake).toBe(0);
    }
  });
});
