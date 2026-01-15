import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Structured Logger Tests (TDD - RED Phase)
 *
 * These tests verify the structured logging abstraction that replaces console.log.
 * They are expected to FAIL until lib/logging/index.ts is implemented.
 *
 * Requirements:
 * - Log levels: debug, info, warn, error
 * - Structured JSON output with context
 * - Correlation ID support for request tracing
 * - Environment-based log level filtering
 */

import {
  createLogger,
  LogLevel,
  parseLogLevel,
  logLevelToString,
  setGlobalLogLevel,
  getGlobalLogLevel,
  initLogLevelFromEnv,
  createLoggerFromEnv,
  logger,
  type Logger,
  type LogEntry
} from '../index'

// ============================================================================
// Logger Creation
// ============================================================================

describe('createLogger', () => {
  it('exports createLogger function', () => {
    expect(typeof createLogger).toBe('function')
  })

  it('returns a Logger instance', () => {
    const logger = createLogger()
    expect(logger).toBeDefined()
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
  })

  it('accepts optional name for the logger', () => {
    const logger = createLogger({ name: 'my-service' })
    expect(logger).toBeDefined()
  })

  it('accepts optional default context', () => {
    const logger = createLogger({
      name: 'my-service',
      context: { service: 'api', version: '1.0.0' }
    })
    expect(logger).toBeDefined()
  })
})

// ============================================================================
// Log Level Enum
// ============================================================================

describe('LogLevel enum', () => {
  it('exports LogLevel enum', () => {
    expect(LogLevel).toBeDefined()
  })

  it('has debug level with value 0', () => {
    expect(LogLevel.DEBUG).toBe(0)
  })

  it('has info level with value 1', () => {
    expect(LogLevel.INFO).toBe(1)
  })

  it('has warn level with value 2', () => {
    expect(LogLevel.WARN).toBe(2)
  })

  it('has error level with value 3', () => {
    expect(LogLevel.ERROR).toBe(3)
  })

  it('has silent level with value 4 to suppress all logs', () => {
    expect(LogLevel.SILENT).toBe(4)
  })
})

// ============================================================================
// Log Level Filtering
// ============================================================================

