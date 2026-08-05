/**
 * Minimal structured logger.
 *
 * Scan pipelines fail in ways that are hard to reproduce (a tool missing on one
 * host, a target that times out only sometimes), so log lines need enough
 * context to diagnose an incident after the fact. Output is JSON in production
 * for log aggregators, and human-readable during development.
 *
 * Deliberately dependency-free: the scanner runs in constrained containers and
 * a logging library is not worth the install size or startup cost here.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

/** Arbitrary structured fields attached to a log line. */
export type LogContext = Record<string, unknown>

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function activeLevel(): Level {
  const configured = process.env.LOG_LEVEL?.toLowerCase()
  if (
    configured === 'debug' ||
    configured === 'info' ||
    configured === 'warn' ||
    configured === 'error'
  ) {
    return configured
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Reduce an unknown thrown value to something safe to serialize.
 *
 * Stack traces are kept out of production output because scan errors routinely
 * embed target URLs and internal paths.
 */
function serializeError(error: unknown): LogContext {
  if (error instanceof Error) {
    return {
      error: error.message,
      error_name: error.name,
      ...(isProduction ? {} : { stack: error.stack }),
    }
  }
  return { error: String(error) }
}

function emit(level: Level, message: string, context?: LogContext): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[activeLevel()]) return

  const line = {
    level,
    time: new Date().toISOString(),
    message,
    ...context,
  }

  const target = level === 'error' || level === 'warn' ? console.error : console.log

  if (isProduction) {
    target(JSON.stringify(line))
    return
  }

  const fields = context && Object.keys(context).length ? ` ${JSON.stringify(context)}` : ''
  target(`[${level}] ${message}${fields}`)
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, error?: unknown, context?: LogContext) =>
    emit('error', message, { ...context, ...(error === undefined ? {} : serializeError(error)) }),
}
