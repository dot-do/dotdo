/**
 * ErrorHandler Pattern Tests
 *
 * Tests for the safe catch handler pattern that replaces unsafe patterns like:
 * - `error as { code?: string }` without validation
 * - `error instanceof Error ? error.message : String(error)`
 * - Silent catch handlers returning null
 * - All errors returning HTTP 400 (should be 400 vs 500)
 *
 * The ErrorHandler utility provides:
 * - wrap(): Safely wraps unknown errors as BashxError
 * - toHttpError(): Converts errors to HTTP-appropriate format with correct status
 * - getCode(): Safely extracts error code
 * - isClientError(): Determines if error is client-side (400) vs server-side (500)
 */

import { describe, it, expect } from 'vitest'
import {
  BashxError,
  TierExecutionError,
  CommandNotFoundError,
  BashxTimeoutError,
  BashxRateLimitError,
  ParseError,
  SafetyBlockedError,
  fromError,
  getErrorMessage,
  isBashxError,
} from '../../src/errors/bashx-error.js'
import {
  ErrorHandler,
  type HttpErrorResponse,
} from '../../src/errors/error-handler.js'

// ============================================================================
// ErrorHandler.wrap() Tests
// ============================================================================

describe('ErrorHandler.wrap()', () => {
  describe('BashxError preservation', () => {
    it('should return BashxError instances unchanged', () => {
      const original = new BashxError('Original error', { code: 'TEST_ERROR' })
      const wrapped = ErrorHandler.wrap(original)

      expect(wrapped).toBe(original)
      expect(wrapped.code).toBe('TEST_ERROR')
    })

    it('should return TierExecutionError unchanged', () => {
      const original = new TierExecutionError('Tier 1 failed', {
        tier: 1,
        command: 'ls -la',
        exitCode: 1,
      })
      const wrapped = ErrorHandler.wrap(original)

      expect(wrapped).toBe(original)
      expect(wrapped).toBeInstanceOf(TierExecutionError)
    })

    it('should return CommandNotFoundError unchanged', () => {
      const original = new CommandNotFoundError('unknown-cmd')
      const wrapped = ErrorHandler.wrap(original)

      expect(wrapped).toBe(original)
      expect(wrapped).toBeInstanceOf(CommandNotFoundError)
    })

    it('should return ParseError unchanged', () => {
      const original = new ParseError('Syntax error', {
        input: 'echo "unclosed',
        line: 1,
        column: 6,
      })
      const wrapped = ErrorHandler.wrap(original)

      expect(wrapped).toBe(original)
      expect(wrapped).toBeInstanceOf(ParseError)
    })

    it('should return SafetyBlockedError unchanged', () => {
      const original = new SafetyBlockedError('Blocked', {
        command: 'rm -rf /',
        reason: 'dangerous',
        impact: 'critical',
      })
      const wrapped = ErrorHandler.wrap(original)

      expect(wrapped).toBe(original)
      expect(wrapped).toBeInstanceOf(SafetyBlockedError)
    })
  })

  describe('Unknown error wrapping via fromError()', () => {
    it('should wrap plain Error via fromError()', () => {
      const original = new Error('Plain error')
      const wrapped = ErrorHandler.wrap(original)

      expect(wrapped).toBeInstanceOf(BashxError)
      expect(wrapped.message).toBe('Plain error')
      expect(wrapped.code).toBe('UNKNOWN_ERROR')
      expect(wrapped.cause).toBe(original)
    })

    it('should wrap string errors', () => {
      const wrapped = ErrorHandler.wrap('String error')

      expect(wrapped).toBeInstanceOf(BashxError)
      expect(wrapped.message).toBe('String error')
      expect(wrapped.code).toBe('UNKNOWN_ERROR')
    })

    it('should wrap null/undefined gracefully', () => {
      const wrappedNull = ErrorHandler.wrap(null)
      const wrappedUndefined = ErrorHandler.wrap(undefined)

      expect(wrappedNull).toBeInstanceOf(BashxError)
      expect(wrappedNull.message).toBe('Unknown error occurred')

      expect(wrappedUndefined).toBeInstanceOf(BashxError)
      expect(wrappedUndefined.message).toBe('Unknown error occurred')
    })

    it('should add context when wrapping', () => {
      const wrapped = ErrorHandler.wrap(new Error('Test'), {
        command: 'test-cmd',
        tier: 1,
      })

      expect(wrapped.context.command).toBe('test-cmd')
      expect(wrapped.context.tier).toBe(1)
    })
  })
})

// ============================================================================
// ErrorHandler.toHttpError() Tests
// ============================================================================

