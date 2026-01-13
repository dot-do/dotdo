/**
 * Schedule Builder Tests
 *
 * Comprehensive tests for the schedule-builder fluent DSL
 *
 * Tests cover:
 * 1. Fluent DSL ($.every.Monday.at9am)
 * 2. CRON expression generation
 * 3. Schedule validation
 * 4. Time parsing (12h/24h formats)
 * 5. Interval scheduling
 * 6. DSL combinations
 * 7. Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createScheduleBuilderProxy,
  parseNaturalSchedule,
  parseNaturalScheduleRegex,
  isValidCron,
  clearCronCache,
  type ScheduleBuilderConfig,
} from './schedule-builder'
import type { ScheduleHandler } from '../types/WorkflowContext'

// ============================================================================
// TEST UTILITIES
// ============================================================================

function createMockState() {
  const storage = new Map<string, unknown>()
  const alarms: { time: number | null } = { time: null }

  return {
    id: { toString: () => 'test-schedule-builder-do-id' },
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
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { alarms: { time: number | null }; _storage: Map<string, unknown> }
}

// ============================================================================
// CRON VALIDATION TESTS
// ============================================================================

describe('isValidCron', () => {
  describe('valid cron expressions', () => {
    it('accepts standard 5-field cron', () => {
      expect(isValidCron('* * * * *')).toBe(true)
      expect(isValidCron('0 9 * * 1')).toBe(true)
      expect(isValidCron('30 17 * * 5')).toBe(true)
    })

    it('accepts step values', () => {
      expect(isValidCron('*/5 * * * *')).toBe(true)
      expect(isValidCron('0 */2 * * *')).toBe(true)
      expect(isValidCron('*/15 */6 * * *')).toBe(true)
    })

    it('accepts ranges', () => {
      expect(isValidCron('0 9-17 * * *')).toBe(true)
      expect(isValidCron('0 0 * * 1-5')).toBe(true)
    })

    it('accepts lists', () => {
      expect(isValidCron('0 0 * * 0,6')).toBe(true)
      expect(isValidCron('0,30 * * * *')).toBe(true)
    })
  })

  describe('invalid cron expressions', () => {
    it('rejects non-5-field expressions', () => {
      expect(isValidCron('* * * *')).toBe(false)
      expect(isValidCron('* * * * * *')).toBe(false)
      expect(isValidCron('')).toBe(false)
    })

    it('rejects invalid syntax', () => {
      expect(isValidCron('invalid cron')).toBe(false)
      expect(isValidCron('a b c d e')).toBe(false)
    })
  })
})

// ============================================================================
// TIME PARSING TESTS (via parseNaturalScheduleRegex)
// ============================================================================

