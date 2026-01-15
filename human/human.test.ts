/**
 * Human-in-the-Loop (HITL) Tests
 *
 * Tests for human oversight and intervention in AI workflows.
 * Covers approval workflows, escalation policies, SLA tracking,
 * review queues, and notification dispatch.
 *
 * NO MOCKS - uses real data structures and timings.
 *
 * @see do-v2.10.1 - [RED] Human-in-the-Loop tests
 * @see do-v2.10.2 - [GREEN] Human-in-the-Loop implementation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will fail until implementation exists (RED state)
import {
  ApprovalWorkflow,
  EscalationPolicy,
  SLATracker,
  ReviewQueue,
  NotificationDispatcher,
  type ApprovalRequest,
  type ApprovalResponse,
  type EscalationConfig,
  type SLACheck,
  type ReviewItem,
  type NotificationResult,
  type NotificationChannel,
} from './index'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a unique request ID for testing
 */
function createRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Create a test action for approval
 */
function createTestAction(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: createRequestId(),
    type: 'expense',
    title: 'Expense Report Approval',
    description: 'Please approve expense report for $1,500',
    amount: 1500,
    requestedBy: 'employee@example.com',
    requestedAt: new Date(),
    metadata: {},
    ...overrides,
  }
}

/**
 * Create test approvers list
 */
function createApprovers(): string[] {
  return ['manager@example.com', 'director@example.com', 'vp@example.com']
}

// ============================================================================
// 1. ApprovalWorkflow Tests
// ============================================================================

describe('ApprovalWorkflow', () => {
  let workflow: ApprovalWorkflow

  beforeEach(() => {
    workflow = new ApprovalWorkflow()
  })

  describe('workflow.request()', () => {
    it('creates an approval request with action and approvers', async () => {
      const action = createTestAction()
      const approvers = createApprovers()

      const request = await workflow.request(action, approvers)

      expect(request.id).toBeDefined()
      expect(request.action).toEqual(action)
      expect(request.approvers).toEqual(approvers)
      expect(request.status).toBe('pending')
      expect(request.createdAt).toBeInstanceOf(Date)
    })

    it('assigns to first approver in the list', async () => {
      const action = createTestAction()
      const approvers = createApprovers()

      const request = await workflow.request(action, approvers)

      expect(request.currentApprover).toBe('manager@example.com')
      expect(request.currentLevel).toBe(0)
    })

    it('generates unique request IDs', async () => {
      const action = createTestAction()
      const approvers = createApprovers()

      const request1 = await workflow.request(action, approvers)
      const request2 = await workflow.request(action, approvers)

      expect(request1.id).not.toBe(request2.id)
    })

    it('stores request for later retrieval', async () => {
      const action = createTestAction()
      const approvers = createApprovers()

      const request = await workflow.request(action, approvers)
      const retrieved = await workflow.get(request.id)

      expect(retrieved).toEqual(request)
    })

    it('supports optional deadline', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

      const request = await workflow.request(action, approvers, { deadline })

      expect(request.deadline).toEqual(deadline)
    })

    it('supports priority levels', async () => {
      const action = createTestAction()
      const approvers = createApprovers()

      const request = await workflow.request(action, approvers, { priority: 'critical' })

      expect(request.priority).toBe('critical')
    })
  })

  describe('workflow.approve()', () => {
    it('approves a pending request', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const request = await workflow.request(action, approvers)

      const result = await workflow.approve(request.id, 'manager@example.com')

      expect(result.status).toBe('approved_at_level')
      expect(result.approvedBy).toBe('manager@example.com')
      expect(result.approvedAt).toBeInstanceOf(Date)
    })

    it('advances to next approver in multi-level workflow', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const request = await workflow.request(action, approvers)

      await workflow.approve(request.id, 'manager@example.com')
      const updated = await workflow.get(request.id)

      expect(updated.currentLevel).toBe(1)
      expect(updated.currentApprover).toBe('director@example.com')
      expect(updated.status).toBe('pending')
    })

    it('completes workflow when final approver approves', async () => {
      const action = createTestAction()
      const approvers = ['manager@example.com'] // Single approver

      const request = await workflow.request(action, approvers)
      const result = await workflow.approve(request.id, 'manager@example.com')

      expect(result.status).toBe('approved')
      expect(result.completedAt).toBeInstanceOf(Date)
    })

    it('rejects approval from non-current approver', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const request = await workflow.request(action, approvers)

      await expect(
        workflow.approve(request.id, 'director@example.com')
      ).rejects.toThrow('Not authorized to approve at this level')
    })

    it('rejects approval for non-existent request', async () => {
      await expect(
        workflow.approve('non-existent-id', 'manager@example.com')
      ).rejects.toThrow('Request not found')
    })

    it('records approval history', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const request = await workflow.request(action, approvers)

      await workflow.approve(request.id, 'manager@example.com')
      await workflow.approve(request.id, 'director@example.com')

      const updated = await workflow.get(request.id)

      expect(updated.history).toHaveLength(2)
      expect(updated.history[0].action).toBe('approved')
      expect(updated.history[0].by).toBe('manager@example.com')
      expect(updated.history[1].action).toBe('approved')
      expect(updated.history[1].by).toBe('director@example.com')
    })

    it('supports approval with comments', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const request = await workflow.request(action, approvers)

      const result = await workflow.approve(request.id, 'manager@example.com', {
        comment: 'Looks good, proceeding with approval',
      })

      expect(result.comment).toBe('Looks good, proceeding with approval')
    })
  })

  describe('workflow.reject()', () => {
    it('rejects a pending request', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const request = await workflow.request(action, approvers)

      const result = await workflow.reject(
        request.id,
        'manager@example.com',
        'Budget exceeded for this quarter'
      )

      expect(result.status).toBe('rejected')
      expect(result.rejectedBy).toBe('manager@example.com')
      expect(result.rejectionReason).toBe('Budget exceeded for this quarter')
      expect(result.rejectedAt).toBeInstanceOf(Date)
    })

    it('requires rejection reason', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const request = await workflow.request(action, approvers)

      await expect(
        workflow.reject(request.id, 'manager@example.com', '')
      ).rejects.toThrow('Rejection reason is required')
    })

    it('terminates workflow immediately on rejection', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const request = await workflow.request(action, approvers)

      await workflow.reject(request.id, 'manager@example.com', 'Not approved')
      const updated = await workflow.get(request.id)

      expect(updated.status).toBe('rejected')
      expect(updated.completedAt).toBeInstanceOf(Date)
    })

    it('allows any current or previous approver to reject', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const request = await workflow.request(action, approvers)

      // Advance to director
      await workflow.approve(request.id, 'manager@example.com')

      // Manager (previous approver) can still reject
      const result = await workflow.reject(
        request.id,
        'manager@example.com',
        'Found issue after initial approval'
      )

      expect(result.status).toBe('rejected')
    })

    it('records rejection in history', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const request = await workflow.request(action, approvers)

      await workflow.reject(request.id, 'manager@example.com', 'Budget issue')
      const updated = await workflow.get(request.id)

      expect(updated.history).toHaveLength(1)
      expect(updated.history[0].action).toBe('rejected')
      expect(updated.history[0].reason).toBe('Budget issue')
    })
  })

  describe('Multi-level approvals', () => {
    it('supports manager -> director -> VP approval chain', async () => {
      const action = createTestAction({ amount: 50000 })
      const approvers = ['manager@example.com', 'director@example.com', 'vp@example.com']

      const request = await workflow.request(action, approvers)

      // Level 0: Manager approves
      await workflow.approve(request.id, 'manager@example.com')
      let state = await workflow.get(request.id)
      expect(state.currentLevel).toBe(1)
      expect(state.status).toBe('pending')

      // Level 1: Director approves
      await workflow.approve(request.id, 'director@example.com')
      state = await workflow.get(request.id)
      expect(state.currentLevel).toBe(2)
      expect(state.status).toBe('pending')

      // Level 2: VP approves (final)
      const result = await workflow.approve(request.id, 'vp@example.com')
      expect(result.status).toBe('approved')
      expect(result.completedAt).toBeInstanceOf(Date)
    })

    it('calculates total approval time across all levels', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const request = await workflow.request(action, approvers)

      await workflow.approve(request.id, 'manager@example.com')
      await workflow.approve(request.id, 'director@example.com')
      await workflow.approve(request.id, 'vp@example.com')

      const final = await workflow.get(request.id)
      const totalTime = final.completedAt!.getTime() - final.createdAt.getTime()

      expect(totalTime).toBeGreaterThanOrEqual(0)
      expect(final.metrics?.totalApprovalTime).toBeDefined()
    })

    it('tracks time spent at each approval level', async () => {
      const action = createTestAction()
      const approvers = createApprovers()
      const request = await workflow.request(action, approvers)

      await workflow.approve(request.id, 'manager@example.com')
      await workflow.approve(request.id, 'director@example.com')
      await workflow.approve(request.id, 'vp@example.com')

      const final = await workflow.get(request.id)

      expect(final.metrics?.timePerLevel).toBeDefined()
      expect(final.metrics?.timePerLevel).toHaveLength(3)
    })
  })
})

