import { describe, expect, it } from 'vitest';
import { createPairingToken, generateRoomCode, secureRandomInt, verifyPairingToken } from '../../src/pairing.js';

const SECRET = 'test-secret-do-not-use-in-production';

describe('pairing tokens', () => {
  it('round-trips a freshly issued token', () => {
    const { token, expiresAt } = createPairingToken(SECRET, 'AB23CD', 900, 1_000_000);
    expect(expiresAt).toBe(1_000_000 + 900_000);
    expect(verifyPairingToken(SECRET, 'AB23CD', token, 1_000_500)).toEqual({ ok: true });
  });

  it('rejects an expired token', () => {
    const { token } = createPairingToken(SECRET, 'AB23CD', 60, 1_000_000);
    const result = verifyPairingToken(SECRET, 'AB23CD', token, 1_000_000 + 61_000);
    expect(result).toEqual({ ok: false, reason: 'TOKEN_EXPIRED' });
  });

  it('rejects a token issued for a different room', () => {
    const { token } = createPairingToken(SECRET, 'AB23CD', 900, 1_000_000);
    expect(verifyPairingToken(SECRET, 'ZZ99ZZ', token, 1_000_500)).toEqual({
      ok: false,
      reason: 'INVALID_TOKEN',
    });
  });

  it('rejects a tampered token', () => {
    const { token } = createPairingToken(SECRET, 'AB23CD', 900, 1_000_000);
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyPairingToken(SECRET, 'AB23CD', tampered, 1_000_500).ok).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = createPairingToken('other-secret', 'AB23CD', 900, 1_000_000);
    expect(verifyPairingToken(SECRET, 'AB23CD', token, 1_000_500).ok).toBe(false);
  });

  it.each([[undefined], [''], ['nonsense'], ['.'], ['abc.def'], ['12.']])(
    'rejects malformed token %s',
    (token) => {
      expect(verifyPairingToken(SECRET, 'AB23CD', token as string, 1_000_000).ok).toBe(false);
    },
  );
});

describe('room codes', () => {
  it('generates the requested length from an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(secureRandomInt);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('produces varied codes (no constant generator)', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRoomCode(secureRandomInt)));
    expect(codes.size).toBeGreaterThan(180);
  });

  it('secureRandomInt stays in range and rejects invalid bounds', () => {
    for (let i = 0; i < 500; i++) {
      const v = secureRandomInt(32);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(32);
    }
    expect(() => secureRandomInt(0)).toThrow();
    expect(() => secureRandomInt(1000)).toThrow();
  });
});
