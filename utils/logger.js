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
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
    LogLevel[LogLevel["SILENT"] = 4] = "SILENT";
})(LogLevel || (LogLevel = {}));
// Default configuration
let config = {
    level: LogLevel.INFO,
    prefix: '[dotdo]',
};
/**
 * Set the global log level
 * @param level - The minimum log level to display
 * @deprecated Use `createScopedLogger()` or `runWithLogContext()` for request-scoped configuration.
 * Global config is problematic in Workers where module state is shared across requests.
 */
export function setLogLevel(level) {
    config.level = level;
}
/**
 * Get the current log level
 * @deprecated Use `createScopedLogger()` or `runWithLogContext()` for request-scoped configuration.
 */
export function getLogLevel() {
    return config.level;
}
/**
 * Set the log prefix
 * @param prefix - The prefix to use for all log messages
 * @deprecated Use `createScopedLogger()` or `runWithLogContext()` for request-scoped configuration.
 * Global config is problematic in Workers where module state is shared across requests.
 */
export function setLogPrefix(prefix) {
    config.prefix = prefix;
}
/**
 * Get the current log prefix
 * @deprecated Use `createScopedLogger()` or `runWithLogContext()` for request-scoped configuration.
 */
export function getLogPrefix() {
    return config.prefix;
}
/**
 * Configure the logger
 * @param newConfig - Partial configuration to merge
 * @deprecated Use `createScopedLogger()` or `runWithLogContext()` for request-scoped configuration.
 * Global config is problematic in Workers where module state is shared across requests.
 */
export function configureLogger(newConfig) {
    config = { ...config, ...newConfig };
}
/**
 * Parse log level from string (for environment variables)
 * @param level - String representation of log level
 * @returns LogLevel enum value
 */
export function parseLogLevel(level) {
    if (!level)
        return LogLevel.INFO;
    switch (level.toUpperCase()) {
        case 'DEBUG':
            return LogLevel.DEBUG;
        case 'INFO':
            return LogLevel.INFO;
        case 'WARN':
        case 'WARNING':
            return LogLevel.WARN;
        case 'ERROR':
            return LogLevel.ERROR;
        case 'SILENT':
        case 'NONE':
            return LogLevel.SILENT;
        default:
            return LogLevel.INFO;
    }
}
/**
 * Initialize logger from environment variable
 *
 * @deprecated This function no longer accesses process.env to avoid `any` type casts.
 * Use `createScopedLogger()` with explicit config instead.
 *
 * For Workers/DO: Pass log level from your wrangler.toml env binding:
 * ```ts
 * const logger = createScopedLogger({
 *   level: parseLogLevel(env.DOTDO_LOG_LEVEL),
 *   prefix: '[MyService]'
 * })
 * ```
 *
 * For Node.js: Use explicit injection:
 * ```ts
 * const logger = createScopedLogger({
 *   level: parseLogLevel(process.env.DOTDO_LOG_LEVEL),
 *   prefix: '[MyService]'
 * })
 * ```
 */
