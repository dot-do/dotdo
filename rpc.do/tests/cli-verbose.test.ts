// CLI Verbose/Debug Mode Tests - TDD for rpc.do CLI
// Tests the --verbose and --debug flags for logging requests, responses, and timing
// Following RED -> GREEN -> REFACTOR methodology

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// Modules under test
import { evalCommand, type EvalOptions } from '../src/cli/eval'
import { pull } from '../src/cli/pull'
import {
  setLogLevel,
  getLogLevel,
  getLogLevelFromEnv,
  LogLevel,
  createLogger,
  type Logger,
} from '../src/cli/logger'

// ============================================================================
// Helper: Create temp directory for testing file operations
// ============================================================================

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rpc-do-cli-verbose-test-'))
  // Reset log level before each test
  setLogLevel(LogLevel.NORMAL)
})

afterEach(async () => {
  // Clean up temp directory
  await fs.rm(tempDir, { recursive: true, force: true })
  // Reset log level
  setLogLevel(LogLevel.NORMAL)
})

// ============================================================================
// Logger module - Basic functionality
// ============================================================================

describe('Logger module', () => {
  it('exports LogLevel enum with NORMAL, VERBOSE, DEBUG', () => {
    expect(LogLevel.NORMAL).toBeDefined()
    expect(LogLevel.VERBOSE).toBeDefined()
    expect(LogLevel.DEBUG).toBeDefined()
  })

  it('exports setLogLevel and getLogLevel functions', () => {
    expect(typeof setLogLevel).toBe('function')
    expect(typeof getLogLevel).toBe('function')
  })

  it('defaults to NORMAL log level', () => {
    expect(getLogLevel()).toBe(LogLevel.NORMAL)
  })

  it('setLogLevel changes the current log level', () => {
    setLogLevel(LogLevel.VERBOSE)
    expect(getLogLevel()).toBe(LogLevel.VERBOSE)

    setLogLevel(LogLevel.DEBUG)
    expect(getLogLevel()).toBe(LogLevel.DEBUG)
  })

  it('createLogger returns a Logger instance', () => {
    const logger = createLogger()
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.verbose).toBe('function')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.error).toBe('function')
  })
})

// ============================================================================
// Logger output behavior
// ============================================================================

describe('Logger output behavior', () => {
  it('info() always outputs regardless of log level', () => {
    const output: string[] = []
    const logger = createLogger({ output: (msg) => output.push(msg) })

    setLogLevel(LogLevel.NORMAL)
    logger.info('test message')

    expect(output).toContain('test message')
  })

  it('verbose() only outputs at VERBOSE or DEBUG level', () => {
    const output: string[] = []
    const logger = createLogger({ output: (msg) => output.push(msg) })

    setLogLevel(LogLevel.NORMAL)
    logger.verbose('should not appear')
    expect(output).not.toContain('should not appear')

    setLogLevel(LogLevel.VERBOSE)
    logger.verbose('should appear')
    expect(output.some(o => o.includes('should appear'))).toBe(true)
  })

  it('debug() only outputs at DEBUG level', () => {
    const output: string[] = []
    const logger = createLogger({ output: (msg) => output.push(msg) })

    setLogLevel(LogLevel.NORMAL) // INFO level = 2
    logger.debug('should not appear normal')
    expect(output.filter(o => o.includes('should not appear normal')).length).toBe(0)

    setLogLevel(LogLevel.VERBOSE) // VERBOSE = 1, still higher than DEBUG=0
    logger.debug('should not appear verbose')
    expect(output.filter(o => o.includes('should not appear verbose')).length).toBe(0)

    setLogLevel(LogLevel.DEBUG) // DEBUG = 0, allows debug messages
    logger.debug('should appear debug')
    expect(output.some(o => o.includes('should appear debug'))).toBe(true)
  })

  it('error() always outputs regardless of log level', () => {
    const errorOutput: string[] = []
    // error() uses errorOutput, not output
    const logger = createLogger({ errorOutput: (msg) => errorOutput.push(msg) })

    setLogLevel(LogLevel.NORMAL)
    logger.error('error message')

    expect(errorOutput.some(o => o.includes('error message'))).toBe(true)
  })
})

// ============================================================================
// --verbose flag shows RPC messages
// ============================================================================

describe('--verbose flag with eval command', () => {
  it('shows request details when verbose is true', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: 2 }),
    })

    await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
      verbose: true,
    })

    // Should show request URL or POST method in verbose output
    expect(output.some(o => o.includes('api.test.com') || o.includes('POST') || o.includes('REQUEST'))).toBe(true)
  })

  it('shows response details when verbose is true', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: 2 }),
    })

    setLogLevel(LogLevel.VERBOSE)
    await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
      verbose: true,
    })

    // Should show response status
    expect(output.some(o => o.includes('200') || o.includes('OK') || o.includes('response'))).toBe(true)
  })

  it('shows timing information when verbose is true', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })

    setLogLevel(LogLevel.VERBOSE)
    await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
      verbose: true,
    })

    // Should show timing (ms or milliseconds)
    expect(output.some(o => o.includes('ms') || o.includes('timing') || o.includes('took'))).toBe(true)
  })

  it('does not show verbose output when verbose is false', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })

    setLogLevel(LogLevel.NORMAL)
    await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
      verbose: false,
    })

    // Should only show result, not request/response details
    expect(output.length).toBe(1) // Just the result
    expect(output[0]).toBe('2')
  })
})

