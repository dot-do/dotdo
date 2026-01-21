/**
 * Logging abstraction for dotdo
 *
 * Provides a centralized logging interface with configurable log levels.
 * All logs are prefixed with [dotdo] for easy identification.
 *
 * @example
 * import { logger, setLogLevel, LogLevel } from './utils/logger'
 *
 * // Use the logger
 * logger.debug('Debug message', { data: 123 })
 * logger.info('Info message')
 * logger.warn('Warning message')
 * logger.error('Error message', error)
 *
 * // Configure log level
 * setLogLevel(LogLevel.WARN) // Only warn and error will be logged
 */
/**
 * Log levels in order of severity (lower = more verbose)
 */
export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    SILENT = 4
}
/**
 * Configuration for the logger
 */
export interface LoggerConfig {
    level: LogLevel;
    prefix: string;
}
/**
 * Logger interface
 */
export interface Logger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
/**
 * Set the global log level
 * @param level - The minimum log level to display
 */
export declare function setLogLevel(level: LogLevel): void;
/**
 * Get the current log level
 */
export declare function getLogLevel(): LogLevel;
/**
 * Set the log prefix
 * @param prefix - The prefix to use for all log messages
 */
export declare function setLogPrefix(prefix: string): void;
/**
 * Get the current log prefix
 */
export declare function getLogPrefix(): string;
/**
 * Configure the logger
 * @param newConfig - Partial configuration to merge
 */
export declare function configureLogger(newConfig: Partial<LoggerConfig>): void;
/**
 * Parse log level from string (for environment variables)
 * @param level - String representation of log level
 * @returns LogLevel enum value
 */
export declare function parseLogLevel(level: string | undefined): LogLevel;
/**
 * Initialize logger from environment variable
 * Reads DOTDO_LOG_LEVEL environment variable if available
 */
export declare function initLoggerFromEnv(): void;
/**
 * Create a logger with a custom prefix
 * Useful for creating module-specific loggers
 *
 * @example
 * const wsLogger = createLogger('[WebSocket]')
 * wsLogger.info('Connection established')
 */
export declare function createLogger(prefix: string): Logger;
/**
 * Default logger instance with [dotdo] prefix
 * Uses the global configuration for log level
 */
export declare const logger: Logger;
//# sourceMappingURL=logger.d.ts.map