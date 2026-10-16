/// <reference types="vite/client" />

export interface RuntimeConfig {
  /** Absolute backend URL. Empty → same origin (the dev server proxies /socket.io). */
  serverUrl: string;
  /** Target controller → backend update rate. */
  inputHz: number;
  /** Room code supplied by the QR link, if any. */
  roomCode: string | null;
  /** Short-lived pairing token supplied by the QR link, if any. */
  pairingToken: string | null;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

const STORAGE_KEYS = {
  serverUrl: 'tiltx.serverUrl',
  sensitivity: 'tiltx.sensitivity',
  smoothing: 'tiltx.smoothing',
  invertPitch: 'tiltx.invertPitch',
} as const;

function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readStored(key: keyof typeof STORAGE_KEYS, fallback: string): string {
  return readString(STORAGE_KEYS[key]) ?? fallback;
}

export function persist(key: keyof typeof STORAGE_KEYS, value: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS[key], value);
  } catch {
    /* private mode / storage disabled — settings simply won't persist */
  }
}

export function parseUrlParams(search: string): { roomCode: string | null; pairingToken: string | null } {
  const params = new URLSearchParams(search);
  const raw = params.get('room') ?? params.get('code');
  const roomCode = raw ? raw.trim().toUpperCase() : null;
  const token = params.get('token');
  return {
    roomCode: roomCode && /^[A-Z0-9]{6}$/.test(roomCode) ? roomCode : null,
    pairingToken: token && token.length > 0 ? token : null,
  };
}

const env = import.meta.env;

export const initialConfig: RuntimeConfig = {
  serverUrl: (env.VITE_SERVER_URL ?? '').trim(),
  inputHz: clamp(Number(env.VITE_INPUT_HZ) || 55, 20, 60),
  ...parseUrlParams(window.location.search),
};

export { STORAGE_KEYS, clamp };
