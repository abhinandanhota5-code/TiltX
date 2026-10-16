import type { ConnectionPhase, ControllerInputPacket } from '@tiltx/shared';

export interface CurrentInput {
  steering: number;
  throttle: number;
  brake: number;
  boost: boolean;
  seq: number;
  ts: number;
  receivedAt: number;
}

export interface GameSnapshot {
  phase: ConnectionPhase;
  serverUrl: string;
  roomCode: string | null;
  pairingUrl: string | null;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  controllerConnected: boolean;
  controllerCalibrated: boolean;
  controllerReady: boolean;
  controllerReason: string | null;
  inputHz: number;
  rttMs: number | null;
  lastPacketAt: number;
  packetCount: number;
  packetsDropped: number;
  errorMessage: string | null;
  roomClosedReason: string | null;
  reconnectAttempts: number;
  socketId: string | null;
}
