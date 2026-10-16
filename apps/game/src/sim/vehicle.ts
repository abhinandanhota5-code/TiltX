/**
 * Arcade car physics. Deliberately simple, fully deterministic and free of any
 * rendering or networking dependency so it can be unit-tested.
 *
 * Controls arrive already normalised from the phone: steering ∈ [-1, 1]
 * (negative = left) and throttle/brake ∈ [0, 1]. Nothing here trusts the
 * controller to be well-behaved — every value is clamped again.
 */

import { Track, Vec2, projectToTrack } from './track.js';

export interface VehicleInput {
  steering: number;
  throttle: number;
  brake: number;
  /** Rising-edge trigger: request a boost this step. */
  boostRequest?: boolean;
}

export interface VehicleState {
  position: Vec2;
  /** Heading in radians; forward = (sin h, cos h). */
  heading: number;
  /** Forward speed, m/s (never negative — reverse is out of scope). */
  speed: number;
  /** Signed lateral offset from the centreline, metres. */
  lateral: number;
  /** Distance travelled along the centreline, metres. */
  distance: number;
  /** Seconds of boost remaining. */
  boostRemaining: number;
  /** Last segment index, used as the projection hint. */
  segmentHint: number;
}

export interface StepResult {
  state: VehicleState;
  offTrack: boolean;
  collided: boolean;
  boosting: boolean;
}

export const VEHICLE = {
  maxSpeed: 38,
  boostMaxSpeed: 58,
  acceleration: 20,
  boostAcceleration: 40,
  brakeDeceleration: 42,
  /** Linear drag coefficient; terminal speed ≈ acceleration / drag. */
  drag: 0.52,
  /** Constant rolling resistance when coasting, m/s². */
  rollingResistance: 2.2,
  /** Maximum yaw rate at full steering, rad/s. */
  turnRate: 2.1,
  /** Speed (m/s) at which steering reaches ~half its authority. */
  turnSpeedRef: 11,
  /** Speed lost per second while scraping a wall. */
  wallFriction: 26,
  boostDuration: 1.5,
  boostCooldown: 4,
} as const;

export function forwardVector(heading: number): Vec2 {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Places a car on the centreline a given distance into the lap, facing forward. */
export function spawnVehicle(track: Track, distanceIntoLap: number): VehicleState {
  const target = ((distanceIntoLap % track.length) + track.length) % track.length;
  let segmentIndex = 0;
  for (let i = 0; i < track.segments.length; i++) {
    const segment = track.segments[i];
    if (target >= segment.startDistance && target < segment.startDistance + segment.length) {
      segmentIndex = i;
      break;
    }
  }
  const segment = track.segments[segmentIndex];
  const t = segment.length === 0 ? 0 : (target - segment.startDistance) / segment.length;
  const position = {
    x: segment.a.x + t * (segment.b.x - segment.a.x),
    z: segment.a.z + t * (segment.b.z - segment.a.z),
  };
  return {
    position,
    heading: Math.atan2(segment.tangent.x, segment.tangent.z),
    speed: 0,
    lateral: 0,
    distance: target,
    boostRemaining: 0,
    segmentHint: segmentIndex,
  };
}

/**
 * Advances the car by one step. The controller is sampled at a fixed rate but
 * the renderer runs at frame rate, so this is called with the real frame delta.
 */
export function stepVehicle(
  track: Track,
  state: VehicleState,
  input: VehicleInput,
  dt: number,
): StepResult {
  const step = clamp(dt, 0, 0.05); // never simulate more than 50 ms at once
  const steering = clamp(input.steering, -1, 1);
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);

  // ---- boost ------------------------------------------------------------
  let boostRemaining = state.boostRemaining;
  let boosting = false;
  if (input.boostRequest && boostRemaining <= 0) {
    boostRemaining = VEHICLE.boostDuration;
  }
  if (boostRemaining > 0) {
    boostRemaining = Math.max(0, boostRemaining - step);
    boosting = boostRemaining > 0;
  }

  // ---- longitudinal -----------------------------------------------------
  let speed = state.speed;
  const maxSpeed = boosting ? VEHICLE.boostMaxSpeed : VEHICLE.maxSpeed;
  if (throttle > 0) {
    speed += (boosting ? VEHICLE.boostAcceleration : VEHICLE.acceleration) * throttle * step;
  }
  if (brake > 0) {
    speed -= VEHICLE.brakeDeceleration * brake * step;
  }
  if (throttle === 0 && brake === 0) {
    speed -= VEHICLE.rollingResistance * step;
  }
  speed -= VEHICLE.drag * speed * step;
  speed = clamp(speed, 0, maxSpeed);

  // ---- steering ---------------------------------------------------------
  // Steering authority scales with speed so the car cannot spin on the spot,
  // but saturates quickly so it stays responsive when moving.
  const authority = speed / (speed + VEHICLE.turnSpeedRef);
  const heading = state.heading + steering * VEHICLE.turnRate * authority * step;

  // ---- integrate position ----------------------------------------------
  const forward = forwardVector(heading);
  let position: Vec2 = {
    x: state.position.x + forward.x * speed * step,
    z: state.position.z + forward.z * speed * step,
  };

  // ---- keep on track ----------------------------------------------------
  const projection = projectToTrack(track, position, state.segmentHint);
  let collided = false;
  const maxLateral = track.halfWidth - 0.9; // keep the car body off the wall
  if (Math.abs(projection.lateral) > maxLateral) {
    const sign = Math.sign(projection.lateral) || 0;
    const overshoot = Math.abs(projection.lateral) - maxLateral;
    position = {
      x: position.x - projection.normal.x * projection.lateral + projection.normal.x * sign * maxLateral,
      z: position.z - projection.normal.z * projection.lateral + projection.normal.z * sign * maxLateral,
    };
    speed = Math.max(0, speed - VEHICLE.wallFriction * step);
    collided = overshoot > 0.05;
  }

  const finalProjection = collided
    ? projectToTrack(track, position, projection.index)
    : projection;

  return {
    state: {
      position,
      heading,
      speed,
      lateral: finalProjection.lateral,
      distance: finalProjection.distance,
      boostRemaining,
      segmentHint: finalProjection.index,
    },
    offTrack: Math.abs(finalProjection.lateral) > track.halfWidth * 0.92,
    collided,
    boosting,
  };
}

/** Cooldown remaining until another boost may be requested, seconds. */
export function boostCooldownRemaining(state: VehicleState, sinceBoostSeconds: number): number {
  if (state.boostRemaining > 0) return state.boostRemaining + VEHICLE.boostCooldown;
  return Math.max(0, VEHICLE.boostCooldown - sinceBoostSeconds);
}
