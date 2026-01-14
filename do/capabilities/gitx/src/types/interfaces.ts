/**
 * @fileoverview Consolidated Interface Types
 *
 * This module provides common interface types used across the gitx.do codebase,
 * including storage interfaces, R2 bucket types, and workflow context interfaces.
 * These interfaces serve as the foundation for DO integration modules.
 *
 * @module types/interfaces
 *
 * @example
 * ```typescript
 * import type { SqlStorage, R2BucketLike, WorkflowContext } from 'gitx.do/types'
 *
 * // Use in a Durable Object context
 * class MyDO {
 *   private storage: SqlStorage
 *   private r2: R2BucketLike
 *
 *   constructor(state: DurableObjectState) {
 *     this.storage = state.storage
 *   }
 * }
 * ```
 */

// ============================================================================
// SQL Storage Interfaces
// ============================================================================

/**
 * SQL execution result interface.
 *
 * @description
 * Represents the result of executing a SQL query. The result can be
 * converted to an array of row objects using the toArray() method.
 *
 * @example
 * ```typescript
 * const result = storage.sql.exec('SELECT * FROM objects WHERE sha = ?', sha)
 * const rows = result.toArray()
 * ```
 */
export interface SqlResult {
  /**
   * Convert the result to an array of row objects.
   * @returns Array of row objects matching the query
   */
  toArray(): unknown[]
}

/**
 * SQL execution interface.
 *
 * @description
 * Provides access to SQLite query execution within a Durable Object.
 * Supports parameterized queries using ? placeholders.
 *
 * @example
 * ```typescript
 * const result = storage.sql.exec(
 *   'INSERT INTO objects (sha, type, data) VALUES (?, ?, ?)',
 *   sha, 'blob', data
 * )
 * ```
 */
export interface SqlExec {
  /**
   * Execute a SQL query with optional parameters.
   *
   * @param query - SQL query string (can use ? placeholders)
   * @param params - Parameter values for placeholders
   * @returns Result object with toArray() method for reading rows
   */
  exec(query: string, ...params: unknown[]): SqlResult
}

/**
 * SQL storage interface for Durable Object storage.
 *
 * @description
 * Abstraction over Cloudflare's Durable Object storage that provides
 * SQLite access. This interface is used by modules that need database
 * persistence within a DO.
 *
 * @example
 * ```typescript
 * class GitModule {
 *   constructor(private storage: SqlStorage) {}
 *
 *   async getCommit(sha: string) {
 *     const result = this.storage.sql.exec(
 *       'SELECT * FROM objects WHERE sha = ? AND type = ?',
 *       sha, 'commit'
 *     )
 *     return result.toArray()[0]
 *   }
 * }
 * ```
 */
export interface SqlStorage {
  /**
   * SQL execution interface.
   */
  sql: SqlExec
}

// ============================================================================
// R2 Storage Interfaces
// ============================================================================

/**
 * R2 object interface.
 *
 * @description
 * Represents a single object stored in R2 (Cloudflare's object storage).
 * Provides methods to access the object's content as binary data or text.
 *
 * @example
 * ```typescript
 * const obj = await r2.get('git/objects/ab/cdef...')
 * if (obj) {
 *   const data = await obj.arrayBuffer()
 *   console.log(`Object size: ${obj.size} bytes`)
 * }
 * ```
 */
export interface R2ObjectLike {
  /** Object key (path in the bucket) */
  key: string
  /** Object size in bytes */
  size: number
  /**
   * Get the object content as an ArrayBuffer.
   * @returns Promise resolving to the binary content
   */
  arrayBuffer(): Promise<ArrayBuffer>
  /**
   * Get the object content as a UTF-8 string.
   * @returns Promise resolving to the text content
   */
  text(): Promise<string>
}

/**
 * R2 objects list result interface.
 *
 * @description
 * Represents the result of listing objects in an R2 bucket.
 * Supports pagination through the truncated flag and cursor.
 *
 * @example
 * ```typescript
 * let cursor: string | undefined
 * do {
 *   const result = await r2.list({ prefix: 'git/objects/', cursor })
 *   for (const obj of result.objects) {
 *     console.log(obj.key)
 *   }
 *   cursor = result.truncated ? result.cursor : undefined
 * } while (cursor)
 * ```
 */
export interface R2ObjectsLike {
  /** Array of object references */
  objects: R2ObjectLike[]
  /** Whether there are more objects to fetch */
  truncated: boolean
  /** Cursor for fetching the next page of results */
  cursor?: string
  /** Delimited prefixes (for directory-like listing) */
  delimitedPrefixes?: string[]
}

/**
 * R2 put options interface.
 *
 * @description
 * Options for putting objects into R2 storage.
 */
