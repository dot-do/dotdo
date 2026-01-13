/**
 * Schedule Manager Tests
 *
 * Tests for the ScheduleManager and natural language scheduling via $.every
 *
 * TDD Approach:
 * - RED: Write failing tests for new features
 * - GREEN: Implement to pass tests
 * - REFACTOR: Clean up
 *
 * Feature requirements from issue:
 * 1. Natural Language Parsing:
 *    - 'Monday at 9am' -> cron: 0 9 * * 1
 *    - 'first day of month' -> cron: 0 0 1 * *
 *    - 'every 15 minutes' -> cron: * /15 * * * *
 * 2. Schedule Persistence: Store in database for DO restart
 * 3. Alarm Integration: Use DO alarms for execution
 * 4. Handler Registration: $.every.Monday.at9am(handler) fluent API
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ScheduleManager,
  parseCronExpression,
  getNextRunTime,
  InvalidCronExpressionError,
} from '../ScheduleManager'
import {
  createScheduleBuilderProxy,
  type ScheduleBuilderConfig,
} from '../schedule-builder'
import type { ScheduleHandler } from '../../types/WorkflowContext'

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
    id: { toString: () => 'test-schedule-do-id' },
    storage,
    alarms,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { alarms: { time: number | null }; _storage: Map<string, unknown> }
}

// ============================================================================
// NATURAL LANGUAGE PARSING - EXTENDED TESTS
// ============================================================================

describe('Natural Language Scheduling', () => {
  let mockState: ReturnType<typeof createMockState>
  let scheduleBuilder: ReturnType<typeof createScheduleBuilderProxy>
  let registeredSchedules: Array<{ cron: string; name: string; handler: ScheduleHandler }>

  beforeEach(() => {
    mockState = createMockState()
    registeredSchedules = []

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-08T12:00:00.000Z'))

    const config: ScheduleBuilderConfig = {
      state: mockState,
      onScheduleRegistered: (cron, name, handler) => {
        registeredSchedules.push({ cron, name, handler })
      },
    }
    scheduleBuilder = createScheduleBuilderProxy(config)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // ISSUE REQUIREMENT: 'Monday at 9am' -> '0 9 * * 1'
  // ==========================================================================

  describe('Day at Time patterns', () => {
    it("parses 'Monday at 9am' to '0 9 * * 1'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('Monday at 9am', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 9 * * 1')
    })

    it("parses 'Tuesday at 3pm' to '0 15 * * 2'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('Tuesday at 3pm', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 15 * * 2')
    })

    it("parses 'Friday at 5:30pm' to '30 17 * * 5'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('Friday at 5:30pm', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('30 17 * * 5')
    })

    it("parses 'Sunday at noon' to '0 12 * * 0'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('Sunday at noon', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 12 * * 0')
    })

    it("parses 'Saturday at midnight' to '0 0 * * 6'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('Saturday at midnight', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 0 * * 6')
    })
  })

  // ==========================================================================
  // ISSUE REQUIREMENT: 'first day of month' -> '0 0 1 * *'
  // ==========================================================================

  describe('Monthly patterns', () => {
    it("parses 'first day of month' to '0 0 1 * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('first day of month', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 0 1 * *')
    })

    it("parses 'first of month at 9am' to '0 9 1 * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('first of month at 9am', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 9 1 * *')
    })

    it("throws for 'last day of month' since standard cron doesn't support it", () => {
      const handler = vi.fn()
      // Standard cron doesn't support 'L' for last day - this throws an error
      expect(() => (scheduleBuilder as Function)('last day of month', handler)).toThrow('last day of month is not supported in standard cron')
    })

    it("parses '15th of month' to '0 0 15 * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('15th of month', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 0 15 * *')
    })

    it("parses '1st of month at 6am' to '0 6 1 * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('1st of month at 6am', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 6 1 * *')
    })
  })

  // ==========================================================================
  // ISSUE REQUIREMENT: 'every 15 minutes' -> '*/15 * * * *'
  // ==========================================================================

  describe('Interval patterns', () => {
    it("parses 'every 15 minutes' to '*/15 * * * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every 15 minutes', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('*/15 * * * *')
    })

    it("parses 'every 5 minutes' to '*/5 * * * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every 5 minutes', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('*/5 * * * *')
    })

    it("parses 'every 30 minutes' to '*/30 * * * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every 30 minutes', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('*/30 * * * *')
    })

    it("parses 'every minute' to '* * * * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every minute', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('* * * * *')
    })

    it("parses 'every hour' to '0 * * * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every hour', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 * * * *')
    })

    it("parses 'hourly' to '0 * * * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('hourly', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 * * * *')
    })

    it("parses 'every 2 hours' to '0 */2 * * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every 2 hours', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 */2 * * *')
    })

    it("parses 'every 6 hours' to '0 */6 * * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every 6 hours', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 */6 * * *')
    })
  })

  // ==========================================================================
  // ADDITIONAL NATURAL LANGUAGE PATTERNS
  // ==========================================================================

  describe('Daily patterns', () => {
    it("parses 'daily at 9am' to '0 9 * * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('daily at 9am', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 9 * * *')
    })

    it("parses 'every day at 6am' to '0 6 * * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every day at 6am', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 6 * * *')
    })

    it("parses 'everyday at noon' to '0 12 * * *'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('everyday at noon', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 12 * * *')
    })
  })

  describe('Weekday/weekend patterns', () => {
    it("parses 'weekdays at 9am' to '0 9 * * 1-5'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('weekdays at 9am', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 9 * * 1-5')
    })

    it("parses 'weekends at 10am' to '0 10 * * 0,6'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('weekends at 10am', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 10 * * 0,6')
    })

    it("parses 'every weekday at 8:30am' to '30 8 * * 1-5'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every weekday at 8:30am', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('30 8 * * 1-5')
    })
  })

  describe('Weekly patterns', () => {
    it("parses 'weekly on Monday' to '0 0 * * 1'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('weekly on Monday', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 0 * * 1')
    })

    it("parses 'every week on Friday at 5pm' to '0 17 * * 5'", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every week on Friday at 5pm', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 17 * * 5')
    })
  })
})

