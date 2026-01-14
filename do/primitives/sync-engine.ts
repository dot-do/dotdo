/**
 * SyncEngine - Bidirectional Data Synchronization Primitive
 *
 * A comprehensive sync engine for bidirectional data synchronization between
 * any two systems. Enables Census/Hightouch-style reverse ETL workflows natively
 * within the dotdo platform.
 *
 * ## Overview
 *
 * SyncEngine orchestrates the full sync lifecycle:
 * 1. Change detection via DiffEngine (added, modified, deleted)
 * 2. Conflict resolution for bidirectional sync scenarios
 * 3. Batched operations with rate limiting
 * 4. Offline support with mutation queuing and reconciliation
 * 5. Full audit trail and progress tracking
 *
 * ## Sync Modes
 *
 * - **Full**: Complete refresh of destination from source
 * - **Incremental**: Only sync changes since last run (based on cursor/timestamp)
 * - **Bidirectional**: Two-way sync with conflict resolution
 * - **Upsert**: Insert or update based on key matching
 *
 * ## Usage Example
 *
 * ```typescript
 * import { SyncEngine, createSyncEngine } from '@dotdo/primitives/sync-engine'
 *
 * const engine = createSyncEngine({
 *   source: {
 *     fetch: async (cursor) => ({ records: await db.query(...), cursor: newCursor }),
 *     name: 'warehouse',
 *   },
 *   destination: {
 *     fetch: async (cursor) => ({ records: await api.list(...), cursor: newCursor }),
 *     push: async (operations) => api.batch(operations),
 *     name: 'salesforce',
 *   },
 *   mode: 'bidirectional',
 *   conflictStrategy: 'last-write-wins',
 *   primaryKey: 'id',
 *   fieldMappings: [
 *     { source: 'user_name', destination: 'Name' },
 *     { source: 'email', destination: 'Email' },
 *   ],
 * })
 *
 * // Run sync
 * const result = await engine.sync()
 *
 * // Or run with progress tracking
 * engine.on('progress', ({ percentage }) => console.log(`${percentage}%`))
 * await engine.sync()
 * ```
 *
 * @module db/primitives/sync-engine
 */

import {
  ConflictDetector,
  createConflictDetector,
  type Conflict,
  type DiffResult,
  type DiffRecord,
  type ConflictResolutionStrategy,
} from './sync/conflict-detector'

import {
  RateLimiter,
  createRateLimiter,
  type RateLimitConfig,
} from './sync/rate-limiter'

import {
  SyncStatus,
  createSyncStatus,
  type SyncProgress,
  type SyncError,
  type SyncStatusState,
} from './sync/sync-status'

import {
  FieldMapper,
  createFieldMapper,
  type FieldMapping,
} from './sync/field-mapper'

import {
  RetryExecutor,
  createRetryExecutor,
  type RetryPolicy,
} from './sync/retry-executor'

// =============================================================================
// TYPES
// =============================================================================

/**
 * A single record in the sync system
 */
export interface SyncRecord {
  /** Unique identifier for the record */
  key: string
  /** Record data */
  data: Record<string, unknown>
  /** When the record was last modified */
  modifiedAt: Date
  /** Optional version for optimistic locking */
  version?: number
  /** Whether this record has been deleted */
  deleted?: boolean
}

/**
 * Result of fetching records from a source/destination
 */
export interface FetchResult {
  /** The fetched records */
  records: SyncRecord[]
  /** Cursor for incremental sync (undefined if no more records) */
  cursor?: string | number
  /** Whether there are more records to fetch */
  hasMore?: boolean
}

/**
 * Operation to apply to a destination
 */
export interface SyncOperation {
  /** Type of operation */
  type: 'insert' | 'update' | 'delete'
  /** Record key */
  key: string
  /** Record data (not present for deletes) */
  data?: Record<string, unknown>
  /** Original record for audit trail */
  originalRecord?: SyncRecord
}

/**
 * Result of pushing operations to a destination
 */
export interface PushResult {
  /** Number of successful operations */
  successCount: number
  /** Number of failed operations */
  failedCount: number
  /** Individual operation results */
  results: Array<{
    key: string
    success: boolean
    error?: string
  }>
}

