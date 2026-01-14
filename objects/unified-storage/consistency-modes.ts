/**
 * ConsistencyModes - Configurable strong/eventual consistency modes
 *
 * Provides consistency levels for distributed storage operations:
 * - `strong` - Wait for leader acknowledgment (LeaderFollower) or quorum (MultiMaster)
 * - `eventual` - Return immediately after local write, propagate async
 * - `read-your-writes` - Ensure read returns own writes (session consistency)
 * - `causal` - Respect causal ordering via vector clocks
 *
 * @module unified-storage/consistency-modes
 * @see tests/unified-storage/consistency-modes.test.ts
 */

import type { VectorClock } from './multi-master'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Consistency levels for read/write operations
 */
export const ConsistencyLevel = {
  /** Wait for leader acknowledgment (LeaderFollower) or quorum (MultiMaster) */
  Strong: 'strong',
  /** Return immediately after local write, propagate async */
  Eventual: 'eventual',
  /** Ensure read returns own writes (session consistency) */
  ReadYourWrites: 'read-your-writes',
  /** Respect causal ordering via vector clocks */
  Causal: 'causal',
} as const

export type ConsistencyLevel = (typeof ConsistencyLevel)[keyof typeof ConsistencyLevel]

/**
 * Write operation for consistency controller
 */
export interface WriteOp {
  key: string
  value: unknown
  operation: 'create' | 'update' | 'delete'
  /** Optional vector clock for causal consistency */
  vectorClock?: Record<string, number>
}

/**
 * Write result from consistency controller
 */
export interface WriteResult {
  success: boolean
  sequence?: number
  acked?: boolean
  error?: string
  errorCode?: string
  /** Time waited for acknowledgment in ms */
  ackWaitMs?: number
}

/**
 * Read result from consistency controller
 */
export interface ReadResult {
  value: unknown | null
  stale?: boolean
  sequence?: number
  /** Vector clock of the value */
  vectorClock?: Record<string, number>
  /** Whether the read waited for replication */
  waited?: boolean
  /** Time waited for consistency in ms */
  waitMs?: number
}

/**
 * Configuration for ConsistencyController
 */
export interface ConsistencyConfig {
  /** Default consistency level for operations */
  defaultLevel: ConsistencyLevel
  /** Quorum size for strong consistency (default: majority) */
  quorumSize?: number
  /** Total number of replicas for quorum calculation */
  replicaCount?: number
  /** Maximum staleness in ms for eventual reads */
  maxStalenessMs?: number
  /** Default timeout for waiting on replication */
  defaultTimeoutMs?: number
  /** Node ID for session tracking */
  nodeId?: string
}

/**
 * Resolved configuration with defaults
 */
export interface ResolvedConsistencyConfig {
  readonly defaultLevel: ConsistencyLevel
  readonly quorumSize: number
  readonly replicaCount: number
  readonly maxStalenessMs: number
  readonly defaultTimeoutMs: number
  readonly nodeId: string
}

/**
 * Session state for read-your-writes consistency
 */
export interface SessionState {
  /** Last write sequence for this session */
  lastWriteSequence: number
  /** Last write timestamp */
  lastWriteTimestamp: number
  /** Vector clock at last write */
  lastWriteVectorClock?: Record<string, number>
  /** Session ID */
  sessionId: string
}

/**
 * Replication status from underlying managers
 */
export interface ReplicationStatus {
  /** Current sequence number */
  currentSequence: number
  /** Applied sequence number */
  appliedSequence: number
  /** Number of acknowledged replicas */
  ackedReplicas: number
  /** Total number of replicas */
  totalReplicas: number
  /** Last event timestamp */
  lastEventTimestamp: number
}

/**
 * State store interface (compatible with LeaderFollowerManager)
 */
export interface StateStore {
  get(key: string): unknown | undefined
  set(key: string, value: unknown): number
  delete(key: string): boolean
  has(key: string): boolean
}

/**
 * Replication manager interface (unified for both LeaderFollower and MultiMaster)
 */
export interface ReplicationManager {
  /** Get current replication status */
  getReplicationStatus?(): ReplicationStatus
  /** Wait for replication to reach a sequence */
  waitForSequence?(sequence: number, timeoutMs: number): Promise<boolean>
  /** Get vector clock (for multi-master) */
  getVectorClock?(): VectorClock | Record<string, number>
  /** Get applied sequence (for leader-follower) */
  getAppliedSequence?(): number
  /** Get current sequence (for leader) */
  getCurrentSequence?(): number
  /** Get acknowledged replicas count */
  getAckedReplicaCount?(): number
  /** Total replica count */
  getTotalReplicaCount?(): number
  /** Get last event timestamp */
  getLastEventTimestamp?(): number
}

