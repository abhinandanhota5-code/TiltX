import {
  CLIENT_DEFAULT_INPUT_HZ,
  ControllerStatusMessage,
  ConnectionPhase,
  EVENTS,
  JoinRoomResult,
  LatencyPong,
  MAX_INPUT_HZ,
  MIN_INPUT_HZ,
  MIN_CALIBRATION_SAMPLES,
  MotionPipeline,
  MotionSample,
  PROTOCOL_VERSION,
  computeBaseline,
  normalizeRoomCode,
} from '@tiltx/shared';
import { io, Socket } from 'socket.io-client';
import {
  initialConfig,
  persist,
  readStored,
  STORAGE_KEYS,
  RuntimeConfig,
  clamp,
} from '../config.js';
import {
  MotionReading,
  MotionSource,
  SensorState,
  createMotionSource,
  readOrientationDeg,
} from './motionSource.js';
import { createStore, Store } from './store.js';

const CALIBRATION_WINDOW_MS = 1500;
const BOOST_LATCH_MS = 250;
const PING_INTERVAL_MS = 2000;
const STATUS_INTERVAL_MS = 1500;
const UI_PUBLISH_INTERVAL_MS = 80;
/** How long to keep streaming neutral input after the player stops, so the game settles. */
const STOP_TAIL_MS = 400;

export interface ControllerSnapshot {
  phase: ConnectionPhase;
  serverUrl: string;
  roomCode: string | null;
  /** Server confirmed this socket owns the room's controller slot. */
  paired: boolean;
  needsPairing: boolean;
  sensorState: SensorState;
  sensorMessage: string;
  calibrated: boolean;
  calibrating: boolean;
  calibrationProgress: number;
  calibrationMessage: string | null;
  streaming: boolean;
  sensitivity: number;
  smoothing: number;
  invertPitch: boolean;
  inputHz: number;
  measuredHz: number;
  rttMs: number | null;
  lastServerMessageAt: number;
  errorMessage: string | null;
  reconnectAttempts: number;
  packetsSent: number;
  sampleCount: number;
  socketId: string | null;
  nativeSource: boolean;
}

export interface LiveControl {
  steering: number;
  throttle: number;
  brake: number;
  boostCooldownMs: number;
  boostActive: boolean;
  deviation: number;
  tiltLateral: number;
  tiltPitch: number;
}

const INITIAL_SNAPSHOT: ControllerSnapshot = {
  phase: 'disconnected',
  serverUrl: initialConfig.serverUrl,
  roomCode: initialConfig.roomCode,
  paired: false,
  needsPairing: initialConfig.roomCode === null,
  sensorState: 'unknown',
  sensorMessage: 'Motion sensors have not been enabled yet.',
  calibrated: false,
  calibrating: false,
  calibrationProgress: 0,
  calibrationMessage: null,
  streaming: false,
  sensitivity: Number(readStored('sensitivity', '1')) || 1,
  smoothing: Number(readStored('smoothing', '0.35')),
  invertPitch: readStored('invertPitch', 'false') === 'true',
  inputHz: initialConfig.inputHz || CLIENT_DEFAULT_INPUT_HZ,
  measuredHz: 0,
  rttMs: null,
  lastServerMessageAt: 0,
  errorMessage: null,
  reconnectAttempts: 0,
  packetsSent: 0,
  sampleCount: 0,
  socketId: null,
  nativeSource: false,
};

/**
 * Owns everything that must not depend on React: the sensor stream, the
 * calibration window, the socket, the bounded send loop, latency probes and
 * reconnection. React only reads snapshots and calls commands.
 */
export class ControllerSession {
  readonly store: Store<ControllerSnapshot>;

  private socket: Socket | null = null;
  private source: MotionSource | null = null;
  private pipeline: MotionPipeline;
  private token: string | null = null;

  private readonly live: LiveControl = {
    steering: 0,
    throttle: 0,
    brake: 0,
    boostCooldownMs: 0,
    boostActive: false,
    deviation: 0,
    tiltLateral: 0,
    tiltPitch: 0,
  };

  private calibrationSamples: MotionReading[] = [];
  private calibrationStartedAt = 0;
  private calibrationTimer: number | null = null;

  private sendTimer: number | null = null;
  private statusTimer: number | null = null;
  private pingTimer: number | null = null;
  private stopTailUntil = 0;

