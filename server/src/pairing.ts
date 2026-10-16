import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type TokenCheck = { ok: true } | { ok: false; reason: 'TOKEN_EXPIRED' | 'INVALID_TOKEN' };

const TOKEN_TTL_DEFAULT = 900;

/**
 * Short-lived pairing tokens.
 *
 * The QR code carries `room + token`, not a long-lived secret. The token is an
 * HMAC over `room.expiry` so it cannot be forged, replayed against another
 * room, or used after `expiresAt`. Restarting the server with a fresh secret
 * invalidates outstanding tokens (documented behaviour).
 */
export function createPairingToken(
  secret: string,
  room: string,
  ttlSec = TOKEN_TTL_DEFAULT,
  nowMs = Date.now(),
): { token: string; expiresAt: number } {
  const expiresAt = nowMs + ttlSec * 1000;
  const payload = `${room}.${Math.floor(expiresAt / 1000)}`;
  const mac = createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 24);
  return { token: `${Math.floor(expiresAt / 1000)}.${mac}`, expiresAt };
}

export function verifyPairingToken(
  secret: string,
  room: string,
  token: string | undefined,
  nowMs = Date.now(),
): TokenCheck {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'INVALID_TOKEN' };
  const sep = token.indexOf('.');
  if (sep <= 0) return { ok: false, reason: 'INVALID_TOKEN' };

  const expSec = Number(token.slice(0, sep));
  const mac = token.slice(sep + 1);
  if (!Number.isFinite(expSec) || mac.length === 0) return { ok: false, reason: 'INVALID_TOKEN' };

  if (expSec * 1000 < nowMs) return { ok: false, reason: 'TOKEN_EXPIRED' };

  const expected = createHmac('sha256', secret)
    .update(`${room}.${expSec}`)
    .digest('base64url')
    .slice(0, 24);

  const a = Buffer.from(expected);
  const b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'INVALID_TOKEN' };
  }
  return { ok: true };
}

/** Cryptographically secure room code (unambiguous alphabet, 30 bits). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(random: (max: number) => number): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[random(ALPHABET.length)] as string;
  return out;
}

export function secureRandomInt(max: number): number {
  // Refuse to fall back silently to weak randomness.
  if (!Number.isInteger(max) || max <= 0 || max > 256) {
    throw new Error('secureRandomInt supports integers 1..256');
  }
  const limit = 256 - (256 % max); // largest multiple of `max` that fits a byte
  for (;;) {
    const value = randomBytes(1)[0] as number;
    if (value < limit) return value % max;
  }
}