describe('log level filtering', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  describe('with level set to DEBUG', () => {
    it('logs debug messages', () => {
      const logger = createLogger({ level: LogLevel.DEBUG })
      logger.debug('debug message')
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('logs info messages', () => {
      const logger = createLogger({ level: LogLevel.DEBUG })
      logger.info('info message')
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('logs warn messages', () => {
      const logger = createLogger({ level: LogLevel.DEBUG })
      logger.warn('warn message')
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('logs error messages', () => {
      const logger = createLogger({ level: LogLevel.DEBUG })
      logger.error('error message')
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('with level set to INFO', () => {
    it('does not log debug messages', () => {
      const logger = createLogger({ level: LogLevel.INFO })
      logger.debug('debug message')
      expect(consoleSpy).not.toHaveBeenCalled()
    })

    it('logs info messages', () => {
      const logger = createLogger({ level: LogLevel.INFO })
      logger.info('info message')
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('logs warn messages', () => {
      const logger = createLogger({ level: LogLevel.INFO })
      logger.warn('warn message')
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('logs error messages', () => {
      const logger = createLogger({ level: LogLevel.INFO })
      logger.error('error message')
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('with level set to WARN', () => {
    it('does not log debug messages', () => {
      const logger = createLogger({ level: LogLevel.WARN })
      logger.debug('debug message')
      expect(consoleSpy).not.toHaveBeenCalled()
    })

    it('does not log info messages', () => {
      const logger = createLogger({ level: LogLevel.WARN })
      logger.info('info message')
      expect(consoleSpy).not.toHaveBeenCalled()
    })

    it('logs warn messages', () => {
      const logger = createLogger({ level: LogLevel.WARN })
      logger.warn('warn message')
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('logs error messages', () => {
      const logger = createLogger({ level: LogLevel.WARN })
      logger.error('error message')
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('with level set to ERROR', () => {
    it('does not log debug messages', () => {
      const logger = createLogger({ level: LogLevel.ERROR })
      logger.debug('debug message')
      expect(consoleSpy).not.toHaveBeenCalled()
    })

    it('does not log info messages', () => {
      const logger = createLogger({ level: LogLevel.ERROR })
      logger.info('info message')
      expect(consoleSpy).not.toHaveBeenCalled()
    })

    it('does not log warn messages', () => {
      const logger = createLogger({ level: LogLevel.ERROR })
      logger.warn('warn message')
      expect(consoleSpy).not.toHaveBeenCalled()
    })

    it('logs error messages', () => {
      const logger = createLogger({ level: LogLevel.ERROR })
      logger.error('error message')
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('with level set to SILENT', () => {
    it('does not log any messages', () => {
      const logger = createLogger({ level: LogLevel.SILENT })
      logger.debug('debug message')
      logger.info('info message')
      logger.warn('warn message')
      logger.error('error message')
      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Structured JSON Output
// ============================================================================

describe('structured JSON output', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let capturedOutput: string | undefined

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation((output: string) => {
      capturedOutput = output
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    capturedOutput = undefined
  })

  it('outputs valid JSON', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test message')

    expect(capturedOutput).toBeDefined()
    expect(() => JSON.parse(capturedOutput!)).not.toThrow()
  })

  it('includes timestamp in ISO format', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test message')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.timestamp).toBeDefined()
    expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp)
  })

  it('includes log level as string', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test message')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.level).toBe('info')
  })

  it('includes the log message', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test message')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.message).toBe('test message')
  })

  it('includes logger name when provided', () => {
    const logger = createLogger({ name: 'my-service', level: LogLevel.DEBUG })
    logger.info('test message')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.name).toBe('my-service')
  })

  it('includes default context in all log entries', () => {
    const logger = createLogger({
      level: LogLevel.DEBUG,
      context: { service: 'api', version: '1.0.0' }
    })
    logger.info('test message')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.service).toBe('api')
    expect(parsed.version).toBe('1.0.0')
  })

  it('includes per-call context', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test message', { userId: 123, action: 'login' })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.userId).toBe(123)
    expect(parsed.action).toBe('login')
  })

  it('merges default context with per-call context', () => {
    const logger = createLogger({
      level: LogLevel.DEBUG,
      context: { service: 'api' }
    })
    logger.info('test message', { userId: 123 })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.service).toBe('api')
    expect(parsed.userId).toBe(123)
  })

  it('per-call context overrides default context', () => {
    const logger = createLogger({
      level: LogLevel.DEBUG,
      context: { env: 'default' }
    })
    logger.info('test message', { env: 'overridden' })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.env).toBe('overridden')
  })
})

// ============================================================================
// Correlation ID Support
// ============================================================================

describe('correlation ID support', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let capturedOutput: string | undefined

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation((output: string) => {
      capturedOutput = output
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    capturedOutput = undefined
  })

  it('includes correlationId when provided in context', () => {
    const logger = createLogger({
      level: LogLevel.DEBUG,
      context: { correlationId: 'req-123-abc' }
    })
    logger.info('test message')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.correlationId).toBe('req-123-abc')
  })

  it('includes requestId when provided in per-call context', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test message', { requestId: 'req-456-def' })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.requestId).toBe('req-456-def')
  })

  it('child logger inherits correlation ID', () => {
    const logger = createLogger({
      level: LogLevel.DEBUG,
      context: { correlationId: 'req-123-abc' }
    })
    const childLogger = logger.child({ component: 'database' })
    childLogger.info('database query')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.correlationId).toBe('req-123-abc')
    expect(parsed.component).toBe('database')
  })
})

// ============================================================================
// Child Logger
// ============================================================================

describe('child logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let capturedOutput: string | undefined

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation((output: string) => {
      capturedOutput = output
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    capturedOutput = undefined
  })

  it('creates child logger with child() method', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    const childLogger = logger.child({ component: 'auth' })

    expect(childLogger).toBeDefined()
    expect(typeof childLogger.info).toBe('function')
  })

  it('child logger inherits parent context', () => {
    const logger = createLogger({
      level: LogLevel.DEBUG,
      context: { service: 'api' }
    })
    const childLogger = logger.child({ component: 'auth' })
    childLogger.info('auth event')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.service).toBe('api')
    expect(parsed.component).toBe('auth')
  })

  it('child logger inherits parent log level', () => {
    const logger = createLogger({ level: LogLevel.WARN })
    const childLogger = logger.child({ component: 'auth' })
    childLogger.info('should not log')

    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('child logger inherits parent name', () => {
    const logger = createLogger({ name: 'api', level: LogLevel.DEBUG })
    const childLogger = logger.child({ component: 'auth' })
    childLogger.info('auth event')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.name).toBe('api')
  })

  it('can create nested child loggers', () => {
    const logger = createLogger({
      level: LogLevel.DEBUG,
      context: { service: 'api' }
    })
    const authLogger = logger.child({ component: 'auth' })
    const tokenLogger = authLogger.child({ subcomponent: 'token' })
    tokenLogger.info('token generated')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.service).toBe('api')
    expect(parsed.component).toBe('auth')
    expect(parsed.subcomponent).toBe('token')
  })
})

// ============================================================================
// Error Handling
// ============================================================================

describe('error handling', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let capturedOutput: string | undefined

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation((output: string) => {
      capturedOutput = output
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    capturedOutput = undefined
  })

  it('logs Error objects with message', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    const error = new Error('Something went wrong')
    logger.error('Operation failed', { error })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.error).toBeDefined()
    expect(parsed.error.message).toBe('Something went wrong')
  })

  it('logs Error objects with stack trace', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    const error = new Error('Something went wrong')
    logger.error('Operation failed', { error })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.error.stack).toBeDefined()
    expect(parsed.error.stack).toContain('Error: Something went wrong')
  })

  it('logs Error objects with name', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    const error = new TypeError('Invalid type')
    logger.error('Type error occurred', { error })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.error.name).toBe('TypeError')
  })

  it('handles circular references in context', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    const circular: Record<string, unknown> = { value: 'test' }
    circular.self = circular

    // Should not throw
    expect(() => logger.info('circular test', { data: circular })).not.toThrow()
    expect(consoleSpy).toHaveBeenCalled()
  })
})

// ============================================================================
// Log Entry Type
// ============================================================================

describe('LogEntry type', () => {
  it('has required fields', () => {
    // Type-level test: LogEntry should have these fields
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'test'
    }

    expect(entry.timestamp).toBeDefined()
    expect(entry.level).toBeDefined()
    expect(entry.message).toBeDefined()
  })

  it('allows optional name field', () => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'test',
      name: 'my-logger'
    }

    expect(entry.name).toBe('my-logger')
  })

  it('allows additional context fields', () => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'test',
      userId: 123,
      requestId: 'req-123'
    }

    expect(entry.userId).toBe(123)
    expect(entry.requestId).toBe('req-123')
  })
})

// ============================================================================
// parseLogLevel - Environment Variable Parsing
// ============================================================================

describe('parseLogLevel', () => {
  it('parses "debug" to LogLevel.DEBUG', () => {
    expect(parseLogLevel('debug')).toBe(LogLevel.DEBUG)
  })

  it('parses "info" to LogLevel.INFO', () => {
    expect(parseLogLevel('info')).toBe(LogLevel.INFO)
  })

  it('parses "warn" to LogLevel.WARN', () => {
    expect(parseLogLevel('warn')).toBe(LogLevel.WARN)
  })

  it('parses "warning" to LogLevel.WARN', () => {
    expect(parseLogLevel('warning')).toBe(LogLevel.WARN)
  })

  it('parses "error" to LogLevel.ERROR', () => {
    expect(parseLogLevel('error')).toBe(LogLevel.ERROR)
  })

  it('parses "silent" to LogLevel.SILENT', () => {
    expect(parseLogLevel('silent')).toBe(LogLevel.SILENT)
  })

  it('parses "none" to LogLevel.SILENT', () => {
    expect(parseLogLevel('none')).toBe(LogLevel.SILENT)
  })

  it('parses "off" to LogLevel.SILENT', () => {
    expect(parseLogLevel('off')).toBe(LogLevel.SILENT)
  })

  it('is case-insensitive', () => {
    expect(parseLogLevel('DEBUG')).toBe(LogLevel.DEBUG)
    expect(parseLogLevel('Debug')).toBe(LogLevel.DEBUG)
    expect(parseLogLevel('INFO')).toBe(LogLevel.INFO)
    expect(parseLogLevel('WARN')).toBe(LogLevel.WARN)
    expect(parseLogLevel('ERROR')).toBe(LogLevel.ERROR)
    expect(parseLogLevel('SILENT')).toBe(LogLevel.SILENT)
  })

  it('trims whitespace', () => {
    expect(parseLogLevel('  debug  ')).toBe(LogLevel.DEBUG)
    expect(parseLogLevel('\tinfo\n')).toBe(LogLevel.INFO)
  })

  it('returns INFO by default for undefined', () => {
    expect(parseLogLevel(undefined)).toBe(LogLevel.INFO)
  })

  it('returns INFO by default for null', () => {
    expect(parseLogLevel(null)).toBe(LogLevel.INFO)
  })

  it('returns INFO by default for empty string', () => {
    expect(parseLogLevel('')).toBe(LogLevel.INFO)
  })

  it('returns INFO by default for invalid value', () => {
    expect(parseLogLevel('invalid')).toBe(LogLevel.INFO)
    expect(parseLogLevel('verbose')).toBe(LogLevel.INFO)
    expect(parseLogLevel('trace')).toBe(LogLevel.INFO)
  })

  it('accepts custom default level', () => {
    expect(parseLogLevel(undefined, LogLevel.DEBUG)).toBe(LogLevel.DEBUG)
    expect(parseLogLevel('invalid', LogLevel.ERROR)).toBe(LogLevel.ERROR)
  })
})

// ============================================================================
// logLevelToString - Enum to String Conversion
// ============================================================================

describe('logLevelToString', () => {
  it('converts LogLevel.DEBUG to "debug"', () => {
    expect(logLevelToString(LogLevel.DEBUG)).toBe('debug')
  })

  it('converts LogLevel.INFO to "info"', () => {
    expect(logLevelToString(LogLevel.INFO)).toBe('info')
  })

  it('converts LogLevel.WARN to "warn"', () => {
    expect(logLevelToString(LogLevel.WARN)).toBe('warn')
  })

  it('converts LogLevel.ERROR to "error"', () => {
    expect(logLevelToString(LogLevel.ERROR)).toBe('error')
  })

  it('converts LogLevel.SILENT to "silent"', () => {
    expect(logLevelToString(LogLevel.SILENT)).toBe('silent')
  })

  it('returns "unknown" for invalid values', () => {
    expect(logLevelToString(99 as LogLevel)).toBe('unknown')
  })
})

// ============================================================================
// Global Log Level Configuration
// ============================================================================

describe('global log level', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let originalLevel: LogLevel

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    originalLevel = getGlobalLogLevel()
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    setGlobalLogLevel(originalLevel)
  })

  it('getGlobalLogLevel returns current level', () => {
    expect(getGlobalLogLevel()).toBeDefined()
    expect(typeof getGlobalLogLevel()).toBe('number')
  })

  it('setGlobalLogLevel changes the global level', () => {
    setGlobalLogLevel(LogLevel.DEBUG)
    expect(getGlobalLogLevel()).toBe(LogLevel.DEBUG)

    setGlobalLogLevel(LogLevel.ERROR)
    expect(getGlobalLogLevel()).toBe(LogLevel.ERROR)
  })

  it('default logger respects global log level changes', () => {
    setGlobalLogLevel(LogLevel.ERROR)
    logger.info('should not log')
    expect(consoleSpy).not.toHaveBeenCalled()

    setGlobalLogLevel(LogLevel.DEBUG)
    logger.debug('should log')
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('initLogLevelFromEnv sets level from env object', () => {
    const level = initLogLevelFromEnv({ LOG_LEVEL: 'debug' })
    expect(level).toBe(LogLevel.DEBUG)
    expect(getGlobalLogLevel()).toBe(LogLevel.DEBUG)
  })

  it('initLogLevelFromEnv defaults to INFO when LOG_LEVEL not set', () => {
    const level = initLogLevelFromEnv({})
    expect(level).toBe(LogLevel.INFO)
  })

  it('initLogLevelFromEnv handles undefined env', () => {
    const level = initLogLevelFromEnv(undefined)
    expect(level).toBe(LogLevel.INFO)
  })

  it('initLogLevelFromEnv handles null env', () => {
    const level = initLogLevelFromEnv(null)
    expect(level).toBe(LogLevel.INFO)
  })
})

// ============================================================================
// createLoggerFromEnv - Environment-Configured Logger Factory
// ============================================================================

describe('createLoggerFromEnv', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('creates logger with level from env.LOG_LEVEL', () => {
    const envLogger = createLoggerFromEnv({ LOG_LEVEL: 'debug' })
    envLogger.debug('debug message')
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('respects LOG_LEVEL=error suppressing lower levels', () => {
    const envLogger = createLoggerFromEnv({ LOG_LEVEL: 'error' })
    envLogger.info('info message')
    expect(consoleSpy).not.toHaveBeenCalled()

    envLogger.error('error message')
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('defaults to INFO when LOG_LEVEL not set', () => {
    const envLogger = createLoggerFromEnv({})
    envLogger.debug('debug message')
    expect(consoleSpy).not.toHaveBeenCalled()

    envLogger.info('info message')
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('accepts name option', () => {
    const envLogger = createLoggerFromEnv({ LOG_LEVEL: 'debug' }, { name: 'my-service' })
    envLogger.info('test')

    const logOutput = consoleSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(logOutput)
    expect(parsed.name).toBe('my-service')
  })

  it('accepts context option', () => {
    const envLogger = createLoggerFromEnv(
      { LOG_LEVEL: 'debug' },
      { context: { service: 'api', version: '1.0' } }
    )
    envLogger.info('test')

    const logOutput = consoleSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(logOutput)
    expect(parsed.service).toBe('api')
    expect(parsed.version).toBe('1.0')
  })

  it('handles undefined env', () => {
    const envLogger = createLoggerFromEnv(undefined)
    envLogger.info('test')
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('handles null env', () => {
    const envLogger = createLoggerFromEnv(null)
    envLogger.info('test')
    expect(consoleSpy).toHaveBeenCalled()
  })
})

// ============================================================================
// Structured JSON Output - Additional Tests
// ============================================================================

describe('structured JSON output - format validation', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let capturedOutput: string | undefined

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation((output: string) => {
      capturedOutput = output
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    capturedOutput = undefined
  })

  it('outputs each log as a single line (no newlines in output)', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test message', { nested: { value: 'data' } })

    expect(capturedOutput).toBeDefined()
    expect(capturedOutput!.includes('\n')).toBe(false)
  })

  it('correctly outputs level as "debug" for debug logs', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.debug('debug test')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.level).toBe('debug')
  })

  it('correctly outputs level as "info" for info logs', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('info test')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.level).toBe('info')
  })

  it('correctly outputs level as "warn" for warn logs', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.warn('warn test')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.level).toBe('warn')
  })

  it('correctly outputs level as "error" for error logs', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.error('error test')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.level).toBe('error')
  })

  it('timestamp is in ISO 8601 format with timezone', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    // ISO format: 2024-01-10T12:00:00.000Z
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('preserves numeric types in context', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test', { count: 42, rate: 3.14, zero: 0, negative: -10 })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.count).toBe(42)
    expect(typeof parsed.count).toBe('number')
    expect(parsed.rate).toBe(3.14)
    expect(parsed.zero).toBe(0)
    expect(parsed.negative).toBe(-10)
  })

  it('preserves boolean types in context', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test', { enabled: true, disabled: false })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.enabled).toBe(true)
    expect(typeof parsed.enabled).toBe('boolean')
    expect(parsed.disabled).toBe(false)
  })

  it('preserves null values in context', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test', { value: null })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.value).toBeNull()
  })

  it('preserves arrays in context', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test', { tags: ['a', 'b', 'c'], numbers: [1, 2, 3] })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.tags).toEqual(['a', 'b', 'c'])
    expect(parsed.numbers).toEqual([1, 2, 3])
  })

  it('preserves nested objects in context', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test', {
      user: {
        id: 123,
        profile: {
          name: 'Alice'
        }
      }
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect((parsed.user as any).id).toBe(123)
    expect((parsed.user as any).profile.name).toBe('Alice')
  })

  it('handles undefined values by omitting them from JSON', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })
    logger.info('test', { defined: 'yes', notDefined: undefined })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.defined).toBe('yes')
    expect('notDefined' in parsed).toBe(false)
  })
})

