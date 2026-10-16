import { describe, expect, it } from 'vitest';
import { detectDefaultInterface, detectLanAddress } from '../../src/net.js';

describe('detectDefaultInterface', () => {
  it('does not throw on any platform and returns a name or null', () => {
    for (const platform of ['darwin', 'linux', 'win32', 'freebsd'] as NodeJS.Platform[]) {
      const result = detectDefaultInterface(platform);
      expect(result === null || typeof result === 'string').toBe(true);
    }
  });

  it('reads the default-route interface on this machine', () => {
    const result = detectDefaultInterface();
    if (process.platform === 'darwin' || process.platform === 'linux') {
      expect(result).toMatch(/^\w+/);
    }
  });
});

describe('detectLanAddress', () => {
  it('honours LAN_ADDRESS_OVERRIDE verbatim (deterministic pairing in tests)', () => {
    expect(detectLanAddress({ LAN_ADDRESS_OVERRIDE: '10.0.0.7' }, null)).toBe('10.0.0.7');
  });

  it('trims a blank override so detection still runs', () => {
    const result = detectLanAddress({ LAN_ADDRESS_OVERRIDE: '   ' }, null);
    expect(result === null || /^\d+\.\d+\.\d+\.\d+$/.test(result)).toBe(true);
  });
});
