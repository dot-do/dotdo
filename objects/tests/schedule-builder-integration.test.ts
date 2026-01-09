/**
 * Schedule Builder Integration Tests ($.every)
 *
 * RED TDD Phase: Tests for integrating $.every with ScheduleManager
 *
 * The $.every API should:
 * 1. Parse fluent syntax ($.every.Monday.at9am) to cron expressions
 * 2. Register schedules with ScheduleManager
 * 3. Use DO alarm API for execution
 * 4. Support natural language scheduling ($.every('every 5 minutes'))
 *
 * Design (from issue dotdo-6qty):
 * - RED: Test $.every.monday.at('9am') creates cron schedule
 * - GREEN: Parse natural language to cron, register DO alarm
 * - REFACTOR: Support $.every('every 5 minutes') syntax
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ScheduleHandler } from '../../types/WorkflowContext'

// ============================================================================
// MOCK DO STATE FOR SCHEDULE TESTING
// ============================================================================

function createMockDOStorage() {
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
      sql: {
        exec: vi.fn(() => ({
          toArray: () => [],
          one: () => null,
          raw: () => [],
        })),
      },
    },
    alarms,
    _storage: storage,
  }
}

function createMockDOState() {
  const { storage, alarms, _storage } = createMockDOStorage()
  return {
    id: { toString: () => 'test-do-id' },
    storage,
    alarms,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { alarms: { time: number | null }; _storage: Map<string, unknown> }
}

// ============================================================================
// IMPORT THE SCHEDULE BUILDER (to be created)
// ============================================================================

// The ScheduleBuilder creates the $.every proxy that integrates with ScheduleManager
import {
  createScheduleBuilderProxy,
  type ScheduleBuilderConfig,
} from '../schedule-builder'

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Schedule Builder Integration ($.every)', () => {
  let mockState: ReturnType<typeof createMockDOState>
  let scheduleBuilder: ReturnType<typeof createScheduleBuilderProxy>
  let registeredSchedules: Array<{ cron: string; name: string; handler: ScheduleHandler }>

  beforeEach(() => {
    mockState = createMockDOState()
    registeredSchedules = []

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-08T12:00:00.000Z'))

    // Create schedule builder with mock registration callback
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
  // 1. FLUENT API - DAY.TIME SYNTAX
  // ==========================================================================

  describe('Fluent API: $.every.Day.atTime(handler)', () => {
    it('$.every.Monday.at9am registers schedule with correct cron', () => {
      const handler = vi.fn()
      scheduleBuilder.Monday.at9am(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 9 * * 1') // 9:00 AM on Monday
    })

    it('$.every.Friday.at5pm registers schedule with correct cron', () => {
      const handler = vi.fn()
      scheduleBuilder.Friday.at5pm(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 17 * * 5') // 5:00 PM on Friday
    })

    it('$.every.Sunday.at12pm registers schedule with correct cron', () => {
      const handler = vi.fn()
      scheduleBuilder.Sunday.at12pm(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 12 * * 0') // 12:00 PM on Sunday
    })

    it('$.every.day.at6am registers daily schedule', () => {
      const handler = vi.fn()
      scheduleBuilder.day.at6am(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 6 * * *') // 6:00 AM every day
    })

    it('$.every.weekday.at9am registers weekday schedule', () => {
      const handler = vi.fn()
      scheduleBuilder.weekday.at9am(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 9 * * 1-5') // 9:00 AM Mon-Fri
    })

    it('$.every.weekend.atnoon registers weekend schedule', () => {
      const handler = vi.fn()
      scheduleBuilder.weekend.atnoon(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 12 * * 0,6') // Noon on Sat, Sun
    })
  })

  // ==========================================================================
  // 2. FLUENT API - INTERVAL SHORTCUTS
  // ==========================================================================

  describe('Fluent API: $.every.interval(handler)', () => {
    it('$.every.hour registers hourly schedule', () => {
      const handler = vi.fn()
      scheduleBuilder.hour(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 * * * *') // Every hour on the hour
    })

    it('$.every.minute registers every-minute schedule', () => {
      const handler = vi.fn()
      scheduleBuilder.minute(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('* * * * *') // Every minute
    })
  })

  // ==========================================================================
  // 3. FLUENT API - DAY ONLY (no time)
  // ==========================================================================

  describe('Fluent API: $.every.Day(handler) - Day without time', () => {
    it('$.every.Monday(handler) registers schedule for midnight Monday', () => {
      const handler = vi.fn()
      scheduleBuilder.Monday(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 0 * * 1') // Midnight on Monday
    })

    it('$.every.day(handler) registers daily at midnight', () => {
      const handler = vi.fn()
      scheduleBuilder.day(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 0 * * *') // Midnight every day
    })
  })

  // ==========================================================================
  // 4. NATURAL LANGUAGE - $.every(schedule, handler)
  // ==========================================================================

  describe("Natural Language: $.every('schedule', handler)", () => {
    it("$.every('every 5 minutes', handler) parses correctly", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every 5 minutes', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('*/5 * * * *')
    })

    it("$.every('every 15 minutes', handler) parses correctly", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every 15 minutes', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('*/15 * * * *')
    })

    it("$.every('every hour', handler) parses correctly", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('every hour', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 * * * *')
    })

    it("$.every('daily at 9am', handler) parses correctly", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('daily at 9am', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 9 * * *')
    })

    it("$.every('Monday at 9am', handler) parses correctly", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('Monday at 9am', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 9 * * 1')
    })

    it("$.every('weekdays at 8:30am', handler) parses correctly", () => {
      const handler = vi.fn()
      ;(scheduleBuilder as Function)('weekdays at 8:30am', handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('30 8 * * 1-5')
    })
  })

  // ==========================================================================
  // 5. SCHEDULE NAME GENERATION
  // ==========================================================================

  describe('Schedule Name Generation', () => {
    it('generates unique schedule names for fluent API', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      scheduleBuilder.Monday.at9am(handler1)
      scheduleBuilder.Friday.at5pm(handler2)

      expect(registeredSchedules[0].name).toBeDefined()
      expect(registeredSchedules[1].name).toBeDefined()
      expect(registeredSchedules[0].name).not.toBe(registeredSchedules[1].name)
    })

    it('generates descriptive schedule names', () => {
      const handler = vi.fn()
      scheduleBuilder.Monday.at9am(handler)

      // Name should be descriptive of the schedule
      expect(registeredSchedules[0].name).toMatch(/monday|9am|schedule/i)
    })
  })

  // ==========================================================================
  // 6. DO ALARM INTEGRATION
  // ==========================================================================

  describe('DO Alarm Integration', () => {
    it('sets DO alarm when schedule is registered', async () => {
      const handler = vi.fn()
      scheduleBuilder.Monday.at9am(handler)

      // Wait for async registration - use vi.runAllTimersAsync for fake timers
      await vi.runAllTimersAsync()

      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })

    it('alarm is set to next occurrence of schedule', async () => {
      const handler = vi.fn()
      // Current time: Thursday Jan 8, 2026 12:00 UTC
      scheduleBuilder.Monday.at9am(handler)

      await vi.runAllTimersAsync()

      // Next Monday at 9am is Jan 12, 2026
      const expectedTime = new Date('2026-01-12T09:00:00.000Z').getTime()
      expect(mockState.alarms.time).toBe(expectedTime)
    })
  })

  // ==========================================================================
  // 7. HANDLER STORAGE AND RETRIEVAL
  // ==========================================================================

  describe('Handler Storage', () => {
    it('stores handler for later execution', () => {
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

  // ==========================================================================
  // 8. ALL TIME SLOTS
  // ==========================================================================

  describe('All Time Slots', () => {
    const timeSlots = [
      { name: 'at6am', cron: '0 6' },
      { name: 'at7am', cron: '0 7' },
      { name: 'at8am', cron: '0 8' },
      { name: 'at9am', cron: '0 9' },
      { name: 'at10am', cron: '0 10' },
      { name: 'at11am', cron: '0 11' },
      { name: 'at12pm', cron: '0 12' },
      { name: 'at1pm', cron: '0 13' },
      { name: 'at2pm', cron: '0 14' },
      { name: 'at3pm', cron: '0 15' },
      { name: 'at4pm', cron: '0 16' },
      { name: 'at5pm', cron: '0 17' },
      { name: 'at6pm', cron: '0 18' },
      { name: 'atnoon', cron: '0 12' },
      { name: 'atmidnight', cron: '0 0' },
    ]

    timeSlots.forEach(({ name, cron }) => {
      it(`$.every.Monday.${name} uses cron: ${cron} * * 1`, () => {
        const handler = vi.fn()
        ;(scheduleBuilder.Monday as Record<string, Function>)[name](handler)

        expect(registeredSchedules).toHaveLength(1)
        expect(registeredSchedules[0].cron).toBe(`${cron} * * 1`)
      })
    })
  })

  // ==========================================================================
  // 9. ALL DAYS
  // ==========================================================================

  describe('All Days', () => {
    const days = [
      { name: 'Sunday', dayNum: '0' },
      { name: 'Monday', dayNum: '1' },
      { name: 'Tuesday', dayNum: '2' },
      { name: 'Wednesday', dayNum: '3' },
      { name: 'Thursday', dayNum: '4' },
      { name: 'Friday', dayNum: '5' },
      { name: 'Saturday', dayNum: '6' },
    ]

    days.forEach(({ name, dayNum }) => {
      it(`$.every.${name}.at9am uses cron: 0 9 * * ${dayNum}`, () => {
        const handler = vi.fn()
        ;(scheduleBuilder as Record<string, { at9am: Function }>)[name].at9am(handler)

        expect(registeredSchedules).toHaveLength(1)
        expect(registeredSchedules[0].cron).toBe(`0 9 * * ${dayNum}`)
      })
    })
  })

  // ==========================================================================
  // 10. DYNAMIC .at() METHOD (REFACTOR PHASE)
  // ==========================================================================

  describe("Dynamic .at('time') method", () => {
    it("$.every.Monday.at('9am') parses correctly", () => {
      const handler = vi.fn()
      scheduleBuilder.Monday.at('9am')(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 9 * * 1')
    })

    it("$.every.Monday.at('9:30am') parses correctly", () => {
      const handler = vi.fn()
      scheduleBuilder.Monday.at('9:30am')(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('30 9 * * 1')
    })

    it("$.every.Monday.at('noon') parses correctly", () => {
      const handler = vi.fn()
      scheduleBuilder.Monday.at('noon')(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 12 * * 1')
    })

    it("$.every.Monday.at('midnight') parses correctly", () => {
      const handler = vi.fn()
      scheduleBuilder.Monday.at('midnight')(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 0 * * 1')
    })

    it("$.every.day.at('6pm') parses correctly", () => {
      const handler = vi.fn()
      scheduleBuilder.day.at('6pm')(handler)

      expect(registeredSchedules).toHaveLength(1)
      expect(registeredSchedules[0].cron).toBe('0 18 * * *')
    })
  })

  // ==========================================================================
  // 11. ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('throws on invalid natural language schedule', () => {
      const handler = vi.fn()
      expect(() => (scheduleBuilder as Function)('invalid schedule', handler)).toThrow()
    })

    it("throws on invalid time in .at('time')", () => {
      const handler = vi.fn()
      expect(() => scheduleBuilder.Monday.at('25:00')(handler)).toThrow()
    })

    it('does not throw on empty handler', () => {
      // Should register even with empty handler
      expect(() => scheduleBuilder.Monday.at9am(async () => {})).not.toThrow()
    })
  })

  // ==========================================================================
  // 12. TYPE SAFETY
  // ==========================================================================

  describe('Type Safety', () => {
    it('handler receives no arguments', () => {
      const handler: ScheduleHandler = async () => {
        // No arguments expected
      }
      expect(() => scheduleBuilder.Monday.at9am(handler)).not.toThrow()
    })

    it('handler can be async', async () => {
      const handler = vi.fn().mockResolvedValue(undefined)
      scheduleBuilder.Monday.at9am(handler)

      // Handler should be stored correctly
      expect(registeredSchedules[0].handler).toBe(handler)
    })
  })
})
