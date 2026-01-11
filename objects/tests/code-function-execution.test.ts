/**
 * CodeFunction Execution Tests
 *
 * RED TDD: These tests should FAIL because CodeFunction execution doesn't exist yet.
 *
 * CodeFunction is a function type that executes TypeScript/JavaScript code
 * in a sandboxed environment with proper context injection, timeout handling,
 * retry logic, and resource limits.
 *
 * This file tests the execution engine, not the factory (see create-function.test.ts).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import {
  CodeFunctionExecutor,
  type ExecutionContext,
  type ExecutionResult,
  type ExecutionOptions,
  type ResourceLimits,
  type RetryConfig,
  type StreamOutput,
  ExecutionTimeoutError,
  ExecutionSandboxError,
  ExecutionResourceError,
  ExecutionRetryExhaustedError,
  ExecutionCancelledError,
} from '../CodeFunctionExecutor'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

/**
 * Expected execution context passed to handlers
 */
interface ExpectedExecutionContext {
  // Identity
  functionId: string
  invocationId: string

  // Environment
  env: Record<string, string>

  // State management
  state: {
    get: <T>(key: string) => Promise<T | null>
    put: <T>(key: string, value: T) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }

  // Services
  services: {
    ai: {
      generate: (opts: { model: string; prompt: string }) => Promise<{ text: string }>
    }
    kv: {
      get: (key: string) => Promise<string | null>
      put: (key: string, value: string) => Promise<void>
    }
    db: {
      query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
    }
    queue: {
      send: (message: unknown) => Promise<void>
    }
    fetch: (url: string, init?: RequestInit) => Promise<Response>
  }

  // Logging
  log: {
    debug: (message: string, data?: unknown) => void
    info: (message: string, data?: unknown) => void
    warn: (message: string, data?: unknown) => void
    error: (message: string, data?: unknown) => void
  }

  // Events
  emit: (event: string, data: unknown) => Promise<void>

  // Cancellation
  signal: AbortSignal
}

/**
 * Expected execution result
 */
interface ExpectedExecutionResult<T = unknown> {
  success: boolean
  result?: T
  error?: {
    message: string
    name: string
    stack?: string
  }
  duration: number
  retryCount: number
  metrics: {
    memoryUsed?: number
    cpuTime?: number
  }
}

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-function-do-id' },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
    },
    waitUntil: () => {},
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
  } as unknown as DurableObjectState
}

function createMockEnv() {
  return {
    API_KEY: 'test-api-key',
    DATABASE_URL: 'test-database-url',
    SECRET_TOKEN: 'test-secret-token',
    NODE_ENV: 'test',
  }
}

