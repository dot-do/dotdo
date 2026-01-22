// Logger Tests for rpc.do - TDD Red Phase
// Tests the structured logging module for the rpc.do package
// This is the CORE logger (not CLI-specific) for general rpc.do use

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Type Tests - Ensure proper exports
// ============================================================================

describe('Logger module exports', () => {
  it('should export LogLevel type', async () => {
    const { LogLevel } = await import('../logger')
    expect(LogLevel).toBeDefined()
    expect(LogLevel.debug).toBe('debug')
    expect(LogLevel.info).toBe('info')
    expect(LogLevel.warn).toBe('warn')
    expect(LogLevel.error).toBe('error')
  })

  it('should export LogEntry interface (via type inference)', async () => {
    const { createLogger } = await import('../logger')
    const logger = createLogger()

    // LogEntry should have these properties when we call createEntry
    const entry = logger.createEntry('info', 'test message')
    expect(entry.level).toBe('info')
    expect(entry.message).toBe('test message')
    expect(entry.timestamp).toBeDefined()
  })

  it('should export Logger interface (via implementation)', async () => {
    const { createLogger } = await import('../logger')
    const logger = createLogger()

    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.child).toBe('function')
  })

  it('should export createLogger factory function', async () => {
    const { createLogger } = await import('../logger')
    expect(typeof createLogger).toBe('function')
  })

  it('should export defaultLogger instance', async () => {
    const { defaultLogger } = await import('../logger')
    expect(defaultLogger).toBeDefined()
    expect(typeof defaultLogger.info).toBe('function')
  })
})

// ============================================================================
// Structured JSON Output Tests
// ============================================================================

describe('Structured JSON output', () => {
  it('debug level outputs structured JSON', async () => {
    const { createLogger } = await import('../logger')
    const outputs: string[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(JSON.stringify(entry)),
    })

    logger.debug('debug message')

    expect(outputs.length).toBe(1)
    const entry = JSON.parse(outputs[0] as string) as { level: string; message: string }
    expect(entry.level).toBe('debug')
    expect(entry.message).toBe('debug message')
  })

  it('info level outputs structured JSON', async () => {
    const { createLogger } = await import('../logger')
    const outputs: string[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(JSON.stringify(entry)),
    })

    logger.info('info message')

    expect(outputs.length).toBe(1)
    const entry = JSON.parse(outputs[0] as string) as { level: string; message: string }
    expect(entry.level).toBe('info')
    expect(entry.message).toBe('info message')
  })

  it('warn level outputs structured JSON', async () => {
    const { createLogger } = await import('../logger')
    const outputs: string[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(JSON.stringify(entry)),
    })

    logger.warn('warn message')

    expect(outputs.length).toBe(1)
    const entry = JSON.parse(outputs[0] as string) as { level: string; message: string }
    expect(entry.level).toBe('warn')
    expect(entry.message).toBe('warn message')
  })

  it('error level outputs structured JSON', async () => {
    const { createLogger } = await import('../logger')
    const outputs: string[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(JSON.stringify(entry)),
    })

    logger.error('error message')

    expect(outputs.length).toBe(1)
    const entry = JSON.parse(outputs[0] as string) as { level: string; message: string }
    expect(entry.level).toBe('error')
    expect(entry.message).toBe('error message')
  })
})

// ============================================================================
// Log Entry Field Tests
// ============================================================================

describe('Log entry fields', () => {
  it('logs include ISO 8601 timestamp', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    logger.info('test')

    const entry = outputs[0] as { timestamp: string }
    expect(entry.timestamp).toBeDefined()
    // Should be valid ISO 8601 format
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp)
  })

  it('logs include correlation ID when set in options', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      correlationId: 'test-correlation-123',
      output: (entry) => outputs.push(entry),
    })

    logger.info('test')

    const entry = outputs[0] as { correlationId?: string }
    expect(entry.correlationId).toBe('test-correlation-123')
  })

  it('logs include correlation ID when passed to log method', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    logger.info('test', { correlationId: 'method-correlation-456' })

    const entry = outputs[0] as { correlationId?: string }
    expect(entry.correlationId).toBe('method-correlation-456')
  })

  it('logs include log level', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    logger.warn('test')

    const entry = outputs[0] as { level: string }
    expect(entry.level).toBe('warn')
  })

  it('logs include message', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    logger.info('this is the message')

    const entry = outputs[0] as { message: string }
    expect(entry.message).toBe('this is the message')
  })

  it('logs include optional context object', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    logger.info('test', { userId: 123, action: 'login' })

    const entry = outputs[0] as { context?: Record<string, unknown> }
    expect(entry.context).toEqual({ userId: 123, action: 'login' })
  })

  it('context excludes correlationId from context object', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    logger.info('test', { correlationId: 'abc', userId: 123 })

    const entry = outputs[0] as { context?: Record<string, unknown>; correlationId?: string }
    expect(entry.correlationId).toBe('abc')
    expect(entry.context).toEqual({ userId: 123 })
  })
})

