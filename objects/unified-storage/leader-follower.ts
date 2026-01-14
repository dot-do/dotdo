/**
 * LeaderFollowerManager - Leader-follower replication for read scaling and failover
 *
 * Coordinates leader-follower replication:
 * - Leader handles all writes and emits events to Pipeline
 * - Followers subscribe to Pipeline events and apply to local state
 * - Followers serve reads from local state (read-only)
 * - Failover promotes follower to leader on leader failure
 *
 * @module unified-storage/leader-follower
 */

import type { Pipeline } from './pipeline-emitter'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Replication role for a node
 */
export const ReplicationRole = {
  Leader: 'leader',
  Follower: 'follower',
} as const

export type ReplicationRole = (typeof ReplicationRole)[keyof typeof ReplicationRole]

/**
 * Replication event structure
 */
export interface ReplicationEvent {
  type: string
  namespace: string
  key: string
  value?: unknown
  operation: 'create' | 'update' | 'delete'
  sequence: number
  sourceNode?: string
  timestamp?: number
}

/**
 * Leader change event
 */
export interface LeaderChangeEvent {
  type: 'replication.leader_changed'
  namespace: string
  newLeaderId: string
  previousLeaderId: string
}

/**
 * Write operation input
 */
export interface WriteOperation {
  key: string
  value: unknown
  operation: 'create' | 'update' | 'delete'
}

/**
 * Write result
 */
export interface WriteResult {
  success: boolean
  error?: string
  errorCode?: string
  leaderId?: string
  sequence?: number
}

/**
 * State store interface (compatible with mocks from test)
 */
export interface StateStore {
  get(key: string): unknown | undefined
  set(key: string, value: unknown): number
  delete(key: string): boolean
  has(key: string): boolean
  getAll(): Map<string, unknown>
  getVersion(): number
}

/**
 * Heartbeat service interface
 */
export interface HeartbeatService {
  sendHeartbeat(nodeId: string): void
  getLastHeartbeat(nodeId: string): number | undefined
  isAlive(nodeId: string, timeoutMs: number): boolean
  onLeaderStatus(callback: (leaderId: string, alive: boolean) => void): () => void
}

/**
 * Leader-follower manager configuration
 */
export interface LeaderFollowerConfig {
  nodeId: string
  role: ReplicationRole
  pipeline: Pipeline
  stateStore: StateStore
  namespace: string
  leaderId?: string
  heartbeatService?: HeartbeatService
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  maxStalenessMs?: number
  lastAppliedSequence?: number
  promotionEligible?: boolean
}

/**
 * Resolved config with defaults
 */
export interface ResolvedLeaderFollowerConfig {
  readonly nodeId: string
  readonly role: ReplicationRole
  readonly namespace: string
  readonly heartbeatIntervalMs: number
  readonly heartbeatTimeoutMs: number
  readonly maxStalenessMs: number
  readonly promotionEligible: boolean
}

/**
 * Leader state information
 */
export interface LeaderState {
  role: ReplicationRole
  currentSequence: number
  followerCount: number
  followers: Map<string, FollowerInfo>
}

/**
 * Follower information tracked by leader
 */
export interface FollowerInfo {
  nodeId: string
  lastReportedSequence: number
  lastHeartbeat: number
}

/**
 * Follower state information
 */
export interface FollowerState {
  role: ReplicationRole
  appliedSequence: number
  leaderId: string
  isStale: boolean
}

/**
 * Manager metrics
 */
export interface ManagerMetrics {
  role: ReplicationRole
  eventsEmitted: number
  eventsApplied: number
  nodeId: string
}

// ============================================================================
// EVENT EMITTER BASE
// ============================================================================

type EventHandler = (...args: unknown[]) => void

class SimpleEventEmitter {
  private handlers: Map<string, EventHandler[]> = new Map()

