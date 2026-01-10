/**
 * $ Proxy - Unified Schema Access
 *
 * The $ proxy provides access to the introspected DOSchema.
 * Instead of calling $introspect() separately, $ IS the schema.
 *
 * @example
 * ```ts
 * const $ = await createDOProxy('myapp.com', token)
 *
 * $                    // → DOSchema (callable)
 * $.schema             // → DOSchema
 * $.classes            // → DOClassSchema[]
 * $.Users              // → Class proxy
 * await $.Users()      // → List all users
 * await $.Users('id')  // → Get user by ID
 * $.Users.where({})    // → Query builder
 * $.fsx                // → Filesystem client
 * ```
 *
 * @module proxy
 */

import type { DOSchema } from '../../../types/introspect'

// ============================================================================
// TYPES
// ============================================================================

export interface CreateDOProxyOptions {
  /** Bypass cache and fetch fresh schema */
  cache?: boolean
}

/**
 * Proxy type for accessing DO classes
 */
export interface ClassProxy<T = unknown> {
  /** List all instances */
  (): Promise<T[]>
  /** Get instance by ID */
  (id: string): Promise<T>
  /** Query with filter */
  where(filter: Partial<T>): Promise<T[]>
  /** Count instances */
  count(filter?: Partial<T>): Promise<number>
  /** Create new instance */
  create(data: Omit<T, 'id'>): Promise<T>
  /** Update instance */
  update(id: string, data: Partial<T>): Promise<T>
  /** Delete instance */
  delete(id: string): Promise<void>
}

/**
 * Storage client interfaces
 */
export interface FSXClient {
  ls(path: string): Promise<string[]>
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  mkdir(path: string): Promise<void>
  rm(path: string): Promise<void>
  stat(path: string): Promise<{ size: number; mtime: Date }>
}

export interface GitXClient {
  status(): Promise<{ modified: string[]; staged: string[] }>
  log(limit?: number): Promise<Array<{ hash: string; message: string; date: Date }>>
  commit(message: string): Promise<string>
  push(): Promise<void>
  pull(): Promise<void>
}

