/**
 * Schedule Triggers as Graph Relationships Tests
 *
 * TDD GREEN Phase: Tests for schedule->workflow trigger relationships
 * using verb form state encoding in the graph model.
 *
 * Graph Model:
 * - Schedule Thing (source) --triggers--> Workflow Thing (target)
 * - Uses verb form state encoding: trigger -> triggering -> triggered
 *
 * Tests cover:
 * 1. Schedule->Workflow relationship storage
 * 2. Trigger verb forms (trigger, triggering, triggered)
 * 3. Query schedules by workflow (reverse traversal)
 * 4. Trigger history tracking in graph
 * 5. Integration with ScheduleManager
 *
 * @see dotdo-rljoj - [GREEN] Implement schedule triggers as graph relationships
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Schedule CRUD
  createSchedule,
  getSchedule,
  getScheduleByUrl,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  // Trigger CRUD
  createTrigger,
  getTrigger,
  getTriggerState,
  // Trigger state transitions
  startTrigger,
  completeTrigger,
  failTrigger,
  // Query operations
  queryTriggersByState,
  querySchedulesByWorkflow,
  queryTriggersBySchedule,
  // History
  getTriggerHistory,
  getRecentTriggerHistory,
  // ScheduleManager integration
  fireScheduleTrigger,
  recordTriggerCompletion,
  recordTriggerFailure,
  // Utilities
  verbFormToState,
  stateToVerbForm,
  buildScheduleUrl,
  buildWorkflowUrl,
  // Types
  type ScheduleThing,
  type TriggerRelationship,
  type TriggerState,
  type TriggerData,
  type ScheduleByWorkflow,
  type TriggerHistoryEntry,
} from '../schedule-triggers'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestDb(): object {
  return {} // Empty object serves as unique db key for WeakMap stores
}

// ============================================================================
// TEST SUITE: Schedule Thing CRUD
// ============================================================================

describe('Schedule Thing CRUD', () => {
  let db: object

  beforeEach(() => {
    db = createTestDb()
  })

  describe('createSchedule', () => {
    it('creates a schedule thing with cron expression', async () => {
      const schedule = await createSchedule(db, {
        name: 'daily-report',
        cronExpression: '0 9 * * *',
        timezone: 'America/New_York',
      })

      expect(schedule.id).toBeDefined()
      expect(schedule.name).toBe('daily-report')
      expect(schedule.cronExpression).toBe('0 9 * * *')
      expect(schedule.timezone).toBe('America/New_York')
      expect(schedule.isActive).toBe(true)
      expect(schedule.url).toContain(schedule.id)
    })

    it('creates schedule with custom ID', async () => {
      const schedule = await createSchedule(db, {
        id: 'my-custom-schedule',
        name: 'custom-job',
        cronExpression: '*/15 * * * *',
      })

      expect(schedule.id).toBe('my-custom-schedule')
    })

    it('creates schedule with metadata', async () => {
      const schedule = await createSchedule(db, {
        name: 'with-metadata',
        cronExpression: '0 0 * * *',
        metadata: { owner: 'team-a', priority: 'high' },
      })

      expect(schedule.metadata).toEqual({ owner: 'team-a', priority: 'high' })
    })
  })

  describe('getSchedule', () => {
    it('retrieves schedule by ID', async () => {
      const created = await createSchedule(db, {
        name: 'test-schedule',
        cronExpression: '0 * * * *',
      })

      const retrieved = await getSchedule(db, created.id)

      expect(retrieved).toEqual(created)
    })

    it('returns null for non-existent schedule', async () => {
      const result = await getSchedule(db, 'non-existent')
      expect(result).toBeNull()
    })
  })

  describe('getScheduleByUrl', () => {
    it('retrieves schedule by URL', async () => {
      const created = await createSchedule(db, {
        name: 'url-test',
        cronExpression: '0 12 * * *',
      })

      const retrieved = await getScheduleByUrl(db, created.url)

      expect(retrieved).toEqual(created)
    })
  })

  describe('listSchedules', () => {
    it('lists all schedules', async () => {
      await createSchedule(db, { name: 'schedule-1', cronExpression: '0 9 * * *' })
      await createSchedule(db, { name: 'schedule-2', cronExpression: '0 12 * * *' })
      await createSchedule(db, { name: 'schedule-3', cronExpression: '0 18 * * *' })

      const schedules = await listSchedules(db)

      expect(schedules).toHaveLength(3)
    })

    it('filters active schedules only', async () => {
      const s1 = await createSchedule(db, { name: 'active', cronExpression: '0 9 * * *' })
      const s2 = await createSchedule(db, { name: 'inactive', cronExpression: '0 12 * * *' })
      await updateSchedule(db, s2.id, { isActive: false })

      const active = await listSchedules(db, { activeOnly: true })

      expect(active).toHaveLength(1)
      expect(active[0]!.name).toBe('active')
    })

    it('respects limit', async () => {
      await createSchedule(db, { name: 'schedule-1', cronExpression: '0 9 * * *' })
      await createSchedule(db, { name: 'schedule-2', cronExpression: '0 12 * * *' })
      await createSchedule(db, { name: 'schedule-3', cronExpression: '0 18 * * *' })

      const schedules = await listSchedules(db, { limit: 2 })

      expect(schedules).toHaveLength(2)
    })
  })

  describe('updateSchedule', () => {
    it('updates schedule properties', async () => {
      const schedule = await createSchedule(db, {
        name: 'original',
        cronExpression: '0 9 * * *',
      })

      const updated = await updateSchedule(db, schedule.id, {
        name: 'updated',
        cronExpression: '0 10 * * *',
        timezone: 'UTC',
      })

      expect(updated.name).toBe('updated')
      expect(updated.cronExpression).toBe('0 10 * * *')
      expect(updated.timezone).toBe('UTC')
      expect(updated.updatedAt.getTime()).toBeGreaterThan(schedule.updatedAt.getTime())
    })

    it('deactivates schedule', async () => {
      const schedule = await createSchedule(db, {
        name: 'to-deactivate',
        cronExpression: '0 9 * * *',
      })

      const updated = await updateSchedule(db, schedule.id, { isActive: false })

      expect(updated.isActive).toBe(false)
    })
  })

  describe('deleteSchedule', () => {
    it('deletes schedule', async () => {
      const schedule = await createSchedule(db, {
        name: 'to-delete',
        cronExpression: '0 9 * * *',
      })

      await deleteSchedule(db, schedule.id)

      const result = await getSchedule(db, schedule.id)
      expect(result).toBeNull()
    })
  })
})

