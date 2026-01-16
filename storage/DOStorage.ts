/**
 * DOStorage - Extends DOSemantic with 4-layer storage (~40KB)
 *
 * Adds:
 * - L0: InMemoryStateManager - Fast O(1) CRUD with dirty tracking
 * - L1: PipelineEmitter (WAL) - Fire-and-forget event emission
 * - L2: LazyCheckpointer (SQLite) - Batched lazy persistence
 * - L3: IcebergWriter (Cold Storage) - Long-term storage in R2
 *
 * Write Path: Client -> L0 (memory) -> L1 (WAL ACK) -> lazy L2 -> eventual L3
 * Read Path: L0 (hit?) -> L2 (hit?) -> L3 (restore)
 */

import { DOSemantic, type DOSemanticEnv } from '../semantic/DOSemantic'
import { InMemoryStateManager, type ThingData, type CreateThingInput } from './in-memory-state-manager'

// ============================================================================
// Types
// ============================================================================

export interface DOStorageEnv extends DOSemanticEnv {
  DOStorage: DurableObjectNamespace<DOStorageClass>
  PIPELINE?: Pipeline
  R2?: R2Bucket
}

interface Pipeline {
  send(batch: unknown[]): Promise<void>
}

interface RecoveryResult {
  source: 'sqlite' | 'iceberg' | 'empty'
  thingsLoaded: number
  eventsReplayed?: number
}

/** Event structure for L1 Pipeline */
interface PipelineEvent {
  type: string
  entityId: string
  payload: unknown
  ts: number
  idempotencyKey: string
  _meta: {
    namespace: string
    emittedAt: number
  }
}

/** Configuration for L1 Pipeline emitter */
interface L1Config {
  /** Interval in ms between batch flushes (default: 100) */
  flushIntervalMs: number
  /** Max events before triggering flush (default: 100) */
  batchSize: number
  /** Max retries on failure (default: 3) */
  maxRetries: number
  /** Delay between retries in ms (default: 100) */
  retryDelayMs: number
}

/** Default L1 configuration */
const DEFAULT_L1_CONFIG: L1Config = {
  flushIntervalMs: 100,
  batchSize: 100,
  maxRetries: 3,
  retryDelayMs: 100,
}

/**
 * Generates a unique idempotency key for event deduplication
 */
function generateIdempotencyKey(): string {
  const random = Math.random().toString(36).substring(2, 15)
  const timestamp = Date.now().toString(36)
  return `${timestamp}-${random}`
}

// ============================================================================
// DOStorage Class
// ============================================================================

export class DOStorageClass extends DOSemantic {
  // L0: In-memory state manager
  protected memoryManager: InMemoryStateManager

  // L1: Pipeline event queue and state
  protected pendingEvents: PipelineEvent[] = []
  protected l1Config: L1Config = DEFAULT_L1_CONFIG
  protected flushTimer: ReturnType<typeof setTimeout> | null = null
  protected flushInProgress: Promise<void> | null = null
  protected namespace: string

  constructor(ctx: DurableObjectState, env: DOStorageEnv) {
    super(ctx, env as DOSemanticEnv)

    // Extract namespace from ctx for event metadata
    this.namespace = ctx.id.toString()

    // Initialize L0: InMemory state manager
    this.memoryManager = new InMemoryStateManager({
      maxEntries: 10000,
      maxBytes: 10 * 1024 * 1024, // 10MB
      onEvict: (entries) => {
        // Log evictions for debugging
        console.log(`Evicted ${entries.length} entries from L0 cache`)
      },
    })

    // Initialize storage tables for L2
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS l2_things (
        id TEXT PRIMARY KEY,
        type TEXT,
        version INTEGER DEFAULT 1,
        data TEXT,
        updated_at INTEGER
      )
    `)

    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_l2_things_type ON l2_things(type)
    `)