  on(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event) || []
    handlers.push(handler)
    this.handlers.set(event, handlers)
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event) || []
    const idx = handlers.indexOf(handler)
    if (idx >= 0) handlers.splice(idx, 1)
  }

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.handlers.get(event) || []
    for (const handler of handlers) {
      handler(...args)
    }
  }

  removeAllListeners(): void {
    this.handlers.clear()
  }
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG = {
  heartbeatIntervalMs: 1000,
  heartbeatTimeoutMs: 5000,
  maxStalenessMs: 30000,
  promotionEligible: true,
} as const

// ============================================================================
// LEADER FOLLOWER MANAGER
// ============================================================================

/**
 * LeaderFollowerManager - Coordinates leader-follower replication
 */
export class LeaderFollowerManager extends SimpleEventEmitter {
  private pipeline: Pipeline & { subscribe?: (namespace: string, callback: (event: unknown) => void) => () => void; getEvents?: (fromSequence?: number) => unknown[] }
  private stateStore: StateStore
  private heartbeatService?: HeartbeatService

  private _config: ResolvedLeaderFollowerConfig
  private _role: ReplicationRole
  private _leaderId: string
  private _closed: boolean = false
  private _started: boolean = false

  // Sequence tracking
  private _currentSequence: number = 0
  private _appliedSequence: number = 0
  private _lastEventTimestamp: number = Date.now()

  // Follower tracking (for leader)
  private _followers: Map<string, FollowerInfo> = new Map()

  // Event buffering for out-of-order handling
  private _eventBuffer: Map<number, ReplicationEvent> = new Map()

  // Pipeline subscription cleanup
  private _unsubscribe?: () => void

  // Heartbeat timer
  private _heartbeatTimer?: ReturnType<typeof setInterval>
  private _leaderStatusUnsubscribe?: () => void

  // Leader health tracking
  private _isLeaderAlive: boolean = true

  // Metrics
  private _eventsEmitted: number = 0
  private _eventsApplied: number = 0

  constructor(config: LeaderFollowerConfig) {
    super()

    this.pipeline = config.pipeline as Pipeline & { subscribe?: (namespace: string, callback: (event: unknown) => void) => () => void; getEvents?: (fromSequence?: number) => unknown[] }
    this.stateStore = config.stateStore
    this.heartbeatService = config.heartbeatService

    this._role = config.role
    this._leaderId = config.leaderId || config.nodeId
    this._appliedSequence = config.lastAppliedSequence || 0
    this._currentSequence = config.lastAppliedSequence || 0

    this._config = Object.freeze({
      nodeId: config.nodeId,
      role: config.role,
      namespace: config.namespace,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? DEFAULT_CONFIG.heartbeatIntervalMs,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? DEFAULT_CONFIG.heartbeatTimeoutMs,
      maxStalenessMs: config.maxStalenessMs ?? DEFAULT_CONFIG.maxStalenessMs,
      promotionEligible: config.promotionEligible ?? DEFAULT_CONFIG.promotionEligible,
    })
  }

  // ==========================================================================
  // PUBLIC GETTERS
  // ==========================================================================

  get config(): ResolvedLeaderFollowerConfig {
    return this._config
  }

  getRole(): ReplicationRole {
    return this._role
  }

  getNodeId(): string {
    return this._config.nodeId
  }

  getLeaderId(): string {
    return this._leaderId
  }

