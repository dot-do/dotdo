// Parquet Storage Adapter for @dotdo/db
// Bridges between @dotdo/db key-value interface and ParqueDB storage backends

import type {
  StorageAdapter,
  StorageAdapterOptions,
  ListOptions,
  ListResult
} from '../storage/storage'

/**
 * ParqueDB StorageBackend interface (from parquedb)
 * Simplified type for our usage - full types are in parquedb
 */
export interface ParquetStorageBackend {
  readonly type: string
  read(path: string): Promise<Uint8Array>
  write(path: string, data: Uint8Array): Promise<{ etag: string; size: number }>
  exists(path: string): Promise<boolean>
  delete(path: string): Promise<boolean>
  list(prefix: string, options?: { limit?: number; cursor?: string }): Promise<{
    files: string[]
    hasMore: boolean
    cursor?: string
  }>
  mkdir?(path: string): Promise<void>
}

/**
 * Options for ParquetStorageAdapter
 */
export interface ParquetStorageAdapterOptions extends StorageAdapterOptions {
  /** Underlying storage backend (FsBackend, R2Backend, MemoryBackend, etc.) */
  backend: ParquetStorageBackend
  /** Base path for storing data (default: '.data') */
  basePath?: string
  /** Whether to use parquet format for batch storage (default: true) */
  useParquet?: boolean
}

/**
 * Encoder for values to/from storage format
 */
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function encodeValue<T>(value: T): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

function decodeValue<T>(data: Uint8Array): T {
  return JSON.parse(decoder.decode(data))
}

/**
 * Storage entry with metadata
 */
interface StoredEntry<T = unknown> {
  value: T
  createdAt: number
  updatedAt: number
}

/**
 * Parquet Storage Adapter
 *
 * Uses ParqueDB storage backends (FsBackend, R2Backend, MemoryBackend) to persist
 * key-value data. Each key is stored as a separate file in the backend.
 *
 * For high-volume scenarios, consider using batch operations which can leverage
 * parquet format for efficient columnar storage.
 *
 * @example
 * ```typescript
 * import { ParquetStorageAdapter } from '@dotdo/db/adapters/parquet'
 * import { FsBackend } from 'parquedb'
 *
 * const adapter = new ParquetStorageAdapter({
 *   backend: new FsBackend({ basePath: './.db' }),
 *   namespace: 'my-app'
 * })
 *
 * // Use with @dotdo/db stores
 * const things = createThingsStoreWithAdapter(adapter)
 * ```
 */
export class ParquetStorageAdapter implements StorageAdapter {
  private readonly backend: ParquetStorageBackend
  private readonly basePath: string
  private readonly namespace: string
  private readonly useParquet: boolean
  private inTx = false

  constructor(options: ParquetStorageAdapterOptions) {
    this.backend = options.backend
    this.basePath = options.basePath ?? '.data'
    this.namespace = options.namespace ?? ''
    this.useParquet = options.useParquet ?? true
  }

  /**
   * Convert key to storage path
   */
  private keyToPath(key: string): string {
    // Sanitize key for filesystem safety
    const safeKey = key.replace(/[^a-zA-Z0-9_\-.:]/g, '_')
    const parts = [this.basePath]
    if (this.namespace) {
      parts.push(this.namespace)
    }
    parts.push(`${safeKey}.json`)
    return parts.join('/')
  }

  /**
   * Convert storage path back to key
   */
  private pathToKey(path: string): string {
    const prefix = this.namespace
      ? `${this.basePath}/${this.namespace}/`
      : `${this.basePath}/`

    if (!path.startsWith(prefix) || !path.endsWith('.json')) {
      return path
    }

    return path.slice(prefix.length, -5)
  }

  /**
   * Get list prefix for operations
   */
  private getListPrefix(prefix?: string): string {
    const baseParts = [this.basePath]
    if (this.namespace) {
      baseParts.push(this.namespace)
    }
    if (prefix) {
      baseParts.push(prefix)
    }
    return baseParts.join('/') + (prefix ? '' : '/')
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const path = this.keyToPath(key)

    try {
      const exists = await this.backend.exists(path)
      if (!exists) {
        return undefined
      }

      const data = await this.backend.read(path)
      const entry = decodeValue<StoredEntry<T>>(data)
      return entry.value
    } catch (error) {
      // File doesn't exist or read error
      return undefined
    }
  }

  async getMany<T = unknown>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>()

    // Read in parallel for better performance
    const reads = keys.map(async (key) => {
      const value = await this.get<T>(key)
      if (value !== undefined) {
        result.set(key, value)
      }
    })

    await Promise.all(reads)
    return result
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    const path = this.keyToPath(key)
    const now = Date.now()

