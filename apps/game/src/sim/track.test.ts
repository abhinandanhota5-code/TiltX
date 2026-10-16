import { describe, expect, it } from 'vitest';
import { createDefaultTrack, projectToTrack, sampleLoop } from './track';

describe('track', () => {
  it('creates a closed loop with positive length', () => {
    const track = createDefaultTrack();
    expect(track.length).toBeGreaterThan(200);
    expect(track.points.length).toBe(240);
    expect(track.segments.length).toBe(240);
  });

  it('projects a point near centreline', () => {
    const track = createDefaultTrack();
    const p = { x: 0, z: -40 };
    const proj = projectToTrack(track, p);
    expect(proj.lateral).toBeCloseTo(0, 1);
  });

  it('sampleLoop closes the loop (last+step == first)', () => {
    const loop = sampleLoop(
      [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 10, z: 10 },
        { x: 0, z: 10 },
      ],
      21,
    );
    expect(loop.length).toBe(21);
    const first = loop[0];
    const last = loop[loop.length - 1];
    const closing = Math.hypot(first.x - last.x, first.z - last.z);
    const typical = Math.hypot(loop[1].x - loop[0].x, loop[1].z - loop[0].z);
    // The closing segment (last -> first) must be a normal step, not a jump,
    // which is what makes the sampled polygon a continuous closed loop.
    expect(closing).toBeGreaterThan(0);
    expect(closing).toBeLessThan(typical * 3);
  });
});
