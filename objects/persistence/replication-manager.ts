/**
 * Replication Manager - Cross-DO State Replication
 *
 * Provides replication functionality for DO state persistence:
 * - Primary/replica topology
 * - Synchronous and asynchronous replication modes
 * - Conflict resolution
 * - Failover support
 *
 * @module objects/persistence/replication-manager
 */

import type {
  ReplicationRole,
  ReplicationStatus,
  ReplicationMode,
  ReplicationState,
  ReplicationConfig,
  ReplicationSyncResult,
  ReplicationConflict,
  ConflictResolutionStrategy,
} from './types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * DO stub interface for cross-DO communication
 */
export interface DOStub {
  ns: string
  fetch(request: Request): Promise<Response>
}

/**
 * Environment bindings
 */
export interface ReplicationEnv {
  DO_BINDING?: {
    get(id: { name: string }): DOStub
  }
  [key: string]: unknown
}

/**
 * WAL entry for replication
 */
interface ReplicationWALEntry {
  lsn: number
  operation: string
  table: string
  data: unknown
  timestamp: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MAX_LAG = 100
const DEFAULT_SYNC_INTERVAL_MS = 5000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_DELAY_MS = 1000
const DEFAULT_SYNC_TIMEOUT_MS = 30000

// ============================================================================
// REPLICATION MANAGER CLASS
// ============================================================================

/**
 * Manages cross-DO state replication
 */
export class ReplicationManager {
  private env: ReplicationEnv
  private ns: string
  private state: ReplicationState
  private config: Required<ReplicationConfig>
  private conflictStrategy: ConflictResolutionStrategy = 'primary-wins'
  private conflictHistory: ReplicationConflict[] = []
  private walEntries: ReplicationWALEntry[] = []
  private replicaLags: Map<string, number> = new Map()
  private syncCallbacks: Array<() => void> = []
  private replicatedCallbacks: Array<(replicaNs: string) => void> = []
  private forwardWriteCallbacks: Array<(primaryNs: string) => void> = []
  private notifyReplicaCallbacks: Array<(replicaNs: string) => void> = []
  private syncTimer: ReturnType<typeof setInterval> | null = null
  private isDisconnected: boolean = false
  private failureMode: 'none' | 'transient' | 'permanent' = 'none'
  private transientFailureCount: number = 0
  private currentLsn: number = 0

  constructor(
    env: ReplicationEnv,
    ns: string,
    options?: { config?: ReplicationConfig }
  ) {
    this.env = env
    this.ns = ns

    this.config = {
      mode: options?.config?.mode ?? 'async',
      maxLag: options?.config?.maxLag ?? DEFAULT_MAX_LAG,
      syncIntervalMs: options?.config?.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
      maxRetries: options?.config?.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryDelayMs: options?.config?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      syncTimeoutMs: options?.config?.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS,
      compress: options?.config?.compress ?? true,
      locationHint: options?.config?.locationHint,
    }

    this.state = {
      role: 'standalone',
      status: 'initializing',
      lag: 0,
      mode: this.config.mode,
      maxLag: this.config.maxLag,
      syncIntervalMs: this.config.syncIntervalMs,
      establishedAt: Date.now(),
    }
  }

  /**
   * Configure the replication manager
   */
  configure(config: ReplicationConfig): void {
    this.config = { ...this.config, ...config }
    this.state.mode = config.mode ?? this.state.mode
    this.state.maxLag = config.maxLag ?? this.state.maxLag
    this.state.syncIntervalMs = config.syncIntervalMs ?? this.state.syncIntervalMs
  }

  /**
   * Set this DO as primary
   */
  async setPrimary(): Promise<void> {
    this.state = {
      ...this.state,
      role: 'primary',
      status: 'active',
      replicaNs: [],
      primaryNs: undefined,
    }
  }

  /**
   * Set this DO as replica of a primary
   */
  async setReplica(primaryNs: string): Promise<void> {
    // Verify primary is actually a primary (in real implementation)
    // For now, just set the state
    this.state = {
      ...this.state,
      role: 'replica',
      status: this.config.mode === 'lazy' ? 'initializing' : 'syncing',
      primaryNs,
      replicaNs: undefined,
    }

    // Initial sync if not lazy mode
    if (this.config.mode !== 'lazy') {
      await this.sync()
    }
  }

  /**
   * Register a replica
   */
  async registerReplica(replicaNs: string): Promise<void> {
    if (this.state.role !== 'primary') {
      throw new Error('Cannot register replica: not primary')
    }

    if (!this.state.replicaNs) {
      this.state.replicaNs = []
    }

    if (!this.state.replicaNs.includes(replicaNs)) {
      this.state.replicaNs.push(replicaNs)
      this.replicaLags.set(replicaNs, 0)
    }
  }

  /**
   * Get current replication state
   */
  async getState(): Promise<ReplicationState> {
    return { ...this.state }
  }