/**
 * Metrics for consistency operations
 */
export interface ConsistencyMetrics {
  /** Writes by consistency level */
  writesByLevel: Record<ConsistencyLevel, number>
  /** Reads by consistency level */
  readsByLevel: Record<ConsistencyLevel, number>
  /** Total strong writes */
  strongWriteCount: number
  /** Total eventual writes */
  eventualWriteCount: number
  /** Average ack wait time for strong writes */
  avgAckWaitMs: number
  /** Stale reads detected */
  staleReadCount: number
  /** Causal ordering violations detected */
  causalViolationCount: number
  /** Session consistency violations */
  sessionViolationCount: number
}

/**
 * Acknowledgment waiter for tracking pending acks
 */
interface AckWaiter {
  sequence: number
  resolve: (acked: boolean) => void
  timeoutId: ReturnType<typeof setTimeout>
  startTime: number
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG = {
  quorumSize: 0, // Will be calculated from replicaCount
  replicaCount: 3,
  maxStalenessMs: 30000,
  defaultTimeoutMs: 5000,
  nodeId: 'default',
} as const

// ============================================================================
// CONSISTENCY CONTROLLER
// ============================================================================

/**
 * ConsistencyController - Manages consistency levels for storage operations
 *
 * Provides configurable consistency guarantees:
 * - Strong: Wait for quorum acknowledgment before returning
 * - Eventual: Return immediately, replicate asynchronously
 * - Read-Your-Writes: Session-based consistency for reading own writes
 * - Causal: Respect vector clock ordering for distributed operations
 */
export class ConsistencyController {
  private readonly _config: ResolvedConsistencyConfig
  private readonly stateStore?: StateStore
  private readonly replicationManager?: ReplicationManager

  // Session tracking for read-your-writes
  private readonly sessions: Map<string, SessionState> = new Map()
  private defaultSessionId: string

  // Sequence tracking
  private _currentSequence: number = 0
  private _appliedSequence: number = 0
  private _lastWriteTimestamp: number = 0

  // Acknowledgment tracking for strong consistency
  private readonly ackWaiters: Map<number, AckWaiter[]> = new Map()
  private _ackedSequence: number = 0

  // Vector clock for causal consistency
  private _vectorClock: Record<string, number> = {}

  // Metrics
  private _metrics: ConsistencyMetrics = {
    writesByLevel: {
      [ConsistencyLevel.Strong]: 0,
      [ConsistencyLevel.Eventual]: 0,
      [ConsistencyLevel.ReadYourWrites]: 0,
      [ConsistencyLevel.Causal]: 0,
    },
    readsByLevel: {
      [ConsistencyLevel.Strong]: 0,
      [ConsistencyLevel.Eventual]: 0,
      [ConsistencyLevel.ReadYourWrites]: 0,
      [ConsistencyLevel.Causal]: 0,
    },
    strongWriteCount: 0,
    eventualWriteCount: 0,
    avgAckWaitMs: 0,
    staleReadCount: 0,
    causalViolationCount: 0,
    sessionViolationCount: 0,
  }
  private _totalAckWaitMs: number = 0

  constructor(
    config: ConsistencyConfig,
    stateStore?: StateStore,
    replicationManager?: ReplicationManager
  ) {
    // Calculate default quorum size as majority
    const replicaCount = config.replicaCount ?? DEFAULT_CONFIG.replicaCount
    const defaultQuorumSize = Math.floor(replicaCount / 2) + 1

    this._config = Object.freeze({
      defaultLevel: config.defaultLevel,
      quorumSize: config.quorumSize ?? defaultQuorumSize,
      replicaCount,
      maxStalenessMs: config.maxStalenessMs ?? DEFAULT_CONFIG.maxStalenessMs,
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_CONFIG.defaultTimeoutMs,
      nodeId: config.nodeId ?? DEFAULT_CONFIG.nodeId,
    })

    this.stateStore = stateStore
    this.replicationManager = replicationManager
    this.defaultSessionId = `session-${this._config.nodeId}-${Date.now()}`

    // Initialize vector clock with this node
    this._vectorClock[this._config.nodeId] = 0
  }

  // ==========================================================================
  // PUBLIC GETTERS
  // ==========================================================================

  get config(): ResolvedConsistencyConfig {
    return this._config
  }

