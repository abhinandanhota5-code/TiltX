import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  applySensitivity,
  lateralTiltToSteering,
  mapSteering,
  normalizeOrientation,
  orientTilt,
  pitchToThrottleBrake,
} from './mapping.js';

describe('applyDeadzone', () => {
  it('zeroes input inside the dead zone', () => {
    expect(applyDeadzone(0.05, 0.1)).toBe(0);
    expect(applyDeadzone(-0.05, 0.1)).toBe(0);
    expect(applyDeadzone(0.1, 0.1)).toBe(0);
  });

  it('rescales so the output still reaches full range', () => {
    expect(applyDeadzone(1, 0.1)).toBeCloseTo(1, 6);
    expect(applyDeadzone(-1, 0.1)).toBeCloseTo(-1, 6);
    expect(applyDeadzone(0.55, 0.1)).toBeCloseTo(0.5, 6);
    expect(applyDeadzone(-0.55, 0.1)).toBeCloseTo(-0.5, 6);
  });

  it('is monotonic outside the dead zone', () => {
    let previous = -1;
    for (let v = -1; v <= 1.0001; v += 0.05) {
      const out = applyDeadzone(v, 0.15);
      expect(out).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = out;
    }
  });

  it('clamps absurd dead zones to a sane maximum', () => {
    expect(applyDeadzone(0.5, 5)).toBe(0);
    expect(applyDeadzone(1, 5)).toBeCloseTo(1, 6);
    expect(applyDeadzone(0.95, 5)).toBeGreaterThan(0.4);
  });
});

describe('applySensitivity / mapSteering', () => {
  it('amplifies and clamps', () => {
    expect(applySensitivity(0.5, 2)).toBe(1);
    expect(applySensitivity(0.5, 0.5)).toBeCloseTo(0.25, 6);
    expect(applySensitivity(2, 1)).toBe(1);
  });

  it('composes dead zone then sensitivity', () => {
    expect(mapSteering(0.05, { deadzone: 0.1, sensitivity: 1 })).toBe(0);
    expect(mapSteering(0.55, { deadzone: 0.1, sensitivity: 2 })).toBe(1);
  });

  it('left tilt produces left steering (negative)', () => {
    expect(lateralTiltToSteering(-0.8, { deadzone: 0, sensitivity: 1 })).toBeCloseTo(0.8, 6);
    expect(lateralTiltToSteering(0.8, { deadzone: 0, sensitivity: 1 })).toBeCloseTo(-0.8, 6);
  });
});

describe('pitchToThrottleBrake', () => {
  const opts = { deadzone: 0.1, sensitivity: 1 };

  it('is neutral inside the dead zone', () => {
    expect(pitchToThrottleBrake(0.05, opts)).toEqual({ throttle: 0, brake: 0 });
    expect(pitchToThrottleBrake(-0.05, opts)).toEqual({ throttle: 0, brake: 0 });
  });

  it('negative pitch accelerates, positive pitch brakes', () => {
    const accel = pitchToThrottleBrake(-0.55, opts);
    expect(accel.throttle).toBeCloseTo(0.5, 6);
    expect(accel.brake).toBe(0);
    const brake = pitchToThrottleBrake(0.55, opts);
    expect(brake.throttle).toBe(0);
    expect(brake.brake).toBeCloseTo(0.5, 6);
  });

  it('never produces overlapping throttle and brake', () => {
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      const { throttle, brake } = pitchToThrottleBrake(v, opts);
      expect(Math.min(throttle, brake)).toBe(0);
    }
  });

  it('supports inverting the mapping', () => {
    const inverted = pitchToThrottleBrake(-0.55, { ...opts, invert: true });
    expect(inverted.throttle).toBe(0);
    expect(inverted.brake).toBeGreaterThan(0);
  });

  it('clamps to [0, 1]', () => {
    expect(pitchToThrottleBrake(-10, { deadzone: 0, sensitivity: 3 }).throttle).toBe(1);
  });
});

describe('orientTilt', () => {
  it('passes through portrait (0°)', () => {
    expect(orientTilt(-20, 30, 0)).toEqual({ lateral: 30, pitch: -20 });
  });

  it('rotates axes in landscape-left (90°)', () => {
    const axes = orientTilt(-20, 30, 90);
    expect(axes.lateral).toBe(20);
    expect(axes.pitch).toBe(30);
  });

  it('rotates axes upside-down (180°)', () => {
    const axes = orientTilt(-20, 30, 180);
    expect(axes.lateral).toBe(-30);
    expect(axes.pitch).toBe(20);
  });

  it('rotates axes in landscape-right (270°)', () => {
    const axes = orientTilt(-20, 30, 270);
    expect(axes.lateral).toBe(-20);
    expect(axes.pitch).toBe(-30);
  });

  it('keeps steering magnitude stable across orientations', () => {
    const portrait = orientTilt(10, 40, 0);
    const landscape = orientTilt(40, -10, 90);
    expect(Math.abs(portrait.lateral)).toBe(Math.abs(landscape.lateral));
  });

  it('normalizes odd orientation values', () => {
    expect(normalizeOrientation(-90)).toBe(270);
    expect(normalizeOrientation(450)).toBe(90);
    expect(normalizeOrientation(Number.NaN)).toBe(0);
    expect(orientTilt(1, 2, 450).lateral).toBe(orientTilt(1, 2, 90).lateral);
  });
});
