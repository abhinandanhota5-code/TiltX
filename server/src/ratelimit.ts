/** Simple token-bucket limiter used for input streaming and join attempts. */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.lastRefill = now();
  }

  tryConsume(cost = 1): boolean {
    const nowMs = this.now();
    const elapsed = Math.max(0, nowMs - this.lastRefill);
    this.lastRefill = nowMs;
    this.tokens = Math.min(this.burst, this.tokens + (elapsed / 1000) * this.ratePerSec);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  reset(): void {
    this.tokens = this.burst;
    this.lastRefill = this.now();
  }
}