// ============================================================================
// TEST SUITE: Trigger Relationship CRUD
// ============================================================================

describe('Trigger Relationship CRUD', () => {
  let db: object
  let schedule: ScheduleThing

  beforeEach(async () => {
    db = createTestDb()
    schedule = await createSchedule(db, {
      name: 'test-schedule',
      cronExpression: '0 9 * * *',
      timezone: 'UTC',
    })
  })

  describe('createTrigger', () => {
    it('creates trigger relationship in scheduled state', async () => {
      const trigger = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/my-workflow',
        cronExpression: schedule.cronExpression,
        timezone: schedule.timezone,
      })

      expect(trigger.id).toBeDefined()
      expect(trigger.verb).toBe('trigger') // Action form = scheduled
      expect(trigger.from).toBe(schedule.url)
      expect(trigger.to).toBe('https://workflows.do/my-workflow')
      expect(trigger.data?.cronExpression).toBe('0 9 * * *')
    })

    it('creates trigger with metadata', async () => {
      const trigger = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/workflow-1',
        cronExpression: '0 * * * *',
        metadata: { runId: 123, priority: 'high' },
      })

      expect(trigger.data?.metadata).toEqual({ runId: 123, priority: 'high' })
    })
  })

  describe('getTrigger', () => {
    it('retrieves trigger by ID', async () => {
      const created = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/workflow-1',
        cronExpression: '0 9 * * *',
      })

      const retrieved = await getTrigger(db, created.id)

      expect(retrieved).toEqual(created)
    })

    it('returns null for non-existent trigger', async () => {
      const result = await getTrigger(db, 'non-existent')
      expect(result).toBeNull()
    })
  })

  describe('getTriggerState', () => {
    it('returns scheduled state for action form', async () => {
      const trigger = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/workflow-1',
        cronExpression: '0 9 * * *',
      })

      const state = await getTriggerState(db, trigger.id)

      expect(state).toBe('scheduled')
    })

    it('returns null for non-existent trigger', async () => {
      const state = await getTriggerState(db, 'non-existent')
      expect(state).toBeNull()
    })
  })
})

