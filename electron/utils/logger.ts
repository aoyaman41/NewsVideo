type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function parseLogLevel(raw: string | undefined): LogLevel | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === 'error' || value === 'warn' || value === 'info' || value === 'debug') {
    return value;
  }
  return null;
}

function getCurrentLogLevel(): LogLevel {
  const fromEnv = parseLogLevel(process.env.NEWSVIDEO_LOG_LEVEL);
  if (fromEnv) return fromEnv;
  return process.env.NODE_ENV === 'development' ? 'info' : 'warn';
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] <= LOG_LEVEL_ORDER[getCurrentLogLevel()];
}

function emit(level: LogLevel, message: string, details?: unknown): void {
  if (!shouldLog(level)) return;

  if (details === undefined) {
    if (level === 'error') console.error(message);
    else if (level === 'warn') console.warn(message);
    else console.log(message);
    return;
  }

  if (level === 'error') console.error(message, details);
  else if (level === 'warn') console.warn(message, details);
  else console.log(message, details);
}

export const logger = {
  error(message: string, details?: unknown): void {
    emit('error', message, details);
  },
  warn(message: string, details?: unknown): void {
    emit('warn', message, details);
  },
  info(message: string, details?: unknown): void {
    emit('info', message, details);
  },
  debug(message: string, details?: unknown): void {
    emit('debug', message, details);
  },
};
