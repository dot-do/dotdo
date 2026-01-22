import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  sanitizeValue,
  sanitizeArgs,
  buildErrorContext,
  logRPCError,
  formatErrorContext,
  RPCErrorContext,
} from '../logging'
import { setLogLevel, LogLevel } from '../../utils/logger'

describe('sanitizeValue', () => {
  describe('primitives', () => {
    it('should return null as-is', () => {
      expect(sanitizeValue(null)).toBeNull()
    })

    it('should return undefined as-is', () => {
      expect(sanitizeValue(undefined)).toBeUndefined()
    })

    it('should return booleans as-is', () => {
      expect(sanitizeValue(true)).toBe(true)
      expect(sanitizeValue(false)).toBe(false)
    })

    it('should return numbers as-is', () => {
      expect(sanitizeValue(42)).toBe(42)
      expect(sanitizeValue(3.14)).toBe(3.14)
      expect(sanitizeValue(-100)).toBe(-100)
    })

    it('should return regular strings as-is', () => {
      expect(sanitizeValue('hello world')).toBe('hello world')
    })

    it('should handle bigint', () => {
      expect(sanitizeValue(BigInt(9007199254740991))).toBe('9007199254740991')
    })

    it('should handle symbols', () => {
      const sym = Symbol('test')
      expect(sanitizeValue(sym)).toBe('Symbol(test)')
    })

    it('should handle functions', () => {
      const fn = () => 'test'
      expect(sanitizeValue(fn)).toBe('[Function]')
    })
  })

  describe('string truncation', () => {
    it('should truncate long strings', () => {
      // Use a string that won't match base64 patterns (include spaces and punctuation)
      const longString = 'Hello world! This is a test message. '.repeat(20)
      const result = sanitizeValue(longString) as string
      expect(result).toContain('... [truncated, total')
      expect(result.length).toBeLessThan(longString.length)
    })

    it('should not truncate strings at exactly max length', () => {
      // Use a string that won't match base64 patterns
      const maxString = 'Hello world! '.repeat(38).slice(0, 500)
      expect(sanitizeValue(maxString)).toBe(maxString)
    })
  })

  describe('sensitive string detection', () => {
    it('should redact JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
      expect(sanitizeValue(jwt)).toBe('[REDACTED]')
    })

    it('should redact Bearer tokens', () => {
      expect(sanitizeValue('Bearer abc123xyz')).toBe('[REDACTED]')
      expect(sanitizeValue('bearer some-token')).toBe('[REDACTED]')
    })

    it('should redact API key patterns', () => {
      // The regex pattern is: /^(sk|pk|api|key|token|secret)[-_][A-Za-z0-9]{20,}$/i
      expect(sanitizeValue('sk-1234567890abcdefghij')).toBe('[REDACTED]')
      expect(sanitizeValue('pk-abcdefghijklmnopqrstuvwxyz')).toBe('[REDACTED]')
      expect(sanitizeValue('api-1234567890abcdefghij')).toBe('[REDACTED]')
      expect(sanitizeValue('token_abcdefghijklmnopqrstuvwxyz')).toBe('[REDACTED]')
      expect(sanitizeValue('secret-1234567890abcdefghij')).toBe('[REDACTED]')
    })

    it('should redact long base64 strings (likely secrets)', () => {
      const base64Secret = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkw'
      expect(sanitizeValue(base64Secret)).toBe('[REDACTED]')
    })

    it('should not redact short or normal strings', () => {
      expect(sanitizeValue('hello')).toBe('hello')
      expect(sanitizeValue('user@example.com')).toBe('user@example.com')
    })
  })

  describe('sensitive key detection', () => {
    it('should redact password fields', () => {
      expect(sanitizeValue({ password: 'secret123' })).toEqual({ password: '[REDACTED]' })
      expect(sanitizeValue({ passwd: 'secret123' })).toEqual({ passwd: '[REDACTED]' })
      expect(sanitizeValue({ pwd: 'secret123' })).toEqual({ pwd: '[REDACTED]' })
    })

    it('should redact token fields', () => {
      expect(sanitizeValue({ token: 'abc123' })).toEqual({ token: '[REDACTED]' })
      expect(sanitizeValue({ accessToken: 'abc123' })).toEqual({ accessToken: '[REDACTED]' })
      expect(sanitizeValue({ access_token: 'abc123' })).toEqual({ access_token: '[REDACTED]' })
      expect(sanitizeValue({ refreshToken: 'abc123' })).toEqual({ refreshToken: '[REDACTED]' })
      expect(sanitizeValue({ refresh_token: 'abc123' })).toEqual({ refresh_token: '[REDACTED]' })
    })

    it('should redact API key fields', () => {
      expect(sanitizeValue({ apiKey: 'key123' })).toEqual({ apiKey: '[REDACTED]' })
      expect(sanitizeValue({ api_key: 'key123' })).toEqual({ api_key: '[REDACTED]' })
      expect(sanitizeValue({ apiToken: 'key123' })).toEqual({ apiToken: '[REDACTED]' })
      expect(sanitizeValue({ api_token: 'key123' })).toEqual({ api_token: '[REDACTED]' })
    })

    it('should redact authorization fields', () => {
      expect(sanitizeValue({ authorization: 'Bearer xyz' })).toEqual({ authorization: '[REDACTED]' })
      expect(sanitizeValue({ auth: 'xyz' })).toEqual({ auth: '[REDACTED]' })
      expect(sanitizeValue({ bearer: 'xyz' })).toEqual({ bearer: '[REDACTED]' })
    })

    it('should redact secret fields', () => {
      expect(sanitizeValue({ secret: 'mysecret' })).toEqual({ secret: '[REDACTED]' })
      expect(sanitizeValue({ secretKey: 'mysecret' })).toEqual({ secretKey: '[REDACTED]' })
      expect(sanitizeValue({ secret_key: 'mysecret' })).toEqual({ secret_key: '[REDACTED]' })
    })

    it('should redact cryptographic key fields', () => {
      expect(sanitizeValue({ privateKey: 'key' })).toEqual({ privateKey: '[REDACTED]' })
      expect(sanitizeValue({ private_key: 'key' })).toEqual({ private_key: '[REDACTED]' })
      expect(sanitizeValue({ signingKey: 'key' })).toEqual({ signingKey: '[REDACTED]' })
      expect(sanitizeValue({ signing_key: 'key' })).toEqual({ signing_key: '[REDACTED]' })
      expect(sanitizeValue({ encryptionKey: 'key' })).toEqual({ encryptionKey: '[REDACTED]' })
      expect(sanitizeValue({ encryption_key: 'key' })).toEqual({ encryption_key: '[REDACTED]' })
    })

    it('should redact session fields', () => {
      expect(sanitizeValue({ session: 'sess123' })).toEqual({ session: '[REDACTED]' })
      expect(sanitizeValue({ sessionId: 'sess123' })).toEqual({ sessionId: '[REDACTED]' })
      expect(sanitizeValue({ session_id: 'sess123' })).toEqual({ session_id: '[REDACTED]' })
      expect(sanitizeValue({ cookie: 'abc=123' })).toEqual({ cookie: '[REDACTED]' })
    })

    it('should redact PII fields', () => {
      expect(sanitizeValue({ ssn: '123-45-6789' })).toEqual({ ssn: '[REDACTED]' })
      expect(sanitizeValue({ creditCard: '4111111111111111' })).toEqual({ creditCard: '[REDACTED]' })
      expect(sanitizeValue({ credit_card: '4111111111111111' })).toEqual({ credit_card: '[REDACTED]' })
      expect(sanitizeValue({ cvv: '123' })).toEqual({ cvv: '[REDACTED]' })
      expect(sanitizeValue({ pin: '1234' })).toEqual({ pin: '[REDACTED]' })
    })

    it('should redact database connection fields', () => {
      expect(sanitizeValue({ connectionString: 'postgres://user:pass@host/db' })).toEqual({ connectionString: '[REDACTED]' })
      expect(sanitizeValue({ connection_string: 'postgres://user:pass@host/db' })).toEqual({ connection_string: '[REDACTED]' })
      expect(sanitizeValue({ dbPassword: 'dbpass' })).toEqual({ dbPassword: '[REDACTED]' })
      expect(sanitizeValue({ db_password: 'dbpass' })).toEqual({ db_password: '[REDACTED]' })
    })

    it('should handle case-insensitive key matching', () => {
      expect(sanitizeValue({ PASSWORD: 'secret' })).toEqual({ PASSWORD: '[REDACTED]' })
      expect(sanitizeValue({ Token: 'abc' })).toEqual({ Token: '[REDACTED]' })
      expect(sanitizeValue({ API_KEY: 'key' })).toEqual({ API_KEY: '[REDACTED]' })
    })

    it('should preserve non-sensitive fields', () => {
      const obj = { name: 'Alice', email: 'alice@example.com', age: 30 }
      expect(sanitizeValue(obj)).toEqual(obj)
    })

    it('should handle mixed sensitive and non-sensitive fields', () => {
      const obj = {
        username: 'alice',
        password: 'secret123',
        email: 'alice@example.com',
        apiKey: 'key123',
      }
      expect(sanitizeValue(obj)).toEqual({
        username: 'alice',
        password: '[REDACTED]',
        email: 'alice@example.com',
        apiKey: '[REDACTED]',
      })
    })
  })

  describe('nested objects', () => {
    it('should recursively sanitize nested objects', () => {
      const obj = {
        user: {
          name: 'Alice',
          config: {
            password: 'secret123',
            token: 'abc123',
          },
        },
      }
      expect(sanitizeValue(obj)).toEqual({
        user: {
          name: 'Alice',
          config: {
            password: '[REDACTED]',
            token: '[REDACTED]',
          },
        },
      })
    })

    it('should redact entire value for sensitive key names like credentials', () => {
      // 'credentials' is a sensitive key, so the entire nested value is redacted
      const obj = {
        user: {
          name: 'Alice',
          credentials: {
            password: 'secret123',
            username: 'alice',
          },
        },
      }
      expect(sanitizeValue(obj)).toEqual({
        user: {
          name: 'Alice',
          credentials: '[REDACTED]',
        },
      })
    })

    it('should handle max depth exceeded', () => {
      let deepObject: Record<string, unknown> = { value: 'leaf' }
      for (let i = 0; i < 15; i++) {
        deepObject = { nested: deepObject }
      }
      const result = sanitizeValue(deepObject) as Record<string, unknown>
      // Should eventually hit [MAX_DEPTH_EXCEEDED]
      let current = result
      let depthReached = 0
      while (current && typeof current === 'object' && 'nested' in current) {
        depthReached++
        current = current.nested as Record<string, unknown>
      }
      expect(current).toBe('[MAX_DEPTH_EXCEEDED]')
    })
  })

  describe('arrays', () => {
    it('should sanitize arrays', () => {
      const arr = [1, 'hello', { password: 'secret' }]
      expect(sanitizeValue(arr)).toEqual([1, 'hello', { password: '[REDACTED]' }])
    })

    it('should truncate long arrays', () => {
      const longArr = Array.from({ length: 30 }, (_, i) => i)
      const result = sanitizeValue(longArr) as unknown[]
      expect(result.length).toBe(21) // 20 items + truncation message
      expect(result[20]).toBe('... [10 more items]')
    })

    it('should not truncate arrays at exactly max length', () => {
      const arr = Array.from({ length: 20 }, (_, i) => i)
      expect(sanitizeValue(arr)).toEqual(arr)
    })
  })

  describe('special objects', () => {
    it('should handle Error objects', () => {
      const error = new Error('Something went wrong')
      error.stack = 'Error: Something went wrong\n    at test.ts:1'
      const result = sanitizeValue(error) as { name: string; message: string; stack: string }
      expect(result.name).toBe('Error')
      expect(result.message).toBe('Something went wrong')
      expect(result.stack).toBe('Error: Something went wrong\n    at test.ts:1')
    })

    it('should handle Date objects', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      expect(sanitizeValue(date)).toBe('2024-01-15T12:00:00.000Z')
    })
  })
})

