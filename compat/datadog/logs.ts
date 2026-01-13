/**
 * @dotdo/datadog - Logs Module
 *
 * Datadog-compatible structured logging API.
 *
 * @module @dotdo/datadog/logs
 */

import type {
  LogLevel,
  LogStatus,
  LogEntry,
  LogContext,
  DatadogConfig,
  DatadogResponse,
} from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Logger configuration options.
 */
export interface LoggerConfig extends DatadogConfig {
  /** Default log level */
  level?: LogLevel
  /** Pretty print in development */
  prettyPrint?: boolean
  /** Include timestamps */
  timestamps?: boolean
  /** Include source location */
  includeSource?: boolean
}

/**
 * Log handler function type.
 */
export type LogHandler = (entry: LogEntry) => void

// =============================================================================
// Level Mapping
// =============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
}

const LEVEL_TO_STATUS: Record<LogLevel, LogStatus> = {
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
  critical: 'critical',
}

// =============================================================================
// Logger Implementation
// =============================================================================

/**
 * Datadog-compatible structured logger.
 */
export class Logger {
  private readonly config: Required<Pick<LoggerConfig, 'service' | 'env' | 'hostname' | 'level'>> & LoggerConfig
  private context: LogContext = {}
  private readonly buffer: LogEntry[] = []
  private readonly handlers: LogHandler[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private enabled = true

  constructor(config: LoggerConfig = {}) {
    this.config = {
      service: config.service ?? 'unknown',
      env: config.env ?? 'development',
      hostname: config.hostname ?? 'localhost',
      level: config.level ?? 'info',
      batching: config.batching ?? true,
      batchSize: config.batchSize ?? 100,
      flushInterval: config.flushInterval ?? 5000,
      prettyPrint: config.prettyPrint ?? false,
      timestamps: config.timestamps ?? true,
      includeSource: config.includeSource ?? false,
      ...config,
    }

    // Set default context
    this.context = {
      service: this.config.service,
      hostname: this.config.hostname,
      env: this.config.env,
      version: this.config.version,
    }

    if (this.config.batching && this.config.flushInterval > 0) {
      this.startAutoFlush()
    }
  }

  // ===========================================================================
  // Core Logging Methods
  // ===========================================================================

  /**
   * Log at debug level.
   */
  debug(message: string, attributes?: Record<string, unknown>): void {
    this.log('debug', message, attributes)
  }

  /**
   * Log at info level.
   */
  info(message: string, attributes?: Record<string, unknown>): void {
    this.log('info', message, attributes)
  }

  /**
   * Log at warn level.
   */
  warn(message: string, attributes?: Record<string, unknown>): void {
    this.log('warn', message, attributes)
  }

  /**
   * Log at error level.
   */
  error(message: string, attributes?: Record<string, unknown>): void {
    this.log('error', message, attributes)
  }

  /**
   * Log at critical level.
   */
  critical(message: string, attributes?: Record<string, unknown>): void {
    this.log('critical', message, attributes)
  }

  /**
   * Generic log method.
   */
  log(level: LogLevel, message: string, attributes?: Record<string, unknown>): void {
    if (!this.enabled) return
    if (!this.shouldLog(level)) return

    const entry = this.createEntry(level, message, attributes)
    this.processEntry(entry)
  }

  // ===========================================================================
  // Error Logging
  // ===========================================================================

  /**
   * Log an error object.
   */
  logError(error: Error, message?: string, attributes?: Record<string, unknown>): void {
    const errorAttrs = {
      error: {
        kind: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...attributes,
    }

    this.error(message ?? error.message, errorAttrs)
  }

  /**
   * Log a warning with an error.
   */
  logWarning(error: Error, message?: string, attributes?: Record<string, unknown>): void {
    const errorAttrs = {
      error: {
        kind: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...attributes,
    }

    this.warn(message ?? error.message, errorAttrs)
  }

  // ===========================================================================
  // Context Management
  // ===========================================================================

  /**
   * Set the global log context.
   */
  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context }
  }

  /**
   * Get the current context.
   */
  getContext(): LogContext {
    return { ...this.context }
  }

  /**
   * Clear the context (reset to defaults).
   */
  clearContext(): void {
    this.context = {
      service: this.config.service,
      hostname: this.config.hostname,
      env: this.config.env,
      version: this.config.version,
    }
  }

  /**
   * Add a tag to all logs.
   */
  addTag(tag: string): void {
    const tags = this.context.tags ?? []
    if (!tags.includes(tag)) {
      this.context.tags = [...tags, tag]
    }
  }

  /**
   * Remove a tag from all logs.
   */
  removeTag(tag: string): void {
    if (this.context.tags) {
      this.context.tags = this.context.tags.filter(t => t !== tag)
    }
  }

  /**
   * Add an attribute to the context.
   */
  addAttribute(key: string, value: unknown): void {
    this.context[key] = value
  }

  /**
   * Remove an attribute from the context.
   */
  removeAttribute(key: string): void {
    delete this.context[key]
  }

  // ===========================================================================
  // Child Loggers
  // ===========================================================================

  /**
   * Create a child logger with additional context.
   */
  child(context: LogContext): Logger {
    const child = new Logger(this.config)
    child.context = { ...this.context, ...context }
    return child
  }

  /**
   * Create a logger bound to a specific request/trace.
   */
  withTrace(traceId: string, spanId?: string): Logger {
    return this.child({
      dd: {
        trace_id: traceId,
        span_id: spanId,
      },
    })
  }

  /**
   * Create a logger bound to a specific user.
   */
  withUser(userId: string, userData?: Record<string, unknown>): Logger {
    return this.child({
      usr: {
        id: userId,
        ...userData,
      },
    })
  }

  // ===========================================================================
  // Log Level Management
  // ===========================================================================

  /**
   * Set the minimum log level.
   */
  setLevel(level: LogLevel): void {
    this.config.level = level
  }

  /**
   * Get the current log level.
   */
  getLevel(): LogLevel {
    return this.config.level
  }

  /**
   * Check if a level would be logged.
   */
  isLevelEnabled(level: LogLevel): boolean {
    return this.shouldLog(level)
  }

  // ===========================================================================
  // Handlers
  // ===========================================================================

  /**
   * Add a custom log handler.
   */
  addHandler(handler: LogHandler): void {
    this.handlers.push(handler)
  }

  /**
   * Remove a log handler.
   */
  removeHandler(handler: LogHandler): void {
    const index = this.handlers.indexOf(handler)
    if (index >= 0) {
      this.handlers.splice(index, 1)
    }
  }

  /**
   * Clear all handlers.
   */
  clearHandlers(): void {
    this.handlers.length = 0
  }

  // ===========================================================================
  // Buffer Management
  // ===========================================================================

  /**
   * Get the log buffer.
   */
  getBuffer(): LogEntry[] {
    return [...this.buffer]
  }

  /**
   * Clear the log buffer.
   */
  clearBuffer(): void {
    this.buffer.length = 0
  }

  /**
   * Flush the log buffer.
   */
  async flush(): Promise<DatadogResponse> {
    if (this.buffer.length === 0) {
      return { status: 'ok', data: { log_count: 0 } }
    }

    const logs = [...this.buffer]
    this.buffer.length = 0

    // In a real implementation, this would send to Datadog API
    return {
      status: 'ok',
      data: { log_count: logs.length },
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Enable the logger.
   */
  enable(): void {
    this.enabled = true
    if (this.config.batching && this.config.flushInterval > 0) {
      this.startAutoFlush()
    }
  }

  /**
   * Disable the logger.
   */
  disable(): void {
    this.enabled = false
    this.stopAutoFlush()
  }

  /**
   * Check if logger is enabled.
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Close the logger.
   */
  async close(): Promise<void> {
    this.enabled = false
    this.stopAutoFlush()
    await this.flush()
  }

  /**
   * Get logger configuration.
   */
  getConfig(): LoggerConfig {
    return { ...this.config }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level]
  }

  private createEntry(
    level: LogLevel,
    message: string,
    attributes?: Record<string, unknown>
  ): LogEntry {
    const entry: LogEntry = {
      message,
      status: LEVEL_TO_STATUS[level],
      service: this.context.service,
      hostname: this.context.hostname,
      ...this.context,
      ...attributes,
    }

    // Add timestamp
    if (this.config.timestamps) {
      entry['@timestamp'] = new Date().toISOString()
    }

    // Add DD tags
    if (this.context.tags && this.context.tags.length > 0) {
      entry.ddtags = this.context.tags.join(',')
    }

    // Add source location if configured
    if (this.config.includeSource) {
      const stack = new Error().stack
      if (stack) {
        const match = stack.split('\n')[3]?.match(/at\s+(.+)\s+\((.+):(\d+):(\d+)\)/)
        if (match) {
          entry.logger = {
            name: match[1],
            file: match[2],
            line: parseInt(match[3]!, 10),
          }
        }
      }
    }

    return entry
  }

  private processEntry(entry: LogEntry): void {
    // Call handlers
    for (const handler of this.handlers) {
      try {
        handler(entry)
      } catch {
        // Ignore handler errors
      }
    }

    // Add to buffer
    this.buffer.push(entry)

    // Auto-flush if buffer is full
    if (this.buffer.length >= (this.config.batchSize ?? 100)) {
      this.flush().catch(() => {
        // Silently ignore flush errors
      })
    }
  }

  private startAutoFlush(): void {
    if (this.flushTimer) return

    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Silently ignore flush errors
      })
    }, this.config.flushInterval)
  }

  private stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new logger.
 */
export function createLogger(config?: LoggerConfig): Logger {
  return new Logger(config)
}

// =============================================================================
// Default Logger
// =============================================================================

let defaultLogger: Logger | null = null

/**
 * Get or create the default logger.
 */
export function getDefaultLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger()
  }
  return defaultLogger
}

/**
 * Set the default logger.
 */
export function setDefaultLogger(logger: Logger): void {
  defaultLogger = logger
}

/**
 * Clear the default logger.
 */
export function clearDefaultLogger(): void {
  defaultLogger = null
}

// Convenience functions using default logger
export const debug = (message: string, attributes?: Record<string, unknown>) =>
  getDefaultLogger().debug(message, attributes)

export const info = (message: string, attributes?: Record<string, unknown>) =>
  getDefaultLogger().info(message, attributes)

export const warn = (message: string, attributes?: Record<string, unknown>) =>
  getDefaultLogger().warn(message, attributes)

export const error = (message: string, attributes?: Record<string, unknown>) =>
  getDefaultLogger().error(message, attributes)

export const critical = (message: string, attributes?: Record<string, unknown>) =>
  getDefaultLogger().critical(message, attributes)