// ============================================================================
// Log Level Filtering Tests
// ============================================================================

describe('Log level filtering', () => {
  it('INFO level filters out DEBUG messages', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'info',
      output: (entry) => outputs.push(entry),
    })

    logger.debug('debug message')
    logger.info('info message')

    expect(outputs.length).toBe(1)
    expect((outputs[0] as { message: string }).message).toBe('info message')
  })

  it('WARN level filters out DEBUG and INFO messages', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'warn',
      output: (entry) => outputs.push(entry),
    })

    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')

    expect(outputs.length).toBe(2)
    expect((outputs[0] as { level: string }).level).toBe('warn')
    expect((outputs[1] as { level: string }).level).toBe('error')
  })

  it('ERROR level only shows ERROR messages', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'error',
      output: (entry) => outputs.push(entry),
    })

    logger.debug('debug')
    logger.info('info')
    logger.warn('warn')
    logger.error('error')

    expect(outputs.length).toBe(1)
    expect((outputs[0] as { level: string }).level).toBe('error')
  })

  it('DEBUG level shows all messages', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    logger.debug('debug')
    logger.info('info')
    logger.warn('warn')
    logger.error('error')

    expect(outputs.length).toBe(4)
  })
})

// ============================================================================
// Logger Disable Tests
// ============================================================================

describe('Logger disable', () => {
  it('logger can be disabled via enabled: false', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      enabled: false,
      output: (entry) => outputs.push(entry),
    })

    logger.debug('debug')
    logger.info('info')
    logger.warn('warn')
    logger.error('error')

    expect(outputs.length).toBe(0)
  })

  it('disabled logger still returns from createEntry', async () => {
    const { createLogger } = await import('../logger')
    const logger = createLogger({
      enabled: false,
    })

    const entry = logger.createEntry('info', 'test')
    expect(entry.level).toBe('info')
    expect(entry.message).toBe('test')
  })
})

// ============================================================================
// createLogger Factory Tests
// ============================================================================

describe('createLogger factory function', () => {
  it('creates logger with default options', async () => {
    const { createLogger } = await import('../logger')
    const logger = createLogger()

    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
  })

  it('accepts level option', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'warn',
      output: (entry) => outputs.push(entry),
    })

    logger.info('should not appear')
    expect(outputs.length).toBe(0)

    logger.warn('should appear')
    expect(outputs.length).toBe(1)
  })

  it('accepts correlationId option', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      correlationId: 'factory-correlation',
      output: (entry) => outputs.push(entry),
    })

    logger.info('test')

    const entry = outputs[0] as { correlationId?: string }
    expect(entry.correlationId).toBe('factory-correlation')
  })

  it('accepts enabled option', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      enabled: false,
      output: (entry) => outputs.push(entry),
    })

    logger.info('test')

    expect(outputs.length).toBe(0)
  })

  it('accepts custom output function', async () => {
    const { createLogger } = await import('../logger')
    const customOutput = vi.fn()
    const logger = createLogger({
      output: customOutput,
    })

    logger.info('test')

    expect(customOutput).toHaveBeenCalledOnce()
    expect(customOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        message: 'test',
      })
    )
  })
})

// ============================================================================
// Child Logger Tests
// ============================================================================

