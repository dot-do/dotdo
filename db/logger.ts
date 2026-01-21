// @dotdo/db Logger
// Simple logging utility for standalone npm package

/**
 * Log levels in order of severity (lower = more verbose)
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

// Default log level
let globalLogLevel: LogLevel = LogLevel.INFO

/**
 * Set the global log level
 */
export function setLogLevel(level: LogLevel): void {
  globalLogLevel = level
}

/**
 * Get the current log level
 */
export function getLogLevel(): LogLevel {
  return globalLogLevel
}

/**
 * Create a logger with a custom prefix
 *
 * @example
 * const logger = createLogger('[SQLite]')
 * logger.info('Connection established')
 */
export function createLogger(prefix: string): Logger {
  return {
    debug: (message: string, ...args: unknown[]) => {
      if (globalLogLevel <= LogLevel.DEBUG) {
        console.debug(prefix, message, ...args)
      }
    },
    info: (message: string, ...args: unknown[]) => {
      if (globalLogLevel <= LogLevel.INFO) {
        console.info(prefix, message, ...args)
      }
    },
    warn: (message: string, ...args: unknown[]) => {
      if (globalLogLevel <= LogLevel.WARN) {
        console.warn(prefix, message, ...args)
      }
    },
    error: (message: string, ...args: unknown[]) => {
      if (globalLogLevel <= LogLevel.ERROR) {
        console.error(prefix, message, ...args)
      }
    },
  }
}

/**
 * Default logger with [dotdo/db] prefix
 */
export const logger: Logger = createLogger('[dotdo/db]')
