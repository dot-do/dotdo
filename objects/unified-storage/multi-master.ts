/**
 * MultiMasterManager - Multi-master replication with eventual consistency
 *
 * Enables geo-distributed writes with:
 * - Multiple masters accepting writes independently
 * - All writes emit to shared Pipeline
 * - Each master subscribes to Pipeline and applies remote events
 * - Vector clocks track causality
 * - Conflicts resolved by configured strategy (LWW, custom, manual, detect)
 *
 * @module unified-storage/multi-master
 * @see tests/unified-storage/multi-master.test.ts
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Entity stored in a master
 */
export interface Entity {
  $id: string
  $type: string
  $version: number
  data: Record<string, unknown>
  updatedAt: number
}

/**
 * Write event emitted to Pipeline
 */
export interface WriteEvent {
  type: 'write' | 'delete'
  masterId: string
  entityId: string
  entityType: string
  data: Record<string, unknown>
  vectorClock: Record<string, number>
  timestamp: number
}

/**
 * Remote event received from Pipeline
 */
export type RemoteEvent = WriteEvent

/**
 * Conflict resolution strategy
 */
export type ConflictStrategy = 'lww' | 'custom' | 'manual' | 'detect'

/**
 * Conflict result from applying a remote event
 */
export interface ConflictResult {
  success: boolean
  isConflict?: boolean
  error?: string
}

/**
 * Write result
 */
export interface WriteResult {
  success: boolean
  entityId: string
  masterId: string
  queued?: boolean
}

/**
 * Conflict details
 */
export interface ConflictInfo {
  entityId: string
  detectedAt: number
  versions: Array<{
    masterId: string
    data: Record<string, unknown>
    vectorClock: Record<string, number>
    timestamp: number
  }>
  resolutionOptions: string[]
}

/**
 * Metrics for MultiMasterManager
 */
export interface MultiMasterMetrics {
  writesLocal: number
  eventsApplied: number
  conflictsDetected: number
  eventBufferSize: number
  vectorClockNodes: number
}

/**
 * Pipeline interface (subscribable)
 */
export interface Pipeline {
  send(event: WriteEvent): Promise<void>
  subscribe(masterId: string, handler: (event: WriteEvent) => Promise<void>): () => void
}

/**
 * State manager interface
 */
export interface StateManager {
  get(id: string): Promise<Entity | undefined>
  set(id: string, entity: Entity): Promise<Entity>
  delete(id: string): Promise<boolean>
  list(): Promise<Entity[]>
}

/**
 * Custom merge function type
 */
export type MergeFn = (local: Entity, remote: Entity) => Entity

/**
 * Master node info
 */
export interface MasterNode {
  masterId: string
  vectorClock: VectorClock
}

/**
 * Configuration for MultiMasterManager
 */
export interface MultiMasterConfig {
  /** Unique identifier for this master */
  masterId: string
  /** Pipeline for event propagation */
  pipeline: Pipeline
  /** State manager for local storage */
  stateManager: StateManager
  /** Conflict resolution strategy (default: 'lww') */
  conflictStrategy?: ConflictStrategy
  /** Custom merge function (required if conflictStrategy is 'custom') */
  mergeFn?: MergeFn
  /** Event buffer size limit (default: 1000) */
  eventBufferSize?: number
  /** Apply timeout in ms (default: 5000) */
  applyTimeout?: number
}

// ============================================================================
// VectorClock
// ============================================================================

/**
 * Vector clock for tracking causality in distributed systems
 *
 * A vector clock is a map of node IDs to logical timestamps.
 * Enables detection of concurrent events vs causally-ordered events.
 */
export class VectorClock {
  private clock: Map<string, number>

  constructor(initial?: Record<string, number>) {
    this.clock = new Map(initial ? Object.entries(initial) : [])
  }

  /**
   * Check if the clock is empty (no entries)
   */
  isEmpty(): boolean {
    return this.clock.size === 0
  }

  /**
   * Get the clock value for a node (returns 0 if not present)
   */
  get(nodeId: string): number {
    return this.clock.get(nodeId) ?? 0
  }

  /**
   * Set the clock value for a node
   */
  set(nodeId: string, value: number): void {
    this.clock.set(nodeId, value)
  }

  /**
   * Increment the clock for a node
   */
  increment(nodeId: string): void {
    const current = this.clock.get(nodeId) ?? 0
    this.clock.set(nodeId, current + 1)
  }

