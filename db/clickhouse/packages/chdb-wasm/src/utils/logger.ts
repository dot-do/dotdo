/**
 * Structured Logger Utility for chDB WASM
 *
 * Provides configurable, production-safe logging with support for:
 * - Log levels (debug, info, warn, error)
 * - Environment-based configuration via DEBUG env var
 * - Cloudflare Workers compatibility (no Node.js dependencies)
 * - Structured log output with timestamps and context
 * - Automatic sensitive data filtering
 *
 * @module utils/logger
 *
 * ## Usage
 *
 * ```typescript
 * import { createLogger, Logger, LogLevel } from './utils/logger';
 *
 * // Create a logger with namespace
 * const log = createLogger('http-handler');
 *
 * // Basic logging
 * log.debug('Processing query', { sql: 'SELECT 1' });
 * log.info('Query completed', { rows: 100, elapsed: 50 });
 * log.warn('Slow query detected', { elapsed: 5000 });
 * log.error('Query failed', { error: 'timeout' });
 *
 * // Conditional logging (only logs if DEBUG is enabled)
 * log.debug('Detailed trace', { context: largeObject });
 * ```
 *
 * ## Configuration
 *
 * Set `DEBUG=true` in wrangler.toml or environment:
 * ```toml
 * [vars]
 * DEBUG = "true"
 * ```
 *
 * Log levels:
 * - error (0): Always logged
 * - warn (1): Warnings and errors
 * - info (2): Info, warnings, and errors
 * - debug (3): All messages (only when DEBUG=true)
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Log level enum for controlling verbosity.
 *
 * - `error`: Critical errors that need immediate attention
 * - `warn`: Warning conditions that might need attention
 * - `info`: Informational messages about normal operation
 * - `debug`: Detailed debugging information (disabled in production)
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

/**
 * Log entry structure for structured logging.
 */
export interface LogEntry {
  /** ISO timestamp of the log entry */
  timestamp: string;
  /** Log level name (debug, info, warn, error) */
  level: string;
  /** Logger namespace/component */
  namespace: string;
  /** Log message */
  message: string;
  /** Additional context data */
  context?: Record<string, unknown>;
}

/**
 * Logger configuration options.
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  level: LogLevel;
  /** Whether debug mode is enabled */
  debugEnabled: boolean;
  /** Namespace prefix for this logger */
  namespace: string;
}

/**
 * Logger interface with level-specific methods.
 */
export interface Logger {
  /** Log debug message (only when DEBUG enabled) */
  debug(message: string, context?: Record<string, unknown>): void;
  /** Log info message */
  info(message: string, context?: Record<string, unknown>): void;
  /** Log warning message */
  warn(message: string, context?: Record<string, unknown>): void;
  /** Log error message */
  error(message: string, context?: Record<string, unknown>): void;
  /** Check if debug logging is enabled */
  isDebugEnabled(): boolean;
  /** Create a child logger with additional namespace */
  child(namespace: string): Logger;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Log level names for output formatting.
 */
const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.DEBUG]: 'DEBUG',
};

/**
 * Keys that should be filtered from log output to prevent sensitive data leakage.
 * Values will be replaced with '[REDACTED]'.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'api_key',
  'apikey',
  'api-key',
  'authorization',
  'auth',
  'credential',
  'credentials',
  'private_key',
  'privatekey',
  'private-key',
  'access_token',
  'accesstoken',
  'access-token',
  'refresh_token',
  'refreshtoken',
  'refresh-token',
  'session',
  'cookie',
  'x-api-key',
]);

// =============================================================================
// Global Configuration
// =============================================================================

/**
 * Global debug flag - set via setDebugEnabled() or environment.
 * Defaults to false (production-safe).
 */
let globalDebugEnabled = false;

/**
 * Global minimum log level.
 * In production (debug disabled), only INFO and above are logged.
 * In debug mode, all levels including DEBUG are logged.
 */
let globalLogLevel: LogLevel = LogLevel.INFO;

// =============================================================================
// Configuration Functions
// =============================================================================

/**
 * Enable or disable debug logging globally.
 *
 * @param enabled - Whether debug logging should be enabled
 *
 * @example
 * // Enable debug mode (typically in development)
 * setDebugEnabled(true);
 *
 * @example
 * // Enable based on environment variable
 * setDebugEnabled(env.DEBUG === 'true');
 */
export function setDebugEnabled(enabled: boolean): void {
  globalDebugEnabled = enabled;
  globalLogLevel = enabled ? LogLevel.DEBUG : LogLevel.INFO;
}

/**
 * Check if debug logging is currently enabled.
 *
 * @returns True if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
  return globalDebugEnabled;
}

/**
 * Set the minimum log level globally.
 *
 * @param level - Minimum log level to output
 *
 * @example
 * // Only log errors
 * setLogLevel(LogLevel.ERROR);
 *
 * @example
 * // Log everything including debug
 * setLogLevel(LogLevel.DEBUG);
 */
