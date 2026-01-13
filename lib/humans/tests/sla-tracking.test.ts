/**
 * SLA Tracking Tests for Human Requests
 *
 * Tests for Service Level Agreement (SLA) tracking on human requests.
 * Validates timestamp recording, SLA metric calculations, breach detection,
 * and priority-based deadline configuration.
 *
 * NO MOCKS - uses real timestamps for all calculations.
 *
 * @see dotdo-mtawh - [RED] Test: SLA tracking with timestamps on human requests
 * @see dotdo-hnz5x - [GREEN] Implement SLA tracking on Human request Things
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Types for SLA tracking (to be implemented in lib/human/sla.ts)
// These imports will fail until implementation exists

// Import the SLA tracking types and functions that don't exist yet
// This will cause the tests to fail (RED state)
import {
  type SLATimestamps,
  type SLAConfig,
  type SLAMetrics,
  type EscalationTimestamp,
  type HumanRequestWithSLA,
  type Priority,
  calculateTimeToFirstResponse,
  calculateTimeToCompletion,
  calculateTimeAtEscalationLevel,
  checkSLABreach,
  getSLADeadlineForPriority,
  createSLAWarning,
  DEFAULT_SLA_CONFIG,
} from '../sla'

// ============================================================================
// Test Fixtures - Real timestamps, NO MOCKS
// ============================================================================

/**
 * Create a human request with SLA timestamps
 * Uses real Date objects, not mocks
 */
function createTestRequest(overrides: Partial<HumanRequestWithSLA> = {}): HumanRequestWithSLA {
  const now = new Date()

  return {
    requestId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'ceo',
    message: 'approve the partnership',
    priority: 'normal' as Priority,
    timestamps: {
      createdAt: now,
    },
    sla: {
      deadline: new Date(now.getTime() + 4 * 60 * 60 * 1000), // 4 hours default
      warningThreshold: 30 * 60 * 1000, // 30 minutes before deadline
      breached: false,
    },
    status: 'pending',
    ...overrides,
  }
}

/**
 * Helper to advance time by specified milliseconds
 * Returns a new Date without modifying the original
 */
function advanceTime(baseTime: Date, ms: number): Date {
  return new Date(baseTime.getTime() + ms)
}

// ============================================================================
// Timestamp Recording Tests
// ============================================================================

