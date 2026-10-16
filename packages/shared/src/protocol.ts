/**
 * TiltX wire protocol: event names, message shapes, and error codes.
 * Every client and the server import from this module — nothing on the wire
 * is defined ad hoc anywhere else.
 */

export const PROTOCOL_VERSION = 1 as const;

export type Role = 'game' | 'controller';

/** Phases shared by both clients so the UI can never lie about state. */
export type ConnectionPhase =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type ErrorCode =
  | 'INVALID_ROOM'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_CLOSED'
  | 'CONTROLLER_TAKEN'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'UNAUTHORIZED_ROLE'
  | 'RATE_LIMITED'
  | 'INVALID_PACKET'
  | 'PROTOCOL_MISMATCH'
  | 'BAD_REQUEST'
  | 'SERVER_ERROR';

export interface Ack<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: ErrorCode;
}

/** Optional, strictly bounded diagnostics attached to input packets. */
export interface InputMeta {
  /** Effective send rate of the controller, updates/second. */
  hz?: number;
  /** Screen orientation in degrees (0 | 90 | 180 | 270). */
  orientation?: number;
  /** Whether the controller has a valid calibration baseline. */
  calibrated?: boolean;
}

/**
 * The single packet the controller streams to the game.
 * `steering` ∈ [-1, 1], `throttle` ∈ [0, 1], `brake` ∈ [0, 1].
 */
export interface ControllerInputPacket {
  /** Protocol version — mismatched clients are rejected. */
  v: number;
  /** Room code. Validated server-side against the socket's membership. */
  room: string;
  /** Monotonic sequence number used to drop stale/out-of-order packets. */
  seq: number;
  /** Client timestamp (ms). Only meaningful relative to the same client. */
  ts: number;
  steering: number;
  throttle: number;
  brake: number;
  boost: boolean;
  jump?: boolean;
  meta?: InputMeta;
}

export interface RoomSummary {
  code: string;
  createdAt: number;
  controllerConnected: boolean;
  gameConnected: boolean;
}

export interface PairingInfo {
  /** Full URL encoded in the QR code (controller app + room + token). */
  url: string;
  /** Room code for manual entry fallback. */
  code: string;
  /** Short-lived pairing token (HMAC) — never a long-lived secret. */
  token: string;
  expiresAt: number;
}

export interface CreateRoomResult {
  room: RoomSummary;
  pairing: PairingInfo;
}

export interface JoinRoomRequest {
  code: string;
  token?: string;
  /** Explicitly take over from an existing controller. */
  replace?: boolean;
}

export interface JoinRoomResult {
  room: RoomSummary;
  role: Role;
  serverTime: number;
}

/** Presence/state push for a game about a room's controller. */
export interface ControllerPresence {
  room: string;
  controllerConnected: boolean;
  calibrated: boolean;
  ready: boolean;
  /** Human-readable reason when not ready (e.g. "calibration required"). */
  reason?: string;
}

/** Controller → server → game: readiness/calibration state, not raw sensors. */
export interface ControllerStatusMessage {
  room: string;
  calibrated: boolean;
  ready: boolean;
  hz: number;
}

export interface LatencyPing {
  seq: number;
  /** Sender monotonic-ish timestamp; echoed back untouched. */
  t0: number;
}

export interface LatencyPong {
  seq: number;
  t0: number;
  /** Server wall-clock time at reply (diagnostic only). */
  serverTime: number;
}

export interface RoomClosedMessage {
  room: string;
  reason: string;
}

export interface ErrorMessage {
  code: ErrorCode;
  message: string;
}

/** All Socket.IO channel names used by TiltX. */
export const EVENTS = {
  /** game → server */
  gameCreateRoom: 'game:create-room',
  gameJoin: 'game:join',
  gameCloseRoom: 'game:close-room',
  /** controller → server */
  controllerJoin: 'controller:join',
  controllerInput: 'controller:input',
  controllerStatus: 'controller:status',
  /** server → game */
  gameControllerPresence: 'game:controller-presence',
  /** server → game: validated controller input packet */
  gameInput: 'game:input',
  /** server → both */
  roomClosed: 'room:closed',
  error: 'error',
  /** bidirectional latency probe */
  latencyPing: 'latency:ping',
  latencyPong: 'latency:pong',
  /** connection monitoring */
  heartbeat: 'heartbeat',
} as const;

/** Input rate bounds enforced server-side. */
export const RATE_LIMITS = {
  /** Hard ceiling on accepted input packets per second. */
  maxInputPerSec: 90,
  burst: 180,
} as const;

export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export const CLIENT_DEFAULT_INPUT_HZ = 55;
export const MIN_INPUT_HZ = 20;
export const MAX_INPUT_HZ = 60;
