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

import { createLogger, LogLevel, type Logger, type LogEntry } from '../index'

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