describe('SLA Tracking', () => {
  describe('Timestamp Recording', () => {
    it('records createdAt when request is created', () => {
      const beforeCreation = new Date()
      const request = createTestRequest()
      const afterCreation = new Date()

      expect(request.timestamps.createdAt).toBeInstanceOf(Date)
      expect(request.timestamps.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreation.getTime())
      expect(request.timestamps.createdAt.getTime()).toBeLessThanOrEqual(afterCreation.getTime())
    })

    it('records assignedAt when request is assigned', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Simulate time passing before assignment
      const assignedAt = advanceTime(createdAt, 5000) // 5 seconds later

      // Update request with assignedAt timestamp
      request.timestamps.assignedAt = assignedAt

      expect(request.timestamps.assignedAt).toBeInstanceOf(Date)
      expect(request.timestamps.assignedAt.getTime()).toBeGreaterThan(request.timestamps.createdAt.getTime())
    })

    it('records firstResponseAt when first response received', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Simulate assignment
      const assignedAt = advanceTime(createdAt, 5000)
      request.timestamps.assignedAt = assignedAt

      // Simulate first response (e.g., "I'm looking at this")
      const firstResponseAt = advanceTime(assignedAt, 10000) // 10 seconds after assignment
      request.timestamps.firstResponseAt = firstResponseAt

      expect(request.timestamps.firstResponseAt).toBeInstanceOf(Date)
      expect(request.timestamps.firstResponseAt.getTime()).toBeGreaterThan(request.timestamps.assignedAt!.getTime())
    })

    it('records completedAt when request is completed', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Simulate full lifecycle
      request.timestamps.assignedAt = advanceTime(createdAt, 5000)
      request.timestamps.firstResponseAt = advanceTime(request.timestamps.assignedAt, 10000)

      // Simulate completion (approval/rejection)
      const completedAt = advanceTime(request.timestamps.firstResponseAt, 30000) // 30 seconds after first response
      request.timestamps.completedAt = completedAt

      expect(request.timestamps.completedAt).toBeInstanceOf(Date)
      expect(request.timestamps.completedAt.getTime()).toBeGreaterThan(request.timestamps.firstResponseAt!.getTime())
    })

    it('records each escalation timestamp', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Initialize escalations array
      request.timestamps.escalations = []

      // First escalation - after 30 minutes with no response
      const firstEscalation: EscalationTimestamp = {
        level: 1,
        escalatedAt: advanceTime(createdAt, 30 * 60 * 1000), // 30 minutes
        target: 'manager',
        reason: 'No response within SLA warning threshold',
      }
      request.timestamps.escalations.push(firstEscalation)

      // Second escalation - after 2 hours
      const secondEscalation: EscalationTimestamp = {
        level: 2,
        escalatedAt: advanceTime(createdAt, 2 * 60 * 60 * 1000), // 2 hours
        target: 'director',
        reason: 'SLA breach imminent',
      }
      request.timestamps.escalations.push(secondEscalation)

      expect(request.timestamps.escalations).toHaveLength(2)
      expect(request.timestamps.escalations[0]!.level).toBe(1)
      expect(request.timestamps.escalations[0]!.target).toBe('manager')
      expect(request.timestamps.escalations[1]!.level).toBe(2)
      expect(request.timestamps.escalations[1]!.target).toBe('director')

      // Verify escalation times are in order
      expect(request.timestamps.escalations[1]!.escalatedAt.getTime())
        .toBeGreaterThan(request.timestamps.escalations[0]!.escalatedAt.getTime())
    })
  })

  // ============================================================================
  // SLA Metrics Tests
  // ============================================================================

  describe('SLA Metrics', () => {
    it('calculates time-to-first-response', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Set up timestamps
      request.timestamps.assignedAt = advanceTime(createdAt, 5000) // 5 seconds
      request.timestamps.firstResponseAt = advanceTime(createdAt, 65000) // 65 seconds from creation

      const ttfr = calculateTimeToFirstResponse(request)

      // Time to first response should be 65000ms (65 seconds)
      expect(ttfr).toBe(65000)
    })

    it('calculates time-to-completion', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Full lifecycle
      request.timestamps.assignedAt = advanceTime(createdAt, 5000)
      request.timestamps.firstResponseAt = advanceTime(createdAt, 10000)
      request.timestamps.completedAt = advanceTime(createdAt, 300000) // 5 minutes total

      const ttc = calculateTimeToCompletion(request)

      // Time to completion should be 300000ms (5 minutes)
      expect(ttc).toBe(300000)
    })

    it('calculates time-at-each-escalation-level', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Set up escalations
      request.timestamps.escalations = [
        {
          level: 1,
          escalatedAt: advanceTime(createdAt, 30 * 60 * 1000), // 30 minutes
          target: 'manager',
        },
        {
          level: 2,
          escalatedAt: advanceTime(createdAt, 90 * 60 * 1000), // 90 minutes
          target: 'director',
        },
      ]
      request.timestamps.completedAt = advanceTime(createdAt, 120 * 60 * 1000) // 2 hours

      const timeAtLevels = calculateTimeAtEscalationLevel(request)

      // Level 0 (initial): 0 to 30 minutes = 30 minutes
      expect(timeAtLevels[0]).toBe(30 * 60 * 1000)

      // Level 1 (manager): 30 to 90 minutes = 60 minutes
      expect(timeAtLevels[1]).toBe(60 * 60 * 1000)

      // Level 2 (director): 90 to 120 minutes = 30 minutes
      expect(timeAtLevels[2]).toBe(30 * 60 * 1000)
    })

    it('flags SLA breaches when deadline exceeded', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Set a deadline 1 hour from creation
      request.sla.deadline = advanceTime(createdAt, 60 * 60 * 1000) // 1 hour

      // Complete AFTER deadline (1.5 hours from creation)
      request.timestamps.completedAt = advanceTime(createdAt, 90 * 60 * 1000)

      const isBreach = checkSLABreach(request)

      expect(isBreach).toBe(true)
    })

    it('does not flag SLA breach when completed before deadline', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Set a deadline 4 hours from creation
      request.sla.deadline = advanceTime(createdAt, 4 * 60 * 60 * 1000)

      // Complete BEFORE deadline (30 minutes from creation)
      request.timestamps.completedAt = advanceTime(createdAt, 30 * 60 * 1000)

      const isBreach = checkSLABreach(request)

      expect(isBreach).toBe(false)
    })

    it('returns null for time-to-first-response when no response yet', () => {
      const request = createTestRequest()
      // No firstResponseAt set

      const ttfr = calculateTimeToFirstResponse(request)

      expect(ttfr).toBeNull()
    })

    it('returns null for time-to-completion when not completed', () => {
      const request = createTestRequest()
      // No completedAt set

      const ttc = calculateTimeToCompletion(request)

      expect(ttc).toBeNull()
    })
  })

  // ============================================================================
  // SLA Warnings Tests
  // ============================================================================

  describe('SLA Warnings', () => {
    it('triggers warning notification before deadline', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Set deadline 1 hour from creation
      request.sla.deadline = advanceTime(createdAt, 60 * 60 * 1000)

      // Warning threshold is 30 minutes before deadline
      request.sla.warningThreshold = 30 * 60 * 1000

      // Current time is 35 minutes after creation (25 minutes until deadline)
      // This is WITHIN the warning threshold
      const currentTime = advanceTime(createdAt, 35 * 60 * 1000)

      const warning = createSLAWarning(request, currentTime)

      expect(warning).not.toBeNull()
      expect(warning!.shouldWarn).toBe(true)
      expect(warning!.requestId).toBe(request.requestId)
    })

    it('includes time remaining in warning', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Set deadline 1 hour from creation
      request.sla.deadline = advanceTime(createdAt, 60 * 60 * 1000)
      request.sla.warningThreshold = 30 * 60 * 1000

      // Current time is 45 minutes after creation (15 minutes until deadline)
      const currentTime = advanceTime(createdAt, 45 * 60 * 1000)

      const warning = createSLAWarning(request, currentTime)

      expect(warning).not.toBeNull()
      expect(warning!.timeRemaining).toBe(15 * 60 * 1000) // 15 minutes
      expect(warning!.message).toContain('15 minutes')
    })

    it('does not trigger warning when deadline is far away', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Set deadline 4 hours from creation
      request.sla.deadline = advanceTime(createdAt, 4 * 60 * 60 * 1000)
      request.sla.warningThreshold = 30 * 60 * 1000 // 30 minutes

      // Current time is 1 hour after creation (3 hours until deadline)
      // This is NOT within the warning threshold
      const currentTime = advanceTime(createdAt, 60 * 60 * 1000)

      const warning = createSLAWarning(request, currentTime)

      expect(warning).toBeNull() // No warning needed yet
    })

    it('returns breach warning when past deadline', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      // Set deadline 1 hour from creation
      request.sla.deadline = advanceTime(createdAt, 60 * 60 * 1000)

      // Current time is 1.5 hours after creation (PAST deadline)
      const currentTime = advanceTime(createdAt, 90 * 60 * 1000)

      const warning = createSLAWarning(request, currentTime)

      expect(warning).not.toBeNull()
      expect(warning!.breached).toBe(true)
      expect(warning!.timeRemaining).toBeLessThan(0) // Negative = overdue
    })
  })

  // ============================================================================
  // Priority-based SLAs Tests
  // ============================================================================

  describe('Priority-based SLAs', () => {
    it('uses shorter deadline for critical priority', () => {
      const criticalDeadline = getSLADeadlineForPriority('critical')
      const normalDeadline = getSLADeadlineForPriority('normal')

      // Critical should be faster than normal
      expect(criticalDeadline).toBeLessThan(normalDeadline)

      // Critical should be around 1 hour (configurable)
      expect(criticalDeadline).toBe(1 * 60 * 60 * 1000) // 1 hour
    })

    it('uses longer deadline for low priority', () => {
      const lowDeadline = getSLADeadlineForPriority('low')
      const normalDeadline = getSLADeadlineForPriority('normal')

      // Low should be slower than normal
      expect(lowDeadline).toBeGreaterThan(normalDeadline)

      // Low should be around 24 hours (configurable)
      expect(lowDeadline).toBe(24 * 60 * 60 * 1000) // 24 hours
    })

    it('has default deadlines for all priority levels', () => {
      const priorities: Priority[] = ['critical', 'high', 'normal', 'low']

      for (const priority of priorities) {
        const deadline = getSLADeadlineForPriority(priority)
        expect(deadline).toBeGreaterThan(0)
        expect(typeof deadline).toBe('number')
      }
    })

    it('applies priority-based deadline when creating request', () => {
      // Create requests with different priorities
      const criticalRequest = createTestRequest({ priority: 'critical' })
      const lowRequest = createTestRequest({ priority: 'low' })

      // Calculate expected deadlines
      const criticalDeadlineMs = getSLADeadlineForPriority('critical')
      const lowDeadlineMs = getSLADeadlineForPriority('low')

      // Set SLA deadlines based on priority
      criticalRequest.sla.deadline = advanceTime(
        criticalRequest.timestamps.createdAt,
        criticalDeadlineMs
      )
      lowRequest.sla.deadline = advanceTime(
        lowRequest.timestamps.createdAt,
        lowDeadlineMs
      )

      // Critical request should have sooner deadline
      const criticalDeadlineDiff = criticalRequest.sla.deadline.getTime() - criticalRequest.timestamps.createdAt.getTime()
      const lowDeadlineDiff = lowRequest.sla.deadline.getTime() - lowRequest.timestamps.createdAt.getTime()

      expect(criticalDeadlineDiff).toBeLessThan(lowDeadlineDiff)
    })

    it('high priority is between critical and normal', () => {
      const criticalDeadline = getSLADeadlineForPriority('critical')
      const highDeadline = getSLADeadlineForPriority('high')
      const normalDeadline = getSLADeadlineForPriority('normal')

      expect(highDeadline).toBeGreaterThan(criticalDeadline)
      expect(highDeadline).toBeLessThan(normalDeadline)

      // High should be around 2 hours
      expect(highDeadline).toBe(2 * 60 * 60 * 1000) // 2 hours
    })

    it('normal priority uses default SLA config', () => {
      const normalDeadline = getSLADeadlineForPriority('normal')

      // Should match the default from SLA config
      expect(normalDeadline).toBe(DEFAULT_SLA_CONFIG.normalDeadlineMs)

      // Normal should be around 4 hours
      expect(normalDeadline).toBe(4 * 60 * 60 * 1000) // 4 hours
    })
  })

  // ============================================================================
  // SLA Metrics Aggregation Tests (Bonus coverage)
  // ============================================================================

  describe('SLA Metrics Aggregation', () => {
    it('calculates total escalation time', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      request.timestamps.escalations = [
        {
          level: 1,
          escalatedAt: advanceTime(createdAt, 30 * 60 * 1000),
          target: 'manager',
        },
        {
          level: 2,
          escalatedAt: advanceTime(createdAt, 90 * 60 * 1000),
          target: 'director',
        },
      ]
      request.timestamps.completedAt = advanceTime(createdAt, 120 * 60 * 1000)

      const timeAtLevels = calculateTimeAtEscalationLevel(request)
      const totalTime = Object.values(timeAtLevels).reduce((sum, time) => sum + time, 0)

      // Total time should equal time from creation to completion
      expect(totalTime).toBe(120 * 60 * 1000) // 2 hours
    })

    it('handles request with no escalations', () => {
      const request = createTestRequest()
      const createdAt = request.timestamps.createdAt

      request.timestamps.escalations = []
      request.timestamps.completedAt = advanceTime(createdAt, 30 * 60 * 1000)

      const timeAtLevels = calculateTimeAtEscalationLevel(request)

      // Only level 0 should have time
      expect(Object.keys(timeAtLevels)).toHaveLength(1)
      expect(timeAtLevels[0]).toBe(30 * 60 * 1000)
    })
  })
})
