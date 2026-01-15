/**
 * Human-in-the-Loop Module
 *
 * Provides primitives for human oversight and intervention in AI workflows.
 *
 * @module human
 * @see do-v2.10.1 - [RED] Human-in-the-Loop tests
 * @see do-v2.10.2 - [GREEN] Human-in-the-Loop implementation
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Priority levels for requests and notifications
 */
export type Priority = 'critical' | 'high' | 'normal' | 'low'

/**
 * Notification channel types
 */
export type NotificationChannel = 'email' | 'slack' | 'sms' | 'push'

/**
 * Approval request data structure
 */
export interface ApprovalRequest {
  id: string
  type: string
  title: string
  description: string
  amount?: number
  requestedBy: string
  requestedAt: Date
  metadata?: Record<string, unknown>
}

/**
 * Approval response after workflow completion
 */
export interface ApprovalResponse {
  id: string
  status: 'pending' | 'approved' | 'approved_at_level' | 'rejected'
  action: ApprovalRequest
  approvers: string[]
  currentApprover?: string
  currentLevel?: number
  createdAt: Date
  deadline?: Date
  priority?: Priority
  approvedBy?: string
  approvedAt?: Date
  rejectedBy?: string
  rejectedAt?: Date
  rejectionReason?: string
  completedAt?: Date
  comment?: string
  history?: Array<{
    action: string
    by: string
    at: Date
    reason?: string
  }>
  metrics?: {
    totalApprovalTime?: number
    timePerLevel?: number[]
  }
}

/**
 * Escalation chain item with optional handler references
 */
export interface EscalationChainItem {
  duration: number
  target: string
  /** Optional typed handler for escalation events (do-igh: type safety) */
  onEscalateHandler?: (event: EscalationEvent) => void | Promise<void>
  /** Optional typed handler for notifications (do-igh: type safety) */
  onNotifyHandler?: (notification: EscalationNotification) => void | Promise<void>
}

/**
 * Escalation configuration
 */
export interface EscalationConfig {
  duration: number
  target: string
  chain?: Array<EscalationChainItem>
  escalateTo: (target: string) => EscalationConfig
  escalateAfter: (duration: string) => EscalationConfig
  onEscalate: (handler: (event: EscalationEvent) => void | Promise<void>) => EscalationConfig
  onNotify: (handler: (notification: EscalationNotification) => void | Promise<void>) => EscalationConfig
  /** Typed storage for onEscalate handler (do-igh: eliminates any cast) */
  onEscalateHandler?: (event: EscalationEvent) => void | Promise<void>
  /** Typed storage for onNotify handler (do-igh: eliminates any cast) */
  onNotifyHandler?: (notification: EscalationNotification) => void | Promise<void>
}

/**
 * Escalation event data
 */
export interface EscalationEvent {
  requestId: string
  escalatedTo: string
  reason: string
  escalatedAt: Date
}

/**
 * Escalation notification data
 */
export interface EscalationNotification {
  recipient: string
  type: 'escalation' | 'assignment'
  message: string
}

/**
 * SLA check result
 */
export interface SLACheck {
  requestId: string
  breached: boolean
  remaining: number
  overdueBy?: number
  percentageElapsed?: number
}

/**
 * Review item in queue
 */
export interface ReviewItem {
  id: string
  type: string
  title: string
  data: Record<string, unknown>
  createdAt: Date
  priority?: Priority
  status?: 'pending' | 'claimed' | 'completed'
  addedAt?: Date
  claimedBy?: string
  claimedAt?: Date
  completedAt?: Date
  decision?: Record<string, unknown>
  metrics?: {
    timeInQueue?: number
    timeToComplete?: number
  }
  reassignedFrom?: string
  reassignedAt?: Date
  reassignmentHistory?: Array<{
    from: string
    to: string
    at: Date
  }>
}

/**
 * Notification result
 */
export interface NotificationResult {
  id: string
  delivered: boolean
  channel: NotificationChannel
  recipient: string
  sentAt: Date
  deliveredAt?: Date
  error?: string
  attempts?: number
}

// ============================================================================
// Constants
// ============================================================================

/**
 * SLA timeout constants (in milliseconds)
 */
const SLA_CONSTANTS = {
  /** Maximum allowed SLA deadline (1 year) */
  MAX_DEADLINE_MS: 365 * 24 * 60 * 60 * 1000,
  /** One year in milliseconds */
  ONE_YEAR_MS: 365 * 24 * 60 * 60 * 1000,
} as const

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse a duration string into milliseconds
 *
 * @param duration - Duration string (e.g., "1 hour", "30 minutes", "2 days")
 * @returns Duration in milliseconds
 * @throws {Error} If duration format is invalid
 */
function parseDuration(duration: string): number {
  const patterns: Array<{ regex: RegExp; multiplier: number }> = [
    { regex: /^(\d+)\s*(?:minute|minutes|m|min)$/i, multiplier: 60 * 1000 },
    { regex: /^(\d+)\s*(?:hour|hours|h|hr)$/i, multiplier: 60 * 60 * 1000 },
    { regex: /^(\d+)\s*(?:day|days|d)$/i, multiplier: 24 * 60 * 60 * 1000 },
  ]

  for (const { regex, multiplier } of patterns) {
    const match = duration.match(regex)
    if (match) {
      return parseInt(match[1], 10) * multiplier
    }
  }

  throw new Error('Invalid duration format')
}