describe('Time Parsing', () => {
  beforeEach(() => {
    clearCronCache()
  })

  describe('12-hour format with AM/PM', () => {
    it('parses simple AM times', () => {
      expect(parseNaturalScheduleRegex('daily at 9am')).toBe('0 9 * * *')
      expect(parseNaturalScheduleRegex('daily at 6am')).toBe('0 6 * * *')
      expect(parseNaturalScheduleRegex('daily at 11am')).toBe('0 11 * * *')
    })

    it('parses simple PM times', () => {
      expect(parseNaturalScheduleRegex('daily at 3pm')).toBe('0 15 * * *')
      expect(parseNaturalScheduleRegex('daily at 6pm')).toBe('0 18 * * *')
      expect(parseNaturalScheduleRegex('daily at 11pm')).toBe('0 23 * * *')
    })

    it('parses 12am as midnight (hour 0)', () => {
      expect(parseNaturalScheduleRegex('daily at 12am')).toBe('0 0 * * *')
    })

    it('parses 12pm as noon (hour 12)', () => {
      expect(parseNaturalScheduleRegex('daily at 12pm')).toBe('0 12 * * *')
    })

    it('parses times with minutes', () => {
      expect(parseNaturalScheduleRegex('daily at 9:30am')).toBe('30 9 * * *')
      expect(parseNaturalScheduleRegex('daily at 2:45pm')).toBe('45 14 * * *')
      expect(parseNaturalScheduleRegex('daily at 12:15pm')).toBe('15 12 * * *')
    })
  })

  describe('special time keywords', () => {
    it('parses noon', () => {
      expect(parseNaturalScheduleRegex('daily at noon')).toBe('0 12 * * *')
    })

    it('parses midnight', () => {
      expect(parseNaturalScheduleRegex('daily at midnight')).toBe('0 0 * * *')
    })
  })

  describe('24-hour format', () => {
    it('parses 24-hour times', () => {
      expect(parseNaturalScheduleRegex('daily at 14:30')).toBe('30 14 * * *')
      expect(parseNaturalScheduleRegex('daily at 0:00')).toBe('0 0 * * *')
      expect(parseNaturalScheduleRegex('daily at 23:59')).toBe('59 23 * * *')
    })
  })

  describe('edge cases and error handling', () => {
    it('throws for invalid time formats', () => {
      expect(() => parseNaturalScheduleRegex('daily at invalid')).toThrow('Invalid time format')
    })

    it('throws for out-of-range hours in 12h format', () => {
      expect(() => parseNaturalScheduleRegex('daily at 13am')).toThrow('Invalid hour')
      expect(() => parseNaturalScheduleRegex('daily at 0am')).toThrow('Invalid hour')
    })

    it('throws for out-of-range hours in 24h format', () => {
      expect(() => parseNaturalScheduleRegex('daily at 25:00')).toThrow('Invalid hour')
    })

    it('throws for invalid minutes', () => {
      expect(() => parseNaturalScheduleRegex('daily at 9:60am')).toThrow('Invalid minute')
    })
  })
})

// ============================================================================
// NATURAL LANGUAGE SCHEDULE PARSING
// ============================================================================

