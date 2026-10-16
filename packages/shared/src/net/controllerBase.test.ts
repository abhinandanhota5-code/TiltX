import { describe, expect, it } from 'vitest';
import {
  isLoopbackHost,
  isPrivateIPv4,
  pickLanAddress,
  resolveControllerBaseUrl,
  type NetInterfaces,
} from './controllerBase.js';

function iface(entries: Array<[string, string]>): NetInterfaces {
  const out: NetInterfaces = {};
  for (const [name, address] of entries) {
    out[name] = [{ address, family: 'IPv4', internal: false }];
  }
  return out;
}

describe('isPrivateIPv4', () => {
  it('accepts RFC1918 ranges', () => {
    for (const ip of ['192.168.1.42', '10.0.0.5', '10.82.163.203', '172.16.0.1', '172.31.255.254']) {
      expect(isPrivateIPv4(ip), ip).toBe(true);
    }
  });

  it('rejects public, link-local, loopback and 172.32+', () => {
    for (const ip of ['8.8.8.8', '169.254.1.1', '127.0.0.1', '172.32.0.1', '172.15.0.1']) {
      expect(isPrivateIPv4(ip), ip).toBe(false);
    }
  });
});

describe('isLoopbackHost', () => {
  it('detects localhost forms', () => {
    for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', 'LOCALHOST']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it('does not flag LAN or public hosts', () => {
    for (const host of ['10.82.163.203', '192.168.1.50', 'example.com', '172.17.60.99']) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});

describe('pickLanAddress', () => {
  it('picks the Wi-Fi address when a stale Docker/VPN interface is also present', () => {
    const address = pickLanAddress(
      iface([
        ['lo0', '127.0.0.1'],
        ['utun3', '10.8.0.6'],
        ['docker0', '172.17.0.1'],
        ['en0', '10.82.163.203'],
      ]),
    );
    expect(address).toBe('10.82.163.203');
  });

  it('prefers en0 over a higher-numbered ethernet interface', () => {
    expect(
      pickLanAddress(
        iface([
          ['en1', '192.168.44.9'],
          ['en0', '10.82.163.203'],
        ]),
      ),
    ).toBe('10.82.163.203');
  });

  it('ignores internal, public and link-local addresses', () => {
    expect(
      pickLanAddress({
        en0: [
          { address: '169.254.10.10', family: 'IPv4', internal: false },
          { address: '93.184.216.34', family: 'IPv4', internal: false },
        ],
        lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      }),
    ).toBeNull();
  });

  it('returns null when only virtual interfaces are up', () => {
    expect(pickLanAddress(iface([['utun0', '10.1.1.1'], ['awdl0', '169.254.1.1']]))).toBeNull();
  });

  it('prefers the default-route interface even when a lower-index NIC exists', () => {
    const interfaces = iface([
      ['en0', '10.82.163.203'],
      ['en1', '192.168.50.10'],
    ]);
    expect(pickLanAddress(interfaces, 'en1')).toBe('192.168.50.10');
  });

  it('falls back to scoring when the preferred interface has no usable address', () => {
    const interfaces: NetInterfaces = {
      en1: [{ address: '169.254.1.1', family: 'IPv4', internal: false }],
      en0: [{ address: '10.82.163.203', family: 'IPv4', internal: false }],
    };
    expect(pickLanAddress(interfaces, 'en1')).toBe('10.82.163.203');
  });

  it('ignores a preferred interface that is not present', () => {
    expect(pickLanAddress(iface([['en0', '10.82.163.203']]), 'en9')).toBe('10.82.163.203');
  });
});

describe('resolveControllerBaseUrl — the QR pairing URL', () => {
  it('always trusts an explicitly configured base', () => {
    const result = resolveControllerBaseUrl({
      configured: 'https://tiltx.example.com/',
      clientBase: 'http://localhost:5174',
      controllerPort: 5173,
      lanAddress: '10.82.163.203',
    });
    expect(result).toEqual({ base: 'https://tiltx.example.com', source: 'configured' });
  });

  it('replaces a stale Docker-ish client base with the detected LAN address', () => {
    const result = resolveControllerBaseUrl({
      clientBase: 'http://172.17.60.99:5173',
      controllerPort: 5173,
      lanAddress: '10.82.163.203',
    });
    expect(result.base).toBe('http://10.82.163.203:5173');
    expect(result.source).toBe('detected');
    expect(result.replacedBase).toBe('http://172.17.60.99:5173');
  });

  it('replaces a localhost client base (the game runs on a different port)', () => {
    const result = resolveControllerBaseUrl({
      clientBase: 'http://localhost:5174',
      controllerPort: 5173,
      lanAddress: '10.82.163.203',
    });
    expect(result.base).toBe('http://10.82.163.203:5173');
    expect(result.source).toBe('detected');
  });

  it('keeps a client base that already points at the LAN address', () => {
    const result = resolveControllerBaseUrl({
      clientBase: 'http://10.82.163.203:5175',
      controllerPort: 5173,
      lanAddress: '10.82.163.203',
    });
    expect(result).toEqual({ base: 'http://10.82.163.203:5175', source: 'client-lan' });
  });

  it('derives the URL from the detected address when the game sends nothing', () => {
    const result = resolveControllerBaseUrl({ controllerPort: 5173, lanAddress: '10.82.163.203' });
    expect(result.base).toBe('http://10.82.163.203:5173');
    expect(result.source).toBe('detected');
  });

  it('honours a non-default controller port', () => {
    const result = resolveControllerBaseUrl({ controllerPort: 5175, lanAddress: '10.82.163.203' });
    expect(result.base).toBe('http://10.82.163.203:5175');
  });

  it('falls back to loopback only when nothing else can be determined', () => {
    const result = resolveControllerBaseUrl({ controllerPort: 5173, lanAddress: null });
    expect(result).toEqual({ base: 'http://localhost:5173', source: 'loopback-fallback' });
  });

  it('never emits a trailing slash', () => {
    const result = resolveControllerBaseUrl({ configured: 'http://10.0.0.9:5173/' });
    expect(result.base.endsWith('/')).toBe(false);
  });

  it('ignores malformed client bases', () => {
    const result = resolveControllerBaseUrl({
      clientBase: 'not a url',
      controllerPort: 5173,
      lanAddress: '10.82.163.203',
    });
    expect(result.base).toBe('http://10.82.163.203:5173');
  });
});
