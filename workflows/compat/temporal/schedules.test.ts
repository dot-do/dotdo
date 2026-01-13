/**
 * Temporal Schedules Compat Layer Tests
 *
 * Tests for Temporal Schedule API compatibility including:
 * - Schedule creation and management
 * - Cron-based schedules
 * - Interval-based schedules
 * - Schedule pausing/resuming
 * - Schedule queries
 * - Schedule history
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  WorkflowClient,
  defineSignal,
  setHandler,
  sleep,
} from './index'

// ============================================================================
// SCHEDULE CLIENT
// ============================================================================

/**
 * Schedule specification for workflow execution
 */
interface ScheduleSpec {
  /** Cron expression for scheduled execution */
  cronExpressions?: string[]
  /** Interval between executions */
  intervals?: Array<{
    every: string | number
    offset?: string | number
  }>
  /** Calendar-based schedules */
  calendars?: Array<{
    /** Day of month (1-31) */
    dayOfMonth?: number | number[]
    /** Month (1-12) */
    month?: number | number[]
    /** Day of week (0-6, 0=Sunday) */
    dayOfWeek?: number | number[]
    /** Hour (0-23) */
    hour?: number | number[]
    /** Minute (0-59) */
    minute?: number | number[]
  }>
  /** Start time for schedule */
  startAt?: Date
  /** End time for schedule */
  endAt?: Date
  /** Jitter to add randomness */
  jitter?: string | number
}

/**
 * Schedule action defines what to execute
 */
interface ScheduleAction {
  type: 'startWorkflow'
  workflowType: string
  args?: unknown[]
  taskQueue: string
  workflowId?: string
  memo?: Record<string, unknown>
}

/**
 * Schedule state for querying
 */
interface ScheduleState {
  paused: boolean
  notes?: string
  limitedActions: boolean
  remainingActions: number
}

/**
 * Schedule policy for overlap handling
 */
interface SchedulePolicy {
  /** What to do when schedule would trigger while a run is active */
  overlap: 'SKIP' | 'BUFFER_ONE' | 'BUFFER_ALL' | 'CANCEL_OTHER' | 'TERMINATE_OTHER' | 'ALLOW_ALL'
  /** What to do on worker unavailability */
  catchupWindow?: string | number
  /** Whether to pause on failure */
  pauseOnFailure?: boolean
}

/**
 * Full schedule description
 */
interface ScheduleDescription {
  scheduleId: string
  spec: ScheduleSpec
  action: ScheduleAction
  state: ScheduleState
  policy: SchedulePolicy
  info: {
    numActions: number
    numActionsMissedCatchupWindow: number
    numActionsSkippedOverlap: number
    recentActions: Array<{ scheduledAt: Date; actualAt: Date; workflowId: string }>
    nextActionTimes: Date[]
  }
}

/**
 * Schedule handle for interacting with a schedule
 */
interface ScheduleHandle {
  scheduleId: string
  describe(): Promise<ScheduleDescription>
  update(spec: Partial<ScheduleSpec>): Promise<void>
  pause(note?: string): Promise<void>
  unpause(note?: string): Promise<void>
  trigger(): Promise<void>
  delete(): Promise<void>
  backfill(options: { startAt: Date; endAt: Date; overlap?: SchedulePolicy['overlap'] }): Promise<void>
}

/**
 * Schedule client for managing schedules
 */
class ScheduleClient {
  private schedules = new Map<string, {
    spec: ScheduleSpec
    action: ScheduleAction
    state: ScheduleState
    policy: SchedulePolicy
    history: Array<{ scheduledAt: Date; actualAt: Date; workflowId: string }>
    timeoutId?: ReturnType<typeof setTimeout>
  }>()

  private workflowClient: WorkflowClient

  constructor(workflowClient: WorkflowClient) {
    this.workflowClient = workflowClient
  }