  private seq = 0;
  private sentTimestamps: number[] = [];
  private lastPublish = 0;
  private lastPingAt = 0;
  private pingSeq = 0;
  private pendingBoost = false;
  private boostLatchUntil = 0;
  private destroyed = false;
  private samples = 0;
  private packetsSent = 0;
  private permissionsRequested = false;
  private intentionalDisconnect = false;

  constructor(private config: RuntimeConfig = initialConfig) {
    const storedUrl = readStored('serverUrl', config.serverUrl);
    this.config = { ...config, serverUrl: storedUrl };
    this.pipeline = new MotionPipeline({
      sensitivity: INITIAL_SNAPSHOT.sensitivity,
      smoothing: INITIAL_SNAPSHOT.smoothing,
      invertPitch: INITIAL_SNAPSHOT.invertPitch,
      deadzone: 0.07,
      steerRangeDeg: 38,
      pitchRangeDeg: 32,
    });
    this.store = createStore<ControllerSnapshot>({
      ...INITIAL_SNAPSHOT,
      serverUrl: this.config.serverUrl,
      roomCode: config.roomCode,
      inputHz: config.inputHz,
    });
  }

  // ------------------------------------------------------------------ setup

  start(): void {
    this.connect();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.stopTimers();
    this.source?.stop();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private socketUrl(): string | undefined {
    const url = this.config.serverUrl.trim();
    return url.length > 0 ? url : undefined;
  }

  private connect(): void {
    this.intentionalDisconnect = true;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.intentionalDisconnect = false;

    this.publish({ phase: 'connecting', errorMessage: null, needsPairing: false });

    const socket = io(this.socketUrl(), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 400,
      reconnectionDelayMax: 4000,
      reconnectionAttempts: 30,
      timeout: 6000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.publish({
        phase: 'connected',
        socketId: socket.id ?? null,
        reconnectAttempts: 0,
        lastServerMessageAt: Date.now(),
      });
      if (this.config.roomCode) {
        void this.joinRoom(this.config.roomCode, this.token ?? this.config.pairingToken);
      }
    });

    socket.on('disconnect', () => {
      this.publish({
        phase: this.intentionalDisconnect ? 'disconnected' : 'reconnecting',
        paired: false,
        streaming: false,
        socketId: null,
        rttMs: null,
      });
      this.safeNeutral();
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      this.publish({ phase: 'reconnecting', reconnectAttempts: attempt });
    });

    socket.on('connect_error', (error) => {
      this.publish({
        phase: 'error',
        errorMessage:
          this.config.serverUrl.trim().length > 0
            ? `Cannot reach the TiltX server at ${this.config.serverUrl}. Check the address and that the backend is running.`
            : `Cannot reach the laptop backend (${error.message}). Make sure the server is running and you are on the same Wi-Fi network.`,
      });
    });

    socket.on(EVENTS.error, (payload: { message?: string }) => {
      this.publish({ errorMessage: payload?.message ?? 'The server rejected a request.' });
    });

    socket.on(EVENTS.roomClosed, (payload: { reason?: string }) => {
      const reason = payload?.reason ?? 'session ended';
      this.publish({
        paired: false,
        streaming: false,
        phase: reason === 'controller replaced' ? 'error' : 'disconnected',
        needsPairing: reason !== 'controller replaced',
        roomCode: reason === 'controller replaced' ? this.config.roomCode : null,
        errorMessage:
          reason === 'controller replaced'
            ? 'Another device took over this controller slot.'
            : `Session ended (${reason}). Scan the QR code again on the laptop to pair.`,
      });
      this.safeNeutral();
    });

    socket.on(EVENTS.latencyPong, (pong: LatencyPong) => {
      if (typeof pong?.t0 !== 'number') return;
      const rtt = performance.now() - pong.t0;
      if (Number.isFinite(rtt) && rtt >= 0 && rtt < 10_000) {
        this.publish({ rttMs: rtt, lastServerMessageAt: Date.now() }, true);
      }
    });

    socket.on(EVENTS.heartbeat, () => {
      this.publish({ lastServerMessageAt: Date.now() }, true);
    });
  }

