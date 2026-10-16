export interface ServerConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  pairingSecret: string;
  pairingTtlSec: number;
  maxInputRate: number;
  inputStallMs: number;
  gameGraceMs: number;
  roomTtlSeconds: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  /** Explicit pairing base (`CONTROLLER_BASE_URL`) — wins over auto-detection. */
  controllerBaseUrl: string;
  /** Controller dev-server port used when building the pairing URL. */
  controllerPort: number;
  /** Test/ops escape hatch for the detected LAN address (`LAN_ADDRESS_OVERRIDE`). */
  lanAddressOverride: string;
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Pure, testable environment parsing. Never throws on bad values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const level = (env['LOG_LEVEL'] ?? 'info') as ServerConfig['logLevel'];
  return {
    port: int(env['PORT'], 3001, 0, 65535),
    host: env['HOST'] && env['HOST'].length > 0 ? env['HOST'] : '0.0.0.0',
    corsOrigins: (env['CORS_ORIGINS'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    pairingSecret: env['PAIRING_SECRET'] ?? '',
    pairingTtlSec: int(env['PAIRING_TOKEN_TTL'], 900, 30, 86400),
    maxInputRate: int(env['MAX_INPUT_RATE'], 90, 10, 500),
    inputStallMs: int(env['INPUT_STALL_MS'], 500, 100, 10000),
    gameGraceMs: int(env['GAME_GRACE_MS'], 30000, 50, 600000),
    roomTtlSeconds: int(env['ROOM_TTL_SECONDS'], 1800, 10, 86400),
    logLevel: LOG_LEVELS.includes(level) ? level : 'info',
    controllerBaseUrl: (env['CONTROLLER_BASE_URL'] ?? '').trim(),
    controllerPort: int(env['CONTROLLER_PORT'], 5173, 1, 65535),
    lanAddressOverride: (env['LAN_ADDRESS_OVERRIDE'] ?? '').trim(),
  };
}
