/**
 * EventReplay - Event replay and projection capabilities
 *
 * Provides event sourcing functionality for business events:
 * - Event replay from any point in time
 * - Projection functions for state derivation
 * - Snapshot creation for fast replay
 * - Replay filtering by dimensions (5W+H)
 * - Idempotent replay handling with deduplication
 *
 * @module db/primitives/business-event-store/event-replay
 */

import type {
  BusinessEvent,
  EventQuery,
  EventType,
  EventAction,
  ObjectState,
  ObjectHistory,
} from './index'

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Projection function type - transforms events into derived state
 */
export type ProjectionFunction<TState> = (
  state: TState,
  event: BusinessEvent,
  context: ProjectionContext
) => TState

/**
 * Projection context provided to projection functions
 */
export interface ProjectionContext {
  /** Current event index in replay sequence */
  eventIndex: number
  /** Total events in replay sequence */
  totalEvents: number
  /** Replay start time */
  replayStartTime: Date
  /** Current replay position (event timestamp) */
  currentTime: Date
  /** Whether this is a snapshot restoration */
  isSnapshotRestore: boolean
}

/**
 * Replay filter options for dimension-based filtering
 */
export interface ReplayFilter {
  /** Filter by object IDs (what) */
  what?: string | string[]
  /** Filter by time range (when) */
  when?: { gte?: Date; lte?: Date }
  /** Filter by location (where) */
  where?: string | string[]
  /** Filter by business step (why) */
  why?: string | string[]
  /** Filter by party (who) */
  who?: string | string[]
  /** Filter by disposition (how) */
  how?: string | string[]
  /** Filter by event type */
  type?: EventType | EventType[]
  /** Filter by action */
  action?: EventAction | EventAction[]
  /** Filter by correlation ID */
  correlationId?: string
  /** Filter by causation chain (include all events caused by this event) */
  causedBy?: string
}

/**
 * Replay options for controlling replay behavior
 */
export interface ReplayOptions<TState = unknown> {
  /** Starting point for replay (timestamp or event ID) */
  from?: Date | string
  /** Ending point for replay (timestamp or event ID) */
  to?: Date | string
  /** Filter for dimension-based filtering */
  filter?: ReplayFilter
  /** Initial state for projection */
  initialState?: TState
  /** Snapshot to restore from (for fast replay) */
  snapshot?: Snapshot<TState>
  /** Batch size for processing events */
  batchSize?: number
  /** Enable idempotent replay (track processed events) */
  idempotent?: boolean
  /** Callback for progress updates */
  onProgress?: (progress: ReplayProgress) => void
  /** Callback for each event processed */
  onEvent?: (event: BusinessEvent, state: TState) => void
  /** Maximum events to process (for testing/debugging) */
  limit?: number
  /** Order of replay (default: ascending by time) */
  order?: 'asc' | 'desc'
}

/**
 * Replay result returned after replay completes
 */
export interface ReplayResult<TState = unknown> {
  /** Final projected state */
  state: TState
  /** Number of events processed */
  eventsProcessed: number
  /** Number of events skipped (duplicates, filtered) */
  eventsSkipped: number
  /** Time range of replayed events */
  timeRange: { start: Date; end: Date } | null
  /** Replay duration in milliseconds */
  durationMs: number
  /** Last event ID processed */
  lastEventId?: string
  /** Last event timestamp processed */
  lastEventTime?: Date
  /** Whether replay completed without errors */
  success: boolean
  /** Error if replay failed */
  error?: Error
}

/**
 * Replay progress information
 */
export interface ReplayProgress {
  /** Events processed so far */
  eventsProcessed: number
  /** Total events to process (if known) */
  totalEvents?: number
  /** Current event being processed */
  currentEvent?: BusinessEvent
  /** Percentage complete (0-100) */
  percentComplete?: number
  /** Estimated time remaining in milliseconds */
  estimatedTimeRemainingMs?: number
  /** Current projected state */
  currentState: unknown
}

/**
 * Snapshot for fast replay
 */
