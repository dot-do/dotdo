/**
 * LogAggregator Tests
 *
 * TDD Red-Green-Refactor implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  LogAggregator,
  ConsoleTransport,
  BufferTransport,
  HTTPTransport,
  LogFormatter,
  ContextManager,
  Redactor,
  SamplingFilter,
} from './index.js'
import type { LogEntry, LogLevel, LogTransport, LogContext } from './types.js'

// =============================================================================
// Log Level Methods
// =============================================================================

describe('LogAggregator - Log Level Methods', () => {
  let logger: LogAggregator
  let buffer: BufferTransport

  beforeEach(() => {
    buffer = new BufferTransport()
    logger = new LogAggregator({
      level: 'trace',
      transports: [buffer],
      format: 'json',
    })
  })

  it('should log trace messages', () => {
    logger.trace('trace message')
    const entries = buffer.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('trace')
    expect(entries[0].message).toBe('trace message')
  })

  it('should log debug messages', () => {
    logger.debug('debug message')
    const entries = buffer.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('debug')
    expect(entries[0].message).toBe('debug message')
  })

  it('should log info messages', () => {
    logger.info('info message')
    const entries = buffer.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('info')
    expect(entries[0].message).toBe('info message')
  })

  it('should log warn messages', () => {
    logger.warn('warn message')
    const entries = buffer.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('warn')
    expect(entries[0].message).toBe('warn message')
  })

  it('should log error messages', () => {
    logger.error('error message')
    const entries = buffer.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('error')
    expect(entries[0].message).toBe('error message')
  })

  it('should log fatal messages', () => {
    logger.fatal('fatal message')
    const entries = buffer.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('fatal')
    expect(entries[0].message).toBe('fatal message')
  })

  it('should include timestamp in log entries', () => {
    const before = new Date()
    logger.info('test')
    const after = new Date()
    const entries = buffer.getEntries()
    expect(entries[0].timestamp).toBeInstanceOf(Date)
    expect(entries[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(entries[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})

// =============================================================================
// Level Filtering
// =============================================================================

describe('LogAggregator - Level Filtering', () => {
  let buffer: BufferTransport

  beforeEach(() => {
    buffer = new BufferTransport()
  })

  it('should filter logs below minimum level', () => {
    const logger = new LogAggregator({
      level: 'warn',
      transports: [buffer],
      format: 'json',
    })

    logger.trace('trace')
    logger.debug('debug')
    logger.info('info')
    logger.warn('warn')
    logger.error('error')
    logger.fatal('fatal')

    const entries = buffer.getEntries()
    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.level)).toEqual(['warn', 'error', 'fatal'])
  })

  it('should allow changing log level at runtime', () => {
    const logger = new LogAggregator({
      level: 'error',
      transports: [buffer],
      format: 'json',
    })

    logger.info('should not appear')
    expect(buffer.getEntries()).toHaveLength(0)

    logger.setLevel('info')
    logger.info('should appear')
    expect(buffer.getEntries()).toHaveLength(1)
  })

  it('should support per-transport level filtering', () => {
    const errorBuffer = new BufferTransport({ level: 'error' })
    const infoBuffer = new BufferTransport({ level: 'info' })

    const logger = new LogAggregator({
      level: 'trace',
      transports: [errorBuffer, infoBuffer],
      format: 'json',
    })

    logger.debug('debug')
    logger.info('info')
    logger.error('error')

    expect(errorBuffer.getEntries()).toHaveLength(1)
    expect(errorBuffer.getEntries()[0].level).toBe('error')
    expect(infoBuffer.getEntries()).toHaveLength(2)
  })
})

// =============================================================================
// Structured Metadata
// =============================================================================

describe('LogAggregator - Structured Metadata', () => {
  let logger: LogAggregator
  let buffer: BufferTransport

  beforeEach(() => {
    buffer = new BufferTransport()
    logger = new LogAggregator({
      level: 'trace',
      transports: [buffer],
      format: 'json',
    })
  })

  it('should include metadata in log entries', () => {
    logger.info('user login', { userId: '123', action: 'login' })
    const entries = buffer.getEntries()
    expect(entries[0].metadata).toEqual({ userId: '123', action: 'login' })
  })

  it('should handle nested metadata objects', () => {
    logger.info('request', {
      user: { id: '123', name: 'John' },
      request: { method: 'GET', path: '/api' },
    })
    const entries = buffer.getEntries()
    expect(entries[0].metadata).toEqual({
      user: { id: '123', name: 'John' },
      request: { method: 'GET', path: '/api' },
    })
  })

  it('should handle Error objects in metadata', () => {
    const error = new Error('Something went wrong')
    logger.error('operation failed', { error })
    const entries = buffer.getEntries()
    expect(entries[0].error).toBe(error)
  })

  it('should handle Error as second argument', () => {
    const error = new Error('Something went wrong')
    logger.error('operation failed', error)
    const entries = buffer.getEntries()
    expect(entries[0].error).toBe(error)
    expect(entries[0].message).toBe('operation failed')
  })
})

// =============================================================================
// Context Propagation
// =============================================================================

describe('LogAggregator - Context Propagation', () => {
  let logger: LogAggregator
  let buffer: BufferTransport

  beforeEach(() => {
    buffer = new BufferTransport()
    logger = new LogAggregator({
      level: 'trace',
      transports: [buffer],
      format: 'json',
      defaultContext: {
        service: 'test-service',
        environment: 'test',
      },
    })
  })

  it('should include default context in all logs', () => {
    logger.info('test message')
    const entries = buffer.getEntries()
    expect(entries[0].context).toMatchObject({
      service: 'test-service',
      environment: 'test',
    })
  })

  it('should allow adding context at log time', () => {
    logger.info('request', { requestId: 'req-123' })
    const entries = buffer.getEntries()
    expect(entries[0].context).toMatchObject({
      service: 'test-service',
      environment: 'test',
    })
  })

  it('should support request-scoped context', () => {
    const context: LogContext = { requestId: 'req-123', userId: 'user-456' }
    logger.withContext(context, () => {
      logger.info('inside context')
      const entries = buffer.getEntries()
      expect(entries[0].context).toMatchObject({
        service: 'test-service',
        requestId: 'req-123',
        userId: 'user-456',
      })
    })
  })
})

// =============================================================================
// Child Loggers
// =============================================================================

describe('LogAggregator - Child Loggers', () => {
  let logger: LogAggregator
  let buffer: BufferTransport

  beforeEach(() => {
    buffer = new BufferTransport()
    logger = new LogAggregator({
      level: 'trace',
      transports: [buffer],
      format: 'json',
      name: 'parent',
    })
  })

  it('should create child logger with inherited config', () => {
    const child = logger.child({ component: 'database' })
    child.info('connected')

    const entries = buffer.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].context).toMatchObject({ component: 'database' })
  })

  it('should create child logger with name', () => {
    const child = logger.child({ component: 'auth' }, 'auth-module')
    child.info('initialized')

    const entries = buffer.getEntries()
    expect(entries[0].logger).toBe('parent:auth-module')
  })

  it('should merge parent and child context', () => {
    const parent = new LogAggregator({
      level: 'trace',
      transports: [buffer],
      format: 'json',
      defaultContext: { service: 'api' },
    })

    const child = parent.child({ component: 'users' })
    child.info('test')

    const entries = buffer.getEntries()
    expect(entries[0].context).toMatchObject({
      service: 'api',
      component: 'users',
    })
  })

  it('should support nested child loggers', () => {
    const child1 = logger.child({ module: 'http' }, 'http')
    const child2 = child1.child({ handler: 'users' }, 'users')
    child2.info('handling request')

    const entries = buffer.getEntries()
    expect(entries[0].logger).toBe('parent:http:users')
    expect(entries[0].context).toMatchObject({
      module: 'http',
      handler: 'users',
    })
  })
})

// =============================================================================
// JSON Formatting
// =============================================================================

describe('LogFormatter - JSON Format', () => {
  it('should format entry as JSON', () => {
    const formatter = new LogFormatter({ format: 'json' })
    const entry: LogEntry = {
      level: 'info',
      message: 'test message',
      timestamp: new Date('2024-01-01T00:00:00Z'),
    }

    const output = formatter.format(entry)
    const parsed = JSON.parse(output)

    expect(parsed.level).toBe('info')
    expect(parsed.message).toBe('test message')
    expect(parsed.timestamp).toBe('2024-01-01T00:00:00.000Z')
  })

  it('should include metadata in JSON output', () => {
    const formatter = new LogFormatter({ format: 'json' })
    const entry: LogEntry = {
      level: 'info',
      message: 'user action',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      metadata: { userId: '123', action: 'click' },
    }

    const output = formatter.format(entry)
    const parsed = JSON.parse(output)

    expect(parsed.userId).toBe('123')
    expect(parsed.action).toBe('click')
  })

  it('should include context in JSON output', () => {
    const formatter = new LogFormatter({ format: 'json' })
    const entry: LogEntry = {
      level: 'info',
      message: 'request',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      context: { requestId: 'req-123', traceId: 'trace-456' },
    }

    const output = formatter.format(entry)
    const parsed = JSON.parse(output)

    expect(parsed.requestId).toBe('req-123')
    expect(parsed.traceId).toBe('trace-456')
  })

  it('should serialize errors in JSON output', () => {
    const formatter = new LogFormatter({ format: 'json' })
    const error = new Error('test error')
    const entry: LogEntry = {
      level: 'error',
      message: 'failed',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      error,
    }

    const output = formatter.format(entry)
    const parsed = JSON.parse(output)

    expect(parsed.error).toBeDefined()
    expect(parsed.error.message).toBe('test error')
    expect(parsed.error.stack).toBeDefined()
  })
})

// =============================================================================
// Text Formatting
// =============================================================================

describe('LogFormatter - Text Format', () => {
  it('should format entry as text', () => {
    const formatter = new LogFormatter({ format: 'text' })
    const entry: LogEntry = {
      level: 'info',
      message: 'test message',
      timestamp: new Date('2024-01-01T00:00:00Z'),
    }

    const output = formatter.format(entry)
    expect(output).toContain('INFO')
    expect(output).toContain('test message')
    expect(output).toContain('2024-01-01')
  })

  it('should include metadata in text output', () => {
    const formatter = new LogFormatter({ format: 'text' })
    const entry: LogEntry = {
      level: 'info',
      message: 'user action',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      metadata: { userId: '123' },
    }

    const output = formatter.format(entry)
    expect(output).toContain('userId')
    expect(output).toContain('123')
  })
})

// =============================================================================
// Pretty Formatting
// =============================================================================

describe('LogFormatter - Pretty Format', () => {
  it('should format entry with colors (pretty)', () => {
    const formatter = new LogFormatter({ format: 'pretty', colorize: true })
    const entry: LogEntry = {
      level: 'error',
      message: 'something went wrong',
      timestamp: new Date('2024-01-01T00:00:00Z'),
    }

    const output = formatter.format(entry)
    // Should contain ANSI color codes for error level
    expect(output).toContain('ERROR')
    expect(output).toContain('something went wrong')
  })

  it('should format without colors when disabled', () => {
    const formatter = new LogFormatter({ format: 'pretty', colorize: false })
    const entry: LogEntry = {
      level: 'info',
      message: 'test',
      timestamp: new Date('2024-01-01T00:00:00Z'),
    }

    const output = formatter.format(entry)
    // Should not contain ANSI escape codes
    expect(output).not.toMatch(/\x1b\[/)
  })
})

// =============================================================================
// Console Transport
// =============================================================================

describe('ConsoleTransport', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('should write to console.log by default', () => {
    const transport = new ConsoleTransport()
    const entry: LogEntry = {
      level: 'info',
      message: 'test',
      timestamp: new Date(),
    }

    transport.write(entry, 'formatted output')
    expect(consoleSpy).toHaveBeenCalledWith('formatted output')
  })

  it('should write errors to console.error', () => {
    const transport = new ConsoleTransport({ stderrLevels: ['error', 'fatal'] })
    const entry: LogEntry = {
      level: 'error',
      message: 'test error',
      timestamp: new Date(),
    }

    transport.write(entry, 'error output')
    expect(consoleErrorSpy).toHaveBeenCalledWith('error output')
  })
})

// =============================================================================
// Buffer Transport
// =============================================================================

describe('BufferTransport', () => {
  it('should buffer log entries', () => {
    const transport = new BufferTransport()
    const entry: LogEntry = {
      level: 'info',
      message: 'test',
      timestamp: new Date(),
    }

    transport.write(entry, 'formatted')
    expect(transport.getEntries()).toHaveLength(1)
    expect(transport.getEntries()[0]).toEqual(entry)
  })

  it('should respect max buffer size', () => {
    const transport = new BufferTransport({ maxSize: 3 })

    for (let i = 0; i < 5; i++) {
      transport.write(
        {
          level: 'info',
          message: `msg ${i}`,
          timestamp: new Date(),
        },
        ''
      )
    }

    const entries = transport.getEntries()
    expect(entries).toHaveLength(3)
    expect(entries[0].message).toBe('msg 2') // Oldest removed
  })

  it('should clear buffer on flush', () => {
    const transport = new BufferTransport()
    transport.write(
      {
        level: 'info',
        message: 'test',
        timestamp: new Date(),
      },
      ''
    )

    expect(transport.getEntries()).toHaveLength(1)
    transport.flush()
    expect(transport.getEntries()).toHaveLength(0)
  })

  it('should return formatted strings', () => {
    const transport = new BufferTransport()
    transport.write(
      {
        level: 'info',
        message: 'test',
        timestamp: new Date(),
      },
      'formatted string'
    )

    expect(transport.getFormatted()).toEqual(['formatted string'])
  })
})

// =============================================================================
// HTTP Transport
// =============================================================================

describe('HTTPTransport', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('should send logs to HTTP endpoint', async () => {
    const transport = new HTTPTransport({
      url: 'https://logs.example.com/ingest',
    })

    const entry: LogEntry = {
      level: 'info',
      message: 'test',
      timestamp: new Date(),
    }

    await transport.write(entry, JSON.stringify(entry))
    await transport.flush()

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://logs.example.com/ingest',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      })
    )
  })

  it('should batch logs before sending', async () => {
    const transport = new HTTPTransport({
      url: 'https://logs.example.com/ingest',
      batchSize: 3,
    })

    for (let i = 0; i < 3; i++) {
      await transport.write(
        {
          level: 'info',
          message: `msg ${i}`,
          timestamp: new Date(),
        },
        `msg ${i}`
      )
    }

    // Should have sent after reaching batch size
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('should include custom headers', async () => {
    const transport = new HTTPTransport({
      url: 'https://logs.example.com/ingest',
      headers: {
        Authorization: 'Bearer token123',
        'X-Custom-Header': 'value',
      },
    })

    await transport.write(
      {
        level: 'info',
        message: 'test',
        timestamp: new Date(),
      },
      ''
    )
    await transport.flush()

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token123',
          'X-Custom-Header': 'value',
        }),
      })
    )
  })
})

// =============================================================================
// Multiple Transports
// =============================================================================

describe('LogAggregator - Multiple Transports', () => {
  it('should write to all transports', () => {
    const buffer1 = new BufferTransport()
    const buffer2 = new BufferTransport()

    const logger = new LogAggregator({
      level: 'info',
      transports: [buffer1, buffer2],
      format: 'json',
    })

    logger.info('test message')

    expect(buffer1.getEntries()).toHaveLength(1)
    expect(buffer2.getEntries()).toHaveLength(1)
  })

  it('should add transport at runtime', () => {
    const buffer1 = new BufferTransport()
    const buffer2 = new BufferTransport()

    const logger = new LogAggregator({
      level: 'info',
      transports: [buffer1],
      format: 'json',
    })

    logger.info('first message')
    logger.addTransport(buffer2)
    logger.info('second message')

    expect(buffer1.getEntries()).toHaveLength(2)
    expect(buffer2.getEntries()).toHaveLength(1)
  })

  it('should remove transport at runtime', () => {
    const buffer1 = new BufferTransport()
    const buffer2 = new BufferTransport()

    const logger = new LogAggregator({
      level: 'info',
      transports: [buffer1, buffer2],
      format: 'json',
    })

    logger.info('first message')
    logger.removeTransport(buffer1)
    logger.info('second message')

    expect(buffer1.getEntries()).toHaveLength(1)
    expect(buffer2.getEntries()).toHaveLength(2)
  })
})

// =============================================================================
// Log Buffering and Query
// =============================================================================

describe('LogAggregator - Log Buffering and Query', () => {
  let logger: LogAggregator
  let buffer: BufferTransport

  beforeEach(() => {
    buffer = new BufferTransport({ maxSize: 100 })
    logger = new LogAggregator({
      level: 'trace',
      transports: [buffer],
      format: 'json',
    })
  })

  it('should query logs by level', () => {
    logger.debug('debug msg')
    logger.info('info msg')
    logger.error('error msg')

    const result = logger.query({ level: 'error' })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].message).toBe('error msg')
  })

  it('should query logs by multiple levels', () => {
    logger.debug('debug msg')
    logger.info('info msg')
    logger.error('error msg')

    const result = logger.query({ level: ['info', 'error'] })
    expect(result.entries).toHaveLength(2)
  })

  it('should query logs by pattern', () => {
    logger.info('user login successful')
    logger.info('user logout')
    logger.info('system startup')

    const result = logger.query({ pattern: /user/ })
    expect(result.entries).toHaveLength(2)
  })

  it('should query logs by time range', () => {
    const now = Date.now()
    const entry1 = { level: 'info' as LogLevel, message: 'old', timestamp: new Date(now - 10000) }
    const entry2 = { level: 'info' as LogLevel, message: 'new', timestamp: new Date(now) }

    buffer.write(entry1, '')
    buffer.write(entry2, '')

    const result = logger.query({
      timeRange: {
        from: new Date(now - 5000),
        to: new Date(now + 1000),
      },
    })

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].message).toBe('new')
  })

  it('should query logs by field value', () => {
    logger.info('action', { userId: '123' })
    logger.info('action', { userId: '456' })

    const result = logger.query({
      field: { path: 'metadata.userId', value: '123', operator: 'eq' },
    })

    expect(result.entries).toHaveLength(1)
  })

  it('should combine filters with AND', () => {
    logger.info('user login', { userId: '123' })
    logger.error('user login failed', { userId: '123' })
    logger.info('system event')

    const result = logger.query({
      combine: 'and',
      filters: [{ level: 'info' }, { pattern: /user/ }],
    })

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].message).toBe('user login')
  })
})

// =============================================================================
// Sensitive Data Redaction
// =============================================================================

describe('Redactor', () => {
  it('should redact specified fields', () => {
    const redactor = new Redactor({
      paths: ['password', 'secret'],
    })

    const data = {
      username: 'john',
      password: 'secret123',
      secret: 'api-key',
    }

    const redacted = redactor.redact(data)
    expect(redacted.username).toBe('john')
    expect(redacted.password).toBe('[REDACTED]')
    expect(redacted.secret).toBe('[REDACTED]')
  })

  it('should redact nested fields', () => {
    const redactor = new Redactor({
      paths: ['user.password', 'config.apiKey'],
    })

    const data = {
      user: { name: 'john', password: 'secret' },
      config: { apiKey: 'key123', timeout: 30 },
    }

    const redacted = redactor.redact(data)
    expect(redacted.user.name).toBe('john')
    expect(redacted.user.password).toBe('[REDACTED]')
    expect(redacted.config.apiKey).toBe('[REDACTED]')
    expect(redacted.config.timeout).toBe(30)
  })

  it('should support wildcard paths', () => {
    const redactor = new Redactor({
      paths: ['*.password', '**.secret'],
    })

    const data = {
      user: { password: 'pass1' },
      admin: { password: 'pass2' },
      nested: { deep: { secret: 'deep-secret' } },
    }

    const redacted = redactor.redact(data)
    expect(redacted.user.password).toBe('[REDACTED]')
    expect(redacted.admin.password).toBe('[REDACTED]')
    expect(redacted.nested.deep.secret).toBe('[REDACTED]')
  })

  it('should use custom replacement', () => {
    const redactor = new Redactor({
      paths: ['password'],
      replacement: '***',
    })

    const redacted = redactor.redact({ password: 'secret' })
    expect(redacted.password).toBe('***')
  })

  it('should use custom redaction function', () => {
    const redactor = new Redactor({
      paths: ['email'],
      redactor: (value) => {
        if (typeof value === 'string') {
          return value.replace(/(.{2}).*(@.*)/, '$1***$2')
        }
        return '[REDACTED]'
      },
    })

    const redacted = redactor.redact({ email: 'john@example.com' })
    expect(redacted.email).toBe('jo***@example.com')
  })
})

describe('LogAggregator - Redaction Integration', () => {
  it('should redact sensitive data in logs', () => {
    const buffer = new BufferTransport()
    const logger = new LogAggregator({
      level: 'info',
      transports: [buffer],
      format: 'json',
      redact: {
        paths: ['password', 'token', '**.secret'],
      },
    })

    logger.info('user auth', {
      username: 'john',
      password: 'secret123',
      token: 'jwt-token',
      config: { secret: 'api-key' },
    })

    const entries = buffer.getEntries()
    expect(entries[0].metadata?.username).toBe('john')
    expect(entries[0].metadata?.password).toBe('[REDACTED]')
    expect(entries[0].metadata?.token).toBe('[REDACTED]')
    expect((entries[0].metadata?.config as any)?.secret).toBe('[REDACTED]')
  })
})

// =============================================================================
// Sampling
// =============================================================================

describe('SamplingFilter', () => {
  it('should sample logs at specified rate', () => {
    const filter = new SamplingFilter({ rate: 0.5 })

    // Run many times and check approximate rate
    let sampled = 0
    const iterations = 1000

    for (let i = 0; i < iterations; i++) {
      if (filter.shouldSample({ level: 'info', message: 'test', timestamp: new Date() })) {
        sampled++
      }
    }

    // Allow 10% variance
    expect(sampled).toBeGreaterThan(iterations * 0.4)
    expect(sampled).toBeLessThan(iterations * 0.6)
  })

  it('should always sample specified levels', () => {
    const filter = new SamplingFilter({
      rate: 0,
      alwaysSample: ['error', 'fatal'],
    })

    expect(filter.shouldSample({ level: 'info', message: 'test', timestamp: new Date() })).toBe(false)
    expect(filter.shouldSample({ level: 'error', message: 'test', timestamp: new Date() })).toBe(true)
    expect(filter.shouldSample({ level: 'fatal', message: 'test', timestamp: new Date() })).toBe(true)
  })

  it('should sample consistently by key', () => {
    const filter = new SamplingFilter({
      rate: 0.5,
      sampleBy: 'requestId',
    })

    // Same requestId should always get same result
    const entry1 = {
      level: 'info' as LogLevel,
      message: 'test',
      timestamp: new Date(),
      context: { requestId: 'req-123' },
    }

    const results = new Set<boolean>()
    for (let i = 0; i < 10; i++) {
      results.add(filter.shouldSample(entry1))
    }

    expect(results.size).toBe(1) // Should be consistent
  })
})

describe('LogAggregator - Sampling Integration', () => {
  it('should apply sampling to logs', () => {
    const buffer = new BufferTransport()
    const logger = new LogAggregator({
      level: 'info',
      transports: [buffer],
      format: 'json',
      sampling: {
        rate: 0,
        alwaysSample: ['error'],
      },
    })

    for (let i = 0; i < 100; i++) {
      logger.info('info message')
    }
    logger.error('error message')

    const entries = buffer.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('error')
  })
})

// =============================================================================
// Flush
// =============================================================================

describe('LogAggregator - Flush', () => {
  it('should flush all transports', async () => {
    const buffer = new BufferTransport()
    const flushSpy = vi.spyOn(buffer, 'flush')

    const logger = new LogAggregator({
      level: 'info',
      transports: [buffer],
      format: 'json',
    })

    await logger.flush()
    expect(flushSpy).toHaveBeenCalled()
  })
})

// =============================================================================
// ContextManager
// =============================================================================

describe('ContextManager', () => {
  it('should store and retrieve context', () => {
    const manager = new ContextManager()

    manager.set({ requestId: 'req-123' })
    expect(manager.get()).toEqual({ requestId: 'req-123' })
  })

  it('should run callback with context', () => {
    const manager = new ContextManager()

    let capturedContext: LogContext | undefined
    manager.run({ requestId: 'req-456' }, () => {
      capturedContext = manager.get()
    })

    expect(capturedContext).toEqual({ requestId: 'req-456' })
  })

  it('should restore context after callback', () => {
    const manager = new ContextManager()

    manager.set({ requestId: 'original' })
    manager.run({ requestId: 'temporary' }, () => {
      // Inside callback
    })

    expect(manager.get()).toEqual({ requestId: 'original' })
  })

  it('should merge contexts', () => {
    const manager = new ContextManager()

    manager.set({ requestId: 'req-123', service: 'api' })
    const merged = manager.merge({ userId: 'user-456' })

    expect(merged).toEqual({
      requestId: 'req-123',
      service: 'api',
      userId: 'user-456',
    })
  })
})

// =============================================================================
// Disabled Logger
// =============================================================================

describe('LogAggregator - Disabled', () => {
  it('should not log when disabled', () => {
    const buffer = new BufferTransport()
    const logger = new LogAggregator({
      level: 'info',
      transports: [buffer],
      format: 'json',
      enabled: false,
    })

    logger.info('should not appear')
    expect(buffer.getEntries()).toHaveLength(0)
  })

  it('should enable/disable at runtime', () => {
    const buffer = new BufferTransport()
    const logger = new LogAggregator({
      level: 'info',
      transports: [buffer],
      format: 'json',
      enabled: false,
    })

    logger.info('should not appear')
    logger.enable()
    logger.info('should appear')

    expect(buffer.getEntries()).toHaveLength(1)
  })
})
