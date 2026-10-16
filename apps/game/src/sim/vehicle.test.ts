import { describe, expect, it } from 'vitest';
import { createDefaultTrack } from './track';
import { spawnVehicle, stepVehicle, VEHICLE } from './vehicle';

describe('vehicle', () => {
  it('spawns on centreline facing along track', () => {
    const track = createDefaultTrack();
    const v = spawnVehicle(track, track.length - 12);
    expect(v.lateral).toBeCloseTo(0, 1);
    expect(v.speed).toBe(0);
  });

  it('accelerates when throttle applied', () => {
    const track = createDefaultTrack();
    const v = spawnVehicle(track, 0);
    const res = stepVehicle(track, v, { steering: 0, throttle: 1, brake: 0 }, 0.1);
    expect(res.state.speed).toBeGreaterThan(0);
  });

  it('triggers boost on edge request', () => {
    const track = createDefaultTrack();
    const v = spawnVehicle(track, 0);
    const res = stepVehicle(track, v, { steering: 0, throttle: 1, brake: 0, boostRequest: true }, 0.05);
    expect(res.state.boostRemaining).toBeCloseTo(VEHICLE.boostDuration - 0.05, 2);
    expect(res.boosting).toBe(true);
  });
});