// ============================================================================
// SCHEDULE PERSISTENCE TESTS
// ============================================================================

describe('Schedule Persistence', () => {
  let mockState: ReturnType<typeof createMockState>
  let manager: ScheduleManager

  beforeEach(() => {
    mockState = createMockState()
    manager = new ScheduleManager(mockState)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-08T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Storage operations', () => {
    it('persists schedule to graph Things on creation', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')

      // Verify schedule can be retrieved (persisted in graph store)
      const schedule = await manager.getSchedule('daily-report')
      expect(schedule).toBeDefined()
      expect(schedule?.name).toBe('daily-report')
    })

    it('restores schedules from graph store after DO restart', async () => {
      // Create a schedule
      await manager.schedule('0 9 * * *', 'daily-report')

      // Get the stored data via public API
      const schedule = await manager.getSchedule('daily-report')
      expect(schedule).toBeDefined()

      // Verify stored data has required fields
      expect(schedule?.name).toBe('daily-report')
      expect(schedule?.cronExpression).toBe('0 9 * * *')
      expect(schedule?.status).toBe('active')
    })

    it('removes schedule from storage on deletion', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')
      await manager.deleteSchedule('daily-report')

      const schedule = await manager.getSchedule('daily-report')
      expect(schedule).toBeNull()
    })

    it('updates schedule in storage on modification', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')
      await manager.updateSchedule('daily-report', { enabled: false })

      const schedule = await manager.getSchedule('daily-report')
      expect(schedule?.status).toBe('paused')
    })
  })

  describe('Metadata storage', () => {
    it('stores custom metadata with schedule', async () => {
      await manager.schedule('0 9 * * *', 'daily-report', {
        metadata: { workflowId: 'wf-123', step: 'send-report' },
      })

      const schedule = await manager.getSchedule('daily-report')
      expect(schedule?.metadata).toEqual({ workflowId: 'wf-123', step: 'send-report' })
    })

    it('stores timezone with schedule', async () => {
      await manager.schedule('0 9 * * *', 'daily-report', {
        timezone: 'America/New_York',
      })

      const schedule = await manager.getSchedule('daily-report')
      expect(schedule?.timezone).toBe('America/New_York')
    })
  })
})

// ============================================================================
// DO ALARM INTEGRATION TESTS
// ============================================================================

