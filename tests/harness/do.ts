/**
 * MockDurableObject - Test factory for DO instantiation
 *
 * Provides utilities for testing Durable Objects without the Cloudflare runtime.
 * Creates mock state, storage, and environment bindings.
 *
 * @example
 * ```typescript
 * import { createMockDO } from 'dotdo/testing'
 * import { Business } from '../objects/Business'
 *
 * const { instance, ctx, env, storage } = createMockDO(Business, {
 *   id: 'test-business',
 *   storage: new Map([['config', { name: 'Acme' }]]),
 * })
 *
 * // Test the DO
 * const config = await instance.getConfig()
 * expect(config?.name).toBe('Acme')
 *
 * // Assert on storage operations
 * expect(storage.puts).toContainEqual(['config', expect.any(Object)])
 * ```
 *
 * @module dotdo/testing
 */

import { vi } from 'vitest'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Mock DurableObjectId
 */
export interface MockDurableObjectId {
  /** String representation of the ID */
  toString(): string
  /** Compare with another ID */
  equals(other: MockDurableObjectId): boolean
  /** Optional name for named IDs */
  name?: string
}

/**
 * Tracked storage operation
 */
export interface StorageOperation {
  type: 'get' | 'put' | 'delete' | 'list' | 'deleteAll'
  key?: string | string[]
  value?: unknown
  options?: unknown
  timestamp: number
}

/**
 * Tracked SQL operation
 */
export interface SqlOperation {
  query: string
  params: unknown[]
  timestamp: number
}

/**
 * Mock DurableObjectStorage with operation tracking
 */
export interface MockDurableObjectStorage {
  // Core storage methods
  get<T = unknown>(key: string): Promise<T | undefined>
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>
  list<T = unknown>(options?: DurableObjectListOptions): Promise<Map<string, T>>
  put<T>(key: string, value: T): Promise<void>
  put<T>(entries: Record<string, T>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  deleteAll(): Promise<void>

  // Alarm methods (on storage in Cloudflare Workers)
  getAlarm(): Promise<number | null>
  setAlarm(time: Date | number): Promise<void>
  deleteAlarm(): Promise<void>

  // SQL storage
  sql: MockSqlStorage

  // Testing utilities
  /** All tracked operations */
  operations: StorageOperation[]
  /** All put operations */
  puts: Array<[string, unknown]>
  /** All get operations */
  gets: string[]
  /** All delete operations */
  deletes: string[]
  /** Raw data store */
  data: Map<string, unknown>
  /** Alarm time if set */
  alarmTime: number | null
  /** Clear all tracking */
  clearTracking(): void
}

/**
 * Mock SQL storage cursor
 */
export interface MockSqlStorageCursor<T = unknown> {
  toArray(): T[]
  one(): T | undefined
  raw(): unknown[]
  [Symbol.iterator](): Iterator<T>
}

/**
 * Mock SQL storage
 */
export interface MockSqlStorage {
  exec<T = unknown>(query: string, ...params: unknown[]): MockSqlStorageCursor<T>
  /** Tracked SQL operations */
  operations: SqlOperation[]
  /** Pre-configured responses by query pattern */
  mockResponse(pattern: string | RegExp, response: unknown[]): void
  /** Clear mocked responses */
  clearMocks(): void
}

/**
 * Durable Object list options
 */
export interface DurableObjectListOptions {
  start?: string
  startAfter?: string
  end?: string
  prefix?: string
  reverse?: boolean
  limit?: number
}

/**
 * Mock DurableObjectState
 */
export interface MockDurableObjectState {
  id: MockDurableObjectId
  storage: MockDurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
  /** Get the alarm time if set */
  getAlarm(): Promise<number | null>
  /** Set an alarm */
  setAlarm(time: Date | number): Promise<void>
  /** Delete the alarm */
  deleteAlarm(): Promise<void>
}

/**
 * Mock DurableObjectStub
 */
export interface MockDurableObjectStub<T = unknown> {
  id: MockDurableObjectId
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>
  /** The actual DO instance (for testing) */
  _instance?: T
}

/**
 * Mock DurableObjectNamespace
 */
export interface MockDurableObjectNamespace<T = unknown> {
  idFromName(name: string): MockDurableObjectId
  idFromString(id: string): MockDurableObjectId
  newUniqueId(options?: { jurisdiction?: string; locationHint?: string }): MockDurableObjectId
  get(id: MockDurableObjectId): MockDurableObjectStub<T>
  /** Track all created stubs */
  stubs: Map<string, MockDurableObjectStub<T>>
  /** Configure stub behavior */
  stubFactory?: (id: MockDurableObjectId) => MockDurableObjectStub<T>
}

/**
 * Mock environment bindings
 */
export interface MockEnv {
  DO?: MockDurableObjectNamespace
  AI?: MockAI
  R2?: MockR2
  KV?: MockKV
  PIPELINE?: MockPipeline
  [key: string]: unknown
}

/**
 * Mock AI binding
 */
export interface MockAI {
  run(model: string, options: unknown): Promise<unknown>
  /** Tracked AI calls */
  calls: Array<{ model: string; options: unknown }>
  /** Configure mock responses */
  mockResponse(model: string, response: unknown): void
}

/**
 * Mock R2 bucket
 */
export interface MockR2 {
  put(key: string, value: unknown): Promise<void>
  get(key: string): Promise<{ body: unknown } | null>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }>
  /** Raw data store */
  data: Map<string, unknown>
  /** Tracked operations */
  operations: Array<{ type: 'put' | 'get' | 'delete' | 'list'; key?: string }>
}

