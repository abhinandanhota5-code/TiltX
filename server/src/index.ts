import 'dotenv/config';
import type { Server as HttpServer } from 'node:http';
import { createServer } from 'node:http';
import { createExpressApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createAppServer } from './socket.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const httpServer: HttpServer = createServer(
    createExpressApp({ corsOrigins: config.corsOrigins, roomCount: () => services.rooms.size }),
  );
  const services = createAppServer(httpServer, config, logger);

  httpServer.listen(config.port, config.host, () => {
    const address = httpServer.address();
    const port = typeof address === 'object' && address ? address.port : config.port;
    logger.info(`TiltX server listening on ${config.host}:${port}`);
    logger.info(`health check: http://127.0.0.1:${port}/health`);
    if (config.host === '0.0.0.0') {
      logger.info('bound to all interfaces — reachable from other devices on this network');
    }
  });

  const shutdown = (signal: string): void => {
    logger.info(`${signal} received — shutting down`);
    void services.close().then(() => {
      httpServer.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('[tiltx] fatal:', error);
  process.exit(1);
});