  /**
   * Create a new schedule
   */
  async create(options: {
    scheduleId: string
    spec: ScheduleSpec
    action: ScheduleAction
    policy?: Partial<SchedulePolicy>
    state?: Partial<ScheduleState>
  }): Promise<ScheduleHandle> {
    const { scheduleId, spec, action, policy, state } = options

    if (this.schedules.has(scheduleId)) {
      throw new Error(`Schedule ${scheduleId} already exists`)
    }

    const fullPolicy: SchedulePolicy = {
      overlap: policy?.overlap ?? 'SKIP',
      catchupWindow: policy?.catchupWindow,
      pauseOnFailure: policy?.pauseOnFailure ?? false,
    }

    const fullState: ScheduleState = {
      paused: state?.paused ?? false,
      notes: state?.notes,
      limitedActions: state?.limitedActions ?? false,
      remainingActions: state?.remainingActions ?? Infinity,
    }

    this.schedules.set(scheduleId, {
      spec,
      action,
      state: fullState,
      policy: fullPolicy,
      history: [],
    })

    // Schedule the next execution
    this.scheduleNext(scheduleId)

    return this.getHandle(scheduleId)
  }

  /**
   * Get a handle to an existing schedule
   */
  getHandle(scheduleId: string): ScheduleHandle {
    const self = this

    return {
      scheduleId,
      async describe(): Promise<ScheduleDescription> {
        const schedule = self.schedules.get(scheduleId)
        if (!schedule) {
          throw new Error(`Schedule ${scheduleId} not found`)
        }

        return {
          scheduleId,
          spec: schedule.spec,
          action: schedule.action,
          state: schedule.state,
          policy: schedule.policy,
          info: {
            numActions: schedule.history.length,
            numActionsMissedCatchupWindow: 0,
            numActionsSkippedOverlap: 0,
            recentActions: schedule.history.slice(-10),
            nextActionTimes: self.getNextActionTimes(scheduleId, 5),
          },
        }
      },
      async update(spec: Partial<ScheduleSpec>): Promise<void> {
        const schedule = self.schedules.get(scheduleId)
        if (!schedule) {
          throw new Error(`Schedule ${scheduleId} not found`)
        }

        schedule.spec = { ...schedule.spec, ...spec }
        self.reschedule(scheduleId)
      },
      async pause(note?: string): Promise<void> {
        const schedule = self.schedules.get(scheduleId)
        if (!schedule) {
          throw new Error(`Schedule ${scheduleId} not found`)
        }

        schedule.state.paused = true
        if (note) schedule.state.notes = note

        // Clear any pending execution
        if (schedule.timeoutId) {
          clearTimeout(schedule.timeoutId)
          schedule.timeoutId = undefined
        }
      },
      async unpause(note?: string): Promise<void> {
        const schedule = self.schedules.get(scheduleId)
        if (!schedule) {
          throw new Error(`Schedule ${scheduleId} not found`)
        }

        schedule.state.paused = false
        if (note) schedule.state.notes = note

        // Resume scheduling
        self.scheduleNext(scheduleId)
      },
      async trigger(): Promise<void> {
        await self.executeAction(scheduleId)
      },
      async delete(): Promise<void> {
        const schedule = self.schedules.get(scheduleId)
        if (schedule?.timeoutId) {
          clearTimeout(schedule.timeoutId)
        }
        self.schedules.delete(scheduleId)
      },
      async backfill(options: { startAt: Date; endAt: Date; overlap?: SchedulePolicy['overlap'] }): Promise<void> {
        const schedule = self.schedules.get(scheduleId)
        if (!schedule) {
          throw new Error(`Schedule ${scheduleId} not found`)
        }

        // Calculate missed executions and run them
        const missedTimes = self.calculateMissedTimes(scheduleId, options.startAt, options.endAt)
        for (const time of missedTimes) {
          await self.executeAction(scheduleId, time)
        }
      },
    }
  }

  /**
   * List all schedules
   */
  async list(options?: { query?: string; pageSize?: number }): Promise<ScheduleDescription[]> {
    const results: ScheduleDescription[] = []

    for (const [scheduleId, schedule] of this.schedules) {
      results.push({
        scheduleId,
        spec: schedule.spec,
        action: schedule.action,
        state: schedule.state,
        policy: schedule.policy,
        info: {
          numActions: schedule.history.length,
          numActionsMissedCatchupWindow: 0,
          numActionsSkippedOverlap: 0,
          recentActions: schedule.history.slice(-10),
          nextActionTimes: this.getNextActionTimes(scheduleId, 5),
        },
      })
    }

    return results.slice(0, options?.pageSize ?? 100)
  }