describe('parseNaturalSchedule', () => {
  beforeEach(() => {
    clearCronCache()
  })

  describe('minute intervals', () => {
    it('parses every minute', () => {
      expect(parseNaturalSchedule('every minute')).toBe('* * * * *')
    })

    it('parses every N minutes', () => {
      expect(parseNaturalSchedule('every 5 minutes')).toBe('*/5 * * * *')
      expect(parseNaturalSchedule('every 10 minutes')).toBe('*/10 * * * *')
      expect(parseNaturalSchedule('every 15 minutes')).toBe('*/15 * * * *')
      expect(parseNaturalSchedule('every 30 minutes')).toBe('*/30 * * * *')
    })

    it('validates minute interval range', () => {
      expect(() => parseNaturalScheduleRegex('every 0 minutes')).toThrow('Invalid minute interval')
      expect(() => parseNaturalScheduleRegex('every 60 minutes')).toThrow('Invalid minute interval')
    })
  })

  describe('hour intervals', () => {
    it('parses every hour', () => {
      expect(parseNaturalSchedule('every hour')).toBe('0 * * * *')
      expect(parseNaturalSchedule('hourly')).toBe('0 * * * *')
    })

    it('parses every N hours', () => {
      expect(parseNaturalSchedule('every 2 hours')).toBe('0 */2 * * *')
      expect(parseNaturalSchedule('every 3 hours')).toBe('0 */3 * * *')
      expect(parseNaturalSchedule('every 4 hours')).toBe('0 */4 * * *')
      expect(parseNaturalSchedule('every 6 hours')).toBe('0 */6 * * *')
      expect(parseNaturalSchedule('every 8 hours')).toBe('0 */8 * * *')
      expect(parseNaturalSchedule('every 12 hours')).toBe('0 */12 * * *')
    })

    it('validates hour interval range', () => {
      expect(() => parseNaturalScheduleRegex('every 0 hours')).toThrow('Invalid hour interval')
      expect(() => parseNaturalScheduleRegex('every 24 hours')).toThrow('Invalid hour interval')
    })
  })

  describe('daily patterns', () => {
    it('parses daily at time', () => {
      expect(parseNaturalSchedule('daily at 6am')).toBe('0 6 * * *')
      expect(parseNaturalSchedule('daily at 9am')).toBe('0 9 * * *')
      expect(parseNaturalSchedule('daily at noon')).toBe('0 12 * * *')
      expect(parseNaturalSchedule('daily at midnight')).toBe('0 0 * * *')
    })

    it('parses every day at time', () => {
      expect(parseNaturalSchedule('every day at 6am')).toBe('0 6 * * *')
      expect(parseNaturalSchedule('every day at 9am')).toBe('0 9 * * *')
    })

    it('parses everyday at time', () => {
      expect(parseNaturalSchedule('everyday at 6am')).toBe('0 6 * * *')
      expect(parseNaturalSchedule('everyday at noon')).toBe('0 12 * * *')
    })
  })

  describe('specific day patterns', () => {
    it('parses day at time', () => {
      expect(parseNaturalSchedule('monday at 9am')).toBe('0 9 * * 1')
      expect(parseNaturalSchedule('tuesday at 3pm')).toBe('0 15 * * 2')
      expect(parseNaturalSchedule('wednesday at 10am')).toBe('0 10 * * 3')
      expect(parseNaturalSchedule('thursday at noon')).toBe('0 12 * * 4')
      expect(parseNaturalSchedule('friday at 5:30pm')).toBe('30 17 * * 5')
      expect(parseNaturalSchedule('saturday at midnight')).toBe('0 0 * * 6')
      expect(parseNaturalSchedule('sunday at noon')).toBe('0 12 * * 0')
    })

    it('parses weekly on day', () => {
      expect(parseNaturalSchedule('weekly on monday')).toBe('0 0 * * 1')
      expect(parseNaturalSchedule('weekly on friday')).toBe('0 0 * * 5')
    })

    it('parses every week on day at time', () => {
      expect(parseNaturalSchedule('every week on friday at 5pm')).toBe('0 17 * * 5')
    })
  })

  describe('weekday/weekend patterns', () => {
    it('parses weekdays at time', () => {
      expect(parseNaturalSchedule('weekdays at 9am')).toBe('0 9 * * 1-5')
      expect(parseNaturalSchedule('every weekday at 8:30am')).toBe('30 8 * * 1-5')
    })

    it('parses weekends at time', () => {
      expect(parseNaturalSchedule('weekends at 10am')).toBe('0 10 * * 0,6')
    })
  })

  describe('monthly patterns', () => {
    it('parses first day of month', () => {
      expect(parseNaturalSchedule('first day of month')).toBe('0 0 1 * *')
      expect(parseNaturalSchedule('first of month')).toBe('0 0 1 * *')
      expect(parseNaturalSchedule('1st of month')).toBe('0 0 1 * *')
    })

    it('parses first day of month at time', () => {
      expect(parseNaturalSchedule('first of month at 9am')).toBe('0 9 1 * *')
      expect(parseNaturalSchedule('1st of month at 6am')).toBe('0 6 1 * *')
    })

    it('parses Nth of month', () => {
      expect(parseNaturalSchedule('15th of month')).toBe('0 0 15 * *')
    })

    it('throws for last day of month (unsupported)', () => {
      expect(() => parseNaturalSchedule('last day of month')).toThrow('last day of month is not supported')
    })

    it('validates day of month range', () => {
      expect(() => parseNaturalScheduleRegex('0th of month')).toThrow()
      expect(() => parseNaturalScheduleRegex('32nd of month')).toThrow('Invalid day of month')
    })
  })

  describe('unrecognized patterns', () => {
    it('throws for unrecognized patterns', () => {
      expect(() => parseNaturalScheduleRegex('gibberish')).toThrow('Unrecognized schedule format')
      expect(() => parseNaturalScheduleRegex('run whenever')).toThrow('Unrecognized schedule format')
    })
  })
})

// ============================================================================
// FLUENT DSL TESTS
// ============================================================================