describe('ErrorHandler.toHttpError()', () => {
  describe('HTTP status code determination', () => {
    it('should return 400 for client errors (ParseError)', () => {
      const error = new ParseError('Invalid syntax', {
        input: 'bad',
        line: 1,
        column: 1,
      })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.status).toBe(400)
      expect(httpError.code).toBe('PARSE_ERROR')
    })

    it('should return 400 for client errors (CommandNotFoundError)', () => {
      const error = new CommandNotFoundError('invalid-cmd')
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.status).toBe(400)
      expect(httpError.code).toBe('COMMAND_NOT_FOUND')
    })

    it('should return 400 for client errors (SafetyBlockedError)', () => {
      const error = new SafetyBlockedError('Blocked', {
        command: 'rm -rf /',
        reason: 'dangerous',
        impact: 'critical',
      })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.status).toBe(400)
      expect(httpError.code).toBe('SAFETY_BLOCKED')
    })

    it('should return 429 for rate limit errors', () => {
      const error = new BashxRateLimitError('Rate limited', {
        limit: 100,
        remaining: 0,
        resetAt: new Date(),
      })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.status).toBe(429)
      expect(httpError.code).toBe('RATE_LIMIT_ERROR')
    })

    it('should return 500 for server errors (TierExecutionError)', () => {
      const error = new TierExecutionError('Execution failed', {
        tier: 1,
        command: 'ls',
        exitCode: 1,
      })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.status).toBe(500)
      expect(httpError.code).toBe('TIER_EXECUTION_ERROR')
    })

    it('should return 500 for unknown errors', () => {
      const error = fromError(new Error('Unknown'))
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.status).toBe(500)
      expect(httpError.code).toBe('UNKNOWN_ERROR')
    })

    it('should return 504 for timeout errors', () => {
      const error = new BashxTimeoutError('Timeout', {
        timeoutMs: 5000,
        operation: 'test',
      })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.status).toBe(504)
      expect(httpError.code).toBe('TIMEOUT_ERROR')
    })

    it('should return 502 for network errors', () => {
      const error = new BashxError('Network failed', {
        code: 'NETWORK_ERROR',
      })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.status).toBe(502)
      expect(httpError.code).toBe('NETWORK_ERROR')
    })

    it('should return 503 for circuit open errors', () => {
      const error = new BashxError('Circuit breaker open', {
        code: 'CIRCUIT_OPEN',
      })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.status).toBe(503)
      expect(httpError.code).toBe('CIRCUIT_OPEN')
    })

    it('should return 502 for RPC errors', () => {
      const error = new BashxError('RPC failed', {
        code: 'RPC_ERROR',
      })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.status).toBe(502)
      expect(httpError.code).toBe('RPC_ERROR')
    })
  })

  describe('HTTP error response format', () => {
    it('should include error flag', () => {
      const error = new BashxError('Test', { code: 'TEST' })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.error).toBe(true)
    })

    it('should include message', () => {
      const error = new BashxError('Test message', { code: 'TEST' })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.message).toBe('Test message')
    })

    it('should include code', () => {
      const error = new BashxError('Test', { code: 'EXECUTION_ERROR' })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.code).toBe('EXECUTION_ERROR')
    })

    it('should include hint when available', () => {
      const error = new BashxError('Test', {
        code: 'TEST',
        hint: 'Try this instead',
      })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.hint).toBe('Try this instead')
    })

    it('should not include hint when not available', () => {
      const error = new BashxError('Test', { code: 'TEST' })
      const httpError = ErrorHandler.toHttpError(error)

      expect(httpError.hint).toBeUndefined()
    })
  })

  describe('Unknown error handling', () => {
    it('should wrap unknown errors before converting', () => {
      const httpError = ErrorHandler.toHttpError(new Error('Plain error'))

      expect(httpError.error).toBe(true)
      expect(httpError.message).toBe('Plain error')
      expect(httpError.code).toBe('UNKNOWN_ERROR')
      expect(httpError.status).toBe(500)
    })

    it('should handle string errors', () => {
      const httpError = ErrorHandler.toHttpError('String error')

      expect(httpError.error).toBe(true)
      expect(httpError.message).toBe('String error')
      expect(httpError.status).toBe(500)
    })
  })
})

// ============================================================================
// ErrorHandler.getCode() Tests
// ============================================================================

