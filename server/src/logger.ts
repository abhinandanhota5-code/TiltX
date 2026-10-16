type Level = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export function createLogger(level: Level = 'info', prefix = '[tiltx]'): Logger {
  const enabled = (min: Level) => ORDER[level] <= ORDER[min];
  const write = (min: Level, fn: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      if (enabled(min)) fn(prefix, ...args);
    };
  return {
    debug: write('debug', console.debug.bind(console)),
    info: write('info', console.log.bind(console)),
    warn: write('warn', console.warn.bind(console)),
    error: write('error', console.error.bind(console)),
  };
}