/**
 * Generate a unique ID
 *
 * @returns Unique identifier combining timestamp and random string
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

// ============================================================================
// Validation Utilities (do-374)
// ============================================================================

/**
 * Validate that a string is non-empty and not just whitespace
 *
 * @param value - Value to check
 * @returns True if value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Validate ApprovalRequest fields
 *
 * @param action - ApprovalRequest to validate
 * @throws {Error} If any required field is invalid
 */
function validateApprovalRequest(action: ApprovalRequest): void {
  if (!isNonEmptyString(action.id)) {
    throw new Error('ApprovalRequest id is required')
  }
  if (!isNonEmptyString(action.type)) {
    throw new Error('ApprovalRequest type is required')
  }
  if (!isNonEmptyString(action.title)) {
    throw new Error('ApprovalRequest title is required')
  }
  if (!isNonEmptyString(action.description)) {
    throw new Error('ApprovalRequest description is required')
  }
  if (!isNonEmptyString(action.requestedBy)) {
    throw new Error('ApprovalRequest requestedBy is required')
  }
  if (!(action.requestedAt instanceof Date) || isNaN(action.requestedAt.getTime())) {
    throw new Error('ApprovalRequest requestedAt must be a valid date')
  }
  if (action.amount !== undefined && (typeof action.amount !== 'number' || action.amount < 0)) {
    throw new Error('ApprovalRequest amount must be a non-negative number')
  }
}

/**
 * Validate SLA deadline
 *
 * @param deadline - Deadline to validate
 * @param now - Current time
 * @throws {Error} If deadline is invalid
 */
function validateSLADeadline(deadline: Date, now: Date): void {
  const deadlineTime = deadline.getTime()
  const nowTime = now.getTime()

  if (deadlineTime <= nowTime) {
    throw new Error('SLA deadline must be in the future')
  }

  if (deadlineTime - nowTime > SLA_CONSTANTS.MAX_DEADLINE_MS) {
    throw new Error('SLA deadline cannot be more than 1 year in the future')
  }
}

/**
 * Validate request ID
 *
 * @param requestId - Request ID to validate
 * @throws {Error} If request ID is invalid
 */
function validateRequestId(requestId: string): void {
  if (!isNonEmptyString(requestId)) {
    throw new Error('Request ID is required')
  }
}

/**
 * Priority order for sorting (lower number = higher priority)
 */
const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

// ============================================================================
// ApprovalWorkflow Implementation
// ============================================================================

/**
 * ApprovalWorkflow - Manages multi-level approval chains
 *
 * Provides a complete workflow system for handling approval requests through
 * multiple approval levels. Supports sequential approval chains where each
 * approver must approve before proceeding to the next level, or the request
 * can be rejected at any level.
 *
 * Features:
 * - Multi-level approval chains with sequential progression
 * - Optional deadlines and priority levels
 * - Approval/rejection with optional comments and reasons
 * - Complete audit history of all actions
 * - Performance metrics (time per level, total approval time)
 *
 * @example
 * ```typescript
 * const workflow = new ApprovalWorkflow()
 * const request = await workflow.request(
 *   { id: 'exp-1', type: 'expense', title: '...', ... },
 *   ['manager@example.com', 'director@example.com'],
 *   { deadline: '24 hours', priority: 'high' }
 * )
 * await workflow.approve(request.id, 'manager@example.com')
 * await workflow.approve(request.id, 'director@example.com')
 * ```
 */
export class ApprovalWorkflow {
  private requests: Map<string, ApprovalResponse> = new Map()
  private levelStartTimes: Map<string, number[]> = new Map()

  /**
   * Create a new approval request
   *
   * @param action - The action/request to be approved
   * @param approvers - Array of approver IDs in order (sequential chain)
   * @param options - Optional configuration
   * @param options.deadline - Deadline for completion (Date or duration string)
   * @param options.priority - Priority level for the request
   * @returns The created approval response with initial state
   * @throws {Error} If action or approvers list is invalid
   */
  async request(
    action: ApprovalRequest,
    approvers: string[],
    options?: { deadline?: Date | string; priority?: Priority }
  ): Promise<ApprovalResponse> {
    // Validate inputs (do-374)
    validateApprovalRequest(action)
    if (!approvers || approvers.length === 0) {
      throw new Error('At least one approver is required')
    }

    const id = generateId()
    const now = new Date()

    let deadline: Date | undefined
    if (options?.deadline) {
      if (options.deadline instanceof Date) {
        deadline = options.deadline
      } else {
        deadline = new Date(now.getTime() + parseDuration(options.deadline))
      }
    }

    const response: ApprovalResponse = {
      id,
      status: 'pending',
      action,
      approvers,
      currentApprover: approvers[0],
      currentLevel: 0,
      createdAt: now,
      deadline,
      priority: options?.priority,
      history: [],
    }

    this.requests.set(id, response)
    this.levelStartTimes.set(id, [now.getTime()])

    return response
  }

  /**
   * Get an approval request by ID
   *
   * @param requestId - ID of the request to retrieve
   * @returns The approval response with current state
   * @throws {Error} If request is not found
   */
  async get(requestId: string): Promise<ApprovalResponse> {
    const request = this.requests.get(requestId)
    if (!request) {
      throw new Error('Request not found')
    }
    return request
  }