  private async joinRoom(code: string, token: string | null): Promise<void> {
    const socket = this.socket;
    if (!socket) return;

    const attempt = async (replace: boolean): Promise<boolean> => {
      const ack = (await socket.emitWithAck(EVENTS.controllerJoin, {
        code,
        ...(token ? { token } : {}),
        replace,
      })) as { ok: boolean; data?: JoinRoomResult; error?: string; code?: string };

      if (ack.ok && ack.data) {
        if (token) this.token = token;
        this.config = { ...this.config, roomCode: code };
        this.publish({
          phase: 'connected',
          roomCode: code,
          paired: true,
          needsPairing: false,
          errorMessage: null,
        });
        this.startTimers();
        return true;
      }

      // The slot may still be held by our previous socket: take it over.
      if (ack.code === 'CONTROLLER_TAKEN' && !replace) {
        return attempt(true);
      }

      const needsRepair = ack.code === 'ROOM_NOT_FOUND' || ack.code === 'ROOM_CLOSED';
      if (needsRepair) this.config = { ...this.config, roomCode: null };
      this.publish({
        paired: false,
        streaming: false,
        needsPairing: true,
        roomCode: null,
        phase: needsRepair ? 'error' : 'disconnected',
        errorMessage: ack.error ?? 'Could not join the room.',
      });
      return false;
    };

    await attempt(false);
  }

  /** Pair manually with a room code typed by the user. */
  async pairWithCode(input: string): Promise<void> {
    const code = normalizeRoomCode(input);
    if (!code) {
      this.publish({ errorMessage: 'Room codes are six characters, e.g. K7M2QX.' });
      return;
    }
    this.token = null;
    this.config = { ...this.config, roomCode: code, pairingToken: null };
    if (this.socket?.connected) {
      await this.joinRoom(code, null);
    } else {
      this.publish({ roomCode: code, needsPairing: false, phase: 'connecting' });
      this.connect();
    }
  }

  unpair(): void {
    this.publish({
      roomCode: null,
      paired: false,
      streaming: false,
      needsPairing: true,
      phase: this.socket?.connected ? 'connected' : 'disconnected',
      errorMessage: null,
    });
    this.config = { ...this.config, roomCode: null, pairingToken: null };
  }

  setServerUrl(url: string): void {
    const clean = url.trim();
    this.config = { ...this.config, serverUrl: clean };
    persist('serverUrl', clean);
    this.publish({ serverUrl: clean, errorMessage: null });
    this.connect();
  }

  clearError(): void {
    this.publish({ errorMessage: null });
  }

  // ----------------------------------------------------------------- sensors

  private ensureSource(): MotionSource {
    if (!this.source) {
      this.source = createMotionSource(
        {
          reading: (reading) => this.onReading(reading),
          state: (state, message) => {
            this.publish({ sensorState: state, sensorMessage: message });
          },
        },
        { isNativePlatform: this.isNative() },
      );
      const { state, message } = this.source.currentState();
      this.publish({ sensorState: state, sensorMessage: message, nativeSource: this.source.kind === 'capacitor' });
    }
    return this.source;
  }

  private isNative(): boolean {
    const capacitor = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return typeof capacitor?.isNativePlatform === 'function' ? capacitor.isNativePlatform() : false;
  }

  async enableMotion(): Promise<void> {
    const source = this.ensureSource();
    this.permissionsRequested = true;
    await source.requestPermission();
  }

  private onReading(reading: MotionReading): void {
    if (this.destroyed) return;

    const now = performance.now();
    const control = this.pipeline.push(reading, reading.gyro);

    this.live.steering = control.steering;
    this.live.throttle = control.throttle;
    this.live.brake = control.brake;
    this.live.deviation = control.deviation;
    this.live.tiltLateral = control.tilt.lateral;
    this.live.tiltPitch = control.tilt.pitch;

    if (control.boost) {
      this.pendingBoost = true;
      this.boostLatchUntil = now + BOOST_LATCH_MS;
    }
    this.live.boostActive = this.pendingBoost || now < this.boostLatchUntil;

    if (this.calibrationTimer !== null) {
      this.calibrationSamples.push(reading);
      const progress = clamp(
        (now - this.calibrationStartedAt) / CALIBRATION_WINDOW_MS,
        0,
        1,
      );
      this.publish({ calibrationProgress: progress }, true);
      if (progress >= 1) this.finishCalibration();
    }

    this.samples += 1;
    this.publish({ sampleCount: this.samples }, true);
  }

