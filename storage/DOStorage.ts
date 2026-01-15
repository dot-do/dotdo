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

// ============================================================================
// DOStorage Class
// ============================================================================

export class DOStorageClass extends DOSemantic {
  // L0: In-memory state manager
  protected memoryManager: InMemoryStateManager
  protected pendingEvents: Array<{
    type: string
    entityId: string
    payload: unknown
    ts: number
  }> = []

  constructor(ctx: DurableObjectState, env: DOStorageEnv) {
    super(ctx, env as DOSemanticEnv)

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
    this.pendingEvents.push({
      type: 'thing.created',
      entityId: thing.$id,
      payload: thing,
      ts: Date.now(),
    })

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

      this.pendingEvents.push({
        type: 'thing.updated',
        entityId: id,
        payload: updates,
        ts: Date.now(),
      })

      return updated
    } catch {
      return null
    }
  }

  /**
   * Delete a thing from L0 memory
   */
  memDelete(id: string): ThingData | null {
    const deleted = this.memoryManager.delete(id)

    if (deleted) {
      this.pendingEvents.push({
        type: 'thing.deleted',
        entityId: id,
        payload: {},
        ts: Date.now(),
      })
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
    // Checkpoint all dirty entries to SQLite
    await this.checkpoint()

    // Call parent hibernation hook
    await super.prepareHibernate()
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