export interface Snapshot<TState = unknown> {
  /** Snapshot ID */
  id: string
  /** Projected state at snapshot time */
  state: TState
  /** Last event ID included in snapshot */
  lastEventId: string
  /** Last event timestamp included in snapshot */
  lastEventTime: Date
  /** Number of events aggregated into this snapshot */
  eventCount: number
  /** Snapshot creation time */
  createdAt: Date
  /** Snapshot version for compatibility checks */
  version: number
  /** Hash of state for integrity verification */
  stateHash: string
  /** Metadata about the snapshot */
  metadata?: Record<string, unknown>
}

/**
 * Snapshot policy configuration
 */
export interface SnapshotPolicy {
  /** Create snapshot every N events */
  everyNEvents?: number
  /** Create snapshot every N milliseconds */
  everyNMs?: number
  /** Maximum snapshots to retain */
  maxSnapshots?: number
  /** Snapshot retention period in milliseconds */
  retentionMs?: number
}

/**
 * Default snapshot policy
 */
export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = {
  everyNEvents: 1000,
  everyNMs: 3600000, // 1 hour
  maxSnapshots: 24,
  retentionMs: 86400000 * 7, // 7 days
}

/**
 * Idempotency tracker for replay deduplication
 */
export interface IdempotencyTracker {
  /** Track an event as processed */
  markProcessed(eventId: string): void
  /** Check if event was already processed */
  isProcessed(eventId: string): boolean
  /** Get all processed event IDs */
  getProcessedIds(): Set<string>
  /** Clear tracking state */
  clear(): void
  /** Get tracker statistics */
  getStats(): { processedCount: number; memoryUsage: number }
}

// =============================================================================
// Built-in Projection Functions
// =============================================================================

/**
 * Built-in projection that tracks object state (location, disposition, etc.)
 */
export function objectStateProjection(
  state: Map<string, ObjectState>,
  event: BusinessEvent,
  context: ProjectionContext
): Map<string, ObjectState> {
  for (const objectId of event.what) {
    const existing = state.get(objectId) || {}
    const updated: ObjectState = { ...existing }

    if (event.where) {
      updated.location = event.where
    }
    if (event.how) {
      updated.disposition = event.how
    }
    updated.lastEventTime = event.when

    // Handle aggregation events (parent container tracking)
    if (event.type === 'AggregationEvent' && 'parentID' in event) {
      const aggEvent = event as BusinessEvent & { parentID: string; childEPCs?: string[] }
      if (event.action === 'ADD' && aggEvent.childEPCs?.includes(objectId)) {
        updated.parentContainer = aggEvent.parentID
      } else if (event.action === 'DELETE' && aggEvent.childEPCs?.includes(objectId)) {
        updated.parentContainer = undefined
      }
    }

    state.set(objectId, updated)
  }

  return state
}

/**
 * Built-in projection that counts events by type
 */
export function eventCountProjection(
  state: Map<EventType, number>,
  event: BusinessEvent,
  context: ProjectionContext
): Map<EventType, number> {
  const current = state.get(event.type) || 0
  state.set(event.type, current + 1)
  return state
}

/**
 * Built-in projection that tracks events by location
 */
export function locationHistoryProjection(
  state: Map<string, BusinessEvent[]>,
  event: BusinessEvent,
  context: ProjectionContext
): Map<string, BusinessEvent[]> {
  if (event.where) {
    const events = state.get(event.where) || []
    events.push(event)
    state.set(event.where, events)
  }
  return state
}

/**
 * Built-in projection that tracks causation chains
 */
export function causationProjection(
  state: Map<string, string[]>,
  event: BusinessEvent,
  context: ProjectionContext
): Map<string, string[]> {
  if (event.causedBy) {
    const children = state.get(event.causedBy) || []
    children.push(event.id)
    state.set(event.causedBy, children)
  }
  return state
}

/**
 * Built-in projection that builds object history
 */
