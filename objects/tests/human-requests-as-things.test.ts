/**
 * Human Request Things with Verb Form State Machine Tests
 *
 * Tests for human request types (ApprovalRequest, TaskRequest, DecisionRequest, ReviewRequest)
 * as Things with verb form state transitions.
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
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  HumanRequestStateMachine,
  ApprovalRequestStateMachine,
  TaskRequestStateMachine,
  DecisionRequestStateMachine,
  ReviewRequestStateMachine,
  transitionTo,
  validateTransition,
  getRequestState,
  type HumanRequestThing,
  type ApprovalRequestThing,
  type TaskRequestThing,
  type DecisionRequestThing,
  type ReviewRequestThing,
  type RequestVerbForm,
  HUMAN_REQUEST_VERBS,
} from '../../db/human-request-things'

// ============================================================================
// TEST SUITE: Human Request Thing Types
// ============================================================================

describe('Human Request Thing Types', () => {
  // ==========================================================================
  // 1. Request Thing Type Definitions
  // ==========================================================================

  describe('Request Thing Type Definitions', () => {
    it('ApprovalRequest Thing has correct structure', () => {
      const request: ApprovalRequestThing = {
        $id: 'https://humans.do/john/ApprovalRequest/req-001',
        $type: 'ApprovalRequest',
        name: 'Approve partnership with Acme Corp',
        data: {
          role: 'ceo',
          message: 'Please approve the partnership agreement',
          sla: 3600000, // 1 hour
          channel: 'slack',
          verbForm: 'request', // Initial state
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(request.$type).toBe('ApprovalRequest')
      expect(request.data?.verbForm).toBe('request')
    })

    it('TaskRequest Thing has correct structure', () => {
      const request: TaskRequestThing = {
        $id: 'https://humans.do/alice/TaskRequest/task-001',
        $type: 'TaskRequest',
        name: 'Review and sign the contract',
        data: {
          assignee: 'alice@company.com',
          priority: 'high',
          dueDate: new Date(Date.now() + 86400000).toISOString(),
          verbForm: 'assign', // Assigned state
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(request.$type).toBe('TaskRequest')
      expect(request.data?.verbForm).toBe('assign')
    })

    it('DecisionRequest Thing has correct structure', () => {
      const request: DecisionRequestThing = {
        $id: 'https://humans.do/bob/DecisionRequest/dec-001',
        $type: 'DecisionRequest',
        name: 'Choose deployment strategy',
        data: {
          options: ['blue-green', 'rolling', 'canary'],
          context: 'Production deployment for v2.0',
          verbForm: 'decide', // Pending decision
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(request.$type).toBe('DecisionRequest')
      expect(request.data?.verbForm).toBe('decide')
    })

    it('ReviewRequest Thing has correct structure', () => {
      const request: ReviewRequestThing = {
        $id: 'https://humans.do/carol/ReviewRequest/rev-001',
        $type: 'ReviewRequest',
        name: 'Review pull request #123',
        data: {
          artifact: 'https://github.com/org/repo/pull/123',
          reviewType: 'code',
          verbForm: 'review', // Pending review
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(request.$type).toBe('ReviewRequest')
      expect(request.data?.verbForm).toBe('review')
    })
  })

  // ==========================================================================
  // 2. Verb Form State Machines
  // ==========================================================================

  describe('Verb Form State Machines', () => {
    describe('Request verb forms', () => {
      it('request -> requesting -> requested', () => {
        const machine = new HumanRequestStateMachine('request')

        expect(machine.getState('request')).toBe('pending')
        expect(machine.getState('requesting')).toBe('in_progress')
        expect(machine.getState('requested')).toBe('completed')
      })
    })

    describe('Approve verb forms', () => {
      it('approve -> approving -> approved', () => {
        const machine = new HumanRequestStateMachine('approve')

        expect(machine.getState('approve')).toBe('pending')
        expect(machine.getState('approving')).toBe('in_progress')
        expect(machine.getState('approved')).toBe('completed')
      })
    })

    describe('Reject verb forms', () => {
      it('reject -> rejecting -> rejected', () => {
        const machine = new HumanRequestStateMachine('reject')

        expect(machine.getState('reject')).toBe('pending')
        expect(machine.getState('rejecting')).toBe('in_progress')
        expect(machine.getState('rejected')).toBe('completed')
      })
    })

    describe('Escalate verb forms', () => {
      it('escalate -> escalating -> escalated', () => {
        const machine = new HumanRequestStateMachine('escalate')

        expect(machine.getState('escalate')).toBe('pending')
        expect(machine.getState('escalating')).toBe('in_progress')
        expect(machine.getState('escalated')).toBe('completed')
      })
    })

    describe('Assign verb forms', () => {
      it('assign -> assigning -> assigned', () => {
        const machine = new HumanRequestStateMachine('assign')

        expect(machine.getState('assign')).toBe('pending')
        expect(machine.getState('assigning')).toBe('in_progress')
        expect(machine.getState('assigned')).toBe('completed')
      })
    })

    describe('Complete verb forms', () => {
      it('complete -> completing -> completed', () => {
        const machine = new HumanRequestStateMachine('complete')

        expect(machine.getState('complete')).toBe('pending')
        expect(machine.getState('completing')).toBe('in_progress')
        expect(machine.getState('completed')).toBe('completed')
      })
    })

    describe('Decide verb forms', () => {
      it('decide -> deciding -> decided', () => {
        const machine = new HumanRequestStateMachine('decide')

        expect(machine.getState('decide')).toBe('pending')
        expect(machine.getState('deciding')).toBe('in_progress')
        expect(machine.getState('decided')).toBe('completed')
      })
    })

    describe('Review verb forms', () => {
      it('review -> reviewing -> reviewed', () => {
        const machine = new HumanRequestStateMachine('review')

        expect(machine.getState('review')).toBe('pending')
        expect(machine.getState('reviewing')).toBe('in_progress')
        expect(machine.getState('reviewed')).toBe('completed')
      })
    })
  })

  // ==========================================================================
  // 3. State Transitions
  // ==========================================================================

  describe('State Transitions', () => {
    describe('transitionTo function', () => {
      it('transitions ApprovalRequest from request to requesting', () => {
        const thing: ApprovalRequestThing = {
          $id: 'https://humans.do/john/ApprovalRequest/req-001',
          $type: 'ApprovalRequest',
          name: 'Approve partnership',
          data: { verbForm: 'request' },
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        const updated = transitionTo(thing, 'request', 'start')
        expect(updated.data?.verbForm).toBe('requesting')
      })

      it('transitions ApprovalRequest through approve lifecycle', () => {
        // When starting an approval, the verbForm should be 'approve' (action form)
        let thing: ApprovalRequestThing = {
          $id: 'https://humans.do/john/ApprovalRequest/req-001',
          $type: 'ApprovalRequest',
          name: 'Approve partnership',
          data: { verbForm: 'approve' },
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        // approve -> approving
        thing = transitionTo(thing, 'approve', 'start') as ApprovalRequestThing
        expect(thing.data?.verbForm).toBe('approving')

        // approving -> approved
        thing = transitionTo(thing, 'approve', 'complete') as ApprovalRequestThing
        expect(thing.data?.verbForm).toBe('approved')
      })

      it('transitions TaskRequest through assign lifecycle', () => {
        let thing: TaskRequestThing = {
          $id: 'https://humans.do/alice/TaskRequest/task-001',
          $type: 'TaskRequest',
          name: 'Review contract',
          data: { verbForm: 'assign' },
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        // assign -> assigning
        thing = transitionTo(thing, 'assign', 'start') as TaskRequestThing
        expect(thing.data?.verbForm).toBe('assigning')

        // assigning -> assigned
        thing = transitionTo(thing, 'assign', 'complete') as TaskRequestThing
        expect(thing.data?.verbForm).toBe('assigned')
      })

      it('transitions TaskRequest through complete lifecycle', () => {
        let thing: TaskRequestThing = {
          $id: 'https://humans.do/alice/TaskRequest/task-001',
          $type: 'TaskRequest',
          name: 'Review contract',
          data: { verbForm: 'complete' },
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        // complete -> completing
        thing = transitionTo(thing, 'complete', 'start') as TaskRequestThing
        expect(thing.data?.verbForm).toBe('completing')

        // completing -> completed
        thing = transitionTo(thing, 'complete', 'complete') as TaskRequestThing
        expect(thing.data?.verbForm).toBe('completed')
      })

      it('transitions DecisionRequest through decide lifecycle', () => {
        let thing: DecisionRequestThing = {
          $id: 'https://humans.do/bob/DecisionRequest/dec-001',
          $type: 'DecisionRequest',
          name: 'Choose strategy',
          data: { verbForm: 'decide' },
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        // decide -> deciding
        thing = transitionTo(thing, 'decide', 'start') as DecisionRequestThing
        expect(thing.data?.verbForm).toBe('deciding')

        // deciding -> decided
        thing = transitionTo(thing, 'decide', 'complete') as DecisionRequestThing
        expect(thing.data?.verbForm).toBe('decided')
      })

      it('transitions ReviewRequest through review lifecycle', () => {
        let thing: ReviewRequestThing = {
          $id: 'https://humans.do/carol/ReviewRequest/rev-001',
          $type: 'ReviewRequest',
          name: 'Review PR',
          data: { verbForm: 'review' },
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        // review -> reviewing
        thing = transitionTo(thing, 'review', 'start') as ReviewRequestThing
        expect(thing.data?.verbForm).toBe('reviewing')

        // reviewing -> reviewed
        thing = transitionTo(thing, 'review', 'complete') as ReviewRequestThing
        expect(thing.data?.verbForm).toBe('reviewed')
      })
    })

    describe('validateTransition function', () => {
      it('validates request -> requesting is allowed', () => {
        expect(validateTransition('request', 'requesting')).toBe(true)
      })

      it('validates requesting -> requested is allowed', () => {
        expect(validateTransition('requesting', 'requested')).toBe(true)
      })

      it('validates approve -> approving is allowed', () => {
        expect(validateTransition('approve', 'approving')).toBe(true)
      })

      it('validates approving -> approved is allowed', () => {
        expect(validateTransition('approving', 'approved')).toBe(true)
      })

      it('validates reject -> rejecting is allowed', () => {
        expect(validateTransition('reject', 'rejecting')).toBe(true)
      })

      it('validates rejecting -> rejected is allowed', () => {
        expect(validateTransition('rejecting', 'rejected')).toBe(true)
      })

      it('rejects invalid backward transitions', () => {
        expect(validateTransition('approved', 'approving')).toBe(false)
        expect(validateTransition('requested', 'requesting')).toBe(false)
        expect(validateTransition('completed', 'completing')).toBe(false)
      })

      it('rejects invalid cross-verb transitions', () => {
        expect(validateTransition('request', 'approving')).toBe(false)
        expect(validateTransition('approve', 'rejected')).toBe(false)
        expect(validateTransition('decide', 'reviewing')).toBe(false)
      })
    })

    describe('Invalid transitions throw errors', () => {
      it('throws on backward transition', () => {
        const thing: ApprovalRequestThing = {
          $id: 'https://humans.do/john/ApprovalRequest/req-001',
          $type: 'ApprovalRequest',
          name: 'Approve partnership',
          data: { verbForm: 'approved' }, // Already completed
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        expect(() => transitionTo(thing, 'approve', 'start')).toThrow()
      })

      it('throws on invalid transition from completed state', () => {
        const thing: TaskRequestThing = {
          $id: 'https://humans.do/alice/TaskRequest/task-001',
          $type: 'TaskRequest',
          name: 'Review contract',
          data: { verbForm: 'completed' }, // Already completed
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        expect(() => transitionTo(thing, 'complete', 'start')).toThrow()
      })
    })
  })

  // ==========================================================================
  // 4. Type-Specific State Machines
  // ==========================================================================

  describe('Type-Specific State Machines', () => {
    describe('ApprovalRequestStateMachine', () => {
      it('supports approval workflow transitions', () => {
        const machine = new ApprovalRequestStateMachine()

        // Initial request
        expect(machine.canTransition('request', 'start')).toBe(true)
        expect(machine.transition('request', 'start')).toBe('requesting')

        // Can move to approve or reject from requesting
        expect(machine.canTransition('requesting', 'complete')).toBe(true)
      })

      it('tracks approval or rejection outcome', () => {
        const approveMachine = new HumanRequestStateMachine('approve')
        const rejectMachine = new HumanRequestStateMachine('reject')

        // Both are valid terminal states
        expect(approveMachine.getState('approved')).toBe('completed')
        expect(rejectMachine.getState('rejected')).toBe('completed')
      })
    })

    describe('TaskRequestStateMachine', () => {
      it('supports task lifecycle transitions', () => {
        const machine = new TaskRequestStateMachine()

        // Assignment
        expect(machine.canTransition('assign', 'start')).toBe(true)
        expect(machine.transition('assign', 'start')).toBe('assigning')
        expect(machine.transition('assigning', 'complete')).toBe('assigned')

        // Completion
        const completeMachine = new HumanRequestStateMachine('complete')
        expect(completeMachine.transition('complete', 'start')).toBe('completing')
        expect(completeMachine.transition('completing', 'complete')).toBe('completed')
      })
    })

    describe('DecisionRequestStateMachine', () => {
      it('supports decision workflow transitions', () => {
        const machine = new DecisionRequestStateMachine()

        expect(machine.canTransition('decide', 'start')).toBe(true)
        expect(machine.transition('decide', 'start')).toBe('deciding')
        expect(machine.transition('deciding', 'complete')).toBe('decided')
      })
    })

    describe('ReviewRequestStateMachine', () => {
      it('supports review workflow transitions', () => {
        const machine = new ReviewRequestStateMachine()

        expect(machine.canTransition('review', 'start')).toBe(true)
        expect(machine.transition('review', 'start')).toBe('reviewing')
        expect(machine.transition('reviewing', 'complete')).toBe('reviewed')
      })
    })
  })

  // ==========================================================================
  // 5. Get Request State Helper
  // ==========================================================================

  describe('getRequestState helper', () => {
    it('returns pending for action form verbs', () => {
      expect(getRequestState('request')).toBe('pending')
      expect(getRequestState('approve')).toBe('pending')
      expect(getRequestState('reject')).toBe('pending')
      expect(getRequestState('escalate')).toBe('pending')
      expect(getRequestState('assign')).toBe('pending')
      expect(getRequestState('complete')).toBe('pending')
      expect(getRequestState('decide')).toBe('pending')
      expect(getRequestState('review')).toBe('pending')
    })

    it('returns in_progress for activity form verbs', () => {
      expect(getRequestState('requesting')).toBe('in_progress')
      expect(getRequestState('approving')).toBe('in_progress')
      expect(getRequestState('rejecting')).toBe('in_progress')
      expect(getRequestState('escalating')).toBe('in_progress')
      expect(getRequestState('assigning')).toBe('in_progress')
      expect(getRequestState('completing')).toBe('in_progress')
      expect(getRequestState('deciding')).toBe('in_progress')
      expect(getRequestState('reviewing')).toBe('in_progress')
    })

    it('returns completed for event form verbs', () => {
      expect(getRequestState('requested')).toBe('completed')
      expect(getRequestState('approved')).toBe('completed')
      expect(getRequestState('rejected')).toBe('completed')
      expect(getRequestState('escalated')).toBe('completed')
      expect(getRequestState('assigned')).toBe('completed')
      expect(getRequestState('completed')).toBe('completed')
      expect(getRequestState('decided')).toBe('completed')
      expect(getRequestState('reviewed')).toBe('completed')
    })
  })

  // ==========================================================================
  // 6. Known Verb Forms Registry
  // ==========================================================================

  describe('HUMAN_REQUEST_VERBS registry', () => {
    it('contains all expected request verbs', () => {
      expect(HUMAN_REQUEST_VERBS.request).toBeDefined()
      expect(HUMAN_REQUEST_VERBS.approve).toBeDefined()
      expect(HUMAN_REQUEST_VERBS.reject).toBeDefined()
      expect(HUMAN_REQUEST_VERBS.escalate).toBeDefined()
      expect(HUMAN_REQUEST_VERBS.assign).toBeDefined()
      expect(HUMAN_REQUEST_VERBS.complete).toBeDefined()
      expect(HUMAN_REQUEST_VERBS.decide).toBeDefined()
      expect(HUMAN_REQUEST_VERBS.review).toBeDefined()
    })

    it('each verb has action, activity, and event forms', () => {
      for (const [_verb, forms] of Object.entries(HUMAN_REQUEST_VERBS)) {
        expect(forms.action).toBeDefined()
        expect(forms.activity).toBeDefined()
        expect(forms.event).toBeDefined()
      }
    })

    it('request verb conjugates correctly', () => {
      expect(HUMAN_REQUEST_VERBS.request).toEqual({
        action: 'request',
        activity: 'requesting',
        event: 'requested',
      })
    })

    it('approve verb conjugates correctly', () => {
      expect(HUMAN_REQUEST_VERBS.approve).toEqual({
        action: 'approve',
        activity: 'approving',
        event: 'approved',
      })
    })

    it('reject verb conjugates correctly', () => {
      expect(HUMAN_REQUEST_VERBS.reject).toEqual({
        action: 'reject',
        activity: 'rejecting',
        event: 'rejected',
      })
    })

    it('escalate verb conjugates correctly', () => {
      expect(HUMAN_REQUEST_VERBS.escalate).toEqual({
        action: 'escalate',
        activity: 'escalating',
        event: 'escalated',
      })
    })

    it('assign verb conjugates correctly', () => {
      expect(HUMAN_REQUEST_VERBS.assign).toEqual({
        action: 'assign',
        activity: 'assigning',
        event: 'assigned',
      })
    })

    it('complete verb conjugates correctly', () => {
      expect(HUMAN_REQUEST_VERBS.complete).toEqual({
        action: 'complete',
        activity: 'completing',
        event: 'completed',
      })
    })

    it('decide verb conjugates correctly', () => {
      expect(HUMAN_REQUEST_VERBS.decide).toEqual({
        action: 'decide',
        activity: 'deciding',
        event: 'decided',
      })
    })

    it('review verb conjugates correctly', () => {
      expect(HUMAN_REQUEST_VERBS.review).toEqual({
        action: 'review',
        activity: 'reviewing',
        event: 'reviewed',
      })
    })
  })

  // ==========================================================================
  // 7. Integration with Thing Data Structure
  // ==========================================================================

  describe('Integration with Thing data structure', () => {
    it('verbForm is stored in data field', () => {
      const thing: ApprovalRequestThing = {
        $id: 'https://humans.do/john/ApprovalRequest/req-001',
        $type: 'ApprovalRequest',
        name: 'Approve partnership',
        data: { verbForm: 'approve' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      expect(thing.data?.verbForm).toBe('approve')
    })

    it('transitionTo updates verbForm and updatedAt', () => {
      const before = new Date()
      const thing: ApprovalRequestThing = {
        $id: 'https://humans.do/john/ApprovalRequest/req-001',
        $type: 'ApprovalRequest',
        name: 'Approve partnership',
        data: { verbForm: 'approve' },
        createdAt: new Date(before.getTime() - 1000),
        updatedAt: before,
      }

      const updated = transitionTo(thing, 'approve', 'start')

      expect(updated.data?.verbForm).toBe('approving')
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    })

    it('preserves other data fields during transition', () => {
      const thing: ApprovalRequestThing = {
        $id: 'https://humans.do/john/ApprovalRequest/req-001',
        $type: 'ApprovalRequest',
        name: 'Approve partnership',
        data: {
          verbForm: 'approve',
          role: 'ceo',
          message: 'Please approve',
          customField: 'preserved',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const updated = transitionTo(thing, 'approve', 'start')

      expect(updated.data?.role).toBe('ceo')
      expect(updated.data?.message).toBe('Please approve')
      expect(updated.data?.customField).toBe('preserved')
      expect(updated.data?.verbForm).toBe('approving')
    })
  })

  // ==========================================================================
  // 8. Complete Workflow Examples
  // ==========================================================================

  describe('Complete Workflow Examples', () => {
    it('ApprovalRequest: request -> approve workflow', () => {
      // Initial request
      let thing: ApprovalRequestThing = {
        $id: 'https://humans.do/john/ApprovalRequest/req-001',
        $type: 'ApprovalRequest',
        name: 'Approve partnership',
        data: { verbForm: 'request', role: 'ceo' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Step 1: Start the request
      thing = transitionTo(thing, 'request', 'start') as ApprovalRequestThing
      expect(thing.data?.verbForm).toBe('requesting')
      expect(getRequestState(thing.data?.verbForm as string)).toBe('in_progress')

      // Step 2: Request is now being processed, awaiting approval
      thing = transitionTo(thing, 'request', 'complete') as ApprovalRequestThing
      expect(thing.data?.verbForm).toBe('requested')

      // Step 3: CEO starts approval process
      thing.data = { ...thing.data, verbForm: 'approve' }
      thing = transitionTo(thing, 'approve', 'start') as ApprovalRequestThing
      expect(thing.data?.verbForm).toBe('approving')

      // Step 4: CEO approves
      thing = transitionTo(thing, 'approve', 'complete') as ApprovalRequestThing
      expect(thing.data?.verbForm).toBe('approved')
      expect(getRequestState(thing.data?.verbForm as string)).toBe('completed')
    })

    it('ApprovalRequest: request -> reject workflow', () => {
      let thing: ApprovalRequestThing = {
        $id: 'https://humans.do/john/ApprovalRequest/req-001',
        $type: 'ApprovalRequest',
        name: 'Approve risky investment',
        data: { verbForm: 'request', role: 'cfo' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Request submitted and processed
      thing = transitionTo(thing, 'request', 'start') as ApprovalRequestThing
      thing = transitionTo(thing, 'request', 'complete') as ApprovalRequestThing

      // CFO rejects
      thing.data = { ...thing.data, verbForm: 'reject' }
      thing = transitionTo(thing, 'reject', 'start') as ApprovalRequestThing
      expect(thing.data?.verbForm).toBe('rejecting')

      thing = transitionTo(thing, 'reject', 'complete') as ApprovalRequestThing
      expect(thing.data?.verbForm).toBe('rejected')
    })

    it('TaskRequest: assign -> complete workflow', () => {
      let thing: TaskRequestThing = {
        $id: 'https://humans.do/alice/TaskRequest/task-001',
        $type: 'TaskRequest',
        name: 'Review contract',
        data: { verbForm: 'assign', assignee: 'alice' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Assign the task
      thing = transitionTo(thing, 'assign', 'start') as TaskRequestThing
      expect(thing.data?.verbForm).toBe('assigning')

      thing = transitionTo(thing, 'assign', 'complete') as TaskRequestThing
      expect(thing.data?.verbForm).toBe('assigned')

      // Complete the task
      thing.data = { ...thing.data, verbForm: 'complete' }
      thing = transitionTo(thing, 'complete', 'start') as TaskRequestThing
      expect(thing.data?.verbForm).toBe('completing')

      thing = transitionTo(thing, 'complete', 'complete') as TaskRequestThing
      expect(thing.data?.verbForm).toBe('completed')
    })

    it('TaskRequest: escalate workflow', () => {
      let thing: TaskRequestThing = {
        $id: 'https://humans.do/alice/TaskRequest/task-001',
        $type: 'TaskRequest',
        name: 'Overdue task',
        data: { verbForm: 'assigned', assignee: 'alice' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Escalate due to timeout
      thing.data = { ...thing.data, verbForm: 'escalate' }
      thing = transitionTo(thing, 'escalate', 'start') as TaskRequestThing
      expect(thing.data?.verbForm).toBe('escalating')

      thing = transitionTo(thing, 'escalate', 'complete') as TaskRequestThing
      expect(thing.data?.verbForm).toBe('escalated')
    })

    it('DecisionRequest: decide workflow', () => {
      let thing: DecisionRequestThing = {
        $id: 'https://humans.do/bob/DecisionRequest/dec-001',
        $type: 'DecisionRequest',
        name: 'Choose deployment strategy',
        data: {
          verbForm: 'decide',
          options: ['blue-green', 'rolling', 'canary'],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Make decision
      thing = transitionTo(thing, 'decide', 'start') as DecisionRequestThing
      expect(thing.data?.verbForm).toBe('deciding')

      thing = transitionTo(thing, 'decide', 'complete') as DecisionRequestThing
      expect(thing.data?.verbForm).toBe('decided')
    })

    it('ReviewRequest: review workflow', () => {
      let thing: ReviewRequestThing = {
        $id: 'https://humans.do/carol/ReviewRequest/rev-001',
        $type: 'ReviewRequest',
        name: 'Review PR #123',
        data: {
          verbForm: 'review',
          artifact: 'https://github.com/org/repo/pull/123',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Review in progress
      thing = transitionTo(thing, 'review', 'start') as ReviewRequestThing
      expect(thing.data?.verbForm).toBe('reviewing')

      // Review completed
      thing = transitionTo(thing, 'review', 'complete') as ReviewRequestThing
      expect(thing.data?.verbForm).toBe('reviewed')
    })
  })
})
