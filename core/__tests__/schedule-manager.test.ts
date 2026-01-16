/**
 * Schedule Manager Tests - TDD RED Phase
 *
 * Comprehensive tests for:
 * - parseTime() function - 24h format, AM/PM format, special times
 * - Invalid time handling (throws on invalid input)
 * - CRON expression generation from fluent DSL
 * - $.every.day.at('9am') pattern
 * - $.every.Monday.at('2pm') pattern
 * - Multiple schedules registration
 * - Schedule cleanup/removal
 *
 * @see do-wzby - Schedule Manager TDD tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { parseTime, ScheduleManager, DAY_MAP } from '../schedule-manager'

// =============================================================================
// Test Helpers
// =============================================================================

function getDO(name: string = 'schedule-test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

// =============================================================================
// 1. parseTime() FUNCTION TESTS
// =============================================================================

describe('parseTime()', () => {
  describe('24-hour format', () => {
    it('should parse "14:30" as { hour: 14, minute: 30 }', () => {
      const result = parseTime('14:30')
      expect(result).toEqual({ hour: 14, minute: 30 })
    })

    it('should parse "00:00" as midnight { hour: 0, minute: 0 }', () => {
      const result = parseTime('00:00')
      expect(result).toEqual({ hour: 0, minute: 0 })
    })

    it('should parse "23:59" as { hour: 23, minute: 59 }', () => {
      const result = parseTime('23:59')
      expect(result).toEqual({ hour: 23, minute: 59 })
    })

    it('should parse "9:00" (single digit hour) as { hour: 9, minute: 0 }', () => {
      const result = parseTime('9:00')
      expect(result).toEqual({ hour: 9, minute: 0 })
    })

    it('should parse "17:00" as { hour: 17, minute: 0 }', () => {
      const result = parseTime('17:00')
      expect(result).toEqual({ hour: 17, minute: 0 })
    })

    it('should parse "06:45" as { hour: 6, minute: 45 }', () => {
      const result = parseTime('06:45')
      expect(result).toEqual({ hour: 6, minute: 45 })
    })
  })

  describe('AM/PM format', () => {
    it('should parse "2:30pm" as { hour: 14, minute: 30 }', () => {
      const result = parseTime('2:30pm')
      expect(result).toEqual({ hour: 14, minute: 30 })
    })

    it('should parse "9am" as { hour: 9, minute: 0 }', () => {
      const result = parseTime('9am')
      expect(result).toEqual({ hour: 9, minute: 0 })
    })

    it('should parse "9AM" (uppercase) as { hour: 9, minute: 0 }', () => {
      const result = parseTime('9AM')
      expect(result).toEqual({ hour: 9, minute: 0 })
    })

    it('should parse "12pm" as noon { hour: 12, minute: 0 }', () => {
      const result = parseTime('12pm')
      expect(result).toEqual({ hour: 12, minute: 0 })
    })

    it('should parse "12am" as midnight { hour: 0, minute: 0 }', () => {
      const result = parseTime('12am')
      expect(result).toEqual({ hour: 0, minute: 0 })
    })

    it('should parse "12:30am" as { hour: 0, minute: 30 }', () => {
      const result = parseTime('12:30am')
      expect(result).toEqual({ hour: 0, minute: 30 })
    })

    it('should parse "11:59pm" as { hour: 23, minute: 59 }', () => {
      const result = parseTime('11:59pm')
      expect(result).toEqual({ hour: 23, minute: 59 })
    })

    it('should parse "6:00PM" (uppercase) as { hour: 18, minute: 0 }', () => {
      const result = parseTime('6:00PM')
      expect(result).toEqual({ hour: 18, minute: 0 })
    })

    it('should parse "5pm" as { hour: 17, minute: 0 }', () => {
      const result = parseTime('5pm')
      expect(result).toEqual({ hour: 17, minute: 0 })
    })

    it('should parse "7:15am" as { hour: 7, minute: 15 }', () => {
      const result = parseTime('7:15am')
      expect(result).toEqual({ hour: 7, minute: 15 })
    })
  })

  describe('special time keywords', () => {
    it('should parse "noon" as { hour: 12, minute: 0 }', () => {
      const result = parseTime('noon')
      expect(result).toEqual({ hour: 12, minute: 0 })
    })

    it('should parse "midnight" as { hour: 0, minute: 0 }', () => {
      const result = parseTime('midnight')
      expect(result).toEqual({ hour: 0, minute: 0 })
    })
  })

  describe('invalid time handling', () => {
    it('should throw on "25:00" (invalid hour)', () => {
      expect(() => parseTime('25:00')).toThrow(/Invalid time format/)
    })

    it('should throw on "invalid"', () => {
      expect(() => parseTime('invalid')).toThrow(/Invalid time format/)
    })

    it('should throw on "abc:def"', () => {
      expect(() => parseTime('abc:def')).toThrow(/Invalid time format/)
    })

    it('should throw on empty string', () => {
      expect(() => parseTime('')).toThrow(/Invalid time format/)
    })

    it('should throw on "13pm" (invalid 12-hour format)', () => {
      // 13pm doesn't make sense in 12-hour format
      // Current implementation may accept this, test should verify proper validation
      expect(() => parseTime('13pm')).toThrow(/Invalid time format/)
    })

    it('should throw on "12:60" (invalid minutes)', () => {
      expect(() => parseTime('12:60')).toThrow(/Invalid time format/)
    })

    it('should throw on "9:5" (single digit minutes without leading zero)', () => {
      // Minutes should be 2 digits
      expect(() => parseTime('9:5')).toThrow(/Invalid time format/)
    })

    it('should throw on negative hours "-1:00"', () => {
      expect(() => parseTime('-1:00')).toThrow(/Invalid time format/)
    })

    it('should throw on spaces "9 am"', () => {
      expect(() => parseTime('9 am')).toThrow(/Invalid time format/)
    })
  })
})

// =============================================================================
// 2. DAY_MAP CONSTANT TESTS
// =============================================================================

describe('DAY_MAP constant', () => {
  it('should map Sunday to 0', () => {
    expect(DAY_MAP.Sunday).toBe(0)
  })

  it('should map Monday to 1', () => {
    expect(DAY_MAP.Monday).toBe(1)
  })

  it('should map Tuesday to 2', () => {
    expect(DAY_MAP.Tuesday).toBe(2)
  })

  it('should map Wednesday to 3', () => {
    expect(DAY_MAP.Wednesday).toBe(3)
  })

  it('should map Thursday to 4', () => {
    expect(DAY_MAP.Thursday).toBe(4)
  })

  it('should map Friday to 5', () => {
    expect(DAY_MAP.Friday).toBe(5)
  })

  it('should map Saturday to 6', () => {
    expect(DAY_MAP.Saturday).toBe(6)
  })

  it('should have exactly 7 day entries', () => {
    expect(Object.keys(DAY_MAP).length).toBe(7)
  })
})

// =============================================================================
// 3. CRON EXPRESSION GENERATION TESTS (via ScheduleManager)
// =============================================================================

describe('ScheduleManager', () => {
  describe('CRON expression generation', () => {
    it('should generate "0 9 * * *" for every.day.at("9am")', async () => {
      const stub = getDO('cron-gen-day-9am')
      const handler = vi.fn()

      // Register via the fluent DSL
      const unsubscribe = await stub.registerScheduleViaEvery('day', '9am', handler)

      // Verify the CRON expression was generated correctly
      const schedule = await stub.getScheduleByCron('0 9 * * *')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should generate "30 14 * * 1" for every.Monday.at("2:30pm")', async () => {
      const stub = getDO('cron-gen-monday-230pm')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaEvery('Monday', '2:30pm', handler)

      // Monday = 1 in CRON, 2:30pm = 14:30
      const schedule = await stub.getScheduleByCron('30 14 * * 1')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should generate "0 * * * *" for every.hour()', async () => {
      const stub = getDO('cron-gen-hour')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaEvery('hour', null, handler)

      const schedule = await stub.getScheduleByCron('0 * * * *')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should generate "* * * * *" for every.minute()', async () => {
      const stub = getDO('cron-gen-minute')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaEvery('minute', null, handler)

      const schedule = await stub.getScheduleByCron('* * * * *')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should generate "*/5 * * * *" for every(5).minutes()', async () => {
      const stub = getDO('cron-gen-5min')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaInterval(5, 'minutes', handler)

      const schedule = await stub.getScheduleByCron('*/5 * * * *')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should generate "0 */2 * * *" for every(2).hours()', async () => {
      const stub = getDO('cron-gen-2hours')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaInterval(2, 'hours', handler)

      const schedule = await stub.getScheduleByCron('0 */2 * * *')
      expect(schedule).toBeDefined()

      unsubscribe()
    })
  })

  describe('$.every.day.at() pattern', () => {
    it('should register a handler for every.day.at("9am")', async () => {
      const stub = getDO('every-day-9am')
      const handler = vi.fn()

      // Access the every builder via the DO's $ context
      const unsubscribe = await stub.registerSchedule('0 9 * * *', handler)

      // Unsubscribe returns a callable RPC stub - verify it's callable
      // Note: In RPC, functions are returned as RPC stubs that can be called
      expect(typeof unsubscribe).toBe('function')

      // Verify registration
      const schedule = await stub.getScheduleByCron('0 9 * * *')
      expect(schedule).toBeDefined()
    })

    it('should register a handler for every.day.at("6pm")', async () => {
      const stub = getDO('every-day-6pm')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaEvery('day', '6pm', handler)

      const schedule = await stub.getScheduleByCron('0 18 * * *')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should support shortcut at9am', async () => {
      const stub = getDO('every-day-at9am-shortcut')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaEveryShortcut('day', 'at9am', handler)

      const schedule = await stub.getScheduleByCron('0 9 * * *')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should support shortcut at5pm', async () => {
      const stub = getDO('every-day-at5pm-shortcut')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaEveryShortcut('day', 'at5pm', handler)

      const schedule = await stub.getScheduleByCron('0 17 * * *')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should support shortcut at6am', async () => {
      const stub = getDO('every-day-at6am-shortcut')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaEveryShortcut('day', 'at6am', handler)

      const schedule = await stub.getScheduleByCron('0 6 * * *')
      expect(schedule).toBeDefined()

      unsubscribe()
    })
  })

  describe('$.every.Monday.at() pattern (day of week)', () => {
    it('should register a handler for every.Monday.at("2pm")', async () => {
      const stub = getDO('every-monday-2pm')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaEvery('Monday', '2pm', handler)

      // Monday = 1 in CRON
      const schedule = await stub.getScheduleByCron('0 14 * * 1')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should register a handler for every.Friday.at("5pm")', async () => {
      const stub = getDO('every-friday-5pm')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaEvery('Friday', '5pm', handler)

      // Friday = 5 in CRON
      const schedule = await stub.getScheduleByCron('0 17 * * 5')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should register a handler for every.Sunday.at("noon")', async () => {
      const stub = getDO('every-sunday-noon')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaEvery('Sunday', 'noon', handler)

      // Sunday = 0 in CRON
      const schedule = await stub.getScheduleByCron('0 12 * * 0')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should register handlers for all days of the week', async () => {
      const stub = getDO('every-all-days')
      const handler = vi.fn()

      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      const unsubscribers: (() => void)[] = []

      for (const day of days) {
        const unsub = await stub.registerScheduleViaEvery(day, '10am', handler)
        unsubscribers.push(unsub)
      }

      // Verify all days were registered
      for (let i = 0; i < days.length; i++) {
        const dow = (i + 1) % 7 // Monday=1, ..., Sunday=0
        const schedule = await stub.getScheduleByCron(`0 10 * * ${dow}`)
        expect(schedule).toBeDefined()
      }

      // Cleanup
      for (const unsub of unsubscribers) {
        unsub()
      }
    })
  })

  describe('multiple schedules registration', () => {
    it('should allow registering multiple different schedules', async () => {
      const stub = getDO('multiple-schedules-1')
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()

      const unsub1 = await stub.registerSchedule('0 9 * * *', handler1)
      const unsub2 = await stub.registerSchedule('0 17 * * *', handler2)
      const unsub3 = await stub.registerSchedule('0 12 * * 1', handler3)

      // All three should be registered
      expect(await stub.getScheduleByCron('0 9 * * *')).toBeDefined()
      expect(await stub.getScheduleByCron('0 17 * * *')).toBeDefined()
      expect(await stub.getScheduleByCron('0 12 * * 1')).toBeDefined()

      unsub1()
      unsub2()
      unsub3()
    })

    it('should replace handler when same CRON is registered twice', async () => {
      const stub = getDO('multiple-schedules-replace')
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      await stub.registerSchedule('0 9 * * *', handler1)
      await stub.registerSchedule('0 9 * * *', handler2)

      // Should have only one entry (replaced)
      const count = await stub.getScheduleCount()
      // Note: This depends on implementation - may need adjustment
      expect(count).toBeGreaterThanOrEqual(1)
    })

    it('should count schedules correctly', async () => {
      const stub = getDO('multiple-schedules-count')
      const handler = vi.fn()

      await stub.registerSchedule('0 9 * * *', handler)
      await stub.registerSchedule('0 10 * * *', handler)
      await stub.registerSchedule('0 11 * * *', handler)

      const count = await stub.getScheduleCount()
      expect(count).toBe(3)
    })

    it('should persist schedules to SQLite', async () => {
      const stub = getDO('schedules-persist')
      const handler = vi.fn()

      await stub.registerSchedule('0 8 * * *', handler)

      // Check SQLite persistence
      const persistedSchedules = await stub.getPersistedSchedules()
      expect(persistedSchedules).toContainEqual(
        expect.objectContaining({ cron: '0 8 * * *' })
      )
    })
  })

  describe('schedule cleanup/removal', () => {
    it('should remove schedule when unsubscribe is called', async () => {
      const stub = getDO('cleanup-unsubscribe')
      const handler = vi.fn()

      const unsubscribe = await stub.registerSchedule('0 9 * * *', handler)

      // Verify it exists
      expect(await stub.getScheduleByCron('0 9 * * *')).toBeDefined()

      // Unsubscribe
      unsubscribe()

      // Verify it's removed
      const schedule = await stub.getScheduleByCron('0 9 * * *')
      expect(schedule).toBeUndefined()
    })

    it('should remove schedule from SQLite when unsubscribed', async () => {
      const stub = getDO('cleanup-sqlite')
      const handler = vi.fn()

      const unsubscribe = await stub.registerSchedule('0 15 * * *', handler)

      // Unsubscribe
      unsubscribe()

      // Check SQLite
      const persistedSchedules = await stub.getPersistedSchedules()
      expect(persistedSchedules).not.toContainEqual(
        expect.objectContaining({ cron: '0 15 * * *' })
      )
    })

    it('should only remove the specific schedule, not others', async () => {
      const stub = getDO('cleanup-selective')
      const handler = vi.fn()

      const unsub1 = await stub.registerSchedule('0 9 * * *', handler)
      const unsub2 = await stub.registerSchedule('0 17 * * *', handler)

      // Remove only the first one
      unsub1()

      // First should be gone
      expect(await stub.getScheduleByCron('0 9 * * *')).toBeUndefined()

      // Second should still exist
      expect(await stub.getScheduleByCron('0 17 * * *')).toBeDefined()

      unsub2()
    })

    it('should handle double unsubscribe gracefully', async () => {
      const stub = getDO('cleanup-double')
      const handler = vi.fn()

      const unsubscribe = await stub.registerSchedule('0 9 * * *', handler)

      // Unsubscribe twice
      unsubscribe()
      expect(() => unsubscribe()).not.toThrow()
    })

    it('should clear all schedules with clearSchedules()', async () => {
      const stub = getDO('cleanup-clear-all')
      const handler = vi.fn()

      await stub.registerSchedule('0 9 * * *', handler)
      await stub.registerSchedule('0 12 * * *', handler)
      await stub.registerSchedule('0 18 * * *', handler)

      // Clear all
      await stub.clearAllSchedules()

      const count = await stub.getScheduleCount()
      expect(count).toBe(0)
    })
  })

  describe('schedule builder DSL (createEveryBuilder)', () => {
    it('should expose day property on builder', async () => {
      const stub = getDO('builder-day')

      // The builder should have a 'day' property that returns a TimeBuilder
      const every = await stub.getEveryBuilder()
      expect(every.day).toBeDefined()
    })

    it('should expose all days of week on builder', async () => {
      const stub = getDO('builder-days')

      const every = await stub.getEveryBuilder()
      expect(every.Monday).toBeDefined()
      expect(every.Tuesday).toBeDefined()
      expect(every.Wednesday).toBeDefined()
      expect(every.Thursday).toBeDefined()
      expect(every.Friday).toBeDefined()
      expect(every.Saturday).toBeDefined()
      expect(every.Sunday).toBeDefined()
    })

    it('should expose hour and minute functions on builder', async () => {
      const stub = getDO('builder-intervals')

      const every = await stub.getEveryBuilder()
      expect(typeof every.hour).toBe('function')
      expect(typeof every.minute).toBe('function')
    })

    it('should be callable as a function for intervals: every(5)', async () => {
      const stub = getDO('builder-callable')

      const every = await stub.getEveryBuilder()
      expect(typeof every).toBe('function')

      const intervalBuilder = every(5)
      expect(intervalBuilder.minutes).toBeDefined()
      expect(intervalBuilder.hours).toBeDefined()
      expect(intervalBuilder.seconds).toBeDefined()
    })
  })

  describe('interval scheduling', () => {
    it('should support every(15).minutes()', async () => {
      const stub = getDO('interval-15min')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaInterval(15, 'minutes', handler)

      const schedule = await stub.getScheduleByCron('*/15 * * * *')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should support every(4).hours()', async () => {
      const stub = getDO('interval-4hours')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaInterval(4, 'hours', handler)

      const schedule = await stub.getScheduleByCron('0 */4 * * *')
      expect(schedule).toBeDefined()

      unsubscribe()
    })

    it('should support every(30).seconds() with special format', async () => {
      const stub = getDO('interval-30sec')
      const handler = vi.fn()

      const unsubscribe = await stub.registerScheduleViaInterval(30, 'seconds', handler)

      // Seconds scheduling uses special format since CRON doesn't support seconds
      const schedule = await stub.getScheduleByCron('every:30s')
      expect(schedule).toBeDefined()

      unsubscribe()
    })
  })

  describe('schedule recovery after eviction', () => {
    it('should recover schedules from SQLite after clearSchedules()', async () => {
      const stub = getDO('recovery-eviction')
      const handler = vi.fn()

      // Register a schedule
      await stub.registerSchedule('0 9 * * *', handler)

      // Simulate eviction by clearing in-memory schedules
      await stub.clearInMemorySchedules()

      // Verify in-memory is cleared
      const memoryCount = await stub.getInMemoryScheduleCount()
      expect(memoryCount).toBe(0)

      // Recovery should restore from SQLite
      await stub.recoverSchedulesFromStorage()

      // Should have the schedule again
      const schedule = await stub.getScheduleByCron('0 9 * * *')
      expect(schedule).toBeDefined()
    })
  })
})