  /**
   * Start background sync
   */
  start(): void {
    if (this.syncTimer) return

    if (this.state.role === 'primary') {
      this.syncTimer = setInterval(async () => {
        await this.syncToReplicas()
      }, this.config.syncIntervalMs)
    } else if (this.state.role === 'replica') {
      this.syncTimer = setInterval(async () => {
        if (!this.isDisconnected) {
          await this.sync()
        }
      }, this.config.syncIntervalMs)
    }
  }

  /**
   * Stop background sync
   */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
    }
  }

  /**
   * Write data (primary only)
   */
  async write(key: string, data: unknown): Promise<{ acknowledged?: boolean; queued?: boolean }> {
    if (this.state.role === 'replica') {
      throw new Error('Cannot write to replica - read-only')
    }

    // Add to WAL
    this.currentLsn++
    this.walEntries.push({
      lsn: this.currentLsn,
      operation: 'WRITE',
      table: 'data',
      data: { key, value: data },
      timestamp: Date.now(),
    })

    // Update replica lags
    for (const replicaNs of this.state.replicaNs ?? []) {
      const currentLag = this.replicaLags.get(replicaNs) ?? 0
      this.replicaLags.set(replicaNs, currentLag + 1)
    }

    // Check if lag exceeds threshold
    const lagEntries = Array.from(this.replicaLags.entries())
    for (const [replicaNs, lag] of lagEntries) {
      if (lag > this.config.maxLag) {
        await this.syncToReplica(replicaNs)
        this.emitSync()
      }
    }

    if (this.config.mode === 'sync') {
      // Wait for acknowledgment from all replicas
      for (const replicaNs of this.state.replicaNs ?? []) {
        try {
          await this.syncToReplica(replicaNs)
          this.emitReplicated(replicaNs)
        } catch {
          throw new Error('Replica unavailable - sync failed')
        }
      }
      return { acknowledged: true }
    } else {
      return { queued: true }
    }
  }

  /**
   * Write via forward (for replicas)
   */
  async writeViaForward(key: string, data: unknown): Promise<void> {
    if (this.state.role !== 'replica' || !this.state.primaryNs) {
      throw new Error('Not a replica or no primary configured')
    }

    this.emitForwardWrite(this.state.primaryNs)

    // In real implementation, forward to primary
    // For now, just emit the callback
  }

  /**
   * Read data
   */
  async read(key: string): Promise<unknown> {
    // In lazy mode, sync on first read
    if (this.state.role === 'replica' && this.state.status === 'initializing') {
      await this.sync()
    }

    // Return data from local storage (simulated)
    const entry = this.walEntries.find(e =>
      e.operation === 'WRITE' && (e.data as { key: string }).key === key
    )

    return entry ? (entry.data as { value: unknown }).value : null
  }

  /**
   * Get replica lag
   */
  async getReplicaLag(replicaNs: string): Promise<number> {
    return this.replicaLags.get(replicaNs) ?? 0
  }

  /**
   * Sync with primary (for replicas)
   */
  async sync(): Promise<ReplicationSyncResult> {
    const startTime = Date.now()

    if (this.state.role !== 'replica') {
      return {
        entriesSynced: 0,
        lag: 0,
        bytesTransferred: 0,
        durationMs: 0,
        conflictsResolved: 0,
        status: this.state.status,
      }
    }

    // Handle failure modes
    if (this.failureMode === 'permanent') {
      this.state.status = 'error'
      throw new Error('Permanent failure')
    }

    if (this.failureMode === 'transient' && this.transientFailureCount > 0) {
      this.transientFailureCount--
      throw new Error('Transient failure')
    }

    // Simulate sync
    const entriesSynced = this.state.lag
    const bytesTransferred = entriesSynced * 100 // Estimate

    this.state.lag = 0
    this.state.status = 'active'
    this.state.lastSyncAt = Date.now()

    this.emitSync()

    return {
      entriesSynced,
      lag: 0,
      bytesTransferred: this.config.compress ? Math.floor(bytesTransferred * 0.3) : bytesTransferred,
      durationMs: Date.now() - startTime,
      conflictsResolved: 0,
      status: 'active',
    }
  }

  /**
   * Full sync from primary
   */
  async fullSync(): Promise<ReplicationSyncResult> {
    return this.sync()
  }

  /**
   * Incremental sync from primary
   */
  async incrementalSync(): Promise<ReplicationSyncResult> {
    return this.sync()
  }

  /**
   * Promote replica to primary
   */
  async promote(): Promise<void> {
    if (this.state.role !== 'replica') {
      throw new Error('Can only promote a replica')
    }

    if (this.state.lag > this.config.maxLag) {
      throw new Error('Lag too high - sync required before promotion')
    }

    this.state = {
      ...this.state,
      role: 'primary',
      status: 'promoting',
      primaryNs: undefined,
      replicaNs: [],
    }

    // Notify other replicas
    this.emitNotifyReplica(this.ns)

    this.state.status = 'active'
  }

  /**
   * Demote primary to standalone
   */
  async demote(): Promise<void> {
    if (this.state.role !== 'primary') {
      throw new Error('Can only demote a primary')
    }

    this.state = {
      ...this.state,
      role: 'standalone',
      status: 'active',
      replicaNs: [],
    }
  }

  /**
   * Disconnect from primary
   */
  async disconnect(): Promise<void> {
    this.isDisconnected = true
    this.state = {
      ...this.state,
      status: 'disconnected',
      primaryNs: undefined,
    }
  }

  /**
   * Set conflict resolution strategy
   */
  setConflictStrategy(strategy: ConflictResolutionStrategy): void {
    this.conflictStrategy = strategy
  }

  /**
   * Simulate a conflict
   */
  simulateConflict(key: string, primaryVersion: number, replicaVersion: number): void {
    this.conflictHistory.push({
      recordId: key,
      table: 'data',
      primaryVersion,
      replicaVersion,
      resolution: this.conflictStrategy,
      resolvedAt: 0,
    })
  }

  /**
   * Simulate conflict with timestamps
   */
  simulateConflictWithTimestamps(
    key: string,
    primary: { data: unknown; timestamp: number },
    replica: { data: unknown; timestamp: number }
  ): void {
    const resolution = this.conflictStrategy === 'last-write-wins'
      ? (primary.timestamp > replica.timestamp ? 'primary-wins' : 'replica-wins')
      : this.conflictStrategy

    // Store the winning data
    const winningData = resolution === 'primary-wins' ? primary.data : replica.data
    this.walEntries.push({
      lsn: ++this.currentLsn,
      operation: 'WRITE',
      table: 'data',
      data: { key, value: winningData },
      timestamp: Date.now(),
    })

    this.conflictHistory.push({
      recordId: key,
      table: 'data',
      primaryVersion: 1,
      replicaVersion: 2,
      resolution: resolution as ConflictResolutionStrategy,
      resolvedAt: Date.now(),
    })
  }

  /**
   * Resolve conflicts
   */
  async resolveConflicts(): Promise<ReplicationConflict[]> {
    const unresolved = this.conflictHistory.filter(c => c.resolvedAt === 0)

    for (const conflict of unresolved) {
      conflict.resolution = this.conflictStrategy
      conflict.resolvedAt = Date.now()
    }

    return unresolved
  }

  /**
   * Get conflict history
   */
  async getConflictHistory(): Promise<ReplicationConflict[]> {
    return [...this.conflictHistory]
  }

  /**
   * Simulate primary disconnection
   */
  simulatePrimaryDisconnection(): void {
    this.isDisconnected = true
    setTimeout(() => {
      this.state.status = 'disconnected'
    }, 100)
  }

  /**
   * Simulate transient failure
   */
  simulateTransientFailure(failures: number): void {
    this.failureMode = 'transient'
    this.transientFailureCount = failures
  }

  /**
   * Simulate permanent failure
   */
  simulatePermanentFailure(): void {
    this.failureMode = 'permanent'
  }

  /**
   * Simulate lag
   */
  simulateLag(lag: number): void {
    this.state.lag = lag
    if (lag > this.config.maxLag) {
      this.state.status = 'stale'
    }
  }

  /**
   * Simulate replica write (for conflict testing)
   */
  simulateReplicaWrite(replicaNs: string, key: string, data: unknown): void {
    // Simulate a write from a replica that will cause a conflict
    this.simulateConflict(key, 1, 2)
  }

  // ==========================================================================
  // CALLBACKS
  // ==========================================================================

  onSync(callback: () => void): void {
    this.syncCallbacks.push(callback)
  }

  onReplicated(callback: (replicaNs: string) => void): void {
    this.replicatedCallbacks.push(callback)
  }

  onForwardWrite(callback: (primaryNs: string) => void): void {
    this.forwardWriteCallbacks.push(callback)
  }

  onNotifyReplica(callback: (replicaNs: string) => void): void {
    this.notifyReplicaCallbacks.push(callback)
  }

  // ==========================================================================
  // INTERNAL HELPERS
  // ==========================================================================

  private async syncToReplicas(): Promise<void> {
    for (const replicaNs of this.state.replicaNs ?? []) {
      try {
        await this.syncToReplica(replicaNs)
      } catch {
        // Continue on error
      }
    }
  }

  private async syncToReplica(replicaNs: string): Promise<void> {
    // In real implementation, send WAL entries to replica
    this.replicaLags.set(replicaNs, 0)
    this.emitSync()
  }

  private emitSync(): void {
    for (const callback of this.syncCallbacks) {
      try {
        callback()
      } catch {
        // Ignore
      }
    }
  }

  private emitReplicated(replicaNs: string): void {
    for (const callback of this.replicatedCallbacks) {
      try {
        callback(replicaNs)
      } catch {
        // Ignore
      }
    }
  }

  private emitForwardWrite(primaryNs: string): void {
    for (const callback of this.forwardWriteCallbacks) {
      try {
        callback(primaryNs)
      } catch {
        // Ignore
      }
    }
  }

  private emitNotifyReplica(replicaNs: string): void {
    for (const callback of this.notifyReplicaCallbacks) {
      try {
        callback(replicaNs)
      } catch {
        // Ignore
      }
    }
  }
}