/**
 * Source/Destination adapter interface
 */
export interface SyncAdapter {
  /** Human-readable name for this adapter */
  name: string

  /**
   * Fetch records from the system
   * @param cursor - Optional cursor for incremental fetching
   * @param since - Optional timestamp for change tracking
   */
  fetch(cursor?: string | number, since?: Date): Promise<FetchResult>

  /**
   * Push operations to the system
   * @param operations - Operations to apply
   */
  push?(operations: SyncOperation[]): Promise<PushResult>

  /**
   * Get the current timestamp from the system (for sync tracking)
   */
  getTimestamp?(): Promise<Date>
}

/**
 * Sync mode configuration
 */
export type SyncMode = 'full' | 'incremental' | 'bidirectional' | 'upsert'

/**
 * Configuration for SyncEngine
 */
export interface SyncEngineConfig {
  /** Source adapter */
  source: SyncAdapter

  /** Destination adapter */
  destination: SyncAdapter

  /** Sync mode */
  mode: SyncMode

  /** Primary key field(s) for matching records */
  primaryKey: string | string[]

  /** Field mappings between source and destination */
  fieldMappings?: FieldMapping[]

  /** Conflict resolution strategy for bidirectional sync */
  conflictStrategy?: ConflictResolutionStrategy

  /** Custom conflict resolver function */
  conflictResolver?: (conflict: Conflict) => SyncRecord | null

  /** Rate limit configuration */
  rateLimit?: RateLimitConfig

  /** Batch size for operations */
  batchSize?: number

  /** Retry policy for failed operations */
  retryPolicy?: RetryPolicy

  /** Enable offline support with mutation queue */
  offlineSupport?: boolean

  /** Persist sync state to this storage */
  stateStorage?: SyncStateStorage

  /** Unique identifier for this sync plan */
  planId?: string
}

/**
 * State to persist across sync sessions
 */
export interface SyncState {
  /** Last successful sync timestamp */
  lastSyncAt?: Date
  /** Source cursor for incremental sync */
  sourceCursor?: string | number
  /** Destination cursor for incremental sync */
  destCursor?: string | number
  /** Pending mutations (for offline support) */
  pendingMutations: SyncOperation[]
  /** Last known txid */
  lastTxid?: number
}

/**
 * Storage interface for persisting sync state
 */
export interface SyncStateStorage {
  load(planId: string): Promise<SyncState | null>
  save(planId: string, state: SyncState): Promise<void>
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Whether the sync completed successfully */
  success: boolean
  /** Sync statistics */
  stats: {
    added: number
    modified: number
    deleted: number
    failed: number
    skipped: number
    conflicts: number
  }
  /** Total duration in milliseconds */
  durationMs: number
  /** Any conflicts that require manual resolution */
  unresolvedConflicts: Conflict[]
  /** Error if sync failed */
  error?: SyncError
}

/**
 * Events emitted by SyncEngine
 */
export interface SyncEngineEvents {
  started: { planId: string; mode: SyncMode }
  progress: { percentage: number; processed: number; total: number }
  conflict: { conflict: Conflict; resolution: ConflictResolutionStrategy | 'pending' }
  batchComplete: { batchNumber: number; results: PushResult }
  completed: { result: SyncResult }
  error: { error: SyncError }
  stateChange: { previousState: SyncStatusState; currentState: SyncStatusState }
}

/**
 * Event handler type
 */
type EventHandler<T> = (data: T) => void

// =============================================================================
// DIFF ENGINE
// =============================================================================

/**
 * DiffEngine calculates changes between source and destination
 */
export class DiffEngine {
  private readonly primaryKey: string | string[]

  constructor(primaryKey: string | string[]) {
    this.primaryKey = primaryKey
  }

  /**
   * Get the composite key for a record
   */
  getKey(record: SyncRecord): string {
    if (Array.isArray(this.primaryKey)) {
      return this.primaryKey
        .map((k) => String(record.data[k] ?? record.key))
        .join(':')
    }
    return String(record.data[this.primaryKey] ?? record.key)
  }

