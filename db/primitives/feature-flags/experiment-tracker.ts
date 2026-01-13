/**
 * Experiment Tracker - Variant Assignment Logging
 *
 * Tracks user assignments to experiment variants with:
 * - Assignment logging with timestamps and context
 * - Deduplication to prevent duplicate assignments
 * - Batch logging for performance
 * - Assignment history retrieval
 * - Sticky assignment support
 *
 * @module db/primitives/feature-flags/experiment-tracker
 */

import type { AllocationResult, ExperimentStore } from './experiment'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Assignment record for a user in an experiment
 */
export interface Assignment {
  /** Unique assignment ID */
  id: string
  /** Experiment ID */
  experimentId: string
  /** User ID */
  userId: string
  /** Assigned variant key */
  variant: string
  /** Bucket value used for assignment */
  bucket?: number
  /** When the assignment was made */
  assignedAt: Date
  /** Additional context about the assignment */
  context?: AssignmentContext
}

/**
 * Context included with an assignment
 */
export interface AssignmentContext {
  /** IP address */
  ip?: string
  /** User agent string */
  userAgent?: string
  /** Geographic location */
  country?: string
  /** Device type */
  deviceType?: 'desktop' | 'mobile' | 'tablet'
  /** Session ID */
  sessionId?: string
  /** Referrer URL */
  referrer?: string
  /** Page URL where assignment occurred */
  pageUrl?: string
  /** Custom properties */
  properties?: Record<string, unknown>
}

/**
 * Assignment log entry for batch operations
 */
export interface AssignmentLogEntry {
  experimentId: string
  userId: string
  variant: string
  bucket?: number
  timestamp: number
  context?: AssignmentContext
}

/**
 * Options for assignment tracking
 */
export interface AssignmentTrackOptions {
  /** Context for the assignment */
  context?: AssignmentContext
  /** Skip if user already assigned */
  skipIfAssigned?: boolean
  /** Force new assignment (override sticky) */
  force?: boolean
}

/**
 * Filters for querying assignments
 */
export interface AssignmentFilters {
  /** Filter by experiment ID */
  experimentId?: string
  /** Filter by user ID */
  userId?: string
  /** Filter by variant */
  variant?: string
  /** Filter assignments after this date */
  after?: Date
  /** Filter assignments before this date */
  before?: Date
  /** Pagination limit */
  limit?: number
  /** Pagination offset */
  offset?: number
}

/**
 * Assignment summary statistics
 */
export interface AssignmentSummary {
  /** Experiment ID */
  experimentId: string
  /** Total assignments */
  totalAssignments: number
  /** Unique users assigned */
  uniqueUsers: number
  /** Assignments per variant */
  variantCounts: Record<string, number>
  /** First assignment timestamp */
  firstAssignment?: Date
  /** Last assignment timestamp */
  lastAssignment?: Date
}

/**
 * Configuration for the experiment tracker
 */
export interface ExperimentTrackerConfig {
  /** Experiment store to use for allocation */
  store: ExperimentStore
  /** Batch size before auto-flush */
  batchSize?: number
  /** Flush interval in milliseconds */
  flushInterval?: number
  /** Enable deduplication (skip duplicate assignments) */
  deduplication?: boolean
  /** Enable sticky assignments (remember previous assignments) */
  stickyAssignments?: boolean
  /** Callback for logging assignments */
  onAssignment?: (assignment: Assignment) => void | Promise<void>
  /** Callback for batch logging */
  onBatchFlush?: (entries: AssignmentLogEntry[]) => void | Promise<void>
}

/**
 * Experiment tracker interface
 */
export interface ExperimentTracker {
  /** Track a user's assignment to an experiment */
  track(experimentId: string, userId: string, options?: AssignmentTrackOptions): Promise<Assignment | null>
  /** Allocate and track in one operation */
  allocateAndTrack(experimentId: string, userId: string, options?: AssignmentTrackOptions): Promise<AllocationResult & { assignment?: Assignment }>
  /** Get a user's assignment for an experiment */
  getAssignment(experimentId: string, userId: string): Promise<Assignment | null>
  /** Get all assignments for a user */
  getUserAssignments(userId: string): Promise<Assignment[]>
  /** Query assignments with filters */
  queryAssignments(filters: AssignmentFilters): Promise<Assignment[]>
  /** Get assignment summary for an experiment */
  getSummary(experimentId: string): Promise<AssignmentSummary>
  /** Clear a user's assignment (for testing/debugging) */
  clearAssignment(experimentId: string, userId: string): Promise<void>
  /** Clear all assignments for an experiment */
  clearExperimentAssignments(experimentId: string): Promise<void>
  /** Flush pending batch entries */
  flush(): Promise<void>
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Generate a unique assignment ID
 */
function generateAssignmentId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `asn_${timestamp}_${random}`
}

