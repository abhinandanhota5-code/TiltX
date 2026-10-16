import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { Ack, CreateRoomResult, EVENTS } from '@tiltx/shared';
import { openClient, startTestServer, type TestServer } from '../helpers/testServer.js';

/**
 * The QR code must encode an address a phone on the same Wi-Fi can reach —
 * never a stale Docker/VPN address baked into a config file, and never the
 * game's own port (the controller is a separate dev server).
 */
describe('LAN pairing URL resolution', () => {
  let server: TestServer | null = null;
  const sockets: Socket[] = [];

  async function boot(env: Record<string, string>): Promise<TestServer> {
    server = await startTestServer(env);
    return server;
  }

  async function createRoom(server: TestServer, controllerBaseUrl?: string): Promise<CreateRoomResult> {
    const game = await openClient(server.baseUrl);
    sockets.push(game);
    const ack = (await game.emitWithAck(EVENTS.gameCreateRoom, { controllerBaseUrl })) as Ack<CreateRoomResult>;
    expect(ack.ok).toBe(true);
    return ack.data as CreateRoomResult;
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('uses the detected LAN address and controller port when the game sends no base', async () => {
    const s = await boot({ LAN_ADDRESS_OVERRIDE: '10.82.163.203', CONTROLLER_PORT: '5173' });
    const result = await createRoom(s);
    expect(result.pairing.url.startsWith('http://10.82.163.203:5173/')).toBe(true);
    expect(result.pairing.url).not.toContain('localhost');
  });

  it('honours a non-default controller port', async () => {
    const s = await boot({ LAN_ADDRESS_OVERRIDE: '10.82.163.203', CONTROLLER_PORT: '5175' });
    const result = await createRoom(s);
    expect(result.pairing.url.startsWith('http://10.82.163.203:5175/')).toBe(true);
  });

  it('repairs a stale Docker/VPN base instead of putting it in the QR', async () => {
    const s = await boot({ LAN_ADDRESS_OVERRIDE: '10.82.163.203' });
    const result = await createRoom(s, 'http://172.17.60.99:5173');
    expect(result.pairing.url.startsWith('http://10.82.163.203:5173/')).toBe(true);
    expect(result.pairing.url).not.toContain('172.17.60.99');
  });

  it('repairs a localhost base (wrong app and wrong port)', async () => {
    const s = await boot({ LAN_ADDRESS_OVERRIDE: '10.82.163.203' });
    const result = await createRoom(s, 'http://localhost:5174');
    expect(result.pairing.url.startsWith('http://10.82.163.203:5173/')).toBe(true);
  });

  it('keeps an explicit CONTROLLER_BASE_URL override verbatim', async () => {
    const s = await boot({
      LAN_ADDRESS_OVERRIDE: '10.82.163.203',
      CONTROLLER_BASE_URL: 'https://tiltx.example.com',
    });
    const result = await createRoom(s, 'http://localhost:5174');
    expect(result.pairing.url.startsWith('https://tiltx.example.com/')).toBe(true);
  });

  it('still mints a working token alongside the resolved URL', async () => {
    const s = await boot({ LAN_ADDRESS_OVERRIDE: '10.82.163.203' });
    const result = await createRoom(s);
    expect(result.pairing.url).toContain(`room=${result.room.code}`);
    expect(result.pairing.url).toContain('token=');
    expect(result.pairing.token.length).toBeGreaterThan(10);
    expect(result.pairing.expiresAt).toBeGreaterThan(Date.now());
  });
});