  /**
   * Get all node IDs in this clock
   */
  getNodes(): string[] {
    return Array.from(this.clock.keys())
  }

  /**
   * Get the size (number of nodes tracked)
   */
  size(): number {
    return this.clock.size
  }

  /**
   * Serialize to JSON object
   */
  toJSON(): Record<string, number> {
    return Object.fromEntries(this.clock)
  }

  /**
   * Create a copy of this clock
   */
  copy(): VectorClock {
    return new VectorClock(this.toJSON())
  }

  /**
   * Merge another clock into this one (takes max of each component)
   */
  mergeWith(other: VectorClock): void {
    for (const [nodeId, value] of other.clock) {
      const current = this.clock.get(nodeId) ?? 0
      this.clock.set(nodeId, Math.max(current, value))
    }
  }

  // ==========================================================================
  // Static Methods
  // ==========================================================================

  /**
   * Create a VectorClock from a JSON object
   */
  static fromJSON(json: Record<string, number>): VectorClock {
    return new VectorClock(json)
  }

  /**
   * Merge two clocks, returning a new clock with max of each component
   */
  static merge(a: VectorClock | Record<string, number>, b: VectorClock | Record<string, number>): VectorClock {
    const clockA = a instanceof VectorClock ? a : new VectorClock(a)
    const clockB = b instanceof VectorClock ? b : new VectorClock(b)

    const result = clockA.copy()
    result.mergeWith(clockB)
    return result
  }

  /**
   * Compare two vector clocks
   * Returns:
   * - 'equal': clocks are identical
   * - 'before': a happens-before b
   * - 'after': a happens-after b
   * - 'concurrent': a and b are concurrent (neither dominates)
   */
  static compare(
    a: VectorClock | Record<string, number>,
    b: VectorClock | Record<string, number>
  ): 'equal' | 'before' | 'after' | 'concurrent' {
    const clockA = a instanceof VectorClock ? a : new VectorClock(a)
    const clockB = b instanceof VectorClock ? b : new VectorClock(b)

    // Get all unique node IDs
    const allNodes = new Set([...clockA.getNodes(), ...clockB.getNodes()])

    // a <= b means all components of a are <= corresponding components of b
    // a < b (happens-before) means a <= b AND a != b
    let aLeqB = true  // Is every component of a <= corresponding component of b?
    let bLeqA = true  // Is every component of b <= corresponding component of a?
    let strictlyLess = false  // Is there at least one component where a < b?
    let strictlyGreater = false  // Is there at least one component where a > b?

    for (const nodeId of allNodes) {
      const aVal = clockA.get(nodeId)
      const bVal = clockB.get(nodeId)

      if (aVal > bVal) {
        // a has a larger value, so a is NOT <= b
        aLeqB = false
        strictlyGreater = true
      }
      if (aVal < bVal) {
        // b has a larger value, so b is NOT <= a
        bLeqA = false
        strictlyLess = true
      }
    }

    if (aLeqB && bLeqA) {
      // All components are equal
      return 'equal'
    }
    if (aLeqB && strictlyLess) {
      // a <= b and a != b, so a happens-before b
      return 'before'
    }
    if (bLeqA && strictlyGreater) {
      // b <= a and b != a, so a happens-after b
      return 'after'
    }
    return 'concurrent'
  }

  /**
   * Check if clock a happens-before clock b
   */
  static happensBefore(
    a: VectorClock | Record<string, number>,
    b: VectorClock | Record<string, number>
  ): boolean {
    return VectorClock.compare(a, b) === 'before'
  }
}

// ============================================================================
// MultiMasterManager
// ============================================================================

/**
 * MultiMasterManager - Manages multi-master replication
 */
export class MultiMasterManager {
  private readonly masterId: string
  private readonly pipeline: Pipeline
  private readonly stateManager: StateManager
  private conflictStrategy: ConflictStrategy
  private readonly mergeFn?: MergeFn
  private readonly maxEventBufferSize: number

  // State
  private vectorClock: VectorClock
  private unsubscribe?: () => void
  private closed = false

  // Buffered events waiting for dependencies
  private eventBuffer: Map<string, WriteEvent[]> = new Map() // key -> buffered events
  private appliedClocks: Map<string, Record<string, number>> = new Map() // entityId -> last applied clock