  /**
   * Approve a request at the current level
   *
   * Advances to the next approval level or completes the workflow if this is
   * the final approver. Automatically calculates metrics for the approval level.
   *
   * @param requestId - ID of the request to approve
   * @param approverId - ID of the approver (must be current approver)
   * @param options - Optional configuration
   * @param options.comment - Optional comment on the approval
   * @returns Updated approval response with new state
   * @throws {Error} If request not found or approver is not authorized at current level
   */
  async approve(
    requestId: string,
    approverId: string,
    options?: { comment?: string }
  ): Promise<ApprovalResponse> {
    const request = await this.get(requestId)

    if (request.currentApprover !== approverId) {
      throw new Error('Not authorized to approve at this level')
    }

    const now = new Date()

    // Record in history
    request.history = request.history || []
    request.history.push({
      action: 'approved',
      by: approverId,
      at: now,
    })

    // Track time at this level
    const levelTimes = this.levelStartTimes.get(requestId) || []
    const currentLevelStart = levelTimes[request.currentLevel || 0] || request.createdAt.getTime()
    const timeAtLevel = now.getTime() - currentLevelStart

    // Check if this is the final approver
    const isLastLevel = (request.currentLevel || 0) >= request.approvers.length - 1

    if (isLastLevel) {
      // Complete the workflow
      request.status = 'approved'
      request.approvedBy = approverId
      request.approvedAt = now
      request.completedAt = now

      // Calculate metrics
      const timePerLevel = levelTimes.map((startTime, idx) => {
        const endTime = idx < levelTimes.length - 1 ? levelTimes[idx + 1] : now.getTime()
        return endTime - startTime
      })

      request.metrics = {
        totalApprovalTime: now.getTime() - request.createdAt.getTime(),
        timePerLevel,
      }
    } else {
      // Advance to next level
      request.currentLevel = (request.currentLevel || 0) + 1
      request.currentApprover = request.approvers[request.currentLevel]
      request.approvedBy = approverId
      request.approvedAt = now

      // Record start time for new level
      levelTimes.push(now.getTime())
      this.levelStartTimes.set(requestId, levelTimes)
    }

    if (options?.comment) {
      request.comment = options.comment
    }

    // Store with pending status for later retrieval
    const storedRequest = { ...request }
    if (!isLastLevel) {
      storedRequest.status = 'pending'
    }
    this.requests.set(requestId, storedRequest)

    // Return with approved_at_level status to show what just happened
    const returnRequest = { ...request }
    if (!isLastLevel) {
      returnRequest.status = 'approved_at_level'
    }
    return returnRequest
  }

  /**
   * Reject a request
   *
   * Immediately terminates the workflow. Any current or previous approver
   * can reject the request, allowing for pull-back of approvals.
   *
   * @param requestId - ID of the request to reject
   * @param approverId - ID of the rejecting approver (must be current or previous level)
   * @param reason - Required reason for rejection
   * @returns Updated approval response with rejected status
   * @throws {Error} If request not found, approver not authorized, or reason is empty
   */
  async reject(
    requestId: string,
    approverId: string,
    reason: string
  ): Promise<ApprovalResponse> {
    if (!reason || reason.trim() === '') {
      throw new Error('Rejection reason is required')
    }

    const request = await this.get(requestId)

    // Check if approver is current or previous level approver
    const approverIndex = request.approvers.indexOf(approverId)
    if (approverIndex === -1 || approverIndex > (request.currentLevel || 0)) {
      throw new Error('Not authorized to reject')
    }

    const now = new Date()

    // Record in history
    request.history = request.history || []
    request.history.push({
      action: 'rejected',
      by: approverId,
      at: now,
      reason,
    })

    request.status = 'rejected'
    request.rejectedBy = approverId
    request.rejectedAt = now
    request.rejectionReason = reason
    request.completedAt = now

    this.requests.set(requestId, request)
    return request
  }
}

// ============================================================================
// EscalationPolicy Implementation
// ============================================================================

interface EscalationTracking {
  requestId: string
  config: EscalationConfig
  options?: { assignee?: string }
  resolved: boolean
  timers: ReturnType<typeof setTimeout>[]
}

/**
 * EscalationPolicy - Configures automatic escalation rules
 *
 * Implements SLA breach escalation with support for configurable escalation chains.
 * Automatically triggers escalations at specified time intervals, with optional
 * notifications to both the original assignee and the escalated target.
 *
 * Features:
 * - Fluent API for configurable escalation chains
 * - Support for multiple escalation levels with different durations
 * - Automatic escalation and notification on breach
 * - Resolution tracking to prevent escalations after resolution
 * - Complete resource cleanup with dispose() method
 *
 * @example
 * ```typescript
 * const policy = new EscalationPolicy()
 * const config = policy
 *   .escalateAfter('1 hour')
 *   .escalateTo('manager@example.com')
 *   .escalateAfter('2 hours')
 *   .escalateTo('director@example.com')
 *   .onEscalate(async (event) => console.log('Escalated:', event.escalatedTo))
 *   .onNotify(async (notif) => console.log('Notifying:', notif.recipient))
 *
 * const tracking = await policy.track('request-123', config, { assignee: 'agent@example.com' })
 * // Later: await tracking.resolve()
 * policy.dispose() // Clean up resources
 * ```
 */
export class EscalationPolicy {
  private trackings: Map<string, EscalationTracking> = new Map()