describe('Fluent DSL ($.every)', () => {
  let mockState: ReturnType<typeof createMockState>
  let scheduleBuilder: ReturnType<typeof createScheduleBuilderProxy>
  let registeredSchedules: Array<{ cron: string; name: string; handler: ScheduleHandler }>

  beforeEach(() => {
    mockState = createMockState()
    registeredSchedules = []

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'))

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
    clearCronCache()
  })

  describe('Day.atTime pattern', () => {
    describe('Monday schedules', () => {
      it('$.every.Monday.at9am generates correct cron', () => {
        const handler = vi.fn()
        scheduleBuilder.Monday.at9am(handler)

        expect(registeredSchedules).toHaveLength(1)
        expect(registeredSchedules[0].cron).toBe('0 9 * * 1')
      })

      it('$.every.Monday.at6am generates correct cron', () => {
        const handler = vi.fn()
        scheduleBuilder.Monday.at6am(handler)

        expect(registeredSchedules[0].cron).toBe('0 6 * * 1')
      })

      it('$.every.Monday.atnoon generates correct cron', () => {
        const handler = vi.fn()
        scheduleBuilder.Monday.atnoon(handler)

        expect(registeredSchedules[0].cron).toBe('0 12 * * 1')
      })

      it('$.every.Monday.atmidnight generates correct cron', () => {
        const handler = vi.fn()
        scheduleBuilder.Monday.atmidnight(handler)

        expect(registeredSchedules[0].cron).toBe('0 0 * * 1')
      })
    })

    describe('all days of week', () => {
      it('$.every.Tuesday.at9am generates correct cron', () => {
        scheduleBuilder.Tuesday.at9am(vi.fn())
        expect(registeredSchedules[0].cron).toBe('0 9 * * 2')
      })

      it('$.every.Wednesday.at9am generates correct cron', () => {
        scheduleBuilder.Wednesday.at9am(vi.fn())
        expect(registeredSchedules[0].cron).toBe('0 9 * * 3')
      })

      it('$.every.Thursday.at9am generates correct cron', () => {
        scheduleBuilder.Thursday.at9am(vi.fn())
        expect(registeredSchedules[0].cron).toBe('0 9 * * 4')
      })

      it('$.every.Friday.at9am generates correct cron', () => {
        scheduleBuilder.Friday.at9am(vi.fn())
        expect(registeredSchedules[0].cron).toBe('0 9 * * 5')
      })

      it('$.every.Saturday.at9am generates correct cron', () => {
        scheduleBuilder.Saturday.at9am(vi.fn())
        expect(registeredSchedules[0].cron).toBe('0 9 * * 6')
      })

      it('$.every.Sunday.at9am generates correct cron', () => {
        scheduleBuilder.Sunday.at9am(vi.fn())
        expect(registeredSchedules[0].cron).toBe('0 9 * * 0')
      })
    })

    describe('all preset times', () => {
      it('$.every.Monday.at6am through at6pm', () => {
        const times = [
          { method: 'at6am', hour: 6 },
          { method: 'at7am', hour: 7 },
          { method: 'at8am', hour: 8 },
          { method: 'at9am', hour: 9 },
          { method: 'at10am', hour: 10 },
          { method: 'at11am', hour: 11 },
          { method: 'at12pm', hour: 12 },
          { method: 'at1pm', hour: 13 },
          { method: 'at2pm', hour: 14 },
          { method: 'at3pm', hour: 15 },
          { method: 'at4pm', hour: 16 },
          { method: 'at5pm', hour: 17 },
          { method: 'at6pm', hour: 18 },
        ] as const

        for (const { method, hour } of times) {
          registeredSchedules = []
          ;(scheduleBuilder.Monday as any)[method](vi.fn())
          expect(registeredSchedules[0].cron).toBe(`0 ${hour} * * 1`)
        }
      })
    })
  })

  describe('Day.at(time) dynamic pattern', () => {
    it("$.every.Monday.at('9am') generates correct cron", () => {
      scheduleBuilder.Monday.at('9am')(vi.fn())
      expect(registeredSchedules[0].cron).toBe('0 9 * * 1')
    })

    it("$.every.Monday.at('9:30am') generates correct cron", () => {
      scheduleBuilder.Monday.at('9:30am')(vi.fn())
      expect(registeredSchedules[0].cron).toBe('30 9 * * 1')
    })

    it("$.every.Monday.at('2:45pm') generates correct cron", () => {
      scheduleBuilder.Monday.at('2:45pm')(vi.fn())
      expect(registeredSchedules[0].cron).toBe('45 14 * * 1')
    })

    it("$.every.Monday.at('noon') generates correct cron", () => {
      scheduleBuilder.Monday.at('noon')(vi.fn())
      expect(registeredSchedules[0].cron).toBe('0 12 * * 1')
    })

    it("$.every.Monday.at('midnight') generates correct cron", () => {
      scheduleBuilder.Monday.at('midnight')(vi.fn())
      expect(registeredSchedules[0].cron).toBe('0 0 * * 1')
    })

    it("$.every.Friday.at('5pm') generates correct cron", () => {
      scheduleBuilder.Friday.at('5pm')(vi.fn())
      expect(registeredSchedules[0].cron).toBe('0 17 * * 5')
    })

    it('$.every.day.at(time) generates daily schedule', () => {
      scheduleBuilder.day.at('6am')(vi.fn())
      expect(registeredSchedules[0].cron).toBe('0 6 * * *')
    })
  })

  describe('special day groups', () => {
    it('$.every.day generates daily cron', () => {
      scheduleBuilder.day.at9am(vi.fn())
      expect(registeredSchedules[0].cron).toBe('0 9 * * *')
    })

    it('$.every.weekday generates weekday cron', () => {
      scheduleBuilder.weekday.at9am(vi.fn())
      expect(registeredSchedules[0].cron).toBe('0 9 * * 1-5')
    })

    it('$.every.weekend generates weekend cron', () => {
      scheduleBuilder.weekend.at10am(vi.fn())
      expect(registeredSchedules[0].cron).toBe('0 10 * * 0,6')
    })
  })

  describe('interval shortcuts', () => {
    it('$.every.hour generates hourly cron', () => {
      scheduleBuilder.hour(vi.fn())
      expect(registeredSchedules[0].cron).toBe('0 * * * *')
    })

    it('$.every.minute generates per-minute cron', () => {
      scheduleBuilder.minute(vi.fn())
      expect(registeredSchedules[0].cron).toBe('* * * * *')
    })
  })

  describe('natural language via function call', () => {
    it("$.every('every 5 minutes', handler) registers interval", () => {
      ;(scheduleBuilder as Function)('every 5 minutes', vi.fn())
      expect(registeredSchedules[0].cron).toBe('*/5 * * * *')
    })

    it("$.every('Monday at 9am', handler) registers weekly", () => {
      ;(scheduleBuilder as Function)('Monday at 9am', vi.fn())
      expect(registeredSchedules[0].cron).toBe('0 9 * * 1')
    })

    it("$.every('daily at 6pm', handler) registers daily", () => {
      ;(scheduleBuilder as Function)('daily at 6pm', vi.fn())
      expect(registeredSchedules[0].cron).toBe('0 18 * * *')
    })
  })
})