export interface BashXClient {
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

/**
 * The unified $ proxy type
 */
export interface DOSchemaProxy extends DOSchema {
  /** Get raw schema */
  schema: DOSchema
  /** Filesystem client (if enabled) */
  fsx?: FSXClient
  /** Git client (if enabled) */
  gitx?: GitXClient
  /** Shell client (if enabled, admin only) */
  bashx?: BashXClient
  /** Dynamic class access */
  [className: string]: ClassProxy | unknown
}

// ============================================================================
// MOCK HELPERS (for testing)
// ============================================================================

let mockFetch: ((ns: string, options: RequestInit) => Promise<DOSchema>) | null = null
let mockRPC: ((method: string, args: unknown[]) => Promise<unknown>) | null = null
let mockStorage: {
  fsx?: Partial<FSXClient>
  gitx?: Partial<GitXClient>
  bashx?: Partial<BashXClient>
} | null = null

/** @internal Test helper to mock fetch */
export function __setMockFetch(fn: typeof mockFetch): void {
  mockFetch = fn
}

/** @internal Test helper to mock RPC calls */
export function __setMockRPC(fn: typeof mockRPC): void {
  mockRPC = fn
}

/** @internal Test helper to mock storage clients */
export function __setMockStorage(storage: typeof mockStorage): void {
  mockStorage = storage
}

/** @internal Test helper to clear schema cache */
export function __clearCache(): void {
  schemaCache.clear()
}

// ============================================================================
// SCHEMA CACHE
// ============================================================================

const schemaCache = new Map<string, DOSchema>()

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Fetch schema from server or use mock.
 */
async function fetchSchema(ns: string, token: string): Promise<DOSchema> {
  if (mockFetch) {
    return mockFetch(`https://${ns}/_do/introspect`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  }

  const response = await fetch(`https://${ns}/_do/introspect`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch schema: ${response.statusText}`)
  }
  return response.json()
}

/**
 * Validate that a response is a valid DOSchema.
 */
function validateSchema(data: unknown): data is DOSchema {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj.ns === 'string' &&
    Array.isArray(obj.classes) &&
    obj.permissions !== undefined
  )
}

/**
 * Create a class proxy for DO class access.
 */
function createClassProxy(
  className: string,
  _schema: DOSchema,
  _token: string
): ClassProxy {
  const classProxy = function (idOrNothing?: string) {
    if (idOrNothing === undefined) {
      // List all instances
      if (mockRPC) {
        return mockRPC('list', [])
      }
      return Promise.resolve([])
    } else {
      // Get by ID
      if (mockRPC) {
        return mockRPC('get', [idOrNothing])
      }
      return Promise.resolve(null)
    }
  } as ClassProxy

  // Add query methods
  classProxy.where = (filter: Partial<unknown>) => {
    if (mockRPC) {
      return mockRPC('where', [filter]) as Promise<unknown[]>
    }
    return Promise.resolve([])
  }

  classProxy.count = (filter?: Partial<unknown>) => {
    if (mockRPC) {
      return mockRPC('count', [filter]) as Promise<number>
    }
    return Promise.resolve(0)
  }

  classProxy.create = (data: Omit<unknown, 'id'>) => {
    if (mockRPC) {
      return mockRPC('create', [data]) as Promise<unknown>
    }
    return Promise.resolve(data)
  }

  classProxy.update = (id: string, data: Partial<unknown>) => {
    if (mockRPC) {
      return mockRPC('update', [id, data]) as Promise<unknown>
    }
    return Promise.resolve({ id, ...data })
  }

  classProxy.delete = (id: string) => {
    if (mockRPC) {
      return mockRPC('delete', [id]) as Promise<void>
    }
    return Promise.resolve()
  }

  return classProxy
}

/**
 * Create a $ proxy for accessing DO schema and classes.
 *
 * @param ns - Namespace URL (e.g., 'myapp.com')
 * @param token - Auth token
 * @param options - Options
 * @returns Proxy that provides schema and class access
 *
 * @example
 * ```ts
 * const $ = await createDOProxy('myapp.com', token)
 *
 * console.log($.ns)           // 'myapp.com'
 * console.log($.classes)      // [...DO classes...]
 *
 * const users = await $.Users()
 * const user = await $.Users('usr-1')
 * const admins = await $.Users.where({ role: 'admin' })
 * ```
 */
export async function createDOProxy(
  ns: string,
  token: string,
  options?: CreateDOProxyOptions
): Promise<DOSchemaProxy> {
  // Check cache first
  const useCache = options?.cache !== false
  if (useCache && schemaCache.has(ns)) {
    const schema = schemaCache.get(ns)!
    return createSchemaProxy(schema, token)
  }

  // Fetch schema
  const rawSchema = await fetchSchema(ns, token)

  // Validate schema
  if (!validateSchema(rawSchema)) {
    throw new Error('Invalid schema response')
  }

  // Cache if enabled
  if (useCache) {
    schemaCache.set(ns, rawSchema)
  }

  return createSchemaProxy(rawSchema, token)
}

/**
 * Create the actual proxy object from a schema.
 */
function createSchemaProxy(schema: DOSchema, token: string): DOSchemaProxy {
  // Create class proxy cache
  const classProxies = new Map<string, ClassProxy>()

  // Build storage clients
  const storage = schema.storage
  const fsxClient: FSXClient | undefined =
    storage.fsx && mockStorage?.fsx
      ? (mockStorage.fsx as FSXClient)
      : storage.fsx
        ? createFSXClient()
        : undefined

  const gitxClient: GitXClient | undefined =
    storage.gitx && mockStorage?.gitx
      ? (mockStorage.gitx as GitXClient)
      : storage.gitx
        ? createGitXClient()
        : undefined

  const bashxClient: BashXClient | undefined =
    storage.bashx && mockStorage?.bashx
      ? (mockStorage.bashx as BashXClient)
      : storage.bashx
        ? createBashXClient()
        : undefined

  // Define the known properties for ownKeys
  // Include function properties because we're proxying a function
  const knownKeys = [
    'length',
    'name',
    'prototype',
    'schema',
    'ns',
    'permissions',
    'classes',
    'stores',
    'storage',
    'nouns',
    'verbs',
    'fsx',
    'gitx',
    'bashx',
  ]

  const proxyTarget = function () {
    return schema
  }

  const proxy = new Proxy(proxyTarget, {
    get(_target, prop: string | symbol) {
      if (typeof prop === 'symbol') return undefined

      // Schema properties
      switch (prop) {
        case 'schema':
          return schema
        case 'ns':
          return schema.ns
        case 'permissions':
          return schema.permissions
        case 'classes':
          return schema.classes
        case 'stores':
          return schema.stores
        case 'storage':
          return schema.storage
        case 'nouns':
          return schema.nouns
        case 'verbs':
          return schema.verbs

        // Storage clients
        case 'fsx':
          return fsxClient
        case 'gitx':
          return gitxClient
        case 'bashx':
          return bashxClient
      }

      // Check if it's a DO class name
      const doClass = schema.classes.find((c) => c.name === prop)
      if (doClass) {
        if (!classProxies.has(prop)) {
          classProxies.set(prop, createClassProxy(prop, schema, token))
        }
        return classProxies.get(prop)
      }

      return undefined
    },

    apply(_target, _thisArg, _args) {
      return schema
    },

    ownKeys() {
      return knownKeys
    },

    getOwnPropertyDescriptor(target, prop) {
      // Handle standard function properties (non-enumerable)
      if (prop === 'prototype') {
        return {
          configurable: false,
          enumerable: false,
          writable: true,
          value: {},
        }
      }
      if (prop === 'length') {
        return {
          configurable: true,
          enumerable: false,
          value: 0,
        }
      }
      if (prop === 'name') {
        return {
          configurable: true,
          enumerable: false,
          value: target.name || '',
        }
      }
      // Schema properties are enumerable
      if (knownKeys.includes(prop as string)) {
        return {
          configurable: true,
          enumerable: true,
          value: proxy[prop as keyof typeof proxy],
        }
      }
      return undefined
    },
  })

  return proxy as unknown as DOSchemaProxy
}

/**
 * Create a stub FSX client (would be real in production).
 */
function createFSXClient(): FSXClient {
  return {
    ls: async () => [],
    read: async () => '',
    write: async () => {},
    mkdir: async () => {},
    rm: async () => {},
    stat: async () => ({ size: 0, mtime: new Date() }),
  }
}

/**
 * Create a stub GitX client (would be real in production).
 */
function createGitXClient(): GitXClient {
  return {
    status: async () => ({ modified: [], staged: [] }),
    log: async () => [],
    commit: async () => '',
    push: async () => {},
    pull: async () => {},
  }
}

/**
 * Create a stub BashX client (would be real in production).
 */
function createBashXClient(): BashXClient {
  return {
    exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  }
}

// ============================================================================
// DEPRECATED - Backwards Compatibility
// ============================================================================

/**
 * Introspect the DO schema.
 *
 * @deprecated Use `createDOProxy()` instead, which provides the same schema
 * via the `$.schema` property plus additional class and storage access.
 *
 * @example
 * ```ts
 * // Old way (deprecated):
 * const schema = await $introspect('myapp.com', token)
 *
 * // New way (recommended):
 * const $ = await createDOProxy('myapp.com', token)
 * const schema = $.schema  // Same DOSchema
 * // Plus:
 * const users = await $.Users()  // Direct class access
 * const files = await $.fsx.ls() // Storage access
 * ```
 *
 * @param ns - Namespace URL (e.g., 'myapp.com')
 * @param token - Auth token
 * @param options - Options
 * @returns The DOSchema for the namespace
 */
export async function $introspect(
  ns: string,
  token: string,
  options?: CreateDOProxyOptions
): Promise<DOSchema> {
  console.warn(
    '[$introspect] Deprecated: Use createDOProxy() instead. ' +
      'See https://dotdo.ai/docs/migration/proxy for migration guide.'
  )
  const proxy = await createDOProxy(ns, token, options)
  return proxy.schema
}