  getDefaultLevel(): ConsistencyLevel {
    return this._config.defaultLevel
  }

  getQuorumSize(): number {
    return this._config.quorumSize
  }

  getMetrics(): ConsistencyMetrics {
    return { ...this._metrics }
  }

  getCurrentSequence(): number {
    return this._currentSequence
  }

  getAppliedSequence(): number {
    return this._appliedSequence
  }

  getVectorClock(): Record<string, number> {
    return { ...this._vectorClock }
  }

  // ==========================================================================
  // WRITE OPERATIONS
  // ==========================================================================

  /**
   * Write with consistency level
   *
   * @param op - Write operation
   * @param level - Consistency level (defaults to config default)
   * @param timeout - Timeout for acknowledgment wait (defaults to config default)
   */
  async write(
    op: WriteOp,
    level?: ConsistencyLevel,
    timeout?: number
  ): Promise<WriteResult> {
    const effectiveLevel = level ?? this._config.defaultLevel
    const effectiveTimeout = timeout ?? this._config.defaultTimeoutMs

    // Track metrics
    this._metrics.writesByLevel[effectiveLevel]++

    switch (effectiveLevel) {
      case ConsistencyLevel.Strong:
        return this.writeStrong(op, effectiveTimeout)
      case ConsistencyLevel.Eventual:
        return this.writeEventual(op)
      case ConsistencyLevel.ReadYourWrites:
        return this.writeReadYourWrites(op)
      case ConsistencyLevel.Causal:
        return this.writeCausal(op)
      default:
        return this.writeEventual(op)
    }
  }

  /**
   * Strong consistency write - wait for quorum acknowledgment
   */
  private async writeStrong(op: WriteOp, timeout: number): Promise<WriteResult> {
    const startTime = Date.now()

    // Perform local write
    this._currentSequence++
    const sequence = this._currentSequence

    if (this.stateStore) {
      if (op.operation === 'delete') {
        this.stateStore.delete(op.key)
      } else {
        this.stateStore.set(op.key, op.value)
      }
    }

    this._lastWriteTimestamp = Date.now()
    this._metrics.strongWriteCount++

    // Wait for acknowledgment
    const acked = await this.waitForAck(sequence, timeout)
    const ackWaitMs = Date.now() - startTime

    // Update metrics
    this._totalAckWaitMs += ackWaitMs
    this._metrics.avgAckWaitMs = this._totalAckWaitMs / this._metrics.strongWriteCount

    return {
      success: true,
      sequence,
      acked,
      ackWaitMs,
      error: acked ? undefined : 'Acknowledgment timeout',
      errorCode: acked ? undefined : 'ACK_TIMEOUT',
    }
  }

  /**
   * Eventual consistency write - return immediately
   */
  private async writeEventual(op: WriteOp): Promise<WriteResult> {
    // Perform local write immediately
    this._currentSequence++
    const sequence = this._currentSequence

    if (this.stateStore) {
      if (op.operation === 'delete') {
        this.stateStore.delete(op.key)
      } else {
        this.stateStore.set(op.key, op.value)
      }
    }

    this._lastWriteTimestamp = Date.now()
    this._metrics.eventualWriteCount++

    // Return immediately without waiting
    return {
      success: true,
      sequence,
      acked: false,
      ackWaitMs: 0,
    }
  }

  /**
   * Read-your-writes consistency write - track session state
   */
  private async writeReadYourWrites(op: WriteOp): Promise<WriteResult> {
    // Perform local write
    this._currentSequence++
    const sequence = this._currentSequence

    if (this.stateStore) {
      if (op.operation === 'delete') {
        this.stateStore.delete(op.key)
      } else {
        this.stateStore.set(op.key, op.value)
      }
    }

    this._lastWriteTimestamp = Date.now()

    // Update session state
    this.updateSession(this.defaultSessionId, sequence, this._vectorClock)

    return {
      success: true,
      sequence,
      acked: false,
    }
  }

  /**
   * Causal consistency write - increment vector clock
   */
  private async writeCausal(op: WriteOp): Promise<WriteResult> {
    // Increment local vector clock
    this._vectorClock[this._config.nodeId] =
      (this._vectorClock[this._config.nodeId] ?? 0) + 1

    // Merge with incoming vector clock if provided
    if (op.vectorClock) {
      this.mergeVectorClock(op.vectorClock)
    }

    // Perform local write
    this._currentSequence++
    const sequence = this._currentSequence

    if (this.stateStore) {
      if (op.operation === 'delete') {
        this.stateStore.delete(op.key)
      } else {
        this.stateStore.set(op.key, op.value)
      }
    }

    this._lastWriteTimestamp = Date.now()

    // Update session state with vector clock
    this.updateSession(this.defaultSessionId, sequence, this._vectorClock)

    return {
      success: true,
      sequence,
      acked: false,
    }
  }

