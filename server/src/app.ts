import cors from 'cors';
import express, { type Express } from 'express';

export interface AppOptions {
  corsOrigins: string[];
  /** Live room count exposed by /health. */
  roomCount: () => number;
}

/** Shared Express app (health + CORS) used by the real server and by tests. */
export function createExpressApp(options: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: options.corsOrigins.length > 0 ? options.corsOrigins : true }));

  const startedAt = Date.now();
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'tiltx-server',
      version: 1,
      uptimeMs: Date.now() - startedAt,
      rooms: options.roomCount(),
      time: new Date().toISOString(),
    });
  });

  return app;
}