// ============================================================================
// TEST SUITE: Trigger Verb Form State Machine
// ============================================================================

describe('Trigger Verb Form State Machine', () => {
  let db: object
  let schedule: ScheduleThing

  beforeEach(async () => {
    db = createTestDb()
    schedule = await createSchedule(db, {
      name: 'state-machine-test',
      cronExpression: '0 9 * * *',
    })
  })

  describe('verb form to state mapping', () => {
    it('maps trigger -> scheduled', () => {
      expect(verbFormToState('trigger')).toBe('scheduled')
    })

    it('maps triggering -> firing', () => {
      expect(verbFormToState('triggering')).toBe('firing')
    })

    it('maps triggered -> completed', () => {
      expect(verbFormToState('triggered')).toBe('completed')
    })
  })

  describe('state to verb form mapping', () => {
    it('maps scheduled -> trigger', () => {
      expect(stateToVerbForm('scheduled')).toBe('trigger')
    })

    it('maps firing -> triggering', () => {
      expect(stateToVerbForm('firing')).toBe('triggering')
    })

    it('maps completed -> triggered', () => {
      expect(stateToVerbForm('completed')).toBe('triggered')
    })
  })

  describe('startTrigger (scheduled -> firing)', () => {
    it('transitions trigger to activity form', async () => {
      const trigger = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/workflow-1',
        cronExpression: '0 9 * * *',
      })

      const firing = await startTrigger(db, trigger.id)

      expect(firing.verb).toBe('triggering') // Activity form
      expect(firing.to).toBeNull() // In-progress, target not resolved
      expect(firing.data?.firedAt).toBeDefined()
    })

    it('throws for invalid transition', async () => {
      const trigger = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/workflow-1',
        cronExpression: '0 9 * * *',
      })

      // Start once
      await startTrigger(db, trigger.id)

      // Cannot start again from firing state
      await expect(startTrigger(db, trigger.id)).rejects.toThrow(/Invalid transition/)
    })
  })

  describe('completeTrigger (firing -> completed)', () => {
    it('transitions trigger to event form with result', async () => {
      const trigger = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/workflow-1',
        cronExpression: '0 9 * * *',
      })

      await startTrigger(db, trigger.id)
      const completed = await completeTrigger(
        db,
        trigger.id,
        'https://workflows.do/instances/instance-123',
        150
      )

      expect(completed.verb).toBe('triggered') // Event form
      expect(completed.to).toBe('https://workflows.do/instances/instance-123')
      expect(completed.data?.executionDurationMs).toBe(150)
    })

    it('throws for invalid transition', async () => {
      const trigger = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/workflow-1',
        cronExpression: '0 9 * * *',
      })

      // Cannot complete from scheduled state
      await expect(
        completeTrigger(db, trigger.id, 'https://workflows.do/instances/x')
      ).rejects.toThrow(/Invalid transition/)
    })
  })

  describe('failTrigger (firing -> completed with error)', () => {
    it('transitions trigger to event form with error', async () => {
      const trigger = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/workflow-1',
        cronExpression: '0 9 * * *',
      })

      await startTrigger(db, trigger.id)
      const failed = await failTrigger(db, trigger.id, new Error('Workflow failed to start'))

      expect(failed.verb).toBe('triggered') // Event form (completed with failure)
      expect(failed.to).toBeNull() // No result due to failure
      expect(failed.data?.error).toBe('Workflow failed to start')
    })
  })

  describe('full lifecycle', () => {
    it('trigger -> triggering -> triggered', async () => {
      const trigger = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/workflow-1',
        cronExpression: '0 9 * * *',
      })

      // Initial state: scheduled
      expect(trigger.verb).toBe('trigger')
      expect(await getTriggerState(db, trigger.id)).toBe('scheduled')

      // Transition to firing
      const firing = await startTrigger(db, trigger.id)
      expect(firing.verb).toBe('triggering')
      expect(await getTriggerState(db, trigger.id)).toBe('firing')

      // Transition to completed
      const completed = await completeTrigger(
        db,
        trigger.id,
        'https://workflows.do/instances/result'
      )
      expect(completed.verb).toBe('triggered')
      expect(await getTriggerState(db, trigger.id)).toBe('completed')
    })
  })
})

// ============================================================================
// TEST SUITE: Query Operations
// ============================================================================

