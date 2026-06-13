import pino, { LoggerOptions } from 'pino';

/**
 * Pretty logs in dev are nice-to-have, not load-bearing. `pino-pretty` is a dev
 * dependency that may not be installed in every environment — if it can't be
 * resolved we silently fall back to plain JSON logging instead of crashing the
 * whole media server on startup.
 */
function buildOptions(): LoggerOptions {
  const base: LoggerOptions = {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'atom-media' },
  };
  if (process.env.NODE_ENV !== 'production') {
    try {
      require.resolve('pino-pretty');
      base.transport = { target: 'pino-pretty', options: { singleLine: true } };
    } catch {
      // pino-pretty not installed → JSON logs (no transport)
    }
  }
  return base;
}

export const logger = pino(buildOptions());
