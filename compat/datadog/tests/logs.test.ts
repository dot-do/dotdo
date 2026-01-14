/**
 * @dotdo/datadog - Logs Module Tests
 *
 * Comprehensive tests for Datadog-compatible structured logging.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  Logger,
  createLogger,
  getDefaultLogger,
  setDefaultLogger,
  clearDefaultLogger,
  debug,
  info,
  warn,
  error,
  critical,
  type LogHandler,
} from '../logs'

describe('@dotdo/datadog - Logs Module', () => {
  let logger: Logger

  beforeEach(() => {
    logger = new Logger({
      service: 'test-service',
      env: 'test',
      hostname: 'test-host',
      level: 'debug',
      batching: false,
    })
    clearDefaultLogger()
  })

  afterEach(() => {
    logger.disable()
    clearDefaultLogger()
  })

  // ===========================================================================
  // Log Levels
  // ===========================================================================

  describe('Log Levels', () => {
    it('should log at debug level', () => {
      logger.debug('Debug message')

      const buffer = logger.getBuffer()
      expect(buffer.length).toBe(1)
      expect(buffer[0].message).toBe('Debug message')
      expect(buffer[0].status).toBe('debug')
    })

    it('should log at info level', () => {
      logger.info('Info message')

      const buffer = logger.getBuffer()
      expect(buffer[0].status).toBe('info')
    })

    it('should log at warn level', () => {
      logger.warn('Warning message')

      const buffer = logger.getBuffer()
      expect(buffer[0].status).toBe('warning')
    })

    it('should log at error level', () => {
      logger.error('Error message')

      const buffer = logger.getBuffer()
      expect(buffer[0].status).toBe('error')
    })

    it('should log at critical level', () => {
      logger.critical('Critical message')

      const buffer = logger.getBuffer()
      expect(buffer[0].status).toBe('critical')
    })

    it('should use generic log method', () => {
      logger.log('info', 'Generic log')

      const buffer = logger.getBuffer()
      expect(buffer[0].message).toBe('Generic log')
      expect(buffer[0].status).toBe('info')
    })
  })

  // ===========================================================================
  // Log Level Filtering
  // ===========================================================================

  describe('Level Filtering', () => {
    it('should filter logs below configured level', () => {
      const warnLogger = new Logger({ level: 'warn', batching: false })

      warnLogger.debug('Debug - should be filtered')
      warnLogger.info('Info - should be filtered')
      warnLogger.warn('Warn - should appear')
      warnLogger.error('Error - should appear')

      const buffer = warnLogger.getBuffer()
      expect(buffer.length).toBe(2)
      expect(buffer[0].message).toBe('Warn - should appear')
      expect(buffer[1].message).toBe('Error - should appear')

      warnLogger.disable()
    })

    it('should change level at runtime', () => {
      logger.setLevel('error')
      logger.warn('Should be filtered')
      logger.error('Should appear')

      const buffer = logger.getBuffer()
      expect(buffer.length).toBe(1)
      expect(buffer[0].message).toBe('Should appear')
    })

    it('should get current level', () => {
      expect(logger.getLevel()).toBe('debug')
      logger.setLevel('error')
      expect(logger.getLevel()).toBe('error')
    })

    it('should check if level is enabled', () => {
      logger.setLevel('warn')

      expect(logger.isLevelEnabled('debug')).toBe(false)
      expect(logger.isLevelEnabled('info')).toBe(false)
      expect(logger.isLevelEnabled('warn')).toBe(true)
      expect(logger.isLevelEnabled('error')).toBe(true)
    })
  })

  // ===========================================================================
  // Attributes
  // ===========================================================================

  describe('Attributes', () => {
    it('should include custom attributes', () => {
      logger.info('Request', {
        method: 'POST',
        path: '/api/users',
        userId: 'user-123',
      })

      const buffer = logger.getBuffer()
      expect(buffer[0].method).toBe('POST')
      expect(buffer[0].path).toBe('/api/users')
      expect(buffer[0].userId).toBe('user-123')
    })

    it('should include nested attributes', () => {
      logger.info('Complex log', {
        request: {
          headers: { 'content-type': 'application/json' },
          body: { name: 'test' },
        },
      })

      const buffer = logger.getBuffer()
      expect((buffer[0].request as any).headers['content-type']).toBe('application/json')
    })

    it('should include array attributes', () => {
      logger.info('Array log', {
        tags: ['tag1', 'tag2'],
        ids: [1, 2, 3],
      })

      const buffer = logger.getBuffer()
      expect(buffer[0].tags).toEqual(['tag1', 'tag2'])
    })
  })

  // ===========================================================================
  // Error Logging
  // ===========================================================================

  describe('Error Logging', () => {
    it('should log error objects', () => {
      const error = new Error('Something went wrong')
      logger.logError(error)

      const buffer = logger.getBuffer()
      expect(buffer[0].status).toBe('error')
      expect(buffer[0].message).toBe('Something went wrong')
      expect((buffer[0].error as any).kind).toBe('Error')
      expect((buffer[0].error as any).stack).toBeDefined()
    })

    it('should log error with custom message', () => {
      const error = new TypeError('Invalid type')
      logger.logError(error, 'Type validation failed')

      const buffer = logger.getBuffer()
      expect(buffer[0].message).toBe('Type validation failed')
      expect((buffer[0].error as any).message).toBe('Invalid type')
    })

    it('should log error with additional attributes', () => {
      const error = new Error('DB Error')
      logger.logError(error, 'Database failed', { table: 'users', operation: 'INSERT' })

      const buffer = logger.getBuffer()
      expect(buffer[0].table).toBe('users')
      expect(buffer[0].operation).toBe('INSERT')
    })

    it('should log warning with error', () => {
      const error = new Error('Retry warning')
      logger.logWarning(error, 'Retrying operation')

      const buffer = logger.getBuffer()
      expect(buffer[0].status).toBe('warning')
      expect(buffer[0].message).toBe('Retrying operation')
    })
  })

  // ===========================================================================
  // Context Management
  // ===========================================================================

  describe('Context', () => {
    it('should set context', () => {
      logger.setContext({ requestId: 'req-123', userId: 'user-456' })
      logger.info('With context')

      const buffer = logger.getBuffer()
      expect(buffer[0].requestId).toBe('req-123')
      expect(buffer[0].userId).toBe('user-456')
    })

    it('should get context', () => {
      logger.setContext({ custom: 'value' })

      const context = logger.getContext()
      expect(context.custom).toBe('value')
      expect(context.service).toBe('test-service')
    })

    it('should clear context', () => {
      logger.setContext({ temp: 'value' })
      logger.clearContext()

      const context = logger.getContext()
      expect(context.temp).toBeUndefined()
      expect(context.service).toBe('test-service')
    })

    it('should add tags', () => {
      logger.addTag('feature:checkout')
      logger.addTag('version:2.0')
      logger.info('Tagged log')

      const buffer = logger.getBuffer()
      expect(buffer[0].ddtags).toBe('feature:checkout,version:2.0')
    })

    it('should not duplicate tags', () => {
      logger.addTag('duplicate')
      logger.addTag('duplicate')

      const context = logger.getContext()
      expect(context.tags).toEqual(['duplicate'])
    })

    it('should remove tags', () => {
      logger.addTag('remove-me')
      logger.addTag('keep-me')
      logger.removeTag('remove-me')

      const context = logger.getContext()
      expect(context.tags).toEqual(['keep-me'])
    })

    it('should add attribute', () => {
      logger.addAttribute('customKey', 'customValue')
      logger.info('With attribute')

      const buffer = logger.getBuffer()
      expect(buffer[0].customKey).toBe('customValue')
    })

    it('should remove attribute', () => {
      logger.addAttribute('temp', 'value')
      logger.removeAttribute('temp')

      const context = logger.getContext()
      expect(context.temp).toBeUndefined()
    })
  })

  // ===========================================================================
  // Child Loggers
  // ===========================================================================

  describe('Child Loggers', () => {
    it('should create child logger with additional context', () => {
      const child = logger.child({ requestId: 'req-001' })
      child.info('Child log')

      const buffer = child.getBuffer()
      expect(buffer[0].requestId).toBe('req-001')
      expect(buffer[0].service).toBe('test-service')

      child.disable()
    })

    it('should not affect parent logger', () => {
      const child = logger.child({ childOnly: true })

      logger.info('Parent log')
      child.info('Child log')

      const parentBuffer = logger.getBuffer()
      const childBuffer = child.getBuffer()

      expect(parentBuffer[0].childOnly).toBeUndefined()
      expect(childBuffer[0].childOnly).toBe(true)

      child.disable()
    })

    it('should create trace-bound logger', () => {
      const tracedLogger = logger.withTrace('trace-123', 'span-456')
      tracedLogger.info('Traced log')

      const buffer = tracedLogger.getBuffer()
      expect((buffer[0].dd as any).trace_id).toBe('trace-123')
      expect((buffer[0].dd as any).span_id).toBe('span-456')

      tracedLogger.disable()
    })

    it('should create user-bound logger', () => {
      const userLogger = logger.withUser('user-123', { email: 'test@example.com' })
      userLogger.info('User log')

      const buffer = userLogger.getBuffer()
      expect((buffer[0].usr as any).id).toBe('user-123')
      expect((buffer[0].usr as any).email).toBe('test@example.com')

      userLogger.disable()
    })
  })

  // ===========================================================================
  // Handlers
  // ===========================================================================

  describe('Handlers', () => {
    it('should call custom handler', () => {
      const logs: any[] = []
      const handler: LogHandler = (entry) => logs.push(entry)

      logger.addHandler(handler)
      logger.info('Handled log')

      expect(logs.length).toBe(1)
      expect(logs[0].message).toBe('Handled log')
    })

    it('should support multiple handlers', () => {
      const logs1: any[] = []
      const logs2: any[] = []

      logger.addHandler((entry) => logs1.push(entry))
      logger.addHandler((entry) => logs2.push(entry))
      logger.info('Multi handler')

      expect(logs1.length).toBe(1)
      expect(logs2.length).toBe(1)
    })

    it('should remove handler', () => {
      const logs: any[] = []
      const handler: LogHandler = (entry) => logs.push(entry)

      logger.addHandler(handler)
      logger.info('First')
      logger.removeHandler(handler)
      logger.info('Second')

      expect(logs.length).toBe(1)
    })

    it('should clear all handlers', () => {
      const logs: any[] = []

      logger.addHandler((entry) => logs.push(entry))
      logger.addHandler((entry) => logs.push(entry))
      logger.clearHandlers()
      logger.info('No handlers')

      expect(logs.length).toBe(0)
    })

    it('should handle handler errors gracefully', () => {
      logger.addHandler(() => {
        throw new Error('Handler error')
      })

      // Should not throw
      expect(() => logger.info('Test')).not.toThrow()
    })
  })

  // ===========================================================================
  // Buffer Management
  // ===========================================================================

  describe('Buffer', () => {
    it('should get buffer', () => {
      logger.info('Log 1')
      logger.info('Log 2')

      const buffer = logger.getBuffer()
      expect(buffer.length).toBe(2)
    })

    it('should clear buffer', () => {
      logger.info('Log 1')
      logger.clearBuffer()

      expect(logger.getBuffer().length).toBe(0)
    })

    it('should flush buffer', async () => {
      logger.info('Log 1')
      logger.info('Log 2')

      const response = await logger.flush()

      expect(response.status).toBe('ok')
      expect(response.data?.log_count).toBe(2)
      expect(logger.getBuffer().length).toBe(0)
    })

    it('should handle empty flush', async () => {
      const response = await logger.flush()

      expect(response.status).toBe('ok')
      expect(response.data?.log_count).toBe(0)
    })
  })

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe('Lifecycle', () => {
    it('should enable/disable logger', () => {
      logger.disable()
      logger.info('Disabled log')

      expect(logger.getBuffer().length).toBe(0)

      logger.enable()
      logger.info('Enabled log')

      expect(logger.getBuffer().length).toBe(1)
    })

    it('should check enabled state', () => {
      expect(logger.isEnabled()).toBe(true)
      logger.disable()
      expect(logger.isEnabled()).toBe(false)
    })

    it('should close logger', async () => {
      logger.info('Before close')

      await logger.close()

      expect(logger.isEnabled()).toBe(false)
      expect(logger.getBuffer().length).toBe(0)
    })

    it('should get configuration', () => {
      const config = logger.getConfig()

      expect(config.service).toBe('test-service')
      expect(config.env).toBe('test')
      expect(config.level).toBe('debug')
    })
  })

  // ===========================================================================
  // Timestamps
  // ===========================================================================

  describe('Timestamps', () => {
    it('should include timestamp by default', () => {
      logger.info('With timestamp')

      const buffer = logger.getBuffer()
      expect(buffer[0]['@timestamp']).toBeDefined()
    })

    it('should format timestamp as ISO string', () => {
      logger.info('Timestamp format')

      const buffer = logger.getBuffer()
      const timestamp = buffer[0]['@timestamp']
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('should disable timestamps', () => {
      const noTsLogger = new Logger({ timestamps: false, batching: false })
      noTsLogger.info('No timestamp')

      const buffer = noTsLogger.getBuffer()
      expect(buffer[0]['@timestamp']).toBeUndefined()

      noTsLogger.disable()
    })
  })

  // ===========================================================================
  // Default Logger
  // ===========================================================================

  describe('Default Logger', () => {
    it('should get default logger', () => {
      const defaultLogger = getDefaultLogger()
      expect(defaultLogger).toBeInstanceOf(Logger)
    })

    it('should set default logger', () => {
      const custom = createLogger({ service: 'custom' })
      setDefaultLogger(custom)

      const retrieved = getDefaultLogger()
      expect(retrieved).toBe(custom)

      custom.disable()
    })

    it('should use convenience functions', () => {
      const custom = createLogger({ service: 'default-test', batching: false })
      setDefaultLogger(custom)

      debug('Debug')
      info('Info')
      warn('Warn')
      error('Error')
      critical('Critical')

      const buffer = custom.getBuffer()
      expect(buffer.length).toBe(5)

      custom.disable()
    })

    it('should clear default logger', () => {
      const custom = createLogger()
      setDefaultLogger(custom)
      clearDefaultLogger()

      const newDefault = getDefaultLogger()
      expect(newDefault).not.toBe(custom)

      newDefault.disable()
      custom.disable()
    })
  })

  // ===========================================================================
  // Service Metadata
  // ===========================================================================

  describe('Service Metadata', () => {
    it('should include service name', () => {
      logger.info('Service log')

      const buffer = logger.getBuffer()
      expect(buffer[0].service).toBe('test-service')
    })

    it('should include hostname', () => {
      logger.info('Host log')

      const buffer = logger.getBuffer()
      expect(buffer[0].hostname).toBe('test-host')
    })

    it('should include environment', () => {
      logger.setContext({})
      const context = logger.getContext()
      expect(context.env).toBe('test')
    })
  })
})
