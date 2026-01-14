/**
 * @fileoverview Git Object Store for Durable Objects
 *
 * This module provides a Git object storage implementation backed by SQLite
 * within Cloudflare Durable Objects. It handles CRUD operations for all four
 * Git object types (blob, tree, commit, tag) with proper SHA-1 hash computation.
 *
 * **Key Features**:
 * - Content-addressable storage using SHA-1 hashes
 * - Write-ahead logging (WAL) for durability
 * - Object index for tiered storage support
 * - Batch operations for efficiency with transaction support
 * - LRU caching for hot tier objects
 * - Metrics and logging infrastructure
 * - Typed accessors for each Git object type
 *
 * @module durable-object/object-store
 *
 * @example
 * ```typescript
 * import { ObjectStore } from './durable-object/object-store'
 *
 * const store = new ObjectStore(durableObjectStorage, {
 *   cacheMaxCount: 1000,
 *   cacheMaxBytes: 50 * 1024 * 1024, // 50MB
 *   enableMetrics: true
 * })
 *
 * // Store a blob
 * const content = new TextEncoder().encode('Hello, World!')
 * const sha = await store.putObject('blob', content)
 *
 * // Retrieve it (cached on second access)
 * const obj = await store.getObject(sha)
 * console.log(obj?.type, obj?.size)
 *
 * // Get typed object
 * const blob = await store.getBlobObject(sha)
 *
 * // Get metrics
 * const metrics = store.getMetrics()
 * console.log(`Cache hit rate: ${metrics.cacheHitRate}%`)
 * ```
 */

import { DurableObjectStorage } from './schema'
import { LRUCache, CacheStats } from '../storage/lru-cache'
import {
  ObjectType,
  BlobObject,
  TreeObject,
  CommitObject,
  TagObject,
  TreeEntry,
  Author,
  isValidMode,
  isValidSha
} from '../types/objects'

// Reserved for future validation
import { validateTreeEntry as _validateTreeEntry } from '../types/objects'
void _validateTreeEntry
import { hashObject } from '../utils/hash'
import type { StorageBackend } from '../storage/backend'

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Stored object record as persisted in SQLite.
 *
 * @description
 * Represents a Git object with metadata as stored in the database.
 * The `data` field contains the object content WITHOUT the Git header.
 *
 * @example
 * ```typescript
 * const obj: StoredObject = {
 *   sha: 'abc123...',
 *   type: 'blob',
 *   size: 13,
 *   data: new Uint8Array([...]),
 *   createdAt: 1704067200000
 * }
 * ```
 */
export interface StoredObject {
  /** 40-character SHA-1 hash (primary key) */
  sha: string
  /** Object type: 'blob', 'tree', 'commit', or 'tag' */
  type: ObjectType
  /** Size of the data in bytes */
  size: number
  /** Raw object content (without Git header) */
  data: Uint8Array
  /** Unix timestamp (milliseconds) when object was created */
  createdAt: number
}

/**
 * Configuration options for ObjectStore.
 *
 * @description
 * Controls caching behavior, metrics collection, and logging.
 *
 * @example
 * ```typescript
 * const options: ObjectStoreOptions = {
 *   cacheMaxCount: 1000,
 *   cacheMaxBytes: 50 * 1024 * 1024,
 *   cacheTTL: 3600000,
 *   enableMetrics: true,
 *   logger: console
 * }
 * ```
 */
export interface ObjectStoreOptions {
  /**
   * Maximum number of objects to cache in memory.
   * @default 500
   */
  cacheMaxCount?: number

  /**
   * Maximum cache size in bytes.
   * @default 25MB
   */
  cacheMaxBytes?: number

  /**
   * Time-to-live for cached objects in milliseconds.
   * @default undefined (no expiration)
   */
  cacheTTL?: number

  /**
   * Enable metrics collection.
   * @default false
   */
  enableMetrics?: boolean

  /**
   * Logger interface for operation logging.
   * @default undefined (no logging)
   */
  logger?: ObjectStoreLogger

  /**
   * Optional storage backend abstraction.
   * If provided, delegates CAS operations to this backend instead of SQLite.
   * This enables gradual migration to different storage implementations.
   * @default undefined (uses SQLite directly)
   */
  backend?: StorageBackend
}

/**
 * Logger interface for ObjectStore operations.
 */
export interface ObjectStoreLogger {
  debug?(message: string, ...args: unknown[]): void
  info?(message: string, ...args: unknown[]): void
  warn?(message: string, ...args: unknown[]): void
  error?(message: string, ...args: unknown[]): void
}

/**
 * Metrics collected by ObjectStore operations.
 */
