import type { ControllerSnapshot } from './session.js';

export type StatusTone = 'good' | 'warn' | 'bad' | 'idle';

export interface StatusView {
  tone: StatusTone;
  label: string;
  detail: string;
}

/**
 * Single source of truth for how connection state is described in the UI.
 * Every state carries a text label so status is never conveyed by colour alone.
 */
export function describeConnection(snapshot: ControllerSnapshot): StatusView {
  if (snapshot.phase === 'error') {
    return { tone: 'bad', label: 'Error', detail: snapshot.errorMessage ?? 'Something went wrong.' };
  }
  if (snapshot.needsPairing || !snapshot.roomCode) {
    return {
      tone: 'idle',
      label: 'Not paired',
      detail: 'Scan the QR code on the laptop or enter the room code.',
    };
  }
  if (snapshot.phase === 'reconnecting') {
    return {
      tone: 'warn',
      label: 'Reconnecting',
      detail: `Trying to restore room ${snapshot.roomCode} (attempt ${snapshot.reconnectAttempts}).`,
    };
  }
  if (snapshot.phase === 'connecting') {
    return { tone: 'warn', label: 'Connecting', detail: 'Contacting the TiltX backend…' };
  }
  if (snapshot.paired) {
    if (snapshot.calibrating) {
      return { tone: 'warn', label: 'Calibrating', detail: 'Hold the phone steady.' };
    }
    if (snapshot.streaming) {
      return { tone: 'good', label: 'Streaming', detail: 'Motion input is being sent to the game.' };
    }
    if (!snapshot.calibrated) {
      return { tone: 'warn', label: 'Needs calibration', detail: 'Calibrate to enable driving.' };
    }
    return { tone: 'good', label: 'Ready', detail: 'Paired and calibrated. Press Start to drive.' };
  }
  return { tone: 'idle', label: 'Idle', detail: 'Waiting for the connection.' };
}

export function describeSensor(snapshot: ControllerSnapshot): StatusView {
  switch (snapshot.sensorState) {
    case 'ready':
      return { tone: 'good', label: 'Sensors live', detail: snapshot.sensorMessage };
    case 'permission-required':
      return { tone: 'warn', label: 'Permission needed', detail: snapshot.sensorMessage };
    case 'denied':
      return { tone: 'bad', label: 'Motion denied', detail: snapshot.sensorMessage };
    case 'unavailable':
      return { tone: 'bad', label: 'Sensors unavailable', detail: snapshot.sensorMessage };
    case 'insecure-context':
      return { tone: 'bad', label: 'Insecure context', detail: snapshot.sensorMessage };
    default:
      return { tone: 'idle', label: 'Sensors off', detail: snapshot.sensorMessage };
  }
}

export function formatMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(value)} ms`;
}