// ============================================================================
// --debug flag shows even more detail
// ============================================================================

describe('--debug flag with eval command', () => {
  it('shows request body when debug is true', async () => {
    const endpoint = 'https://api.test.com'
    const code = '$.things.list()'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: [] }),
    })

    setLogLevel(LogLevel.DEBUG)
    await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
      debug: true,
    })

    // Should show request body
    expect(output.some(o => o.includes('$.things.list()') || o.includes('body') || o.includes('request'))).toBe(true)
  })

  it('shows response body when debug is true', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })

    setLogLevel(LogLevel.DEBUG)
    await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
      debug: true,
    })

    // Should show response body details
    expect(output.some(o => o.includes('result') || o.includes('response'))).toBe(true)
  })

  it('shows auth token status when debug is true', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })

    setLogLevel(LogLevel.DEBUG)
    await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
      debug: true,
      authToken: 'test-token',
    })

    // Should show auth status (token present/absent)
    expect(output.some(o =>
      o.toLowerCase().includes('auth') ||
      o.toLowerCase().includes('token') ||
      o.toLowerCase().includes('bearer')
    )).toBe(true)
  })

  it('shows auth absent status when no token provided', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })

    setLogLevel(LogLevel.DEBUG)
    await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
      debug: true,
    })

    // Should show auth status indicating no token
    expect(output.some(o =>
      o.toLowerCase().includes('no auth') ||
      o.toLowerCase().includes('anonymous') ||
      o.toLowerCase().includes('auth:')
    )).toBe(true)
  })

  it('debug includes everything verbose includes', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: 2 }),
    })

    setLogLevel(LogLevel.DEBUG)
    await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
      debug: true,
    })

    // Should have timing info (from verbose)
    expect(output.some(o => o.includes('ms') || o.includes('timing') || o.includes('took'))).toBe(true)
    // Should have request info
    expect(output.some(o => o.includes('api.test.com') || o.includes('POST') || o.includes('_eval'))).toBe(true)
  })
})

// ============================================================================
// --verbose with pull command
// ============================================================================

describe('--verbose flag with pull command', () => {
  it('shows request details when verbose is true', async () => {
    const typesDef = 'export interface $ { test(): void }'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })

    setLogLevel(LogLevel.VERBOSE)
    await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
      onProgress: (msg) => output.push(msg),
      verbose: true,
    })

    // Should show request details
    expect(output.some(o => o.includes('_types') || o.includes('POST'))).toBe(true)
  })

  it('shows timing when verbose is true', async () => {
    const typesDef = 'export interface $ { test(): void }'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(typesDef),
    })

    setLogLevel(LogLevel.VERBOSE)
    await pull({
      endpoint: 'https://api.test.com',
      cwd: tempDir,
      onProgress: (msg) => output.push(msg),
      verbose: true,
    })

    // Should show timing
    expect(output.some(o => o.includes('ms') || o.includes('timing') || o.includes('took'))).toBe(true)
  })
})

// ============================================================================
// Environment variable support
// ============================================================================

describe('Environment variable support', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    // Reset log level
    setLogLevel(LogLevel.NORMAL)
  })

  afterEach(() => {
    process.env = originalEnv
    setLogLevel(LogLevel.NORMAL)
  })

  it('RPC_DO_VERBOSE=1 enables verbose mode', () => {
    process.env.RPC_DO_VERBOSE = '1'
    // Already imported at top, just call the function
    expect(getLogLevelFromEnv()).toBe(LogLevel.VERBOSE)
  })

  it('RPC_DO_DEBUG=1 enables debug mode', () => {
    process.env.RPC_DO_DEBUG = '1'
    expect(getLogLevelFromEnv()).toBe(LogLevel.DEBUG)
  })

  it('DEBUG=rpc.do enables debug mode', () => {
    process.env.DEBUG = 'rpc.do'
    expect(getLogLevelFromEnv()).toBe(LogLevel.DEBUG)
  })

  it('DEBUG=rpc.do:* enables debug mode', () => {
    process.env.DEBUG = 'rpc.do:*'
    expect(getLogLevelFromEnv()).toBe(LogLevel.DEBUG)
  })

  it('command line flag overrides environment variable', async () => {
    process.env.RPC_DO_VERBOSE = '1'

    const endpoint = 'https://api.test.com'
    const code = '1+1'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })

    // Explicitly set to not verbose via option
    setLogLevel(LogLevel.NORMAL)
    await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
      verbose: false, // Explicitly false overrides env
    })

    // Should only have result, no verbose output
    expect(output.length).toBe(1)
    expect(output[0]).toBe('2')
  })
})

// ============================================================================
// CLI integration - flags are wired correctly
// ============================================================================

