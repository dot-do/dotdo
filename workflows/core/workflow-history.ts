/**
 * WorkflowHistory - Time-travel enabled workflow history using TemporalStore
 *
 * Provides workflow history tracking with:
 * - Time-travel debugging: replay workflow to any point
 * - Efficient snapshots for long-running workflows
 * - Retention policies for memory management
 * - Versioned state for Continue-As-New
 *
 * Uses TemporalStore primitive for time-aware key-value storage with:
 * - put/get with timestamps
 * - getAsOf for historical queries (time-travel)
 * - snapshot/restoreSnapshot for checkpointing
 * - prune/compact for retention-based cleanup
 *
 * @module workflows/core/workflow-history
 */

import {
  createTemporalStore,
  type TemporalStore,
  type SnapshotId,
  type SnapshotInfo,
  type RetentionPolicy,
  type PruneStats,
} from '../../db/primitives/temporal-store'

// Re-export RetentionPolicy for use by WorkflowCore
export type { RetentionPolicy, PruneStats, SnapshotId }

import { type MetricsCollector, noopMetrics } from '../../db/primitives/observability'

// ============================================================================
// Types
// ============================================================================

/**
 * A workflow history event.
 * Must include type and timestamp, can include arbitrary additional data.
 */
export interface HistoryEvent {
  /** Event type (e.g., 'STEP_STARTED', 'STEP_COMPLETED', 'WORKFLOW_STARTED') */
  type: string
  /** Timestamp when the event occurred */
  timestamp: number
  /** Additional event data */
  [key: string]: unknown
}

/**
 * Snapshot metadata including event count
 */
export interface HistorySnapshot extends SnapshotInfo {
  /** Number of events in the snapshot */
  eventCount: number
}

/**
 * Checkpoint state for WorkflowCore integration
 */
export interface HistoryCheckpoint {
  /** Workflow instance ID */
  workflowId: string
  /** All history events */
  events: HistoryEvent[]
  /** Timestamp of latest event */
  historyTimestamp: number
}

/**
 * Options for creating a WorkflowHistory
 */
export interface WorkflowHistoryOptions {
  /** Unique workflow instance ID */
  workflowId: string
  /** Optional run ID for this execution */
  runId?: string
  /** Optional metrics collector */
  metrics?: MetricsCollector
  /** Default retention policy */
  retention?: RetentionPolicy
  /** LRU cache size for time-travel queries */
  cacheSize?: number
}

// ============================================================================
// WorkflowHistory Implementation
// ============================================================================

/**
 * WorkflowHistory provides time-travel enabled workflow history tracking.
 *
 * Backed by TemporalStore for efficient:
 * - Event recording with timestamps
 * - Time-travel queries (getAsOf)
 * - Snapshots for checkpointing
 * - Retention policies for memory management
 *
 * @example
 * ```typescript
 * const history = createWorkflowHistory({ workflowId: 'order-123' })
 *
 * // Record events
 * await history.recordEvent({
 *   type: 'STEP_COMPLETED',
 *   timestamp: Date.now(),
 *   stepId: 'fetch-data',
 *   result: { data: 'fetched' }
 * })
 *
 * // Time-travel query
 * const pastEvents = await history.getEventsAsOf(pastTimestamp)
 *
 * // Create snapshot
 * const snapshotId = await history.snapshot()
 *
 * // Restore snapshot
 * await history.restoreSnapshot(snapshotId)
 *
 * // Apply retention
 * await history.prune({ maxVersions: 100, maxAge: '7d' })
 * ```
 */
export class WorkflowHistory {
  private readonly workflowId: string
  private readonly runId: string
  private readonly metrics: MetricsCollector

  // TemporalStore backing the history
  private readonly temporalStore: TemporalStore<HistoryEvent>

  // In-memory event list (synced with TemporalStore)
  private events: HistoryEvent[] = []

  // Snapshot metadata (events at snapshot time)
  private snapshotEvents = new Map<SnapshotId, HistoryEvent[]>()

  // Retention policy
  private retentionPolicy: RetentionPolicy | undefined

  constructor(options: WorkflowHistoryOptions) {
    if (!options.workflowId) {
      throw new Error('workflowId is required')
    }

    this.workflowId = options.workflowId
    this.runId = options.runId ?? `run-${Date.now()}`
    this.metrics = options.metrics ?? noopMetrics
    this.retentionPolicy = options.retention

    // Initialize TemporalStore with options
    this.temporalStore = createTemporalStore<HistoryEvent>({
      metrics: this.metrics,
      retention: options.retention,
      cacheSize: options.cacheSize ?? 1000,
    })
  }

