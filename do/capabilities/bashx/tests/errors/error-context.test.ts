/**
 * Error Context Preservation Tests
 *
 * Tests for ensuring all error paths include relevant context for debugging.
 * Following TDD: these tests define the expected behavior.
 *
 * Error context requirements:
 * - File errors include path
 * - Command errors include full command
 * - Network errors include URL and method
 * - Retry errors include attempt number
 * - Pipeline errors include stage index
 * - Tier errors include tier number
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest'
import {
  BashxError,
  TierExecutionError,
  BashxTimeoutError,
  BashxRateLimitError,
  ParseError,
  SafetyBlockedError,
  fromError,
  type ErrorContext,
} from '../../src/errors/bashx-error.js'
import {
  formatErrorContext,
  redactSensitiveContext,
  FileError,
  NetworkError,
  RetryError,
  PipelineError,
  type SensitiveFields,
} from '../../src/errors/error-context.js'

// ============================================================================
// FileError Tests - File operations include path
// ============================================================================

describe('FileError - file path context', () => {
  it('should include file path in context', () => {
    const error = new FileError('File not found', {
      path: '/path/to/file.txt',
      operation: 'read',
    })

    expect(error).toBeInstanceOf(BashxError)
    expect(error.context.path).toBe('/path/to/file.txt')
    expect(error.context.operation).toBe('read')
  })

  it('should include errno when available', () => {
    const error = new FileError('Permission denied', {
      path: '/etc/passwd',
      operation: 'write',
      errno: 'EACCES',
    })

    expect(error.context.errno).toBe('EACCES')
    expect(error.code).toBe('FILE_ERROR')
  })

  it('should format path in error message', () => {
    const error = new FileError('Cannot access file', {
      path: '/secret/data.json',
      operation: 'read',
    })

    expect(error.hint).toContain('/secret/data.json')
  })

  it('should not be retryable for ENOENT', () => {
    const error = new FileError('No such file', {
      path: '/missing.txt',
      operation: 'read',
      errno: 'ENOENT',
    })

    expect(error.retryable).toBe(false)
  })

  it('should be retryable for EAGAIN', () => {
    const error = new FileError('Resource temporarily unavailable', {
      path: '/busy/file.txt',
      operation: 'read',
      errno: 'EAGAIN',
    })

    expect(error.retryable).toBe(true)
  })
})

// ============================================================================
// NetworkError Tests - Network errors include URL and method
// ============================================================================

describe('NetworkError - URL and method context', () => {
  it('should include URL in context', () => {
    const error = new NetworkError('Connection refused', {
      url: 'https://api.example.com/data',
      method: 'GET',
    })

    expect(error).toBeInstanceOf(BashxError)
    expect(error.context.url).toBe('https://api.example.com/data')
    expect(error.context.method).toBe('GET')
  })

  it('should include status code when available', () => {
    const error = new NetworkError('Server error', {
      url: 'https://api.example.com/endpoint',
      method: 'POST',
      statusCode: 500,
    })

    expect(error.context.statusCode).toBe(500)
    expect(error.code).toBe('NETWORK_ERROR')
  })

  it('should include request body size for POST/PUT', () => {
    const error = new NetworkError('Request too large', {
      url: 'https://api.example.com/upload',
      method: 'POST',
      bodySize: 1024 * 1024 * 10, // 10MB
    })

    expect(error.context.bodySize).toBe(10485760)
  })

  it('should be retryable for connection errors', () => {
    const error = new NetworkError('Connection reset', {
      url: 'https://api.example.com/data',
      method: 'GET',
      errno: 'ECONNRESET',
    })

    expect(error.retryable).toBe(true)
  })

  it('should not be retryable for 4xx errors', () => {
    const error = new NetworkError('Not found', {
      url: 'https://api.example.com/missing',
      method: 'GET',
      statusCode: 404,
    })

    expect(error.retryable).toBe(false)
  })

  it('should be retryable for 5xx errors', () => {
    const error = new NetworkError('Internal server error', {
      url: 'https://api.example.com/endpoint',
      method: 'GET',
      statusCode: 503,
    })

    expect(error.retryable).toBe(true)
  })
})

// ============================================================================
// RetryError Tests - Retry errors include attempt number
// ============================================================================

describe('RetryError - attempt number context', () => {
  it('should include attempt number in context', () => {
    const error = new RetryError('Operation failed after retries', {
      attempt: 3,
      maxAttempts: 5,
      operation: 'fetch',
    })

    expect(error).toBeInstanceOf(BashxError)
    expect(error.context.attempt).toBe(3)
    expect(error.context.maxAttempts).toBe(5)
  })

  it('should include original error when wrapping', () => {
    const originalError = new Error('Network timeout')
    const error = new RetryError('Retry exhausted', {
      attempt: 3,
      maxAttempts: 3,
      operation: 'rpc-call',
      cause: originalError,
    })

    expect(error.cause).toBe(originalError)
    expect(error.code).toBe('RETRY_EXHAUSTED')
  })

  it('should include all attempt timestamps', () => {
    const attempts = [
      new Date('2024-01-15T10:00:00Z'),
      new Date('2024-01-15T10:00:01Z'),
      new Date('2024-01-15T10:00:03Z'),
    ]
    const error = new RetryError('All attempts failed', {
      attempt: 3,
      maxAttempts: 3,
      operation: 'upload',
      attemptTimestamps: attempts,
    })

    expect(error.context.attemptTimestamps).toEqual(attempts)
  })

  it('should provide useful hint about retry exhaustion', () => {
    const error = new RetryError('Max retries exceeded', {
      attempt: 5,
      maxAttempts: 5,
      operation: 'database-query',
    })

    expect(error.hint).toContain('5')
    expect(error.hint).toContain('attempt')
  })

  it('should not be retryable when max attempts reached', () => {
    const error = new RetryError('Exhausted', {
      attempt: 3,
      maxAttempts: 3,
      operation: 'fetch',
    })

    expect(error.retryable).toBe(false)
  })
})

// ============================================================================
// PipelineError Tests - Pipeline errors include stage index
// ============================================================================

describe('PipelineError - stage index context', () => {
  it('should include stage index in context', () => {
    const error = new PipelineError('Stage failed', {
      stageIndex: 2,
      stageCommand: 'grep pattern',
      pipeline: 'cat file | sort | grep pattern',
    })

    expect(error).toBeInstanceOf(BashxError)
    expect(error.context.stageIndex).toBe(2)
    expect(error.context.stageCommand).toBe('grep pattern')
  })

  it('should include previous stage output size', () => {
    const error = new PipelineError('Stage error', {
      stageIndex: 1,
      stageCommand: 'sort',
      pipeline: 'cat file | sort',
      previousOutputSize: 1024,
    })

    expect(error.context.previousOutputSize).toBe(1024)
    expect(error.code).toBe('PIPELINE_ERROR')
  })

  it('should include total stages count', () => {
    const error = new PipelineError('Pipeline failed at stage 2 of 5', {
      stageIndex: 2,
      stageCommand: 'awk',
      pipeline: 'cat | sort | awk | grep | wc',
      totalStages: 5,
    })

    expect(error.context.totalStages).toBe(5)
  })

  it('should indicate which stages completed', () => {
    const error = new PipelineError('Pipeline failed', {
      stageIndex: 2,
      stageCommand: 'failing-cmd',
      pipeline: 'a | b | failing-cmd | d',
      completedStages: ['a', 'b'],
    })

    expect(error.context.completedStages).toEqual(['a', 'b'])
  })

  it('should provide hint about pipeline debugging', () => {
    const error = new PipelineError('Grep failed', {
      stageIndex: 1,
      stageCommand: 'grep invalid-regex[',
      pipeline: 'cat file | grep invalid-regex[',
    })

    expect(error.hint).toContain('stage')
  })
})

// ============================================================================
// TierExecutionError - Tier context
// ============================================================================

describe('TierExecutionError - enhanced tier context', () => {
  it('should include full command in context', () => {
    const error = new TierExecutionError('Tier 1 failed', {
      tier: 1,
      command: 'cat /path/to/file.txt',
      exitCode: 1,
    })

    expect(error.context.command).toBe('cat /path/to/file.txt')
    expect(error.context.tier).toBe(1)
  })

  it('should include timing information', () => {
    const error = new TierExecutionError('Timeout', {
      tier: 2,
      command: 'long-running-command',
      context: {
        startTime: new Date('2024-01-15T10:00:00Z'),
        endTime: new Date('2024-01-15T10:00:30Z'),
        durationMs: 30000,
      },
    })

    expect(error.context.durationMs).toBe(30000)
  })

  it('should include tier-specific service name for tier 2', () => {
    const error = new TierExecutionError('RPC failed', {
      tier: 2,
      command: 'jq .foo',
      context: {
        serviceName: 'jq.do',
        serviceUrl: 'https://jq.do/execute',
      },
    })

    expect(error.context.serviceName).toBe('jq.do')
    expect(error.context.serviceUrl).toBe('https://jq.do/execute')
  })
})

// ============================================================================
// formatErrorContext - Context Formatting Utility
// ============================================================================

describe('formatErrorContext', () => {
  it('should format basic context as readable string', () => {
    const context: ErrorContext = {
      command: 'cat file.txt',
      tier: 1,
    }

    const formatted = formatErrorContext(context)

    expect(formatted).toContain('command')
    expect(formatted).toContain('cat file.txt')
    expect(formatted).toContain('tier')
    expect(formatted).toContain('1')
  })

  it('should format nested objects', () => {
    const context: ErrorContext = {
      request: {
        url: 'https://example.com',
        method: 'POST',
      },
    }

    const formatted = formatErrorContext(context)

    expect(formatted).toContain('url')
    expect(formatted).toContain('https://example.com')
  })

  it('should handle arrays', () => {
    const context: ErrorContext = {
      completedStages: ['stage1', 'stage2', 'stage3'],
    }

    const formatted = formatErrorContext(context)

    expect(formatted).toContain('stage1')
    expect(formatted).toContain('stage2')
  })

  it('should truncate long values', () => {
    const longString = 'x'.repeat(1000)
    const context: ErrorContext = {
      output: longString,
    }

    const formatted = formatErrorContext(context, { maxValueLength: 100 })

    expect(formatted.length).toBeLessThan(500)
    expect(formatted).toContain('...')
  })

  it('should format dates nicely', () => {
    const context: ErrorContext = {
      timestamp: new Date('2024-01-15T10:30:00Z'),
    }

    const formatted = formatErrorContext(context)

    expect(formatted).toMatch(/2024-01-15/)
  })

  it('should handle undefined and null values', () => {
    const context: ErrorContext = {
      defined: 'value',
      undefinedValue: undefined,
      nullValue: null,
    }

    const formatted = formatErrorContext(context)

    expect(formatted).toContain('defined')
    expect(formatted).toContain('value')
  })
})

// ============================================================================
// redactSensitiveContext - Sensitive Data Redaction
// ============================================================================

describe('redactSensitiveContext', () => {
  it('should redact authorization headers', () => {
    const context: ErrorContext = {
      url: 'https://api.example.com',
      headers: {
        Authorization: 'Bearer secret-token-12345',
        'Content-Type': 'application/json',
      },
    }

    const redacted = redactSensitiveContext(context)

    expect(redacted.url).toBe('https://api.example.com')
    expect((redacted.headers as Record<string, string>).Authorization).toBe('[REDACTED]')
    expect((redacted.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('should redact tokens in URLs', () => {
    const context: ErrorContext = {
      url: 'https://api.example.com?token=secret123&other=value',
    }

    const redacted = redactSensitiveContext(context)

    expect(redacted.url).toContain('token=[REDACTED]')
    expect(redacted.url).toContain('other=value')
  })

  it('should redact password fields', () => {
    const context: ErrorContext = {
      credentials: {
        username: 'user',
        password: 'supersecret',
      },
    }

    const redacted = redactSensitiveContext(context)

    expect((redacted.credentials as Record<string, string>).username).toBe('user')
    expect((redacted.credentials as Record<string, string>).password).toBe('[REDACTED]')
  })

  it('should redact API keys', () => {
    const context: ErrorContext = {
      apiKey: 'sk-1234567890abcdef',
      api_key: 'pk-0987654321fedcba',
    }

    const redacted = redactSensitiveContext(context)

    expect(redacted.apiKey).toBe('[REDACTED]')
    expect(redacted.api_key).toBe('[REDACTED]')
  })

  it('should redact bearer tokens in strings', () => {
    const context: ErrorContext = {
      rawRequest: 'Authorization: Bearer my-secret-token\nContent-Type: application/json',
    }

    const redacted = redactSensitiveContext(context)

    expect(redacted.rawRequest).toContain('Bearer [REDACTED]')
    expect(redacted.rawRequest).toContain('Content-Type: application/json')
  })

  it('should allow custom sensitive field names', () => {
    const context: ErrorContext = {
      customSecret: 'my-secret-value',
      normalField: 'public-data',
    }

    const sensitiveFields: SensitiveFields = ['customSecret']
    const redacted = redactSensitiveContext(context, sensitiveFields)

    expect(redacted.customSecret).toBe('[REDACTED]')
    expect(redacted.normalField).toBe('public-data')
  })

  it('should recursively redact nested objects', () => {
    const context: ErrorContext = {
      nested: {
        deep: {
          password: 'nested-secret',
        },
      },
    }

    const redacted = redactSensitiveContext(context)

    expect(
      ((redacted.nested as Record<string, unknown>).deep as Record<string, string>).password
    ).toBe('[REDACTED]')
  })

  it('should handle arrays with sensitive data', () => {
    const context: ErrorContext = {
      headers: [
        { name: 'Authorization', value: 'Bearer token' },
        { name: 'Content-Type', value: 'application/json' },
      ],
    }

    const redacted = redactSensitiveContext(context)
    const headers = redacted.headers as Array<{ name: string; value: string }>

    const authHeader = headers.find(h => h.name === 'Authorization')
    expect(authHeader?.value).toBe('[REDACTED]')
  })

  it('should not modify the original context', () => {
    const context: ErrorContext = {
      password: 'secret',
    }

    redactSensitiveContext(context)

    expect(context.password).toBe('secret')
  })
})

// ============================================================================
// Integration Tests - Error Context Through Error Chain
// ============================================================================

describe('Error context through error chain', () => {
  it('should preserve file context through fromError', () => {
    const fileError = new FileError('ENOENT', {
      path: '/missing/file.txt',
      operation: 'read',
      errno: 'ENOENT',
    })

    const wrapped = fromError(fileError)

    expect(wrapped.context.path).toBe('/missing/file.txt')
    expect(wrapped.context.operation).toBe('read')
  })

  it('should merge contexts when wrapping errors', () => {
    const originalError = new Error('Low-level error')
    const wrapped = fromError(originalError, {
      command: 'some-command',
      tier: 2,
      additionalContext: 'extra-info',
    })

    expect(wrapped.context.command).toBe('some-command')
    expect(wrapped.context.tier).toBe(2)
    expect(wrapped.context.additionalContext).toBe('extra-info')
  })

  it('should preserve context in serialization round-trip', () => {
    const error = new FileError('Not found', {
      path: '/test/path',
      operation: 'read',
    })

    const serialized = error.toJSON()
    const deserialized = BashxError.fromJSON(serialized)

    expect(deserialized.context.path).toBe('/test/path')
    expect(deserialized.context.operation).toBe('read')
  })
})

// ============================================================================
// Error Message Actionability Tests
// ============================================================================

describe('Error messages are actionable', () => {
  it('FileError should include path and suggested action', () => {
    const error = new FileError('File not found', {
      path: '/config/settings.json',
      operation: 'read',
      errno: 'ENOENT',
    })

    expect(error.message).toContain('File not found')
    expect(error.hint).toBeDefined()
    // Hint should help user understand what to do
  })

  it('NetworkError should include URL and status', () => {
    const error = new NetworkError('Request failed', {
      url: 'https://api.example.com/data',
      method: 'POST',
      statusCode: 503,
    })

    expect(error.hint).toBeDefined()
    // Should suggest retry for 5xx errors
  })

  it('PipelineError should identify failing stage', () => {
    const error = new PipelineError('Pipeline failed', {
      stageIndex: 2,
      stageCommand: 'grep invalid[',
      pipeline: 'cat file | sort | grep invalid[',
    })

    expect(error.hint).toBeDefined()
    // Should help user identify which part of pipeline failed
  })

  it('RetryError should include attempt count and operation', () => {
    const error = new RetryError('Exhausted', {
      attempt: 3,
      maxAttempts: 3,
      operation: 'fetch-data',
    })

    expect(error.hint).toBeDefined()
    // Should indicate how many attempts were made
  })
})