  private scheduleNext(scheduleId: string): void {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule || schedule.state.paused) return

    const nextTime = this.getNextActionTime(scheduleId)
    if (!nextTime) return

    const delay = Math.max(0, nextTime.getTime() - Date.now())

    schedule.timeoutId = setTimeout(() => {
      this.executeAction(scheduleId)
      this.scheduleNext(scheduleId)
    }, delay)
  }

  private reschedule(scheduleId: string): void {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) return

    if (schedule.timeoutId) {
      clearTimeout(schedule.timeoutId)
    }

    this.scheduleNext(scheduleId)
  }

  private async executeAction(scheduleId: string, scheduledAt?: Date): Promise<void> {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) return

    const now = new Date()
    const workflowId = schedule.action.workflowId ?? `${scheduleId}-${now.getTime()}`

    // Record the action
    schedule.history.push({
      scheduledAt: scheduledAt ?? now,
      actualAt: now,
      workflowId,
    })

    // Would execute the workflow here via workflowClient
    // For testing, we just record the action
  }

  private getNextActionTime(scheduleId: string): Date | null {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) return null

    const now = new Date()
    const { spec } = schedule

    // Check start/end constraints
    if (spec.startAt && now < spec.startAt) return spec.startAt
    if (spec.endAt && now >= spec.endAt) return null

    // Calculate next time based on spec
    if (spec.intervals && spec.intervals.length > 0) {
      const interval = spec.intervals[0]
      const everyMs = typeof interval.every === 'number' ? interval.every : parseDuration(interval.every)
      return new Date(now.getTime() + everyMs)
    }

    if (spec.cronExpressions && spec.cronExpressions.length > 0) {
      // Simplified cron: just return a fixed interval for testing
      return new Date(now.getTime() + 60000) // 1 minute
    }

    return null
  }

  private getNextActionTimes(scheduleId: string, count: number): Date[] {
    const times: Date[] = []
    let current = new Date()

    for (let i = 0; i < count; i++) {
      const schedule = this.schedules.get(scheduleId)
      if (!schedule) break

      const { spec } = schedule

      if (spec.intervals && spec.intervals.length > 0) {
        const interval = spec.intervals[0]
        const everyMs = typeof interval.every === 'number' ? interval.every : parseDuration(interval.every)
        current = new Date(current.getTime() + everyMs)
        times.push(current)
      } else if (spec.cronExpressions && spec.cronExpressions.length > 0) {
        current = new Date(current.getTime() + 60000)
        times.push(current)
      }
    }

    return times
  }

  private calculateMissedTimes(scheduleId: string, startAt: Date, endAt: Date): Date[] {
    const times: Date[] = []
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) return times

    let current = startAt

    while (current < endAt) {
      const { spec } = schedule

      if (spec.intervals && spec.intervals.length > 0) {
        const interval = spec.intervals[0]
        const everyMs = typeof interval.every === 'number' ? interval.every : parseDuration(interval.every)
        current = new Date(current.getTime() + everyMs)
        if (current < endAt) {
          times.push(current)
        }
      } else {
        break
      }
    }

    return times
  }
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) return 0

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'ms': return value
    case 's': return value * 1000
    case 'm': return value * 60 * 1000
    case 'h': return value * 60 * 60 * 1000
    case 'd': return value * 24 * 60 * 60 * 1000
    default: return 0
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Temporal Schedules Compat Layer', () => {
  let client: WorkflowClient
  let scheduleClient: ScheduleClient

  beforeEach(() => {
    vi.useFakeTimers()
    client = new WorkflowClient()
    scheduleClient = new ScheduleClient(client)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Schedule Creation', () => {
    it('should create a schedule with cron expression', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'cron-schedule-1',
        spec: {
          cronExpressions: ['0 9 * * MON-FRI'],
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'dailyReport',
          taskQueue: 'reports',
        },
      })

      expect(handle.scheduleId).toBe('cron-schedule-1')

      const desc = await handle.describe()
      expect(desc.spec.cronExpressions).toContain('0 9 * * MON-FRI')
      expect(desc.action.workflowType).toBe('dailyReport')
    })

    it('should create a schedule with interval', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'interval-schedule-1',
        spec: {
          intervals: [{ every: '1h' }],
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'healthCheck',
          taskQueue: 'monitoring',
        },
      })

      const desc = await handle.describe()
      expect(desc.spec.intervals?.[0].every).toBe('1h')
    })

    it('should create a schedule with interval and offset', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'offset-schedule-1',
        spec: {
          intervals: [{ every: '1h', offset: '15m' }],
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'syncData',
          taskQueue: 'sync',
        },
      })

      const desc = await handle.describe()
      expect(desc.spec.intervals?.[0].offset).toBe('15m')
    })

    it('should create a schedule with start and end times', async () => {
      const startAt = new Date('2024-01-01T00:00:00Z')
      const endAt = new Date('2024-12-31T23:59:59Z')

      const handle = await scheduleClient.create({
        scheduleId: 'bounded-schedule-1',
        spec: {
          intervals: [{ every: '1d' }],
          startAt,
          endAt,
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'yearlyTask',
          taskQueue: 'tasks',
        },
      })

      const desc = await handle.describe()
      expect(desc.spec.startAt).toEqual(startAt)
      expect(desc.spec.endAt).toEqual(endAt)
    })

    it('should create a schedule with jitter', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'jitter-schedule-1',
        spec: {
          intervals: [{ every: '1h' }],
          jitter: '5m',
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'randomizedTask',
          taskQueue: 'tasks',
        },
      })

      const desc = await handle.describe()
      expect(desc.spec.jitter).toBe('5m')
    })

    it('should reject duplicate schedule IDs', async () => {
      await scheduleClient.create({
        scheduleId: 'unique-schedule',
        spec: { intervals: [{ every: '1h' }] },
        action: { type: 'startWorkflow', workflowType: 'test', taskQueue: 'test' },
      })

      await expect(
        scheduleClient.create({
          scheduleId: 'unique-schedule',
          spec: { intervals: [{ every: '30m' }] },
          action: { type: 'startWorkflow', workflowType: 'test2', taskQueue: 'test' },
        })
      ).rejects.toThrow('already exists')
    })
  })

  describe('Schedule Actions', () => {
    it('should specify workflow action with arguments', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'args-schedule-1',
        spec: { intervals: [{ every: '1h' }] },
        action: {
          type: 'startWorkflow',
          workflowType: 'processData',
          args: [{ batchSize: 100, region: 'us-west' }],
          taskQueue: 'processing',
        },
      })

      const desc = await handle.describe()
      expect(desc.action.args).toEqual([{ batchSize: 100, region: 'us-west' }])
    })

    it('should specify workflow action with memo', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'memo-schedule-1',
        spec: { intervals: [{ every: '1h' }] },
        action: {
          type: 'startWorkflow',
          workflowType: 'auditTask',
          taskQueue: 'audit',
          memo: { source: 'scheduled', priority: 'low' },
        },
      })

      const desc = await handle.describe()
      expect(desc.action.memo).toEqual({ source: 'scheduled', priority: 'low' })
    })

    it('should specify custom workflow ID pattern', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'custom-id-schedule',
        spec: { intervals: [{ every: '1h' }] },
        action: {
          type: 'startWorkflow',
          workflowType: 'namedTask',
          taskQueue: 'tasks',
          workflowId: 'hourly-task-run',
        },
      })

      const desc = await handle.describe()
      expect(desc.action.workflowId).toBe('hourly-task-run')
    })
  })

  describe('Schedule Policies', () => {
    it('should configure SKIP overlap policy', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'skip-overlap-schedule',
        spec: { intervals: [{ every: '10m' }] },
        action: { type: 'startWorkflow', workflowType: 'longTask', taskQueue: 'tasks' },
        policy: { overlap: 'SKIP' },
      })

      const desc = await handle.describe()
      expect(desc.policy.overlap).toBe('SKIP')
    })

    it('should configure BUFFER_ONE overlap policy', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'buffer-one-schedule',
        spec: { intervals: [{ every: '5m' }] },
        action: { type: 'startWorkflow', workflowType: 'queuedTask', taskQueue: 'tasks' },
        policy: { overlap: 'BUFFER_ONE' },
      })

      const desc = await handle.describe()
      expect(desc.policy.overlap).toBe('BUFFER_ONE')
    })

    it('should configure ALLOW_ALL overlap policy', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'allow-all-schedule',
        spec: { intervals: [{ every: '1m' }] },
        action: { type: 'startWorkflow', workflowType: 'parallelTask', taskQueue: 'tasks' },
        policy: { overlap: 'ALLOW_ALL' },
      })

      const desc = await handle.describe()
      expect(desc.policy.overlap).toBe('ALLOW_ALL')
    })

    it('should configure catchup window', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'catchup-schedule',
        spec: { intervals: [{ every: '1h' }] },
        action: { type: 'startWorkflow', workflowType: 'catchupTask', taskQueue: 'tasks' },
        policy: { overlap: 'SKIP', catchupWindow: '1d' },
      })

      const desc = await handle.describe()
      expect(desc.policy.catchupWindow).toBe('1d')
    })

    it('should configure pause on failure', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'pause-on-fail-schedule',
        spec: { intervals: [{ every: '30m' }] },
        action: { type: 'startWorkflow', workflowType: 'riskyTask', taskQueue: 'tasks' },
        policy: { overlap: 'SKIP', pauseOnFailure: true },
      })

      const desc = await handle.describe()
      expect(desc.policy.pauseOnFailure).toBe(true)
    })
  })

  describe('Schedule State Management', () => {
    it('should pause a schedule', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'pausable-schedule',
        spec: { intervals: [{ every: '1h' }] },
        action: { type: 'startWorkflow', workflowType: 'pausableTask', taskQueue: 'tasks' },
      })

      await handle.pause('Maintenance window')

      const desc = await handle.describe()
      expect(desc.state.paused).toBe(true)
      expect(desc.state.notes).toBe('Maintenance window')
    })

    it('should unpause a schedule', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'unpausable-schedule',
        spec: { intervals: [{ every: '1h' }] },
        action: { type: 'startWorkflow', workflowType: 'unpausableTask', taskQueue: 'tasks' },
        state: { paused: true },
      })

      await handle.unpause('Maintenance complete')

      const desc = await handle.describe()
      expect(desc.state.paused).toBe(false)
      expect(desc.state.notes).toBe('Maintenance complete')
    })

    it('should manually trigger a schedule', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'triggerable-schedule',
        spec: { intervals: [{ every: '1d' }] },
        action: { type: 'startWorkflow', workflowType: 'triggerableTask', taskQueue: 'tasks' },
      })

      // Manually trigger
      await handle.trigger()

      const desc = await handle.describe()
      expect(desc.info.numActions).toBe(1)
    })

    it('should delete a schedule', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'deletable-schedule',
        spec: { intervals: [{ every: '1h' }] },
        action: { type: 'startWorkflow', workflowType: 'deletableTask', taskQueue: 'tasks' },
      })

      await handle.delete()

      await expect(handle.describe()).rejects.toThrow('not found')
    })
  })

  describe('Schedule Updates', () => {
    it('should update schedule interval', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'updatable-schedule',
        spec: { intervals: [{ every: '1h' }] },
        action: { type: 'startWorkflow', workflowType: 'updatableTask', taskQueue: 'tasks' },
      })

      await handle.update({ intervals: [{ every: '30m' }] })

      const desc = await handle.describe()
      expect(desc.spec.intervals?.[0].every).toBe('30m')
    })

    it('should update schedule start/end times', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'time-update-schedule',
        spec: { intervals: [{ every: '1h' }] },
        action: { type: 'startWorkflow', workflowType: 'timeUpdateTask', taskQueue: 'tasks' },
      })

      const newEndAt = new Date('2025-01-01T00:00:00Z')
      await handle.update({ endAt: newEndAt })

      const desc = await handle.describe()
      expect(desc.spec.endAt).toEqual(newEndAt)
    })
  })

  describe('Schedule Backfill', () => {
    it('should backfill missed executions', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'backfill-schedule',
        spec: { intervals: [{ every: '1h' }] },
        action: { type: 'startWorkflow', workflowType: 'backfillTask', taskQueue: 'tasks' },
      })

      const startAt = new Date(Date.now() - 5 * 60 * 60 * 1000) // 5 hours ago
      const endAt = new Date()

      await handle.backfill({ startAt, endAt })

      const desc = await handle.describe()
      // Should have executed for missed hours
      expect(desc.info.numActions).toBeGreaterThan(0)
    })
  })

  describe('Schedule Listing', () => {
    it('should list all schedules', async () => {
      await scheduleClient.create({
        scheduleId: 'list-schedule-1',
        spec: { intervals: [{ every: '1h' }] },
        action: { type: 'startWorkflow', workflowType: 'task1', taskQueue: 'tasks' },
      })

      await scheduleClient.create({
        scheduleId: 'list-schedule-2',
        spec: { intervals: [{ every: '30m' }] },
        action: { type: 'startWorkflow', workflowType: 'task2', taskQueue: 'tasks' },
      })

      const schedules = await scheduleClient.list()
      expect(schedules.length).toBe(2)
      expect(schedules.map((s) => s.scheduleId)).toContain('list-schedule-1')
      expect(schedules.map((s) => s.scheduleId)).toContain('list-schedule-2')
    })

    it('should respect page size', async () => {
      for (let i = 0; i < 5; i++) {
        await scheduleClient.create({
          scheduleId: `page-schedule-${i}`,
          spec: { intervals: [{ every: '1h' }] },
          action: { type: 'startWorkflow', workflowType: 'pageTask', taskQueue: 'tasks' },
        })
      }

      const schedules = await scheduleClient.list({ pageSize: 3 })
      expect(schedules.length).toBe(3)
    })
  })

  describe('Schedule Info', () => {
    it('should track action history', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'history-schedule',
        spec: { intervals: [{ every: '1h' }] },
        action: { type: 'startWorkflow', workflowType: 'historyTask', taskQueue: 'tasks' },
      })

      // Trigger multiple times
      await handle.trigger()
      await handle.trigger()
      await handle.trigger()

      const desc = await handle.describe()
      expect(desc.info.numActions).toBe(3)
      expect(desc.info.recentActions.length).toBe(3)
    })

    it('should provide next action times', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'next-times-schedule',
        spec: { intervals: [{ every: '1h' }] },
        action: { type: 'startWorkflow', workflowType: 'nextTimesTask', taskQueue: 'tasks' },
      })

      const desc = await handle.describe()
      expect(desc.info.nextActionTimes.length).toBeGreaterThan(0)
      expect(desc.info.nextActionTimes[0]).toBeInstanceOf(Date)
    })
  })

  describe('Calendar-Based Schedules', () => {
    it('should create a calendar-based schedule', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'calendar-schedule',
        spec: {
          calendars: [
            {
              dayOfWeek: [1, 3, 5], // Mon, Wed, Fri
              hour: 9,
              minute: 0,
            },
          ],
        },
        action: { type: 'startWorkflow', workflowType: 'calendarTask', taskQueue: 'tasks' },
      })

      const desc = await handle.describe()
      expect(desc.spec.calendars?.[0].dayOfWeek).toEqual([1, 3, 5])
    })

    it('should create a monthly schedule', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'monthly-schedule',
        spec: {
          calendars: [
            {
              dayOfMonth: 1,
              hour: 0,
              minute: 0,
            },
          ],
        },
        action: { type: 'startWorkflow', workflowType: 'monthlyTask', taskQueue: 'tasks' },
      })

      const desc = await handle.describe()
      expect(desc.spec.calendars?.[0].dayOfMonth).toBe(1)
    })
  })

  describe('Multiple Schedule Specs', () => {
    it('should create a schedule with multiple cron expressions', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'multi-cron-schedule',
        spec: {
          cronExpressions: [
            '0 9 * * MON-FRI', // 9am weekdays
            '0 12 * * SAT', // Noon Saturday
          ],
        },
        action: { type: 'startWorkflow', workflowType: 'multiCronTask', taskQueue: 'tasks' },
      })

      const desc = await handle.describe()
      expect(desc.spec.cronExpressions?.length).toBe(2)
    })

    it('should create a schedule with multiple intervals', async () => {
      const handle = await scheduleClient.create({
        scheduleId: 'multi-interval-schedule',
        spec: {
          intervals: [
            { every: '1h' },
            { every: '30m', offset: '5m' },
          ],
        },
        action: { type: 'startWorkflow', workflowType: 'multiIntervalTask', taskQueue: 'tasks' },
      })

      const desc = await handle.describe()
      expect(desc.spec.intervals?.length).toBe(2)
    })
  })
})