  /**
   * Configure escalation timeout
   *
   * @param duration - Duration string (e.g., "1 hour", "30 minutes", "2 days")
   * @returns Chainable configuration object
   * @throws {Error} If duration format is invalid
   */
  escalateAfter(duration: string): EscalationConfig {
    const durationMs = parseDuration(duration)

    const config: EscalationConfig = {
      duration: durationMs,
      target: '',
      chain: [],
      escalateTo: (target: string): EscalationConfig => {
        config.target = target
        config.chain = config.chain || []
        config.chain.push({ duration: durationMs, target })
        return config
      },
      escalateAfter: (nextDuration: string): EscalationConfig => {
        const nextDurationMs = parseDuration(nextDuration)
        const newConfig: EscalationConfig = {
          ...config,
          duration: nextDurationMs,
          escalateTo: (target: string): EscalationConfig => {
            config.chain = config.chain || []
            config.chain.push({ duration: nextDurationMs, target })
            config.target = target
            return config
          },
          escalateAfter: config.escalateAfter,
          onEscalate: config.onEscalate,
          onNotify: config.onNotify,
        }
        return newConfig
      },
      onEscalate: (handler: (event: EscalationEvent) => void | Promise<void>): EscalationConfig => {
        config.onEscalateHandler = handler
        // Also attach handler to all chain items for type safety (do-igh)
        if (config.chain) {
          for (const item of config.chain) {
            item.onEscalateHandler = handler
          }
        }
        return config
      },
      onNotify: (handler: (notification: EscalationNotification) => void | Promise<void>): EscalationConfig => {
        config.onNotifyHandler = handler
        // Also attach handler to all chain items for type safety (do-igh)
        if (config.chain) {
          for (const item of config.chain) {
            item.onNotifyHandler = handler
          }
        }
        return config
      },
    }

    return config
  }

  /**
   * Track a request for escalation
   *
   * Starts escalation timers for the configured escalation chain. Automatically
   * triggers escalation and notification handlers when durations elapse.
   *
   * @param requestId - ID of the request to track
   * @param config - Escalation configuration (from escalateAfter())
   * @param options - Optional configuration
   * @param options.assignee - Original assignee to notify on escalation
   * @returns Tracking handle with resolve() method to stop escalation
   * @throws {Error} If request ID is invalid
   */
  async track(
    requestId: string,
    config: EscalationConfig,
    options?: { assignee?: string }
  ): Promise<{ resolve: () => Promise<void> }> {
    // Validate inputs (do-374)
    validateRequestId(requestId)

    const tracking: EscalationTracking = {
      requestId,
      config,
      options,
      resolved: false,
      timers: [],
    }

    // Set up timers for each escalation in the chain
    const chain = config.chain || []
    let cumulativeTime = 0

    for (const escalation of chain) {
      cumulativeTime += escalation.duration
      const targetTime = cumulativeTime

      const timer = setTimeout(async () => {
        if (tracking.resolved) return

        const onEscalate = config.onEscalateHandler
        const onNotify = config.onNotifyHandler

        // Trigger escalation handler
        if (onEscalate) {
          await onEscalate({
            requestId,
            escalatedTo: escalation.target,
            reason: 'SLA breach',
            escalatedAt: new Date(),
          })
        }

        // Trigger notification handlers
        if (onNotify) {
          // Notify original assignee
          if (options?.assignee) {
            await onNotify({
              recipient: options.assignee,
              type: 'escalation',
              message: `Request has been escalated to ${escalation.target}`,
            })
          }

          // Notify new assignee
          await onNotify({
            recipient: escalation.target,
            type: 'assignment',
            message: `Request has been assigned to you`,
          })
        }
      }, targetTime)

      tracking.timers.push(timer)
    }

    this.trackings.set(requestId, tracking)

    return {
      resolve: async () => {
        tracking.resolved = true
        // Clear all timers
        for (const timer of tracking.timers) {
          clearTimeout(timer)
        }
        tracking.timers = []
      },
    }
  }

  /**
   * Dispose of all resources and clear all timers
   *
   * Stops all active escalation timers and clears tracking data.
   * Should be called when the policy instance is no longer needed.
   * This is critical to prevent memory leaks and timer callbacks
   * from executing after disposal.
   */
  dispose(): void {
    this.clearAllTimers()
    this.trackings.clear()
  }

  /**
   * Helper method to clear timers for a tracking instance
   *
   * @param tracking - Tracking instance to clear timers for
   */
  private clearTimersForTracking(tracking: EscalationTracking): void {
    tracking.resolved = true
    for (const timer of tracking.timers) {
      clearTimeout(timer)
    }
    tracking.timers = []
  }

  /**
   * Helper method to clear all timers across all trackings
   */
  private clearAllTimers(): void {
    for (const tracking of this.trackings.values()) {
      this.clearTimersForTracking(tracking)
    }
  }
}

// ============================================================================
// SLATracker Implementation
// ============================================================================

interface SLATracking {
  requestId: string
  deadline: Date
  startedAt: Date
  timers: ReturnType<typeof setTimeout>[]
}

interface SLACompletion {
  requestId: string
  responseTime: number
  breached: boolean
  priority?: Priority
}

interface SLAConfig {
  warningThreshold?: number
  criticalThreshold?: number
  onWarning?: (event: { requestId: string; remaining: number; threshold: number }) => void
  onCritical?: (event: { requestId: string; remaining: number; threshold: number }) => void
  onBreach?: (event: { requestId: string; overdueBy: number }) => void
}

