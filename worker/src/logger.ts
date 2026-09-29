/**
 * Structured logs to stdout, which `wrangler tail` and the dashboard's Logs
 * tab pick up. One JSON object per line so they can be filtered.
 */
type Fields = Record<string, unknown>;

function write(level: 'info' | 'warn' | 'error', module: string, fields: Fields, message: string): void {
  const line = JSON.stringify({ level, module, message, ...serialise(fields) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** Errors do not survive JSON.stringify, so flatten them by hand. */
function serialise(fields: Fields): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] =
      value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
  }
  return out;
}

export function createLogger(module: string) {
  return {
    info: (fields: Fields, message: string) => write('info', module, fields, message),
    warn: (fields: Fields, message: string) => write('warn', module, fields, message),
    error: (fields: Fields, message: string) => write('error', module, fields, message),
  };
}
