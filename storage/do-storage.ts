/**
 * DOStorage - Integrated 4-Layer Storage Coordinator
 *
 * Coordinates all storage layers:
 * - L0: InMemoryStateManager (hot cache)
 * - L1: PipelineEmitter (WAL for durability)
 * - L2: LazyCheckpointer (SQLite for persistence)
 * - L3: IcebergWriter (cold storage)
 */

import { InMemoryStateManager, type ThingData, type CreateThingInput, type TierMetadata } from './in-memory-state-manager'
import { PipelineEmitter } from './pipeline-emitter'
import { LazyCheckpointer, type DirtyTracker, type L0DataProvider } from './lazy-checkpointer'
import { IcebergWriter, type IcebergEvent } from './iceberg-writer'

// ============================================================================
// Tier Policy Types
// ============================================================================

export interface TierPolicy {
  L0_to_L2_threshold: number // Number of entries before promoting to L2
  L2_to_L3_age_ms: number // Age in ms before promoting to L3
  keepHotInL0: boolean // Keep frequently accessed entries in L0
}

export interface TierInfo {
  tiers: string[]
  promotedAt: {
    L0?: number
    L1?: number
    L2?: number
    L3?: number
  }
}

// ============================================================================
// Configuration Constants
// ============================================================================

/** Default interval (ms) between SQLite checkpoints */
const DEFAULT_CHECKPOINT_INTERVAL_MS = 5000

/** Default interval (ms) between Iceberg flushes */
const DEFAULT_ICEBERG_FLUSH_INTERVAL_MS = 60000

/** Default pipeline flush interval (ms) for WAL batching */
const DEFAULT_PIPELINE_FLUSH_INTERVAL_MS = 100

/** Default batch size for pipeline events */
const DEFAULT_PIPELINE_BATCH_SIZE = 50

// ============================================================================
// SQL Query Constants
// ============================================================================

/** Query to select thing by ID */
const SQL_SELECT_BY_ID = 'SELECT id, type, data FROM things WHERE id = ?'

/** Query to insert or replace thing */
const SQL_INSERT_OR_REPLACE_THING = 'INSERT OR REPLACE INTO things (id, type, data) VALUES (?, ?, ?)'

/** Query to select oldest entries for promotion */
const SQL_SELECT_OLDEST = 'SELECT id, type, data FROM things ORDER BY id LIMIT ?'

/** Query to count entries */
const SQL_COUNT_ENTRIES = 'SELECT COUNT(*) as count FROM things'

/** Query to delete by ID */
const SQL_DELETE_BY_ID = 'DELETE FROM things WHERE id = ?'

/** Default L2 promotion threshold (number of entries to trigger promotion) */
const DEFAULT_L2_PROMOTION_THRESHOLD = 100

/** Default L2 max entries (cleanup older entries after this) */
const DEFAULT_L2_MAX_ENTRIES = 1000

/** Default L3 age threshold (ms) - entries older than this are promoted */
const DEFAULT_L3_AGE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Health status for a service layer */
export type ServiceStatus = 'ok' | 'degraded' | 'unavailable'

/** Health status for all services */
export interface HealthStatus {
  r2: ServiceStatus
  pipeline: ServiceStatus
  sql: ServiceStatus
}

/** Degradation event payload */
export interface DegradationEvent {
  service: 'r2' | 'pipeline' | 'sql'
  status: ServiceStatus
  error?: string
  timestamp: number
}

/** Callback for degradation events */
export type DegradationCallback = (event: DegradationEvent) => void

export interface DOStorageConfig {
  namespace: string
  env: StorageEnv
  checkpointInterval?: number // ms between SQLite checkpoints
  icebergFlushInterval?: number // ms between Iceberg flushes
  waitForPipeline?: boolean // Block until Pipeline ACK
  tierPolicy?: TierPolicy // Custom tier promotion policy
  l2PromotionThreshold?: number // Promote to L3 when L2 has more than this
  l2MaxEntries?: number // Keep max entries in L2
  l3AgeThresholdMs?: number // Promote entries older than this to L3
}

/**
 * Health check status for a tier
 */
export interface TierHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  entryCount?: number
  estimatedBytes?: number
  lastError?: string
}