export function initLoggerFromEnv() {
    // No-op: This function is deprecated.
    // The previous implementation used (globalThis as any).process?.env which
    // bypassed TypeScript's type safety. Use createScopedLogger() with explicit
    // environment injection instead.
}
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
export function createLogger(prefix) {
    return {
        debug: (message, ...args) => {
            if (config.level <= LogLevel.DEBUG) {
                console.debug(prefix, message, ...args);
            }
        },
        info: (message, ...args) => {
            if (config.level <= LogLevel.INFO) {
                console.info(prefix, message, ...args);
            }
        },
        warn: (message, ...args) => {
            if (config.level <= LogLevel.WARN) {
                console.warn(prefix, message, ...args);
            }
        },
        error: (message, ...args) => {
            if (config.level <= LogLevel.ERROR) {
                console.error(prefix, message, ...args);
            }
        },
    };
}
// ============================================================================
// Request-Scoped Logging (Recommended for Workers)
// ============================================================================
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
export function createScopedLogger(scopedConfig) {
    // Capture config at creation time - fully isolated from global state
    const loggerConfig = { ...scopedConfig };
    return {
        debug: (message, ...args) => {
            if (loggerConfig.level <= LogLevel.DEBUG) {
                console.debug(loggerConfig.prefix, message, ...args);
            }
        },
        info: (message, ...args) => {
            if (loggerConfig.level <= LogLevel.INFO) {
                console.info(loggerConfig.prefix, message, ...args);
            }
        },
        warn: (message, ...args) => {
            if (loggerConfig.level <= LogLevel.WARN) {
                console.warn(loggerConfig.prefix, message, ...args);
            }
        },
        error: (message, ...args) => {
            if (loggerConfig.level <= LogLevel.ERROR) {
                console.error(loggerConfig.prefix, message, ...args);
            }
        },
    };
}
/**
 * AsyncLocalStorage instance for request-scoped logging config.
 * Lazily initialized to avoid issues in environments without AsyncLocalStorage.
 */
let logAsyncLocalStorage = null;
/**
 * Lazy initialization of AsyncLocalStorage.
 * Works in Node.js, Cloudflare Workers, and other compatible runtimes.
 */
async function getLogAsyncLocalStorage() {
    if (!logAsyncLocalStorage) {
        try {
            // Try dynamic import for Node.js/Workers environments
            const moduleName = 'node:async_hooks';
            const asyncHooks = await import(moduleName);
            logAsyncLocalStorage = new asyncHooks.AsyncLocalStorage();
        }
        catch {
            // Fallback: Stack-based implementation for non-ALS environments
            const contextStack = [];
            logAsyncLocalStorage = {
                run(store, callback) {
                    contextStack.push(store);
                    const result = callback();
                    // Handle async callbacks
                    const isPromiseLike = (val) => val !== null &&
                        typeof val === 'object' &&
                        typeof val.then === 'function';
                    if (isPromiseLike(result)) {
                        const resultPromise = Promise.resolve(result).finally(() => {
                            contextStack.pop();
                        });
                        return resultPromise;
                    }
                    contextStack.pop();
                    return result;
                },
                getStore() {
                    return contextStack[contextStack.length - 1];
                },
            };
        }
    }
    return logAsyncLocalStorage;
}
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
export async function runWithLogContext(logConfig, fn) {
    const als = await getLogAsyncLocalStorage();
    return als.run(logConfig, fn);
}
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
export function getContextLogger() {
    const scopedConfig = logAsyncLocalStorage?.getStore();
    if (scopedConfig) {
        // Return a logger using the request-scoped config
        return createScopedLogger(scopedConfig);
    }
    // Fallback to global logger for backward compatibility
    return logger;
}
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
export function getLogContext() {
    return logAsyncLocalStorage?.getStore();
}
/**
 * Default logger instance with [dotdo] prefix
 * Uses the global configuration for log level
 *
 * @deprecated For Workers, use `createScopedLogger()` or `runWithLogContext()`
 * to avoid configuration leakage between requests. The global logger shares
 * mutable state across all requests in the same isolate.
 */
export const logger = {
    debug: (message, ...args) => {
        if (config.level <= LogLevel.DEBUG) {
            console.debug(config.prefix, message, ...args);
        }
    },
    info: (message, ...args) => {
        if (config.level <= LogLevel.INFO) {
            console.info(config.prefix, message, ...args);
        }
    },
    warn: (message, ...args) => {
        if (config.level <= LogLevel.WARN) {
            console.warn(config.prefix, message, ...args);
        }
    },
    error: (message, ...args) => {
        if (config.level <= LogLevel.ERROR) {
            console.error(config.prefix, message, ...args);
        }
    },
};
// Initialize from environment on module load
initLoggerFromEnv();
//# sourceMappingURL=logger.js.map