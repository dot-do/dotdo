/**
 * DOStorage - Integrated 4-Layer Storage Coordinator
 *
 * Coordinates all storage layers:
 * - L0: InMemoryStateManager (hot cache)
 * - L1: PipelineEmitter (WAL for durability)
 * - L2: LazyCheckpointer (SQLite for persistence)
 * - L3: IcebergWriter (cold storage)
 */

import { InMemoryStateManager, type ThingData, type CreateThingInput } from './in-memory-state-manager'
import { PipelineEmitter } from './pipeline-emitter'
import { LazyCheckpointer, type DirtyTracker } from './lazy-checkpointer'
import { IcebergWriter, type IcebergEvent } from './iceberg-writer'

export interface DOStorageConfig {
  namespace: string
  env: StorageEnv
  checkpointInterval?: number // ms between SQLite checkpoints
  icebergFlushInterval?: number // ms between Iceberg flushes
  waitForPipeline?: boolean // Block until Pipeline ACK
}

interface StorageEnv {
  PIPELINE?: { send(batch: unknown[]): Promise<void> }
  R2?: R2Bucket
  sql?: SqlStorage
}

interface R2Bucket {
  put(key: string, data: ArrayBuffer | string): Promise<unknown>
  get(key: string): Promise<{ events: IcebergEvent[] } | null>
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
      const thing = this.manager.get(key)
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
  private config: Required<DOStorageConfig>

  // Storage layers
  private memory: InMemoryStateManager
  private pipeline: PipelineEmitter | null = null
  private checkpointer: LazyCheckpointer | null = null
  private iceberg: IcebergWriter | null = null

  // Iceberg flush timer
  private icebergTimer: ReturnType<typeof setInterval> | null = null
  private icebergBuffer: IcebergEvent[] = []

  private closed: boolean = false

  constructor(config: DOStorageConfig) {
    this.namespace = config.namespace
    this.env = config.env
    this.config = {
      namespace: config.namespace,
      env: config.env,
      checkpointInterval: config.checkpointInterval ?? 5000,
      icebergFlushInterval: config.icebergFlushInterval ?? 60000,
      waitForPipeline: config.waitForPipeline ?? false,
    }

    // Initialize L0: InMemory
    this.memory = new InMemoryStateManager()

    // Initialize L1: Pipeline (if available)
    if (this.env.PIPELINE) {
      this.pipeline = new PipelineEmitter(this.env.PIPELINE, {
        namespace: this.namespace,
        flushInterval: 100, // Quick flush for durability
        batchSize: 50,
      })
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
    }
  }

  /**
   * Create a new thing
   * Write path: L0 -> L1 (ACK) -> lazy L2 -> eventual L3
   */
  async create(input: CreateThingInput): Promise<ThingData> {
    // L0: Write to memory immediately
    const thing = this.memory.create(input)

    // L1: Emit to Pipeline (WAL)
    if (this.pipeline) {
      this.pipeline.emit('thing.created', 'things', thing)

      // Buffer for L3
      this.icebergBuffer.push({
        type: 'thing.created',
        entityId: thing.$id,
        payload: thing,
        ts: Date.now(),
      })

      // If waitForPipeline, flush and wait
      if (this.config.waitForPipeline) {
        await this.pipeline.flush()
      }
    }

    return thing
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
      const result = this.env.sql.exec(
        'SELECT id, type, data FROM things WHERE id = ?',
        id
      )
      const rows = result.toArray() as Array<{ id: string; type: string; data: string }>
      if (rows.length > 0) {
        const thing = JSON.parse(rows[0].data) as ThingData

        // Hydrate L0 cache
        this.memory.loadBulk([thing])

        return thing
      }
    }

    return null
  }

  /**
   * Get with full fallback (L0 -> L2 -> L3)
   */
  async getWithFullFallback(id: string): Promise<ThingData | null> {
    // Try L0 and L2
    const fromL2 = await this.getWithFallback(id)
    if (fromL2) return fromL2

    // Fallback to L3 (Iceberg)
    if (this.env.R2) {
      const r2Result = await this.env.R2.get(`things/${id}`)
      if (r2Result && r2Result.events) {
        // Reconstruct from events
        let state: ThingData | null = null
        for (const event of r2Result.events) {
          if (event.entityId === id) {
            if (event.type === 'thing.created') {
              state = event.payload as ThingData
            } else if (event.type === 'thing.updated' && state) {
              state = { ...state, ...event.payload }
            }
          }
        }

        if (state) {
          // Hydrate L0 cache
          this.memory.loadBulk([state])
          return state
        }
      }
    }

    return null
  }

  /**
   * Update a thing
   */
  async update(id: string, updates: Partial<ThingData>): Promise<ThingData> {
    const thing = this.memory.update(id, updates)

    if (this.pipeline) {
      this.pipeline.emit('thing.updated', 'things', { $id: id, ...updates })

      this.icebergBuffer.push({
        type: 'thing.updated',
        entityId: id,
        payload: updates,
        ts: Date.now(),
      })
    }

    return thing
  }

  /**
   * Delete a thing
   */
  async delete(id: string): Promise<ThingData | null> {
    const thing = this.memory.delete(id)

    if (thing && this.pipeline) {
      this.pipeline.emit('thing.deleted', 'things', { $id: id })

      this.icebergBuffer.push({
        type: 'thing.deleted',
        entityId: id,
        payload: {},
        ts: Date.now(),
      })
    }

    return thing
  }

  /**
   * Flush to Iceberg (L3)
   */
  private async flushToIceberg(): Promise<void> {
    if (this.icebergBuffer.length === 0 || !this.iceberg) return

    const events = this.icebergBuffer.splice(0, this.icebergBuffer.length)
    await this.iceberg.write(events)
  }

  /**
   * Called before DO hibernation - flush all dirty state
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

    // Close layers
    if (this.pipeline) {
      await this.pipeline.close()
    }

    if (this.checkpointer) {
      await this.checkpointer.destroy()
    }

    if (this.iceberg) {
      await this.flushToIceberg()
      await this.iceberg.close()
    }
  }
}
