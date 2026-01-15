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
export type ConflictStrategy = 'lww' | 'custom' | 'manual' | 'detect' | 'crdt'

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

// Re-export unified Pipeline interface from shared types
export type { Pipeline } from './types/pipeline'
import type { Pipeline as BasePipeline } from './types/pipeline'

/**
 * Pipeline interface with subscription support for MultiMaster
 *
 * Extends the base Pipeline with subscribe() for multi-master replication.
 * Uses the canonical batch send() interface from unified types.
 */
export interface MultiMasterPipeline extends BasePipeline {
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
  /** Pipeline for event propagation (uses batch interface with subscribe support) */
  pipeline: MultiMasterPipeline
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
  private readonly pipeline: MultiMasterPipeline
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
  private senderEntityClocks: Map<string, number> = new Map() // sender:entity -> last applied clock value from that sender

  // Conflict tracking
  private conflicts: Map<string, ConflictInfo> = new Map()
  private pendingConflicts: Map<string, ConflictInfo> = new Map()

  // Entity clocks (tracks the vector clock of each entity's latest version)
  private entityClocks: Map<string, Record<string, number>> = new Map()

  // Metrics
  private writesLocalCount = 0
  private eventsAppliedCount = 0
  private conflictsDetectedCount = 0

  // Pending writes queue (for partition recovery)
  private pendingWrites: WriteEvent[] = []

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
   * Get the maximum event buffer size limit
   *
   * The event buffer stores out-of-order events waiting for their dependencies.
   * When the buffer reaches this limit, the oldest events are evicted (FIFO).
   * A value of 0 disables buffering entirely.
   *
   * @returns The maximum number of events that can be buffered
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
    // Uses batch interface - wrap single event in array
    let queued = false
    try {
      await this.pipeline.send([event])
    } catch {
      // Pipeline unavailable - queue for retry
      queued = true
      this.pendingWrites.push(event)
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

    // Emit to Pipeline (batch interface - wrap single event in array)
    try {
      await this.pipeline.send([event])
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

    // Check for dependencies using a hybrid approach:
    // 1. Use global sender clock for sequential ordering across all entities
    // 2. Use per-entity clock for within-entity ordering
    const remoteClock = new VectorClock(event.vectorClock)
    const senderVal = remoteClock.get(event.masterId)
    const globalSeenSender = this.vectorClock.get(event.masterId)
    const senderEntityKey = `${event.masterId}:${event.entityId}`
    const mySeenSenderEntity = this.senderEntityClocks.get(senderEntityKey) ?? 0

    // Determine if we can apply this event:
    // 1. If it's the next event we expect from this sender globally (senderVal === globalSeenSender + 1), apply
    // 2. If we've seen events for this specific entity, require strict per-entity ordering
    // 3. If senderVal is 1, it's the first event from sender - always apply
    // 4. If sender has multiple nodes in clock (been syncing), allow catch-up
    let canApply = true

    // First check: is this the next event in global sequence from this sender?
    const isNextGlobalEvent = senderVal === globalSeenSender + 1

    if (isNextGlobalEvent) {
      // Sequential in global order - always apply
      canApply = true
    } else if (mySeenSenderEntity > 0) {
      // We've seen events from this sender for this entity - require strict per-entity ordering
      canApply = senderVal === mySeenSenderEntity + 1
    } else if (senderVal > 1) {
      // Never seen this sender for this entity, not next global event, and clock skips early events
      // Check if sender has been syncing with other nodes
      const remoteNodes = remoteClock.getNodes()
      if (remoteNodes.length === 1) {
        // Only sender's node in clock - this is likely out-of-order delivery
        canApply = false
      }
      // If remote clock has multiple nodes, sender has been syncing - allow catch-up
    }
    // If senderVal == 1, this is the first event from sender - always apply (default canApply = true)

    if (!canApply) {
      // If buffer limit is 0, don't buffer at all (drop the event)
      if (this.maxEventBufferSize === 0) {
        return { success: true, isConflict: false }
      }

      // Enforce buffer size limit with FIFO eviction
      const currentSize = this.getBufferedEventCount()
      if (currentSize >= this.maxEventBufferSize) {
        // Evict oldest event(s) to make room
        this.evictOldestEvent()
      }

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
   * Get the current number of buffered events waiting for dependencies
   *
   * Events are buffered when they arrive out of order and cannot be applied
   * because earlier events from the same sender haven't been received yet.
   *
   * @returns The total count of buffered events across all entity keys
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
    // Get conflict info to merge all version clocks
    const conflict = this.conflicts.get(entityId) ?? this.pendingConflicts.get(entityId)

    // Merge all conflicting version clocks into our clock
    if (conflict) {
      for (const version of conflict.versions) {
        this.vectorClock.mergeWith(new VectorClock(version.vectorClock))
      }
    }

    // Also merge the entity clock if exists
    const entityClock = this.entityClocks.get(entityId)
    if (entityClock) {
      this.vectorClock.mergeWith(new VectorClock(entityClock))
    }

    // Increment clock for resolution (happens-after all merged events)
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

    // Update entity clock with the merged+incremented clock
    this.entityClocks.set(entityId, this.vectorClock.toJSON())

    // Emit resolution event to pipeline so other masters see it
    // The merged clock ensures this event dominates all conflicting versions
    const event: WriteEvent = {
      type: 'write',
      masterId: this.masterId,
      entityId,
      entityType: entity.$type,
      data: resolvedData,
      vectorClock: this.vectorClock.toJSON(),
      timestamp,
    }

    try {
      await this.pipeline.send([event])
    } catch {
      // Queue for retry if partition
      this.pendingWrites.push(event)
    }
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
  // Partition Recovery Methods
  // ==========================================================================

  /**
   * Sync with remote masters after partition heals
   * This triggers re-processing of any buffered events
   */
  async syncWithRemote(): Promise<void> {
    // Process any buffered events (out-of-order events waiting for deps)
    await this.processBufferedEvents()

    // First, re-send pending writes that failed during partition
    const writesToSend = [...this.pendingWrites]
    this.pendingWrites = []

    for (const event of writesToSend) {
      try {
        await this.pipeline.send([event])
      } catch {
        // Still partitioned - re-queue
        this.pendingWrites.push(event)
      }
    }

    // Then, fetch and apply any buffered events from the pipeline
    const pipeline = this.pipeline as MultiMasterPipeline & {
      getBufferedEvents?: (fromSequence?: number) => WriteEvent[]
      getEvents?: () => unknown[]
    }

    // Try getBufferedEvents first, then getEvents as fallback
    const events = pipeline.getBufferedEvents?.() ?? pipeline.getEvents?.() ?? []

    for (const event of events as WriteEvent[]) {
      if (event.masterId && event.masterId !== this.masterId) {
        await this.applyRemoteEvent(event)
      }
    }
  }

  // ==========================================================================
  // CRDT Methods
  // ==========================================================================

  /**
   * Write a G-Counter (grow-only counter)
   */
  async writeCounter(counterId: string, initialValue: number): Promise<WriteResult> {
    const data: Record<string, unknown> = {
      _type: 'g-counter',
      _counters: { [this.masterId]: initialValue },
    }
    return this.write(`counter:${counterId}`, data)
  }

  /**
   * Increment a G-Counter
   */
  async incrementCounter(counterId: string, amount: number): Promise<WriteResult> {
    const entityId = `counter:${counterId}`
    const existing = await this.stateManager.get(entityId)

    const counters = (existing?.data._counters as Record<string, number>) ?? {}
    counters[this.masterId] = (counters[this.masterId] ?? 0) + amount

    const data: Record<string, unknown> = {
      _type: 'g-counter',
      _counters: counters,
    }
    return this.write(entityId, data)
  }

  /**
   * Get a G-Counter value (sum of all master contributions)
   */
  async getCounter(counterId: string): Promise<number> {
    const entityId = `counter:${counterId}`
    const entity = await this.stateManager.get(entityId)
    if (!entity || entity.data._type !== 'g-counter') return 0

    const counters = (entity.data._counters as Record<string, number>) ?? {}
    return Object.values(counters).reduce((sum, val) => sum + val, 0)
  }

  /**
   * Write a PN-Counter (increment/decrement counter)
   */
  async writePNCounter(counterId: string, initialValue: number): Promise<WriteResult> {
    const data: Record<string, unknown> = {
      _type: 'pn-counter',
      _increments: { [this.masterId]: initialValue },
      _decrements: { [this.masterId]: 0 },
    }
    return this.write(`pncounter:${counterId}`, data)
  }

  /**
   * Increment a PN-Counter
   */
  async incrementPNCounter(counterId: string, amount: number): Promise<WriteResult> {
    const entityId = `pncounter:${counterId}`
    const existing = await this.stateManager.get(entityId)

    const increments = (existing?.data._increments as Record<string, number>) ?? {}
    const decrements = (existing?.data._decrements as Record<string, number>) ?? {}

    increments[this.masterId] = (increments[this.masterId] ?? 0) + amount

    const data: Record<string, unknown> = {
      _type: 'pn-counter',
      _increments: increments,
      _decrements: decrements,
    }
    return this.write(entityId, data)
  }

  /**
   * Decrement a PN-Counter
   */
  async decrementPNCounter(counterId: string, amount: number): Promise<WriteResult> {
    const entityId = `pncounter:${counterId}`
    const existing = await this.stateManager.get(entityId)

    const increments = (existing?.data._increments as Record<string, number>) ?? {}
    const decrements = (existing?.data._decrements as Record<string, number>) ?? {}

    decrements[this.masterId] = (decrements[this.masterId] ?? 0) + amount

    const data: Record<string, unknown> = {
      _type: 'pn-counter',
      _increments: increments,
      _decrements: decrements,
    }
    return this.write(entityId, data)
  }

  /**
   * Get a PN-Counter value
   */
  async getPNCounter(counterId: string): Promise<number> {
    const entityId = `pncounter:${counterId}`
    const entity = await this.stateManager.get(entityId)
    if (!entity || entity.data._type !== 'pn-counter') return 0

    const increments = (entity.data._increments as Record<string, number>) ?? {}
    const decrements = (entity.data._decrements as Record<string, number>) ?? {}

    const totalInc = Object.values(increments).reduce((sum, val) => sum + val, 0)
    const totalDec = Object.values(decrements).reduce((sum, val) => sum + val, 0)

    return totalInc - totalDec
  }

  /**
   * Add element to a G-Set (grow-only set)
   */
  async addToSet(setId: string, element: string): Promise<WriteResult> {
    const entityId = `gset:${setId}`
    const existing = await this.stateManager.get(entityId)

    const elements = new Set<string>(
      (existing?.data._elements as string[]) ?? []
    )
    elements.add(element)

    const data: Record<string, unknown> = {
      _type: 'g-set',
      _elements: Array.from(elements),
    }
    return this.write(entityId, data)
  }

  /**
   * Get G-Set elements
   */
  async getSet(setId: string): Promise<string[]> {
    const entityId = `gset:${setId}`
    const entity = await this.stateManager.get(entityId)
    if (!entity || entity.data._type !== 'g-set') return []

    return (entity.data._elements as string[]) ?? []
  }

  /**
   * Write a LWW-Register (last-writer-wins register)
   */
  async writeRegister(registerId: string, value: unknown): Promise<WriteResult> {
    const data: Record<string, unknown> = {
      _type: 'lww-register',
      _value: value,
      _timestamp: Date.now(),
      _masterId: this.masterId,
    }
    return this.write(`register:${registerId}`, data)
  }

  /**
   * Get LWW-Register value
   */
  async getRegister(registerId: string): Promise<unknown> {
    const entityId = `register:${registerId}`
    const entity = await this.stateManager.get(entityId)
    if (!entity || entity.data._type !== 'lww-register') return undefined

    return entity.data._value
  }

  /**
   * Write a CRDT document with multiple CRDT fields
   */
  async writeCRDTDocument(docId: string, fields: Record<string, unknown>): Promise<WriteResult> {
    const entityId = `crdtdoc:${docId}`
    const existing = await this.stateManager.get(entityId)

    // Merge fields with existing document
    const mergedFields: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(fields)) {
      const field = value as { type: string; value?: unknown; values?: string[] }

      switch (field.type) {
        case 'lww-register':
          mergedFields[key] = {
            type: 'lww-register',
            value: field.value,
            timestamp: Date.now(),
            masterId: this.masterId,
          }
          break

        case 'g-counter':
          const existingCounter = existing?.data[key] as { counters?: Record<string, number> } | undefined
          const counters = existingCounter?.counters ?? {}
          counters[this.masterId] = (counters[this.masterId] ?? 0) + (field.value as number ?? 0)
          mergedFields[key] = {
            type: 'g-counter',
            value: Object.values(counters).reduce((sum, v) => sum + v, 0),
            counters,
          }
          break

        case 'g-set':
          const existingSet = existing?.data[key] as { values?: string[] } | undefined
          const existingValues = new Set<string>(existingSet?.values ?? [])
          for (const v of (field.values ?? [])) {
            existingValues.add(v)
          }
          mergedFields[key] = {
            type: 'g-set',
            values: Array.from(existingValues),
          }
          break
      }
    }

    const data: Record<string, unknown> = {
      _type: 'crdt-document',
      ...mergedFields,
    }
    return this.write(entityId, data)
  }

  /**
   * Get CRDT document
   */
  async getCRDTDocument(docId: string): Promise<Record<string, unknown>> {
    const entityId = `crdtdoc:${docId}`
    const entity = await this.stateManager.get(entityId)
    if (!entity || entity.data._type !== 'crdt-document') {
      return {}
    }

    // Return without the _type field
    const { _type, ...fields } = entity.data
    return fields
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Evict the oldest event from the buffer using FIFO (First-In-First-Out) eviction
   *
   * When the event buffer reaches capacity (`maxEventBufferSize`), this method removes
   * the oldest buffered event across all keys to make room for new events. The oldest
   * event is determined by comparing timestamps across all buffer entries.
   *
   * This prevents unbounded memory growth when events arrive out of order and their
   * dependencies are never satisfied.
   *
   * @internal
   */
  private evictOldestEvent(): void {
    // Find the oldest event across all buffer keys
    let oldestKey: string | null = null
    let oldestTimestamp = Infinity

    for (const [key, events] of this.eventBuffer) {
      if (events.length > 0 && events[0].timestamp < oldestTimestamp) {
        oldestTimestamp = events[0].timestamp
        oldestKey = key
      }
    }

    if (oldestKey) {
      const events = this.eventBuffer.get(oldestKey)!
      events.shift() // Remove the oldest event (FIFO)

      // Clean up empty buffer entries
      if (events.length === 0) {
        this.eventBuffer.delete(oldestKey)
      }
    }
  }

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

    // Track the sender-entity clock for per-entity ordering
    const remoteClockObj = new VectorClock(remoteClock)
    const senderEntityKey = `${event.masterId}:${event.entityId}`
    const senderVal = remoteClockObj.get(event.masterId)
    this.senderEntityClocks.set(senderEntityKey, senderVal)

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
          // Check if we can now apply this event using the same hybrid logic as applyRemoteEvent
          const remoteClock = new VectorClock(event.vectorClock)
          const senderVal = remoteClock.get(event.masterId)
          const globalSeenSender = this.vectorClock.get(event.masterId)
          const senderEntityKey = `${event.masterId}:${event.entityId}`
          const mySeenSenderEntity = this.senderEntityClocks.get(senderEntityKey) ?? 0

          // Same hybrid logic as applyRemoteEvent
          let canApply = true
          const isNextGlobalEvent = senderVal === globalSeenSender + 1

          if (isNextGlobalEvent) {
            canApply = true
          } else if (mySeenSenderEntity > 0) {
            canApply = senderVal === mySeenSenderEntity + 1
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
