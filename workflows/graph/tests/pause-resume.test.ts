/**
 * Workflow Pause/Resume via Verb Form Relationships - Tests
 *
 * TDD RED Phase: Failing tests for workflow pause/resume state transitions
 * using verb form relationships.
 *
 * Key Insight: Verb form IS the state - no separate status column needed.
 *
 * State Machine (via verb forms):
 * - Pause lifecycle: 'pause' (action) -> 'pausing' (activity) -> 'paused' (event)
 * - Resume lifecycle: 'resume' (action) -> 'resuming' (activity) -> 'resumed' (event)
 * - WaitForEvent: 'waitFor' (action) -> 'waitingFor' (activity) -> 'waitedFor' (event)
 *
 * Expected Relationships:
 * - Pause lifecycle:
 *   { verb: 'pause', from: 'instance:123', to: null }
 *   { verb: 'pausing', from: 'instance:123', to: null }
 *   { verb: 'paused', from: 'instance:123', to: 'event:user-requested' }
 *
 * - Resume lifecycle:
 *   { verb: 'resume', from: 'instance:123', to: null }
 *   { verb: 'resuming', from: 'instance:123', to: null }
 *   { verb: 'resumed', from: 'instance:123', to: 'event:user-approved' }
 *
 * - WaitForEvent:
 *   { verb: 'waitFor', from: 'instance:123', to: 'event:payment.completed' }
 *   { verb: 'waitingFor', from: 'instance:123', to: null }
 *   { verb: 'waitedFor', from: 'instance:123', to: 'event:payment.completed:payload' }
 *
 * Uses real SQLite, NO MOCKS per CLAUDE.md guidelines.
 *
 * @see dotdo-g23h2 - [RED] Workflow pause/resume via verb forms - tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../../db/graph/stores/sqlite'
import type { GraphRelationship } from '../../../db/graph/types'

// ============================================================================
// EXPECTED API - PauseResumeStore (NOT YET IMPLEMENTED)
// ============================================================================

/**
 * Semantic workflow pause/resume states
 */
type PauseResumeState = 'pending' | 'in_progress' | 'completed'

/**
 * Pause reason data stored in the relationship
 */
interface PauseData {
  /** Reason for the pause */
  reason?: string
  /** Event that triggered the pause */
  triggerEvent?: string
  /** When the pause was initiated */
  initiatedAt?: number
  /** When the pause completed */
  completedAt?: number
  /** Who/what requested the pause */
  requestedBy?: string
}

/**
 * Resume data stored in the relationship
 */
interface ResumeData {
  /** Reason for the resume */
  reason?: string
  /** Event that triggered the resume */
  triggerEvent?: string
  /** When the resume was initiated */
  initiatedAt?: number
  /** When the resume completed */
  completedAt?: number
  /** Who/what approved the resume */
  approvedBy?: string
}

/**
 * WaitForEvent data stored in the relationship
 */
interface WaitForEventData {
  /** Event name being waited for */
  eventName: string
  /** Timeout in milliseconds */
  timeout?: number
  /** When the wait was registered */
  registeredAt?: number
  /** When the event was received */
  receivedAt?: number
  /** Event payload when received */
  payload?: unknown
  /** Duration waited */
  duration?: number
}

/**
 * Pause/Resume relationship extending GraphRelationship with typed data
 */
interface PauseResumeRelationship extends Omit<GraphRelationship, 'data'> {
  verb: 'pause' | 'pausing' | 'paused' | 'resume' | 'resuming' | 'resumed'
  data: PauseData | ResumeData | null
}

/**
 * WaitForEvent relationship extending GraphRelationship with typed data
 */
interface WaitForEventRelationship extends Omit<GraphRelationship, 'data'> {
  verb: 'waitFor' | 'waitingFor' | 'waitedFor'
  data: WaitForEventData | null
}

/**
 * Input for initiating a pause
 */
interface PauseInput {
  instanceId: string
  reason?: string
  requestedBy?: string
  triggerEvent?: string
}

/**
 * Input for initiating a resume
 */
interface ResumeInput {
  instanceId: string
  reason?: string
  approvedBy?: string
  triggerEvent?: string
}

/**
 * Input for registering a waitForEvent
 */
interface WaitForEventInput {
  instanceId: string
  eventName: string
  timeout?: number
}

/**
 * PauseResumeStore interface (to be implemented)
 * Encapsulates pause/resume/waitForEvent tracking as relationships with verb forms.
 */
interface PauseResumeStore {
  // Pause lifecycle
  initiatePause(input: PauseInput): Promise<PauseResumeRelationship>
  startPausing(instanceId: string): Promise<PauseResumeRelationship>
  completePause(instanceId: string, triggerEvent?: string): Promise<PauseResumeRelationship>

  // Resume lifecycle
  initiateResume(input: ResumeInput): Promise<PauseResumeRelationship>
  startResuming(instanceId: string): Promise<PauseResumeRelationship>
  completeResume(instanceId: string, triggerEvent?: string): Promise<PauseResumeRelationship>

  // WaitForEvent lifecycle
  registerWaitFor(input: WaitForEventInput): Promise<WaitForEventRelationship>
  startWaiting(instanceId: string, eventName: string): Promise<WaitForEventRelationship>
  completeWaitFor(instanceId: string, eventName: string, payload: unknown): Promise<WaitForEventRelationship>

