/**
 * Logger Interface Tests (RED)
 *
 * These tests define the contract for Logger - a structured logging interface
 * that supports log levels, filtering, and context.
 *
 * Tests are written to FAIL until the interface is implemented.
 */

import { describe, it, expect, vi } from 'vitest'
import type { Logger } from '../../core/logging/logger.js'
import { createLogger, LogLevel } from '../../core/logging/logger.js'

describe('Logger interface', () => {
  it('should have all log levels', () => {
    const logger = createLogger()
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
  })

  it('should respect log level filtering', () => {
    const output = vi.fn()
    const logger = createLogger({ level: LogLevel.WARN, output })

    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')

    expect(output).toHaveBeenCalledTimes(1)
    expect(output).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      message: 'warn message'
    }))
  })

  it('should include context in log entries', () => {
    const output = vi.fn()
    const logger = createLogger({ output })

    logger.info('test', { userId: '123', action: 'login' })

    expect(output).toHaveBeenCalledWith(expect.objectContaining({
      context: { userId: '123', action: 'login' }
    }))
  })
})