/**
 * SLATracker - Tracks SLA compliance and metrics
 *
 * Monitors Service Level Agreement deadlines and triggers callbacks at
 * configurable warning and critical thresholds. Automatically tracks
 * request completion times and calculates performance metrics
 * (p50, p95, p99 response times, breach rate).
 *
 * Features:
 * - Deadline tracking with configurable warning/critical/breach thresholds
 * - Automatic callback triggering at threshold crossings
 * - SLA breach detection and metrics
 * - Performance statistics (percentiles, average, breach rate)
 * - Per-priority metrics for fine-grained analysis
 * - Per-request resource cleanup with stop()
 * - Complete resource cleanup with dispose()
 *
 * @example
 * ```typescript
 * const sla = new SLATracker()
 * sla.configure({
 *   warningThreshold: 0.75,   // 75% of deadline
 *   criticalThreshold: 0.90,  // 90% of deadline
 *   onWarning: (event) => console.log('Warning:', event),
 *   onCritical: (event) => console.log('Critical:', event),
 *   onBreach: (event) => console.log('Breached:', event),
 * })
 *
 * const tracking = sla.track('request-123', '4 hours')
 * // ... later ...
 * sla.recordCompletion('request-123', 3600000, { breached: false })
 * const metrics = sla.getMetrics({ groupBy: 'priority' })
 * sla.dispose() // Clean up all resources
 * ```
 */
export class SLATracker {
  private trackings: Map<string, SLATracking> = new Map()
  private completions: SLACompletion[] = []
  private config: SLAConfig = {}

  /**
   * Configure SLA thresholds and callbacks
   *
   * @param options - Configuration options including thresholds and handlers
   */
  configure(options: SLAConfig): void {
    this.config = { ...this.config, ...options }
  }

  /**
   * Start tracking a request with an SLA deadline
   *
   * Automatically sets up timers for warning, critical, and breach thresholds.
   * The thresholds are based on the total duration as percentages.
   *
   * @param requestId - ID of the request to track
   * @param deadline - Deadline as Date or duration string (e.g., "4 hours")
   * @returns Tracking info with request ID, deadline, and start time
   * @throws {Error} If request ID is invalid or deadline is invalid
   */
  track(
    requestId: string,
    deadline: Date | string
  ): { requestId: string; deadline: Date; startedAt: Date } {
    // Validate inputs (do-374)
    validateRequestId(requestId)

    const now = new Date()
    const startedAt = now

    let deadlineDate: Date
    if (deadline instanceof Date) {
      deadlineDate = deadline
    } else {
      deadlineDate = new Date(now.getTime() + parseDuration(deadline))
    }

    // Validate deadline (do-374)
    validateSLADeadline(deadlineDate, now)

    const totalDuration = deadlineDate.getTime() - startedAt.getTime()
    const timers: ReturnType<typeof setTimeout>[] = []

    // Set up warning threshold timer
    if (this.config.warningThreshold && this.config.onWarning) {
      const warningTime = totalDuration * this.config.warningThreshold
      const timer = setTimeout(() => {
        const tracking = this.trackings.get(requestId)
        if (tracking) {
          const remaining = tracking.deadline.getTime() - Date.now()
          this.config.onWarning!({
            requestId,
            remaining,
            threshold: this.config.warningThreshold!,
          })
        }
      }, warningTime)
      timers.push(timer)
    }

    // Set up critical threshold timer
    if (this.config.criticalThreshold && this.config.onCritical) {
      const criticalTime = totalDuration * this.config.criticalThreshold
      const timer = setTimeout(() => {
        const tracking = this.trackings.get(requestId)
        if (tracking) {
          const remaining = tracking.deadline.getTime() - Date.now()
          this.config.onCritical!({
            requestId,
            remaining,
            threshold: this.config.criticalThreshold!,
          })
        }
      }, criticalTime)
      timers.push(timer)
    }

    // Set up breach timer
    if (this.config.onBreach) {
      const timer = setTimeout(() => {
        const tracking = this.trackings.get(requestId)
        if (tracking) {
          const overdueBy = Date.now() - tracking.deadline.getTime()
          this.config.onBreach!({
            requestId,
            overdueBy,
          })
        }
      }, totalDuration)
      timers.push(timer)
    }

    const tracking: SLATracking = {
      requestId,
      deadline: deadlineDate,
      startedAt,
      timers,
    }

    this.trackings.set(requestId, tracking)

    return {
      requestId,
      deadline: deadlineDate,
      startedAt,
    }
  }

  /**
   * Get tracking info for a request
   */
  get(requestId: string): { requestId: string; deadline: Date; startedAt: Date } | undefined {
    const tracking = this.trackings.get(requestId)
    if (!tracking) return undefined
    return {
      requestId: tracking.requestId,
      deadline: tracking.deadline,
      startedAt: tracking.startedAt,
    }
  }

  /**
   * Check SLA status for a request
   */
  check(requestId: string): SLACheck {
    const tracking = this.trackings.get(requestId)
    if (!tracking) {
      throw new Error('Request not found')
    }

    const now = Date.now()
    const remaining = tracking.deadline.getTime() - now
    const elapsed = now - tracking.startedAt.getTime()
    const totalDuration = tracking.deadline.getTime() - tracking.startedAt.getTime()
    const percentageElapsed = Math.round((elapsed / totalDuration) * 100)

    const breached = remaining < 0

    const result: SLACheck = {
      requestId,
      breached,
      remaining,
      percentageElapsed,
    }

    if (breached) {
      result.overdueBy = Math.abs(remaining)
    }

    return result
  }

  /**
   * Record a completion for metrics
   */
  recordCompletion(
    requestId: string,
    responseTime: number,
    options?: { breached?: boolean; priority?: Priority }
  ): void {
    this.completions.push({
      requestId,
      responseTime,
      breached: options?.breached || false,
      priority: options?.priority,
    })
  }

