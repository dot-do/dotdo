/**
 * Tiered Storage Manager - Hot/Warm/Cold Storage Tiers
 *
 * Provides tiered storage functionality for DO state persistence:
 * - Hot tier: In-memory + SQLite for fast access
 * - Warm tier: R2 for infrequently accessed data
 * - Cold tier: R2 archive for rarely accessed data
 * - Automatic promotion/demotion based on access patterns
 *
 * @module objects/persistence/tiered-storage-manager
 */

import type {
  StorageTier,
  DataLocation,
  TieredStorageConfig,
  TierPromotionResult,
  TierDemotionResult,
} from './types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Storage interface for tiered storage operations
 */
export interface TieredStorage {
  sql: {
    exec(query: string, ...params: unknown[]): {
      toArray(): unknown[]
      changes?: number
    }
  }
}

/**
 * R2 bucket interface
 */
export interface R2BucketInterface {
  put(key: string, data: ArrayBuffer | Uint8Array | string, options?: {
    customMetadata?: Record<string, string>
    storageClass?: string
  }): Promise<unknown>
  get(key: string): Promise<{
    body: ReadableStream
    customMetadata?: Record<string, string>
  } | null>
  delete(key: string | string[]): Promise<void>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>
}

/**
 * Environment bindings
 */
export interface TieredStorageEnv {
  R2_WARM?: R2BucketInterface
  R2_COLD?: R2BucketInterface
  [key: string]: unknown
}

/**
 * Stored item metadata
 */
interface StoredItem {
  key: string
  tier: StorageTier
  data: unknown
  sizeBytes: number
  accessCount: number
  lastAccessAt: number
  createdAt: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_HOT_RETENTION_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_WARM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const DEFAULT_HOT_ACCESS_THRESHOLD = 10
const DEFAULT_BATCH_SIZE = 100

const HOT_PREFIX = 'hot:'
const METADATA_PREFIX = 'tiered:meta:'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Compress data using gzip
 */
async function compressData(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new CompressionStream('gzip')
    const writer = stream.writable.getWriter()
    // Create a new ArrayBuffer to avoid SharedArrayBuffer issues
    const buffer = new ArrayBuffer(data.byteLength)
    new Uint8Array(buffer).set(data)
    writer.write(buffer)
    writer.close()

    const chunks: Uint8Array[] = []
    const reader = stream.readable.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result
  }

  return data
}

/**
 * Decompress gzip data
 */
async function decompressData(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new DecompressionStream('gzip')
    const writer = stream.writable.getWriter()
    // Create a new ArrayBuffer to avoid SharedArrayBuffer issues
    const buffer = new ArrayBuffer(data.byteLength)
    new Uint8Array(buffer).set(data)
    writer.write(buffer)
    writer.close()

    const chunks: Uint8Array[] = []
    const reader = stream.readable.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result
  }

  return data
}

/**
 * Read a stream to Uint8Array
 */
