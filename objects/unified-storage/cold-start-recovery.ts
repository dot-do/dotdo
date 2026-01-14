/**
 * ColdStartRecovery - State restoration when a Durable Object starts cold
 *
 * Recovery strategy:
 * 1. First, try loading from local SQLite (fast, ~100ms)
 * 2. If SQLite empty, replay from Iceberg (slower, but complete)
 * 3. Handle empty state gracefully
 *
 * @module objects/unified-storage/cold-start-recovery
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Thing entity with metadata
 */
export interface Thing {
  $id: string
  $type: string
  $version: number
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

/**
 * Domain event for replay
 */
export interface DomainEvent {
  type: 'thing.created' | 'thing.updated' | 'thing.deleted'
  entityId: string
  entityType: string
  payload: Record<string, unknown>
  ts: number
  version: number
  ns: string
}

/**
 * Recovery options
 */
export interface RecoveryOptions {
  namespace: string
  sql: SqliteConnection
  iceberg?: IcebergReader
  timeout?: number
  onProgress?: (progress: RecoveryProgress) => void
}

/**
 * Progress reporting during recovery
 */
export interface RecoveryProgress {
  phase: 'sqlite' | 'iceberg' | 'applying' | 'complete'
  loaded: number
  total: number
  elapsedMs: number
}

/**
 * Result of recovery operation
 */
export interface RecoveryResult {
  source: 'sqlite' | 'iceberg' | 'empty'
  thingsLoaded: number
  eventsReplayed: number
  durationMs: number
  state: Map<string, Thing>
}

/**
 * SQLite connection interface
 */
export interface SqliteConnection {
  exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
}

/**
 * Iceberg reader interface
 */
export interface IcebergReader {
  getRecords(options: {
    table: string
    partition?: { ns?: string }
    orderBy?: string
  }): Promise<DomainEvent[]>
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// ============================================================================
// COLD START RECOVERY CLASS
// ============================================================================

/**
 * ColdStartRecovery handles state restoration when a DO starts cold.
 *
 * Prefers fast SQLite loading, falls back to Iceberg event replay if needed.
 */
export class ColdStartRecovery {
  private readonly namespace: string
  private readonly sql: SqliteConnection
  private readonly iceberg?: IcebergReader
  private readonly timeout: number
  private readonly onProgress?: (progress: RecoveryProgress) => void

  private state: Map<string, Thing> = new Map()
  private recoveryPromise: Promise<RecoveryResult> | null = null
  private startTime: number = 0

  constructor(options: RecoveryOptions) {
    this.namespace = options.namespace
    this.sql = options.sql
    this.iceberg = options.iceberg
    this.timeout = options.timeout ?? 30000 // 30s default
    this.onProgress = options.onProgress
  }

  /**
   * Recover state from SQLite or Iceberg
   */
  async recover(): Promise<RecoveryResult> {
    // Handle concurrent recovery calls - return same promise
    if (this.recoveryPromise) {
      return this.recoveryPromise
    }

    this.recoveryPromise = this.doRecover()
    return this.recoveryPromise
  }

  /**
   * Force rebuild from Iceberg (ignores SQLite)
   */
  async forceRebuildFromIceberg(): Promise<RecoveryResult> {
    this.startTime = performance.now()
    this.state.clear()

    if (!this.iceberg) {
      return this.createResult('empty', 0, 0)
    }

    return this.replayFromIceberg()
  }

  /**
   * Get current in-memory state
   */
  getState(): Map<string, Thing> {
    return this.state
  }