describe('ErrorHandler.getCode()', () => {
  it('should return code from BashxError', () => {
    const error = new BashxError('Test', { code: 'EXECUTION_ERROR' })
    expect(ErrorHandler.getCode(error)).toBe('EXECUTION_ERROR')
  })

  it('should return code from subclasses', () => {
    expect(ErrorHandler.getCode(new TierExecutionError('Test', { tier: 1, command: 'ls' }))).toBe('TIER_EXECUTION_ERROR')
    expect(ErrorHandler.getCode(new CommandNotFoundError('cmd'))).toBe('COMMAND_NOT_FOUND')
    expect(ErrorHandler.getCode(new ParseError('Error', { input: 'x', line: 1, column: 1 }))).toBe('PARSE_ERROR')
  })

  it('should return UNKNOWN_ERROR for plain Error', () => {
    expect(ErrorHandler.getCode(new Error('Test'))).toBe('UNKNOWN_ERROR')
  })

  it('should return UNKNOWN_ERROR for non-error values', () => {
    expect(ErrorHandler.getCode('string')).toBe('UNKNOWN_ERROR')
    expect(ErrorHandler.getCode(null)).toBe('UNKNOWN_ERROR')
    expect(ErrorHandler.getCode(undefined)).toBe('UNKNOWN_ERROR')
    expect(ErrorHandler.getCode(42)).toBe('UNKNOWN_ERROR')
  })

  it('should extract code from error-like objects', () => {
    const errorLike = { code: 'CUSTOM_ERROR', message: 'Custom' }
    expect(ErrorHandler.getCode(errorLike)).toBe('CUSTOM_ERROR')
  })

  it('should extract code from Node.js system errors', () => {
    const nodeError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    expect(ErrorHandler.getCode(nodeError)).toBe('ENOENT')
  })
})

// ============================================================================
// ErrorHandler.isClientError() Tests
// ============================================================================

describe('ErrorHandler.isClientError()', () => {
  it('should return true for ParseError', () => {
    const error = new ParseError('Bad input', { input: 'x', line: 1, column: 1 })
    expect(ErrorHandler.isClientError(error)).toBe(true)
  })

  it('should return true for CommandNotFoundError', () => {
    const error = new CommandNotFoundError('bad-cmd')
    expect(ErrorHandler.isClientError(error)).toBe(true)
  })

  it('should return true for SafetyBlockedError', () => {
    const error = new SafetyBlockedError('Blocked', {
      command: 'rm -rf /',
      reason: 'dangerous',
      impact: 'critical',
    })
    expect(ErrorHandler.isClientError(error)).toBe(true)
  })

  it('should return false for TierExecutionError', () => {
    const error = new TierExecutionError('Failed', { tier: 1, command: 'ls' })
    expect(ErrorHandler.isClientError(error)).toBe(false)
  })

  it('should return false for BashxTimeoutError', () => {
    const error = new BashxTimeoutError('Timeout', { timeoutMs: 5000, operation: 'test' })
    expect(ErrorHandler.isClientError(error)).toBe(false)
  })

  it('should return false for BashxRateLimitError', () => {
    const error = new BashxRateLimitError('Rate limited', {
      limit: 100,
      remaining: 0,
      resetAt: new Date(),
    })
    expect(ErrorHandler.isClientError(error)).toBe(false)
  })

  it('should return false for unknown errors', () => {
    const error = new Error('Unknown')
    expect(ErrorHandler.isClientError(error)).toBe(false)
  })
})

// ============================================================================
// ErrorHandler.getMessage() Tests
// ============================================================================

describe('ErrorHandler.getMessage()', () => {
  it('should extract message from BashxError', () => {
    const error = new BashxError('Test message', { code: 'TEST' })
    expect(ErrorHandler.getMessage(error)).toBe('Test message')
  })

  it('should extract message from plain Error', () => {
    const error = new Error('Plain message')
    expect(ErrorHandler.getMessage(error)).toBe('Plain message')
  })

  it('should handle string errors', () => {
    expect(ErrorHandler.getMessage('String error')).toBe('String error')
  })

  it('should handle null/undefined', () => {
    expect(ErrorHandler.getMessage(null)).toBe('Unknown error occurred')
    expect(ErrorHandler.getMessage(undefined)).toBe('Unknown error occurred')
  })

  it('should be equivalent to getErrorMessage()', () => {
    // ErrorHandler.getMessage is an alias for getErrorMessage
    const inputs = [
      new Error('Test'),
      'string',
      42,
      null,
      undefined,
      { message: 'obj' },
    ]

    for (const input of inputs) {
      expect(ErrorHandler.getMessage(input)).toBe(getErrorMessage(input))
    }
  })
})

// ============================================================================
// Error Context Preservation Tests
// ============================================================================

