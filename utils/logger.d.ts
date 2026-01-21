/**
 * Logging abstraction for dotdo
 *
 * Provides a centralized logging interface with configurable log levels.
 * All logs are prefixed with [dotdo] for easy identification.
 *
 * ## Request-Scoped Logging (Recommended for Workers)
 *
 * In Cloudflare Workers, module-level state is shared across requests.
 * Use request-scoped logging to avoid configuration leakage:
 *
 * @example
 * ```ts
 * import { createScopedLogger, runWithLogContext, getContextLogger } from './utils/logger'
 *
 * // Option 1: Create a scoped logger with its own config
 * const log = createScopedLogger({ level: LogLevel.DEBUG, prefix: '[MyService]' })
 * log.info('Isolated from global config')
 *
 * // Option 2: Use AsyncLocalStorage for automatic request scoping
 * await runWithLogContext({ level: LogLevel.DEBUG }, async () => {
 *   const log = getContextLogger()
 *   log.info('This uses request-scoped config')
 * })
 * ```
 *
 * ## Legacy Global Config (Deprecated)
 *
 * The global config functions still work but are deprecated for Workers:
 *
 * @example
 * ```ts
 * import { logger, setLogLevel, LogLevel } from './utils/logger'
 *
 * // Use the logger
 * logger.debug('Debug message', { data: 123 })
 * logger.info('Info message')
 * logger.warn('Warning message')
 * logger.error('Error message', error)
 *
 * // Configure log level (DEPRECATED - use createScopedLogger instead)
 * setLogLevel(LogLevel.WARN) // Only warn and error will be logged
 * ```
 *
 * @see do-6eza - Request-scoped logger configuration
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
 * @deprecated Use `createScopedLogger()` or `runWithLogContext()` for request-scoped configuration.
 * Global config is problematic in Workers where module state is shared across requests.
 */
export declare function setLogLevel(level: LogLevel): void;
/**
 * Get the current log level
 * @deprecated Use `createScopedLogger()` or `runWithLogContext()` for request-scoped configuration.
 */
export declare function getLogLevel(): LogLevel;
/**
 * Set the log prefix
 * @param prefix - The prefix to use for all log messages
 * @deprecated Use `createScopedLogger()` or `runWithLogContext()` for request-scoped configuration.
 * Global config is problematic in Workers where module state is shared across requests.
 */
export declare function setLogPrefix(prefix: string): void;
/**
 * Get the current log prefix
 * @deprecated Use `createScopedLogger()` or `runWithLogContext()` for request-scoped configuration.
 */
export declare function getLogPrefix(): string;
/**
 * Configure the logger
 * @param newConfig - Partial configuration to merge
 * @deprecated Use `createScopedLogger()` or `runWithLogContext()` for request-scoped configuration.
 * Global config is problematic in Workers where module state is shared across requests.
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
 * @deprecated Use `createScopedLogger()` with explicit config for request-scoped configuration.
 */
export declare function initLoggerFromEnv(): void;
/**
 * Create a logger with a custom prefix
 * Useful for creating module-specific loggers
 *
 * NOTE: This function still uses the global log level.
 * For fully isolated loggers, use `createScopedLogger()` instead.
 *
 * @example
 * const wsLogger = createLogger('[WebSocket]')
 * wsLogger.info('Connection established')
 *
 * @deprecated Use `createScopedLogger()` for fully isolated loggers with their own config.
 */
export declare function createLogger(prefix: string): Logger;
/**
 * Create a fully isolated logger with its own configuration.
 *
 * Unlike `createLogger()` which only customizes the prefix but shares the
 * global log level, `createScopedLogger()` creates a completely independent
 * logger with its own configuration.
 *
 * This is the recommended approach for Cloudflare Workers where module-level
 * state is shared across requests.
 *
 * @param scopedConfig - Configuration for this logger instance
 * @returns A Logger instance with isolated configuration
 *
 * @example
 * ```ts
 * // Create a logger with its own config
 * const log = createScopedLogger({
 *   level: LogLevel.DEBUG,
 *   prefix: '[MyService]'
 * })
 *
 * // This logger ignores global config changes
 * setLogLevel(LogLevel.SILENT) // Has no effect on `log`
 * log.debug('Still works!') // Logs because this logger's level is DEBUG
 * ```
 *
 * @see do-6eza - Request-scoped logger configuration
 */
export declare function createScopedLogger(scopedConfig: LoggerConfig): Logger;
/**
 * Run a function with request-scoped logging configuration.
 *
 * Within the callback, `getContextLogger()` will return a logger
 * using the provided configuration, completely isolated from global state.
 *
 * @param logConfig - Logging configuration for this request scope
 * @param fn - The async function to run with the scoped config
 * @returns The result of the function
 *
 * @example
 * ```ts
 * // In request handler
 * await runWithLogContext({ level: LogLevel.DEBUG, prefix: '[Request-123]' }, async () => {
 *   const log = getContextLogger()
 *   log.debug('Processing request...') // Uses request-specific config
 *
 *   await processRequest()
 *
 *   log.info('Request completed')
 * })
 * ```
 *
 * @see do-6eza - Request-scoped logger configuration
 */
export declare function runWithLogContext<T>(logConfig: LoggerConfig, fn: () => Promise<T>): Promise<T>;
/**
 * Get a logger using the current request-scoped configuration.
 *
 * If called within `runWithLogContext()`, returns a logger using that config.
 * Otherwise, returns a logger using the global config (for backward compatibility).
 *
 * @returns A Logger instance using request-scoped or global config
 *
 * @example
 * ```ts
 * // Within runWithLogContext - uses scoped config
 * await runWithLogContext({ level: LogLevel.DEBUG, prefix: '[Scoped]' }, async () => {
 *   const log = getContextLogger()
 *   log.debug('Uses scoped config')
 * })
 *
 * // Outside runWithLogContext - uses global config
 * const log = getContextLogger()
 * log.info('Uses global config')
 * ```
 *
 * @see do-6eza - Request-scoped logger configuration
 */
export declare function getContextLogger(): Logger;
/**
 * Get the current request-scoped logging configuration, if any.
 *
 * @returns The current LoggerConfig from AsyncLocalStorage, or undefined
 *
 * @example
 * ```ts
 * await runWithLogContext({ level: LogLevel.DEBUG, prefix: '[Test]' }, async () => {
 *   const config = getLogContext()
 *   console.log(config?.level) // LogLevel.DEBUG
 * })
 * ```
 */
export declare function getLogContext(): LoggerConfig | undefined;
/**
 * Default logger instance with [dotdo] prefix
 * Uses the global configuration for log level
 *
 * @deprecated For Workers, use `createScopedLogger()` or `runWithLogContext()`
 * to avoid configuration leakage between requests. The global logger shares
 * mutable state across all requests in the same isolate.
 */
export declare const logger: Logger;
//# sourceMappingURL=logger.d.ts.map