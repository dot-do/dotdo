/**
 * Checkpoint Manager
 *
 * Manages automatic and manual checkpointing of session state to R2.
 * Implements the Iceberg pattern: recent ops in DO SQLite (WAL),
 * checkpoints in R2 for durability.
 *
 * @module bashx/session/checkpoint-manager
 */

import type {
  SessionState,
  SessionId,
  Checkpoint,
  CheckpointType,
  CheckpointConfig,
  CheckpointStorage,
  WALStorage,
  WALEntry,
  SessionRef,
  SessionMetricsCollector,
} from './types.js'
import { noopMetricsCollector } from './types.js'

// ============================================================================
// Checkpoint Manager
// ============================================================================

/**
 * Manages session checkpointing to R2 storage.
 *
 * Responsibilities:
 * - Track pending operations since last checkpoint
 * - Auto-checkpoint on idle or threshold
 * - Create checkpoints on fork/branch/manual
 * - Manage HEAD reference updates
 */
export class CheckpointManager {
  private timer: ReturnType<typeof setTimeout> | null = null
  private pendingOps: number = 0
  private lastCheckpoint: number = Date.now()
  private latestCheckpointHash: string | null = null
  private metricsCollector: SessionMetricsCollector

  constructor(
    private sessionId: SessionId,
    private config: CheckpointConfig,
    private checkpointStorage: CheckpointStorage,
    private walStorage: WALStorage,
    private getTreeHash: () => Promise<string>,
    private getState?: () => SessionState,
    metricsCollector?: SessionMetricsCollector
  ) {
    this.metricsCollector = metricsCollector ?? noopMetricsCollector
  }

  /**
   * Called after each operation to potentially trigger checkpoint.
   */
  async onOperation(entry: WALEntry): Promise<void> {
    // Record in WAL
    await this.walStorage.append(this.sessionId, entry)

    this.pendingOps++

    // Reset idle timer
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(
      () => this.checkpointIfNeeded('idle'),
      this.config.idleTimeout * 1000
    )

    // Check command threshold
    if (this.pendingOps >= this.config.commandThreshold) {
      await this.checkpoint('auto', 'Automatic checkpoint (threshold)')
    }
  }

  /**
   * Check if checkpoint is needed and create one if so.
   */
  private async checkpointIfNeeded(reason: 'idle'): Promise<void> {
    const now = Date.now()

    // Enforce minimum interval
    if (now - this.lastCheckpoint < this.config.minInterval * 1000) {
      return
    }

    if (this.pendingOps > 0) {
      await this.checkpoint('auto', `Automatic checkpoint (${reason})`)
    }
  }

  /**
   * Create a checkpoint of current session state.
   */
  async checkpoint(
    type: CheckpointType,
    message?: string,
    state?: SessionState
  ): Promise<Checkpoint> {
    const startTime = Date.now()

    // Emit checkpoint start event
    this.metricsCollector.emit({
      type: 'checkpoint:start',
      sessionId: this.sessionId,
      timestamp: startTime,
      checkpointType: type,
    })

    // Get current tree hash from filesystem
    const treeHash = await this.getTreeHash()

    // Build checkpoint
    const checkpoint: Checkpoint = {
      hash: '', // Will be computed
      state: state || await this.buildCurrentState(treeHash),
      parentHash: this.latestCheckpointHash,
      type,
      message,
      r2Key: '', // Will be set
      size: 0,
      compression: 'gzip',
    }

    // Compute content hash
    checkpoint.hash = await this.computeCheckpointHash(checkpoint)
    checkpoint.r2Key = `checkpoints/${checkpoint.hash}`

    // Serialize and store
    const serialized = JSON.stringify(checkpoint)
    checkpoint.size = serialized.length

    await this.checkpointStorage.putCheckpoint(checkpoint)

    // Update HEAD reference
    const headRef: SessionRef = {
      name: `sessions/${this.sessionId}/HEAD`,
      checkpointHash: checkpoint.hash,
      type: 'head',
      sessionId: this.sessionId,
      updatedAt: startTime,
    }
    await this.checkpointStorage.putRef(headRef)

    // Mark WAL entries as checkpointed
    const latestSeq = await this.walStorage.getLatestSeq(this.sessionId)
    await this.walStorage.markCheckpointed(this.sessionId, latestSeq)

    // Update local state
    this.pendingOps = 0
    this.lastCheckpoint = startTime
    this.latestCheckpointHash = checkpoint.hash

    const duration = Date.now() - startTime

    // Update checkpoint metrics in session state
    if (this.getState) {
      const sessionState = this.getState()
      sessionState.metrics.checkpointCount++
      sessionState.metrics.lastCheckpointAt = startTime
      sessionState.metrics.totalCheckpointDuration += duration
      sessionState.metrics.avgCheckpointDuration =
        sessionState.metrics.totalCheckpointDuration / sessionState.metrics.checkpointCount
      sessionState.metrics.minCheckpointDuration = Math.min(
        sessionState.metrics.minCheckpointDuration,
        duration
      )
      sessionState.metrics.maxCheckpointDuration = Math.max(
        sessionState.metrics.maxCheckpointDuration,
        duration
      )
    }

    // Emit checkpoint end event
    this.metricsCollector.emit({
      type: 'checkpoint:end',
      sessionId: this.sessionId,
      timestamp: Date.now(),
      checkpointType: type,
      hash: checkpoint.hash,
      durationMs: duration,
      sizeBytes: checkpoint.size,
    })

    return checkpoint
  }

  /**
   * Build current session state from the Session's live state.
   * Uses the getState callback to access the session's current _state.
   */
  private async buildCurrentState(treeHash: string): Promise<SessionState> {
    if (!this.getState) {
      throw new Error('CheckpointManager requires getState callback to build current state')
    }

    // Get the current state from the Session
    const currentState = this.getState()

    // Return a deep copy of the state with the current tree hash
    // Deep copy arrays and nested objects to prevent mutations from affecting the checkpoint
    return {
      ...currentState,
      treeHash,
      updatedAt: Date.now(),
      // Deep copy mutable fields
      env: { ...currentState.env },
      history: [...currentState.history],  // Copy history array
      processes: [...currentState.processes],
      config: {
        ...currentState.config,
        checkpoint: { ...currentState.config.checkpoint }
      },
      metrics: { ...currentState.metrics },
    }
  }

  /**
   * Compute content hash for a checkpoint.
   */
  private async computeCheckpointHash(checkpoint: Omit<Checkpoint, 'hash'>): Promise<string> {
    const content = JSON.stringify({
      state: checkpoint.state,
      parentHash: checkpoint.parentHash,
      type: checkpoint.type,
    })

    // Use SubtleCrypto for SHA-1 (or SHA-256)
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Get the latest checkpoint for this session.
   */
  async getLatestCheckpoint(): Promise<Checkpoint | null> {
    if (this.latestCheckpointHash) {
      return this.checkpointStorage.getCheckpoint(this.latestCheckpointHash)
    }

    // Try to load from HEAD ref
    const headRef = await this.checkpointStorage.getRef(
      `sessions/${this.sessionId}/HEAD`
    )
    if (headRef) {
      this.latestCheckpointHash = headRef.checkpointHash
      return this.checkpointStorage.getCheckpoint(headRef.checkpointHash)
    }

    return null
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
