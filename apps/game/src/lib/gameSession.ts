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
import { io, Socket } from 'socket.io-client';
import { createStore, Store } from './store.js';
import type { CurrentInput, GameSnapshot } from './types.js';
import { GameConfig, loadGameConfig, resolvePairingBase, pairingBaseIsLoopback } from '../config.js';

const INITIAL_SNAPSHOT: GameSnapshot = {
  phase: 'disconnected',
  serverUrl: '',
  roomCode: null,
  pairingUrl: null,
  pairingCode: null,
  pairingExpiresAt: null,
  controllerConnected: false,
  controllerCalibrated: false,
  controllerReady: false,
  controllerReason: null,
  inputHz: 0,
  rttMs: null,
  lastPacketAt: 0,
  packetCount: 0,
  packetsDropped: 0,
  errorMessage: null,
  roomClosedReason: null,
  reconnectAttempts: 0,
  socketId: null,
};

const PING_INTERVAL_MS = 2000;
const UI_PUBLISH_INTERVAL_MS = 80;

export class GameSession {
  readonly store: Store<GameSnapshot>;
  readonly input: CurrentInput = {
    steering: 0,
    throttle: 0,
    brake: 0,
    boost: false,
    seq: -1,
    ts: 0,
    receivedAt: 0,
  };

  private readonly config: GameConfig = loadGameConfig();
  private socket: Socket | null = null;
  private pingTimer: number | null = null;
  private statusTimer: number | null = null;
  private lastPublish = 0;
  private packetTimestamps: number[] = [];
  private intentionalDisconnect = false;
  private roomCode: string | null = null;
  private destroyed = false;
  private boostPrev = false;
  private boostPending = false;

  constructor() {
    this.store = createStore<GameSnapshot>({ ...INITIAL_SNAPSHOT });
  }

  start(): void {
    if (this.destroyed) return;
    this.connect();
  }

  destroy(): void {
    this.destroyed = true;
    this.stopTimers();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private socketUrl(): string | undefined {
    const url = (this.config.serverUrl ?? '').trim();
    return url.length > 0 ? url : undefined;
  }

  private connect(): void {
    this.intentionalDisconnect = true;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.intentionalDisconnect = false;

    const socket = io(this.socketUrl(), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 400,
      reconnectionDelayMax: 4000,
      reconnectionAttempts: 30,
      timeout: 6000,
    });
    this.socket = socket;

    this.publish({
      phase: 'connecting',
      serverUrl: this.socketUrl() ?? (typeof window !== 'undefined' ? window.location.origin : ''),
      errorMessage: null,
      roomClosedReason: null,
    });

    socket.on('connect', () => {
      this.publish({
        phase: 'connected',
        socketId: socket.id ?? null,
        reconnectAttempts: 0,
        rttMs: null,
      });
      void this.createOrRejoin();
    });

    socket.on('disconnect', () => {
      this.publish({
        phase: this.intentionalDisconnect ? 'disconnected' : 'reconnecting',
        socketId: null,
        controllerConnected: false,
        controllerCalibrated: false,
        controllerReady: false,
        controllerReason: 'controller disconnected',
      });
      this.stopTimers();
      this.clearInput();
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      this.publish({ phase: 'reconnecting', reconnectAttempts: attempt });
    });

    socket.on('connect_error', (error) => {
      this.publish({
        phase: 'error',
        errorMessage: error.message
          ? `Cannot reach the TiltX server: ${error.message}`
          : 'Cannot reach the TiltX server.',
      });
    });

    socket.on(EVENTS.error, (payload: { message?: string }) => {
      this.publish({ errorMessage: payload?.message ?? 'The server rejected a request.' });
    });

    socket.on(EVENTS.roomClosed, (payload: { reason?: string }) => {
      this.publish({
        phase: 'disconnected',
        roomClosedReason: payload?.reason ?? 'session ended',
        controllerConnected: false,
        controllerCalibrated: false,
        controllerReady: false,
        controllerReason: payload?.reason ?? 'session ended',
        pairingUrl: null,
        pairingExpiresAt: null,
      });
      this.stopTimers();
      this.clearInput();
    });

    socket.on(EVENTS.gameControllerPresence, (payload: ControllerPresence) => {
      this.publish({
        controllerConnected: payload.controllerConnected,
        controllerCalibrated: payload.calibrated,
        controllerReady: payload.ready,
        controllerReason: payload.reason ?? (payload.controllerConnected ? null : 'controller disconnected'),
      });
    });

    socket.on(EVENTS.gameInput, (packet: ControllerInputPacket) => {
      this.handleInput(packet);
    });

    socket.on(EVENTS.latencyPong, (pong: LatencyPong) => {
      if (typeof pong?.t0 === 'number') {
        const rtt = performance.now() - pong.t0;
        if (Number.isFinite(rtt) && rtt >= 0 && rtt < 8000) {
          this.publish({ rttMs: rtt }, true);
        }
      }
    });

    socket.on(EVENTS.heartbeat, () => {
      void 0;
    });

    this.startTimers();
  }

