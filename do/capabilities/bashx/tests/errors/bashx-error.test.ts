/**
 * BashxError Hierarchy Tests
 *
 * Tests for the unified error handling system in bashx.
 * Follows TDD: these tests define the expected behavior before implementation.
 *
 * Error Hierarchy:
 * - BashxError (base class)
 *   - TierExecutionError (tier-specific failures)
 *   - CommandNotFoundError (command not found in any tier)
 *   - BashxTimeoutError (operation timeout, consolidated with existing)
 *   - RateLimitError (consolidated from src/rpc and src/remote)
 *   - ParseError (AST parsing failures)
 *   - SafetyBlockedError (safety gate blocked execution)
 *
 * Each error type includes:
 * - code: string identifier for programmatic handling
 * - context: structured metadata about the error
 * - retryable: whether the operation can be retried
 * - hint: recovery suggestion
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
  isBashxError,
  getErrorMessage,
  isRetryableError,
  type ErrorCode,
  type ErrorContext,
} from '../../src/errors/bashx-error.js'

// ============================================================================
// BashxError Base Class Tests
// ============================================================================

describe('BashxError Base Class', () => {
  describe('Basic construction', () => {
    it('should create an error with message and code', () => {
      const error = new BashxError('Something went wrong', {
        code: 'EXECUTION_ERROR',
      })

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(BashxError)
      expect(error.message).toBe('Something went wrong')
      expect(error.code).toBe('EXECUTION_ERROR')
      expect(error.name).toBe('BashxError')
    })

    it('should have default values for optional properties', () => {
      const error = new BashxError('Error', { code: 'TEST_ERROR' })

      expect(error.retryable).toBe(false)
      expect(error.hint).toBeUndefined()
      // Context always gets a timestamp added automatically
      expect(error.context.timestamp).toBeInstanceOf(Date)
    })

    it('should accept optional hint and retryable flag', () => {
      const error = new BashxError('Temporary failure', {
        code: 'TEMP_ERROR',
        retryable: true,
        hint: 'Try again in a few seconds',
      })

      expect(error.retryable).toBe(true)
      expect(error.hint).toBe('Try again in a few seconds')
    })

    it('should accept context object with structured metadata', () => {
      const error = new BashxError('Command failed', {
        code: 'EXECUTION_ERROR',
        context: {
          command: 'ls -la',
          tier: 1,
          timestamp: new Date('2024-01-15T10:30:00Z'),
        },
      })

      expect(error.context).toEqual({
        command: 'ls -la',
        tier: 1,
        timestamp: new Date('2024-01-15T10:30:00Z'),
      })
    })

    it('should support Error cause for wrapping other errors', () => {
      const originalError = new Error('Network timeout')
      const error = new BashxError('Operation failed', {
        code: 'WRAPPED_ERROR',
        cause: originalError,
      })

      expect(error.cause).toBe(originalError)
    })
  })

  describe('Error serialization', () => {
    it('should serialize to a plain object', () => {
      const error = new BashxError('Test error', {
        code: 'TEST_ERROR',
        retryable: true,
        hint: 'Try again',
        context: { command: 'echo hello', tier: 1 },
      })

      const serialized = error.toJSON()

      expect(serialized).toEqual({
        name: 'BashxError',
        message: 'Test error',
        code: 'TEST_ERROR',
        retryable: true,
        hint: 'Try again',
        context: { command: 'echo hello', tier: 1, timestamp: expect.any(Date) },
        stack: expect.any(String),
      })
    })

    it('should serialize cause if present', () => {
      const cause = new Error('Original error')
      const error = new BashxError('Wrapped', {
        code: 'WRAPPED_ERROR',
        cause,
      })

      const serialized = error.toJSON()

      expect(serialized.cause).toEqual({
        name: 'Error',
        message: 'Original error',
        stack: expect.any(String),
      })
    })

    it('should deserialize from a plain object', () => {
      const data = {
        name: 'BashxError',
        message: 'Deserialized error',
        code: 'DESER_ERROR' as const,
        retryable: true,
        hint: 'Recovered from serialized data',
        context: { tier: 2 },
      }

      const error = BashxError.fromJSON(data)

      expect(error).toBeInstanceOf(BashxError)
      expect(error.message).toBe('Deserialized error')
      expect(error.code).toBe('DESER_ERROR')
      expect(error.retryable).toBe(true)
      expect(error.hint).toBe('Recovered from serialized data')
      // Context gets a timestamp added on deserialization
      expect(error.context.tier).toBe(2)
      expect(error.context.timestamp).toBeInstanceOf(Date)
    })
  })

  describe('Type guard', () => {
    it('should identify BashxError instances', () => {
      const bashxError = new BashxError('Test', { code: 'TEST' })

      expect(isBashxError(bashxError)).toBe(true)
    })

    it('should reject plain Error instances', () => {
      const plainError = new Error('Not a BashxError')

      expect(isBashxError(plainError)).toBe(false)
    })

    it('should reject non-Error values', () => {
      expect(isBashxError(null)).toBe(false)
      expect(isBashxError(undefined)).toBe(false)
      expect(isBashxError('error string')).toBe(false)
      expect(isBashxError({ code: 'FAKE' })).toBe(false)
    })

    it('should identify subclasses of BashxError', () => {
      const tierError = new TierExecutionError('Tier failed', {
        tier: 1,
        command: 'ls',
      })

      expect(isBashxError(tierError)).toBe(true)
    })
  })
})

// ============================================================================
// TierExecutionError Tests
// ============================================================================

describe('TierExecutionError', () => {
  it('should create a tier execution error with tier info', () => {
    const error = new TierExecutionError('Tier 1 execution failed', {
      tier: 1,
      command: 'ls -la /nonexistent',
      exitCode: 2,
    })

    expect(error).toBeInstanceOf(BashxError)
    expect(error).toBeInstanceOf(TierExecutionError)
    expect(error.name).toBe('TierExecutionError')
    expect(error.code).toBe('TIER_EXECUTION_ERROR')
    expect(error.tier).toBe(1)
    expect(error.command).toBe('ls -la /nonexistent')
    expect(error.exitCode).toBe(2)
  })

  it('should include tier in context', () => {
    const error = new TierExecutionError('Failed', {
      tier: 2,
      command: 'python script.py',
    })

    expect(error.context.tier).toBe(2)
    expect(error.context.command).toBe('python script.py')
  })

  it('should support all three tiers', () => {
    const tier1 = new TierExecutionError('Tier 1', { tier: 1, command: 'cat' })
    const tier2 = new TierExecutionError('Tier 2', { tier: 2, command: 'python' })
    const tier3 = new TierExecutionError('Tier 3', { tier: 3, command: 'bash.do' })

    expect(tier1.tier).toBe(1)
    expect(tier2.tier).toBe(2)
    expect(tier3.tier).toBe(3)
  })

  it('should provide helpful hint based on tier', () => {
    const tier1Error = new TierExecutionError('Native failed', {
      tier: 1,
      command: 'cat /file',
    })

    const tier3Error = new TierExecutionError('RPC failed', {
      tier: 3,
      command: 'complex command',
    })

    expect(tier1Error.hint).toContain('native')
    expect(tier3Error.hint).toContain('RPC')
  })

  it('should track stdout and stderr when available', () => {
    const error = new TierExecutionError('Command failed', {
      tier: 1,
      command: 'grep pattern file',
      exitCode: 1,
      stdout: '',
      stderr: 'grep: file: No such file or directory',
    })

    expect(error.stdout).toBe('')
    expect(error.stderr).toBe('grep: file: No such file or directory')
  })
})

// ============================================================================
// CommandNotFoundError Tests
// ============================================================================

describe('CommandNotFoundError', () => {
  it('should create command not found error', () => {
    const error = new CommandNotFoundError('nonexistent-command')

    expect(error).toBeInstanceOf(BashxError)
    expect(error).toBeInstanceOf(CommandNotFoundError)
    expect(error.name).toBe('CommandNotFoundError')
    expect(error.code).toBe('COMMAND_NOT_FOUND')
    expect(error.command).toBe('nonexistent-command')
    expect(error.message).toContain('nonexistent-command')
    expect(error.retryable).toBe(false)
  })

  it('should include searched tiers in context', () => {
    const error = new CommandNotFoundError('missing-cmd', {
      searchedTiers: [1, 2, 3],
    })

    expect(error.context.searchedTiers).toEqual([1, 2, 3])
  })

  it('should provide hint about available commands', () => {
    const error = new CommandNotFoundError('nde')

    expect(error.hint).toBeDefined()
    expect(typeof error.hint).toBe('string')
  })

  it('should suggest similar commands when available', () => {
    const error = new CommandNotFoundError('gti', {
      suggestions: ['git'],
    })

    expect(error.suggestions).toEqual(['git'])
    expect(error.hint).toContain('git')
  })
})

// ============================================================================
// BashxTimeoutError Tests (consolidate with existing TimeoutError)
// ============================================================================

describe('BashxTimeoutError', () => {
  it('should create timeout error with duration', () => {
    const error = new BashxTimeoutError('Command timed out', {
      timeoutMs: 30000,
      operation: 'ls -R /',
    })

    expect(error).toBeInstanceOf(BashxError)
    expect(error).toBeInstanceOf(BashxTimeoutError)
    expect(error.name).toBe('BashxTimeoutError')
    expect(error.code).toBe('TIMEOUT_ERROR')
    expect(error.timeoutMs).toBe(30000)
    expect(error.operation).toBe('ls -R /')
    expect(error.retryable).toBe(true)
  })

  it('should format timeout in human-readable form', () => {
    const error30s = new BashxTimeoutError('Timeout', {
      timeoutMs: 30000,
      operation: 'test',
    })

    const error5m = new BashxTimeoutError('Timeout', {
      timeoutMs: 300000,
      operation: 'test',
    })

    expect(error30s.formattedTimeout).toBe('30s')
    expect(error5m.formattedTimeout).toBe('5m')
  })

  it('should provide retry hint', () => {
    const error = new BashxTimeoutError('Timed out', {
      timeoutMs: 5000,
      operation: 'slow-command',
    })

    expect(error.hint).toContain('timeout')
  })

  it('should track elapsed time when available', () => {
    const error = new BashxTimeoutError('Timeout', {
      timeoutMs: 30000,
      operation: 'long-running',
      elapsedMs: 30050,
    })

    expect(error.elapsedMs).toBe(30050)
  })
})

// ============================================================================
// BashxRateLimitError Tests (consolidate RateLimitError from rpc and remote)
// ============================================================================

describe('BashxRateLimitError', () => {
  it('should create rate limit error with limit info', () => {
    const error = new BashxRateLimitError('Rate limit exceeded', {
      limit: 100,
      remaining: 0,
      resetAt: new Date('2024-01-15T11:00:00Z'),
    })

    expect(error).toBeInstanceOf(BashxError)
    expect(error).toBeInstanceOf(BashxRateLimitError)
    expect(error.name).toBe('BashxRateLimitError')
    expect(error.code).toBe('RATE_LIMIT_ERROR')
    expect(error.limit).toBe(100)
    expect(error.remaining).toBe(0)
    expect(error.resetAt).toEqual(new Date('2024-01-15T11:00:00Z'))
    expect(error.retryable).toBe(true)
  })

  it('should calculate wait time until reset', () => {
    const resetAt = new Date(Date.now() + 60000) // 1 minute from now
    const error = new BashxRateLimitError('Rate limited', {
      limit: 100,
      remaining: 0,
      resetAt,
    })

    const waitMs = error.getWaitMs()
    expect(waitMs).toBeGreaterThan(55000)
    expect(waitMs).toBeLessThanOrEqual(60000)
  })

  it('should return 0 for wait time if already reset', () => {
    const resetAt = new Date(Date.now() - 1000) // 1 second ago
    const error = new BashxRateLimitError('Rate limited', {
      limit: 100,
      remaining: 0,
      resetAt,
    })

    expect(error.getWaitMs()).toBe(0)
  })

  it('should format wait time in hint', () => {
    const resetAt = new Date(Date.now() + 120000) // 2 minutes from now
    const error = new BashxRateLimitError('Rate limited', {
      limit: 100,
      remaining: 0,
      resetAt,
    })

    expect(error.hint).toContain('2')
    expect(error.hint).toContain('minute')
  })

  it('should track provider when available (for remote git operations)', () => {
    const error = new BashxRateLimitError('GitHub rate limit', {
      limit: 60,
      remaining: 0,
      resetAt: new Date(Date.now() + 3600000),
      provider: 'github',
    })

    expect(error.provider).toBe('github')
  })

  it('should support RPC rate limit stats (from src/rpc)', () => {
    const error = new BashxRateLimitError('RPC rate limit', {
      limit: 1000,
      remaining: 0,
      windowStart: Date.now() - 500,
      totalRequests: 1000,
      totalRejected: 5,
    })

    expect(error.windowStart).toBeDefined()
    expect(error.totalRequests).toBe(1000)
    expect(error.totalRejected).toBe(5)
  })
})

// ============================================================================
// ParseError Tests
// ============================================================================

describe('ParseError', () => {
  it('should create parse error with location info', () => {
    const error = new ParseError('Unexpected token', {
      input: 'echo "unclosed',
      line: 1,
      column: 6,
    })

    expect(error).toBeInstanceOf(BashxError)
    expect(error).toBeInstanceOf(ParseError)
    expect(error.name).toBe('ParseError')
    expect(error.code).toBe('PARSE_ERROR')
    expect(error.input).toBe('echo "unclosed')
    expect(error.line).toBe(1)
    expect(error.column).toBe(6)
    expect(error.retryable).toBe(false)
  })

  it('should include the problematic token when available', () => {
    const error = new ParseError('Unexpected token', {
      input: 'ls &&& cat',
      line: 1,
      column: 4,
      token: '&',
    })

    expect(error.token).toBe('&')
  })

  it('should provide hint with syntax suggestion', () => {
    const error = new ParseError('Unclosed quote', {
      input: 'echo "hello',
      line: 1,
      column: 6,
      token: '"', // Provide the token to get the quote-specific hint
    })

    expect(error.hint).toBeDefined()
    expect(error.hint).toContain('quote')
  })

  it('should format error position nicely', () => {
    const error = new ParseError('Syntax error', {
      input: 'if then fi',
      line: 1,
      column: 4,
    })

    expect(error.formattedLocation).toBe('line 1, column 4')
  })
})

// ============================================================================
// SafetyBlockedError Tests
// ============================================================================

describe('SafetyBlockedError', () => {
  it('should create safety blocked error', () => {
    const error = new SafetyBlockedError('Command blocked for safety', {
      command: 'rm -rf /',
      reason: 'destructive operation on root directory',
      impact: 'critical',
    })

    expect(error).toBeInstanceOf(BashxError)
    expect(error).toBeInstanceOf(SafetyBlockedError)
    expect(error.name).toBe('SafetyBlockedError')
    expect(error.code).toBe('SAFETY_BLOCKED')
    expect(error.command).toBe('rm -rf /')
    expect(error.reason).toBe('destructive operation on root directory')
    expect(error.impact).toBe('critical')
    expect(error.retryable).toBe(false)
  })

  it('should track the safety classification', () => {
    const error = new SafetyBlockedError('Blocked', {
      command: 'chmod 777 /etc/passwd',
      reason: 'permission change on system file',
      impact: 'high',
      classification: {
        type: 'permission_change',
        impact: 'high',
        reversible: false,
      },
    })

    expect(error.classification).toEqual({
      type: 'permission_change',
      impact: 'high',
      reversible: false,
    })
  })

  it('should provide hint about using confirm flag', () => {
    const error = new SafetyBlockedError('Operation blocked', {
      command: 'rm -rf ./node_modules',
      reason: 'recursive deletion',
      impact: 'high',
    })

    expect(error.hint).toContain('confirm')
  })

  it('should suggest safer alternative when available', () => {
    const error = new SafetyBlockedError('Blocked', {
      command: 'rm -rf *',
      reason: 'glob deletion',
      impact: 'high',
      saferAlternative: 'rm -i *',
    })

    expect(error.saferAlternative).toBe('rm -i *')
    expect(error.hint).toContain('rm -i *')
  })
})

// ============================================================================
// fromError Factory Tests
// ============================================================================

describe('fromError factory', () => {
  it('should return BashxError instances unchanged', () => {
    const original = new BashxError('Original', { code: 'TEST' })
    const wrapped = fromError(original)

    expect(wrapped).toBe(original)
  })

  it('should wrap plain Error with context', () => {
    const original = new Error('Something went wrong')
    const wrapped = fromError(original, { command: 'test-command' })

    expect(wrapped).toBeInstanceOf(BashxError)
    expect(wrapped.message).toBe('Something went wrong')
    expect(wrapped.code).toBe('UNKNOWN_ERROR')
    expect(wrapped.cause).toBe(original)
    expect(wrapped.context.command).toBe('test-command')
  })

  it('should wrap string errors', () => {
    const wrapped = fromError('String error message')

    expect(wrapped).toBeInstanceOf(BashxError)
    expect(wrapped.message).toBe('String error message')
    expect(wrapped.code).toBe('UNKNOWN_ERROR')
  })

  it('should handle null/undefined gracefully', () => {
    const wrappedNull = fromError(null)
    const wrappedUndefined = fromError(undefined)

    expect(wrappedNull).toBeInstanceOf(BashxError)
    expect(wrappedNull.message).toBe('Unknown error occurred')

    expect(wrappedUndefined).toBeInstanceOf(BashxError)
    expect(wrappedUndefined.message).toBe('Unknown error occurred')
  })

  it('should preserve error stack when available', () => {
    const original = new Error('With stack')
    const wrapped = fromError(original)

    expect(wrapped.cause).toBe(original)
    expect((wrapped.cause as Error).stack).toBeDefined()
  })

  it('should handle objects with message property', () => {
    const errorLike = { message: 'Error-like object', code: 123 }
    const wrapped = fromError(errorLike)

    expect(wrapped).toBeInstanceOf(BashxError)
    expect(wrapped.message).toBe('Error-like object')
  })

  it('should handle thrown numbers and booleans', () => {
    const wrappedNumber = fromError(42)
    const wrappedBoolean = fromError(false)

    expect(wrappedNumber).toBeInstanceOf(BashxError)
    expect(wrappedNumber.message).toBe('42')

    expect(wrappedBoolean).toBeInstanceOf(BashxError)
    expect(wrappedBoolean.message).toBe('false')
  })

  it('should use provided code over default', () => {
    const original = new Error('Test')
    const wrapped = fromError(original, { code: 'SPECIFIC_ERROR' })

    expect(wrapped.code).toBe('SPECIFIC_ERROR')
  })
})

// ============================================================================
// Error Context Preservation Tests
// ============================================================================

describe('Error context preservation', () => {
  it('should preserve command through error chain', () => {
    const tier1Error = new TierExecutionError('Native failed', {
      tier: 1,
      command: 'ls -la',
      exitCode: 1,
    })

    const wrapped = fromError(tier1Error)

    expect(wrapped.context.command).toBe('ls -la')
    expect(wrapped.context.tier).toBe(1)
  })

  it('should add timestamp to context', () => {
    const error = new BashxError('Test', {
      code: 'TEST',
      context: { command: 'test' },
    })

    expect(error.context.timestamp).toBeInstanceOf(Date)
  })

  it('should merge context when wrapping', () => {
    const original = new Error('Original')
    const wrapped = fromError(original, {
      command: 'test-cmd',
      tier: 2,
      extraInfo: 'additional',
    })

    expect(wrapped.context.command).toBe('test-cmd')
    expect(wrapped.context.tier).toBe(2)
    expect(wrapped.context.extraInfo).toBe('additional')
  })
})

// ============================================================================
// ErrorCode Type Tests
// ============================================================================

describe('ErrorCode types', () => {
  it('should have known error codes', () => {
    const codes: ErrorCode[] = [
      'EXECUTION_ERROR',
      'TIER_EXECUTION_ERROR',
      'COMMAND_NOT_FOUND',
      'TIMEOUT_ERROR',
      'RATE_LIMIT_ERROR',
      'PARSE_ERROR',
      'SAFETY_BLOCKED',
      'UNKNOWN_ERROR',
      'NETWORK_ERROR',
    ]

    // Just ensure these compile - the types should enforce valid codes
    expect(codes.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Integration Pattern Tests
// ============================================================================

describe('Error handling patterns', () => {
  it('should replace instanceof Error ? error.message : String(error) pattern', () => {
    // Old pattern (what we're replacing):
    const handleErrorOld = (error: unknown): string => {
      return error instanceof Error ? error.message : String(error)
    }

    // New pattern with fromError:
    const handleErrorNew = (error: unknown): string => {
      return fromError(error).message
    }

    // Both should produce the same result
    const error1 = new Error('Test error')
    expect(handleErrorNew(error1)).toBe(handleErrorOld(error1))

    const error2 = 'string error'
    expect(handleErrorNew(error2)).toBe(handleErrorOld(error2))

    const error3 = { toString: () => 'object error' }
    expect(handleErrorNew(error3)).toBe(handleErrorOld(error3))
  })

  it('should support discriminated union error handling', () => {
    const handleError = (error: BashxError): string => {
      switch (error.code) {
        case 'TIER_EXECUTION_ERROR':
          return `Tier ${(error as TierExecutionError).tier} failed`
        case 'COMMAND_NOT_FOUND':
          return `Command not found: ${(error as CommandNotFoundError).command}`
        case 'TIMEOUT_ERROR':
          return `Timed out after ${(error as BashxTimeoutError).timeoutMs}ms`
        default:
          return error.message
      }
    }

    const tierError = new TierExecutionError('Failed', { tier: 1, command: 'ls' })
    expect(handleError(tierError)).toBe('Tier 1 failed')

    const cmdError = new CommandNotFoundError('missing')
    expect(handleError(cmdError)).toBe('Command not found: missing')
  })
})

// ============================================================================
// getErrorMessage Helper Tests
// ============================================================================

describe('getErrorMessage helper', () => {
  it('should extract message from Error', () => {
    const error = new Error('Test error message')
    expect(getErrorMessage(error)).toBe('Test error message')
  })

  it('should extract message from BashxError', () => {
    const error = new BashxError('Bashx error', { code: 'TEST' })
    expect(getErrorMessage(error)).toBe('Bashx error')
  })

  it('should handle string errors', () => {
    expect(getErrorMessage('string error')).toBe('string error')
  })

  it('should handle null', () => {
    expect(getErrorMessage(null)).toBe('Unknown error occurred')
  })

  it('should handle undefined', () => {
    expect(getErrorMessage(undefined)).toBe('Unknown error occurred')
  })

  it('should handle objects with message property', () => {
    const errorLike = { message: 'Error-like object message' }
    expect(getErrorMessage(errorLike)).toBe('Error-like object message')
  })

  it('should convert other types to string', () => {
    expect(getErrorMessage(42)).toBe('42')
    expect(getErrorMessage(true)).toBe('true')
    expect(getErrorMessage({ toString: () => 'custom object' })).toBe('custom object')
  })

  it('should be a drop-in replacement for the old pattern', () => {
    // Old pattern
    const old = (error: unknown): string =>
      error instanceof Error ? error.message : String(error)

    // Test various inputs that behave identically
    const inputs: unknown[] = [
      new Error('test'),
      'string',
      42,
    ]

    for (const input of inputs) {
      expect(getErrorMessage(input)).toBe(old(input))
    }

    // Note: getErrorMessage is BETTER than the old pattern because:
    // - It extracts .message from error-like objects (old pattern doesn't)
    // - It returns 'Unknown error occurred' for null/undefined (more descriptive)
    expect(getErrorMessage({ message: 'obj' })).toBe('obj') // Better than '[object Object]'
    expect(getErrorMessage(null)).toBe('Unknown error occurred') // Better than 'null'
  })
})

// ============================================================================
// isRetryableError Helper Tests
// ============================================================================

describe('isRetryableError helper', () => {
  it('should return true for BashxError with retryable=true', () => {
    const error = new BashxError('Retryable', {
      code: 'TEST',
      retryable: true,
    })
    expect(isRetryableError(error)).toBe(true)
  })

  it('should return false for BashxError with retryable=false', () => {
    const error = new BashxError('Not retryable', {
      code: 'TEST',
      retryable: false,
    })
    expect(isRetryableError(error)).toBe(false)
  })

  it('should return true for rate limit errors', () => {
    const error = new BashxRateLimitError('Rate limited', {
      limit: 100,
      remaining: 0,
      resetAt: new Date(),
    })
    expect(isRetryableError(error)).toBe(true)
  })

  it('should return true for timeout errors', () => {
    const error = new BashxTimeoutError('Timeout', {
      timeoutMs: 5000,
      operation: 'test',
    })
    expect(isRetryableError(error)).toBe(true)
  })

  it('should return true for network error codes', () => {
    const networkErrors = [
      { code: 'ECONNRESET' },
      { code: 'ETIMEDOUT' },
      { code: 'ECONNREFUSED' },
      { code: 'ENETUNREACH' },
      { code: 'EPIPE' },
      { code: 'EAI_AGAIN' },
    ]

    for (const error of networkErrors) {
      expect(isRetryableError(error)).toBe(true)
    }
  })

  it('should return false for non-retryable errors', () => {
    const error = new Error('Regular error')
    expect(isRetryableError(error)).toBe(false)
  })

  it('should return false for non-error values', () => {
    expect(isRetryableError(null)).toBe(false)
    expect(isRetryableError('string')).toBe(false)
    expect(isRetryableError(42)).toBe(false)
  })

  it('should return true for errors with RateLimitError name', () => {
    const error = new Error('Rate limit')
    error.name = 'RateLimitError'
    expect(isRetryableError(error)).toBe(true)
  })
})
