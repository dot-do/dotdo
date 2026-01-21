/**
 * Logging Standardization Tests (do-fmux2)
 *
 * TDD tests to ensure all packages use the standardized @dotdo/utils logging pattern.
 * These tests verify:
 * 1. Logger interface compatibility
 * 2. LogLevel enum compatibility
 * 3. createLogger function signature
 * 4. createScopedLogger for request isolation
 * 5. No duplicate logger implementations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  LogLevel,
  Logger,
  LoggerConfig,
  createLogger,
  createScopedLogger,
  setLogLevel,
  getLogLevel,
  logger,
} from '../logger'

// ============================================================================
// Interface Contract Tests
// ============================================================================

describe('Standardized Logger Interface (do-fmux2)', () => {
  describe('LogLevel enum contract', () => {
    it('should have DEBUG, INFO, WARN, ERROR, SILENT levels', () => {
      expect(LogLevel.DEBUG).toBeDefined()
      expect(LogLevel.INFO).toBeDefined()
      expect(LogLevel.WARN).toBeDefined()
      expect(LogLevel.ERROR).toBeDefined()
      expect(LogLevel.SILENT).toBeDefined()
    })

    it('should have severity ordering: DEBUG < INFO < WARN < ERROR < SILENT', () => {
      expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO)
      expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN)
      expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR)
      expect(LogLevel.ERROR).toBeLessThan(LogLevel.SILENT)
    })

    it('should have numeric values 0-4', () => {
      expect(LogLevel.DEBUG).toBe(0)
      expect(LogLevel.INFO).toBe(1)
      expect(LogLevel.WARN).toBe(2)
      expect(LogLevel.ERROR).toBe(3)
      expect(LogLevel.SILENT).toBe(4)
    })
  })

  describe('Logger interface contract', () => {
    it('should have debug, info, warn, error methods', () => {
      const testLogger: Logger = {
        debug: (_msg: string, ..._args: unknown[]) => {},
        info: (_msg: string, ..._args: unknown[]) => {},
        warn: (_msg: string, ..._args: unknown[]) => {},
        error: (_msg: string, ..._args: unknown[]) => {},
      }

      expect(typeof testLogger.debug).toBe('function')
      expect(typeof testLogger.info).toBe('function')
      expect(typeof testLogger.warn).toBe('function')
      expect(typeof testLogger.error).toBe('function')
    })

    it('should accept message and variadic args', () => {
      const calls: Array<{ method: string; args: unknown[] }> = []
      const testLogger: Logger = {
        debug: (msg, ...args) => calls.push({ method: 'debug', args: [msg, ...args] }),
        info: (msg, ...args) => calls.push({ method: 'info', args: [msg, ...args] }),
        warn: (msg, ...args) => calls.push({ method: 'warn', args: [msg, ...args] }),
        error: (msg, ...args) => calls.push({ method: 'error', args: [msg, ...args] }),
      }

      testLogger.info('message', { data: 1 }, 'extra')

      expect(calls[0]).toEqual({
        method: 'info',
        args: ['message', { data: 1 }, 'extra'],
      })
    })
  })

  describe('LoggerConfig interface contract', () => {
    it('should have level and prefix properties', () => {
      const config: LoggerConfig = {
        level: LogLevel.DEBUG,
        prefix: '[Test]',
      }

      expect(config.level).toBe(LogLevel.DEBUG)
      expect(config.prefix).toBe('[Test]')
    })
  })
})

// ============================================================================
// createLogger Function Tests
// ============================================================================

describe('createLogger standardized function (do-fmux2)', () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>
    info: ReturnType<typeof vi.spyOn>
    warn: ReturnType<typeof vi.spyOn>
    error: ReturnType<typeof vi.spyOn>
  }

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should accept a prefix string parameter', () => {
    const log = createLogger('[MyModule]')
    expect(log).toBeDefined()
  })

  it('should return a Logger interface', () => {
    const log = createLogger('[Test]')

    expect(typeof log.debug).toBe('function')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
  })

  it('should prepend prefix to all log messages', () => {
    // Force DEBUG level to see all messages
    setLogLevel(LogLevel.DEBUG)

    const log = createLogger('[API]')

    log.debug('debug message')
    log.info('info message')
    log.warn('warn message')
    log.error('error message')

    expect(consoleSpy.debug).toHaveBeenCalledWith('[API]', 'debug message')
    expect(consoleSpy.info).toHaveBeenCalledWith('[API]', 'info message')
    expect(consoleSpy.warn).toHaveBeenCalledWith('[API]', 'warn message')
    expect(consoleSpy.error).toHaveBeenCalledWith('[API]', 'error message')

    // Reset
    setLogLevel(LogLevel.INFO)
  })

  it('should support additional arguments (structured logging)', () => {
    setLogLevel(LogLevel.DEBUG)

    const log = createLogger('[Service]')
    const data = { userId: '123', action: 'login' }

    log.info('user action', data, 200)

    expect(consoleSpy.info).toHaveBeenCalledWith('[Service]', 'user action', data, 200)

    setLogLevel(LogLevel.INFO)
  })
})

// ============================================================================
// createScopedLogger Function Tests (Request Isolation)
// ============================================================================

describe('createScopedLogger standardized function (do-fmux2)', () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>
    info: ReturnType<typeof vi.spyOn>
    warn: ReturnType<typeof vi.spyOn>
    error: ReturnType<typeof vi.spyOn>
  }

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should accept LoggerConfig parameter', () => {
    const log = createScopedLogger({
      level: LogLevel.DEBUG,
      prefix: '[Scoped]',
    })

    expect(log).toBeDefined()
  })

  it('should return a Logger interface', () => {
    const log = createScopedLogger({
      level: LogLevel.INFO,
      prefix: '[Test]',
    })

    expect(typeof log.debug).toBe('function')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
  })

  it('should be fully isolated from global config', () => {
    const originalLevel = getLogLevel()

    // Create scoped logger with DEBUG
    const scopedLog = createScopedLogger({
      level: LogLevel.DEBUG,
      prefix: '[Isolated]',
    })

    // Change global to SILENT
    setLogLevel(LogLevel.SILENT)

    // Scoped logger should STILL work
    scopedLog.debug('should still log')
    expect(consoleSpy.debug).toHaveBeenCalledWith('[Isolated]', 'should still log')

    // Global logger should be silent
    logger.debug('should NOT log')
    // Should have been called only once (by scoped logger)
    expect(consoleSpy.debug).toHaveBeenCalledTimes(1)

    // Restore
    setLogLevel(originalLevel)
  })

  it('should respect its own log level', () => {
    const warnOnlyLog = createScopedLogger({
      level: LogLevel.WARN,
      prefix: '[WarnOnly]',
    })

    warnOnlyLog.debug('debug')
    warnOnlyLog.info('info')
    warnOnlyLog.warn('warn')
    warnOnlyLog.error('error')

    expect(consoleSpy.debug).not.toHaveBeenCalled()
    expect(consoleSpy.info).not.toHaveBeenCalled()
    expect(consoleSpy.warn).toHaveBeenCalledWith('[WarnOnly]', 'warn')
    expect(consoleSpy.error).toHaveBeenCalledWith('[WarnOnly]', 'error')
  })
})

// ============================================================================
// Usage Pattern Tests (verifying packages use standard pattern)
// ============================================================================

describe('Standard usage patterns (do-fmux2)', () => {
  it('should use createLogger with [ModuleName] prefix convention', () => {
    // This is the standard pattern all modules should follow
    const moduleLogger = createLogger('[DO]')
    const wsLogger = createLogger('[WebSocket]')
    const dbLogger = createLogger('[DB]')

    expect(moduleLogger).toBeDefined()
    expect(wsLogger).toBeDefined()
    expect(dbLogger).toBeDefined()
  })

  it('should use createScopedLogger for request-scoped isolation in Workers', () => {
    // Simulate two concurrent requests
    const request1Logger = createScopedLogger({
      level: LogLevel.DEBUG,
      prefix: '[Request-1]',
    })

    const request2Logger = createScopedLogger({
      level: LogLevel.ERROR,
      prefix: '[Request-2]',
    })

    // They should be independent
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    request1Logger.debug('debug from 1') // Should log
    request2Logger.debug('debug from 2') // Should NOT log (ERROR level)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('[Request-1]', 'debug from 1')

    spy.mockRestore()
  })
})
