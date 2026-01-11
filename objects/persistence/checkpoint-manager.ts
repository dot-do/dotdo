/**
 * Checkpoint Manager - Full State Snapshots and Recovery Points
 *
 * Provides checkpoint/snapshot functionality for DO state persistence:
 * - Periodic full state snapshots
 * - Crash recovery points
 * - State backup/restore to/from R2
 * - Snapshot retention management
 *
 * @module objects/persistence/checkpoint-manager
 */

import type {
  Checkpoint,
  StateSnapshot,
  CheckpointConfig,
  PersistenceState,
} from './types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Storage interface for checkpoint operations
 */
export interface CheckpointStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
  sql: {
    exec(query: string, ...params: unknown[]): {
      toArray(): unknown[]
      changes?: number
    }
  }
}

/**
 * R2 bucket interface for snapshot storage
 */
export interface R2BucketInterface {
  put(key: string, data: ArrayBuffer | Uint8Array | string, options?: {
    customMetadata?: Record<string, string>
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
export interface CheckpointEnv {
  R2_SNAPSHOTS?: R2BucketInterface
  [key: string]: unknown
}

/**
 * Table data extractor function type
 */
export type TableDataExtractor = (tableName: string) => Promise<unknown[]>

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_MAX_WAL_ENTRIES = 1000
const DEFAULT_SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const DEFAULT_MAX_SNAPSHOTS = 10

const CHECKPOINT_PREFIX = 'checkpoint:'
const SNAPSHOT_PREFIX = 'snapshots/'
const STATE_KEY = 'persistence:state'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}`
}

/**
 * Calculate SHA-256 checksum
 */
async function calculateChecksum(data: Uint8Array): Promise<string> {
  // Create a new ArrayBuffer to avoid SharedArrayBuffer issues
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Compress data using gzip (if available) or return as-is
 */
async function compressData(data: Uint8Array): Promise<Uint8Array> {
  // Check if CompressionStream is available
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
// CHECKPOINT MANAGER CLASS
// ============================================================================

/**
 * Manages checkpoints and snapshots for DO state persistence
 */
export class CheckpointManager {
  private storage: CheckpointStorage
  private env: CheckpointEnv
  private ns: string
  private config: Required<CheckpointConfig>
  private schemaVersion: number
  private walEntriesSinceCheckpoint: number = 0
  private lastCheckpoint: Checkpoint | null = null
  private lastSnapshot: StateSnapshot | null = null
  private checkpointTimer: ReturnType<typeof setInterval> | null = null
  private restoreInProgress: boolean = false
  private tableDataExtractor?: TableDataExtractor
  private tableNames: string[] = ['things', 'relationships', 'actions', 'events']

  constructor(
    storage: CheckpointStorage,
    env: CheckpointEnv,
    ns: string,
    options?: {
      schemaVersion?: number
      config?: CheckpointConfig
      tableDataExtractor?: TableDataExtractor
      tableNames?: string[]
    }
  ) {
    this.storage = storage
    this.env = env
    this.ns = ns
    this.schemaVersion = options?.schemaVersion ?? 1
    this.tableDataExtractor = options?.tableDataExtractor
    if (options?.tableNames) {
      this.tableNames = options.tableNames
    }

    this.config = {
      intervalMs: options?.config?.intervalMs ?? DEFAULT_INTERVAL_MS,
      maxWalEntries: options?.config?.maxWalEntries ?? DEFAULT_MAX_WAL_ENTRIES,
      createSnapshots: options?.config?.createSnapshots ?? false,
      snapshotRetentionMs: options?.config?.snapshotRetentionMs ?? DEFAULT_SNAPSHOT_RETENTION_MS,
      maxSnapshots: options?.config?.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS,
      compressSnapshots: options?.config?.compressSnapshots ?? true,
    }
  }

  /**
   * Configure the checkpoint manager
   */
  configure(config: CheckpointConfig): void {
    this.config = {
      ...this.config,
      ...config,
    }
  }

  /**
   * Start automatic checkpointing
   */
  start(): void {
    if (this.checkpointTimer) return

    this.checkpointTimer = setInterval(async () => {
      if (this.walEntriesSinceCheckpoint > 0) {
        try {
          const walPosition = await this.getCurrentWalPosition()
          await this.createCheckpoint(walPosition)
        } catch (error) {
          console.error('Auto-checkpoint failed:', error)
        }
      }
    }, this.config.intervalMs)
  }

  /**
   * Stop automatic checkpointing
   */
  stop(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer)
      this.checkpointTimer = null
    }
  }

  /**
   * Notify of a new WAL entry (for tracking when to checkpoint)
   */
  onWalEntry(lsn: number): void {
    this.walEntriesSinceCheckpoint++

    // Check if we should auto-checkpoint based on entry count
    if (this.walEntriesSinceCheckpoint >= this.config.maxWalEntries) {
      this.createCheckpoint(lsn).catch(console.error)
    }
  }

  /**
   * Create a new checkpoint
   */
  async createCheckpoint(walPosition: number): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: `cp-${generateId()}`,
      ns: this.ns,
      walPosition,
      schemaVersion: this.schemaVersion,
      createdAt: Date.now(),
      verified: true,
      metadata: undefined,
    }

    // Create snapshot if configured
    if (this.config.createSnapshots) {
      const snapshot = await this.createSnapshot()
      checkpoint.snapshotId = snapshot.id
    }

    // Persist checkpoint
    await this.storage.put(`${CHECKPOINT_PREFIX}${checkpoint.id}`, checkpoint)

    // Update state
    this.lastCheckpoint = checkpoint
    this.walEntriesSinceCheckpoint = 0

    // Save state
    await this.saveState()

    return checkpoint
  }

  /**
   * Get a checkpoint by ID
   */
  async getCheckpoint(id: string): Promise<Checkpoint | null> {
    const checkpoint = await this.storage.get<Checkpoint>(`${CHECKPOINT_PREFIX}${id}`)
    return checkpoint ?? null
  }

  /**
   * Get the latest checkpoint
   */
  async getLatestCheckpoint(): Promise<Checkpoint | null> {
    const checkpoints = await this.getCheckpoints({ order: 'desc', limit: 1 })
    return checkpoints[0] ?? null
  }

  /**
   * Get all checkpoints
   */
  async getCheckpoints(options?: {
    limit?: number
    order?: 'asc' | 'desc'
  }): Promise<Checkpoint[]> {
    const entries = await this.storage.list({ prefix: CHECKPOINT_PREFIX })
    const checkpoints: Checkpoint[] = []

    entries.forEach((value) => {
      if (value && typeof value === 'object') {
        checkpoints.push(value as Checkpoint)
      }
    })

    // Sort by createdAt
    checkpoints.sort((a, b) => {
      const order = options?.order === 'asc' ? 1 : -1
      return order * (a.createdAt - b.createdAt)
    })

    if (options?.limit) {
      return checkpoints.slice(0, options.limit)
    }

    return checkpoints
  }

  /**
   * Get checkpoint for a specific WAL position
   */
  async getCheckpointForWalPosition(lsn: number): Promise<Checkpoint | null> {
    const checkpoints = await this.getCheckpoints({ order: 'desc' })

    for (const cp of checkpoints) {
      if (cp.walPosition <= lsn) {
        return cp
      }
    }

    return null
  }

  /**
   * Delete a checkpoint and its associated snapshot
   */
  async deleteCheckpoint(id: string): Promise<void> {
    const checkpoint = await this.getCheckpoint(id)
    if (!checkpoint) return

    // Delete associated snapshot
    if (checkpoint.snapshotId) {
      await this.deleteSnapshot(checkpoint.snapshotId)
    }

    // Delete checkpoint
    await this.storage.delete(`${CHECKPOINT_PREFIX}${id}`)
  }

  /**
   * Create a full state snapshot
   */
  async createSnapshot(options?: { maxRetries?: number }): Promise<StateSnapshot> {
    const maxRetries = options?.maxRetries ?? 3
    let lastError: Error | undefined

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.createSnapshotInternal()
      } catch (error) {
        lastError = error as Error
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
        }
      }
    }

    throw lastError ?? new Error('Snapshot creation failed')
  }

  private async createSnapshotInternal(): Promise<StateSnapshot> {
    const snapshotId = `snap-${generateId()}`
    const sequence = await this.getNextSnapshotSequence()

    // Collect all table data
    const tableData: Record<string, unknown[]> = {}

    for (const tableName of this.tableNames) {
      if (this.tableDataExtractor) {
        tableData[tableName] = await this.tableDataExtractor(tableName)
      } else {
        tableData[tableName] = await this.getTableData(tableName)
      }
    }

    // Serialize data
    const rawData = JSON.stringify({
      schemaVersion: this.schemaVersion,
      tables: tableData,
      createdAt: Date.now(),
    })

    const encoded = new TextEncoder().encode(rawData)

    // Compress if configured
    const data = this.config.compressSnapshots
      ? await compressData(encoded)
      : encoded

    // Calculate checksum
    const checksum = await calculateChecksum(data)

    const snapshot: StateSnapshot = {
      id: snapshotId,
      ns: this.ns,
      schemaVersion: this.schemaVersion,
      sequence,
      createdAt: Date.now(),
      sizeBytes: data.length,
      checksum,
      data,
    }

    // Store in R2
    const r2Bucket = this.getR2Bucket()
    await r2Bucket.put(`${SNAPSHOT_PREFIX}${snapshotId}.gz`, data, {
      customMetadata: {
        checksum,
        schemaVersion: String(this.schemaVersion),
        createdAt: String(snapshot.createdAt),
        ns: this.ns,
      },
    })

    // Update state
    this.lastSnapshot = snapshot

    // Cleanup old snapshots
    await this.cleanupOldSnapshots()

    return snapshot
  }

  /**
   * Verify a snapshot's checksum
   */
  async verifyChecksum(snapshot: StateSnapshot): Promise<boolean> {
    const calculatedChecksum = await calculateChecksum(snapshot.data)
    return calculatedChecksum === snapshot.checksum
  }

  /**
   * Get a snapshot by ID
   */
  async getSnapshot(id: string): Promise<StateSnapshot | null> {
    const r2Bucket = this.getR2Bucket()

    try {
      const obj = await r2Bucket.get(`${SNAPSHOT_PREFIX}${id}.gz`)
      if (!obj) return null

      const data = await readStream(obj.body)

      return {
        id,
        ns: this.ns,
        schemaVersion: parseInt(obj.customMetadata?.schemaVersion ?? '1'),
        sequence: 0,
        createdAt: parseInt(obj.customMetadata?.createdAt ?? '0'),
        sizeBytes: data.length,
        checksum: obj.customMetadata?.checksum ?? '',
        data,
      }
    } catch {
      return null
    }
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(id: string): Promise<void> {
    const r2Bucket = this.getR2Bucket()
    await r2Bucket.delete(`${SNAPSHOT_PREFIX}${id}.gz`)
  }

  /**
   * Get all snapshots
   */
  async getSnapshots(): Promise<StateSnapshot[]> {
    const r2Bucket = this.getR2Bucket()
    const result = await r2Bucket.list({ prefix: SNAPSHOT_PREFIX })

    const snapshots: StateSnapshot[] = []

    for (const obj of result.objects) {
      const id = obj.key.replace(SNAPSHOT_PREFIX, '').replace('.gz', '')
      const snapshot = await this.getSnapshot(id)
      if (snapshot) {
        snapshots.push(snapshot)
      }
    }

    return snapshots.sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * Restore from a snapshot
   */
  async restoreFromSnapshot(snapshot: StateSnapshot): Promise<void> {
    if (this.restoreInProgress) {
      throw new Error('A restore operation is already in progress')
    }

    this.restoreInProgress = true

    try {
      // Verify checksum
      const isValid = await this.verifyChecksum(snapshot)
      if (!isValid) {
        throw new Error('Snapshot checksum mismatch - data integrity check failed')
      }

      // Check schema version
      if (snapshot.schemaVersion !== this.schemaVersion) {
        throw new Error(
          `Schema version mismatch: snapshot is v${snapshot.schemaVersion}, ` +
          `current is v${this.schemaVersion}. Migration required.`
        )
      }

      // Decompress data
      let rawData = snapshot.data
      if (this.config.compressSnapshots) {
        rawData = await decompressData(snapshot.data)
      }

      // Parse data
      const parsed = JSON.parse(new TextDecoder().decode(rawData))

      // Restore tables
      for (const [tableName, rows] of Object.entries(parsed.tables)) {
        await this.restoreTableData(tableName, rows as unknown[])
      }
    } finally {
      this.restoreInProgress = false
    }
  }

  /**
   * Restore from a snapshot by ID
   */
  async restoreFromSnapshotId(id: string): Promise<void> {
    const snapshot = await this.getSnapshot(id)
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${id}`)
    }

    await this.restoreFromSnapshot(snapshot)
  }

  /**
   * Restore to a checkpoint
   */
  async restoreToCheckpoint(checkpoint: Checkpoint): Promise<void> {
    if (checkpoint.snapshotId) {
      await this.restoreFromSnapshotId(checkpoint.snapshotId)
    }

    // Update WAL position
    await this.storage.put('wal:position', checkpoint.walPosition)
  }

  /**
   * Check if a restore is in progress
   */
  isRestoreInProgress(): boolean {
    return this.restoreInProgress
  }

  /**
   * Get current WAL position
   */
  getWalPosition(): number {
    return this.lastCheckpoint?.walPosition ?? 0
  }

  /**
   * Cleanup old snapshots based on retention policy
   */
  async cleanupOldSnapshots(): Promise<number> {
    const snapshots = await this.getSnapshots()
    const now = Date.now()
    let cleaned = 0

    // Sort by createdAt descending (newest first)
    snapshots.sort((a, b) => b.createdAt - a.createdAt)

    for (let i = 0; i < snapshots.length; i++) {
      const snapshot = snapshots[i]
      const isExpired = now - snapshot.createdAt > this.config.snapshotRetentionMs
      const isBeyondLimit = i >= this.config.maxSnapshots

      // Keep at least one snapshot for recovery
      if (i === 0) continue

      if (isExpired || isBeyondLimit) {
        await this.deleteSnapshot(snapshot.id)
        cleaned++
      }
    }

    return cleaned
  }

  /**
   * Clear all data
   */
  async clearAll(): Promise<void> {
    for (const tableName of this.tableNames) {
      this.storage.sql.exec(`DELETE FROM ${tableName}`)
    }
  }

  /**
   * Get table data
   */
  async getTableData(tableName: string): Promise<unknown[]> {
    const result = this.storage.sql.exec(`SELECT * FROM ${tableName}`)
    return result.toArray()
  }

  /**
   * Restore table data
   */
  private async restoreTableData(tableName: string, rows: unknown[]): Promise<void> {
    // Clear existing data
    this.storage.sql.exec(`DELETE FROM ${tableName}`)

    // Insert restored rows
    for (const row of rows) {
      if (typeof row === 'object' && row !== null) {
        const columns = Object.keys(row)
        const values = Object.values(row)
        const placeholders = columns.map(() => '?').join(', ')

        this.storage.sql.exec(
          `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
          ...values
        )
      }
    }
  }

  /**
   * Get persistence state
   */
  getState(): PersistenceState {
    return {
      schemaVersion: this.schemaVersion,
      lastCheckpoint: this.lastCheckpoint ?? undefined,
      lastSnapshot: this.lastSnapshot ?? undefined,
      walPosition: this.lastCheckpoint?.walPosition ?? 0,
      walEntriesSinceCheckpoint: this.walEntriesSinceCheckpoint,
      appliedMigrations: [],
      pendingMigrations: [],
    }
  }

  /**
   * Save persistence state
   */
  private async saveState(): Promise<void> {
    await this.storage.put(STATE_KEY, this.getState())
  }

  /**
   * Load persistence state
   */
  async loadState(): Promise<void> {
    const state = await this.storage.get<PersistenceState>(STATE_KEY)
    if (state) {
      this.lastCheckpoint = state.lastCheckpoint ?? null
      this.lastSnapshot = state.lastSnapshot ?? null
      this.walEntriesSinceCheckpoint = state.walEntriesSinceCheckpoint
    }
  }

  /**
   * Get the next snapshot sequence number
   */
  private async getNextSnapshotSequence(): Promise<number> {
    const snapshots = await this.getSnapshots()
    if (snapshots.length === 0) return 1
    return Math.max(...snapshots.map(s => s.sequence)) + 1
  }

  /**
   * Get the current WAL position from storage
   */
  private async getCurrentWalPosition(): Promise<number> {
    const result = this.storage.sql.exec('SELECT MAX(lsn) as max_lsn FROM wal')
    const rows = result.toArray() as { max_lsn: number | null }[]
    return rows[0]?.max_lsn ?? 0
  }

  /**
   * Get the R2 bucket for snapshots
   */
  private getR2Bucket(): R2BucketInterface {
    if (!this.env.R2_SNAPSHOTS) {
      throw new Error('R2_SNAPSHOTS bucket binding not found')
    }
    return this.env.R2_SNAPSHOTS
  }
}
