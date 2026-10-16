import type { PairingInfo } from '@tiltx/shared';

export interface Room {
  code: string;
  createdAt: number;
  lastActivityAt: number;
  gameSocketId: string | null;
  controllerSocketId: string | null;
  /** Calibrated/ready state mirrored from controller status messages. */
  calibrated: boolean;
  ready: boolean;
  hz: number;
  /** Highest accepted controller sequence number (stale packets dropped). */
  lastSeq: number;
  lastInputAt: number;
  /** Set when the game explicitly closed the room; members get notified. */
  closed: boolean;
  /** Pairing info issued when the room was created (for QR re-render). */
  pairing: PairingInfo | null;
}

export type JoinFailure =
  | 'ROOM_NOT_FOUND'
  | 'CONTROLLER_TAKEN'
  | 'ROOM_CLOSED';

export type JoinOk =
  | { ok: true; room: Room; replaced: boolean; previousSocketId: string | null }
  | { ok: false; error: JoinFailure };

export interface InputAcceptResult {
  accepted: boolean;
  reason?: 'ROOM_NOT_FOUND' | 'STALE_SEQ' | 'CLOSED';
}

/**
 * In-memory room registry with explicit role slots.
 *
 * Roles are assigned here after validation — clients never get to claim a
 * role. Only one controller may occupy a room at a time; a second controller
 * must request `replace` explicitly so two phones cannot silently fight over
 * the same vehicle.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly opts: {
      now?: () => number;
      /** Called when a room transitions to having no members. */
      onEmpty?: (room: Room) => void;
    } = {},
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  list(): Room[] {
    return [...this.rooms.values()];
  }

  byGameSocket(socketId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.gameSocketId === socketId) return room;
    }
    return undefined;
  }

  byControllerSocket(socketId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.controllerSocketId === socketId) return room;
    }
    return undefined;
  }

  create(code: string, gameSocketId: string): Room {
    const nowMs = this.now();
    const room: Room = {
      code,
      createdAt: nowMs,
      lastActivityAt: nowMs,
      gameSocketId,
      controllerSocketId: null,
      calibrated: false,
      ready: false,
      hz: 0,
      lastSeq: -1,
      lastInputAt: 0,
      closed: false,
      pairing: null,
    };
    this.rooms.set(code, room);
    return room;
  }

  /** Take over the game slot (initial create uses this too). */
  joinGame(code: string, socketId: string): JoinOk {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    if (room.closed) return { ok: false, error: 'ROOM_CLOSED' };
    const previous = room.gameSocketId;
    room.gameSocketId = socketId;
    room.lastActivityAt = this.now();
    return { ok: true, room, replaced: false, previousSocketId: previous };
  }

  joinController(code: string, socketId: string, replace: boolean): JoinOk {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };
    if (room.closed) return { ok: false, error: 'ROOM_CLOSED' };

    const current = room.controllerSocketId;
    if (current !== null && current !== socketId) {
      if (!replace) return { ok: false, error: 'CONTROLLER_TAKEN' };
      // Explicit hand-off: the previous controller slot is released and its
      // socket will be told to stop streaming.
      room.controllerSocketId = null;
    }

    room.controllerSocketId = socketId;
    room.lastActivityAt = this.now();
    // A (re)joining controller starts a fresh sequence space.
    room.lastSeq = -1;
    room.calibrated = false;
    room.ready = false;
    room.hz = 0;
    return {
      ok: true,
      room,
      replaced: current !== null && current !== socketId,
      previousSocketId: current !== null && current !== socketId ? current : null,
    };
  }

  /**
   * Record a controller input packet. Returns whether it should be processed.
   * Sequence numbers must strictly increase within a controller session.
   */
  recordInput(code: string, seq: number): InputAcceptResult {
    const room = this.rooms.get(code);
    if (!room || room.closed) return { accepted: false, reason: 'ROOM_NOT_FOUND' };
    if (seq <= room.lastSeq) return { accepted: false, reason: 'STALE_SEQ' };
    room.lastSeq = seq;
    room.lastInputAt = this.now();
    room.lastActivityAt = room.lastInputAt;
    return { accepted: true };
  }

  setStatus(code: string, status: { calibrated: boolean; ready: boolean; hz: number }): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.calibrated = status.calibrated;
    room.ready = status.ready;
    room.hz = status.hz;
    room.lastActivityAt = this.now();
  }

  isStalled(code: string, stallMs: number): boolean {
    const room = this.rooms.get(code);
    if (!room || room.controllerSocketId === null) return false;
    if (room.lastInputAt === 0) return false;
    return this.now() - room.lastInputAt > stallMs;
  }

  /**
   * Handle a socket disconnect. Returns the room and freed role, if any.
   * The game slot is kept until the room is swept so a reconnecting game can
   * rejoin within the grace period.
   */
  handleDisconnect(socketId: string): { room: Room; role: 'game' | 'controller' } | null {
    for (const room of this.rooms.values()) {
      if (room.controllerSocketId === socketId) {
        room.controllerSocketId = null;
        room.calibrated = false;
        room.ready = false;
        room.hz = 0;
        room.lastSeq = -1;
        room.lastActivityAt = this.now();
        this.maybeEmpty(room);
        return { room, role: 'controller' };
      }
    }
    for (const room of this.rooms.values()) {
      if (room.gameSocketId === socketId) {
        room.gameSocketId = null;
        room.lastActivityAt = this.now();
        this.maybeEmpty(room);
        return { room, role: 'game' };
      }
    }
    return null;
  }

  close(code: string): Room | undefined {
    const room = this.rooms.get(code);
    if (!room) return undefined;
    room.closed = true;
    room.lastActivityAt = this.now();
    return room;
  }

  delete(code: string): void {
    this.rooms.delete(code);
  }

  private maybeEmpty(room: Room): void {
    if (room.gameSocketId === null && room.controllerSocketId === null) {
      this.opts.onEmpty?.(room);
    }
  }

  /**
   * Remove closed rooms with no members and idle rooms past their TTL.
   * Returns the codes that were removed.
   */
  sweep(): string[] {
    const nowMs = this.now();
    const removed: string[] = [];
    for (const [code, room] of this.rooms) {
      const empty = room.gameSocketId === null && room.controllerSocketId === null;
      const expired = room.closed
        ? empty
        : empty && nowMs - room.lastActivityAt > this.ttlSeconds * 1000;
      if (expired) {
        this.rooms.delete(code);
        removed.push(code);
      }
    }
    return removed;
  }

  private ttlSeconds = 1800;

  setTtl(seconds: number): void {
    this.ttlSeconds = seconds;
  }
}