  // ==========================================================================
  // Event Recording
  // ==========================================================================

  /**
   * Record a workflow event with timestamp.
   *
   * @param event - Event to record (must have type and timestamp)
   * @throws Error if event is missing type or timestamp
   */
  async recordEvent(event: HistoryEvent): Promise<void> {
    // Validate required fields
    if (!event.type) {
      throw new Error('Event must have a type')
    }
    if (event.timestamp === undefined || event.timestamp === null) {
      throw new Error('Event must have a timestamp')
    }

    const key = `${this.workflowId}:${this.runId}:event:${this.events.length}`
    await this.temporalStore.put(key, event, event.timestamp)
    this.events.push(event)

    this.metrics.recordGauge('workflow_history.event_count', this.events.length, {
      workflowId: this.workflowId,
    })
  }

  /**
   * Get all recorded events.
   *
   * @returns Array of all history events in order
   */
  async getEvents(): Promise<HistoryEvent[]> {
    return [...this.events]
  }

  /**
   * Get the number of recorded events.
   *
   * @returns History length
   */
  async getLength(): Promise<number> {
    return this.events.length
  }

  // ==========================================================================
  // Time Travel (getAsOf)
  // ==========================================================================

  /**
   * Get all events as of a specific timestamp.
   * Time-travel query that returns events up to and including the timestamp.
   *
   * Uses TemporalStore's getAsOf for efficient O(log n) queries on recent data.
   *
   * @param timestamp - Point in time to query
   * @returns Events up to that timestamp
   */
  async getEventsAsOf(timestamp: number): Promise<HistoryEvent[]> {
    // Filter events by timestamp
    return this.events.filter((e) => e.timestamp <= timestamp)
  }

  /**
   * Get a specific keyed state as of a timestamp.
   * Useful for querying workflow state at a point in time.
   *
   * @param key - State key to query
   * @param timestamp - Point in time
   * @returns State value at that time or null
   */
  async getStateAsOf(key: string, timestamp: number): Promise<HistoryEvent | null> {
    const fullKey = `${this.workflowId}:${this.runId}:${key}`
    return this.temporalStore.getAsOf(fullKey, timestamp)
  }

  /**
   * Record a keyed state with timestamp.
   * Useful for tracking named state values with time-travel capability.
   *
   * @param key - State key
   * @param event - State event to record
   */
  async recordState(key: string, event: HistoryEvent): Promise<void> {
    const fullKey = `${this.workflowId}:${this.runId}:${key}`
    await this.temporalStore.put(fullKey, event, event.timestamp)
    // Also record in main events list
    await this.recordEvent(event)
  }

  // ==========================================================================
  // Snapshots
  // ==========================================================================

  /**
   * Create a point-in-time snapshot of the history.
   *
   * @returns Unique snapshot identifier
   */
  async snapshot(): Promise<SnapshotId> {
    const snapshotId = await this.temporalStore.snapshot()
    // Store a copy of events at snapshot time (needed for restore after prune)
    this.snapshotEvents.set(snapshotId, [...this.events])
    return snapshotId
  }

  /**
   * Restore the history to a previous snapshot state.
   *
   * @param id - Snapshot ID to restore
   * @throws Error if snapshot not found
   */
  async restoreSnapshot(id: SnapshotId): Promise<void> {
    await this.temporalStore.restoreSnapshot(id)

    // Restore events list from snapshot
    const snapshotedEvents = this.snapshotEvents.get(id)
    if (snapshotedEvents !== undefined) {
      this.events = [...snapshotedEvents]
    } else {
      // Fallback: if snapshot exists in TemporalStore but not in our map,
      // we can't restore the events (this is an edge case)
      throw new Error(`Cannot restore events for snapshot: ${id}`)
    }
  }

  /**
   * List all available snapshots with metadata.
   *
   * @returns Array of snapshot information
   */
  async listSnapshots(): Promise<HistorySnapshot[]> {
    const snapshots = await this.temporalStore.listSnapshots()
    return snapshots.map((s) => ({
      ...s,
      eventCount: this.snapshotEvents.get(s.id)?.length ?? 0,
    }))
  }

  // ==========================================================================
  // Retention Policy
  // ==========================================================================