export function objectHistoryProjection(
  state: Map<string, ObjectHistory>,
  event: BusinessEvent,
  context: ProjectionContext
): Map<string, ObjectHistory> {
  for (const objectId of event.what) {
    let history = state.get(objectId)
    if (!history) {
      history = {
        objectId,
        events: [],
        currentState: undefined,
      }
      state.set(objectId, history)
    }

    history.events.push(event)

    // Update current state
    if (!history.currentState) {
      history.currentState = {}
    }
    if (event.where) {
      history.currentState.location = event.where
    }
    if (event.how) {
      history.currentState.disposition = event.how
    }
    history.currentState.lastEventTime = event.when
  }

  return state
}

/**
 * Built-in projection that aggregates metrics over time windows
 */
export function timeWindowAggregationProjection(
  state: { windows: Map<number, { count: number; events: BusinessEvent[] }>; windowSizeMs: number },
  event: BusinessEvent,
  context: ProjectionContext
): typeof state {
  const windowStart = Math.floor(event.when.getTime() / state.windowSizeMs) * state.windowSizeMs

  let window = state.windows.get(windowStart)
  if (!window) {
    window = { count: 0, events: [] }
    state.windows.set(windowStart, window)
  }

  window.count++
  window.events.push(event)

  return state
}

// =============================================================================
// IdempotencyTracker Implementation
// =============================================================================

/**
 * In-memory idempotency tracker
 */
class InMemoryIdempotencyTracker implements IdempotencyTracker {
  private processedIds: Set<string> = new Set()

  markProcessed(eventId: string): void {
    this.processedIds.add(eventId)
  }

  isProcessed(eventId: string): boolean {
    return this.processedIds.has(eventId)
  }

  getProcessedIds(): Set<string> {
    return new Set(this.processedIds)
  }

  clear(): void {
    this.processedIds.clear()
  }

  getStats(): { processedCount: number; memoryUsage: number } {
    return {
      processedCount: this.processedIds.size,
      // Approximate: ~50 bytes per event ID
      memoryUsage: this.processedIds.size * 50,
    }
  }
}

// =============================================================================
// EventReplayer Class
// =============================================================================

/**
 * Event replayer for projecting state from event streams
 */
export class EventReplayer<TState = unknown> {
  private projection: ProjectionFunction<TState>
  private idempotencyTracker: IdempotencyTracker | null = null
  private snapshots: Map<string, Snapshot<TState>> = new Map()
  private snapshotPolicy: SnapshotPolicy
  private eventsSinceLastSnapshot: number = 0
  private lastSnapshotTime: Date | null = null

  constructor(
    projection: ProjectionFunction<TState>,
    snapshotPolicy: Partial<SnapshotPolicy> = {}
  ) {
    this.projection = projection
    this.snapshotPolicy = { ...DEFAULT_SNAPSHOT_POLICY, ...snapshotPolicy }
  }