  /**
   * Calculate full diff between source and destination
   */
  diff(source: SyncRecord[], destination: SyncRecord[]): DiffResult {
    const sourceMap = new Map<string, SyncRecord>()
    const destMap = new Map<string, SyncRecord>()

    for (const record of source) {
      sourceMap.set(this.getKey(record), record)
    }
    for (const record of destination) {
      destMap.set(this.getKey(record), record)
    }

    const added: DiffRecord[] = []
    const modified: DiffRecord[] = []
    const deleted: string[] = []

    // Find added and modified records (in source but not/different in dest)
    for (const [key, srcRecord] of sourceMap) {
      const destRecord = destMap.get(key)

      if (!destRecord) {
        // New record
        added.push({
          key,
          data: srcRecord.data,
          modifiedAt: srcRecord.modifiedAt,
        })
      } else if (!this.recordsEqual(srcRecord, destRecord)) {
        // Modified record
        modified.push({
          key,
          data: srcRecord.data,
          modifiedAt: srcRecord.modifiedAt,
        })
      }
    }

    // Find deleted records (in dest but not in source)
    for (const key of destMap.keys()) {
      if (!sourceMap.has(key)) {
        deleted.push(key)
      }
    }

    return { added, modified, deleted }
  }

  /**
   * Calculate incremental diff based on changed records only
   */
  diffIncremental(
    sourceChanges: SyncRecord[],
    destChanges: SyncRecord[],
    since: Date
  ): { sourceDiff: DiffResult; destDiff: DiffResult } {
    // Filter to only records changed since the timestamp
    const sourceChanged = sourceChanges.filter(
      (r) => r.modifiedAt >= since || r.deleted
    )
    const destChanged = destChanges.filter(
      (r) => r.modifiedAt >= since || r.deleted
    )

    const sourceDiff = this.buildDiffFromChanges(sourceChanged)
    const destDiff = this.buildDiffFromChanges(destChanged)

    return { sourceDiff, destDiff }
  }

  /**
   * Build diff result from changed records
   */
  private buildDiffFromChanges(changes: SyncRecord[]): DiffResult {
    const added: DiffRecord[] = []
    const modified: DiffRecord[] = []
    const deleted: string[] = []

    for (const record of changes) {
      const key = this.getKey(record)

      if (record.deleted) {
        deleted.push(key)
      } else {
        // We can't distinguish add vs modify without baseline,
        // so we treat all non-deleted changes as modified
        modified.push({
          key,
          data: record.data,
          modifiedAt: record.modifiedAt,
        })
      }
    }

    return { added, modified, deleted }
  }

  /**
   * Check if two records have the same data (excluding metadata)
   */
  private recordsEqual(a: SyncRecord, b: SyncRecord): boolean {
    const aJson = JSON.stringify(this.normalizeData(a.data))
    const bJson = JSON.stringify(this.normalizeData(b.data))
    return aJson === bJson
  }

  /**
   * Normalize data for comparison (sort keys, handle dates)
   */
  private normalizeData(data: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {}
    const keys = Object.keys(data).sort()

    for (const key of keys) {
      const value = data[key]
      if (value instanceof Date) {
        normalized[key] = value.toISOString()
      } else if (typeof value === 'object' && value !== null) {
        normalized[key] = this.normalizeData(value as Record<string, unknown>)
      } else {
        normalized[key] = value
      }
    }

    return normalized
  }
}

// =============================================================================
// CONFLICT RESOLVER
// =============================================================================

/**
 * ConflictResolver handles conflict resolution for bidirectional sync
 */
export class ConflictResolver {
  private readonly strategy: ConflictResolutionStrategy
  private readonly customResolver?: (conflict: Conflict) => SyncRecord | null

  constructor(
    strategy: ConflictResolutionStrategy = 'last-write-wins',
    customResolver?: (conflict: Conflict) => SyncRecord | null
  ) {
    this.strategy = strategy
    this.customResolver = customResolver
  }

