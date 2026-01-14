/**
 * R2 Storage Adapter for Iceberg
 *
 * Provides storage operations for Iceberg metadata and data files on R2.
 *
 * @module db/compat/sql/duckdb-wasm/iceberg/deep/storage
 */

import type {
  R2StorageAdapter,
  R2StorageConfig,
  FileEntry,
} from './types'
import type { TableMetadata } from '../types'

// ============================================================================
// R2 Storage Adapter Implementation
// ============================================================================

class R2StorageAdapterImpl implements R2StorageAdapter {
  private bucket: R2StorageConfig['bucket']
  private prefix: string

  constructor(config: R2StorageConfig) {
    this.bucket = config.bucket
    this.prefix = config.prefix || ''
  }

  /**
   * Build full R2 key from path
   */
  private buildKey(path: string): string {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path
    return this.prefix ? `${this.prefix}${cleanPath}` : cleanPath
  }

  /**
   * Strip prefix from key
   */
  private stripPrefix(key: string): string {
    if (this.prefix && key.startsWith(this.prefix)) {
      return key.slice(this.prefix.length)
    }
    return key
  }

  // ============================================================================
  // Read Operations
  // ============================================================================

  async readMetadata(path: string): Promise<TableMetadata> {
    const key = this.buildKey(path)
    const object = await this.bucket.get(key)

    if (!object) {
      throw new Error(`File not found: ${path}`)
    }

    // R2 objects have json() method for JSON files
    if ('json' in object && typeof object.json === 'function') {
      return object.json() as Promise<TableMetadata>
    }

    // Fallback: parse from arrayBuffer
    const buffer = await object.arrayBuffer()
    const text = new TextDecoder().decode(buffer)
    return JSON.parse(text) as TableMetadata
  }

  async readParquet(path: string): Promise<ArrayBuffer> {
    const key = this.buildKey(path)
    const object = await this.bucket.get(key)

    if (!object) {
      throw new Error(`File not found: ${path}`)
    }

    return object.arrayBuffer()
  }

  async readAvro(path: string): Promise<ArrayBuffer> {
    const key = this.buildKey(path)
    const object = await this.bucket.get(key)

    if (!object) {
      throw new Error(`File not found: ${path}`)
    }

    return object.arrayBuffer()
  }

  // ============================================================================
  // Write Operations
  // ============================================================================

  async writeMetadata(path: string, metadata: TableMetadata): Promise<void> {
    const key = this.buildKey(path)
    const content = JSON.stringify(metadata, null, 2)

    await this.bucket.put(key, content, {
      httpMetadata: {
        contentType: 'application/json',
      },
    })
  }

  async writeParquet(path: string, data: ArrayBuffer): Promise<void> {
    const key = this.buildKey(path)

    await this.bucket.put(key, data, {
      httpMetadata: {
        contentType: 'application/octet-stream',
      },
    })
  }

  // ============================================================================
  // Listing and Management
  // ============================================================================

  async listFiles(prefix: string): Promise<FileEntry[]> {
    const fullPrefix = this.buildKey(prefix)
    const entries: FileEntry[] = []
    let cursor: string | undefined

    do {
      const options: { prefix: string; limit: number; cursor?: string } = {
        prefix: fullPrefix,
        limit: 1000,
      }

      if (cursor) {
        options.cursor = cursor
      }

      const result = await this.bucket.list(options)

      for (const obj of result.objects) {
        entries.push({
          key: this.stripPrefix(obj.key),
          size: obj.size,
          // R2ObjectHead doesn't have lastModified or etag directly
          // These would come from head() call
        })
      }

      cursor = result.truncated ? result.cursor : undefined
    } while (cursor)

    return entries
  }

  async deleteFile(path: string): Promise<void> {
    const key = this.buildKey(path)
    await this.bucket.delete(key)
  }

  async exists(path: string): Promise<boolean> {
    const key = this.buildKey(path)
    const head = await this.bucket.head(key)
    return head !== null
  }

  // ============================================================================
  // Path Resolution
  // ============================================================================

  resolveS3Path(s3Path: string): string {
    // Handle s3:// URLs
    if (s3Path.startsWith('s3://')) {
      // s3://bucket-name/path/to/file -> path/to/file
      const withoutProtocol = s3Path.slice(5)
      const slashIndex = withoutProtocol.indexOf('/')
      if (slashIndex === -1) {
        return ''
      }
      return withoutProtocol.slice(slashIndex + 1)
    }

    // Handle absolute paths
    if (s3Path.startsWith('/')) {
      return s3Path.slice(1)
    }

    return s3Path
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an R2 storage adapter
 *
 * @param config - Storage configuration
 * @returns R2 storage adapter instance
 *
 * @example
 * ```typescript
 * const storage = createR2StorageAdapter({
 *   bucket: env.R2_BUCKET,
 *   prefix: 'warehouse/',
 * })
 *
 * const metadata = await storage.readMetadata('analytics/events/metadata/v1.json')
 * const parquet = await storage.readParquet('analytics/events/data/part-00000.parquet')
 * ```
 */
export function createR2StorageAdapter(config: R2StorageConfig): R2StorageAdapter {
  return new R2StorageAdapterImpl(config)
}
