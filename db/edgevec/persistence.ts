/**
 * HNSW Index Persistence to R2
 *
 * Provides save/load functionality for HNSW indices to Cloudflare R2.
 * Features:
 * - Chunked storage for large indices
 * - Compression support
 * - Incremental backups
 * - Checksum validation
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
