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
 */
export function setLogLevel(level) {
    config.level = level;
}
/**
 * Get the current log level
 */
export function getLogLevel() {
    return config.level;
}
/**
 * Set the log prefix
 * @param prefix - The prefix to use for all log messages
 */
export function setLogPrefix(prefix) {
    config.prefix = prefix;
}
/**
 * Get the current log prefix
 */
export function getLogPrefix() {
    return config.prefix;
}
/**
 * Configure the logger
 * @param newConfig - Partial configuration to merge
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
 * Reads DOTDO_LOG_LEVEL environment variable if available
 */
export function initLoggerFromEnv() {
    // Check for environment variable (works in Node.js)
    if (typeof process !== 'undefined' && process.env?.DOTDO_LOG_LEVEL) {
        setLogLevel(parseLogLevel(process.env.DOTDO_LOG_LEVEL));
    }
}
/**
 * Create a logger with a custom prefix
 * Useful for creating module-specific loggers
 *
 * @example
 * const wsLogger = createLogger('[WebSocket]')
 * wsLogger.info('Connection established')
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
/**
 * Default logger instance with [dotdo] prefix
 * Uses the global configuration for log level
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