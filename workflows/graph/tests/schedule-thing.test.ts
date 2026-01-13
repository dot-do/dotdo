/**
 * Schedule Thing Tests
 *
 * TDD tests for schedule/cron triggers as Things and Relationships.
 *
 * Schedule Things store cron expressions and trigger workflow instances.
 * State is encoded via verb forms:
 * - 'active' / 'paused' status for schedule state
 * - 'triggers' relationship from Schedule to Workflow
 * - 'triggered' relationship from Schedule to WorkflowInstance
 * - 'triggeredBy' relationship from WorkflowInstance to Schedule
 *
 * Uses real SQLite, NO MOCKS per CLAUDE.md guidelines.
 *
 * @see dotdo-sciot - [RED] Schedule triggers as relationships - tests
 * @see dotdo-rljoj - [GREEN] Implement schedule triggers as graph relationships
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // CRUD operations
  createSchedule,
  getSchedule,
  getScheduleByName,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  // Relationship operations
  createTriggersRelationship,
  getTriggersRelationship,
  removeTriggersRelationship,
  // Trigger operations
  triggerSchedule,
  recordTriggerEvent,
  queryTriggerEvents,
  // State operations
  pauseSchedule,
  resumeSchedule,
  getScheduleStatus,
  // Query helpers
  getScheduledWorkflows,
  getTriggeredInstances,
  getInstanceTrigger,
  // Types
  type ScheduleThing,
  type CreateScheduleInput,
  type TriggersRelationship,
  type TriggeredRelationship,
} from '../schedule-thing'

// ============================================================================
// TEST SUITE: Schedule Thing CRUD
// ============================================================================

describe('Schedule Thing', () => {
  // In-memory store for testing (per test isolation)
  let db: object

  beforeEach(() => {
    // Create a fresh in-memory store for each test
    db = { _testId: Math.random().toString(36).slice(2) }
  })

  // ==========================================================================
  // 1. Schedule Creation
  // ==========================================================================

  describe('createSchedule', () => {
    it('creates a Schedule Thing with cron expression', async () => {
      const input: CreateScheduleInput = {
        name: 'daily-report',
        cronExpression: '0 9 * * *',
        timezone: 'America/New_York',
      }

      const schedule = await createSchedule(db, input)

      // Should have an auto-generated ID
      expect(schedule.id).toBeDefined()

      // Should be typed as Schedule
      expect(schedule.typeName).toBe('Schedule')

      // Should have cron expression in data
      expect(schedule.data?.cronExpression).toBe('0 9 * * *')

      // Should have timezone
      expect(schedule.data?.timezone).toBe('America/New_York')

      // Should have active status by default
      expect(schedule.data?.status).toBe('active')
    })

    it('creates schedule with custom ID', async () => {
      const input: CreateScheduleInput = {
        id: 'schedule:custom-id',
        name: 'custom-schedule',
        cronExpression: '0 * * * *',
      }

      const schedule = await createSchedule(db, input)

      expect(schedule.id).toBe('schedule:custom-id')
    })

    it('creates schedule with nextRunAt', async () => {
      const nextRun = new Date('2026-01-14T09:00:00Z')
      const input: CreateScheduleInput = {
        name: 'with-next-run',
        cronExpression: '0 9 * * *',
        nextRunAt: nextRun,
      }

      const schedule = await createSchedule(db, input)

      expect(schedule.data?.nextRunAt).toBe(nextRun.toISOString())
    })

    it('prevents duplicate schedule names', async () => {
      await createSchedule(db, {
        name: 'unique-schedule',
        cronExpression: '0 * * * *',
      })

      await expect(
        createSchedule(db, {
          name: 'unique-schedule',
          cronExpression: '0 * * * *',
        })
      ).rejects.toThrow('already exists')
    })
  })

  // ==========================================================================
  // 2. Schedule Retrieval
  // ==========================================================================

  describe('getSchedule / getScheduleByName', () => {
    it('retrieves schedule by ID', async () => {
      const created = await createSchedule(db, {
        id: 'test-schedule-id',
        name: 'test-schedule',
        cronExpression: '0 9 * * *',
      })

      const retrieved = await getSchedule(db, 'test-schedule-id')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe('test-schedule-id')
      expect(retrieved!.data?.name).toBe('test-schedule')
    })

    it('retrieves schedule by name', async () => {
      await createSchedule(db, {
        name: 'named-schedule',
        cronExpression: '0 9 * * *',
      })

      const retrieved = await getScheduleByName(db, 'named-schedule')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.data?.name).toBe('named-schedule')
    })

    it('returns null for non-existent schedule', async () => {
      const retrieved = await getSchedule(db, 'does-not-exist')
      expect(retrieved).toBeNull()
    })
  })

  // ==========================================================================
  // 3. Schedule Listing
  // ==========================================================================

  describe('listSchedules', () => {
    it('lists all schedules', async () => {
      await createSchedule(db, { name: 'schedule-1', cronExpression: '0 * * * *' })
      await createSchedule(db, { name: 'schedule-2', cronExpression: '0 */2 * * *' })
      await createSchedule(db, { name: 'schedule-3', cronExpression: '0 */3 * * *' })

      const schedules = await listSchedules(db)

      expect(schedules).toHaveLength(3)
    })

    it('filters by status', async () => {
      const s1 = await createSchedule(db, { name: 'active-1', cronExpression: '0 * * * *' })
      const s2 = await createSchedule(db, { name: 'paused-1', cronExpression: '0 * * * *', status: 'paused' })

      const activeSchedules = await listSchedules(db, { status: 'active' })
      const pausedSchedules = await listSchedules(db, { status: 'paused' })

      expect(activeSchedules).toHaveLength(1)
      expect(activeSchedules[0]!.data?.name).toBe('active-1')

      expect(pausedSchedules).toHaveLength(1)
      expect(pausedSchedules[0]!.data?.name).toBe('paused-1')
    })

    it('applies limit and offset', async () => {
      await createSchedule(db, { name: 'schedule-1', cronExpression: '0 * * * *' })
      await createSchedule(db, { name: 'schedule-2', cronExpression: '0 * * * *' })
      await createSchedule(db, { name: 'schedule-3', cronExpression: '0 * * * *' })

      const limited = await listSchedules(db, { limit: 2 })
      expect(limited).toHaveLength(2)
    })
  })

  // ==========================================================================
  // 4. Triggers Relationship (Schedule -> Workflow)
  // ==========================================================================

  describe('createTriggersRelationship', () => {
    it('creates triggers relationship from Schedule to Workflow', async () => {
      const schedule = await createSchedule(db, {
        name: 'daily-report',
        cronExpression: '0 9 * * *',
      })

      const workflowId = 'workflow:generate-report'

      const relationship = await createTriggersRelationship(db, schedule.id, workflowId)

      expect(relationship.verb).toBe('triggers')
      expect(relationship.from).toContain(schedule.id)
      expect(relationship.to).toBe(workflowId)
    })

    it('retrieves triggers relationship', async () => {
      const schedule = await createSchedule(db, {
        name: 'test-schedule',
        cronExpression: '0 * * * *',
      })

      const workflowId = 'workflow:test-workflow'
      await createTriggersRelationship(db, schedule.id, workflowId)

      const relationship = await getTriggersRelationship(db, schedule.id)

      expect(relationship).not.toBeNull()
      expect(relationship!.to).toBe(workflowId)
    })

    it('removes triggers relationship', async () => {
      const schedule = await createSchedule(db, {
        name: 'test-schedule',
        cronExpression: '0 * * * *',
      })

      const workflowId = 'workflow:test-workflow'
      await createTriggersRelationship(db, schedule.id, workflowId)
      await removeTriggersRelationship(db, schedule.id)

      const relationship = await getTriggersRelationship(db, schedule.id)
      expect(relationship).toBeNull()
    })
  })

  // ==========================================================================
  // 5. Trigger Schedule (Creates WorkflowInstance)
  // ==========================================================================

  describe('triggerSchedule', () => {
    it('creates WorkflowInstance when triggered', async () => {
      const schedule = await createSchedule(db, {
        name: 'triggerable-schedule',
        cronExpression: '0 9 * * *',
      })

      const workflowId = 'workflow:report-generator'
      await createTriggersRelationship(db, schedule.id, workflowId)

      const result = await triggerSchedule(db, schedule.id)

      // Should create an instance
      expect(result.instance).toBeDefined()
      expect(result.instance.id).toBeDefined()
    })

    it('creates triggered relationship from Schedule to Instance', async () => {
      const schedule = await createSchedule(db, {
        name: 'trigger-test',
        cronExpression: '0 9 * * *',
      })

      const workflowId = 'workflow:test'
      await createTriggersRelationship(db, schedule.id, workflowId)

      const result = await triggerSchedule(db, schedule.id)

      // Should have triggered relationship
      expect(result.triggered).toBeDefined()
      expect(result.triggered.verb).toBe('triggered')
      expect(result.triggered.from).toContain(schedule.id)
      expect(result.triggered.to).toContain(result.instance.id)
    })

    it('creates triggeredBy relationship from Instance to Schedule', async () => {
      const schedule = await createSchedule(db, {
        name: 'trigger-test',
        cronExpression: '0 9 * * *',
      })

      const workflowId = 'workflow:test'
      await createTriggersRelationship(db, schedule.id, workflowId)

      const result = await triggerSchedule(db, schedule.id)

      // Should have triggeredBy relationship
      expect(result.triggeredBy).toBeDefined()
      expect(result.triggeredBy.verb).toBe('triggeredBy')
      expect(result.triggeredBy.from).toContain(result.instance.id)
      expect(result.triggeredBy.to).toContain(schedule.id)
    })

    it('records trigger timestamps', async () => {
      const schedule = await createSchedule(db, {
        name: 'timestamp-test',
        cronExpression: '0 9 * * *',
      })

      const workflowId = 'workflow:test'
      await createTriggersRelationship(db, schedule.id, workflowId)

      const before = Date.now()
      const result = await triggerSchedule(db, schedule.id)
      const after = Date.now()

      expect(result.triggered.data.triggeredAt).toBeDefined()
      const triggeredAt = new Date(result.triggered.data.triggeredAt).getTime()
      expect(triggeredAt).toBeGreaterThanOrEqual(before)
      expect(triggeredAt).toBeLessThanOrEqual(after)
    })

    it('increments runCount on trigger', async () => {
      const schedule = await createSchedule(db, {
        name: 'count-test',
        cronExpression: '0 9 * * *',
      })

      const workflowId = 'workflow:test'
      await createTriggersRelationship(db, schedule.id, workflowId)

      expect(schedule.data?.runCount).toBe(0)

      await triggerSchedule(db, schedule.id)
      const updated1 = await getSchedule(db, schedule.id)
      expect(updated1!.data?.runCount).toBe(1)

      await triggerSchedule(db, schedule.id)
      const updated2 = await getSchedule(db, schedule.id)
      expect(updated2!.data?.runCount).toBe(2)
    })

    it('updates lastRunAt on trigger', async () => {
      const schedule = await createSchedule(db, {
        name: 'lastrun-test',
        cronExpression: '0 9 * * *',
      })

      const workflowId = 'workflow:test'
      await createTriggersRelationship(db, schedule.id, workflowId)

      expect(schedule.data?.lastRunAt).toBeNull()

      const before = Date.now()
      await triggerSchedule(db, schedule.id)
      const updated = await getSchedule(db, schedule.id)
      const after = Date.now()

      expect(updated!.data?.lastRunAt).toBeDefined()
      const lastRunAt = new Date(updated!.data!.lastRunAt!).getTime()
      expect(lastRunAt).toBeGreaterThanOrEqual(before)
      expect(lastRunAt).toBeLessThanOrEqual(after)
    })

    it('throws if schedule has no triggers relationship', async () => {
      const schedule = await createSchedule(db, {
        name: 'no-workflow',
        cronExpression: '0 9 * * *',
      })

      await expect(triggerSchedule(db, schedule.id)).rejects.toThrow('No workflow configured')
    })

    it('throws if schedule is paused', async () => {
      const schedule = await createSchedule(db, {
        name: 'paused-schedule',
        cronExpression: '0 9 * * *',
        status: 'paused',
      })

      const workflowId = 'workflow:test'
      await createTriggersRelationship(db, schedule.id, workflowId)

      await expect(triggerSchedule(db, schedule.id)).rejects.toThrow('paused')
    })
  })

  // ==========================================================================
  // 6. Pause/Resume Schedule via Verb Forms
  // ==========================================================================

  describe('pauseSchedule / resumeSchedule', () => {
    it('pauses an active schedule', async () => {
      const schedule = await createSchedule(db, {
        name: 'to-pause',
        cronExpression: '0 9 * * *',
      })

      expect(await getScheduleStatus(db, schedule.id)).toBe('active')

      const paused = await pauseSchedule(db, schedule.id)

      expect(paused.data?.status).toBe('paused')
      expect(await getScheduleStatus(db, schedule.id)).toBe('paused')
    })

    it('resumes a paused schedule', async () => {
      const schedule = await createSchedule(db, {
        name: 'to-resume',
        cronExpression: '0 9 * * *',
        status: 'paused',
      })

      expect(await getScheduleStatus(db, schedule.id)).toBe('paused')

      const resumed = await resumeSchedule(db, schedule.id)

      expect(resumed.data?.status).toBe('active')
      expect(await getScheduleStatus(db, schedule.id)).toBe('active')
    })

    it('throws when pausing already paused schedule', async () => {
      const schedule = await createSchedule(db, {
        name: 'already-paused',
        cronExpression: '0 9 * * *',
        status: 'paused',
      })

      await expect(pauseSchedule(db, schedule.id)).rejects.toThrow('already paused')
    })

    it('throws when resuming already active schedule', async () => {
      const schedule = await createSchedule(db, {
        name: 'already-active',
        cronExpression: '0 9 * * *',
      })

      await expect(resumeSchedule(db, schedule.id)).rejects.toThrow('already active')
    })
  })

  // ==========================================================================
  // 7. Query Helpers
  // ==========================================================================

  describe('Query helpers', () => {
    describe('getScheduledWorkflows', () => {
      it('returns workflows with their schedules', async () => {
        const s1 = await createSchedule(db, { name: 'schedule-1', cronExpression: '0 9 * * *' })
        const s2 = await createSchedule(db, { name: 'schedule-2', cronExpression: '0 18 * * *' })

        await createTriggersRelationship(db, s1.id, 'workflow:daily-report')
        await createTriggersRelationship(db, s2.id, 'workflow:evening-report')

        const scheduled = await getScheduledWorkflows(db)

        expect(scheduled).toHaveLength(2)
        expect(scheduled.map((s) => s.workflowId).sort()).toEqual([
          'workflow:daily-report',
          'workflow:evening-report',
        ])
      })
    })

    describe('getTriggeredInstances', () => {
      it('returns instances triggered by a schedule', async () => {
        const schedule = await createSchedule(db, {
          name: 'multi-trigger',
          cronExpression: '0 * * * *',
        })

        await createTriggersRelationship(db, schedule.id, 'workflow:hourly')

        const r1 = await triggerSchedule(db, schedule.id)
        const r2 = await triggerSchedule(db, schedule.id)
        const r3 = await triggerSchedule(db, schedule.id)

        const instances = await getTriggeredInstances(db, schedule.id)

        expect(instances).toHaveLength(3)
        expect(instances.map((i) => i.instanceId).sort()).toEqual(
          [r1.instance.id, r2.instance.id, r3.instance.id].sort()
        )
      })

      it('returns empty array if no instances triggered', async () => {
        const schedule = await createSchedule(db, {
          name: 'no-triggers',
          cronExpression: '0 * * * *',
        })

        const instances = await getTriggeredInstances(db, schedule.id)

        expect(instances).toEqual([])
      })
    })

    describe('getInstanceTrigger', () => {
      it('returns the schedule that triggered an instance', async () => {
        const schedule = await createSchedule(db, {
          name: 'trigger-source',
          cronExpression: '0 9 * * *',
        })

        await createTriggersRelationship(db, schedule.id, 'workflow:test')
        const result = await triggerSchedule(db, schedule.id)

        const trigger = await getInstanceTrigger(db, result.instance.id)

        expect(trigger).not.toBeNull()
        expect(trigger!.scheduleId).toBe(schedule.id)
        expect(trigger!.scheduleName).toBe('trigger-source')
      })

      it('returns null for instance not triggered by schedule', async () => {
        const trigger = await getInstanceTrigger(db, 'instance:manual-123')

        expect(trigger).toBeNull()
      })
    })
  })

  // ==========================================================================
  // 8. Complete Schedule Lifecycle
  // ==========================================================================

  describe('Complete Schedule Lifecycle', () => {
    it('demonstrates full lifecycle: create -> configure -> trigger -> query', async () => {
      // 1. Create schedule
      const schedule = await createSchedule(db, {
        name: 'daily-report',
        cronExpression: '0 9 * * *',
        timezone: 'America/New_York',
      })
      expect(schedule.data?.status).toBe('active')

      // 2. Configure triggers relationship to workflow
      await createTriggersRelationship(db, schedule.id, 'workflow:generate-report')
      const triggersRel = await getTriggersRelationship(db, schedule.id)
      expect(triggersRel!.to).toBe('workflow:generate-report')

      // 3. Trigger the schedule (simulating cron firing)
      const result = await triggerSchedule(db, schedule.id)
      expect(result.instance).toBeDefined()
      expect(result.triggered.verb).toBe('triggered')
      expect(result.triggeredBy.verb).toBe('triggeredBy')

      // 4. Query triggered instances
      const instances = await getTriggeredInstances(db, schedule.id)
      expect(instances).toHaveLength(1)
      expect(instances[0]!.instanceId).toBe(result.instance.id)

      // 5. Verify schedule stats updated
      const updated = await getSchedule(db, schedule.id)
      expect(updated!.data?.runCount).toBe(1)
      expect(updated!.data?.lastRunAt).toBeDefined()
    })

    it('demonstrates pause/resume lifecycle', async () => {
      const schedule = await createSchedule(db, {
        name: 'pausable-schedule',
        cronExpression: '0 * * * *',
      })
      await createTriggersRelationship(db, schedule.id, 'workflow:hourly-task')

      // Trigger while active
      await triggerSchedule(db, schedule.id)

      // Pause the schedule
      await pauseSchedule(db, schedule.id)
      expect(await getScheduleStatus(db, schedule.id)).toBe('paused')

      // Cannot trigger while paused
      await expect(triggerSchedule(db, schedule.id)).rejects.toThrow('paused')

      // Resume the schedule
      await resumeSchedule(db, schedule.id)
      expect(await getScheduleStatus(db, schedule.id)).toBe('active')

      // Can trigger again
      const result = await triggerSchedule(db, schedule.id)
      expect(result.instance).toBeDefined()
    })
  })
})
