import { describe, expect, it } from 'vitest';
import { createDefaultTrack } from './track';
import { createRace, stepRace } from './race';

const track = createDefaultTrack();

function step(race: ReturnType<typeof createRace>, n: number) {
  let r = race;
  for (let i = 0; i < n; i++) {
    r = stepRace(track, r, { steering: 0, throttle: 1, brake: 0, dtMs: 16 });
  }
  return r;
}

describe('race', () => {
  it('starts the race after the first forward crossing', () => {
    const r = createRace(track);
    expect(r.started).toBe(false);
    const after = step(r, 120);
    expect(after.started).toBe(true);
    expect(after.laps).toBe(0);
    expect(after.currentLapMs).toBeGreaterThan(0);
  });

  it('never completes a lap without driving a full loop', () => {
    const r = step(createRace(track), 300);
    expect(r.laps).toBe(0);
  });
});