// ============================================================================
// 2. EscalationPolicy Tests
// ============================================================================

describe('EscalationPolicy', () => {
  let policy: EscalationPolicy

  beforeEach(() => {
    policy = new EscalationPolicy()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('policy.escalateAfter()', () => {
    it('configures escalation timeout duration', () => {
      const config = policy.escalateAfter('2 hours')

      expect(config.duration).toBe(2 * 60 * 60 * 1000) // 2 hours in ms
    })

    it('supports various duration formats', () => {
      expect(policy.escalateAfter('30 minutes').duration).toBe(30 * 60 * 1000)
      expect(policy.escalateAfter('1 hour').duration).toBe(60 * 60 * 1000)
      expect(policy.escalateAfter('1 day').duration).toBe(24 * 60 * 60 * 1000)
      expect(policy.escalateAfter('2h').duration).toBe(2 * 60 * 60 * 1000)
      expect(policy.escalateAfter('30m').duration).toBe(30 * 60 * 1000)
    })

    it('returns chainable configuration', () => {
      const config = policy.escalateAfter('1 hour')

      expect(config.escalateTo).toBeInstanceOf(Function)
    })

    it('throws on invalid duration format', () => {
      expect(() => policy.escalateAfter('invalid')).toThrow('Invalid duration format')
    })
  })

  describe('policy.escalateTo()', () => {
    it('configures escalation target role', () => {
      const config = policy.escalateAfter('1 hour').escalateTo('director')

      expect(config.target).toBe('director')
    })

    it('supports user email as target', () => {
      const config = policy.escalateAfter('1 hour').escalateTo('director@example.com')

      expect(config.target).toBe('director@example.com')
    })

    it('supports escalation chain', () => {
      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('manager')
        .escalateAfter('2 hours')
        .escalateTo('director')
        .escalateAfter('4 hours')
        .escalateTo('vp')

      expect(config.chain).toHaveLength(3)
      expect(config.chain[0]).toEqual({ duration: 60 * 60 * 1000, target: 'manager' })
      expect(config.chain[1]).toEqual({ duration: 2 * 60 * 60 * 1000, target: 'director' })
      expect(config.chain[2]).toEqual({ duration: 4 * 60 * 60 * 1000, target: 'vp' })
    })
  })

  describe('Auto-escalate when SLA breached', () => {
    it('triggers escalation when deadline passes', async () => {
      vi.useFakeTimers()
      const escalated = vi.fn()

      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('director')
        .onEscalate(escalated)

      const request = await policy.track('request-123', config)

      // Advance time past escalation threshold
      vi.advanceTimersByTime(61 * 60 * 1000) // 61 minutes

      expect(escalated).toHaveBeenCalledWith(expect.objectContaining({
        requestId: 'request-123',
        escalatedTo: 'director',
        reason: 'SLA breach',
      }))
    })

    it('escalates through chain sequentially', async () => {
      vi.useFakeTimers()
      const escalated = vi.fn()

      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('manager')
        .escalateAfter('2 hours')
        .escalateTo('director')
        .onEscalate(escalated)

      await policy.track('request-123', config)

      // First escalation at 1 hour
      vi.advanceTimersByTime(61 * 60 * 1000)
      expect(escalated).toHaveBeenCalledTimes(1)
      expect(escalated).toHaveBeenLastCalledWith(expect.objectContaining({
        escalatedTo: 'manager',
      }))

      // Second escalation at 3 hours (1 + 2)
      vi.advanceTimersByTime(2 * 60 * 60 * 1000)
      expect(escalated).toHaveBeenCalledTimes(2)
      expect(escalated).toHaveBeenLastCalledWith(expect.objectContaining({
        escalatedTo: 'director',
      }))
    })

    it('stops escalation when request is resolved', async () => {
      vi.useFakeTimers()
      const escalated = vi.fn()

      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('director')
        .onEscalate(escalated)

      const tracking = await policy.track('request-123', config)

      // Resolve before escalation
      vi.advanceTimersByTime(30 * 60 * 1000) // 30 minutes
      await tracking.resolve()

      // Advance past escalation time
      vi.advanceTimersByTime(60 * 60 * 1000) // Another hour

      expect(escalated).not.toHaveBeenCalled()
    })
  })

  describe('Notification on escalation', () => {
    it('notifies original assignee of escalation', async () => {
      vi.useFakeTimers()
      const notified = vi.fn()

      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('director')
        .onNotify(notified)

      await policy.track('request-123', config, {
        assignee: 'manager@example.com',
      })

      vi.advanceTimersByTime(61 * 60 * 1000)

      expect(notified).toHaveBeenCalledWith(expect.objectContaining({
        recipient: 'manager@example.com',
        type: 'escalation',
        message: expect.stringContaining('escalated to director'),
      }))
    })

    it('notifies new assignee of escalation', async () => {
      vi.useFakeTimers()
      const notified = vi.fn()

      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('director@example.com')
        .onNotify(notified)

      await policy.track('request-123', config)

      vi.advanceTimersByTime(61 * 60 * 1000)

      expect(notified).toHaveBeenCalledWith(expect.objectContaining({
        recipient: 'director@example.com',
        type: 'assignment',
        message: expect.stringContaining('assigned to you'),
      }))
    })
  })
})

// ============================================================================
// 3. SLATracker Tests
// ============================================================================

describe('SLATracker', () => {
  let sla: SLATracker

  beforeEach(() => {
    sla = new SLATracker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('sla.track()', () => {
    it('starts tracking a request with deadline', () => {
      const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours
      const tracking = sla.track('request-123', deadline)

      expect(tracking.requestId).toBe('request-123')
      expect(tracking.deadline).toEqual(deadline)
      expect(tracking.startedAt).toBeInstanceOf(Date)
    })

    it('supports deadline as duration string', () => {
      const tracking = sla.track('request-123', '4 hours')

      const expectedDeadline = new Date(Date.now() + 4 * 60 * 60 * 1000)
      // Allow 100ms tolerance for test execution time
      expect(Math.abs(tracking.deadline.getTime() - expectedDeadline.getTime())).toBeLessThan(100)
    })

    it('stores tracking for retrieval', () => {
      const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000)
      sla.track('request-123', deadline)

      const tracking = sla.get('request-123')

      expect(tracking).toBeDefined()
      expect(tracking?.requestId).toBe('request-123')
    })
  })

  describe('sla.check()', () => {
    it('returns breach status and remaining time', () => {
      vi.useFakeTimers()
      const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours
      sla.track('request-123', deadline)

      const check = sla.check('request-123')

      expect(check.breached).toBe(false)
      expect(check.remaining).toBe(4 * 60 * 60 * 1000) // 4 hours in ms
    })

    it('reports breach when deadline passed', () => {
      vi.useFakeTimers()
      const deadline = new Date(Date.now() + 1 * 60 * 60 * 1000) // 1 hour
      sla.track('request-123', deadline)

      vi.advanceTimersByTime(2 * 60 * 60 * 1000) // 2 hours

      const check = sla.check('request-123')

      expect(check.breached).toBe(true)
      expect(check.remaining).toBeLessThan(0)
      expect(check.overdueBy).toBe(1 * 60 * 60 * 1000) // 1 hour overdue
    })

    it('returns percentage of time elapsed', () => {
      vi.useFakeTimers()
      const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours
      sla.track('request-123', deadline)

      vi.advanceTimersByTime(1 * 60 * 60 * 1000) // 1 hour

      const check = sla.check('request-123')

      expect(check.percentageElapsed).toBe(25) // 1/4 of time used
    })

    it('throws for unknown request', () => {
      expect(() => sla.check('unknown')).toThrow('Request not found')
    })
  })

  describe('Alerts when approaching deadline', () => {
    it('triggers warning at 75% threshold', async () => {
      vi.useFakeTimers()
      const onWarning = vi.fn()

      sla.configure({
        warningThreshold: 0.75, // 75%
        onWarning,
      })

      const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours
      sla.track('request-123', deadline)

      // Advance to 75% (3 hours)
      vi.advanceTimersByTime(3 * 60 * 60 * 1000)

      expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({
        requestId: 'request-123',
        remaining: 1 * 60 * 60 * 1000, // 1 hour remaining
        threshold: 0.75,
      }))
    })

    it('triggers critical alert at 90% threshold', async () => {
      vi.useFakeTimers()
      const onCritical = vi.fn()

      sla.configure({
        criticalThreshold: 0.90, // 90%
        onCritical,
      })

      const deadline = new Date(Date.now() + 100 * 60 * 1000) // 100 minutes
      sla.track('request-123', deadline)

      // Advance to 90% (90 minutes)
      vi.advanceTimersByTime(90 * 60 * 1000)

      expect(onCritical).toHaveBeenCalledWith(expect.objectContaining({
        requestId: 'request-123',
        remaining: 10 * 60 * 1000, // 10 minutes remaining
        threshold: 0.90,
      }))
    })

    it('triggers breach alert when deadline passes', async () => {
      vi.useFakeTimers()
      const onBreach = vi.fn()

      sla.configure({ onBreach })

      const deadline = new Date(Date.now() + 1 * 60 * 60 * 1000) // 1 hour
      sla.track('request-123', deadline)

      vi.advanceTimersByTime(61 * 60 * 1000) // 61 minutes

      expect(onBreach).toHaveBeenCalledWith(expect.objectContaining({
        requestId: 'request-123',
        overdueBy: expect.any(Number),
      }))
    })
  })

  describe('Metrics: p50, p95, p99 response times', () => {
    it('calculates p50 response time', () => {
      // Record multiple completions
      const responseTimes = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]

      for (let i = 0; i < responseTimes.length; i++) {
        sla.recordCompletion(`request-${i}`, responseTimes[i])
      }

      const metrics = sla.getMetrics()

      expect(metrics.p50).toBe(550) // Median of 100-1000
    })

    it('calculates p95 response time', () => {
      const responseTimes = Array.from({ length: 100 }, (_, i) => (i + 1) * 10)

      for (let i = 0; i < responseTimes.length; i++) {
        sla.recordCompletion(`request-${i}`, responseTimes[i])
      }

      const metrics = sla.getMetrics()

      expect(metrics.p95).toBe(950) // 95th percentile
    })

    it('calculates p99 response time', () => {
      const responseTimes = Array.from({ length: 100 }, (_, i) => (i + 1) * 10)

      for (let i = 0; i < responseTimes.length; i++) {
        sla.recordCompletion(`request-${i}`, responseTimes[i])
      }

      const metrics = sla.getMetrics()

      expect(metrics.p99).toBe(990) // 99th percentile
    })

    it('returns breach rate', () => {
      // 3 out of 10 breached
      for (let i = 0; i < 10; i++) {
        sla.recordCompletion(`request-${i}`, i * 100, { breached: i >= 7 })
      }

      const metrics = sla.getMetrics()

      expect(metrics.breachRate).toBe(0.3) // 30% breach rate
    })

    it('returns average response time', () => {
      const responseTimes = [100, 200, 300, 400, 500]

      for (let i = 0; i < responseTimes.length; i++) {
        sla.recordCompletion(`request-${i}`, responseTimes[i])
      }

      const metrics = sla.getMetrics()

      expect(metrics.average).toBe(300)
    })

    it('returns metrics by priority', () => {
      sla.recordCompletion('req-1', 100, { priority: 'critical' })
      sla.recordCompletion('req-2', 200, { priority: 'critical' })
      sla.recordCompletion('req-3', 500, { priority: 'normal' })
      sla.recordCompletion('req-4', 600, { priority: 'normal' })

      const metrics = sla.getMetrics({ groupBy: 'priority' })

      expect(metrics.byPriority.critical.average).toBe(150)
      expect(metrics.byPriority.normal.average).toBe(550)
    })
  })
})

// ============================================================================
// 4. ReviewQueue Tests
// ============================================================================

describe('ReviewQueue', () => {
  let queue: ReviewQueue

  beforeEach(() => {
    queue = new ReviewQueue()
  })

  describe('queue.add()', () => {
    it('adds item to the queue', async () => {
      const item: ReviewItem = {
        id: 'item-1',
        type: 'approval',
        title: 'Review expense report',
        data: { amount: 500 },
        createdAt: new Date(),
      }

      const added = await queue.add(item)

      expect(added.id).toBe('item-1')
      expect(added.status).toBe('pending')
      expect(added.addedAt).toBeInstanceOf(Date)
    })

    it('adds item with priority', async () => {
      const item: ReviewItem = {
        id: 'item-1',
        type: 'approval',
        title: 'Urgent review',
        data: {},
        createdAt: new Date(),
      }

      const added = await queue.add(item, { priority: 'critical' })

      expect(added.priority).toBe('critical')
    })

    it('assigns default priority when not specified', async () => {
      const item: ReviewItem = {
        id: 'item-1',
        type: 'approval',
        title: 'Normal review',
        data: {},
        createdAt: new Date(),
      }

      const added = await queue.add(item)

      expect(added.priority).toBe('normal')
    })

    it('prevents duplicate items', async () => {
      const item: ReviewItem = {
        id: 'item-1',
        type: 'approval',
        title: 'Review',
        data: {},
        createdAt: new Date(),
      }

      await queue.add(item)

      await expect(queue.add(item)).rejects.toThrow('Item already exists in queue')
    })
  })

  describe('queue.claim()', () => {
    it('returns highest priority item for reviewer', async () => {
      await queue.add({ id: 'low', type: 'approval', title: 'Low priority', data: {}, createdAt: new Date() }, { priority: 'low' })
      await queue.add({ id: 'critical', type: 'approval', title: 'Critical', data: {}, createdAt: new Date() }, { priority: 'critical' })
      await queue.add({ id: 'normal', type: 'approval', title: 'Normal', data: {}, createdAt: new Date() }, { priority: 'normal' })

      const claimed = await queue.claim('reviewer@example.com')

      expect(claimed?.id).toBe('critical')
      expect(claimed?.claimedBy).toBe('reviewer@example.com')
      expect(claimed?.claimedAt).toBeInstanceOf(Date)
    })

    it('returns null when queue is empty', async () => {
      const claimed = await queue.claim('reviewer@example.com')

      expect(claimed).toBeNull()
    })

    it('marks item as claimed', async () => {
      await queue.add({ id: 'item-1', type: 'approval', title: 'Review', data: {}, createdAt: new Date() })

      await queue.claim('reviewer@example.com')
      const item = await queue.get('item-1')

      expect(item?.status).toBe('claimed')
    })

    it('prevents claiming already claimed items', async () => {
      await queue.add({ id: 'item-1', type: 'approval', title: 'Review', data: {}, createdAt: new Date() })

      await queue.claim('reviewer1@example.com')
      const claimed = await queue.claim('reviewer2@example.com')

      // Should get null since only item is claimed
      expect(claimed).toBeNull()
    })

    it('respects FIFO within same priority', async () => {
      const now = new Date()
      await queue.add({ id: 'first', type: 'approval', title: 'First', data: {}, createdAt: new Date(now.getTime()) }, { priority: 'normal' })
      await queue.add({ id: 'second', type: 'approval', title: 'Second', data: {}, createdAt: new Date(now.getTime() + 100) }, { priority: 'normal' })

      const claimed = await queue.claim('reviewer@example.com')

      expect(claimed?.id).toBe('first')
    })
  })

  describe('queue.complete()', () => {
    it('marks item as completed with decision', async () => {
      await queue.add({ id: 'item-1', type: 'approval', title: 'Review', data: {}, createdAt: new Date() })
      await queue.claim('reviewer@example.com')

      const completed = await queue.complete('item-1', { approved: true })

      expect(completed.status).toBe('completed')
      expect(completed.decision).toEqual({ approved: true })
      expect(completed.completedAt).toBeInstanceOf(Date)
    })

    it('throws when completing unclaimed item', async () => {
      await queue.add({ id: 'item-1', type: 'approval', title: 'Review', data: {}, createdAt: new Date() })

      await expect(queue.complete('item-1', { approved: true })).rejects.toThrow(
        'Item must be claimed before completion'
      )
    })

    it('throws for non-existent item', async () => {
      await expect(queue.complete('unknown', { approved: true })).rejects.toThrow(
        'Item not found'
      )
    })

    it('records completion metrics', async () => {
      await queue.add({ id: 'item-1', type: 'approval', title: 'Review', data: {}, createdAt: new Date() })
      await queue.claim('reviewer@example.com')

      const completed = await queue.complete('item-1', { approved: true })

      expect(completed.metrics?.timeInQueue).toBeDefined()
      expect(completed.metrics?.timeToComplete).toBeDefined()
    })
  })

  describe('queue.reassign()', () => {
    it('reassigns claimed item to new reviewer', async () => {
      await queue.add({ id: 'item-1', type: 'approval', title: 'Review', data: {}, createdAt: new Date() })
      await queue.claim('reviewer1@example.com')

      const reassigned = await queue.reassign('item-1', 'reviewer2@example.com')

      expect(reassigned.claimedBy).toBe('reviewer2@example.com')
      expect(reassigned.reassignedFrom).toBe('reviewer1@example.com')
      expect(reassigned.reassignedAt).toBeInstanceOf(Date)
    })

    it('allows reassigning unclaimed items', async () => {
      await queue.add({ id: 'item-1', type: 'approval', title: 'Review', data: {}, createdAt: new Date() })

      const reassigned = await queue.reassign('item-1', 'reviewer@example.com')

      expect(reassigned.claimedBy).toBe('reviewer@example.com')
      expect(reassigned.status).toBe('claimed')
    })

    it('throws for completed items', async () => {
      await queue.add({ id: 'item-1', type: 'approval', title: 'Review', data: {}, createdAt: new Date() })
      await queue.claim('reviewer@example.com')
      await queue.complete('item-1', { approved: true })

      await expect(
        queue.reassign('item-1', 'another@example.com')
      ).rejects.toThrow('Cannot reassign completed item')
    })

    it('records reassignment history', async () => {
      await queue.add({ id: 'item-1', type: 'approval', title: 'Review', data: {}, createdAt: new Date() })
      await queue.claim('reviewer1@example.com')
      await queue.reassign('item-1', 'reviewer2@example.com')
      await queue.reassign('item-1', 'reviewer3@example.com')

      const item = await queue.get('item-1')

      expect(item?.reassignmentHistory).toHaveLength(2)
    })
  })

  describe('Priority ordering', () => {
    it('orders by priority: critical > high > normal > low', async () => {
      await queue.add({ id: 'low', type: 'approval', title: 'Low', data: {}, createdAt: new Date() }, { priority: 'low' })
      await queue.add({ id: 'high', type: 'approval', title: 'High', data: {}, createdAt: new Date() }, { priority: 'high' })
      await queue.add({ id: 'normal', type: 'approval', title: 'Normal', data: {}, createdAt: new Date() }, { priority: 'normal' })
      await queue.add({ id: 'critical', type: 'approval', title: 'Critical', data: {}, createdAt: new Date() }, { priority: 'critical' })

      const items = await queue.list({ sortBy: 'priority' })

      expect(items.map(i => i.id)).toEqual(['critical', 'high', 'normal', 'low'])
    })

    it('returns queue length', async () => {
      await queue.add({ id: 'item-1', type: 'approval', title: 'Item 1', data: {}, createdAt: new Date() })
      await queue.add({ id: 'item-2', type: 'approval', title: 'Item 2', data: {}, createdAt: new Date() })

      const length = await queue.length()

      expect(length).toBe(2)
    })

    it('returns pending count', async () => {
      await queue.add({ id: 'item-1', type: 'approval', title: 'Item 1', data: {}, createdAt: new Date() })
      await queue.add({ id: 'item-2', type: 'approval', title: 'Item 2', data: {}, createdAt: new Date() })
      await queue.claim('reviewer@example.com')

      const pending = await queue.pendingCount()

      expect(pending).toBe(1)
    })
  })
})

// ============================================================================
// 5. NotificationDispatcher Tests
// ============================================================================

describe('NotificationDispatcher', () => {
  let dispatcher: NotificationDispatcher

  beforeEach(() => {
    dispatcher = new NotificationDispatcher()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('dispatcher.notify()', () => {
    it('sends notification to user via channel', async () => {
      const result = await dispatcher.notify('user@example.com', 'email', {
        subject: 'Approval Required',
        body: 'Please review the expense report',
      })

      expect(result.delivered).toBe(true)
      expect(result.channel).toBe('email')
      expect(result.recipient).toBe('user@example.com')
      expect(result.sentAt).toBeInstanceOf(Date)
    })

    it('supports email channel', async () => {
      const result = await dispatcher.notify('user@example.com', 'email', {
        subject: 'Test Subject',
        body: 'Test Body',
      })

      expect(result.delivered).toBe(true)
      expect(result.channel).toBe('email')
    })

    it('supports slack channel', async () => {
      const result = await dispatcher.notify('U12345678', 'slack', {
        text: 'Approval needed for expense report',
        blocks: [],
      })

      expect(result.delivered).toBe(true)
      expect(result.channel).toBe('slack')
    })

    it('supports sms channel', async () => {
      const result = await dispatcher.notify('+1234567890', 'sms', {
        body: 'Urgent: Approval needed',
      })

      expect(result.delivered).toBe(true)
      expect(result.channel).toBe('sms')
    })

    it('supports push notification channel', async () => {
      const result = await dispatcher.notify('device-token-123', 'push', {
        title: 'Approval Required',
        body: 'New expense report awaiting review',
        data: { requestId: 'req-123' },
      })

      expect(result.delivered).toBe(true)
      expect(result.channel).toBe('push')
    })

    it('throws for unsupported channel', async () => {
      await expect(
        dispatcher.notify('user@example.com', 'carrier-pigeon' as NotificationChannel, {})
      ).rejects.toThrow('Unsupported notification channel')
    })
  })

  describe('Delivery tracking', () => {
    it('tracks delivery status', async () => {
      const result = await dispatcher.notify('user@example.com', 'email', {
        subject: 'Test',
        body: 'Test',
      })

      const status = await dispatcher.getDeliveryStatus(result.id)

      expect(status.delivered).toBe(true)
      expect(status.deliveredAt).toBeInstanceOf(Date)
    })

    it('tracks failed deliveries', async () => {
      // Configure mock to fail
      dispatcher.configure({
        email: {
          simulateFailure: true,
        },
      })

      const result = await dispatcher.notify('user@example.com', 'email', {
        subject: 'Test',
        body: 'Test',
      })

      expect(result.delivered).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('returns delivery history', async () => {
      await dispatcher.notify('user@example.com', 'email', { subject: 'Test 1', body: 'Body 1' })
      await dispatcher.notify('user@example.com', 'email', { subject: 'Test 2', body: 'Body 2' })
      await dispatcher.notify('user@example.com', 'slack', { text: 'Test 3' })

      const history = await dispatcher.getDeliveryHistory('user@example.com')

      expect(history).toHaveLength(3)
    })

    it('filters history by channel', async () => {
      await dispatcher.notify('user@example.com', 'email', { subject: 'Test', body: 'Body' })
      await dispatcher.notify('user@example.com', 'slack', { text: 'Test' })

      const emailHistory = await dispatcher.getDeliveryHistory('user@example.com', {
        channel: 'email',
      })

      expect(emailHistory).toHaveLength(1)
      expect(emailHistory[0].channel).toBe('email')
    })
  })

  describe('Retry on failure', () => {
    it('retries failed deliveries', async () => {
      let attempts = 0
      dispatcher.configure({
        email: {
          beforeSend: () => {
            attempts++
            if (attempts < 3) {
              throw new Error('Temporary failure')
            }
          },
        },
        retryPolicy: {
          maxRetries: 3,
          backoff: 'exponential',
        },
      })

      const result = await dispatcher.notify('user@example.com', 'email', {
        subject: 'Test',
        body: 'Test',
      })

      expect(result.delivered).toBe(true)
      expect(result.attempts).toBe(3)
    })

    it('gives up after max retries', async () => {
      dispatcher.configure({
        email: {
          simulateFailure: true,
        },
        retryPolicy: {
          maxRetries: 3,
        },
      })

      const result = await dispatcher.notify('user@example.com', 'email', {
        subject: 'Test',
        body: 'Test',
      })

      expect(result.delivered).toBe(false)
      expect(result.attempts).toBe(4) // Initial + 3 retries
      expect(result.error).toContain('Max retries exceeded')
    })

    it('uses exponential backoff between retries', async () => {
      vi.useFakeTimers()
      const retryTimes: number[] = []

      dispatcher.configure({
        email: {
          beforeSend: () => {
            retryTimes.push(Date.now())
            throw new Error('Failure')
          },
        },
        retryPolicy: {
          maxRetries: 3,
          backoff: 'exponential',
          initialDelay: 100,
        },
      })

      const promise = dispatcher.notify('user@example.com', 'email', {
        subject: 'Test',
        body: 'Test',
      })

      // Advance through retries
      await vi.advanceTimersByTimeAsync(100) // First retry
      await vi.advanceTimersByTimeAsync(200) // Second retry (2x)
      await vi.advanceTimersByTimeAsync(400) // Third retry (4x)

      await promise

      // Verify exponential delays (approximately)
      expect(retryTimes.length).toBe(4)
    })

    it('respects per-channel retry configuration', async () => {
      dispatcher.configure({
        sms: {
          retryPolicy: {
            maxRetries: 5, // SMS gets more retries
          },
          simulateFailure: true,
        },
        email: {
          retryPolicy: {
            maxRetries: 2,
          },
          simulateFailure: true,
        },
      })

      const smsResult = await dispatcher.notify('+1234567890', 'sms', { body: 'Test' })
      const emailResult = await dispatcher.notify('user@example.com', 'email', { subject: 'Test', body: 'Test' })

      expect(smsResult.attempts).toBe(6) // Initial + 5 retries
      expect(emailResult.attempts).toBe(3) // Initial + 2 retries
    })
  })

  describe('Multi-channel notification', () => {
    it('sends to multiple channels simultaneously', async () => {
      const results = await dispatcher.notifyMultiple('user@example.com', ['email', 'slack'], {
        email: { subject: 'Test', body: 'Email body' },
        slack: { text: 'Slack message' },
      })

      expect(results).toHaveLength(2)
      expect(results.every(r => r.delivered)).toBe(true)
    })

    it('reports partial failures', async () => {
      dispatcher.configure({
        slack: {
          simulateFailure: true,
        },
      })

      const results = await dispatcher.notifyMultiple('user@example.com', ['email', 'slack'], {
        email: { subject: 'Test', body: 'Email body' },
        slack: { text: 'Slack message' },
      })

      expect(results.find(r => r.channel === 'email')?.delivered).toBe(true)
      expect(results.find(r => r.channel === 'slack')?.delivered).toBe(false)
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

// ============================================================================
// 6. Input Validation Tests (do-374)
// ============================================================================

describe('Input Validation', () => {
  describe('ApprovalRequest validation', () => {
    let workflow: ApprovalWorkflow

    beforeEach(() => {
      workflow = new ApprovalWorkflow()
    })

    it('rejects request with empty id', async () => {
      const action = createTestAction({ id: '' })
      const approvers = createApprovers()

      await expect(workflow.request(action, approvers)).rejects.toThrow(
        'ApprovalRequest id is required'
      )
    })

    it('rejects request with empty type', async () => {
      const action = createTestAction({ type: '' })
      const approvers = createApprovers()

      await expect(workflow.request(action, approvers)).rejects.toThrow(
        'ApprovalRequest type is required'
      )
    })

    it('rejects request with empty title', async () => {
      const action = createTestAction({ title: '' })
      const approvers = createApprovers()

      await expect(workflow.request(action, approvers)).rejects.toThrow(
        'ApprovalRequest title is required'
      )
    })

    it('rejects request with empty description', async () => {
      const action = createTestAction({ description: '' })
      const approvers = createApprovers()

      await expect(workflow.request(action, approvers)).rejects.toThrow(
        'ApprovalRequest description is required'
      )
    })

    it('rejects request with empty requestedBy', async () => {
      const action = createTestAction({ requestedBy: '' })
      const approvers = createApprovers()

      await expect(workflow.request(action, approvers)).rejects.toThrow(
        'ApprovalRequest requestedBy is required'
      )
    })

    it('rejects request with invalid requestedAt', async () => {
      const action = createTestAction({ requestedAt: new Date('invalid') })
      const approvers = createApprovers()

      await expect(workflow.request(action, approvers)).rejects.toThrow(
        'ApprovalRequest requestedAt must be a valid date'
      )
    })

    it('rejects request with negative amount', async () => {
      const action = createTestAction({ amount: -100 })
      const approvers = createApprovers()

      await expect(workflow.request(action, approvers)).rejects.toThrow(
        'ApprovalRequest amount must be a non-negative number'
      )
    })

    it('rejects request with empty approvers list', async () => {
      const action = createTestAction()

      await expect(workflow.request(action, [])).rejects.toThrow(
        'At least one approver is required'
      )
    })

    it('rejects request with whitespace-only id', async () => {
      const action = createTestAction({ id: '   ' })
      const approvers = createApprovers()

      await expect(workflow.request(action, approvers)).rejects.toThrow(
        'ApprovalRequest id is required'
      )
    })

    it('accepts valid request with all fields', async () => {
      const action = createTestAction()
      const approvers = createApprovers()

      const result = await workflow.request(action, approvers)

      expect(result.id).toBeDefined()
      expect(result.status).toBe('pending')
    })

    it('accepts request with zero amount', async () => {
      const action = createTestAction({ amount: 0 })
      const approvers = createApprovers()

      const result = await workflow.request(action, approvers)

      expect(result.action.amount).toBe(0)
    })

    it('accepts request without optional amount', async () => {
      const action = createTestAction()
      delete action.amount
      const approvers = createApprovers()

      const result = await workflow.request(action, approvers)

      expect(result.action.amount).toBeUndefined()
    })
  })

  describe('SLA timeout validation', () => {
    let sla: SLATracker

    beforeEach(() => {
      sla = new SLATracker()
    })

    it('rejects negative timeout duration', () => {
      expect(() => sla.track('req-1', '-1 hour')).toThrow(
        'Invalid duration format'
      )
    })

    it('rejects zero timeout', () => {
      const zeroDeadline = new Date(Date.now())
      expect(() => sla.track('req-1', zeroDeadline)).toThrow(
        'SLA deadline must be in the future'
      )
    })

    it('rejects past deadline', () => {
      const pastDeadline = new Date(Date.now() - 60000)
      expect(() => sla.track('req-1', pastDeadline)).toThrow(
        'SLA deadline must be in the future'
      )
    })

    it('rejects deadline too far in future (> 1 year)', () => {
      const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000) // 400 days
      expect(() => sla.track('req-1', farFuture)).toThrow(
        'SLA deadline cannot be more than 1 year in the future'
      )
    })

    it('rejects empty request ID', () => {
      const deadline = new Date(Date.now() + 60000)
      expect(() => sla.track('', deadline)).toThrow(
        'Request ID is required'
      )
    })

    it('rejects whitespace-only request ID', () => {
      const deadline = new Date(Date.now() + 60000)
      expect(() => sla.track('   ', deadline)).toThrow(
        'Request ID is required'
      )
    })

    it('accepts valid deadline in near future', () => {
      const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours
      const tracking = sla.track('req-1', deadline)

      expect(tracking.requestId).toBe('req-1')
      expect(tracking.deadline).toEqual(deadline)
    })

    it('accepts valid duration string', () => {
      const tracking = sla.track('req-1', '4 hours')

      expect(tracking.requestId).toBe('req-1')
      expect(tracking.deadline.getTime()).toBeGreaterThan(Date.now())
    })

    it('accepts deadline at maximum allowed (1 year)', () => {
      const maxDeadline = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // exactly 1 year
      const tracking = sla.track('req-1', maxDeadline)

      expect(tracking.requestId).toBe('req-1')
    })
  })

  describe('EscalationPolicy validation', () => {
    let policy: EscalationPolicy

    beforeEach(() => {
      policy = new EscalationPolicy()
    })

    it('rejects empty request ID in track()', async () => {
      const config = policy.escalateAfter('1 hour').escalateTo('director')

      await expect(policy.track('', config)).rejects.toThrow(
        'Request ID is required'
      )
    })

    it('rejects whitespace-only request ID in track()', async () => {
      const config = policy.escalateAfter('1 hour').escalateTo('director')

      await expect(policy.track('   ', config)).rejects.toThrow(
        'Request ID is required'
      )
    })
  })
})

// ============================================================================
// 7. Timer Cleanup Tests (do-374)
// ============================================================================

describe('Timer Cleanup', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('SLATracker.dispose()', () => {
    it('clears all timers on dispose', async () => {
      vi.useFakeTimers()
      const onWarning = vi.fn()
      const onBreach = vi.fn()

      const sla = new SLATracker()
      sla.configure({
        warningThreshold: 0.75,
        onWarning,
        onBreach,
      })

      sla.track('req-1', '4 hours')
      sla.track('req-2', '2 hours')

      // Dispose before any timer fires
      sla.dispose()

      // Advance time past all thresholds
      vi.advanceTimersByTime(5 * 60 * 60 * 1000) // 5 hours

      // No callbacks should have been called
      expect(onWarning).not.toHaveBeenCalled()
      expect(onBreach).not.toHaveBeenCalled()
    })

    it('clears timers for specific request on stop()', async () => {
      vi.useFakeTimers()
      const onWarning = vi.fn()

      const sla = new SLATracker()
      sla.configure({
        warningThreshold: 0.75,
        onWarning,
      })

      sla.track('req-1', '4 hours')
      sla.track('req-2', '4 hours')

      // Stop tracking req-1 only
      sla.stop('req-1')

      // Advance time to warning threshold
      vi.advanceTimersByTime(3 * 60 * 60 * 1000) // 3 hours (75%)

      // Only req-2 should trigger warning
      expect(onWarning).toHaveBeenCalledTimes(1)
      expect(onWarning).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-2' })
      )
    })
  })

  describe('EscalationPolicy.dispose()', () => {
    it('clears all escalation timers on dispose', async () => {
      vi.useFakeTimers()
      const escalated = vi.fn()

      const policy = new EscalationPolicy()
      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('director')
        .onEscalate(escalated)

      await policy.track('req-1', config)
      await policy.track('req-2', config)

      // Dispose before escalation
      policy.dispose()

      // Advance time past escalation
      vi.advanceTimersByTime(2 * 60 * 60 * 1000) // 2 hours

      expect(escalated).not.toHaveBeenCalled()
    })

    it('clears escalation timers on resolve without side effects', async () => {
      vi.useFakeTimers()
      const escalated = vi.fn()

      const policy = new EscalationPolicy()
      const config = policy
        .escalateAfter('1 hour')
        .escalateTo('director')
        .escalateAfter('2 hours')
        .escalateTo('vp')
        .onEscalate(escalated)

      const tracking = await policy.track('req-1', config)

      // Resolve before any escalation
      await tracking.resolve()

      // Advance time past all escalations
      vi.advanceTimersByTime(4 * 60 * 60 * 1000) // 4 hours

      expect(escalated).not.toHaveBeenCalled()
    })
  })

  describe('Memory leak prevention', () => {
    it('SLATracker removes tracking data on stop()', () => {
      const sla = new SLATracker()
      const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000)

      sla.track('req-1', deadline)
      expect(sla.get('req-1')).toBeDefined()

      sla.stop('req-1')
      expect(sla.get('req-1')).toBeUndefined()
    })

    it('SLATracker removes all tracking data on dispose()', () => {
      const sla = new SLATracker()
      const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000)

      sla.track('req-1', deadline)
      sla.track('req-2', deadline)

      sla.dispose()

      expect(sla.get('req-1')).toBeUndefined()
      expect(sla.get('req-2')).toBeUndefined()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Human-in-the-Loop Integration', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates approval workflow with SLA tracking and notifications', async () => {
    const workflow = new ApprovalWorkflow()
    const sla = new SLATracker()
    const dispatcher = new NotificationDispatcher()

    // Create an approval request
    const action = createTestAction({ amount: 10000 })
    const approvers = createApprovers()

    const request = await workflow.request(action, approvers, {
      deadline: '4 hours',
    })

    // Start SLA tracking
    sla.track(request.id, '4 hours')

    // Send notification to first approver
    await dispatcher.notify('manager@example.com', 'email', {
      subject: 'Approval Required',
      body: `Please review: ${action.title}`,
    })

    // Verify setup
    expect(request.status).toBe('pending')
    expect(sla.check(request.id).breached).toBe(false)
  })

  it('handles escalation when SLA is breached', async () => {
    vi.useFakeTimers()

    const workflow = new ApprovalWorkflow()
    const policy = new EscalationPolicy()
    const dispatcher = new NotificationDispatcher()
    const escalated = vi.fn()

    // Create request
    const action = createTestAction()
    const request = await workflow.request(action, ['manager@example.com'])

    // Set up escalation policy
    const escalationConfig = policy
      .escalateAfter('1 hour')
      .escalateTo('director@example.com')
      .onEscalate(async (event) => {
        escalated(event)
        // Notify director
        await dispatcher.notify('director@example.com', 'email', {
          subject: 'Escalated: Approval Required',
          body: `Request escalated due to SLA breach`,
        })
      })

    await policy.track(request.id, escalationConfig)

    // Advance time past SLA
    vi.advanceTimersByTime(61 * 60 * 1000)

    expect(escalated).toHaveBeenCalled()
  })
})