/**
 * Mock KV namespace
 */
export interface MockKV {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  /** Raw data store */
  data: Map<string, string>
}

/**
 * Mock Pipeline
 */
export interface MockPipeline {
  send(data: unknown): Promise<void>
  /** Captured events */
  events: unknown[]
}

/**
 * Options for creating a mock Durable Object
 */
export interface MockDOOptions<E extends MockEnv = MockEnv> {
  /** ID for the DO (defaults to random UUID) */
  id?: string
  /** Optional name for named IDs */
  name?: string
  /** Initial storage data */
  storage?: Map<string, unknown> | Record<string, unknown>
  /** Initial SQL data by table name */
  sqlData?: Map<string, unknown[]>
  /** Custom environment bindings */
  env?: Partial<E>
  /** Namespace URL */
  ns?: string
}

/**
 * Result of creating a mock Durable Object
 */
export interface MockDOResult<T, E extends MockEnv = MockEnv> {
  /** The DO instance */
  instance: T
  /** Mock context (state) */
  ctx: MockDurableObjectState
  /** Mock environment */
  env: E
  /** Direct access to mock storage */
  storage: MockDurableObjectStorage
  /** Direct access to SQL data tables */
  sqlData: Map<string, unknown[]>
  /** Reset all tracking and optionally clear storage */
  reset(options?: { clearStorage?: boolean }): void
}

// ============================================================================
// FACTORY IMPLEMENTATIONS
// ============================================================================

/**
 * Create a mock DurableObjectId
 */
export function createMockId(id?: string, name?: string): MockDurableObjectId {
  const idString = id ?? crypto.randomUUID()
  return {
    toString: () => idString,
    equals: (other: MockDurableObjectId) => other.toString() === idString,
    name,
  }
}

/**
 * Create a mock SQL storage with operation tracking
 */