describe('sanitizeArgs', () => {
  it('should sanitize an array of arguments', () => {
    const args = [
      'method-name',
      { password: 'secret', name: 'Alice' },
      42,
    ]
    expect(sanitizeArgs(args)).toEqual([
      'method-name',
      { password: '[REDACTED]', name: 'Alice' },
      42,
    ])
  })

  it('should handle empty arguments', () => {
    expect(sanitizeArgs([])).toEqual([])
  })

  it('should handle mixed sensitive values', () => {
    const args = [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      { apiKey: 'key123', data: 'safe' },
    ]
    expect(sanitizeArgs(args)).toEqual([
      '[REDACTED]',
      { apiKey: '[REDACTED]', data: 'safe' },
    ])
  })
})

describe('buildErrorContext', () => {
  it('should build context with method and args', () => {
    const context = buildErrorContext(
      new Error('Test error'),
      'users.create',
      [{ name: 'Alice' }]
    )

    expect(context.method).toBe('users.create')
    expect(context.args).toEqual([{ name: 'Alice' }])
    expect(context.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('should include correlation ID when provided', () => {
    const context = buildErrorContext(
      new Error('Test error'),
      'users.create',
      [],
      'req-123-abc'
    )

    expect(context.correlationId).toBe('req-123-abc')
  })

  it('should not include correlation ID when not provided', () => {
    const context = buildErrorContext(
      new Error('Test error'),
      'users.create',
      []
    )

    expect(context.correlationId).toBeUndefined()
  })

  it('should include stack trace from Error', () => {
    const error = new Error('Test error')
    const context = buildErrorContext(error, 'test.method', [])

    expect(context.stack).toBeDefined()
    expect(context.stack).toContain('Error: Test error')
  })

  it('should include code from RPCError-like objects', () => {
    const error = new Error('Not found') as Error & { code: string }
    error.code = 'NOT_FOUND'
    const context = buildErrorContext(error, 'test.method', [])

    expect(context.code).toBe('NOT_FOUND')
  })

  it('should include httpStatus from RPCError-like objects', () => {
    const error = new Error('Not found') as Error & { httpStatus: number }
    error.httpStatus = 404
    const context = buildErrorContext(error, 'test.method', [])

    expect(context.httpStatus).toBe(404)
  })

  it('should include and sanitize details from RPCError-like objects', () => {
    const error = new Error('Auth failed') as Error & { details: Record<string, unknown> }
    error.details = { userId: '123', password: 'secret' }
    const context = buildErrorContext(error, 'test.method', [])

    expect(context.details).toEqual({ userId: '123', password: '[REDACTED]' })
  })

  it('should sanitize args in context', () => {
    const context = buildErrorContext(
      new Error('Test'),
      'auth.login',
      [{ username: 'alice', password: 'secret123' }]
    )

    expect(context.args).toEqual([{ username: 'alice', password: '[REDACTED]' }])
  })

  it('should handle non-Error values', () => {
    const context = buildErrorContext(
      'String error',
      'test.method',
      []
    )

    expect(context.method).toBe('test.method')
    expect(context.stack).toBeUndefined()
    expect(context.code).toBeUndefined()
  })

  it('should handle null error', () => {
    const context = buildErrorContext(null, 'test.method', [])

    expect(context.method).toBe('test.method')
    expect(context.stack).toBeUndefined()
  })
})

describe('logRPCError', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    setLogLevel(LogLevel.ERROR)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    setLogLevel(LogLevel.INFO)
  })

  it('should log RPC error with context', () => {
    const error = new Error('Test error')
    logRPCError(error, 'users.create', [{ name: 'Alice' }])

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const [prefix, message, context] = consoleErrorSpy.mock.calls[0]
    expect(prefix).toBe('[RPC]')
    expect(message).toContain('RPC error in users.create')
    expect(message).toContain('Test error')
    expect(context).toHaveProperty('method', 'users.create')
  })

  it('should log with correlation ID', () => {
    const error = new Error('Test error')
    logRPCError(error, 'test.method', [], 'corr-123')

    const [, , context] = consoleErrorSpy.mock.calls[0]
    expect(context).toHaveProperty('correlationId', 'corr-123')
  })

  it('should sanitize sensitive data in logged args', () => {
    const error = new Error('Auth failed')
    logRPCError(error, 'auth.login', [{ username: 'alice', password: 'secret' }])

    const [, , context] = consoleErrorSpy.mock.calls[0]
    expect(context.args).toEqual([{ username: 'alice', password: '[REDACTED]' }])
  })

  it('should handle non-Error values', () => {
    logRPCError('String error', 'test.method', [])

    const [, message] = consoleErrorSpy.mock.calls[0]
    expect(message).toContain('String error')
  })
})

