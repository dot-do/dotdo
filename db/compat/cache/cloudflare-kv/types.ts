/**
 * @dotdo/cloudflare-kv types
 *
 * Cloudflare Workers KV-compatible type definitions
 * for the KV SDK backed by Durable Objects and unified primitives.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/kv/
 */

// =============================================================================
// VALUE TYPES
// =============================================================================

/**
 * KV value types supported for storage
 */
export type KVValue = string | ArrayBuffer | ReadableStream

/**
 * Return types for get operations based on type parameter
 */
export type KVGetValueType = 'text' | 'json' | 'arrayBuffer' | 'stream'

/**
 * Metadata attached to a KV entry
 */
export type KVMetadata = Record<string, unknown> | null

// =============================================================================
// GET OPTIONS
// =============================================================================

/**
 * Options for KV get operations
 */
export interface KVGetOptions<Type extends KVGetValueType = 'text'> {
  /** The type to return: 'text', 'json', 'arrayBuffer', or 'stream' */
  type?: Type
  /**
   * If true, enables caching for the get.
   * This option is for compatibility but has no effect in the DO-backed implementation
   * since data is already cached in DO memory.
   */
  cacheTtl?: number
}

/**
 * Result of getWithMetadata operations
 */
export interface KVGetWithMetadataResult<T, M = unknown> {
  /** The value, or null if not found */
  value: T | null
  /** Metadata attached to the entry, or null if none */
  metadata: M | null
  /**
   * Cache status - for compatibility only.
   * Always returns 'MISS' in DO-backed implementation.
   */
  cacheStatus: 'HIT' | 'MISS' | null
}

// =============================================================================
// PUT OPTIONS
// =============================================================================

/**
 * Options for KV put operations
 */
export interface KVPutOptions<M = unknown> {
  /**
   * Expiration time as a Unix timestamp (seconds since epoch).
   * The key will be deleted after this time.
   * Must be at least 60 seconds in the future.
   */
  expiration?: number
  /**
   * Expiration time-to-live in seconds.
   * The key will be deleted this many seconds after the put.
   * Must be at least 60 seconds.
   */
  expirationTtl?: number
  /**
   * Arbitrary JSON-serializable metadata to store with the key.
   * Maximum size: 1024 bytes when JSON-serialized.
   */
  metadata?: M
}

// =============================================================================
// LIST OPTIONS
// =============================================================================

/**
 * Options for KV list operations
 */
export interface KVListOptions {
  /**
   * A prefix to filter keys.
   * Only keys starting with this prefix will be returned.
   */
  prefix?: string
  /**
   * Maximum number of keys to return.
   * @default 1000
   * @max 1000
   */
  limit?: number
  /**
   * A cursor for pagination.
   * Use the cursor from a previous list result to continue iteration.
   */
  cursor?: string
}

/**
 * A single key in the list result
 */
export interface KVListKey<M = unknown> {
  /** The key name */
  name: string
  /** Expiration time as Unix timestamp, if set */
  expiration?: number
  /** Metadata attached to the key, if any */
  metadata?: M
}

/**
 * Result of KV list operations
 */
export interface KVListResult<M = unknown> {
  /** Array of keys matching the query */
  keys: KVListKey<M>[]
  /** Whether there are more keys to fetch */
  list_complete: boolean
  /** Cursor for the next page of results, if list_complete is false */
  cursor?: string
  /**
   * Cache status - for compatibility only.
   * Always returns null in DO-backed implementation.
   */
  cacheStatus: 'HIT' | 'MISS' | null
}

// =============================================================================
// KV NAMESPACE INTERFACE
// =============================================================================

/**
 * Cloudflare Workers KV Namespace interface
 *
 * This interface matches the Cloudflare Workers KV API exactly,
 * allowing drop-in replacement of KV bindings.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/kv/
 */
export interface KVNamespace<M = unknown> {
  /**
   * Get a value from KV.
   *
   * @param key - The key to retrieve
   * @param options - Get options including type
   * @returns The value, or null if not found
   *
   * @example
   * // Get as text (default)
   * const text = await kv.get('mykey')
   *
   * @example
   * // Get as JSON
   * const data = await kv.get('mykey', { type: 'json' })
   *
   * @example
   * // Get as ArrayBuffer
   * const buffer = await kv.get('mykey', { type: 'arrayBuffer' })
   */
  get(key: string): Promise<string | null>
  get(key: string, type: 'text'): Promise<string | null>
  get(key: string, options: KVGetOptions<'text'>): Promise<string | null>
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>
  get<T = unknown>(key: string, options: KVGetOptions<'json'>): Promise<T | null>
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  get(key: string, options: KVGetOptions<'arrayBuffer'>): Promise<ArrayBuffer | null>
  get(key: string, type: 'stream'): Promise<ReadableStream | null>
  get(key: string, options: KVGetOptions<'stream'>): Promise<ReadableStream | null>

