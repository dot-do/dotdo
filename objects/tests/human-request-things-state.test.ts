/**
 * [RED] Human Request Things with Verb Form State Transitions
 *
 * TDD RED Phase: Tests for Human request Things stored in the graph with
 * verb form state encoding. These tests verify that Human approval/task/decision/review
 * requests are properly persisted as Things with state transitions via verb forms.
 *
 * ## Key Concepts
 *
 * **Request as Thing:**
 * - ApprovalRequest, TaskRequest, DecisionRequest, ReviewRequest are all Things
 * - Each request Thing has a relationship to the target Human
 * - The relationship verb encodes the state
 *
 * **Verb Form State Machine:**
 * ```
 * Request ──request──> Human     (pending - intent)
 * Request ──requesting──> Human  (in-progress - human is reviewing)
 * Request ──requested──> Human   (completed - resolved, for historical record)
 * ```
 *
 * **Approval Flow:**
 * ```
 * Request ──approve──> Human     (pending - awaiting approval)
 * Request ──approving──> Human   (in-progress - human is reviewing)
 * Request ──approved──> Human    (completed - approved)
 * Request ──rejected──> Human    (completed - rejected)
 * ```
 *
 * **Task Flow:**
 * ```
 * Task ──assign──> Human         (pending)
 * Task ──assigning──> Human      (in-progress)
 * Task ──assigned──> Human       (assigned but not started)
 * Task ──completing──> Human     (work in progress)
 * Task ──completed──> Human      (done)
 * ```
 *
 * @see dotdo-kgldi - [RED] Human request Things with verb form state transitions
 * @see db/graph/humans/types.ts - Type definitions
 * @see db/graph/humans/hitl.ts - Graph integration
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SQLiteGraphStore } from '../../db/graph/stores'
import type { GraphStore, GraphThing, GraphRelationship } from '../../db/graph/types'
import {
  HUMAN_VERBS,
  HUMAN_TYPE_NAMES,
  HumanUrls,
  type ApprovalRequestThingData,
  type TaskRequestThingData,
  type DecisionRequestThingData,
  type ReviewRequestThingData,
} from '../../db/graph/humans/types'
import {
  createUser,
  createApprovalRequest,
  getApprovalRequest,
  getApprovalStatus,
  startReview,
  approve,
  reject,
  getPendingApprovals,
  escalateApproval,
} from '../../db/graph/humans'
import {
  getStateFromVerb,
  transitionVerb,
  REQUEST_VERB_FORMS,
  createTaskRequest,
  getTaskRequest,
  assignTask,
  startTask,
  completeTask,
  createDecisionRequest,
  startDecision,
  makeDecision,
  createReviewRequest,
  startReviewRequest,
  completeReview,
} from '../../db/graph/humans/hitl'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('[RED] Human Request Things with Verb Form State Transitions', () => {
  let graph: GraphStore

  beforeEach(async () => {
    graph = new SQLiteGraphStore(':memory:')
    await graph.initialize()
  })

  // ==========================================================================
  // SECTION 1: Verb Form State Machine
  // ==========================================================================

  describe('Verb Form State Machine', () => {
    describe('getStateFromVerb', () => {
      it('maps action verbs to pending state', () => {
        expect(getStateFromVerb(HUMAN_VERBS.APPROVE)).toBe('pending')
        expect(getStateFromVerb(HUMAN_VERBS.ASSIGN)).toBe('pending')
        expect(getStateFromVerb(HUMAN_VERBS.DECIDE)).toBe('pending')
        expect(getStateFromVerb(HUMAN_VERBS.REVIEW)).toBe('pending')
        expect(getStateFromVerb(HUMAN_VERBS.REQUEST)).toBe('pending')
      })

      it('maps activity verbs (-ing) to in_progress state', () => {
        expect(getStateFromVerb(HUMAN_VERBS.APPROVING)).toBe('in_progress')
        expect(getStateFromVerb(HUMAN_VERBS.ASSIGNING)).toBe('in_progress')
        expect(getStateFromVerb(HUMAN_VERBS.DECIDING)).toBe('in_progress')
        expect(getStateFromVerb(HUMAN_VERBS.REVIEWING)).toBe('in_progress')
        expect(getStateFromVerb(HUMAN_VERBS.REQUESTING)).toBe('in_progress')
        expect(getStateFromVerb(HUMAN_VERBS.COMPLETING)).toBe('in_progress')
      })

      it('maps event verbs (-ed) to completed state', () => {
        expect(getStateFromVerb(HUMAN_VERBS.APPROVED)).toBe('completed')
        expect(getStateFromVerb(HUMAN_VERBS.ASSIGNED)).toBe('completed')
        expect(getStateFromVerb(HUMAN_VERBS.DECIDED)).toBe('completed')
        expect(getStateFromVerb(HUMAN_VERBS.REVIEWED)).toBe('completed')
        expect(getStateFromVerb(HUMAN_VERBS.REQUESTED)).toBe('completed')
        expect(getStateFromVerb(HUMAN_VERBS.COMPLETED)).toBe('completed')
      })

      it('maps rejected verb to rejected state', () => {
        expect(getStateFromVerb(HUMAN_VERBS.REJECTED)).toBe('rejected')
      })
    })

    describe('transitionVerb', () => {
      it('transitions action -> activity on start', () => {
        expect(transitionVerb(HUMAN_VERBS.APPROVE, 'start')).toBe(HUMAN_VERBS.APPROVING)
        expect(transitionVerb(HUMAN_VERBS.ASSIGN, 'start')).toBe(HUMAN_VERBS.ASSIGNING)
        expect(transitionVerb(HUMAN_VERBS.DECIDE, 'start')).toBe(HUMAN_VERBS.DECIDING)
        expect(transitionVerb(HUMAN_VERBS.REVIEW, 'start')).toBe(HUMAN_VERBS.REVIEWING)
      })

      it('transitions activity -> event on complete', () => {
        expect(transitionVerb(HUMAN_VERBS.APPROVING, 'complete')).toBe(HUMAN_VERBS.APPROVED)
        expect(transitionVerb(HUMAN_VERBS.ASSIGNING, 'complete')).toBe(HUMAN_VERBS.ASSIGNED)
        expect(transitionVerb(HUMAN_VERBS.DECIDING, 'complete')).toBe(HUMAN_VERBS.DECIDED)
        expect(transitionVerb(HUMAN_VERBS.REVIEWING, 'complete')).toBe(HUMAN_VERBS.REVIEWED)
      })

      it('transitions to rejected on reject', () => {
        expect(transitionVerb(HUMAN_VERBS.APPROVE, 'reject')).toBe(HUMAN_VERBS.REJECTED)
        expect(transitionVerb(HUMAN_VERBS.APPROVING, 'reject')).toBe(HUMAN_VERBS.REJECTED)
      })

      it('throws error when transitioning from completed state', () => {
        expect(() => transitionVerb(HUMAN_VERBS.APPROVED, 'start')).toThrow()
        expect(() => transitionVerb(HUMAN_VERBS.COMPLETED, 'complete')).toThrow()
      })

      it('throws error when transitioning from rejected state', () => {
        expect(() => transitionVerb(HUMAN_VERBS.REJECTED, 'start')).toThrow()
        expect(() => transitionVerb(HUMAN_VERBS.REJECTED, 'complete')).toThrow()
      })

      it('allows direct action -> event completion (skip in-progress)', () => {
        // Direct completion without explicit start
        expect(transitionVerb(HUMAN_VERBS.APPROVE, 'complete')).toBe(HUMAN_VERBS.APPROVED)
        expect(transitionVerb(HUMAN_VERBS.DECIDE, 'complete')).toBe(HUMAN_VERBS.DECIDED)
      })
    })
  })

  // ==========================================================================
  // SECTION 2: Approval Request as Thing with Verb Form State
  // ==========================================================================

  describe('Approval Request as Thing', () => {
    it('creates ApprovalRequest Thing with approve verb relationship', async () => {
      const requester = await createUser(graph, {
        email: 'requester@example.com',
        name: 'Requester',
        status: 'active',
      })

      const { thing, relationship } = await createApprovalRequest(graph, {
        title: 'Budget Approval',
        message: 'Please approve the Q1 budget of $50,000',
        type: 'approval',
        priority: 'high',
        requesterId: requester.id,
        targetRole: 'cfo',
        sla: 4 * 60 * 60 * 1000, // 4 hours
      })

      // Thing should be created
      expect(thing).toBeDefined()
      expect(thing.id).toBeDefined()
      expect(thing.typeName).toBe(HUMAN_TYPE_NAMES.ApprovalRequest)

      // Thing data should contain request details
      const data = thing.data as ApprovalRequestThingData
      expect(data.title).toBe('Budget Approval')
      expect(data.message).toBe('Please approve the Q1 budget of $50,000')
      expect(data.type).toBe('approval')
      expect(data.priority).toBe('high')
      expect(data.requesterId).toBe(requester.id)

      // Relationship should use approve verb (pending state)
      expect(relationship.verb).toBe(HUMAN_VERBS.APPROVE)
      expect(relationship.from).toContain(thing.id)
    })

    it('persists ApprovalRequest Thing in graph store', async () => {
      const requester = await createUser(graph, {
        email: 'requester@example.com',
        name: 'Requester',
        status: 'active',
      })

      const { thing } = await createApprovalRequest(graph, {
        title: 'Persisted Request',
        message: 'This should be retrievable',
        type: 'approval',
        priority: 'normal',
        requesterId: requester.id,
      })

      // Should be retrievable from graph
      const retrieved = await getApprovalRequest(graph, thing.id)
      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(thing.id)

      const data = retrieved!.data as ApprovalRequestThingData
      expect(data.title).toBe('Persisted Request')
    })

    describe('Approval State Transitions via Verb Forms', () => {
      it('transitions approve -> approving when human starts review', async () => {
        const requester = await createUser(graph, {
          email: 'requester@example.com',
          name: 'Requester',
          status: 'active',
        })
        const approver = await createUser(graph, {
          email: 'approver@example.com',
          name: 'Approver',
          status: 'active',
        })

        const { thing } = await createApprovalRequest(
          graph,
          {
            title: 'Review Me',
            message: 'Needs review',
            type: 'approval',
            priority: 'normal',
            requesterId: requester.id,
          },
          { targetId: approver.id }
        )

        // Initial state: approve verb (pending)
        const initial = await getApprovalStatus(graph, thing.id)
        expect(initial.status).toBe('pending')
        expect(initial.relationship?.verb).toBe(HUMAN_VERBS.APPROVE)

        // Start review - transitions to approving
        await startReview(graph, thing.id, approver.id)

        const reviewing = await getApprovalStatus(graph, thing.id)
        expect(reviewing.status).toBe('approving')
        expect(reviewing.relationship?.verb).toBe(HUMAN_VERBS.APPROVING)
      })

      it('transitions approving -> approved when human approves', async () => {
        const requester = await createUser(graph, {
          email: 'requester@example.com',
          name: 'Requester',
          status: 'active',
        })
        const approver = await createUser(graph, {
          email: 'approver@example.com',
          name: 'Approver',
          status: 'active',
        })

        const { thing } = await createApprovalRequest(
          graph,
          {
            title: 'Approve Me',
            message: 'Ready for approval',
            type: 'approval',
            priority: 'normal',
            requesterId: requester.id,
          },
          { targetId: approver.id }
        )

        await startReview(graph, thing.id, approver.id)
        await approve(graph, thing.id, approver.id, 'Looks good!')

        const approved = await getApprovalStatus(graph, thing.id)
        expect(approved.status).toBe('approved')
        expect(approved.relationship?.verb).toBe(HUMAN_VERBS.APPROVED)
      })

      it('transitions approving -> rejected when human rejects', async () => {
        const requester = await createUser(graph, {
          email: 'requester@example.com',
          name: 'Requester',
          status: 'active',
        })
        const approver = await createUser(graph, {
          email: 'approver@example.com',
          name: 'Approver',
          status: 'active',
        })

        const { thing } = await createApprovalRequest(
          graph,
          {
            title: 'Reject Me',
            message: 'Not quite ready',
            type: 'approval',
            priority: 'normal',
            requesterId: requester.id,
          },
          { targetId: approver.id }
        )

        await startReview(graph, thing.id, approver.id)
        await reject(graph, thing.id, approver.id, 'Missing documentation')

        const rejected = await getApprovalStatus(graph, thing.id)
        expect(rejected.status).toBe('rejected')
        expect(rejected.relationship?.verb).toBe(HUMAN_VERBS.REJECTED)
      })

      it('allows direct approve -> approved (skip in-progress)', async () => {
        const requester = await createUser(graph, {
          email: 'requester@example.com',
          name: 'Requester',
          status: 'active',
        })
        const approver = await createUser(graph, {
          email: 'approver@example.com',
          name: 'Approver',
          status: 'active',
        })

        const { thing } = await createApprovalRequest(
          graph,
          {
            title: 'Quick Approval',
            message: 'Urgent - approve immediately',
            type: 'approval',
            priority: 'urgent',
            requesterId: requester.id,
          },
          { targetId: approver.id }
        )

        // Direct approval without explicit startReview
        await approve(graph, thing.id, approver.id, 'Auto-approved')

        const status = await getApprovalStatus(graph, thing.id)
        expect(status.status).toBe('approved')
        expect(status.relationship?.verb).toBe(HUMAN_VERBS.APPROVED)
      })
    })

    describe('Approval Request Response Data in Thing', () => {
      it('stores approval response in Thing data', async () => {
        const requester = await createUser(graph, {
          email: 'requester@example.com',
          name: 'Requester',
          status: 'active',
        })
        const approver = await createUser(graph, {
          email: 'approver@example.com',
          name: 'Approver',
          status: 'active',
        })

        const { thing } = await createApprovalRequest(
          graph,
          {
            title: 'Response Test',
            message: 'Test response storage',
            type: 'approval',
            priority: 'normal',
            requesterId: requester.id,
          },
          { targetId: approver.id }
        )

        await approve(graph, thing.id, approver.id, 'Approved with comment')

        const retrieved = await getApprovalRequest(graph, thing.id)
        const data = retrieved!.data as ApprovalRequestThingData

        expect(data.response).toBeDefined()
        expect(data.response!.approved).toBe(true)
        expect(data.response!.responderId).toBe(approver.id)
        expect(data.response!.reason).toBe('Approved with comment')
        expect(data.response!.respondedAt).toBeDefined()
      })

      it('stores rejection response in Thing data', async () => {
        const requester = await createUser(graph, {
          email: 'requester@example.com',
          name: 'Requester',
          status: 'active',
        })
        const approver = await createUser(graph, {
          email: 'approver@example.com',
          name: 'Approver',
          status: 'active',
        })

        const { thing } = await createApprovalRequest(
          graph,
          {
            title: 'Rejection Test',
            message: 'Test rejection storage',
            type: 'approval',
            priority: 'normal',
            requesterId: requester.id,
          },
          { targetId: approver.id }
        )

        await reject(graph, thing.id, approver.id, 'Budget exceeded')

        const retrieved = await getApprovalRequest(graph, thing.id)
        const data = retrieved!.data as ApprovalRequestThingData

        expect(data.response).toBeDefined()
        expect(data.response!.approved).toBe(false)
        expect(data.response!.reason).toBe('Budget exceeded')
      })
    })
  })

  // ==========================================================================
  // SECTION 3: Task Request as Thing with Verb Form State
  // ==========================================================================

  describe('Task Request as Thing', () => {
    it('creates TaskRequest Thing with assign verb relationship', async () => {
      const { thing, relationship } = await createTaskRequest(graph, {
        title: 'Implement Feature X',
        instructions: 'Build the new dashboard widget',
        requesterId: 'agent-001',
        targetUserId: 'human-dev',
        priority: 'high',
        tools: ['vscode', 'git', 'terminal'],
        estimatedEffort: 120, // 2 hours
      })

      expect(thing).toBeDefined()
      expect(thing.typeName).toBe(HUMAN_TYPE_NAMES.TaskRequest)

      const data = thing.data as TaskRequestThingData
      expect(data.title).toBe('Implement Feature X')
      expect(data.instructions).toBe('Build the new dashboard widget')
      expect(data.state).toBe('pending')
      expect(data.tools).toContain('vscode')

      expect(relationship.verb).toBe(HUMAN_VERBS.ASSIGN)
    })

    describe('Task State Transitions via Verb Forms', () => {
      it('transitions assign -> assigned when task is assigned', async () => {
        const { thing } = await createTaskRequest(graph, {
          title: 'Assignable Task',
          instructions: 'Do the thing',
          requesterId: 'agent-001',
          priority: 'normal',
        })

        const { relationship } = await assignTask(graph, thing.id, 'human-worker')

        expect(relationship.verb).toBe(HUMAN_VERBS.ASSIGNED)

        const retrieved = await getTaskRequest(graph, thing.id)
        const data = retrieved!.data as TaskRequestThingData
        expect(data.state).toBe('assigned')
        expect(data.targetUserId).toBe('human-worker')
      })

      it('transitions assigned -> in_progress when work starts', async () => {
        const { thing } = await createTaskRequest(graph, {
          title: 'Start Work Task',
          instructions: 'Begin working',
          requesterId: 'agent-001',
          priority: 'normal',
        })

        await assignTask(graph, thing.id, 'human-worker')
        const updated = await startTask(graph, thing.id, 'human-worker')

        const data = updated.data as TaskRequestThingData
        expect(data.state).toBe('in_progress')
        expect(data.timestamps.startedAt).toBeDefined()
      })

      it('transitions in_progress -> completed when task is done', async () => {
        const { thing } = await createTaskRequest(graph, {
          title: 'Complete Task',
          instructions: 'Finish the work',
          requesterId: 'agent-001',
          priority: 'normal',
        })

        await assignTask(graph, thing.id, 'human-worker')
        await startTask(graph, thing.id, 'human-worker')

        const { thing: completedThing, relationship } = await completeTask(graph, thing.id, {
          completedBy: 'human-worker',
          completedAt: Date.now(),
          result: { output: 'Task completed successfully' },
          notes: 'All requirements met',
        })

        expect(relationship.verb).toBe(HUMAN_VERBS.COMPLETED)

        const data = completedThing.data as TaskRequestThingData
        expect(data.state).toBe('completed')
        expect(data.response).toBeDefined()
        expect(data.response!.result).toEqual({ output: 'Task completed successfully' })
      })
    })
  })

  // ==========================================================================
  // SECTION 4: Decision Request as Thing with Verb Form State
  // ==========================================================================

  describe('Decision Request as Thing', () => {
    it('creates DecisionRequest Thing with decide verb relationship', async () => {
      const { thing, relationship } = await createDecisionRequest(graph, {
        title: 'Technology Stack Decision',
        question: 'Which database should we use for the new project?',
        options: [
          { id: 'postgres', label: 'PostgreSQL', description: 'Relational database' },
          { id: 'mongodb', label: 'MongoDB', description: 'Document database' },
          { id: 'sqlite', label: 'SQLite', description: 'Embedded database' },
        ],
        requesterId: 'agent-architect',
        targetRole: 'cto',
        priority: 'high',
        criteria: ['Scalability', 'Developer experience', 'Cost'],
      })

      expect(thing).toBeDefined()
      expect(thing.typeName).toBe(HUMAN_TYPE_NAMES.DecisionRequest)

      const data = thing.data as DecisionRequestThingData
      expect(data.title).toBe('Technology Stack Decision')
      expect(data.question).toContain('database')
      expect(data.options).toHaveLength(3)

      expect(relationship.verb).toBe(HUMAN_VERBS.DECIDE)
    })

    describe('Decision State Transitions via Verb Forms', () => {
      it('transitions decide -> deciding when decision starts', async () => {
        const { thing } = await createDecisionRequest(graph, {
          title: 'Pending Decision',
          question: 'What color?',
          options: [
            { id: 'red', label: 'Red' },
            { id: 'blue', label: 'Blue' },
          ],
          requesterId: 'agent-001',
          priority: 'normal',
        })

        const relationship = await startDecision(graph, thing.id, 'human-decider')

        expect(relationship.verb).toBe(HUMAN_VERBS.DECIDING)
      })

      it('transitions deciding -> decided when decision is made', async () => {
        const { thing } = await createDecisionRequest(graph, {
          title: 'Make a Choice',
          question: 'Which option?',
          options: [
            { id: 'opt-a', label: 'Option A' },
            { id: 'opt-b', label: 'Option B' },
          ],
          requesterId: 'agent-001',
          priority: 'normal',
        })

        await startDecision(graph, thing.id, 'human-decider')

        const { thing: decidedThing, relationship } = await makeDecision(graph, thing.id, {
          selectedOptionId: 'opt-a',
          decidedBy: 'human-decider',
          decidedAt: Date.now(),
          reasoning: 'Option A has better long-term benefits',
          confidence: 0.85,
        })

        expect(relationship.verb).toBe(HUMAN_VERBS.DECIDED)

        const data = decidedThing.data as DecisionRequestThingData
        expect(data.decision).toBeDefined()
        expect(data.decision!.selectedOptionId).toBe('opt-a')
        expect(data.decision!.confidence).toBe(0.85)
      })
    })
  })

  // ==========================================================================
  // SECTION 5: Review Request as Thing with Verb Form State
  // ==========================================================================

  describe('Review Request as Thing', () => {
    it('creates ReviewRequest Thing with review verb relationship', async () => {
      const { thing, relationship } = await createReviewRequest(graph, {
        title: 'Code Review: Feature Branch',
        content: 'PR #123 - Implement user authentication',
        reviewType: 'code',
        criteria: ['Security', 'Performance', 'Code style'],
        requesterId: 'agent-dev',
        targetRole: 'tech-lead',
        priority: 'high',
      })

      expect(thing).toBeDefined()
      expect(thing.typeName).toBe(HUMAN_TYPE_NAMES.ReviewRequest)

      const data = thing.data as ReviewRequestThingData
      expect(data.title).toBe('Code Review: Feature Branch')
      expect(data.reviewType).toBe('code')
      expect(data.criteria).toContain('Security')

      expect(relationship.verb).toBe(HUMAN_VERBS.REVIEW)
    })

    describe('Review State Transitions via Verb Forms', () => {
      it('transitions review -> reviewing when review starts', async () => {
        const { thing } = await createReviewRequest(graph, {
          title: 'Pending Review',
          content: 'Review this content',
          reviewType: 'content',
          requesterId: 'agent-001',
          priority: 'normal',
        })

        const relationship = await startReviewRequest(graph, thing.id, 'human-reviewer')

        expect(relationship.verb).toBe(HUMAN_VERBS.REVIEWING)
      })

      it('transitions reviewing -> reviewed when review completes', async () => {
        const { thing } = await createReviewRequest(graph, {
          title: 'Complete Review',
          content: 'Finish reviewing this',
          reviewType: 'quality',
          requesterId: 'agent-001',
          priority: 'normal',
        })

        await startReviewRequest(graph, thing.id, 'human-reviewer')

        const { thing: reviewedThing, relationship } = await completeReview(graph, thing.id, {
          reviewedBy: 'human-reviewer',
          reviewedAt: Date.now(),
          approved: true,
          score: 95,
          feedback: 'Excellent work, minor suggestions only',
          issues: [
            {
              type: 'suggestion',
              description: 'Consider adding more comments',
              severity: 1,
            },
          ],
        })

        expect(relationship.verb).toBe(HUMAN_VERBS.REVIEWED)

        const data = reviewedThing.data as ReviewRequestThingData
        expect(data.review).toBeDefined()
        expect(data.review!.approved).toBe(true)
        expect(data.review!.score).toBe(95)
        expect(data.review!.issues).toHaveLength(1)
      })
    })
  })

  // ==========================================================================
  // SECTION 6: Graph Queries for Human Requests
  // ==========================================================================

  describe('Graph Queries for Human Requests', () => {
    it('queries pending approvals by target user via verb', async () => {
      const approver = await createUser(graph, {
        email: 'approver@example.com',
        name: 'Approver',
        status: 'active',
      })

      // Create multiple approval requests for the same approver
      await createApprovalRequest(
        graph,
        {
          title: 'Pending 1',
          message: 'First request',
          type: 'approval',
          priority: 'normal',
          requesterId: 'agent-001',
        },
        { targetId: approver.id }
      )

      await createApprovalRequest(
        graph,
        {
          title: 'Pending 2',
          message: 'Second request',
          type: 'approval',
          priority: 'high',
          requesterId: 'agent-002',
        },
        { targetId: approver.id }
      )

      const pending = await getPendingApprovals(graph, approver.id)

      expect(pending).toHaveLength(2)
      // [RED] Should be sorted by priority - high priority first
      // This test reveals missing priority-based sorting in getPendingApprovals
      expect((pending[0]!.data as ApprovalRequestThingData).priority).toBe('high')
    })

    it('excludes completed approvals from pending queries', async () => {
      const approver = await createUser(graph, {
        email: 'approver@example.com',
        name: 'Approver',
        status: 'active',
      })

      const { thing: req1 } = await createApprovalRequest(
        graph,
        {
          title: 'Will be approved',
          message: 'Approve me',
          type: 'approval',
          priority: 'normal',
          requesterId: 'agent-001',
        },
        { targetId: approver.id }
      )

      await createApprovalRequest(
        graph,
        {
          title: 'Still pending',
          message: 'Still waiting',
          type: 'approval',
          priority: 'normal',
          requesterId: 'agent-002',
        },
        { targetId: approver.id }
      )

      // Approve the first request
      await approve(graph, req1.id, approver.id, 'Done')

      const pending = await getPendingApprovals(graph, approver.id)

      expect(pending).toHaveLength(1)
      expect((pending[0]!.data as ApprovalRequestThingData).title).toBe('Still pending')
    })

    it('tracks approval status via relationship verb', async () => {
      const approver = await createUser(graph, {
        email: 'approver@example.com',
        name: 'Approver',
        status: 'active',
      })

      const { thing } = await createApprovalRequest(
        graph,
        {
          title: 'Track Status',
          message: 'Watch the status',
          type: 'approval',
          priority: 'normal',
          requesterId: 'agent-001',
        },
        { targetId: approver.id }
      )

      // Check initial status
      let status = await getApprovalStatus(graph, thing.id)
      expect(status.status).toBe('pending')

      // Start review
      await startReview(graph, thing.id, approver.id)
      status = await getApprovalStatus(graph, thing.id)
      expect(status.status).toBe('approving')

      // Approve
      await approve(graph, thing.id, approver.id)
      status = await getApprovalStatus(graph, thing.id)
      expect(status.status).toBe('approved')
    })
  })

  // ==========================================================================
  // SECTION 7: Escalation as Verb Form Transition
  // ==========================================================================

  describe('Escalation as Verb Form Transition', () => {
    it('creates escalation relationship with escalated verb', async () => {
      const manager = await createUser(graph, {
        email: 'manager@example.com',
        name: 'Manager',
        status: 'active',
      })
      const director = await createUser(graph, {
        email: 'director@example.com',
        name: 'Director',
        status: 'active',
      })

      const { thing } = await createApprovalRequest(
        graph,
        {
          title: 'Escalation Test',
          message: 'Will be escalated',
          type: 'approval',
          priority: 'high',
          requesterId: 'agent-001',
        },
        { targetId: manager.id }
      )

      const escalationRel = await escalateApproval(graph, thing.id, {
        toUserId: director.id,
        reason: 'Exceeds approval limit',
        escalatedBy: manager.id,
      })

      expect(escalationRel.verb).toBe(HUMAN_VERBS.ESCALATED)
      expect((escalationRel.data as { level: number }).level).toBe(1)
    })

    it('tracks escalation chain via relationships', async () => {
      const support = await createUser(graph, {
        email: 'support@example.com',
        name: 'Support',
        status: 'active',
      })
      const manager = await createUser(graph, {
        email: 'manager@example.com',
        name: 'Manager',
        status: 'active',
      })
      const director = await createUser(graph, {
        email: 'director@example.com',
        name: 'Director',
        status: 'active',
      })

      const { thing } = await createApprovalRequest(
        graph,
        {
          title: 'Multi-Escalation',
          message: 'Complex issue',
          type: 'approval',
          priority: 'urgent',
          requesterId: 'agent-001',
        },
        { targetId: support.id }
      )

      // First escalation: support -> manager
      await escalateApproval(graph, thing.id, {
        toUserId: manager.id,
        reason: 'Beyond support scope',
        escalatedBy: support.id,
      })

      // Second escalation: manager -> director
      await escalateApproval(graph, thing.id, {
        toUserId: director.id,
        reason: 'Requires executive approval',
        escalatedBy: manager.id,
      })

      // Import getEscalationChain
      const { getEscalationChain } = await import('../../db/graph/humans/approval')
      const chain = await getEscalationChain(graph, thing.id)

      expect(chain).toHaveLength(2)
      expect((chain[0]!.relationship.data as { level: number }).level).toBe(1)
      expect((chain[1]!.relationship.data as { level: number }).level).toBe(2)
    })
  })

  // ==========================================================================
  // SECTION 8: Invalid State Transitions
  // ==========================================================================

  describe('Invalid State Transitions', () => {
    it('prevents transitioning from completed state', async () => {
      const approver = await createUser(graph, {
        email: 'approver@example.com',
        name: 'Approver',
        status: 'active',
      })

      const { thing } = await createApprovalRequest(
        graph,
        {
          title: 'Already Approved',
          message: 'This is done',
          type: 'approval',
          priority: 'normal',
          requesterId: 'agent-001',
        },
        { targetId: approver.id }
      )

      await approve(graph, thing.id, approver.id)

      // Attempting to start review on completed request should fail
      await expect(startReview(graph, thing.id, approver.id)).rejects.toThrow()
    })

    it('prevents assigning already assigned task', async () => {
      const { thing } = await createTaskRequest(graph, {
        title: 'Already Assigned',
        instructions: 'Do work',
        requesterId: 'agent-001',
        priority: 'normal',
      })

      await assignTask(graph, thing.id, 'human-worker-1')

      // Attempting to assign again should fail
      await expect(assignTask(graph, thing.id, 'human-worker-2')).rejects.toThrow()
    })

    it('prevents completing task that is not in progress', async () => {
      const { thing } = await createTaskRequest(graph, {
        title: 'Not Started',
        instructions: 'Do work',
        requesterId: 'agent-001',
        priority: 'normal',
      })

      // Attempting to complete pending task should fail
      await expect(
        completeTask(graph, thing.id, {
          completedBy: 'human-worker',
          completedAt: Date.now(),
        })
      ).rejects.toThrow()
    })

    it('prevents making decision on already decided request', async () => {
      const { thing } = await createDecisionRequest(graph, {
        title: 'Already Decided',
        question: 'What?',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        requesterId: 'agent-001',
        priority: 'normal',
      })

      await makeDecision(graph, thing.id, {
        selectedOptionId: 'a',
        decidedBy: 'human-decider',
        decidedAt: Date.now(),
      })

      // Attempting to decide again should fail
      await expect(
        makeDecision(graph, thing.id, {
          selectedOptionId: 'b',
          decidedBy: 'human-decider',
          decidedAt: Date.now(),
        })
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // SECTION 9: SLA and Deadline Tracking in Thing Data
  // ==========================================================================

  describe('SLA and Deadline Tracking in Thing Data', () => {
    it('stores SLA and deadline in approval request Thing', async () => {
      const { thing } = await createApprovalRequest(graph, {
        title: 'SLA Test',
        message: 'Has deadline',
        type: 'approval',
        priority: 'urgent',
        requesterId: 'agent-001',
        sla: 2 * 60 * 60 * 1000, // 2 hours
      })

      const data = thing.data as ApprovalRequestThingData
      expect(data.sla).toBe(2 * 60 * 60 * 1000)
      expect(data.deadline).toBeDefined()
      expect(data.deadline).toBeGreaterThan(Date.now())
    })

    it('stores timestamps for SLA tracking in task request', async () => {
      const { thing } = await createTaskRequest(graph, {
        title: 'Timestamped Task',
        instructions: 'Track all timestamps',
        requesterId: 'agent-001',
        priority: 'high',
        sla: 4 * 60 * 60 * 1000, // 4 hours
      })

      const data = thing.data as TaskRequestThingData
      expect(data.timestamps.createdAt).toBeDefined()
      expect(data.timestamps.assignedAt).toBeUndefined()
      expect(data.timestamps.startedAt).toBeUndefined()
      expect(data.timestamps.completedAt).toBeUndefined()

      // Assign and check timestamp
      await assignTask(graph, thing.id, 'human-worker')
      const assigned = await getTaskRequest(graph, thing.id)
      const assignedData = assigned!.data as TaskRequestThingData
      expect(assignedData.timestamps.assignedAt).toBeDefined()
    })
  })

  // ==========================================================================
  // SECTION 10: [RED] Additional RED Tests - Expected to Fail
  // ==========================================================================

  describe('[RED] Verb Form Request Lifecycle Audit Trail', () => {
    it.todo('[RED] should record all verb transitions in audit history')

    it.todo('[RED] should track which user triggered each state transition')

    it.todo('[RED] should maintain complete history when request is reassigned')
  })

  describe('[RED] Request Thing with Context and Artifacts', () => {
    it.todo('[RED] should store artifacts (files, links) attached to request')

    it.todo('[RED] should link request Thing to related workflow instance')

    it.todo('[RED] should support request chaining (approval triggers task)')
  })

  describe('[RED] Priority-Based Request Ordering', () => {
    it('[RED] orders pending approvals by priority (urgent > high > normal > low)', async () => {
      const approver = await createUser(graph, {
        email: 'approver@example.com',
        name: 'Approver',
        status: 'active',
      })

      // Create requests in non-priority order
      await createApprovalRequest(
        graph,
        {
          title: 'Normal Priority',
          message: 'Normal',
          type: 'approval',
          priority: 'normal',
          requesterId: 'agent-001',
        },
        { targetId: approver.id }
      )

      await createApprovalRequest(
        graph,
        {
          title: 'Urgent Priority',
          message: 'Urgent',
          type: 'approval',
          priority: 'urgent',
          requesterId: 'agent-002',
        },
        { targetId: approver.id }
      )

      await createApprovalRequest(
        graph,
        {
          title: 'Low Priority',
          message: 'Low',
          type: 'approval',
          priority: 'low',
          requesterId: 'agent-003',
        },
        { targetId: approver.id }
      )

      await createApprovalRequest(
        graph,
        {
          title: 'High Priority',
          message: 'High',
          type: 'approval',
          priority: 'high',
          requesterId: 'agent-004',
        },
        { targetId: approver.id }
      )

      const pending = await getPendingApprovals(graph, approver.id)

      expect(pending).toHaveLength(4)
      // [RED] Should be sorted: urgent, high, normal, low
      const priorities = pending.map(p => (p.data as ApprovalRequestThingData).priority)
      expect(priorities).toEqual(['urgent', 'high', 'normal', 'low'])
    })

    it('[RED] orders pending tasks by deadline when priority is equal', async () => {
      const now = Date.now()

      // Create tasks with same priority but different deadlines
      const { thing: laterTask } = await createTaskRequest(graph, {
        title: 'Later Task',
        instructions: 'Due later',
        requesterId: 'agent-001',
        targetUserId: 'human-worker',
        priority: 'normal',
        deadline: now + 4 * 60 * 60 * 1000, // 4 hours from now
      })

      const { thing: soonerTask } = await createTaskRequest(graph, {
        title: 'Sooner Task',
        instructions: 'Due sooner',
        requesterId: 'agent-002',
        targetUserId: 'human-worker',
        priority: 'normal',
        deadline: now + 1 * 60 * 60 * 1000, // 1 hour from now
      })

      const { getPendingTasks } = await import('../../db/graph/humans/hitl')
      const pending = await getPendingTasks(graph, 'human-worker')

      expect(pending).toHaveLength(2)
      // [RED] Should be sorted by deadline - sooner first
      const titles = pending.map(t => (t.data as TaskRequestThingData).title)
      expect(titles[0]).toBe('Sooner Task')
    })
  })

  describe('[RED] Batch Request Operations', () => {
    it.todo('[RED] should approve multiple requests in single operation')

    it.todo('[RED] should reject multiple requests with single reason')

    it.todo('[RED] should reassign batch of tasks to different worker')
  })

  describe('[RED] Request Cancellation with Verb Form', () => {
    it('[RED] transitions to cancelled verb on explicit cancellation', async () => {
      const approver = await createUser(graph, {
        email: 'approver@example.com',
        name: 'Approver',
        status: 'active',
      })

      const { thing } = await createApprovalRequest(
        graph,
        {
          title: 'Cancellable Request',
          message: 'May be cancelled',
          type: 'approval',
          priority: 'normal',
          requesterId: 'agent-001',
        },
        { targetId: approver.id }
      )

      // [RED] This function may not exist yet - tests expected cancellation behavior
      const { cancelApproval } = await import('../../db/graph/humans')
      await cancelApproval(graph, thing.id, 'No longer needed')

      const status = await getApprovalStatus(graph, thing.id)
      // [RED] Should have cancelled status with cancelled verb
      expect(status.status).toBe('cancelled')
      expect(status.relationship?.verb).toBe('cancelled')
    })

    it.todo('[RED] should allow cancellation only from pending or in-progress states')

    it.todo('[RED] should record cancellation reason and timestamp in Thing')
  })

  describe('[RED] Request Delegation', () => {
    it.todo('[RED] should delegate pending request to another approver')

    it.todo('[RED] should maintain delegation chain in relationships')

    it.todo('[RED] should delegate in-progress review to another reviewer')
  })

  describe('[RED] Human Request Notifications', () => {
    it.todo('[RED] should create notification relationship when request is created')

    it.todo('[RED] should create reminder notification when SLA warning threshold reached')

    it.todo('[RED] should create escalation notification when SLA breached')
  })
})
