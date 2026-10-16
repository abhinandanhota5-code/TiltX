import { describe, expect, it } from 'vitest';
import {
  ControllerInputPacket,
  PROTOCOL_VERSION,
  neutralInput,
  normalizeRoomCode,
  validateInputPacket,
} from './index.js';

function validPacket(overrides: Partial<ControllerInputPacket> = {}): unknown {
  return {
    v: PROTOCOL_VERSION,
    room: 'ABC234',
    seq: 1,
    ts: 1000,
    steering: -0.5,
    throttle: 0.25,
    brake: 0,
    boost: false,
    ...overrides,
  };
}

describe('validateInputPacket', () => {
  it('accepts a well-formed packet', () => {
    const result = validateInputPacket(validPacket());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.steering).toBe(-0.5);
      expect(result.value.room).toBe('ABC234');
    }
  });

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 42, 'x', [1, 2, 3]]) {
      const result = validateInputPacket(bad);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a protocol version mismatch', () => {
    const result = validateInputPacket(validPacket({ v: 99 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PROTOCOL_MISMATCH');
  });

  it.each([
    ['NaN steering', { steering: NaN }],
    ['infinite steering', { steering: Number.POSITIVE_INFINITY }],
    ['steering above range', { steering: 1.001 }],
    ['steering below range', { steering: -1.5 }],
    ['throttle above range', { throttle: 2 }],
    ['negative throttle', { throttle: -0.01 }],
    ['brake above range', { brake: 1.0001 }],
    ['string throttle', { throttle: '0.5' }],
    ['missing boost', { boost: undefined }],
    ['non-boolean boost', { boost: 1 }],
    ['float seq', { seq: 1.5 }],
    ['negative seq', { seq: -1 }],
    ['negative ts', { ts: -5 }],
    ['bad room', { room: 'abc!1' }],
    ['short room', { room: 'AB' }],
    ['missing room', { room: undefined }],
  ])('rejects %s', (_label, overrides) => {
    const result = validateInputPacket(validPacket(overrides as Partial<ControllerInputPacket>));
    expect(result.ok).toBe(false);
  });

  it('accepts boundary values exactly at range edges', () => {
    const result = validateInputPacket(
      validPacket({ steering: 1, throttle: 1, brake: 1, seq: 0xffffffff }),
    );
    expect(result.ok).toBe(true);
  });

  it('keeps an optional jump flag only when boolean', () => {
    const ok = validateInputPacket(validPacket({ jump: true }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.jump).toBe(true);

    const bad = validateInputPacket(validPacket({ jump: 'yes' } as never));
    expect(bad.ok).toBe(false);
  });

  it('strips unknown and malformed metadata', () => {
    const result = validateInputPacket(
      validPacket({
        meta: {
          hz: 55,
          orientation: 91,
          calibrated: true,
          evil: 'x'.repeat(500),
          nested: { a: 1 },
        } as never,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // orientation is snapped to the nearest supported quadrant
      expect(result.value.meta).toEqual({ hz: 55, orientation: 90, calibrated: true });
      expect((result.value.meta as Record<string, unknown>)['evil']).toBeUndefined();
    }
  });

  it('drops metadata entirely when nothing valid is present', () => {
    const result = validateInputPacket(validPacket({ meta: { evil: 1 } as never }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.meta).toBeUndefined();
  });

  it('accepts a valid optional jump flag', () => {
    const result = validateInputPacket(validPacket({ jump: false }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.jump).toBe(false);
  });
});

describe('normalizeRoomCode', () => {
  it('uppercases and strips separators', () => {
    expect(normalizeRoomCode(' abc-234 ')).toBe('ABC234');
    expect(normalizeRoomCode('abc 234')).toBe('ABC234');
  });

  it('returns null for invalid codes', () => {
    expect(normalizeRoomCode('abc')).toBeNull();
    expect(normalizeRoomCode('')).toBeNull();
    expect(normalizeRoomCode('TOOLONG1')).toBeNull();
  });
});

describe('neutralInput', () => {
  it('is safe by construction', () => {
    const n = neutralInput();
    expect(n.steering).toBe(0);
    expect(n.throttle).toBe(0);
    expect(n.brake).toBe(0);
    expect(n.boost).toBe(false);
    expect(validateInputPacket({ ...n, room: 'ABC234' }).ok).toBe(true);
  });
});