  // ==========================================================================
  // READ OPERATIONS
  // ==========================================================================

  /**
   * Read with consistency level
   *
   * @param key - Key to read
   * @param level - Consistency level (defaults to config default)
   * @param timeout - Timeout for consistency wait (defaults to config default)
   */
  async read(
    key: string,
    level?: ConsistencyLevel,
    timeout?: number
  ): Promise<ReadResult> {
    const effectiveLevel = level ?? this._config.defaultLevel
    const effectiveTimeout = timeout ?? this._config.defaultTimeoutMs

    // Track metrics
    this._metrics.readsByLevel[effectiveLevel]++

    switch (effectiveLevel) {
      case ConsistencyLevel.Strong:
        return this.readStrong(key, effectiveTimeout)
      case ConsistencyLevel.Eventual:
        return this.readEventual(key)
      case ConsistencyLevel.ReadYourWrites:
        return this.readReadYourWrites(key, effectiveTimeout)
      case ConsistencyLevel.Causal:
        return this.readCausal(key, effectiveTimeout)
      default:
        return this.readEventual(key)
    }
  }

  /**
   * Strong consistency read - wait for latest replication
   */
  private async readStrong(key: string, timeout: number): Promise<ReadResult> {
    const startTime = Date.now()

    // Check if we're already caught up - no waiting needed
    const alreadyCaughtUp = this._appliedSequence >= this._currentSequence

    // Wait for replication to catch up to current sequence
    const replicationSuccess = await this.waitForReplication(this._currentSequence, timeout)
    const waitMs = Date.now() - startTime

    const value = this.stateStore?.get(key) ?? null

    return {
      value,
      stale: !replicationSuccess,
      sequence: this._appliedSequence,
      vectorClock: { ...this._vectorClock },
      waited: !alreadyCaughtUp, // Only report waited if we weren't already caught up
      waitMs,
    }
  }

  /**
   * Eventual consistency read - return immediately, may be stale
   */
  private async readEventual(key: string): Promise<ReadResult> {
    const value = this.stateStore?.get(key) ?? null

    // Check staleness
    const stale = this.isStale(this._lastWriteTimestamp, this._config.maxStalenessMs)
    if (stale) {
      this._metrics.staleReadCount++
    }

    return {
      value,
      stale,
      sequence: this._appliedSequence,
      vectorClock: { ...this._vectorClock },
      waited: false,
      waitMs: 0,
    }
  }

  /**
   * Read-your-writes consistency read - ensure session's writes are visible
   */
  private async readReadYourWrites(key: string, timeout: number): Promise<ReadResult> {
    const startTime = Date.now()
    const session = this.sessions.get(this.defaultSessionId)

    let waited = false
    let waitMs = 0

    if (session) {
      // Wait for our own writes to be applied
      if (this._appliedSequence < session.lastWriteSequence) {
        waited = await this.waitForReplication(session.lastWriteSequence, timeout)
        waitMs = Date.now() - startTime

        if (!waited) {
          this._metrics.sessionViolationCount++
        }
      }
    }

    const value = this.stateStore?.get(key) ?? null

    return {
      value,
      stale: false, // Not stale if we see our own writes
      sequence: this._appliedSequence,
      vectorClock: { ...this._vectorClock },
      waited,
      waitMs,
    }
  }

  /**
   * Causal consistency read - respect vector clock ordering
   */
  private async readCausal(key: string, timeout: number): Promise<ReadResult> {
    const startTime = Date.now()
    const session = this.sessions.get(this.defaultSessionId)

    let waited = false
    let waitMs = 0

    if (session?.lastWriteVectorClock) {
      // Check if we've seen all causally preceding writes
      const causallyReady = this.isCausallySatisfied(session.lastWriteVectorClock)

      if (!causallyReady) {
        // Wait for causal dependencies
        waited = await this.waitForCausalDependencies(
          session.lastWriteVectorClock,
          timeout
        )
        waitMs = Date.now() - startTime

        if (!waited) {
          this._metrics.causalViolationCount++
        }
      }
    }

    const value = this.stateStore?.get(key) ?? null

    return {
      value,
      stale: false,
      sequence: this._appliedSequence,
      vectorClock: { ...this._vectorClock },
      waited,
      waitMs,
    }
  }