// ============================================================================
// Sensitive Data Protection Tests
// ============================================================================

describe('sensitive data protection', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let capturedOutput: string | undefined

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation((output: string) => {
      capturedOutput = output
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    capturedOutput = undefined
  })

  describe('developer responsibility - context should be sanitized before logging', () => {
    // These tests document that developers should NOT pass sensitive data
    // The logger does not automatically redact - it's the caller's responsibility

    it('does NOT automatically redact password fields - caller must sanitize', () => {
      const logger = createLogger({ level: LogLevel.DEBUG })
      // This is what NOT to do - demonstrating that logging does not auto-redact
      logger.info('User created', { username: 'alice', password: 'secret123' })

      const parsed = JSON.parse(capturedOutput!) as LogEntry
      // Password IS logged - this is intentional to show it's NOT auto-redacted
      expect(parsed.password).toBe('secret123')
    })

    it('recommends: redact sensitive fields before logging', () => {
      const logger = createLogger({ level: LogLevel.DEBUG })

      // Recommended pattern: sanitize before logging
      const sensitiveData = { username: 'alice', password: 'secret123', apiKey: 'abc123' }
      const safeData = {
        username: sensitiveData.username,
        // Don't include password or apiKey
      }

      logger.info('User created', safeData)

      const parsed = JSON.parse(capturedOutput!) as LogEntry
      expect(parsed.username).toBe('alice')
      expect(parsed.password).toBeUndefined()
      expect(parsed.apiKey).toBeUndefined()
    })

    it('recommends: use placeholder for redacted fields', () => {
      const logger = createLogger({ level: LogLevel.DEBUG })

      const redact = (data: Record<string, unknown>, sensitiveKeys: string[]) => {
        const result = { ...data }
        for (const key of sensitiveKeys) {
          if (key in result) {
            result[key] = '[REDACTED]'
          }
        }
        return result
      }

      const userData = { username: 'alice', password: 'secret', token: 'xyz' }
      const safeData = redact(userData, ['password', 'token'])

      logger.info('Auth attempt', safeData)

      const parsed = JSON.parse(capturedOutput!) as LogEntry
      expect(parsed.username).toBe('alice')
      expect(parsed.password).toBe('[REDACTED]')
      expect(parsed.token).toBe('[REDACTED]')
    })
  })

  describe('safe patterns for common sensitive data', () => {
    it('log only last 4 digits of credit card', () => {
      const logger = createLogger({ level: LogLevel.DEBUG })

      const maskCreditCard = (cc: string) => `****${cc.slice(-4)}`
      logger.info('Payment processed', { card: maskCreditCard('4111111111111111') })

      const parsed = JSON.parse(capturedOutput!) as LogEntry
      expect(parsed.card).toBe('****1111')
      expect(capturedOutput!).not.toContain('4111111111111111')
    })

    it('log email with domain only', () => {
      const logger = createLogger({ level: LogLevel.DEBUG })

      const maskEmail = (email: string) => {
        const [, domain] = email.split('@')
        return `***@${domain}`
      }

      logger.info('Email sent', { recipient: maskEmail('user@example.com') })

      const parsed = JSON.parse(capturedOutput!) as LogEntry
      expect(parsed.recipient).toBe('***@example.com')
      expect(capturedOutput!).not.toContain('user@example.com')
    })

    it('log IP address with last octet masked', () => {
      const logger = createLogger({ level: LogLevel.DEBUG })

      const maskIP = (ip: string) => ip.split('.').slice(0, 3).join('.') + '.xxx'

      logger.info('Request received', { clientIP: maskIP('192.168.1.100') })

      const parsed = JSON.parse(capturedOutput!) as LogEntry
      expect(parsed.clientIP).toBe('192.168.1.xxx')
      expect(capturedOutput!).not.toContain('192.168.1.100')
    })

    it('omit Authorization header from request logs', () => {
      const logger = createLogger({ level: LogLevel.DEBUG })

      const safeHeaders = (headers: Record<string, string>) => {
        const { authorization, Authorization, cookie, Cookie, ...safe } = headers
        return {
          ...safe,
          ...(authorization || Authorization ? { authorization: '[PRESENT]' } : {}),
          ...(cookie || Cookie ? { cookie: '[PRESENT]' } : {})
        }
      }

      const headers = {
        'content-type': 'application/json',
        'authorization': 'Bearer secret-token-123',
        'x-request-id': 'req-456'
      }

      logger.info('Incoming request', { headers: safeHeaders(headers) })

      const parsed = JSON.parse(capturedOutput!) as LogEntry
      const loggedHeaders = parsed.headers as Record<string, string>
      expect(loggedHeaders['content-type']).toBe('application/json')
      expect(loggedHeaders['x-request-id']).toBe('req-456')
      expect(loggedHeaders.authorization).toBe('[PRESENT]')
      expect(capturedOutput!).not.toContain('secret-token-123')
    })
  })
})