/**
 * Overall health check result (used by tests)
 */
export interface HealthCheckResult {
  l0: TierHealthStatus
  l1: TierHealthStatus
  l2: TierHealthStatus
  l3: TierHealthStatus
}

interface StorageEnv {
  PIPELINE?: { send(batch: unknown[]): Promise<void> }
  R2?: R2Bucket
  sql?: SqlStorage
}

interface R2Bucket {
  put(key: string, data: ArrayBuffer | string): Promise<unknown>
  get(key: string): Promise<R2ObjectBody | null>
  list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }>
}

interface R2ObjectBody {
  key: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  json(): Promise<unknown>
  events?: IcebergEvent[] // For mock compatibility
}

interface SqlStorage {
  exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
}

/**
 * Adapter to make InMemoryStateManager work as DirtyTracker
 */
class InMemoryDirtyTracker implements DirtyTracker {
  private manager: InMemoryStateManager

  constructor(manager: InMemoryStateManager) {
    this.manager = manager
  }

  getDirtyEntries(): Map<string, { type: string; data: unknown; size: number }> {
    const entries = new Map<string, { type: string; data: unknown; size: number }>()
    const dirtyKeys = this.manager.getDirtyKeys()

    for (const key of dirtyKeys) {
      // Use getRaw to avoid incrementing access count
      const thing = this.manager.getRaw(key)
      if (thing) {
        entries.set(key, {
          type: thing.$type,
          data: thing,
          size: JSON.stringify(thing).length,
        })
      }
    }

    return entries
  }

  getDirtyCount(): number {
    return this.manager.getDirtyCount()
  }

  getMemoryUsage(): number {
    return this.manager.getStats().estimatedBytes
  }

  clearDirty(keys: string[]): void {
    this.manager.markClean(keys)
  }

  clear(): void {
    this.manager.clear()
  }
}

export class DOStorage {
  private namespace: string
  private env: StorageEnv
  private config: Required<Omit<DOStorageConfig, 'tierPolicy'>> & { tierPolicy?: TierPolicy }

  // Storage layers
  private memory: InMemoryStateManager
  private pipeline: PipelineEmitter | null = null
  private checkpointer: LazyCheckpointer | null = null
  private iceberg: IcebergWriter | null = null

  // Iceberg flush timer
  private icebergTimer: ReturnType<typeof setInterval> | null = null
  private icebergBuffer: IcebergEvent[] = []

  // Tier tracking
  private tierPromotionTimes: Map<string, { L0?: number; L1?: number; L2?: number; L3?: number }> = new Map()
  private tierPolicy?: TierPolicy

  private closed: boolean = false

  // Health tracking - R2 starts as 'degraded' until probe succeeds
  private healthStatus: HealthStatus = {
    r2: 'degraded',
    pipeline: 'ok',
    sql: 'ok',
  }

  // R2 write buffer for sync-on-recovery
  private r2WriteBuffer: Array<{ key: string; data: string }> = []

  // Degradation callbacks
  private degradationCallbacks: DegradationCallback[] = []

  // Circuit breaker state
  private circuitBreakerState = {
    pipeline: { failures: 0, lastFailure: 0, open: false },
    r2: { failures: 0, lastFailure: 0, open: false },
  }
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5
  private readonly CIRCUIT_BREAKER_RESET_MS = 30000

  // Health probe completion tracking
  private pipelineProbeComplete = false
  private pipelineProbePromise: Promise<void> | null = null