export interface ObjectStoreMetrics {
  /** Total number of read operations */
  reads: number
  /** Total number of write operations */
  writes: number
  /** Total number of delete operations */
  deletes: number
  /** Cache statistics */
  cache: CacheStats
  /** Cache hit rate percentage */
  cacheHitRate: number
  /** Total bytes written */
  bytesWritten: number
  /** Total bytes read */
  bytesRead: number
  /** Average write latency in ms */
  avgWriteLatencyMs: number
  /** Average read latency in ms */
  avgReadLatencyMs: number
  /** Number of batch operations */
  batchOperations: number
  /** Total objects in batch operations */
  batchObjectsTotal: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Default cache configuration
const DEFAULT_CACHE_MAX_COUNT = 500
const DEFAULT_CACHE_MAX_BYTES = 25 * 1024 * 1024 // 25MB

// ============================================================================
// ObjectStore Class
// ============================================================================

/**
 * ObjectStore class for managing Git objects in SQLite storage.
 *
 * @description
 * Provides a complete implementation of Git object storage operations.
 * All objects are stored in the `objects` table and indexed in `object_index`
 * for tiered storage support. Write operations are logged to WAL for durability.
 *
 * @example
 * ```typescript
 * const store = new ObjectStore(durableObjectStorage)
 *
 * // Create a commit
 * const commitSha = await store.putCommitObject({
 *   tree: treeSha,
 *   parents: [parentSha],
 *   author: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   committer: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Initial commit'
 * })
 *
 * // Read it back
 * const commit = await store.getCommitObject(commitSha)
 * console.log(commit?.message)
 * ```
 */
export class ObjectStore {
  private cache: LRUCache<string, StoredObject>
  private options: ObjectStoreOptions
  private logger?: ObjectStoreLogger
  private backend: StorageBackend | null

  // Metrics tracking
  private _reads = 0
  private _writes = 0
  private _deletes = 0
  private _bytesWritten = 0
  private _bytesRead = 0
  private _totalWriteLatency = 0
  private _totalReadLatency = 0
  private _batchOperations = 0
  private _batchObjectsTotal = 0

  /**
   * Create a new ObjectStore.
   *
   * @param storage - Durable Object storage interface with SQL support
   * @param options - Configuration options for caching, metrics, logging, and backend
   *
   * @example
   * ```typescript
   * // Basic usage (SQLite backend)
   * const store = new ObjectStore(storage)
   *
   * // With caching and metrics
   * const store = new ObjectStore(storage, {
   *   cacheMaxCount: 1000,
   *   cacheMaxBytes: 50 * 1024 * 1024,
   *   enableMetrics: true,
   *   logger: console
   * })
   *
   * // With StorageBackend abstraction
   * const store = new ObjectStore(storage, {
   *   backend: fsBackend
   * })
   * ```
   */
  constructor(
    private storage: DurableObjectStorage,
    options?: ObjectStoreOptions
  ) {
    this.options = options ?? {}
    this.logger = options?.logger
    this.backend = options?.backend ?? null

    // Initialize LRU cache for hot tier objects
    this.cache = new LRUCache<string, StoredObject>({
      maxCount: options?.cacheMaxCount ?? DEFAULT_CACHE_MAX_COUNT,
      maxBytes: options?.cacheMaxBytes ?? DEFAULT_CACHE_MAX_BYTES,
      defaultTTL: options?.cacheTTL,
      sizeCalculator: (obj) => (obj as StoredObject).data.byteLength + 100, // 100 bytes overhead for metadata
      onEvict: (key, _value, reason) => {
        this.log('debug', `Cache eviction: ${key} (reason: ${reason})`)
      }
    })
  }

  /**
   * Log a message if logger is configured.
   * @internal
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
    if (!this.logger) return
    const logFn = this.logger[level]
    if (logFn) {
      logFn.call(this.logger, `[ObjectStore] ${message}`, ...args)
    }
  }

  /**
   * Store a raw object and return its SHA.
   *
   * @description
   * Computes the SHA-1 hash of the object in Git format (type + size + content),
   * logs the operation to WAL, stores the object, and updates the object index.
   * If an object with the same SHA already exists, it is replaced (idempotent).
   * The object is also added to the LRU cache for fast subsequent reads.
   *
   * @param type - Object type ('blob', 'tree', 'commit', 'tag')
   * @param data - Raw object content (without Git header)
   * @returns 40-character SHA-1 hash of the stored object
   *
   * @example
   * ```typescript
   * const content = new TextEncoder().encode('file content')
   * const sha = await store.putObject('blob', content)
   * console.log(`Stored blob: ${sha}`)
   * ```
   */
  async putObject(type: ObjectType, data: Uint8Array): Promise<string> {
    const startTime = this.options.enableMetrics ? Date.now() : 0

    // Delegate to backend if available
    if (this.backend) {
      const sha = await this.backend.putObject(type, data)

      // Add to cache for fast subsequent reads
      const storedObject: StoredObject = {
        sha,
        type,
        size: data.length,
        data,
        createdAt: Date.now()
      }
      this.cache.set(sha, storedObject)

      // Update metrics
      if (this.options.enableMetrics) {
        this._writes++
        this._bytesWritten += data.length
        this._totalWriteLatency += Date.now() - startTime
      }

      return sha
    }

    // Existing SQLite implementation as fallback
    // Compute SHA-1 hash using git object format: "type size\0content"
    const sha = await hashObject(type, data)

    this.log('debug', `Storing ${type} object: ${sha} (${data.length} bytes)`)

    // Log to WAL first
    await this.logToWAL('PUT', sha, type, data)

    const now = Date.now()

    // Store the object
    this.storage.sql.exec(
      'INSERT OR REPLACE INTO objects (sha, type, size, data, created_at) VALUES (?, ?, ?, ?, ?)',
      sha,
      type,
      data.length,
      data,
      now
    )

    // Update object index
    this.storage.sql.exec(
      'INSERT OR REPLACE INTO object_index (sha, tier, pack_id, offset, size, type, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      sha,
      'hot',
      null,  // pack_id is null for hot tier
      null,  // offset is null for hot tier
      data.length,
      type,
      now
    )

    // Add to cache for fast subsequent reads
    const storedObject: StoredObject = {
      sha,
      type,
      size: data.length,
      data,
      createdAt: now
    }
    this.cache.set(sha, storedObject)

    // Update metrics
    if (this.options.enableMetrics) {
      this._writes++
      this._bytesWritten += data.length
      this._totalWriteLatency += Date.now() - startTime
    }

    return sha
  }