  /**
   * Resolve a conflict and return the winning record
   */
  resolve(conflict: Conflict): SyncRecord | null {
    // Try custom resolver first
    if (this.customResolver) {
      const result = this.customResolver(conflict)
      if (result !== undefined) {
        return result
      }
    }

    switch (this.strategy) {
      case 'source-wins':
        return this.toSyncRecord(conflict.sourceRecord)

      case 'destination-wins':
        return this.toSyncRecord(conflict.destinationRecord)

      case 'last-write-wins': {
        const sourceTime = conflict.sourceModifiedAt?.getTime() ?? 0
        const destTime = conflict.destinationModifiedAt?.getTime() ?? 0
        return sourceTime >= destTime
          ? this.toSyncRecord(conflict.sourceRecord)
          : this.toSyncRecord(conflict.destinationRecord)
      }

      case 'first-write-wins': {
        const sourceTime = conflict.sourceModifiedAt?.getTime() ?? Infinity
        const destTime = conflict.destinationModifiedAt?.getTime() ?? Infinity
        return sourceTime <= destTime
          ? this.toSyncRecord(conflict.sourceRecord)
          : this.toSyncRecord(conflict.destinationRecord)
      }

      case 'manual':
      default:
        // Return null to indicate manual resolution needed
        return null
    }
  }

  /**
   * Resolve all conflicts in a batch
   */
  resolveAll(conflicts: Conflict[]): {
    resolved: Array<{ conflict: Conflict; winner: SyncRecord }>
    unresolved: Conflict[]
  } {
    const resolved: Array<{ conflict: Conflict; winner: SyncRecord }> = []
    const unresolved: Conflict[] = []

    for (const conflict of conflicts) {
      const winner = this.resolve(conflict)
      if (winner) {
        resolved.push({ conflict, winner })
      } else {
        unresolved.push(conflict)
      }
    }

    return { resolved, unresolved }
  }

  /**
   * Convert DiffRecord to SyncRecord
   */
  private toSyncRecord(diffRecord: DiffRecord | null): SyncRecord | null {
    if (!diffRecord) return null

    return {
      key: diffRecord.key,
      data: diffRecord.data,
      modifiedAt: diffRecord.modifiedAt,
    }
  }
}

// =============================================================================
// BATCH PROCESSOR
// =============================================================================

/**
 * BatchProcessor handles batched operations with rate limiting
 */
export class BatchProcessor {
  private readonly batchSize: number
  private readonly rateLimiter: RateLimiter | null
  private readonly retryExecutor: RetryExecutor | null

  constructor(config: {
    batchSize?: number
    rateLimit?: RateLimitConfig
    retryPolicy?: RetryPolicy
  }) {
    this.batchSize = config.batchSize ?? 100
    this.rateLimiter = config.rateLimit
      ? createRateLimiter(config.rateLimit)
      : null
    this.retryExecutor = config.retryPolicy
      ? createRetryExecutor({ policy: config.retryPolicy })
      : null
  }

  /**
   * Process operations in batches
   */
  async process(
    operations: SyncOperation[],
    pushFn: (ops: SyncOperation[]) => Promise<PushResult>,
    onBatchComplete?: (batchNumber: number, result: PushResult) => void
  ): Promise<PushResult> {
    const batches = this.splitIntoBatches(operations)
    let totalSuccess = 0
    let totalFailed = 0
    const allResults: PushResult['results'] = []

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]

      // Rate limit if configured
      if (this.rateLimiter) {
        await this.rateLimiter.acquire()
      }

      // Execute with retry if configured
      let result: PushResult
      if (this.retryExecutor) {
        const execResult = await this.retryExecutor.execute(
          async () => pushFn(batch),
          { id: `batch-${i}` }
        )
        result = execResult.result ?? {
          successCount: 0,
          failedCount: batch.length,
          results: batch.map((op) => ({
            key: op.key,
            success: false,
            error: execResult.error?.message,
          })),
        }
      } else {
        try {
          result = await pushFn(batch)
        } catch (error) {
          result = {
            successCount: 0,
            failedCount: batch.length,
            results: batch.map((op) => ({
              key: op.key,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            })),
          }
        }
      }

      totalSuccess += result.successCount
      totalFailed += result.failedCount
      allResults.push(...result.results)