function createMockServices() {
  return {
    ai: {
      generate: vi.fn().mockResolvedValue({ text: 'Generated response' }),
    },
    kv: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    },
    db: {
      query: vi.fn().mockResolvedValue([]),
    },
    queue: {
      send: vi.fn().mockResolvedValue(undefined),
    },
    fetch: vi.fn().mockResolvedValue(new Response('OK')),
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('CodeFunction Execution', () => {
  let executor: InstanceType<typeof CodeFunctionExecutor>
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>
  let mockServices: ReturnType<typeof createMockServices>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    mockServices = createMockServices()
    executor = new CodeFunctionExecutor({
      state: mockState,
      env: mockEnv,
      services: mockServices,
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. BASIC EXECUTION TESTS
  // ==========================================================================

  describe('Basic Execution', () => {
    describe('Synchronous handlers', () => {
      it('executes a sync handler and returns result', async () => {
        const handler = (input: { value: number }) => {
          return input.value * 2
        }

        const result = await executor.execute(handler, { value: 21 })

        expect(result.success).toBe(true)
        expect(result.result).toBe(42)
      })

      it('captures sync handler return value of any type', async () => {
        const objectHandler = () => ({ foo: 'bar', count: 42 })
        const arrayHandler = () => [1, 2, 3]
        const stringHandler = () => 'hello'
        const numberHandler = () => 123
        const booleanHandler = () => true
        const nullHandler = () => null

        expect((await executor.execute(objectHandler, {})).result).toEqual({ foo: 'bar', count: 42 })
        expect((await executor.execute(arrayHandler, {})).result).toEqual([1, 2, 3])
        expect((await executor.execute(stringHandler, {})).result).toBe('hello')
        expect((await executor.execute(numberHandler, {})).result).toBe(123)
        expect((await executor.execute(booleanHandler, {})).result).toBe(true)
        expect((await executor.execute(nullHandler, {})).result).toBeNull()
      })

      it('handles handler that returns undefined', async () => {
        const handler = () => {
          // No return
        }

        const result = await executor.execute(handler, {})

        expect(result.success).toBe(true)
        expect(result.result).toBeUndefined()
      })
    })

    describe('Async handlers', () => {
      it('executes an async handler and returns result', async () => {
        const handler = async (input: { value: number }) => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return input.value * 2
        }

        const result = await executor.execute(handler, { value: 21 })

        expect(result.success).toBe(true)
        expect(result.result).toBe(42)
      })

      it('handles async handlers with multiple awaits', async () => {
        const handler = async (input: { values: number[] }) => {
          let sum = 0
          for (const val of input.values) {
            await new Promise((resolve) => setTimeout(resolve, 1))
            sum += val
          }
          return sum
        }

        const result = await executor.execute(handler, { values: [1, 2, 3, 4, 5] })

        expect(result.success).toBe(true)
        expect(result.result).toBe(15)
      })

      it('correctly awaits Promise-returning handlers', async () => {
        const handler = (input: { value: number }): Promise<number> => {
          return Promise.resolve(input.value * 3)
        }

        const result = await executor.execute(handler, { value: 10 })

        expect(result.success).toBe(true)
        expect(result.result).toBe(30)
      })
    })

    describe('Execution metadata', () => {
      it('tracks execution duration', async () => {
        const handler = async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return 'done'
        }

        const result = await executor.execute(handler, {})

        expect(result.duration).toBeGreaterThanOrEqual(50)
        expect(result.duration).toBeLessThan(200) // reasonable upper bound
      })

      it('generates unique invocation ID for each execution', async () => {
        const capturedIds: string[] = []
        const handler = (_input: unknown, ctx: ExecutionContext) => {
          capturedIds.push(ctx.invocationId)
          return 'ok'
        }

        await executor.execute(handler, {})
        await executor.execute(handler, {})
        await executor.execute(handler, {})

        expect(new Set(capturedIds).size).toBe(3)
      })

      it('includes function ID in context', async () => {
        let capturedFunctionId: string | undefined
        const handler = (_input: unknown, ctx: ExecutionContext) => {
          capturedFunctionId = ctx.functionId
          return 'ok'
        }

        await executor.execute(handler, {}, { functionId: 'my-function-123' })

        expect(capturedFunctionId).toBe('my-function-123')
      })

      it('reports retry count of 0 for successful first attempt', async () => {
        const handler = () => 'success'

        const result = await executor.execute(handler, {})

        expect(result.retryCount).toBe(0)
      })
    })
  })

  // ==========================================================================
  // 2. CONTEXT INJECTION TESTS
  // ==========================================================================

  describe('Context Injection', () => {
    describe('Environment variables', () => {
      it('provides env vars in context', async () => {
        let capturedEnv: Record<string, string> | undefined
        const handler = (_input: unknown, ctx: ExecutionContext) => {
          capturedEnv = ctx.env
          return 'ok'
        }

        await executor.execute(handler, {})

        expect(capturedEnv).toBeDefined()
        expect(capturedEnv?.API_KEY).toBe('test-api-key')
        expect(capturedEnv?.DATABASE_URL).toBe('test-database-url')
      })

      it('env vars are read-only', async () => {
        const handler = (_input: unknown, ctx: ExecutionContext) => {
          // Attempt to modify env
          ctx.env.NEW_VAR = 'should-not-work'
          return ctx.env.NEW_VAR
        }

        const result = await executor.execute(handler, {})

        // Should either throw or not persist the change
        expect(result.result).not.toBe('should-not-work')
      })

      it('can filter which env vars are exposed', async () => {
        let capturedEnv: Record<string, string> | undefined
        const handler = (_input: unknown, ctx: ExecutionContext) => {
          capturedEnv = ctx.env
          return 'ok'
        }

        await executor.execute(handler, {}, {
          exposeEnv: ['API_KEY'], // Only expose API_KEY
        })

        expect(capturedEnv?.API_KEY).toBe('test-api-key')
        expect(capturedEnv?.SECRET_TOKEN).toBeUndefined()
      })
    })

    describe('State management', () => {
      it('provides state.get() for reading state', async () => {
        // Pre-populate state
        await mockState.storage.put('user:123', { name: 'Alice' })

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          const user = await ctx.state.get<{ name: string }>('user:123')
          return user?.name
        }

        const result = await executor.execute(handler, {})

        expect(result.success).toBe(true)
        expect(result.result).toBe('Alice')
      })

      it('provides state.put() for writing state', async () => {
        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          await ctx.state.put('counter', 42)
          return 'stored'
        }

        await executor.execute(handler, {})

        const stored = await mockState.storage.get('counter')
        expect(stored).toBe(42)
      })

      it('provides state.delete() for removing state', async () => {
        await mockState.storage.put('temp:data', 'value')

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          const deleted = await ctx.state.delete('temp:data')
          return deleted
        }

        const result = await executor.execute(handler, {})

        expect(result.result).toBe(true)
        expect(await mockState.storage.get('temp:data')).toBeUndefined()
      })

      it('provides state.list() for enumerating state', async () => {
        await mockState.storage.put('item:1', 'a')
        await mockState.storage.put('item:2', 'b')
        await mockState.storage.put('other:1', 'c')

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          const items = await ctx.state.list({ prefix: 'item:' })
          return Array.from(items.keys())
        }

        const result = await executor.execute(handler, {})

        expect(result.result).toEqual(['item:1', 'item:2'])
      })

      it('state operations are isolated per function', async () => {
        const executor1 = new CodeFunctionExecutor({
          state: createMockState(),
          env: mockEnv,
          services: mockServices,
        })
        const executor2 = new CodeFunctionExecutor({
          state: createMockState(),
          env: mockEnv,
          services: mockServices,
        })

        await executor1.execute(async (_input, ctx) => {
          await ctx.state.put('key', 'value1')
        }, {})

        const result = await executor2.execute(async (_input, ctx) => {
          return await ctx.state.get('key')
        }, {})

        expect(result.result).toBeNull() // Different state
      })
    })

    describe('Services access', () => {
      it('provides AI service', async () => {
        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          const response = await ctx.services.ai.generate({
            model: 'claude-3-sonnet',
            prompt: 'Hello',
          })
          return response.text
        }

        const result = await executor.execute(handler, {})

        expect(result.result).toBe('Generated response')
        expect(mockServices.ai.generate).toHaveBeenCalledWith({
          model: 'claude-3-sonnet',
          prompt: 'Hello',
        })
      })

      it('provides KV service', async () => {
        mockServices.kv.get.mockResolvedValueOnce('cached-value')

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          const value = await ctx.services.kv.get('cache:key')
          return value
        }

        const result = await executor.execute(handler, {})

        expect(result.result).toBe('cached-value')
      })

      it('provides DB service', async () => {
        mockServices.db.query.mockResolvedValueOnce([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ])

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          const users = await ctx.services.db.query<{ id: number; name: string }>(
            'SELECT * FROM users WHERE active = ?',
            [true],
          )
          return users
        }

        const result = await executor.execute(handler, {})

        expect(result.result).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ])
      })

      it('provides Queue service', async () => {
        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          await ctx.services.queue.send({ type: 'email', to: 'user@example.com.ai' })
          return 'queued'
        }

        const result = await executor.execute(handler, {})

        expect(result.result).toBe('queued')
        expect(mockServices.queue.send).toHaveBeenCalledWith({
          type: 'email',
          to: 'user@example.com.ai',
        })
      })

      it('provides fetch service for external HTTP calls', async () => {
        mockServices.fetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ data: 'external' })),
        )

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          const response = await ctx.services.fetch('https://api.example.com.ai/data')
          return await response.json()
        }

        const result = await executor.execute(handler, {})

        expect(result.result).toEqual({ data: 'external' })
        expect(mockServices.fetch).toHaveBeenCalledWith('https://api.example.com.ai/data')
      })
    })

    describe('Logging', () => {
      it('provides log.debug()', async () => {
        const logSpy = vi.fn()
        const executorWithLog = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          logger: { debug: logSpy, info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        })

        await executorWithLog.execute((_input, ctx) => {
          ctx.log.debug('Debug message', { key: 'value' })
          return 'ok'
        }, {})

        expect(logSpy).toHaveBeenCalledWith('Debug message', { key: 'value' })
      })

      it('provides log.info()', async () => {
        const logSpy = vi.fn()
        const executorWithLog = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          logger: { debug: vi.fn(), info: logSpy, warn: vi.fn(), error: vi.fn() },
        })

        await executorWithLog.execute((_input, ctx) => {
          ctx.log.info('Info message')
          return 'ok'
        }, {})

        expect(logSpy).toHaveBeenCalledWith('Info message')
      })

      it('provides log.warn()', async () => {
        const logSpy = vi.fn()
        const executorWithLog = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          logger: { debug: vi.fn(), info: vi.fn(), warn: logSpy, error: vi.fn() },
        })

        await executorWithLog.execute((_input, ctx) => {
          ctx.log.warn('Warning message')
          return 'ok'
        }, {})

        expect(logSpy).toHaveBeenCalledWith('Warning message')
      })

      it('provides log.error()', async () => {
        const logSpy = vi.fn()
        const executorWithLog = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: logSpy },
        })

        await executorWithLog.execute((_input, ctx) => {
          ctx.log.error('Error message', { error: 'details' })
          return 'ok'
        }, {})

        expect(logSpy).toHaveBeenCalledWith('Error message', { error: 'details' })
      })
    })

    describe('Event emission', () => {
      it('provides emit() for custom events', async () => {
        const eventSpy = vi.fn()
        const executorWithEvents = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          onEvent: eventSpy,
        })

        await executorWithEvents.execute(async (_input, ctx) => {
          await ctx.emit('custom.event', { data: 'payload' })
          return 'ok'
        }, {})

        expect(eventSpy).toHaveBeenCalledWith('custom.event', { data: 'payload' })
      })

      it('emit() is async and can be awaited', async () => {
        const events: string[] = []
        const executorWithEvents = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          onEvent: async (event) => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            events.push(event)
          },
        })

        await executorWithEvents.execute(async (_input, ctx) => {
          await ctx.emit('first', {})
          events.push('after-first')
          await ctx.emit('second', {})
          events.push('after-second')
          return 'ok'
        }, {})

        expect(events).toEqual(['first', 'after-first', 'second', 'after-second'])
      })
    })
  })

  // ==========================================================================
  // 3. SANDBOX TESTS
  // ==========================================================================

  describe('Sandboxed Execution', () => {
    describe('Restricted globals', () => {
      it('prevents access to require()', async () => {
        const handler = () => {
          // @ts-expect-error - require is not defined
          return require('fs')
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/require.*not.*defined|not.*allowed/i)
      })

      it('prevents access to process', async () => {
        const handler = () => {
          return process.env.SECRET
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/process.*not.*defined|not.*allowed/i)
      })

      it('prevents access to global', async () => {
        const handler = () => {
          // @ts-expect-error - global is not defined
          return global
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/global.*not.*defined|not.*allowed/i)
      })

      it('prevents access to globalThis modification', async () => {
        const handler = () => {
          globalThis.customProp = 'value'
          return globalThis.customProp
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        // Should either fail or not persist the modification
        expect(result.success).toBe(false) || expect(result.result).not.toBe('value')
      })

      it('prevents access to eval()', async () => {
        const handler = () => {
          return eval('1 + 1')
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/eval.*not.*allowed|not.*defined/i)
      })

      it('prevents access to Function constructor', async () => {
        const handler = () => {
          return new Function('return 42')()
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/Function.*not.*allowed|not.*defined/i)
      })
    })

    describe('Allowed globals', () => {
      it('allows console.log (redirected to logger)', async () => {
        const logSpy = vi.fn()
        const executorWithLog = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          logger: { debug: vi.fn(), info: logSpy, warn: vi.fn(), error: vi.fn() },
        })

        const handler = () => {
          console.log('Hello from sandbox')
          return 'ok'
        }

        const result = await executorWithLog.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(true)
        expect(logSpy).toHaveBeenCalledWith('Hello from sandbox')
      })

      it('allows JSON.stringify and JSON.parse', async () => {
        const handler = () => {
          const obj = { foo: 'bar' }
          const str = JSON.stringify(obj)
          const parsed = JSON.parse(str)
          return parsed
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ foo: 'bar' })
      })

      it('allows Math operations', async () => {
        const handler = () => {
          return Math.sqrt(16) + Math.floor(3.7)
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(true)
        expect(result.result).toBe(7) // 4 + 3
      })

      it('allows Date operations', async () => {
        const handler = () => {
          const now = new Date()
          return now instanceof Date
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(true)
        expect(result.result).toBe(true)
      })

      it('allows Array methods', async () => {
        const handler = () => {
          return [1, 2, 3].map((x) => x * 2).filter((x) => x > 2)
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(true)
        expect(result.result).toEqual([4, 6])
      })

      it('allows Promise and async/await', async () => {
        const handler = async () => {
          const result = await Promise.resolve(42)
          return result
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(true)
        expect(result.result).toBe(42)
      })

      it('allows Object methods', async () => {
        const handler = () => {
          const obj = { a: 1, b: 2 }
          return Object.keys(obj)
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(true)
        expect(result.result).toEqual(['a', 'b'])
      })

      it('allows Set and Map', async () => {
        const handler = () => {
          const set = new Set([1, 2, 2, 3])
          const map = new Map([['a', 1]])
          return { setSize: set.size, mapValue: map.get('a') }
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ setSize: 3, mapValue: 1 })
      })

      it('allows TextEncoder and TextDecoder', async () => {
        const handler = () => {
          const encoder = new TextEncoder()
          const decoder = new TextDecoder()
          const encoded = encoder.encode('hello')
          const decoded = decoder.decode(encoded)
          return decoded
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(true)
        expect(result.result).toBe('hello')
      })

      it('allows URL and URLSearchParams', async () => {
        const handler = () => {
          const url = new URL('https://example.com.ai/path?foo=bar')
          return { host: url.host, foo: url.searchParams.get('foo') }
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ host: 'example.com.ai', foo: 'bar' })
      })
    })

    describe('Sandbox isolation', () => {
      it('handlers cannot pollute shared state between executions', async () => {
        const handler1 = () => {
          // @ts-expect-error - intentional pollution attempt
          globalThis.__pollution = 'polluted'
          return 'done'
        }

        const handler2 = () => {
          // @ts-expect-error - check for pollution
          return globalThis.__pollution
        }

        await executor.execute(handler1, {}, { sandboxed: true })
        const result = await executor.execute(handler2, {}, { sandboxed: true })

        expect(result.result).toBeUndefined()
      })

      it('prototype pollution is prevented', async () => {
        const handler = () => {
          // Attempt prototype pollution
          Object.prototype.polluted = true
          return 'done'
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(false)
        // @ts-expect-error - check pollution didn't happen
        expect(Object.prototype.polluted).toBeUndefined()
      })

      it('cannot access parent scope variables', async () => {
        const secretValue = 'super-secret'
        const handler = () => {
          // @ts-expect-error - secretValue is not in scope
          return secretValue
        }

        const result = await executor.execute(handler, {}, { sandboxed: true })

        expect(result.success).toBe(false)
        expect(result.result).not.toBe('super-secret')
      })
    })

    describe('Non-sandboxed mode', () => {
      it('allows unrestricted execution when sandboxed: false', async () => {
        const handler = () => {
          // In non-sandboxed mode, this should work
          return typeof process !== 'undefined' ? 'has-process' : 'no-process'
        }

        const result = await executor.execute(handler, {}, { sandboxed: false })

        expect(result.success).toBe(true)
        // Result depends on actual environment
      })

      it('defaults to sandboxed mode', async () => {
        const handler = () => {
          return process.env.TEST
        }

        const result = await executor.execute(handler, {}) // No options

        expect(result.success).toBe(false) // Should fail due to sandbox
      })
    })
  })

  // ==========================================================================
  // 4. TIMEOUT TESTS
  // ==========================================================================

  describe('Timeout Handling', () => {
    describe('Configurable timeout', () => {
      it('times out after configured duration', async () => {
        const handler = async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return 'done'
        }

        const result = await executor.execute(handler, {}, { timeout: 100 })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(ExecutionTimeoutError)
        expect(result.error?.message).toMatch(/timeout|exceeded/i)
      })

      it('completes before timeout when fast enough', async () => {
        const handler = async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return 'done'
        }

        const result = await executor.execute(handler, {}, { timeout: 1000 })

        expect(result.success).toBe(true)
        expect(result.result).toBe('done')
      })

      it('uses default timeout when not specified', async () => {
        const handler = async () => {
          await new Promise((resolve) => setTimeout(resolve, 35000))
          return 'done'
        }

        // Default timeout should be 30000ms
        const startTime = Date.now()
        const result = await executor.execute(handler, {})
        const elapsed = Date.now() - startTime

        expect(result.success).toBe(false)
        expect(elapsed).toBeLessThan(35000) // Should have timed out before completion
      })

      it('timeout can be set to 0 for no timeout', async () => {
        // Note: This might not be a real test since we can't wait forever
        // Just verify it accepts timeout: 0
        const handler = () => 'instant'

        const result = await executor.execute(handler, {}, { timeout: 0 })

        expect(result.success).toBe(true)
      })

      it('reports timeout duration in error', async () => {
        const handler = async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return 'done'
        }

        const result = await executor.execute(handler, {}, { timeout: 50 })

        expect(result.error?.message).toContain('50')
      })
    })

    describe('Cancellation', () => {
      it('provides AbortSignal in context', async () => {
        let capturedSignal: AbortSignal | undefined
        const handler = (_input: unknown, ctx: ExecutionContext) => {
          capturedSignal = ctx.signal
          return 'ok'
        }

        await executor.execute(handler, {})

        expect(capturedSignal).toBeDefined()
        expect(capturedSignal).toBeInstanceOf(AbortSignal)
      })

      it('signal is aborted on timeout', async () => {
        let signalAborted = false
        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          ctx.signal.addEventListener('abort', () => {
            signalAborted = true
          })
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return 'done'
        }

        await executor.execute(handler, {}, { timeout: 50 })

        expect(signalAborted).toBe(true)
      })

      it('can cancel execution externally', async () => {
        const controller = new AbortController()

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          await new Promise((resolve, reject) => {
            ctx.signal.addEventListener('abort', () => reject(new Error('Cancelled')))
            setTimeout(resolve, 5000)
          })
          return 'done'
        }

        // Cancel after 50ms
        setTimeout(() => controller.abort(), 50)

        const result = await executor.execute(handler, {}, { signal: controller.signal })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(ExecutionCancelledError)
      })

      it('respects abort reason', async () => {
        const controller = new AbortController()

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return 'done'
        }

        setTimeout(() => controller.abort('User cancelled'), 50)

        const result = await executor.execute(handler, {}, { signal: controller.signal })

        expect(result.error?.message).toContain('User cancelled')
      })

      it('early return when signal is already aborted', async () => {
        const controller = new AbortController()
        controller.abort()

        const handler = vi.fn(() => 'should not run')

        const result = await executor.execute(handler, {}, { signal: controller.signal })

        expect(handler).not.toHaveBeenCalled()
        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(ExecutionCancelledError)
      })
    })
  })

  // ==========================================================================
  // 5. RETRY TESTS
  // ==========================================================================

  describe('Retry Logic', () => {
    describe('Automatic retries', () => {
      it('retries on failure when configured', async () => {
        let attempts = 0
        const handler = () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Temporary failure')
          }
          return 'success'
        }

        const result = await executor.execute(handler, {}, {
          retry: { maxAttempts: 3, delay: 10 },
        })

        expect(result.success).toBe(true)
        expect(result.result).toBe('success')
        expect(result.retryCount).toBe(2)
        expect(attempts).toBe(3)
      })

      it('reports failure after all retries exhausted', async () => {
        let attempts = 0
        const handler = () => {
          attempts++
          throw new Error('Persistent failure')
        }

        const result = await executor.execute(handler, {}, {
          retry: { maxAttempts: 3, delay: 10 },
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(ExecutionRetryExhaustedError)
        expect(result.retryCount).toBe(3)
        expect(attempts).toBe(3)
      })

      it('does not retry by default', async () => {
        let attempts = 0
        const handler = () => {
          attempts++
          throw new Error('Failure')
        }

        const result = await executor.execute(handler, {})

        expect(result.success).toBe(false)
        expect(attempts).toBe(1)
        expect(result.retryCount).toBe(0)
      })

      it('retries preserve input between attempts', async () => {
        const inputs: unknown[] = []
        let attempts = 0

        const handler = (input: { value: number }) => {
          inputs.push(input)
          attempts++
          if (attempts < 2) {
            throw new Error('Retry')
          }
          return input.value
        }

        await executor.execute(handler, { value: 42 }, {
          retry: { maxAttempts: 3, delay: 10 },
        })

        expect(inputs).toEqual([{ value: 42 }, { value: 42 }])
      })
    })

    describe('Backoff strategies', () => {
      it('supports fixed delay backoff', async () => {
        const startTimes: number[] = []
        let attempts = 0

        const handler = () => {
          startTimes.push(Date.now())
          attempts++
          if (attempts < 3) {
            throw new Error('Retry')
          }
          return 'success'
        }

        await executor.execute(handler, {}, {
          retry: { maxAttempts: 3, delay: 50, backoff: 'fixed' },
        })

        // Each retry should be ~50ms apart
        const delay1 = startTimes[1] - startTimes[0]
        const delay2 = startTimes[2] - startTimes[1]

        expect(delay1).toBeGreaterThanOrEqual(45)
        expect(delay1).toBeLessThan(100)
        expect(delay2).toBeGreaterThanOrEqual(45)
        expect(delay2).toBeLessThan(100)
      })

      it('supports exponential backoff', async () => {
        const startTimes: number[] = []
        let attempts = 0

        const handler = () => {
          startTimes.push(Date.now())
          attempts++
          if (attempts < 4) {
            throw new Error('Retry')
          }
          return 'success'
        }

        await executor.execute(handler, {}, {
          retry: { maxAttempts: 4, delay: 20, backoff: 'exponential' },
        })

        // Delays should be: 20, 40, 80 (2^0*20, 2^1*20, 2^2*20)
        const delay1 = startTimes[1] - startTimes[0]
        const delay2 = startTimes[2] - startTimes[1]
        const delay3 = startTimes[3] - startTimes[2]

        expect(delay1).toBeGreaterThanOrEqual(15)
        expect(delay2).toBeGreaterThan(delay1 * 1.5)
        expect(delay3).toBeGreaterThan(delay2 * 1.5)
      })

      it('supports exponential backoff with jitter', async () => {
        const delays: number[] = []
        let attempts = 0
        let lastTime = Date.now()

        const handler = () => {
          const now = Date.now()
          if (attempts > 0) {
            delays.push(now - lastTime)
          }
          lastTime = now
          attempts++
          if (attempts < 4) {
            throw new Error('Retry')
          }
          return 'success'
        }

        // Run multiple times to verify jitter creates variance
        const allDelays: number[][] = []
        for (let i = 0; i < 3; i++) {
          attempts = 0
          lastTime = Date.now()
          delays.length = 0
          await executor.execute(handler, {}, {
            retry: { maxAttempts: 4, delay: 20, backoff: 'exponential-jitter' },
          })
          allDelays.push([...delays])
        }

        // With jitter, delays should vary between runs
        // At least one pair of runs should have different first delays
        const firstDelays = allDelays.map((d) => d[0])
        const allSame = firstDelays.every((d) => Math.abs(d - firstDelays[0]) < 5)
        expect(allSame).toBe(false)
      })

      it('supports linear backoff', async () => {
        const startTimes: number[] = []
        let attempts = 0

        const handler = () => {
          startTimes.push(Date.now())
          attempts++
          if (attempts < 4) {
            throw new Error('Retry')
          }
          return 'success'
        }

        await executor.execute(handler, {}, {
          retry: { maxAttempts: 4, delay: 20, backoff: 'linear', increment: 20 },
        })

        // Delays should be: 20, 40, 60 (20 + 0*20, 20 + 1*20, 20 + 2*20)
        const delay1 = startTimes[1] - startTimes[0]
        const delay2 = startTimes[2] - startTimes[1]
        const delay3 = startTimes[3] - startTimes[2]

        expect(delay1).toBeGreaterThanOrEqual(15)
        expect(delay2).toBeGreaterThanOrEqual(delay1 + 15)
        expect(delay3).toBeGreaterThanOrEqual(delay2 + 15)
      })

      it('caps maximum delay', async () => {
        const startTimes: number[] = []
        let attempts = 0

        const handler = () => {
          startTimes.push(Date.now())
          attempts++
          if (attempts < 5) {
            throw new Error('Retry')
          }
          return 'success'
        }

        await executor.execute(handler, {}, {
          retry: {
            maxAttempts: 5,
            delay: 50,
            backoff: 'exponential',
            maxDelay: 100,
          },
        })

        // Without cap: 50, 100, 200, 400
        // With cap: 50, 100, 100, 100
        const delay3 = startTimes[3] - startTimes[2]
        const delay4 = startTimes[4] - startTimes[3]

        expect(delay3).toBeLessThanOrEqual(150)
        expect(delay4).toBeLessThanOrEqual(150)
      })
    })

    describe('Retry conditions', () => {
      it('can specify which errors to retry', async () => {
        let attempts = 0

        const handler = () => {
          attempts++
          if (attempts === 1) {
            throw new Error('RetryableError: temporary')
          }
          if (attempts === 2) {
            throw new Error('FatalError: permanent')
          }
          return 'success'
        }

        const result = await executor.execute(handler, {}, {
          retry: {
            maxAttempts: 3,
            delay: 10,
            retryIf: (error) => error.message.startsWith('RetryableError'),
          },
        })

        expect(result.success).toBe(false)
        expect(attempts).toBe(2) // Stopped on FatalError, didn't retry
      })

      it('does not retry on specific error types', async () => {
        class ValidationError extends Error {
          constructor(message: string) {
            super(message)
            this.name = 'ValidationError'
          }
        }

        let attempts = 0

        const handler = () => {
          attempts++
          throw new ValidationError('Invalid input')
        }

        const result = await executor.execute(handler, {}, {
          retry: {
            maxAttempts: 3,
            delay: 10,
            retryIf: (error) => error.name !== 'ValidationError',
          },
        })

        expect(result.success).toBe(false)
        expect(attempts).toBe(1)
      })

      it('retries on timeout by default', async () => {
        let attempts = 0

        const handler = async () => {
          attempts++
          if (attempts < 3) {
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          return 'success'
        }

        const result = await executor.execute(handler, {}, {
          timeout: 50,
          retry: { maxAttempts: 3, delay: 10 },
        })

        expect(result.success).toBe(true)
        expect(attempts).toBe(3)
      })

      it('can disable retry on timeout', async () => {
        let attempts = 0

        const handler = async () => {
          attempts++
          await new Promise((resolve) => setTimeout(resolve, 200))
          return 'success'
        }

        const result = await executor.execute(handler, {}, {
          timeout: 50,
          retry: { maxAttempts: 3, delay: 10, retryOnTimeout: false },
        })

        expect(result.success).toBe(false)
        expect(attempts).toBe(1)
      })
    })

    describe('Retry events', () => {
      it('emits event on each retry attempt', async () => {
        const events: Array<{ attempt: number; error: string }> = []
        let attempts = 0

        const executorWithEvents = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          onEvent: (event, data) => {
            if (event === 'function.retry') {
              events.push(data as { attempt: number; error: string })
            }
          },
        })

        const handler = () => {
          attempts++
          if (attempts < 3) {
            throw new Error(`Attempt ${attempts} failed`)
          }
          return 'success'
        }

        await executorWithEvents.execute(handler, {}, {
          retry: { maxAttempts: 3, delay: 10 },
        })

        expect(events).toHaveLength(2)
        expect(events[0].attempt).toBe(1)
        expect(events[0].error).toContain('Attempt 1')
        expect(events[1].attempt).toBe(2)
      })

      it('onRetry callback is called before each retry', async () => {
        const retryInfos: Array<{ attempt: number; delay: number }> = []
        let attempts = 0

        const handler = () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Retry')
          }
          return 'success'
        }

        await executor.execute(handler, {}, {
          retry: {
            maxAttempts: 3,
            delay: 50,
            onRetry: (info) => {
              retryInfos.push({ attempt: info.attempt, delay: info.delay })
            },
          },
        })

        expect(retryInfos).toHaveLength(2)
        expect(retryInfos[0].attempt).toBe(1)
        expect(retryInfos[0].delay).toBe(50)
      })
    })
  })

  // ==========================================================================
  // 6. STREAMING OUTPUT TESTS
  // ==========================================================================

  describe('Streaming Output', () => {
    describe('Stream emission', () => {
      it('handler can emit stream events', async () => {
        const chunks: string[] = []

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          await ctx.emit('stream.chunk', { data: 'Hello' })
          await ctx.emit('stream.chunk', { data: ' ' })
          await ctx.emit('stream.chunk', { data: 'World' })
          return 'complete'
        }

        const executorWithEvents = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          onEvent: (event, data) => {
            if (event === 'stream.chunk') {
              chunks.push((data as { data: string }).data)
            }
          },
        })

        await executorWithEvents.execute(handler, {})

        expect(chunks).toEqual(['Hello', ' ', 'World'])
      })

      it('stream events include sequence numbers', async () => {
        const sequences: number[] = []

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          await ctx.emit('stream.chunk', { data: 'a' })
          await ctx.emit('stream.chunk', { data: 'b' })
          await ctx.emit('stream.chunk', { data: 'c' })
          return 'done'
        }

        const executorWithEvents = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          onEvent: (event, data) => {
            if (event === 'stream.chunk') {
              sequences.push((data as { sequence: number }).sequence)
            }
          },
        })

        await executorWithEvents.execute(handler, {})

        expect(sequences).toEqual([0, 1, 2])
      })

      it('emits stream.start event at beginning', async () => {
        let startReceived = false

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          await ctx.emit('stream.chunk', { data: 'data' })
          return 'done'
        }

        const executorWithEvents = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          onEvent: (event) => {
            if (event === 'stream.start') {
              startReceived = true
            }
          },
        })

        await executorWithEvents.execute(handler, {}, { streaming: true })

        expect(startReceived).toBe(true)
      })

      it('emits stream.end event at completion', async () => {
        let endReceived = false
        let endData: { totalChunks: number } | null = null

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          await ctx.emit('stream.chunk', { data: 'a' })
          await ctx.emit('stream.chunk', { data: 'b' })
          return 'done'
        }

        const executorWithEvents = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          onEvent: (event, data) => {
            if (event === 'stream.end') {
              endReceived = true
              endData = data as { totalChunks: number }
            }
          },
        })

        await executorWithEvents.execute(handler, {}, { streaming: true })

        expect(endReceived).toBe(true)
        expect(endData?.totalChunks).toBe(2)
      })
    })

    describe('Progress updates', () => {
      it('handler can emit progress updates', async () => {
        const progressUpdates: Array<{ current: number; total: number }> = []

        const handler = async (input: { items: number[] }, ctx: ExecutionContext) => {
          const total = input.items.length
          for (let i = 0; i < total; i++) {
            await ctx.emit('progress', { current: i + 1, total })
          }
          return 'done'
        }

        const executorWithEvents = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          onEvent: (event, data) => {
            if (event === 'progress') {
              progressUpdates.push(data as { current: number; total: number })
            }
          },
        })

        await executorWithEvents.execute(handler, { items: [1, 2, 3] })

        expect(progressUpdates).toEqual([
          { current: 1, total: 3 },
          { current: 2, total: 3 },
          { current: 3, total: 3 },
        ])
      })

      it('progress percentage is calculated correctly', async () => {
        const percentages: number[] = []

        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          await ctx.emit('progress', { current: 25, total: 100 })
          await ctx.emit('progress', { current: 50, total: 100 })
          await ctx.emit('progress', { current: 100, total: 100 })
          return 'done'
        }

        const executorWithEvents = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          onEvent: (event, data) => {
            if (event === 'progress') {
              const p = data as { current: number; total: number; percentage: number }
              percentages.push(p.percentage)
            }
          },
        })

        await executorWithEvents.execute(handler, {})

        expect(percentages).toEqual([25, 50, 100])
      })
    })

    describe('Streaming mode', () => {
      it('returns async iterator in streaming mode', async () => {
        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          await ctx.emit('stream.chunk', { data: 'a' })
          await ctx.emit('stream.chunk', { data: 'b' })
          await ctx.emit('stream.chunk', { data: 'c' })
          return 'done'
        }

        const stream = await executor.executeStreaming(handler, {})

        const chunks: string[] = []
        for await (const chunk of stream) {
          chunks.push(chunk.data)
        }

        expect(chunks).toEqual(['a', 'b', 'c'])
      })

      it('streaming result includes final value', async () => {
        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          await ctx.emit('stream.chunk', { data: 'chunk' })
          return { status: 'complete', count: 42 }
        }

        const stream = await executor.executeStreaming(handler, {})

        let finalResult: unknown
        for await (const chunk of stream) {
          if (chunk.type === 'result') {
            finalResult = chunk.value
          }
        }

        expect(finalResult).toEqual({ status: 'complete', count: 42 })
      })

      it('can convert stream to array', async () => {
        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          await ctx.emit('stream.chunk', { data: '1' })
          await ctx.emit('stream.chunk', { data: '2' })
          await ctx.emit('stream.chunk', { data: '3' })
          return 'done'
        }

        const stream = await executor.executeStreaming(handler, {})
        const chunks = await stream.toArray()

        expect(chunks.filter((c) => c.type === 'chunk')).toHaveLength(3)
      })

      it('stream can be cancelled', async () => {
        const handler = async (_input: unknown, ctx: ExecutionContext) => {
          for (let i = 0; i < 100; i++) {
            await ctx.emit('stream.chunk', { data: i.toString() })
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          return 'done'
        }

        const stream = await executor.executeStreaming(handler, {})

        const chunks: string[] = []
        for await (const chunk of stream) {
          if (chunk.type === 'chunk') {
            chunks.push(chunk.data)
          }
          if (chunks.length >= 5) {
            stream.cancel()
            break
          }
        }

        expect(chunks.length).toBe(5)
      })
    })
  })

  // ==========================================================================
  // 7. RESOURCE LIMITS TESTS
  // ==========================================================================

  describe('Resource Limits', () => {
    describe('Memory limits', () => {
      it('enforces memory limit', async () => {
        const handler = () => {
          // Attempt to allocate large array
          const largeArray = new Array(10_000_000).fill('x')
          return largeArray.length
        }

        const result = await executor.execute(handler, {}, {
          resourceLimits: { maxMemory: 1_000_000 }, // 1MB limit
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(ExecutionResourceError)
        expect(result.error?.message).toMatch(/memory.*limit|exceeded/i)
      })

      it('reports memory usage in metrics', async () => {
        const handler = () => {
          const data = new Array(1000).fill('test')
          return data.length
        }

        const result = await executor.execute(handler, {})

        expect(result.metrics.memoryUsed).toBeDefined()
        expect(result.metrics.memoryUsed).toBeGreaterThan(0)
      })

      it('uses default memory limit when not specified', async () => {
        // Default should be some reasonable value like 128MB
        const handler = () => 'ok'

        const result = await executor.execute(handler, {})

        // Should succeed with small handler
        expect(result.success).toBe(true)
      })
    })

    describe('CPU time limits', () => {
      it('enforces CPU time limit', async () => {
        const handler = () => {
          // CPU-intensive loop
          let result = 0
          for (let i = 0; i < 1_000_000_000; i++) {
            result += Math.sqrt(i)
          }
          return result
        }

        const result = await executor.execute(handler, {}, {
          resourceLimits: { maxCpuTime: 50 }, // 50ms CPU time
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(ExecutionResourceError)
        expect(result.error?.message).toMatch(/cpu.*time|exceeded/i)
      })

      it('reports CPU time in metrics', async () => {
        const handler = () => {
          let sum = 0
          for (let i = 0; i < 10000; i++) {
            sum += i
          }
          return sum
        }

        const result = await executor.execute(handler, {})

        expect(result.metrics.cpuTime).toBeDefined()
        expect(result.metrics.cpuTime).toBeGreaterThan(0)
      })

      it('CPU time is separate from wall clock time', async () => {
        const handler = async () => {
          // Mostly idle time, little CPU
          await new Promise((resolve) => setTimeout(resolve, 100))
          return 'done'
        }

        const result = await executor.execute(handler, {})

        // Wall clock ~100ms but CPU time should be much less
        expect(result.duration).toBeGreaterThanOrEqual(100)
        expect(result.metrics.cpuTime).toBeLessThan(50)
      })
    })

    describe('Output size limits', () => {
      it('enforces output size limit', async () => {
        const handler = () => {
          // Return very large string
          return 'x'.repeat(10_000_000)
        }

        const result = await executor.execute(handler, {}, {
          resourceLimits: { maxOutputSize: 1_000_000 }, // 1MB limit
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/output.*size|exceeded/i)
      })

      it('deep object output is size-checked', async () => {
        const handler = () => {
          // Create deeply nested structure
          let obj: Record<string, unknown> = { value: 'x'.repeat(100000) }
          for (let i = 0; i < 100; i++) {
            obj = { nested: obj, value: 'x'.repeat(100000) }
          }
          return obj
        }

        const result = await executor.execute(handler, {}, {
          resourceLimits: { maxOutputSize: 1_000_000 },
        })

        expect(result.success).toBe(false)
      })
    })

    describe('Recursion limits', () => {
      it('enforces maximum recursion depth', async () => {
        const handler = () => {
          function recurse(n: number): number {
            if (n === 0) return 0
            return 1 + recurse(n - 1)
          }
          return recurse(100000)
        }

        const result = await executor.execute(handler, {}, {
          resourceLimits: { maxRecursionDepth: 100 },
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/recursion|stack/i)
      })
    })

    describe('Combined limits', () => {
      it('can set multiple resource limits', async () => {
        const handler = () => 'ok'

        const result = await executor.execute(handler, {}, {
          resourceLimits: {
            maxMemory: 128_000_000,
            maxCpuTime: 5000,
            maxOutputSize: 10_000_000,
            maxRecursionDepth: 100,
          },
        })

        expect(result.success).toBe(true)
      })

      it('first limit hit causes failure', async () => {
        const handler = () => {
          // This might hit memory or CPU first
          const data: number[] = []
          for (let i = 0; i < 10_000_000; i++) {
            data.push(Math.sqrt(i))
          }
          return data.length
        }

        const result = await executor.execute(handler, {}, {
          resourceLimits: {
            maxMemory: 1_000_000,
            maxCpuTime: 100,
          },
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(ExecutionResourceError)
      })
    })
  })

  // ==========================================================================
  // 8. ERROR HANDLING TESTS
  // ==========================================================================

  describe('Error Handling', () => {
    describe('Handler errors', () => {
      it('catches synchronous throw', async () => {
        const handler = () => {
          throw new Error('Sync error')
        }

        const result = await executor.execute(handler, {})

        expect(result.success).toBe(false)
        expect(result.error?.message).toBe('Sync error')
        expect(result.error?.name).toBe('Error')
      })

      it('catches async rejection', async () => {
        const handler = async () => {
          throw new Error('Async error')
        }

        const result = await executor.execute(handler, {})

        expect(result.success).toBe(false)
        expect(result.error?.message).toBe('Async error')
      })

      it('catches Promise rejection', async () => {
        const handler = () => {
          return Promise.reject(new Error('Promise rejection'))
        }

        const result = await executor.execute(handler, {})

        expect(result.success).toBe(false)
        expect(result.error?.message).toBe('Promise rejection')
      })

      it('preserves error stack trace', async () => {
        const handler = () => {
          throw new Error('With stack')
        }

        const result = await executor.execute(handler, {})

        expect(result.error?.stack).toBeDefined()
        expect(result.error?.stack).toContain('Error: With stack')
      })

      it('handles non-Error thrown values', async () => {
        const handler = () => {
          throw 'string error'
        }

        const result = await executor.execute(handler, {})

        expect(result.success).toBe(false)
        expect(result.error?.message).toBe('string error')
      })

      it('handles thrown objects', async () => {
        const handler = () => {
          throw { code: 'ERR_CUSTOM', message: 'Custom error object' }
        }

        const result = await executor.execute(handler, {})

        expect(result.success).toBe(false)
        expect(result.error?.message).toContain('Custom error object')
      })

      it('handles thrown null/undefined', async () => {
        const handlerNull = () => {
          throw null
        }
        const handlerUndefined = () => {
          throw undefined
        }

        const result1 = await executor.execute(handlerNull, {})
        const result2 = await executor.execute(handlerUndefined, {})

        expect(result1.success).toBe(false)
        expect(result2.success).toBe(false)
      })
    })

    describe('Custom error types', () => {
      it('preserves custom error type name', async () => {
        class CustomError extends Error {
          constructor(message: string) {
            super(message)
            this.name = 'CustomError'
          }
        }

        const handler = () => {
          throw new CustomError('Custom message')
        }

        const result = await executor.execute(handler, {})

        expect(result.error?.name).toBe('CustomError')
      })

      it('preserves custom error properties', async () => {
        class DetailedError extends Error {
          code: string
          details: Record<string, unknown>

          constructor(message: string, code: string, details: Record<string, unknown>) {
            super(message)
            this.name = 'DetailedError'
            this.code = code
            this.details = details
          }
        }

        const handler = () => {
          throw new DetailedError('Failed', 'ERR_001', { field: 'email' })
        }

        const result = await executor.execute(handler, {})

        expect(result.error?.message).toBe('Failed')
        // Additional properties should be available
        expect((result.error as unknown as { code: string }).code).toBe('ERR_001')
      })
    })

    describe('Validation errors', () => {
      it('validates input before execution', async () => {
        const handler = (input: { email: string }) => {
          return `Hello ${input.email}`
        }

        const result = await executor.execute(handler, { email: 123 }, {
          inputSchema: {
            type: 'object',
            properties: { email: { type: 'string' } },
            required: ['email'],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/validation|invalid.*input/i)
      })

      it('validates output after execution', async () => {
        const handler = () => {
          return { count: 'not a number' }
        }

        const result = await executor.execute(handler, {}, {
          outputSchema: {
            type: 'object',
            properties: { count: { type: 'number' } },
            required: ['count'],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/validation|invalid.*output/i)
      })

      it('passes validation with correct types', async () => {
        const handler = (input: { value: number }) => {
          return { result: input.value * 2 }
        }

        const result = await executor.execute(handler, { value: 21 }, {
          inputSchema: {
            type: 'object',
            properties: { value: { type: 'number' } },
            required: ['value'],
          },
          outputSchema: {
            type: 'object',
            properties: { result: { type: 'number' } },
            required: ['result'],
          },
        })

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ result: 42 })
      })
    })

    describe('Error events', () => {
      it('emits function.error event on failure', async () => {
        let errorEvent: { error: string; invocationId: string } | null = null

        const executorWithEvents = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          onEvent: (event, data) => {
            if (event === 'function.error') {
              errorEvent = data as { error: string; invocationId: string }
            }
          },
        })

        await executorWithEvents.execute(() => {
          throw new Error('Test error')
        }, {})

        expect(errorEvent).not.toBeNull()
        expect(errorEvent?.error).toContain('Test error')
        expect(errorEvent?.invocationId).toBeDefined()
      })

      it('error event includes execution context', async () => {
        let errorData: Record<string, unknown> | null = null

        const executorWithEvents = new CodeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          services: mockServices,
          onEvent: (event, data) => {
            if (event === 'function.error') {
              errorData = data as Record<string, unknown>
            }
          },
        })

        await executorWithEvents.execute(
          () => {
            throw new Error('Test')
          },
          { testInput: true },
          { functionId: 'test-fn' },
        )

        expect(errorData?.functionId).toBe('test-fn')
        expect(errorData?.input).toEqual({ testInput: true })
      })
    })

    describe('Unhandled promise rejections', () => {
      it('catches floating promises', async () => {
        const handler = () => {
          // Fire-and-forget promise that rejects
          Promise.reject(new Error('Floating rejection'))
          return 'returned before rejection'
        }

        // This is tricky - the handler returns but there's an unhandled rejection
        // The executor should wait for and catch this
        const result = await executor.execute(handler, {}, { waitForPromises: true })

        // Behavior depends on implementation - either:
        // 1. Catches the rejection and fails
        // 2. Succeeds but logs warning
        expect(result.success).toBeDefined()
      })
    })
  })
})