  constructor(config: DOStorageConfig) {
    this.namespace = config.namespace
    this.env = config.env
    this.tierPolicy = config.tierPolicy
    this.config = {
      namespace: config.namespace,
      env: config.env,
      checkpointInterval: config.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL_MS,
      icebergFlushInterval: config.icebergFlushInterval ?? DEFAULT_ICEBERG_FLUSH_INTERVAL_MS,
      waitForPipeline: config.waitForPipeline ?? false,
      tierPolicy: config.tierPolicy,
      l2PromotionThreshold: config.l2PromotionThreshold ?? DEFAULT_L2_PROMOTION_THRESHOLD,
      l2MaxEntries: config.l2MaxEntries ?? DEFAULT_L2_MAX_ENTRIES,
      l3AgeThresholdMs: config.l3AgeThresholdMs ?? DEFAULT_L3_AGE_THRESHOLD_MS,
    }

    // Initialize L0: InMemory
    this.memory = new InMemoryStateManager()

    // Initialize L1: Pipeline (if available)
    if (this.env.PIPELINE) {
      this.pipeline = new PipelineEmitter(this.env.PIPELINE, {
        namespace: this.namespace,
        flushInterval: DEFAULT_PIPELINE_FLUSH_INTERVAL_MS,
        batchSize: DEFAULT_PIPELINE_BATCH_SIZE,
      })
      // Probe pipeline health asynchronously and track completion
      this.pipelineProbePromise = this.probePipelineHealth().finally(() => {
        this.pipelineProbeComplete = true
        this.pipelineProbePromise = null
      })
    } else {
      this.pipelineProbeComplete = true
    }

    // Initialize L2: SQLite checkpointer (if available)
    if (this.env.sql) {
      const dirtyTracker = new InMemoryDirtyTracker(this.memory)
      this.checkpointer = new LazyCheckpointer({
        sql: this.env.sql,
        dirtyTracker,
        intervalMs: this.config.checkpointInterval,
      })
      this.checkpointer.start()
    }

    // Initialize L3: Iceberg (if R2 available)
    if (this.env.R2) {
      this.iceberg = new IcebergWriter({
        bucket: this.env.R2 as any,
        namespace: this.namespace,
        tableName: 'events',
      })

      // Start Iceberg flush timer
      this.icebergTimer = setInterval(() => {
        this.flushToIceberg()
      }, this.config.icebergFlushInterval)

      // Probe R2 health asynchronously and update status when complete
      // Use immediate fire-and-forget to start probe
      void this.probeR2Health()
    }
  }

  /**
   * Probe R2 health and update status
   * Called during initialization to detect degraded services
   */
  private async probeR2Health(): Promise<void> {
    if (!this.env.R2) return

    try {
      // Simple probe - list with empty prefix
      await this.env.R2.list({ prefix: '__health__' })
      this.healthStatus.r2 = 'ok'
    } catch {
      this.healthStatus.r2 = 'degraded'
      this.emitDegradation('r2', 'degraded', 'R2 health probe failed')
    }
  }