export function createMockSqlStorage(sqlData: Map<string, unknown[]>): MockSqlStorage {
  const operations: SqlOperation[] = []
  const mockResponses = new Map<string | RegExp, unknown[]>()

  return {
    operations,

    exec<T = unknown>(query: string, ...params: unknown[]): MockSqlStorageCursor<T> {
      operations.push({ query, params, timestamp: Date.now() })

      // Check for mocked responses
      for (const [pattern, response] of mockResponses) {
        if (typeof pattern === 'string' && query.includes(pattern)) {
          return createMockCursor<T>(response as T[])
        }
        if (pattern instanceof RegExp && pattern.test(query)) {
          return createMockCursor<T>(response as T[])
        }
      }

      // Parse simple queries for table operations
      // Handle both quoted and unquoted table names (e.g., `things` or "things" or things)
      const selectMatch = query.match(/SELECT.*FROM\s+["`]?(\w+)["`]?/i)
      const insertMatch = query.match(/INSERT\s+INTO\s+["`]?(\w+)["`]?/i)
      const deleteMatch = query.match(/DELETE\s+FROM\s+["`]?(\w+)["`]?/i)
      const updateMatch = query.match(/UPDATE\s+["`]?(\w+)["`]?\s+SET/i)

      if (selectMatch) {
        const tableName = selectMatch[1]
        const tableData = sqlData.get(tableName) || []
        return createMockCursor<T>(tableData as T[])
      }

      if (insertMatch) {
        // Return empty for inserts
        return createMockCursor<T>([])
      }

      if (deleteMatch) {
        const tableName = deleteMatch[1]
        const tableData = sqlData.get(tableName) || []

        // Parse WHERE clause for targeted deletes
        // Support multiple formats:
        // - DELETE FROM "things" WHERE "things"."id" = ?
        // - delete from "things" where "id" = ?
        // - DELETE FROM things WHERE id = ?
        const wherePatterns = [
          /WHERE\s+["`]?\w+["`]?\.["`]?(\w+)["`]?\s*=\s*\?/i,  // table.column = ?
          /WHERE\s+["`]?(\w+)["`]?\s*=\s*\?/i,                  // column = ?
        ]

        let whereField: string | null = null
        for (const pattern of wherePatterns) {
          const match = query.match(pattern)
          if (match) {
            whereField = match[1]
            break
          }
        }

        if (whereField && params.length > 0) {
          const whereValue = params[0] // First param is the WHERE value

          // Filter out the matching records
          const filteredData = tableData.filter((record: unknown) => {
            const rec = record as Record<string, unknown>
            return rec[whereField!] !== whereValue
          })
          sqlData.set(tableName, filteredData)
        } else {
          // No WHERE clause - clear entire table
          sqlData.set(tableName, [])
        }
        return createMockCursor<T>([])
      }

      if (updateMatch) {
        const tableName = updateMatch[1]
        const tableData = sqlData.get(tableName) || []
        // Parse SET clause and WHERE clause for basic update support
        // Example: UPDATE things SET "deleted" = ?, "data" = ? WHERE "things"."id" = ?
        const setMatch = query.match(/SET\s+(.*?)\s+WHERE/i)
        const whereMatch = query.match(/WHERE\s+["`]?\w+["`]?\.["`]?(\w+)["`]?\s*=\s*\?/i)

        if (setMatch && whereMatch && params.length > 0) {
          const whereField = whereMatch[1]
          const whereValue = params[params.length - 1] // Last param is typically the WHERE value

          // Find and update the matching record
          const updatedData = tableData.map((record: unknown) => {
            const rec = record as Record<string, unknown>
            if (rec[whereField] === whereValue) {
              // Parse SET fields from the query
              // Match patterns like "deleted" = ? or `data` = ?
              const setFields = setMatch[1].match(/["`]?(\w+)["`]?\s*=\s*\?/g) || []
              const updatedRecord = { ...rec }
              setFields.forEach((field: string, idx: number) => {
                const fieldName = field.match(/["`]?(\w+)["`]?\s*=\s*\?/)?.[1]
                if (fieldName && idx < params.length - 1) {
                  // Parse JSON strings back to objects
                  let value = params[idx]
                  if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
                    try {
                      value = JSON.parse(value)
                    } catch {
                      // Keep as string
                    }
                  }
                  updatedRecord[fieldName] = value
                }
              })
              return updatedRecord
            }
            return rec
          })
          sqlData.set(tableName, updatedData)
        }
        return createMockCursor<T>([])
      }

      // Default: return empty
      return createMockCursor<T>([])
    },

    mockResponse(pattern: string | RegExp, response: unknown[]): void {
      mockResponses.set(pattern, response)
    },

    clearMocks(): void {
      mockResponses.clear()
    },
  }
}

/**
 * Create a mock SQL cursor
 */
function createMockCursor<T>(data: T[]): MockSqlStorageCursor<T> {
  // For raw(), we need to serialize JSON columns as strings because Drizzle will parse them
  const rawData = data.map((row) => {
    const obj = row as Record<string, unknown>
    return Object.values(obj).map((val) => {
      // If value is an object (not null), serialize it as JSON string for Drizzle to parse
      if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
        return JSON.stringify(val)
      }
      return val
    })
  })

  return {
    toArray: () => [...data],
    one: () => data[0],
    // Drizzle's durable-sqlite driver expects raw() to return an object with toArray()
    raw: () => ({
      toArray: () => rawData,
      columnNames: data.length > 0 ? Object.keys(data[0] as Record<string, unknown>) : [],
    }),
    [Symbol.iterator]: function* () {
      for (const item of data) {
        yield item
      }
    },
  }
}

/**
 * Create a mock DurableObjectStorage with operation tracking
 */
export function createMockStorage(
  initialData?: Map<string, unknown> | Record<string, unknown>,
  sqlData?: Map<string, unknown[]>
): MockDurableObjectStorage {
  // Initialize data store
  const data = new Map<string, unknown>()
  if (initialData instanceof Map) {
    for (const [key, value] of initialData) {
      data.set(key, value)
    }
  } else if (initialData) {
    for (const [key, value] of Object.entries(initialData)) {
      data.set(key, value)
    }
  }

  // Initialize SQL data
  const sqlTables = sqlData ?? new Map<string, unknown[]>()

  // Tracking arrays
  const operations: StorageOperation[] = []
  const puts: Array<[string, unknown]> = []
  const gets: string[] = []
  const deletes: string[] = []

  // Create mock SQL storage
  const sql = createMockSqlStorage(sqlTables)

  // Track alarm time
  let alarmTime: number | null = null

  const storage: MockDurableObjectStorage = {
    operations,
    puts,
    gets,
    deletes,
    data,
    sql,
    get alarmTime() {
      return alarmTime
    },
    set alarmTime(value: number | null) {
      alarmTime = value
    },

    clearTracking() {
      operations.length = 0
      puts.length = 0
      gets.length = 0
      deletes.length = 0
      sql.operations.length = 0
    },

    async get<T = unknown>(keyOrKeys: string | string[]): Promise<T | Map<string, T> | undefined> {
      if (Array.isArray(keyOrKeys)) {
        operations.push({ type: 'get', key: keyOrKeys, timestamp: Date.now() })
        const result = new Map<string, T>()
        for (const key of keyOrKeys) {
          gets.push(key)
          if (data.has(key)) {
            result.set(key, data.get(key) as T)
          }
        }
        return result as Map<string, T>
      }

      operations.push({ type: 'get', key: keyOrKeys, timestamp: Date.now() })
      gets.push(keyOrKeys)
      return data.get(keyOrKeys) as T | undefined
    },

    async list<T = unknown>(options?: DurableObjectListOptions): Promise<Map<string, T>> {
      operations.push({ type: 'list', options, timestamp: Date.now() })
      const result = new Map<string, T>()

      const entries = Array.from(data.entries())
      let filtered = entries

      // Apply prefix filter
      if (options?.prefix) {
        filtered = filtered.filter(([key]) => key.startsWith(options.prefix!))
      }

      // Apply start filter
      if (options?.start) {
        filtered = filtered.filter(([key]) => key >= options.start!)
      }

      // Apply startAfter filter
      if (options?.startAfter) {
        filtered = filtered.filter(([key]) => key > options.startAfter!)
      }

      // Apply end filter
      if (options?.end) {
        filtered = filtered.filter(([key]) => key < options.end!)
      }

      // Sort
      filtered.sort((a, b) => (options?.reverse ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])))

      // Apply limit
      if (options?.limit) {
        filtered = filtered.slice(0, options.limit)
      }

      for (const [key, value] of filtered) {
        result.set(key, value as T)
      }

      return result
    },

    async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
      if (typeof keyOrEntries === 'string') {
        operations.push({ type: 'put', key: keyOrEntries, value, timestamp: Date.now() })
        puts.push([keyOrEntries, value])
        data.set(keyOrEntries, value)
      } else {
        for (const [key, val] of Object.entries(keyOrEntries)) {
          operations.push({ type: 'put', key, value: val, timestamp: Date.now() })
          puts.push([key, val])
          data.set(key, val)
        }
      }
    },

    async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
      if (Array.isArray(keyOrKeys)) {
        operations.push({ type: 'delete', key: keyOrKeys, timestamp: Date.now() })
        let count = 0
        for (const key of keyOrKeys) {
          deletes.push(key)
          if (data.delete(key)) {
            count++
          }
        }
        return count
      }

      operations.push({ type: 'delete', key: keyOrKeys, timestamp: Date.now() })
      deletes.push(keyOrKeys)
      return data.delete(keyOrKeys)
    },

    async deleteAll(): Promise<void> {
      operations.push({ type: 'deleteAll', timestamp: Date.now() })
      data.clear()
    },

    async getAlarm(): Promise<number | null> {
      return alarmTime
    },

    async setAlarm(time: Date | number): Promise<void> {
      alarmTime = typeof time === 'number' ? time : time.getTime()
    },

    async deleteAlarm(): Promise<void> {
      alarmTime = null
    },
  }

  return storage
}

