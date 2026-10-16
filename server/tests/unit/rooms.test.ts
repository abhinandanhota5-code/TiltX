import { describe, expect, it } from 'vitest';
import { RoomManager } from '../../src/rooms.js';

/** Deterministic clock for TTL / stall assertions. */
class FakeClock {
  constructor(public now: number = 1_000) {}
  read = (): number => this.now;
  advance(ms: number): void {
    this.now += ms;
  }
}

function makeRooms(): { rooms: RoomManager; clock: FakeClock } {
  const clock = new FakeClock();
  const rooms = new RoomManager({ now: clock.read });
  rooms.setTtl(60);
  return { rooms, clock };
}

describe('RoomManager — creation and joining', () => {
  it('creates a room with a single game slot', () => {
    const { rooms } = makeRooms();
    const room = rooms.create('ABC234', 'game-1');
    expect(room.gameSocketId).toBe('game-1');
    expect(room.controllerSocketId).toBeNull();
    expect(rooms.get('ABC234')).toBe(room);
    expect(rooms.size).toBe(1);
  });

  it('rejects joining a missing room', () => {
    const { rooms } = makeRooms();
    expect(rooms.joinController('NOPE12', 'ctrl-1', false)).toEqual({
      ok: false,
      error: 'ROOM_NOT_FOUND',
    });
  });

  it('rejects joining a closed room', () => {
    const { rooms } = makeRooms();
    rooms.create('ABC234', 'game-1');
    rooms.close('ABC234');
    expect(rooms.joinController('ABC234', 'ctrl-1', false).ok).toBe(false);
    expect(rooms.joinGame('ABC234', 'game-2').ok).toBe(false);
  });

  it('lets a game rejoin and reports the replaced socket', () => {
    const { rooms } = makeRooms();
    rooms.create('ABC234', 'game-1');
    const result = rooms.joinGame('ABC234', 'game-2');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.previousSocketId).toBe('game-1');
    expect(rooms.byGameSocket('game-2')?.code).toBe('ABC234');
  });
});

describe('RoomManager — controller exclusivity', () => {
  it('accepts the first controller', () => {
    const { rooms } = makeRooms();
    rooms.create('ABC234', 'game-1');
    const result = rooms.joinController('ABC234', 'ctrl-1', false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replaced).toBe(false);
      expect(result.previousSocketId).toBeNull();
    }
  });

  it('rejects a second controller unless replacement is explicit', () => {
    const { rooms } = makeRooms();
    rooms.create('ABC234', 'game-1');
    rooms.joinController('ABC234', 'ctrl-1', false);

    expect(rooms.joinController('ABC234', 'ctrl-2', false)).toEqual({
      ok: false,
      error: 'CONTROLLER_TAKEN',
    });

    const takeover = rooms.joinController('ABC234', 'ctrl-2', true);
    expect(takeover.ok).toBe(true);
    if (takeover.ok) {
      expect(takeover.replaced).toBe(true);
      expect(takeover.previousSocketId).toBe('ctrl-1');
    }
    expect(rooms.get('ABC234')?.controllerSocketId).toBe('ctrl-2');
  });

  it('is idempotent for the same socket', () => {
    const { rooms } = makeRooms();
    rooms.create('ABC234', 'game-1');
    rooms.joinController('ABC234', 'ctrl-1', false);
    const again = rooms.joinController('ABC234', 'ctrl-1', false);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.replaced).toBe(false);
  });

  it('resets calibration and sequence state when a controller rejoins', () => {
    const { rooms } = makeRooms();
    rooms.create('ABC234', 'game-1');
    rooms.joinController('ABC234', 'ctrl-1', false);
    rooms.recordInput('ABC234', 10);
    rooms.setStatus('ABC234', { calibrated: true, ready: true, hz: 55 });

    rooms.joinController('ABC234', 'ctrl-2', true);
    const room = rooms.get('ABC234')!;
    expect(room.calibrated).toBe(false);
    expect(room.ready).toBe(false);
    expect(room.lastSeq).toBe(-1);
  });
});

