/**
 * Test Context Factory
 *
 * Creates mock execution contexts for testing function handlers.
 * Provides:
 * - Mock state storage (in-memory)
 * - Mock services (AI, KV, DB, Queue, fetch)
 * - Event capture for assertions
 * - Log capture for assertions
 */

import type { ExecutionContext } from '../CodeFunctionExecutor'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface CapturedEvent {
  type: string
  data: unknown
  timestamp: number
}

export interface CapturedLog {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  data?: unknown
  timestamp: number
}

export interface AICall {
  model: string
  prompt: string
}

export interface KVOperation {
  operation: 'get' | 'put'
  key: string
  value?: string
}

export interface DBQuery {
  sql: string
  params?: unknown[]
}

export interface FetchCall {
  url: string
  init?: RequestInit
}

// Mock AI types
export interface MockAIOptions {
  response?: string | ((opts: { model: string; prompt: string }) => string)
  error?: Error
}

export interface MockAI {
  generate: (opts: { model: string; prompt: string }) => Promise<{ text: string }>
}

// Mock KV types
export interface MockKV {
  get: (key: string) => Promise<string | null>
  put: (key: string, value: string) => Promise<void>
}

// Mock DB types
export type MockDBResponses = Record<
  string,
  unknown[] | ((params?: unknown[]) => unknown[])
>

export interface MockDB {
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

// Mock Queue types
export interface MockQueueOptions {
  onSend?: (message: unknown) => void
}

export interface MockQueue {
  send: (message: unknown) => Promise<void>
}

// Mock Fetch types
export type MockFetchResponses =
  | Record<string, Response>
  | ((url: string, init?: RequestInit) => Response)

// Services configuration
export interface MockServices {
  ai?: MockAI
  kv?: MockKV
  db?: MockDB
  queue?: MockQueue
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
}

// Test context options
export interface TestContextOptions {
  functionId?: string
  invocationId?: string
  env?: Record<string, string>
  state?: Record<string, unknown>
  services?: Partial<MockServices>
  signal?: AbortSignal
  onEvent?: (event: string, data: unknown) => void
}

// Extended test context with helper methods
export interface TestContext extends ExecutionContext {
  // Captured data
  events: CapturedEvent[]
  logs: CapturedLog[]

  // Event helpers
  getEventsByType: (type: string) => CapturedEvent[]
  hasEvent: (type: string) => boolean
  clearEvents: () => void
  getLastEvent: () => CapturedEvent | undefined

  // Log helpers
  getLogsByLevel: (level: CapturedLog['level']) => CapturedLog[]
  searchLogs: (pattern: string) => CapturedLog[]
  clearLogs: () => void
  getLastLog: () => CapturedLog | undefined

  // Service call tracking
  getAICalls: () => AICall[]
  getKVOperations: () => KVOperation[]
  getDBQueries: () => DBQuery[]
  getQueuedMessages: () => unknown[]
  getFetchCalls: () => FetchCall[]

  // State helpers
  getStateSnapshot: () => Record<string, unknown>

  // Abort helper
  abort: (reason?: string) => void

  // Reset helper
  reset: () => void

  // Assertion helpers
  assertEventEmitted: (type: string) => void
  assertNoErrors: () => void
}

// ============================================================================
// MOCK FACTORIES
// ============================================================================

/**
 * Create a mock AI service
 */
export function mockAI(options: MockAIOptions = {}): MockAI {
  return {
    generate: async (opts: { model: string; prompt: string }) => {
      if (options.error) {
        throw options.error
      }

      let text: string
      if (typeof options.response === 'function') {
        text = options.response(opts)
      } else if (options.response !== undefined) {
        text = options.response
      } else {
        text = 'Mock AI response'
      }

      return { text }
    },
  }
}

/**
 * Create a mock KV service with optional pre-populated data
 */
export function mockKV(initialData: Record<string, string> = {}): MockKV {
  const store = new Map<string, string>(Object.entries(initialData))

  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value)
    },
  }
}

/**
 * Create a mock DB service with optional query responses
 */