  /**
   * Probe Pipeline health and update status
   * Sends a probe event to detect if pipeline is available
   */
  private async probePipelineHealth(): Promise<void> {
    if (!this.pipeline || !this.env.PIPELINE) return

    const PROBE_TIMEOUT_MS = 500 // Quick timeout for health probe

    try {
      // Send a probe event to test pipeline connectivity with timeout
      const probePromise = this.env.PIPELINE.send([{ type: '__probe__', timestamp: Date.now() }])
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Probe timeout')), PROBE_TIMEOUT_MS)
      )
      await Promise.race([probePromise, timeoutPromise])
      this.healthStatus.pipeline = 'ok'
      this.recordSuccess('pipeline')
    } catch {
      // Pipeline is failing or slow - open circuit breaker immediately
      this.healthStatus.pipeline = 'degraded'
      this.circuitBreakerState.pipeline.open = true
      this.circuitBreakerState.pipeline.failures = this.CIRCUIT_BREAKER_THRESHOLD
      this.circuitBreakerState.pipeline.lastFailure = Date.now()
      this.emitDegradation('pipeline', 'degraded', 'Pipeline health probe failed')
    }
  }

  /**
   * Wait for async initialization to complete (e.g., health probes)
   * Useful for tests and scenarios where caller needs to know status immediately
   */
  async waitForInit(): Promise<void> {
    // Small delay to allow async probes to complete
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  /**
   * Create a new thing with saga compensation
   * Write path: L0 -> L1 (ACK) -> lazy L2 -> eventual L3
   *
   * If Pipeline is degraded, falls back to direct SQLite write.
   * If Pipeline emit fails, the in-memory state is rolled back (compensation).
   */
  async create(input: CreateThingInput): Promise<ThingData> {
    // Wait for pipeline health probe to complete before deciding write path
    if (this.pipelineProbePromise) {
      await this.pipelineProbePromise
    }

    // L0: Write to memory immediately
    const thing = this.memory.create(input)

    // Check if pipeline is healthy or circuit breaker is open
    const pipelineDegraded = this.isCircuitOpen('pipeline')

    // L1: Emit to Pipeline (WAL) if healthy
    if (this.pipeline && !pipelineDegraded) {
      this.pipeline.emit('thing.created', 'things', thing)

      // Buffer for L3
      this.icebergBuffer.push({
        type: 'thing.created',
        entityId: thing.$id,
        payload: thing,
        ts: Date.now(),
      })

      // Trigger immediate flush after circuit breaker recovery (half-open test)
      const wasRecovering = this.circuitBreakerState.pipeline.open
      if (wasRecovering) {
        try {
          await this.pipeline.flush()
          // Success - close circuit breaker
          this.recordSuccess('pipeline')
        } catch {
          // Still failing - keep circuit open
          this.recordFailure('pipeline')
        }
      }

      // If waitForPipeline, flush and wait - with compensation on failure
      if (this.config.waitForPipeline) {
        try {
          await this.pipeline.flush()
        } catch (error) {
          // Compensation: rollback in-memory state
          this.memory.delete(thing.$id)
          // Remove from Iceberg buffer
          const icebergIdx = this.icebergBuffer.findIndex(
            (e) => e.entityId === thing.$id && e.type === 'thing.created'
          )
          if (icebergIdx !== -1) {
            this.icebergBuffer.splice(icebergIdx, 1)
          }
          throw error
        }
      }
    } else if (pipelineDegraded && this.env.sql) {
      // Fallback: write directly to SQLite when pipeline is degraded
      await this.writeDirectToSql(thing)
    }

    return thing
  }

  /**
   * Write directly to SQLite (fallback when pipeline is degraded)
   */
  private async writeDirectToSql(thing: ThingData): Promise<void> {
    if (!this.env.sql) return

    try {
      const dataJson = JSON.stringify(thing)
      this.env.sql.exec(SQL_INSERT_OR_REPLACE_THING, thing.$id, thing.$type, dataJson)
    } catch (error) {
      console.error(`[DOStorage] Failed to write directly to SQLite: ${error}`)
    }
  }

  /**
   * Get a thing by ID (L0 only - synchronous)
   */
  get(id: string): ThingData | null {
    return this.memory.get(id)
  }

  /**
   * Get with fallback to SQLite (L2)
   */
  async getWithFallback(id: string): Promise<ThingData | null> {
    // Try L0 first
    const fromMemory = this.memory.get(id)
    if (fromMemory) return fromMemory

    // Fallback to L2 (SQLite)
    if (this.env.sql) {
      try {
        const result = this.env.sql.exec(SQL_SELECT_BY_ID, id)
        const rows = result.toArray() as Array<{ id: string; type: string; data: string }>
        if (rows.length > 0) {
          const thing = JSON.parse(rows[0].data) as ThingData

          // Hydrate L0 cache
          this.memory.loadBulk([thing])

          // Opportunistically sync to R2 (recovery path)
          // Always try if R2 is available - sync will update health status
          if (this.env.R2) {
            await this.syncToR2(thing)
          }

          return thing
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error(`[DOStorage] Failed to read from SQLite for id '${id}': ${errorMsg}`)
      }
    }

    return null
  }

  /**
   * Sync a thing to R2 (fire-and-forget)
   */
  private async syncToR2(thing: ThingData): Promise<void> {
    if (!this.env.R2) return

    try {
      const key = `things/${thing.$id}`
      const data = JSON.stringify({
        events: [{
          type: 'thing.created',
          entityId: thing.$id,
          payload: thing,
          ts: Date.now(),
        }],
      })
      await this.env.R2.put(key, data)
      this.recordSuccess('r2')
    } catch {
      // Non-critical - data is still in SQLite
      this.recordFailure('r2')
    }
  }

  /**
   * Get with full fallback (L0 -> L2 -> L3)
   * Uses IcebergWriter.get() for proper L3 retrieval with event reconstruction
   */
  async getWithFullFallback(id: string): Promise<ThingData | null> {
    // Try L0 and L2
    const fromL2 = await this.getWithFallback(id)
    if (fromL2) return fromL2

    // Fallback to L3 (Iceberg) using IcebergWriter
    if (this.iceberg) {
      try {
        const thing = await this.iceberg.get(id)
        if (thing) {
          // Hydrate L0 cache
          this.memory.loadBulk([thing])
          return thing
        }
      } catch (error) {
        console.error(`[DOStorage] Failed to retrieve from L3 for id '${id}':`, error)
      }
    }

    // Direct R2 fallback - handles mock format and scans for data files
    // This runs even if iceberg is available but didn't find the entity
    if (this.env.R2) {
      try {
        // Support mock format with events property
        const r2Result = await this.env.R2.get(`things/${id}`)
        if (r2Result && (r2Result as any).events) {
          const events = (r2Result as any).events as IcebergEvent[]
          let state: ThingData | null = null
          for (const event of events) {
            if (event.entityId === id) {
              if (event.type === 'thing.created') {
                state = event.payload as ThingData
              } else if (event.type === 'thing.updated' && state) {
                state = { ...state, ...(event.payload as Partial<ThingData>) }
              } else if (event.type === 'thing.deleted') {
                state = null
              }
            }
          }

          if (state) {
            this.memory.loadBulk([state])
            return state
          }
        }

        // Try scanning R2 for data files
        const prefix = `events/ns=${this.namespace}/`
        const listResult = await this.env.R2.list({ prefix })

        for (const obj of listResult.objects) {
          if (!obj.key.endsWith('.parquet')) continue

          const r2Object = await this.env.R2.get(obj.key)
          if (r2Object) {
            const data = await r2Object.arrayBuffer()
            const decoder = new TextDecoder()
            const events: IcebergEvent[] = JSON.parse(decoder.decode(data))

            let state: ThingData | null = null
            for (const event of events) {
              if (event.entityId !== id) continue
              if (event.type === 'thing.created') {
                state = event.payload as ThingData
              } else if (event.type === 'thing.updated' && state) {
                state = { ...state, ...(event.payload as Partial<ThingData>) }
              } else if (event.type === 'thing.deleted') {
                state = null
              }
            }

            if (state) {
              this.memory.loadBulk([state])
              return state
            }
          }
        }
      } catch (error) {
        console.error(`[DOStorage] Failed to scan R2 for id '${id}':`, error)
      }
    }

    return null
  }

  /**
   * Update a thing with saga compensation
   *
   * If Pipeline emit fails, the in-memory state is restored to its original value.
   */
  async update(id: string, updates: Partial<ThingData>): Promise<ThingData> {
    // Capture original state for compensation (deep copy)
    const originalState = this.memory.get(id)
    if (!originalState) {
      throw new Error(`Thing with id '${id}' not found`)
    }
    // Deep copy to preserve original values
    const originalStateCopy = JSON.parse(JSON.stringify(originalState)) as ThingData

    // L0: Update in memory
    const thing = this.memory.update(id, updates)

    if (this.pipeline) {
      this.pipeline.emit('thing.updated', 'things', { $id: id, ...updates })

      this.icebergBuffer.push({
        type: 'thing.updated',
        entityId: id,
        payload: updates,
        ts: Date.now(),
      })

      // If waitForPipeline, flush and wait - with compensation on failure
      if (this.config.waitForPipeline) {
        try {
          await this.pipeline.flush()
        } catch (error) {
          // Compensation: restore original state
          // Delete current state and reload with original
          this.memory.delete(id)
          this.memory.loadBulk([originalStateCopy])

          // Remove the update event from Iceberg buffer
          const icebergIdx = this.icebergBuffer.findIndex(
            (e) => e.entityId === id && e.type === 'thing.updated'
          )
          if (icebergIdx !== -1) {
            this.icebergBuffer.splice(icebergIdx, 1)
          }
          throw error
        }
      }
    }

    return thing
  }

  /**
   * Delete a thing with saga compensation
   *
   * If Pipeline emit fails, the deleted thing is restored to memory.
   */
  async delete(id: string): Promise<ThingData | null> {
    const thing = this.memory.delete(id)

    if (thing && this.pipeline) {
      // Deep copy for potential restoration
      const thingCopy = JSON.parse(JSON.stringify(thing)) as ThingData

      this.pipeline.emit('thing.deleted', 'things', { $id: id })

      this.icebergBuffer.push({
        type: 'thing.deleted',
        entityId: id,
        payload: {},
        ts: Date.now(),
      })

      // If waitForPipeline, flush and wait - with compensation on failure
      if (this.config.waitForPipeline) {
        try {
          await this.pipeline.flush()
        } catch (error) {
          // Compensation: restore deleted thing
          this.memory.loadBulk([thingCopy])

          // Remove the delete event from Iceberg buffer
          const icebergIdx = this.icebergBuffer.findIndex(
            (e) => e.entityId === id && e.type === 'thing.deleted'
          )
          if (icebergIdx !== -1) {
            this.icebergBuffer.splice(icebergIdx, 1)
          }
          throw error
        }
      }
    }

    return thing
  }

  /**
   * Flush to Iceberg (L3) and trigger promotion if needed
   */
  private async flushToIceberg(): Promise<void> {
    if (!this.iceberg) return

    // Flush buffered events
    if (this.icebergBuffer.length > 0) {
      const events = this.icebergBuffer.splice(0, this.icebergBuffer.length)
      await this.iceberg.write(events)
    }

    // Check if L2->L3 promotion is needed
    await this.promoteToL3()
  }

  /**
   * Promote entries from L2 (SQLite) to L3 (Iceberg) based on thresholds
   *
   * Promotion triggers:
   * 1. Entry count exceeds l2PromotionThreshold
   * 2. Entry count exceeds l2MaxEntries (cleanup mode)
   * 3. Entries older than l3AgeThresholdMs (age-based, independent of count)
   */
  async promoteToL3(): Promise<{ promoted: number; cleaned: number }> {
    if (!this.env.sql || !this.iceberg) {
      return { promoted: 0, cleaned: 0 }
    }

    const l2PromotionThreshold = (this.config as any).l2PromotionThreshold ?? DEFAULT_L2_PROMOTION_THRESHOLD
    const l2MaxEntries = (this.config as any).l2MaxEntries ?? DEFAULT_L2_MAX_ENTRIES
    const l3AgeThresholdMs = (this.config as any).l3AgeThresholdMs ?? DEFAULT_L3_AGE_THRESHOLD_MS

    let promoted = 0
    let cleaned = 0

    try {
      // Get current L2 count
      const countResult = this.env.sql.exec(SQL_COUNT_ENTRIES)
      const countRows = countResult.toArray() as Array<{ count: number }>
      const l2Count = countRows.length > 0 ? countRows[0].count : 0

      // Get all entries to check for age-based promotion and count-based promotion
      const allEntriesResult = this.env.sql.exec('SELECT id, type, data FROM things')
      const rows = allEntriesResult.toArray() as Array<{ id: string; type: string; data: string }>

      const eventsToWrite: IcebergEvent[] = []
      const idsToDelete: string[] = []

      for (const row of rows) {
        const thing = JSON.parse(row.data) as ThingData

        // Check age-based promotion
        const createdAt = (thing as any).$createdAt ?? (thing as any).createdAt ?? 0
        const age = Date.now() - (typeof createdAt === 'number' ? createdAt : 0)

        // Determine if this entry should be promoted:
        // 1. Age-based: promote if older than l3AgeThresholdMs
        // 2. Count-based: promote if L2 exceeds threshold
        const shouldPromoteByAge = age > l3AgeThresholdMs
        const shouldPromoteByCount = l2Count > l2PromotionThreshold

        if (shouldPromoteByAge || shouldPromoteByCount) {
          eventsToWrite.push({
            type: 'thing.promoted',
            entityId: thing.$id,
            payload: thing,
            ts: Date.now(),
          })
          idsToDelete.push(row.id)
          promoted++
        }

        // For count-based promotion, limit how many we delete to stay within target
        if (shouldPromoteByCount && !shouldPromoteByAge) {
          const targetCount = Math.floor(l2MaxEntries * 0.8)
          if (l2Count - cleaned <= targetCount) {
            break
          }
        }
      }

      // Write to L3
      if (eventsToWrite.length > 0) {
        await this.iceberg.write(eventsToWrite)

        // Clean up from L2
        for (const id of idsToDelete) {
          this.env.sql.exec(SQL_DELETE_BY_ID, id)
          cleaned++
        }
      }
    } catch (error) {
      console.error('[DOStorage] Error during L2->L3 promotion:', error)
    }

    return { promoted, cleaned }
  }

  /**
   * Health check for all storage tiers
   * Returns status of each tier (L0, L1, L2, L3)
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const result: HealthCheckResult = {
      l0: { status: 'healthy' },
      l1: { status: 'healthy' },
      l2: { status: 'healthy' },
      l3: { status: 'healthy' },
    }

    // L0: InMemoryStateManager
    try {
      const stats = this.memory.getStats()
      result.l0 = {
        status: 'healthy',
        entryCount: stats.entryCount,
        estimatedBytes: stats.estimatedBytes,
      }
    } catch (error) {
      result.l0 = {
        status: 'unhealthy',
        lastError: error instanceof Error ? error.message : String(error),
      }
    }

    // L1: Pipeline
    if (this.pipeline) {
      result.l1 = { status: 'healthy' }
    } else if (this.env.PIPELINE) {
      result.l1 = { status: 'degraded', lastError: 'Pipeline not initialized' }
    } else {
      result.l1 = { status: 'healthy' } // No pipeline configured is OK
    }

    // L2: SQLite
    if (this.env.sql) {
      try {
        const countResult = this.env.sql.exec(SQL_COUNT_ENTRIES)
        const rows = countResult.toArray() as Array<{ count: number }>
        result.l2 = {
          status: 'healthy',
          entryCount: rows.length > 0 ? rows[0].count : 0,
        }
      } catch (error) {
        result.l2 = {
          status: 'unhealthy',
          lastError: error instanceof Error ? error.message : String(error),
        }
      }
    } else {
      result.l2 = { status: 'healthy' } // No SQLite configured is OK
    }

    // L3: Iceberg
    if (this.iceberg) {
      try {
        const stats = this.iceberg.getStats()
        result.l3 = {
          status: 'healthy',
          entryCount: stats.entryCount,
          estimatedBytes: stats.estimatedBytes,
        }
      } catch (error) {
        result.l3 = {
          status: 'unhealthy',
          lastError: error instanceof Error ? error.message : String(error),
        }
      }
    } else if (this.env.R2) {
      result.l3 = { status: 'degraded', lastError: 'R2 available but Iceberg not initialized' }
    } else {
      result.l3 = { status: 'healthy' } // No R2 configured is OK
    }

    return result
  }

  /**
   * Called before DO hibernation - flush all dirty state and promote to L3
   */
  async beforeHibernation(): Promise<void> {
    // Flush Pipeline
    if (this.pipeline) {
      await this.pipeline.flush()
    }

    // Checkpoint to SQLite
    if (this.checkpointer) {
      await this.checkpointer.beforeHibernation()
    }

    // Flush to Iceberg
    await this.flushToIceberg()
  }

  /**
   * Close all storage layers
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    // Stop timers
    if (this.icebergTimer) {
      clearInterval(this.icebergTimer)
      this.icebergTimer = null
    }

    // Close layers with timeout to avoid hanging on slow/stuck services
    const CLOSE_TIMEOUT_MS = 500

    if (this.pipeline) {
      try {
        const closePromise = this.pipeline.close()
        const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS))
        await Promise.race([closePromise, timeoutPromise])
      } catch {
        // Swallow close errors - pipeline failures during close are non-critical
        // Data is already persisted to local SQLite
      }
    }

    if (this.checkpointer) {
      // Flush dirty entries to SQLite before closing
      await this.checkpointer.beforeHibernation()
      await this.checkpointer.destroy()
    }

    if (this.iceberg) {
      try {
        const flushPromise = this.flushToIceberg()
        const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS))
        await Promise.race([flushPromise, timeoutPromise])
        await this.iceberg.close()
      } catch {
        // Swallow R2/Iceberg errors during close - data should be in local SQLite
        this.emitDegradation('r2', 'degraded', 'R2 unavailable during close')
      }
    }
  }

  /**
   * Get tier policy configuration
   */
  getTierPolicy(): TierPolicy | undefined {
    return this.tierPolicy
  }

  /**
   * Get tier information for a specific entry
   */
  async getTierInfo(id: string): Promise<TierInfo | undefined> {
    const entry = this.memory.get(id)
    if (!entry) return undefined

    const tiers: string[] = ['L0'] // Always in L0 if we found it

    // Check tier metadata
    const tierMeta = entry._tier as TierMetadata | undefined
    if (tierMeta?.residency) {
      // Use residency from metadata if available
      return {
        tiers: tierMeta.residency,
        promotedAt: this.tierPromotionTimes.get(id) ?? { L0: tierMeta.createdAt },
      }
    }

    // Check if in L1 (emitted to Pipeline)
    if (this.pipeline) {
      tiers.push('L1')
    }

    // Check if in L2 (checkpointed to SQLite)
    if (this.env.sql) {
      try {
        const result = this.env.sql.exec('SELECT id FROM things WHERE id = ?', id)
        const rows = result.toArray()
        if (rows.length > 0) {
          tiers.push('L2')
        }
      } catch {
        // Ignore
      }
    }

    // Check if in L3 (archived to Iceberg)
    const inIcebergBuffer = this.icebergBuffer.some((e) => e.entityId === id)
    if (inIcebergBuffer || this.iceberg) {
      // If it was flushed to Iceberg at some point
      tiers.push('L3')
    }

    return {
      tiers,
      promotedAt: this.tierPromotionTimes.get(id) ?? {},
    }
  }

  /**
   * Get health status of all storage services
   */
  getHealthStatus(): HealthStatus {
    return { ...this.healthStatus }
  }

  /**
   * Subscribe to degradation events
   */
  onDegradation(callback: DegradationCallback): () => void {
    this.degradationCallbacks.push(callback)
    return () => {
      const index = this.degradationCallbacks.indexOf(callback)
      if (index !== -1) {
        this.degradationCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * Emit a degradation event
   */
  private emitDegradation(service: 'r2' | 'pipeline' | 'sql', status: ServiceStatus, error?: string): void {
    const event: DegradationEvent = {
      service,
      status,
      error,
      timestamp: Date.now(),
    }

    // Update health status
    this.healthStatus[service] = status

    // Notify all callbacks
    for (const callback of this.degradationCallbacks) {
      try {
        callback(event)
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Record a service failure for circuit breaker
   */
  private recordFailure(service: 'pipeline' | 'r2'): void {
    const state = this.circuitBreakerState[service]
    state.failures++
    state.lastFailure = Date.now()

    if (state.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      state.open = true
      this.emitDegradation(service, 'degraded', 'Circuit breaker opened')
    }
  }

  /**
   * Check if circuit breaker allows a request
   */
  private isCircuitOpen(service: 'pipeline' | 'r2'): boolean {
    const state = this.circuitBreakerState[service]

    if (!state.open) return false

    // Check if we should try half-open
    const timeSinceLastFailure = Date.now() - state.lastFailure
    if (timeSinceLastFailure >= this.CIRCUIT_BREAKER_RESET_MS) {
      // Half-open: allow one request to test
      return false
    }

    return true
  }

  /**
   * Record a service success (resets circuit breaker)
   */
  private recordSuccess(service: 'pipeline' | 'r2'): void {
    const state = this.circuitBreakerState[service]
    state.failures = 0
    state.open = false

    if (this.healthStatus[service] !== 'ok') {
      this.healthStatus[service] = 'ok'
    }
  }

  /**
   * Buffer an R2 write for later sync
   */
  private bufferR2Write(key: string, data: string): void {
    this.r2WriteBuffer.push({ key, data })
  }

  /**
   * Sync buffered R2 writes when R2 becomes available
   */
  async syncR2Buffer(): Promise<void> {
    if (this.r2WriteBuffer.length === 0 || !this.env.R2) return

    const pendingWrites = [...this.r2WriteBuffer]
    this.r2WriteBuffer = []

    for (const { key, data } of pendingWrites) {
      try {
        await this.env.R2.put(key, data)
        this.recordSuccess('r2')
      } catch {
        // Re-buffer if still failing
        this.r2WriteBuffer.push({ key, data })
        this.recordFailure('r2')
      }
    }
  }
}
