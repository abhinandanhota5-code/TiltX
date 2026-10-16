import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { pickLanAddress, type NetInterfaces } from '@tiltx/shared';

/**
 * Name of the interface currently carrying the default route (e.g. `en0`).
 *
 * This is the interface a phone on the same network can actually reach, so it
 * outranks any name-based heuristic. Best-effort and fully guarded: if the
 * platform lookup fails we return null and the caller falls back to scoring.
 */
export function detectDefaultInterface(platform: NodeJS.Platform = process.platform): string | null {
  try {
    if (platform === 'darwin' || platform === 'freebsd') {
      const out = execFileSync('route', ['-n', 'get', 'default'], {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = /^\s*interface:\s*(\S+)/m.exec(out);
      return match?.[1] ?? null;
    }
    if (platform === 'linux') {
      const table = readFileSync('/proc/net/route', 'utf8');
      for (const line of table.split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/);
        // Destination 00000000 == default route; col 0 is the interface.
        if (cols[1] === '00000000' && cols[0]) return cols[0];
      }
      return null;
    }
  } catch {
    // No route table, no permissions, unsupported platform — just guess.
  }
  return null;
}

/**
 * Address a phone on the same Wi-Fi can reach this machine on.
 * `LAN_ADDRESS_OVERRIDE` makes this deterministic in tests and lets an operator
 * pin a specific address when detection picks the wrong interface.
 */
export function detectLanAddress(
  env: NodeJS.ProcessEnv = process.env,
  preferredInterface: string | null = detectDefaultInterface(),
): string | null {
  const override = (env['LAN_ADDRESS_OVERRIDE'] ?? '').trim();
  if (override.length > 0) return override;
  return pickLanAddress(networkInterfaces() as NetInterfaces, preferredInterface);
}