  beginCalibration(): void {
    if (!this.permissionsRequested) {
      void this.enableMotion();
    }
    this.calibrationSamples = [];
    this.calibrationStartedAt = performance.now();
    this.calibrationTimer = 1; // non-null marker: collection is active
    this.publish({
      calibrating: true,
      calibrationProgress: 0,
      calibrationMessage: 'Hold the phone comfortably and keep it steady…',
      errorMessage: null,
    });
  }

  cancelCalibration(): void {
    this.calibrationTimer = null;
    this.calibrationSamples = [];
    this.publish({ calibrating: false, calibrationProgress: 0, calibrationMessage: null });
  }

  private finishCalibration(): void {
    this.calibrationTimer = null;
    const samples: MotionSample[] = this.calibrationSamples;
    this.calibrationSamples = [];
    const baseline = computeBaseline(samples, Date.now());

    if (!baseline || baseline.samples < MIN_CALIBRATION_SAMPLES) {
      this.publish({
        calibrating: false,
        calibrationProgress: 0,
        calibrated: false,
        calibrationMessage:
          'Calibration failed — the phone moved too much. Hold it still and try again.',
      });
      return;
    }

    this.pipeline.setBaseline(baseline);
    this.live.steering = 0;
    this.live.throttle = 0;
    this.live.brake = 0;
    this.publish({
      calibrating: false,
      calibrated: true,
      calibrationProgress: 1,
      calibrationMessage: `Calibration saved (${baseline.samples} samples, jitter ${baseline.spread.toFixed(2)} m/s²).`,
    });
    this.sendStatus();
  }

  resetCalibration(): void {
    this.pipeline.setBaseline(null);
    this.publish({
      calibrated: false,
      calibrationMessage: 'Calibration cleared. Calibrate before driving.',
    });
    this.sendStatus();
  }

  // --------------------------------------------------------------- settings

  setSensitivity(value: number): void {
    const sensitivity = clamp(value, 0.25, 3);
    persist('sensitivity', String(sensitivity));
    this.pipeline.setOptions({ sensitivity });
    this.publish({ sensitivity });
  }

  setSmoothing(value: number): void {
    const smoothing = clamp(value, 0, 0.9);
    persist('smoothing', String(smoothing));
    this.pipeline.setOptions({ smoothing });
    this.publish({ smoothing });
  }

  setInvertPitch(value: boolean): void {
    persist('invertPitch', String(value));
    this.pipeline.setOptions({ invertPitch: value });
    this.publish({ invertPitch: value });
  }

  setInputHz(value: number): void {
    const hz = clamp(Math.round(value), MIN_INPUT_HZ, MAX_INPUT_HZ);
    this.config = { ...this.config, inputHz: hz };
    this.publish({ inputHz: hz });
    if (this.sendTimer !== null) {
      this.stopSendLoop();
      this.startSendLoop();
    }
  }

  // --------------------------------------------------------------- streaming

  startStreaming(): void {
    const snapshot = this.store.getSnapshot();
    if (!snapshot.paired) {
      this.publish({ errorMessage: 'Not connected to a room yet. Pair with the laptop first.' });
      return;
    }
    if (!snapshot.calibrated) {
      this.publish({ errorMessage: 'Calibrate the phone before starting.' });
      return;
    }
    if (snapshot.sensorState !== 'ready') {
      this.publish({ errorMessage: snapshot.sensorMessage || 'Motion sensors are not ready.' });
      return;
    }
    this.stopTailUntil = 0;
    this.publish({ streaming: true, errorMessage: null });
    this.startSendLoop();
    this.sendStatus();
  }

  stopStreaming(): void {
    if (this.store.getSnapshot().streaming) {
      // Keep sending neutral frames briefly so the game settles safely.
      this.pendingBoost = false;
      this.stopTailUntil = performance.now() + STOP_TAIL_MS;
      this.publish({ streaming: false });
      this.sendStatus();
    }
  }

  toggleStreaming(): void {
    if (this.store.getSnapshot().streaming) this.stopStreaming();
    else this.startStreaming();
  }

  private startSendLoop(): void {
    if (this.sendTimer !== null) return;
    const interval = 1000 / clamp(this.config.inputHz, MIN_INPUT_HZ, MAX_INPUT_HZ);
    this.sendTimer = window.setInterval(() => this.tick(), interval);
  }

