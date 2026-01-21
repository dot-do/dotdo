/**
 * Tests for DO.alarm() implementation
 *
 * These tests verify alarm scheduling and execution using real miniflare instances.
 * NO MOCKS - all tests run against real Durable Object instances with real SQLite/storage.
 *
 * Note: Many alarm execution tests are skipped because the base DO class has an empty
 * alarm() stub. The actual alarm execution functionality is in alarm-scheduling.test.ts
 * which tests against a properly configured alarm handler.
 *
 * Tests cover:
 * 1. Schedule registration via $.every DSL
 * 2. Schedule tracking in context
 * 3. Basic alarm() method existence
 *
 * @module do/tests/alarm.test
 */
import { describe, it, expect } from 'vitest'
import { env, runInDurableObject } from 'cloudflare:test'
import { DO } from '../DO'
import { getSchedules } from '../workflow'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Generate unique test identifier to ensure test isolation
 */
function generateTestId(): string {
  return `alarm-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a test DO stub with a unique name
 */
function getTestDO(name: string = generateTestId()) {
  const id = env.DO.idFromName(name)
  return env.DO.get(id)
}

// ============================================================================
// TESTS: Alarm and Scheduling
// ============================================================================

describe('DO.alarm() implementation', () => {
  describe('schedule registration', () => {
    it('should track schedules in context via $.every.hour', async () => {
      const stub = getTestDO()

      const scheduleCount = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.hour(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules.length
      })

      expect(scheduleCount).toBe(1)
    })

    it('should track multiple schedules', async () => {
      const stub = getTestDO()

      const scheduleCount = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.hour(async () => {})
        $.every.minute(async () => {})
        $.every.day(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules.length
      })

      expect(scheduleCount).toBe(3)
    })

    it('should store schedule interval configuration', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every(5).minutes(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(interval?.type).toBe('minute')
      expect(interval?.value).toBe(5)
    })

    it('should store cron expression for day-based schedules', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.Monday.at9am(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(interval?.expression).toBe('0 9 * * 1')
    })
  })

  describe('alarm method', () => {
    it('should have alarm() method on DO instance', async () => {
      const stub = getTestDO()

      const hasAlarm = await runInDurableObject(stub, async (instance: DO) => {
        return typeof instance.alarm === 'function'
      })

      expect(hasAlarm).toBe(true)
    })

    it('should call alarm() without error when no schedules', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        try {
          await instance.alarm()
          return { threw: false }
        } catch (e) {
          return { threw: true, message: (e as Error).message }
        }
      })

      expect(result.threw).toBe(false)
    })

    it('should not set alarm when no schedules registered', async () => {
      const stub = getTestDO()

      const alarmTime = await runInDurableObject(stub, async (instance: DO) => {
        const state = (instance as any).state as DurableObjectState

        // No schedules registered
        await instance.alarm()

        // Should not have set an alarm
        return await state.storage.getAlarm()
      })

      expect(alarmTime).toBeNull()
    })
  })

  describe('schedule DSL variations', () => {
    it('should support $.every.minute syntax', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.minute(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      // $.every.minute uses cron expression for every minute
      expect(interval?.type).toBe('cron')
      expect(interval?.expression).toBe('* * * * *')
    })

    it('should support $.every.hour syntax', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.hour(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      // $.every.hour uses cron expression for every hour at minute 0
      expect(interval?.type).toBe('cron')
      expect(interval?.expression).toBe('0 * * * *')
    })

    it('should support $.every.day syntax', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.day(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(interval?.type).toBe('cron')
      expect(interval?.expression).toBe('0 0 * * *')
    })

    it('should support $.every.Monday syntax', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.Monday(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(interval?.expression).toBe('0 0 * * 1')
    })

    it('should support $.every.weekday.at8am syntax', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.weekday.at8am(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(interval?.expression).toBe('0 8 * * 1-5')
    })

    it('should support $.every(n).minutes syntax', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every(30).minutes(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(interval?.type).toBe('minute')
      expect(interval?.value).toBe(30)
    })

    it('should support $.every(n).hours syntax', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every(2).hours(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(interval?.type).toBe('hour')
      expect(interval?.value).toBe(2)
    })
  })

  describe('schedule handler storage', () => {
    it('should store handler function in schedule registration', async () => {
      const stub = getTestDO()

      const hasHandler = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.hour(async () => {
          return 'test'
        })

        const schedules = getSchedules($._schedules)
        return typeof schedules[0]?.handler === 'function'
      })

      expect(hasHandler).toBe(true)
    })

    it('should maintain separate handlers for each schedule', async () => {
      const stub = getTestDO()

      const results = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const markers: string[] = []

        $.every.hour(async () => markers.push('hourly'))
        $.every.day(async () => markers.push('daily'))

        const schedules = getSchedules($._schedules)

        // Execute handlers manually to verify they're distinct
        for (const schedule of schedules) {
          await schedule.handler()
        }

        return markers
      })

      expect(results).toContain('hourly')
      expect(results).toContain('daily')
      expect(results.length).toBe(2)
    })
  })
})