describe('Child loggers', () => {
  it('child logger inherits parent correlation ID', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const parent = createLogger({
      correlationId: 'parent-correlation',
      output: (entry) => outputs.push(entry),
    })

    const child = parent.child({})
    child.info('child message')

    const entry = outputs[0] as { correlationId?: string }
    expect(entry.correlationId).toBe('parent-correlation')
  })

  it('child logger inherits parent log level', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const parent = createLogger({
      level: 'warn',
      output: (entry) => outputs.push(entry),
    })

    const child = parent.child({})
    child.info('should not appear')
    child.warn('should appear')

    expect(outputs.length).toBe(1)
    expect((outputs[0] as { level: string }).level).toBe('warn')
  })

  it('child logger inherits parent enabled state', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const parent = createLogger({
      enabled: false,
      output: (entry) => outputs.push(entry),
    })

    const child = parent.child({})
    child.info('test')

    expect(outputs.length).toBe(0)
  })

  it('child logger can add additional context', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const parent = createLogger({
      output: (entry) => outputs.push(entry),
    })

    const child = parent.child({ requestId: 'req-123' })
    child.info('child message', { action: 'test' })

    const entry = outputs[0] as { context?: Record<string, unknown> }
    expect(entry.context).toEqual({ requestId: 'req-123', action: 'test' })
  })

  it('child context overrides parent context for same keys', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const parent = createLogger({
      output: (entry) => outputs.push(entry),
    })

    const child = parent.child({ service: 'child-service', shared: 'child-value' })
    child.info('message')

    const entry = outputs[0] as { context?: Record<string, unknown> }
    expect(entry.context?.['service']).toBe('child-service')
    expect(entry.context?.['shared']).toBe('child-value')
  })

  it('child logger can override correlation ID', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const parent = createLogger({
      correlationId: 'parent-corr',
      output: (entry) => outputs.push(entry),
    })

    const child = parent.child({ correlationId: 'child-corr' })
    child.info('message')

    const entry = outputs[0] as { correlationId?: string }
    expect(entry.correlationId).toBe('child-corr')
  })

  it('nested child loggers accumulate context', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const parent = createLogger({
      output: (entry) => outputs.push(entry),
    })

    const child1 = parent.child({ level1: 'a' })
    const child2 = child1.child({ level2: 'b' })
    child2.info('nested message', { level3: 'c' })

    const entry = outputs[0] as { context?: Record<string, unknown> }
    expect(entry.context).toEqual({ level1: 'a', level2: 'b', level3: 'c' })
  })
})

// ============================================================================
// CLI Verbose Mode Integration Tests
// ============================================================================

describe('CLI verbose mode', () => {
  it('verbose option enables debug logging', async () => {
    const { createLoggerFromCLI } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLoggerFromCLI({
      verbose: true,
      output: (entry) => outputs.push(entry),
    })

    logger.debug('debug message')

    expect(outputs.length).toBe(1)
    expect((outputs[0] as { level: string }).level).toBe('debug')
  })

  it('without verbose, debug messages are filtered', async () => {
    const { createLoggerFromCLI } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLoggerFromCLI({
      verbose: false,
      output: (entry) => outputs.push(entry),
    })

    logger.debug('debug message')
    logger.info('info message')

    expect(outputs.length).toBe(1)
    expect((outputs[0] as { level: string }).level).toBe('info')
  })

  it('quiet option sets level to warn', async () => {
    const { createLoggerFromCLI } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLoggerFromCLI({
      quiet: true,
      output: (entry) => outputs.push(entry),
    })

    logger.info('info message')
    logger.warn('warn message')

    expect(outputs.length).toBe(1)
    expect((outputs[0] as { level: string }).level).toBe('warn')
  })
})

// ============================================================================
// Request/Response Logging Helpers (REFACTOR Phase)
// ============================================================================

describe('Request/response logging helpers', () => {
  it('logRequest helper logs method and URL', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    logger.logRequest('GET', 'https://api.example.com/users')

    expect(outputs.length).toBe(1)
    const entry = outputs[0] as { message: string; context?: Record<string, unknown> }
    expect(entry.message).toContain('GET')
    expect(entry.context?.['url']).toBe('https://api.example.com/users')
    expect(entry.context?.['method']).toBe('GET')
  })

  it('logRequest helper includes optional body', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    logger.logRequest('POST', 'https://api.example.com/users', { name: 'Alice' })

    const entry = outputs[0] as { context?: Record<string, unknown> }
    expect(entry.context?.['body']).toEqual({ name: 'Alice' })
  })

  it('logResponse helper logs status', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    logger.logResponse(200)

    expect(outputs.length).toBe(1)
    const entry = outputs[0] as { context?: Record<string, unknown> }
    expect(entry.context?.['status']).toBe(200)
  })

  it('logResponse helper includes optional body and duration', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    logger.logResponse(200, { data: 'result' }, 150)

    const entry = outputs[0] as { context?: Record<string, unknown> }
    expect(entry.context?.['body']).toEqual({ data: 'result' })
    expect(entry.context?.['durationMs']).toBe(150)
  })
})

// ============================================================================
// Timing Utilities (REFACTOR Phase)
// ============================================================================

describe('Timing utilities', () => {
  it('startTimer returns a function that returns elapsed time', async () => {
    const { createLogger } = await import('../logger')
    const logger = createLogger()

    const timer = logger.startTimer()

    // Small delay to ensure measurable time
    await new Promise((resolve) => setTimeout(resolve, 10))

    const elapsed = timer()
    expect(typeof elapsed).toBe('number')
    expect(elapsed).toBeGreaterThanOrEqual(10)
  })

  it('timing can be logged with logTiming helper', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    logger.logTiming('database query', 42)

    expect(outputs.length).toBe(1)
    const entry = outputs[0] as { message: string; context?: Record<string, unknown> }
    expect(entry.message).toContain('database query')
    expect(entry.context?.['durationMs']).toBe(42)
  })

  it('withTiming wraps async operation and logs duration', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      level: 'debug',
      output: (entry) => outputs.push(entry),
    })

    const result = await logger.withTiming('async operation', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return 'done'
    })

    expect(result).toBe('done')
    expect(outputs.length).toBe(1)
    const entry = outputs[0] as { context?: Record<string, unknown> }
    expect(entry.context?.['durationMs']).toBeGreaterThanOrEqual(10)
  })
})

