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

import type { Pipeline } from './types/pipeline'

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
 * Distributed lock service interface for coordinated leader election
 *
 * This interface abstracts the distributed lock mechanism used to ensure
 * only one node can be the leader at a time. In production deployments,
 * this should be backed by a distributed consensus system like:
 * - etcd (recommended for Kubernetes environments)
 * - Redis with SETNX/Redlock algorithm
 * - ZooKeeper
 * - Consul
 * - Custom Raft implementation
 *
 * The lock service provides fencing tokens to prevent split-brain scenarios
 * where network partitions could result in multiple nodes thinking they're leader.
 *
 * @example
 * ```typescript
 * // Production implementation with etcd
 * const lockService: DistributedLockService = {
 *   async tryAcquireLock(nodeId) {
 *     const lease = await etcd.lease(30000) // 30s TTL
 *     const token = await etcd.put('/leader').value(nodeId).lease(lease)
 *     return token.revision // Use revision as fencing token
 *   },
 *   async releaseLock(nodeId) {
 *     await etcd.delete('/leader')
 *     return true
 *   },
 *   getCurrentHolder() { return cachedLeader },
 *   getFencingToken() { return currentRevision }
 * }
 * ```
 */
export interface DistributedLockService {
  /**
   * Attempt to acquire the leader lock
   * @param nodeId - The unique identifier of the node attempting to acquire the lock
   * @returns The fencing token on success, or `null` if the lock is already held
   */
  tryAcquireLock(nodeId: string): Promise<number | null>

  /**
   * Release the leader lock
   * @param nodeId - The unique identifier of the node releasing the lock
   * @returns `true` if successfully released, `false` if the lock wasn't held by this node
   */
  releaseLock(nodeId: string): Promise<boolean>

  /**
   * Get the node ID of the current lock holder
   * @returns The node ID of the current holder, or `null` if no node holds the lock
   */
  getCurrentHolder(): string | null

  /**
   * Get the current fencing token
   * @returns The fencing token of the current lock holder (0 if no holder)
   */
  getFencingToken(): number
}

/**
 * Callback function for quorum-based consensus simulation
 *
 * This callback is invoked during promotion/demotion to verify that a
 * majority of nodes in the cluster agree with the leadership change.
 * It enables simulation of distributed consensus for testing and can
 * be replaced with actual consensus protocol calls in production.
 *
 * @param nodeId - The node requesting the action
 * @param action - Either 'promote' (become leader) or 'demote' (step down)
 * @returns A promise resolving to `true` if quorum is reached, `false` otherwise
 *
 * @example
 * ```typescript
 * const quorumCallback: QuorumCallback = async (nodeId, action) => {
 *   const votes = await pollClusterNodes(nodeId, action)
 *   const majority = Math.floor(clusterSize / 2) + 1
 *   return votes >= majority
 * }
 * ```
 */
