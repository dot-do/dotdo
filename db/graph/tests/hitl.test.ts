/**
 * Human-in-the-Loop Graph Integration Tests
 *
 * Comprehensive tests for human requests (Task, Decision, Review) with
 * verb form state encoding, escalation chains, and SLA tracking.
 *
 * NO MOCKS - uses real SQLite via SQLiteGraphStore
 *
 * @see dotdo-z9jo6 - Human-in-the-Loop Graph Integration epic
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import type { GraphStore } from '../types'
import {
  // Types
  HUMAN_VERBS,
  HumanUrls,
  DEFAULT_SLA_CONFIG,
  type TaskRequestThingData,
  type TaskTimestamps,
  type TaskResponse,
  type TaskState,
  type DecisionRequestThingData,
  type DecisionOption,
  type DecisionResult,
  type ReviewRequestThingData,
  type ReviewResult,
  type NotificationDeliveryData,
  // Type guards
  isTaskRequestThingData,
  isDecisionRequestThingData,
  isReviewRequestThingData,
  isHumanRequestThingData,
  // HITL operations
  REQUEST_TYPE_IDS,
  REQUEST_TYPE_NAMES,
  REQUEST_VERB_FORMS,
  getStateFromVerb,
  transitionVerb,
  // Task operations
  createTaskRequest,
  getTaskRequest,
  assignTask,
  startTask,
  completeTask,
  escalateTaskRequest,
  getTaskEscalationChain,
  getPendingTasks,
  getTaskSLAStatus,
  // Decision operations
  createDecisionRequest,
  getDecisionRequest,
  startDecision,
  makeDecision,
  getPendingDecisions,
  getDecisionSLAStatus,
  // Review operations
  createReviewRequest,
  getReviewRequest,
  startReviewRequest,
  completeReview,
  getPendingReviews,
  getReviewSLAStatus,
  // SLA tracking
  calculateSLAStatus,
  calculateTimeMetrics,
  // Notification tracking
  recordRequestNotification,
  getRequestNotificationHistory,
  // Unified queries
  getAllPendingRequests,
  // User operations for setup
  createUser,
} from '../humans'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('Human-in-the-Loop Graph Integration', () => {
  let graph: GraphStore

  beforeEach(async () => {
    // Create in-memory SQLite GraphStore
    graph = new SQLiteGraphStore(':memory:')
    await graph.initialize()
  })

  afterEach(async () => {
    // SQLiteGraphStore handles its own cleanup
  })

  // ==========================================================================
  // VERB FORM STATE MACHINE TESTS
  // ==========================================================================

  describe('Verb Form State Machine', () => {
    describe('getStateFromVerb', () => {
      it('returns pending for action verbs', () => {
        expect(getStateFromVerb(HUMAN_VERBS.APPROVE)).toBe('pending')
        expect(getStateFromVerb(HUMAN_VERBS.ASSIGN)).toBe('pending')
        expect(getStateFromVerb(HUMAN_VERBS.DECIDE)).toBe('pending')
        expect(getStateFromVerb(HUMAN_VERBS.REVIEW)).toBe('pending')
        expect(getStateFromVerb(HUMAN_VERBS.REQUEST)).toBe('pending')
      })

      it('returns in_progress for activity verbs', () => {
        expect(getStateFromVerb(HUMAN_VERBS.APPROVING)).toBe('in_progress')
        expect(getStateFromVerb(HUMAN_VERBS.ASSIGNING)).toBe('in_progress')
        expect(getStateFromVerb(HUMAN_VERBS.DECIDING)).toBe('in_progress')
        expect(getStateFromVerb(HUMAN_VERBS.REVIEWING)).toBe('in_progress')
        expect(getStateFromVerb(HUMAN_VERBS.ESCALATING)).toBe('in_progress')
      })

      it('returns completed for event verbs', () => {
        expect(getStateFromVerb(HUMAN_VERBS.APPROVED)).toBe('completed')
        expect(getStateFromVerb(HUMAN_VERBS.ASSIGNED)).toBe('completed')
        expect(getStateFromVerb(HUMAN_VERBS.DECIDED)).toBe('completed')
        expect(getStateFromVerb(HUMAN_VERBS.REVIEWED)).toBe('completed')
        expect(getStateFromVerb(HUMAN_VERBS.COMPLETED)).toBe('completed')
      })

      it('returns rejected for rejected verb', () => {
        expect(getStateFromVerb(HUMAN_VERBS.REJECTED)).toBe('rejected')
      })
    })

    describe('transitionVerb', () => {
      it('transitions action to activity on start', () => {
        expect(transitionVerb(HUMAN_VERBS.APPROVE, 'start')).toBe(HUMAN_VERBS.APPROVING)
        expect(transitionVerb(HUMAN_VERBS.ASSIGN, 'start')).toBe(HUMAN_VERBS.ASSIGNING)
        expect(transitionVerb(HUMAN_VERBS.DECIDE, 'start')).toBe(HUMAN_VERBS.DECIDING)
        expect(transitionVerb(HUMAN_VERBS.REVIEW, 'start')).toBe(HUMAN_VERBS.REVIEWING)
      })

      it('transitions activity to event on complete', () => {
        expect(transitionVerb(HUMAN_VERBS.APPROVING, 'complete')).toBe(HUMAN_VERBS.APPROVED)
        expect(transitionVerb(HUMAN_VERBS.ASSIGNING, 'complete')).toBe(HUMAN_VERBS.ASSIGNED)
        expect(transitionVerb(HUMAN_VERBS.DECIDING, 'complete')).toBe(HUMAN_VERBS.DECIDED)
        expect(transitionVerb(HUMAN_VERBS.REVIEWING, 'complete')).toBe(HUMAN_VERBS.REVIEWED)
      })

      it('transitions action directly to event on immediate complete', () => {
        expect(transitionVerb(HUMAN_VERBS.APPROVE, 'complete')).toBe(HUMAN_VERBS.APPROVED)
        expect(transitionVerb(HUMAN_VERBS.DECIDE, 'complete')).toBe(HUMAN_VERBS.DECIDED)
      })

      it('transitions to rejected on reject', () => {
        expect(transitionVerb(HUMAN_VERBS.APPROVE, 'reject')).toBe(HUMAN_VERBS.REJECTED)
        expect(transitionVerb(HUMAN_VERBS.APPROVING, 'reject')).toBe(HUMAN_VERBS.REJECTED)
      })

      it('transitions activity back to action on cancel', () => {
        expect(transitionVerb(HUMAN_VERBS.APPROVING, 'cancel')).toBe(HUMAN_VERBS.APPROVE)
        expect(transitionVerb(HUMAN_VERBS.DECIDING, 'cancel')).toBe(HUMAN_VERBS.DECIDE)
        expect(transitionVerb(HUMAN_VERBS.REVIEWING, 'cancel')).toBe(HUMAN_VERBS.REVIEW)
      })

      it('throws error when transitioning from completed state', () => {
        expect(() => transitionVerb(HUMAN_VERBS.APPROVED, 'start')).toThrow(/completed/)
        expect(() => transitionVerb(HUMAN_VERBS.DECIDED, 'complete')).toThrow(/completed/)
      })

      it('throws error when transitioning from rejected state', () => {
        expect(() => transitionVerb(HUMAN_VERBS.REJECTED, 'start')).toThrow(/rejected/)
      })

      it('throws error for invalid transition from in_progress', () => {
        expect(() => transitionVerb(HUMAN_VERBS.APPROVING, 'start')).toThrow(/pending/)
      })
    })
  })

  // ==========================================================================
  // TASK REQUEST TESTS
  // ==========================================================================

  describe('TaskRequest Thing', () => {
    describe('createTaskRequest', () => {
      it('creates a TaskRequest Thing with correct type and initial state', async () => {
        const { thing, relationship } = await createTaskRequest(graph, {
          title: 'Review PR #123',
          instructions: 'Please review the code changes',
          requesterId: 'user-1',
          priority: 'high',
        })

        expect(thing).toBeDefined()
        expect(thing.typeName).toBe(REQUEST_TYPE_NAMES.task)
        expect(thing.typeId).toBe(REQUEST_TYPE_IDS.task)

        const data = thing.data as TaskRequestThingData
        expect(data.title).toBe('Review PR #123')
        expect(data.instructions).toBe('Please review the code changes')
        expect(data.state).toBe('pending')
        expect(data.priority).toBe('high')
        expect(data.timestamps.createdAt).toBeDefined()
      })

      it('creates TaskRequest with tools array', async () => {
        const { thing } = await createTaskRequest(graph, {
          title: 'Debug issue',
          instructions: 'Find and fix the bug',
          tools: ['debugger', 'profiler', 'logs'],
          requesterId: 'user-1',
        })

        const data = thing.data as TaskRequestThingData
        expect(data.tools).toEqual(['debugger', 'profiler', 'logs'])
      })

      it('creates TaskRequest with estimated effort', async () => {
        const { thing } = await createTaskRequest(graph, {
          title: 'Write tests',
          instructions: 'Add unit tests for the module',
          estimatedEffort: 60, // 60 minutes
          requesterId: 'user-1',
        })

        const data = thing.data as TaskRequestThingData
        expect(data.estimatedEffort).toBe(60)
      })

      it('creates initial assignment relationship with assign verb', async () => {
        const { relationship } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Do something',
          requesterId: 'user-1',
          targetUserId: 'user-2',
        })

        expect(relationship.verb).toBe(HUMAN_VERBS.ASSIGN)
        expect(relationship.to).toBe(HumanUrls.user('user-2'))
      })

      it('calculates deadline from SLA', async () => {
        const now = Date.now()
        const { thing } = await createTaskRequest(graph, {
          title: 'Urgent task',
          instructions: 'Do it now',
          requesterId: 'user-1',
          priority: 'urgent',
        })

        const data = thing.data as TaskRequestThingData
        const expectedDeadline = now + DEFAULT_SLA_CONFIG.byPriority.urgent
        // Allow 1 second tolerance
        expect(Math.abs(data.deadline! - expectedDeadline)).toBeLessThan(1000)
      })
    })

    describe('getTaskRequest', () => {
      it('retrieves a task request by ID', async () => {
        const { thing: created } = await createTaskRequest(graph, {
          title: 'Test task',
          instructions: 'Test instructions',
          requesterId: 'user-1',
        })

        const found = await getTaskRequest(graph, created.id)
        expect(found).toBeDefined()
        expect(found!.id).toBe(created.id)
      })

      it('returns null for non-existent task', async () => {
        const found = await getTaskRequest(graph, 'non-existent')
        expect(found).toBeNull()
      })
    })

    describe('assignTask', () => {
      it('transitions task from pending to assigned', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        const { thing: assigned, relationship } = await assignTask(graph, task.id, 'assignee-1')

        const data = assigned.data as TaskRequestThingData
        expect(data.state).toBe('assigned')
        expect(data.targetUserId).toBe('assignee-1')
        expect(data.timestamps.assignedAt).toBeDefined()
        expect(relationship.verb).toBe(HUMAN_VERBS.ASSIGNED)
      })

      it('records first response timestamp on assignment', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        const { thing: assigned } = await assignTask(graph, task.id, 'assignee-1')

        const data = assigned.data as TaskRequestThingData
        expect(data.timestamps.firstResponseAt).toBeDefined()
        expect(data.timestamps.firstResponseAt).toBe(data.timestamps.assignedAt)
      })

      it('throws error when assigning non-pending task', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        await assignTask(graph, task.id, 'assignee-1')
        await startTask(graph, task.id, 'assignee-1')

        await expect(assignTask(graph, task.id, 'other-assignee')).rejects.toThrow(/Cannot assign/)
      })
    })

    describe('startTask', () => {
      it('transitions task from assigned to in_progress', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        await assignTask(graph, task.id, 'worker-1')
        const started = await startTask(graph, task.id, 'worker-1')

        const data = started.data as TaskRequestThingData
        expect(data.state).toBe('in_progress')
        expect(data.timestamps.startedAt).toBeDefined()
      })

      it('can start directly from pending', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        const started = await startTask(graph, task.id, 'worker-1')

        const data = started.data as TaskRequestThingData
        expect(data.state).toBe('in_progress')
        expect(data.timestamps.assignedAt).toBeDefined()
        expect(data.timestamps.startedAt).toBeDefined()
      })
    })

    describe('completeTask', () => {
      it('transitions task from in_progress to completed', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        await startTask(graph, task.id, 'worker-1')

        const response: TaskResponse = {
          completedBy: 'worker-1',
          completedAt: Date.now(),
          result: { success: true },
          notes: 'All done!',
        }

        const { thing: completed, relationship } = await completeTask(graph, task.id, response)

        const data = completed.data as TaskRequestThingData
        expect(data.state).toBe('completed')
        expect(data.timestamps.completedAt).toBeDefined()
        expect(data.response).toBeDefined()
        expect(data.response?.notes).toBe('All done!')
        expect(relationship.verb).toBe(HUMAN_VERBS.COMPLETED)
      })

      it('throws error when completing pending task', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        await expect(
          completeTask(graph, task.id, {
            completedBy: 'worker-1',
            completedAt: Date.now(),
          })
        ).rejects.toThrow(/Cannot complete/)
      })
    })

    describe('Task State Transitions (Full Lifecycle)', () => {
      it('completes full task lifecycle: pending -> assigned -> in_progress -> completed', async () => {
        // Create
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Full lifecycle task',
          instructions: 'Complete all steps',
          requesterId: 'user-1',
        })
        expect((task.data as TaskRequestThingData).state).toBe('pending')

        // Assign
        const { thing: assigned } = await assignTask(graph, task.id, 'worker-1')
        expect((assigned.data as TaskRequestThingData).state).toBe('assigned')

        // Start
        const started = await startTask(graph, task.id, 'worker-1')
        expect((started.data as TaskRequestThingData).state).toBe('in_progress')

        // Complete
        const { thing: completed } = await completeTask(graph, task.id, {
          completedBy: 'worker-1',
          completedAt: Date.now(),
          result: 'Task completed successfully',
        })
        expect((completed.data as TaskRequestThingData).state).toBe('completed')
      })
    })
  })

  // ==========================================================================
  // DECISION REQUEST TESTS
  // ==========================================================================

  describe('DecisionRequest Thing', () => {
    const testOptions: DecisionOption[] = [
      { id: 'opt-a', label: 'Option A', description: 'First option' },
      { id: 'opt-b', label: 'Option B', description: 'Second option' },
      { id: 'opt-c', label: 'Option C', description: 'Third option' },
    ]

    describe('createDecisionRequest', () => {
      it('creates a DecisionRequest Thing with options', async () => {
        const { thing, relationship } = await createDecisionRequest(graph, {
          title: 'Architecture Decision',
          question: 'Which database should we use?',
          options: testOptions,
          requesterId: 'user-1',
        })

        expect(thing).toBeDefined()
        expect(thing.typeName).toBe(REQUEST_TYPE_NAMES.decision)

        const data = thing.data as DecisionRequestThingData
        expect(data.title).toBe('Architecture Decision')
        expect(data.question).toBe('Which database should we use?')
        expect(data.options).toHaveLength(3)
        expect(data.timestamps.createdAt).toBeDefined()
      })

      it('creates DecisionRequest with criteria', async () => {
        const { thing } = await createDecisionRequest(graph, {
          title: 'Vendor Selection',
          question: 'Which vendor to choose?',
          options: testOptions,
          criteria: ['cost', 'reliability', 'support'],
          requesterId: 'user-1',
        })

        const data = thing.data as DecisionRequestThingData
        expect(data.criteria).toEqual(['cost', 'reliability', 'support'])
      })

      it('creates initial relationship with decide verb', async () => {
        const { relationship } = await createDecisionRequest(graph, {
          title: 'Decision',
          question: 'What to do?',
          options: testOptions,
          requesterId: 'user-1',
          targetUserId: 'decider-1',
        })

        expect(relationship.verb).toBe(HUMAN_VERBS.DECIDE)
        expect(relationship.to).toBe(HumanUrls.user('decider-1'))
      })
    })

    describe('startDecision', () => {
      it('transitions decide -> deciding and records timestamps', async () => {
        const { thing: decision } = await createDecisionRequest(graph, {
          title: 'Decision',
          question: 'What to do?',
          options: testOptions,
          requesterId: 'user-1',
        })

        const relationship = await startDecision(graph, decision.id, 'decider-1')

        expect(relationship.verb).toBe(HUMAN_VERBS.DECIDING)

        const updated = await getDecisionRequest(graph, decision.id)
        const data = updated!.data as DecisionRequestThingData
        expect(data.timestamps.assignedAt).toBeDefined()
        expect(data.timestamps.firstResponseAt).toBeDefined()
      })
    })

    describe('makeDecision', () => {
      it('transitions deciding -> decided with selected option', async () => {
        const { thing: decision } = await createDecisionRequest(graph, {
          title: 'Decision',
          question: 'What to do?',
          options: testOptions,
          requesterId: 'user-1',
        })

        await startDecision(graph, decision.id, 'decider-1')

        const result: DecisionResult = {
          selectedOptionId: 'opt-b',
          decidedBy: 'decider-1',
          decidedAt: Date.now(),
          reasoning: 'Option B best fits our needs',
          confidence: 0.85,
        }

        const { thing: decided, relationship } = await makeDecision(graph, decision.id, result)

        expect(relationship.verb).toBe(HUMAN_VERBS.DECIDED)

        const data = decided.data as DecisionRequestThingData
        expect(data.decision).toBeDefined()
        expect(data.decision?.selectedOptionId).toBe('opt-b')
        expect(data.decision?.reasoning).toBe('Option B best fits our needs')
        expect(data.decision?.confidence).toBe(0.85)
        expect(data.timestamps.decidedAt).toBeDefined()
      })

      it('throws error for invalid option ID', async () => {
        const { thing: decision } = await createDecisionRequest(graph, {
          title: 'Decision',
          question: 'What to do?',
          options: testOptions,
          requesterId: 'user-1',
        })

        await expect(
          makeDecision(graph, decision.id, {
            selectedOptionId: 'invalid-option',
            decidedBy: 'decider-1',
            decidedAt: Date.now(),
          })
        ).rejects.toThrow(/Invalid option ID/)
      })

      it('throws error when decision already made', async () => {
        const { thing: decision } = await createDecisionRequest(graph, {
          title: 'Decision',
          question: 'What to do?',
          options: testOptions,
          requesterId: 'user-1',
        })

        await makeDecision(graph, decision.id, {
          selectedOptionId: 'opt-a',
          decidedBy: 'decider-1',
          decidedAt: Date.now(),
        })

        await expect(
          makeDecision(graph, decision.id, {
            selectedOptionId: 'opt-b',
            decidedBy: 'decider-1',
            decidedAt: Date.now(),
          })
        ).rejects.toThrow(/already made/)
      })
    })
  })

  // ==========================================================================
  // REVIEW REQUEST TESTS
  // ==========================================================================

  describe('ReviewRequest Thing', () => {
    describe('createReviewRequest', () => {
      it('creates a ReviewRequest Thing with content and reviewType', async () => {
        const { thing, relationship } = await createReviewRequest(graph, {
          title: 'Code Review',
          content: 'function add(a, b) { return a + b; }',
          reviewType: 'code',
          requesterId: 'user-1',
        })

        expect(thing).toBeDefined()
        expect(thing.typeName).toBe(REQUEST_TYPE_NAMES.review)

        const data = thing.data as ReviewRequestThingData
        expect(data.title).toBe('Code Review')
        expect(data.content).toBe('function add(a, b) { return a + b; }')
        expect(data.reviewType).toBe('code')
        expect(data.timestamps.createdAt).toBeDefined()
      })

      it('creates ReviewRequest with criteria', async () => {
        const { thing } = await createReviewRequest(graph, {
          title: 'Legal Review',
          content: 'Contract terms...',
          reviewType: 'legal',
          criteria: ['compliance', 'liability', 'termination-clause'],
          requesterId: 'user-1',
        })

        const data = thing.data as ReviewRequestThingData
        expect(data.criteria).toEqual(['compliance', 'liability', 'termination-clause'])
      })

      it('supports all review types', async () => {
        const reviewTypes = ['code', 'content', 'design', 'legal', 'security', 'quality', 'other'] as const

        for (const reviewType of reviewTypes) {
          const { thing } = await createReviewRequest(graph, {
            title: `${reviewType} review`,
            content: 'Content to review',
            reviewType,
            requesterId: 'user-1',
          })

          const data = thing.data as ReviewRequestThingData
          expect(data.reviewType).toBe(reviewType)
        }
      })
    })

    describe('startReviewRequest', () => {
      it('transitions review -> reviewing', async () => {
        const { thing: review } = await createReviewRequest(graph, {
          title: 'Review',
          content: 'Content',
          reviewType: 'code',
          requesterId: 'user-1',
        })

        const relationship = await startReviewRequest(graph, review.id, 'reviewer-1')

        expect(relationship.verb).toBe(HUMAN_VERBS.REVIEWING)

        const updated = await getReviewRequest(graph, review.id)
        const data = updated!.data as ReviewRequestThingData
        expect(data.timestamps.startedAt).toBeDefined()
        expect(data.timestamps.assignedAt).toBeDefined()
      })
    })

    describe('completeReview', () => {
      it('transitions reviewing -> reviewed with approval', async () => {
        const { thing: review } = await createReviewRequest(graph, {
          title: 'Review',
          content: 'Content',
          reviewType: 'code',
          requesterId: 'user-1',
        })

        await startReviewRequest(graph, review.id, 'reviewer-1')

        const result: ReviewResult = {
          reviewedBy: 'reviewer-1',
          reviewedAt: Date.now(),
          approved: true,
          score: 95,
          feedback: 'Excellent code quality!',
        }

        const { thing: reviewed, relationship } = await completeReview(graph, review.id, result)

        expect(relationship.verb).toBe(HUMAN_VERBS.REVIEWED)

        const data = reviewed.data as ReviewRequestThingData
        expect(data.review).toBeDefined()
        expect(data.review?.approved).toBe(true)
        expect(data.review?.score).toBe(95)
        expect(data.review?.feedback).toBe('Excellent code quality!')
        expect(data.timestamps.completedAt).toBeDefined()
      })

      it('transitions reviewing -> reviewed with rejection and issues', async () => {
        const { thing: review } = await createReviewRequest(graph, {
          title: 'Review',
          content: 'Content',
          reviewType: 'code',
          requesterId: 'user-1',
        })

        await startReviewRequest(graph, review.id, 'reviewer-1')

        const result: ReviewResult = {
          reviewedBy: 'reviewer-1',
          reviewedAt: Date.now(),
          approved: false,
          score: 45,
          feedback: 'Needs improvement',
          issues: [
            { type: 'error', description: 'Missing error handling', severity: 4 },
            { type: 'warning', description: 'No tests', severity: 3 },
            { type: 'suggestion', description: 'Consider using const', severity: 1 },
          ],
        }

        const { thing: reviewed } = await completeReview(graph, review.id, result)

        const data = reviewed.data as ReviewRequestThingData
        expect(data.review?.approved).toBe(false)
        expect(data.review?.issues).toHaveLength(3)
        expect(data.review?.issues![0].type).toBe('error')
      })
    })
  })

  // ==========================================================================
  // SLA TRACKING TESTS
  // ==========================================================================

  describe('SLA Tracking', () => {
    describe('calculateSLAStatus', () => {
      it('calculates time remaining correctly', async () => {
        const now = Date.now()
        const { thing } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
          priority: 'normal',
          sla: 60000, // 1 minute
        })

        const status = calculateSLAStatus(thing.data as TaskRequestThingData)

        expect(status.breached).toBe(false)
        expect(status.timeRemaining).toBeGreaterThan(0)
        expect(status.consumed).toBeGreaterThanOrEqual(0)
        expect(status.consumed).toBeLessThan(1)
      })

      it('detects SLA breach', async () => {
        const pastDeadline = Date.now() - 10000 // 10 seconds ago
        const { thing } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
          deadline: pastDeadline,
          sla: 1000,
        })

        const data = thing.data as TaskRequestThingData
        // Override deadline for test
        data.deadline = pastDeadline

        const status = calculateSLAStatus(data)

        expect(status.breached).toBe(true)
        expect(status.timeRemaining).toBeLessThan(0)
      })

      it('detects warning zone', async () => {
        const now = Date.now()
        const sla = 100000 // 100 seconds
        const deadline = now + 20000 // Only 20% remaining (past 75% threshold)

        const { thing } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
          sla,
          deadline,
        })

        const data = thing.data as TaskRequestThingData

        const status = calculateSLAStatus(data)

        expect(status.warning).toBe(true)
        expect(status.breached).toBe(false)
      })
    })

    describe('getTaskSLAStatus', () => {
      it('returns SLA status for existing task', async () => {
        const { thing } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        const status = await getTaskSLAStatus(graph, thing.id)

        expect(status).toBeDefined()
        expect(status!.deadline).toBeDefined()
      })

      it('returns null for non-existent task', async () => {
        const status = await getTaskSLAStatus(graph, 'non-existent')
        expect(status).toBeNull()
      })
    })

    describe('calculateTimeMetrics', () => {
      it('calculates time to first response', () => {
        const timestamps: TaskTimestamps = {
          createdAt: 1000,
          firstResponseAt: 5000,
        }

        const metrics = calculateTimeMetrics(timestamps)

        expect(metrics.timeToFirstResponse).toBe(4000)
        expect(metrics.timeToCompletion).toBeNull()
      })

      it('calculates time to completion', () => {
        const timestamps: TaskTimestamps = {
          createdAt: 1000,
          firstResponseAt: 5000,
          completedAt: 10000,
        }

        const metrics = calculateTimeMetrics(timestamps)

        expect(metrics.timeToFirstResponse).toBe(4000)
        expect(metrics.timeToCompletion).toBe(9000)
      })

      it('calculates time per escalation', () => {
        const timestamps: TaskTimestamps = {
          createdAt: 1000,
          firstResponseAt: 5000,
          escalations: [
            { level: 1, escalatedAt: 3000, target: 'role-1' },
            { level: 2, escalatedAt: 6000, target: 'role-2' },
          ],
        }

        const metrics = calculateTimeMetrics(timestamps)

        expect(metrics.timePerEscalation).toHaveLength(2)
        expect(metrics.timePerEscalation[0]).toBe(2000) // 3000 - 1000
        expect(metrics.timePerEscalation[1]).toBe(3000) // 6000 - 3000
      })
    })
  })

  // ==========================================================================
  // ESCALATION TESTS
  // ==========================================================================

  describe('Escalation Chains', () => {
    describe('escalateTaskRequest', () => {
      it('escalates task to new target', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
          targetUserId: 'user-2',
        })

        const relationship = await escalateTaskRequest(graph, task.id, {
          toRole: 'manager',
          reason: 'No response',
          escalatedBy: 'system',
        })

        expect(relationship.verb).toBe(HUMAN_VERBS.ESCALATED)

        const updated = await getTaskRequest(graph, task.id)
        const data = updated!.data as TaskRequestThingData
        expect(data.targetRole).toBe('manager')
        expect(data.timestamps.escalations).toHaveLength(1)
        expect(data.timestamps.escalations![0].level).toBe(1)
      })

      it('tracks escalation level progression', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        // First escalation
        await escalateTaskRequest(graph, task.id, {
          toRole: 'manager',
          reason: 'Level 1',
        })

        // Second escalation
        await escalateTaskRequest(graph, task.id, {
          toRole: 'director',
          reason: 'Level 2',
        })

        const updated = await getTaskRequest(graph, task.id)
        const data = updated!.data as TaskRequestThingData
        expect(data.timestamps.escalations).toHaveLength(2)
        expect(data.timestamps.escalations![0].level).toBe(1)
        expect(data.timestamps.escalations![1].level).toBe(2)
      })

      it('throws error when escalating completed task', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        await startTask(graph, task.id, 'worker-1')
        await completeTask(graph, task.id, {
          completedBy: 'worker-1',
          completedAt: Date.now(),
        })

        await expect(
          escalateTaskRequest(graph, task.id, { toRole: 'manager' })
        ).rejects.toThrow(/Cannot escalate/)
      })
    })

    describe('getTaskEscalationChain', () => {
      it('retrieves escalation chain in order', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        await escalateTaskRequest(graph, task.id, { toRole: 'manager' })
        await escalateTaskRequest(graph, task.id, { toRole: 'director' })
        await escalateTaskRequest(graph, task.id, { toRole: 'vp' })

        const chain = await getTaskEscalationChain(graph, task.id)

        expect(chain).toHaveLength(3)
        expect((chain[0].relationship.data as any).level).toBe(1)
        expect((chain[1].relationship.data as any).level).toBe(2)
        expect((chain[2].relationship.data as any).level).toBe(3)
      })
    })
  })

  // ==========================================================================
  // NOTIFICATION TRACKING TESTS
  // ==========================================================================

  describe('Notification Tracking', () => {
    describe('recordRequestNotification', () => {
      it('records slack notification for task', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        const delivery: NotificationDeliveryData = {
          channel: 'slack',
          deliveredAt: Date.now(),
          messageId: 'slack-msg-123',
          status: 'delivered',
        }

        const relationship = await recordRequestNotification(graph, 'task', task.id, delivery)

        expect(relationship.verb).toBe(HUMAN_VERBS.NOTIFIED_VIA)
        expect(relationship.to).toContain('slack')
      })

      it('records email notification for decision', async () => {
        const { thing: decision } = await createDecisionRequest(graph, {
          title: 'Decision',
          question: 'What to do?',
          options: [{ id: 'opt-1', label: 'Option 1' }],
          requesterId: 'user-1',
        })

        const delivery: NotificationDeliveryData = {
          channel: 'email',
          deliveredAt: Date.now(),
          messageId: 'email-123',
          status: 'delivered',
        }

        const relationship = await recordRequestNotification(graph, 'decision', decision.id, delivery)

        expect(relationship.to).toContain('email')
      })

      it('records failed notification', async () => {
        const { thing: review } = await createReviewRequest(graph, {
          title: 'Review',
          content: 'Content',
          reviewType: 'code',
          requesterId: 'user-1',
        })

        const delivery: NotificationDeliveryData = {
          channel: 'sms',
          deliveredAt: Date.now(),
          status: 'failed',
          error: 'Invalid phone number',
        }

        await recordRequestNotification(graph, 'review', review.id, delivery)

        const history = await getRequestNotificationHistory(graph, 'review', review.id)
        expect(history).toHaveLength(1)
        expect(history[0].status).toBe('failed')
        expect(history[0].error).toBe('Invalid phone number')
      })
    })

    describe('getRequestNotificationHistory', () => {
      it('retrieves notification history for task', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
        })

        await recordRequestNotification(graph, 'task', task.id, {
          channel: 'slack',
          deliveredAt: Date.now(),
          status: 'delivered',
        })

        await recordRequestNotification(graph, 'task', task.id, {
          channel: 'email',
          deliveredAt: Date.now(),
          status: 'delivered',
        })

        const history = await getRequestNotificationHistory(graph, 'task', task.id)

        expect(history).toHaveLength(2)
        expect(history.map((h) => h.channel).sort()).toEqual(['email', 'slack'])
      })
    })
  })

  // ==========================================================================
  // QUERY HELPERS TESTS
  // ==========================================================================

  describe('Query Helpers', () => {
    describe('getPendingTasks', () => {
      it('returns pending tasks for user', async () => {
        // Create user
        await createUser(graph, { email: 'worker@test.com', name: 'Worker', status: 'active' })

        // Create tasks
        await createTaskRequest(graph, {
          title: 'Task 1',
          instructions: 'Do task 1',
          requesterId: 'user-1',
          targetUserId: 'worker@test.com',
        })

        await createTaskRequest(graph, {
          title: 'Task 2',
          instructions: 'Do task 2',
          requesterId: 'user-1',
          targetUserId: 'worker@test.com',
        })

        const pending = await getPendingTasks(graph, 'worker@test.com')

        expect(pending).toHaveLength(2)
      })

      it('excludes completed tasks', async () => {
        const { thing: task } = await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
          targetUserId: 'worker-1',
        })

        await startTask(graph, task.id, 'worker-1')
        await completeTask(graph, task.id, {
          completedBy: 'worker-1',
          completedAt: Date.now(),
        })

        const pending = await getPendingTasks(graph, 'worker-1')

        expect(pending).toHaveLength(0)
      })
    })

    describe('getPendingDecisions', () => {
      it('returns pending decisions for user', async () => {
        await createDecisionRequest(graph, {
          title: 'Decision 1',
          question: 'What to do?',
          options: [{ id: 'opt-1', label: 'Option 1' }],
          requesterId: 'user-1',
          targetUserId: 'decider-1',
        })

        await createDecisionRequest(graph, {
          title: 'Decision 2',
          question: 'What to choose?',
          options: [{ id: 'opt-2', label: 'Option 2' }],
          requesterId: 'user-1',
          targetUserId: 'decider-1',
        })

        const pending = await getPendingDecisions(graph, 'decider-1')

        expect(pending).toHaveLength(2)
      })
    })

    describe('getPendingReviews', () => {
      it('returns pending reviews for user', async () => {
        await createReviewRequest(graph, {
          title: 'Review 1',
          content: 'Content 1',
          reviewType: 'code',
          requesterId: 'user-1',
          targetUserId: 'reviewer-1',
        })

        const pending = await getPendingReviews(graph, 'reviewer-1')

        expect(pending).toHaveLength(1)
      })
    })

    describe('getAllPendingRequests', () => {
      it('returns all pending requests for user', async () => {
        await createTaskRequest(graph, {
          title: 'Task',
          instructions: 'Instructions',
          requesterId: 'user-1',
          targetUserId: 'worker-1',
        })

        await createDecisionRequest(graph, {
          title: 'Decision',
          question: 'What to do?',
          options: [{ id: 'opt-1', label: 'Option 1' }],
          requesterId: 'user-1',
          targetUserId: 'worker-1',
        })

        await createReviewRequest(graph, {
          title: 'Review',
          content: 'Content',
          reviewType: 'code',
          requesterId: 'user-1',
          targetUserId: 'worker-1',
        })

        const all = await getAllPendingRequests(graph, 'worker-1')

        expect(all.tasks).toHaveLength(1)
        expect(all.decisions).toHaveLength(1)
        expect(all.reviews).toHaveLength(1)
      })
    })
  })

  // ==========================================================================
  // TYPE GUARD TESTS
  // ==========================================================================

  describe('Type Guards', () => {
    it('isTaskRequestThingData correctly identifies task data', async () => {
      const { thing } = await createTaskRequest(graph, {
        title: 'Task',
        instructions: 'Instructions',
        requesterId: 'user-1',
      })

      expect(isTaskRequestThingData(thing.data)).toBe(true)
      expect(isDecisionRequestThingData(thing.data)).toBe(false)
      expect(isReviewRequestThingData(thing.data)).toBe(false)
    })

    it('isDecisionRequestThingData correctly identifies decision data', async () => {
      const { thing } = await createDecisionRequest(graph, {
        title: 'Decision',
        question: 'What?',
        options: [{ id: 'opt-1', label: 'Option 1' }],
        requesterId: 'user-1',
      })

      expect(isDecisionRequestThingData(thing.data)).toBe(true)
      expect(isTaskRequestThingData(thing.data)).toBe(false)
      expect(isReviewRequestThingData(thing.data)).toBe(false)
    })

    it('isReviewRequestThingData correctly identifies review data', async () => {
      const { thing } = await createReviewRequest(graph, {
        title: 'Review',
        content: 'Content',
        reviewType: 'code',
        requesterId: 'user-1',
      })

      expect(isReviewRequestThingData(thing.data)).toBe(true)
      expect(isTaskRequestThingData(thing.data)).toBe(false)
      expect(isDecisionRequestThingData(thing.data)).toBe(false)
    })

    it('isHumanRequestThingData identifies all request types', async () => {
      const { thing: task } = await createTaskRequest(graph, {
        title: 'Task',
        instructions: 'Instructions',
        requesterId: 'user-1',
      })

      const { thing: decision } = await createDecisionRequest(graph, {
        title: 'Decision',
        question: 'What?',
        options: [{ id: 'opt-1', label: 'Option 1' }],
        requesterId: 'user-1',
      })

      const { thing: review } = await createReviewRequest(graph, {
        title: 'Review',
        content: 'Content',
        reviewType: 'code',
        requesterId: 'user-1',
      })

      expect(isHumanRequestThingData(task.data)).toBe(true)
      expect(isHumanRequestThingData(decision.data)).toBe(true)
      expect(isHumanRequestThingData(review.data)).toBe(true)
      expect(isHumanRequestThingData({ invalid: 'data' })).toBe(false)
    })
  })

  // ==========================================================================
  // URL SCHEME TESTS
  // ==========================================================================

  describe('HumanUrls', () => {
    it('generates correct task URL', () => {
      expect(HumanUrls.task('task-123')).toBe('requests://tasks/task-123')
    })

    it('generates correct decision URL', () => {
      expect(HumanUrls.decision('decision-456')).toBe('requests://decisions/decision-456')
    })

    it('generates correct review URL', () => {
      expect(HumanUrls.review('review-789')).toBe('requests://reviews/review-789')
    })

    it('extracts correct type from task URL', () => {
      expect(HumanUrls.extractType('requests://tasks/task-123')).toBe('TaskRequest')
    })

    it('extracts correct type from decision URL', () => {
      expect(HumanUrls.extractType('requests://decisions/decision-456')).toBe('DecisionRequest')
    })

    it('extracts correct type from review URL', () => {
      expect(HumanUrls.extractType('requests://reviews/review-789')).toBe('ReviewRequest')
    })

    it('extracts ID from URL', () => {
      expect(HumanUrls.extractId('requests://tasks/task-123')).toBe('task-123')
    })
  })

  // ==========================================================================
  // REQUEST_VERB_FORMS CONSTANTS TESTS
  // ==========================================================================

  describe('REQUEST_VERB_FORMS', () => {
    it('has correct forms for approval', () => {
      expect(REQUEST_VERB_FORMS.approval.action).toBe('approve')
      expect(REQUEST_VERB_FORMS.approval.activity).toBe('approving')
      expect(REQUEST_VERB_FORMS.approval.event).toBe('approved')
    })

    it('has correct forms for task', () => {
      expect(REQUEST_VERB_FORMS.task.action).toBe('assign')
      expect(REQUEST_VERB_FORMS.task.activity).toBe('assigning')
      expect(REQUEST_VERB_FORMS.task.event).toBe('assigned')
      expect(REQUEST_VERB_FORMS.task.complete).toBe('complete')
      expect(REQUEST_VERB_FORMS.task.completed).toBe('completed')
    })

    it('has correct forms for decision', () => {
      expect(REQUEST_VERB_FORMS.decision.action).toBe('decide')
      expect(REQUEST_VERB_FORMS.decision.activity).toBe('deciding')
      expect(REQUEST_VERB_FORMS.decision.event).toBe('decided')
    })

    it('has correct forms for review', () => {
      expect(REQUEST_VERB_FORMS.review.action).toBe('review')
      expect(REQUEST_VERB_FORMS.review.activity).toBe('reviewing')
      expect(REQUEST_VERB_FORMS.review.event).toBe('reviewed')
    })
  })
})