/**
 * Create a mock DurableObjectState
 */
export function createMockState(
  id: MockDurableObjectId,
  storage: MockDurableObjectStorage
): MockDurableObjectState {
  let alarmTime: number | null = null
  const waitUntilPromises: Promise<unknown>[] = []

  return {
    id,
    storage,

    waitUntil(promise: Promise<unknown>): void {
      waitUntilPromises.push(promise)
    },

    async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      return callback()
    },

    async getAlarm(): Promise<number | null> {
      return alarmTime
    },

    async setAlarm(time: Date | number): Promise<void> {
      alarmTime = typeof time === 'number' ? time : time.getTime()
    },

    async deleteAlarm(): Promise<void> {
      alarmTime = null
    },
  }
}

/**
 * Create a mock DO namespace
 */
export function createMockDONamespace<T = unknown>(): MockDurableObjectNamespace<T> {
  const stubs = new Map<string, MockDurableObjectStub<T>>()
  let stubFactory: ((id: MockDurableObjectId) => MockDurableObjectStub<T>) | undefined

  return {
    stubs,

    get stubFactory() {
      return stubFactory
    },

    set stubFactory(factory: ((id: MockDurableObjectId) => MockDurableObjectStub<T>) | undefined) {
      stubFactory = factory
    },

    idFromName(name: string): MockDurableObjectId {
      return createMockId(`id-from-${name}`, name)
    },

    idFromString(id: string): MockDurableObjectId {
      return createMockId(id)
    },

    newUniqueId(options?: { jurisdiction?: string; locationHint?: string }): MockDurableObjectId {
      const id = `new-unique-id-${crypto.randomUUID().slice(0, 8)}`
      const mockId = createMockId(id)
      // Store location hint for testing
      ;(mockId as Record<string, unknown>).locationHint = options?.locationHint
      return mockId
    },

    get(id: MockDurableObjectId): MockDurableObjectStub<T> {
      const idString = id.toString()

      // Return existing stub if available
      if (stubs.has(idString)) {
        return stubs.get(idString)!
      }

      // Use factory if provided
      if (stubFactory) {
        const stub = stubFactory(id)
        stubs.set(idString, stub)
        return stub
      }

      // Create default stub
      const stub: MockDurableObjectStub<T> = {
        id,
        fetch: vi.fn(async () => new Response('OK')),
      }
      stubs.set(idString, stub)
      return stub
    },
  }
}