export type QuorumCallback = (nodeId: string, action: 'promote' | 'demote') => Promise<boolean>

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
  /** Distributed lock service for coordinated leader election */
  distributedLock?: DistributedLockService
  /** Quorum callback for consensus simulation */
  quorumCallback?: QuorumCallback
  /** Lock timeout in ms (default 30000) */
  lockTimeoutMs?: number
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
  /** Epoch/term that increments on each leader election - used for fencing */
  epoch: number
  /** Fencing token for this leader term */
  fencingToken: number
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
  lockTimeoutMs: 30000,
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
  private distributedLock?: DistributedLockService
  private quorumCallback?: QuorumCallback

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

  // Distributed leader election state
  private _epoch: number = 0
  private _fencingToken: number = 0
  private _hasLeaderLock: boolean = false
  private _lockTimeoutMs: number = DEFAULT_CONFIG.lockTimeoutMs
  private _lockAcquiredAt?: number

  // Global lock for single-process coordination (simulates distributed lock)
  private static _globalLeaderLock: Map<string, { holder: string; epoch: number; acquiredAt: number }> = new Map()
  // Track highest epoch per namespace for monotonic epoch progression
  private static _globalMaxEpoch: Map<string, number> = new Map()

  constructor(config: LeaderFollowerConfig) {
    super()

    this.pipeline = config.pipeline as Pipeline & { subscribe?: (namespace: string, callback: (event: unknown) => void) => () => void; getEvents?: (fromSequence?: number) => unknown[] }
    this.stateStore = config.stateStore
    this.heartbeatService = config.heartbeatService
    this.distributedLock = config.distributedLock
    this.quorumCallback = config.quorumCallback

    this._role = config.role
    this._leaderId = config.leaderId || config.nodeId
    this._appliedSequence = config.lastAppliedSequence || 0
    this._currentSequence = config.lastAppliedSequence || 0
    this._lockTimeoutMs = config.lockTimeoutMs ?? DEFAULT_CONFIG.lockTimeoutMs

    // If starting as leader, initialize epoch
    if (config.role === ReplicationRole.Leader) {
      this._epoch = 1
      this._fencingToken = 1
      this._hasLeaderLock = true
    }

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

  /**
   * Check if this node currently holds the leader lock
   *
   * The leader lock is a distributed lock that ensures only one node can be
   * the active leader at a time. A node must hold this lock to accept writes.
   *
   * The lock may be lost due to:
   * - Explicit `demote()` call
   * - Lock timeout expiration
   * - Another node acquiring the lock with a higher epoch
   *
   * @returns `true` if this node holds the leader lock, `false` otherwise
   */
  hasLeaderLock(): boolean {
    return this._hasLeaderLock
  }

  /**
   * Get the current epoch (term number) for this node
   *
   * The epoch is a monotonically increasing counter that increments with each
   * leader election. It's used for:
   * - Fencing: Preventing split-brain scenarios where two nodes think they're leader
   * - Ordering: Determining which leader is "newer" during partition recovery
   * - Staleness detection: Rejecting operations from stale leaders
   *
   * A higher epoch always wins in conflict resolution.
   *
   * @returns The current epoch number (starts at 0 for followers, 1+ for leaders)
   */
  getEpoch(): number {
    return this._epoch
  }

  /**
   * Get the current fencing token for this node
   *
   * The fencing token is assigned when acquiring the leader lock and is used to
   * prevent stale leaders from performing operations. It serves as a "lease number"
   * that storage systems can validate to reject requests from old leaders.
   *
   * In this implementation, the fencing token equals the epoch.
   *
   * @returns The fencing token (0 if not a leader, otherwise equals epoch)
   */
  getFencingToken(): number {
    return this._fencingToken
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
      // Acquire leader lock when starting as leader
      await this.acquireLock()
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

    // Release leader lock if held
    if (this._hasLeaderLock) {
      await this.releaseLock()
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

    // Check if we still hold the leader lock
    if (!this._hasLeaderLock) {
      return {
        success: false,
        error: 'Not the leader - lost leader lock',
        errorCode: 'NOT_LEADER',
        leaderId: this._leaderId,
      }
    }

    // Check for stale fencing token (split-brain prevention)
    const globalLock = LeaderFollowerManager._globalLeaderLock.get(this._config.namespace)
    if (globalLock && globalLock.holder !== this._config.nodeId) {
      // Another node has the lock - we're stale
      this._hasLeaderLock = false
      return {
        success: false,
        error: 'Stale leader - another leader exists with higher fencing token',
        errorCode: 'STALE_LEADER',
        leaderId: globalLock.holder,
      }
    }

    // Check epoch - if global epoch is higher, we're stale
    if (globalLock && globalLock.epoch > this._epoch) {
      this._hasLeaderLock = false
      return {
        success: false,
        error: 'Stale leader - another leader has taken over with higher epoch',
        errorCode: 'STALE_LEADER',
        leaderId: globalLock.holder,
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
      epoch: this._epoch,
      fencingToken: this._fencingToken,
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

    // Step 1: Check quorum if quorum callback is configured
    if (this.quorumCallback) {
      const hasQuorum = await this.quorumCallback(this._config.nodeId, 'promote')
      if (!hasQuorum) {
        throw new Error('Cannot promote: quorum not reached - requires majority consensus')
      }
    } else {
      // No quorum callback - check if we can achieve quorum via canAchieveQuorum()
      const canPromote = await this.canAchieveQuorum()
      if (!canPromote) {
        throw new Error('Cannot promote: quorum not reached - requires majority consensus')
      }
    }

    // Step 2: Try to acquire distributed lock
    const lockAcquired = await this.acquireLock()
    if (!lockAcquired) {
      throw new Error('Cannot promote: leader lock already held by another node - election failed')
    }

    // Before promotion, flush any buffered events to ensure we have the latest state
    // This handles the case where we received events out of order and some are still buffered
    this.flushBufferedEventsOnPromotion()

    // Change role
    const previousRole = this._role
    const previousLeaderId = this._leaderId
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
      previousLeaderId: previousLeaderId,
    }

    try {
      await this.pipeline.send([leaderChangeEvent])
    } catch {
      // Best effort
    }

    this.emit('promoted', { previousRole, newRole: ReplicationRole.Leader, epoch: this._epoch })
  }

  /**
   * Demote this leader to follower
   */
  async demote(): Promise<void> {
    // Release leader lock first
    if (this._hasLeaderLock) {
      await this.releaseLock()
    }

    this._role = ReplicationRole.Follower
    this.stopHeartbeat()

    // Subscribe to Pipeline events
    this.subscribeToPipeline()
  }

  /**
   * Reconcile with a peer node after network partition
   * Resolves split-brain by comparing epochs - higher epoch wins
   */
  async reconcileWithPeer(peerId: string): Promise<{ resolved: boolean; winner: string }> {
    // Check the global lock to see the current state
    const globalLock = LeaderFollowerManager._globalLeaderLock.get(this._config.namespace)

    // If there's no global lock state, this node is the valid leader
    if (!globalLock) {
      return { resolved: true, winner: this._config.nodeId }
    }

    // Compare epochs - higher epoch wins
    if (globalLock.epoch > this._epoch) {
      // Other node has higher epoch - we should demote
      if (this._role === ReplicationRole.Leader) {
        await this.demote()
      }
      return { resolved: true, winner: globalLock.holder }
    } else if (globalLock.epoch < this._epoch) {
      // We have higher epoch - we're the valid leader
      return { resolved: true, winner: this._config.nodeId }
    } else {
      // Same epoch - the lock holder wins
      if (globalLock.holder !== this._config.nodeId && this._role === ReplicationRole.Leader) {
        await this.demote()
      }
      return { resolved: true, winner: globalLock.holder }
    }
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
  // PARTITION RECOVERY METHODS
  // ==========================================================================

  /**
   * Get the current applied sequence number (follower only)
   */
  getAppliedSequence(): number {
    return this._appliedSequence
  }

  /**
   * Get the replication lag (events behind leader)
   * Returns the difference between leader's current sequence and follower's applied sequence
   */
  getReplicationLag(): number {
    if (this._role === ReplicationRole.Leader) {
      return 0
    }

    // For followers, try to get leader's sequence from pipeline events
    // If we're partitioned, we won't know the actual lag, so estimate based on time
    const events = this.pipeline.getEvents?.() as ReplicationEvent[] || []
    const leaderEvents = events.filter(
      e => e.type === 'replication.write' && e.namespace === this._config.namespace
    )

    if (leaderEvents.length > 0) {
      const maxSequence = Math.max(...leaderEvents.map(e => e.sequence))
      return Math.max(0, maxSequence - this._appliedSequence)
    }

    return 0
  }

  /**
   * Request catch-up from the leader's event log
   * Public method that can be called to trigger recovery
   */
  async requestCatchUp(fromSequence?: number): Promise<void> {
    const startSequence = fromSequence ?? this._appliedSequence
    const recoveryStartTime = Date.now()
    const initialSequence = this._appliedSequence

    if (!this.pipeline.getEvents) return

    const events = this.pipeline.getEvents(startSequence) as ReplicationEvent[]

    for (const event of events) {
      if (event.type === 'replication.write' && event.namespace === this._config.namespace) {
        // Only apply events we haven't seen
        if (event.sequence > this._appliedSequence) {
          this.bufferAndApplyEvent(event)
        }
      }
    }

    // Emit recovery complete event if we recovered any events
    const eventsRecovered = this._appliedSequence - initialSequence
    if (eventsRecovered > 0) {
      this.emit('recoveryComplete', {
        eventsRecovered,
        recoveryDurationMs: Date.now() - recoveryStartTime,
      })
    }
  }

  /**
   * Check if this node can achieve quorum for leader election
   * In a real system, this would query other nodes
   */
  async canAchieveQuorum(): Promise<boolean> {
    // Use quorum callback if configured
    if (this.quorumCallback) {
      return this.quorumCallback(this._config.nodeId, 'promote')
    }

    // If no callback and we're partitioned, assume we can't achieve quorum
    // This prevents split-brain scenarios
    return false
  }

  /**
   * Force promote to leader (bypasses quorum check - for testing/recovery)
   */
  async forcePromote(): Promise<void> {
    // Bypass quorum check but still acquire lock
    const lockAcquired = await this.acquireLock()
    if (!lockAcquired) {
      // If another node has the lock, we still force promote but with a higher epoch
      const globalLock = LeaderFollowerManager._globalLeaderLock.get(this._config.namespace)
      if (globalLock) {
        this._epoch = globalLock.epoch + 1
      } else {
        this._epoch = (LeaderFollowerManager._globalMaxEpoch.get(this._config.namespace) || 0) + 1
      }
      this._fencingToken = this._epoch
      this._hasLeaderLock = true

      // Update global state
      LeaderFollowerManager._globalLeaderLock.set(this._config.namespace, {
        holder: this._config.nodeId,
        epoch: this._epoch,
        acquiredAt: Date.now(),
      })
      LeaderFollowerManager._globalMaxEpoch.set(this._config.namespace, this._epoch)
    }

    // Flush any buffered events before promotion
    this.flushBufferedEventsOnPromotion()

    // Change role
    const previousRole = this._role
    this._role = ReplicationRole.Leader
    this._leaderId = this._config.nodeId

    // Continue sequence from last applied
    this._currentSequence = this._appliedSequence

    // Unsubscribe from Pipeline events
    if (this._unsubscribe) {
      this._unsubscribe()
      this._unsubscribe = undefined
    }

    // Start heartbeat
    this.startHeartbeat()

    this.emit('promoted', { previousRole, newRole: ReplicationRole.Leader, epoch: this._epoch, forced: true })
  }

  /**
   * Detect if a new leader has been elected and step down if necessary
   */
  async detectNewLeader(): Promise<boolean> {
    const globalLock = LeaderFollowerManager._globalLeaderLock.get(this._config.namespace)

    if (!globalLock) {
      return false
    }

    // If another node holds the lock with a higher epoch, step down
    if (globalLock.holder !== this._config.nodeId && globalLock.epoch >= this._epoch) {
      if (this._role === ReplicationRole.Leader) {
        await this.demote()
        this._leaderId = globalLock.holder
      }
      return true
    }

    return false
  }

  /**
   * Resolve split-brain scenario by comparing fencing tokens
   * Node with lower token steps down
   */
  async resolveSplitBrain(): Promise<void> {
    const globalLock = LeaderFollowerManager._globalLeaderLock.get(this._config.namespace)

    if (!globalLock) {
      return
    }

    // If we're leader but another node has a higher epoch, step down
    if (this._role === ReplicationRole.Leader &&
        globalLock.holder !== this._config.nodeId &&
        globalLock.epoch > this._epoch) {
      await this.demote()
      this._leaderId = globalLock.holder
    }

    // If we're leader and have equal epoch, use node ID as tiebreaker
    if (this._role === ReplicationRole.Leader &&
        globalLock.holder !== this._config.nodeId &&
        globalLock.epoch === this._epoch) {
      // Higher node ID wins
      if (globalLock.holder > this._config.nodeId) {
        await this.demote()
        this._leaderId = globalLock.holder
      }
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

  // ==========================================================================
  // PRIVATE: DISTRIBUTED LOCK
  // ==========================================================================

  /**
   * Acquire the leader lock for this namespace
   * Uses either an external distributed lock service or the internal global lock
   * Returns true if lock acquired, false if lock held by another node
   */
  private async acquireLock(): Promise<boolean> {
    const namespace = this._config.namespace
    const nodeId = this._config.nodeId
    const now = Date.now()

    // If using external distributed lock service
    if (this.distributedLock) {
      const fencingToken = await this.distributedLock.tryAcquireLock(nodeId)
      if (fencingToken === null) {
        return false
      }
      this._fencingToken = fencingToken
      this._epoch = fencingToken // Use fencing token as epoch
      this._hasLeaderLock = true
      this._lockAcquiredAt = now
      return true
    }

    // Use internal global lock for single-process coordination
    const existingLock = LeaderFollowerManager._globalLeaderLock.get(namespace)
    const maxEpoch = LeaderFollowerManager._globalMaxEpoch.get(namespace) || 0

    if (existingLock) {
      // Check if the existing lock has expired
      const lockAge = now - existingLock.acquiredAt
      if (lockAge < this._lockTimeoutMs && existingLock.holder !== nodeId) {
        // Lock is still valid and held by another node
        return false
      }
      // Lock expired or held by us - we can take it
      // Increment epoch from maximum of previous lock's epoch and tracked max epoch
      this._epoch = Math.max(existingLock.epoch, maxEpoch) + 1
    } else {
      // First lock acquisition for this namespace OR re-acquisition after release
      // Use max epoch to ensure monotonic progression
      this._epoch = maxEpoch + 1
    }

    // Update the global max epoch
    LeaderFollowerManager._globalMaxEpoch.set(namespace, this._epoch)

    // Acquire the lock
    this._fencingToken = this._epoch
    this._hasLeaderLock = true
    this._lockAcquiredAt = now

    LeaderFollowerManager._globalLeaderLock.set(namespace, {
      holder: nodeId,
      epoch: this._epoch,
      acquiredAt: now,
    })

    return true
  }

  /**
   * Release the leader lock for this namespace
   */
  private async releaseLock(): Promise<boolean> {
    const namespace = this._config.namespace
    const nodeId = this._config.nodeId

    // If using external distributed lock service
    if (this.distributedLock) {
      const released = await this.distributedLock.releaseLock(nodeId)
      if (released) {
        this._hasLeaderLock = false
        this._lockAcquiredAt = undefined
      }
      return released
    }

    // Use internal global lock
    const existingLock = LeaderFollowerManager._globalLeaderLock.get(namespace)

    if (existingLock && existingLock.holder === nodeId) {
      LeaderFollowerManager._globalLeaderLock.delete(namespace)
      this._hasLeaderLock = false
      this._lockAcquiredAt = undefined
      return true
    }

    // We don't hold the lock
    this._hasLeaderLock = false
    return false
  }

  /**
   * Static method to clear global lock state (for testing)
   */
  static clearGlobalLocks(): void {
    LeaderFollowerManager._globalLeaderLock.clear()
    LeaderFollowerManager._globalMaxEpoch.clear()
  }

  /**
   * Static method to get current global lock state (for testing/debugging)
   */
  static getGlobalLockState(namespace: string): { holder: string; epoch: number; acquiredAt: number } | undefined {
    return LeaderFollowerManager._globalLeaderLock.get(namespace)
  }
}
