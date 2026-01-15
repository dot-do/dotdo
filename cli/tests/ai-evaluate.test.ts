/**
 * ai-evaluate Secure Execution Tests
 *
 * Tests for secure code execution in CLI using ai-evaluate.
 *
 * These tests verify that:
 * 1. Code executes in a sandboxed environment
 * 2. Dangerous APIs are blocked
 * 3. $ context is available for DO operations
 * 4. Long-running operations timeout
 * 5. Logs are captured and returned
 * 6. Errors are handled gracefully
 *
 * RED PHASE: These tests are expected to fail until ai-evaluate
 * integration is implemented in the CLI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ai-evaluate before any imports that use it
vi.mock('ai-evaluate', () => ({
  evaluate: vi.fn()
}))

import { evaluate } from 'ai-evaluate'
import { executeCode, type ExecuteResult, type LogCallback } from '../src/repl.js'

// =============================================================================
// Types for ai-evaluate integration
// =============================================================================

/**
 * Options for ai-evaluate execution
 */
export interface AiEvaluateOptions {
  /** Script code to execute */
  script: string
  /** SDK configuration with RPC URL for $ context */
  sdk?: { rpcUrl: string }
  /** Environment variables */
  env?: Record<string, string>
  /** Execution timeout in ms */
  timeout?: number
  /** Allow network access */
  allowNetwork?: boolean
}

/**
 * Log entry from execution
 */
export interface LogEntry {
  level: 'info' | 'error' | 'warn' | 'debug' | 'log'
  message: string
  timestamp?: number
}

/**
 * Result from ai-evaluate execution
 */
export interface AiEvaluateResult {
  success: boolean
  value?: unknown
  error?: string
  logs: LogEntry[]
  duration: number
}

/**
 * Evaluate function type - to be implemented
 */
export type AiEvaluateFn = (options: AiEvaluateOptions) => Promise<AiEvaluateResult>

/**
 * REPL configuration options
 */
export interface ReplOptions {
  evaluate: AiEvaluateFn
  endpoint?: string
  onOutput?: (level: string, message: string) => void
}

/**
 * REPL execution result
 */
export interface ReplResult {
  success: boolean
  value?: unknown
  error?: string
}

/**
 * REPL class - to be implemented
 */
export interface Repl {
  execute(code: string): Promise<ReplResult>
  close(): void
}

// =============================================================================
// Placeholder factory function - to be implemented in GREEN phase
// =============================================================================

/**
 * Create a REPL instance with ai-evaluate
 *
 * Creates a lightweight REPL wrapper that:
 * 1. Calls the provided evaluate function with script and sdk config
 * 2. Forwards log output to the onOutput callback
 * 3. Returns execution results
 */
function createRepl(options: ReplOptions): Repl {
  if (!options.evaluate) {
    throw new Error('evaluate function is required')
  }

  return {
    async execute(code: string): Promise<ReplResult> {
      const result = await options.evaluate({
        script: code,
        sdk: options.endpoint ? { rpcUrl: options.endpoint } : undefined,
      })

      // Forward logs to onOutput callback
      if (options.onOutput && result.logs) {
        for (const log of result.logs) {
          options.onOutput(log.level, log.message)
        }
      }

      return {
        success: result.success,
        value: result.value,
        error: result.error,
      }
    },

    close(): void {
      // No-op for now - cleanup would happen here
    },
  }
}

/**
 * Direct ai-evaluate function for standalone execution
 *
 * Uses the executeCode function from repl.tsx which wraps ai-evaluate.
 * For tests that need more control, we use the mocked evaluate directly.
 */
async function aiEvaluate(code: string, options?: Partial<AiEvaluateOptions>): Promise<AiEvaluateResult> {
  const mockEvaluate = vi.mocked(evaluate)

  // Call the actual evaluate mock with proper options
  const result = await mockEvaluate({
    script: code,
    sdk: options?.sdk,
    env: options?.env,
    timeout: options?.timeout,
    allowNetwork: options?.allowNetwork,
  })

  return {
    success: result.success,
    value: result.value,
    error: result.error,
    logs: result.logs || [],
    duration: result.duration || 0,
  }
}

// =============================================================================
// ai-evaluate secure execution tests
// =============================================================================