// ============================================================================
// HANDLER REGISTRATION TESTS
// ============================================================================

describe('Handler Registration', () => {
  let mockState: ReturnType<typeof createMockState>
  let scheduleBuilder: ReturnType<typeof createScheduleBuilderProxy>
  let registeredSchedules: Array<{ cron: string; name: string; handler: ScheduleHandler }>

  beforeEach(() => {
    mockState = createMockState()
    registeredSchedules = []

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'))

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

  it('stores handler reference correctly', () => {
    const handler = vi.fn()
    scheduleBuilder.Monday.at9am(handler)

    expect(registeredSchedules[0].handler).toBe(handler)
  })

  it('generates unique names for each registration', () => {
    scheduleBuilder.Monday.at9am(vi.fn())
    scheduleBuilder.Monday.at9am(vi.fn())
    scheduleBuilder.Monday.at9am(vi.fn())

    const names = registeredSchedules.map((s) => s.name)
    const uniqueNames = new Set(names)
    expect(uniqueNames.size).toBe(3)
  })

  it('calls onScheduleRegistered callback', () => {
    const callback = vi.fn()
    const config: ScheduleBuilderConfig = {
      state: mockState,
      onScheduleRegistered: callback,
    }
    const builder = createScheduleBuilderProxy(config)

    const handler = vi.fn()
    builder.Monday.at9am(handler)

    expect(callback).toHaveBeenCalledWith('0 9 * * 1', expect.any(String), handler)
  })

  it('sets DO alarm when schedule is registered', async () => {
    scheduleBuilder.Monday.at9am(vi.fn())

    // Wait for async alarm setting
    await vi.runAllTimersAsync()

    expect(mockState.storage.setAlarm).toHaveBeenCalled()
  })
})

// ============================================================================
// DSL COMBINATIONS AND EDGE CASES
// ============================================================================

describe('DSL Combinations', () => {
  let mockState: ReturnType<typeof createMockState>
  let scheduleBuilder: ReturnType<typeof createScheduleBuilderProxy>
  let registeredSchedules: Array<{ cron: string; name: string; handler: ScheduleHandler }>

  beforeEach(() => {
    mockState = createMockState()
    registeredSchedules = []

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'))

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
    clearCronCache()
  })

  it('registers multiple different schedules', () => {
    const morningHandler = vi.fn()
    const eveningHandler = vi.fn()
    const hourlyHandler = vi.fn()

    scheduleBuilder.Monday.at9am(morningHandler)
    scheduleBuilder.Friday.at5pm(eveningHandler)
    scheduleBuilder.hour(hourlyHandler)

    expect(registeredSchedules).toHaveLength(3)
    expect(registeredSchedules[0].cron).toBe('0 9 * * 1')
    expect(registeredSchedules[1].cron).toBe('0 17 * * 5')
    expect(registeredSchedules[2].cron).toBe('0 * * * *')
  })

  it('mixes fluent DSL and natural language', () => {
    scheduleBuilder.Monday.at9am(vi.fn())
    ;(scheduleBuilder as Function)('every 15 minutes', vi.fn())
    scheduleBuilder.day.at('6pm')(vi.fn())

    expect(registeredSchedules).toHaveLength(3)
    expect(registeredSchedules[0].cron).toBe('0 9 * * 1')
    expect(registeredSchedules[1].cron).toBe('*/15 * * * *')
    expect(registeredSchedules[2].cron).toBe('0 18 * * *')
  })

  it('handles same handler registered for multiple schedules', () => {
    const sharedHandler = vi.fn()

    scheduleBuilder.Monday.at9am(sharedHandler)
    scheduleBuilder.Wednesday.at9am(sharedHandler)
    scheduleBuilder.Friday.at9am(sharedHandler)

    expect(registeredSchedules).toHaveLength(3)
    expect(registeredSchedules.every((s) => s.handler === sharedHandler)).toBe(true)
  })
})

// ============================================================================
// CRON CACHE TESTS
// ============================================================================

describe('Cron Cache', () => {
  beforeEach(() => {
    clearCronCache()
  })

  it('caches parsed schedules', () => {
    // First call parses
    const result1 = parseNaturalSchedule('every 5 minutes')
    // Second call should use cache
    const result2 = parseNaturalSchedule('every 5 minutes')

    expect(result1).toBe(result2)
    expect(result1).toBe('*/5 * * * *')
  })

  it('clearCronCache resets the cache but keeps common patterns', () => {
    clearCronCache()

    // Common patterns should still work
    expect(parseNaturalSchedule('every minute')).toBe('* * * * *')
    expect(parseNaturalSchedule('every hour')).toBe('0 * * * *')
    expect(parseNaturalSchedule('hourly')).toBe('0 * * * *')
  })

  it('case insensitive matching', () => {
    expect(parseNaturalSchedule('Every Minute')).toBe('* * * * *')
    expect(parseNaturalSchedule('EVERY HOUR')).toBe('0 * * * *')
    expect(parseNaturalSchedule('Daily At 9Am')).toBe('0 9 * * *')
  })
})

// ============================================================================
// ALARM CALCULATION TESTS
// ============================================================================

describe('Alarm Calculation', () => {
  let mockState: ReturnType<typeof createMockState>
  let scheduleBuilder: ReturnType<typeof createScheduleBuilderProxy>

  beforeEach(() => {
    mockState = createMockState()

    vi.useFakeTimers()
    // Tuesday, January 13, 2026 at noon UTC
    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'))

    const config: ScheduleBuilderConfig = {
      state: mockState,
      onScheduleRegistered: vi.fn(),
    }
    scheduleBuilder = createScheduleBuilderProxy(config)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets alarm for next occurrence of daily schedule', async () => {
    scheduleBuilder.day.at('6am')(vi.fn())
    await vi.runAllTimersAsync()

    // 6am has passed today, so should be tomorrow 6am UTC
    const expectedTime = new Date('2026-01-14T06:00:00.000Z').getTime()
    expect(mockState.alarms.time).toBe(expectedTime)
  })

  it('sets alarm for later today if time has not passed', async () => {
    scheduleBuilder.day.at('3pm')(vi.fn())
    await vi.runAllTimersAsync()

    // 3pm today is still in the future
    const expectedTime = new Date('2026-01-13T15:00:00.000Z').getTime()
    expect(mockState.alarms.time).toBe(expectedTime)
  })

  it('sets alarm for specific day of week', async () => {
    // Current: Tuesday Jan 13. Next Monday is Jan 19
    scheduleBuilder.Monday.at9am(vi.fn())
    await vi.runAllTimersAsync()

    const expectedTime = new Date('2026-01-19T09:00:00.000Z').getTime()
    expect(mockState.alarms.time).toBe(expectedTime)
  })

  it('sets alarm for hourly schedule', async () => {
    scheduleBuilder.hour(vi.fn())
    await vi.runAllTimersAsync()

    // Next hour is 1pm (13:00)
    const expectedTime = new Date('2026-01-13T13:00:00.000Z').getTime()
    expect(mockState.alarms.time).toBe(expectedTime)
  })

  it('sets alarm for minute interval', async () => {
    ;(scheduleBuilder as Function)('every 5 minutes', vi.fn())
    await vi.runAllTimersAsync()

    // At 12:00, next 5-minute mark would be 12:05 (since we're exactly at a 5min mark, next is +5)
    // Actually the calculation starts from next minute, so it finds 12:05
    const alarmTime = mockState.alarms.time!
    const alarmDate = new Date(alarmTime)
    expect(alarmDate.getUTCMinutes() % 5).toBe(0)
    expect(alarmDate.getTime()).toBeGreaterThan(new Date('2026-01-13T12:00:00.000Z').getTime())
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  let mockState: ReturnType<typeof createMockState>
  let registeredSchedules: Array<{ cron: string; name: string; handler: ScheduleHandler }>

  beforeEach(() => {
    mockState = createMockState()
    registeredSchedules = []

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    clearCronCache()
  })

  it('complete workflow: register, store, and verify alarm', async () => {
    const handler = vi.fn()

    const config: ScheduleBuilderConfig = {
      state: mockState,
      onScheduleRegistered: (cron, name, h) => {
        registeredSchedules.push({ cron, name, handler: h })
      },
    }
    const scheduleBuilder = createScheduleBuilderProxy(config)

    // Register a schedule
    scheduleBuilder.Monday.at9am(handler)

    // Verify registration
    expect(registeredSchedules).toHaveLength(1)
    expect(registeredSchedules[0].cron).toBe('0 9 * * 1')
    expect(registeredSchedules[0].handler).toBe(handler)

    // Verify alarm was set
    await vi.runAllTimersAsync()
    expect(mockState.storage.setAlarm).toHaveBeenCalled()
  })

  it('supports typical business scheduling patterns', () => {
    const config: ScheduleBuilderConfig = {
      state: mockState,
      onScheduleRegistered: (cron, name, h) => {
        registeredSchedules.push({ cron, name, handler: h })
      },
    }
    const scheduleBuilder = createScheduleBuilderProxy(config)

    // Morning standup
    scheduleBuilder.weekday.at9am(vi.fn())

    // End of day report
    scheduleBuilder.day.at5pm(vi.fn())

    // Weekly review
    scheduleBuilder.Friday.at('4pm')(vi.fn())

    // Monitoring
    ;(scheduleBuilder as Function)('every 5 minutes', vi.fn())

    expect(registeredSchedules).toHaveLength(4)
    expect(registeredSchedules.map((s) => s.cron)).toEqual([
      '0 9 * * 1-5', // weekdays at 9am
      '0 17 * * *', // daily at 5pm
      '0 16 * * 5', // Friday at 4pm
      '*/5 * * * *', // every 5 minutes
    ])
  })
})
