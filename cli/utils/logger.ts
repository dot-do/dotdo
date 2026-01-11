/**
 * Logger Utility
 *
 * Provides consistent, colorful logging for CLI operations.
 * Supports different log levels and contexts.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success'

export interface LoggerOptions {
  level?: LogLevel
  context?: string
  silent?: boolean
  colors?: boolean
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

// Icons for different log levels
const icons = {
  debug: colors.gray + '[debug]' + colors.reset,
  info: colors.blue + '[info]' + colors.reset,
  warn: colors.yellow + '[warn]' + colors.reset,
  error: colors.red + '[error]' + colors.reset,
  success: colors.green + '[ok]' + colors.reset,
}

// Log level priority
const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  success: 1,
}

/**
 * Logger class for CLI output
 */
export class Logger {
  private level: LogLevel
  private context: string
  private silent: boolean
  private useColors: boolean

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? (process.env.DEBUG ? 'debug' : 'info')
    this.context = options.context ?? ''
    this.silent = options.silent ?? false
    this.useColors = options.colors ?? (process.stdout.isTTY ?? false)
  }

  /**
   * Format a message with context and level
   */
  private format(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    const icon = this.useColors ? icons[level] : `[${level}]`
    const ctx = this.context ? this.useColors ? `${colors.dim}(${this.context})${colors.reset}` : `(${this.context})` : ''

    let output = `${icon} ${ctx} ${message}`

    if (data) {
      const dataStr = JSON.stringify(data, null, 2)
      output += this.useColors ? `\n${colors.dim}${dataStr}${colors.reset}` : `\n${dataStr}`
    }

    return output
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return !this.silent && levelPriority[level] >= levelPriority[this.level]
  }

  /**
   * Debug level logging
   */
  debug(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.log(this.format('debug', message, data))
    }
  }

  /**
   * Info level logging
   */
  info(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.log(this.format('info', message, data))
    }
  }

  /**
   * Warning level logging
   */
  warn(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.format('warn', message, data))
    }
  }

  /**
   * Error level logging
   */
  error(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      console.error(this.format('error', message, data))
    }
  }

  /**
   * Success level logging
   */
  success(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('success')) {
      console.log(this.format('success', message, data))
    }
  }

  /**
   * Plain output without formatting
   */
  log(message: string): void {
    if (!this.silent) {
      console.log(message)
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: string): Logger {
    return new Logger({
      level: this.level,
      context: this.context ? `${this.context}:${context}` : context,
      silent: this.silent,
      colors: this.useColors,
    })
  }

  /**
   * Create a spinner for long operations
   */
  spinner(message: string): Spinner {
    return new Spinner(message, this)
  }
}

/**
 * Spinner for long-running operations
 */
export class Spinner {
  private message: string
  private logger: Logger
  private frames = ['|', '/', '-', '\\']
  private frameIndex = 0
  private interval: ReturnType<typeof setInterval> | null = null

  constructor(message: string, logger: Logger) {
    this.message = message
    this.logger = logger
  }

  /**
   * Start the spinner
   */
  start(): void {
    if (process.stdout.isTTY) {
      this.interval = setInterval(() => {
        process.stdout.write(`\r${colors.cyan}${this.frames[this.frameIndex]}${colors.reset} ${this.message}`)
        this.frameIndex = (this.frameIndex + 1) % this.frames.length
      }, 100)
    } else {
      this.logger.info(this.message)
    }
  }

  /**
   * Stop the spinner with success
   */
  succeed(message?: string): void {
    this.stop()
    this.logger.success(message ?? this.message)
  }

  /**
   * Stop the spinner with failure
   */
  fail(message?: string): void {
    this.stop()
    this.logger.error(message ?? this.message)
  }

  /**
   * Stop the spinner
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
      if (process.stdout.isTTY) {
        process.stdout.write('\r' + ' '.repeat(this.message.length + 10) + '\r')
      }
    }
  }
}

/**
 * Create a new logger instance
 */
export function createLogger(context?: string, options?: Omit<LoggerOptions, 'context'>): Logger {
  return new Logger({ ...options, context })
}

/**
 * Default logger instance
 */
export const logger = createLogger('dotdo')
