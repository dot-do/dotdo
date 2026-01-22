/**
 * Tests for structured logger
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  LogLevel,
  parseLogLevel,
  createStructuredLogger,
  configureLogger,
  getLoggerConfig,
  type StructuredLogger,
} from '../logger'

describe('LogLevel', () => {
  describe('parseLogLevel', () => {
    it('should parse DEBUG level', () => {
      expect(parseLogLevel('DEBUG')).toBe(LogLevel.DEBUG)
      expect(parseLogLevel('debug')).toBe(LogLevel.DEBUG)
      expect(parseLogLevel('TRACE')).toBe(LogLevel.DEBUG)
    })

    it('should parse INFO level', () => {
      expect(parseLogLevel('INFO')).toBe(LogLevel.INFO)
      expect(parseLogLevel('info')).toBe(LogLevel.INFO)
    })

    it('should parse WARN level', () => {
      expect(parseLogLevel('WARN')).toBe(LogLevel.WARN)
      expect(parseLogLevel('WARNING')).toBe(LogLevel.WARN)
    })

    it('should parse ERROR level', () => {
      expect(parseLogLevel('ERROR')).toBe(LogLevel.ERROR)
    })

    it('should parse FATAL level', () => {
      expect(parseLogLevel('FATAL')).toBe(LogLevel.FATAL)
      expect(parseLogLevel('CRITICAL')).toBe(LogLevel.FATAL)
    })

    it('should parse SILENT level', () => {
      expect(parseLogLevel('SILENT')).toBe(LogLevel.SILENT)
      expect(parseLogLevel('NONE')).toBe(LogLevel.SILENT)
      expect(parseLogLevel('OFF')).toBe(LogLevel.SILENT)
    })

    it('should default to INFO for unknown levels', () => {
      expect(parseLogLevel('unknown')).toBe(LogLevel.INFO)
      expect(parseLogLevel(undefined)).toBe(LogLevel.INFO)
    })
  })
})

describe('createStructuredLogger', () => {
  let logger: StructuredLogger
  let output: string[]

  beforeEach(() => {
    output = []
    logger = createStructuredLogger({
      level: LogLevel.DEBUG,
      format: 'json',
      service: 'test-service',
      output: (_level, message) => {
        output.push(message)
      },
    })
  })

  it('should create a logger with all methods', () => {
    expect(logger.debug).toBeDefined()
    expect(logger.info).toBeDefined()
    expect(logger.warn).toBeDefined()
    expect(logger.error).toBeDefined()
    expect(logger.fatal).toBeDefined()
    expect(logger.child).toBeDefined()
    expect(logger.setLevel).toBeDefined()
    expect(logger.getLevel).toBeDefined()
  })

  it('should log at DEBUG level', () => {
    logger.debug('test message', { key: 'value' })
    expect(output).toHaveLength(1)
    const entry = JSON.parse(output[0]!)
    expect(entry.level).toBe('debug')
    expect(entry.message).toBe('test message')
    expect(entry.key).toBe('value')
    expect(entry.service).toBe('test-service')
  })

  it('should log at INFO level', () => {
    logger.info('info message')
    expect(output).toHaveLength(1)
    const entry = JSON.parse(output[0]!)
    expect(entry.level).toBe('info')
    expect(entry.message).toBe('info message')
  })

  it('should log at WARN level', () => {
    logger.warn('warning message')
    expect(output).toHaveLength(1)
    const entry = JSON.parse(output[0]!)
    expect(entry.level).toBe('warn')
  })

  it('should log at ERROR level with error object', () => {
    const error = new Error('test error')
    logger.error('error occurred', error)
    expect(output).toHaveLength(1)
    const entry = JSON.parse(output[0]!)
    expect(entry.level).toBe('error')
    expect(entry.error.name).toBe('Error')
    expect(entry.error.message).toBe('test error')
    expect(entry.error.stack).toBeDefined()
  })

  it('should log at FATAL level', () => {
    logger.fatal('fatal error')
    expect(output).toHaveLength(1)
    const entry = JSON.parse(output[0]!)
    expect(entry.level).toBe('fatal')
  })

  it('should respect log level filtering', () => {
    logger.setLevel(LogLevel.WARN)
    logger.debug('debug')
    logger.info('info')
    logger.warn('warn')
    logger.error('error')
    expect(output).toHaveLength(2)
  })

  it('should include timestamp in ISO format', () => {
    logger.info('test')
    const entry = JSON.parse(output[0]!)
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  describe('child logger', () => {
    it('should create child logger with inherited context', () => {
      const child = logger.child({ correlationId: 'test-cid' })
      child.info('child message')
      const entry = JSON.parse(output[0]!)
      expect(entry.correlationId).toBe('test-cid')
    })

    it('should include trace context in child logger', () => {
      const child = logger.child({
        correlationId: 'cid-123',
        traceId: 'trace-abc',
        spanId: 'span-xyz',
      })
      child.info('traced message')
      const entry = JSON.parse(output[0]!)
      expect(entry.correlationId).toBe('cid-123')
      expect(entry.traceId).toBe('trace-abc')
      expect(entry.spanId).toBe('span-xyz')
    })

    it('should allow nested child loggers', () => {
      const child1 = logger.child({ component: 'auth' })
      const child2 = child1.child({ action: 'login' })
      child2.info('login attempt')
      const entry = JSON.parse(output[0]!)
      expect(entry.component).toBe('auth')
      expect(entry.action).toBe('login')
    })
  })

  describe('withContext', () => {
    it('should bind context to subsequent logs', () => {
      logger.withContext({ userId: 'user-123' })
      logger.info('first message')
      logger.info('second message')
      expect(output).toHaveLength(2)
      expect(JSON.parse(output[0]!).userId).toBe('user-123')
      expect(JSON.parse(output[1]!).userId).toBe('user-123')
    })
  })

  describe('sensitive data redaction', () => {
    it('should redact password fields', () => {
      logger.info('user data', { username: 'alice', password: 'secret123' })
      const entry = JSON.parse(output[0]!)
      expect(entry.username).toBe('alice')
      expect(entry.password).toBe('[REDACTED]')
    })

    it('should redact API keys', () => {
      logger.info('config', { apiKey: 'sk-1234567890abcdefghij' })
      const entry = JSON.parse(output[0]!)
      expect(entry.apiKey).toBe('[REDACTED]')
    })

    it('should redact JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
      logger.info('auth', { token: jwt })
      const entry = JSON.parse(output[0]!)
      expect(entry.token).toBe('[REDACTED]')
    })

    it('should redact authorization headers', () => {
      logger.info('request', { authorization: 'Bearer abc123' })
      const entry = JSON.parse(output[0]!)
      expect(entry.authorization).toBe('[REDACTED]')
    })
  })

  describe('pretty format', () => {
    it('should format output for humans', () => {
      const prettyLogger = createStructuredLogger({
        level: LogLevel.DEBUG,
        format: 'pretty',
        service: 'pretty-service',
        output: (_level, message) => {
          output.push(message)
        },
      })

      prettyLogger.info('human readable')
      expect(output[0]).toContain('[INFO]')
      expect(output[0]).toContain('[pretty-service]')
      expect(output[0]).toContain('human readable')
    })
  })
})

describe('configureLogger', () => {
  it('should update global config', () => {
    configureLogger({ level: LogLevel.ERROR, service: 'global-test' })
    const config = getLoggerConfig()
    expect(config.level).toBe(LogLevel.ERROR)
    expect(config.service).toBe('global-test')

    // Reset
    configureLogger({ level: LogLevel.INFO, service: 'dotdo' })
  })
})
