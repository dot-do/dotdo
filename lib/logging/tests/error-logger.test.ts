import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Error Logger Tests (TDD - RED Phase)
 *
 * Tests for the best-effort error logging module.
 * Verifies structured error output, never-throw behavior, and scoped logger creation.
 */

import { logBestEffortError, createScopedErrorLogger } from '../error-logger'
import type { LogEntry } from '../index'

// ============================================================================
// logBestEffortError
// ============================================================================

describe('logBestEffortError', () => {
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

  it('logs Error objects with structured output', () => {
    const error = new Error('Database connection failed')

    logBestEffortError(error, {
      operation: 'connect',
      source: 'Database.connect'
    })

    expect(consoleSpy).toHaveBeenCalled()
    expect(capturedOutput).toBeDefined()

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.level).toBe('warn')
    expect(parsed.message).toContain('Best-effort operation failed')
    expect(parsed.bestEffort).toBe(true)
    expect(parsed.operation).toBe('connect')
    expect(parsed.source).toBe('Database.connect')
  })

  it('serializes Error with name, message, and stack', () => {
    const error = new TypeError('Invalid argument')

    logBestEffortError(error, {
      operation: 'validate',
      source: 'Validator.check'
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    const errorObj = parsed.error as { name: string; message: string; stack?: string }

    expect(errorObj.name).toBe('TypeError')
    expect(errorObj.message).toBe('Invalid argument')
    expect(errorObj.stack).toBeDefined()
    expect(errorObj.stack).toContain('TypeError: Invalid argument')
  })

  it('handles string errors', () => {
    logBestEffortError('Something went wrong', {
      operation: 'process',
      source: 'Worker.run'
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    const errorObj = parsed.error as { name: string; message: string }

    expect(errorObj.name).toBe('StringError')
    expect(errorObj.message).toBe('Something went wrong')
  })

  it('handles null error', () => {
    logBestEffortError(null, {
      operation: 'unknown',
      source: 'Handler.catch'
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    const errorObj = parsed.error as { name: string; message: string }

    expect(errorObj.name).toBe('Unknown')
    expect(errorObj.message).toContain('Unknown error')
  })

  it('handles undefined error', () => {
    logBestEffortError(undefined, {
      operation: 'unknown',
      source: 'Handler.catch'
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    const errorObj = parsed.error as { name: string; message: string }

    expect(errorObj.name).toBe('Unknown')
    expect(errorObj.message).toContain('Unknown error')
  })

  it('handles object-shaped errors', () => {
    const errorLike = { name: 'CustomError', message: 'Custom message', code: 500 }

    logBestEffortError(errorLike, {
      operation: 'custom',
      source: 'CustomHandler'
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    const errorObj = parsed.error as { name: string; message: string }

    expect(errorObj.name).toBe('CustomError')
    expect(errorObj.message).toBe('Custom message')
  })

  it('handles primitive non-string errors', () => {
    logBestEffortError(42, {
      operation: 'numeric',
      source: 'Handler'
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    const errorObj = parsed.error as { name: string; message: string }

    expect(errorObj.name).toBe('Unknown')
    expect(errorObj.message).toBe('42')
  })

  it('includes correlationId when provided', () => {
    logBestEffortError(new Error('test'), {
      operation: 'test',
      source: 'Test',
      correlationId: 'req-123-abc'
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.correlationId).toBe('req-123-abc')
  })

  it('includes additional context when provided', () => {
    logBestEffortError(new Error('test'), {
      operation: 'insert',
      source: 'ThingStore.create',
      context: { thingId: 'thing-123', verb: 'Thing.created' }
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    const ctx = parsed.context as { thingId: string; verb: string }
    expect(ctx.thingId).toBe('thing-123')
    expect(ctx.verb).toBe('Thing.created')
  })

  it('includes name "best-effort" in log entry', () => {
    logBestEffortError(new Error('test'), {
      operation: 'test',
      source: 'Test'
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.name).toBe('best-effort')
  })

  it('NEVER throws even if logging itself fails', () => {
    // Mock console.log to throw
    consoleSpy.mockImplementation(() => {
      throw new Error('Console is broken')
    })

    // This should NOT throw
    expect(() => {
      logBestEffortError(new Error('test'), {
        operation: 'test',
        source: 'Test'
      })
    }).not.toThrow()
  })
})

// ============================================================================
// createScopedErrorLogger
// ============================================================================

describe('createScopedErrorLogger', () => {
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

  it('creates a scoped logger function', () => {
    const logError = createScopedErrorLogger('ThingStore')
    expect(typeof logError).toBe('function')
  })

  it('scoped logger includes source prefix', () => {
    const logError = createScopedErrorLogger('ThingStore')
    logError(new Error('test'), 'create')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.source).toBe('ThingStore.create')
  })

  it('scoped logger accepts context', () => {
    const logError = createScopedErrorLogger('ThingStore')
    logError(new Error('test'), 'create', { thingId: 'thing-123' })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    const ctx = parsed.context as { thingId: string }
    expect(ctx.thingId).toBe('thing-123')
  })

  it('scoped logger accepts correlationId', () => {
    const logError = createScopedErrorLogger('ThingStore')
    logError(new Error('test'), 'create', undefined, 'req-456')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.correlationId).toBe('req-456')
  })

  it('scoped logger logs at warn level', () => {
    const logError = createScopedErrorLogger('Component')
    logError(new Error('test'), 'method')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.level).toBe('warn')
  })

  it('scoped logger includes bestEffort flag', () => {
    const logError = createScopedErrorLogger('Component')
    logError(new Error('test'), 'method')

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.bestEffort).toBe(true)
  })

  it('scoped logger never throws', () => {
    consoleSpy.mockImplementation(() => {
      throw new Error('Console broken')
    })

    const logError = createScopedErrorLogger('Component')

    expect(() => {
      logError(new Error('test'), 'method')
    }).not.toThrow()
  })
})

// ============================================================================
// Structured Output Format
// ============================================================================

describe('error-logger structured output', () => {
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
    logBestEffortError(new Error('test'), {
      operation: 'test',
      source: 'Test'
    })

    expect(capturedOutput).toBeDefined()
    expect(() => JSON.parse(capturedOutput!)).not.toThrow()
  })

  it('includes timestamp in ISO format', () => {
    logBestEffortError(new Error('test'), {
      operation: 'test',
      source: 'Test'
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('outputs single-line JSON (no newlines)', () => {
    const error = new Error('Multi\nLine\nError')

    logBestEffortError(error, {
      operation: 'test',
      source: 'Test',
      context: {
        multilineData: 'line1\nline2\nline3'
      }
    })

    // The output string should not contain unescaped newlines
    // (JSON.stringify escapes them as \n)
    expect(capturedOutput).toBeDefined()
    expect(capturedOutput!.split('\n').length).toBe(1)
  })
})

// ============================================================================
// Error Handling Edge Cases
// ============================================================================

describe('error-logger edge cases', () => {
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

  it('handles errors with circular references in cause', () => {
    const circular: Record<string, unknown> = { value: 'test' }
    circular.self = circular
    const error = new Error('Circular error')
    ;(error as any).context = circular

    expect(() => {
      logBestEffortError(error, {
        operation: 'test',
        source: 'Test'
      })
    }).not.toThrow()
  })

  it('handles errors with very long messages', () => {
    const longMessage = 'x'.repeat(10000)
    const error = new Error(longMessage)

    expect(() => {
      logBestEffortError(error, {
        operation: 'test',
        source: 'Test'
      })
    }).not.toThrow()

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    const errorObj = parsed.error as { message: string }
    expect(errorObj.message).toBe(longMessage)
  })

  it('handles context with deeply nested objects', () => {
    const deepContext = {
      level1: {
        level2: {
          level3: {
            level4: {
              value: 'deep'
            }
          }
        }
      }
    }

    logBestEffortError(new Error('test'), {
      operation: 'test',
      source: 'Test',
      context: deepContext
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    const ctx = parsed.context as any
    expect(ctx.level1.level2.level3.level4.value).toBe('deep')
  })

  it('handles empty context object', () => {
    logBestEffortError(new Error('test'), {
      operation: 'test',
      source: 'Test',
      context: {}
    })

    const parsed = JSON.parse(capturedOutput!) as LogEntry
    expect(parsed.context).toEqual({})
  })

  it('handles special characters in error message', () => {
    const specialChars = 'Error with "quotes" and \\backslashes\\ and unicode: \u0000\u001f'
    const error = new Error(specialChars)

    expect(() => {
      logBestEffortError(error, {
        operation: 'test',
        source: 'Test'
      })
    }).not.toThrow()

    // Should still be valid JSON
    expect(() => JSON.parse(capturedOutput!)).not.toThrow()
  })
})