  private async createOrRejoin(): Promise<void> {
    const socket = this.socket;
    if (!socket || !socket.connected) return;

    const existing = this.roomCode;
    if (existing) {
      const ack = (await socket.emitWithAck(EVENTS.gameJoin, { code: existing })) as Ack<JoinRoomResult>;
      if (ack.ok && ack.data) {
        this.publish({
          roomCode: existing,
          phase: 'connected',
          errorMessage: null,
          roomClosedReason: null,
        });
        return;
      }
    }

    const base = resolvePairingBase(this.config);
    if (pairingBaseIsLoopback(base)) {
      this.publish({
        errorMessage:
          'VITE_PAIRING_BASE_URL points at localhost, which a phone cannot reach. Clear it (the server then uses the detected LAN address) or set it to http://<lan-ip>:<controller-port>.',
      });
    }

    const ack = (await socket.emitWithAck(EVENTS.gameCreateRoom, {
      controllerBaseUrl: base || undefined,
    })) as Ack<CreateRoomResult>;
    if (ack.ok && ack.data) {
      this.roomCode = ack.data.room.code;
      this.publish({
        roomCode: ack.data.room.code,
        pairingUrl: ack.data.pairing.url,
        pairingCode: ack.data.pairing.code,
        pairingExpiresAt: ack.data.pairing.expiresAt,
        phase: 'connected',
        controllerConnected: ack.data.room.controllerConnected,
        errorMessage: null,
      });
      return;
    }

    this.publish({
      phase: 'error',
      errorMessage: ack.error ?? 'Could not create a room.',
    });
  }

  endSession(): void {
    const socket = this.socket;
    if (socket?.connected) {
      socket.emit(EVENTS.gameCloseRoom);
    } else {
      this.publish({ phase: 'disconnected', roomClosedReason: 'session ended on laptop' });
    }
  }

  consumeBoostRequest(): boolean {
    if (!this.boostPending) return false;
    this.boostPending = false;
    return true;
  }

  private handleInput(packet: ControllerInputPacket): void {
    const now = performance.now();
    const v = packet.v ?? 1;
    if (v !== PROTOCOL_VERSION) {
      this.publish({ packetsDropped: this.store.getSnapshot().packetsDropped + 1 }, true);
      return;
    }

    this.packetTimestamps.push(now);
    if (this.packetTimestamps.length > 120) this.packetTimestamps.shift();

    const receivedAt = now;
    const boost = Boolean(packet.boost);
    if (!this.boostPrev && boost) {
      this.boostPending = true;
    }
    this.boostPrev = boost;

    this.input.steering = packet.steering;
    this.input.throttle = packet.throttle;
    this.input.brake = packet.brake;
    this.input.boost = boost;
    this.input.seq = packet.seq;
    this.input.ts = packet.ts;
    this.input.receivedAt = receivedAt;

    this.publish(
      {
        packetCount: this.store.getSnapshot().packetCount + 1,
        lastPacketAt: now,
        inputHz: this.measureHz(now),
      },
      true,
    );
  }

  private measureHz(now: number): number {
    const cutoff = now - 1000;
    while (this.packetTimestamps.length > 0 && this.packetTimestamps[0] < cutoff) {
      this.packetTimestamps.shift();
    }
    return this.packetTimestamps.length;
  }

  private clearInput(): void {
    this.boostPrev = false;
    this.boostPending = false;
    this.input.steering = 0;
    this.input.throttle = 0;
    this.input.brake = 0;
    this.input.boost = false;
    this.input.seq = -1;
  }

  private startTimers(): void {
    if (this.pingTimer === null) {
      this.pingTimer = window.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
      this.sendPing();
    }
  }

  private stopTimers(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private sendPing(): void {
    const socket = this.socket;
    if (!socket?.connected) return;
    const t0 = performance.now();
    socket.emit(EVENTS.latencyPing, { seq: 0, t0 }, (pong: LatencyPong) => {
      const rtt = performance.now() - pong.t0;
      if (Number.isFinite(rtt) && rtt >= 0 && rtt < 8000) {
        this.publish({ rttMs: rtt }, true);
      }
    });
  }

  private publish(patch: Partial<GameSnapshot>, throttled = false): void {
    if (this.destroyed) return;
    const now = performance.now();
    if (throttled && now - this.lastPublish < UI_PUBLISH_INTERVAL_MS) return;
    this.lastPublish = now;
    this.store.update((prev: GameSnapshot) => ({ ...prev, ...patch }));
  }
}