    // Start L1 flush timer if Pipeline binding available
    if ((env as DOStorageEnv).PIPELINE && this.l1Config.flushIntervalMs > 0) {
      this.scheduleFlush()
    }
  }

  // =========================================================================
  // L1: PIPELINE EVENT EMISSION
  // =========================================================================

  /**
   * Queue an event for L1 Pipeline emission
   */
  protected queueEvent(type: string, entityId: string, payload: unknown): void {
    const event: PipelineEvent = {
      type,
      entityId,
      payload,
      ts: Date.now(),
      idempotencyKey: generateIdempotencyKey(),
      _meta: {
        namespace: this.namespace,
        emittedAt: Date.now(),
      },
    }

    this.pendingEvents.push(event)

    // Check if batch size threshold reached
    if (this.pendingEvents.length >= this.l1Config.batchSize) {
      this.triggerFlush()
    }
  }

  /**
   * Schedule periodic flush timer
   */
  protected scheduleFlush(): void {
    if (this.flushTimer) return

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.triggerFlush()
      // Reschedule if we still have the Pipeline binding
      const env = this.env as DOStorageEnv
      if (env.PIPELINE && this.l1Config.flushIntervalMs > 0) {
        this.scheduleFlush()
      }
    }, this.l1Config.flushIntervalMs)
  }

  /**
   * Trigger a non-blocking flush of pending events
   */
  protected triggerFlush(): void {
    if (this.pendingEvents.length === 0) return

    // Fire-and-forget: don't await, but track for hibernation
    const flushOp = this.flushPipeline().catch((err) => {
      console.error('[DOStorage] Pipeline flush failed:', (err as Error).message)
    })

    // Track the flush promise so we can await it during hibernation
    this.flushInProgress = flushOp.finally(() => {
      this.flushInProgress = null
    })
  }

  /**
   * Flush pending events to Pipeline with retry logic
   * This method can throw if all retries fail - events are preserved for next attempt
   */
  async flushPipeline(): Promise<void> {
    const env = this.env as DOStorageEnv
    if (!env.PIPELINE || this.pendingEvents.length === 0) {
      return
    }

    // Snapshot events to send (don't clear yet - wait for success)
    const batch = [...this.pendingEvents]
    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.l1Config.maxRetries; attempt++) {
      try {
        await env.PIPELINE.send(batch)

        // Success - clear sent events from queue
        // Only remove the specific events we sent (new ones may have been added)
        const sentIds = new Set(batch.map((e) => e.idempotencyKey))
        this.pendingEvents = this.pendingEvents.filter(
          (e) => !sentIds.has(e.idempotencyKey)
        )

        return // Success
      } catch (error) {
        lastError = error as Error
        console.warn(
          `[DOStorage] Pipeline send attempt ${attempt + 1}/${this.l1Config.maxRetries} failed:`,
          lastError.message
        )

        // Wait before retry (except on last attempt)
        if (attempt < this.l1Config.maxRetries - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.l1Config.retryDelayMs * (attempt + 1))
          )
        }
      }
    }

    // All retries failed - events remain in pendingEvents for next attempt
    // Log but don't throw to avoid blocking operations
    console.error(
      '[DOStorage] Pipeline flush failed after all retries. Events preserved for next attempt:',
      lastError?.message
    )
  }

  /**
   * Force immediate flush of all pending events (blocking)
   * Use before hibernation or when durability guarantee is needed
   */
  async forceFlush(): Promise<{ flushed: number; failed: number }> {
    const env = this.env as DOStorageEnv
    if (!env.PIPELINE) {
      return { flushed: 0, failed: 0 }
    }

    // Wait for any in-progress flush to complete
    if (this.flushInProgress) {
      await this.flushInProgress
    }

    if (this.pendingEvents.length === 0) {
      return { flushed: 0, failed: 0 }
    }

    const initialCount = this.pendingEvents.length

    try {
      await this.flushPipeline()
      const flushed = initialCount - this.pendingEvents.length
      return { flushed, failed: this.pendingEvents.length }
    } catch (error) {
      console.error('[DOStorage] Force flush failed:', (error as Error).message)
      return { flushed: 0, failed: initialCount }
    }
  }

  /**
   * Get count of pending events waiting to be sent
   */
  getPendingEventCount(): number {
    return this.pendingEvents.length
  }

  /**
   * Configure L1 Pipeline settings
   */
  configureL1(config: Partial<L1Config>): void {
    this.l1Config = { ...this.l1Config, ...config }

    // Restart timer with new interval if needed
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    const env = this.env as DOStorageEnv
    if (env.PIPELINE && this.l1Config.flushIntervalMs > 0) {
      this.scheduleFlush()
    }
  }

  // =========================================================================
  // L0: INMEMORY OPERATIONS
  // =========================================================================

  /**
   * Create a thing in the L0 memory layer
   */
  memCreate(input: CreateThingInput): ThingData {
    const thing = this.memoryManager.create(input)

    // Queue event for L1 pipeline
    this.queueEvent('thing.created', thing.$id, thing)

    return thing
  }

  /**
   * Get a thing from L0 memory (synchronous)
   */
  memGet(id: string): ThingData | null {
    return this.memoryManager.get(id)
  }

  /**
   * Update a thing in L0 memory
   */
  memUpdate(id: string, updates: Partial<ThingData>): ThingData | null {
    try {
      const updated = this.memoryManager.update(id, updates)

      // Queue event for L1 pipeline
      this.queueEvent('thing.updated', id, updates)

      return updated
    } catch (err) {
      // Update failed - log for debugging and return null
      console.warn(`[DOStorage] Memory update failed for ${id}:`, (err as Error).message)
      return null
    }
  }

  /**
   * Delete a thing from L0 memory
   */
  memDelete(id: string): ThingData | null {
    const deleted = this.memoryManager.delete(id)

    if (deleted) {
      // Queue event for L1 pipeline
      this.queueEvent('thing.deleted', id, { $id: id })
    }

    return deleted
  }

  /**
   * List things from L0 memory
   */
  memList(options?: { prefix?: string; limit?: number; offset?: number }): ThingData[] {
    return this.memoryManager.list(options)
  }

  /**
   * Check if an ID is dirty (modified since last checkpoint)
   */
  isDirty(id: string): boolean {
    return this.memoryManager.isDirty(id)
  }

  /**
   * Get count of dirty entries
   */
  getDirtyCount(): number {
    return this.memoryManager.getDirtyCount()
  }

  /**
   * Get statistics for L0 layer
   */
  getL0Stats(): { entryCount: number; dirtyCount: number; estimatedBytes: number } {
    return this.memoryManager.getStats()
  }

  // =========================================================================
  // L2: SQLITE CHECKPOINT OPERATIONS
  // =========================================================================

  /**
   * Checkpoint dirty entries from L0 to L2 (SQLite)
   */
  async checkpoint(): Promise<{ checkpointed: number }> {
    const dirtyKeys = this.memoryManager.getDirtyKeys()
    if (dirtyKeys.length === 0) {
      return { checkpointed: 0 }
    }

    const now = Date.now()

    // Batch insert/update dirty entries
    for (const key of dirtyKeys) {
      const thing = this.memoryManager.get(key)
      if (thing) {
        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO l2_things (id, type, version, data, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          thing.$id,
          thing.$type,
          thing.$version ?? 1,
          JSON.stringify(thing),
          now
        )
      }
    }

    // Mark entries as clean
    this.memoryManager.markClean(dirtyKeys)

    return { checkpointed: dirtyKeys.length }
  }

  /**
   * Get a thing with fallback to L2 (SQLite)
   */
  async getWithFallback(id: string): Promise<ThingData | null> {
    // Try L0 first
    const fromMemory = this.memoryManager.get(id)
    if (fromMemory) return fromMemory

    // Fallback to L2 (SQLite)
    const result = this.ctx.storage.sql
      .exec('SELECT data FROM l2_things WHERE id = ?', id)
      .toArray()

    if (result.length > 0) {
      const thing = JSON.parse(result[0].data as string) as ThingData

      // Hydrate L0 cache (without marking dirty)
      this.memoryManager.loadBulk([thing])

      return thing
    }

    return null
  }

  // =========================================================================
  // COLD START RECOVERY
  // =========================================================================

  /**
   * Recover state from L2 (SQLite) on cold start
   */
  async recover(): Promise<RecoveryResult> {
    // Try L2 (SQLite) first
    const rows = this.ctx.storage.sql.exec('SELECT data FROM l2_things').toArray()

    if (rows.length > 0) {
      const things: ThingData[] = rows.map((row) => JSON.parse(row.data as string))

      // Load into L0 (without marking dirty)
      this.memoryManager.loadBulk(things)

      return {
        source: 'sqlite',
        thingsLoaded: things.length,
      }
    }

    // L2 empty - could fall back to L3 (Iceberg) in a full implementation
    return {
      source: 'empty',
      thingsLoaded: 0,
    }
  }

  // =========================================================================
  // HIBERNATION SUPPORT
  // =========================================================================

  /**
   * Called before DO hibernation - flush all dirty state
   */
  async beforeHibernation(): Promise<void> {
    // Stop the flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    // Force flush all pending events to Pipeline (blocking)
    const flushResult = await this.forceFlush()
    if (flushResult.failed > 0) {
      console.warn(
        `[DOStorage] ${flushResult.failed} events could not be flushed to Pipeline before hibernation`
      )
    }

    // Checkpoint all dirty entries to SQLite
    await this.checkpoint()

    // Call parent hibernation hook
    await super.prepareHibernate()
  }

  // =========================================================================
  // RPC-COMPATIBLE CRUD METHODS
  // =========================================================================

  /**
   * Create a thing with RPC-compatible signature.
   * First argument is the type, second is the data.
   * Returns the created thing with $id, $type, $version, etc.
   */
  async create(type: string, data: Record<string, unknown>): Promise<ThingData> {
    const thing = this.memCreate({
      $type: type,
      ...data,
    })

    // Immediately checkpoint to SQLite for durability
    await this.checkpoint()

    return thing
  }

  /**
   * Get a thing by ID with RPC-compatible signature.
   * Returns the thing or null if not found.
   */
  async get(id: string): Promise<ThingData | null> {
    return this.getWithFallback(id)
  }

  /**
   * Override DOCore.getThingById to use DOStorage's L0/L2 storage
   * This enables NounInstanceAccessor to access things stored in DOStorage
   */
  override async getThingById(id: string): Promise<ThingData | null> {
    return this.getWithFallback(id)
  }

  /**
   * Override DOCore.updateThingById to use DOStorage's L0/L2 storage
   * This enables NounInstanceAccessor to update things stored in DOStorage
   */
  override async updateThingById(id: string, updates: Record<string, unknown>): Promise<ThingData> {
    return this.update(id, updates as Partial<ThingData>)
  }

  /**
   * Override DOCore.deleteThingById to use DOStorage's L0/L2 storage
   * This enables NounInstanceAccessor to delete things stored in DOStorage
   */
  override async deleteThingById(id: string): Promise<boolean> {
    const deleted = await this.removeById(id)
    return deleted !== null
  }

  /**
   * Delete a thing by ID and return it
   * Use this when you need the deleted thing returned.
   * Returns the deleted thing or null if not found.
   */
  async deleteThing(id: string): Promise<ThingData | null> {
    return this.removeById(id)
  }

  /**
   * Update a thing by ID with RPC-compatible signature.
   * Returns the updated thing.
   */
  async update(id: string, updates: Partial<ThingData>): Promise<ThingData> {
    // First ensure we have the thing in memory
    const existing = await this.getWithFallback(id)
    if (!existing) {
      throw new Error(`Thing not found: ${id}`)
    }

    // Update in memory
    const updated = this.memUpdate(id, updates)
    if (!updated) {
      throw new Error(`Failed to update thing: ${id}`)
    }

    // Checkpoint for durability
    await this.checkpoint()

    return updated
  }

  /**
   * Delete a thing by ID with RPC-compatible signature.
   * Returns the deleted thing or null if not found.
   *
   * Note: Named removeById to avoid conflicts with DOCore methods
   */
  async removeById(id: string): Promise<ThingData | null> {
    // First ensure we have the thing in memory
    const existing = await this.getWithFallback(id)
    if (!existing) {
      return null
    }

    // Delete from memory
    const deleted = this.memDelete(id)

    // Delete from SQLite
    this.ctx.storage.sql.exec('DELETE FROM l2_things WHERE id = ?', id)

    return deleted
  }
}

// Use a named export alias for compatibility
export { DOStorageClass as DOStorage }

// ============================================================================
// Default Worker Export
// ============================================================================

export default {
  async fetch(request: Request, env: DOStorageEnv): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOStorage.idFromName(ns)
    const stub = env.DOStorage.get(id)

    return stub.fetch(request)
  },
}