describe('Query Operations', () => {
  let db: object
  let schedule1: ScheduleThing
  let schedule2: ScheduleThing

  beforeEach(async () => {
    db = createTestDb()
    schedule1 = await createSchedule(db, {
      name: 'schedule-1',
      cronExpression: '0 9 * * *',
    })
    schedule2 = await createSchedule(db, {
      name: 'schedule-2',
      cronExpression: '0 18 * * *',
    })
  })

  describe('queryTriggersByState', () => {
    it('queries scheduled triggers', async () => {
      await createTrigger(db, {
        scheduleUrl: schedule1.url,
        workflowUrl: 'https://workflows.do/wf1',
        cronExpression: '0 9 * * *',
      })
      await createTrigger(db, {
        scheduleUrl: schedule2.url,
        workflowUrl: 'https://workflows.do/wf2',
        cronExpression: '0 18 * * *',
      })

      const scheduled = await queryTriggersByState(db, 'scheduled')

      expect(scheduled).toHaveLength(2)
      expect(scheduled.every((t) => t.verb === 'trigger')).toBe(true)
    })

    it('queries firing triggers', async () => {
      const t1 = await createTrigger(db, {
        scheduleUrl: schedule1.url,
        workflowUrl: 'https://workflows.do/wf1',
        cronExpression: '0 9 * * *',
      })
      await createTrigger(db, {
        scheduleUrl: schedule2.url,
        workflowUrl: 'https://workflows.do/wf2',
        cronExpression: '0 18 * * *',
      })

      await startTrigger(db, t1.id)

      const firing = await queryTriggersByState(db, 'firing')

      expect(firing).toHaveLength(1)
      expect(firing[0]!.verb).toBe('triggering')
    })

    it('queries completed triggers', async () => {
      const t1 = await createTrigger(db, {
        scheduleUrl: schedule1.url,
        workflowUrl: 'https://workflows.do/wf1',
        cronExpression: '0 9 * * *',
      })

      await startTrigger(db, t1.id)
      await completeTrigger(db, t1.id, 'https://workflows.do/instances/i1')

      const completed = await queryTriggersByState(db, 'completed')

      expect(completed).toHaveLength(1)
      expect(completed[0]!.verb).toBe('triggered')
    })

    it('filters by schedule URL', async () => {
      await createTrigger(db, {
        scheduleUrl: schedule1.url,
        workflowUrl: 'https://workflows.do/wf1',
        cronExpression: '0 9 * * *',
      })
      await createTrigger(db, {
        scheduleUrl: schedule2.url,
        workflowUrl: 'https://workflows.do/wf2',
        cronExpression: '0 18 * * *',
      })

      const filtered = await queryTriggersByState(db, 'scheduled', {
        scheduleUrl: schedule1.url,
      })

      expect(filtered).toHaveLength(1)
      expect(filtered[0]!.from).toBe(schedule1.url)
    })
  })

  describe('querySchedulesByWorkflow (reverse traversal)', () => {
    it('finds schedules that trigger a workflow', async () => {
      const workflowUrl = 'https://workflows.do/target-workflow'

      await createTrigger(db, {
        scheduleUrl: schedule1.url,
        workflowUrl,
        cronExpression: '0 9 * * *',
      })
      await createTrigger(db, {
        scheduleUrl: schedule2.url,
        workflowUrl,
        cronExpression: '0 18 * * *',
      })

      const results = await querySchedulesByWorkflow(db, workflowUrl)

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.schedule.name).sort()).toEqual(['schedule-1', 'schedule-2'])
    })

    it('excludes completed triggers by default', async () => {
      const workflowUrl = 'https://workflows.do/target-workflow'

      const t1 = await createTrigger(db, {
        scheduleUrl: schedule1.url,
        workflowUrl,
        cronExpression: '0 9 * * *',
      })
      await createTrigger(db, {
        scheduleUrl: schedule2.url,
        workflowUrl,
        cronExpression: '0 18 * * *',
      })

      // Complete one trigger
      await startTrigger(db, t1.id)
      await completeTrigger(db, t1.id, 'https://workflows.do/instances/i1')

      const results = await querySchedulesByWorkflow(db, workflowUrl)

      expect(results).toHaveLength(1)
      expect(results[0]!.schedule.name).toBe('schedule-2')
    })

    it('includes completed triggers when requested', async () => {
      const workflowUrl = 'https://workflows.do/target-workflow'

      const t1 = await createTrigger(db, {
        scheduleUrl: schedule1.url,
        workflowUrl,
        cronExpression: '0 9 * * *',
      })

      await startTrigger(db, t1.id)
      await completeTrigger(db, t1.id, 'https://workflows.do/instances/i1')

      const results = await querySchedulesByWorkflow(db, workflowUrl, {
        includeCompleted: true,
      })

      expect(results).toHaveLength(1)
      expect(results[0]!.state).toBe('completed')
    })
  })

  describe('queryTriggersBySchedule (forward traversal)', () => {
    it('finds triggers for a schedule', async () => {
      await createTrigger(db, {
        scheduleUrl: schedule1.url,
        workflowUrl: 'https://workflows.do/wf1',
        cronExpression: '0 9 * * *',
      })
      await createTrigger(db, {
        scheduleUrl: schedule1.url,
        workflowUrl: 'https://workflows.do/wf2',
        cronExpression: '0 9 * * *',
      })
      await createTrigger(db, {
        scheduleUrl: schedule2.url,
        workflowUrl: 'https://workflows.do/wf3',
        cronExpression: '0 18 * * *',
      })

      const triggers = await queryTriggersBySchedule(db, schedule1.url)

      expect(triggers).toHaveLength(2)
      expect(triggers.every((t) => t.from === schedule1.url)).toBe(true)
    })

    it('filters by state', async () => {
      const t1 = await createTrigger(db, {
        scheduleUrl: schedule1.url,
        workflowUrl: 'https://workflows.do/wf1',
        cronExpression: '0 9 * * *',
      })
      await createTrigger(db, {
        scheduleUrl: schedule1.url,
        workflowUrl: 'https://workflows.do/wf2',
        cronExpression: '0 9 * * *',
      })

      await startTrigger(db, t1.id)

      const firing = await queryTriggersBySchedule(db, schedule1.url, { state: 'firing' })

      expect(firing).toHaveLength(1)
      expect(firing[0]!.verb).toBe('triggering')
    })
  })
})

