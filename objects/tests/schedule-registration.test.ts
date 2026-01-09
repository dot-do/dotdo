/**
 * Schedule Registration Tests
 *
 * Tests for workflow.schedule() - allows workflows to register cron-triggered
 * schedules that use the DO alarm API for execution.
 *
 * This integrates with:
 * - DO storage for schedule persistence
 * - Alarm API for next run time scheduling
 * - Cron expression parsing for schedule calculation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will define the interface we need to implement
import {
  ScheduleManager,
  type Schedule,
  type ScheduleOptions,
  type CronExpression,
  parseCronExpression,
  getNextRunTime,
  ScheduleValidationError,
  ScheduleNotFoundError,
  InvalidCronExpressionError,
} from '../ScheduleManager'

// ============================================================================
// MOCK DO STATE
// ============================================================================

function createMockStorage() {
  const storage = new Map<string, unknown>()
  const alarms: { time: number | null } = { time: null }

  return {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      }),
      getAlarm: vi.fn(async () => alarms.time),
      setAlarm: vi.fn(async (time: number | Date) => {
        alarms.time = typeof time === 'number' ? time : time.getTime()
      }),
      deleteAlarm: vi.fn(async () => {
        alarms.time = null
      }),
    },
    alarms,
    _storage: storage,
  }
}

function createMockState() {
  const { storage, alarms, _storage } = createMockStorage()
  return {
    id: { toString: () => 'test-workflow-do-id' },
    storage,
    alarms,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { alarms: { time: number | null }; _storage: Map<string, unknown> }
}

// ============================================================================
// TESTS
// ============================================================================

describe('ScheduleManager', () => {
  let mockState: ReturnType<typeof createMockState>
  let manager: ScheduleManager

  beforeEach(() => {
    mockState = createMockState()
    manager = new ScheduleManager(mockState)
    vi.useFakeTimers()
    // Set a fixed "now" for predictable tests
    vi.setSystemTime(new Date('2026-01-08T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // 1. SCHEDULE REGISTRATION
  // ==========================================================================

  describe('Schedule Registration', () => {
    it('registers a cron schedule with a name', async () => {
      const schedule = await manager.schedule('0 9 * * *', 'daily-report')

      expect(schedule).toBeDefined()
      expect(schedule.id).toBeDefined()
      expect(schedule.name).toBe('daily-report')
      expect(schedule.cronExpression).toBe('0 9 * * *')
      expect(schedule.status).toBe('active')
    })

    it('calculates and stores the next run time', async () => {
      const schedule = await manager.schedule('0 9 * * *', 'daily-report')

      // 9:00 AM UTC is the next occurrence after 12:00 noon on Jan 8
      // So next run should be Jan 9 at 9:00 AM UTC
      const expectedNextRun = new Date('2026-01-09T09:00:00.000Z')
      expect(schedule.nextRunAt).toEqual(expectedNextRun)
    })

    it('sets a DO alarm for the next run time', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')

      expect(mockState.storage.setAlarm).toHaveBeenCalled()
      const alarmTime = mockState.alarms.time
      expect(alarmTime).toBeDefined()
      // Should be set to Jan 9 at 9:00 AM UTC
      expect(new Date(alarmTime!)).toEqual(new Date('2026-01-09T09:00:00.000Z'))
    })

    it('persists schedule to DO storage', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')

      expect(mockState.storage.put).toHaveBeenCalled()
      const storedSchedule = await mockState.storage.get('schedule:daily-report')
      expect(storedSchedule).toBeDefined()
    })

    it('throws on duplicate schedule name', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')

      await expect(manager.schedule('0 10 * * *', 'daily-report')).rejects.toThrow(ScheduleValidationError)
    })

    it('supports schedule with timezone', async () => {
      const schedule = await manager.schedule('0 9 * * *', 'daily-report', {
        timezone: 'America/New_York',
      })

      expect(schedule.timezone).toBe('America/New_York')
      // 9:00 AM EST is 14:00 UTC (during standard time in January)
      // Next occurrence after 12:00 UTC on Jan 8 would be Jan 8 at 14:00 UTC
      const expectedNextRun = new Date('2026-01-08T14:00:00.000Z')
      expect(schedule.nextRunAt).toEqual(expectedNextRun)
    })

    it('supports schedule with metadata', async () => {
      const schedule = await manager.schedule('0 9 * * *', 'daily-report', {
        metadata: { workflowId: 'wf-123', step: 'send-report' },
      })

      expect(schedule.metadata).toEqual({ workflowId: 'wf-123', step: 'send-report' })
    })

    it('supports schedule with enabled=false (paused)', async () => {
      const schedule = await manager.schedule('0 9 * * *', 'daily-report', {
        enabled: false,
      })

      expect(schedule.status).toBe('paused')
      expect(schedule.nextRunAt).toBeNull()
      // Should not set an alarm when paused
      expect(mockState.storage.setAlarm).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 2. CRON EXPRESSION PARSING
  // ==========================================================================

  describe('Cron Expression Parsing', () => {
    describe('Standard 5-field format', () => {
      it('parses minute field', () => {
        const cron = parseCronExpression('30 * * * *')

        expect(cron.minute).toEqual([30])
        expect(cron.hour).toEqual('*')
        expect(cron.dayOfMonth).toEqual('*')
        expect(cron.month).toEqual('*')
        expect(cron.dayOfWeek).toEqual('*')
      })

      it('parses hour field', () => {
        const cron = parseCronExpression('0 9 * * *')

        expect(cron.minute).toEqual([0])
        expect(cron.hour).toEqual([9])
      })

      it('parses day of month field', () => {
        const cron = parseCronExpression('0 0 15 * *')

        expect(cron.dayOfMonth).toEqual([15])
      })

      it('parses month field', () => {
        const cron = parseCronExpression('0 0 1 6 *')

        expect(cron.month).toEqual([6])
      })

      it('parses day of week field', () => {
        const cron = parseCronExpression('0 0 * * 1')

        expect(cron.dayOfWeek).toEqual([1]) // Monday
      })

      it('parses wildcard (*)', () => {
        const cron = parseCronExpression('* * * * *')

        expect(cron.minute).toEqual('*')
        expect(cron.hour).toEqual('*')
        expect(cron.dayOfMonth).toEqual('*')
        expect(cron.month).toEqual('*')
        expect(cron.dayOfWeek).toEqual('*')
      })

      it('parses ranges (e.g., 1-5)', () => {
        const cron = parseCronExpression('0 9-17 * * *')

        expect(cron.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
      })

      it('parses lists (e.g., 1,3,5)', () => {
        const cron = parseCronExpression('0 0 * * 1,3,5')

        expect(cron.dayOfWeek).toEqual([1, 3, 5])
      })

      it('parses step values (e.g., */15)', () => {
        const cron = parseCronExpression('*/15 * * * *')

        expect(cron.minute).toEqual([0, 15, 30, 45])
      })

      it('parses range with step (e.g., 0-30/10)', () => {
        const cron = parseCronExpression('0-30/10 * * * *')

        expect(cron.minute).toEqual([0, 10, 20, 30])
      })

      it('parses complex combinations', () => {
        // Every 15 minutes during business hours (9-17) on weekdays
        const cron = parseCronExpression('*/15 9-17 * * 1-5')

        expect(cron.minute).toEqual([0, 15, 30, 45])
        expect(cron.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
        expect(cron.dayOfWeek).toEqual([1, 2, 3, 4, 5])
      })
    })

    describe('Validation', () => {
      it('throws on empty expression', () => {
        expect(() => parseCronExpression('')).toThrow(InvalidCronExpressionError)
      })

      it('throws on too few fields', () => {
        expect(() => parseCronExpression('0 9 *')).toThrow(InvalidCronExpressionError)
      })

      it('throws on too many fields', () => {
        expect(() => parseCronExpression('0 9 * * * * *')).toThrow(InvalidCronExpressionError)
      })

      it('throws on invalid minute value', () => {
        expect(() => parseCronExpression('60 * * * *')).toThrow(InvalidCronExpressionError)
      })

      it('throws on invalid hour value', () => {
        expect(() => parseCronExpression('0 25 * * *')).toThrow(InvalidCronExpressionError)
      })

      it('throws on invalid day of month value', () => {
        expect(() => parseCronExpression('0 0 32 * *')).toThrow(InvalidCronExpressionError)
      })

      it('throws on invalid month value', () => {
        expect(() => parseCronExpression('0 0 1 13 *')).toThrow(InvalidCronExpressionError)
      })

      it('throws on invalid day of week value', () => {
        expect(() => parseCronExpression('0 0 * * 8')).toThrow(InvalidCronExpressionError)
      })

      it('throws on invalid characters', () => {
        expect(() => parseCronExpression('0 9 * * abc')).toThrow(InvalidCronExpressionError)
      })

      it('throws on invalid range (start > end)', () => {
        expect(() => parseCronExpression('0 17-9 * * *')).toThrow(InvalidCronExpressionError)
      })
    })

    describe('Month and day name aliases', () => {
      it('supports month names (JAN-DEC)', () => {
        const cron = parseCronExpression('0 0 1 JAN *')
        expect(cron.month).toEqual([1])

        const cron2 = parseCronExpression('0 0 1 DEC *')
        expect(cron2.month).toEqual([12])
      })

      it('supports day names (SUN-SAT)', () => {
        const cron = parseCronExpression('0 0 * * MON')
        expect(cron.dayOfWeek).toEqual([1])

        const cron2 = parseCronExpression('0 0 * * FRI')
        expect(cron2.dayOfWeek).toEqual([5])
      })

      it('supports day name ranges', () => {
        const cron = parseCronExpression('0 0 * * MON-FRI')
        expect(cron.dayOfWeek).toEqual([1, 2, 3, 4, 5])
      })
    })
  })

  // ==========================================================================
  // 3. NEXT RUN TIME CALCULATION
  // ==========================================================================

  describe('Next Run Time Calculation', () => {
    it('calculates next run for simple daily schedule', () => {
      // Current time: 2026-01-08T12:00:00.000Z
      const cron = parseCronExpression('0 9 * * *') // 9:00 AM daily
      const nextRun = getNextRunTime(cron)

      // 9:00 AM has already passed today, so next is tomorrow
      expect(nextRun).toEqual(new Date('2026-01-09T09:00:00.000Z'))
    })

    it('calculates next run when schedule is later today', () => {
      const cron = parseCronExpression('0 15 * * *') // 3:00 PM daily
      const nextRun = getNextRunTime(cron)

      // 3:00 PM is later today (after 12:00 noon)
      expect(nextRun).toEqual(new Date('2026-01-08T15:00:00.000Z'))
    })

    it('calculates next run for hourly schedule', () => {
      const cron = parseCronExpression('0 * * * *') // Every hour on the hour
      const nextRun = getNextRunTime(cron)

      // Next hour after 12:00 is 13:00
      expect(nextRun).toEqual(new Date('2026-01-08T13:00:00.000Z'))
    })

    it('calculates next run for every 15 minutes', () => {
      vi.setSystemTime(new Date('2026-01-08T12:07:00.000Z'))
      const cron = parseCronExpression('*/15 * * * *') // Every 15 minutes
      const nextRun = getNextRunTime(cron)

      // At 12:07, next 15-minute mark is 12:15
      expect(nextRun).toEqual(new Date('2026-01-08T12:15:00.000Z'))
    })

    it('calculates next run for specific day of week', () => {
      // 2026-01-08 is a Thursday (day 4)
      const cron = parseCronExpression('0 9 * * 1') // Monday at 9 AM
      const nextRun = getNextRunTime(cron)

      // Next Monday is Jan 12
      expect(nextRun).toEqual(new Date('2026-01-12T09:00:00.000Z'))
    })

    it('calculates next run for specific day of month', () => {
      const cron = parseCronExpression('0 0 15 * *') // 15th of each month at midnight
      const nextRun = getNextRunTime(cron)

      expect(nextRun).toEqual(new Date('2026-01-15T00:00:00.000Z'))
    })

    it('calculates next run for specific month', () => {
      const cron = parseCronExpression('0 0 1 6 *') // June 1st at midnight
      const nextRun = getNextRunTime(cron)

      expect(nextRun).toEqual(new Date('2026-06-01T00:00:00.000Z'))
    })

    it('handles timezone correctly', () => {
      const cron = parseCronExpression('0 9 * * *') // 9:00 AM
      const nextRun = getNextRunTime(cron, { timezone: 'America/New_York' })

      // 9:00 AM EST is 14:00 UTC (standard time in January)
      // Current time is 12:00 UTC, so 9 AM EST (14:00 UTC) is later today
      expect(nextRun).toEqual(new Date('2026-01-08T14:00:00.000Z'))
    })

    it('calculates from a specific reference time', () => {
      const cron = parseCronExpression('0 9 * * *')
      const referenceTime = new Date('2026-03-15T08:00:00.000Z')
      const nextRun = getNextRunTime(cron, { from: referenceTime })

      // 9:00 AM is later on March 15
      expect(nextRun).toEqual(new Date('2026-03-15T09:00:00.000Z'))
    })

    it('handles end of month correctly', () => {
      vi.setSystemTime(new Date('2026-01-31T12:00:00.000Z'))
      const cron = parseCronExpression('0 9 * * *')
      const nextRun = getNextRunTime(cron)

      // Next 9 AM after Jan 31 noon is Feb 1
      expect(nextRun).toEqual(new Date('2026-02-01T09:00:00.000Z'))
    })

    it('handles leap year correctly', () => {
      vi.setSystemTime(new Date('2028-02-28T12:00:00.000Z')) // 2028 is a leap year
      const cron = parseCronExpression('0 9 * * *')
      const nextRun = getNextRunTime(cron)

      // Next 9 AM is Feb 29 (leap day)
      expect(nextRun).toEqual(new Date('2028-02-29T09:00:00.000Z'))
    })

    it('handles year rollover', () => {
      vi.setSystemTime(new Date('2026-12-31T23:00:00.000Z'))
      const cron = parseCronExpression('0 9 * * *')
      const nextRun = getNextRunTime(cron)

      // Next 9 AM is Jan 1, 2027
      expect(nextRun).toEqual(new Date('2027-01-01T09:00:00.000Z'))
    })
  })

  // ==========================================================================
  // 4. SCHEDULE LISTING
  // ==========================================================================

  describe('Schedule Listing', () => {
    it('lists all registered schedules', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')
      await manager.schedule('0 0 * * 1', 'weekly-summary')
      await manager.schedule('*/15 * * * *', 'health-check')

      const schedules = await manager.listSchedules()

      expect(schedules).toHaveLength(3)
      expect(schedules.map((s) => s.name).sort()).toEqual(['daily-report', 'health-check', 'weekly-summary'])
    })

    it('returns empty array when no schedules exist', async () => {
      const schedules = await manager.listSchedules()

      expect(schedules).toEqual([])
    })

    it('filters schedules by status', async () => {
      await manager.schedule('0 9 * * *', 'active-schedule')
      await manager.schedule('0 10 * * *', 'paused-schedule', { enabled: false })

      const activeSchedules = await manager.listSchedules({ status: 'active' })
      const pausedSchedules = await manager.listSchedules({ status: 'paused' })

      expect(activeSchedules).toHaveLength(1)
      expect(activeSchedules[0].name).toBe('active-schedule')

      expect(pausedSchedules).toHaveLength(1)
      expect(pausedSchedules[0].name).toBe('paused-schedule')
    })

    it('returns schedule details including next run time', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')

      const schedules = await manager.listSchedules()

      expect(schedules[0]).toMatchObject({
        name: 'daily-report',
        cronExpression: '0 9 * * *',
        status: 'active',
        nextRunAt: new Date('2026-01-09T09:00:00.000Z'),
      })
    })
  })

  // ==========================================================================
  // 5. SCHEDULE DELETION
  // ==========================================================================

  describe('Schedule Deletion', () => {
    it('deletes a schedule by name', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')
      await manager.deleteSchedule('daily-report')

      const schedules = await manager.listSchedules()
      expect(schedules).toHaveLength(0)
    })

    it('removes schedule from storage', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')
      await manager.deleteSchedule('daily-report')

      const storedSchedule = await mockState.storage.get('schedule:daily-report')
      expect(storedSchedule).toBeUndefined()
    })

    it('throws when deleting non-existent schedule', async () => {
      await expect(manager.deleteSchedule('non-existent')).rejects.toThrow(ScheduleNotFoundError)
    })

    it('reschedules alarm when deleting the next-to-run schedule', async () => {
      await manager.schedule('0 13 * * *', 'afternoon-report') // 1 PM today
      await manager.schedule('0 15 * * *', 'evening-report') // 3 PM today

      // afternoon-report should be the next alarm
      expect(new Date(mockState.alarms.time!)).toEqual(new Date('2026-01-08T13:00:00.000Z'))

      // Delete the afternoon report
      await manager.deleteSchedule('afternoon-report')

      // Alarm should be rescheduled to evening report
      expect(new Date(mockState.alarms.time!)).toEqual(new Date('2026-01-08T15:00:00.000Z'))
    })

    it('clears alarm when deleting the last schedule', async () => {
      await manager.schedule('0 9 * * *', 'only-schedule')
      await manager.deleteSchedule('only-schedule')

      expect(mockState.alarms.time).toBeNull()
    })
  })

  // ==========================================================================
  // 6. SCHEDULE UPDATES
  // ==========================================================================

  describe('Schedule Updates', () => {
    it('updates a schedule cron expression', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')
      const updated = await manager.updateSchedule('daily-report', {
        cronExpression: '0 10 * * *',
      })

      expect(updated.cronExpression).toBe('0 10 * * *')
      expect(updated.nextRunAt).toEqual(new Date('2026-01-09T10:00:00.000Z')) // 10 AM already passed today (12:00 noon), so next is tomorrow
    })

    it('pauses a schedule', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')
      const updated = await manager.updateSchedule('daily-report', {
        enabled: false,
      })

      expect(updated.status).toBe('paused')
      expect(updated.nextRunAt).toBeNull()
    })

    it('resumes a paused schedule', async () => {
      await manager.schedule('0 9 * * *', 'daily-report', { enabled: false })
      const updated = await manager.updateSchedule('daily-report', {
        enabled: true,
      })

      expect(updated.status).toBe('active')
      expect(updated.nextRunAt).toEqual(new Date('2026-01-09T09:00:00.000Z'))
    })

    it('updates schedule metadata', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')
      const updated = await manager.updateSchedule('daily-report', {
        metadata: { workflowId: 'wf-456' },
      })

      expect(updated.metadata).toEqual({ workflowId: 'wf-456' })
    })

    it('throws when updating non-existent schedule', async () => {
      await expect(manager.updateSchedule('non-existent', { enabled: false })).rejects.toThrow(ScheduleNotFoundError)
    })
  })

  // ==========================================================================
  // 7. ALARM HANDLING
  // ==========================================================================

  describe('Alarm Handling', () => {
    it('executes scheduled workflow on alarm', async () => {
      const handler = vi.fn()
      manager.onScheduleTrigger(handler)

      await manager.schedule('0 9 * * *', 'daily-report')

      // Advance to the scheduled time
      vi.setSystemTime(new Date('2026-01-09T09:00:00.000Z'))
      await manager.handleAlarm()

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'daily-report',
          cronExpression: '0 9 * * *',
        }),
      )
    })

    it('reschedules alarm for next occurrence after trigger', async () => {
      manager.onScheduleTrigger(vi.fn())
      await manager.schedule('0 9 * * *', 'daily-report')

      // Advance to the scheduled time
      vi.setSystemTime(new Date('2026-01-09T09:00:00.000Z'))
      await manager.handleAlarm()

      // Should reschedule for the next day
      expect(new Date(mockState.alarms.time!)).toEqual(new Date('2026-01-10T09:00:00.000Z'))
    })

    it('handles multiple schedules with same trigger time', async () => {
      const handler = vi.fn()
      manager.onScheduleTrigger(handler)

      await manager.schedule('0 9 * * *', 'report-a')
      await manager.schedule('0 9 * * *', 'report-b')

      vi.setSystemTime(new Date('2026-01-09T09:00:00.000Z'))
      await manager.handleAlarm()

      // Both schedules should be triggered
      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('updates lastRunAt after successful trigger', async () => {
      manager.onScheduleTrigger(vi.fn())
      await manager.schedule('0 9 * * *', 'daily-report')

      vi.setSystemTime(new Date('2026-01-09T09:00:00.000Z'))
      await manager.handleAlarm()

      const schedules = await manager.listSchedules()
      expect(schedules[0].lastRunAt).toEqual(new Date('2026-01-09T09:00:00.000Z'))
    })

    it('increments run count after trigger', async () => {
      manager.onScheduleTrigger(vi.fn())
      await manager.schedule('0 9 * * *', 'daily-report')

      vi.setSystemTime(new Date('2026-01-09T09:00:00.000Z'))
      await manager.handleAlarm()

      const schedules = await manager.listSchedules()
      expect(schedules[0].runCount).toBe(1)
    })
  })

  // ==========================================================================
  // 8. GETTING A SPECIFIC SCHEDULE
  // ==========================================================================

  describe('Getting a Schedule', () => {
    it('gets a schedule by name', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')

      const schedule = await manager.getSchedule('daily-report')

      expect(schedule).toBeDefined()
      expect(schedule!.name).toBe('daily-report')
      expect(schedule!.cronExpression).toBe('0 9 * * *')
    })

    it('returns null for non-existent schedule', async () => {
      const schedule = await manager.getSchedule('non-existent')

      expect(schedule).toBeNull()
    })
  })

  // ==========================================================================
  // 9. SCHEDULE INTERFACE FOR WORKFLOW
  // ==========================================================================

  describe('Workflow Integration', () => {
    it('supports workflow.schedule() API', async () => {
      // This simulates the API: await workflow.schedule('0 9 * * *', 'daily-report')
      const schedule = await manager.schedule('0 9 * * *', 'daily-report')

      expect(schedule.name).toBe('daily-report')
    })

    it('supports workflow.listSchedules() API', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')

      const schedules = await manager.listSchedules()

      expect(schedules).toHaveLength(1)
    })

    it('supports workflow.deleteSchedule() API', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')
      await manager.deleteSchedule('daily-report')

      const schedules = await manager.listSchedules()
      expect(schedules).toHaveLength(0)
    })
  })
})

// ============================================================================
// STANDALONE CRON PARSING TESTS
// ============================================================================

describe('parseCronExpression (standalone)', () => {
  it('exports parseCronExpression function', () => {
    expect(typeof parseCronExpression).toBe('function')
  })

  it('exports getNextRunTime function', () => {
    expect(typeof getNextRunTime).toBe('function')
  })
})