      onBatchComplete?.(i + 1, result)
    }

    return {
      successCount: totalSuccess,
      failedCount: totalFailed,
      results: allResults,
    }
  }

  /**
   * Split operations into batches
   */
  private splitIntoBatches(operations: SyncOperation[]): SyncOperation[][] {
    const batches: SyncOperation[][] = []

    for (let i = 0; i < operations.length; i += this.batchSize) {
      batches.push(operations.slice(i, i + this.batchSize))
    }

    return batches
  }
}

// =============================================================================
// OFFLINE SUPPORT
// =============================================================================

/**
 * OfflineManager handles offline mutation queuing and reconciliation
 */
export class OfflineManager {
  private pendingMutations: SyncOperation[] = []
  private readonly storage: SyncStateStorage | null
  private readonly planId: string

  constructor(config: {
    storage?: SyncStateStorage
    planId: string
  }) {
    this.storage = config.storage ?? null
    this.planId = config.planId
  }

  /**
   * Queue a mutation for later sync
   */
  queueMutation(operation: SyncOperation): void {
    this.pendingMutations.push(operation)
    this.persistState().catch(() => {
      // Silent fail on persist
    })
  }

  /**
   * Get all pending mutations
   */
  getPendingMutations(): SyncOperation[] {
    return [...this.pendingMutations]
  }

  /**
   * Clear pending mutations after successful sync
   */
  clearPendingMutations(keys?: string[]): void {
    if (keys) {
      this.pendingMutations = this.pendingMutations.filter(
        (m) => !keys.includes(m.key)
      )
    } else {
      this.pendingMutations = []
    }
    this.persistState().catch(() => {
      // Silent fail on persist
    })
  }

  /**
   * Load state from storage
   */
  async loadState(): Promise<SyncState | null> {
    if (!this.storage) return null
    const state = await this.storage.load(this.planId)
    if (state) {
      this.pendingMutations = state.pendingMutations ?? []
    }
    return state
  }

  /**
   * Save state to storage
   */
  async saveState(state: Partial<SyncState>): Promise<void> {
    if (!this.storage) return
    const fullState: SyncState = {
      ...state,
      pendingMutations: this.pendingMutations,
    }
    await this.storage.save(this.planId, fullState)
  }

  /**
   * Persist current state
   */
  private async persistState(): Promise<void> {
    if (!this.storage) return
    const currentState = await this.storage.load(this.planId)
    await this.storage.save(this.planId, {
      ...currentState,
      pendingMutations: this.pendingMutations,
    })
  }

  /**
   * Reconcile pending mutations with remote state
   *
   * @param remoteRecords - Current remote state
   * @returns Operations that still need to be applied
   */
  reconcile(remoteRecords: SyncRecord[]): SyncOperation[] {
    const remoteMap = new Map<string, SyncRecord>()
    for (const record of remoteRecords) {
      remoteMap.set(record.key, record)
    }

    const reconciledOps: SyncOperation[] = []

    for (const mutation of this.pendingMutations) {
      const remoteRecord = remoteMap.get(mutation.key)

      if (mutation.type === 'delete') {
        // Delete is still needed if record exists remotely
        if (remoteRecord && !remoteRecord.deleted) {
          reconciledOps.push(mutation)
        }
      } else if (mutation.type === 'insert') {
        // Insert becomes update if record already exists
        if (remoteRecord) {
          reconciledOps.push({
            ...mutation,
            type: 'update',
          })
        } else {
          reconciledOps.push(mutation)
        }
      } else {
        // Update is needed if data differs
        if (remoteRecord) {
          const mutationJson = JSON.stringify(mutation.data)
          const remoteJson = JSON.stringify(remoteRecord.data)
          if (mutationJson !== remoteJson) {
            reconciledOps.push(mutation)
          }
        }
        // If record doesn't exist remotely, skip the update
      }
    }

    return reconciledOps
  }
}

// =============================================================================
// SYNC ENGINE
// =============================================================================

/**
 * SyncEngine orchestrates bidirectional data synchronization
 */