/**
 * Create a mock AI binding
 */
export function createMockAI(): MockAI {
  const calls: Array<{ model: string; options: unknown }> = []
  const mockResponses = new Map<string, unknown>()

  return {
    calls,

    async run(model: string, options: unknown): Promise<unknown> {
      calls.push({ model, options })
      return mockResponses.get(model) ?? { text: `Mock AI response for ${model}` }
    },

    mockResponse(model: string, response: unknown): void {
      mockResponses.set(model, response)
    },
  }
}

/**
 * Create a mock R2 bucket
 */
export function createMockR2(): MockR2 {
  const data = new Map<string, unknown>()
  const operations: Array<{ type: 'put' | 'get' | 'delete' | 'list'; key?: string }> = []

  return {
    data,
    operations,

    async put(key: string, value: unknown): Promise<void> {
      operations.push({ type: 'put', key })
      data.set(key, value)
    },

    async get(key: string): Promise<{ body: unknown } | null> {
      operations.push({ type: 'get', key })
      const value = data.get(key)
      return value !== undefined ? { body: value } : null
    },

    async delete(key: string): Promise<void> {
      operations.push({ type: 'delete', key })
      data.delete(key)
    },

    async list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }> {
      operations.push({ type: 'list' })
      const keys = Array.from(data.keys())
      const filtered = options?.prefix ? keys.filter((k) => k.startsWith(options.prefix!)) : keys
      return { objects: filtered.map((key) => ({ key })) }
    },
  }
}

/**
 * Create a mock KV namespace
 */
export function createMockKV(): MockKV {
  const data = new Map<string, string>()

  return {
    data,

    async get(key: string): Promise<string | null> {
      return data.get(key) ?? null
    },

    async put(key: string, value: string): Promise<void> {
      data.set(key, value)
    },

    async delete(key: string): Promise<void> {
      data.delete(key)
    },
  }
}

/**
 * Create a mock Pipeline
 */
export function createMockPipeline(): MockPipeline {
  const events: unknown[] = []

  return {
    events,

    async send(data: unknown): Promise<void> {
      if (Array.isArray(data)) {
        events.push(...data)
      } else {
        events.push(data)
      }
    },
  }
}

/**
 * Create a mock environment with all bindings
 */
