import { describe, expect, it } from 'vitest';
import { computeBaseline, MIN_CALIBRATION_SAMPLES, MotionSample } from './calibration.js';

function sample(t: number, x: number, y: number, z: number, orientation = 0): MotionSample {
  return { t, acceleration: { x, y, z }, orientation };
}

/** Deterministic pseudo-random noise (mulberry32). */
function noise(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

describe('computeBaseline', () => {
  it('estimates the median gravity vector from quiet samples', () => {
    const rnd = noise(42);
    const samples: MotionSample[] = [];
    for (let i = 0; i < 40; i++) {
      samples.push(sample(i * 16, rnd() * 0.2, rnd() * 0.2, 9.81 + rnd() * 0.2, 0));
    }
    const baseline = computeBaseline(samples, 1000);
    expect(baseline).not.toBeNull();
    expect(baseline!.gravity.z).toBeCloseTo(9.81, 1);
    expect(Math.abs(baseline!.gravity.x)).toBeLessThan(0.2);
    expect(baseline!.samples).toBeGreaterThanOrEqual(MIN_CALIBRATION_SAMPLES);
    expect(baseline!.spread).toBeLessThan(0.5);
    expect(baseline!.calibratedAt).toBe(1000);
  });

  it('rejects obvious movement outliers', () => {
    const rnd = noise(7);
    const samples: MotionSample[] = [];
    for (let i = 0; i < 40; i++) {
      samples.push(sample(i * 16, rnd() * 0.1, rnd() * 0.1, 9.81 + rnd() * 0.1, 0));
    }
    // Spikes from someone tapping/waving the device.
    for (let i = 0; i < 6; i++) {
      samples.push(sample(1000 + i, 25 + i, -18, 3, 0));
    }
    const baseline = computeBaseline(samples, 5000);
    expect(baseline).not.toBeNull();
    expect(baseline!.gravity.z).toBeCloseTo(9.81, 1);
    expect(baseline!.samples).toBeLessThan(samples.length);
  });

  it('returns null when there are too few samples', () => {
    const samples = Array.from({ length: MIN_CALIBRATION_SAMPLES - 1 }, (_, i) =>
      sample(i, 0, 0, 9.81),
    );
    expect(computeBaseline(samples, 0)).toBeNull();
  });

  it('returns null when the device never settled', () => {
    const samples: MotionSample[] = [];
    for (let i = 0; i < 30; i++) {
      samples.push(sample(i * 16, i * 1.7, -i * 1.3, 9.81 + i, 0));
    }
    expect(computeBaseline(samples, 0)).toBeNull();
  });

  it('records the median orientation', () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample(i, 0, 0, 9.81, i < 16 ? 90 : 91));
    const baseline = computeBaseline(samples, 0);
    expect(baseline).not.toBeNull();
    expect(baseline!.orientation).toBe(90);
  });

  it('is deterministic for a fixed input', () => {
    const rnd = noise(3);
    const samples = Array.from({ length: 30 }, (_, i) =>
      sample(i, rnd() * 0.1, rnd() * 0.1, 9.81 + rnd() * 0.1),
    );
    const a = computeBaseline(samples, 1);
    const b = computeBaseline(samples, 1);
    expect(a).toEqual(b);
  });
});