// ============================================================================
// TEST SUITE: Trigger History
// ============================================================================

describe('Trigger History', () => {
  let db: object
  let schedule: ScheduleThing

  beforeEach(async () => {
    db = createTestDb()
    schedule = await createSchedule(db, {
      name: 'history-test',
      cronExpression: '0 * * * *',
    })
  })

  describe('getTriggerHistory', () => {
    it('returns completed triggers for a schedule', async () => {
      // Create and complete multiple triggers
      for (let i = 0; i < 3; i++) {
        const t = await createTrigger(db, {
          scheduleUrl: schedule.url,
          workflowUrl: `https://workflows.do/wf-${i}`,
          cronExpression: '0 * * * *',
        })
        await startTrigger(db, t.id)
        await completeTrigger(db, t.id, `https://workflows.do/instances/i-${i}`)
      }

      const history = await getTriggerHistory(db, schedule.url)

      expect(history).toHaveLength(3)
      expect(history.every((h) => h.state === 'completed')).toBe(true)
    })

    it('orders by completion time descending', async () => {
      const t1 = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/wf-1',
        cronExpression: '0 * * * *',
      })
      await startTrigger(db, t1.id)
      await completeTrigger(db, t1.id, 'https://workflows.do/instances/i-1')

      const t2 = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/wf-2',
        cronExpression: '0 * * * *',
      })
      await startTrigger(db, t2.id)
      await completeTrigger(db, t2.id, 'https://workflows.do/instances/i-2')

      const history = await getTriggerHistory(db, schedule.url)

      // Most recent first
      expect(history[0]!.triggerId).toBe(t2.id)
      expect(history[1]!.triggerId).toBe(t1.id)
    })

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        const t = await createTrigger(db, {
          scheduleUrl: schedule.url,
          workflowUrl: `https://workflows.do/wf-${i}`,
          cronExpression: '0 * * * *',
        })
        await startTrigger(db, t.id)
        await completeTrigger(db, t.id, `https://workflows.do/instances/i-${i}`)
      }

      const history = await getTriggerHistory(db, schedule.url, { limit: 3 })

      expect(history).toHaveLength(3)
    })

    it('includes error information for failed triggers', async () => {
      const t = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/wf-1',
        cronExpression: '0 * * * *',
      })
      await startTrigger(db, t.id)
      await failTrigger(db, t.id, new Error('Connection timeout'))

      const history = await getTriggerHistory(db, schedule.url)

      expect(history).toHaveLength(1)
      expect(history[0]!.error).toBe('Connection timeout')
    })
  })

  describe('getRecentTriggerHistory', () => {
    it('returns recent triggers across all schedules', async () => {
      const schedule2 = await createSchedule(db, {
        name: 'schedule-2',
        cronExpression: '0 12 * * *',
      })

      const t1 = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/wf-1',
        cronExpression: '0 * * * *',
      })
      await startTrigger(db, t1.id)
      await completeTrigger(db, t1.id, 'https://workflows.do/instances/i-1')

      const t2 = await createTrigger(db, {
        scheduleUrl: schedule2.url,
        workflowUrl: 'https://workflows.do/wf-2',
        cronExpression: '0 12 * * *',
      })
      await startTrigger(db, t2.id)
      await completeTrigger(db, t2.id, 'https://workflows.do/instances/i-2')

      const history = await getRecentTriggerHistory(db)

      expect(history).toHaveLength(2)
    })

    it('filters by workflow URL', async () => {
      const targetWorkflow = 'https://workflows.do/target'

      const t1 = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: targetWorkflow,
        cronExpression: '0 * * * *',
      })
      await startTrigger(db, t1.id)
      await completeTrigger(db, t1.id, targetWorkflow + '/instances/i-1')

      const t2 = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: 'https://workflows.do/other',
        cronExpression: '0 * * * *',
      })
      await startTrigger(db, t2.id)
      await completeTrigger(db, t2.id, 'https://workflows.do/other/instances/i-2')

      const history = await getRecentTriggerHistory(db, {
        workflowUrl: targetWorkflow + '/instances/i-1',
      })

      expect(history).toHaveLength(1)
      expect(history[0]!.workflowUrl).toBe(targetWorkflow + '/instances/i-1')
    })
  })
})