describe('Error context preservation', () => {
  it('should preserve context through wrap()', () => {
    const error = new TierExecutionError('Failed', {
      tier: 2,
      command: 'python script.py',
      exitCode: 1,
      stderr: 'ImportError',
    })

    const wrapped = ErrorHandler.wrap(error)

    expect(wrapped.context.tier).toBe(2)
    expect(wrapped.context.command).toBe('python script.py')
  })

  it('should add context when wrapping plain errors', () => {
    const wrapped = ErrorHandler.wrap(new Error('Test'), {
      command: 'curl example.com',
      tier: 1,
    })

    expect(wrapped.context.command).toBe('curl example.com')
    expect(wrapped.context.tier).toBe(1)
  })

  it('should preserve timestamp in context', () => {
    const error = new BashxError('Test', {
      code: 'TEST',
      context: { timestamp: new Date('2024-01-01') },
    })

    const httpError = ErrorHandler.toHttpError(error)
    expect(httpError).toBeDefined()

    // The original error's timestamp should be preserved
    expect(error.context.timestamp).toEqual(new Date('2024-01-01'))
  })
})

// ============================================================================
// Integration Pattern Tests
// ============================================================================

describe('Safe catch handler pattern', () => {
  it('should replace unsafe `error as { code?: string }` pattern', () => {
    // UNSAFE OLD PATTERN:
    // catch (error: unknown) {
    //   const err = error as { code?: string; message?: string }
    //   return { code: err.code || 'UNKNOWN', message: err.message || 'Unknown' }
    // }

    // SAFE NEW PATTERN:
    const safeHandler = (error: unknown) => {
      const wrapped = ErrorHandler.wrap(error)
      return { code: wrapped.code, message: wrapped.message }
    }

    // Test with various error types
    const bashxError = new BashxError('Test', { code: 'TEST_CODE' })
    expect(safeHandler(bashxError)).toEqual({ code: 'TEST_CODE', message: 'Test' })

    const plainError = new Error('Plain')
    expect(safeHandler(plainError)).toEqual({ code: 'UNKNOWN_ERROR', message: 'Plain' })

    // The new pattern correctly handles null/undefined/strings
    expect(safeHandler(null).message).toBe('Unknown error occurred')
    expect(safeHandler('string error').message).toBe('string error')
  })

  it('should replace unsafe silent catch returning null', () => {
    // UNSAFE OLD PATTERN:
    // catch (error) {
    //   return null  // Silent failure!
    // }

    // SAFE NEW PATTERN (with logging):
    let loggedError: BashxError | null = null
    const safeHandler = (error: unknown): { success: false; error: BashxError } => {
      const wrapped = ErrorHandler.wrap(error)
      loggedError = wrapped // Log it
      return { success: false, error: wrapped }
    }

    const result = safeHandler(new Error('Test'))
    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(BashxError)
    expect(loggedError).not.toBeNull()
  })

  it('should provide correct HTTP status codes', () => {
    // UNSAFE OLD PATTERN:
    // catch (error: unknown) {
    //   return c.json({ error: true, message: err.message }, 400)  // Always 400!
    // }

    // SAFE NEW PATTERN:
    const safeHttpHandler = (error: unknown) => {
      const httpError = ErrorHandler.toHttpError(error)
      return { body: httpError, status: httpError.status }
    }

    // Client error (400)
    const parseError = new ParseError('Bad syntax', { input: 'x', line: 1, column: 1 })
    expect(safeHttpHandler(parseError).status).toBe(400)

    // Server error (500)
    const tierError = new TierExecutionError('Failed', { tier: 1, command: 'ls' })
    expect(safeHttpHandler(tierError).status).toBe(500)

    // Rate limit (429)
    const rateError = new BashxRateLimitError('Limited', { limit: 100, remaining: 0 })
    expect(safeHttpHandler(rateError).status).toBe(429)

    // Timeout (504)
    const timeoutError = new BashxTimeoutError('Timeout', { timeoutMs: 5000, operation: 'test' })
    expect(safeHttpHandler(timeoutError).status).toBe(504)
  })
})

// ============================================================================
// Worker.ts Catch Handler Patterns
// ============================================================================