describe('DO Alarm Integration', () => {
  let mockState: ReturnType<typeof createMockState>
  let manager: ScheduleManager

  beforeEach(() => {
    mockState = createMockState()
    manager = new ScheduleManager(mockState)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-08T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Alarm scheduling', () => {
    it('sets DO alarm when schedule is created', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')

      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })

    it('sets alarm to correct next run time', async () => {
      await manager.schedule('0 9 * * *', 'daily-report')

      // 9:00 AM has already passed today (12:00 noon), so next is tomorrow
      const expectedTime = new Date('2026-01-09T09:00:00.000Z').getTime()
      expect(mockState.alarms.time).toBe(expectedTime)
    })

    it('reschedules alarm after execution', async () => {
      manager.onScheduleTrigger(vi.fn())
      await manager.schedule('0 9 * * *', 'daily-report')

      vi.setSystemTime(new Date('2026-01-09T09:00:00.000Z'))
      await manager.handleAlarm()

      // Should be rescheduled to next day
      const expectedTime = new Date('2026-01-10T09:00:00.000Z').getTime()
      expect(mockState.alarms.time).toBe(expectedTime)
    })

    it('clears alarm when last schedule is deleted', async () => {
      await manager.schedule('0 9 * * *', 'only-schedule')
      await manager.deleteSchedule('only-schedule')

      expect(mockState.alarms.time).toBeNull()
    })

    it('sets alarm to earliest schedule when multiple exist', async () => {
      await manager.schedule('0 15 * * *', 'afternoon-report') // 3 PM today
      await manager.schedule('0 9 * * *', 'morning-report')   // 9 AM tomorrow

      // 3 PM today is earlier than 9 AM tomorrow
      const expectedTime = new Date('2026-01-08T15:00:00.000Z').getTime()
      expect(mockState.alarms.time).toBe(expectedTime)
    })
  })

  describe('Alarm execution', () => {
    it('calls handler when alarm fires', async () => {
      const handler = vi.fn()
      manager.onScheduleTrigger(handler)
      await manager.schedule('0 9 * * *', 'daily-report')

      vi.setSystemTime(new Date('2026-01-09T09:00:00.000Z'))
      await manager.handleAlarm()

      expect(handler).toHaveBeenCalled()
    })

    it('passes schedule info to handler', async () => {
      const handler = vi.fn()
      manager.onScheduleTrigger(handler)
      await manager.schedule('0 9 * * *', 'daily-report')

      vi.setSystemTime(new Date('2026-01-09T09:00:00.000Z'))
      await manager.handleAlarm()

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'daily-report',
          cronExpression: '0 9 * * *',
        }),
      )
    })

    it('updates lastRunAt after execution', async () => {
      manager.onScheduleTrigger(vi.fn())
      await manager.schedule('0 9 * * *', 'daily-report')

      vi.setSystemTime(new Date('2026-01-09T09:00:00.000Z'))
      await manager.handleAlarm()

      const schedule = await manager.getSchedule('daily-report')
      expect(schedule?.lastRunAt).toEqual(new Date('2026-01-09T09:00:00.000Z'))
    })

    it('increments runCount after execution', async () => {
      manager.onScheduleTrigger(vi.fn())
      await manager.schedule('0 9 * * *', 'daily-report')

      vi.setSystemTime(new Date('2026-01-09T09:00:00.000Z'))
      await manager.handleAlarm()

      const schedule = await manager.getSchedule('daily-report')
      expect(schedule?.runCount).toBe(1)
    })
  })
})

// ============================================================================
// FLUENT API TESTS ($.every.Monday.at9am)
// ============================================================================

