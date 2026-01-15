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

import type { RecoveryMetrics, MetricRecoverySource } from './metrics'
import { IdempotencyTracker, type IdempotencyConfig } from './idempotency-tracker'

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
  /** Metrics collector for observability */
  metrics?: RecoveryMetrics
  /** Idempotency configuration for event deduplication */
  idempotencyConfig?: IdempotencyConfig
}

/**
 * Progress reporting during recovery
 */
export interface RecoveryProgress {
  phase: 'sqlite' | 'iceberg' | 'applying' | 'complete'
  loaded: number
  total: number
  elapsedMs: number
  /** Number of duplicate events skipped (optional) */
  duplicatesSkipped?: number
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
  /** Number of duplicate events skipped during replay */
  duplicatesSkipped?: number
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

  // Metrics
  private metrics?: RecoveryMetrics

  // Idempotency tracking
  private readonly idempotencyTracker: IdempotencyTracker

  constructor(options: RecoveryOptions) {
    this.namespace = options.namespace
    this.sql = options.sql
    this.iceberg = options.iceberg
    this.timeout = options.timeout ?? 30000 // 30s default
    this.onProgress = options.onProgress
    this.metrics = options.metrics
    this.idempotencyTracker = new IdempotencyTracker(options.idempotencyConfig)
  }

  /**
   * Set metrics collector (can be set after construction)
   */
  setMetrics(metrics: RecoveryMetrics): void {
    this.metrics = metrics
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

    let sqliteLoaded = 0
    let sqliteFailed = false

    // Try SQLite first (fast path)
    try {
      const sqliteResult = await this.loadFromSqlite()
      sqliteLoaded = sqliteResult.thingsLoaded

      // If SQLite has data and we have no Iceberg, return SQLite result
      if (sqliteLoaded > 0 && !this.iceberg) {
        return sqliteResult
      }
    } catch (error) {
      // SQLite failed (possibly corrupted), fall back to Iceberg
      console.warn('SQLite load failed, falling back to Iceberg:', error)
      // Track recovery error
      this.metrics?.errorsCount.inc()
      sqliteFailed = true
    }

    // Merge with Iceberg replay (handles partial checkpoint scenarios)
    // This replays from Iceberg while preserving SQLite state and deduplicating
    if (this.iceberg) {
      try {
        return await this.replayFromIceberg()
      } catch (error) {
        // Timeouts should be propagated - they indicate operational issues
        if (error instanceof Error && error.message.includes('timed out')) {
          throw error
        }
        // Other Iceberg replay failures fall through to empty state
        console.warn('Iceberg replay failed:', error)
        this.metrics?.errorsCount.inc()

        // If SQLite loaded data before Iceberg failed, return SQLite result
        if (sqliteLoaded > 0) {
          return this.createResult('sqlite', sqliteLoaded, 0)
        }
      }
    }

    // If SQLite loaded something (and Iceberg was not available), return that
    if (sqliteLoaded > 0 && !sqliteFailed) {
      return this.createResult('sqlite', sqliteLoaded, 0)
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

    // Track state size before replay to detect new entities from Iceberg
    const stateSizeBeforeReplay = this.state.size

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

    // Apply events in order with idempotency tracking
    let appliedCount = 0
    let processedCount = 0
    for (const event of events) {
      processedCount++

      // Check idempotency key to skip duplicates
      const idempotencyKey = (event as DomainEvent & { idempotencyKey?: string }).idempotencyKey
      if (idempotencyKey && this.idempotencyTracker.checkAndTrack(idempotencyKey, event.ts)) {
        // Duplicate event, skip it
        // Report progress periodically
        if (processedCount % 100 === 0 || processedCount === totalEvents) {
          this.reportProgress('applying', processedCount, totalEvents)
        }
        continue
      }

      this.applyEvent(event)
      appliedCount++

      // Report progress periodically
      if (processedCount % 100 === 0 || processedCount === totalEvents) {
        this.reportProgress('applying', processedCount, totalEvents)
      }
    }

    this.reportProgress('complete', this.state.size, totalEvents)

    // Determine source:
    // - If no events were applied, state came from SQLite (or empty)
    // - If state had items before and Iceberg added more, source is 'iceberg' (merge)
    // - If state was empty and Iceberg added items, source is 'iceberg'
    // - If state had items and Iceberg only updated existing (no new items), source is 'sqlite'
    const newEntitiesFromIceberg = this.state.size - stateSizeBeforeReplay
    let source: 'sqlite' | 'iceberg' | 'empty'

    if (appliedCount === 0) {
      // No events applied from Iceberg
      source = stateSizeBeforeReplay > 0 ? 'sqlite' : 'empty'
    } else if (stateSizeBeforeReplay > 0 && newEntitiesFromIceberg === 0) {
      // SQLite had data and Iceberg only updated existing entities (no new ones)
      // Treat this as SQLite being the authoritative source
      source = 'sqlite'
    } else if (newEntitiesFromIceberg > 0) {
      // Iceberg added new entities not in SQLite
      source = 'iceberg'
    } else {
      source = appliedCount > 0 ? 'iceberg' : 'empty'
    }

    return this.createResult(source, this.state.size, appliedCount)
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
        duplicatesSkipped: this.idempotencyTracker.duplicatesSkipped,
      })
    }
  }

  private createResult(
    source: RecoveryResult['source'],
    thingsLoaded: number,
    eventsReplayed: number
  ): RecoveryResult {
    const durationMs = performance.now() - this.startTime
    const duplicatesSkipped = this.idempotencyTracker.duplicatesSkipped

    // Update metrics
    this.metrics?.duration.observe(durationMs)
    this.metrics?.sourceCount[source as MetricRecoverySource]?.inc()
    this.metrics?.thingsLoaded.inc(thingsLoaded)
    this.metrics?.eventsReplayed.inc(eventsReplayed)

    return {
      source,
      thingsLoaded,
      eventsReplayed,
      durationMs,
      state: this.state,
      duplicatesSkipped,
    }
  }
}