export interface R2PutOptions {
  /** Content-Type header for the object */
  httpMetadata?: {
    contentType?: string
    contentLanguage?: string
    contentDisposition?: string
    contentEncoding?: string
    cacheControl?: string
    cacheExpiry?: Date
  }
  /** Custom metadata for the object */
  customMetadata?: Record<string, string>
  /** MD5 hash for integrity verification */
  md5?: ArrayBuffer | string
  /** SHA-1 hash for integrity verification */
  sha1?: ArrayBuffer | string
  /** SHA-256 hash for integrity verification */
  sha256?: ArrayBuffer | string
  /** SHA-384 hash for integrity verification */
  sha384?: ArrayBuffer | string
  /** SHA-512 hash for integrity verification */
  sha512?: ArrayBuffer | string
  /** Storage class for the object */
  storageClass?: 'Standard' | 'InfrequentAccess'
}

/**
 * R2 bucket interface for object storage operations.
 *
 * @description
 * Represents an R2 bucket with methods for CRUD operations on objects.
 * Used as the global git object store across DOs.
 *
 * @example
 * ```typescript
 * // Store a git object
 * const sha = 'abc123...'
 * const key = `git/objects/${sha.slice(0, 2)}/${sha.slice(2)}`
 * await r2.put(key, objectData)
 *
 * // Retrieve a git object
 * const obj = await r2.get(key)
 * if (obj) {
 *   const data = await obj.arrayBuffer()
 * }
 * ```
 */
export interface R2BucketLike {
  /**
   * Get an object from the bucket.
   * @param key - Object key
   * @returns Promise resolving to the object, or null if not found
   */
  get(key: string): Promise<R2ObjectLike | null>

  /**
   * Put an object into the bucket.
   * @param key - Object key
   * @param value - Object content (binary data or string)
   * @param options - Optional put options
   * @returns Promise resolving to the stored object reference
   */
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string | ReadableStream | Blob,
    options?: R2PutOptions
  ): Promise<R2ObjectLike>

  /**
   * Delete one or more objects from the bucket.
   * @param key - Object key or array of keys to delete
   */
  delete(key: string | string[]): Promise<void>

  /**
   * List objects in the bucket.
   * @param options - List options (prefix, limit, cursor, delimiter)
   * @returns Promise resolving to the list result
   */
  list(options?: {
    prefix?: string
    limit?: number
    cursor?: string
    delimiter?: string
    include?: string[]
  }): Promise<R2ObjectsLike>

  /**
   * Check if an object exists in the bucket.
   * @param key - Object key
   * @returns Promise resolving to object metadata, or null if not found
   */
  head?(key: string): Promise<R2ObjectLike | null>
}

// ============================================================================
// KV Storage Interfaces
// ============================================================================

/**
 * KV namespace interface for key-value storage.
 *
 * @description
 * Represents a Cloudflare KV namespace for simple key-value operations.
 * Used for caching and lightweight data storage.
 *
 * @example
 * ```typescript
 * // Store a value
 * await kv.put('user:123', JSON.stringify({ name: 'Alice' }))
 *
 * // Retrieve a value
 * const data = await kv.get('user:123')
 * if (data) {
 *   const user = JSON.parse(data)
 * }
 * ```
 */
export interface KVNamespaceLike {
  /**
   * Get a value from KV.
   * @param key - Key to look up
   * @param options - Optional read options
   * @returns Promise resolving to the value, or null if not found
   */
  get(
    key: string,
    options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }
  ): Promise<string | null>

  /**
   * Put a value into KV.
   * @param key - Key to store under
   * @param value - Value to store
   * @param options - Optional write options (expiration, metadata)
   */
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: { expiration?: number; expirationTtl?: number; metadata?: unknown }
  ): Promise<void>

  /**
   * Delete a value from KV.
   * @param key - Key to delete
   */
  delete(key: string): Promise<void>

  /**
   * List keys in KV.
   * @param options - List options (prefix, limit, cursor)
   * @returns Promise resolving to the list result
   */
  list(options?: {
    prefix?: string
    limit?: number
    cursor?: string
  }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>
    list_complete: boolean
    cursor?: string
  }>
}

// ============================================================================
// Durable Object Interfaces
// ============================================================================

/**
 * Durable Object ID interface.
 *
 * @description
 * Represents a unique identifier for a Durable Object instance.
 */
export interface DurableObjectId {
  /** String representation of the ID */
  toString(): string
  /** Check if two IDs are equal */
  equals(other: DurableObjectId): boolean
}