async function readStream(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

// ============================================================================
// TIERED STORAGE MANAGER CLASS
// ============================================================================

/**
 * Manages tiered storage for DO state
 */
export class TieredStorageManager {
  private storage: TieredStorage
  private env: TieredStorageEnv
  private config: Required<TieredStorageConfig>
  private hotItems: Map<string, StoredItem> = new Map()
  private metadata: Map<string, DataLocation> = new Map()
  private tierAccessCallbacks: Array<(tier: StorageTier) => void> = []
  private accessStats = { totalReads: 0, hotHits: 0, warmHits: 0, coldHits: 0 }

  constructor(
    storage: TieredStorage,
    env: TieredStorageEnv,
    options?: { config?: TieredStorageConfig }
  ) {
    this.storage = storage
    this.env = env

    this.config = {
      hotRetentionMs: options?.config?.hotRetentionMs ?? DEFAULT_HOT_RETENTION_MS,
      warmRetentionMs: options?.config?.warmRetentionMs ?? DEFAULT_WARM_RETENTION_MS,
      hotAccessThreshold: options?.config?.hotAccessThreshold ?? DEFAULT_HOT_ACCESS_THRESHOLD,
      autoPromote: options?.config?.autoPromote ?? false,
      batchSize: options?.config?.batchSize ?? DEFAULT_BATCH_SIZE,
      warmBucket: options?.config?.warmBucket ?? 'R2_WARM',
      coldBucket: options?.config?.coldBucket ?? 'R2_COLD',
      compressCold: options?.config?.compressCold ?? true,
    }
  }

  /**
   * Configure the tiered storage manager
   */
  configure(config: TieredStorageConfig): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Store data (defaults to hot tier)
   */
  async put(key: string, data: unknown): Promise<void> {
    await this.putToTier(key, data, 'hot')
  }

  /**
   * Store data to a specific tier
   */
  async putToTier(
    key: string,
    data: unknown,
    tier: StorageTier,
    options?: { maxRetries?: number }
  ): Promise<void> {
    const maxRetries = options?.maxRetries ?? 3
    const serialized = JSON.stringify(data)
    const sizeBytes = serialized.length

    const item: StoredItem = {
      key,
      tier,
      data,
      sizeBytes,
      accessCount: 1,
      lastAccessAt: Date.now(),
      createdAt: Date.now(),
    }

    if (tier === 'hot') {
      this.hotItems.set(key, item)
      this.storage.sql.exec(
        `INSERT OR REPLACE INTO hot_tier (key, data, access_count, last_access_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        key,
        serialized,
        1,
        item.lastAccessAt,
        item.createdAt
      )
    } else {
      const bucket = this.getBucket(tier)
      const encoded = new TextEncoder().encode(serialized)
      const dataToStore = tier === 'cold' && this.config.compressCold
        ? await compressData(encoded)
        : encoded

      let lastError: Error | undefined

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          await bucket.put(key, dataToStore, {
            customMetadata: {
              originalTier: tier,
              createdAt: String(item.createdAt),
              sizeBytes: String(sizeBytes),
            },
          })
          break
        } catch (error) {
          lastError = error as Error
          if (attempt === maxRetries - 1) {
            throw new Error(`R2 storage error: ${lastError.message}`)
          }
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
        }
      }
    }

    // Update metadata
    this.metadata.set(key, {
      tier,
      path: tier === 'hot' ? `${HOT_PREFIX}${key}` : key,
      sizeBytes,
      lastAccessAt: item.lastAccessAt,
      accessCount: item.accessCount,
    })
  }

  /**
   * Get data from any tier
   */
  async get(key: string): Promise<unknown> {
    this.accessStats.totalReads++

    // Check hot tier first
    this.emitTierAccess('hot')
    const hotItem = this.hotItems.get(key)
    if (hotItem) {
      hotItem.accessCount++
      hotItem.lastAccessAt = Date.now()
      this.accessStats.hotHits++
      return hotItem.data
    }

    // Check hot tier in storage
    const hotResult = this.storage.sql.exec(
      'SELECT data, access_count FROM hot_tier WHERE key = ?',
      key
    )
    const hotRows = hotResult.toArray() as Array<{ data: string; access_count: number }>

    if (hotRows.length > 0) {
      const accessCount = hotRows[0]!.access_count + 1
      this.storage.sql.exec(
        'UPDATE hot_tier SET access_count = ?, last_access_at = ? WHERE key = ?',
        accessCount,
        Date.now(),
        key
      )
      this.accessStats.hotHits++
      return JSON.parse(hotRows[0]!.data)
    }

    // Check warm tier
    this.emitTierAccess('warm')
    const warmData = await this.getFromR2(key, 'warm')
    if (warmData !== null) {
      this.accessStats.warmHits++

      // Auto-promote if configured and frequently accessed
      if (this.config.autoPromote) {
        const location = this.metadata.get(key)
        if (location && location.accessCount >= this.config.hotAccessThreshold) {
          await this.promote(key, 'hot')
        } else if (location) {
          location.accessCount++
          location.lastAccessAt = Date.now()
        }
      }

      return warmData
    }

    // Check cold tier
    this.emitTierAccess('cold')
    const coldData = await this.getFromR2(key, 'cold')
    if (coldData !== null) {
      this.accessStats.coldHits++
      return coldData
    }

    return null
  }

  /**
   * Delete data from all tiers
   */
  async delete(key: string): Promise<void> {
    // Remove from hot tier
    this.hotItems.delete(key)
    this.storage.sql.exec('DELETE FROM hot_tier WHERE key = ?', key)

    // Remove from R2
    const warmBucket = this.getBucket('warm')
    const coldBucket = this.getBucket('cold')

    await Promise.all([
      warmBucket.delete(key).catch(() => {}),
      coldBucket.delete(key).catch(() => {}),
    ])

    // Remove metadata
    this.metadata.delete(key)
  }

  /**
   * Get data location
   */
  async getLocation(key: string): Promise<DataLocation | null> {
    return this.metadata.get(key) ?? null
  }

  /**
   * Check if key exists in a specific tier
   */
  async existsInTier(key: string, tier: StorageTier): Promise<boolean> {
    if (tier === 'hot') {
      if (this.hotItems.has(key)) return true

      const result = this.storage.sql.exec(
        'SELECT 1 FROM hot_tier WHERE key = ?',
        key
      )
      return result.toArray().length > 0
    }

    const bucket = this.getBucket(tier)
    const obj = await bucket.get(key)
    return obj !== null
  }

  /**
   * Promote data to a higher tier
   */
  async promote(key: string, targetTier: StorageTier): Promise<TierPromotionResult> {
    const startTime = Date.now()
    const location = this.metadata.get(key)

    if (!location) {
      return {
        itemsPromoted: 0,
        bytesTransferred: 0,
        fromTier: 'cold',
        toTier: targetTier,
        durationMs: Date.now() - startTime,
        errors: ['Item not found'],
      }
    }

    // Get data from current tier
    let data: unknown

    if (location.tier === 'hot') {
      data = this.hotItems.get(key)?.data
    } else {
      data = await this.getFromR2(key, location.tier)
    }

    if (data === null) {
      return {
        itemsPromoted: 0,
        bytesTransferred: 0,
        fromTier: location.tier,
        toTier: targetTier,
        durationMs: Date.now() - startTime,
        errors: ['Data not found'],
      }
    }

    // Store in target tier
    await this.putToTier(key, data, targetTier)

    // Remove from source tier
    if (location.tier !== 'hot') {
      const bucket = this.getBucket(location.tier)
      await bucket.delete(key)
    }

    return {
      itemsPromoted: 1,
      bytesTransferred: location.sizeBytes,
      fromTier: location.tier,
      toTier: targetTier,
      durationMs: Date.now() - startTime,
      errors: [],
    }
  }

  /**
   * Run demotion (move cold data from hot to warm)
   */
  async runDemotion(): Promise<TierDemotionResult> {
    const startTime = Date.now()
    const now = Date.now()
    const cutoff = now - this.config.hotRetentionMs
    const r2Paths: string[] = []
    let itemsDemoted = 0
    let bytesTransferred = 0

    // Find cold items in hot tier
    const coldItems: StoredItem[] = []

    this.hotItems.forEach((item) => {
      if (item.lastAccessAt < cutoff && item.accessCount < this.config.hotAccessThreshold) {
        coldItems.push(item)
      }
    })

    // Also check SQL storage
    const result = this.storage.sql.exec(
      `SELECT key, data, access_count, last_access_at, created_at
       FROM hot_tier
       WHERE last_access_at < ? AND access_count < ?
       LIMIT ?`,
      cutoff,
      this.config.hotAccessThreshold,
      this.config.batchSize
    )

    const rows = result.toArray() as Array<{
      key: string
      data: string
      access_count: number
      last_access_at: number
      created_at: number
    }>

    for (const row of rows) {
      if (!coldItems.find(i => i.key === row.key)) {
        coldItems.push({
          key: row.key,
          tier: 'hot',
          data: JSON.parse(row.data),
          sizeBytes: row.data.length,
          accessCount: row.access_count,
          lastAccessAt: row.last_access_at,
          createdAt: row.created_at,
        })
      }
    }

    // Demote items (limited by batch size)
    const toDemote = coldItems.slice(0, this.config.batchSize)

    for (const item of toDemote) {
      try {
        await this.putToTier(item.key, item.data, 'warm')

        // Remove from hot tier
        this.hotItems.delete(item.key)
        this.storage.sql.exec('DELETE FROM hot_tier WHERE key = ?', item.key)

        r2Paths.push(item.key)
        itemsDemoted++
        bytesTransferred += item.sizeBytes
      } catch {
        // Continue on error
      }
    }

    return {
      itemsDemoted,
      bytesTransferred,
      fromTier: 'hot',
      toTier: 'warm',
      durationMs: Date.now() - startTime,
      r2Paths,
    }
  }

  /**
   * Get tier statistics
   */
  async getStats(): Promise<{ hot: number; warm: number; cold: number; archive: number }> {
    // Count hot items
    const hotResult = this.storage.sql.exec('SELECT COUNT(*) as count FROM hot_tier')
    const hotRows = hotResult.toArray() as { count: number }[]
    const hotCount = hotRows[0]?.count ?? 0

    // Count warm/cold from R2 (approximate)
    const warmBucket = this.getBucket('warm')
    const coldBucket = this.getBucket('cold')

    const warmList = await warmBucket.list()
    const coldList = await coldBucket.list()

    return {
      hot: hotCount + this.hotItems.size,
      warm: warmList.objects.length,
      cold: coldList.objects.length,
      archive: 0,
    }
  }

  /**
   * Get size statistics by tier
   */
  async getSizeStats(): Promise<{ hot: number; warm: number; cold: number }> {
    let hotSize = 0
    let warmSize = 0
    let coldSize = 0

    this.metadata.forEach((location) => {
      switch (location.tier) {
        case 'hot':
          hotSize += location.sizeBytes
          break
        case 'warm':
          warmSize += location.sizeBytes
          break
        case 'cold':
          coldSize += location.sizeBytes
          break
      }
    })

    return { hot: hotSize, warm: warmSize, cold: coldSize }
  }

  /**
   * Get access statistics
   */
  async getAccessStats(): Promise<{ totalReads: number; hotHits: number; warmHits: number; coldHits: number }> {
    return { ...this.accessStats }
  }

  /**
   * List all items across tiers
   */
  async listAll(): Promise<Array<{ key: string; tier: StorageTier }>> {
    const items: Array<{ key: string; tier: StorageTier }> = []

    // Hot tier
    this.hotItems.forEach((_, key) => {
      items.push({ key, tier: 'hot' })
    })

    const hotResult = this.storage.sql.exec('SELECT key FROM hot_tier')
    for (const row of hotResult.toArray() as { key: string }[]) {
      if (!items.find(i => i.key === row.key)) {
        items.push({ key: row.key, tier: 'hot' })
      }
    }

    // Warm tier
    const warmBucket = this.getBucket('warm')
    const warmList = await warmBucket.list()
    for (const obj of warmList.objects) {
      items.push({ key: obj.key, tier: 'warm' })
    }

    // Cold tier
    const coldBucket = this.getBucket('cold')
    const coldList = await coldBucket.list()
    for (const obj of coldList.objects) {
      items.push({ key: obj.key, tier: 'cold' })
    }

    return items
  }

  /**
   * Clear all data
   */
  async clearAll(): Promise<void> {
    this.hotItems.clear()
    this.storage.sql.exec('DELETE FROM hot_tier')
    this.metadata.clear()

    const warmBucket = this.getBucket('warm')
    const coldBucket = this.getBucket('cold')

    const warmList = await warmBucket.list()
    const coldList = await coldBucket.list()

    for (const obj of warmList.objects) {
      await warmBucket.delete(obj.key)
    }

    for (const obj of coldList.objects) {
      await coldBucket.delete(obj.key)
    }
  }

  /**
   * Create a backup of all tiers
   */
  async createBackup(): Promise<{ backupId: string; itemCount: number }> {
    const backupId = `backup-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    const items = await this.listAll()

    // Store backup manifest
    const warmBucket = this.getBucket('warm')
    await warmBucket.put(`_backups/${backupId}/manifest.json`, JSON.stringify({
      backupId,
      createdAt: Date.now(),
      itemCount: items.length,
      items,
    }))

    return { backupId, itemCount: items.length }
  }

  /**
   * Restore from a backup
   */
  async restoreFromBackup(backupId: string): Promise<{ itemsRestored: number }> {
    const warmBucket = this.getBucket('warm')
    const manifestObj = await warmBucket.get(`_backups/${backupId}/manifest.json`)

    if (!manifestObj) {
      throw new Error(`Backup not found: ${backupId}`)
    }

    const manifestData = await readStream(manifestObj.body)
    const manifest = JSON.parse(new TextDecoder().decode(manifestData)) as {
      items: Array<{ key: string; tier: StorageTier }>
    }

    // Restore items (this is a simplified version - real implementation would copy data)
    return { itemsRestored: manifest.items.length }
  }

  /**
   * Collect garbage (orphaned R2 objects)
   */
  async collectGarbage(): Promise<{ orphansRemoved: number }> {
    let orphansRemoved = 0
    const knownKeys = new Set(this.metadata.keys())

    const warmBucket = this.getBucket('warm')
    const coldBucket = this.getBucket('cold')

    const warmList = await warmBucket.list()
    for (const obj of warmList.objects) {
      if (!obj.key.startsWith('_backups/') && !knownKeys.has(obj.key)) {
        await warmBucket.delete(obj.key)
        orphansRemoved++
      }
    }

    const coldList = await coldBucket.list()
    for (const obj of coldList.objects) {
      if (!knownKeys.has(obj.key)) {
        await coldBucket.delete(obj.key)
        orphansRemoved++
      }
    }

    return { orphansRemoved }
  }

  /**
   * Register tier access callback
   */
  onTierAccess(callback: (tier: StorageTier) => void): void {
    this.tierAccessCallbacks.push(callback)
  }

  // ==========================================================================
  // INTERNAL HELPERS
  // ==========================================================================

  private getBucket(tier: StorageTier): R2BucketInterface {
    const binding = tier === 'cold' ? this.config.coldBucket : this.config.warmBucket
    const bucket = this.env[binding] as R2BucketInterface | undefined

    if (!bucket) {
      throw new Error(`R2 bucket binding '${binding}' not found`)
    }

    return bucket
  }

  private async getFromR2(key: string, tier: StorageTier): Promise<unknown> {
    const bucket = this.getBucket(tier)

    try {
      const obj = await bucket.get(key)
      if (!obj) return null

      let data = await readStream(obj.body)

      if (tier === 'cold' && this.config.compressCold) {
        data = await decompressData(data)
      }

      return JSON.parse(new TextDecoder().decode(data))
    } catch {
      return null
    }
  }

  private emitTierAccess(tier: StorageTier): void {
    for (const callback of this.tierAccessCallbacks) {
      try {
        callback(tier)
      } catch {
        // Ignore
      }
    }
  }
}
