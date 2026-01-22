// @dotdo/db Logger
// Simple logging utility for standalone npm package
//
// NOTE: This is a minimal logger for standalone db package usage.
// For full-featured structured logging with:
// - Sensitive data redaction (passwords, API keys, tokens)
// - Correlation ID support for distributed tracing
// - Child loggers with inherited context
// - JSON output formatting
//
// Use @dotdo/observability instead:
//   import { createStructuredLogger, LogLevel } from '@dotdo/observability'
//
// See do-fmux2 for the standardization initiative.
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
// Default log level
let globalLogLevel = LogLevel.INFO;
/**
 * Set the global log level
 */
export function setLogLevel(level) {
    globalLogLevel = level;
}
/**
 * Get the current log level
 */
export function getLogLevel() {
    return globalLogLevel;
}
/**
 * Create a logger with a custom prefix
 *
 * @example
 * const logger = createLogger('[SQLite]')
 * logger.info('Connection established')
 */
export function createLogger(prefix) {
    return {
        debug: (message, ...args) => {
            if (globalLogLevel <= LogLevel.DEBUG) {
                console.debug(prefix, message, ...args);
            }
        },
        info: (message, ...args) => {
            if (globalLogLevel <= LogLevel.INFO) {
                console.info(prefix, message, ...args);
            }
        },
        warn: (message, ...args) => {
            if (globalLogLevel <= LogLevel.WARN) {
                console.warn(prefix, message, ...args);
            }
        },
        error: (message, ...args) => {
            if (globalLogLevel <= LogLevel.ERROR) {
                console.error(prefix, message, ...args);
            }
        },
    };
}
/**
 * Default logger with [dotdo/db] prefix
 */
export const logger = createLogger('[dotdo/db]');
//# sourceMappingURL=logger.js.map