  /**
   * Validate recovered state consistency
   */
  validateState(): ValidationResult {
    const errors: string[] = []

    for (const [id, thing] of this.state) {
      // Check required fields
      if (!thing.$id) {
        errors.push(`Thing at key ${id} missing $id`)
      }
      if (!thing.$type) {
        errors.push(`Thing ${id} missing $type`)
      }
      if (thing.$id !== id) {
        errors.push(`Thing $id ${thing.$id} doesn't match map key ${id}`)
      }
      if (typeof thing.$version !== 'number' || thing.$version < 1) {
        errors.push(`Thing ${id} has invalid $version: ${thing.$version}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private async doRecover(): Promise<RecoveryResult> {
    this.startTime = performance.now()
    this.state.clear()

    // Try SQLite first (fast path)
    try {
      const sqliteResult = await this.loadFromSqlite()
      if (sqliteResult.thingsLoaded > 0) {
        return sqliteResult
      }
    } catch (error) {
      // SQLite failed (possibly corrupted), fall back to Iceberg
      console.warn('SQLite load failed, falling back to Iceberg:', error)
    }

    // Fall back to Iceberg replay
    if (this.iceberg) {
      return this.replayFromIceberg()
    }

    // No data anywhere
    return this.createResult('empty', 0, 0)
  }

  private async loadFromSqlite(): Promise<RecoveryResult> {
    this.reportProgress('sqlite', 0, 0)

    let thingsLoaded = 0

    // Load columnar collections
    try {
      const collectionsResult = this.sql.exec('SELECT type, data FROM collections')
      const collections = collectionsResult.toArray() as Array<{ type: string; data: string }>

      for (const collection of collections) {
        try {
          const parsed = JSON.parse(collection.data)

          // Handle both array format and object format (from LazyCheckpointer)
          if (Array.isArray(parsed)) {
            // Array format: [thing1, thing2, ...]
            for (const thing of parsed as Thing[]) {
              this.state.set(thing.$id, thing)
              thingsLoaded++
            }
          } else if (typeof parsed === 'object' && parsed !== null) {
            // Object format from LazyCheckpointer: {"Type:id": thingData, ...}
            for (const [, thingData] of Object.entries(parsed)) {
              const thing = thingData as Thing
              if (thing && thing.$id) {
                this.state.set(thing.$id, thing)
                thingsLoaded++
              }
            }
          }
        } catch {
          // Invalid JSON, skip this collection
          throw new Error(`Invalid JSON in collection ${collection.type}`)
        }
      }
    } catch (error) {
      // Collections table might not exist or be corrupted
      if (String(error).includes('Invalid JSON')) {
        throw error
      }
    }

    // Load normalized things
    try {
      const thingsResult = this.sql.exec('SELECT id, type, data FROM things')
      const things = thingsResult.toArray() as Array<{ id: string; type: string; data: string }>

      for (const row of things) {
        try {
          const thing = JSON.parse(row.data) as Thing
          this.state.set(row.id, thing)
          thingsLoaded++
        } catch {
          // Invalid JSON, skip this thing
          throw new Error(`Invalid JSON in thing ${row.id}`)
        }
      }
    } catch (error) {
      // Things table might not exist or be corrupted
      if (String(error).includes('Invalid JSON')) {
        throw error
      }
    }

    this.reportProgress('complete', thingsLoaded, thingsLoaded)

    return this.createResult(
      thingsLoaded > 0 ? 'sqlite' : 'empty',
      thingsLoaded,
      0
    )
  }

  private async replayFromIceberg(): Promise<RecoveryResult> {
    if (!this.iceberg) {
      return this.createResult('empty', 0, 0)
    }

    this.reportProgress('iceberg', 0, 0)

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Recovery timed out')), this.timeout)
    })

    // Race between recovery and timeout
    const events = await Promise.race([
      this.iceberg.getRecords({
        table: 'do_events',
        partition: { ns: this.namespace },
        orderBy: 'ts ASC',
      }),
      timeoutPromise,
    ])

    const totalEvents = events.length
    this.reportProgress('applying', 0, totalEvents)

    // Apply events in order
    let appliedCount = 0
    for (const event of events) {
      this.applyEvent(event)
      appliedCount++

      // Report progress periodically
      if (appliedCount % 100 === 0 || appliedCount === totalEvents) {
        this.reportProgress('applying', appliedCount, totalEvents)
      }
    }

    this.reportProgress('complete', this.state.size, totalEvents)

    return this.createResult(
      totalEvents > 0 ? 'iceberg' : 'empty',
      this.state.size,
      totalEvents
    )
  }

  private applyEvent(event: DomainEvent): void {
    // Skip malformed events
    if (!event.entityId && !event.payload?.$id) {
      return
    }

    const entityId = event.entityId || (event.payload.$id as string)

    switch (event.type) {
      case 'thing.created': {
        const thing: Thing = {
          $id: entityId,
          $type: event.entityType || (event.payload.$type as string) || 'Unknown',
          $version: event.version || (event.payload.$version as number) || 1,
          $createdAt: event.ts || Date.now(),
          $updatedAt: event.ts || Date.now(),
          ...event.payload,
        }
        this.state.set(entityId, thing)
        break
      }

      case 'thing.updated': {
        const existing = this.state.get(entityId)
        if (existing) {
          // Merge update into existing
          const updated: Thing = {
            ...existing,
            ...event.payload,
            $id: entityId, // Preserve ID
            $type: existing.$type, // Preserve type
            $version: event.version || existing.$version + 1,
            $updatedAt: event.ts || Date.now(),
          }
          this.state.set(entityId, updated)
        }
        break
      }

      case 'thing.deleted': {
        this.state.delete(entityId)
        break
      }
    }
  }

  private reportProgress(
    phase: RecoveryProgress['phase'],
    loaded: number,
    total: number
  ): void {
    if (this.onProgress) {
      this.onProgress({
        phase,
        loaded,
        total,
        elapsedMs: performance.now() - this.startTime,
      })
    }
  }

  private createResult(
    source: RecoveryResult['source'],
    thingsLoaded: number,
    eventsReplayed: number
  ): RecoveryResult {
    return {
      source,
      thingsLoaded,
      eventsReplayed,
      durationMs: performance.now() - this.startTime,
      state: this.state,
    }
  }
}