/**
 * Durable Object stub interface.
 *
 * @description
 * A stub for communicating with a Durable Object instance.
 * Used to send HTTP requests to a DO.
 *
 * @example
 * ```typescript
 * const id = env.DO_NAMESPACE.idFromName('my-repo')
 * const stub = env.DO_NAMESPACE.get(id)
 * const response = await stub.fetch(request)
 * ```
 */
export interface DurableObjectStub {
  /**
   * Send an HTTP request to the Durable Object.
   * @param request - Request object or URL string
   * @param init - Optional request init
   * @returns Promise resolving to the response
   */
  fetch(request: Request | string, init?: RequestInit): Promise<Response>

  /** The ID of this Durable Object */
  id: DurableObjectId

  /** Name of the Durable Object (if created with idFromName) */
  name?: string
}

/**
 * Durable Object namespace interface.
 *
 * @description
 * Provides methods for creating IDs and getting stubs to Durable Objects.
 *
 * @example
 * ```typescript
 * // Get a DO by name
 * const id = env.DO_NAMESPACE.idFromName('repo/my-repo')
 * const stub = env.DO_NAMESPACE.get(id)
 *
 * // Create a new unique DO
 * const newId = env.DO_NAMESPACE.newUniqueId()
 * const newStub = env.DO_NAMESPACE.get(newId)
 * ```
 */
export interface DurableObjectNamespace {
  /**
   * Create an ID from a name (deterministic).
   * @param name - String name to derive ID from
   * @returns The Durable Object ID
   */
  idFromName(name: string): DurableObjectId

  /**
   * Parse an ID from its string representation.
   * @param id - String representation of the ID
   * @returns The Durable Object ID
   */
  idFromString(id: string): DurableObjectId

  /**
   * Create a new unique ID.
   * @param options - Optional creation options (locationHint)
   * @returns A new unique Durable Object ID
   */
  newUniqueId(options?: { locationHint?: string }): DurableObjectId

  /**
   * Get a stub for communicating with a Durable Object.
   * @param id - The Durable Object ID
   * @returns A stub for making requests to the DO
   */
  get(id: DurableObjectId): DurableObjectStub

  /**
   * Get jurisdiction-restricted ID from name.
   * @param name - String name to derive ID from
   * @param options - Jurisdiction options
   * @returns The Durable Object ID
   */
  jurisdiction?(name: string, options: { jurisdiction: string }): DurableObjectId
}

/**
 * Durable Object state interface.
 *
 * @description
 * The state object passed to a Durable Object constructor.
 * Provides access to storage, ID, and lifecycle methods.
 *
 * @example
 * ```typescript
 * class MyDO implements DurableObject {
 *   constructor(private state: DurableObjectState, private env: Env) {
 *     // Access storage
 *     const data = this.state.storage.sql.exec('SELECT * FROM table')
 *   }
 * }
 * ```
 */
export interface DurableObjectState {
  /** The unique ID of this Durable Object */
  id: DurableObjectId

  /** Storage interface with SQL and key-value access */
  storage: SqlStorage & {
    get(key: string): Promise<unknown>
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<boolean>
    list(options?: { prefix?: string }): Promise<Map<string, unknown>>
    setAlarm(scheduledTime: number | Date): Promise<void>
    getAlarm(): Promise<number | null>
    deleteAlarm(): Promise<void>
  }

  /**
   * Block concurrent requests until callback completes.
   * Used for initialization that must complete before handling requests.
   * @param callback - Async function to execute
   */
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>

  /**
   * Extend the lifetime of the DO to complete async work.
   * @param promise - Promise to wait for
   */
  waitUntil(promise: Promise<unknown>): void

  /**
   * Accept websocket connections.
   * @param ws - WebSocket to accept
   * @param tags - Optional tags for the connection
   */
  acceptWebSocket?(ws: WebSocket, tags?: string[]): void

  /**
   * Get all accepted websockets.
   * @param tag - Optional tag filter
   * @returns Array of accepted WebSockets
   */
  getWebSockets?(tag?: string): WebSocket[]
}

// ============================================================================
// Workflow Context Interfaces
// ============================================================================

/**
 * Event handler registration interface.
 *
 * @description
 * Provides a proxy interface for registering event handlers using
 * the pattern $.on.Noun.verb(handler).
 *
 * @example
 * ```typescript
 * // Register event handlers
 * $.on.User.created((user) => console.log('User created:', user))
 * $.on.Order.completed((order) => processOrder(order))
 * ```
 */
export type EventHandlerProxy = {
  [noun: string]: {
    [verb: string]: (handler: (data: unknown) => void | Promise<void>) => void
  }
}