export function setLogLevel(level: LogLevel): void {
  globalLogLevel = level;
  // If setting to DEBUG, enable debug mode
  if (level === LogLevel.DEBUG) {
    globalDebugEnabled = true;
  }
}

/**
 * Get the current global log level.
 *
 * @returns Current minimum log level
 */
export function getLogLevel(): LogLevel {
  return globalLogLevel;
}

/**
 * Configure logging based on Cloudflare Workers environment.
 * Call this at worker startup with your env object.
 *
 * @param env - Environment object with DEBUG variable
 *
 * @example
 * // In worker.ts fetch handler
 * configureLogging(env);
 */
export function configureLogging(env: { DEBUG?: string }): void {
  const debugEnabled = env.DEBUG === 'true' || env.DEBUG === '1';
  setDebugEnabled(debugEnabled);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Filter sensitive data from a context object.
 * Replaces values of sensitive keys with '[REDACTED]'.
 * For nested objects, recursively filters while preserving structure.
 *
 * @param context - Object to filter
 * @returns New object with sensitive values redacted
 */
function filterSensitiveData(context: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();

    // Check if current key is sensitive - if so, redact the entire value
    if (SENSITIVE_KEYS.has(lowerKey)) {
      filtered[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively filter nested objects
      filtered[key] = filterSensitiveData(value as Record<string, unknown>);
    } else {
      filtered[key] = value;
    }
  }

  return filtered;
}

/**
 * Format a log entry for output.
 * Uses JSON format for structured logging in production.
 *
 * @param entry - Log entry to format
 * @returns Formatted string for output
 */
function formatLogEntry(entry: LogEntry): string {
  // Use JSON format for structured logging (parseable by log aggregators)
  return JSON.stringify(entry);
}

// =============================================================================
// Logger Implementation
// =============================================================================

/**
 * Create a logger instance with a namespace.
 *
 * @param namespace - Namespace for this logger (e.g., 'http-handler', 'sql-executor')
 * @returns Logger instance with level-specific methods
 *
 * @example
 * const log = createLogger('http-handler');
 * log.info('Request received', { path: '/query', method: 'GET' });
 *
 * @example
 * const log = createLogger('chdb-backend');
 * log.debug('WASM initialized', { memoryLimit: 128 * 1024 * 1024 });
 */
export function createLogger(namespace: string): Logger {
  /**
   * Internal log function that handles all levels.
   */
  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    // Skip if level is below minimum
    if (level > globalLogLevel) {
      return;
    }

    // Skip debug logs if debug mode is disabled
    if (level === LogLevel.DEBUG && !globalDebugEnabled) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LOG_LEVEL_NAMES[level],
      namespace,
      message,
    };

    if (context && Object.keys(context).length > 0) {
      entry.context = filterSensitiveData(context);
    }

    const formatted = formatLogEntry(entry);

    // Use appropriate console method for each level
    switch (level) {
      case LogLevel.ERROR:
        console.error(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.INFO:
        console.info(formatted);
        break;
      case LogLevel.DEBUG:
        console.log(formatted);
        break;
    }
  }

  const logger: Logger = {
    debug(message: string, context?: Record<string, unknown>): void {
      log(LogLevel.DEBUG, message, context);
    },

    info(message: string, context?: Record<string, unknown>): void {
      log(LogLevel.INFO, message, context);
    },

    warn(message: string, context?: Record<string, unknown>): void {
      log(LogLevel.WARN, message, context);
    },

    error(message: string, context?: Record<string, unknown>): void {
      log(LogLevel.ERROR, message, context);
    },

    isDebugEnabled(): boolean {
      return globalDebugEnabled;
    },

    child(childNamespace: string): Logger {
      return createLogger(`${namespace}:${childNamespace}`);
    },
  };

  return logger;
}

// =============================================================================
// Pre-configured Loggers
// =============================================================================

/**
 * Default logger for general use.
 * Use createLogger() for component-specific logging.
 */
export const defaultLogger = createLogger('chdb');

// =============================================================================
// Convenience Exports
// =============================================================================

/**
 * Quick debug log using the default logger.
 * Only logs when DEBUG is enabled.
 *
 * @param message - Log message
 * @param context - Optional context data
 */
export function debug(message: string, context?: Record<string, unknown>): void {
  defaultLogger.debug(message, context);
}

/**
 * Quick info log using the default logger.
 *
 * @param message - Log message
 * @param context - Optional context data
 */
export function info(message: string, context?: Record<string, unknown>): void {
  defaultLogger.info(message, context);
}

/**
 * Quick warn log using the default logger.
 *
 * @param message - Log message
 * @param context - Optional context data
 */
export function warn(message: string, context?: Record<string, unknown>): void {
  defaultLogger.warn(message, context);
}

/**
 * Quick error log using the default logger.
 *
 * @param message - Log message
 * @param context - Optional context data
 */
export function error(message: string, context?: Record<string, unknown>): void {
  defaultLogger.error(message, context);
}