  // ==========================================================================
  // STALENESS CHECK
  // ==========================================================================

  /**
   * Check if data is stale based on last write timestamp
   */
  isStale(lastWrite: number, maxStaleMs: number): boolean {
    const now = Date.now()
    const elapsed = now - lastWrite
    return elapsed > maxStaleMs
  }

  // ==========================================================================
  // REPLICATION WAIT
  // ==========================================================================

  /**
   * Wait for replication to reach a sequence number
   *
   * @param sequence - Target sequence number
   * @param timeout - Timeout in milliseconds
   * @returns Whether replication reached the sequence
   */
  async waitForReplication(sequence: number, timeout?: number): Promise<boolean> {
    const effectiveTimeout = timeout ?? this._config.defaultTimeoutMs

    // Already at or past the sequence
    if (this._appliedSequence >= sequence) {
      return true
    }

    // Check replication manager if available
    if (this.replicationManager?.waitForSequence) {
      return this.replicationManager.waitForSequence(sequence, effectiveTimeout)
    }

    // Poll for replication
    return new Promise<boolean>((resolve) => {
      const startTime = Date.now()

      const checkInterval = setInterval(() => {
        if (this._appliedSequence >= sequence) {
          clearInterval(checkInterval)
          resolve(true)
          return
        }

        if (Date.now() - startTime >= effectiveTimeout) {
          clearInterval(checkInterval)
          resolve(false)
        }
      }, 10) // Check every 10ms
    })
  }

  // ==========================================================================
  // ACKNOWLEDGMENT HANDLING
  // ==========================================================================

  /**
   * Wait for acknowledgment of a sequence number
   */
  private async waitForAck(sequence: number, timeout: number): Promise<boolean> {
    // Already acknowledged
    if (this._ackedSequence >= sequence) {
      return true
    }

    return new Promise<boolean>((resolve) => {
      const waiter: AckWaiter = {
        sequence,
        resolve,
        startTime: Date.now(),
        timeoutId: setTimeout(() => {
          // Remove waiter and resolve with false
          this.removeAckWaiter(sequence, waiter)
          resolve(false)
        }, timeout),
      }

      // Add to waiters
      if (!this.ackWaiters.has(sequence)) {
        this.ackWaiters.set(sequence, [])
      }
      this.ackWaiters.get(sequence)!.push(waiter)
    })
  }

  /**
   * Acknowledge a sequence number (called by replication layer)
   */
  acknowledge(sequence: number): void {
    this._ackedSequence = Math.max(this._ackedSequence, sequence)

    // Resolve all waiters for this sequence and below
    for (const [seq, waiters] of this.ackWaiters) {
      if (seq <= sequence) {
        for (const waiter of waiters) {
          clearTimeout(waiter.timeoutId)
          waiter.resolve(true)
        }
        this.ackWaiters.delete(seq)
      }
    }
  }

  /**
   * Remove a specific ack waiter
   */
  private removeAckWaiter(sequence: number, waiter: AckWaiter): void {
    const waiters = this.ackWaiters.get(sequence)
    if (waiters) {
      const idx = waiters.indexOf(waiter)
      if (idx >= 0) {
        waiters.splice(idx, 1)
      }
      if (waiters.length === 0) {
        this.ackWaiters.delete(sequence)
      }
    }
  }

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  /**
   * Create or get a session for read-your-writes consistency
   */
  createSession(sessionId?: string): string {
    const id = sessionId ?? `session-${this._config.nodeId}-${Date.now()}-${Math.random().toString(36).slice(2)}`

    if (!this.sessions.has(id)) {
      this.sessions.set(id, {
        lastWriteSequence: 0,
        lastWriteTimestamp: 0,
        sessionId: id,
      })
    }

    return id
  }

  /**
   * Get session state
   */
  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Update session state after a write
   */
  private updateSession(
    sessionId: string,
    sequence: number,
    vectorClock?: Record<string, number>
  ): void {
    let session = this.sessions.get(sessionId)

    if (!session) {
      session = {
        lastWriteSequence: 0,
        lastWriteTimestamp: 0,
        sessionId,
      }
      this.sessions.set(sessionId, session)
    }

    session.lastWriteSequence = sequence
    session.lastWriteTimestamp = Date.now()
    if (vectorClock) {
      session.lastWriteVectorClock = { ...vectorClock }
    }
  }