// ============================================================================
// TEST SUITE: ScheduleManager Integration
// ============================================================================

describe('ScheduleManager Integration', () => {
  let db: object
  let schedule: ScheduleThing

  beforeEach(async () => {
    db = createTestDb()
    schedule = await createSchedule(db, {
      name: 'integration-test',
      cronExpression: '0 9 * * *',
      timezone: 'America/New_York',
      metadata: { department: 'engineering' },
    })
  })

  describe('fireScheduleTrigger', () => {
    it('creates and starts a trigger', async () => {
      const trigger = await fireScheduleTrigger(
        db,
        schedule.id,
        'https://workflows.do/my-workflow'
      )

      expect(trigger.verb).toBe('triggering') // Started, in firing state
      expect(trigger.from).toBe(schedule.url)
      expect(trigger.to).toBeNull() // In-progress
      expect(trigger.data?.firedAt).toBeDefined()
    })

    it('copies schedule metadata to trigger', async () => {
      const trigger = await fireScheduleTrigger(
        db,
        schedule.id,
        'https://workflows.do/my-workflow'
      )

      expect(trigger.data?.metadata?.department).toBe('engineering')
    })

    it('marks catchup triggers', async () => {
      const trigger = await fireScheduleTrigger(
        db,
        schedule.id,
        'https://workflows.do/my-workflow',
        { isCatchup: true }
      )

      expect(trigger.data?.isCatchup).toBe(true)
    })

    it('throws for non-existent schedule', async () => {
      await expect(
        fireScheduleTrigger(db, 'non-existent', 'https://workflows.do/wf')
      ).rejects.toThrow(/Schedule not found/)
    })
  })

  describe('recordTriggerCompletion', () => {
    it('completes a firing trigger', async () => {
      const firing = await fireScheduleTrigger(
        db,
        schedule.id,
        'https://workflows.do/my-workflow'
      )

      const completed = await recordTriggerCompletion(
        db,
        firing.id,
        'https://workflows.do/instances/i-123'
      )

      expect(completed.verb).toBe('triggered')
      expect(completed.to).toBe('https://workflows.do/instances/i-123')
      expect(completed.data?.executionDurationMs).toBeDefined()
    })
  })

  describe('recordTriggerFailure', () => {
    it('records trigger failure', async () => {
      const firing = await fireScheduleTrigger(
        db,
        schedule.id,
        'https://workflows.do/my-workflow'
      )

      const failed = await recordTriggerFailure(
        db,
        firing.id,
        new Error('Workflow quota exceeded')
      )

      expect(failed.verb).toBe('triggered')
      expect(failed.to).toBeNull()
      expect(failed.data?.error).toBe('Workflow quota exceeded')
    })
  })

  describe('full integration workflow', () => {
    it('handles complete trigger lifecycle', async () => {
      // 1. Schedule fires trigger
      const firing = await fireScheduleTrigger(
        db,
        schedule.id,
        'https://workflows.do/my-workflow'
      )
      expect(await getTriggerState(db, firing.id)).toBe('firing')

      // 2. Workflow instance created, record completion
      const completed = await recordTriggerCompletion(
        db,
        firing.id,
        'https://workflows.do/instances/run-abc'
      )
      expect(await getTriggerState(db, completed.id)).toBe('completed')

      // 3. Query history
      const history = await getTriggerHistory(db, schedule.url)
      expect(history).toHaveLength(1)
      expect(history[0]!.workflowUrl).toBe('https://workflows.do/instances/run-abc')
    })

    it('handles multiple triggers from same schedule', async () => {
      // Fire multiple triggers over time
      for (let i = 0; i < 3; i++) {
        const firing = await fireScheduleTrigger(
          db,
          schedule.id,
          'https://workflows.do/my-workflow'
        )
        await recordTriggerCompletion(
          db,
          firing.id,
          `https://workflows.do/instances/run-${i}`
        )
      }

      // Check history
      const history = await getTriggerHistory(db, schedule.url)
      expect(history).toHaveLength(3)

      // Query active triggers (should be none)
      const active = await queryTriggersBySchedule(db, schedule.url, { state: 'scheduled' })
      expect(active).toHaveLength(0)
    })
  })
})