describe('CLI integration', () => {
  it('EvalOptions includes verbose and debug fields', () => {
    // Type check - these should be valid options
    const options: EvalOptions = {
      verbose: true,
      debug: false,
    }
    expect(options.verbose).toBe(true)
    expect(options.debug).toBe(false)
  })

  it('verbose=true implies verbose output', async () => {
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })

    await evalCommand('https://api.test.com', '1+1', {
      onOutput: (msg) => output.push(msg),
      verbose: true,
    })

    // Should have more than just the result
    expect(output.length).toBeGreaterThan(1)
  })

  it('debug=true implies debug output', async () => {
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })

    await evalCommand('https://api.test.com', '1+1', {
      onOutput: (msg) => output.push(msg),
      debug: true,
    })

    // Should have more than just the result (debug output)
    expect(output.length).toBeGreaterThan(1)
  })
})

// ============================================================================
// Output formatting
// ============================================================================

describe('Verbose output formatting', () => {
  it('prefixes verbose messages with [VERBOSE] or similar indicator', async () => {
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })

    setLogLevel(LogLevel.VERBOSE)
    await evalCommand('https://api.test.com', '1+1', {
      onOutput: (msg) => output.push(msg),
      verbose: true,
    })

    // Verbose messages should be distinguishable
    const verboseMessages = output.filter(o =>
      o.includes('[') || o.includes('>') || o.includes(':')
    )
    expect(verboseMessages.length).toBeGreaterThan(0)
  })

  it('prefixes debug messages with [DEBUG] or similar indicator', async () => {
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })

    setLogLevel(LogLevel.DEBUG)
    await evalCommand('https://api.test.com', '1+1', {
      onOutput: (msg) => output.push(msg),
      debug: true,
    })

    // Debug messages should be distinguishable
    const debugMessages = output.filter(o =>
      o.includes('[') || o.includes('DEBUG') || o.includes('>')
    )
    expect(debugMessages.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Verbose output goes to stderr (configurable via errorOutput)
// ============================================================================

describe('Verbose output destination', () => {
  it('error() uses errorOutput (stderr by default)', () => {
    const errorOutput: string[] = []
    const regularOutput: string[] = []
    const logger = createLogger({
      output: (msg) => regularOutput.push(msg),
      errorOutput: (msg) => errorOutput.push(msg),
    })

    logger.error('error message')

    // Error should go to errorOutput, not regular output
    expect(errorOutput.some(o => o.includes('error message'))).toBe(true)
    expect(regularOutput.some(o => o.includes('error message'))).toBe(false)
  })

  it('verbose/debug messages use regular output (configurable)', () => {
    const output: string[] = []
    const logger = createLogger({ output: (msg) => output.push(msg) })

    setLogLevel(LogLevel.DEBUG)
    logger.verbose('verbose message')
    logger.debug('debug message')

    expect(output.some(o => o.includes('verbose message'))).toBe(true)
    expect(output.some(o => o.includes('debug message'))).toBe(true)
  })
})

// ============================================================================
// Transport events logging
// ============================================================================

describe('Transport events logging', () => {
  it('logs transport errors in verbose mode', async () => {
    const output: string[] = []

    // Simulate network error
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))

    setLogLevel(LogLevel.VERBOSE)
    await evalCommand('https://api.test.com', '1+1', {
      onOutput: (msg) => output.push(msg),
      verbose: true,
    })

    // Should show error message and timing
    expect(output.some(o =>
      o.toLowerCase().includes('error') ||
      o.toLowerCase().includes('failed') ||
      o.toLowerCase().includes('connection')
    )).toBe(true)
  })

  it('logs connection/request info in verbose mode', async () => {
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: 2 }),
    })

    setLogLevel(LogLevel.VERBOSE)
    await evalCommand('https://api.test.com', '1+1', {
      onOutput: (msg) => output.push(msg),
      verbose: true,
    })

    // Should show request being made (transport connect)
    expect(output.some(o =>
      o.includes('api.test.com') ||
      o.includes('POST') ||
      o.includes('REQUEST')
    )).toBe(true)
  })
})

// ============================================================================
// REPL verbose support (structural test - REPL options interface)
// ============================================================================

describe('REPL verbose support', () => {
  it('ReplServiceOptions should support verbose logging configuration', async () => {
    // This is a structural test - we're verifying the interface supports
    // verbose logging through the output callback
    const { ReplService } = await import('../src/cli/repl')

    // Create a mock transport
    const mockTransport = {
      send: vi.fn().mockResolvedValue({ result: 'test' }),
    }

    const output: string[] = []
    const repl = new ReplService({
      transport: mockTransport as any,
      output: (msg) => output.push(msg),
    })

    // Verify we can access the REPL's output function
    expect(repl).toBeDefined()
  })

  it('createLogger can be used with REPL output function', () => {
    const output: string[] = []
    const logger = createLogger({ output: (msg) => output.push(msg) })

    setLogLevel(LogLevel.VERBOSE)
    logger.verbose('REPL verbose message')

    expect(output.some(o => o.includes('REPL verbose message'))).toBe(true)
  })
})