  /**
   * Set the default session ID
   */
  setDefaultSession(sessionId: string): void {
    this.defaultSessionId = sessionId
    this.createSession(sessionId)
  }

  // ==========================================================================
  // VECTOR CLOCK MANAGEMENT
  // ==========================================================================

  /**
   * Merge a remote vector clock into local clock
   */
  mergeVectorClock(remote: Record<string, number>): void {
    for (const [node, value] of Object.entries(remote)) {
      this._vectorClock[node] = Math.max(this._vectorClock[node] ?? 0, value)
    }
  }

  /**
   * Check if all causal dependencies are satisfied
   */
  private isCausallySatisfied(required: Record<string, number>): boolean {
    for (const [node, value] of Object.entries(required)) {
      if ((this._vectorClock[node] ?? 0) < value) {
        return false
      }
    }
    return true
  }

  /**
   * Wait for causal dependencies to be satisfied
   */
  private async waitForCausalDependencies(
    required: Record<string, number>,
    timeout: number
  ): Promise<boolean> {
    const startTime = Date.now()

    return new Promise<boolean>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.isCausallySatisfied(required)) {
          clearInterval(checkInterval)
          resolve(true)
          return
        }

        if (Date.now() - startTime >= timeout) {
          clearInterval(checkInterval)
          resolve(false)
        }
      }, 10)
    })
  }

  /**
   * Set vector clock entry (for testing or external updates)
   */
  setVectorClockEntry(node: string, value: number): void {
    this._vectorClock[node] = value
  }

  // ==========================================================================
  // EXTERNAL STATE UPDATES
  // ==========================================================================

  /**
   * Update applied sequence (called by replication layer)
   */
  updateAppliedSequence(sequence: number): void {
    this._appliedSequence = sequence
  }

  /**
   * Update current sequence (for synchronization)
   */
  updateCurrentSequence(sequence: number): void {
    this._currentSequence = sequence
  }

  /**
   * Update last write timestamp
   */
  updateLastWriteTimestamp(timestamp: number): void {
    this._lastWriteTimestamp = timestamp
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Clear all pending ack waiters
   */
  clearPendingAcks(): void {
    for (const [, waiters] of this.ackWaiters) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeoutId)
        waiter.resolve(false)
      }
    }
    this.ackWaiters.clear()
  }

  /**
   * Clear all sessions
   */
  clearSessions(): void {
    this.sessions.clear()
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this._metrics = {
      writesByLevel: {
        [ConsistencyLevel.Strong]: 0,
        [ConsistencyLevel.Eventual]: 0,
        [ConsistencyLevel.ReadYourWrites]: 0,
        [ConsistencyLevel.Causal]: 0,
      },
      readsByLevel: {
        [ConsistencyLevel.Strong]: 0,
        [ConsistencyLevel.Eventual]: 0,
        [ConsistencyLevel.ReadYourWrites]: 0,
        [ConsistencyLevel.Causal]: 0,
      },
      strongWriteCount: 0,
      eventualWriteCount: 0,
      avgAckWaitMs: 0,
      staleReadCount: 0,
      causalViolationCount: 0,
      sessionViolationCount: 0,
    }
    this._totalAckWaitMs = 0
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate majority quorum size for a given replica count
 */
export function calculateMajorityQuorum(replicaCount: number): number {
  return Math.floor(replicaCount / 2) + 1
}

/**
 * Check if quorum is satisfied
 */
export function isQuorumSatisfied(
  ackedCount: number,
  quorumSize: number
): boolean {
  return ackedCount >= quorumSize
}

/**
 * Compare two vector clocks for causal ordering
 * Returns: 'before', 'after', 'concurrent', or 'equal'
 */
export function compareVectorClocks(
  a: Record<string, number>,
  b: Record<string, number>
): 'before' | 'after' | 'concurrent' | 'equal' {
  const allNodes = new Set([...Object.keys(a), ...Object.keys(b)])

  let aLeqB = true
  let bLeqA = true
  let strictlyLess = false
  let strictlyGreater = false

  for (const node of allNodes) {
    const aVal = a[node] ?? 0
    const bVal = b[node] ?? 0

    if (aVal > bVal) {
      aLeqB = false
      strictlyGreater = true
    }
    if (aVal < bVal) {
      bLeqA = false
      strictlyLess = true
    }
  }

  if (aLeqB && bLeqA) {
    return 'equal'
  }
  if (aLeqB && strictlyLess) {
    return 'before'
  }
  if (bLeqA && strictlyGreater) {
    return 'after'
  }
  return 'concurrent'
}