export class SyncEngine {
  private readonly config: SyncEngineConfig
  private readonly diffEngine: DiffEngine
  private readonly conflictDetector: ConflictDetector
  private readonly conflictResolver: ConflictResolver
  private readonly batchProcessor: BatchProcessor
  private readonly fieldMapper: FieldMapper | null
  private readonly offlineManager: OfflineManager
  private readonly status: SyncStatus

  private readonly handlers = new Map<string, Set<EventHandler<unknown>>>()
  private isRunning = false

  constructor(config: SyncEngineConfig) {
    this.config = config

    // Initialize components
    this.diffEngine = new DiffEngine(config.primaryKey)

    this.conflictDetector = createConflictDetector({
      defaultStrategy: config.conflictStrategy ?? 'last-write-wins',
    })

    this.conflictResolver = new ConflictResolver(
      config.conflictStrategy,
      config.conflictResolver
    )

    this.batchProcessor = new BatchProcessor({
      batchSize: config.batchSize,
      rateLimit: config.rateLimit,
      retryPolicy: config.retryPolicy,
    })

    this.fieldMapper = config.fieldMappings
      ? createFieldMapper({ mappings: config.fieldMappings })
      : null

    this.offlineManager = new OfflineManager({
      storage: config.stateStorage,
      planId: config.planId ?? `sync-${Date.now()}`,
    })

    this.status = createSyncStatus({
      planId: config.planId ?? `sync-${Date.now()}`,
    })

    // Wire up status events
    this.status.on('stateChange', (event) => {
      this.emit('stateChange', event)
    })
  }