export function mockDB(responses: MockDBResponses = {}): MockDB {
  return {
    query: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      const response = responses[sql]
      if (typeof response === 'function') {
        return response(params) as T[]
      }
      if (Array.isArray(response)) {
        return response as T[]
      }
      return [] as T[]
    },
  }
}

/**
 * Create a mock Queue service
 */
export function mockQueue(options: MockQueueOptions = {}): MockQueue {
  return {
    send: async (message: unknown) => {
      options.onSend?.(message)
    },
  }
}

/**
 * Create a mock fetch function
 */
export function mockFetch(
  responsesOrHandler: MockFetchResponses = {}
): (url: string, init?: RequestInit) => Promise<Response> {
  if (typeof responsesOrHandler === 'function') {
    return async (url: string, init?: RequestInit) => {
      return responsesOrHandler(url, init)
    }
  }

  return async (url: string) => {
    const response = responsesOrHandler[url]
    if (response) {
      // Clone response to allow multiple reads
      return response.clone()
    }
    return new Response('OK', { status: 200 })
  }
}

// ============================================================================
// TEST CONTEXT FACTORY
// ============================================================================

/**
 * Create a test context for testing function handlers.
 *
 * @example
 * ```typescript
 * const ctx = createTestContext({
 *   env: { API_KEY: 'test' },
 *   state: { counter: 0 },
 *   services: {
 *     ai: mockAI({ response: 'hello' }),
 *   },
 * })
 *
 * const result = await myFunction.execute(input, ctx)
 * expect(ctx.events).toContain({ type: 'step.completed' })
 * ```
 */