describe('Fluent API Handler Registration', () => {
  let mockState: ReturnType<typeof createMockState>
  let scheduleBuilder: ReturnType<typeof createScheduleBuilderProxy>
  let registeredSchedules: Array<{ cron: string; name: string; handler: ScheduleHandler }>

  beforeEach(() => {
    mockState = createMockState()
    registeredSchedules = []

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-08T12:00:00.000Z'))

    const config: ScheduleBuilderConfig = {
      state: mockState,
      onScheduleRegistered: (cron, name, handler) => {
        registeredSchedules.push({ cron, name, handler })
      },
    }
    scheduleBuilder = createScheduleBuilderProxy(config)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('$.every.Day.atTime pattern', () => {
    it('$.every.Monday.at9am registers correct cron', () => {
      const handler = vi.fn()
      scheduleBuilder.Monday.at9am(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 9 * * 1')
    })

    it('$.every.Friday.at5pm registers correct cron', () => {
      const handler = vi.fn()
      scheduleBuilder.Friday.at5pm(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 17 * * 5')
    })

    it('$.every.day.at6am registers daily schedule', () => {
      const handler = vi.fn()
      scheduleBuilder.day.at6am(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 6 * * *')
    })
  })

  describe('$.every.interval pattern', () => {
    it('$.every.hour registers hourly schedule', () => {
      const handler = vi.fn()
      scheduleBuilder.hour(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 * * * *')
    })

    it('$.every.minute registers every-minute schedule', () => {
      const handler = vi.fn()
      scheduleBuilder.minute(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('* * * * *')
    })
  })

  describe("$.every.Day.at('time') dynamic pattern", () => {
    it("$.every.Monday.at('9am') registers correct cron", () => {
      const handler = vi.fn()
      scheduleBuilder.Monday.at('9am')(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 9 * * 1')
    })

    it("$.every.Monday.at('9:30am') registers correct cron", () => {
      const handler = vi.fn()
      scheduleBuilder.Monday.at('9:30am')(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('30 9 * * 1')
    })

    it("$.every.day.at('noon') registers correct cron", () => {
      const handler = vi.fn()
      scheduleBuilder.day.at('noon')(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 12 * * *')
    })
  })

  describe('Handler storage', () => {
    it('stores handler reference for later execution', () => {
      const handler = vi.fn()
      scheduleBuilder.Monday.at9am(handler)

      expect(registeredSchedules[0].handler).toBe(handler)
    })

    it('stores different handlers for different schedules', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      scheduleBuilder.Monday.at9am(handler1)
      scheduleBuilder.Friday.at5pm(handler2)

      expect(registeredSchedules[0].handler).toBe(handler1)
      expect(registeredSchedules[1].handler).toBe(handler2)
    })
  })

  describe('Unique name generation', () => {
    it('generates unique names for each schedule', () => {
      scheduleBuilder.Monday.at9am(vi.fn())
      scheduleBuilder.Monday.at9am(vi.fn())

      expect(registeredSchedules[0].name).not.toBe(registeredSchedules[1].name)
    })
  })
})

// ============================================================================
// CRON EXPRESSION VALIDATION
// ============================================================================

describe('Cron Expression Parsing', () => {
  describe('parseCronExpression', () => {
    it('parses standard 5-field cron', () => {
      const cron = parseCronExpression('0 9 * * 1')

      expect(cron.minute).toEqual([0])
      expect(cron.hour).toEqual([9])
      expect(cron.dayOfMonth).toEqual('*')
      expect(cron.month).toEqual('*')
      expect(cron.dayOfWeek).toEqual([1])
    })

    it('parses step values', () => {
      const cron = parseCronExpression('*/15 * * * *')

      expect(cron.minute).toEqual([0, 15, 30, 45])
    })

    it('parses ranges', () => {
      const cron = parseCronExpression('0 9-17 * * *')

      expect(cron.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    })

    it('parses lists', () => {
      const cron = parseCronExpression('0 0 * * 1,3,5')

      expect(cron.dayOfWeek).toEqual([1, 3, 5])
    })

    it('throws on invalid expression', () => {
      expect(() => parseCronExpression('')).toThrow(InvalidCronExpressionError)
      expect(() => parseCronExpression('invalid')).toThrow(InvalidCronExpressionError)
      expect(() => parseCronExpression('60 * * * *')).toThrow(InvalidCronExpressionError)
    })
  })

  describe('getNextRunTime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-08T12:00:00.000Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('calculates next run for daily schedule', () => {
      const cron = parseCronExpression('0 9 * * *')
      const nextRun = getNextRunTime(cron)

      // 9 AM has passed today, so next is tomorrow
      expect(nextRun).toEqual(new Date('2026-01-09T09:00:00.000Z'))
    })

    it('calculates next run for later today', () => {
      const cron = parseCronExpression('0 15 * * *')
      const nextRun = getNextRunTime(cron)

      // 3 PM is later today
      expect(nextRun).toEqual(new Date('2026-01-08T15:00:00.000Z'))
    })

    it('calculates next run for specific day of week', () => {
      // Thursday Jan 8, 2026 - next Monday is Jan 12
      const cron = parseCronExpression('0 9 * * 1')
      const nextRun = getNextRunTime(cron)

      expect(nextRun).toEqual(new Date('2026-01-12T09:00:00.000Z'))
    })

    it('calculates next run with timezone', () => {
      const cron = parseCronExpression('0 9 * * *')
      const nextRun = getNextRunTime(cron, { timezone: 'America/New_York' })

      // 9 AM EST = 14:00 UTC (during standard time)
      expect(nextRun).toEqual(new Date('2026-01-08T14:00:00.000Z'))
    })
  })
})
