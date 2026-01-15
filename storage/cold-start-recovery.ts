/**
 * Cold Start Recovery
 *
 * Restores state on DO startup from SQLite (L2) or Iceberg (L3).
 * Replays pipeline events to catch up to latest state.
 */

// Import canonical types from types/index.ts
import type { ThingData } from '../types'

export interface RecoveryResult {
  source: 'sqlite' | 'iceberg' | 'empty'
  thingsLoaded: number
  eventsReplayed: number
  state: Map<string, ThingData>
  durationMs: number
}

export interface RecoveryOptions {
  sql: SqlStorage
  iceberg?: IcebergReader
  namespace: string
  pipelineEvents?: PipelineEvent[]
  seenIdempotencyKeys?: Set<string> // For cross-session deduplication
}

interface SqlStorage {
  exec(query: string, ...params: unknown[]): { toArray(): Array<{ id: string; type: string; data: string }> }
}

interface IcebergReader {
  query(options?: unknown): Promise<IcebergEvent[]>
}

interface IcebergEvent {
  type: string
  entityId: string
  payload: Partial<ThingData>
  ts: number
  version?: number
}

interface PipelineEvent {
  type: string
  entityId: string
  payload: Partial<ThingData>
  ts: number
  idempotencyKey?: string
}

export class ColdStartRecovery {
  private sql: SqlStorage
  private iceberg?: IcebergReader
  private namespace: string
  private pipelineEvents: PipelineEvent[]
  private seenIdempotencyKeys: Set<string>

  constructor(options: RecoveryOptions) {
    this.sql = options.sql
    this.iceberg = options.iceberg
    this.namespace = options.namespace
    this.pipelineEvents = options.pipelineEvents ?? []
    this.seenIdempotencyKeys = options.seenIdempotencyKeys ?? new Set()
  }

  /**
   * Get all seen idempotency keys (for cross-session tracking)
   */
  getSeenIdempotencyKeys(): Set<string> {
    return new Set(this.seenIdempotencyKeys)
  }

  /**
   * Recover state from storage layers.
   * Priority: SQLite (L2) -> Iceberg (L3) -> empty
   *
   * Always replays pipeline events on top of the recovered base state
   * to ensure consistency after the last checkpoint.
   *
   * @returns Recovery result with source, loaded things, replayed events, and state
   */
  async recover(): Promise<RecoveryResult> {
    const startTime = Date.now()
    const state = new Map<string, ThingData>()
    let baseThingsLoaded = 0
    let baseEventsReplayed = 0

    // Try SQLite first (L2)
    const sqliteThings = this.loadFromSQLite()
    if (sqliteThings.length > 0) {
      for (const thing of sqliteThings) {
        state.set(thing.$id, thing)
      }
      baseThingsLoaded = sqliteThings.length

      const eventsReplayed = this.replayPipelineEvents(state)
      return {
        source: 'sqlite',
        thingsLoaded: baseThingsLoaded,
        eventsReplayed,
        state,
        durationMs: Date.now() - startTime,
      }
    }

    // Fallback to Iceberg (L3)
    if (this.iceberg) {
      const icebergEvents = (await this.loadFromIceberg()).events
      if (icebergEvents.length > 0) {
        // Replay Iceberg events to reconstruct state
        for (const event of icebergEvents) {
          this.applyEvent(state, event)
        }
        baseEventsReplayed = icebergEvents.length

        // Replay pipeline events on top of Iceberg state
        const pipelineEventsReplayed = this.replayPipelineEvents(state)

        return {
          source: 'iceberg',
          thingsLoaded: state.size,
          eventsReplayed: baseEventsReplayed + pipelineEventsReplayed,
          state,
          durationMs: Date.now() - startTime,
        }
      }
    }

    // Replay pipeline events even if no base state (for fresh DO)
    const eventsReplayed = this.replayPipelineEvents(state)

    // Empty state
    return {
      source: 'empty',
      thingsLoaded: 0,
      eventsReplayed,
      state,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Load things from SQLite
   */
  private loadFromSQLite(): ThingData[] {
    const result = this.sql.exec('SELECT id, type, data FROM things')
    const rows = result.toArray()

    return rows.map((row) => {
      const data = JSON.parse(row.data) as ThingData
      return data
    })
  }

  /**
   * Load events from Iceberg
   */
  private async loadFromIceberg(): Promise<{ events: IcebergEvent[] }> {
    if (!this.iceberg) {
      return { events: [] }
    }

    const events = await this.iceberg.query({ namespace: this.namespace })
    // Sort by timestamp
    events.sort((a, b) => a.ts - b.ts)
    return { events }
  }

  /**
   * Apply an event to reconstruct state
   */
  private applyEvent(
    state: Map<string, ThingData>,
    event: IcebergEvent | PipelineEvent
  ): void {
    const { type, entityId, payload } = event

    if (type === 'thing.created') {
      const thing: ThingData = {
        $id: entityId,
        $type: (payload as ThingData).$type ?? 'Unknown',
        $version: 1,
        ...payload,
      }
      state.set(entityId, thing)
    } else if (type === 'thing.updated') {
      const existing = state.get(entityId)
      if (existing) {
        const updated: ThingData = {
          ...existing,
          ...payload,
          $id: existing.$id,
          $type: existing.$type,
          $version: (existing.$version ?? 0) + 1,
        }
        state.set(entityId, updated)
      } else {
        // Create if doesn't exist (event sourcing - create from update)
        const thing: ThingData = {
          $id: entityId,
          $type: (payload as ThingData).$type ?? 'Unknown',
          $version: 1,
          ...payload,
        }
        state.set(entityId, thing)
      }
    } else if (type === 'thing.deleted') {
      state.delete(entityId)
    }
  }

  /**
   * Replay pipeline events that occurred after last checkpoint.
   * Deduplicates events by idempotency key.
   */
  private replayPipelineEvents(state: Map<string, ThingData>): number {
    let replayed = 0

    for (const event of this.pipelineEvents) {
      // Deduplicate by idempotency key
      if (event.idempotencyKey) {
        if (this.seenIdempotencyKeys.has(event.idempotencyKey)) {
          // Skip duplicate event
          continue
        }
        // Track this key
        this.seenIdempotencyKeys.add(event.idempotencyKey)
      }

      this.applyEvent(state, event)
      replayed++
    }

    return replayed
  }
}
