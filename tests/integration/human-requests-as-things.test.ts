/**
 * Human Requests as Things - Integration Tests
 *
 * TDD RED Phase: These tests define the expected behavior for human request
 * Things with verb form state transitions, using real DO storage.
 *
 * Key Design:
 * - Human requests (ApprovalRequest, TaskRequest, DecisionRequest, ReviewRequest)
 *   are stored as Things with verb form state encoding
 * - State transitions follow verb form patterns: action -> activity -> event
 * - NO MOCKS - tests use real DO storage via ThingsStore
 *
 * Verb Form State Machines:
 * - request: request -> requesting -> requested
 * - approve: approve -> approving -> approved
 * - reject: reject -> rejecting -> rejected
 * - escalate: escalate -> escalating -> escalated
 * - assign: assign -> assigning -> assigned
 * - complete: complete -> completing -> completed
 * - decide: decide -> deciding -> decided
 * - review: review -> reviewing -> reviewed
 *
 * Run with: npx vitest run tests/integration/human-requests-as-things.test.ts --project=integration
 *
 * @module tests/integration/human-requests-as-things
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// IMPORTS - These should fail until HumanRequestThingsStore is implemented
// ============================================================================

// These types exist in db/human-request-things.ts
import {
  type ApprovalRequestThing,
  type TaskRequestThing,
  type DecisionRequestThing,
  type ReviewRequestThing,
  type HumanRequestThing,
  getRequestState,
} from '../../db/human-request-things'

// This store class needs to be implemented for these tests to pass
// RED PHASE: The import will fail until the store is created
import {
  HumanRequestThingsStore,
  type HumanRequestThingInput,
} from '../../db/human-request-things-store'

import type { StoreContext } from '../../db/stores'

/**
 * Helper to get request state from a Thing
 * Uses the existing getRequestState from human-request-things
 */
function getRequestThingState(thing: HumanRequestThing): string {
  return getRequestState(thing.data?.verbForm ?? 'request')
}

// ============================================================================
// TEST CONTEXT SETUP
// ============================================================================

/**
 * Creates a real DO storage context for testing.
 * This should connect to actual SQLite storage, not mocks.
 */
async function createTestContext(): Promise<StoreContext> {
  // This function should create a real StoreContext with SQLite
  // The import will fail until the store is implemented
  const { createStoreContext } = await import('../../db/test-utils')
  return createStoreContext({ namespace: 'test-human-requests' })
}

// ============================================================================
// APPROVAL REQUEST TESTS
// ============================================================================