describe('Worker catch handler patterns', () => {
  it('should handle RPC endpoint errors correctly', () => {
    // Simulating the worker.ts /rpc endpoint pattern
    const handleRpcError = (error: unknown): { body: HttpErrorResponse; status: number } => {
      const httpError = ErrorHandler.toHttpError(error)
      return { body: httpError, status: httpError.status }
    }

    // Parse error from invalid input
    const parseError = new ParseError('Invalid', { input: 'bad', line: 1, column: 1 })
    const result1 = handleRpcError(parseError)
    expect(result1.status).toBe(400)
    expect(result1.body.code).toBe('PARSE_ERROR')

    // Execution error
    const execError = new TierExecutionError('Failed', { tier: 1, command: 'ls' })
    const result2 = handleRpcError(execError)
    expect(result2.status).toBe(500)
    expect(result2.body.code).toBe('TIER_EXECUTION_ERROR')
  })

  it('should handle /exec endpoint errors correctly', () => {
    const handleExecError = (error: unknown) => ErrorHandler.toHttpError(error)

    // Command not found
    const cmdError = new CommandNotFoundError('invalid')
    expect(handleExecError(cmdError).status).toBe(400)

    // Execution failure
    const execError = new TierExecutionError('Failed', { tier: 2, command: 'python' })
    expect(handleExecError(execError).status).toBe(500)
  })

  it('should handle /analyze endpoint errors correctly', () => {
    const handleAnalyzeError = (error: unknown) => ErrorHandler.toHttpError(error)

    // Analysis errors are client errors (bad input)
    const parseError = new ParseError('Cannot parse', { input: 'x', line: 1, column: 1 })
    expect(handleAnalyzeError(parseError).status).toBe(400)
  })
})

// ============================================================================
// TieredExecutor Catch Handler Patterns
// ============================================================================

describe('TieredExecutor catch handler patterns', () => {
  it('should handle native execution errors', () => {
    // Pattern: catch (error) { ... return createResult(cmd, '', message, 1, 1) }
    const handleNativeError = (error: unknown, command: string) => {
      const wrapped = ErrorHandler.wrap(error, { command, tier: 1 })
      return {
        command,
        stdout: '',
        stderr: wrapped.message,
        exitCode: 1,
        tier: 1,
        error: wrapped,
      }
    }

    const result = handleNativeError(new Error('ENOENT'), 'cat /missing')
    expect(result.stderr).toBe('ENOENT')
    expect(result.error.context.command).toBe('cat /missing')
    expect(result.error.context.tier).toBe(1)
  })

  it('should handle RPC tier errors', () => {
    const handleRpcTierError = (error: unknown, command: string) => {
      const wrapped = ErrorHandler.wrap(error, { command, tier: 2 })
      return wrapped
    }

    const result = handleRpcTierError(new Error('Network timeout'), 'git status')
    expect(result.context.command).toBe('git status')
    expect(result.context.tier).toBe(2)
  })

  it('should handle fallback scenarios', () => {
    // When tier fails, error should include which tier failed
    const handleTierFallback = (error: unknown, tier: 1 | 2 | 3, command: string) => {
      return ErrorHandler.wrap(error, { tier, command, fallbackAttempted: true })
    }

    const result = handleTierFallback(new Error('Tier 2 failed'), 2, 'python script.py')
    expect(result.context.tier).toBe(2)
    expect(result.context.fallbackAttempted).toBe(true)
  })
})

// ============================================================================
// Index.ts Catch Handler Patterns (Native Ops)
// ============================================================================

describe('Index.ts native op catch handler patterns', () => {
  it('should handle native cat errors', () => {
    const handleNativeCatError = (error: unknown, args: string[]) => {
      return {
        command: `cat ${args.join(' ')}`,
        stdout: '',
        stderr: ErrorHandler.getMessage(error),
        exitCode: 1,
      }
    }

    const result = handleNativeCatError(new Error('ENOENT: no such file'), ['missing.txt'])
    expect(result.stderr).toBe('ENOENT: no such file')
  })

  it('should handle native ls errors', () => {
    const handleNativeLsError = (error: unknown, args: string[]) => {
      return {
        command: `ls ${args.join(' ')}`,
        stdout: '',
        stderr: ErrorHandler.getMessage(error),
        exitCode: 1,
      }
    }

    const result = handleNativeLsError(new Error('EACCES: permission denied'), ['/root'])
    expect(result.stderr).toBe('EACCES: permission denied')
  })

  it('should not silently swallow errors in tryNativeExec', () => {
    // The silent catch returning null pattern should log the error
    let logged = false
    const handleTryNativeError = (error: unknown): null => {
      const wrapped = ErrorHandler.wrap(error)
      logged = true
      console.warn(`Native execution failed, falling back: ${wrapped.message}`)
      return null
    }

    const result = handleTryNativeError(new Error('Not supported'))
    expect(result).toBe(null)
    expect(logged).toBe(true)
  })
})
