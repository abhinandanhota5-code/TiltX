#!/usr/bin/env node
/**
 * Prints the LAN address a phone on the same Wi-Fi can reach this machine on,
 * plus the environment variables that control the pairing QR link.
 *
 * Uses the same selection logic as the server (`pickLanAddress`), so virtual
 * interfaces (utun/VPN, awdl, bridge, Docker) are ignored and the answer
 * matches what the QR code will actually encode.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { pickLanAddress } from '@tiltx/shared';

function defaultInterface() {
  try {
    if (process.platform === 'darwin' || process.platform === 'freebsd') {
      const out = execFileSync('route', ['-n', 'get', 'default'], {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return /^\s*interface:\s*(\S+)/m.exec(out)?.[1] ?? null;
    }
    if (process.platform === 'linux') {
      for (const line of readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols[1] === '00000000' && cols[0]) return cols[0];
      }
    }
  } catch {
    // ignore — fall back to interface scoring
  }
  return null;
}

const controllerPort = Number(process.env.CONTROLLER_PORT ?? 5173) || 5173;
const preferred = defaultInterface();
const address = pickLanAddress(networkInterfaces(), preferred);

if (!address) {
  console.log('No LAN IPv4 address found — are you connected to Wi-Fi?');
  console.log('The pairing QR will fall back to localhost and a phone will not reach it.');
  process.exitCode = 1;
} else {
  console.log(`Default-route interface: ${preferred ?? '(unknown — used interface scoring)'}`);
  console.log('Reachable LAN address (what the QR code will use):\n');
  console.log(`  http://${address}:${controllerPort}`);
  console.log('\nOptional overrides (npm run dev picks these up):');
  console.log('  # controller dev-server port (must match CONTROLLER_PORT)');
  console.log(`  CONTROLLER_PORT=${controllerPort}`);
  console.log('  # pin a specific address if auto-detection picks the wrong one');
  console.log(`  LAN_ADDRESS_OVERRIDE=${address}`);
  console.log('  # or set the whole URL and skip auto-detection entirely');
  console.log(`  CONTROLLER_BASE_URL=http://${address}:${controllerPort}`);
  console.log('\nUsually none of these are needed — just start the stack and scan.');
}