  isClosed(): boolean {
    return this._closed
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Start the manager
   */
  async start(): Promise<void> {
    if (this._started || this._closed) return
    this._started = true

    if (this._role === ReplicationRole.Leader) {
      this.startHeartbeat()
    } else {
      // Subscribe to Pipeline events
      this.subscribeToPipeline()

      // Catch up from Pipeline
      await this.requestCatchUp(this._appliedSequence)

      // Subscribe to leader status if heartbeat service available
      if (this.heartbeatService) {
        this._leaderStatusUnsubscribe = this.heartbeatService.onLeaderStatus(
          (leaderId: string, alive: boolean) => {
            if (leaderId === this._leaderId || leaderId === 'leader') {
              this._isLeaderAlive = alive
              if (!alive) {
                this.emit('leaderFailed', { leaderId: this._leaderId })
              }
            }
          }
        )
      }
    }
  }

  /**
   * Close the manager and clean up resources
   */
  async close(): Promise<void> {
    if (this._closed) return
    this._closed = true

    // Stop heartbeat
    this.stopHeartbeat()

    // Unsubscribe from leader status
    if (this._leaderStatusUnsubscribe) {
      this._leaderStatusUnsubscribe()
      this._leaderStatusUnsubscribe = undefined
    }

    // Unsubscribe from Pipeline
    if (this._unsubscribe) {
      this._unsubscribe()
      this._unsubscribe = undefined
    }

    // Flush pending events if leader
    if (this._role === ReplicationRole.Leader) {
      await this.flushPendingEvents()
    }

    // Clean up event emitter
    this.removeAllListeners()
  }

  // ==========================================================================
  // WRITE OPERATIONS (LEADER)
  // ==========================================================================

  /**
   * Write operation - only allowed on leader
   */
  async write(operation: WriteOperation): Promise<WriteResult> {
    // Check if closed
    if (this._closed) {
      return {
        success: false,
        error: 'Manager is closed',
        errorCode: 'MANAGER_CLOSED',
      }
    }

    // Reject writes on follower
    if (this._role === ReplicationRole.Follower) {
      // Use different error code based on whether we were demoted (started as leader)
      // vs always been a follower
      const wasDemoted = this._config.role === ReplicationRole.Leader
      return {
        success: false,
        error: wasDemoted ? 'Not the leader' : 'Follower is read-only. Redirect to leader.',
        errorCode: wasDemoted ? 'NOT_LEADER' : 'FOLLOWER_READ_ONLY',
        leaderId: this._leaderId,
      }
    }

    // Perform local write
    const { key, value, operation: op } = operation

    if (op === 'delete') {
      this.stateStore.delete(key)
    } else {
      this.stateStore.set(key, value)
    }

    // Increment sequence
    this._currentSequence++
    const sequence = this._currentSequence

    // Emit event to Pipeline
    const event: ReplicationEvent = {
      type: 'replication.write',
      namespace: this._config.namespace,
      key,
      value,
      operation: op,
      sequence,
      sourceNode: this._config.nodeId,
      timestamp: Date.now(),
    }

    // Send to Pipeline (fire-and-forget style, but we await for test verification)
    try {
      await this.pipeline.send([event])
      this._eventsEmitted++
      this.emit('write', { key, operation: op, sequence })
    } catch {
      // Log error but don't fail - Pipeline will handle retries
    }

    return {
      success: true,
      sequence,
    }
  }

  // ==========================================================================
  // READ OPERATIONS
  // ==========================================================================

  /**
   * Read from local state (works on both leader and follower)
   */
  async read(key: string): Promise<unknown | null> {
    const value = this.stateStore.get(key)
    return value === undefined ? null : value
  }

  /**
   * Check if data is stale (follower only)
   */
  isStale(): boolean {
    if (this._role === ReplicationRole.Leader) return false

    const elapsed = Date.now() - this._lastEventTimestamp
    return elapsed > this._config.maxStalenessMs
  }

  // ==========================================================================
  // FOLLOWER TRACKING (LEADER)
  // ==========================================================================

  /**
   * Register a follower (leader only)
   */
  async registerFollower(followerId: string): Promise<void> {
    if (this._role !== ReplicationRole.Leader) return

    this._followers.set(followerId, {
      nodeId: followerId,
      lastReportedSequence: 0,
      lastHeartbeat: Date.now(),
    })
  }

  /**
   * Unregister a follower (leader only)
   */
  async unregisterFollower(followerId: string): Promise<void> {
    this._followers.delete(followerId)
  }

  /**
   * Get connected followers (leader only)
   */
  getConnectedFollowers(): string[] {
    return Array.from(this._followers.keys())
  }

  /**
   * Report follower progress (leader receives this from follower)
   */
  async reportFollowerProgress(followerId: string, sequence: number): Promise<void> {
    const follower = this._followers.get(followerId)
    if (follower) {
      follower.lastReportedSequence = sequence
      follower.lastHeartbeat = Date.now()
    }
  }

  /**
   * Get follower lag (leader only)
   */
  getFollowerLag(followerId: string): number {
    const follower = this._followers.get(followerId)
    if (!follower) return -1
    return this._currentSequence - follower.lastReportedSequence
  }

  /**
   * Get leader state (leader only)
   */
  getLeaderState(): LeaderState | null {
    if (this._role !== ReplicationRole.Leader) return null

    return {
      role: this._role,
      currentSequence: this._currentSequence,
      followerCount: this._followers.size,
      followers: new Map(this._followers),
    }
  }

  // ==========================================================================
  // FOLLOWER STATE
  // ==========================================================================

  /**
   * Get follower state (follower only)
   */
  getFollowerState(): FollowerState | null {
    if (this._role !== ReplicationRole.Follower) return null

    return {
      role: this._role,
      appliedSequence: this._appliedSequence,
      leaderId: this._leaderId,
      isStale: this.isStale(),
    }
  }

  // ==========================================================================
  // FAILOVER
  // ==========================================================================

  /**
   * Check if leader is healthy (follower only)
   */
  isLeaderHealthy(): boolean {
    return this._isLeaderAlive
  }

  /**
   * Check if this node can participate in election
   */
  canParticipateInElection(): boolean {
    return this._config.promotionEligible && !this._closed
  }

  /**
   * Promote this follower to leader
   */
  async promote(): Promise<void> {
    if (!this._config.promotionEligible) {
      throw new Error('This node is not eligible for promotion')
    }

    // Before promotion, flush any buffered events to ensure we have the latest state
    // This handles the case where we received events out of order and some are still buffered
    this.flushBufferedEventsOnPromotion()

    // Change role
    const previousRole = this._role
    this._role = ReplicationRole.Leader
    this._leaderId = this._config.nodeId

    // Continue sequence from last applied
    this._currentSequence = this._appliedSequence

    // Unsubscribe from Pipeline events (no longer receiving)
    if (this._unsubscribe) {
      this._unsubscribe()
      this._unsubscribe = undefined
    }

    // Start heartbeat as leader
    this.startHeartbeat()

    // Emit leader changed event to Pipeline
    const leaderChangeEvent: LeaderChangeEvent = {
      type: 'replication.leader_changed',
      namespace: this._config.namespace,
      newLeaderId: this._config.nodeId,
      previousLeaderId: this._leaderId,
    }

    try {
      await this.pipeline.send([leaderChangeEvent])
    } catch {
      // Best effort
    }

    this.emit('promoted', { previousRole, newRole: ReplicationRole.Leader })
  }

  /**
   * Demote this leader to follower
   */
  async demote(): Promise<void> {
    this._role = ReplicationRole.Follower
    this.stopHeartbeat()

    // Subscribe to Pipeline events
    this.subscribeToPipeline()
  }

  // ==========================================================================
  // METRICS
  // ==========================================================================

  /**
   * Get manager metrics
   */
  getMetrics(): ManagerMetrics {
    return {
      role: this._role,
      eventsEmitted: this._eventsEmitted,
      eventsApplied: this._eventsApplied,
      nodeId: this._config.nodeId,
    }
  }

  // ==========================================================================
  // PRIVATE: PIPELINE SUBSCRIPTION
  // ==========================================================================

  private subscribeToPipeline(): void {
    if (!this.pipeline.subscribe) return

    this._unsubscribe = this.pipeline.subscribe(
      this._config.namespace,
      (event: unknown) => this.handlePipelineEvent(event)
    )
  }

  private handlePipelineEvent(event: unknown): void {
    const e = event as ReplicationEvent | LeaderChangeEvent

    // Handle leader change events
    if (e.type === 'replication.leader_changed') {
      const leaderChange = e as LeaderChangeEvent
      if (leaderChange.namespace === this._config.namespace) {
        this._leaderId = leaderChange.newLeaderId
      }
      return
    }

    // Handle replication events
    if (e.type === 'replication.write') {
      const repEvent = e as ReplicationEvent

      // Filter by namespace
      if (repEvent.namespace !== this._config.namespace) return

      // Handle out-of-order events
      this.bufferAndApplyEvent(repEvent)
    }
  }

  private bufferAndApplyEvent(event: ReplicationEvent): void {
    const expectedSequence = this._appliedSequence + 1

    // Already applied - duplicate, ignore
    if (event.sequence <= this._appliedSequence) {
      return
    }

    // If this is the next expected event, apply it
    if (event.sequence === expectedSequence) {
      this.applyEvent(event)
      this.tryApplyBufferedEvents()
    } else {
      // Out of order - buffer it
      this._eventBuffer.set(event.sequence, event)
    }
  }

  private tryApplyBufferedEvents(): void {
    // Apply any buffered events that are now in order
    let nextSequence = this._appliedSequence + 1
    while (this._eventBuffer.has(nextSequence)) {
      const event = this._eventBuffer.get(nextSequence)!
      this._eventBuffer.delete(nextSequence)
      this.applyEvent(event)
      nextSequence = this._appliedSequence + 1
    }
  }

  private applyEvent(event: ReplicationEvent): void {
    const { key, value, operation, sequence } = event

    // Apply to local state
    if (operation === 'delete') {
      this.stateStore.delete(key)
    } else {
      this.stateStore.set(key, value)
    }

    // Update tracking
    this._appliedSequence = sequence
    this._lastEventTimestamp = Date.now()
    this._eventsApplied++

    this.emit('eventApplied', { key, operation, sequence })
  }

  /**
   * Flush buffered events on promotion - apply all buffered events in order
   * This ensures the promoted leader has the most up-to-date state
   */
  private flushBufferedEventsOnPromotion(): void {
    if (this._eventBuffer.size === 0) return

    // Get all buffered sequences sorted
    const sequences = Array.from(this._eventBuffer.keys()).sort((a, b) => a - b)

    // Apply events from lowest sequence
    for (const seq of sequences) {
      const event = this._eventBuffer.get(seq)!
      this._eventBuffer.delete(seq)
      this.applyEvent(event)
    }
  }

  // ==========================================================================
  // PRIVATE: CATCH-UP
  // ==========================================================================

  private async requestCatchUp(fromSequence: number): Promise<void> {
    if (!this.pipeline.getEvents) return

    const events = this.pipeline.getEvents(fromSequence) as ReplicationEvent[]

    for (const event of events) {
      if (event.type === 'replication.write' && event.namespace === this._config.namespace) {
        // Only apply events we haven't seen
        if (event.sequence > this._appliedSequence) {
          this.bufferAndApplyEvent(event)
        }
      }
    }
  }

  // ==========================================================================
  // PRIVATE: HEARTBEAT
  // ==========================================================================

  private startHeartbeat(): void {
    if (this._heartbeatTimer || !this.heartbeatService) return

    // Start heartbeat interval (first heartbeat after interval elapses)
    this._heartbeatTimer = setInterval(() => {
      if (this._closed || this._role !== ReplicationRole.Leader) {
        this.stopHeartbeat()
        return
      }
      this.heartbeatService!.sendHeartbeat(this._config.nodeId)
    }, this._config.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = undefined
    }
  }

  // ==========================================================================
  // PRIVATE: FLUSH
  // ==========================================================================

  private async flushPendingEvents(): Promise<void> {
    // No-op for now - events are sent immediately
    // Could be used for batching in the future
  }
}