  /**
   * Get aggregated metrics
   */
  getMetrics(options?: { groupBy?: 'priority' }): {
    p50: number
    p95: number
    p99: number
    average: number
    breachRate: number
    byPriority?: Record<Priority, { average: number }>
  } {
    if (this.completions.length === 0) {
      return { p50: 0, p95: 0, p99: 0, average: 0, breachRate: 0 }
    }

    const responseTimes = this.completions.map((c) => c.responseTime).sort((a, b) => a - b)
    const n = responseTimes.length

    const percentile = (p: number): number => {
      // Different behavior based on percentile:
      // - p50 (median): for even n, average the two middle values
      // - p95, p99: return the value at the appropriate index
      //
      // For n=10, p50: average of [4] and [5] = (500 + 600) / 2 = 550
      // For n=100, p95: value at index 94 = 950
      // For n=100, p99: value at index 98 = 990

      if (p === 50) {
        // Median calculation
        if (n % 2 === 0) {
          // Even count: average of two middle values
          const mid = n / 2
          return (responseTimes[mid - 1] + responseTimes[mid]) / 2
        } else {
          // Odd count: middle value
          return responseTimes[Math.floor(n / 2)]
        }
      }

      // For other percentiles (p95, p99), use nearest rank method
      // p95 of 100 items: 95th item (0-indexed: 94)
      // p99 of 100 items: 99th item (0-indexed: 98)
      const index = Math.ceil((p / 100) * n) - 1
      return responseTimes[Math.max(0, Math.min(index, n - 1))]
    }

    const average = responseTimes.reduce((sum, t) => sum + t, 0) / n
    const breachCount = this.completions.filter((c) => c.breached).length
    const breachRate = breachCount / n

    const result: {
      p50: number
      p95: number
      p99: number
      average: number
      breachRate: number
      byPriority?: Record<Priority, { average: number }>
    } = {
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
      average,
      breachRate,
    }

    if (options?.groupBy === 'priority') {
      const byPriority: Record<Priority, { average: number }> = {
        critical: { average: 0 },
        high: { average: 0 },
        normal: { average: 0 },
        low: { average: 0 },
      }

      for (const priority of ['critical', 'high', 'normal', 'low'] as Priority[]) {
        const priorityCompletions = this.completions.filter((c) => c.priority === priority)
        if (priorityCompletions.length > 0) {
          const sum = priorityCompletions.reduce((s, c) => s + c.responseTime, 0)
          byPriority[priority] = { average: sum / priorityCompletions.length }
        }
      }

      result.byPriority = byPriority
    }

    return result
  }

  /**
   * Stop tracking a specific request and clear its timers
   *
   * Cancels all pending timers for the given request and removes it from tracking.
   * Should be called when a request is resolved or discarded.
   *
   * @param requestId - ID of the request to stop tracking
   */
  stop(requestId: string): void {
    const tracking = this.trackings.get(requestId)
    if (tracking) {
      this.clearTimersForTracking(tracking)
      this.trackings.delete(requestId)
    }
  }

  /**
   * Dispose of all resources and clear all timers
   *
   * Stops all active request timers and clears all tracking data.
   * Should be called when the tracker instance is no longer needed.
   * This is critical to prevent memory leaks and timer callbacks
   * from executing after disposal.
   */
  dispose(): void {
    this.clearAllTimers()
    this.trackings.clear()
  }

  /**
   * Helper method to clear timers for a tracking instance
   *
   * @param tracking - Tracking instance to clear timers for
   */
  private clearTimersForTracking(tracking: SLATracking): void {
    for (const timer of tracking.timers) {
      clearTimeout(timer)
    }
    tracking.timers = []
  }

  /**
   * Helper method to clear all timers across all trackings
   */
  private clearAllTimers(): void {
    for (const tracking of this.trackings.values()) {
      this.clearTimersForTracking(tracking)
    }
  }
}

// ============================================================================
// ReviewQueue Implementation
// ============================================================================

interface QueuedItem extends ReviewItem {
  _addedAt: Date
}

/**
 * ReviewQueue - Priority-based queue for human reviews
 */
export class ReviewQueue {
  private items: Map<string, QueuedItem> = new Map()

  /**
   * Add an item to the queue
   */
  async add(item: ReviewItem, options?: { priority?: Priority }): Promise<ReviewItem> {
    if (this.items.has(item.id)) {
      throw new Error('Item already exists in queue')
    }

    const now = new Date()
    const queuedItem: QueuedItem = {
      ...item,
      status: 'pending',
      priority: options?.priority || 'normal',
      addedAt: now,
      _addedAt: now,
    }

    this.items.set(item.id, queuedItem)

    return queuedItem
  }

  /**
   * Get an item by ID
   */
  async get(itemId: string): Promise<ReviewItem | undefined> {
    return this.items.get(itemId)
  }

  /**
   * Claim the next item for a reviewer
   */
  async claim(reviewerId: string): Promise<ReviewItem | null> {
    // Find pending items sorted by priority, then by addedAt (FIFO)
    const pendingItems = Array.from(this.items.values())
      .filter((item) => item.status === 'pending')
      .sort((a, b) => {
        const priorityDiff =
          PRIORITY_ORDER[a.priority || 'normal'] - PRIORITY_ORDER[b.priority || 'normal']
        if (priorityDiff !== 0) return priorityDiff
        return a._addedAt.getTime() - b._addedAt.getTime()
      })

    if (pendingItems.length === 0) {
      return null
    }

    const item = pendingItems[0]
    const now = new Date()

    item.status = 'claimed'
    item.claimedBy = reviewerId
    item.claimedAt = now

    this.items.set(item.id, item)

    return item
  }

