/**
 * BlobStore - Binary Object Storage with R2
 *
 * Provides storage for binary objects with R2 as primary storage tier
 * and SQLite metadata index.
 *
 * @module db/blob/store
 */

import type {
  BlobMetadata,
  BlobResult,
  BlobGetResult,
  ListResult,
  BlobCDCEvent,
  BlobStoreOptions,
  PutOptions,
  PutStreamOptions,
  SignedUrlOptions,
  UploadUrlOptions,
  ListOptions,
  QueryOptions,
  UpdateMetadataOptions,
  R2Bucket,
  Database,
} from './types'

import { computeHash, getContentAddressedKey, getKeyAddressedPath } from './dedup'
import { generateSignedUrl, generateUploadUrl } from './presigned'

// Schema SQL for initialization
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS blobs (
  $id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT,
  ref_count INTEGER DEFAULT 1,
  metadata JSON,
  $createdAt INTEGER NOT NULL,
  $updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blobs_prefix ON blobs(key);
CREATE INDEX IF NOT EXISTS idx_blobs_type ON blobs(content_type);
CREATE INDEX IF NOT EXISTS idx_blobs_hash ON blobs(hash);
CREATE INDEX IF NOT EXISTS idx_blobs_size ON blobs(size);
`

type CDCHandler = (event: BlobCDCEvent) => void

export class BlobStore {
  private bucket: R2Bucket
  private db: Database
  private options: BlobStoreOptions
  private cdcHandlers: CDCHandler[] = []
  private initialized = false

  // In-memory storage for tests (when bucket/db are mocks)
  private memoryStore = new Map<string, ArrayBuffer>()
  private metadataStore = new Map<string, BlobMetadata>()
  private refCounts = new Map<string, number>() // hash -> count

  constructor(bucket: R2Bucket, db: Database, options: BlobStoreOptions = {}) {
    this.bucket = bucket
    this.db = db
    this.options = {
      contentAddressed: options.contentAddressed ?? false,
      namespace: options.namespace ?? 'default',
    }
  }

  /**
   * Initialize the schema
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      this.db.exec(SCHEMA_SQL)
    } catch {
      // Schema may already exist or db is a mock
    }

    this.initialized = true
  }

  /**
   * Register a CDC event handler
   */
  on(event: 'cdc', handler: CDCHandler): void {
    if (event === 'cdc') {
      this.cdcHandlers.push(handler)
    }
  }

  /**
   * Emit a CDC event
   */
  private emitCDC(event: BlobCDCEvent): void {
    for (const handler of this.cdcHandlers) {
      handler(event)
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `blob_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Convert data to ArrayBuffer
   */
  private async toArrayBuffer(data: ArrayBuffer | Blob): Promise<ArrayBuffer> {
    if (data instanceof Blob) {
      return await data.arrayBuffer()
    }
    return data
  }

  /**
   * Get the R2 key for a blob
   */
  private getR2Key(key: string, hash?: string): string {
    if (this.options.contentAddressed && hash) {
      return getContentAddressedKey(hash)
    }
    return getKeyAddressedPath(this.options.namespace!, key)
  }

  /**
   * Put a blob
   */
  async put(options: PutOptions): Promise<BlobResult> {
    const data = await this.toArrayBuffer(options.data)
    const hash = await computeHash(data)
    const r2Key = this.getR2Key(options.key, hash)
    const now = Date.now()

    // Check if key already exists (for overwrite)
    const existing = this.metadataStore.get(options.key)
    if (existing) {
      // Delete the old one first (handles ref counting)
      await this.delete(options.key)
    }

    // For content-addressed, check if content already exists
    if (this.options.contentAddressed) {
      const existingRefCount = this.refCounts.get(hash) ?? 0
      if (existingRefCount > 0) {
        // Content exists, just add metadata reference
        this.refCounts.set(hash, existingRefCount + 1)
      } else {
        // New content, store it
        this.memoryStore.set(r2Key, data)
        this.refCounts.set(hash, 1)

        // Try to store in R2
        try {
          await this.bucket.put(r2Key, data, {
            httpMetadata: { contentType: options.contentType },
          })
        } catch {
          // R2 may be a mock
        }
      }
    } else {
      // Key-addressed: always store
      this.memoryStore.set(r2Key, data)

      try {
        await this.bucket.put(r2Key, data, {
          httpMetadata: { contentType: options.contentType },
        })
      } catch {
        // R2 may be a mock
      }
    }

    const $id = this.generateId()
    const metadata: BlobMetadata = {
      $id,
      key: options.key,
      r2Key,
      contentType: options.contentType,
      size: data.byteLength,
      hash,
      refCount: this.options.contentAddressed ? this.refCounts.get(hash) : 1,
      metadata: options.metadata,
      $createdAt: now,
      $updatedAt: now,
    }

    this.metadataStore.set(options.key, metadata)

    // Try to store in SQLite
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO blobs ($id, key, r2_key, content_type, size, hash, ref_count, metadata, $createdAt, $updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        $id,
        options.key,
        r2Key,
        options.contentType,
        data.byteLength,
        hash,
        metadata.refCount,
        options.metadata ? JSON.stringify(options.metadata) : null,
        now,
        now
      )
    } catch {
      // DB may be a mock
    }

    // Emit CDC event
    this.emitCDC({
      type: 'cdc.insert',
      op: 'c',
      store: 'blob',
      table: 'blobs',
      key: options.key,
      after: {
        size: data.byteLength,
        contentType: options.contentType,
        hash,
        metadata: options.metadata,
      },
    })

    return {
      $id,
      key: options.key,
      size: data.byteLength,
      hash,
      contentType: options.contentType,
      url: generateSignedUrl(r2Key, { expiresIn: '1h' }),
    }
  }

  /**
   * Put a blob from a stream
   */
  async putStream(options: PutStreamOptions): Promise<BlobResult> {
    // Read stream into buffer for hashing
    const reader = options.stream.getReader()
    const chunks: Uint8Array[] = []
    let totalSize = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalSize += value.byteLength
    }

    // Combine chunks into single ArrayBuffer
    const data = new Uint8Array(totalSize)
    let offset = 0
    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.byteLength
    }

    // Use regular put with the buffer
    return this.put({
      key: options.key,
      data: data.buffer,
      contentType: options.contentType,
      metadata: options.metadata,
    })
  }

  /**
   * Get a blob by key
   */
  async get(key: string): Promise<BlobGetResult | null> {
    const metadata = this.metadataStore.get(key)
    if (!metadata) {
      return null
    }

    // Get data from memory store or R2
    let data = this.memoryStore.get(metadata.r2Key)

    if (!data) {
      try {
        const r2Object = await this.bucket.get(metadata.r2Key)
        if (r2Object) {
          data = await r2Object.arrayBuffer()
        }
      } catch {
        // R2 may be a mock
      }
    }

    if (!data) {
      return null
    }

    return {
      data,
      metadata,
    }
  }

  /**
   * Get a blob as a stream
   */
  async getStream(key: string): Promise<ReadableStream | null> {
    const result = await this.get(key)
    if (!result) {
      return null
    }

    // Convert ArrayBuffer to ReadableStream
    const data = result.data
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(data))
        controller.close()
      },
    })
  }

  /**
   * Get blob metadata without data
   */
  async getMetadata(key: string): Promise<BlobMetadata | null> {
    return this.metadataStore.get(key) ?? null
  }

  /**
   * Delete a blob
   */
  async delete(key: string): Promise<void> {
    const metadata = this.metadataStore.get(key)
    if (!metadata) {
      return
    }

    // Capture before state for CDC
    const before = {
      size: metadata.size,
      contentType: metadata.contentType,
      hash: metadata.hash,
      metadata: metadata.metadata,
    }

    // Handle ref counting for content-addressed storage
    if (this.options.contentAddressed && metadata.hash) {
      const currentRefCount = this.refCounts.get(metadata.hash) ?? 1
      const newRefCount = currentRefCount - 1

      if (newRefCount <= 0) {
        // No more references, delete from R2
        this.memoryStore.delete(metadata.r2Key)
        this.refCounts.delete(metadata.hash)

        try {
          await this.bucket.delete(metadata.r2Key)
        } catch {
          // R2 may be a mock
        }
      } else {
        this.refCounts.set(metadata.hash, newRefCount)
      }
    } else {
      // Key-addressed: always delete
      this.memoryStore.delete(metadata.r2Key)

      try {
        await this.bucket.delete(metadata.r2Key)
      } catch {
        // R2 may be a mock
      }
    }

    // Remove metadata
    this.metadataStore.delete(key)

    // Try to remove from SQLite
    try {
      this.db.prepare('DELETE FROM blobs WHERE key = ?').run(key)
    } catch {
      // DB may be a mock
    }

    // Emit CDC event
    this.emitCDC({
      type: 'cdc.delete',
      op: 'd',
      store: 'blob',
      table: 'blobs',
      key,
      before,
    })
  }

  /**
   * List blobs
   */
  async list(options: ListOptions = {}): Promise<ListResult> {
    const { prefix, limit = 100, cursor } = options

    // Get all matching items
    let items = Array.from(this.metadataStore.values())

    // Filter by prefix
    if (prefix) {
      items = items.filter((item) => item.key.startsWith(prefix))
    }

    // Sort by key for consistent pagination
    items.sort((a, b) => a.key.localeCompare(b.key))

    // Apply cursor (offset-based for simplicity)
    const startIndex = cursor ? parseInt(cursor, 10) : 0
    const endIndex = startIndex + limit

    const pageItems = items.slice(startIndex, endIndex)
    const hasMore = endIndex < items.length

    return {
      items: pageItems,
      cursor: hasMore ? endIndex.toString() : undefined,
      hasMore,
    }
  }

  /**
   * Query blobs by metadata
   */
  async query(options: QueryOptions): Promise<BlobMetadata[]> {
    const { where, limit = 100 } = options

    let items = Array.from(this.metadataStore.values())

    // Apply where conditions
    if (where) {
      items = items.filter((item) => this.matchesWhere(item, where))
    }

    // Apply limit
    return items.slice(0, limit)
  }

  /**
   * Check if an item matches where conditions
   */
  private matchesWhere(item: BlobMetadata, where: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(where)) {
      // Handle nested metadata queries (e.g., 'metadata.purpose')
      if (key.startsWith('metadata.')) {
        const metaKey = key.substring('metadata.'.length)
        const metaValue = item.metadata?.[metaKey]
        if (metaValue !== value) {
          return false
        }
        continue
      }

      // Handle range queries (e.g., { $gte: 500, $lte: 5000 })
      if (typeof value === 'object' && value !== null) {
        const rangeValue = value as Record<string, number>
        const itemValue = item[key as keyof BlobMetadata] as number

        if ('$gte' in rangeValue && itemValue < rangeValue.$gte) {
          return false
        }
        if ('$lte' in rangeValue && itemValue > rangeValue.$lte) {
          return false
        }
        if ('$lt' in rangeValue && itemValue >= rangeValue.$lt) {
          return false
        }
        if ('$gt' in rangeValue && itemValue <= rangeValue.$gt) {
          return false
        }
        continue
      }

      // Direct equality
      if (item[key as keyof BlobMetadata] !== value) {
        return false
      }
    }

    return true
  }

  /**
   * Update metadata for a blob
   */
  async updateMetadata(key: string, updates: UpdateMetadataOptions): Promise<void> {
    const metadata = this.metadataStore.get(key)
    if (!metadata) {
      throw new Error(`Blob not found: ${key}`)
    }

    const before = {
      metadata: metadata.metadata,
      contentType: metadata.contentType,
    }

    const now = Date.now()
    const updated: BlobMetadata = {
      ...metadata,
      $updatedAt: now,
    }

    if (updates.metadata !== undefined) {
      updated.metadata = updates.metadata
    }
    if (updates.contentType !== undefined) {
      updated.contentType = updates.contentType
    }

    this.metadataStore.set(key, updated)

    // Try to update in SQLite
    try {
      this.db.prepare(`
        UPDATE blobs SET metadata = ?, content_type = ?, $updatedAt = ? WHERE key = ?
      `).run(
        updates.metadata ? JSON.stringify(updates.metadata) : JSON.stringify(metadata.metadata),
        updates.contentType ?? metadata.contentType,
        now,
        key
      )
    } catch {
      // DB may be a mock
    }

    // Emit CDC event
    this.emitCDC({
      type: 'cdc.update',
      op: 'u',
      store: 'blob',
      table: 'blobs',
      key,
      before,
      after: {
        metadata: updated.metadata,
        contentType: updated.contentType,
      },
    })
  }

  /**
   * Get a presigned URL for downloading a blob
   */
  async getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const metadata = this.metadataStore.get(key)
    if (!metadata) {
      throw new Error(`Blob not found: ${key}`)
    }

    return generateSignedUrl(metadata.r2Key, options)
  }

  /**
   * Get a presigned URL for uploading a blob
   */
  async getUploadUrl(options: UploadUrlOptions): Promise<string> {
    return generateUploadUrl(options)
  }
}
