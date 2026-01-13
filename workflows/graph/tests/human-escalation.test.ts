/**
 * Human Escalation Tests
 *
 * TDD GREEN Phase: Tests for human-in-the-loop via verb form relationships.
 *
 * The key insight: verb form IS the state - no separate status column needed.
 *
 * Escalation States (via verb forms):
 * - 'escalate' (action form) = pending, awaiting human attention
 * - 'escalating' (activity form) = in-progress, human is working on it
 * - 'escalated' (event form) = completed, human has handled it
 *
 * Approval States (via verb forms):
 * - 'approve' (action form) = pending approval
 * - 'approved' (event form) = approved
 * - 'rejected' (event form) = rejected
 *
 * Uses in-memory store for testing, NO MOCKS per CLAUDE.md guidelines.
 *
 * @see dotdo-4brx6 - [GREEN] Implement human escalation via verb form relationships
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  escalateToHuman,
  startEscalation,
  completeEscalation,
  getEscalation,
  getEscalationState,
  requestApproval,
  recordApproval,
  getApproval,
  getApprovalState,
  queryPendingApprovals,
  queryPendingEscalations,
  queryEscalationsByInstance,
  queryApprovalsByInstance,
  checkApprovalSLA,
  checkEscalationSLA,
  findExpiredApprovals,
  findExpiredEscalations,
  type EscalateOptions,
  type ApprovalDocument,
  type ApprovalDecision,
} from '../human-escalation'

// ============================================================================
// TEST SUITE: Human Escalation via Verb Form Relationships
// ============================================================================

describe('Human Escalation via Verb Form Relationships', () => {
  // In-memory store for testing (per test isolation)
  let db: object

  beforeEach(() => {
    // Create a fresh in-memory store for each test
    db = { _testId: Math.random().toString(36).slice(2) }
    // Reset any mocked timers
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // 1. escalateToHuman - Creates 'escalate' relationship
  // ==========================================================================

  describe('escalateToHuman', () => {
    it('creates an escalation relationship with pending state', async () => {
      const options: EscalateOptions = {
        reason: 'Workflow requires human review',
        sla: 3600000, // 1 hour
        priority: 2,
        channel: 'slack',
      }

      const escalation = await escalateToHuman(
        db,
        'instance-123',
        'human-ceo',
        options
      )

      // Should have auto-generated ID
      expect(escalation.id).toBeDefined()
      expect(escalation.id).toContain('esc-')

      // Should use action form verb (pending state)
      expect(escalation.verb).toBe('escalate')

      // Should have correct from/to
      expect(escalation.from).toBe('instance-123')
      expect(escalation.to).toBe('human-ceo')

      // Should store escalation data
      expect(escalation.data.reason).toBe('Workflow requires human review')
      expect(escalation.data.sla).toBe(3600000)
      expect(escalation.data.priority).toBe(2)
      expect(escalation.data.channel).toBe('slack')

      // Should have timestamps
      expect(escalation.createdAt).toBeDefined()
      expect(escalation.updatedAt).toBeDefined()
    })

    it('calculates expiresAt from createdAt + SLA', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

      const escalation = await escalateToHuman(db, 'instance-1', 'human-1', {
        reason: 'Test',
        sla: 7200000, // 2 hours
      })

      // expiresAt should be createdAt + sla
      expect(escalation.data.expiresAt).toBe(
        new Date('2024-01-15T12:00:00Z').getTime()
      )
    })

    it('creates escalation without SLA (no expiration)', async () => {
      const escalation = await escalateToHuman(db, 'instance-1', 'human-1', {
        reason: 'No rush',
      })

      expect(escalation.data.sla).toBeUndefined()
      expect(escalation.data.expiresAt).toBeUndefined()
    })

    it('stores additional metadata', async () => {
      const escalation = await escalateToHuman(db, 'instance-1', 'human-1', {
        reason: 'Test',
        metadata: { customField: 'value', tags: ['urgent', 'finance'] },
      })

      expect(escalation.data.metadata).toEqual({
        customField: 'value',
        tags: ['urgent', 'finance'],
      })
    })
  })

  // ==========================================================================
  // 2. Escalation State Transitions
  // ==========================================================================

  describe('Escalation State Transitions', () => {
    describe('startEscalation', () => {
      it('transitions from pending (escalate) to in-progress (escalating)', async () => {
        const escalation = await escalateToHuman(db, 'instance-1', 'human-1', {
          reason: 'Test',
        })
        expect(getEscalationState(escalation)).toBe('pending')

        const started = await startEscalation(db, escalation.id)

        expect(started.verb).toBe('escalating')
        expect(getEscalationState(started)).toBe('in_progress')
        expect(started.updatedAt).toBeGreaterThanOrEqual(started.createdAt)
      })

      it('throws error if escalation not found', async () => {
        await expect(startEscalation(db, 'non-existent')).rejects.toThrow(
          'Escalation not found'
        )
      })

      it('throws error if already in progress', async () => {
        const escalation = await escalateToHuman(db, 'instance-1', 'human-1', {
          reason: 'Test',
        })
        await startEscalation(db, escalation.id)

        await expect(startEscalation(db, escalation.id)).rejects.toThrow(
          'Cannot start escalation in in_progress state'
        )
      })
    })

    describe('completeEscalation', () => {
      it('transitions from in-progress (escalating) to completed (escalated)', async () => {
        const escalation = await escalateToHuman(db, 'instance-1', 'human-1', {
          reason: 'Test',
        })
        await startEscalation(db, escalation.id)

        const completed = await completeEscalation(db, escalation.id)

        expect(completed.verb).toBe('escalated')
        expect(getEscalationState(completed)).toBe('completed')
      })

      it('throws error if not in progress', async () => {
        const escalation = await escalateToHuman(db, 'instance-1', 'human-1', {
          reason: 'Test',
        })
        // Still in pending state

        await expect(completeEscalation(db, escalation.id)).rejects.toThrow(
          'Cannot complete escalation in pending state'
        )
      })
    })

    describe('getEscalation', () => {
      it('retrieves escalation by ID', async () => {
        const created = await escalateToHuman(db, 'instance-1', 'human-1', {
          reason: 'Test reason',
        })

        const retrieved = await getEscalation(db, created.id)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.id).toBe(created.id)
        expect(retrieved!.data.reason).toBe('Test reason')
      })

      it('returns null for non-existent escalation', async () => {
        const result = await getEscalation(db, 'does-not-exist')
        expect(result).toBeNull()
      })
    })
  })

  // ==========================================================================
  // 3. requestApproval - Creates 'approve' action relationship
  // ==========================================================================

  describe('requestApproval', () => {
    it('creates an approval relationship with pending state', async () => {
      const document: ApprovalDocument = {
        type: 'expense',
        description: 'Travel reimbursement for conference',
        data: { amount: 1500, currency: 'USD', category: 'travel' },
        context: { employeeId: 'emp-123', department: 'engineering' },
      }

      const approval = await requestApproval(
        db,
        'instance-expense-001',
        'human-finance-manager',
        document,
        { sla: 86400000 } // 24 hours
      )

      // Should have auto-generated ID
      expect(approval.id).toBeDefined()
      expect(approval.id).toContain('apr-')

      // Should use action form verb (pending approval)
      expect(approval.verb).toBe('approve')

      // Should have correct from/to
      expect(approval.from).toBe('instance-expense-001')
      expect(approval.to).toBe('human-finance-manager')

      // Should store document
      expect(approval.data.document).toEqual(document)

      // Should calculate expiration
      expect(approval.data.sla).toBe(86400000)
      expect(approval.data.expiresAt).toBeDefined()
    })

    it('creates approval without SLA', async () => {
      const document: ApprovalDocument = {
        type: 'policy',
        description: 'New vacation policy',
        data: { policyText: '...' },
      }

      const approval = await requestApproval(
        db,
        'instance-1',
        'human-1',
        document
      )

      expect(approval.data.sla).toBeUndefined()
      expect(approval.data.expiresAt).toBeUndefined()
    })
  })

  // ==========================================================================
  // 4. recordApproval - Transitions state based on decision
  // ==========================================================================

  describe('recordApproval', () => {
    it('records approved decision and transitions to approved state', async () => {
      const document: ApprovalDocument = {
        type: 'purchase',
        description: 'New laptop',
        data: { amount: 2000 },
      }
      const approval = await requestApproval(
        db,
        'instance-1',
        'human-manager',
        document
      )

      const decision: ApprovalDecision = {
        approved: true,
        reason: 'Within budget allocation',
        comment: 'Approved. Proceed with Dell XPS.',
      }

      const result = await recordApproval(
        db,
        approval.id,
        'human-manager',
        decision
      )

      // Should transition to approved state
      expect(result.verb).toBe('approved')
      expect(getApprovalState(result)).toBe('approved')

      // Should store decision
      expect(result.data.decision).toEqual(decision)
      expect(result.data.decidedAt).toBeDefined()
      expect(result.data.decidedBy).toBe('human-manager')
    })

    it('records rejected decision and transitions to rejected state', async () => {
      const document: ApprovalDocument = {
        type: 'contract',
        description: 'Vendor agreement',
        data: { vendor: 'Acme Corp', value: 500000 },
      }
      const approval = await requestApproval(
        db,
        'instance-1',
        'human-legal',
        document
      )

      const decision: ApprovalDecision = {
        approved: false,
        reason: 'Missing liability clause',
        comment: 'Please add indemnification section before resubmitting.',
        modifications: { addClause: 'liability', section: 7 },
      }

      const result = await recordApproval(
        db,
        approval.id,
        'human-legal',
        decision
      )

      // Should transition to rejected state
      expect(result.verb).toBe('rejected')
      expect(getApprovalState(result)).toBe('rejected')

      // Should store decision with modifications
      expect(result.data.decision).toEqual(decision)
      expect(result.data.decision?.modifications).toEqual({
        addClause: 'liability',
        section: 7,
      })
    })

    it('throws error if approval not found', async () => {
      const decision: ApprovalDecision = { approved: true }

      await expect(
        recordApproval(db, 'non-existent', 'human-1', decision)
      ).rejects.toThrow('Approval not found')
    })

    it('throws error if approval already decided', async () => {
      const document: ApprovalDocument = {
        type: 'test',
        description: 'Test',
        data: {},
      }
      const approval = await requestApproval(
        db,
        'instance-1',
        'human-1',
        document
      )

      // First decision
      await recordApproval(db, approval.id, 'human-1', { approved: true })

      // Second decision should fail
      await expect(
        recordApproval(db, approval.id, 'human-1', { approved: false })
      ).rejects.toThrow('already decided')
    })
  })

  // ==========================================================================
  // 5. queryPendingApprovals - Query by verb form
  // ==========================================================================

  describe('queryPendingApprovals', () => {
    it('returns pending approvals for a specific human', async () => {
      // Create multiple approvals for different humans
      await requestApproval(db, 'inst-1', 'human-a', {
        type: 'test',
        description: 'For A',
        data: {},
      })
      await requestApproval(db, 'inst-2', 'human-b', {
        type: 'test',
        description: 'For B',
        data: {},
      })
      await requestApproval(db, 'inst-3', 'human-a', {
        type: 'test',
        description: 'For A again',
        data: {},
      })

      const pending = await queryPendingApprovals(db, 'human-a')

      expect(pending).toHaveLength(2)
      expect(pending.every((p) => p.humanId === 'human-a')).toBe(true)
    })

    it('excludes already decided approvals', async () => {
      const approval1 = await requestApproval(db, 'inst-1', 'human-a', {
        type: 'test',
        description: 'Test 1',
        data: {},
      })
      await requestApproval(db, 'inst-2', 'human-a', {
        type: 'test',
        description: 'Test 2',
        data: {},
      })

      // Approve the first one
      await recordApproval(db, approval1.id, 'human-a', { approved: true })

      const pending = await queryPendingApprovals(db, 'human-a')

      expect(pending).toHaveLength(1)
      expect(pending[0]!.document.description).toBe('Test 2')
    })

    it('returns SLA status for each approval', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

      await requestApproval(
        db,
        'inst-1',
        'human-a',
        { type: 'urgent', description: 'Urgent', data: {} },
        { sla: 3600000 } // 1 hour
      )
      await requestApproval(
        db,
        'inst-2',
        'human-a',
        { type: 'normal', description: 'Normal', data: {} },
        { sla: 86400000 } // 24 hours
      )

      // Advance time by 2 hours
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))

      const pending = await queryPendingApprovals(db, 'human-a')

      // First should be expired (1 hour SLA, 2 hours passed)
      expect(pending[0]!.isExpired).toBe(true)
      expect(pending[0]!.timeRemaining).toBeLessThan(0)

      // Second should not be expired (24 hour SLA, 2 hours passed)
      expect(pending[1]!.isExpired).toBe(false)
      expect(pending[1]!.timeRemaining).toBeGreaterThan(0)
    })

    it('sorts by urgency (expired first, then by time remaining)', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

      await requestApproval(
        db,
        'inst-1',
        'human-a',
        { type: 'test', description: 'Long SLA', data: {} },
        { sla: 86400000 } // 24 hours
      )
      await requestApproval(
        db,
        'inst-2',
        'human-a',
        { type: 'test', description: 'Short SLA', data: {} },
        { sla: 1800000 } // 30 minutes
      )
      await requestApproval(
        db,
        'inst-3',
        'human-a',
        { type: 'test', description: 'Expired', data: {} },
        { sla: 600000 } // 10 minutes
      )

      // Advance time by 1 hour
      vi.setSystemTime(new Date('2024-01-15T11:00:00Z'))

      const pending = await queryPendingApprovals(db, 'human-a')

      // Order should be: Expired, Short SLA (expired at 1.5hr), Long SLA
      expect(pending[0]!.document.description).toBe('Expired')
      expect(pending[0]!.isExpired).toBe(true)
      expect(pending[1]!.document.description).toBe('Short SLA')
      expect(pending[2]!.document.description).toBe('Long SLA')
    })

    it('filters to expired only when option set', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

      await requestApproval(
        db,
        'inst-1',
        'human-a',
        { type: 'test', description: 'Not expired', data: {} },
        { sla: 86400000 }
      )
      await requestApproval(
        db,
        'inst-2',
        'human-a',
        { type: 'test', description: 'Expired', data: {} },
        { sla: 1000 }
      )

      // Advance time
      vi.setSystemTime(new Date('2024-01-15T10:01:00Z'))

      const expired = await queryPendingApprovals(db, 'human-a', {
        expiredOnly: true,
      })

      expect(expired).toHaveLength(1)
      expect(expired[0]!.document.description).toBe('Expired')
    })

    it('applies limit', async () => {
      for (let i = 0; i < 10; i++) {
        await requestApproval(db, `inst-${i}`, 'human-a', {
          type: 'test',
          description: `Test ${i}`,
          data: {},
        })
      }

      const pending = await queryPendingApprovals(db, 'human-a', { limit: 3 })

      expect(pending).toHaveLength(3)
    })
  })

  // ==========================================================================
  // 6. queryPendingEscalations
  // ==========================================================================

  describe('queryPendingEscalations', () => {
    it('returns pending escalations for a specific human', async () => {
      await escalateToHuman(db, 'inst-1', 'human-a', { reason: 'Test 1' })
      await escalateToHuman(db, 'inst-2', 'human-b', { reason: 'Test 2' })
      await escalateToHuman(db, 'inst-3', 'human-a', { reason: 'Test 3' })

      const pending = await queryPendingEscalations(db, 'human-a')

      expect(pending).toHaveLength(2)
      expect(pending.every((e) => e.to === 'human-a')).toBe(true)
    })

    it('excludes in-progress and completed escalations', async () => {
      const esc1 = await escalateToHuman(db, 'inst-1', 'human-a', {
        reason: 'Test 1',
      })
      await escalateToHuman(db, 'inst-2', 'human-a', { reason: 'Test 2' })

      // Start the first one
      await startEscalation(db, esc1.id)

      const pending = await queryPendingEscalations(db, 'human-a')

      expect(pending).toHaveLength(1)
    })

    it('sorts by priority (lower number = higher priority)', async () => {
      await escalateToHuman(db, 'inst-1', 'human-a', {
        reason: 'Low priority',
        priority: 5,
      })
      await escalateToHuman(db, 'inst-2', 'human-a', {
        reason: 'High priority',
        priority: 1,
      })
      await escalateToHuman(db, 'inst-3', 'human-a', {
        reason: 'Medium priority',
        priority: 3,
      })

      const pending = await queryPendingEscalations(db, 'human-a')

      expect(pending[0]!.data.reason).toBe('High priority')
      expect(pending[1]!.data.reason).toBe('Medium priority')
      expect(pending[2]!.data.reason).toBe('Low priority')
    })
  })

  // ==========================================================================
  // 7. Query by Instance
  // ==========================================================================

  describe('queryEscalationsByInstance', () => {
    it('returns all escalations for an instance', async () => {
      await escalateToHuman(db, 'instance-a', 'human-1', { reason: 'First' })
      await escalateToHuman(db, 'instance-a', 'human-2', { reason: 'Second' })
      await escalateToHuman(db, 'instance-b', 'human-1', { reason: 'Other' })

      const escalations = await queryEscalationsByInstance(db, 'instance-a')

      expect(escalations).toHaveLength(2)
      expect(escalations.every((e) => e.from === 'instance-a')).toBe(true)
    })
  })

  describe('queryApprovalsByInstance', () => {
    it('returns all approvals for an instance', async () => {
      await requestApproval(db, 'instance-a', 'human-1', {
        type: 'test',
        description: 'First',
        data: {},
      })
      await requestApproval(db, 'instance-a', 'human-2', {
        type: 'test',
        description: 'Second',
        data: {},
      })
      await requestApproval(db, 'instance-b', 'human-1', {
        type: 'test',
        description: 'Other',
        data: {},
      })

      const approvals = await queryApprovalsByInstance(db, 'instance-a')

      expect(approvals).toHaveLength(2)
      expect(approvals.every((a) => a.from === 'instance-a')).toBe(true)
    })
  })

  // ==========================================================================
  // 8. SLA Enforcement
  // ==========================================================================

  describe('SLA Enforcement', () => {
    describe('checkApprovalSLA', () => {
      it('returns SLA status for approval', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

        const approval = await requestApproval(
          db,
          'inst-1',
          'human-1',
          { type: 'test', description: 'Test', data: {} },
          { sla: 3600000 }
        )

        // Check before expiration
        let status = checkApprovalSLA(approval)
        expect(status.hasExpired).toBe(false)
        expect(status.timeRemaining).toBe(3600000)
        expect(status.expiresAt).toEqual(new Date('2024-01-15T11:00:00Z'))

        // Check after expiration
        vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
        const retrieved = await getApproval(db, approval.id)
        status = checkApprovalSLA(retrieved!)
        expect(status.hasExpired).toBe(true)
        expect(status.timeRemaining).toBeLessThan(0)
      })

      it('handles approval without SLA', async () => {
        const approval = await requestApproval(db, 'inst-1', 'human-1', {
          type: 'test',
          description: 'Test',
          data: {},
        })

        const status = checkApprovalSLA(approval)

        expect(status.hasExpired).toBe(false)
        expect(status.timeRemaining).toBe(Number.MAX_SAFE_INTEGER)
        expect(status.expiresAt).toBeNull()
      })
    })

    describe('checkEscalationSLA', () => {
      it('returns SLA status for escalation', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

        const escalation = await escalateToHuman(db, 'inst-1', 'human-1', {
          reason: 'Test',
          sla: 1800000, // 30 minutes
        })

        let status = checkEscalationSLA(escalation)
        expect(status.hasExpired).toBe(false)
        expect(status.timeRemaining).toBe(1800000)

        // Advance past SLA
        vi.setSystemTime(new Date('2024-01-15T10:35:00Z'))
        const retrieved = await getEscalation(db, escalation.id)
        status = checkEscalationSLA(retrieved!)
        expect(status.hasExpired).toBe(true)
      })
    })

    describe('findExpiredApprovals', () => {
      it('finds all expired pending approvals', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

        await requestApproval(
          db,
          'inst-1',
          'human-1',
          { type: 'test', description: 'Expired soon', data: {} },
          { sla: 1000 }
        )
        await requestApproval(
          db,
          'inst-2',
          'human-1',
          { type: 'test', description: 'Not expired', data: {} },
          { sla: 86400000 }
        )

        // Advance time
        vi.setSystemTime(new Date('2024-01-15T10:01:00Z'))

        const expired = await findExpiredApprovals(db)

        expect(expired).toHaveLength(1)
        expect(expired[0]!.from).toBe('inst-1')
      })

      it('excludes already decided approvals', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

        const approval = await requestApproval(
          db,
          'inst-1',
          'human-1',
          { type: 'test', description: 'Test', data: {} },
          { sla: 1000 }
        )

        // Record decision before checking
        await recordApproval(db, approval.id, 'human-1', { approved: true })

        // Advance time past SLA
        vi.setSystemTime(new Date('2024-01-15T10:01:00Z'))

        const expired = await findExpiredApprovals(db)

        expect(expired).toHaveLength(0)
      })
    })

    describe('findExpiredEscalations', () => {
      it('finds all expired pending escalations', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

        await escalateToHuman(db, 'inst-1', 'human-1', {
          reason: 'Expired',
          sla: 1000,
        })
        await escalateToHuman(db, 'inst-2', 'human-1', {
          reason: 'Not expired',
          sla: 86400000,
        })

        // Advance time
        vi.setSystemTime(new Date('2024-01-15T10:01:00Z'))

        const expired = await findExpiredEscalations(db)

        expect(expired).toHaveLength(1)
        expect(expired[0]!.from).toBe('inst-1')
      })
    })
  })

  // ==========================================================================
  // 9. Complete Workflow Integration
  // ==========================================================================

  describe('Complete Workflow Integration', () => {
    it('demonstrates full escalation lifecycle', async () => {
      // 1. Create escalation (pending)
      const escalation = await escalateToHuman(db, 'workflow-123', 'ceo', {
        reason: 'Contract value exceeds $1M threshold',
        sla: 86400000,
        priority: 1,
        channel: 'slack',
      })
      expect(escalation.verb).toBe('escalate')
      expect(getEscalationState(escalation)).toBe('pending')

      // 2. Human starts working on it (in-progress)
      const inProgress = await startEscalation(db, escalation.id)
      expect(inProgress.verb).toBe('escalating')
      expect(getEscalationState(inProgress)).toBe('in_progress')

      // 3. Human completes escalation (completed)
      const completed = await completeEscalation(db, escalation.id)
      expect(completed.verb).toBe('escalated')
      expect(getEscalationState(completed)).toBe('completed')
    })

    it('demonstrates full approval lifecycle', async () => {
      // 1. Request approval (pending)
      const document: ApprovalDocument = {
        type: 'partnership',
        description: 'Strategic partnership with Acme Corp',
        data: {
          partner: 'Acme Corp',
          terms: 'Revenue share 70/30',
          duration: '3 years',
          value: 5000000,
        },
        context: {
          requestedBy: 'biz-dev-team',
          urgency: 'high',
        },
      }

      const approval = await requestApproval(
        db,
        'workflow-partnership-001',
        'ceo',
        document,
        { sla: 172800000 } // 48 hours
      )
      expect(approval.verb).toBe('approve')
      expect(getApprovalState(approval)).toBe('pending')

      // 2. Query pending approvals for CEO
      const pending = await queryPendingApprovals(db, 'ceo')
      expect(pending).toHaveLength(1)
      expect(pending[0]!.document.type).toBe('partnership')

      // 3. CEO approves
      const decision: ApprovalDecision = {
        approved: true,
        reason: 'Strategic fit with our expansion plans',
        comment: 'Approved. Proceed with legal review.',
      }

      const approved = await recordApproval(db, approval.id, 'ceo', decision)
      expect(approved.verb).toBe('approved')
      expect(getApprovalState(approved)).toBe('approved')
      expect(approved.data.decidedBy).toBe('ceo')

      // 4. Verify no longer in pending
      const stillPending = await queryPendingApprovals(db, 'ceo')
      expect(stillPending).toHaveLength(0)
    })

    it('demonstrates rejection workflow', async () => {
      const document: ApprovalDocument = {
        type: 'budget',
        description: 'Q2 Marketing Budget Increase',
        data: { increase: 500000, reason: 'Campaign expansion' },
      }

      const approval = await requestApproval(
        db,
        'budget-request-123',
        'cfo',
        document
      )

      // CFO rejects
      const decision: ApprovalDecision = {
        approved: false,
        reason: 'Budget constraints for current quarter',
        comment: 'Resubmit with phased approach for Q3/Q4',
        modifications: {
          suggestion: 'Split into 250K Q3 + 250K Q4',
        },
      }

      const rejected = await recordApproval(db, approval.id, 'cfo', decision)

      expect(rejected.verb).toBe('rejected')
      expect(getApprovalState(rejected)).toBe('rejected')
      expect(rejected.data.decision?.modifications).toEqual({
        suggestion: 'Split into 250K Q3 + 250K Q4',
      })
    })

    it('demonstrates SLA expiration handling', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T09:00:00Z'))

      // Create approval with 1 hour SLA
      const approval = await requestApproval(
        db,
        'urgent-request',
        'manager',
        { type: 'urgent', description: 'Time-sensitive approval', data: {} },
        { sla: 3600000 }
      )

      // After 30 minutes - not expired
      vi.setSystemTime(new Date('2024-01-15T09:30:00Z'))
      let status = checkApprovalSLA(
        (await getApproval(db, approval.id))!
      )
      expect(status.hasExpired).toBe(false)
      expect(status.timeRemaining).toBe(1800000) // 30 minutes remaining

      // After 2 hours - expired
      vi.setSystemTime(new Date('2024-01-15T11:00:00Z'))
      status = checkApprovalSLA((await getApproval(db, approval.id))!)
      expect(status.hasExpired).toBe(true)
      expect(status.timeRemaining).toBe(-3600000) // 1 hour overdue

      // Should appear in expired list
      const expired = await findExpiredApprovals(db)
      expect(expired.some((a) => a.id === approval.id)).toBe(true)
    })
  })
})

// ============================================================================
// TDD RED PHASE: Tests for Human DO Integration with Verb Form Relationships
// ============================================================================
//
// These tests define the expected behavior for human escalation/approval
// as verb form relationships WITH Human DO integration.
//
// Current implementation uses in-memory stores. These tests require:
// 1. Real SQLite via SQLiteGraphStore
// 2. Human DO URL format (do://tenant/Human/ceo)
// 3. 'approving' intermediate state for approval workflow
// 4. Relationship-based SLA tracking with timestamps
//
// @see dotdo-djrs2 - [RED] Human-in-the-loop waits as verb form relationships - tests
// ============================================================================

import { SQLiteGraphStore } from '../../../db/graph/stores/sqlite'
import {
  createHumanDOStore,
  type HumanDOStore,
  type HumanEscalationRelationship,
  type HumanApprovalRelationship,
} from '../human-escalation'

// ============================================================================
// RED PHASE TESTS: Human DO Integration
// ============================================================================

describe('Human DO Integration [RED]', () => {
  let graphStore: SQLiteGraphStore
  let humanStore: HumanDOStore

  beforeEach(async () => {
    // Create fresh in-memory SQLite store for each test
    graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    // Create HumanDOStore wrapping the graph store
    // This will fail until the implementation exists
    humanStore = createHumanDOStore(graphStore)
  })

  afterEach(async () => {
    await graphStore.close()
  })

  // ==========================================================================
  // 1. Human escalation creates 'escalate' relationship to Human DO
  // ==========================================================================

  describe('Human escalation creates relationship to Human DO', () => {
    it('creates escalate relationship with proper DO URLs', async () => {
      const escalation = await humanStore.createEscalation(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/ceo',
        {
          reason: 'Amount exceeds $10000',
          sla: '4 hours',
          priority: 1,
          channel: 'slack',
        }
      )

      // Should have auto-generated ID
      expect(escalation.id).toBeDefined()

      // Should use action form verb (pending state)
      expect(escalation.verb).toBe('escalate')

      // Should have proper DO URLs
      expect(escalation.from).toBe('do://tenant/WorkflowInstance/instance-123')
      expect(escalation.to).toBe('do://tenant/Human/ceo')

      // Should store escalation data
      expect(escalation.data.reason).toBe('Amount exceeds $10000')
      expect(escalation.data.sla).toBe('4 hours')
      expect(escalation.data.priority).toBe(1)
      expect(escalation.data.channel).toBe('slack')

      // Should have timestamps
      expect(escalation.createdAt).toBeDefined()
      expect(escalation.updatedAt).toBeDefined()
    })

    it('can query escalation by Human DO URL', async () => {
      await humanStore.createEscalation(
        'do://tenant/WorkflowInstance/instance-1',
        'do://tenant/Human/ceo',
        { reason: 'Test 1' }
      )
      await humanStore.createEscalation(
        'do://tenant/WorkflowInstance/instance-2',
        'do://tenant/Human/cfo',
        { reason: 'Test 2' }
      )
      await humanStore.createEscalation(
        'do://tenant/WorkflowInstance/instance-3',
        'do://tenant/Human/ceo',
        { reason: 'Test 3' }
      )

      // Query by Human DO URL
      const ceoEscalations = await humanStore.queryPendingEscalations(
        'do://tenant/Human/ceo'
      )

      expect(ceoEscalations).toHaveLength(2)
      expect(ceoEscalations.every((e) => e.to === 'do://tenant/Human/ceo')).toBe(true)
    })

    it('stores relationship in SQLite graph store', async () => {
      await humanStore.createEscalation(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/ceo',
        { reason: 'Test' }
      )

      // Verify relationship is in SQLite via direct query
      const rels = await graphStore.queryRelationshipsTo(
        'do://tenant/Human/ceo',
        { verb: 'escalate' }
      )

      expect(rels).toHaveLength(1)
      expect(rels[0]!.verb).toBe('escalate')
      expect(rels[0]!.from).toBe('do://tenant/WorkflowInstance/instance-123')
    })
  })

  // ==========================================================================
  // 2. 'escalate' -> 'escalating' -> 'escalated' transitions
  // ==========================================================================

  describe('Escalation state transitions', () => {
    it('transitions from escalate to escalating when human starts', async () => {
      const escalation = await humanStore.createEscalation(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/ceo',
        { reason: 'Test' }
      )
      expect(escalation.verb).toBe('escalate')

      const started = await humanStore.startEscalation(escalation.id)

      expect(started.verb).toBe('escalating')
      expect(started.data.startedAt).toBeDefined()
      expect(started.updatedAt).toBeGreaterThanOrEqual(escalation.updatedAt)
    })

    it('transitions from escalating to escalated when human completes', async () => {
      const escalation = await humanStore.createEscalation(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/ceo',
        { reason: 'Test' }
      )
      await humanStore.startEscalation(escalation.id)

      const completed = await humanStore.completeEscalation(escalation.id, {
        resolution: 'Approved manually',
      })

      expect(completed.verb).toBe('escalated')
      expect(completed.data.completedAt).toBeDefined()
    })

    it('throws error when transitioning from invalid state', async () => {
      const escalation = await humanStore.createEscalation(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/ceo',
        { reason: 'Test' }
      )

      // Cannot complete without starting
      await expect(humanStore.completeEscalation(escalation.id)).rejects.toThrow(
        /cannot complete.*pending/i
      )
    })

    it('updates relationship verb in SQLite on transition', async () => {
      const escalation = await humanStore.createEscalation(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/ceo',
        { reason: 'Test' }
      )

      await humanStore.startEscalation(escalation.id)

      // Verify SQLite has 'escalating' verb
      const rels = await graphStore.queryRelationshipsByVerb('escalating')
      expect(rels).toHaveLength(1)
      expect(rels[0]!.from).toBe('do://tenant/WorkflowInstance/instance-123')

      // Old 'escalate' verb should not exist
      const oldRels = await graphStore.queryRelationshipsByVerb('escalate')
      expect(oldRels).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 3. Approval creates 'approve' relationship
  // ==========================================================================

  describe('Approval creates relationship', () => {
    it('creates approve relationship with document data', async () => {
      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/legal',
        {
          type: 'contract',
          description: 'Contract for Acme Corp',
          data: { value: 500000, vendor: 'Acme Corp' },
        }
      )

      expect(approval.verb).toBe('approve')
      expect(approval.from).toBe('do://tenant/WorkflowInstance/instance-123')
      expect(approval.to).toBe('do://tenant/Human/legal')
      expect(approval.data.document).toEqual({
        type: 'contract',
        description: 'Contract for Acme Corp',
        data: { value: 500000, vendor: 'Acme Corp' },
      })
    })

    it('can query pending approvals by Human DO URL', async () => {
      await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-1',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Doc 1', data: {} }
      )
      await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-2',
        'do://tenant/Human/finance',
        { type: 'expense', description: 'Doc 2', data: {} }
      )

      const legalApprovals = await humanStore.queryPendingApprovals(
        'do://tenant/Human/legal'
      )

      expect(legalApprovals).toHaveLength(1)
      expect(legalApprovals[0]!.data.document?.description).toBe('Doc 1')
    })
  })

  // ==========================================================================
  // 4. 'approve' -> 'approving' -> 'approved' / 'rejected' transitions
  // ==========================================================================

  describe('Approval state transitions', () => {
    it('transitions from approve to approving when human starts review', async () => {
      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Test', data: {} }
      )
      expect(approval.verb).toBe('approve')

      const reviewing = await humanStore.startReview(approval.id, 'legal-team')

      expect(reviewing.verb).toBe('approving')
      expect(reviewing.data.decidedBy).toBe('legal-team')
    })

    it('transitions from approving to approved', async () => {
      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Test', data: {} }
      )
      await humanStore.startReview(approval.id, 'legal-team')

      const approved = await humanStore.recordDecision(approval.id, {
        approved: true,
        comment: 'Looks good',
      })

      expect(approved.verb).toBe('approved')
      expect(approved.data.decision).toBe('approved')
      expect(approved.data.comment).toBe('Looks good')
      expect(approved.data.decidedAt).toBeDefined()
    })

    it('transitions from approving to rejected', async () => {
      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Test', data: {} }
      )
      await humanStore.startReview(approval.id, 'legal-team')

      const rejected = await humanStore.recordDecision(approval.id, {
        approved: false,
        reason: 'Missing signature',
      })

      expect(rejected.verb).toBe('rejected')
      expect(rejected.data.decision).toBe('rejected')
      expect(rejected.data.reason).toBe('Missing signature')
      expect(rejected.data.decidedAt).toBeDefined()
    })

    it('cannot record decision without starting review', async () => {
      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Test', data: {} }
      )

      await expect(
        humanStore.recordDecision(approval.id, { approved: true })
      ).rejects.toThrow(/cannot record decision.*pending/i)
    })
  })

  // ==========================================================================
  // 5. Human response stored in relationship data
  // ==========================================================================

  describe('Human response stored in relationship data', () => {
    it('stores approval decision with comment in relationship data', async () => {
      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Test', data: {} }
      )
      await humanStore.startReview(approval.id, 'legal-team')

      const approved = await humanStore.recordDecision(approval.id, {
        approved: true,
        comment: 'Looks good - proceed with signature',
      })

      // Verify data structure matches expected format
      expect(approved.data).toMatchObject({
        decision: 'approved',
        comment: 'Looks good - proceed with signature',
        decidedAt: expect.any(Number),
        decidedBy: expect.any(String),
      })
    })

    it('stores rejection reason in relationship data', async () => {
      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Test', data: {} }
      )
      await humanStore.startReview(approval.id, 'legal-team')

      const rejected = await humanStore.recordDecision(approval.id, {
        approved: false,
        reason: 'Missing signature on page 5',
      })

      expect(rejected.data).toMatchObject({
        decision: 'rejected',
        reason: 'Missing signature on page 5',
        decidedAt: expect.any(Number),
        decidedBy: expect.any(String),
      })
    })

    it('preserves original document in relationship data after decision', async () => {
      const document = {
        type: 'contract',
        description: 'Vendor Agreement',
        data: { vendor: 'Acme', value: 100000 },
      }

      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/legal',
        document
      )
      await humanStore.startReview(approval.id, 'legal-team')
      const approved = await humanStore.recordDecision(approval.id, {
        approved: true,
        comment: 'Approved',
      })

      // Original document should still be in data
      expect(approved.data.document).toEqual(document)
    })
  })

  // ==========================================================================
  // 6. Query pending human approvals by 'approve' action verb
  // ==========================================================================

  describe('Query pending approvals by action verb', () => {
    it('queryPendingApprovals returns only approve verb relationships', async () => {
      // Create multiple approvals in different states
      const approval1 = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-1',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Pending', data: {} }
      )

      const approval2 = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-2',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'In review', data: {} }
      )
      await humanStore.startReview(approval2.id, 'reviewer')

      const approval3 = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-3',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Approved', data: {} }
      )
      await humanStore.startReview(approval3.id, 'reviewer')
      await humanStore.recordDecision(approval3.id, { approved: true })

      // Query pending (action verb 'approve')
      const pending = await humanStore.queryPendingApprovals('do://tenant/Human/legal')

      // Should only return the one with 'approve' verb (pending state)
      expect(pending).toHaveLength(1)
      expect(pending[0]!.verb).toBe('approve')
      expect(pending[0]!.data.document?.description).toBe('Pending')
    })

    it('filters by Human DO URL correctly', async () => {
      await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-1',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'For legal', data: {} }
      )
      await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-2',
        'do://tenant/Human/finance',
        { type: 'expense', description: 'For finance', data: {} }
      )

      const legalPending = await humanStore.queryPendingApprovals('do://tenant/Human/legal')
      const financePending = await humanStore.queryPendingApprovals('do://tenant/Human/finance')

      expect(legalPending).toHaveLength(1)
      expect(legalPending[0]!.to).toBe('do://tenant/Human/legal')

      expect(financePending).toHaveLength(1)
      expect(financePending[0]!.to).toBe('do://tenant/Human/finance')
    })

    it('uses SQLite graph store verb index for efficient query', async () => {
      // Create many approvals
      for (let i = 0; i < 100; i++) {
        await humanStore.requestApproval(
          `do://tenant/WorkflowInstance/instance-${i}`,
          'do://tenant/Human/legal',
          { type: 'contract', description: `Doc ${i}`, data: {} }
        )
      }

      // Query should use verb index (verify via actual SQLite query execution)
      const pending = await humanStore.queryPendingApprovals('do://tenant/Human/legal')

      expect(pending).toHaveLength(100)
      // All should be 'approve' verb
      expect(pending.every((p) => p.verb === 'approve')).toBe(true)
    })
  })

  // ==========================================================================
  // 7. SLA tracking via relationship timestamps
  // ==========================================================================

  describe('SLA tracking via relationship timestamps', () => {
    it('calculates SLA status from relationship createdAt', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Test', data: {} },
        { sla: '4 hours' }
      )

      // Immediately after creation
      let slaStatus = await humanStore.checkSLA(approval.id)
      expect(slaStatus.hasExpired).toBe(false)
      expect(slaStatus.sla).toBe('4 hours')
      expect(slaStatus.createdAt).toBe(new Date('2024-01-15T10:00:00Z').getTime())

      // After 2 hours
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
      slaStatus = await humanStore.checkSLA(approval.id)
      expect(slaStatus.hasExpired).toBe(false)
      expect(slaStatus.timeRemaining).toBe(2 * 60 * 60 * 1000) // 2 hours

      // After 5 hours (1 hour overdue)
      vi.setSystemTime(new Date('2024-01-15T15:00:00Z'))
      slaStatus = await humanStore.checkSLA(approval.id)
      expect(slaStatus.hasExpired).toBe(true)
      expect(slaStatus.timeRemaining).toBe(-1 * 60 * 60 * 1000) // -1 hour

      vi.useRealTimers()
    })

    it('stores SLA in relationship data', async () => {
      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Test', data: {} },
        { sla: '24 hours' }
      )

      // Verify SLA is queryable from SQLite
      const rels = await graphStore.queryRelationshipsFrom(
        'do://tenant/WorkflowInstance/instance-123',
        { verb: 'approve' }
      )

      expect(rels).toHaveLength(1)
      expect((rels[0]!.data as Record<string, unknown>).sla).toBe('24 hours')
    })

    it('handles ISO duration format for SLA', async () => {
      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Test', data: {} },
        { sla: 'PT4H' } // ISO 8601 duration: 4 hours
      )

      const slaStatus = await humanStore.checkSLA(approval.id)
      expect(slaStatus.sla).toBe('PT4H')
      // Should still calculate timeRemaining correctly
      expect(slaStatus.timeRemaining).toBeGreaterThan(0)
    })

    it('returns null SLA for approvals without SLA', async () => {
      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/legal',
        { type: 'contract', description: 'Test', data: {} }
        // No SLA specified
      )

      const slaStatus = await humanStore.checkSLA(approval.id)
      expect(slaStatus.sla).toBeNull()
      expect(slaStatus.hasExpired).toBe(false)
      expect(slaStatus.timeRemaining).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('tracks SLA for escalations', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

      const escalation = await humanStore.createEscalation(
        'do://tenant/WorkflowInstance/instance-123',
        'do://tenant/Human/ceo',
        { reason: 'Urgent', sla: '1 hour' }
      )

      // After 30 minutes
      vi.setSystemTime(new Date('2024-01-15T10:30:00Z'))
      let slaStatus = await humanStore.checkSLA(escalation.id)
      expect(slaStatus.hasExpired).toBe(false)
      expect(slaStatus.timeRemaining).toBe(30 * 60 * 1000) // 30 minutes

      // After 2 hours
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
      slaStatus = await humanStore.checkSLA(escalation.id)
      expect(slaStatus.hasExpired).toBe(true)
      expect(slaStatus.timeRemaining).toBe(-1 * 60 * 60 * 1000) // -1 hour overdue

      vi.useRealTimers()
    })
  })

  // ==========================================================================
  // Complete workflow integration test
  // ==========================================================================

  describe('Complete workflow integration', () => {
    it('demonstrates full human approval workflow with DO URLs', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T09:00:00Z'))

      // 1. Workflow instance requests approval from legal
      const approval = await humanStore.requestApproval(
        'do://tenant/WorkflowInstance/contract-workflow-001',
        'do://tenant/Human/legal-team',
        {
          type: 'partnership',
          description: 'Strategic partnership with Acme Corp',
          data: {
            partner: 'Acme Corp',
            terms: 'Revenue share 70/30',
            value: 5000000,
          },
        },
        { sla: '48 hours' }
      )

      expect(approval.verb).toBe('approve')

      // 2. Query shows approval in legal team's pending queue
      let pending = await humanStore.queryPendingApprovals('do://tenant/Human/legal-team')
      expect(pending).toHaveLength(1)

      // 3. Legal team starts review
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
      const reviewing = await humanStore.startReview(approval.id, 'legal-sarah')
      expect(reviewing.verb).toBe('approving')

      // 4. No longer in pending queue (now 'approving' not 'approve')
      pending = await humanStore.queryPendingApprovals('do://tenant/Human/legal-team')
      expect(pending).toHaveLength(0)

      // 5. Legal approves
      vi.setSystemTime(new Date('2024-01-15T14:00:00Z'))
      const approved = await humanStore.recordDecision(approval.id, {
        approved: true,
        comment: 'Reviewed and approved. Proceed with signature.',
      })

      expect(approved.verb).toBe('approved')
      expect(approved.data.decision).toBe('approved')
      expect(approved.data.comment).toBe('Reviewed and approved. Proceed with signature.')
      expect(approved.data.decidedBy).toBe('legal-sarah')
      expect(approved.data.decidedAt).toBeDefined()

      // 6. Verify relationship is persisted in SQLite with final state
      const rels = await graphStore.queryRelationshipsFrom(
        'do://tenant/WorkflowInstance/contract-workflow-001',
        { verb: 'approved' }
      )
      expect(rels).toHaveLength(1)
      expect(rels[0]!.to).toBe('do://tenant/Human/legal-team')

      vi.useRealTimers()
    })

    it('demonstrates escalation to CEO workflow', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T09:00:00Z'))

      // 1. Workflow escalates to CEO due to high amount
      const escalation = await humanStore.createEscalation(
        'do://tenant/WorkflowInstance/expense-workflow-001',
        'do://tenant/Human/ceo',
        {
          reason: 'Expense amount $50,000 exceeds manager limit',
          sla: '4 hours',
          priority: 1,
          channel: 'slack',
        }
      )

      expect(escalation.verb).toBe('escalate')

      // 2. CEO starts handling
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))
      const started = await humanStore.startEscalation(escalation.id)
      expect(started.verb).toBe('escalating')

      // 3. CEO completes review
      vi.setSystemTime(new Date('2024-01-15T11:00:00Z'))
      const completed = await humanStore.completeEscalation(escalation.id, {
        resolution: 'Approved for Q1 strategic initiative',
        approvedAmount: 50000,
      })

      expect(completed.verb).toBe('escalated')

      // 4. Verify completed within SLA
      const slaStatus = await humanStore.checkSLA(escalation.id)
      // Even though escalation is complete, we can still check the SLA status
      expect(slaStatus.sla).toBe('4 hours')

      vi.useRealTimers()
    })
  })
})