  /**
   * Get a value from KV with its metadata.
   *
   * @param key - The key to retrieve
   * @param options - Get options including type
   * @returns Object containing value, metadata, and cache status
   *
   * @example
   * const { value, metadata } = await kv.getWithMetadata('mykey')
   */
  getWithMetadata<Meta = M>(key: string): Promise<KVGetWithMetadataResult<string, Meta>>
  getWithMetadata<Meta = M>(key: string, type: 'text'): Promise<KVGetWithMetadataResult<string, Meta>>
  getWithMetadata<Meta = M>(key: string, options: KVGetOptions<'text'>): Promise<KVGetWithMetadataResult<string, Meta>>
  getWithMetadata<T = unknown, Meta = M>(key: string, type: 'json'): Promise<KVGetWithMetadataResult<T, Meta>>
  getWithMetadata<T = unknown, Meta = M>(key: string, options: KVGetOptions<'json'>): Promise<KVGetWithMetadataResult<T, Meta>>
  getWithMetadata<Meta = M>(key: string, type: 'arrayBuffer'): Promise<KVGetWithMetadataResult<ArrayBuffer, Meta>>
  getWithMetadata<Meta = M>(key: string, options: KVGetOptions<'arrayBuffer'>): Promise<KVGetWithMetadataResult<ArrayBuffer, Meta>>
  getWithMetadata<Meta = M>(key: string, type: 'stream'): Promise<KVGetWithMetadataResult<ReadableStream, Meta>>
  getWithMetadata<Meta = M>(key: string, options: KVGetOptions<'stream'>): Promise<KVGetWithMetadataResult<ReadableStream, Meta>>

  /**
   * Store a value in KV.
   *
   * @param key - The key to store under
   * @param value - The value to store (string, ArrayBuffer, or ReadableStream)
   * @param options - Put options including expiration and metadata
   *
   * @example
   * // Store a string
   * await kv.put('mykey', 'hello world')
   *
   * @example
   * // Store with expiration (1 hour from now)
   * await kv.put('mykey', 'temporary', { expirationTtl: 3600 })
   *
   * @example
   * // Store with metadata
   * await kv.put('mykey', 'data', { metadata: { author: 'alice' } })
   */
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: KVPutOptions<M>): Promise<void>

  /**
   * Delete a key from KV.
   *
   * @param key - The key to delete
   *
   * @example
   * await kv.delete('mykey')
   */
  delete(key: string): Promise<void>

  /**
   * List keys in the namespace.
   *
   * @param options - List options including prefix, limit, and cursor
   * @returns Object containing keys array and pagination info
   *
   * @example
   * // List all keys
   * const { keys } = await kv.list()
   *
   * @example
   * // List keys with prefix
   * const { keys } = await kv.list({ prefix: 'user:' })
   *
   * @example
   * // Paginate through all keys
   * let cursor: string | undefined
   * do {
   *   const result = await kv.list({ cursor, limit: 100 })
   *   for (const key of result.keys) {
   *     console.log(key.name)
   *   }
   *   cursor = result.list_complete ? undefined : result.cursor
   * } while (cursor)
   */
  list<Meta = M>(options?: KVListOptions): Promise<KVListResult<Meta>>
}

// =============================================================================
// EXTENDED OPTIONS
// =============================================================================

/**
 * Extended options for DO-backed KV implementation
 */
export interface ExtendedKVOptions {
  /**
   * Key prefix for partitioning.
   * All keys will be prefixed with this value.
   */
  keyPrefix?: string

  /**
   * Enable time-travel queries via TemporalStore.
   * When true, historical values can be queried.
   * @default false
   */
  enableTimeTravel?: boolean

  /**
   * Maximum number of versions to keep per key when time-travel is enabled.
   * @default 10
   */
  maxVersionsPerKey?: number

  /**
   * Enable metrics collection via Observability primitive.
   * @default false
   */
  enableMetrics?: boolean
}

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Base KV error
 */
export class KVError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KVError'
  }
}

/**
 * Error when key is not found (for internal use - get returns null)
 */
export class KVKeyNotFoundError extends KVError {
  readonly key: string

  constructor(key: string) {
    super(`Key not found: ${key}`)
    this.name = 'KVKeyNotFoundError'
    this.key = key
  }
}

/**
 * Error when value exceeds size limits
 */
export class KVValueTooLargeError extends KVError {
  readonly key: string
  readonly size: number
  readonly maxSize: number

  constructor(key: string, size: number, maxSize: number) {
    super(`Value too large for key "${key}": ${size} bytes exceeds maximum ${maxSize} bytes`)
    this.name = 'KVValueTooLargeError'
    this.key = key
    this.size = size
    this.maxSize = maxSize
  }
}

/**
 * Error when metadata exceeds size limits
 */
export class KVMetadataTooLargeError extends KVError {
  readonly key: string
  readonly size: number

  constructor(key: string, size: number) {
    super(`Metadata too large for key "${key}": ${size} bytes exceeds maximum 1024 bytes`)
    this.name = 'KVMetadataTooLargeError'
    this.key = key
    this.size = size
  }
}

/**
 * Error when expiration is invalid
 */
export class KVExpirationError extends KVError {
  constructor(message: string) {
    super(message)
    this.name = 'KVExpirationError'
  }
}
