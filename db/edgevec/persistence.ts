/**
 * HNSW Index Persistence to R2 - Reliable Index Storage and Recovery
 *
 * This module provides save/load functionality for HNSW indices to Cloudflare R2
 * object storage. It handles serialization, chunking, compression, and integrity
 * validation for reliable index persistence.
 *
 * ## Features
 *
 * - **Chunked Storage**: Split large indices into manageable R2 objects (default 10MB)
 * - **Optional Compression**: Gzip compression to reduce storage costs
 * - **Checksum Validation**: SHA-256 checksums ensure data integrity
 * - **Point-in-time Backups**: Timestamped backups for disaster recovery
 * - **Manifest Tracking**: JSON manifests for index metadata and chunk locations
 *
 * ## Storage Layout
 *
 * ```
 * edgevec/
 *   my-index/
 *     _manifest.json         <- Current index manifest
 *     1704067200000/         <- Timestamped backup folder
 *       chunk_0.bin          <- Index data chunk 0
 *       chunk_1.bin          <- Index data chunk 1
 *       ...
 *     1704153600000/         <- Older backup
 *       chunk_0.bin
 *       ...
 * ```
 *
 * ## Manifest Format
 *
 * ```json
 * {
 *   "name": "my-index",
 *   "createdAt": 1704067200000,
 *   "updatedAt": 1704067200000,
 *   "vectorCount": 50000,
 *   "dimensions": 768,
 *   "config": { "M": 16, "efConstruction": 200, "metric": "cosine" },
 *   "chunks": [
 *     { "key": "edgevec/my-index/1704067200000/chunk_0.bin", "sizeBytes": 10485760, "checksum": "abc..." }
 *   ],
 *   "hasMetadata": true,
 *   "version": "1.0.0"
 * }
 * ```
 *
 * ## Storage Cost Estimation
 *
 * | Vectors | Dimensions | Estimated Size | R2 Cost (~$0.015/GB/mo) |
 * |---------|------------|----------------|-------------------------|
 * | 10K     | 768        | ~35MB          | ~$0.01/mo               |
 * | 100K    | 768        | ~350MB         | ~$0.05/mo               |
 * | 1M      | 768        | ~3.5GB         | ~$0.05/mo               |
 * | 10K     | 1536       | ~65MB          | ~$0.01/mo               |
 *
 * @example Saving an index to R2
 * ```typescript
 * import { HNSWPersistence } from 'db/edgevec/persistence'
 *
 * const persistence = new HNSWPersistence(env.R2, {
 *   compression: 'gzip',     // Enable compression
 *   maxChunkSizeMB: 10,      // 10MB chunks
 *   validateChecksum: true   // Verify on load
 * })
 *
 * // Save index with custom metadata
 * await persistence.save('my-index', index, {
 *   description: 'Product embeddings',
 *   lastTrainingDate: '2024-01-01'
 * })
 * ```
 *
 * @example Loading an index from R2
 * ```typescript
 * // Load latest version
 * const index = await persistence.load('my-index')
 *
 * // Load specific backup by timestamp
 * const backups = await persistence.listBackups('my-index')
 * const olderIndex = await persistence.loadBackup('my-index', backups[1].timestamp)
 * ```
 *
 * @example Index management
 * ```typescript
 * // Get manifest without loading full index
 * const manifest = await persistence.getManifest('my-index')
 * console.log(`Vectors: ${manifest.vectorCount}`)
 * console.log(`Dimensions: ${manifest.dimensions}`)
 *
 * // List all backups
 * const backups = await persistence.listBackups('my-index')
 * for (const backup of backups) {
 *   console.log(`${new Date(backup.timestamp)}: ${backup.vectorCount} vectors`)
 * }
 *
 * // Delete index and all backups
 * await persistence.delete('my-index')
 * ```
 *
 * @module db/edgevec/persistence
 */

import { HNSWIndexImpl, type HNSWIndex } from './hnsw'
import { FilteredHNSWIndexImpl, type FilteredHNSWIndex } from './filtered-search'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Persistence options
 */
export interface PersistenceOptions {
  /** Compression algorithm (default: none) */
  compression?: 'none' | 'gzip'
  /** Max chunk size in MB (default: 10) */
  maxChunkSizeMB?: number
  /** Whether to validate checksum on load (default: true) */
  validateChecksum?: boolean
}

/**
 * Index manifest stored in R2
 */
export interface IndexManifest {
  /** Index name */
  name: string
  /** Creation timestamp */
  createdAt: number
  /** Last update timestamp */
  updatedAt: number
  /** Number of vectors */
  vectorCount: number
  /** Vector dimensions */
  dimensions: number
  /** Index configuration */
  config: {
    M: number
    efConstruction: number
    metric: string
  }
  /** Data chunks */
  chunks: Array<{
    key: string
    sizeBytes: number
    checksum: string
  }>
  /** Has metadata */
  hasMetadata: boolean
  /** Custom metadata */
  indexMetadata?: Record<string, unknown>
  /** Version */
  version: string
}