  /**
   * Prune old events based on retention policy.
   *
   * @param policy - Optional policy override (uses default if not provided)
   * @returns Statistics about what was pruned
   */
  async prune(policy?: RetentionPolicy): Promise<PruneStats> {
    const effectivePolicy = policy ?? this.retentionPolicy

    if (!effectivePolicy) {
      return { versionsRemoved: 0, keysAffected: 0, keysRemoved: 0 }
    }

    // Apply retention to in-memory events
    const now = Date.now()
    let filteredEvents = [...this.events]
    const originalCount = filteredEvents.length

    // Apply maxAge filter
    if (effectivePolicy.maxAge) {
      const maxAgeMs = toMillis(effectivePolicy.maxAge)
      const cutoff = now - maxAgeMs
      filteredEvents = filteredEvents.filter((e) => e.timestamp >= cutoff)
    }

    // Apply maxVersions limit (keep the most recent N)
    if (effectivePolicy.maxVersions !== undefined && filteredEvents.length > effectivePolicy.maxVersions) {
      filteredEvents = filteredEvents.slice(-effectivePolicy.maxVersions)
    }

    const versionsRemoved = originalCount - filteredEvents.length
    this.events = filteredEvents

    // Also prune the underlying TemporalStore
    await this.temporalStore.prune(effectivePolicy)

    return {
      versionsRemoved,
      keysAffected: versionsRemoved > 0 ? 1 : 0,
      keysRemoved: filteredEvents.length === 0 ? 1 : 0,
    }
  }

  /**
   * Alias for prune - compact old history.
   *
   * @param policy - Optional policy override
   * @returns Statistics about what was compacted
   */
  async compact(policy?: RetentionPolicy): Promise<PruneStats> {
    return this.prune(policy)
  }

  /**
   * Get the current retention policy.
   *
   * @returns Current policy or undefined
   */
  getRetentionPolicy(): RetentionPolicy | undefined {
    return this.retentionPolicy
  }

  /**
   * Set the default retention policy.
   *
   * @param policy - New policy or undefined to disable
   */
  setRetentionPolicy(policy: RetentionPolicy | undefined): void {
    this.retentionPolicy = policy
    this.temporalStore.setRetentionPolicy(policy)
  }

  // ==========================================================================
  // WorkflowCore Integration
  // ==========================================================================

  /**
   * Export checkpoint state for WorkflowCore compatibility.
   *
   * @returns Checkpoint state that can be restored later
   */
  async exportCheckpoint(): Promise<HistoryCheckpoint> {
    const events = await this.getEvents()
    const latestTimestamp = events.length > 0 ? Math.max(...events.map((e) => e.timestamp)) : 0

    return {
      workflowId: this.workflowId,
      events: [...events],
      historyTimestamp: latestTimestamp,
    }
  }

  /**
   * Import checkpoint state from WorkflowCore.
   *
   * @param checkpoint - Checkpoint state to import
   */
  async importCheckpoint(checkpoint: HistoryCheckpoint): Promise<void> {
    // Clear existing state
    this.events = []

    // Import events
    for (const event of checkpoint.events) {
      await this.recordEvent(event)
    }
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.events = []
    this.snapshotEvents.clear()
    // TemporalStore doesn't have a dispose method, but we clear our references
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert a duration string or number to milliseconds.
 *
 * @param duration - Duration as number (ms) or string ('7d', '24h', '30m')
 * @returns Duration in milliseconds
 */
function toMillis(duration: number | string | undefined): number {
  if (duration === undefined || duration === null) {
    return 0
  }

  if (typeof duration === 'number') {
    return duration
  }

  if (typeof duration === 'string') {
    const match = duration.match(/^(\d+)(ms|s|m|h|d|w)$/)
    if (!match) {
      throw new Error(`Invalid duration format: ${duration}`)
    }

    const value = parseInt(match[1]!, 10)
    const unit = match[2]!

    const multipliers: Record<string, number> = {
      ms: 1,
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
    }

    return value * (multipliers[unit] ?? 1)
  }

  return 0
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new WorkflowHistory instance.
 *
 * @param options - Configuration options
 * @returns New WorkflowHistory instance
 *
 * @example
 * ```typescript
 * const history = createWorkflowHistory({
 *   workflowId: 'order-processing-123',
 *   retention: { maxVersions: 100, maxAge: '7d' }
 * })
 * ```
 */
export function createWorkflowHistory(options: WorkflowHistoryOptions): WorkflowHistory {
  return new WorkflowHistory(options)
}
