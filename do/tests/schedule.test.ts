/**
 * Schedule DSL Tests - Real Alarm Scheduling via Miniflare
 *
 * Tests the $.every scheduling DSL with real Durable Object alarms.
 * Uses vitest-pool-workers for actual DO runtime behavior.
 *
 * The scheduling DSL should:
 * 1. Register schedule handlers via $.every.* patterns
 * 2. Calculate next execution times from cron expressions
 * 3. Execute handlers when alarm() is triggered
 * 4. Reschedule recurring alarms after execution
 *
 * @module do/tests/schedule.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env, runInDurableObject } from 'cloudflare:test'
import { DO } from '../DO'
import {
  createEveryProxy,
  getSchedules,
  getScheduleCount,
  clearSchedules,
  type ScheduleRegistration,
} from '../workflow/schedule'
import {
  calculateNextRunTime,
  calculateNextCronTime,
  calculateNextAlarmTime,
  createAlarmStore,
} from '../workflow/alarm'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate unique test identifier
 */
function generateTestId(): string {
  return `schedule-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// UNIT TESTS - Schedule DSL (no mocks needed, pure functions)
// ============================================================================

describe('$.every scheduling DSL', () => {
  let schedules: Map<string, ScheduleRegistration>
  let every: ReturnType<typeof createEveryProxy>

  beforeEach(() => {
    schedules = new Map()
    every = createEveryProxy(schedules)
  })

  describe('$.every.hour pattern', () => {
    it('should register handler for every.hour', () => {
      const handler = async () => {}
      every.hour(handler)

      expect(schedules.size).toBe(1)

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 * * * *',
        natural: 'hour',
      })
    })

    it('should register handler for every.day', () => {
      every.day(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 0 * * *',
        natural: 'day',
      })
    })

    it('should register handler for every.minute', () => {
      every.minute(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '* * * * *',
        natural: 'minute',
      })
    })

    it('should register handler for every.week', () => {
      every.week(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 0 * * 0',
        natural: 'week',
      })
    })
  })

  describe('$.every.Monday pattern', () => {
    it('should register handler for every.Monday', () => {
      every.Monday(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 0 * * 1',
        natural: 'Monday',
      })
    })

    it('should register handler for every.Friday', () => {
      every.Friday(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 0 * * 5',
        natural: 'Friday',
      })
    })

    it('should register handler for every.weekday', () => {
      every.weekday(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 0 * * 1-5',
        natural: 'weekday',
      })
    })
  })

  describe('$.every.Monday.at9am pattern', () => {
    it('should register handler for every.Monday.at9am', () => {
      every.Monday.at9am(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 9 * * 1',
        natural: 'Monday.at9am',
      })
    })

    it('should register handler for every.Friday.at5pm', () => {
      every.Friday.at5pm(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 17 * * 5',
        natural: 'Friday.at5pm',
      })
    })

    it('should register handler for every.weekday.at8am', () => {
      every.weekday.at8am(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 8 * * 1-5',
        natural: 'weekday.at8am',
      })
    })

    it('should register handler for every.day.at("6pm")', () => {
      every.day.at('6pm')(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 18 * * *',
        natural: 'day.at(6pm)',
      })
    })

    it('should handle dynamic time with at("3:45pm")', () => {
      every.Monday.at('3:45pm')(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '45 15 * * 1',
        natural: 'Monday.at(3:45pm)',
      })
    })
  })

  describe('$.every(5).minutes pattern', () => {
    it('should register handler for every(5).minutes', () => {
      every(5).minutes(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'minute',
        value: 5,
        natural: '5 minutes',
      })
    })

    it('should register handler for every(30).minutes', () => {
      every(30).minutes(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'minute',
        value: 30,
        natural: '30 minutes',
      })
    })

    it('should register handler for every(2).hours', () => {
      every(2).hours(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'hour',
        value: 2,
        natural: '2 hours',
      })
    })

    it('should register handler for every(10).seconds', () => {
      every(10).seconds(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'second',
        value: 10,
        natural: '10 seconds',
      })
    })
  })

  describe('$.every.week.on.Friday.at("3pm") pattern', () => {
    it('should register handler for every.week.on.Friday.at("3pm")', () => {
      every.week.on.Friday.at('3pm')(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 15 * * 5',
        natural: 'week.on.Friday.at(3pm)',
      })
    })

    it('should register handler for every.week.on.Monday.at("9am")', () => {
      every.week.on.Monday.at('9am')(async () => {})

      const [schedule] = Array.from(schedules.values())
      expect(schedule.interval).toEqual({
        type: 'cron',
        expression: '0 9 * * 1',
        natural: 'week.on.Monday.at(9am)',
      })
    })
  })

  describe('multiple handlers', () => {
    it('should support multiple schedule registrations', () => {
      every.hour(async () => {})
      every.day(async () => {})
      every.Monday.at9am(async () => {})

      expect(schedules.size).toBe(3)
    })

    it('should track each handler separately', () => {
      const handler1 = async () => {}
      const handler2 = async () => {}

      every.hour(handler1)
      every.day(handler2)

      const values = Array.from(schedules.values())

      expect(values[0].handler).toBe(handler1)
      expect(values[1].handler).toBe(handler2)
    })
  })

  describe('chaining support', () => {
    it('should allow property chaining', () => {
      expect(every.Monday).toBeDefined()
      expect(typeof every.Monday).toBe('function')
      expect(every.Monday.at9am).toBeDefined()
      expect(typeof every.Monday.at9am).toBe('function')
    })

    it('should allow on chaining for week patterns', () => {
      expect(every.week.on).toBeDefined()
      expect(every.week.on.Friday).toBeDefined()
    })

    it('should allow numeric patterns', () => {
      expect(typeof every(5)).toBe('object')
      expect(typeof every(5).minutes).toBe('function')
    })
  })
})

// ============================================================================
// UNIT TESTS - Time Calculation (pure functions, no mocks)
// ============================================================================

describe('Schedule time calculations', () => {
  describe('calculateNextRunTime', () => {
    it('should calculate next time for minute intervals', () => {
      const now = new Date('2026-01-20T10:00:00Z').getTime()
      const next = calculateNextRunTime({ type: 'minute', value: 5 }, now)

      // 5 minutes from now
      expect(next).toBe(now + 5 * 60 * 1000)
    })

    it('should calculate next time for hour intervals', () => {
      const now = new Date('2026-01-20T10:00:00Z').getTime()
      const next = calculateNextRunTime({ type: 'hour', value: 2 }, now)

      // 2 hours from now
      expect(next).toBe(now + 2 * 60 * 60 * 1000)
    })

    it('should calculate next time for day intervals', () => {
      const now = new Date('2026-01-20T10:00:00Z').getTime()
      const next = calculateNextRunTime({ type: 'day', value: 1 }, now)

      // 1 day from now
      expect(next).toBe(now + 24 * 60 * 60 * 1000)
    })
  })

  describe('calculateNextCronTime', () => {
    it('should calculate next hourly time', () => {
      const now = new Date('2026-01-20T10:30:00Z').getTime()
      const next = calculateNextCronTime('0 * * * *', now)

      // Next hour is 11:00
      const expected = new Date('2026-01-20T11:00:00Z').getTime()
      expect(next).toBe(expected)
    })

    it('should calculate next daily time (midnight)', () => {
      const now = new Date('2026-01-20T10:30:00Z').getTime()
      const next = calculateNextCronTime('0 0 * * *', now)

      // The cron parser uses local time, so check the result is at midnight local time
      const result = new Date(next)
      expect(result.getHours()).toBe(0)
      expect(result.getMinutes()).toBe(0)
      // Should be after now
      expect(next).toBeGreaterThan(now)
    })

    it('should calculate next Monday at 9am', () => {
      // Start from a Tuesday
      const now = new Date('2026-01-20T10:30:00Z').getTime() // This is actually Monday
      const next = calculateNextCronTime('0 9 * * 1', now)

      // Next Monday 9am (since we're at Monday 10:30, it should be next Monday)
      const result = new Date(next)
      expect(result.getDay()).toBe(1) // Monday
      expect(result.getHours()).toBe(9)
      expect(result.getMinutes()).toBe(0)
    })

    it('should handle weekday ranges (1-5)', () => {
      // Start from a Sunday evening
      const now = new Date('2026-01-19T22:00:00Z').getTime()
      const next = calculateNextCronTime('0 8 * * 1-5', now)

      // Next weekday at 8am should be Monday
      const result = new Date(next)
      expect(result.getDay()).toBeGreaterThanOrEqual(1)
      expect(result.getDay()).toBeLessThanOrEqual(5)
      expect(result.getHours()).toBe(8)
    })
  })

  describe('calculateNextAlarmTime', () => {
    it('should return null for empty schedules', () => {
      const schedules = new Map<string, ScheduleRegistration>()
      const alarmStore = createAlarmStore()

      const next = calculateNextAlarmTime(schedules, alarmStore)
      expect(next).toBeNull()
    })

    it('should return earliest time among multiple schedules', () => {
      const schedules = new Map<string, ScheduleRegistration>()
      const alarmStore = createAlarmStore()

      // Register two schedules
      schedules.set('hourly', {
        interval: { type: 'minute', value: 30 },
        handler: async () => {},
        source: '',
      })
      schedules.set('daily', {
        interval: { type: 'hour', value: 2 },
        handler: async () => {},
        source: '',
      })

      const now = Date.now()
      const next = calculateNextAlarmTime(schedules, alarmStore)

      // Should be the 30-minute interval (sooner)
      expect(next).toBeLessThanOrEqual(now + 30 * 60 * 1000)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS - Real DO Alarms via Miniflare
// ============================================================================

describe('Real Alarm Scheduling (via miniflare)', () => {
  describe('schedule registration in real DO', () => {
    it('should register schedules via $.every in real DO context', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      // Use runInDurableObject to access internal $ context
      const scheduleCount = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        // Register schedules
        $.every.hour(async () => {})
        $.every.day(async () => {})

        return getScheduleCount($._schedules)
      })

      expect(scheduleCount).toBe(2)
    })

    it('should parse cron expressions correctly in real DO', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.Monday.at9am(async () => {})

        const scheduleList = getSchedules($._schedules)
        return scheduleList[0]
      })

      expect(schedule.interval.expression).toBe('0 9 * * 1')
      expect(schedule.interval.natural).toBe('Monday.at9am')
    })
  })

  describe('alarm execution in real DO', () => {
    it('should execute scheduled handlers when alarm() is called', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        let executed = false

        $.every.hour(async () => {
          executed = true
        })

        // Trigger alarm
        await instance.alarm()

        return executed
      })

      expect(result).toBe(true)
    })

    it('should execute multiple handlers when alarm fires', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const executions: string[] = []

        $.every.hour(async () => {
          executions.push('handler1')
        })
        $.every.hour(async () => {
          executions.push('handler2')
        })

        await instance.alarm()

        return executions
      })

      expect(result).toContain('handler1')
      expect(result).toContain('handler2')
      expect(result.length).toBe(2)
    })

    it('should handle handler errors gracefully and continue', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const executions: string[] = []

        $.every.hour(async () => {
          throw new Error('Handler 1 error')
        })
        $.every.hour(async () => {
          executions.push('handler2')
        })

        // Should not throw
        await instance.alarm()

        return executions
      })

      // Second handler should still execute despite first handler error
      expect(result).toContain('handler2')
    })
  })

  describe('alarm rescheduling in real DO', () => {
    it('should set alarm via storage.setAlarm after execution', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const hasAlarm = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        $.every.hour(async () => {})

        // Trigger alarm to set up next execution
        await instance.alarm()

        // Check if alarm was scheduled
        const nextAlarm = await state.storage.getAlarm()
        return nextAlarm !== null
      })

      expect(hasAlarm).toBe(true)
    })

    it('should schedule alarm for correct next execution time', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const alarmTime = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        // Register a 5-minute interval
        $.every(5).minutes(async () => {})

        await instance.alarm()

        return await state.storage.getAlarm()
      })

      // Should be scheduled within 5 minutes + small tolerance
      const now = Date.now()
      expect(alarmTime).toBeGreaterThan(now)
      expect(alarmTime).toBeLessThanOrEqual(now + 5 * 60 * 1000 + 1000)
    })
  })

  describe('alarm state persistence', () => {
    it('should persist schedule metadata to storage', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const hasPersistedData = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        $.every.hour(async () => {})
        await instance.alarm()

        // Check for persisted alarm data
        const stored = await state.storage.get('_alarms')
        return stored !== undefined && stored !== null
      })

      expect(hasPersistedData).toBe(true)
    })
  })

  describe('no schedules behavior', () => {
    it('should handle alarm() with no registered schedules', async () => {
      const testName = generateTestId()
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const alarmAfterNoSchedules = await runInDurableObject(stub, async (instance: DO) => {
        const state = (instance as any).state as DurableObjectState

        // Call alarm with no schedules registered
        await instance.alarm()

        // Should not have scheduled any alarm
        return await state.storage.getAlarm()
      })

      // No alarm should be scheduled when there are no schedules
      expect(alarmAfterNoSchedules).toBeNull()
    })
  })
})

// ============================================================================
// INTEGRATION TESTS - Schedule helpers
// ============================================================================

describe('Schedule helper functions', () => {
  describe('getSchedules', () => {
    it('should return all registered schedules', () => {
      const schedules = new Map<string, ScheduleRegistration>()
      const every = createEveryProxy(schedules)

      every.hour(async () => {})
      every.day(async () => {})

      const result = getSchedules(schedules)
      expect(result.length).toBe(2)
    })
  })

  describe('getScheduleCount', () => {
    it('should return correct count', () => {
      const schedules = new Map<string, ScheduleRegistration>()
      const every = createEveryProxy(schedules)

      expect(getScheduleCount(schedules)).toBe(0)

      every.hour(async () => {})
      expect(getScheduleCount(schedules)).toBe(1)

      every.day(async () => {})
      expect(getScheduleCount(schedules)).toBe(2)
    })
  })

  describe('clearSchedules', () => {
    it('should clear all schedules', () => {
      const schedules = new Map<string, ScheduleRegistration>()
      const every = createEveryProxy(schedules)

      every.hour(async () => {})
      every.day(async () => {})
      expect(schedules.size).toBe(2)

      clearSchedules(schedules)
      expect(schedules.size).toBe(0)
    })
  })
})
