/**
 * Race bookkeeping: lap timing, best laps and the start-line crossing rule.
 *
 * A lap only counts when the car crosses the start/finish line travelling
 * forwards *and* it has cleared the far side of the circuit, so backing over
 * the line (or creeping across it) can never farm laps.
 */

import { Track } from './track.js';
import { VehicleInput, VehicleState, spawnVehicle, stepVehicle } from './vehicle.js';

/** How far before the line the car spawns, metres. */
const GRID_OFFSET = 12;
/** A crossing only counts if the car was at least this far around the lap. */
const FORWARD_CROSSING_MIN_PROGRESS = 0.6;

export interface RaceState {
  vehicle: VehicleState;
  /** Fraction of the lap completed, 0 – 1. */
  progress: number;
  /** Fraction of the lap at the previous step. */
  previousProgress: number;
  /** Completed laps. */
  laps: number;
  /** True once the car has crossed the line for the first time. */
  started: boolean;
  /** Milliseconds into the current lap. */
  currentLapMs: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  totalMs: number;
  /** Rolling window used to detect forward crossings. */
  maxProgressSeen: number;
  /** Set for one step when a lap is completed, for HUD flash/messages. */
  lapJustCompleted: number | null;
}

export function createRace(track: Track): RaceState {
  return {
    vehicle: spawnVehicle(track, track.length - GRID_OFFSET),
    progress: (track.length - GRID_OFFSET) / track.length,
    previousProgress: (track.length - GRID_OFFSET) / track.length,
    laps: 0,
    started: false,
    currentLapMs: 0,
    lastLapMs: null,
    bestLapMs: null,
    totalMs: 0,
    maxProgressSeen: 0,
    lapJustCompleted: null,
  };
}

export interface RaceStepInput extends VehicleInput {
  /** Frame delta in milliseconds. */
  dtMs: number;
}

export function stepRace(track: Track, race: RaceState, input: RaceStepInput): RaceState {
  const dtMs = Math.max(0, Math.min(input.dtMs, 50));
  const dt = dtMs / 1000;

  const result = stepVehicle(track, race.vehicle, input, dt);
  const progress = result.state.distance / track.length;
  const normalizedProgress = progress - Math.floor(progress);

  const previousProgress = race.previousProgress;
  let laps = race.laps;
  let started = race.started;
  let currentLapMs = race.currentLapMs;
  let lastLapMs = race.lastLapMs;
  let bestLapMs = race.bestLapMs;
  let lapJustCompleted: number | null = null;

  const crossedForward =
    previousProgress > FORWARD_CROSSING_MIN_PROGRESS &&
    normalizedProgress < 1 - FORWARD_CROSSING_MIN_PROGRESS &&
    race.maxProgressSeen > FORWARD_CROSSING_MIN_PROGRESS;

  if (crossedForward) {
    if (!started) {
      started = true;
      currentLapMs = 0;
    } else {
      lastLapMs = Math.round(currentLapMs);
      if (bestLapMs === null || lastLapMs < bestLapMs) bestLapMs = lastLapMs;
      laps += 1;
      lapJustCompleted = lastLapMs;
      currentLapMs = 0;
    }
  } else if (started) {
    currentLapMs += dtMs;
  }

  const totalMs = race.totalMs + dtMs;
  const maxProgressSeen = Math.max(race.maxProgressSeen, normalizedProgress);

  return {
    vehicle: result.state,
    progress: normalizedProgress,
    previousProgress: normalizedProgress,
    laps,
    started,
    currentLapMs,
    lastLapMs,
    bestLapMs,
    totalMs,
    maxProgressSeen,
    lapJustCompleted,
  };
}
