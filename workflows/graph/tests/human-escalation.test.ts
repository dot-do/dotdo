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