  /**
   * Complete a claimed item
   */
  async complete(itemId: string, decision: Record<string, unknown>): Promise<ReviewItem> {
    const item = this.items.get(itemId)
    if (!item) {
      throw new Error('Item not found')
    }

    if (item.status !== 'claimed') {
      throw new Error('Item must be claimed before completion')
    }

    const now = new Date()

    item.status = 'completed'
    item.decision = decision
    item.completedAt = now

    // Calculate metrics
    const timeInQueue = item.claimedAt!.getTime() - item._addedAt.getTime()
    const timeToComplete = now.getTime() - item.claimedAt!.getTime()

    item.metrics = {
      timeInQueue,
      timeToComplete,
    }

    this.items.set(itemId, item)

    return item
  }

  /**
   * Reassign an item to a different reviewer
   */
  async reassign(itemId: string, newReviewerId: string): Promise<ReviewItem> {
    const item = this.items.get(itemId)
    if (!item) {
      throw new Error('Item not found')
    }

    if (item.status === 'completed') {
      throw new Error('Cannot reassign completed item')
    }

    const now = new Date()
    const previousReviewer = item.claimedBy

    // Record reassignment history
    if (previousReviewer) {
      item.reassignmentHistory = item.reassignmentHistory || []
      item.reassignmentHistory.push({
        from: previousReviewer,
        to: newReviewerId,
        at: now,
      })
      item.reassignedFrom = previousReviewer
    }

    item.status = 'claimed'
    item.claimedBy = newReviewerId
    item.claimedAt = now
    item.reassignedAt = now

    this.items.set(itemId, item)

    return item
  }

  /**
   * List all items with optional sorting
   */
  async list(options?: { sortBy?: 'priority' | 'createdAt' }): Promise<ReviewItem[]> {
    const items = Array.from(this.items.values())

    if (options?.sortBy === 'priority') {
      items.sort((a, b) => {
        return PRIORITY_ORDER[a.priority || 'normal'] - PRIORITY_ORDER[b.priority || 'normal']
      })
    } else if (options?.sortBy === 'createdAt') {
      items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    }

    return items
  }

  /**
   * Get total queue length
   */
  async length(): Promise<number> {
    return this.items.size
  }

  /**
   * Get count of pending items
   */
  async pendingCount(): Promise<number> {
    return Array.from(this.items.values()).filter((item) => item.status === 'pending').length
  }
}

// ============================================================================
// NotificationDispatcher Implementation
// ============================================================================

interface ChannelConfig {
  simulateFailure?: boolean
  beforeSend?: () => void
  retryPolicy?: {
    maxRetries?: number
    backoff?: 'exponential' | 'linear'
    initialDelay?: number
  }
}

interface DispatcherConfig {
  email?: ChannelConfig
  slack?: ChannelConfig
  sms?: ChannelConfig
  push?: ChannelConfig
  retryPolicy?: {
    maxRetries?: number
    backoff?: 'exponential' | 'linear'
    initialDelay?: number
  }
}

interface StoredNotification extends NotificationResult {
  message: Record<string, unknown>
}

const SUPPORTED_CHANNELS: NotificationChannel[] = ['email', 'slack', 'sms', 'push']

/**
 * NotificationDispatcher - Multi-channel notification delivery
 *
 * Manages reliable delivery of notifications across multiple channels
 * (email, Slack, SMS, push) with configurable retry policies.
 *
 * Features:
 * - Multi-channel delivery with channel-specific configurations
 * - Configurable retry policies (exponential or linear backoff)
 * - Per-channel and global retry configurations
 * - Delivery status tracking and history
 * - Optional before-send hooks for testing
 * - Simulated failure support for testing
 *
 * @example
 * ```typescript
 * const dispatcher = new NotificationDispatcher()
 * dispatcher.configure({
 *   email: {
 *     retryPolicy: { maxRetries: 3, backoff: 'exponential', initialDelay: 100 },
 *   },
 * })
 *
 * const result = await dispatcher.notify('user@example.com', 'email', {
 *   subject: 'Approval Required',
 *   body: 'Please review the request',
 * })
 * ```
 */
export class NotificationDispatcher {
  private config: DispatcherConfig = {}
  private notifications: Map<string, StoredNotification> = new Map()
  private recipientHistory: Map<string, string[]> = new Map() // recipient -> notificationIds

  /**
   * Configure channel settings and retry policy
   *
   * @param options - Configuration options for channels and global retry policy
   */
  configure(options: DispatcherConfig): void {
    this.config = { ...this.config, ...options }
  }

  /**
   * Send a notification
   *
   * Routes the notification to the appropriate channel with configured retry policy.
   * Supports hooks for testing and simulated failures.
   *
   * @param recipient - Recipient identifier (email, user ID, phone, etc.)
   * @param channel - Target channel (email, slack, sms, push)
   * @param message - Message content for the channel
   * @returns Notification result with delivery status and attempt count
   * @throws {Error} If channel is not supported
   */
  async notify(
    recipient: string,
    channel: NotificationChannel,
    message: Record<string, unknown>
  ): Promise<NotificationResult> {
    if (!SUPPORTED_CHANNELS.includes(channel)) {
      throw new Error('Unsupported notification channel')
    }

    const id = generateId()
    const sendConfig = this.buildSendConfig(channel)

    const { delivered, attempts, error, deliveredAt } = await this.attemptNotification(
      sendConfig
    )

    return this.storeAndReturnResult(
      id,
      recipient,
      channel,
      message,
      delivered,
      attempts,
      error,
      deliveredAt
    )
  }

