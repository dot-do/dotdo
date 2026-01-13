/**
 * SLA (Service Level Agreement) Tracking for Human Requests
 *
 * This module provides timestamp tracking, SLA metric calculations,
 * and priority-based deadline configuration for human-in-the-loop requests.
 *
 * Features:
 * - Time-to-first-response calculation
 * - Time-to-completion calculation
 * - Time-at-escalation-level tracking
 * - SLA breach detection
 * - Priority-based deadline configuration (critical, high, normal, low)
 * - SLA warning generation for approaching deadlines
 *
 * @module lib/humans/sla
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Priority levels for human requests
 */
export type Priority = 'critical' | 'high' | 'normal' | 'low'

/**
 * Timestamps recorded throughout a human request lifecycle
 */
export interface SLATimestamps {
  /** When the request was created */
  createdAt: Date
  /** When the request was assigned to a human */
  assignedAt?: Date
  /** When the first response was received */
  firstResponseAt?: Date
  /** When the request was completed (approved/rejected) */
  completedAt?: Date
  /** Escalation history */
  escalations?: EscalationTimestamp[]
}

/**
 * Record of an escalation event
 */
export interface EscalationTimestamp {
  /** Escalation level (1, 2, 3, etc.) */
  level: number
  /** When this escalation occurred */
  escalatedAt: Date
  /** Who/what role it was escalated to */
  target: string
  /** Reason for escalation (optional) */
  reason?: string
}

/**
 * SLA configuration for a request
 */
export interface SLAConfig {
  /** The deadline by which the request must be completed */
  deadline: Date
  /** Time before deadline to trigger warning (ms) */
  warningThreshold: number
  /** Whether the SLA has been breached */
  breached: boolean
}

/**
 * Human request with SLA tracking
 */
export interface HumanRequestWithSLA {
  requestId: string
  role: string
  message: string
  priority: Priority
  timestamps: SLATimestamps
  sla: SLAConfig
  status: 'pending' | 'assigned' | 'completed' | 'expired'
}

/**
 * Calculated SLA metrics
 */
export interface SLAMetrics {
  timeToFirstResponse: number | null
  timeToCompletion: number | null
  timeAtLevels: Record<number, number>
  breached: boolean
}

/**
 * SLA warning information
 */
export interface SLAWarning {
  requestId: string
  shouldWarn: boolean
  breached: boolean
  timeRemaining: number
  message: string
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default SLA configuration values
 */
export const DEFAULT_SLA_CONFIG = {
  normalDeadlineMs: 4 * 60 * 60 * 1000, // 4 hours
  warningThresholdMs: 30 * 60 * 1000, // 30 minutes
}

/**
 * Priority-based SLA deadlines (milliseconds)
 */
export const PRIORITY_DEADLINES: Record<Priority, number> = {
  critical: 1 * 60 * 60 * 1000, // 1 hour
  high: 2 * 60 * 60 * 1000, // 2 hours
  normal: 4 * 60 * 60 * 1000, // 4 hours (same as default)
  low: 24 * 60 * 60 * 1000, // 24 hours
}

// ============================================================================
// SLA Calculation Functions
// ============================================================================

/**
 * Calculate time from request creation to first response
 * @returns Time in milliseconds, or null if no response yet
 */
export function calculateTimeToFirstResponse(request: HumanRequestWithSLA): number | null {
  if (!request.timestamps.firstResponseAt) {
    return null
  }
  return request.timestamps.firstResponseAt.getTime() - request.timestamps.createdAt.getTime()
}

/**
 * Calculate time from request creation to completion
 * @returns Time in milliseconds, or null if not completed
 */
export function calculateTimeToCompletion(request: HumanRequestWithSLA): number | null {
  if (!request.timestamps.completedAt) {
    return null
  }
  return request.timestamps.completedAt.getTime() - request.timestamps.createdAt.getTime()
}

/**
 * Calculate time spent at each escalation level
 * @returns Map of level number to time in milliseconds
 */
export function calculateTimeAtEscalationLevel(request: HumanRequestWithSLA): Record<number, number> {
  const timeAtLevels: Record<number, number> = {}
  const escalations = request.timestamps.escalations || []
  const createdAt = request.timestamps.createdAt.getTime()
  const completedAt = request.timestamps.completedAt?.getTime() || Date.now()

  if (escalations.length === 0) {
    // No escalations - all time spent at level 0
    timeAtLevels[0] = completedAt - createdAt
    return timeAtLevels
  }

  // Time at level 0 (before first escalation)
  const firstEscalation = escalations[0]!
  timeAtLevels[0] = firstEscalation.escalatedAt.getTime() - createdAt

  // Time at each escalation level
  for (let i = 0; i < escalations.length; i++) {
    const current = escalations[i]!
    const nextEscalation = escalations[i + 1]
    const levelEnd = nextEscalation ? nextEscalation.escalatedAt.getTime() : completedAt

    timeAtLevels[current.level] = levelEnd - current.escalatedAt.getTime()
  }

  return timeAtLevels
}

/**
 * Check if the SLA has been breached
 * @returns true if deadline was exceeded
 */
export function checkSLABreach(request: HumanRequestWithSLA): boolean {
  const deadline = request.sla.deadline.getTime()

  // If completed, check if completion was after deadline
  if (request.timestamps.completedAt) {
    return request.timestamps.completedAt.getTime() > deadline
  }

  // If not completed, check if current time is past deadline
  return Date.now() > deadline
}

/**
 * Get the SLA deadline duration for a given priority
 * @returns Deadline in milliseconds
 */
export function getSLADeadlineForPriority(priority: Priority): number {
  return PRIORITY_DEADLINES[priority]
}

/**
 * Create an SLA warning if the request is approaching or past deadline
 * @returns Warning object, or null if no warning needed
 */
export function createSLAWarning(request: HumanRequestWithSLA, currentTime: Date): SLAWarning | null {
  const deadline = request.sla.deadline.getTime()
  const current = currentTime.getTime()
  const timeRemaining = deadline - current
  const warningThreshold = request.sla.warningThreshold

  // Check if past deadline (breached)
  if (timeRemaining < 0) {
    const overdueMinutes = Math.abs(Math.floor(timeRemaining / (60 * 1000)))
    return {
      requestId: request.requestId,
      shouldWarn: true,
      breached: true,
      timeRemaining,
      message: `SLA breached: Request is ${overdueMinutes} minutes overdue`,
    }
  }

  // Check if within warning threshold
  if (timeRemaining <= warningThreshold) {
    const remainingMinutes = Math.floor(timeRemaining / (60 * 1000))
    return {
      requestId: request.requestId,
      shouldWarn: true,
      breached: false,
      timeRemaining,
      message: `SLA warning: ${remainingMinutes} minutes remaining until deadline`,
    }
  }

  // No warning needed - deadline is not approaching
  return null
}
