import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3001);
    expect(config.host).toBe('0.0.0.0');
    expect(config.pairingTtlSec).toBe(900);
    expect(config.maxInputRate).toBe(90);
    expect(config.inputStallMs).toBe(500);
    expect(config.roomTtlSeconds).toBe(1800);
    expect(config.gameGraceMs).toBe(30000);
    expect(config.logLevel).toBe('info');
    expect(config.corsOrigins).toEqual([]);
    expect(config.controllerBaseUrl).toBe('');
    expect(config.controllerPort).toBe(5173);
    expect(config.lanAddressOverride).toBe('');
  });

  it('parses overrides', () => {
    const config = loadConfig({
      PORT: '4123',
      HOST: '127.0.0.1',
      CORS_ORIGINS: 'http://localhost:5173, http://192.168.1.4:5174',
      LOG_LEVEL: 'debug',
      MAX_INPUT_RATE: '60',
      CONTROLLER_BASE_URL: 'http://10.82.163.203:5175',
      CONTROLLER_PORT: '5175',
      LAN_ADDRESS_OVERRIDE: '10.82.163.203',
    });
    expect(config.port).toBe(4123);
    expect(config.host).toBe('127.0.0.1');
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'http://192.168.1.4:5174']);
    expect(config.logLevel).toBe('debug');
    expect(config.maxInputRate).toBe(60);
    expect(config.controllerBaseUrl).toBe('http://10.82.163.203:5175');
    expect(config.controllerPort).toBe(5175);
    expect(config.lanAddressOverride).toBe('10.82.163.203');
  });

  it('ignores nonsense instead of throwing', () => {
    const config = loadConfig({ PORT: 'abc', LOG_LEVEL: 'screaming' as never, MAX_INPUT_RATE: '-5' });
    expect(config.port).toBe(3001);
    expect(config.logLevel).toBe('info');
    expect(config.maxInputRate).toBe(10); // clamped to the minimum
  });

  it('clamps values into safe ranges', () => {
    const config = loadConfig({ PORT: '999999', PAIRING_TOKEN_TTL: '1', ROOM_TTL_SECONDS: '9' });
    expect(config.port).toBe(65535);
    expect(config.pairingTtlSec).toBe(30);
    expect(config.roomTtlSeconds).toBe(10);
  });

  it('allows binding to an ephemeral port (0) for tests', () => {
    expect(loadConfig({ PORT: '0' }).port).toBe(0);
  });
});
