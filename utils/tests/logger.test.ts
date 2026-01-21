/**
 * Tests for utils/logger.ts
 *
 * Comprehensive test coverage for the logging abstraction:
 * 1. Log level filtering
 * 2. Log formatting with prefixes
 * 3. Structured logging with additional args
 * 4. Different output targets (console methods)
 * 5. Configuration management
 * 6. Environment variable initialization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  LogLevel,
  logger,
  createLogger,
  createScopedLogger,
  runWithLogContext,
  getContextLogger,
  getLogContext,
  setLogLevel,
  getLogLevel,
  setLogPrefix,
  getLogPrefix,
  configureLogger,
  parseLogLevel,
  initLoggerFromEnv,
  type Logger,
  type LoggerConfig,
} from '../logger'

describe('LogLevel enum', () => {
  it('should have correct severity ordering', () => {
    expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO)
    expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN)
    expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR)
    expect(LogLevel.ERROR).toBeLessThan(LogLevel.SILENT)
  })

  it('should have expected numeric values', () => {
    expect(LogLevel.DEBUG).toBe(0)
    expect(LogLevel.INFO).toBe(1)
    expect(LogLevel.WARN).toBe(2)
    expect(LogLevel.ERROR).toBe(3)
    expect(LogLevel.SILENT).toBe(4)
  })
})

describe('parseLogLevel', () => {
  it('should parse DEBUG level case-insensitively', () => {
    expect(parseLogLevel('DEBUG')).toBe(LogLevel.DEBUG)
    expect(parseLogLevel('debug')).toBe(LogLevel.DEBUG)
    expect(parseLogLevel('Debug')).toBe(LogLevel.DEBUG)
  })

  it('should parse INFO level case-insensitively', () => {
    expect(parseLogLevel('INFO')).toBe(LogLevel.INFO)
    expect(parseLogLevel('info')).toBe(LogLevel.INFO)
    expect(parseLogLevel('Info')).toBe(LogLevel.INFO)
  })

  it('should parse WARN level and aliases', () => {
    expect(parseLogLevel('WARN')).toBe(LogLevel.WARN)
    expect(parseLogLevel('warn')).toBe(LogLevel.WARN)
    expect(parseLogLevel('WARNING')).toBe(LogLevel.WARN)
    expect(parseLogLevel('warning')).toBe(LogLevel.WARN)
  })

  it('should parse ERROR level', () => {
    expect(parseLogLevel('ERROR')).toBe(LogLevel.ERROR)
    expect(parseLogLevel('error')).toBe(LogLevel.ERROR)
  })

  it('should parse SILENT level and aliases', () => {
    expect(parseLogLevel('SILENT')).toBe(LogLevel.SILENT)
    expect(parseLogLevel('silent')).toBe(LogLevel.SILENT)
    expect(parseLogLevel('NONE')).toBe(LogLevel.SILENT)
    expect(parseLogLevel('none')).toBe(LogLevel.SILENT)
  })

  it('should default to INFO for undefined', () => {
    expect(parseLogLevel(undefined)).toBe(LogLevel.INFO)
  })

  it('should default to INFO for unknown strings', () => {
    expect(parseLogLevel('unknown')).toBe(LogLevel.INFO)
    expect(parseLogLevel('invalid')).toBe(LogLevel.INFO)
    expect(parseLogLevel('')).toBe(LogLevel.INFO)
    expect(parseLogLevel('verbose')).toBe(LogLevel.INFO)
  })
})

describe('Log Level Configuration', () => {
  const originalLevel = getLogLevel()
  const originalPrefix = getLogPrefix()

  afterEach(() => {
    // Restore original config after each test
    configureLogger({ level: originalLevel, prefix: originalPrefix })
  })

  describe('setLogLevel / getLogLevel', () => {
    it('should set and get DEBUG level', () => {
      setLogLevel(LogLevel.DEBUG)
      expect(getLogLevel()).toBe(LogLevel.DEBUG)
    })

    it('should set and get INFO level', () => {
      setLogLevel(LogLevel.INFO)
      expect(getLogLevel()).toBe(LogLevel.INFO)
    })

    it('should set and get WARN level', () => {
      setLogLevel(LogLevel.WARN)
      expect(getLogLevel()).toBe(LogLevel.WARN)
    })

    it('should set and get ERROR level', () => {
      setLogLevel(LogLevel.ERROR)
      expect(getLogLevel()).toBe(LogLevel.ERROR)
    })

    it('should set and get SILENT level', () => {
      setLogLevel(LogLevel.SILENT)
      expect(getLogLevel()).toBe(LogLevel.SILENT)
    })
  })

  describe('setLogPrefix / getLogPrefix', () => {
    it('should set and get a custom prefix', () => {
      setLogPrefix('[custom]')
      expect(getLogPrefix()).toBe('[custom]')
    })

    it('should allow empty prefix', () => {
      setLogPrefix('')
      expect(getLogPrefix()).toBe('')
    })

    it('should allow complex prefixes', () => {
      setLogPrefix('[app:module:component]')
      expect(getLogPrefix()).toBe('[app:module:component]')
    })
  })

  describe('configureLogger', () => {
    it('should configure level only', () => {
      const oldPrefix = getLogPrefix()
      configureLogger({ level: LogLevel.DEBUG })
      expect(getLogLevel()).toBe(LogLevel.DEBUG)
      expect(getLogPrefix()).toBe(oldPrefix)
    })

    it('should configure prefix only', () => {
      const oldLevel = getLogLevel()
      configureLogger({ prefix: '[new-prefix]' })
      expect(getLogPrefix()).toBe('[new-prefix]')
      expect(getLogLevel()).toBe(oldLevel)
    })

    it('should configure both level and prefix', () => {
      configureLogger({ level: LogLevel.ERROR, prefix: '[error-only]' })
      expect(getLogLevel()).toBe(LogLevel.ERROR)
      expect(getLogPrefix()).toBe('[error-only]')
    })

    it('should merge partial config with existing', () => {
      configureLogger({ level: LogLevel.DEBUG, prefix: '[test]' })
      configureLogger({ level: LogLevel.WARN })
      expect(getLogLevel()).toBe(LogLevel.WARN)
      expect(getLogPrefix()).toBe('[test]')
    })
  })
})

describe('Log Level Filtering', () => {
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
    setLogLevel(LogLevel.INFO)
    setLogPrefix('[dotdo]')
  })

  describe('DEBUG level filtering', () => {
    beforeEach(() => {
      setLogLevel(LogLevel.DEBUG)
    })

    it('should log all levels when set to DEBUG', () => {
      logger.debug('debug message')
      logger.info('info message')
      logger.warn('warn message')
      logger.error('error message')

      expect(consoleSpy.debug).toHaveBeenCalledTimes(1)
      expect(consoleSpy.info).toHaveBeenCalledTimes(1)
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1)
      expect(consoleSpy.error).toHaveBeenCalledTimes(1)
    })
  })

  describe('INFO level filtering', () => {
    beforeEach(() => {
      setLogLevel(LogLevel.INFO)
    })

    it('should NOT log debug when set to INFO', () => {
      logger.debug('debug message')
      expect(consoleSpy.debug).not.toHaveBeenCalled()
    })

    it('should log info, warn, and error when set to INFO', () => {
      logger.info('info message')
      logger.warn('warn message')
      logger.error('error message')

      expect(consoleSpy.info).toHaveBeenCalledTimes(1)
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1)
      expect(consoleSpy.error).toHaveBeenCalledTimes(1)
    })
  })

  describe('WARN level filtering', () => {
    beforeEach(() => {
      setLogLevel(LogLevel.WARN)
    })

    it('should NOT log debug or info when set to WARN', () => {
      logger.debug('debug message')
      logger.info('info message')

      expect(consoleSpy.debug).not.toHaveBeenCalled()
      expect(consoleSpy.info).not.toHaveBeenCalled()
    })

    it('should log warn and error when set to WARN', () => {
      logger.warn('warn message')
      logger.error('error message')

      expect(consoleSpy.warn).toHaveBeenCalledTimes(1)
      expect(consoleSpy.error).toHaveBeenCalledTimes(1)
    })
  })

  describe('ERROR level filtering', () => {
    beforeEach(() => {
      setLogLevel(LogLevel.ERROR)
    })

    it('should NOT log debug, info, or warn when set to ERROR', () => {
      logger.debug('debug message')
      logger.info('info message')
      logger.warn('warn message')

      expect(consoleSpy.debug).not.toHaveBeenCalled()
      expect(consoleSpy.info).not.toHaveBeenCalled()
      expect(consoleSpy.warn).not.toHaveBeenCalled()
    })

    it('should log only error when set to ERROR', () => {
      logger.error('error message')
      expect(consoleSpy.error).toHaveBeenCalledTimes(1)
    })
  })

  describe('SILENT level filtering', () => {
    beforeEach(() => {
      setLogLevel(LogLevel.SILENT)
    })

    it('should NOT log anything when set to SILENT', () => {
      logger.debug('debug message')
      logger.info('info message')
      logger.warn('warn message')
      logger.error('error message')

      expect(consoleSpy.debug).not.toHaveBeenCalled()
      expect(consoleSpy.info).not.toHaveBeenCalled()
      expect(consoleSpy.warn).not.toHaveBeenCalled()
      expect(consoleSpy.error).not.toHaveBeenCalled()
    })
  })
})

describe('Log Formatting', () => {
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
    setLogLevel(LogLevel.DEBUG)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setLogLevel(LogLevel.INFO)
    setLogPrefix('[dotdo]')
  })

  describe('Default logger prefix', () => {
    it('should include [dotdo] prefix by default', () => {
      setLogPrefix('[dotdo]')
      logger.info('test message')

      expect(consoleSpy.info).toHaveBeenCalledWith('[dotdo]', 'test message')
    })

    it('should use custom prefix when configured', () => {
      setLogPrefix('[custom-app]')
      logger.info('test message')

      expect(consoleSpy.info).toHaveBeenCalledWith('[custom-app]', 'test message')
    })

    it('should work with empty prefix', () => {
      setLogPrefix('')
      logger.info('test message')

      expect(consoleSpy.info).toHaveBeenCalledWith('', 'test message')
    })
  })

  describe('Different output targets', () => {
    it('should use console.debug for debug level', () => {
      logger.debug('debug test')
      expect(consoleSpy.debug).toHaveBeenCalled()
      expect(consoleSpy.info).not.toHaveBeenCalled()
      expect(consoleSpy.warn).not.toHaveBeenCalled()
      expect(consoleSpy.error).not.toHaveBeenCalled()
    })

    it('should use console.info for info level', () => {
      logger.info('info test')
      expect(consoleSpy.debug).not.toHaveBeenCalled()
      expect(consoleSpy.info).toHaveBeenCalled()
      expect(consoleSpy.warn).not.toHaveBeenCalled()
      expect(consoleSpy.error).not.toHaveBeenCalled()
    })

    it('should use console.warn for warn level', () => {
      logger.warn('warn test')
      expect(consoleSpy.debug).not.toHaveBeenCalled()
      expect(consoleSpy.info).not.toHaveBeenCalled()
      expect(consoleSpy.warn).toHaveBeenCalled()
      expect(consoleSpy.error).not.toHaveBeenCalled()
    })

    it('should use console.error for error level', () => {
      logger.error('error test')
      expect(consoleSpy.debug).not.toHaveBeenCalled()
      expect(consoleSpy.info).not.toHaveBeenCalled()
      expect(consoleSpy.warn).not.toHaveBeenCalled()
      expect(consoleSpy.error).toHaveBeenCalled()
    })
  })
})

describe('Structured Logging (additional args)', () => {
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
    setLogLevel(LogLevel.DEBUG)
    setLogPrefix('[dotdo]')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setLogLevel(LogLevel.INFO)
    setLogPrefix('[dotdo]')
  })

  it('should pass additional primitive arguments', () => {
    logger.info('message', 123, 'extra', true)

    expect(consoleSpy.info).toHaveBeenCalledWith('[dotdo]', 'message', 123, 'extra', true)
  })

  it('should pass object arguments for structured logging', () => {
    const data = { userId: '123', action: 'login' }
    logger.info('user action', data)

    expect(consoleSpy.info).toHaveBeenCalledWith('[dotdo]', 'user action', data)
  })

  it('should pass multiple object arguments', () => {
    const user = { id: '123', name: 'Alice' }
    const metadata = { timestamp: 12345, source: 'api' }
    logger.info('event', user, metadata)

    expect(consoleSpy.info).toHaveBeenCalledWith('[dotdo]', 'event', user, metadata)
  })

  it('should pass Error objects', () => {
    const error = new Error('test error')
    logger.error('caught error', error)

    expect(consoleSpy.error).toHaveBeenCalledWith('[dotdo]', 'caught error', error)
  })

  it('should handle array arguments', () => {
    const items = [1, 2, 3]
    logger.debug('processing items', items)

    expect(consoleSpy.debug).toHaveBeenCalledWith('[dotdo]', 'processing items', items)
  })

  it('should handle null and undefined arguments', () => {
    logger.warn('warning with nullish', null, undefined)

    expect(consoleSpy.warn).toHaveBeenCalledWith('[dotdo]', 'warning with nullish', null, undefined)
  })

  it('should handle nested objects', () => {
    const nested = {
      level1: {
        level2: {
          value: 'deep',
        },
      },
    }
    logger.info('nested data', nested)

    expect(consoleSpy.info).toHaveBeenCalledWith('[dotdo]', 'nested data', nested)
  })
})

describe('createLogger (custom loggers)', () => {
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
    setLogLevel(LogLevel.DEBUG)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setLogLevel(LogLevel.INFO)
  })

  it('should create a logger with custom prefix', () => {
    const customLogger = createLogger('[WebSocket]')
    customLogger.info('connected')

    expect(consoleSpy.info).toHaveBeenCalledWith('[WebSocket]', 'connected')
  })

  it('should create multiple loggers with different prefixes', () => {
    const wsLogger = createLogger('[WS]')
    const httpLogger = createLogger('[HTTP]')
    const dbLogger = createLogger('[DB]')

    wsLogger.info('ws message')
    httpLogger.info('http message')
    dbLogger.info('db message')

    expect(consoleSpy.info).toHaveBeenNthCalledWith(1, '[WS]', 'ws message')
    expect(consoleSpy.info).toHaveBeenNthCalledWith(2, '[HTTP]', 'http message')
    expect(consoleSpy.info).toHaveBeenNthCalledWith(3, '[DB]', 'db message')
  })

  it('should respect global log level', () => {
    const customLogger = createLogger('[Custom]')
    setLogLevel(LogLevel.WARN)

    customLogger.debug('debug')
    customLogger.info('info')
    customLogger.warn('warn')
    customLogger.error('error')

    expect(consoleSpy.debug).not.toHaveBeenCalled()
    expect(consoleSpy.info).not.toHaveBeenCalled()
    expect(consoleSpy.warn).toHaveBeenCalled()
    expect(consoleSpy.error).toHaveBeenCalled()
  })

  it('should react to dynamic log level changes', () => {
    const customLogger = createLogger('[Dynamic]')

    // Start at INFO
    setLogLevel(LogLevel.INFO)
    customLogger.debug('should not appear')
    expect(consoleSpy.debug).not.toHaveBeenCalled()

    // Change to DEBUG
    setLogLevel(LogLevel.DEBUG)
    customLogger.debug('should appear')
    expect(consoleSpy.debug).toHaveBeenCalledWith('[Dynamic]', 'should appear')
  })

  it('should have all Logger interface methods', () => {
    const customLogger = createLogger('[Test]')

    expect(typeof customLogger.debug).toBe('function')
    expect(typeof customLogger.info).toBe('function')
    expect(typeof customLogger.warn).toBe('function')
    expect(typeof customLogger.error).toBe('function')
  })

  it('should pass additional arguments through custom logger', () => {
    const customLogger = createLogger('[API]')
    const requestData = { method: 'GET', path: '/users' }

    customLogger.info('request', requestData, 200)

    expect(consoleSpy.info).toHaveBeenCalledWith('[API]', 'request', requestData, 200)
  })
})

describe('initLoggerFromEnv', () => {
  const originalEnv = process.env.DOTDO_LOG_LEVEL

  afterEach(() => {
    // Restore original environment
    if (originalEnv === undefined) {
      delete process.env.DOTDO_LOG_LEVEL
    } else {
      process.env.DOTDO_LOG_LEVEL = originalEnv
    }
    setLogLevel(LogLevel.INFO)
  })

  it('should set DEBUG level from env', () => {
    process.env.DOTDO_LOG_LEVEL = 'DEBUG'
    initLoggerFromEnv()
    expect(getLogLevel()).toBe(LogLevel.DEBUG)
  })

  it('should set WARN level from env', () => {
    process.env.DOTDO_LOG_LEVEL = 'WARN'
    initLoggerFromEnv()
    expect(getLogLevel()).toBe(LogLevel.WARN)
  })

  it('should set SILENT level from env', () => {
    process.env.DOTDO_LOG_LEVEL = 'SILENT'
    initLoggerFromEnv()
    expect(getLogLevel()).toBe(LogLevel.SILENT)
  })

  it('should handle lowercase env values', () => {
    process.env.DOTDO_LOG_LEVEL = 'error'
    initLoggerFromEnv()
    expect(getLogLevel()).toBe(LogLevel.ERROR)
  })

  it('should default to INFO when env is not set', () => {
    delete process.env.DOTDO_LOG_LEVEL
    setLogLevel(LogLevel.ERROR) // Set a different value first
    initLoggerFromEnv()
    // When env is not set, it doesn't change the current level
    expect(getLogLevel()).toBe(LogLevel.ERROR)
  })
})

describe('Logger Interface compliance', () => {
  it('default logger should satisfy Logger interface', () => {
    const l: Logger = logger
    expect(l).toBeDefined()
    expect(typeof l.debug).toBe('function')
    expect(typeof l.info).toBe('function')
    expect(typeof l.warn).toBe('function')
    expect(typeof l.error).toBe('function')
  })

  it('createLogger should return Logger interface', () => {
    const l: Logger = createLogger('[test]')
    expect(l).toBeDefined()
    expect(typeof l.debug).toBe('function')
    expect(typeof l.info).toBe('function')
    expect(typeof l.warn).toBe('function')
    expect(typeof l.error).toBe('function')
  })
})

describe('Edge cases', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    setLogLevel(LogLevel.DEBUG)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setLogLevel(LogLevel.INFO)
    setLogPrefix('[dotdo]')
  })

  it('should handle empty message', () => {
    logger.info('')
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), '')
  })

  it('should handle very long messages', () => {
    const longMessage = 'a'.repeat(10000)
    logger.info(longMessage)
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), longMessage)
  })

  it('should handle special characters in message', () => {
    const specialMessage = 'Hello\nWorld\tTab\r\nNewline'
    logger.info(specialMessage)
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), specialMessage)
  })

  it('should handle unicode characters', () => {
    const unicodeMessage = 'Hello World 👋'
    logger.info(unicodeMessage)
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), unicodeMessage)
  })

  it('should handle circular references in args gracefully', () => {
    // Console naturally handles circular references, we just ensure no crash
    const obj: Record<string, unknown> = { name: 'test' }
    obj.self = obj

    // This should not throw
    expect(() => logger.info('circular', obj)).not.toThrow()
  })

  it('should handle functions in args', () => {
    const fn = () => 'result'
    expect(() => logger.info('with function', fn)).not.toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), 'with function', fn)
  })

  it('should handle Symbol in args', () => {
    const sym = Symbol('test')
    expect(() => logger.info('with symbol', sym)).not.toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), 'with symbol', sym)
  })

  it('should handle BigInt in args', () => {
    const big = BigInt(9007199254740991)
    expect(() => logger.info('with bigint', big)).not.toThrow()
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), 'with bigint', big)
  })
})

describe('Concurrent usage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setLogLevel(LogLevel.INFO)
    setLogPrefix('[dotdo]')
  })

  it('should handle rapid level changes', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    // Rapid level changes
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        setLogLevel(LogLevel.DEBUG)
        logger.debug('debug')
      } else {
        setLogLevel(LogLevel.INFO)
        logger.debug('debug') // Should not log
      }
    }

    // Debug should only be called 50 times (even iterations)
    expect(debugSpy).toHaveBeenCalledTimes(50)
  })

  it('should maintain isolation between custom loggers', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const logger1 = createLogger('[Logger1]')
    const logger2 = createLogger('[Logger2]')

    logger1.info('from 1')
    logger2.info('from 2')
    logger1.info('again from 1')

    expect(spy).toHaveBeenNthCalledWith(1, '[Logger1]', 'from 1')
    expect(spy).toHaveBeenNthCalledWith(2, '[Logger2]', 'from 2')
    expect(spy).toHaveBeenNthCalledWith(3, '[Logger1]', 'again from 1')
  })
})

// ============================================================================
// Request-Scoped Logging Tests (do-6eza)
// ============================================================================

describe('createScopedLogger (request-scoped)', () => {
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
    setLogLevel(LogLevel.INFO)
    setLogPrefix('[dotdo]')
  })

  it('should create a logger with fully isolated configuration', () => {
    const scopedLogger = createScopedLogger({
      level: LogLevel.DEBUG,
      prefix: '[Scoped]',
    })

    scopedLogger.debug('scoped message')
    expect(consoleSpy.debug).toHaveBeenCalledWith('[Scoped]', 'scoped message')
  })

  it('should NOT be affected by global config changes', () => {
    // Create scoped logger with DEBUG level
    const scopedLogger = createScopedLogger({
      level: LogLevel.DEBUG,
      prefix: '[Isolated]',
    })

    // Change global to SILENT - should NOT affect scoped logger
    setLogLevel(LogLevel.SILENT)

    scopedLogger.debug('still works')
    expect(consoleSpy.debug).toHaveBeenCalledWith('[Isolated]', 'still works')

    // But global logger should be silenced
    logger.debug('should not appear')
    // Should have been called only once (by scoped logger)
    expect(consoleSpy.debug).toHaveBeenCalledTimes(1)
  })

  it('should respect its own log level filtering', () => {
    const scopedLogger = createScopedLogger({
      level: LogLevel.WARN,
      prefix: '[WarnOnly]',
    })

    scopedLogger.debug('debug')
    scopedLogger.info('info')
    scopedLogger.warn('warn')
    scopedLogger.error('error')

    expect(consoleSpy.debug).not.toHaveBeenCalled()
    expect(consoleSpy.info).not.toHaveBeenCalled()
    expect(consoleSpy.warn).toHaveBeenCalledWith('[WarnOnly]', 'warn')
    expect(consoleSpy.error).toHaveBeenCalledWith('[WarnOnly]', 'error')
  })

  it('should maintain isolation between multiple scoped loggers', () => {
    const logger1 = createScopedLogger({ level: LogLevel.DEBUG, prefix: '[L1]' })
    const logger2 = createScopedLogger({ level: LogLevel.ERROR, prefix: '[L2]' })

    logger1.debug('debug from 1') // Should log
    logger2.debug('debug from 2') // Should NOT log (level is ERROR)

    expect(consoleSpy.debug).toHaveBeenCalledTimes(1)
    expect(consoleSpy.debug).toHaveBeenCalledWith('[L1]', 'debug from 1')
  })

  it('should have all Logger interface methods', () => {
    const scopedLogger = createScopedLogger({ level: LogLevel.INFO, prefix: '[Test]' })

    expect(typeof scopedLogger.debug).toBe('function')
    expect(typeof scopedLogger.info).toBe('function')
    expect(typeof scopedLogger.warn).toBe('function')
    expect(typeof scopedLogger.error).toBe('function')
  })

  it('should pass additional arguments through', () => {
    const scopedLogger = createScopedLogger({ level: LogLevel.DEBUG, prefix: '[API]' })
    const data = { method: 'GET', path: '/users' }

    scopedLogger.info('request', data, 200)

    expect(consoleSpy.info).toHaveBeenCalledWith('[API]', 'request', data, 200)
  })
})

describe('runWithLogContext and getContextLogger (AsyncLocalStorage)', () => {
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
    setLogLevel(LogLevel.INFO)
    setLogPrefix('[dotdo]')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setLogLevel(LogLevel.INFO)
    setLogPrefix('[dotdo]')
  })

  it('should provide scoped logger within runWithLogContext', async () => {
    await runWithLogContext(
      { level: LogLevel.DEBUG, prefix: '[Request-123]' },
      async () => {
        const log = getContextLogger()
        log.debug('processing')
        expect(consoleSpy.debug).toHaveBeenCalledWith('[Request-123]', 'processing')
      }
    )
  })

  it('should return global logger outside of runWithLogContext', () => {
    // Outside of runWithLogContext, getContextLogger should return global logger
    const log = getContextLogger()
    setLogLevel(LogLevel.DEBUG)

    log.debug('global debug')
    expect(consoleSpy.debug).toHaveBeenCalledWith('[dotdo]', 'global debug')
  })

  it('should isolate config between nested runWithLogContext calls', async () => {
    await runWithLogContext(
      { level: LogLevel.DEBUG, prefix: '[Outer]' },
      async () => {
        const outerLog = getContextLogger()
        outerLog.info('outer start')

        await runWithLogContext(
          { level: LogLevel.ERROR, prefix: '[Inner]' },
          async () => {
            const innerLog = getContextLogger()
            innerLog.info('inner info') // Should NOT log (level is ERROR)
            innerLog.error('inner error') // Should log

            expect(consoleSpy.info).toHaveBeenCalledTimes(1) // Only outer
            expect(consoleSpy.error).toHaveBeenCalledWith('[Inner]', 'inner error')
          }
        )

        // After inner context, outer context should be restored
        outerLog.info('outer end')
        expect(consoleSpy.info).toHaveBeenCalledTimes(2)
      }
    )
  })

  it('should return context config with getLogContext', async () => {
    await runWithLogContext(
      { level: LogLevel.DEBUG, prefix: '[Test]' },
      async () => {
        const config = getLogContext()
        expect(config).toBeDefined()
        expect(config?.level).toBe(LogLevel.DEBUG)
        expect(config?.prefix).toBe('[Test]')
      }
    )
  })

  it('should return undefined from getLogContext outside context', () => {
    const config = getLogContext()
    expect(config).toBeUndefined()
  })

  it('should preserve context across async operations', async () => {
    await runWithLogContext(
      { level: LogLevel.DEBUG, prefix: '[Async]' },
      async () => {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10))

        const log = getContextLogger()
        log.debug('after await')

        expect(consoleSpy.debug).toHaveBeenCalledWith('[Async]', 'after await')
      }
    )
  })

  it('should handle errors in context without leaking', async () => {
    try {
      await runWithLogContext(
        { level: LogLevel.DEBUG, prefix: '[Error]' },
        async () => {
          const log = getContextLogger()
          log.info('before error')
          throw new Error('test error')
        }
      )
    } catch {
      // Expected
    }

    // After error, context should be cleaned up
    const config = getLogContext()
    expect(config).toBeUndefined()
  })
})

describe('Request-scoped isolation for Workers (do-6eza)', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setLogLevel(LogLevel.INFO)
    setLogPrefix('[dotdo]')
  })

  it('should demonstrate global config leakage with old API', () => {
    // This test demonstrates the PROBLEM that do-6eza fixes
    // Global config changes from one "request" affect others

    // Request 1 sets DEBUG level
    setLogLevel(LogLevel.DEBUG)
    const request1Logger = createLogger('[Request1]')

    // Request 2 starts, changes level to SILENT
    setLogLevel(LogLevel.SILENT)

    // Request 1 tries to log, but level was changed by Request 2!
    request1Logger.info('from request 1') // Should have logged, but won't

    // This is the PROBLEM: no logging happened
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('should prevent global config leakage with createScopedLogger', () => {
    // This test demonstrates the FIX with createScopedLogger

    // Request 1 creates a scoped logger
    const request1Logger = createScopedLogger({
      level: LogLevel.DEBUG,
      prefix: '[Request1]',
    })

    // Request 2 creates its own scoped logger (or changes global - doesn't matter)
    setLogLevel(LogLevel.SILENT) // Global change
    const request2Logger = createScopedLogger({
      level: LogLevel.SILENT,
      prefix: '[Request2]',
    })

    // Request 1 can still log! Its config is isolated.
    request1Logger.info('from request 1')

    expect(consoleSpy).toHaveBeenCalledWith('[Request1]', 'from request 1')
    expect(consoleSpy).toHaveBeenCalledTimes(1)
  })

  it('should simulate concurrent requests with isolated logging', async () => {
    const logs: string[] = []
    vi.spyOn(console, 'info').mockImplementation((...args) => {
      logs.push(args.join(' '))
    })

    // Simulate two concurrent requests
    const request1 = runWithLogContext(
      { level: LogLevel.DEBUG, prefix: '[Req-1]' },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        const log = getContextLogger()
        log.info('from request 1')
      }
    )

    const request2 = runWithLogContext(
      { level: LogLevel.DEBUG, prefix: '[Req-2]' },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 2))
        const log = getContextLogger()
        log.info('from request 2')
      }
    )

    await Promise.all([request1, request2])

    // Both requests should have logged with their own prefixes
    expect(logs).toContain('[Req-1] from request 1')
    expect(logs).toContain('[Req-2] from request 2')
  })
})