describe('formatErrorContext', () => {
  it('should format basic context', () => {
    const context: RPCErrorContext = {
      method: 'users.create',
      timestamp: '2024-01-15T12:00:00.000Z',
    }

    const formatted = formatErrorContext(context)

    expect(formatted).toContain('method=users.create')
    expect(formatted).toContain('timestamp=2024-01-15T12:00:00.000Z')
  })

  it('should include correlation ID when present', () => {
    const context: RPCErrorContext = {
      method: 'test.method',
      timestamp: '2024-01-15T12:00:00.000Z',
      correlationId: 'req-123',
    }

    const formatted = formatErrorContext(context)

    expect(formatted).toContain('correlationId=req-123')
  })

  it('should include code when present', () => {
    const context: RPCErrorContext = {
      method: 'test.method',
      timestamp: '2024-01-15T12:00:00.000Z',
      code: 'NOT_FOUND',
    }

    const formatted = formatErrorContext(context)

    expect(formatted).toContain('code=NOT_FOUND')
  })

  it('should include httpStatus when present', () => {
    const context: RPCErrorContext = {
      method: 'test.method',
      timestamp: '2024-01-15T12:00:00.000Z',
      httpStatus: 404,
    }

    const formatted = formatErrorContext(context)

    expect(formatted).toContain('httpStatus=404')
  })

  it('should include serialized args when present', () => {
    const context: RPCErrorContext = {
      method: 'test.method',
      timestamp: '2024-01-15T12:00:00.000Z',
      args: [{ name: 'Alice' }, 42],
    }

    const formatted = formatErrorContext(context)

    expect(formatted).toContain('args=[{"name":"Alice"},42]')
  })

  it('should not include args when empty', () => {
    const context: RPCErrorContext = {
      method: 'test.method',
      timestamp: '2024-01-15T12:00:00.000Z',
      args: [],
    }

    const formatted = formatErrorContext(context)

    expect(formatted).not.toContain('args=')
  })

  it('should handle args serialization failure gracefully', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const context: RPCErrorContext = {
      method: 'test.method',
      timestamp: '2024-01-15T12:00:00.000Z',
      args: [circular],
    }

    const formatted = formatErrorContext(context)

    expect(formatted).toContain('args=[serialization failed]')
  })

  it('should format all fields in correct order', () => {
    const context: RPCErrorContext = {
      method: 'users.create',
      timestamp: '2024-01-15T12:00:00.000Z',
      correlationId: 'req-123',
      code: 'INTERNAL_ERROR',
      httpStatus: 500,
      args: [{ id: 1 }],
    }

    const formatted = formatErrorContext(context)

    // Check order: method, timestamp, correlationId, code, httpStatus, args
    const methodIndex = formatted.indexOf('method=')
    const timestampIndex = formatted.indexOf('timestamp=')
    const correlationIdIndex = formatted.indexOf('correlationId=')
    const codeIndex = formatted.indexOf('code=')
    const httpStatusIndex = formatted.indexOf('httpStatus=')
    const argsIndex = formatted.indexOf('args=')

    expect(methodIndex).toBeLessThan(timestampIndex)
    expect(timestampIndex).toBeLessThan(correlationIdIndex)
    expect(correlationIdIndex).toBeLessThan(codeIndex)
    expect(codeIndex).toBeLessThan(httpStatusIndex)
    expect(httpStatusIndex).toBeLessThan(argsIndex)
  })
})
