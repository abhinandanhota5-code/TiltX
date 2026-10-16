/**
 * LAN-address selection and controller pairing-base resolution.
 *
 * The pairing QR code must encode an address a phone on the same Wi-Fi can
 * reach. Hard-coding that address in a config file breaks the moment the
 * laptop joins a different network (or when a VPN/Docker interface appears),
 * so the server derives it at runtime from the machine's interfaces instead.
 *
 * Everything here is pure: callers pass `os.networkInterfaces()` in, which
 * keeps this testable and keeps Node built-ins out of the browser bundle.
 */

export interface NetAddress {
  address: string;
  family?: string | number;
  internal?: boolean;
}

export type NetInterfaces = Record<string, NetAddress[] | undefined>;

/** Interfaces that are never a phone-reachable LAN address. */
const VIRTUAL_INTERFACE = /^(utun|awdl|llw|bridge|ap\d|anpi|gif|stf|vmenet|docker|veth|tun|tap|wg|ipsec)/i;

function isIPv4(address: NetAddress | null | undefined): boolean {
  if (!address) return false;
  return address.family === 'IPv4' || address.family === 4;
}

/** RFC1918 private space (link-local 169.254.x.x is deliberately excluded). */
export function isPrivateIPv4(ip: string): boolean {
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('10.')) return true;
  const match = /^172\.(\d+)\./.exec(ip);
  if (match) {
    const second = Number(match[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

/**
 * Ordered by usefulness, highest first: real NICs (en0/en1/…) beat everything
 * else, then the lower interface index wins (en0 before en1), then the usual
 * home LAN ranges.
 */
function candidateScore(name: string, address: string): number {
  const nic = /^en(\d+)$/.exec(name);
  const ifaceScore = nic ? (1000 - Number(nic[1])) * 10 : 1000;
  const classScore = address.startsWith('192.168.') ? 3 : address.startsWith('10.') ? 2 : 1;
  return ifaceScore + classScore;
}

function firstUsableAddress(addresses: NetAddress[] | undefined): string | null {
  for (const entry of addresses ?? []) {
    if (isIPv4(entry) && !entry.internal && isPrivateIPv4(entry.address)) return entry.address;
  }
  return null;
}

/**
 * Best guess at the address a phone on the same network can reach.
 *
 * When `preferredInterface` is given (the interface that owns the default
 * route — i.e. the one actually carrying traffic), its address wins outright,
 * because that is by definition the reachable one. Otherwise falls back to
 * scoring real NICs (`en*`) above everything else.
 *
 * Returns null when the machine is offline or only has virtual interfaces.
 */
export function pickLanAddress(interfaces: NetInterfaces, preferredInterface?: string | null): string | null {
  if (preferredInterface) {
    const match = firstUsableAddress(interfaces[preferredInterface]);
    if (match) return match;
  }
  let best: { address: string; score: number } | null = null;
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const entry of addresses ?? []) {
      if (!isIPv4(entry) || entry.internal) continue;
      if (!isPrivateIPv4(entry.address)) continue;
      const score = candidateScore(name, entry.address);
      if (!best || score > best.score) best = { address: entry.address, score };
    }
  }
  return best?.address ?? null;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '::1' || /^127\./.test(normalized);
}

function normalizeHttpUrl(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

export type ControllerBaseSource = 'configured' | 'client-lan' | 'detected' | 'loopback-fallback';

export interface ResolveControllerBaseInput {
  /** `CONTROLLER_BASE_URL` — an explicit operator override, always trusted. */
  configured?: string;
  /** Base the game asked for (`VITE_PAIRING_BASE_URL`, or the page origin). */
  clientBase?: string;
  /** Controller dev-server port (`CONTROLLER_PORT`). */
  controllerPort?: number;
  /** Result of {@link pickLanAddress} for this machine. */
  lanAddress?: string | null;
}

export interface ResolvedControllerBase {
  base: string;
  source: ControllerBaseSource;
  /** Set when a client-supplied base was discarded because it is unreachable. */
  replacedBase?: string;
}

/**
 * Decides which base URL goes into the QR code.
 *
 * A client-supplied base is only honoured when it points at this machine's
 * detected LAN address — a `localhost` or stale/unroutable address (e.g. a
 * leftover Docker/VPN IP from a previous network) is replaced with the
 * detected one so the QR keeps working after the laptop changes Wi-Fi.
 */
export function resolveControllerBaseUrl(input: ResolveControllerBaseInput): ResolvedControllerBase {
  const port = input.controllerPort && input.controllerPort > 0 ? input.controllerPort : 5173;

  const configured = normalizeHttpUrl(input.configured);
  if (configured) return { base: configured, source: 'configured' };

  const detected = input.lanAddress ?? null;
  const detectedBase = detected ? `http://${detected}:${port}` : null;

  const client = normalizeHttpUrl(input.clientBase);
  if (client) {
    let host: string | null = null;
    try {
      host = new URL(client).hostname;
    } catch {
      host = null;
    }
    if (host && detected && host === detected) return { base: client, source: 'client-lan' };
    if (detectedBase) return { base: detectedBase, source: 'detected', replacedBase: client };
    return { base: client, source: 'loopback-fallback' };
  }

  if (detectedBase) return { base: detectedBase, source: 'detected' };
  return { base: `http://localhost:${port}`, source: 'loopback-fallback' };
}