export function createTestContext(options: TestContextOptions = {}): TestContext {
  // Generate IDs
  const functionId = options.functionId ?? `test-function-${crypto.randomUUID().slice(0, 8)}`
  const invocationId = options.invocationId ?? crypto.randomUUID()

  // Initialize env (make a copy)
  const env = { ...options.env } as Record<string, string>

  // Initialize state storage
  const initialState = { ...options.state }
  const stateStore = new Map<string, unknown>(Object.entries(initialState))

  // Captured data
  const events: CapturedEvent[] = []
  const logs: CapturedLog[] = []
  const aiCalls: AICall[] = []
  const kvOperations: KVOperation[] = []
  const dbQueries: DBQuery[] = []
  const queuedMessages: unknown[] = []
  const fetchCalls: FetchCall[] = []

  // Abort controller
  let abortController = new AbortController()
  const signal = options.signal ?? abortController.signal

  // State wrapper with tracking
  const state: ExecutionContext['state'] = {
    get: async <T>(key: string): Promise<T | null> => {
      const value = stateStore.get(key)
      return (value as T) ?? null
    },
    put: async <T>(key: string, value: T): Promise<void> => {
      stateStore.set(key, value)
    },
    delete: async (key: string): Promise<boolean> => {
      return stateStore.delete(key)
    },
    list: async (opts?: { prefix?: string }): Promise<Map<string, unknown>> => {
      const result = new Map<string, unknown>()
      for (const [key, value] of stateStore) {
        if (!opts?.prefix || key.startsWith(opts.prefix)) {
          result.set(key, value)
        }
      }
      return result
    },
  }

  // Build mock services with tracking
  const defaultAI = mockAI()
  const aiService: MockAI = {
    generate: async (opts) => {
      aiCalls.push({ model: opts.model, prompt: opts.prompt })
      if (options.services?.ai) {
        return options.services.ai.generate(opts)
      }
      return defaultAI.generate(opts)
    },
  }

  const defaultKV = mockKV()
  const kvService: MockKV = {
    get: async (key) => {
      kvOperations.push({ operation: 'get', key })
      if (options.services?.kv) {
        return options.services.kv.get(key)
      }
      return defaultKV.get(key)
    },
    put: async (key, value) => {
      kvOperations.push({ operation: 'put', key, value })
      if (options.services?.kv) {
        return options.services.kv.put(key, value)
      }
      return defaultKV.put(key, value)
    },
  }

  const defaultDB = mockDB()
  const dbService: MockDB = {
    query: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      dbQueries.push({ sql, params })
      if (options.services?.db) {
        return options.services.db.query<T>(sql, params)
      }
      return defaultDB.query<T>(sql, params)
    },
  }

  const defaultQueue = mockQueue()
  const queueService: MockQueue = {
    send: async (message) => {
      queuedMessages.push(message)
      if (options.services?.queue) {
        return options.services.queue.send(message)
      }
      return defaultQueue.send(message)
    },
  }

  const defaultFetch = mockFetch()
  const fetchService = async (url: string, init?: RequestInit): Promise<Response> => {
    fetchCalls.push({ url, init })
    if (options.services?.fetch) {
      return options.services.fetch(url, init)
    }
    return defaultFetch(url, init)
  }

  // Build services object
  const services: ExecutionContext['services'] = {
    ai: aiService,
    kv: kvService,
    db: dbService,
    queue: queueService,
    fetch: fetchService,
  }

  // Log wrapper with capture
  const log: ExecutionContext['log'] = {
    debug: (message: string, data?: unknown) => {
      logs.push({ level: 'debug', message, data, timestamp: Date.now() })
    },
    info: (message: string, data?: unknown) => {
      logs.push({ level: 'info', message, data, timestamp: Date.now() })
    },
    warn: (message: string, data?: unknown) => {
      logs.push({ level: 'warn', message, data, timestamp: Date.now() })
    },
    error: (message: string, data?: unknown) => {
      logs.push({ level: 'error', message, data, timestamp: Date.now() })
    },
  }

  // Emit function with capture
  const emit = async (event: string, data: unknown): Promise<void> => {
    events.push({ type: event, data, timestamp: Date.now() })
    options.onEvent?.(event, data)
  }

  // Build the test context
  const testContext: TestContext = {
    // ExecutionContext properties
    functionId,
    invocationId,
    env,
    state,
    services,
    log,
    emit,
    signal,

    // Captured data
    events,
    logs,

    // Event helpers
    getEventsByType: (type: string) => events.filter((e) => e.type === type),
    hasEvent: (type: string) => events.some((e) => e.type === type),
    clearEvents: () => {
      events.length = 0
    },
    getLastEvent: () => events[events.length - 1],

    // Log helpers
    getLogsByLevel: (level: CapturedLog['level']) =>
      logs.filter((l) => l.level === level),
    searchLogs: (pattern: string) =>
      logs.filter((l) => l.message.includes(pattern)),
    clearLogs: () => {
      logs.length = 0
    },
    getLastLog: () => logs[logs.length - 1],

    // Service call tracking
    getAICalls: () => [...aiCalls],
    getKVOperations: () => [...kvOperations],
    getDBQueries: () => [...dbQueries],
    getQueuedMessages: () => [...queuedMessages],
    getFetchCalls: () => [...fetchCalls],

    // State helpers
    getStateSnapshot: () => Object.fromEntries(stateStore),

    // Abort helper
    abort: (reason?: string) => {
      abortController.abort(reason)
    },

    // Reset helper
    reset: () => {
      // Clear captures
      events.length = 0
      logs.length = 0
      aiCalls.length = 0
      kvOperations.length = 0
      dbQueries.length = 0
      queuedMessages.length = 0
      fetchCalls.length = 0

      // Reset state to initial
      stateStore.clear()
      for (const [key, value] of Object.entries(initialState)) {
        stateStore.set(key, value)
      }

      // Reset abort controller
      abortController = new AbortController()
      // Note: We can't reassign signal directly since it's readonly,
      // but the abort() method will work with the new controller
    },

    // Assertion helpers
    assertEventEmitted: (type: string) => {
      if (!events.some((e) => e.type === type)) {
        throw new Error(`Expected event "${type}" to be emitted, but it was not`)
      }
    },
    assertNoErrors: () => {
      const errorLogs = logs.filter((l) => l.level === 'error')
      if (errorLogs.length > 0) {
        throw new Error(
          `Expected no error logs, but found ${errorLogs.length}: ${errorLogs
            .map((l) => l.message)
            .join(', ')}`
        )
      }
    },
  }

  return testContext
}

export default createTestContext