  /**
   * Run the sync operation
   */
  async sync(): Promise<SyncResult> {
    if (this.isRunning) {
      throw new Error('Sync is already running')
    }

    this.isRunning = true
    const startTime = Date.now()

    // Initialize stats
    const stats = {
      added: 0,
      modified: 0,
      deleted: 0,
      failed: 0,
      skipped: 0,
      conflicts: 0,
    }
    const unresolvedConflicts: Conflict[] = []

    try {
      // Emit started event
      this.emit('started', {
        planId: this.config.planId ?? 'default',
        mode: this.config.mode,
      })
      this.status.start()

      // Load any persisted state
      const savedState = await this.offlineManager.loadState()

      // Fetch records based on sync mode
      let sourceRecords: SyncRecord[]
      let destRecords: SyncRecord[]

      if (this.config.mode === 'incremental' && savedState?.lastSyncAt) {
        // Incremental: only fetch changes since last sync
        const sourceResult = await this.config.source.fetch(
          savedState.sourceCursor,
          savedState.lastSyncAt
        )
        const destResult = await this.config.destination.fetch(
          savedState.destCursor,
          savedState.lastSyncAt
        )
        sourceRecords = sourceResult.records
        destRecords = destResult.records
      } else {
        // Full: fetch all records
        sourceRecords = await this.fetchAll(this.config.source)
        destRecords = await this.fetchAll(this.config.destination)
      }

      // Set total for progress tracking
      this.status.setTotalRecords(
        sourceRecords.length + destRecords.length
      )

      // Apply field mappings if configured
      if (this.fieldMapper) {
        sourceRecords = sourceRecords.map((r) => ({
          ...r,
          data: this.fieldMapper!.map(r.data),
        }))
      }

      // Calculate diff
      const sourceDiff = this.diffEngine.diff(sourceRecords, destRecords)

      // Handle based on sync mode
      let operations: SyncOperation[]

      if (this.config.mode === 'bidirectional') {
        // For bidirectional, also calculate reverse diff
        const destDiff = this.diffEngine.diff(destRecords, sourceRecords)

        // Detect conflicts
        const conflicts = this.conflictDetector.detect(sourceDiff, destDiff)
        stats.conflicts = conflicts.length

        // Resolve conflicts
        const { resolved, unresolved } =
          this.conflictResolver.resolveAll(conflicts)
        unresolvedConflicts.push(...unresolved)

        // Emit conflict events
        for (const conflict of conflicts) {
          const resolution = resolved.find((r) => r.conflict === conflict)
          this.emit('conflict', {
            conflict,
            resolution: resolution ? this.config.conflictStrategy ?? 'last-write-wins' : 'pending',
          })
        }

        // Build operations from resolved conflicts and non-conflicting changes
        operations = this.buildBidirectionalOperations(
          sourceDiff,
          destDiff,
          resolved
        )
      } else {
        // Unidirectional: source -> destination
        operations = this.buildUnidirectionalOperations(sourceDiff)
      }

      // Reconcile with any pending offline mutations
      if (this.config.offlineSupport) {
        const pendingOps = this.offlineManager.getPendingMutations()
        if (pendingOps.length > 0) {
          const reconciledOps = this.offlineManager.reconcile(destRecords)
          operations = this.mergeOperations(operations, reconciledOps)
        }
      }

      // Process operations in batches
      if (operations.length > 0 && this.config.destination.push) {
        const result = await this.batchProcessor.process(
          operations,
          async (ops) => this.config.destination.push!(ops),
          (batchNumber, batchResult) => {
            this.emit('batchComplete', { batchNumber, results: batchResult })

            // Update progress
            const processed = batchNumber * (this.config.batchSize ?? 100)
            this.emit('progress', {
              percentage: Math.min(
                100,
                Math.round((processed / operations.length) * 100)
              ),
              processed,
              total: operations.length,
            })
          }
        )

        // Update stats from result
        for (const op of operations) {
          const opResult = result.results.find((r) => r.key === op.key)
          if (opResult?.success) {
            switch (op.type) {
              case 'insert':
                stats.added++
                this.status.recordProcessed('added')
                break
              case 'update':
                stats.modified++
                this.status.recordProcessed('modified')
                break
              case 'delete':
                stats.deleted++
                this.status.recordProcessed('deleted')
                break
            }
          } else {
            stats.failed++
            this.status.recordProcessed('failed')
          }
        }

        // Clear successful pending mutations
        if (this.config.offlineSupport) {
          const successKeys = result.results
            .filter((r) => r.success)
            .map((r) => r.key)
          this.offlineManager.clearPendingMutations(successKeys)
        }
      }

      // Save state for next incremental sync
      await this.offlineManager.saveState({
        lastSyncAt: new Date(),
        sourceCursor: undefined, // Could track cursor from fetch
        destCursor: undefined,
      })

      // Complete status
      this.status.complete()

      const result: SyncResult = {
        success: stats.failed === 0 && unresolvedConflicts.length === 0,
        stats,
        durationMs: Date.now() - startTime,
        unresolvedConflicts,
      }

      this.emit('completed', { result })
      return result
    } catch (error) {
      const syncError: SyncError = {
        code: 'SYNC_ERROR',
        message: error instanceof Error ? error.message : String(error),
        details: { stack: error instanceof Error ? error.stack : undefined },
      }

      this.status.fail(syncError)
      this.emit('error', { error: syncError })

      return {
        success: false,
        stats,
        durationMs: Date.now() - startTime,
        unresolvedConflicts,
        error: syncError,
      }
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Queue a mutation for offline sync
   */
  queueMutation(operation: SyncOperation): void {
    if (!this.config.offlineSupport) {
      throw new Error('Offline support is not enabled')
    }
    this.offlineManager.queueMutation(operation)
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return this.status
  }

  /**
   * Check if sync is currently running
   */
  isSyncing(): boolean {
    return this.isRunning
  }

  /**
   * Add an event listener
   */
  on<K extends keyof SyncEngineEvents>(
    event: K,
    handler: EventHandler<SyncEngineEvents[K]>
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>)

    return () => {
      const handlers = this.handlers.get(event)
      if (handlers) {
        handlers.delete(handler as EventHandler<unknown>)
      }
    }
  }

  /**
   * Remove all event listeners
   */
  removeAllListeners(event?: keyof SyncEngineEvents): void {
    if (event) {
      this.handlers.delete(event)
    } else {
      this.handlers.clear()
    }
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Emit an event
   */
  private emit<K extends keyof SyncEngineEvents>(
    event: K,
    data: SyncEngineEvents[K]
  ): void {
    const handlers = this.handlers.get(event)
    if (!handlers) return

    for (const handler of handlers) {
      try {
        handler(data)
      } catch (error) {
        console.error(`Error in SyncEngine event handler for '${event}':`, error)
      }
    }
  }

  /**
   * Fetch all records from an adapter (handles pagination)
   */
  private async fetchAll(adapter: SyncAdapter): Promise<SyncRecord[]> {
    const allRecords: SyncRecord[] = []
    let cursor: string | number | undefined

    do {
      const result = await adapter.fetch(cursor)
      allRecords.push(...result.records)
      cursor = result.hasMore ? result.cursor : undefined
    } while (cursor !== undefined)

    return allRecords
  }

  /**
   * Build operations for unidirectional sync
   */
  private buildUnidirectionalOperations(diff: DiffResult): SyncOperation[] {
    const operations: SyncOperation[] = []

    for (const record of diff.added) {
      operations.push({
        type: 'insert',
        key: record.key,
        data: record.data,
      })
    }

    for (const record of diff.modified) {
      operations.push({
        type: 'update',
        key: record.key,
        data: record.data,
      })
    }

    for (const key of diff.deleted) {
      operations.push({
        type: 'delete',
        key,
      })
    }

    return operations
  }

  /**
   * Build operations for bidirectional sync
   */
  private buildBidirectionalOperations(
    sourceDiff: DiffResult,
    _destDiff: DiffResult,
    resolvedConflicts: Array<{ conflict: Conflict; winner: SyncRecord }>
  ): SyncOperation[] {
    const operations: SyncOperation[] = []
    const conflictKeys = new Set(resolvedConflicts.map((r) => r.conflict.key))

    // Add non-conflicting source changes to destination
    for (const record of sourceDiff.added) {
      if (!conflictKeys.has(record.key)) {
        operations.push({
          type: 'insert',
          key: record.key,
          data: record.data,
        })
      }
    }

    for (const record of sourceDiff.modified) {
      if (!conflictKeys.has(record.key)) {
        operations.push({
          type: 'update',
          key: record.key,
          data: record.data,
        })
      }
    }

    for (const key of sourceDiff.deleted) {
      if (!conflictKeys.has(key)) {
        operations.push({
          type: 'delete',
          key,
        })
      }
    }

    // Add resolved conflict winners
    for (const { conflict, winner } of resolvedConflicts) {
      // Determine if this is an insert or update based on whether
      // the destination has the record
      const isDestDeleted = conflict.destinationRecord === null
      operations.push({
        type: isDestDeleted ? 'insert' : 'update',
        key: conflict.key,
        data: winner.data,
      })
    }

    return operations
  }

  /**
   * Merge offline pending operations with calculated operations
   */
  private mergeOperations(
    calculated: SyncOperation[],
    pending: SyncOperation[]
  ): SyncOperation[] {
    const merged = new Map<string, SyncOperation>()

    // Add calculated operations first
    for (const op of calculated) {
      merged.set(op.key, op)
    }

    // Override with pending operations (they are more recent)
    for (const op of pending) {
      merged.set(op.key, op)
    }

    return Array.from(merged.values())
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new SyncEngine instance
 *
 * @param config - SyncEngine configuration
 * @returns A new SyncEngine instance
 *
 * @example
 * ```typescript
 * const engine = createSyncEngine({
 *   source: { name: 'db', fetch: async () => ({ records: [] }) },
 *   destination: { name: 'api', fetch: async () => ({ records: [] }), push: async () => ({ successCount: 0, failedCount: 0, results: [] }) },
 *   mode: 'full',
 *   primaryKey: 'id',
 * })
 *
 * const result = await engine.sync()
 * ```
 */
export function createSyncEngine(config: SyncEngineConfig): SyncEngine {
  return new SyncEngine(config)
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

export { DiffEngine, ConflictResolver, BatchProcessor, OfflineManager }
export type {
  ConflictResolutionStrategy,
  Conflict,
  DiffResult,
  DiffRecord,
  RateLimitConfig,
  RetryPolicy,
  FieldMapping,
  SyncProgress,
  SyncError,
  SyncStatusState,
}