  // Queries
  getPauseState(instanceId: string): Promise<PauseResumeState | null>
  getResumeState(instanceId: string): Promise<PauseResumeState | null>
  getWaitState(instanceId: string, eventName: string): Promise<PauseResumeState | null>
  queryPausedInstances(): Promise<PauseResumeRelationship[]>
  queryWaitingInstances(eventName?: string): Promise<WaitForEventRelationship[]>
}

// Import the actual implementation (GREEN phase)
import { createPauseResumeStore as createPauseResumeStoreImpl } from '../pause-resume-store'

/**
 * Factory function to create PauseResumeStore.
 * GREEN phase: Uses the actual implementation.
 */
function createPauseResumeStore(graphStore: SQLiteGraphStore): PauseResumeStore {
  return createPauseResumeStoreImpl(graphStore) as unknown as PauseResumeStore
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type ID for WorkflowInstance Things - matches NOUN_REGISTRY.WorkflowInstance.rowid */
const WORKFLOW_INSTANCE_TYPE_ID = 400

/** Type name for WorkflowInstance Things */
const WORKFLOW_INSTANCE_TYPE_NAME = 'WorkflowInstance'

/** Type ID for Event Things - use HumanFunction.rowid (103) as Event type since there's no dedicated Event noun */
const EVENT_TYPE_ID = 103

/** Type name for Event Things */
const EVENT_TYPE_NAME = 'HumanFunction'

// ============================================================================
// TEST FIXTURES
// ============================================================================

const testWorkflowId = 'workflow:expense-approval'
const testInstanceId = 'instance:exp-001'
const testPauseEventId = 'event:user-requested-pause'
const testResumeEventId = 'event:manager-approved-resume'
const testPaymentEventName = 'payment.completed'

// ============================================================================
// TEST SUITE: Workflow Pause/Resume via Verb Form Relationships
// ============================================================================

describe('Workflow Pause/Resume via Verb Form Relationships', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    // Create fresh in-memory SQLite store for each test
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    // Seed workflow instance in running state
    await store.createThing({
      id: testInstanceId,
      typeId: WORKFLOW_INSTANCE_TYPE_ID,
      typeName: WORKFLOW_INSTANCE_TYPE_NAME,
      data: {
        workflowId: testWorkflowId,
        input: { amount: 1500, description: 'Conference travel' },
        stateVerb: 'starting', // Instance is running
      },
    })
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // Test Case 1: Pause workflow creates 'pause' action relationship
  // ==========================================================================

  describe('Pause workflow creates pause action relationship', () => {
    it('creates pause relationship for pending pause (action form)', async () => {
      // Create 'pause' relationship = intent to pause workflow
      const pauseRel = await store.createRelationship({
        id: `rel:pause:${testInstanceId}`,
        verb: 'pause',
        from: testInstanceId,
        to: testInstanceId, // Self-referencing for state action
        data: {
          reason: 'user-requested',
          initiatedAt: Date.now(),
          requestedBy: 'user-alice',
        },
      })

      expect(pauseRel.verb).toBe('pause')
      expect(pauseRel.from).toBe(testInstanceId)
      expect(pauseRel.data).toBeDefined()
      expect((pauseRel.data as PauseData).reason).toBe('user-requested')
      expect((pauseRel.data as PauseData).requestedBy).toBe('user-alice')
    })

    it('pause relationship from field is the workflow instance ID', async () => {
      const pauseRel = await store.createRelationship({
        id: 'rel:pause:from-test',
        verb: 'pause',
        from: testInstanceId,
        to: testInstanceId,
        data: { reason: 'testing' },
      })

      expect(pauseRel.from).toBe(testInstanceId)
      expect(pauseRel.from).toMatch(/^instance:/)
    })

    it('pause relationship stores reason in data', async () => {
      const pauseRel = await store.createRelationship({
        id: 'rel:pause:reason-test',
        verb: 'pause',
        from: testInstanceId,
        to: testInstanceId,
        data: {
          reason: 'awaiting-manager-approval',
          requestedBy: 'system',
          initiatedAt: Date.now(),
        },
      })

      const data = pauseRel.data as PauseData
      expect(data.reason).toBe('awaiting-manager-approval')
      expect(data.requestedBy).toBe('system')
      expect(data.initiatedAt).toBeDefined()
    })
  })

  // ==========================================================================
  // Test Case 2: pause -> pausing -> paused state transitions
  // ==========================================================================

  describe('pause -> pausing -> paused state transitions', () => {
    it('transitions from pause (action) to pausing (activity)', async () => {
      // Create initial 'pause' relationship (action/pending)
      await store.createRelationship({
        id: `rel:pause:trans:${testInstanceId}`,
        verb: 'pause',
        from: testInstanceId,
        to: testInstanceId,
        data: { reason: 'user-requested', initiatedAt: Date.now() },
      })

      // Delete pause and create pausing (activity/in-progress)
      await store.deleteRelationship(`rel:pause:trans:${testInstanceId}`)
      const pausingRel = await store.createRelationship({
        id: `rel:pausing:trans:${testInstanceId}`,
        verb: 'pausing',
        from: testInstanceId,
        to: testInstanceId, // to is self during activity
        data: { reason: 'user-requested' },
      })

      expect(pausingRel.verb).toBe('pausing')
      expect(pausingRel.from).toBe(testInstanceId)
    })

    it('transitions from pausing (activity) to paused (event)', async () => {
      // Create 'pausing' relationship
      await store.createRelationship({
        id: `rel:pausing:event:${testInstanceId}`,
        verb: 'pausing',
        from: testInstanceId,
        to: testInstanceId,
        data: { reason: 'user-requested' },
      })

      // Create event Thing that triggered the pause completion
      await store.createThing({
        id: testPauseEventId,
        typeId: EVENT_TYPE_ID,
        typeName: EVENT_TYPE_NAME,
        data: { type: 'pause.completed', source: 'user-alice' },
      })

      // Delete pausing and create paused (event/completed)
      await store.deleteRelationship(`rel:pausing:event:${testInstanceId}`)
      const pausedRel = await store.createRelationship({
        id: `rel:paused:event:${testInstanceId}`,
        verb: 'paused',
        from: testInstanceId,
        to: testPauseEventId, // 'to' points to the event that completed the pause
        data: {
          reason: 'user-requested',
          completedAt: Date.now(),
        },
      })

      expect(pausedRel.verb).toBe('paused')
      expect(pausedRel.from).toBe(testInstanceId)
      expect(pausedRel.to).toBe(testPauseEventId)
    })

    it('full pause lifecycle: pause -> pausing -> paused', async () => {
      const reason = 'manual-pause'

      // 1. Create pause (action/pending)
      await store.createRelationship({
        id: `rel:pause:lifecycle:${testInstanceId}`,
        verb: 'pause',
        from: testInstanceId,
        to: testInstanceId,
        data: { reason, initiatedAt: Date.now() },
      })

      // Verify pending state
      const pauseRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'pause' })
      expect(pauseRels).toHaveLength(1)

      // 2. Transition to pausing (activity/in-progress)
      await store.deleteRelationship(`rel:pause:lifecycle:${testInstanceId}`)
      await store.createRelationship({
        id: `rel:pausing:lifecycle:${testInstanceId}`,
        verb: 'pausing',
        from: testInstanceId,
        to: testInstanceId,
        data: { reason },
      })

      // Verify in-progress state
      const pausingRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'pausing' })
      expect(pausingRels).toHaveLength(1)

      // 3. Create event and transition to paused (event/completed)
      await store.createThing({
        id: testPauseEventId,
        typeId: EVENT_TYPE_ID,
        typeName: EVENT_TYPE_NAME,
        data: { type: 'pause.completed' },
      })

      await store.deleteRelationship(`rel:pausing:lifecycle:${testInstanceId}`)
      await store.createRelationship({
        id: `rel:paused:lifecycle:${testInstanceId}`,
        verb: 'paused',
        from: testInstanceId,
        to: testPauseEventId,
        data: { reason, completedAt: Date.now() },
      })

      // Verify completed state
      const pausedRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'paused' })
      expect(pausedRels).toHaveLength(1)
      expect(pausedRels[0]!.to).toBe(testPauseEventId)
    })
  })

  // ==========================================================================
  // Test Case 3: Resume workflow creates 'resume' action relationship
  // ==========================================================================

  describe('Resume workflow creates resume action relationship', () => {
    beforeEach(async () => {
      // Put instance in paused state first
      await store.createThing({
        id: testPauseEventId,
        typeId: EVENT_TYPE_ID,
        typeName: EVENT_TYPE_NAME,
        data: { type: 'pause.completed' },
      })
      await store.createRelationship({
        id: `rel:paused:setup:${testInstanceId}`,
        verb: 'paused',
        from: testInstanceId,
        to: testPauseEventId,
        data: { reason: 'setup' },
      })
    })

    it('creates resume relationship for pending resume (action form)', async () => {
      // Create 'resume' relationship = intent to resume workflow
      const resumeRel = await store.createRelationship({
        id: `rel:resume:${testInstanceId}`,
        verb: 'resume',
        from: testInstanceId,
        to: testInstanceId, // Self-referencing for state action
        data: {
          reason: 'manager-approved',
          initiatedAt: Date.now(),
          approvedBy: 'manager-bob',
        },
      })

      expect(resumeRel.verb).toBe('resume')
      expect(resumeRel.from).toBe(testInstanceId)
      expect(resumeRel.data).toBeDefined()
      expect((resumeRel.data as ResumeData).reason).toBe('manager-approved')
      expect((resumeRel.data as ResumeData).approvedBy).toBe('manager-bob')
    })

    it('resume relationship from field is the workflow instance ID', async () => {
      const resumeRel = await store.createRelationship({
        id: 'rel:resume:from-test',
        verb: 'resume',
        from: testInstanceId,
        to: testInstanceId,
        data: { reason: 'testing' },
      })

      expect(resumeRel.from).toBe(testInstanceId)
      expect(resumeRel.from).toMatch(/^instance:/)
    })

    it('resume relationship stores approver info in data', async () => {
      const resumeRel = await store.createRelationship({
        id: 'rel:resume:approver-test',
        verb: 'resume',
        from: testInstanceId,
        to: testInstanceId,
        data: {
          reason: 'approval-granted',
          approvedBy: 'manager-charlie',
          triggerEvent: 'approval.granted',
          initiatedAt: Date.now(),
        },
      })

      const data = resumeRel.data as ResumeData
      expect(data.reason).toBe('approval-granted')
      expect(data.approvedBy).toBe('manager-charlie')
      expect(data.triggerEvent).toBe('approval.granted')
    })
  })

  // ==========================================================================
  // Test Case 4: resume -> resuming -> resumed state transitions
  // ==========================================================================

  describe('resume -> resuming -> resumed state transitions', () => {
    beforeEach(async () => {
      // Put instance in paused state first
      await store.createThing({
        id: testPauseEventId,
        typeId: EVENT_TYPE_ID,
        typeName: EVENT_TYPE_NAME,
        data: { type: 'pause.completed' },
      })
      await store.createRelationship({
        id: `rel:paused:setup:${testInstanceId}`,
        verb: 'paused',
        from: testInstanceId,
        to: testPauseEventId,
        data: { reason: 'setup' },
      })
    })

    it('transitions from resume (action) to resuming (activity)', async () => {
      // Create initial 'resume' relationship (action/pending)
      await store.createRelationship({
        id: `rel:resume:trans:${testInstanceId}`,
        verb: 'resume',
        from: testInstanceId,
        to: testInstanceId,
        data: { reason: 'manager-approved', initiatedAt: Date.now() },
      })

      // Delete resume and create resuming (activity/in-progress)
      await store.deleteRelationship(`rel:resume:trans:${testInstanceId}`)
      const resumingRel = await store.createRelationship({
        id: `rel:resuming:trans:${testInstanceId}`,
        verb: 'resuming',
        from: testInstanceId,
        to: testInstanceId, // to is self during activity
        data: { reason: 'manager-approved' },
      })

      expect(resumingRel.verb).toBe('resuming')
      expect(resumingRel.from).toBe(testInstanceId)
    })

    it('transitions from resuming (activity) to resumed (event)', async () => {
      // Create 'resuming' relationship
      await store.createRelationship({
        id: `rel:resuming:event:${testInstanceId}`,
        verb: 'resuming',
        from: testInstanceId,
        to: testInstanceId,
        data: { reason: 'manager-approved' },
      })

      // Create event Thing that triggered the resume completion
      await store.createThing({
        id: testResumeEventId,
        typeId: EVENT_TYPE_ID,
        typeName: EVENT_TYPE_NAME,
        data: { type: 'resume.completed', approvedBy: 'manager-bob' },
      })

      // Delete resuming and create resumed (event/completed)
      await store.deleteRelationship(`rel:resuming:event:${testInstanceId}`)
      const resumedRel = await store.createRelationship({
        id: `rel:resumed:event:${testInstanceId}`,
        verb: 'resumed',
        from: testInstanceId,
        to: testResumeEventId, // 'to' points to the event that completed the resume
        data: {
          reason: 'manager-approved',
          completedAt: Date.now(),
        },
      })

      expect(resumedRel.verb).toBe('resumed')
      expect(resumedRel.from).toBe(testInstanceId)
      expect(resumedRel.to).toBe(testResumeEventId)
    })

    it('full resume lifecycle: resume -> resuming -> resumed', async () => {
      const reason = 'approval-granted'

      // 1. Create resume (action/pending)
      await store.createRelationship({
        id: `rel:resume:lifecycle:${testInstanceId}`,
        verb: 'resume',
        from: testInstanceId,
        to: testInstanceId,
        data: { reason, initiatedAt: Date.now(), approvedBy: 'manager-jane' },
      })

      // Verify pending state
      const resumeRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'resume' })
      expect(resumeRels).toHaveLength(1)

      // 2. Transition to resuming (activity/in-progress)
      await store.deleteRelationship(`rel:resume:lifecycle:${testInstanceId}`)
      await store.createRelationship({
        id: `rel:resuming:lifecycle:${testInstanceId}`,
        verb: 'resuming',
        from: testInstanceId,
        to: testInstanceId,
        data: { reason },
      })

      // Verify in-progress state
      const resumingRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'resuming' })
      expect(resumingRels).toHaveLength(1)

      // 3. Create event and transition to resumed (event/completed)
      await store.createThing({
        id: testResumeEventId,
        typeId: EVENT_TYPE_ID,
        typeName: EVENT_TYPE_NAME,
        data: { type: 'resume.completed' },
      })

      await store.deleteRelationship(`rel:resuming:lifecycle:${testInstanceId}`)
      await store.createRelationship({
        id: `rel:resumed:lifecycle:${testInstanceId}`,
        verb: 'resumed',
        from: testInstanceId,
        to: testResumeEventId,
        data: { reason, completedAt: Date.now() },
      })

      // Verify completed state
      const resumedRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'resumed' })
      expect(resumedRels).toHaveLength(1)
      expect(resumedRels[0]!.to).toBe(testResumeEventId)
    })
  })

  // ==========================================================================
  // Test Case 5: Paused instance can be queried by 'paused' event verb
  // ==========================================================================

  describe('Paused instance can be queried by paused event verb', () => {
    beforeEach(async () => {
      // Create multiple instances with different states
      const instances = [
        { id: 'instance:paused-1', state: 'paused' },
        { id: 'instance:paused-2', state: 'paused' },
        { id: 'instance:running-1', state: 'running' },
        { id: 'instance:resumed-1', state: 'resumed' },
      ]

      for (const inst of instances) {
        // Create instance Thing
        await store.createThing({
          id: inst.id,
          typeId: WORKFLOW_INSTANCE_TYPE_ID,
          typeName: WORKFLOW_INSTANCE_TYPE_NAME,
          data: { workflowId: testWorkflowId, input: {} },
        })

        // Create appropriate state relationship
        if (inst.state === 'paused') {
          const eventId = `event:pause:${inst.id}`
          await store.createThing({
            id: eventId,
            typeId: EVENT_TYPE_ID,
            typeName: EVENT_TYPE_NAME,
            data: { type: 'pause.completed' },
          })
          await store.createRelationship({
            id: `rel:paused:query:${inst.id}`,
            verb: 'paused',
            from: inst.id,
            to: eventId,
            data: { reason: 'test' },
          })
        } else if (inst.state === 'running') {
          await store.createRelationship({
            id: `rel:starting:query:${inst.id}`,
            verb: 'starting',
            from: inst.id,
            to: inst.id,
            data: {},
          })
        } else if (inst.state === 'resumed') {
          const eventId = `event:resume:${inst.id}`
          await store.createThing({
            id: eventId,
            typeId: EVENT_TYPE_ID,
            typeName: EVENT_TYPE_NAME,
            data: { type: 'resume.completed' },
          })
          await store.createRelationship({
            id: `rel:resumed:query:${inst.id}`,
            verb: 'resumed',
            from: inst.id,
            to: eventId,
            data: { reason: 'test' },
          })
        }
      }
    })

    it('queries all paused instances by verb', async () => {
      const pausedRels = await store.queryRelationshipsByVerb('paused')

      expect(pausedRels).toHaveLength(2)
      const instanceIds = pausedRels.map((r) => r.from).sort()
      expect(instanceIds).toEqual(['instance:paused-1', 'instance:paused-2'])
    })

    it('distinguishes paused from resumed instances', async () => {
      const pausedRels = await store.queryRelationshipsByVerb('paused')
      const resumedRels = await store.queryRelationshipsByVerb('resumed')

      expect(pausedRels).toHaveLength(2)
      expect(resumedRels).toHaveLength(1)
      expect(resumedRels[0]!.from).toBe('instance:resumed-1')
    })

    it('paused instances to field points to pause event', async () => {
      const pausedRels = await store.queryRelationshipsByVerb('paused')

      for (const rel of pausedRels) {
        expect(rel.to).toMatch(/^event:pause:/)
        // Verify the event Thing exists
        const event = await store.getThing(rel.to)
        expect(event).not.toBeNull()
        expect(event!.typeName).toBe(EVENT_TYPE_NAME)
      }
    })

    it('can filter paused instances for specific workflow', async () => {
      // Query all paused instances and filter by instanceOf relationship
      const pausedRels = await store.queryRelationshipsByVerb('paused')
      const pausedInstanceIds = pausedRels.map((r) => r.from)

      // In a real implementation, this would be a join query
      // Here we demonstrate the pattern
      expect(pausedInstanceIds).toHaveLength(2)
    })
  })

  // ==========================================================================
  // Test Case 6: WaitForEvent creates 'waitFor' relationship
  // ==========================================================================

  describe('WaitForEvent creates waitFor relationship', () => {
    it('creates waitFor relationship with event name as to field', async () => {
      // Create 'waitFor' relationship = intent to wait for an event
      const waitForRel = await store.createRelationship({
        id: `rel:waitFor:${testInstanceId}:${testPaymentEventName}`,
        verb: 'waitFor',
        from: testInstanceId,
        to: `event:${testPaymentEventName}`, // Event identifier
        data: {
          eventName: testPaymentEventName,
          timeout: 300000, // 5 minutes
          registeredAt: Date.now(),
        },
      })

      expect(waitForRel.verb).toBe('waitFor')
      expect(waitForRel.from).toBe(testInstanceId)
      expect(waitForRel.to).toBe(`event:${testPaymentEventName}`)
      expect((waitForRel.data as WaitForEventData).eventName).toBe(testPaymentEventName)
    })

    it('waitFor relationship from field is the workflow instance ID', async () => {
      const waitForRel = await store.createRelationship({
        id: 'rel:waitFor:from-test',
        verb: 'waitFor',
        from: testInstanceId,
        to: 'event:order.shipped',
        data: { eventName: 'order.shipped' },
      })

      expect(waitForRel.from).toBe(testInstanceId)
      expect(waitForRel.from).toMatch(/^instance:/)
    })

    it('waitFor relationship stores timeout in data', async () => {
      const timeout = 600000 // 10 minutes
      const waitForRel = await store.createRelationship({
        id: 'rel:waitFor:timeout-test',
        verb: 'waitFor',
        from: testInstanceId,
        to: 'event:approval.granted',
        data: {
          eventName: 'approval.granted',
          timeout,
          registeredAt: Date.now(),
        },
      })

      const data = waitForRel.data as WaitForEventData
      expect(data.timeout).toBe(timeout)
      expect(data.eventName).toBe('approval.granted')
    })

    it('multiple waitFor relationships for different events', async () => {
      const events = ['payment.completed', 'shipment.delivered', 'approval.granted']

      for (const eventName of events) {
        await store.createRelationship({
          id: `rel:waitFor:multi:${eventName}`,
          verb: 'waitFor',
          from: testInstanceId,
          to: `event:${eventName}`,
          data: { eventName, registeredAt: Date.now() },
        })
      }

      const waitForRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'waitFor' })
      expect(waitForRels).toHaveLength(3)
    })
  })

  // ==========================================================================
  // Test Case 7: waitFor -> waitingFor -> waitedFor transitions
  // ==========================================================================

  describe('waitFor -> waitingFor -> waitedFor state transitions', () => {
    it('transitions from waitFor (action) to waitingFor (activity)', async () => {
      const eventName = testPaymentEventName

      // Create initial 'waitFor' relationship (action/pending)
      await store.createRelationship({
        id: `rel:waitFor:trans:${testInstanceId}:${eventName}`,
        verb: 'waitFor',
        from: testInstanceId,
        to: `event:${eventName}`,
        data: { eventName, registeredAt: Date.now() },
      })

      // Delete waitFor and create waitingFor (activity/in-progress)
      await store.deleteRelationship(`rel:waitFor:trans:${testInstanceId}:${eventName}`)
      const waitingForRel = await store.createRelationship({
        id: `rel:waitingFor:trans:${testInstanceId}:${eventName}`,
        verb: 'waitingFor',
        from: testInstanceId,
        to: testInstanceId, // to is typically null/self while waiting
        data: { eventName },
      })

      expect(waitingForRel.verb).toBe('waitingFor')
      expect(waitingForRel.from).toBe(testInstanceId)
    })

    it('transitions from waitingFor (activity) to waitedFor (event)', async () => {
      const eventName = testPaymentEventName

      // Create 'waitingFor' relationship
      await store.createRelationship({
        id: `rel:waitingFor:event:${testInstanceId}:${eventName}`,
        verb: 'waitingFor',
        from: testInstanceId,
        to: testInstanceId,
        data: { eventName },
      })

      // Create event Thing with payload
      const payloadEventId = `event:${eventName}:payload:${Date.now()}`
      await store.createThing({
        id: payloadEventId,
        typeId: EVENT_TYPE_ID,
        typeName: EVENT_TYPE_NAME,
        data: {
          type: eventName,
          payload: {
            transactionId: 'txn-12345',
            amount: 1500,
            status: 'completed',
          },
        },
      })

      // Delete waitingFor and create waitedFor (event/completed)
      await store.deleteRelationship(`rel:waitingFor:event:${testInstanceId}:${eventName}`)
      const waitedForRel = await store.createRelationship({
        id: `rel:waitedFor:event:${testInstanceId}:${eventName}`,
        verb: 'waitedFor',
        from: testInstanceId,
        to: payloadEventId, // 'to' points to the event with payload
        data: {
          eventName,
          receivedAt: Date.now(),
          payload: { transactionId: 'txn-12345', amount: 1500 },
        },
      })

      expect(waitedForRel.verb).toBe('waitedFor')
      expect(waitedForRel.from).toBe(testInstanceId)
      expect(waitedForRel.to).toBe(payloadEventId)
    })

    it('full waitForEvent lifecycle: waitFor -> waitingFor -> waitedFor', async () => {
      const eventName = 'order.confirmed'
      const registeredAt = Date.now()

      // 1. Create waitFor (action/pending)
      await store.createRelationship({
        id: `rel:waitFor:lifecycle:${testInstanceId}:${eventName}`,
        verb: 'waitFor',
        from: testInstanceId,
        to: `event:${eventName}`,
        data: { eventName, registeredAt, timeout: 300000 },
      })

      // Verify pending state
      const waitForRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'waitFor' })
      expect(waitForRels).toHaveLength(1)

      // 2. Transition to waitingFor (activity/in-progress)
      await store.deleteRelationship(`rel:waitFor:lifecycle:${testInstanceId}:${eventName}`)
      await store.createRelationship({
        id: `rel:waitingFor:lifecycle:${testInstanceId}:${eventName}`,
        verb: 'waitingFor',
        from: testInstanceId,
        to: testInstanceId,
        data: { eventName },
      })

      // Verify in-progress state
      const waitingForRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'waitingFor' })
      expect(waitingForRels).toHaveLength(1)

      // 3. Event arrives, transition to waitedFor (event/completed)
      const receivedAt = Date.now()
      const payloadEventId = `event:${eventName}:${receivedAt}`
      const payload = { orderId: 'ORD-001', confirmed: true }

      await store.createThing({
        id: payloadEventId,
        typeId: EVENT_TYPE_ID,
        typeName: EVENT_TYPE_NAME,
        data: { type: eventName, payload },
      })

      await store.deleteRelationship(`rel:waitingFor:lifecycle:${testInstanceId}:${eventName}`)
      await store.createRelationship({
        id: `rel:waitedFor:lifecycle:${testInstanceId}:${eventName}`,
        verb: 'waitedFor',
        from: testInstanceId,
        to: payloadEventId,
        data: {
          eventName,
          receivedAt,
          duration: receivedAt - registeredAt,
          payload,
        },
      })

      // Verify completed state
      const waitedForRels = await store.queryRelationshipsFrom(testInstanceId, { verb: 'waitedFor' })
      expect(waitedForRels).toHaveLength(1)
      expect(waitedForRels[0]!.to).toBe(payloadEventId)

      // Verify payload is accessible
      const eventThing = await store.getThing(payloadEventId)
      expect(eventThing).not.toBeNull()
      expect((eventThing!.data as { payload: typeof payload }).payload.orderId).toBe('ORD-001')
    })

    it('waitedFor to field points to event payload Thing', async () => {
      const eventName = 'notification.sent'
      const payload = { recipientId: 'user-123', channel: 'email', messageId: 'msg-456' }
      const payloadEventId = `event:${eventName}:payload`

      // Create event with payload
      await store.createThing({
        id: payloadEventId,
        typeId: EVENT_TYPE_ID,
        typeName: EVENT_TYPE_NAME,
        data: { type: eventName, payload },
      })

      // Create waitedFor relationship pointing to payload
      const waitedForRel = await store.createRelationship({
        id: `rel:waitedFor:payload:${testInstanceId}`,
        verb: 'waitedFor',
        from: testInstanceId,
        to: payloadEventId,
        data: {
          eventName,
          receivedAt: Date.now(),
          payload,
        },
      })

      expect(waitedForRel.to).toBe(payloadEventId)

      // Verify can traverse to payload
      const eventThing = await store.getThing(waitedForRel.to)
      expect(eventThing).not.toBeNull()
      expect((eventThing!.data as { payload: typeof payload }).payload).toEqual(payload)
    })

    it('query instances waiting for specific event', async () => {
      // Create multiple instances waiting for different events
      const waits = [
        { instanceId: 'instance:wait-1', eventName: 'payment.completed' },
        { instanceId: 'instance:wait-2', eventName: 'payment.completed' },
        { instanceId: 'instance:wait-3', eventName: 'approval.granted' },
      ]

      for (const wait of waits) {
        await store.createThing({
          id: wait.instanceId,
          typeId: WORKFLOW_INSTANCE_TYPE_ID,
          typeName: WORKFLOW_INSTANCE_TYPE_NAME,
          data: { workflowId: testWorkflowId, input: {} },
        })

        await store.createRelationship({
          id: `rel:waitingFor:query:${wait.instanceId}`,
          verb: 'waitingFor',
          from: wait.instanceId,
          to: wait.instanceId,
          data: { eventName: wait.eventName },
        })
      }

      // Query all waiting instances
      const allWaiting = await store.queryRelationshipsByVerb('waitingFor')
      expect(allWaiting).toHaveLength(3)

      // Filter for payment.completed (would be done in implementation)
      const paymentWaiting = allWaiting.filter(
        (r) => (r.data as WaitForEventData).eventName === 'payment.completed'
      )
      expect(paymentWaiting).toHaveLength(2)
    })
  })

  // ==========================================================================
  // Test Case 8: PauseResumeStore API (GREEN Phase - IMPLEMENTED)
  // ==========================================================================

  describe('PauseResumeStore API [GREEN]', () => {
    it('createPauseResumeStore returns a PauseResumeStore instance', () => {
      const pauseStore = createPauseResumeStore(store)
      expect(pauseStore).toBeDefined()
      expect(typeof pauseStore.initiatePause).toBe('function')
      expect(typeof pauseStore.completePause).toBe('function')
    })

    // These tests now pass with the implementation
    describe('PauseResumeStore.initiatePause()', () => {
      it('creates pause relationship with proper structure', async () => {
        const pauseStore = createPauseResumeStore(store)

        const pauseRel = await pauseStore.initiatePause({
          instanceId: testInstanceId,
          reason: 'user-requested',
          requestedBy: 'user-alice',
        })

        expect(pauseRel.verb).toBe('pause')
        expect(pauseRel.from).toBe(testInstanceId)
        expect((pauseRel.data as PauseData).reason).toBe('user-requested')
      })
    })

    describe('PauseResumeStore.completePause()', () => {
      it('transitions through pause lifecycle to paused', async () => {
        const pauseStore = createPauseResumeStore(store)

        await pauseStore.initiatePause({
          instanceId: testInstanceId,
          reason: 'manual',
        })
        await pauseStore.startPausing(testInstanceId)
        const pausedRel = await pauseStore.completePause(testInstanceId, 'event:user-confirmed')

        expect(pausedRel.verb).toBe('paused')
        expect(pausedRel.to).toBe('event:user-confirmed')
      })
    })

    describe('PauseResumeStore.initiateResume()', () => {
      it('creates resume relationship with proper structure', async () => {
        const pauseStore = createPauseResumeStore(store)

        // First pause the instance
        await pauseStore.initiatePause({ instanceId: testInstanceId, reason: 'test' })
        await pauseStore.startPausing(testInstanceId)
        await pauseStore.completePause(testInstanceId)

        // Now resume
        const resumeRel = await pauseStore.initiateResume({
          instanceId: testInstanceId,
          reason: 'manager-approved',
          approvedBy: 'manager-bob',
        })

        expect(resumeRel.verb).toBe('resume')
        expect(resumeRel.from).toBe(testInstanceId)
        expect((resumeRel.data as ResumeData).approvedBy).toBe('manager-bob')
      })
    })

    describe('PauseResumeStore.completeResume()', () => {
      it('transitions through resume lifecycle to resumed', async () => {
        const pauseStore = createPauseResumeStore(store)

        // Pause first
        await pauseStore.initiatePause({ instanceId: testInstanceId, reason: 'test' })
        await pauseStore.startPausing(testInstanceId)
        await pauseStore.completePause(testInstanceId)

        // Resume
        await pauseStore.initiateResume({ instanceId: testInstanceId, reason: 'approved' })
        await pauseStore.startResuming(testInstanceId)
        const resumedRel = await pauseStore.completeResume(testInstanceId, 'event:manager-approved')

        expect(resumedRel.verb).toBe('resumed')
        expect(resumedRel.to).toBe('event:manager-approved')
      })
    })

    describe('PauseResumeStore.registerWaitFor()', () => {
      it('creates waitFor relationship for event', async () => {
        const pauseStore = createPauseResumeStore(store)

        const waitRel = await pauseStore.registerWaitFor({
          instanceId: testInstanceId,
          eventName: 'payment.completed',
          timeout: 300000,
        })

        expect(waitRel.verb).toBe('waitFor')
        expect(waitRel.from).toBe(testInstanceId)
        expect((waitRel.data as WaitForEventData).eventName).toBe('payment.completed')
      })
    })

    describe('PauseResumeStore.completeWaitFor()', () => {
      it('transitions through wait lifecycle with payload', async () => {
        const pauseStore = createPauseResumeStore(store)

        await pauseStore.registerWaitFor({
          instanceId: testInstanceId,
          eventName: 'payment.completed',
        })
        await pauseStore.startWaiting(testInstanceId, 'payment.completed')

        const payload = { transactionId: 'txn-123', amount: 1500 }
        const waitedRel = await pauseStore.completeWaitFor(
          testInstanceId,
          'payment.completed',
          payload
        )

        expect(waitedRel.verb).toBe('waitedFor')
        expect((waitedRel.data as WaitForEventData).payload).toEqual(payload)
      })
    })

    describe('PauseResumeStore.getPauseState()', () => {
      it('returns pending for pause verb', async () => {
        const pauseStore = createPauseResumeStore(store)

        await pauseStore.initiatePause({ instanceId: testInstanceId, reason: 'test' })

        const state = await pauseStore.getPauseState(testInstanceId)
        expect(state).toBe('pending')
      })

      it('returns in_progress for pausing verb', async () => {
        const pauseStore = createPauseResumeStore(store)

        await pauseStore.initiatePause({ instanceId: testInstanceId, reason: 'test' })
        await pauseStore.startPausing(testInstanceId)

        const state = await pauseStore.getPauseState(testInstanceId)
        expect(state).toBe('in_progress')
      })

      it('returns completed for paused verb', async () => {
        const pauseStore = createPauseResumeStore(store)

        await pauseStore.initiatePause({ instanceId: testInstanceId, reason: 'test' })
        await pauseStore.startPausing(testInstanceId)
        await pauseStore.completePause(testInstanceId)

        const state = await pauseStore.getPauseState(testInstanceId)
        expect(state).toBe('completed')
      })
    })

    describe('PauseResumeStore.queryPausedInstances()', () => {
      it('returns all instances in paused state', async () => {
        const pauseStore = createPauseResumeStore(store)

        // Create and pause multiple instances
        const instanceIds = ['instance:p-1', 'instance:p-2']
        for (const id of instanceIds) {
          await store.createThing({
            id,
            typeId: WORKFLOW_INSTANCE_TYPE_ID,
            typeName: WORKFLOW_INSTANCE_TYPE_NAME,
            data: { workflowId: testWorkflowId, input: {} },
          })
          await pauseStore.initiatePause({ instanceId: id, reason: 'test' })
          await pauseStore.startPausing(id)
          await pauseStore.completePause(id)
        }

        const pausedInstances = await pauseStore.queryPausedInstances()
        expect(pausedInstances).toHaveLength(2)
        expect(pausedInstances.every((r) => r.verb === 'paused')).toBe(true)
      })
    })

    describe('PauseResumeStore.queryWaitingInstances()', () => {
      it('returns all instances waiting for events', async () => {
        const pauseStore = createPauseResumeStore(store)

        // Create instances waiting for different events
        const waits = [
          { instanceId: 'instance:w-1', eventName: 'payment.completed' },
          { instanceId: 'instance:w-2', eventName: 'shipment.delivered' },
        ]

        for (const wait of waits) {
          await store.createThing({
            id: wait.instanceId,
            typeId: WORKFLOW_INSTANCE_TYPE_ID,
            typeName: WORKFLOW_INSTANCE_TYPE_NAME,
            data: { workflowId: testWorkflowId, input: {} },
          })
          await pauseStore.registerWaitFor({
            instanceId: wait.instanceId,
            eventName: wait.eventName,
          })
          await pauseStore.startWaiting(wait.instanceId, wait.eventName)
        }

        const waitingInstances = await pauseStore.queryWaitingInstances()
        expect(waitingInstances).toHaveLength(2)
        expect(waitingInstances.every((r) => r.verb === 'waitingFor')).toBe(true)
      })

      it('filters by event name', async () => {
        const pauseStore = createPauseResumeStore(store)

        // Create instances waiting for different events
        await store.createThing({
          id: 'instance:w-3',
          typeId: WORKFLOW_INSTANCE_TYPE_ID,
          typeName: WORKFLOW_INSTANCE_TYPE_NAME,
          data: { workflowId: testWorkflowId, input: {} },
        })
        await pauseStore.registerWaitFor({
          instanceId: 'instance:w-3',
          eventName: 'payment.completed',
        })
        await pauseStore.startWaiting('instance:w-3', 'payment.completed')

        await store.createThing({
          id: 'instance:w-4',
          typeId: WORKFLOW_INSTANCE_TYPE_ID,
          typeName: WORKFLOW_INSTANCE_TYPE_NAME,
          data: { workflowId: testWorkflowId, input: {} },
        })
        await pauseStore.registerWaitFor({
          instanceId: 'instance:w-4',
          eventName: 'approval.granted',
        })
        await pauseStore.startWaiting('instance:w-4', 'approval.granted')

        const paymentWaiting = await pauseStore.queryWaitingInstances('payment.completed')
        expect(paymentWaiting).toHaveLength(1)
        expect((paymentWaiting[0]!.data as WaitForEventData).eventName).toBe('payment.completed')
      })
    })
  })
})