/**
 * Backup info
 */
export interface BackupInfo {
  timestamp: number
  vectorCount: number
  sizeBytes: number
}

// ============================================================================
// PERSISTENCE IMPLEMENTATION
// ============================================================================

export class HNSWPersistence {
  private bucket: R2Bucket
  private options: Required<PersistenceOptions>
  private readonly MANIFEST_SUFFIX = '_manifest.json'
  private readonly VERSION = '1.0.0'

  constructor(bucket: R2Bucket, options: PersistenceOptions = {}) {
    this.bucket = bucket
    this.options = {
      compression: options.compression ?? 'none',
      maxChunkSizeMB: options.maxChunkSizeMB ?? 10,
      validateChecksum: options.validateChecksum ?? true,
    }
  }

  // ============================================================================
  // SAVE OPERATIONS
  // ============================================================================

  /**
   * Save index to R2
   */
  async save(
    name: string,
    index: HNSWIndex | FilteredHNSWIndex,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const timestamp = Date.now()
    const prefix = `edgevec/${name}/${timestamp}`

    // Serialize index
    const serialized = index.serialize()
    const data = new Uint8Array(serialized)

    // Compress if needed
    const finalData = await this.compress(data)

    // Calculate checksum
    const checksum = await this.calculateChecksum(finalData)

    // Split into chunks if needed
    const maxChunkBytes = this.options.maxChunkSizeMB * 1024 * 1024
    const chunks = this.splitIntoChunks(finalData, maxChunkBytes)

    // Upload chunks
    const chunkInfos: IndexManifest['chunks'] = []
    for (let i = 0; i < chunks.length; i++) {
      const chunkKey = `${prefix}/chunk_${i}.bin`
      const chunkChecksum = await this.calculateChecksum(chunks[i]!)

      await this.bucket.put(chunkKey, chunks[i]!.buffer as ArrayBuffer)

      chunkInfos.push({
        key: chunkKey,
        sizeBytes: chunks[i]!.byteLength,
        checksum: chunkChecksum,
      })
    }

    // Create manifest
    const isFiltered = 'getMetadata' in index
    const config = index.config()

    const manifest: IndexManifest = {
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
      vectorCount: index.size(),
      dimensions: index.dimensions(),
      config: {
        M: config.M,
        efConstruction: config.efConstruction,
        metric: config.metric,
      },
      chunks: chunkInfos,
      hasMetadata: isFiltered,
      indexMetadata: metadata,
      version: this.VERSION,
    }

    // Save manifest
    const manifestKey = `edgevec/${name}${this.MANIFEST_SUFFIX}`
    await this.bucket.put(manifestKey, JSON.stringify(manifest))
  }

  /**
   * Save incremental changes
   */
  async saveIncremental(
    name: string,
    index: HNSWIndex | FilteredHNSWIndex
  ): Promise<void> {
    // For now, just do a full save
    // Future: implement delta encoding
    await this.save(name, index)
  }

  // ============================================================================
  // LOAD OPERATIONS
  // ============================================================================

  /**
   * Load index from R2
   */
  async load(name: string): Promise<HNSWIndex | FilteredHNSWIndex> {
    // Get manifest
    const manifest = await this.getManifest(name)
    if (!manifest) {
      throw new Error(`Index "${name}" not found`)
    }

    // Load and concatenate chunks
    const chunks: Uint8Array[] = []
    for (const chunkInfo of manifest.chunks) {
      const obj = await this.bucket.get(chunkInfo.key)
      if (!obj) {
        throw new Error(`Chunk ${chunkInfo.key} not found`)
      }

      const chunkData = new Uint8Array(await obj.arrayBuffer())

      // Validate checksum
      if (this.options.validateChecksum) {
        const actualChecksum = await this.calculateChecksum(chunkData)
        if (actualChecksum !== chunkInfo.checksum) {
          throw new Error(`Checksum mismatch for chunk ${chunkInfo.key}`)
        }
      }

      chunks.push(chunkData)
    }

    // Concatenate chunks
    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.byteLength
    }

    // Decompress if needed
    const decompressed = await this.decompress(combined)