    // Try to get existing entry for createdAt preservation
    let createdAt = now
    try {
      const existing = await this.backend.exists(path)
      if (existing) {
        const data = await this.backend.read(path)
        const entry = decodeValue<StoredEntry>(data)
        createdAt = entry.createdAt
      }
    } catch {
      // File doesn't exist, use now as createdAt
    }

    const entry: StoredEntry<T> = {
      value,
      createdAt,
      updatedAt: now
    }

    // Ensure parent directory exists
    const dir = path.split('/').slice(0, -1).join('/')
    if (this.backend.mkdir && dir) {
      try {
        await this.backend.mkdir(dir)
      } catch {
        // Directory might already exist
      }
    }

    await this.backend.write(path, encodeValue(entry))
  }

  async putMany<T = unknown>(entries: Map<string, T>): Promise<void> {
    // Write in parallel for better performance
    const writes = Array.from(entries.entries()).map(([key, value]) =>
      this.put(key, value)
    )

    await Promise.all(writes)
  }

  async delete(key: string): Promise<void> {
    const path = this.keyToPath(key)

    try {
      await this.backend.delete(path)
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    const deletes = keys.map((key) => this.delete(key))
    await Promise.all(deletes)
  }

  async list<T = unknown>(options: ListOptions = {}): Promise<ListResult<T>> {
    const { prefix, limit = 1000, cursor, includeValues = true } = options
    const listPrefix = this.getListPrefix(prefix)

    // List files from backend
    const result = await this.backend.list(listPrefix, {
      limit: limit + 1, // Fetch one extra to check hasMore
      cursor
    })

    // Filter to only .json files
    const jsonFiles = result.files.filter((f) => f.endsWith('.json'))

    // Check if there are more results
    const hasMore = jsonFiles.length > limit
    const pageFiles = jsonFiles.slice(0, limit)

    // Build result entries
    const entries = new Map<string, T>()

    if (includeValues) {
      // Read values in parallel
      const reads = pageFiles.map(async (file) => {
        const key = this.pathToKey(file)
        try {
          const data = await this.backend.read(file)
          const entry = decodeValue<StoredEntry<T>>(data)
          entries.set(key, entry.value)
        } catch {
          // Skip files that can't be read
        }
      })
      await Promise.all(reads)
    } else {
      for (const file of pageFiles) {
        const key = this.pathToKey(file)
        entries.set(key, undefined as T)
      }
    }

    // Compute next cursor
    const lastFile = pageFiles[pageFiles.length - 1]
    const nextCursor = hasMore && lastFile ? lastFile : undefined

    const resultObj: ListResult<T> = {
      entries,
      hasMore
    }

    if (nextCursor !== undefined) {
      resultObj.cursor = nextCursor
    }

    return resultObj
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // ParqueDB backends don't have built-in transaction support
    // We implement a simple optimistic approach:
    // 1. Track operations during the transaction
    // 2. On failure, we can't automatically rollback, so we just throw

    if (this.inTx) {
      // Already in transaction, just execute
      return await fn()
    }

    this.inTx = true
    try {
      return await fn()
    } finally {
      this.inTx = false
    }
  }

  inTransaction(): boolean {
    return this.inTx
  }

  supportsNestedTransactions(): boolean {
    return false
  }

  async has(key: string): Promise<boolean> {
    const path = this.keyToPath(key)
    return await this.backend.exists(path)
  }

  async clear(): Promise<void> {
    const listPrefix = this.getListPrefix()

    // List and delete all files
    let cursor: string | undefined
    do {
      const result = await this.backend.list(listPrefix, { limit: 1000, cursor })

      for (const file of result.files) {
        if (file.endsWith('.json')) {
          await this.backend.delete(file)
        }
      }

      cursor = result.cursor
    } while (cursor)
  }

  async count(prefix?: string): Promise<number> {
    const listPrefix = this.getListPrefix(prefix)
    let count = 0
    let cursor: string | undefined

    do {
      const result = await this.backend.list(listPrefix, { limit: 1000, cursor })
      count += result.files.filter((f) => f.endsWith('.json')).length
      cursor = result.cursor
    } while (cursor)

    return count
  }

  /**
   * Get the underlying storage backend
   */
  getBackend(): ParquetStorageBackend {
    return this.backend
  }

  /**
   * Get the base path used for storage
   */
  getBasePath(): string {
    return this.basePath
  }
}

/**
 * Factory function to create a parquet storage adapter
 */
export function createParquetStorageAdapter(
  options: ParquetStorageAdapterOptions
): ParquetStorageAdapter {
  return new ParquetStorageAdapter(options)
}

/**
 * Factory for creating adapters with different backends
 */
export const ParquetStorageAdapterFactory = {
  /**
   * Create adapter with an existing backend instance
   */
  withBackend(
    backend: ParquetStorageBackend,
    options?: Omit<ParquetStorageAdapterOptions, 'backend'>
  ): ParquetStorageAdapter {
    return new ParquetStorageAdapter({ ...options, backend })
  }
}