describe('RoomManager — input sequencing', () => {
  it('accepts strictly increasing sequence numbers', () => {
    const { rooms } = makeRooms();
    rooms.create('ABC234', 'game-1');
    rooms.joinController('ABC234', 'ctrl-1', false);
    expect(rooms.recordInput('ABC234', 1).accepted).toBe(true);
    expect(rooms.recordInput('ABC234', 2).accepted).toBe(true);
  });

  it('drops duplicate and out-of-order packets as stale', () => {
    const { rooms } = makeRooms();
    rooms.create('ABC234', 'game-1');
    rooms.joinController('ABC234', 'ctrl-1', false);
    rooms.recordInput('ABC234', 5);
    expect(rooms.recordInput('ABC234', 5)).toEqual({ accepted: false, reason: 'STALE_SEQ' });
    expect(rooms.recordInput('ABC234', 4)).toEqual({ accepted: false, reason: 'STALE_SEQ' });
  });

  it('rejects input for unknown rooms', () => {
    const { rooms } = makeRooms();
    expect(rooms.recordInput('NOPE12', 1).accepted).toBe(false);
  });

  it('tracks when input stalled', () => {
    const { rooms, clock } = makeRooms();
    rooms.create('ABC234', 'game-1');
    rooms.joinController('ABC234', 'ctrl-1', false);
    rooms.recordInput('ABC234', 1);
    expect(rooms.isStalled('ABC234', 500)).toBe(false);
    clock.advance(600);
    expect(rooms.isStalled('ABC234', 500)).toBe(true);
    rooms.recordInput('ABC234', 2);
    expect(rooms.isStalled('ABC234', 500)).toBe(false);
  });

  it('never reports a stall without a connected controller', () => {
    const { rooms, clock } = makeRooms();
    rooms.create('ABC234', 'game-1');
    clock.advance(10_000);
    expect(rooms.isStalled('ABC234', 500)).toBe(false);
  });
});

describe('RoomManager — disconnect and cleanup', () => {
  it('frees the controller slot and clears readiness on disconnect', () => {
    const { rooms } = makeRooms();
    rooms.create('ABC234', 'game-1');
    rooms.joinController('ABC234', 'ctrl-1', false);
    rooms.setStatus('ABC234', { calibrated: true, ready: true, hz: 55 });

    const freed = rooms.handleDisconnect('ctrl-1');
    expect(freed?.role).toBe('controller');
    const room = rooms.get('ABC234')!;
    expect(room.controllerSocketId).toBeNull();
    expect(room.calibrated).toBe(false);
    expect(room.ready).toBe(false);
    // The game socket is untouched.
    expect(room.gameSocketId).toBe('game-1');
    expect(rooms.handleDisconnect('ctrl-1')).toBeNull();
  });

  it('keeps the room alive for a reconnecting game (grace semantics)', () => {
    const { rooms } = makeRooms();
    rooms.create('ABC234', 'game-1');
    rooms.joinController('ABC234', 'ctrl-1', false);
    const freed = rooms.handleDisconnect('game-1');
    expect(freed?.role).toBe('game');
    expect(rooms.get('ABC234')).toBeDefined();
    expect(rooms.joinGame('ABC234', 'game-9').ok).toBe(true);
  });

  it('sweeps idle empty rooms after the TTL but keeps active ones', () => {
    const { rooms, clock } = makeRooms();
    rooms.create('ABC234', 'game-1');
    rooms.create('ZZZZZZ', 'game-2');
    rooms.handleDisconnect('game-1');

    clock.advance(30_000);
    expect(rooms.sweep()).toEqual([]); // still inside the 60s TTL
    clock.advance(31_000);
    expect(rooms.sweep()).toEqual(['ABC234']);
    expect(rooms.get('ABC234')).toBeUndefined();
    expect(rooms.get('ZZZZZZ')).toBeDefined();
  });

  it('removes closed empty rooms immediately', () => {
    const { rooms } = makeRooms();
    rooms.create('ABC234', 'game-1');
    rooms.close('ABC234');
    rooms.handleDisconnect('game-1');
    expect(rooms.sweep()).toEqual(['ABC234']);
  });

  it('notifies when a room becomes empty', () => {
    const now = 1000;
    const emptied: string[] = [];
    const rooms = new RoomManager({
      now: () => now,
      onEmpty: (room) => emptied.push(room.code),
    });
    rooms.create('ABC234', 'game-1');
    rooms.handleDisconnect('game-1');
    expect(emptied).toEqual(['ABC234']);
  });
});
