import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Ack,
  ControllerInputPacket,
  ControllerPresence,
  CreateRoomResult,
  EVENTS,
  JoinRoomResult,
  LatencyPong,
  PROTOCOL_VERSION,
} from '@tiltx/shared';
import { openClient, startTestServer, waitFor, waitUntil, type TestServer } from '../helpers/testServer.js';

function packet(room: string, overrides: Partial<ControllerInputPacket> = {}): ControllerInputPacket {
  return {
    v: PROTOCOL_VERSION,
    room,
    seq: 1,
    ts: 12345,
    steering: 0.25,
    throttle: 0.6,
    brake: 0,
    boost: false,
    ...overrides,
  };
}

describe('TiltX server integration — pairing and input delivery', () => {
  let server: TestServer;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    // Pin the "detected" LAN address so the LAN-repair logic is deterministic
    // and the controllerBaseUrl above survives untouched.
    server = await startTestServer({ LAN_ADDRESS_OVERRIDE: '192.168.1.50' });
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await server.close();
  });

  async function open(): Promise<Socket> {
    const socket = await openClient(server.baseUrl);
    sockets.push(socket);
    return socket;
  }

  async function createRoom(game: Socket): Promise<CreateRoomResult> {
    const ack = await game.emitWithAck(EVENTS.gameCreateRoom, {
      controllerBaseUrl: 'http://192.168.1.50:5173',
    });
    expect(ack.ok).toBe(true);
    return ack.data as CreateRoomResult;
  }

  it('serves a health endpoint', async () => {
    const response = await fetch(`${server.baseUrl}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; service: string; rooms: number };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('tiltx-server');
    expect(typeof body.rooms).toBe('number');
  });

  it('creates a room with a QR-ready pairing URL that is never localhost-hardcoded', async () => {
    const game = await open();
    const result = await createRoom(game);
    expect(result.room.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(result.pairing.url).toContain(`room=${result.room.code}`);
    expect(result.pairing.url).toContain('token=');
    expect(result.pairing.url.startsWith('http://192.168.1.50:5173')).toBe(true);
    expect(result.pairing.expiresAt).toBeGreaterThan(Date.now());
    expect(result.room.gameConnected).toBe(true);
    expect(result.room.controllerConnected).toBe(false);
  });

  it('is idempotent when the game re-requests a room', async () => {
    const game = await open();
    const first = await createRoom(game);
    const second = await createRoom(game);
    expect(second.room.code).toBe(first.room.code);
  });

  it('lets a controller join with a valid token and notify the game', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();

    const presencePromise = waitFor<ControllerPresence>(game, EVENTS.gameControllerPresence);
    const ack = await controller.emitWithAck(EVENTS.controllerJoin, {
      code: room.code,
      token: pairing.token,
    });
    expect(ack.ok).toBe(true);
    const joined = ack.data as JoinRoomResult;
    expect(joined.role).toBe('controller');
    expect(joined.room.controllerConnected).toBe(true);

    const presence = await presencePromise;
    expect(presence.controllerConnected).toBe(true);
    expect(presence.calibrated).toBe(false);
    expect(presence.ready).toBe(false);
    expect(presence.reason).toBe('calibration required');
  });

  it('delivers validated controller input to the game', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();
    await controller.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });

    const received = waitFor<ControllerInputPacket>(game, EVENTS.gameInput);
    controller.emit(EVENTS.controllerInput, packet(room.code, { seq: 1, steering: -0.4, throttle: 0.9 }));
    const forwarded = await received;
    expect(forwarded.v).toBe(PROTOCOL_VERSION);
    expect(forwarded.room).toBe(room.code);
    expect(forwarded.steering).toBeCloseTo(-0.4, 6);
    expect(forwarded.throttle).toBeCloseTo(0.9, 6);
    expect(forwarded.seq).toBe(1);
  });

  it('propagates controller calibration status to the game', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();
    await controller.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });

    const presencePromise = waitFor<ControllerPresence>(game, EVENTS.gameControllerPresence);
    controller.emit(EVENTS.controllerStatus, { room: room.code, calibrated: true, ready: true, hz: 55 });

    const presence = await presencePromise;
    expect(presence.calibrated).toBe(true);
    expect(presence.ready).toBe(true);
    expect(presence.reason).toBeUndefined();

    await waitUntil(() => server.services.rooms.get(room.code)?.hz === 55);
    expect(server.services.rooms.get(room.code)?.calibrated).toBe(true);
  });

  it('rejects malformed calibration status messages', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();
    await controller.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });

    const errorPromise = waitFor<{ code: string }>(controller, EVENTS.error);
    controller.emit(EVENTS.controllerStatus, { room: room.code, calibrated: 'yes', ready: true, hz: 55 });
    const error = await errorPromise;
    expect(error.code).toBe('BAD_REQUEST');
    expect(server.services.rooms.get(room.code)?.calibrated).toBe(false);
  });

  it('rejects malformed input without forwarding it', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();
    await controller.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });

    let forwarded = false;
    game.on(EVENTS.gameInput, () => {
      forwarded = true;
    });

    controller.emit(EVENTS.controllerInput, packet(room.code, { steering: Number.NaN, seq: 2 }));
    controller.emit(EVENTS.controllerInput, packet(room.code, { throttle: 99, seq: 3 }));
    controller.emit(EVENTS.controllerInput, { garbage: true });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(forwarded).toBe(false);
  });

  it('drops packets whose room does not match the socket membership', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();
    await controller.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });

    const errorPromise = waitFor<{ code: string }>(controller, EVENTS.error);
    let forwarded = false;
    game.on(EVENTS.gameInput, () => {
      forwarded = true;
    });

    controller.emit(EVENTS.controllerInput, packet('ZZZZZZ', { seq: 1 }));
    const error = await errorPromise;
    expect(error.code).toBe('UNAUTHORIZED_ROLE');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(forwarded).toBe(false);
  });

  it('refuses input from a socket that never joined as a controller', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const rogue = await open();
    await rogue.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });

    const gameSocket = await open();
    // A second socket that tries to stream without joining.
    const errorPromise = waitFor<{ code: string }>(gameSocket, EVENTS.error);
    gameSocket.emit(EVENTS.controllerInput, packet(room.code, { seq: 1 }));
    const error = await errorPromise;
    expect(error.code).toBe('UNAUTHORIZED_ROLE');
  });

  it('drops duplicate/out-of-order sequence numbers', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();
    await controller.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });

    const seen: number[] = [];
    game.on(EVENTS.gameInput, (p: ControllerInputPacket) => seen.push(p.seq));

    controller.emit(EVENTS.controllerInput, packet(room.code, { seq: 10 }));
    controller.emit(EVENTS.controllerInput, packet(room.code, { seq: 10 }));
    controller.emit(EVENTS.controllerInput, packet(room.code, { seq: 9 }));
    controller.emit(EVENTS.controllerInput, packet(room.code, { seq: 11 }));

    await waitUntil(() => seen.length >= 2);
    expect(seen).toEqual([10, 11]);
  });

  it('enforces the input rate limit', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();
    await controller.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });

    let count = 0;
    game.on(EVENTS.gameInput, () => count++);
    for (let i = 0; i < 600; i++) {
      controller.emit(EVENTS.controllerInput, packet(room.code, { seq: 1000 + i }));
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(300);
  });

  it('measures round-trip latency via ping/pong', async () => {
    const client = await open();
    const t0 = performance.now();
    const pong = (await client.emitWithAck(EVENTS.latencyPing, { seq: 7, t0 })) as LatencyPong;
    const rtt = performance.now() - t0;
    expect(pong.seq).toBe(7);
    expect(pong.t0).toBe(t0);
    expect(typeof pong.serverTime).toBe('number');
    expect(rtt).toBeGreaterThanOrEqual(0);
    expect(rtt).toBeLessThan(2000);
  });

  it('rejects joining an unknown room and a bad token', async () => {
    const controller = await open();
    const missing = (await controller.emitWithAck(EVENTS.controllerJoin, {
      code: 'ZZZZZZ',
    })) as Ack<JoinRoomResult>;
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe('ROOM_NOT_FOUND');

    const game = await open();
    const { room } = await createRoom(game);
    const badToken = (await controller.emitWithAck(EVENTS.controllerJoin, {
      code: room.code,
      token: '123.abcdef',
    })) as Ack<JoinRoomResult>;
    expect(badToken.ok).toBe(false);
    expect(['INVALID_TOKEN', 'TOKEN_EXPIRED']).toContain(badToken.code);

    const malformed = (await controller.emitWithAck(EVENTS.controllerJoin, {
      code: 'nope',
    })) as Ack<JoinRoomResult>;
    expect(malformed.ok).toBe(false);
    expect(malformed.code).toBe('INVALID_ROOM');
  });

  it('surfaces a safe presence state when the controller disconnects', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();
    await controller.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });
    controller.emit(EVENTS.controllerStatus, { room: room.code, calibrated: true, ready: true, hz: 55 });
    await waitUntil(() => server.services.rooms.get(room.code)?.ready === true);

    const presencePromise = waitFor<ControllerPresence>(game, EVENTS.gameControllerPresence);
    controller.disconnect();
    const presence = await presencePromise;
    expect(presence.controllerConnected).toBe(false);
    expect(presence.calibrated).toBe(false);
    expect(presence.ready).toBe(false);
    expect(presence.reason).toBe('controller disconnected');
  });

  it('allows an explicit controller replacement and notifies the first phone', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const first = await open();
    await first.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });

    const second = await open();
    const rejected = (await second.emitWithAck(EVENTS.controllerJoin, {
      code: room.code,
    })) as Ack<JoinRoomResult>;
    expect(rejected.ok).toBe(false);
    expect(rejected.code).toBe('CONTROLLER_TAKEN');

    const closedPromise = waitFor<{ reason: string }>(first, EVENTS.roomClosed);
    const takeover = (await second.emitWithAck(EVENTS.controllerJoin, {
      code: room.code,
      replace: true,
    })) as Ack<JoinRoomResult>;
    expect(takeover.ok).toBe(true);
    const closed = await closedPromise;
    expect(closed.reason).toBe('controller replaced');
  });

  it('lets a reconnecting controller reclaim its room with the stored token', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();
    await controller.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });
    controller.disconnect();

    const reconnected = await open();
    const ack = (await reconnected.emitWithAck(EVENTS.controllerJoin, {
      code: room.code,
      token: pairing.token,
    })) as Ack<JoinRoomResult>;
    expect(ack.ok).toBe(true);
    expect((ack.data as JoinRoomResult).room.controllerConnected).toBe(true);
  });

  it('lets the game rejoin its room after a reconnect', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();
    await controller.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });
    game.disconnect();

    const newGame = await open();
    const presencePromise = waitFor<ControllerPresence>(newGame, EVENTS.gameControllerPresence);
    const ack = (await newGame.emitWithAck(EVENTS.gameJoin, { code: room.code })) as Ack<JoinRoomResult>;
    expect(ack.ok).toBe(true);
    const presence = await presencePromise;
    expect(presence.controllerConnected).toBe(true);

    // And the controller keeps working after the game returned.
    const received = waitFor<ControllerInputPacket>(newGame, EVENTS.gameInput);
    controller.emit(EVENTS.controllerInput, packet(room.code, { seq: 1 }));
    expect((await received).room).toBe(room.code);
  });

  it('closes the room (and tells the phone) when the game leaves for good', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();
    await controller.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });

    const closedPromise = waitFor<{ room: string; reason: string }>(controller, EVENTS.roomClosed, 3000);
    game.disconnect();
    const closed = await closedPromise;
    expect(closed.room).toBe(room.code);
    expect(closed.reason).toBe('laptop disconnected');
    expect(server.services.rooms.get(room.code)).toBeUndefined();
  });

  it('closes the room when the game explicitly ends the session', async () => {
    const game = await open();
    const { room, pairing } = await createRoom(game);
    const controller = await open();
    await controller.emitWithAck(EVENTS.controllerJoin, { code: room.code, token: pairing.token });

    const closedPromise = waitFor<{ reason: string }>(controller, EVENTS.roomClosed, 3000);
    game.emit(EVENTS.gameCloseRoom);
    const closed = await closedPromise;
    expect(closed.reason).toBe('session ended on laptop');
    await waitUntil(() => server.services.rooms.get(room.code) === undefined);
  });

  it('reports an error when the room no longer exists after a reconnect', async () => {
    const controller = await open();
    const ack = (await controller.emitWithAck(EVENTS.controllerJoin, {
      code: 'AAA222',
      token: '9999999999.abcdefghijklmnopqrstuv',
    })) as Ack<JoinRoomResult>;
    expect(ack.ok).toBe(false);
    expect(['ROOM_NOT_FOUND', 'INVALID_TOKEN', 'TOKEN_EXPIRED']).toContain(ack.code);
  });
});