// ============================================================================
// TEST SUITE: URL Building
// ============================================================================

describe('URL Building', () => {
  it('builds schedule URLs', () => {
    const url = buildScheduleUrl('my-schedule-123')
    expect(url).toBe('https://schedules.do/my-schedule-123')
  })

  it('builds workflow URLs', () => {
    const url = buildWorkflowUrl('my-workflow-456')
    expect(url).toBe('https://workflows.do/my-workflow-456')
  })
})

// ============================================================================
// TEST SUITE: Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  let db: object

  beforeEach(() => {
    db = createTestDb()
  })

  it('handles schedules with same cron expression', async () => {
    const s1 = await createSchedule(db, {
      name: 'morning-report-1',
      cronExpression: '0 9 * * *',
    })
    const s2 = await createSchedule(db, {
      name: 'morning-report-2',
      cronExpression: '0 9 * * *',
    })

    expect(s1.cronExpression).toBe(s2.cronExpression)
    expect(s1.id).not.toBe(s2.id)
  })

  it('handles workflow triggered by multiple schedules', async () => {
    const workflowUrl = 'https://workflows.do/shared-workflow'

    const s1 = await createSchedule(db, {
      name: 'schedule-1',
      cronExpression: '0 9 * * *',
    })
    const s2 = await createSchedule(db, {
      name: 'schedule-2',
      cronExpression: '0 18 * * *',
    })

    await createTrigger(db, {
      scheduleUrl: s1.url,
      workflowUrl,
      cronExpression: s1.cronExpression,
    })
    await createTrigger(db, {
      scheduleUrl: s2.url,
      workflowUrl,
      cronExpression: s2.cronExpression,
    })

    const schedules = await querySchedulesByWorkflow(db, workflowUrl)

    expect(schedules).toHaveLength(2)
    expect(schedules.map((s) => s.schedule.name).sort()).toEqual(['schedule-1', 'schedule-2'])
  })

  it('handles rapid successive triggers', async () => {
    const schedule = await createSchedule(db, {
      name: 'rapid-test',
      cronExpression: '* * * * *',
    })

    const triggers: TriggerRelationship[] = []
    for (let i = 0; i < 10; i++) {
      const t = await createTrigger(db, {
        scheduleUrl: schedule.url,
        workflowUrl: `https://workflows.do/wf-${i}`,
        cronExpression: schedule.cronExpression,
      })
      triggers.push(t)
    }

    expect(triggers).toHaveLength(10)
    expect(new Set(triggers.map((t) => t.id)).size).toBe(10) // All unique IDs
  })
})
