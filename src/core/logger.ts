import { pino } from 'pino';
import { env, isProduction } from '../config/env.js';

/**
 * Structured logger. In production we emit newline-delimited JSON so `docker
 * logs` output stays machine-readable; in development we pretty-print.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined, // drop pid/hostname noise
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});

/** Namespaced child logger, e.g. `createLogger('tickets')`. */
export function createLogger(name: string) {
  return logger.child({ module: name });
}
