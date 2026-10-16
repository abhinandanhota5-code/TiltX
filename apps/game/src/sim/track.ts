/**
 * Track geometry and the pure maths the simulation needs.
 *
 * The centreline is a closed Catmull-Rom spline through a handful of control
 * points, sampled once into a dense polyline. The renderer and the physics read
 * the same polyline, so what you see is exactly what you drive on.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export interface TrackSegment {
  /** Start point of the segment. */
  a: Vec2;
  /** End point of the segment. */
  b: Vec2;
  /** Unit tangent (direction of travel). */
  tangent: Vec2;
  /** Unit left-normal (perpendicular to tangent). */
  normal: Vec2;
  /** Segment length in metres. */
  length: number;
  /** Cumulative distance from the start of the lap to `a`. */
  startDistance: number;
}

export interface Track {
  points: Vec2[];
  segments: TrackSegment[];
  /** Total centreline length in metres. */
  length: number;
  /** Half the drivable width, metres. */
  halfWidth: number;
}

export interface TrackProjection {
  /** Segment index of the closest point. */
  index: number;
  /** Distance along the centreline of the closest point. */
  distance: number;
  /** Signed lateral offset (positive = left of travel). */
  lateral: number;
  /** Unit tangent at the closest point. */
  tangent: Vec2;
  /** Unit left-normal at the closest point. */
  normal: Vec2;
  /** Closest point on the centreline. */
  point: Vec2;
}

const DEFAULT_HALF_WIDTH = 9;

export function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const z =
    0.5 *
    (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
  return { x, z };
}

function normalize(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.z);
  if (length === 0) return { x: 0, z: 0 };
  return { x: v.x / length, z: v.z / length };
}

/** Samples a closed Catmull-Rom spline through `control` into `count` points. */
export function sampleLoop(control: Vec2[], count: number): Vec2[] {
  if (control.length < 3) throw new Error('a track needs at least three control points');
  const points: Vec2[] = [];
  const n = control.length;
  for (let i = 0; i < count; i++) {
    const u = (i / count) * n;
    const seg = Math.floor(u);
    const t = u - seg;
    const p0 = control[(seg - 1 + n) % n];
    const p1 = control[seg % n];
    const p2 = control[(seg + 1) % n];
    const p3 = control[(seg + 2) % n];
    points.push(catmullRom(p0, p1, p2, p3, t));
  }
  return points;
}

export function createTrack(points: Vec2[], halfWidth = DEFAULT_HALF_WIDTH): Track {
  if (points.length < 3) throw new Error('a track needs at least three points');
  const segments: TrackSegment[] = [];
  let distance = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const delta = { x: b.x - a.x, z: b.z - a.z };
    const length = Math.hypot(delta.x, delta.z);
    const tangent = normalize(delta);
    // Left-normal in XZ: rotate tangent by +90° about Y.
    const normal = { x: -tangent.z, z: tangent.x };
    segments.push({ a, b, tangent, normal, length, startDistance: distance });
    distance += length;
  }
  return { points, segments, length: distance, halfWidth };
}

function projectOnSegment(segment: TrackSegment, point: Vec2): { t: number; squaredDistance: number } {
  const dx = segment.b.x - segment.a.x;
  const dz = segment.b.z - segment.a.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return { t: 0, squaredDistance: (point.x - segment.a.x) ** 2 + (point.z - segment.a.z) ** 2 };
  let t = ((point.x - segment.a.x) * dx + (point.z - segment.a.z) * dz) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = segment.a.x + t * dx;
  const cz = segment.a.z + t * dz;
  return { t, squaredDistance: (point.x - cx) ** 2 + (point.z - cz) ** 2 };
}

/** Finds the closest centreline point, its distance along the lap and lateral offset. */
export function projectToTrack(track: Track, point: Vec2, hintIndex?: number): TrackProjection {
  let bestIndex = 0;
  let bestT = 0;
  let bestSquared = Infinity;

  // When a hint is available we only check a window around it, which keeps the
  // per-frame cost constant for long tracks. Otherwise scan everything.
  const count = track.segments.length;
  const window = hintIndex === undefined ? count : 3;
  for (let k = 0; k < window; k++) {
    const index = hintIndex === undefined ? k : (hintIndex + k - 1 + count) % count;
    const segment = track.segments[index];
    const { t, squaredDistance } = projectOnSegment(segment, point);
    if (squaredDistance < bestSquared) {
      bestSquared = squaredDistance;
      bestIndex = index;
      bestT = t;
    }
  }

  const segment = track.segments[bestIndex];
  const cx = segment.a.x + bestT * (segment.b.x - segment.a.x);
  const cz = segment.a.z + bestT * (segment.b.z - segment.a.z);
  const offset = { x: point.x - cx, z: point.z - cz };
  const lateral = offset.x * segment.normal.x + offset.z * segment.normal.z;

  return {
    index: bestIndex,
    distance: segment.startDistance + bestT * segment.length,
    lateral,
    tangent: segment.tangent,
    normal: segment.normal,
    point: { x: cx, z: cz },
  };
}

/** The default TiltX circuit — a sweeping, mostly-flat loop that is fun to drift. */
export function createDefaultTrack(): Track {
  const control: Vec2[] = [
    { x: 0, z: -40 },
    { x: 70, z: -55 },
    { x: 130, z: -20 },
    { x: 140, z: 45 },
    { x: 100, z: 95 },
    { x: 30, z: 110 },
    { x: -40, z: 95 },
    { x: -85, z: 50 },
    { x: -80, z: -10 },
    { x: -45, z: -35 },
  ];
  return createTrack(sampleLoop(control, 240));
}

export const TRACK_CONSTANTS = {
  defaultHalfWidth: DEFAULT_HALF_WIDTH,
} as const;