/**
 * Create assignment key for deduplication/sticky lookups
 */
function assignmentKey(experimentId: string, userId: string): string {
  return `${experimentId}:${userId}`
}

/**
 * In-memory experiment tracker implementation
 */
class InMemoryExperimentTracker implements ExperimentTracker {
  private store: ExperimentStore
  private assignments: Map<string, Assignment> = new Map()
  private assignmentIndex: Map<string, Set<string>> = new Map() // experimentId -> Set<assignmentKeys>
  private userIndex: Map<string, Set<string>> = new Map() // userId -> Set<assignmentKeys>
  private batchQueue: AssignmentLogEntry[] = []
  private config: Required<Omit<ExperimentTrackerConfig, 'store' | 'onAssignment' | 'onBatchFlush'>> & {
    store: ExperimentStore
    onAssignment?: (assignment: Assignment) => void | Promise<void>
    onBatchFlush?: (entries: AssignmentLogEntry[]) => void | Promise<void>
  }
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: ExperimentTrackerConfig) {
    this.store = config.store
    this.config = {
      store: config.store,
      batchSize: config.batchSize ?? 100,
      flushInterval: config.flushInterval ?? 5000,
      deduplication: config.deduplication ?? true,
      stickyAssignments: config.stickyAssignments ?? true,
      onAssignment: config.onAssignment,
      onBatchFlush: config.onBatchFlush,
    }

    // Start flush timer if interval is set and callback exists
    if (this.config.flushInterval > 0 && this.config.onBatchFlush) {
      this.flushTimer = setInterval(() => {
        this.flush().catch(() => {
          // Ignore flush errors in timer
        })
      }, this.config.flushInterval)
    }
  }

  async track(
    experimentId: string,
    userId: string,
    options?: AssignmentTrackOptions
  ): Promise<Assignment | null> {
    const key = assignmentKey(experimentId, userId)

    // Check for existing assignment
    const existing = this.assignments.get(key)
    if (existing && !options?.force) {
      if (options?.skipIfAssigned || this.config.deduplication) {
        return existing
      }
    }

    // Allocate the user
    const allocation = await this.store.allocate(experimentId, userId)

    if (!allocation.inExperiment || !allocation.variant) {
      return null
    }

    // Create assignment record
    const now = new Date()
    const assignment: Assignment = {
      id: generateAssignmentId(),
      experimentId,
      userId,
      variant: allocation.variant,
      bucket: allocation.bucket,
      assignedAt: now,
      context: options?.context,
    }

    // Store assignment
    this.assignments.set(key, assignment)

    // Update indices
    if (!this.assignmentIndex.has(experimentId)) {
      this.assignmentIndex.set(experimentId, new Set())
    }
    this.assignmentIndex.get(experimentId)!.add(key)

    if (!this.userIndex.has(userId)) {
      this.userIndex.set(userId, new Set())
    }
    this.userIndex.get(userId)!.add(key)

    // Add to batch queue
    this.batchQueue.push({
      experimentId,
      userId,
      variant: allocation.variant,
      bucket: allocation.bucket,
      timestamp: now.getTime(),
      context: options?.context,
    })

    // Trigger assignment callback
    if (this.config.onAssignment) {
      await Promise.resolve(this.config.onAssignment(assignment))
    }

    // Auto-flush if batch size reached
    if (this.batchQueue.length >= this.config.batchSize) {
      await this.flush()
    }

    return assignment
  }

  async allocateAndTrack(
    experimentId: string,
    userId: string,
    options?: AssignmentTrackOptions
  ): Promise<AllocationResult & { assignment?: Assignment }> {
    // Check for sticky assignment first
    if (this.config.stickyAssignments && !options?.force) {
      const existing = await this.getAssignment(experimentId, userId)
      if (existing) {
        return {
          experimentId,
          inExperiment: true,
          variant: existing.variant,
          bucket: existing.bucket,
          reason: 'allocated',
          assignment: existing,
        }
      }
    }

    // Perform allocation
    const allocation = await this.store.allocate(experimentId, userId)

    // Track the assignment if allocated
    let assignment: Assignment | undefined
    if (allocation.inExperiment && allocation.variant) {
      const tracked = await this.track(experimentId, userId, {
        ...options,
        skipIfAssigned: false, // We've already checked
      })
      if (tracked) {
        assignment = tracked
      }
    }

    return {
      ...allocation,
      assignment,
    }
  }

  async getAssignment(experimentId: string, userId: string): Promise<Assignment | null> {
    const key = assignmentKey(experimentId, userId)
    return this.assignments.get(key) ?? null
  }

  async getUserAssignments(userId: string): Promise<Assignment[]> {
    const keys = this.userIndex.get(userId)
    if (!keys) {
      return []
    }

    const assignments: Assignment[] = []
    for (const key of keys) {
      const assignment = this.assignments.get(key)
      if (assignment) {
        assignments.push({ ...assignment })
      }
    }

    return assignments.sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime())
  }

  async queryAssignments(filters: AssignmentFilters): Promise<Assignment[]> {
    let assignments: Assignment[]

    // Start with the most specific filter
    if (filters.experimentId && filters.userId) {
      const assignment = await this.getAssignment(filters.experimentId, filters.userId)
      assignments = assignment ? [assignment] : []
    } else if (filters.experimentId) {
      const keys = this.assignmentIndex.get(filters.experimentId)
      assignments = keys
        ? Array.from(keys).map(k => this.assignments.get(k)!).filter(Boolean)
        : []
    } else if (filters.userId) {
      assignments = await this.getUserAssignments(filters.userId)
    } else {
      assignments = Array.from(this.assignments.values())
    }

    // Apply additional filters
    if (filters.variant) {
      assignments = assignments.filter(a => a.variant === filters.variant)
    }

    if (filters.after) {
      assignments = assignments.filter(a => a.assignedAt >= filters.after!)
    }

    if (filters.before) {
      assignments = assignments.filter(a => a.assignedAt <= filters.before!)
    }

    // Sort by assignment date (newest first)
    assignments.sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime())

    // Pagination
    const offset = filters.offset ?? 0
    const limit = filters.limit ?? assignments.length
    assignments = assignments.slice(offset, offset + limit)

    return assignments.map(a => ({ ...a }))
  }

  async getSummary(experimentId: string): Promise<AssignmentSummary> {
    const keys = this.assignmentIndex.get(experimentId)

    if (!keys || keys.size === 0) {
      return {
        experimentId,
        totalAssignments: 0,
        uniqueUsers: 0,
        variantCounts: {},
      }
    }

    const variantCounts: Record<string, number> = {}
    const uniqueUsers = new Set<string>()
    let firstAssignment: Date | undefined
    let lastAssignment: Date | undefined

    for (const key of keys) {
      const assignment = this.assignments.get(key)
      if (assignment) {
        uniqueUsers.add(assignment.userId)
        variantCounts[assignment.variant] = (variantCounts[assignment.variant] ?? 0) + 1

        if (!firstAssignment || assignment.assignedAt < firstAssignment) {
          firstAssignment = assignment.assignedAt
        }
        if (!lastAssignment || assignment.assignedAt > lastAssignment) {
          lastAssignment = assignment.assignedAt
        }
      }
    }

    return {
      experimentId,
      totalAssignments: keys.size,
      uniqueUsers: uniqueUsers.size,
      variantCounts,
      firstAssignment,
      lastAssignment,
    }
  }

  async clearAssignment(experimentId: string, userId: string): Promise<void> {
    const key = assignmentKey(experimentId, userId)

    if (this.assignments.has(key)) {
      this.assignments.delete(key)

      // Update indices
      this.assignmentIndex.get(experimentId)?.delete(key)
      this.userIndex.get(userId)?.delete(key)
    }
  }

  async clearExperimentAssignments(experimentId: string): Promise<void> {
    const keys = this.assignmentIndex.get(experimentId)

    if (keys) {
      for (const key of keys) {
        const assignment = this.assignments.get(key)
        if (assignment) {
          this.userIndex.get(assignment.userId)?.delete(key)
          this.assignments.delete(key)
        }
      }
      this.assignmentIndex.delete(experimentId)
    }
  }

  async flush(): Promise<void> {
    if (this.batchQueue.length === 0) {
      return
    }

    const entries = [...this.batchQueue]
    this.batchQueue = []

    if (this.config.onBatchFlush) {
      await Promise.resolve(this.config.onBatchFlush(entries))
    }
  }

  /**
   * Cleanup resources (call when done with tracker)
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new experiment tracker
 */
export function createExperimentTracker(config: ExperimentTrackerConfig): ExperimentTracker & { destroy: () => void } {
  return new InMemoryExperimentTracker(config)
}
