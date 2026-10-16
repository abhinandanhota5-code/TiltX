import { describe, expect, it } from 'vitest';
import { ShakeDetector } from './shake.js';

describe('ShakeDetector', () => {
  it('fires once after the deviation is sustained', () => {
    const det = new ShakeDetector({ threshold: 14, sustainMs: 90, cooldownMs: 1000 });
    let t = 0;
    let fired = 0;
    // Below threshold: nothing happens.
    for (let i = 0; i < 10; i++) {
      if (det.update(5, t)) fired++;
      t += 16;
    }
    expect(fired).toBe(0);

    // Sustained above threshold for < sustainMs: still nothing.
    for (let i = 0; i < 4; i++) {
      if (det.update(30, t)) fired++;
      t += 16;
    }
    expect(fired).toBe(0);

    // Keep holding past the sustain window.
    for (let i = 0; i < 8; i++) {
      if (det.update(30, t)) fired++;
      t += 16;
    }
    expect(fired).toBe(1);
  });

  it('does not fire on a momentary spike', () => {
    const det = new ShakeDetector({ threshold: 14, sustainMs: 100, cooldownMs: 500 });
    expect(det.update(40, 0)).toBe(false);
    expect(det.update(4, 16)).toBe(false);
    expect(det.update(40, 32)).toBe(false);
    // Never held long enough.
    let fired = false;
    for (let i = 0; i < 5; i++) fired = fired || det.update(40, 40 + i * 10);
    expect(fired).toBe(false);
  });

  it('enforces the cooldown between activations', () => {
    const det = new ShakeDetector({ threshold: 14, sustainMs: 50, cooldownMs: 2000 });
    let t = 0;
    let fired = 0;
    for (let i = 0; i < 20; i++) {
      if (det.update(30, t)) fired++;
      t += 16;
    }
    expect(fired).toBe(1);

    // Release so the detector re-arms, then shake again inside the cooldown.
    t = 500;
    for (let i = 0; i < 10; i++) det.update(1, t + i * 16);
    t = 600;
    fired = 0;
    for (let i = 0; i < 20; i++) {
      if (det.update(30, t)) fired++;
      t += 16;
    }
    expect(fired).toBe(0);
    expect(det.cooldownRemaining(700)).toBeGreaterThan(0);

    // After the cooldown expires it may fire again.
    t = 3000;
    for (let i = 0; i < 10; i++) det.update(1, t + i * 16);
    t = 3100;
    fired = 0;
    for (let i = 0; i < 20; i++) {
      if (det.update(30, t)) fired++;
      t += 16;
    }
    expect(fired).toBe(1);
    expect(det.cooldownRemaining(3200)).toBeGreaterThan(0);
  });

  it('requires a release below the re-arm level before firing again', () => {
    const det = new ShakeDetector({ threshold: 14, sustainMs: 30, cooldownMs: 0 });
    let fired = 0;
    let t = 0;
    for (let i = 0; i < 10; i++) {
      if (det.update(30, t)) fired++;
      t += 16;
    }
    expect(fired).toBe(1);
    // Still elevated: must not fire again despite zero cooldown.
    for (let i = 0; i < 30; i++) {
      if (det.update(30, t)) fired++;
      t += 16;
    }
    expect(fired).toBe(1);
    // Drop below release level, then shake again.
    det.update(1, t);
    for (let i = 0; i < 10; i++) {
      if (det.update(30, t + i * 16)) fired++;
    }
    expect(fired).toBe(2);
  });

  it('ignores non-finite magnitudes', () => {
    const det = new ShakeDetector();
    expect(det.update(Number.NaN, 0)).toBe(false);
    expect(det.update(Number.POSITIVE_INFINITY, 0)).toBe(false);
  });

  it('ignores ordinary handling motion (below threshold)', () => {
    const det = new ShakeDetector({ threshold: 14, sustainMs: 90, cooldownMs: 2000 });
    let fired = 0;
    let t = 0;
    // Typical walking/handling noise stays under ~10 m/s² deviation.
    for (let i = 0; i < 300; i++) {
      const magnitude = 3 + ((i * 37) % 70) / 10; // 3 … 10
      if (det.update(magnitude, t)) fired++;
      t += 16;
    }
    expect(fired).toBe(0);
  });
});