  /**
   * Helper method to build send configuration from global and channel settings
   *
   * @param channel - Channel name
   * @returns Merged send configuration
   */
  private buildSendConfig(
    channel: NotificationChannel
  ): {
    channelConfig: ChannelConfig
    maxRetries: number
    backoff: 'exponential' | 'linear'
    initialDelay: number
    skipDelays: boolean
  } {
    const channelConfig = this.config[channel] || {}
    const globalRetryPolicy = this.config.retryPolicy || {}
    const retryPolicy = {
      ...globalRetryPolicy,
      ...channelConfig.retryPolicy,
    }

    return {
      channelConfig,
      maxRetries: retryPolicy.maxRetries ?? 0,
      backoff: retryPolicy.backoff || 'exponential',
      initialDelay: retryPolicy.initialDelay || 100,
      skipDelays: !!channelConfig.simulateFailure && !channelConfig.beforeSend,
    }
  }

  /**
   * Helper method to attempt sending a notification with retries
   *
   * @param config - Send configuration
   * @returns Delivery result with status, attempts, error, and timestamp
   */
  private async attemptNotification(config: {
    channelConfig: ChannelConfig
    maxRetries: number
    backoff: 'exponential' | 'linear'
    initialDelay: number
    skipDelays: boolean
  }): Promise<{
    delivered: boolean
    attempts: number
    error?: string
    deliveredAt?: Date
  }> {
    let attempts = 0
    let delivered = false
    let deliveredAt: Date | undefined

    const send = async (): Promise<boolean> => {
      attempts++

      if (config.channelConfig.beforeSend) {
        try {
          config.channelConfig.beforeSend()
        } catch {
          return false
        }
      }

      return !config.channelConfig.simulateFailure
    }

    // Initial attempt
    delivered = await send()

    // Retry loop
    if (!delivered && config.maxRetries > 0) {
      for (let i = 0; i < config.maxRetries; i++) {
        const delay =
          config.backoff === 'exponential'
            ? config.initialDelay * Math.pow(2, i)
            : config.initialDelay * (i + 1)

        if (!config.skipDelays) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }

        delivered = await send()
        if (delivered) break
      }
    }

    if (delivered) {
      deliveredAt = new Date()
    }

    const error = delivered ? undefined : attempts > 1 ? 'Max retries exceeded' : 'Delivery failed'

    return { delivered, attempts, error, deliveredAt }
  }

  /**
   * Helper method to store notification result and update recipient history
   *
   * @param id - Notification ID
   * @param recipient - Recipient identifier
   * @param channel - Channel name
   * @param message - Message content
   * @param delivered - Delivery status
   * @param attempts - Number of attempts
   * @param error - Error message if failed
   * @param deliveredAt - Delivery timestamp
   * @returns Notification result
   */
  private storeAndReturnResult(
    id: string,
    recipient: string,
    channel: NotificationChannel,
    message: Record<string, unknown>,
    delivered: boolean,
    attempts: number,
    error: string | undefined,
    deliveredAt: Date | undefined
  ): NotificationResult {
    const result: NotificationResult = {
      id,
      delivered,
      channel,
      recipient,
      sentAt: new Date(),
      deliveredAt,
      error,
      attempts,
    }

    const stored: StoredNotification = {
      ...result,
      message,
    }
    this.notifications.set(id, stored)

    const history = this.recipientHistory.get(recipient) || []
    history.push(id)
    this.recipientHistory.set(recipient, history)

    return result
  }

  /**
   * Send to multiple channels
   */
  async notifyMultiple(
    recipient: string,
    channels: NotificationChannel[],
    messages: Partial<Record<NotificationChannel, Record<string, unknown>>>
  ): Promise<NotificationResult[]> {
    const results = await Promise.all(
      channels.map((channel) => {
        const message = messages[channel] || {}
        return this.notify(recipient, channel, message)
      })
    )

    return results
  }

  /**
   * Get delivery status for a notification
   */
  async getDeliveryStatus(notificationId: string): Promise<{
    delivered: boolean
    deliveredAt?: Date
    error?: string
  }> {
    const notification = this.notifications.get(notificationId)
    if (!notification) {
      throw new Error('Notification not found')
    }

    return {
      delivered: notification.delivered,
      deliveredAt: notification.deliveredAt,
      error: notification.error,
    }
  }

  /**
   * Get delivery history for a recipient
   */
  async getDeliveryHistory(
    recipient: string,
    options?: { channel?: NotificationChannel }
  ): Promise<NotificationResult[]> {
    const notificationIds = this.recipientHistory.get(recipient) || []
    let results = notificationIds
      .map((id) => this.notifications.get(id))
      .filter((n): n is StoredNotification => n !== undefined)

    if (options?.channel) {
      results = results.filter((n) => n.channel === options.channel)
    }

    return results.map((stored) => ({
      id: stored.id,
      delivered: stored.delivered,
      channel: stored.channel,
      recipient: stored.recipient,
      sentAt: stored.sentAt,
      deliveredAt: stored.deliveredAt,
      error: stored.error,
      attempts: stored.attempts,
    }))
  }
}
