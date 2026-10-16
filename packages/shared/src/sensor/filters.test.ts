import { describe, expect, it } from 'vitest';
import { ComplementaryFilter, ExponentialSmoother } from './filters.js';

describe('ExponentialSmoother', () => {
  it('passes the first sample through unchanged', () => {
    const s = new ExponentialSmoother(0.5);
    expect(s.push(10, 16)).toBe(10);
    expect(s.settled).toBe(true);
  });

  it('converges toward a constant input', () => {
    const s = new ExponentialSmoother(0.5);
    s.push(0, 16);
    let value = 0;
    for (let i = 0; i < 200; i++) value = s.push(1, 16);
    expect(value).toBeCloseTo(1, 2);
  });

  it('reduces jitter relative to the raw signal', () => {
    const s = new ExponentialSmoother(0.6);
    s.push(0, 16);
    const outputs: number[] = [];
    for (let i = 0; i < 60; i++) outputs.push(s.push(i % 2 === 0 ? 1 : -1, 16));
    const variance = outputs.reduce((acc, v) => acc + (v - outputs[0]!) ** 2, 0) / outputs.length;
    expect(variance).toBeLessThan(0.35);
  });

  it('is independent of update rate for the same wall time', () => {
    const a = new ExponentialSmoother(0.5);
    const b = new ExponentialSmoother(0.5);
    a.push(0, 16);
    b.push(0, 16);
    for (let i = 0; i < 50; i++) a.push(1, 16); // 800ms
    for (let i = 0; i < 100; i++) b.push(1, 8); // 800ms
    expect(a.read()).toBeCloseTo(b.read(), 1);
  });

  it('handles non-finite dt defensively', () => {
    const s = new ExponentialSmoother(0.3);
    s.push(5, Number.NaN);
    expect(Number.isFinite(s.read())).toBe(true);
  });

  it('reset returns it to the unset state', () => {
    const s = new ExponentialSmoother(0.3);
    s.push(4, 16);
    s.reset();
    expect(s.settled).toBe(false);
    expect(s.push(9, 16)).toBe(9);
  });
});

describe('ComplementaryFilter', () => {
  it('initializes from the accelerometer angle', () => {
    const f = new ComplementaryFilter();
    expect(f.update(0, 12, 16)).toBe(12);
  });

  it('follows the gyro for fast changes', () => {
    const f = new ComplementaryFilter(0.98);
    f.update(0, 0, 16);
    // 100 deg/s for 100ms without any accelerometer correction signal.
    let angle = 0;
    for (let i = 0; i < 6; i++) angle = f.update(100, 0, 16);
    expect(angle).toBeGreaterThan(5);
  });

  it('pulls back toward the accelerometer reference (gyro drift correction)', () => {
    const f = new ComplementaryFilter(0.9);
    f.update(0, 0, 16);
    // Inject a wrong gyro rate: the accel reference must win eventually.
    let angle = 0;
    for (let i = 0; i < 500; i++) angle = f.update(5, 0, 16);
    expect(Math.abs(angle)).toBeLessThan(2);
  });

  it('stays bounded with hostile inputs', () => {
    const f = new ComplementaryFilter();
    f.update(0, 0, 16);
    let angle = 0;
    for (let i = 0; i < 200; i++) angle = f.update(i % 2 ? 1e6 : -1e6, 0, 16);
    expect(Math.abs(angle)).toBeLessThan(1e6);
    expect(Number.isFinite(angle)).toBe(true);
  });
});
