import {
  ControllerInputPacket,
  InputMeta,
  PROTOCOL_VERSION,
  ROOM_CODE_PATTERN,
} from './protocol.js';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: 'INVALID_PACKET' | 'PROTOCOL_MISMATCH' | 'BAD_REQUEST' };

const EPS = 1e-6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkRange(
  value: unknown,
  min: number,
  max: number,
  field: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (!isFiniteNumber(value)) {
    return { ok: false, error: `${field} must be a finite number` };
  }
  if (value < min - EPS || value > max + EPS) {
    return { ok: false, error: `${field} out of range [${min}, ${max}]: ${value}` };
  }
  // Clamp away the tiny epsilon so downstream math stays inside the range.
  return { ok: true, value: Math.min(max, Math.max(min, value)) };
}

function sanitizeMeta(raw: unknown): InputMeta | undefined {
  if (!isPlainObject(raw)) return undefined;
  const meta: InputMeta = {};
  if (isFiniteNumber(raw['hz']) && raw['hz'] >= 0 && raw['hz'] <= 1000) {
    meta.hz = Math.round(raw['hz']);
  }
  if (isFiniteNumber(raw['orientation'])) {
    const o = Math.round(raw['orientation'] / 90) * 90;
    if (o === 0 || o === 90 || o === 180 || o === 270 || o === -90 || o === -180 || o === -270) {
      meta.orientation = Math.abs(o) === 90 ? (o > 0 ? 90 : 270) : Math.abs(o);
    }
  }
  if (typeof raw['calibrated'] === 'boolean') {
    meta.calibrated = raw['calibrated'];
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Validate an untrusted controller input packet.
 *
 * Rejects malformed objects, protocol mismatches, non-finite numbers,
 * out-of-range values and oversized payloads. Never throws.
 */
export function validateInputPacket(raw: unknown): ValidationResult<ControllerInputPacket> {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'packet must be an object', code: 'BAD_REQUEST' };
  }

  if (raw['v'] !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: `protocol version mismatch: got ${String(raw['v'])}, want ${PROTOCOL_VERSION}`,
      code: 'PROTOCOL_MISMATCH',
    };
  }

  const room = raw['room'];
  if (typeof room !== 'string' || !ROOM_CODE_PATTERN.test(room)) {
    return { ok: false, error: 'invalid room code', code: 'BAD_REQUEST' };
  }

  const seq = raw['seq'];
  if (!isFiniteNumber(seq) || !Number.isInteger(seq) || seq < 0 || seq > 0xffffffff) {
    return { ok: false, error: 'seq must be a uint32 integer', code: 'BAD_REQUEST' };
  }

  const ts = raw['ts'];
  if (!isFiniteNumber(ts) || ts < 0) {
    return { ok: false, error: 'ts must be a non-negative finite timestamp', code: 'BAD_REQUEST' };
  }

  const steering = checkRange(raw['steering'], -1, 1, 'steering');
  if (!steering.ok) return { ok: false, error: steering.error, code: 'INVALID_PACKET' };

  const throttle = checkRange(raw['throttle'], 0, 1, 'throttle');
  if (!throttle.ok) return { ok: false, error: throttle.error, code: 'INVALID_PACKET' };

  const brake = checkRange(raw['brake'], 0, 1, 'brake');
  if (!brake.ok) return { ok: false, error: brake.error, code: 'INVALID_PACKET' };

  const boost = raw['boost'];
  if (typeof boost !== 'boolean') {
    return { ok: false, error: 'boost must be a boolean', code: 'INVALID_PACKET' };
  }

  const jumpRaw = raw['jump'];
  if (jumpRaw !== undefined && typeof jumpRaw !== 'boolean') {
    return { ok: false, error: 'jump must be a boolean when present', code: 'INVALID_PACKET' };
  }

  const packet: ControllerInputPacket = {
    v: PROTOCOL_VERSION,
    room,
    seq,
    ts,
    steering: steering.value,
    throttle: throttle.value,
    brake: brake.value,
    boost,
  };
  if (jumpRaw !== undefined) packet.jump = jumpRaw;

  const meta = sanitizeMeta(raw['meta']);
  if (meta) packet.meta = meta;

  return { ok: true, value: packet };
}

/** Validate a room code entered by a human (manual pairing fallback). */
export function normalizeRoomCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ROOM_CODE_PATTERN.test(cleaned) ? cleaned : null;
}

/** The neutral/safe input state used whenever a controller is missing. */
export function neutralInput(): ControllerInputPacket {
  return {
    v: PROTOCOL_VERSION,
    room: '',
    seq: 0,
    ts: 0,
    steering: 0,
    throttle: 0,
    brake: 0,
    boost: false,
  };
}