describe('Human Requests as Things', () => {
  let ctx: StoreContext
  let store: HumanRequestThingsStore

  beforeEach(async () => {
    ctx = await createTestContext()
    store = new HumanRequestThingsStore(ctx)
  })

  afterEach(async () => {
    // Cleanup test data
    await store.cleanup?.()
  })

  // ==========================================================================
  // ApprovalRequest Thing Tests
  // ==========================================================================

  describe('ApprovalRequest Thing', () => {
    it('creates ApprovalRequest Thing with correct type and initial state', async () => {
      const input: HumanRequestThingInput = {
        $type: 'ApprovalRequest',
        name: 'Approve partnership with Acme Corp',
        data: {
          role: 'ceo',
          message: 'Please approve the partnership agreement',
          sla: 3600000, // 1 hour
          channel: 'slack',
        },
      }

      const thing = await store.create(input)

      expect(thing.$id).toBeDefined()
      expect(thing.$id).toMatch(/^ApprovalRequest\//)
      expect(thing.$type).toBe('ApprovalRequest')
      expect(thing.name).toBe('Approve partnership with Acme Corp')
      expect(thing.data?.verbForm).toBe('request') // Initial state
      expect(thing.data?.role).toBe('ceo')
      expect(thing.createdAt).toBeInstanceOf(Date)
      expect(thing.updatedAt).toBeInstanceOf(Date)
    })

    it('transitions through verb forms: request -> requesting -> requested', async () => {
      // Create approval request
      const thing = await store.create({
        $type: 'ApprovalRequest',
        name: 'Approval test',
        data: { role: 'manager' },
      })

      expect(thing.data?.verbForm).toBe('request')

      // Transition: request -> requesting (start processing)
      const processing = await store.transition(thing.$id, 'request', 'start')
      expect(processing.data?.verbForm).toBe('requesting')
      expect(getRequestThingState(processing)).toBe('in_progress')

      // Transition: requesting -> requested (finished processing)
      const completed = await store.transition(processing.$id, 'request', 'complete')
      expect(completed.data?.verbForm).toBe('requested')
      expect(getRequestThingState(completed)).toBe('completed')
    })

    it('transitions approve: approving -> approved', async () => {
      // Create approval request in 'approve' state (ready for approval decision)
      const thing = await store.create({
        $type: 'ApprovalRequest',
        name: 'Approve budget increase',
        data: { role: 'cfo', verbForm: 'approve' },
      })

      expect(thing.data?.verbForm).toBe('approve')

      // Transition: approve -> approving (CEO is reviewing)
      const reviewing = await store.transition(thing.$id, 'approve', 'start')
      expect(reviewing.data?.verbForm).toBe('approving')

      // Transition: approving -> approved (CEO approved)
      const approved = await store.transition(reviewing.$id, 'approve', 'complete')
      expect(approved.data?.verbForm).toBe('approved')
      expect(getRequestThingState(approved)).toBe('completed')
    })

    it('transitions reject: rejecting -> rejected', async () => {
      // Create approval request ready for rejection
      const thing = await store.create({
        $type: 'ApprovalRequest',
        name: 'Reject risky investment',
        data: { role: 'cfo', verbForm: 'reject' },
      })

      expect(thing.data?.verbForm).toBe('reject')

      // Transition: reject -> rejecting (CFO is processing rejection)
      const rejecting = await store.transition(thing.$id, 'reject', 'start')
      expect(rejecting.data?.verbForm).toBe('rejecting')

      // Transition: rejecting -> rejected (CFO rejected)
      const rejected = await store.transition(rejecting.$id, 'reject', 'complete')
      expect(rejected.data?.verbForm).toBe('rejected')
      expect(getRequestThingState(rejected)).toBe('completed')
    })

    it('transitions escalate: escalating -> escalated', async () => {
      // Create approval request that needs escalation
      const thing = await store.create({
        $type: 'ApprovalRequest',
        name: 'Escalate urgent approval',
        data: { role: 'manager', verbForm: 'escalate' },
      })

      expect(thing.data?.verbForm).toBe('escalate')

      // Transition: escalate -> escalating
      const escalating = await store.transition(thing.$id, 'escalate', 'start')
      expect(escalating.data?.verbForm).toBe('escalating')

      // Transition: escalating -> escalated
      const escalated = await store.transition(escalating.$id, 'escalate', 'complete')
      expect(escalated.data?.verbForm).toBe('escalated')
      expect(getRequestThingState(escalated)).toBe('completed')
    })

    it('persists state transitions to DO storage', async () => {
      // Create and transition
      const created = await store.create({
        $type: 'ApprovalRequest',
        name: 'Persistent approval',
        data: { role: 'legal' },
      })

      // Small delay to ensure updatedAt will be different from createdAt
      await new Promise((resolve) => setTimeout(resolve, 1))

      await store.transition(created.$id, 'request', 'start')

      // Fetch from storage - should have persisted state
      const fetched = await store.get(created.$id)

      expect(fetched).toBeDefined()
      expect(fetched!.data?.verbForm).toBe('requesting')
      // updatedAt should be >= createdAt (may be same millisecond on fast machines)
      expect(fetched!.updatedAt.getTime()).toBeGreaterThanOrEqual(fetched!.createdAt.getTime())
    })

    it('rejects invalid state transitions', async () => {
      const thing = await store.create({
        $type: 'ApprovalRequest',
        name: 'Invalid transition test',
        data: { role: 'admin', verbForm: 'approved' }, // Already completed
      })

      // Attempting to start from completed state should throw
      await expect(
        store.transition(thing.$id, 'approve', 'start')
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // TaskRequest Thing Tests
  // ==========================================================================

  describe('TaskRequest Thing', () => {
    it('creates TaskRequest with instructions and tools', async () => {
      const input: HumanRequestThingInput = {
        $type: 'TaskRequest',
        name: 'Review and sign the contract',
        data: {
          instructions: 'Please review the contract and provide your signature',
          tools: ['document-viewer', 'signature-pad'],
          assignee: 'alice@company.com',
          priority: 'high',
          dueDate: new Date(Date.now() + 86400000).toISOString(),
        },
      }

      const thing = await store.create(input)

      expect(thing.$id).toMatch(/^TaskRequest\//)
      expect(thing.$type).toBe('TaskRequest')
      expect(thing.name).toBe('Review and sign the contract')
      expect(thing.data?.verbForm).toBe('assign') // Initial state for tasks
      expect(thing.data?.instructions).toBe('Please review the contract and provide your signature')
      expect(thing.data?.tools).toEqual(['document-viewer', 'signature-pad'])
      expect(thing.data?.assignee).toBe('alice@company.com')
    })

    it('transitions assign: assigning -> assigned', async () => {
      const thing = await store.create({
        $type: 'TaskRequest',
        name: 'Assign task test',
        data: { assignee: 'bob@company.com' },
      })

      expect(thing.data?.verbForm).toBe('assign')

      // Transition: assign -> assigning
      const assigning = await store.transition(thing.$id, 'assign', 'start')
      expect(assigning.data?.verbForm).toBe('assigning')
      expect(getRequestThingState(assigning)).toBe('in_progress')

      // Transition: assigning -> assigned
      const assigned = await store.transition(assigning.$id, 'assign', 'complete')
      expect(assigned.data?.verbForm).toBe('assigned')
      expect(getRequestThingState(assigned)).toBe('completed')
    })

    it('transitions complete: completing -> completed', async () => {
      // Create task in 'complete' state (ready to be marked complete)
      const thing = await store.create({
        $type: 'TaskRequest',
        name: 'Complete task test',
        data: { assignee: 'carol@company.com', verbForm: 'complete' },
      })

      expect(thing.data?.verbForm).toBe('complete')

      // Transition: complete -> completing (work in progress)
      const completing = await store.transition(thing.$id, 'complete', 'start')
      expect(completing.data?.verbForm).toBe('completing')

      // Transition: completing -> completed (work done)
      const completed = await store.transition(completing.$id, 'complete', 'complete')
      expect(completed.data?.verbForm).toBe('completed')
      expect(getRequestThingState(completed)).toBe('completed')
    })

    it('supports full task lifecycle: assign -> assigned -> complete -> completed', async () => {
      // Create task
      let task = await store.create({
        $type: 'TaskRequest',
        name: 'Full lifecycle task',
        data: {
          instructions: 'Complete this multi-step task',
          assignee: 'dave@company.com',
        },
      }) as TaskRequestThing

      // Assignment phase
      task = await store.transition(task.$id, 'assign', 'start') as TaskRequestThing
      expect(task.data?.verbForm).toBe('assigning')

      task = await store.transition(task.$id, 'assign', 'complete') as TaskRequestThing
      expect(task.data?.verbForm).toBe('assigned')

      // Now switch to completion workflow
      task = await store.update(task.$id, { data: { ...task.data, verbForm: 'complete' } }) as TaskRequestThing
      expect(task.data?.verbForm).toBe('complete')

      // Completion phase
      task = await store.transition(task.$id, 'complete', 'start') as TaskRequestThing
      expect(task.data?.verbForm).toBe('completing')

      task = await store.transition(task.$id, 'complete', 'complete') as TaskRequestThing
      expect(task.data?.verbForm).toBe('completed')
    })
  })

  // ==========================================================================
  // DecisionRequest Thing Tests
  // ==========================================================================

  describe('DecisionRequest Thing', () => {
    it('creates DecisionRequest with options and criteria', async () => {
      const input: HumanRequestThingInput = {
        $type: 'DecisionRequest',
        name: 'Choose deployment strategy',
        data: {
          question: 'Which deployment strategy should we use for the v2.0 release?',
          options: [
            { id: 'blue-green', label: 'Blue-Green Deployment', description: 'Zero downtime, instant rollback' },
            { id: 'rolling', label: 'Rolling Update', description: 'Gradual rollout with automatic rollback' },
            { id: 'canary', label: 'Canary Release', description: 'Test with small user subset first' },
          ],
          criteria: [
            'Minimize downtime',
            'Fast rollback capability',
            'Cost efficiency',
          ],
          context: 'Production deployment for customer-facing services',
        },
      }

      const thing = await store.create(input)

      expect(thing.$id).toMatch(/^DecisionRequest\//)
      expect(thing.$type).toBe('DecisionRequest')
      expect(thing.name).toBe('Choose deployment strategy')
      expect(thing.data?.verbForm).toBe('decide') // Initial state for decisions
      expect(thing.data?.options).toHaveLength(3)
      expect(thing.data?.criteria).toContain('Minimize downtime')
    })

    it('transitions decide: deciding -> decided', async () => {
      const thing = await store.create({
        $type: 'DecisionRequest',
        name: 'Decision test',
        data: {
          options: ['option-a', 'option-b'],
        },
      })

      expect(thing.data?.verbForm).toBe('decide')

      // Transition: decide -> deciding (deliberation in progress)
      const deciding = await store.transition(thing.$id, 'decide', 'start')
      expect(deciding.data?.verbForm).toBe('deciding')
      expect(getRequestThingState(deciding)).toBe('in_progress')

      // Transition: deciding -> decided (decision made)
      const decided = await store.transition(deciding.$id, 'decide', 'complete')
      expect(decided.data?.verbForm).toBe('decided')
      expect(getRequestThingState(decided)).toBe('completed')
    })

    it('records decision result with reasoning', async () => {
      let thing = await store.create({
        $type: 'DecisionRequest',
        name: 'Recorded decision test',
        data: {
          options: ['strategy-a', 'strategy-b', 'strategy-c'],
        },
      }) as DecisionRequestThing

      // Go through decision process
      thing = await store.transition(thing.$id, 'decide', 'start') as DecisionRequestThing

      // Complete with decision result
      thing = await store.transitionWithResult(thing.$id, 'decide', 'complete', {
        choice: 'strategy-b',
        decidedBy: 'tech-lead@company.com',
        reasoning: 'Strategy B balances cost and reliability',
        confidence: 0.85,
      }) as DecisionRequestThing

      expect(thing.data?.verbForm).toBe('decided')
      expect(thing.data?.result?.choice).toBe('strategy-b')
      expect(thing.data?.result?.reasoning).toBe('Strategy B balances cost and reliability')
    })
  })

  // ==========================================================================
  // ReviewRequest Thing Tests
  // ==========================================================================

  describe('ReviewRequest Thing', () => {
    it('creates ReviewRequest with content and reviewType', async () => {
      const input: HumanRequestThingInput = {
        $type: 'ReviewRequest',
        name: 'Review pull request #123',
        data: {
          artifact: 'https://github.com/org/repo/pull/123',
          reviewType: 'code',
          content: 'PR #123: Implement user authentication flow',
          criteria: [
            'Code quality and readability',
            'Test coverage',
            'Security considerations',
            'Performance impact',
          ],
        },
      }

      const thing = await store.create(input)

      expect(thing.$id).toMatch(/^ReviewRequest\//)
      expect(thing.$type).toBe('ReviewRequest')
      expect(thing.name).toBe('Review pull request #123')
      expect(thing.data?.verbForm).toBe('review') // Initial state for reviews
      expect(thing.data?.reviewType).toBe('code')
      expect(thing.data?.artifact).toBe('https://github.com/org/repo/pull/123')
    })

    it('transitions review: reviewing -> reviewed', async () => {
      const thing = await store.create({
        $type: 'ReviewRequest',
        name: 'Review test',
        data: {
          artifact: 'doc://specification.md',
          reviewType: 'document',
        },
      })

      expect(thing.data?.verbForm).toBe('review')

      // Transition: review -> reviewing (review in progress)
      const reviewing = await store.transition(thing.$id, 'review', 'start')
      expect(reviewing.data?.verbForm).toBe('reviewing')
      expect(getRequestThingState(reviewing)).toBe('in_progress')

      // Transition: reviewing -> reviewed (review complete)
      const reviewed = await store.transition(reviewing.$id, 'review', 'complete')
      expect(reviewed.data?.verbForm).toBe('reviewed')
      expect(getRequestThingState(reviewed)).toBe('completed')
    })

    it('records review result with feedback and issues', async () => {
      let thing = await store.create({
        $type: 'ReviewRequest',
        name: 'Code review with feedback',
        data: {
          artifact: 'https://github.com/org/repo/pull/456',
          reviewType: 'code',
        },
      }) as ReviewRequestThing

      // Go through review process
      thing = await store.transition(thing.$id, 'review', 'start') as ReviewRequestThing

      // Complete with review result
      thing = await store.transitionWithResult(thing.$id, 'review', 'complete', {
        reviewedBy: 'senior-dev@company.com',
        approved: false,
        status: 'changes_requested',
        score: 75,
        feedback: 'Good implementation but needs more test coverage',
        issues: [
          { type: 'warning', description: 'Missing unit tests for error cases', severity: 3 },
          { type: 'suggestion', description: 'Consider using a more descriptive variable name', severity: 1 },
        ],
      }) as ReviewRequestThing

      expect(thing.data?.verbForm).toBe('reviewed')
      expect(thing.data?.result?.approved).toBe(false)
      expect(thing.data?.result?.status).toBe('changes_requested')
      expect(thing.data?.result?.issues).toHaveLength(2)
    })

    it('supports different review types: code, document, design, legal', async () => {
      const reviewTypes = ['code', 'document', 'design', 'legal'] as const

      for (const reviewType of reviewTypes) {
        const thing = await store.create({
          $type: 'ReviewRequest',
          name: `${reviewType} review`,
          data: {
            reviewType,
            artifact: `artifact://${reviewType}-item`,
          },
        })

        expect(thing.data?.reviewType).toBe(reviewType)
        expect(thing.data?.verbForm).toBe('review')
      }
    })
  })

  // ==========================================================================
  // Cross-Cutting Integration Tests
  // ==========================================================================

  describe('Cross-Cutting Integration', () => {
    it('lists all pending human requests', async () => {
      // Create various request types
      await store.create({ $type: 'ApprovalRequest', name: 'Approval 1', data: { role: 'ceo' } })
      await store.create({ $type: 'TaskRequest', name: 'Task 1', data: { assignee: 'alice' } })
      await store.create({ $type: 'DecisionRequest', name: 'Decision 1', data: {} })
      await store.create({ $type: 'ReviewRequest', name: 'Review 1', data: { reviewType: 'code' } })

      // List all pending (action form verb state)
      const pending = await store.listByState('pending')

      expect(pending.length).toBeGreaterThanOrEqual(4)
      expect(pending.every(t => getRequestThingState(t) === 'pending')).toBe(true)
    })

    it('lists all in-progress human requests', async () => {
      // Create and transition to in-progress
      const approval = await store.create({ $type: 'ApprovalRequest', name: 'In-progress approval', data: { role: 'manager' } })
      await store.transition(approval.$id, 'request', 'start')

      const task = await store.create({ $type: 'TaskRequest', name: 'In-progress task', data: { assignee: 'bob' } })
      await store.transition(task.$id, 'assign', 'start')

      // List all in-progress (activity form verb state)
      const inProgress = await store.listByState('in_progress')

      expect(inProgress.length).toBeGreaterThanOrEqual(2)
      expect(inProgress.every(t => getRequestThingState(t) === 'in_progress')).toBe(true)
    })

    it('queries requests by assignee/role', async () => {
      await store.create({ $type: 'ApprovalRequest', name: 'CEO Approval', data: { role: 'ceo' } })
      await store.create({ $type: 'ApprovalRequest', name: 'CFO Approval', data: { role: 'cfo' } })
      await store.create({ $type: 'TaskRequest', name: 'Alice Task', data: { assignee: 'alice@company.com' } })

      // Query by role
      const ceoRequests = await store.listByRole('ceo')
      expect(ceoRequests.length).toBe(1)
      expect(ceoRequests[0]!.name).toBe('CEO Approval')

      // Query by assignee
      const aliceTasks = await store.listByAssignee('alice@company.com')
      expect(aliceTasks.length).toBe(1)
      expect(aliceTasks[0]!.name).toBe('Alice Task')
    })

    it('preserves data integrity through transitions', async () => {
      const originalData = {
        role: 'ceo',
        message: 'Approve this important decision',
        sla: 7200000,
        channel: 'slack',
        customField: { nested: { value: 42 } },
      }

      const thing = await store.create({
        $type: 'ApprovalRequest',
        name: 'Data integrity test',
        data: originalData,
      })

      // Transition multiple times
      let current = await store.transition(thing.$id, 'request', 'start')
      current = await store.transition(current.$id, 'request', 'complete')

      // All original data should be preserved
      expect(current.data?.role).toBe('ceo')
      expect(current.data?.message).toBe('Approve this important decision')
      expect(current.data?.sla).toBe(7200000)
      expect(current.data?.channel).toBe('slack')
      expect(current.data?.customField).toEqual({ nested: { value: 42 } })

      // Only verbForm and updatedAt should have changed
      expect(current.data?.verbForm).toBe('requested')
    })

    it('tracks audit history of state transitions', async () => {
      const thing = await store.create({
        $type: 'ApprovalRequest',
        name: 'Audit test',
        data: { role: 'legal' },
      })

      // Perform transitions
      await store.transition(thing.$id, 'request', 'start')
      await store.transition(thing.$id, 'request', 'complete')

      // Get audit history
      const history = await store.getHistory(thing.$id)

      expect(history.length).toBeGreaterThanOrEqual(3) // create + 2 transitions
      expect(history[0]!.action).toBe('create')
      expect(history[0]!.verbForm).toBe('request')
      expect(history[1]!.action).toBe('transition')
      expect(history[1]!.verbForm).toBe('requesting')
      expect(history[2]!.action).toBe('transition')
      expect(history[2]!.verbForm).toBe('requested')
    })
  })
})