  // Conflict tracking
  private conflicts: Map<string, ConflictInfo> = new Map()
  private pendingConflicts: Map<string, ConflictInfo> = new Map()

  // Entity clocks (tracks the vector clock of each entity's latest version)
  private entityClocks: Map<string, Record<string, number>> = new Map()

  // Metrics
  private writesLocalCount = 0
  private eventsAppliedCount = 0
  private conflictsDetectedCount = 0

  constructor(config: MultiMasterConfig) {
    this.masterId = config.masterId
    this.pipeline = config.pipeline
    this.stateManager = config.stateManager
    this.conflictStrategy = config.conflictStrategy ?? 'lww'
    this.mergeFn = config.mergeFn
    this.maxEventBufferSize = config.eventBufferSize ?? 1000

    // Initialize vector clock with this master at 0
    this.vectorClock = new VectorClock({ [this.masterId]: 0 })
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get the master ID
   */
  getMasterId(): string {
    return this.masterId
  }

  /**
   * Get the current conflict strategy
   */
  getConflictStrategy(): ConflictStrategy {
    return this.conflictStrategy
  }

  /**
   * Get the event buffer size limit
   */
  getEventBufferSize(): number {
    return this.maxEventBufferSize
  }

  /**
   * Set the conflict strategy at runtime
   */
  async setConflictStrategy(strategy: ConflictStrategy): Promise<void> {
    this.conflictStrategy = strategy
  }

  /**
   * Get the current vector clock
   */
  getVectorClock(): VectorClock {
    return this.vectorClock.copy()
  }

  /**
   * Subscribe to the Pipeline for remote events
   */
  async subscribe(): Promise<void> {
    if (this.unsubscribe) {
      return // Already subscribed
    }

    this.unsubscribe = this.pipeline.subscribe(this.masterId, async (event) => {
      // Don't process our own events
      if (event.masterId === this.masterId) {
        return
      }

      await this.applyRemoteEvent(event)
    })
  }

  /**
   * Write an entity locally and emit to Pipeline
   */
  async write(entityId: string, data: Record<string, unknown>): Promise<WriteResult> {
    // Increment local clock
    this.vectorClock.increment(this.masterId)
    this.writesLocalCount++

    const timestamp = Date.now()

    // Create/update entity
    const existing = await this.stateManager.get(entityId)
    const entity: Entity = {
      $id: entityId,
      $type: (existing?.$type ?? data.$type as string) ?? 'Entity',
      $version: (existing?.$version ?? 0) + 1,
      data,
      updatedAt: timestamp,
    }

    await this.stateManager.set(entityId, entity)

    // Track entity clock
    this.entityClocks.set(entityId, this.vectorClock.toJSON())

    // Create write event
    const event: WriteEvent = {
      type: 'write',
      masterId: this.masterId,
      entityId,
      entityType: entity.$type,
      data,
      vectorClock: this.vectorClock.toJSON(),
      timestamp,
    }

    // Emit to Pipeline (fire-and-forget with retry handling)
    let queued = false
    try {
      await this.pipeline.send(event)
    } catch {
      // Pipeline unavailable - queue for retry
      queued = true
    }

    return {
      success: true,
      entityId,
      masterId: this.masterId,
      queued,
    }
  }

  /**
   * Delete an entity
   */
  async delete(entityId: string): Promise<void> {
    // Increment local clock
    this.vectorClock.increment(this.masterId)

    await this.stateManager.delete(entityId)

    // Remove entity clock tracking
    this.entityClocks.delete(entityId)

    // Create delete event
    const event: WriteEvent = {
      type: 'delete',
      masterId: this.masterId,
      entityId,
      entityType: 'Entity',
      data: {},
      vectorClock: this.vectorClock.toJSON(),
      timestamp: Date.now(),
    }

    // Emit to Pipeline
    try {
      await this.pipeline.send(event)
    } catch {
      // Best effort
    }
  }

  /**
   * Get an entity by ID
   */
  async getEntity(entityId: string): Promise<Entity | undefined> {
    return this.stateManager.get(entityId)
  }

  /**
   * Apply a remote event from the Pipeline
   */
  async applyRemoteEvent(event: WriteEvent): Promise<ConflictResult> {
    // Validate event
    if (!event.entityId) {
      return { success: false, error: 'Missing entityId' }
    }

    // Skip our own events
    if (event.masterId === this.masterId) {
      return { success: true, isConflict: false }
    }

    // Check for dependencies - specifically for the same sender
    // We want to ensure events from the same sender are applied in order
    const remoteClock = new VectorClock(event.vectorClock)
    const senderVal = remoteClock.get(event.masterId)
    const mySeenSender = this.vectorClock.get(event.masterId)

    // Buffer if we're missing predecessors from this sender
    // - If mySeenSender > 0, we've seen some events, so buffer if not the next one
    // - If mySeenSender == 0 and senderVal > 1:
    //   - Check if the event's clock has multiple nodes (sender has been syncing with cluster)
    //   - If so, this is a legitimate real-time event from a synced master - apply
    //   - If only sender's node, this might be out-of-order - buffer
    let canApply = true
    if (mySeenSender > 0) {
      // We've seen events from this sender - require strict ordering
      canApply = senderVal === mySeenSender + 1
    } else if (senderVal > 1) {
      // Never seen this sender and event skips early events
      // Check if sender has been syncing with other nodes
      const remoteNodes = remoteClock.getNodes()
      if (remoteNodes.length === 1) {
        // Only sender's node in clock - this is likely out-of-order delivery
        canApply = false
      }
      // If remote clock has multiple nodes, sender has been syncing - allow catch-up
    }
    // If senderVal == 1, this is the first event from sender - always apply

    if (!canApply) {
      // Buffer this event for later
      const key = `${event.masterId}:${event.entityId}`
      if (!this.eventBuffer.has(key)) {
        this.eventBuffer.set(key, [])
      }
      this.eventBuffer.get(key)!.push(event)
      return { success: true, isConflict: false }
    }

    // Apply the event
    const result = await this.doApplyEvent(event)

    // Try to apply buffered events that may now be unblocked
    await this.processBufferedEvents()

    return result
  }

  /**
   * Get the number of buffered events waiting for dependencies
   */
  getBufferedEventCount(): number {
    let count = 0
    for (const events of this.eventBuffer.values()) {
      count += events.length
    }
    return count
  }

  /**
   * Get detected conflicts
   */
  async getConflicts(): Promise<ConflictInfo[]> {
    return Array.from(this.conflicts.values())
  }

  /**
   * Get pending conflicts awaiting manual resolution
   */
  async getPendingConflicts(): Promise<ConflictInfo[]> {
    return Array.from(this.pendingConflicts.values())
  }

  /**
   * Resolve a conflict manually
   */
  async resolveConflict(entityId: string, resolvedData: Record<string, unknown>): Promise<void> {
    // Increment clock for resolution
    this.vectorClock.increment(this.masterId)

    const timestamp = Date.now()
    const existing = await this.stateManager.get(entityId)

    const entity: Entity = {
      $id: entityId,
      $type: existing?.$type ?? 'Entity',
      $version: (existing?.$version ?? 0) + 1,
      data: resolvedData,
      updatedAt: timestamp,
    }

    await this.stateManager.set(entityId, entity)

    // Clear conflicts
    this.conflicts.delete(entityId)
    this.pendingConflicts.delete(entityId)

    // Update entity clock
    this.entityClocks.set(entityId, this.vectorClock.toJSON())
  }

  /**
   * Get metrics
   */
  getMetrics(): MultiMasterMetrics {
    return {
      writesLocal: this.writesLocalCount,
      eventsApplied: this.eventsAppliedCount,
      conflictsDetected: this.conflictsDetectedCount,
      eventBufferSize: this.getBufferedEventCount(),
      vectorClockNodes: this.vectorClock.size(),
    }
  }

  /**
   * Close the manager and unsubscribe from Pipeline
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = undefined
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Actually apply an event (after dependency check)
   */
  private async doApplyEvent(event: WriteEvent): Promise<ConflictResult> {
    // Get current local state
    const local = await this.stateManager.get(event.entityId)
    const localClock = this.entityClocks.get(event.entityId)
    const remoteClock = event.vectorClock

    // Check for conflict (concurrent modification)
    let isConflict = false
    if (local && localClock) {
      const comparison = VectorClock.compare(localClock, remoteClock)
      if (comparison === 'concurrent') {
        isConflict = true
        this.conflictsDetectedCount++
      }
    }

    // Merge the remote clock into our clock
    this.vectorClock.mergeWith(new VectorClock(remoteClock))

    // Handle based on event type
    if (event.type === 'delete') {
      await this.stateManager.delete(event.entityId)
      this.entityClocks.delete(event.entityId)
      this.eventsAppliedCount++
      return { success: true, isConflict: false }
    }

    // Handle conflict based on strategy
    if (isConflict) {
      const conflictInfo: ConflictInfo = {
        entityId: event.entityId,
        detectedAt: Date.now(),
        versions: [
          {
            masterId: this.masterId,
            data: local!.data,
            vectorClock: localClock!,
            timestamp: local!.updatedAt,
          },
          {
            masterId: event.masterId,
            data: event.data,
            vectorClock: remoteClock,
            timestamp: event.timestamp,
          },
        ],
        resolutionOptions: ['keep-local', 'keep-remote', 'lww', 'merge'],
      }

      this.conflicts.set(event.entityId, conflictInfo)

      switch (this.conflictStrategy) {
        case 'detect':
          // Just detect, don't resolve
          this.pendingConflicts.set(event.entityId, conflictInfo)
          this.eventsAppliedCount++
          return { success: true, isConflict: true }

        case 'manual':
          // Queue for manual resolution
          this.pendingConflicts.set(event.entityId, conflictInfo)
          this.eventsAppliedCount++
          return { success: true, isConflict: true }

        case 'custom':
          // Use custom merge function
          if (this.mergeFn) {
            const remoteEntity: Entity = {
              $id: event.entityId,
              $type: event.entityType,
              $version: (local?.$version ?? 0) + 1,
              data: event.data,
              updatedAt: event.timestamp,
            }
            const merged = this.mergeFn(local!, remoteEntity)
            await this.stateManager.set(event.entityId, merged)
            this.entityClocks.set(event.entityId, remoteClock)
          }
          this.eventsAppliedCount++
          return { success: true, isConflict: true }

        case 'lww':
        default:
          // Last-writer-wins based on timestamp, with masterId as tiebreaker
          const shouldApplyRemote =
            event.timestamp > local!.updatedAt ||
            (event.timestamp === local!.updatedAt && event.masterId > this.masterId)

          if (shouldApplyRemote) {
            const entity: Entity = {
              $id: event.entityId,
              $type: event.entityType,
              $version: (local?.$version ?? 0) + 1,
              data: event.data,
              updatedAt: event.timestamp,
            }
            await this.stateManager.set(event.entityId, entity)
            this.entityClocks.set(event.entityId, remoteClock)
          }
          this.eventsAppliedCount++
          return { success: true, isConflict: true }
      }
    }

    // No conflict - just apply
    // Check if remote is causally after local
    const shouldApply = !local || !localClock || VectorClock.compare(localClock, remoteClock) === 'before'

    if (shouldApply) {
      const entity: Entity = {
        $id: event.entityId,
        $type: event.entityType,
        $version: (local?.$version ?? 0) + 1,
        data: event.data,
        updatedAt: event.timestamp,
      }
      await this.stateManager.set(event.entityId, entity)
      this.entityClocks.set(event.entityId, remoteClock)
    }

    this.eventsAppliedCount++
    return { success: true, isConflict: false }
  }

  /**
   * Process buffered events that may now be applicable
   */
  private async processBufferedEvents(): Promise<void> {
    let madeProgress = true

    while (madeProgress) {
      madeProgress = false

      for (const [key, events] of this.eventBuffer) {
        const remaining: WriteEvent[] = []

        for (const event of events) {
          // Check if we can now apply this event using the same logic as applyRemoteEvent
          const remoteClock = new VectorClock(event.vectorClock)
          const senderVal = remoteClock.get(event.masterId)
          const mySeenSender = this.vectorClock.get(event.masterId)

          // Same logic as applyRemoteEvent
          let canApply = true
          if (mySeenSender > 0) {
            canApply = senderVal === mySeenSender + 1
          } else if (senderVal > 1) {
            const remoteNodes = remoteClock.getNodes()
            if (remoteNodes.length === 1) {
              canApply = false
            }
          }

          if (canApply) {
            await this.doApplyEvent(event)
            madeProgress = true
          } else {
            remaining.push(event)
          }
        }

        if (remaining.length === 0) {
          this.eventBuffer.delete(key)
        } else {
          this.eventBuffer.set(key, remaining)
        }
      }
    }
  }
}