  /**
   * Replay events and project state
   */
  async replay(
    events: BusinessEvent[] | AsyncIterable<BusinessEvent>,
    options: ReplayOptions<TState> = {}
  ): Promise<ReplayResult<TState>> {
    const startTime = performance.now()
    let state = this.getInitialState(options)
    let eventsProcessed = 0
    let eventsSkipped = 0
    let firstEvent: BusinessEvent | null = null
    let lastEvent: BusinessEvent | null = null

    // Setup idempotency tracking if enabled (reuse existing or create new)
    if (options.idempotent && !this.idempotencyTracker) {
      this.idempotencyTracker = new InMemoryIdempotencyTracker()
    }

    // Apply snapshot if provided
    if (options.snapshot) {
      state = options.snapshot.state
      this.eventsSinceLastSnapshot = 0
      this.lastSnapshotTime = options.snapshot.createdAt
    }

    try {
      // Process events
      const filteredEvents = this.filterEvents(events, options)
      const orderedEvents = this.orderEvents(filteredEvents, options.order || 'asc')

      for await (const event of orderedEvents) {
        // Check limit
        if (options.limit !== undefined && eventsProcessed >= options.limit) {
          break
        }

        // Idempotency check
        if (this.idempotencyTracker?.isProcessed(event.id)) {
          eventsSkipped++
          continue
        }

        // Check time range
        if (!this.isInTimeRange(event, options)) {
          eventsSkipped++
          continue
        }

        // Track first/last events
        if (!firstEvent) {
          firstEvent = event
        }
        lastEvent = event

        // Build projection context
        const context: ProjectionContext = {
          eventIndex: eventsProcessed,
          totalEvents: Array.isArray(events) ? events.length : -1,
          replayStartTime: new Date(startTime),
          currentTime: event.when,
          isSnapshotRestore: !!options.snapshot && eventsProcessed === 0,
        }

        // Apply projection
        state = this.projection(state, event, context)
        eventsProcessed++

        // Mark as processed for idempotency
        this.idempotencyTracker?.markProcessed(event.id)

        // Callback for each event
        if (options.onEvent) {
          options.onEvent(event, state)
        }

        // Progress callback
        if (options.onProgress) {
          options.onProgress({
            eventsProcessed,
            totalEvents: Array.isArray(events) ? events.length : undefined,
            currentEvent: event,
            percentComplete: Array.isArray(events)
              ? (eventsProcessed / events.length) * 100
              : undefined,
            currentState: state,
          })
        }

        // Check if we should create a snapshot
        this.checkSnapshotCreation(state, event, eventsProcessed)
      }

      return {
        state,
        eventsProcessed,
        eventsSkipped,
        timeRange: firstEvent && lastEvent
          ? { start: firstEvent.when, end: lastEvent.when }
          : null,
        durationMs: performance.now() - startTime,
        lastEventId: lastEvent?.id,
        lastEventTime: lastEvent?.when,
        success: true,
      }
    } catch (error) {
      return {
        state,
        eventsProcessed,
        eventsSkipped,
        timeRange: firstEvent && lastEvent
          ? { start: firstEvent.when, end: lastEvent.when }
          : null,
        durationMs: performance.now() - startTime,
        lastEventId: lastEvent?.id,
        lastEventTime: lastEvent?.when,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  /**
   * Create a snapshot of current state
   */
  createSnapshot(
    state: TState,
    lastEvent: BusinessEvent,
    eventCount: number,
    metadata?: Record<string, unknown>
  ): Snapshot<TState> {
    const snapshot: Snapshot<TState> = {
      id: this.generateSnapshotId(),
      state,
      lastEventId: lastEvent.id,
      lastEventTime: lastEvent.when,
      eventCount,
      createdAt: new Date(),
      version: 1,
      stateHash: this.computeStateHash(state),
      metadata,
    }

    this.snapshots.set(snapshot.id, snapshot)
    this.enforceSnapshotRetention()

    return snapshot
  }

  /**
   * Get the most recent snapshot before a given time
   */
  getSnapshotBefore(time: Date): Snapshot<TState> | null {
    let bestSnapshot: Snapshot<TState> | null = null
    let bestTime: number = 0

    for (const snapshot of this.snapshots.values()) {
      const snapshotTime = snapshot.lastEventTime.getTime()
      if (snapshotTime <= time.getTime() && snapshotTime > bestTime) {
        bestSnapshot = snapshot
        bestTime = snapshotTime
      }
    }

    return bestSnapshot
  }

  /**
   * Get all snapshots
   */
  getSnapshots(): Snapshot<TState>[] {
    return Array.from(this.snapshots.values())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  /**
   * Get snapshot by ID
   */
  getSnapshot(id: string): Snapshot<TState> | null {
    return this.snapshots.get(id) ?? null
  }

  /**
   * Delete a snapshot
   */
  deleteSnapshot(id: string): boolean {
    return this.snapshots.delete(id)
  }

  /**
   * Clear all snapshots
   */
  clearSnapshots(): void {
    this.snapshots.clear()
  }

  /**
   * Get idempotency tracker statistics
   */
  getIdempotencyStats(): { processedCount: number; memoryUsage: number } | null {
    return this.idempotencyTracker?.getStats() ?? null
  }

  /**
   * Clear idempotency tracking state
   */
  clearIdempotencyState(): void {
    this.idempotencyTracker?.clear()
    this.idempotencyTracker = null
  }

  /**
   * Verify snapshot integrity
   */
  verifySnapshot(snapshot: Snapshot<TState>): boolean {
    const currentHash = this.computeStateHash(snapshot.state)
    return currentHash === snapshot.stateHash
  }

  private getInitialState(options: ReplayOptions<TState>): TState {
    if (options.initialState !== undefined) {
      return options.initialState
    }
    // Return a default empty state - caller should provide initialState for non-trivial types
    return undefined as TState
  }

  private async *filterEvents(
    events: BusinessEvent[] | AsyncIterable<BusinessEvent>,
    options: ReplayOptions<TState>
  ): AsyncGenerator<BusinessEvent> {
    const filter = options.filter
    if (!filter) {
      for await (const event of events) {
        yield event
      }
      return
    }

    for await (const event of events) {
      if (this.matchesFilter(event, filter)) {
        yield event
      }
    }
  }

  private matchesFilter(event: BusinessEvent, filter: ReplayFilter): boolean {
    // Filter by what (object IDs)
    if (filter.what) {
      const whats = Array.isArray(filter.what) ? filter.what : [filter.what]
      const hasMatch = event.what.some((w) => whats.includes(w))
      if (!hasMatch) return false
    }

    // Filter by where (location)
    if (filter.where) {
      const wheres = Array.isArray(filter.where) ? filter.where : [filter.where]
      if (!event.where || !wheres.includes(event.where)) return false
    }

    // Filter by why (business step)
    if (filter.why) {
      const whys = Array.isArray(filter.why) ? filter.why : [filter.why]
      if (!event.why || !whys.includes(event.why)) return false
    }

    // Filter by who (party)
    if (filter.who) {
      const whos = Array.isArray(filter.who) ? filter.who : [filter.who]
      if (!event.who || !whos.includes(event.who)) return false
    }

    // Filter by how (disposition)
    if (filter.how) {
      const hows = Array.isArray(filter.how) ? filter.how : [filter.how]
      if (!event.how || !hows.includes(event.how)) return false
    }

    // Filter by type
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type]
      if (!types.includes(event.type)) return false
    }

    // Filter by action
    if (filter.action) {
      const actions = Array.isArray(filter.action) ? filter.action : [filter.action]
      if (!event.action || !actions.includes(event.action)) return false
    }

    // Filter by correlation ID
    if (filter.correlationId) {
      if (event.correlationId !== filter.correlationId) return false
    }

    // Filter by causation
    if (filter.causedBy) {
      if (event.causedBy !== filter.causedBy) return false
    }

    return true
  }

  private isInTimeRange(event: BusinessEvent, options: ReplayOptions<TState>): boolean {
    if (options.from) {
      const fromTime = options.from instanceof Date
        ? options.from.getTime()
        : this.parseEventIdTime(options.from)
      if (fromTime !== null && event.when.getTime() < fromTime) {
        return false
      }
    }

    if (options.to) {
      const toTime = options.to instanceof Date
        ? options.to.getTime()
        : this.parseEventIdTime(options.to)
      if (toTime !== null && event.when.getTime() > toTime) {
        return false
      }
    }

    return true
  }

  private parseEventIdTime(eventId: string): number | null {
    // Event IDs are formatted as evt_{timestamp36}_{random}
    const match = eventId.match(/^evt_([a-z0-9]+)_/)
    if (match) {
      return parseInt(match[1]!, 36)
    }
    return null
  }

  private async *orderEvents(
    events: AsyncIterable<BusinessEvent>,
    order: 'asc' | 'desc'
  ): AsyncGenerator<BusinessEvent> {
    // Collect all events for sorting
    const allEvents: BusinessEvent[] = []
    for await (const event of events) {
      allEvents.push(event)
    }

    // Sort by timestamp
    allEvents.sort((a, b) => {
      const diff = a.when.getTime() - b.when.getTime()
      return order === 'asc' ? diff : -diff
    })

    for (const event of allEvents) {
      yield event
    }
  }

  private checkSnapshotCreation(
    state: TState,
    event: BusinessEvent,
    eventsProcessed: number
  ): void {
    this.eventsSinceLastSnapshot++

    const now = Date.now()
    const shouldCreateByCount =
      this.snapshotPolicy.everyNEvents &&
      this.eventsSinceLastSnapshot >= this.snapshotPolicy.everyNEvents

    const shouldCreateByTime =
      this.snapshotPolicy.everyNMs &&
      this.lastSnapshotTime &&
      now - this.lastSnapshotTime.getTime() >= this.snapshotPolicy.everyNMs

    if (shouldCreateByCount || shouldCreateByTime) {
      this.createSnapshot(state, event, eventsProcessed)
      this.eventsSinceLastSnapshot = 0
      this.lastSnapshotTime = new Date()
    }
  }

  private enforceSnapshotRetention(): void {
    // Enforce max snapshots
    if (this.snapshotPolicy.maxSnapshots) {
      const snapshots = this.getSnapshots()
      while (snapshots.length > this.snapshotPolicy.maxSnapshots) {
        const oldest = snapshots.shift()
        if (oldest) {
          this.snapshots.delete(oldest.id)
        }
      }
    }

    // Enforce retention period
    if (this.snapshotPolicy.retentionMs) {
      const cutoff = Date.now() - this.snapshotPolicy.retentionMs
      for (const [id, snapshot] of this.snapshots) {
        if (snapshot.createdAt.getTime() < cutoff) {
          this.snapshots.delete(id)
        }
      }
    }
  }

  private generateSnapshotId(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 8)
    return `snap_${timestamp}_${random}`
  }

  private computeStateHash(state: TState): string {
    // Simple hash based on JSON serialization
    const json = JSON.stringify(state, (key, value) => {
      if (value instanceof Map) {
        return { __type: 'Map', entries: Array.from(value.entries()) }
      }
      if (value instanceof Set) {
        return { __type: 'Set', values: Array.from(value) }
      }
      if (value instanceof Date) {
        return { __type: 'Date', value: value.toISOString() }
      }
      return value
    })

    // FNV-1a hash
    let hash = 2166136261
    for (let i = 0; i < json.length; i++) {
      hash ^= json.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  }
}

// =============================================================================
// EventProjector Class (Convenience wrapper)
// =============================================================================

/**
 * Convenience class for common projection patterns
 */
export class EventProjector {
  /**
   * Project object states from events
   */
  static async projectObjectStates(
    events: BusinessEvent[],
    options: Omit<ReplayOptions<Map<string, ObjectState>>, 'initialState'> = {}
  ): Promise<Map<string, ObjectState>> {
    const replayer = new EventReplayer(objectStateProjection)
    const result = await replayer.replay(events, {
      ...options,
      initialState: new Map(),
    })
    return result.state
  }

  /**
   * Count events by type
   */
  static async countEventsByType(
    events: BusinessEvent[],
    options: Omit<ReplayOptions<Map<EventType, number>>, 'initialState'> = {}
  ): Promise<Map<EventType, number>> {
    const replayer = new EventReplayer(eventCountProjection)
    const result = await replayer.replay(events, {
      ...options,
      initialState: new Map(),
    })
    return result.state
  }

  /**
   * Get events by location
   */
  static async getEventsByLocation(
    events: BusinessEvent[],
    options: Omit<ReplayOptions<Map<string, BusinessEvent[]>>, 'initialState'> = {}
  ): Promise<Map<string, BusinessEvent[]>> {
    const replayer = new EventReplayer(locationHistoryProjection)
    const result = await replayer.replay(events, {
      ...options,
      initialState: new Map(),
    })
    return result.state
  }

  /**
   * Build object histories
   */
  static async buildObjectHistories(
    events: BusinessEvent[],
    options: Omit<ReplayOptions<Map<string, ObjectHistory>>, 'initialState'> = {}
  ): Promise<Map<string, ObjectHistory>> {
    const replayer = new EventReplayer(objectHistoryProjection)
    const result = await replayer.replay(events, {
      ...options,
      initialState: new Map(),
    })
    return result.state
  }

  /**
   * Build causation graph
   */
  static async buildCausationGraph(
    events: BusinessEvent[],
    options: Omit<ReplayOptions<Map<string, string[]>>, 'initialState'> = {}
  ): Promise<Map<string, string[]>> {
    const replayer = new EventReplayer(causationProjection)
    const result = await replayer.replay(events, {
      ...options,
      initialState: new Map(),
    })
    return result.state
  }

  /**
   * Aggregate events by time window
   */
  static async aggregateByTimeWindow(
    events: BusinessEvent[],
    windowSizeMs: number,
    options: Omit<ReplayOptions<{ windows: Map<number, { count: number; events: BusinessEvent[] }>; windowSizeMs: number }>, 'initialState'> = {}
  ): Promise<Map<number, { count: number; events: BusinessEvent[] }>> {
    const replayer = new EventReplayer(timeWindowAggregationProjection)
    const result = await replayer.replay(events, {
      ...options,
      initialState: { windows: new Map(), windowSizeMs },
    })
    return result.state.windows
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an event replayer with a custom projection
 */
export function createEventReplayer<TState>(
  projection: ProjectionFunction<TState>,
  snapshotPolicy?: Partial<SnapshotPolicy>
): EventReplayer<TState> {
  return new EventReplayer(projection, snapshotPolicy)
}

/**
 * Create an idempotency tracker
 */
export function createIdempotencyTracker(): IdempotencyTracker {
  return new InMemoryIdempotencyTracker()
}

/**
 * Compose multiple projections into a single projection
 */
export function composeProjections<TState extends Record<string, unknown>>(
  projections: {
    [K in keyof TState]: ProjectionFunction<TState[K]>
  }
): ProjectionFunction<TState> {
  return (state: TState, event: BusinessEvent, context: ProjectionContext): TState => {
    const result = { ...state }
    for (const key of Object.keys(projections) as (keyof TState)[]) {
      const projection = projections[key]
      if (projection) {
        result[key] = projection(state[key], event, context)
      }
    }
    return result
  }
}

/**
 * Create a filtered projection that only processes matching events
 */
export function createFilteredProjection<TState>(
  projection: ProjectionFunction<TState>,
  filter: ReplayFilter
): ProjectionFunction<TState> {
  const replayer = new EventReplayer(projection)

  return (state: TState, event: BusinessEvent, context: ProjectionContext): TState => {
    // Use the internal matchesFilter logic
    const whats = filter.what ? (Array.isArray(filter.what) ? filter.what : [filter.what]) : null
    const wheres = filter.where ? (Array.isArray(filter.where) ? filter.where : [filter.where]) : null
    const whys = filter.why ? (Array.isArray(filter.why) ? filter.why : [filter.why]) : null
    const whos = filter.who ? (Array.isArray(filter.who) ? filter.who : [filter.who]) : null
    const hows = filter.how ? (Array.isArray(filter.how) ? filter.how : [filter.how]) : null
    const types = filter.type ? (Array.isArray(filter.type) ? filter.type : [filter.type]) : null
    const actions = filter.action ? (Array.isArray(filter.action) ? filter.action : [filter.action]) : null

    if (whats && !event.what.some((w) => whats.includes(w))) return state
    if (wheres && (!event.where || !wheres.includes(event.where))) return state
    if (whys && (!event.why || !whys.includes(event.why))) return state
    if (whos && (!event.who || !whos.includes(event.who))) return state
    if (hows && (!event.how || !hows.includes(event.how))) return state
    if (types && !types.includes(event.type)) return state
    if (actions && (!event.action || !actions.includes(event.action))) return state
    if (filter.correlationId && event.correlationId !== filter.correlationId) return state
    if (filter.causedBy && event.causedBy !== filter.causedBy) return state

    return projection(state, event, context)
  }
}