export function createMockEnv<E extends MockEnv = MockEnv>(
  overrides?: Partial<E>
): E {
  const env: MockEnv = {
    DO: createMockDONamespace(),
    AI: createMockAI(),
    R2: createMockR2(),
    KV: createMockKV(),
    PIPELINE: createMockPipeline(),
    ...overrides,
  }

  return env as E
}

// ============================================================================
// MAIN FACTORY FUNCTION
// ============================================================================

/**
 * Create a mock Durable Object instance for testing.
 *
 * This factory provides:
 * - Mock DurableObjectState with in-memory storage
 * - Mock SQL storage with query tracking
 * - Mock environment bindings (DO, KV, R2, AI, Pipeline)
 * - Operation tracking for assertions
 * - Test isolation (storage resets between tests)
 *
 * @param DOClass - The Durable Object class to instantiate
 * @param options - Configuration options
 * @returns Object containing the DO instance, context, environment, and utilities
 *
 * @example
 * ```typescript
 * import { createMockDO } from 'dotdo/testing'
 * import { Business } from '../objects/Business'
 *
 * describe('Business DO', () => {
 *   it('should store configuration', async () => {
 *     const { instance, storage } = createMockDO(Business, {
 *       id: 'test-biz',
 *       storage: { config: { name: 'Acme' } },
 *     })
 *
 *     const config = await instance.getConfig()
 *     expect(config?.name).toBe('Acme')
 *     expect(storage.gets).toContain('config')
 *   })
 * })
 * ```
 */
export function createMockDO<
  T extends new (ctx: MockDurableObjectState, env: E) => InstanceType<T>,
  E extends MockEnv = MockEnv,
>(
  DOClass: T,
  options: MockDOOptions<E> = {}
): MockDOResult<InstanceType<T>, E> {
  // Initialize SQL data tables with defaults
  const sqlData = options.sqlData ?? new Map<string, unknown[]>()

  // Ensure common tables exist
  const defaultTables = ['things', 'branches', 'actions', 'events', 'objects', 'relationships']
  for (const table of defaultTables) {
    if (!sqlData.has(table)) {
      sqlData.set(table, [])
    }
  }

  // Create mock components
  const id = createMockId(options.id, options.name)
  const storage = createMockStorage(options.storage, sqlData)
  const ctx = createMockState(id, storage)
  const env = createMockEnv<E>(options.env)

  // Store namespace if provided
  if (options.ns) {
    storage.data.set('ns', options.ns)
  }

  // Create the DO instance
  const instance = new DOClass(ctx, env) as InstanceType<T>

  // If namespace was provided, try to set it
  if (options.ns && 'ns' in instance) {
    // Use Object.defineProperty to bypass readonly
    Object.defineProperty(instance, 'ns', {
      value: options.ns,
      writable: false,
      configurable: true,
    })
  }

  // Reset function
  function reset(resetOptions?: { clearStorage?: boolean }): void {
    storage.clearTracking()

    if (resetOptions?.clearStorage) {
      storage.data.clear()
      for (const [table] of sqlData) {
        sqlData.set(table, [])
      }
    }
  }

  return {
    instance,
    ctx,
    env,
    storage,
    sqlData,
    reset,
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a simple mock Request for testing DO fetch handlers
 */
export function createMockRequest(
  url: string,
  options?: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
  }
): Request {
  const init: RequestInit = {
    method: options?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  }

  if (options?.body !== undefined) {
    init.body = JSON.stringify(options.body)
  }

  return new Request(url, init)
}

/**
 * Assert that a storage operation occurred
 */
export function expectStorageOperation(
  storage: MockDurableObjectStorage,
  type: StorageOperation['type'],
  key?: string
): void {
  const found = storage.operations.some(
    (op) => op.type === type && (key === undefined || op.key === key)
  )

  if (!found) {
    const keyInfo = key ? ` with key "${key}"` : ''
    throw new Error(
      `Expected storage operation "${type}"${keyInfo} but found: ${JSON.stringify(
        storage.operations.map((op) => ({ type: op.type, key: op.key }))
      )}`
    )
  }
}

/**
 * Assert that a SQL query was executed
 */
export function expectSqlQuery(
  storage: MockDurableObjectStorage,
  pattern: string | RegExp
): void {
  const found = storage.sql.operations.some((op) => {
    if (typeof pattern === 'string') {
      return op.query.includes(pattern)
    }
    return pattern.test(op.query)
  })

  if (!found) {
    throw new Error(
      `Expected SQL query matching "${pattern}" but found: ${JSON.stringify(
        storage.sql.operations.map((op) => op.query)
      )}`
    )
  }
}

export default createMockDO