// ============================================================================
// Environment Variable Support (REFACTOR Phase)
// ============================================================================

describe('Environment variable support', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('DEBUG=rpc.do:* enables debug logging', async () => {
    process.env['DEBUG'] = 'rpc.do:*'
    const { getLogLevelFromEnv } = await import('../logger')

    const level = getLogLevelFromEnv()
    expect(level).toBe('debug')
  })

  it('DEBUG=rpc.do enables debug logging', async () => {
    process.env['DEBUG'] = 'rpc.do'
    const { getLogLevelFromEnv } = await import('../logger')

    const level = getLogLevelFromEnv()
    expect(level).toBe('debug')
  })

  it('DEBUG=* enables debug logging', async () => {
    process.env['DEBUG'] = '*'
    const { getLogLevelFromEnv } = await import('../logger')

    const level = getLogLevelFromEnv()
    expect(level).toBe('debug')
  })

  it('RPC_DO_LOG_LEVEL sets specific level', async () => {
    process.env['RPC_DO_LOG_LEVEL'] = 'warn'
    const { getLogLevelFromEnv } = await import('../logger')

    const level = getLogLevelFromEnv()
    expect(level).toBe('warn')
  })

  it('returns info level when no env vars set', async () => {
    delete process.env['DEBUG']
    delete process.env['RPC_DO_LOG_LEVEL']
    const { getLogLevelFromEnv } = await import('../logger')

    const level = getLogLevelFromEnv()
    expect(level).toBe('info')
  })
})

// ============================================================================
// Integration with Transport Correlation ID
// ============================================================================

describe('Integration with transport correlation ID', () => {
  it('logger can receive correlation ID from transport response', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      output: (entry) => outputs.push(entry),
    })

    // Simulate receiving correlation ID from transport
    const transportCorrelationId = 'transport-abc-123'
    logger.info('Request complete', { correlationId: transportCorrelationId })

    const entry = outputs[0] as { correlationId?: string }
    expect(entry.correlationId).toBe('transport-abc-123')
  })

  it('child logger can be created with transport correlation ID', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const baseLogger = createLogger({
      output: (entry) => outputs.push(entry),
    })

    // Create child with transport's correlation ID
    const requestLogger = baseLogger.child({ correlationId: 'request-xyz' })
    requestLogger.info('Processing')
    requestLogger.info('Complete')

    expect((outputs[0] as { correlationId?: string }).correlationId).toBe('request-xyz')
    expect((outputs[1] as { correlationId?: string }).correlationId).toBe('request-xyz')
  })
})

// ============================================================================
// createEntry Method Tests
// ============================================================================

describe('createEntry method', () => {
  it('creates log entry without outputting', async () => {
    const { createLogger } = await import('../logger')
    const outputs: unknown[] = []
    const logger = createLogger({
      output: (entry) => outputs.push(entry),
    })

    const entry = logger.createEntry('info', 'test message')

    // Should not have output anything
    expect(outputs.length).toBe(0)

    // Entry should be properly formed
    expect(entry.level).toBe('info')
    expect(entry.message).toBe('test message')
    expect(entry.timestamp).toBeDefined()
  })

  it('createEntry includes context', async () => {
    const { createLogger } = await import('../logger')
    const logger = createLogger({
      correlationId: 'test-corr',
    })

    const entry = logger.createEntry('warn', 'warning', { key: 'value' })

    expect(entry.correlationId).toBe('test-corr')
    expect(entry.context).toEqual({ key: 'value' })
  })
})

// ============================================================================
// Default Output Behavior Tests
// ============================================================================

describe('Default output behavior', () => {
  it('uses console.log by default for info', async () => {
    const { createLogger } = await import('../logger')
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const logger = createLogger()
    logger.info('test message')

    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('uses console.error by default for error', async () => {
    const { createLogger } = await import('../logger')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const logger = createLogger()
    logger.error('error message')

    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('uses console.warn by default for warn', async () => {
    const { createLogger } = await import('../logger')
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const logger = createLogger()
    logger.warn('warn message')

    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('uses console.debug by default for debug', async () => {
    const { createLogger } = await import('../logger')
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    const logger = createLogger({ level: 'debug' })
    logger.debug('debug message')

    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