// ============================================================================
// Log Level String Consistency
// ============================================================================

describe('log level string consistency', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let capturedOutputs: string[] = []

  beforeEach(() => {
    capturedOutputs = []
    consoleSpy = vi.spyOn(console, 'log').mockImplementation((output: string) => {
      capturedOutputs.push(output)
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    capturedOutputs = []
  })

  it('all level strings are lowercase', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })

    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')

    const levels = capturedOutputs.map(o => (JSON.parse(o) as LogEntry).level)
    expect(levels).toEqual(['debug', 'info', 'warn', 'error'])

    for (const level of levels) {
      expect(level).toBe(level.toLowerCase())
    }
  })

  it('level strings match standard syslog-style names', () => {
    const logger = createLogger({ level: LogLevel.DEBUG })

    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')

    const validLevels = ['debug', 'info', 'warn', 'error']
    for (const output of capturedOutputs) {
      const parsed = JSON.parse(output) as LogEntry
      expect(validLevels).toContain(parsed.level)
    }
  })
})

// ============================================================================
// Default Logger Export
// ============================================================================

describe('default logger export', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let originalLevel: LogLevel

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    originalLevel = getGlobalLogLevel()
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    setGlobalLogLevel(originalLevel)
  })

  it('exports a default logger instance', () => {
    expect(logger).toBeDefined()
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.child).toBe('function')
  })

  it('default logger has name "dotdo"', () => {
    setGlobalLogLevel(LogLevel.DEBUG)
    logger.info('test')

    const output = consoleSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.name).toBe('dotdo')
  })

  it('default logger dynamically respects global level changes', () => {
    setGlobalLogLevel(LogLevel.ERROR)
    logger.info('should not log')
    expect(consoleSpy).not.toHaveBeenCalled()

    setGlobalLogLevel(LogLevel.INFO)
    logger.info('should log now')
    expect(consoleSpy).toHaveBeenCalled()
  })
})
