import {
  Ack,
  ControllerInputPacket,
  ControllerPresence,
  ControllerStatusMessage,
  CreateRoomResult,
  EVENTS,
  JoinRoomRequest,
  JoinRoomResult,
  LatencyPing,
  LatencyPong,
  PairingInfo,
  PROTOCOL_VERSION,
  resolveControllerBaseUrl,
  RoomSummary,
  validateInputPacket,
} from '@tiltx/shared';
import type { Server as HttpServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import type { ServerConfig } from './config.js';
import type { Logger } from './logger.js';
import { detectLanAddress } from './net.js';
import {
  createPairingToken,
  generateRoomCode,
  secureRandomInt,
  verifyPairingToken,
} from './pairing.js';
import { TokenBucket } from './ratelimit.js';
import { Room, RoomManager } from './rooms.js';

interface SocketData {
  role?: 'game' | 'controller';
  room?: string;
  joinLimiter: TokenBucket;
  inputLimiter: TokenBucket;
  errorsSent: number;
  packetsReceived: number;
  packetsDropped: number;
}

/** socket.io types Socket.data as `any` by default; narrow it at the edge. */
function state(socket: Socket): SocketData {
  return socket.data as SocketData;
}

export interface AppServices {
  io: Server;
  rooms: RoomManager;
  config: ServerConfig;
  logger: Logger;
  secret: string;
  close(): Promise<void>;
}

const MAX_REPORTED_ERRORS_PER_SOCKET = 5;

function summary(room: Room): RoomSummary {
  return {
    code: room.code,
    createdAt: room.createdAt,
    controllerConnected: room.controllerSocketId !== null,
    gameConnected: room.gameSocketId !== null,
  };
}

function presenceFor(room: Room): ControllerPresence {
  const controllerConnected = room.controllerSocketId !== null;
  let reason: string | undefined;
  if (!controllerConnected) reason = 'controller disconnected';
  else if (!room.calibrated) reason = 'calibration required';
  else if (!room.ready) reason = 'controller not ready';
  return {
    room: room.code,
    controllerConnected,
    calibrated: room.calibrated,
    ready: controllerConnected && room.ready,
    ...(reason ? { reason } : {}),
  };
}

function buildPairing(base: string, code: string, secret: string, ttlSec: number): PairingInfo {
  const { token, expiresAt } = createPairingToken(secret, code, ttlSec);
  const baseClean = base.replace(/\/+$/, '');
  const url = `${baseClean}/?room=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`;
  return { url, code, token, expiresAt };
}

export function createAppServer(httpServer: HttpServer, config: ServerConfig, logger: Logger): AppServices {
  const io = new Server(httpServer, {
    // Prefer WebSocket, keep polling fallback for odd networks/browsers.
    transports: ['websocket', 'polling'],
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 4096,
    cors: {
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
      methods: ['GET', 'POST'],
    },
  });

  const secret = config.pairingSecret || generateRoomCode(secureRandomInt) + secureRandomInt(256).toString(16);
  if (!config.pairingSecret) {
    logger.warn('PAIRING_SECRET not set — generated an ephemeral secret; pairing tokens die on restart');
  }

  const rooms = new RoomManager({ now: () => Date.now() });
  rooms.setTtl(config.roomTtlSeconds);

  // Resolved once at boot: the QR link has to survive the laptop changing
  // Wi-Fi, so the address comes from the live interfaces rather than a file.
  const lanAddress = detectLanAddress({
    ...process.env,
    ...(config.lanAddressOverride ? { LAN_ADDRESS_OVERRIDE: config.lanAddressOverride } : {}),
  });
  if (lanAddress) {
    logger.info(`controller pairing base: ${lanAddress}:${config.controllerPort} (auto-detected)`);
  } else {
    logger.warn(
      'no LAN IPv4 address detected — the pairing QR will fall back to localhost and a phone will not reach it',
    );
  }

  const gameGraceTimers = new Map<string, NodeJS.Timeout>();

  const clearGrace = (code: string): void => {
    const t = gameGraceTimers.get(code);
    if (t) {
      clearTimeout(t);
      gameGraceTimers.delete(code);
    }
  };

  const sendPresence = (room: Room): void => {
    const game = room.gameSocketId ? io.sockets.sockets.get(room.gameSocketId) : undefined;
    if (game) game.emit(EVENTS.gameControllerPresence, presenceFor(room));
  };

  const closeRoom = (room: Room, reason: string): void => {
    clearGrace(room.code);
    rooms.close(room.code);
    for (const socketId of [room.gameSocketId, room.controllerSocketId]) {
      const target = socketId ? io.sockets.sockets.get(socketId) : undefined;
      if (target) {
        target.emit(EVENTS.roomClosed, { room: room.code, reason });
        state(target).room = undefined;
        state(target).role = undefined;
      }
    }
    rooms.delete(room.code);
    logger.info(`room ${room.code} closed (${reason})`);
  };

  io.on('connection', (socket: Socket) => {
    state(socket).joinLimiter = new TokenBucket(5, 10);
    state(socket).inputLimiter = new TokenBucket(config.maxInputRate, config.maxInputRate * 2);
    state(socket).errorsSent = 0;
    state(socket).packetsReceived = 0;
    state(socket).packetsDropped = 0;

    const reportError = (message: string, code: string): void => {
      if (state(socket).errorsSent < MAX_REPORTED_ERRORS_PER_SOCKET) {
        state(socket).errorsSent += 1;
        socket.emit(EVENTS.error, { code, message });
      }
      logger.debug(`socket ${socket.id} error ${code}: ${message}`);
    };

    const fail = <T>(error: string, code: Ack<T>['code']): Ack<T> => ({ ok: false, error, code });

    // ---------------------------------------------------------------- create
    socket.on(
      EVENTS.gameCreateRoom,
      (payload: { controllerBaseUrl?: string } | undefined, ack?: (r: Ack<CreateRoomResult>) => void) => {
        if (typeof ack !== 'function') return;
        if (!state(socket).joinLimiter.tryConsume()) {
          return ack(fail('Too many requests', 'RATE_LIMITED'));
        }

        // Idempotent: a re-render/reconnect of the same game socket returns
        // the existing room instead of orphaning the previous one.
        const existing = rooms.byGameSocket(socket.id);
        if (existing && existing.pairing) {
          state(socket).role = 'game';
          state(socket).room = existing.code;
          clearGrace(existing.code);
          return ack({ ok: true, data: { room: summary(existing), pairing: existing.pairing } });
        }

        if (existing) rooms.handleDisconnect(socket.id);

        let code = generateRoomCode(secureRandomInt);
        let guard = 0;
        while (rooms.get(code) && guard++ < 50) code = generateRoomCode(secureRandomInt);
        if (rooms.get(code)) return ack(fail('Could not allocate a room code', 'SERVER_ERROR'));

        const resolved = resolveControllerBaseUrl({
          configured: config.controllerBaseUrl,
          clientBase: typeof payload?.controllerBaseUrl === 'string' ? payload.controllerBaseUrl : undefined,
          controllerPort: config.controllerPort,
          lanAddress,
        });
        if (resolved.replacedBase) {
          logger.warn(
            `controller base ${resolved.replacedBase} is not reachable from a phone — using ${resolved.base}`,
          );
        }
        const base = resolved.base;

        const pairing = buildPairing(base, code, secret, config.pairingTtlSec);
        const room = rooms.create(code, socket.id);
        room.pairing = pairing;
        state(socket).role = 'game';
        state(socket).room = code;
        clearGrace(code);
        logger.info(`room ${code} created by ${socket.id} (controller url: ${pairing.url})`);
        return ack({ ok: true, data: { room: summary(room), pairing } });
      },
    );

    // ------------------------------------------------------------------ join
    socket.on(
      EVENTS.controllerJoin,
      (payload: JoinRoomRequest | undefined, ack?: (r: Ack<JoinRoomResult>) => void) => {
        if (typeof ack !== 'function') return;
        if (!state(socket).joinLimiter.tryConsume()) {
          return ack(fail('Too many requests', 'RATE_LIMITED'));
        }
        if (!payload || typeof payload.code !== 'string') {
          return ack(fail('Room code is required', 'BAD_REQUEST'));
        }
        const code = payload.code.trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) {
          return ack(fail('Room code must be 6 characters', 'INVALID_ROOM'));
        }

        const tokenCheck = verifyPairingToken(secret, code, payload.token);
        const hasValidToken = tokenCheck.ok;
        if (payload.token && !hasValidToken) {
          return ack(
            fail(
              tokenCheck.reason === 'TOKEN_EXPIRED'
                ? 'Pairing code expired — scan the QR code again on the laptop'
                : 'Pairing code is not valid for this room',
              'TOKEN_EXPIRED' === tokenCheck.reason ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
            ),
          );
        }

        const existing = rooms.byControllerSocket(socket.id);
        if (existing && existing.code !== code) rooms.handleDisconnect(socket.id);

        // A valid token authorises taking over the slot (reconnect or a fresh
        // scan); otherwise the caller must ask for an explicit replacement.
        const replace = hasValidToken || payload.replace === true;
        const result = rooms.joinController(code, socket.id, replace);
        if (!result.ok) {
          const message =
            result.error === 'ROOM_NOT_FOUND'
              ? 'Room not found — create a new session on the laptop'
              : result.error === 'ROOM_CLOSED'
                ? 'This session has ended — pair again from the laptop'
                : 'Another controller is using this room. Enable "replace" to take over.';
          return ack(fail(message, result.error));
        }

        if (result.replaced && result.previousSocketId) {
          const previous = io.sockets.sockets.get(result.previousSocketId);
          if (previous) {
            previous.emit(EVENTS.roomClosed, { room: code, reason: 'controller replaced' });
            state(previous).room = undefined;
            state(previous).role = undefined;
          }
          logger.info(`room ${code}: controller slot taken over by ${socket.id}`);
        }

        state(socket).role = 'controller';
        state(socket).room = code;
        state(socket).errorsSent = 0;
        clearGrace(code);
        sendPresence(result.room);
        logger.info(`controller joined room ${code} (token=${hasValidToken ? 'valid' : 'none'})`);
        return ack({
          ok: true,
          data: { room: summary(result.room), role: 'controller', serverTime: Date.now() },
        });
      },
    );

    // ------------------------------------------------------------- game join
    socket.on(EVENTS.gameJoin, (payload: { code?: string } | undefined, ack?: (r: Ack<JoinRoomResult>) => void) => {
      if (typeof ack !== 'function') return;
      if (!state(socket).joinLimiter.tryConsume()) return ack(fail('Too many requests', 'RATE_LIMITED'));
      const code = typeof payload?.code === 'string' ? payload.code.trim().toUpperCase() : '';
      if (!/^[A-Z0-9]{6}$/.test(code)) return ack(fail('Room code must be 6 characters', 'INVALID_ROOM'));

      const result = rooms.joinGame(code, socket.id);
      if (!result.ok) {
        const message =
          result.error === 'ROOM_NOT_FOUND'
            ? 'Room no longer exists — pair again'
            : 'This session has ended — pair again';
        return ack(fail(message, result.error));
      }
      state(socket).role = 'game';
      state(socket).room = code;
      clearGrace(code);
      sendPresence(result.room);
      logger.info(`game rejoined room ${code}`);
      return ack({
        ok: true,
        data: { room: summary(result.room), role: 'game', serverTime: Date.now() },
      });
    });

    socket.on(EVENTS.gameCloseRoom, () => {
      const code = state(socket).room;
      const room = code ? rooms.get(code) : undefined;
      if (room && room.gameSocketId === socket.id) {
        closeRoom(room, 'session ended on laptop');
      }
    });

    // ----------------------------------------------------------- controller
    socket.on(EVENTS.controllerInput, (raw: unknown) => {
      if (state(socket).role !== 'controller' || !state(socket).room) {
        reportError('Not authorised to send input for this room', 'UNAUTHORIZED_ROLE');
        state(socket).packetsDropped += 1;
        return;
      }
      if (!state(socket).inputLimiter.tryConsume()) {
        state(socket).packetsDropped += 1;
        return;
      }
      state(socket).packetsReceived += 1;

      const result = validateInputPacket(raw);
      if (!result.ok) {
        state(socket).packetsDropped += 1;
        reportError(result.error, result.code);
        return;
      }
      if (result.value.room !== state(socket).room) {
        state(socket).packetsDropped += 1;
        reportError('Packet room does not match socket membership', 'UNAUTHORIZED_ROLE');
        return;
      }

      const accepted = rooms.recordInput(result.value.room, result.value.seq);
      if (!accepted.accepted) {
        state(socket).packetsDropped += 1; // stale/out-of-order — by design
        return;
      }

      const room = rooms.get(result.value.room);
      if (!room || !room.gameSocketId) return;
      const game = io.sockets.sockets.get(room.gameSocketId);
      if (game) game.emit(EVENTS.gameInput, result.value);
    });

    socket.on(EVENTS.controllerStatus, (raw: unknown) => {
      if (state(socket).role !== 'controller' || !state(socket).room) {
        reportError('Not authorised to report status', 'UNAUTHORIZED_ROLE');
        return;
      }
      if (!state(socket).joinLimiter.tryConsume()) return;
      const msg = raw as ControllerStatusMessage | undefined;
      if (
        !msg ||
        typeof msg.room !== 'string' ||
        msg.room !== state(socket).room ||
        typeof msg.calibrated !== 'boolean' ||
        typeof msg.ready !== 'boolean' ||
        typeof msg.hz !== 'number' ||
        !Number.isFinite(msg.hz)
      ) {
        reportError('Malformed status message', 'BAD_REQUEST');
        return;
      }
      const code = state(socket).room;
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      rooms.setStatus(room.code, {
        calibrated: msg.calibrated,
        ready: msg.ready,
        hz: Math.max(0, Math.min(1000, msg.hz)),
      });
      sendPresence(room);
    });

    // --------------------------------------------------------------- latency
    socket.on(EVENTS.latencyPing, (raw: unknown, ack?: (r: LatencyPong) => void) => {
      const ping = raw as LatencyPing | undefined;
      const seq = ping && Number.isInteger(ping.seq) ? ping.seq : 0;
      const t0 = ping && Number.isFinite(ping.t0) ? ping.t0 : 0;
      const pong: LatencyPong = { seq, t0, serverTime: Date.now() };
      if (typeof ack === 'function') ack(pong);
      else socket.emit(EVENTS.latencyPong, pong);
    });

    socket.on(EVENTS.heartbeat, (_raw: unknown, ack?: (r: { serverTime: number }) => void) => {
      if (typeof ack === 'function') ack({ serverTime: Date.now() });
    });

    // ------------------------------------------------------------ disconnect
    socket.on('disconnect', () => {
      const freed = rooms.handleDisconnect(socket.id);
      if (!freed) return;
      const { room, role } = freed;
      logger.info(`room ${room.code}: ${role} ${socket.id} disconnected`);

      if (role === 'controller') {
        sendPresence(room);
        if (room.gameSocketId === null) clearGrace(room.code);
        return;
      }

      // Game left: give it a grace period to reconnect before closing.
      if (room.controllerSocketId !== null && !room.closed) {
        clearGrace(room.code);
        const timer = setTimeout(() => {
          const current = rooms.get(room.code);
          if (current && current.gameSocketId === null) {
            closeRoom(current, 'laptop disconnected');
          }
        }, config.gameGraceMs);
        gameGraceTimers.set(room.code, timer);
        logger.info(`room ${room.code}: game grace period ${config.gameGraceMs}ms started`);
      } else if (room.controllerSocketId === null) {
        // Nobody left in the room — let the sweeper remove it.
        rooms.delete(room.code);
      }
    });
  });

  // ------------------------------------------------------------- background
  const sweepTimer = setInterval(() => {
    const removed = rooms.sweep();
    if (removed.length > 0) logger.debug(`swept rooms: ${removed.join(', ')}`);
    for (const code of removed) clearGrace(code);
  }, 10_000);
  sweepTimer.unref?.();

  const heartbeatTimer = setInterval(() => {
    for (const [, room] of new Map(rooms.list().map((r) => [r.code, r] as const))) {
      for (const socketId of [room.gameSocketId, room.controllerSocketId]) {
        const target = socketId ? io.sockets.sockets.get(socketId) : undefined;
        if (target) target.emit(EVENTS.heartbeat, { serverTime: Date.now() });
      }
    }
  }, 5_000);
  heartbeatTimer.unref?.();

  return {
    io,
    rooms,
    config,
    logger,
    secret,
    close: async () => {
      clearInterval(sweepTimer);
      clearInterval(heartbeatTimer);
      for (const t of gameGraceTimers.values()) clearTimeout(t);
      gameGraceTimers.clear();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}

export { PROTOCOL_VERSION };