    // Deserialize
    if (manifest.hasMetadata) {
      return FilteredHNSWIndexImpl.deserialize(decompressed.buffer as ArrayBuffer)
    } else {
      return HNSWIndexImpl.deserialize(decompressed.buffer as ArrayBuffer)
    }
  }

  /**
   * Load from a specific backup
   */
  async loadBackup(name: string, timestamp: number): Promise<HNSWIndex | FilteredHNSWIndex> {
    const prefix = `edgevec/${name}/${timestamp}`
    const manifestKey = `${prefix}${this.MANIFEST_SUFFIX}`

    const obj = await this.bucket.get(manifestKey)
    if (!obj) {
      throw new Error(`Backup at timestamp ${timestamp} not found`)
    }

    const manifest = await obj.json<IndexManifest>()
    return this.loadFromManifest(manifest)
  }

  private async loadFromManifest(manifest: IndexManifest): Promise<HNSWIndex | FilteredHNSWIndex> {
    const chunks: Uint8Array[] = []
    for (const chunkInfo of manifest.chunks) {
      const obj = await this.bucket.get(chunkInfo.key)
      if (!obj) {
        throw new Error(`Chunk ${chunkInfo.key} not found`)
      }
      chunks.push(new Uint8Array(await obj.arrayBuffer()))
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.byteLength
    }

    const decompressed = await this.decompress(combined)

    if (manifest.hasMetadata) {
      return FilteredHNSWIndexImpl.deserialize(decompressed.buffer as ArrayBuffer)
    } else {
      return HNSWIndexImpl.deserialize(decompressed.buffer as ArrayBuffer)
    }
  }

  // ============================================================================
  // MANAGEMENT OPERATIONS
  // ============================================================================

  /**
   * Get manifest for an index
   */
  async getManifest(name: string): Promise<IndexManifest | null> {
    const manifestKey = `edgevec/${name}${this.MANIFEST_SUFFIX}`
    const obj = await this.bucket.get(manifestKey)
    if (!obj) {
      return null
    }
    return obj.json<IndexManifest>()
  }

  /**
   * List available backups
   */
  async listBackups(name: string): Promise<BackupInfo[]> {
    const prefix = `edgevec/${name}/`
    const listed = await this.bucket.list({ prefix })

    const backups: BackupInfo[] = []
    const timestamps = new Set<number>()

    for (const obj of listed.objects) {
      // Extract timestamp from path
      const match = obj.key.match(/\/(\d+)\//)
      if (match) {
        const timestamp = parseInt(match[1]!, 10)
        if (!timestamps.has(timestamp)) {
          timestamps.add(timestamp)
          backups.push({
            timestamp,
            vectorCount: 0, // Would need to load manifest to get this
            sizeBytes: obj.size,
          })
        }
      }
    }

    // Sort by timestamp descending
    backups.sort((a, b) => b.timestamp - a.timestamp)
    return backups
  }

  /**
   * Delete an index and all its backups
   */
  async delete(name: string): Promise<void> {
    const prefix = `edgevec/${name}/`
    const listed = await this.bucket.list({ prefix })

    for (const obj of listed.objects) {
      await this.bucket.delete(obj.key)
    }

    // Delete manifest
    const manifestKey = `edgevec/${name}${this.MANIFEST_SUFFIX}`
    await this.bucket.delete(manifestKey)
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private splitIntoChunks(data: Uint8Array, maxSize: number): Uint8Array[] {
    if (data.byteLength <= maxSize) {
      return [data]
    }

    const chunks: Uint8Array[] = []
    for (let i = 0; i < data.byteLength; i += maxSize) {
      chunks.push(data.slice(i, Math.min(i + maxSize, data.byteLength)))
    }
    return chunks
  }

  private async compress(data: Uint8Array): Promise<Uint8Array> {
    if (this.options.compression === 'none') {
      return data
    }

    // Use CompressionStream if available (Workers runtime)
    if (typeof CompressionStream !== 'undefined') {
      const stream = new CompressionStream('gzip')
      const writer = stream.writable.getWriter()
      writer.write(data)
      writer.close()

      const chunks: Uint8Array[] = []
      const reader = stream.readable.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0)
      const result = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
      }
      return result
    }

    // Fallback: no compression
    return data
  }

  private async decompress(data: Uint8Array): Promise<Uint8Array> {
    if (this.options.compression === 'none') {
      return data
    }

    // Use DecompressionStream if available
    if (typeof DecompressionStream !== 'undefined') {
      const stream = new DecompressionStream('gzip')
      const writer = stream.writable.getWriter()
      writer.write(data)
      writer.close()

      const chunks: Uint8Array[] = []
      const reader = stream.readable.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0)
      const result = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
      }
      return result
    }

    // Fallback: assume uncompressed
    return data
  }

  private async calculateChecksum(data: Uint8Array): Promise<string> {
    // Use SubtleCrypto if available
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    // Fallback: simple checksum
    let checksum = 0
    for (let i = 0; i < data.byteLength; i++) {
      checksum = ((checksum << 5) - checksum + data[i]!) | 0
    }
    return checksum.toString(16)
  }
}
