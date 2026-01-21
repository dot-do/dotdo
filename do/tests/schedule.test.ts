/**
 * $.every Scheduling DSL Tests
 *
 * Tests for the scheduling DSL that provides a fluent API:
 * - $.every.Monday.at9am(handler)
 * - $.every.day.at('6pm')(handler)
 * - $.every.hour(handler)
 * - $.every(5).minutes(handler)
 * - $.every.week.on.Friday.at('3pm')(handler)
 *
 * Uses vitest-pool-workers with real miniflare instances.
 * NO MOCKS - follows the dotdo testing philosophy.
 *
 * @module do/tests/schedule.test
 */
import { describe, it, expect } from 'vitest'
import { env, runInDurableObject } from 'cloudflare:test'
import { DO } from '../DO'
import { getSchedules, type ScheduleRegistration } from '../workflow'

// ============================================================================
// TEST HELPER FUNCTIONS
// ============================================================================

/**
 * Generate unique test identifier to ensure test isolation
 */
function generateTestId(): string {
  return `schedule-dsl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a test DO stub with a unique name
 */
function getTestDO(name: string = generateTestId()) {
  const id = env.DO.idFromName(name)
  return env.DO.get(id)
}

// ============================================================================
// TESTS: $.every scheduling DSL
// ============================================================================

describe('$.every scheduling DSL', () => {
  describe('$.every.hour pattern', () => {
    it('should register handler for every.hour', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const handler = async () => {}
        $.every.hour(handler)

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '0 * * * *',
        natural: 'hour',
      })
    })

    it('should register handler for every.day', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.day(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '0 0 * * *',
        natural: 'day',
      })
    })

    it('should register handler for every.minute', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.minute(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '* * * * *',
        natural: 'minute',
      })
    })

    it('should register handler for every.week', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.week(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '0 0 * * 0',
        natural: 'week',
      })
    })
  })

  describe('$.every.Monday pattern', () => {
    it('should register handler for every.Monday', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.Monday(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '0 0 * * 1',
        natural: 'Monday',
      })
    })

    it('should register handler for every.Friday', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.Friday(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '0 0 * * 5',
        natural: 'Friday',
      })
    })

    it('should register handler for every.weekday', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.weekday(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '0 0 * * 1-5',
        natural: 'weekday',
      })
    })
  })

  describe('$.every.Monday.at9am pattern', () => {
    it('should register handler for every.Monday.at9am', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.Monday.at9am(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '0 9 * * 1',
        natural: 'Monday.at9am',
      })
    })

    it('should register handler for every.Friday.at5pm', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.Friday.at5pm(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '0 17 * * 5',
        natural: 'Friday.at5pm',
      })
    })

    it('should register handler for every.weekday.at8am', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.weekday.at8am(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '0 8 * * 1-5',
        natural: 'weekday.at8am',
      })
    })

    it('should register handler for every.day.at("6pm")', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.day.at('6pm')(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '0 18 * * *',
        natural: 'day.at(6pm)',
      })
    })

    it('should handle dynamic time with at("3:45pm")', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.Monday.at('3:45pm')(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '45 15 * * 1',
        natural: 'Monday.at(3:45pm)',
      })
    })
  })

  describe('$.every(5).minutes pattern', () => {
    it('should register handler for every(5).minutes', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every(5).minutes(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'minute',
        value: 5,
        natural: '5 minutes',
      })
    })

    it('should register handler for every(30).minutes', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every(30).minutes(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'minute',
        value: 30,
        natural: '30 minutes',
      })
    })

    it('should register handler for every(2).hours', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every(2).hours(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'hour',
        value: 2,
        natural: '2 hours',
      })
    })

    it('should register handler for every(10).seconds', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every(10).seconds(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'second',
        value: 10,
        natural: '10 seconds',
      })
    })
  })

  describe('$.every.week.on.Friday.at("3pm") pattern', () => {
    it('should register handler for every.week.on.Friday.at("3pm")', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.week.on.Friday.at('3pm')(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '0 15 * * 5',
        natural: 'week.on.Friday.at(3pm)',
      })
    })

    it('should register handler for every.week.on.Monday.at("9am")', async () => {
      const stub = getTestDO()

      const schedule = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.week.on.Monday.at('9am')(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(schedule).toEqual({
        type: 'cron',
        expression: '0 9 * * 1',
        natural: 'week.on.Monday.at(9am)',
      })
    })
  })

  describe('multiple handlers', () => {
    it('should support multiple schedule registrations', async () => {
      const stub = getTestDO()

      const scheduleCount = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        $.every.hour(async () => {})
        $.every.day(async () => {})
        $.every.Monday.at9am(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules.length
      })

      expect(scheduleCount).toBe(3)
    })

    it('should track each handler separately', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.hour(async () => {})
        $.every.day(async () => {})

        const schedules = getSchedules($._schedules)
        return {
          firstInterval: schedules[0]?.interval.natural,
          secondInterval: schedules[1]?.interval.natural,
          count: schedules.length,
        }
      })

      expect(result.count).toBe(2)
      expect(result.firstInterval).toBe('hour')
      expect(result.secondInterval).toBe('day')
    })
  })

  describe('chaining support', () => {
    it('should allow property chaining', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        return {
          mondayDefined: $.every.Monday !== undefined,
          mondayIsFunction: typeof $.every.Monday === 'function',
          at9amDefined: $.every.Monday.at9am !== undefined,
          at9amIsFunction: typeof $.every.Monday.at9am === 'function',
        }
      })

      expect(result.mondayDefined).toBe(true)
      expect(result.mondayIsFunction).toBe(true)
      expect(result.at9amDefined).toBe(true)
      expect(result.at9amIsFunction).toBe(true)
    })

    it('should allow on chaining for week patterns', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        return {
          onDefined: $.every.week.on !== undefined,
          fridayDefined: $.every.week.on.Friday !== undefined,
        }
      })

      expect(result.onDefined).toBe(true)
      expect(result.fridayDefined).toBe(true)
    })

    it('should allow numeric patterns', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        return {
          every5IsObject: typeof $.every(5) === 'object',
          minutesIsFunction: typeof $.every(5).minutes === 'function',
        }
      })

      expect(result.every5IsObject).toBe(true)
      expect(result.minutesIsFunction).toBe(true)
    })
  })

  describe('handler storage', () => {
    it('should store handler function reference', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const myHandler = async () => {}

        $.every.hour(myHandler)

        const schedules = getSchedules($._schedules)
        return {
          hasHandler: schedules[0]?.handler !== undefined,
          hasSource: schedules[0]?.source !== undefined,
        }
      })

      expect(result.hasHandler).toBe(true)
      expect(result.hasSource).toBe(true)
    })

    it('should store unique schedule IDs', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.hour(async () => {})
        $.every.day(async () => {})
        $.every.minute(async () => {})

        const scheduleIds = Array.from($._schedules.keys())
        return {
          ids: scheduleIds,
          uniqueCount: new Set(scheduleIds).size,
        }
      })

      expect(result.uniqueCount).toBe(3)
      expect(result.ids.length).toBe(3)
    })
  })
})