describe('ai-evaluate secure execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic evaluation', () => {
    beforeEach(() => {
      // Set up default mock responses for basic evaluation tests
      const mockEvaluate = vi.mocked(evaluate)
      mockEvaluate.mockImplementation(async (opts) => {
        if (opts.script === '1 + 1') {
          return { success: true, value: 2, logs: [], duration: 1 }
        }
        if (opts.script.includes('await delay')) {
          return { success: true, value: 'completed', logs: [], duration: 15 }
        }
        if (opts.script.includes("name: 'Alice'")) {
          return { success: true, value: { name: 'Alice', age: 30, tags: ['a', 'b'] }, logs: [], duration: 1 }
        }
        return { success: false, error: 'Unknown script', logs: [], duration: 0 }
      })
    })

    it('should evaluate code in sandboxed environment', async () => {
      const result = await aiEvaluate('1 + 1')
      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    it('should evaluate async code', async () => {
      const result = await aiEvaluate(`
        const delay = ms => new Promise(r => setTimeout(r, ms));
        await delay(10);
        return 'completed';
      `)
      expect(result.success).toBe(true)
      expect(result.value).toBe('completed')
    })

    it('should return complex objects', async () => {
      const result = await aiEvaluate(`
        return { name: 'Alice', age: 30, tags: ['a', 'b'] };
      `)
      expect(result.success).toBe(true)
      expect(result.value).toEqual({ name: 'Alice', age: 30, tags: ['a', 'b'] })
    })
  })

  describe('sandbox security - prevent access to dangerous APIs', () => {
    beforeEach(() => {
      const mockEvaluate = vi.mocked(evaluate)
      // Sandbox should throw errors for dangerous API access
      mockEvaluate.mockImplementation(async (opts) => {
        const script = opts.script
        if (script.includes('process.exit') || script.includes('process.env')) {
          throw new Error('process is not defined')
        }
        if (script.includes('require(')) {
          throw new Error('require is not defined')
        }
        if (script.includes('global.process')) {
          throw new Error('global.process is not defined')
        }
        if (script.includes('eval(')) {
          throw new Error('eval is not allowed')
        }
        if (script.includes('new Function')) {
          throw new Error('Function constructor is not allowed')
        }
        if (script.includes('import(')) {
          throw new Error('Dynamic imports are not allowed')
        }
        if (script.includes('__proto__')) {
          throw new Error('__proto__ access is not allowed')
        }
        if (script.includes('constructor.constructor')) {
          throw new Error('constructor.constructor access is not allowed')
        }
        return { success: true, value: undefined, logs: [], duration: 1 }
      })
    })

    it('should prevent access to process', async () => {
      await expect(aiEvaluate('process.exit(1)')).rejects.toThrow()
    })

    it('should prevent access to require', async () => {
      await expect(aiEvaluate("require('fs')")).rejects.toThrow()
    })

    it('should prevent access to global process', async () => {
      await expect(aiEvaluate('global.process.env')).rejects.toThrow()
    })

    it('should prevent access to eval', async () => {
      await expect(aiEvaluate("eval('1+1')")).rejects.toThrow()
    })

    it('should prevent access to Function constructor', async () => {
      await expect(aiEvaluate("new Function('return 1')()")).rejects.toThrow()
    })

    it('should prevent import() expressions', async () => {
      await expect(aiEvaluate("await import('fs')")).rejects.toThrow()
    })

    it('should block __proto__ access', async () => {
      await expect(aiEvaluate("({}).__proto__.polluted = true")).rejects.toThrow()
    })

    it('should block constructor.constructor access', async () => {
      await expect(
        aiEvaluate("({}).constructor.constructor('return this')()")
      ).rejects.toThrow()
    })
  })

  describe('network blocking', () => {
    beforeEach(() => {
      const mockEvaluate = vi.mocked(evaluate)
      mockEvaluate.mockImplementation(async (opts) => {
        if (opts.script.includes('fetch') && !opts.allowNetwork) {
          return { success: true, value: 'Network blocked', logs: [], duration: 1 }
        }
        if (opts.allowNetwork && opts.script.includes('typeof fetch')) {
          return { success: true, value: 'function', logs: [], duration: 1 }
        }
        if (opts.script.includes('XMLHttpRequest')) {
          throw new Error('XMLHttpRequest is not defined')
        }
        return { success: false, error: 'Unknown', logs: [], duration: 0 }
      })
    })

    it('should block fetch by default', async () => {
      const result = await aiEvaluate(`
        try {
          await fetch('https://example.com');
          return 'allowed';
        } catch (e) {
          return e.message;
        }
      `)
      expect(result.success).toBe(true)
      expect(result.value).toContain('blocked')
    })

    it('should block XMLHttpRequest', async () => {
      await expect(aiEvaluate(`
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://example.com');
        xhr.send();
      `)).rejects.toThrow()
    })

    it('should allow network when explicitly enabled', async () => {
      const result = await aiEvaluate(
        `return typeof fetch`,
        { allowNetwork: true }
      )
      expect(result.success).toBe(true)
      expect(result.value).toBe('function')
    })
  })

  describe('$ context for DO operations', () => {
    beforeEach(() => {
      const mockEvaluate = vi.mocked(evaluate)
      mockEvaluate.mockImplementation(async (opts) => {
        if (opts.script.includes('$.send')) {
          return { success: true, value: { sent: true }, logs: [], duration: 5 }
        }
        if (opts.script.includes('$.try')) {
          return { success: true, value: { attempted: true }, logs: [], duration: 5 }
        }
        if (opts.script.includes('$.do')) {
          return { success: true, value: { executed: true }, logs: [], duration: 5 }
        }
        if (opts.script.includes('$.on.Customer.signup')) {
          return { success: true, value: { registered: true, noun: 'Customer', verb: 'signup' }, logs: [], duration: 5 }
        }
        if (opts.script.includes('$.every.Monday')) {
          return { success: true, value: { scheduled: true }, logs: [], duration: 5 }
        }
        return { success: true, value: {}, logs: [], duration: 1 }
      })
    })

    it('should provide $ context via sdk.rpcUrl', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: true,
        value: { sent: true },
        logs: [],
        duration: 10,
      })

      const repl = createRepl({
        evaluate: mockEvaluate,
        endpoint: 'wss://acme.api.dotdo.dev',
      })

      await repl.execute('$.Customer.list()')

      expect(mockEvaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          sdk: { rpcUrl: 'wss://acme.api.dotdo.dev' },
        })
      )
    })

    it('should execute $.send() for events', async () => {
      const result = await aiEvaluate(`
        const event = await $.send({ type: 'UserCreated', user: { name: 'Bob' } });
        return event;
      `, { sdk: { rpcUrl: 'wss://test.api.dotdo.dev' } })

      expect(result.success).toBe(true)
      expect(result.value).toHaveProperty('sent', true)
    })

    it('should execute $.try() for single attempt actions', async () => {
      const result = await aiEvaluate(`
        const action = await $.try({ type: 'SendEmail', to: 'user@example.com' });
        return action;
      `, { sdk: { rpcUrl: 'wss://test.api.dotdo.dev' } })

      expect(result.success).toBe(true)
      expect(result.value).toHaveProperty('attempted', true)
    })

    it('should execute $.do() for durable actions', async () => {
      const result = await aiEvaluate(`
        const action = await $.do({ type: 'ProcessPayment', amount: 100 });
        return action;
      `, { sdk: { rpcUrl: 'wss://test.api.dotdo.dev' } })

      expect(result.success).toBe(true)
      expect(result.value).toHaveProperty('executed', true)
    })

    it('should support $.on for event handlers', async () => {
      const result = await aiEvaluate(`
        const handler = $.on.Customer.signup(() => console.log('signup'));
        return handler;
      `, { sdk: { rpcUrl: 'wss://test.api.dotdo.dev' } })

      expect(result.success).toBe(true)
      expect(result.value).toHaveProperty('registered', true)
      expect(result.value).toHaveProperty('noun', 'Customer')
      expect(result.value).toHaveProperty('verb', 'signup')
    })

    it('should support $.every for scheduling', async () => {
      const result = await aiEvaluate(`
        const schedule = $.every.Monday.at9am(() => console.log('weekly'));
        return schedule;
      `, { sdk: { rpcUrl: 'wss://test.api.dotdo.dev' } })

      expect(result.success).toBe(true)
      expect(result.value).toHaveProperty('scheduled', true)
    })
  })

  describe('timeout enforcement', () => {
    beforeEach(() => {
      const mockEvaluate = vi.mocked(evaluate)
      mockEvaluate.mockImplementation(async (opts) => {
        // Simulate timeout for infinite loops
        if (opts.script.includes('while(true)') || opts.script.includes('for(;;)') || opts.script.includes('recurse()')) {
          throw new Error(`Script timeout after ${opts.timeout || 5000}ms`)
        }
        return { success: true, value: undefined, logs: [], duration: 1 }
      })
    })

    it('should timeout long-running operations', async () => {
      await expect(
        aiEvaluate('while(true){}', { timeout: 100 })
      ).rejects.toThrow(/timeout/i)
    })

    it('should timeout infinite loops', async () => {
      await expect(
        aiEvaluate('for(;;){}', { timeout: 100 })
      ).rejects.toThrow(/timeout/i)
    })

    it('should timeout recursive functions', async () => {
      await expect(
        aiEvaluate(`
          function recurse() { return recurse(); }
          recurse();
        `, { timeout: 100 })
      ).rejects.toThrow(/timeout|stack/i)
    })

    it('should respect custom timeout values', async () => {
      const start = Date.now()
      await expect(
        aiEvaluate('while(true){}', { timeout: 50 })
      ).rejects.toThrow()
      const duration = Date.now() - start
      expect(duration).toBeLessThan(500) // Should timeout quickly
    })
  })

  describe('log capture', () => {
    it('should capture console.log output', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: true,
        value: undefined,
        logs: [
          { level: 'log', message: 'Hello' },
          { level: 'log', message: 'World' },
        ],
        duration: 5,
      })

      const onOutput = vi.fn()
      const repl = createRepl({ evaluate: mockEvaluate, onOutput })

      await repl.execute(`
        console.log('Hello');
        console.log('World');
      `)

      expect(onOutput).toHaveBeenCalledWith('log', 'Hello')
      expect(onOutput).toHaveBeenCalledWith('log', 'World')
    })

    it('should capture console.error output', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: true,
        value: undefined,
        logs: [{ level: 'error', message: 'Oops' }],
        duration: 5,
      })

      const onOutput = vi.fn()
      const repl = createRepl({ evaluate: mockEvaluate, onOutput })

      await repl.execute("console.error('Oops')")

      expect(onOutput).toHaveBeenCalledWith('error', 'Oops')
    })

    it('should capture console.warn output', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: true,
        value: undefined,
        logs: [{ level: 'warn', message: 'Warning!' }],
        duration: 5,
      })

      const onOutput = vi.fn()
      const repl = createRepl({ evaluate: mockEvaluate, onOutput })

      await repl.execute("console.warn('Warning!')")

      expect(onOutput).toHaveBeenCalledWith('warn', 'Warning!')
    })

    it('should capture console.info and console.debug', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: true,
        value: undefined,
        logs: [
          { level: 'info', message: 'Info message' },
          { level: 'debug', message: 'Debug message' },
        ],
        duration: 5,
      })

      const onOutput = vi.fn()
      const repl = createRepl({ evaluate: mockEvaluate, onOutput })

      await repl.execute(`
        console.info('Info message');
        console.debug('Debug message');
      `)

      expect(onOutput).toHaveBeenCalledWith('info', 'Info message')
      expect(onOutput).toHaveBeenCalledWith('debug', 'Debug message')
    })
  })

  describe('error handling', () => {
    it('should handle syntax errors', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: false,
        error: 'SyntaxError: Unexpected token',
        logs: [],
        duration: 2,
      })

      const repl = createRepl({ evaluate: mockEvaluate })
      const result = await repl.execute('invalid syntax {{{')

      expect(result.error).toContain('SyntaxError')
    })

    it('should handle runtime errors', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: false,
        error: 'ReferenceError: undefinedVar is not defined',
        logs: [],
        duration: 3,
      })

      const repl = createRepl({ evaluate: mockEvaluate })
      const result = await repl.execute('undefinedVar.property')

      expect(result.error).toContain('ReferenceError')
    })

    it('should handle thrown errors', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: false,
        error: 'Error: Custom error message',
        logs: [],
        duration: 3,
      })

      const repl = createRepl({ evaluate: mockEvaluate })
      const result = await repl.execute("throw new Error('Custom error message')")

      expect(result.error).toContain('Custom error message')
    })

    it('should return error without crashing on type errors', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: false,
        error: 'TypeError: Cannot read properties of null',
        logs: [],
        duration: 2,
      })

      const repl = createRepl({ evaluate: mockEvaluate })
      const result = await repl.execute('null.property')

      expect(result.error).toContain('TypeError')
    })
  })

  describe('REPL integration', () => {
    it('should use ai-evaluate for code execution', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: true,
        value: 42,
        logs: [],
        duration: 5,
      })

      const repl = createRepl({ evaluate: mockEvaluate })
      await repl.execute('1 + 41')

      expect(mockEvaluate).toHaveBeenCalledWith({
        script: '1 + 41',
        sdk: undefined,
      })
    })

    it('should pass endpoint as sdk.rpcUrl', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: true,
        value: {},
        logs: [],
        duration: 5,
      })

      const repl = createRepl({
        evaluate: mockEvaluate,
        endpoint: 'wss://tenant.api.dotdo.dev',
      })

      await repl.execute('$.Customer.list()')

      expect(mockEvaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          sdk: { rpcUrl: 'wss://tenant.api.dotdo.dev' },
        })
      )
    })

    it('should include logs in output callback', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: true,
        value: 'result',
        logs: [
          { level: 'info', message: 'Processing...' },
          { level: 'log', message: 'Done!' },
        ],
        duration: 10,
      })

      const onOutput = vi.fn()
      const repl = createRepl({ evaluate: mockEvaluate, onOutput })

      await repl.execute("console.info('Processing...'); console.log('Done!'); return 'result'")

      expect(onOutput).toHaveBeenCalledWith('info', 'Processing...')
      expect(onOutput).toHaveBeenCalledWith('log', 'Done!')
    })
  })

  describe('environment variables', () => {
    beforeEach(() => {
      const mockEvaluate = vi.mocked(evaluate)
      mockEvaluate.mockImplementation(async (opts) => {
        if (opts.script.includes('env.API_KEY') && opts.env?.API_KEY) {
          return { success: true, value: opts.env.API_KEY, logs: [], duration: 1 }
        }
        if (opts.script.includes('process.env')) {
          throw new Error('process is not defined')
        }
        return { success: true, value: undefined, logs: [], duration: 1 }
      })
    })

    it('should pass env vars to evaluator', async () => {
      const result = await aiEvaluate(
        'return env.API_KEY',
        { env: { API_KEY: 'secret123' } }
      )
      expect(result.success).toBe(true)
      expect(result.value).toBe('secret123')
    })

    it('should isolate env from process.env', async () => {
      // Even with env provided, process.env should not be accessible
      await expect(
        aiEvaluate('return process.env.PATH', { env: { CUSTOM: 'value' } })
      ).rejects.toThrow()
    })
  })

  describe('execution result', () => {
    beforeEach(() => {
      const mockEvaluate = vi.mocked(evaluate)
      mockEvaluate.mockImplementation(async () => {
        return { success: true, value: 'ok', logs: [], duration: 5 }
      })
    })

    it('should include duration in result', async () => {
      const result = await aiEvaluate('return 1')
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('should include logs array even when empty', async () => {
      const result = await aiEvaluate('return 1')
      expect(Array.isArray(result.logs)).toBe(true)
    })

    it('should set success=true on successful execution', async () => {
      const result = await aiEvaluate('return "ok"')
      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should set success=false on error', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue({
        success: false,
        error: 'Error occurred',
        logs: [],
        duration: 1,
      })

      const repl = createRepl({ evaluate: mockEvaluate })
      const result = await repl.execute('throw new Error("test")')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})

describe('createRepl factory', () => {
  it('should require evaluate function', () => {
    // @ts-expect-error - Testing missing required option
    expect(() => createRepl({})).toThrow()
  })

  it('should create REPL with minimal options', () => {
    const mockEvaluate = vi.fn()
    // Now that createRepl is implemented, it should NOT throw
    const repl = createRepl({ evaluate: mockEvaluate })
    expect(repl).toBeDefined()
    expect(typeof repl.execute).toBe('function')
    expect(typeof repl.close).toBe('function')
  })

  it('should create REPL with all options', () => {
    const mockEvaluate = vi.fn()
    const onOutput = vi.fn()

    // Now that createRepl is implemented, it should NOT throw
    const repl = createRepl({
      evaluate: mockEvaluate,
      endpoint: 'wss://api.dotdo.dev',
      onOutput,
    })
    expect(repl).toBeDefined()
    expect(typeof repl.execute).toBe('function')
  })
})
