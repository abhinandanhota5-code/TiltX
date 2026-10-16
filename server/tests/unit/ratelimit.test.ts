import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../../src/ratelimit.js';

/** Deterministic fake clock so rate-limit tests are reproducible. */
class FakeClock {
  constructor(public now: number = 0) {}
  read = (): number => this.now;
  advance(ms: number): void {
    this.now += ms;
  }
}

describe('TokenBucket', () => {
  it('allows a burst up to the bucket size', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(10, 5, clock.read);
    const results = Array.from({ length: 5 }, () => bucket.tryConsume());
    expect(results.every(Boolean)).toBe(true);
  });

  it('rejects once the burst is exhausted', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(10, 5, clock.read);
    for (let i = 0; i < 5; i++) bucket.tryConsume();
    expect(bucket.tryConsume()).toBe(false);
  });

  it('refills at the configured rate', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(10, 5, clock.read);
    for (let i = 0; i < 5; i++) bucket.tryConsume();
    clock.advance(200); // 2 tokens at 10/s
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it('never exceeds the burst capacity', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(10, 5, clock.read);
    clock.advance(100_000);
    for (let i = 0; i < 5; i++) expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it('accepts a steady stream at the configured rate', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(90, 90, clock.read);
    let accepted = 0;
    for (let i = 0; i < 90; i++) {
      if (bucket.tryConsume()) accepted++;
      clock.advance(1000 / 90);
    }
    expect(accepted).toBe(90);
  });

  it('caps a burst flood at the bucket size', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(90, 90, clock.read);
    let accepted = 0;
    for (let i = 0; i < 1000; i++) if (bucket.tryConsume()) accepted++;
    expect(accepted).toBe(90);
  });
});
