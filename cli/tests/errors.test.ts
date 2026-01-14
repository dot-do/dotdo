/**
 * CLI Error Handling Tests
 *
 * Tests for the unified error type hierarchy and error handling utilities.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import {
  // Exit Codes
  ExitCode,
  ErrorCode,
  // Base Error
  CLIError,
  // Specific Errors
  AuthError,
  ValidationError,
  NetworkError,
  SandboxError,
  MCPError,
  CommandError,
  ConfigError,
  // Utilities
  handleError,
  withErrorHandling,
  isCLIError,
  hasErrorCode,
  toCLIError,
  // Stack trace formatting
  parseStackTrace,
  formatStackTrace,
  formatErrorChain,
  summarizeError,
  debugError,
} from '../utils/errors'

// ============================================================================
// Exit Codes Tests
// ============================================================================

describe('Exit Codes', () => {
  it('defines standard exit codes', () => {
    expect(ExitCode.SUCCESS).toBe(0)
    expect(ExitCode.ERROR).toBe(1)
    expect(ExitCode.MISUSE).toBe(2)
    expect(ExitCode.AUTH_REQUIRED).toBe(3)
    expect(ExitCode.AUTH_DENIED).toBe(4)
    expect(ExitCode.NETWORK_ERROR).toBe(5)
    expect(ExitCode.RATE_LIMITED).toBe(6)
    expect(ExitCode.NOT_FOUND).toBe(7)
    expect(ExitCode.TIMEOUT).toBe(8)
    expect(ExitCode.SANDBOX_ERROR).toBe(9)
    expect(ExitCode.CONFIG_ERROR).toBe(10)
  })
})

// ============================================================================
// CLIError Tests
// ============================================================================

describe('CLIError', () => {
  it('creates basic error with message', () => {
    const error = new CLIError('Something went wrong')
    expect(error.message).toBe('Something went wrong')
    expect(error.name).toBe('CLIError')
    expect(error.code).toBe(ErrorCode.UNKNOWN)
    expect(error.exitCode).toBe(ExitCode.ERROR)
  })

  it('creates error with custom code and exitCode', () => {
    const error = new CLIError('Auth failed', {
      code: ErrorCode.AUTH_REQUIRED,
      exitCode: ExitCode.AUTH_REQUIRED,
    })
    expect(error.code).toBe(ErrorCode.AUTH_REQUIRED)
    expect(error.exitCode).toBe(ExitCode.AUTH_REQUIRED)
  })

  it('includes details and hint', () => {
    const error = new CLIError('Invalid input', {
      details: { field: 'email', value: 'not-an-email' },
      hint: 'Provide a valid email address',
    })
    expect(error.details).toEqual({ field: 'email', value: 'not-an-email' })
    expect(error.hint).toBe('Provide a valid email address')
  })

  it('preserves cause error', () => {
    const cause = new Error('Original error')
    const error = new CLIError('Wrapped error', { cause })
    expect(error.cause).toBe(cause)
  })

  describe('toJSON', () => {
    it('returns structured error format', () => {
      const error = new CLIError('Test error', {
        code: ErrorCode.INVALID_ARGUMENT,
        exitCode: ExitCode.MISUSE,
        details: { arg: 'foo' },
        hint: 'Try bar instead',
      })

      const json = error.toJSON()
      expect(json.error.code).toBe(ErrorCode.INVALID_ARGUMENT)
      expect(json.error.message).toBe('Test error')
      expect(json.error.exitCode).toBe(ExitCode.MISUSE)
      expect(json.error.details).toEqual({ arg: 'foo' })
      expect(json.error.hint).toBe('Try bar instead')
    })

    it('includes cause message when present', () => {
      const cause = new Error('Root cause')
      const error = new CLIError('Outer error', { cause })

      const json = error.toJSON()
      expect(json.error.cause).toBe('Root cause')
    })

    it('omits undefined fields', () => {
      const error = new CLIError('Simple error')
      const json = error.toJSON()

      expect(json.error.code).toBe(ErrorCode.UNKNOWN)
      expect(json.error.message).toBe('Simple error')
      expect(json.error.details).toBeUndefined()
      expect(json.error.hint).toBeUndefined()
      expect(json.error.cause).toBeUndefined()
    })
  })

  describe('format', () => {
    it('formats error without colors', () => {
      const error = new CLIError('Test error', {
        hint: 'A helpful hint',
        details: { key: 'value' },
      })

      const formatted = error.format(false)
      expect(formatted).toContain('Error: Test error')
      expect(formatted).toContain('Hint: A helpful hint')
      expect(formatted).toContain('key: value')
    })

    it('formats error with colors', () => {
      const error = new CLIError('Test error')
      const formatted = error.format(true)
      expect(formatted).toContain('\x1b[31m') // Red color code
      expect(formatted).toContain('\x1b[0m') // Reset code
    })
  })
})

// ============================================================================
// AuthError Tests
// ============================================================================

describe('AuthError', () => {
  it('creates auth required error', () => {
    const error = new AuthError('Not logged in')
    expect(error.name).toBe('AuthError')
    expect(error.code).toBe(ErrorCode.AUTH_REQUIRED)
    expect(error.exitCode).toBe(ExitCode.AUTH_REQUIRED)
    expect(error.expired).toBe(false)
    expect(error.hint).toContain('login')
  })

  it('creates expired session error', () => {
    const error = new AuthError('Session expired', { expired: true })
    expect(error.code).toBe(ErrorCode.AUTH_EXPIRED)
    expect(error.expired).toBe(true)
  })

  describe('factory methods', () => {
    it('notLoggedIn creates proper error', () => {
      const error = AuthError.notLoggedIn()
      expect(error.message).toBe('Not logged in.')
      expect(error.code).toBe(ErrorCode.AUTH_REQUIRED)
    })

    it('expired creates proper error', () => {
      const error = AuthError.expired()
      expect(error.message).toBe('Session expired.')
      expect(error.expired).toBe(true)
    })

    it('denied creates proper error', () => {
      const error = AuthError.denied('Insufficient permissions')
      expect(error.message).toBe('Insufficient permissions')
      expect(error.code).toBe(ErrorCode.AUTH_DENIED)
      expect(error.exitCode).toBe(ExitCode.AUTH_DENIED)
    })
  })
})

// ============================================================================
// ValidationError Tests
// ============================================================================

describe('ValidationError', () => {
  it('creates basic validation error', () => {
    const error = new ValidationError('Invalid input')
    expect(error.name).toBe('ValidationError')
    expect(error.code).toBe(ErrorCode.INVALID_ARGUMENT)
    expect(error.exitCode).toBe(ExitCode.MISUSE)
  })

  describe('factory methods', () => {
    it('invalidArgument', () => {
      const error = ValidationError.invalidArgument('port', 'number', 'abc')
      expect(error.message).toBe('Invalid argument: port')
      expect(error.details?.argument).toBe('port')
      expect(error.details?.expected).toBe('number')
      expect(error.details?.received).toBe('abc')
    })

    it('missingArgument', () => {
      const error = ValidationError.missingArgument('name', 'Provide a project name')
      expect(error.message).toBe('Missing required argument: name')
      expect(error.code).toBe(ErrorCode.MISSING_ARGUMENT)
      expect(error.hint).toBe('Provide a project name')
    })

    it('invalidOption', () => {
      const error = ValidationError.invalidOption('port', 'number between 1-65535', 'xyz')
      expect(error.message).toBe('Invalid option: --port')
      expect(error.code).toBe(ErrorCode.INVALID_OPTION)
    })

    it('missingOption', () => {
      const error = ValidationError.missingOption('config')
      expect(error.message).toBe('Missing required option: --config')
      expect(error.code).toBe(ErrorCode.MISSING_OPTION)
    })

    it('invalidFormat', () => {
      const error = ValidationError.invalidFormat('date', 'YYYY-MM-DD', '2024/01/01')
      expect(error.code).toBe(ErrorCode.INVALID_FORMAT)
    })

    it('invalidPort', () => {
      const error = ValidationError.invalidPort('abc')
      expect(error.message).toContain('Invalid port')
      expect(error.details?.expected).toContain('65535')
    })

    it('invalidPhoneNumber', () => {
      const error = ValidationError.invalidPhoneNumber('123')
      expect(error.message).toContain('phone number')
      expect(error.details?.expected).toContain('E.164')
    })

    it('invalidEmail', () => {
      const error = ValidationError.invalidEmail('not-email')
      expect(error.message).toContain('email address')
    })

    it('invalidJSON', () => {
      const error = ValidationError.invalidJSON('metadata', '{invalid}')
      expect(error.message).toContain('Invalid JSON')
    })
  })
})

// ============================================================================
// NetworkError Tests
// ============================================================================

describe('NetworkError', () => {
  it('creates basic network error', () => {
    const error = new NetworkError('Connection refused')
    expect(error.name).toBe('NetworkError')
    expect(error.code).toBe(ErrorCode.NETWORK_ERROR)
    expect(error.exitCode).toBe(ExitCode.NETWORK_ERROR)
  })

  describe('factory methods', () => {
    it('connectionFailed', () => {
      const cause = new Error('ECONNREFUSED')
      const error = NetworkError.connectionFailed('https://example.com', cause)
      expect(error.message).toBe('Connection failed')
      expect(error.url).toBe('https://example.com')
      expect(error.cause).toBe(cause)
    })

    it('timeout', () => {
      const error = NetworkError.timeout('https://api.example.com', 5000)
      expect(error.message).toBe('Request timed out')
      expect(error.code).toBe(ErrorCode.TIMEOUT)
      expect(error.exitCode).toBe(ExitCode.TIMEOUT)
      expect(error.details?.timeoutMs).toBe(5000)
    })

    it('rateLimited with retryAfter', () => {
      const error = NetworkError.rateLimited(60)
      expect(error.message).toBe('Rate limit exceeded')
      expect(error.code).toBe(ErrorCode.RATE_LIMITED)
      expect(error.retryAfter).toBe(60)
      expect(error.hint).toContain('60 seconds')
    })

    it('rateLimited without retryAfter', () => {
      const error = NetworkError.rateLimited()
      expect(error.hint).toContain('wait')
    })

    describe('httpError', () => {
      it('handles 401 Unauthorized', () => {
        const error = NetworkError.httpError(401, 'Unauthorized')
        expect(error.code).toBe(ErrorCode.AUTH_REQUIRED)
        expect(error.exitCode).toBe(ExitCode.AUTH_REQUIRED)
      })

      it('handles 403 Forbidden', () => {
        const error = NetworkError.httpError(403, 'Forbidden')
        expect(error.code).toBe(ErrorCode.AUTH_DENIED)
        expect(error.exitCode).toBe(ExitCode.AUTH_DENIED)
      })

      it('handles 404 Not Found', () => {
        const error = NetworkError.httpError(404, 'Not Found')
        expect(error.code).toBe(ErrorCode.NOT_FOUND)
        expect(error.exitCode).toBe(ExitCode.NOT_FOUND)
      })

      it('handles 429 Too Many Requests', () => {
        const error = NetworkError.httpError(429)
        expect(error.code).toBe(ErrorCode.RATE_LIMITED)
        expect(error.exitCode).toBe(ExitCode.RATE_LIMITED)
      })

      it('handles 500 Server Error', () => {
        const error = NetworkError.httpError(500)
        expect(error.code).toBe(ErrorCode.SERVER_ERROR)
      })

      it('handles generic errors', () => {
        const error = NetworkError.httpError(400, 'Bad Request')
        expect(error.code).toBe(ErrorCode.API_ERROR)
        expect(error.status).toBe(400)
      })
    })

    describe('serviceUnavailable', () => {
      it('creates service unavailable error with service name', () => {
        const error = NetworkError.serviceUnavailable('workers.do')
        expect(error.message).toBe('Unable to connect to workers.do')
        expect(error.code).toBe(ErrorCode.CONNECTION_FAILED)
        expect(error.hint).toContain('Check your internet connection')
      })

      it('includes url when provided', () => {
        const error = NetworkError.serviceUnavailable('workers.do', 'https://workers.do')
        expect(error.url).toBe('https://workers.do')
      })

      it('includes cause when provided', () => {
        const cause = new Error('ECONNREFUSED')
        const error = NetworkError.serviceUnavailable('workers.do', undefined, cause)
        expect(error.cause).toBe(cause)
      })

      it('provides helpful hint with service name', () => {
        const error = NetworkError.serviceUnavailable('api.example.com')
        expect(error.hint).toContain('api.example.com may be temporarily unavailable')
      })
    })

    describe('isNetworkError', () => {
      it('returns true for NetworkError instances', () => {
        const error = new NetworkError('Connection failed')
        expect(NetworkError.isNetworkError(error)).toBe(true)
      })

      it('returns true for fetch failed errors', () => {
        const error = new Error('fetch failed')
        expect(NetworkError.isNetworkError(error)).toBe(true)
      })

      it('returns true for network errors', () => {
        const error = new Error('Network request failed')
        expect(NetworkError.isNetworkError(error)).toBe(true)
      })

      it('returns true for ECONNREFUSED errors', () => {
        const error = new Error('connect ECONNREFUSED 127.0.0.1:8787')
        expect(NetworkError.isNetworkError(error)).toBe(true)
      })

      it('returns true for ENOTFOUND errors', () => {
        const error = new Error('getaddrinfo ENOTFOUND workers.do')
        expect(NetworkError.isNetworkError(error)).toBe(true)
      })

      it('returns true for ETIMEDOUT errors', () => {
        const error = new Error('connect ETIMEDOUT')
        expect(NetworkError.isNetworkError(error)).toBe(true)
      })

      it('returns true for ECONNRESET errors', () => {
        const error = new Error('read ECONNRESET')
        expect(NetworkError.isNetworkError(error)).toBe(true)
      })

      it('returns true for bad RPC message errors', () => {
        const error = new Error('bad RPC message: {"service":"workers"}')
        expect(NetworkError.isNetworkError(error)).toBe(true)
      })

      it('returns true for unable to connect errors', () => {
        const error = new Error('Unable to connect to workers.do')
        expect(NetworkError.isNetworkError(error)).toBe(true)
      })

      it('returns false for regular errors', () => {
        const error = new Error('Something went wrong')
        expect(NetworkError.isNetworkError(error)).toBe(false)
      })

      it('returns false for non-Error values', () => {
        expect(NetworkError.isNetworkError('string')).toBe(false)
        expect(NetworkError.isNetworkError(null)).toBe(false)
        expect(NetworkError.isNetworkError(undefined)).toBe(false)
        expect(NetworkError.isNetworkError(42)).toBe(false)
      })
    })
  })
})

// ============================================================================
// SandboxError Tests
// ============================================================================

describe('SandboxError', () => {
  it('creates basic sandbox error', () => {
    const error = new SandboxError('Execution failed')
    expect(error.name).toBe('SandboxError')
    expect(error.code).toBe(ErrorCode.SANDBOX_ERROR)
    expect(error.exitCode).toBe(ExitCode.SANDBOX_ERROR)
  })

  describe('factory methods', () => {
    it('transformFailed', () => {
      const error = SandboxError.transformFailed('typescript')
      expect(error.message).toBe('Failed to transform code')
      expect(error.code).toBe(ErrorCode.TRANSFORM_ERROR)
      expect(error.details?.fileType).toBe('typescript')
    })

    it('executionFailed', () => {
      const cause = new Error('ReferenceError: x is not defined')
      const error = SandboxError.executionFailed('Runtime error', cause)
      expect(error.code).toBe(ErrorCode.EXECUTION_ERROR)
      expect(error.cause).toBe(cause)
    })

    it('executionTimeout', () => {
      const error = SandboxError.executionTimeout(5000)
      expect(error.code).toBe(ErrorCode.EXECUTION_TIMEOUT)
      expect(error.exitCode).toBe(ExitCode.TIMEOUT)
      expect(error.details?.timeoutMs).toBe(5000)
    })

    it('disposed', () => {
      const error = SandboxError.disposed()
      expect(error.message).toBe('Sandbox has been disposed')
    })
  })
})

// ============================================================================
// MCPError Tests
// ============================================================================

describe('MCPError', () => {
  it('creates basic MCP error', () => {
    const error = new MCPError('Protocol error')
    expect(error.name).toBe('MCPError')
    expect(error.code).toBe(ErrorCode.MCP_ERROR)
  })

  describe('factory methods', () => {
    it('parseError', () => {
      const error = MCPError.parseError()
      expect(error.message).toBe('Failed to parse JSON')
      expect(error.jsonRpcCode).toBe(-32700)
    })

    it('invalidRequest', () => {
      const error = MCPError.invalidRequest('Missing method')
      expect(error.message).toBe('Missing method')
      expect(error.jsonRpcCode).toBe(-32600)
    })

    it('methodNotFound', () => {
      const error = MCPError.methodNotFound('tools/call')
      expect(error.message).toBe('Method not found: tools/call')
      expect(error.jsonRpcCode).toBe(-32601)
    })

    it('transportClosed', () => {
      const error = MCPError.transportClosed()
      expect(error.code).toBe(ErrorCode.MCP_TRANSPORT_ERROR)
    })

    it('notConfigured', () => {
      const error = MCPError.notConfigured()
      expect(error.message).toBe('DO_URL not configured')
      expect(error.exitCode).toBe(ExitCode.CONFIG_ERROR)
      expect(error.hint).toContain('DO_URL')
    })

    it('invalidUrl', () => {
      const error = MCPError.invalidUrl('not-a-url')
      expect(error.code).toBe(ErrorCode.INVALID_FORMAT)
      expect(error.details?.url).toBe('not-a-url')
    })

    it('toolNotFound', () => {
      const error = MCPError.toolNotFound('some-tool')
      expect(error.message).toBe('Tool not found: some-tool')
      expect(error.code).toBe(ErrorCode.MCP_TOOL_ERROR)
    })
  })
})

// ============================================================================
// CommandError Tests
// ============================================================================

describe('CommandError', () => {
  it('creates basic command error', () => {
    const error = new CommandError('Command failed')
    expect(error.name).toBe('CommandError')
    expect(error.code).toBe(ErrorCode.COMMAND_FAILED)
  })

  describe('factory methods', () => {
    it('notFound', () => {
      const error = CommandError.notFound('wrangler')
      expect(error.message).toBe('Command not found: wrangler')
      expect(error.exitCode).toBe(ExitCode.NOT_FOUND)
    })

    it('failed', () => {
      const error = CommandError.failed('npm', 1, ['install'])
      expect(error.message).toBe('Command failed with exit code 1')
      expect(error.command).toBe('npm')
      expect(error.args).toEqual(['install'])
      expect(error.details?.processExitCode).toBe(1)
    })

    it('spawnFailed', () => {
      const cause = new Error('ENOENT')
      const error = CommandError.spawnFailed('node', cause)
      expect(error.message).toContain('Failed to spawn')
      expect(error.code).toBe(ErrorCode.SPAWN_ERROR)
    })
  })
})

// ============================================================================
// ConfigError Tests
// ============================================================================

describe('ConfigError', () => {
  it('creates basic config error', () => {
    const error = new ConfigError('Invalid config')
    expect(error.name).toBe('ConfigError')
    expect(error.code).toBe(ErrorCode.CONFIG_INVALID)
    expect(error.exitCode).toBe(ExitCode.CONFIG_ERROR)
  })

  describe('factory methods', () => {
    it('notFound', () => {
      const error = ConfigError.notFound('/path/to/config.json')
      expect(error.code).toBe(ErrorCode.CONFIG_NOT_FOUND)
      expect(error.details?.path).toBe('/path/to/config.json')
    })

    it('parseError', () => {
      const cause = new SyntaxError('Unexpected token')
      const error = ConfigError.parseError('config.json', cause)
      expect(error.code).toBe(ErrorCode.CONFIG_PARSE_ERROR)
    })

    it('invalidKey', () => {
      const error = ConfigError.invalidKey('unknown_option')
      expect(error.message).toContain('Unknown configuration key')
      expect(error.hint).toContain('dotdo config list')
    })

    it('invalidValue', () => {
      const error = ConfigError.invalidValue('port', 'integer')
      expect(error.details?.key).toBe('port')
    })
  })
})

// ============================================================================
// handleError Tests
// ============================================================================

describe('handleError', () => {
  let mockLog: Mock
  let mockExit: Mock

  beforeEach(() => {
    mockLog = vi.fn()
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    }) as unknown as Mock
  })

  afterEach(() => {
    mockExit.mockRestore()
  })

  it('formats CLIError and exits', () => {
    const error = new CLIError('Test error', { exitCode: ExitCode.MISUSE })

    expect(() => {
      handleError(error, { log: mockLog })
    }).toThrow('process.exit called')

    expect(mockLog).toHaveBeenCalled()
    expect(mockExit).toHaveBeenCalledWith(ExitCode.MISUSE)
  })

  it('outputs JSON when json option is true', () => {
    const error = new CLIError('Test error')

    expect(() => {
      handleError(error, { log: mockLog, json: true })
    }).toThrow('process.exit called')

    const output = mockLog.mock.calls[0][0]
    const parsed = JSON.parse(output)
    expect(parsed.error.message).toBe('Test error')
  })

  it('wraps non-CLIError in CLIError', () => {
    const error = new Error('Regular error')

    expect(() => {
      handleError(error, { log: mockLog })
    }).toThrow('process.exit called')

    expect(mockLog).toHaveBeenCalled()
    expect(mockExit).toHaveBeenCalledWith(ExitCode.ERROR)
  })

  it('handles string errors', () => {
    expect(() => {
      handleError('String error', { log: mockLog })
    }).toThrow('process.exit called')

    expect(mockLog.mock.calls[0][0]).toContain('String error')
  })

  it('does not exit when exit option is false', () => {
    const error = new CLIError('Test error')

    handleError(error, { log: mockLog, exit: false })

    expect(mockLog).toHaveBeenCalled()
    expect(mockExit).not.toHaveBeenCalled()
  })
})

// ============================================================================
// withErrorHandling Tests
// ============================================================================

describe('withErrorHandling', () => {
  let mockLog: Mock
  let mockExit: Mock

  beforeEach(() => {
    mockLog = vi.fn()
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    }) as unknown as Mock
  })

  afterEach(() => {
    mockExit.mockRestore()
  })

  it('returns result on success', async () => {
    const fn = async () => 'success'
    const wrapped = withErrorHandling(fn)

    const result = await wrapped()
    expect(result).toBe('success')
  })

  it('handles errors and exits', async () => {
    const fn = async () => {
      throw new CLIError('Test error')
    }
    const wrapped = withErrorHandling(fn, { log: mockLog })

    await expect(wrapped()).rejects.toThrow('process.exit called')
    expect(mockLog).toHaveBeenCalled()
  })

  it('passes arguments to wrapped function', async () => {
    const fn = async (a: number, b: string) => `${a}-${b}`
    const wrapped = withErrorHandling(fn)

    const result = await wrapped(42, 'test')
    expect(result).toBe('42-test')
  })
})

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('utility functions', () => {
  describe('isCLIError', () => {
    it('returns true for CLIError', () => {
      expect(isCLIError(new CLIError('test'))).toBe(true)
    })

    it('returns true for AuthError', () => {
      expect(isCLIError(new AuthError('test'))).toBe(true)
    })

    it('returns false for regular Error', () => {
      expect(isCLIError(new Error('test'))).toBe(false)
    })

    it('returns false for non-errors', () => {
      expect(isCLIError('test')).toBe(false)
      expect(isCLIError(null)).toBe(false)
      expect(isCLIError(undefined)).toBe(false)
    })
  })

  describe('hasErrorCode', () => {
    it('returns true for matching code', () => {
      const error = new CLIError('test', { code: ErrorCode.AUTH_REQUIRED })
      expect(hasErrorCode(error, ErrorCode.AUTH_REQUIRED)).toBe(true)
    })

    it('returns false for non-matching code', () => {
      const error = new CLIError('test', { code: ErrorCode.AUTH_REQUIRED })
      expect(hasErrorCode(error, ErrorCode.NETWORK_ERROR)).toBe(false)
    })

    it('returns false for non-CLIError', () => {
      expect(hasErrorCode(new Error('test'), ErrorCode.UNKNOWN)).toBe(false)
    })
  })

  describe('toCLIError', () => {
    it('returns same error for CLIError', () => {
      const error = new CLIError('test')
      expect(toCLIError(error)).toBe(error)
    })

    it('wraps regular Error', () => {
      const original = new Error('original')
      const wrapped = toCLIError(original)

      expect(wrapped).toBeInstanceOf(CLIError)
      expect(wrapped.message).toBe('original')
      expect(wrapped.cause).toBe(original)
    })

    it('converts string to CLIError', () => {
      const wrapped = toCLIError('string error')
      expect(wrapped).toBeInstanceOf(CLIError)
      expect(wrapped.message).toBe('string error')
    })
  })
})
