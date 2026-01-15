/**
 * Cold Start Recovery
 *
 * Restores state on DO startup from SQLite (L2) or Iceberg (L3).
 * Replays pipeline events to catch up to latest state.
 */

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
}

interface ThingData {
  $id: string
  $type: string
  $version?: number
  name?: string
  [key: string]: unknown
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
}

export class ColdStartRecovery {
  private sql: SqlStorage
  private iceberg?: IcebergReader
  private namespace: string
  private pipelineEvents: PipelineEvent[]

  constructor(options: RecoveryOptions) {
    this.sql = options.sql
    this.iceberg = options.iceberg
    this.namespace = options.namespace
    this.pipelineEvents = options.pipelineEvents ?? []
  }

  /**
   * Recover state from storage layers
   * Priority: SQLite (L2) -> Iceberg (L3) -> empty
   */
  async recover(): Promise<RecoveryResult> {
    const startTime = Date.now()
    const state = new Map<string, ThingData>()

    // Try SQLite first (L2)
    const sqliteResult = this.loadFromSQLite()
    if (sqliteResult.length > 0) {
      for (const thing of sqliteResult) {
        state.set(thing.$id, thing)
      }

      // Replay pipeline events on top of SQLite state
      const eventsReplayed = this.replayPipelineEvents(state)

      return {
        source: 'sqlite',
        thingsLoaded: sqliteResult.length,
        eventsReplayed,
        state,
        durationMs: Date.now() - startTime,
      }
    }

    // Fallback to Iceberg (L3)
    if (this.iceberg) {
      const icebergResult = await this.loadFromIceberg()
      if (icebergResult.events.length > 0) {
        // Replay events to reconstruct state
        for (const event of icebergResult.events) {
          this.applyEvent(state, event)
        }

        // Replay pipeline events on top of Iceberg state
        const pipelineEventsReplayed = this.replayPipelineEvents(state)

        return {
          source: 'iceberg',
          thingsLoaded: state.size,
          eventsReplayed: icebergResult.events.length + pipelineEventsReplayed,
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
   * Replay pipeline events that occurred after last checkpoint
   */
  private replayPipelineEvents(state: Map<string, ThingData>): number {
    for (const event of this.pipelineEvents) {
      this.applyEvent(state, event)
    }
    return this.pipelineEvents.length
  }
}
