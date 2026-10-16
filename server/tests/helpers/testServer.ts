import type { Server as HttpServer } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { createExpressApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { createAppServer, type AppServices } from '../../src/socket.js';

export interface TestServer {
  baseUrl: string;
  services: AppServices;
  close(): Promise<void>;
}

/** Boots a real HTTP + Socket.IO server on an ephemeral port. */
export async function startTestServer(env: Record<string, string> = {}): Promise<TestServer> {
  const config = loadConfig({
    PORT: '0',
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    PAIRING_SECRET: 'integration-test-secret',
    GAME_GRACE_MS: '150',
    ...env,
  });
  const logger = createLogger(config.logLevel);

  let services!: AppServices;
  const app = createExpressApp({
    corsOrigins: config.corsOrigins,
    roomCount: () => services.rooms.size,
  });
  const http: HttpServer = createServer(app);
  services = createAppServer(http, config, logger);

  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
  const { port } = http.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    services,
    close: async () => {
      await services.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

export function connectClient(baseUrl: string): Socket {
  return connect(baseUrl, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: 4000,
  });
}

/** Resolves with the first payload for an event, or rejects on timeout. */
export function waitFor<T = unknown>(socket: Socket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload: T): void => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

/** Waits until a predicate is true, polling on a short interval. */
export async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Connects a socket and waits for the transport to be ready. */
export async function openClient(baseUrl: string): Promise<Socket> {
  const socket = connectClient(baseUrl);
  await waitFor(socket, 'connect');
  return socket;
}