  private stopSendLoop(): void {
    if (this.sendTimer !== null) {
      window.clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
  }

  private tick(): void {
    const socket = this.socket;
    const snapshot = this.store.getSnapshot();
    if (!socket?.connected || !snapshot.paired) return;

    const streaming = snapshot.streaming;
    const inTail = performance.now() < this.stopTailUntil;

    if (!streaming && !inTail) {
      if (this.sendTimer !== null && this.stopTailUntil !== 0) {
        this.stopTailUntil = 0;
        this.stopSendLoop();
      }
      return;
    }

    const boost = this.pendingBoost;
    if (boost) this.pendingBoost = false;

    const packet = {
      v: PROTOCOL_VERSION,
      room: snapshot.roomCode as string,
      seq: this.seq++,
      ts: Date.now(),
      steering: streaming ? this.live.steering : 0,
      throttle: streaming ? this.live.throttle : 0,
      brake: streaming ? this.live.brake : 0,
      boost: streaming ? boost : false,
      meta: {
        orientation: Math.round(readOrientationDeg() / 90) * 90,
        calibrated: snapshot.calibrated,
      },
    };

    socket.emit(EVENTS.controllerInput, packet);
    this.sentTimestamps.push(performance.now());
    if (this.sentTimestamps.length > 120) this.sentTimestamps.shift();
    this.packetsSent += 1;
    if (this.packetsSent % 20 === 0) this.publish({ packetsSent: this.packetsSent }, true);
  }

  // --------------------------------------------------------------- messaging

  private startTimers(): void {
    if (this.statusTimer === null) {
      this.statusTimer = window.setInterval(() => this.sendStatus(), STATUS_INTERVAL_MS);
    }
    if (this.pingTimer === null) {
      this.pingTimer = window.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
      this.sendPing();
    }
  }

  private stopTimers(): void {
    this.stopSendLoop();
    if (this.statusTimer !== null) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private sendStatus(): void {
    const socket = this.socket;
    const snapshot = this.store.getSnapshot();
    if (!socket?.connected || !snapshot.paired || !snapshot.roomCode) return;
    const message: ControllerStatusMessage = {
      room: snapshot.roomCode,
      calibrated: snapshot.calibrated,
      ready: snapshot.calibrated && snapshot.sensorState === 'ready',
      hz: Math.round(snapshot.measuredHz),
    };
    socket.emit(EVENTS.controllerStatus, message);
  }

  private sendPing(): void {
    const socket = this.socket;
    if (!socket?.connected) return;
    this.lastPingAt = performance.now();
    this.pingSeq += 1;
    socket.emit(EVENTS.latencyPing, { seq: this.pingSeq, t0: this.lastPingAt });
  }

  private safeNeutral(): void {
    this.pendingBoost = false;
    this.live.steering = 0;
    this.live.throttle = 0;
    this.live.brake = 0;
    this.live.boostActive = false;
  }

  // ------------------------------------------------------------------ output

  /** Live values for rAF-driven widgets — deliberately outside React state. */
  getLive(): LiveControl {
    const now = performance.now();
    const snapshot = this.store.getSnapshot();
    return {
      ...this.live,
      boostActive: this.live.boostActive || now < this.boostLatchUntil,
      boostCooldownMs: snapshot.calibrated ? this.pipeline.shakeCooldownRemaining(now) : 0,
    };
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      // Backgrounding stops sensor events; make sure the car cannot keep
      // accelerating on stale input.
      this.safeNeutral();
      if (this.store.getSnapshot().streaming) {
        this.stopStreaming();
      }
    }
  };

  private measureHz(): number {
    const now = performance.now();
    const recent = this.sentTimestamps.filter((t) => now - t < 1000);
    return recent.length;
  }

  /** Publishes a partial snapshot, throttled for continuous values. */
  private publish(patch: Partial<ControllerSnapshot>, throttled = false): void {
    const now = performance.now();
    if (throttled && now - this.lastPublish < UI_PUBLISH_INTERVAL_MS) return;
    this.lastPublish = now;
    this.store.update((previous) => ({ ...previous, ...patch, measuredHz: this.measureHz() }));
  }
}

export { CALIBRATION_WINDOW_MS };