/**
 * Schedule builder interface.
 *
 * @description
 * Provides a proxy interface for scheduling recurring tasks using
 * natural language patterns like $.every.monday.at('9am').
 *
 * @example
 * ```typescript
 * // Schedule recurring tasks
 * $.every.monday.at('9am')(() => sendWeeklyReport())
 * $.every.hour.at('30')(() => cleanupTempFiles())
 * ```
 */
export type ScheduleProxy = {
  [schedule: string]: {
    at: (time: string) => (handler: () => void | Promise<void>) => void
  }
}

/**
 * Workflow context interface (the $ API).
 *
 * @description
 * The main workflow context interface providing the $ API pattern
 * used throughout dotdo. Includes messaging (send/try/do), event
 * handling (on), and scheduling (every).
 *
 * @example
 * ```typescript
 * class MyDO extends DO {
 *   async handleRequest() {
 *     // Fire-and-forget
 *     this.$.send('user.created', { id: '123' })
 *
 *     // Quick attempt
 *     const result = await this.$.try('validate', data)
 *
 *     // Durable execution
 *     await this.$.do('process', data)
 *   }
 * }
 * ```
 */
export interface WorkflowContext {
  /**
   * Fire-and-forget event dispatch.
   * Queues an event for async processing without waiting.
   * @param event - Event name
   * @param data - Optional event data
   */
  send(event: string, data?: unknown): void

  /**
   * Quick attempt (blocking, non-durable).
   * Executes an action directly without persistence.
   * @param action - Action name
   * @param data - Optional action data
   * @returns Promise resolving to the action result
   */
  try<T>(action: string, data?: unknown): Promise<T>

  /**
   * Durable execution with retries.
   * Stores the action for durability and executes with retry logic.
   * @param action - Action name
   * @param data - Optional action data
   * @returns Promise resolving to the action result
   */
  do<T>(action: string, data?: unknown): Promise<T>

  /**
   * Event handler registration proxy.
   * Use as $.on.Noun.verb(handler).
   */
  on: EventHandlerProxy

  /**
   * Schedule builder proxy.
   * Use as $.every.schedule.at('time')(handler).
   */
  every: ScheduleProxy

  /**
   * Allow additional dynamic properties for domain proxies.
   * Supports patterns like $.User('id').method().
   */
  [key: string]: unknown
}

// ============================================================================
// Module Interfaces
// ============================================================================

/**
 * Base module interface.
 *
 * @description
 * Common interface for all DO modules (GitModule, FsModule, BashModule).
 * Provides lifecycle methods and a module name identifier.
 *
 * @example
 * ```typescript
 * class MyModule implements Module {
 *   readonly name = 'my-module'
 *
 *   async initialize() {
 *     // Setup module
 *   }
 *
 *   async dispose() {
 *     // Cleanup resources
 *   }
 * }
 * ```
 */
export interface Module {
  /** Module name identifier */
  readonly name: string

  /**
   * Initialize the module.
   * Called when the DO is first activated.
   */
  initialize?(): Promise<void>

  /**
   * Dispose the module.
   * Called when the DO is about to be deactivated.
   */
  dispose?(): Promise<void>
}

/**
 * Storage-backed module interface.
 *
 * @description
 * Interface for modules that persist state using SQL storage.
 * Extends the base Module interface with storage capabilities.
 */
export interface StorageBackedModule extends Module {
  /**
   * Attach storage to the module.
   * @param storage - SQL storage interface
   */
  attachStorage?(storage: SqlStorage): void
}

/**
 * Capability mixin result type.
 *
 * @description
 * Generic type for the result of applying a capability mixin.
 * Combines the base class with the capability interface.
 *
 * @template Base - The base class type
 * @template Cap - The capability interface
 *
 * @example
 * ```typescript
 * type GitCapableDO = WithCapability<typeof DO, GitCapability>
 * ```
 */
export type WithCapability<Base, Cap> = Base & Cap

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for gitx operations.
 *
 * @description
 * Extends the standard Error with additional context fields
 * for better error handling and debugging.
 */
export interface GitxError extends Error {
  /** Error code for programmatic handling */
  code: string
  /** HTTP status code if applicable */
  status?: number
  /** Additional context data */
  context?: Record<string, unknown>
}

/**
 * Storage error for database operations.
 */
export interface StorageError extends GitxError {
  code: 'STORAGE_ERROR'
  /** The SQL query that failed */
  query?: string
}

/**
 * R2 error for object storage operations.
 */
export interface R2Error extends GitxError {
  code: 'R2_ERROR'
  /** The object key involved */
  key?: string
}

/**
 * Git error for git operations.
 */
export interface GitError extends GitxError {
  code: 'GIT_ERROR'
  /** The git operation that failed */
  operation?: string
  /** The repository involved */
  repo?: string
}