  /**
   * Store a tree object with entries.
   *
   * @description
   * Creates a Git tree object from an array of entries. Entries are sorted
   * by name (with directories treated as having trailing slashes for sorting).
   * Each entry is serialized as: "{mode} {name}\0{20-byte-sha}"
   *
   * @param entries - Array of tree entries (files and subdirectories)
   * @returns 40-character SHA-1 hash of the stored tree
   *
   * @example
   * ```typescript
   * const treeSha = await store.putTreeObject([
   *   { mode: '100644', name: 'README.md', sha: blobSha },
   *   { mode: '040000', name: 'src', sha: subdirSha }
   * ])
   * ```
   */
  async putTreeObject(entries: TreeEntry[]): Promise<string> {
    // Validate all entries first
    const seenNames = new Set<string>()
    for (const entry of entries) {
      // Check for invalid names: empty, '.', '..', contains '/' or null byte
      if (!entry.name || entry.name === '.' || entry.name === '..') {
        throw new Error(`Invalid entry name: "${entry.name}". Entry names cannot be empty, ".", or ".."`)
      }
      if (entry.name.includes('/')) {
        throw new Error(`Invalid entry name: "${entry.name}". Entry names cannot contain path separators`)
      }
      if (entry.name.includes('\0')) {
        throw new Error(`Invalid entry name: "${entry.name}". Entry names cannot contain null bytes`)
      }
      // Check for duplicate names
      if (seenNames.has(entry.name)) {
        throw new Error(`Duplicate entry name: "${entry.name}". Tree entries must have unique names`)
      }
      seenNames.add(entry.name)
      // Validate mode
      if (!isValidMode(entry.mode)) {
        throw new Error(`Invalid mode: "${entry.mode}". Valid modes: 100644, 100755, 040000, 120000, 160000`)
      }
      // Validate SHA
      if (!isValidSha(entry.sha)) {
        throw new Error(`Invalid SHA: "${entry.sha}". Must be 40 lowercase hex characters`)
      }
    }

    // Sort entries by name using ASCII byte-order comparison
    // Git sorts directories as if they have trailing slashes for comparison
    const sortedEntries = [...entries].sort((a, b) => {
      const aName = a.mode === '040000' ? a.name + '/' : a.name
      const bName = b.mode === '040000' ? b.name + '/' : b.name
      // Use simple comparison for ASCII byte order
      if (aName < bName) return -1
      if (aName > bName) return 1
      return 0
    })

    // Build tree content (without header)
    const entryParts: Uint8Array[] = []
    for (const entry of sortedEntries) {
      const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`)
      const sha20 = hexToBytes(entry.sha)
      const entryData = new Uint8Array(modeName.length + 20)
      entryData.set(modeName)
      entryData.set(sha20, modeName.length)
      entryParts.push(entryData)
    }

    // Combine all entry parts
    const contentLength = entryParts.reduce((sum, part) => sum + part.length, 0)
    const content = new Uint8Array(contentLength)
    let offset = 0
    for (const part of entryParts) {
      content.set(part, offset)
      offset += part.length
    }

    return this.putObject('tree', content)
  }

  /**
   * Store a commit object.
   *
   * @description
   * Creates a Git commit object with the specified tree, parents, author,
   * committer, and message. The commit content is formatted according to
   * the Git commit format specification.
   *
   * @param commit - Commit data
   * @param commit.tree - SHA of the root tree object
   * @param commit.parents - Array of parent commit SHAs (empty for root commit)
   * @param commit.author - Author information
   * @param commit.committer - Committer information
   * @param commit.message - Commit message
   * @returns 40-character SHA-1 hash of the stored commit
   *
   * @example
   * ```typescript
   * const now = Math.floor(Date.now() / 1000)
   * const author = { name: 'Alice', email: 'alice@example.com.ai', timestamp: now, timezone: '+0000' }
   *
   * const sha = await store.putCommitObject({
   *   tree: treeSha,
   *   parents: [],
   *   author,
   *   committer: author,
   *   message: 'Initial commit\n\nThis is the first commit.'
   * })
   * ```
   */
  async putCommitObject(commit: {
    tree: string
    parents: string[]
    author: Author
    committer: Author
    message: string
  }): Promise<string> {
    // Build commit content (without header)
    const lines: string[] = []
    lines.push(`tree ${commit.tree}`)
    for (const parent of commit.parents) {
      lines.push(`parent ${parent}`)
    }
    lines.push(`author ${commit.author.name} <${commit.author.email}> ${commit.author.timestamp} ${commit.author.timezone}`)
    lines.push(`committer ${commit.committer.name} <${commit.committer.email}> ${commit.committer.timestamp} ${commit.committer.timezone}`)
    lines.push('')
    lines.push(commit.message)

    const content = encoder.encode(lines.join('\n'))
    return this.putObject('commit', content)
  }

  /**
   * Store a tag object (annotated tag).
   *
   * @description
   * Creates a Git tag object pointing to another object with tagger
   * information and a message. The tag content is formatted according
   * to the Git tag format specification.
   *
   * @param tag - Tag data
   * @param tag.object - SHA of the object being tagged
   * @param tag.objectType - Type of the object being tagged
   * @param tag.tagger - Tagger information
   * @param tag.message - Tag message
   * @param tag.name - Tag name
   * @returns 40-character SHA-1 hash of the stored tag object
   *
   * @example
   * ```typescript
   * const now = Math.floor(Date.now() / 1000)
   * const tagger = { name: 'Bob', email: 'bob@example.com.ai', timestamp: now, timezone: '+0000' }
   *
   * const sha = await store.putTagObject({
   *   object: commitSha,
   *   objectType: 'commit',
   *   tagger,
   *   message: 'Release v1.0.0',
   *   name: 'v1.0.0'
   * })
   * ```
   */
  async putTagObject(tag: {
    object: string
    objectType: ObjectType
    tagger?: Author
    message: string
    name: string
  }): Promise<string> {
    // Build tag content (without header)
    const lines: string[] = []
    lines.push(`object ${tag.object}`)
    lines.push(`type ${tag.objectType}`)
    lines.push(`tag ${tag.name}`)
    if (tag.tagger) {
      lines.push(`tagger ${tag.tagger.name} <${tag.tagger.email}> ${tag.tagger.timestamp} ${tag.tagger.timezone}`)
    }
    lines.push('')
    lines.push(tag.message)

    const content = encoder.encode(lines.join('\n'))
    return this.putObject('tag', content)
  }

  /**
   * Retrieve an object by SHA.
   *
   * @description
   * Fetches an object from the LRU cache first, falling back to the database
   * if not cached. Returns null if the object doesn't exist or if the SHA is invalid.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns The stored object or null if not found
   *
   * @example
   * ```typescript
   * const obj = await store.getObject(sha)
   * if (obj) {
   *   console.log(`Found ${obj.type} of ${obj.size} bytes`)
   * }
   * ```
   */
  async getObject(sha: string): Promise<StoredObject | null> {
    const startTime = this.options.enableMetrics ? Date.now() : 0

    if (!sha || sha.length < 4) {
      return null
    }

    // Check cache first (fast path)
    const cached = this.cache.get(sha)
    if (cached) {
      this.log('debug', `Cache hit for object: ${sha}`)
      if (this.options.enableMetrics) {
        this._reads++
        this._bytesRead += cached.size
        this._totalReadLatency += Date.now() - startTime
      }
      return cached
    }

    // Delegate to backend if available
    if (this.backend) {
      const result = await this.backend.getObject(sha)
      if (!result) {
        this.log('debug', `Object not found: ${sha}`)
        if (this.options.enableMetrics) {
          this._reads++
          this._totalReadLatency += Date.now() - startTime
        }
        return null
      }

      const obj: StoredObject = {
        sha,
        type: result.type,
        size: result.content.length,
        data: result.content,
        createdAt: Date.now()
      }

      // Add to cache for subsequent reads
      this.cache.set(sha, obj)

      if (this.options.enableMetrics) {
        this._reads++
        this._bytesRead += obj.size
        this._totalReadLatency += Date.now() - startTime
      }

      return obj
    }

    // Existing SQLite implementation as fallback
    // Fall back to database
    const result = this.storage.sql.exec(
      'SELECT sha, type, size, data, created_at as createdAt FROM objects WHERE sha = ?',
      sha
    )
    const rows = result.toArray() as StoredObject[]

    if (rows.length === 0) {
      this.log('debug', `Object not found: ${sha}`)
      if (this.options.enableMetrics) {
        this._reads++
        this._totalReadLatency += Date.now() - startTime
      }
      return null
    }

    const obj = rows[0]

    // Add to cache for subsequent reads
    this.cache.set(sha, obj)

    if (this.options.enableMetrics) {
      this._reads++
      this._bytesRead += obj.size
      this._totalReadLatency += Date.now() - startTime
    }

    return obj
  }

  /**
   * Delete an object by SHA.
   *
   * @description
   * Removes an object from the cache, objects table, and the object index.
   * The operation is logged to WAL. Returns false if the object doesn't exist.
   *
   * **Warning**: Deleting objects that are still referenced by other objects
   * (e.g., blobs referenced by trees) will corrupt the repository.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns True if the object was deleted, false if it didn't exist
   *
   * @example
   * ```typescript
   * const deleted = await store.deleteObject(sha)
   * if (deleted) {
   *   console.log('Object removed')
   * }
   * ```
   */
  async deleteObject(sha: string): Promise<boolean> {
    // Delegate to backend if available
    if (this.backend) {
      // Check if object exists first via backend
      const exists = await this.backend.hasObject(sha)
      if (!exists) {
        return false
      }

      this.log('debug', `Deleting object via backend: ${sha}`)

      await this.backend.deleteObject(sha)

      // Remove from cache
      this.cache.delete(sha)

      // Update metrics
      if (this.options.enableMetrics) {
        this._deletes++
      }

      return true
    }

    // Existing SQLite implementation as fallback
    // Check if object exists first
    const exists = await this.hasObject(sha)
    if (!exists) {
      return false
    }

    this.log('debug', `Deleting object: ${sha}`)

    // Log to WAL
    await this.logToWAL('DELETE', sha, 'blob', new Uint8Array(0))

    // Delete from objects table
    this.storage.sql.exec('DELETE FROM objects WHERE sha = ?', sha)

    // Delete from object index
    this.storage.sql.exec('DELETE FROM object_index WHERE sha = ?', sha)

    // Remove from cache
    this.cache.delete(sha)

    // Update metrics
    if (this.options.enableMetrics) {
      this._deletes++
    }

    return true
  }

  /**
   * Check if an object exists.
   *
   * @description
   * Efficiently checks for object existence without fetching the full content.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns True if the object exists, false otherwise
   *
   * @example
   * ```typescript
   * if (await store.hasObject(sha)) {
   *   console.log('Object exists')
   * }
   * ```
   */
  async hasObject(sha: string): Promise<boolean> {
    if (!sha || sha.length < 4) {
      return false
    }

    // Check cache first (fast path)
    if (this.cache.has(sha)) {
      return true
    }

    // Delegate to backend if available
    if (this.backend) {
      return this.backend.hasObject(sha)
    }

    // Existing SQLite implementation as fallback
    // Use getObject and check for null - this works better with the mock
    const obj = await this.getObject(sha)
    return obj !== null
  }

  /**
   * Verify an object's integrity by recomputing its hash.
   *
   * @description
   * Computes the SHA-1 hash of the stored object and compares it
   * to the stored SHA. Returns false if the object is corrupted
   * or doesn't exist.
   *
   * @param sha - 40-character SHA-1 hash to verify
   * @returns True if the computed hash matches, false otherwise
   *
   * @example
   * ```typescript
   * if (await store.verifyObject(sha)) {
   *   console.log('Object integrity verified')
   * } else {
   *   console.log('Object is corrupted or missing')
   * }
   * ```
   */
  async verifyObject(sha: string): Promise<boolean> {
    // Read directly from storage (bypass cache) to verify actual stored data
    const result = this.storage.sql.exec(
      'SELECT type, data FROM objects WHERE sha = ?',
      sha
    )
    const rows = result.toArray() as { type: ObjectType; data: ArrayBuffer }[]

    if (rows.length === 0) {
      return false
    }

    const obj = rows[0]
    const computedSha = await hashObject(obj.type, new Uint8Array(obj.data))
    return computedSha === sha
  }

  /**
   * Get object type by SHA.
   *
   * @description
   * Returns just the type of an object without fetching its content.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Object type or null if not found
   *
   * @example
   * ```typescript
   * const type = await store.getObjectType(sha)
   * if (type === 'commit') {
   *   // Handle commit
   * }
   * ```
   */
  async getObjectType(sha: string): Promise<ObjectType | null> {
    const obj = await this.getObject(sha)
    return obj?.type ?? null
  }

  /**
   * Get object size by SHA.
   *
   * @description
   * Returns just the size of an object without fetching its content.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Object size in bytes or null if not found
   *
   * @example
   * ```typescript
   * const size = await store.getObjectSize(sha)
   * console.log(`Object is ${size} bytes`)
   * ```
   */
  async getObjectSize(sha: string): Promise<number | null> {
    const obj = await this.getObject(sha)
    return obj?.size ?? null
  }

  /**
   * Store multiple objects in a batch using a single transaction.
   *
   * @description
   * Stores multiple objects atomically within a single SQLite transaction.
   * This is more efficient than individual puts for bulk operations as it:
   * - Reduces the number of disk flushes
   * - Ensures atomic writes (all-or-nothing)
   * - Batches WAL entries for better performance
   *
   * @param objects - Array of objects to store
   * @returns Array of SHA-1 hashes in the same order as input
   *
   * @example
   * ```typescript
   * const shas = await store.putObjects([
   *   { type: 'blob', data: content1 },
   *   { type: 'blob', data: content2 }
   * ])
   * ```
   */
  async putObjects(objects: { type: ObjectType; data: Uint8Array }[]): Promise<string[]> {
    if (objects.length === 0) {
      return []
    }

    // For single objects, delegate to putObject
    if (objects.length === 1) {
      const sha = await this.putObject(objects[0].type, objects[0].data)
      return [sha]
    }

    const startTime = this.options.enableMetrics ? Date.now() : 0
    const shas: string[] = []
    const now = Date.now()
    let totalBytes = 0

    this.log('info', `Starting batch write of ${objects.length} objects`)

    // Pre-compute all SHA hashes (CPU-bound, before transaction)
    const objectsWithSha: Array<{ sha: string; type: ObjectType; data: Uint8Array }> = []
    for (const obj of objects) {
      const sha = await hashObject(obj.type, obj.data)
      objectsWithSha.push({ sha, type: obj.type, data: obj.data })
      shas.push(sha)
      totalBytes += obj.data.length
    }

    // Begin transaction for atomic batch write
    this.storage.sql.exec('BEGIN TRANSACTION')

    try {
      for (const { sha, type, data } of objectsWithSha) {
        // Log batch operation to WAL (single entry for the batch)
        const payload = encoder.encode(JSON.stringify({
          sha,
          type,
          timestamp: now,
          batchSize: objects.length
        }))
        this.storage.sql.exec(
          'INSERT INTO wal (operation, payload, created_at, flushed) VALUES (?, ?, ?, 0)',
          'BATCH_PUT',
          payload,
          now
        )

        // Store the object
        this.storage.sql.exec(
          'INSERT OR REPLACE INTO objects (sha, type, size, data, created_at) VALUES (?, ?, ?, ?, ?)',
          sha,
          type,
          data.length,
          data,
          now
        )

        // Update object index
        this.storage.sql.exec(
          'INSERT OR REPLACE INTO object_index (sha, tier, pack_id, offset, size, type, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          sha,
          'hot',
          null,  // pack_id is null for hot tier
          null,  // offset is null for hot tier
          data.length,
          type,
          now
        )

        // Add to cache
        const storedObject: StoredObject = {
          sha,
          type,
          size: data.length,
          data,
          createdAt: now
        }
        this.cache.set(sha, storedObject)
      }

      // Commit transaction
      this.storage.sql.exec('COMMIT')

      this.log('info', `Batch write completed: ${objects.length} objects, ${totalBytes} bytes`)

      // Update metrics
      if (this.options.enableMetrics) {
        this._writes += objects.length
        this._bytesWritten += totalBytes
        this._totalWriteLatency += Date.now() - startTime
        this._batchOperations++
        this._batchObjectsTotal += objects.length
      }

      return shas
    } catch (error) {
      // Rollback on error
      this.storage.sql.exec('ROLLBACK')
      this.log('error', `Batch write failed, rolled back`, error)
      throw error
    }
  }

  /**
   * Retrieve multiple objects by SHA using optimized batch queries.
   *
   * @description
   * Fetches multiple objects efficiently by:
   * 1. First checking the LRU cache for each SHA
   * 2. Batching uncached SHAs into a single SQL query with IN clause
   * 3. Returning results in the original order with null for missing objects
   *
   * @param shas - Array of 40-character SHA-1 hashes
   * @returns Array of objects (or null for missing) in the same order
   *
   * @example
   * ```typescript
   * const objects = await store.getObjects([sha1, sha2, sha3])
   * objects.forEach((obj, i) => {
   *   if (obj) {
   *     console.log(`${i}: ${obj.type}`)
   *   }
   * })
   * ```
   */
  async getObjects(shas: string[]): Promise<(StoredObject | null)[]> {
    if (shas.length === 0) {
      return []
    }

    const startTime = this.options.enableMetrics ? Date.now() : 0
    const results: (StoredObject | null)[] = new Array(shas.length).fill(null)
    const uncachedIndices: number[] = []
    const uncachedShas: string[] = []
    let totalBytesRead = 0

    // First pass: check cache for each SHA
    for (let i = 0; i < shas.length; i++) {
      const sha = shas[i]
      if (!sha || sha.length < 4) {
        results[i] = null
        continue
      }

      const cached = this.cache.get(sha)
      if (cached) {
        results[i] = cached
        totalBytesRead += cached.size
      } else {
        uncachedIndices.push(i)
        uncachedShas.push(sha)
      }
    }

    // Second pass: batch query for uncached objects
    if (uncachedShas.length > 0) {
      this.log('debug', `Batch fetching ${uncachedShas.length} uncached objects`)

      // Build optimized IN query
      const placeholders = uncachedShas.map(() => '?').join(', ')
      const result = this.storage.sql.exec(
        `SELECT sha, type, size, data, created_at as createdAt FROM objects WHERE sha IN (${placeholders})`,
        ...uncachedShas
      )
      const rows = result.toArray() as StoredObject[]

      // Build lookup map for O(1) access
      const rowMap = new Map<string, StoredObject>()
      for (const row of rows) {
        rowMap.set(row.sha, row)
        // Add to cache for future reads
        this.cache.set(row.sha, row)
        totalBytesRead += row.size
      }

      // Fill in results at original indices
      for (let i = 0; i < uncachedIndices.length; i++) {
        const originalIndex = uncachedIndices[i]
        const sha = uncachedShas[i]
        results[originalIndex] = rowMap.get(sha) ?? null
      }
    }

    // Update metrics
    if (this.options.enableMetrics) {
      this._reads += shas.length
      this._bytesRead += totalBytesRead
      this._totalReadLatency += Date.now() - startTime
    }

    return results
  }

  /**
   * Get a blob object with typed result.
   *
   * @description
   * Fetches an object and returns it as a BlobObject if it's a blob.
   * Returns null if the object doesn't exist or isn't a blob.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Typed BlobObject or null
   *
   * @example
   * ```typescript
   * const blob = await store.getBlobObject(sha)
   * if (blob) {
   *   const content = new TextDecoder().decode(blob.data)
   *   console.log(content)
   * }
   * ```
   */
  async getBlobObject(sha: string): Promise<BlobObject | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'blob') {
      return null
    }

    return {
      type: 'blob',
      data: obj.data
    }
  }

  /**
   * Get a tree object with parsed entries.
   *
   * @description
   * Fetches and parses a tree object, extracting all entries
   * with their modes, names, and SHA references.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Parsed TreeObject with entries or null
   *
   * @example
   * ```typescript
   * const tree = await store.getTreeObject(sha)
   * if (tree) {
   *   for (const entry of tree.entries) {
   *     console.log(`${entry.mode} ${entry.name} ${entry.sha}`)
   *   }
   * }
   * ```
   */
  async getTreeObject(sha: string): Promise<TreeObject | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'tree') {
      return null
    }

    // Parse tree entries from raw data
    const entries: TreeEntry[] = []
    let offset = 0
    const data = obj.data

    try {
      while (offset < data.length) {
        // Find the null byte after mode+name
        let nullIndex = offset
        while (nullIndex < data.length && data[nullIndex] !== 0) {
          nullIndex++
        }

        // Check if we found a null byte
        if (nullIndex >= data.length) {
          // No null byte found - malformed data, return empty entries
          return { type: 'tree', data: obj.data, entries: [] }
        }

        const modeNameStr = decoder.decode(data.slice(offset, nullIndex))
        const spaceIndex = modeNameStr.indexOf(' ')

        // Check for valid mode+name format
        if (spaceIndex === -1) {
          // No space found - malformed entry, return empty entries
          return { type: 'tree', data: obj.data, entries: [] }
        }

        const mode = modeNameStr.slice(0, spaceIndex)
        const name = modeNameStr.slice(spaceIndex + 1)

        // Check if we have enough bytes for the 20-byte SHA
        if (nullIndex + 21 > data.length) {
          // Not enough bytes for SHA - return what we have parsed so far as malformed
          return { type: 'tree', data: obj.data, entries: [] }
        }

        // Read 20-byte SHA
        const sha20 = data.slice(nullIndex + 1, nullIndex + 21)
        const entrySha = bytesToHex(sha20)

        entries.push({ mode, name, sha: entrySha })
        offset = nullIndex + 21
      }
    } catch {
      // Any parsing error - return null or empty entries
      return { type: 'tree', data: obj.data, entries: [] }
    }

    return {
      type: 'tree',
      data: obj.data,
      entries
    }
  }

  /**
   * Get a commit object with parsed fields.
   *
   * @description
   * Fetches and parses a commit object, extracting tree SHA,
   * parent SHAs, author, committer, and message.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Parsed CommitObject or null
   *
   * @example
   * ```typescript
   * const commit = await store.getCommitObject(sha)
   * if (commit) {
   *   console.log(`Author: ${commit.author.name}`)
   *   console.log(`Message: ${commit.message}`)
   *   console.log(`Parents: ${commit.parents.length}`)
   * }
   * ```
   */
  async getCommitObject(sha: string): Promise<CommitObject | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'commit') {
      return null
    }

    const content = decoder.decode(obj.data)
    const lines = content.split('\n')

    let tree = ''
    const parents: string[] = []
    let author: Author | null = null
    let committer: Author | null = null
    let messageStartIndex = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line === '') {
        messageStartIndex = i + 1
        break
      }

      if (line.startsWith('tree ')) {
        tree = line.slice(5)
      } else if (line.startsWith('parent ')) {
        parents.push(line.slice(7))
      } else if (line.startsWith('author ')) {
        author = parseAuthorLine(line)
      } else if (line.startsWith('committer ')) {
        committer = parseAuthorLine(line)
      }
    }

    if (!author || !committer) {
      return null
    }

    const message = lines.slice(messageStartIndex).join('\n')

    return {
      type: 'commit',
      data: obj.data,
      tree,
      parents,
      author,
      committer,
      message
    }
  }

  /**
   * Get a tag object with parsed fields.
   *
   * @description
   * Fetches and parses an annotated tag object, extracting
   * the tagged object SHA, object type, tag name, tagger, and message.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Parsed TagObject or null
   *
   * @example
   * ```typescript
   * const tag = await store.getTagObject(sha)
   * if (tag) {
   *   console.log(`Tag: ${tag.name}`)
   *   console.log(`Points to: ${tag.object} (${tag.objectType})`)
   *   console.log(`Tagger: ${tag.tagger?.name}`)
   * }
   * ```
   */
  async getTagObject(sha: string): Promise<TagObject | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'tag') {
      return null
    }

    const content = decoder.decode(obj.data)
    const lines = content.split('\n')

    let object = ''
    let objectType: ObjectType = 'commit'
    let name = ''
    let tagger: Author | undefined = undefined
    let messageStartIndex = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line === '') {
        messageStartIndex = i + 1
        break
      }

      if (line.startsWith('object ')) {
        object = line.slice(7)
      } else if (line.startsWith('type ')) {
        objectType = line.slice(5) as ObjectType
      } else if (line.startsWith('tag ')) {
        name = line.slice(4)
      } else if (line.startsWith('tagger ')) {
        try {
          tagger = parseAuthorLine(line)
        } catch {
          // Malformed tagger line - leave tagger as undefined
          return null
        }
      }
    }

    // Validate required fields - object and name must be present
    // tagger is optional (some older tags or special tags may not have it)
    if (!object || !name) {
      return null
    }

    const message = lines.slice(messageStartIndex).join('\n')

    return {
      type: 'tag',
      data: obj.data,
      object,
      objectType,
      name,
      tagger,
      message
    }
  }

  /**
   * Get raw serialized object with Git header.
   *
   * @description
   * Returns the complete Git object format including header:
   * "{type} {size}\0{content}"
   *
   * This is the format used for hashing and storage in pack files.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Complete object with Git header or null
   *
   * @example
   * ```typescript
   * const raw = await store.getRawObject(sha)
   * if (raw) {
   *   // Can be written directly to a pack file or loose object
   * }
   * ```
   */
  async getRawObject(sha: string): Promise<Uint8Array | null> {
    const obj = await this.getObject(sha)
    if (!obj) {
      return null
    }

    // Build git object format: "type size\0content"
    const header = encoder.encode(`${obj.type} ${obj.data.length}\0`)
    const result = new Uint8Array(header.length + obj.data.length)
    result.set(header)
    result.set(obj.data, header.length)
    return result
  }

  /**
   * Log operation to WAL.
   *
   * @description
   * Writes an operation entry to the write-ahead log for durability.
   * The WAL ensures operations can be recovered after crashes.
   *
   * @param operation - Operation type ('PUT', 'DELETE', etc.)
   * @param sha - Object SHA being operated on
   * @param type - Object type
   * @param _data - Object data (not stored in WAL, just for signature compatibility)
   * @internal
   */
  private async logToWAL(
    operation: string,
    sha: string,
    type: ObjectType,
    _data: Uint8Array
  ): Promise<void> {
    // Create payload with operation details
    const payload = encoder.encode(JSON.stringify({
      sha,
      type,
      timestamp: Date.now()
    }))

    this.storage.sql.exec(
      'INSERT INTO wal (operation, payload, created_at, flushed) VALUES (?, ?, ?, 0)',
      operation,
      payload,
      Date.now()
    )
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert hexadecimal string to bytes.
 *
 * @description
 * Parses a hexadecimal string and returns the corresponding bytes.
 * Used for converting SHA strings to 20-byte binary format.
 *
 * @param hex - Hexadecimal string
 * @returns Binary data as Uint8Array
 * @internal
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Convert bytes to hexadecimal string.
 *
 * @description
 * Converts binary data to a lowercase hexadecimal string.
 * Used for converting 20-byte SHA to 40-character string.
 *
 * @param bytes - Binary data to convert
 * @returns Lowercase hexadecimal string
 * @internal
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Parse author/committer/tagger line.
 *
 * @description
 * Parses a Git author/committer/tagger line in the format:
 * "author Name <email> timestamp timezone"
 *
 * @param line - Full line including prefix
 * @returns Parsed Author object
 * @throws Error if line format is invalid
 * @internal
 */
function parseAuthorLine(line: string): Author {
  const match = line.match(/^(?:author|committer|tagger) (.+) <(.+)> (\d+) ([+-]\d{4})$/)
  if (!match) {
    throw new Error(`Invalid author line: ${line}`)
  }
  return {
    name: match[1],
    email: match[2],
    timestamp: parseInt(match[3], 10),
    timezone: match[4]
  }
}
