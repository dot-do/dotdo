/**
 * Alarm-based scheduling tests (do-eo4t)
 *
 * Tests for connecting $.every DSL to actual DO alarms using real miniflare instances.
 * NO MOCKS - all tests run against real Durable Object instances with real SQLite/storage.
 *
 * The scheduling DSL should:
 * 1. Register schedule handlers
 * 2. Set alarms via state.storage.setAlarm()
 * 3. Execute handlers when alarm() is called
 * 4. Reschedule the next alarm after execution
 *
 * @module do/tests/alarm-scheduling.test
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
  return `alarm-scheduling-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a test DO stub with a unique name
 */
function getTestDO(name: string = generateTestId()) {
  const id = env.DO.idFromName(name)
  return env.DO.get(id)
}

// ============================================================================
// TESTS: Alarm-based Scheduling
// ============================================================================

describe('Alarm-based scheduling (do-eo4t)', () => {
  describe('schedule registration and alarm setting', () => {
    it('should set alarm when scheduling via $.every.hour', async () => {
      const stub = getTestDO()

      const hasAlarm = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        // Register a schedule
        $.every.hour(async () => {
          // Handler logic
        })

        // Trigger alarm setup (schedules are registered, alarm should be set)
        await instance.alarm()

        // Verify alarm was set
        const alarm = await state.storage.getAlarm()
        return alarm !== null
      })

      expect(hasAlarm).toBe(true)
    })

    it('should calculate next execution time for $.every.hour', async () => {
      const stub = getTestDO()

      const alarmTime = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        $.every.hour(async () => {})

        // Trigger alarm to set up next execution
        await instance.alarm()

        return await state.storage.getAlarm()
      })

      const now = Date.now()
      // Alarm should be scheduled within the next hour
      expect(alarmTime).toBeGreaterThan(now)
      expect(alarmTime).toBeLessThanOrEqual(now + 60 * 60 * 1000 + 1000) // 1 hour + tolerance
    })

    it('should calculate next execution time for $.every.day', async () => {
      const stub = getTestDO()

      const alarmTime = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        $.every.day(async () => {})

        await instance.alarm()

        return await state.storage.getAlarm()
      })

      const now = Date.now()
      // Should be scheduled for the next day (next midnight)
      expect(alarmTime).toBeGreaterThan(now)
      // Should be scheduled within the next 24 hours
      expect(alarmTime).toBeLessThanOrEqual(now + 24 * 60 * 60 * 1000 + 1000)
    })

    it('should calculate next execution time for $.every.Monday.at9am', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        $.every.Monday.at9am(async () => {})

        await instance.alarm()

        const alarmTime = await state.storage.getAlarm()
        const schedules = getSchedules($._schedules)

        return {
          alarmTime,
          cronExpression: schedules[0]?.interval.expression,
        }
      })

      const now = Date.now()
      expect(result.alarmTime).toBeGreaterThan(now)
      // Should be scheduled within the next week (7 days)
      expect(result.alarmTime).toBeLessThanOrEqual(now + 7 * 24 * 60 * 60 * 1000 + 1000)
      // Verify the cron expression
      expect(result.cronExpression).toBe('0 9 * * 1')
    })

    it('should calculate next execution for $.every(5).minutes', async () => {
      const stub = getTestDO()

      const alarmTime = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        $.every(5).minutes(async () => {})

        await instance.alarm()

        return await state.storage.getAlarm()
      })

      const now = Date.now()
      // 5 minutes from now
      expect(alarmTime).toBeGreaterThan(now)
      expect(alarmTime).toBeLessThanOrEqual(now + 5 * 60 * 1000 + 1000)
    })
  })

  describe('alarm execution', () => {
    it('should execute scheduled handlers when alarm fires', async () => {
      const stub = getTestDO()

      const executed = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        let handlerExecuted = false

        $.every.hour(async () => {
          handlerExecuted = true
        })

        // Simulate alarm firing
        await instance.alarm()

        return handlerExecuted
      })

      expect(executed).toBe(true)
    })

    it('should execute multiple handlers when alarm fires', async () => {
      const stub = getTestDO()

      const executions = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const executed: string[] = []

        $.every.hour(async () => {
          executed.push('handler1')
        })
        $.every.hour(async () => {
          executed.push('handler2')
        })

        await instance.alarm()

        return executed
      })

      expect(executions).toContain('handler1')
      expect(executions).toContain('handler2')
      expect(executions.length).toBe(2)
    })

    it('should reschedule alarm after execution', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        $.every.hour(async () => {})

        // First alarm call
        await instance.alarm()

        const firstAlarm = await state.storage.getAlarm()

        // Second alarm call (simulates time passing and alarm firing again)
        await instance.alarm()

        const secondAlarm = await state.storage.getAlarm()

        return {
          firstAlarmSet: firstAlarm !== null,
          secondAlarmSet: secondAlarm !== null,
          // The second alarm should be different (rescheduled)
          alarmsAreEqual: firstAlarm === secondAlarm,
        }
      })

      expect(result.firstAlarmSet).toBe(true)
      expect(result.secondAlarmSet).toBe(true)
      // Note: In real time, the alarms would be different. In tests without time advancement,
      // they may be the same. The key point is that an alarm is still set after re-execution.
    })

    it('should handle handler errors gracefully', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState
        let successHandlerExecuted = false

        $.every.hour(async () => {
          throw new Error('Handler error')
        })
        $.every.hour(async () => {
          successHandlerExecuted = true
        })

        // Should not throw
        await instance.alarm()

        const alarmStillSet = await state.storage.getAlarm()

        return {
          successHandlerExecuted,
          alarmStillSet: alarmStillSet !== null,
        }
      })

      // Success handler should still run despite error in first handler
      expect(result.successHandlerExecuted).toBe(true)
      // Alarm should still be rescheduled
      expect(result.alarmStillSet).toBe(true)
    })
  })

  describe('schedule filtering', () => {
    it('should execute all registered schedules when alarm fires', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const executed: string[] = []

        $.every.hour(async () => {
          executed.push('hourly')
        })
        $.every.day(async () => {
          executed.push('daily')
        })

        await instance.alarm()

        return executed
      })

      // Both handlers should execute when alarm fires
      expect(result).toContain('hourly')
      expect(result).toContain('daily')
    })
  })

  describe('schedule persistence', () => {
    it('should persist schedule metadata to storage', async () => {
      const stub = getTestDO()

      const hasPersistedData = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        $.every.hour(async () => {})

        await instance.alarm()

        // Check that alarm metadata is persisted
        const stored = await state.storage.get('_alarms')
        return stored !== undefined && stored !== null
      })

      expect(hasPersistedData).toBe(true)
    })

    it('should track schedules in context', async () => {
      const stub = getTestDO()

      const scheduleCount = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.hour(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules.length
      })

      expect(scheduleCount).toBeGreaterThan(0)
    })
  })

  describe('no schedules', () => {
    it('should handle alarm() with no registered schedules', async () => {
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

  describe('cron expression handling', () => {
    it('should parse cron expression for $.every.Monday', async () => {
      const stub = getTestDO()

      const cronExpression = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.Monday(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval.expression
      })

      expect(cronExpression).toBe('0 0 * * 1')
    })

    it('should parse cron expression for $.every.weekday.at8am', async () => {
      const stub = getTestDO()

      const cronExpression = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every.weekday.at8am(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval.expression
      })

      expect(cronExpression).toBe('0 8 * * 1-5')
    })

    it('should parse cron expression for $.every(30).minutes', async () => {
      const stub = getTestDO()

      const interval = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$

        $.every(30).minutes(async () => {})

        const schedules = getSchedules($._schedules)
        return schedules[0]?.interval
      })

      expect(interval.type).toBe('minute')
      expect(interval.value).toBe(30)
    })
  })

  describe('alarm clearing', () => {
    it('should allow clearing all alarms', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        $.every.hour(async () => {})

        // Set up the alarm
        await instance.alarm()
        const alarmBeforeClear = await state.storage.getAlarm()

        // Clear all alarms using protected method
        await (instance as any).clearAllAlarms()
        const alarmAfterClear = await state.storage.getAlarm()

        return {
          alarmWasSet: alarmBeforeClear !== null,
          alarmWasCleared: alarmAfterClear === null,
        }
      })

      expect(result.alarmWasSet).toBe(true)
      expect(result.alarmWasCleared).toBe(true)
    })
  })

  describe('one-time alarm scheduling', () => {
    it('should schedule a one-time alarm', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const state = (instance as any).state as DurableObjectState
        let executed = false

        // Schedule one-time alarm for 1 second from now
        await (instance as any).scheduleOneTimeAlarm(1000, async () => {
          executed = true
        })

        // Verify alarm was set
        const alarmTime = await state.storage.getAlarm()
        const now = Date.now()

        return {
          alarmSet: alarmTime !== null,
          alarmInFuture: alarmTime !== null && alarmTime > now,
          alarmWithinRange: alarmTime !== null && alarmTime <= now + 2000,
        }
      })

      expect(result.alarmSet).toBe(true)
      expect(result.alarmInFuture).toBe(true)
      expect(result.alarmWithinRange).toBe(true)
    })

    it('should execute one-time alarm when triggered', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        let executed = false

        // Schedule one-time alarm with 0 delay (due immediately)
        // Use -1 to ensure it's already past due when alarm() is called
        await (instance as any).scheduleOneTimeAlarm(-1, async () => {
          executed = true
        })

        // Trigger alarm (simulates the alarm firing)
        await instance.alarm()

        return executed
      })

      expect(result).toBe(true)
    })
  })

  describe('initial alarm scheduling (do-7td2u.1)', () => {
    it('should automatically set alarm when $.every.day.at("6pm") is registered', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        // Register a schedule - this should automatically trigger alarm scheduling
        $.every.day.at('6pm')(async () => {})

        // Wait a tick for the async alarm scheduling to complete
        await new Promise(resolve => setTimeout(resolve, 10))

        // Check if alarm was set without calling alarm()
        const alarmTime = await state.storage.getAlarm()

        return {
          alarmSet: alarmTime !== null,
          alarmInFuture: alarmTime !== null && alarmTime > Date.now(),
        }
      })

      expect(result.alarmSet).toBe(true)
      expect(result.alarmInFuture).toBe(true)
    })

    it('should automatically set alarm when $.every.hour is registered', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        // Register a schedule - this should automatically trigger alarm scheduling
        $.every.hour(async () => {})

        // Wait a tick for the async alarm scheduling to complete
        await new Promise(resolve => setTimeout(resolve, 10))

        // Check if alarm was set without calling alarm()
        const alarmTime = await state.storage.getAlarm()

        return {
          alarmSet: alarmTime !== null,
          alarmInFuture: alarmTime !== null && alarmTime > Date.now(),
          alarmWithinHour: alarmTime !== null && alarmTime <= Date.now() + 60 * 60 * 1000 + 1000,
        }
      })

      expect(result.alarmSet).toBe(true)
      expect(result.alarmInFuture).toBe(true)
      expect(result.alarmWithinHour).toBe(true)
    })

    it('should automatically set alarm when $.every(5).minutes is registered', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        // Register a schedule - this should automatically trigger alarm scheduling
        $.every(5).minutes(async () => {})

        // Wait a tick for the async alarm scheduling to complete
        await new Promise(resolve => setTimeout(resolve, 10))

        // Check if alarm was set without calling alarm()
        const alarmTime = await state.storage.getAlarm()
        const now = Date.now()

        return {
          alarmSet: alarmTime !== null,
          alarmInFuture: alarmTime !== null && alarmTime > now,
          alarmWithin5Minutes: alarmTime !== null && alarmTime <= now + 5 * 60 * 1000 + 1000,
        }
      })

      expect(result.alarmSet).toBe(true)
      expect(result.alarmInFuture).toBe(true)
      expect(result.alarmWithin5Minutes).toBe(true)
    })

    it('should automatically set alarm when $.every.Monday.at9am is registered', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        // Register a schedule - this should automatically trigger alarm scheduling
        $.every.Monday.at9am(async () => {})

        // Wait a tick for the async alarm scheduling to complete
        await new Promise(resolve => setTimeout(resolve, 10))

        // Check if alarm was set without calling alarm()
        const alarmTime = await state.storage.getAlarm()
        const now = Date.now()

        return {
          alarmSet: alarmTime !== null,
          alarmInFuture: alarmTime !== null && alarmTime > now,
          // Should be scheduled within the next week
          alarmWithinWeek: alarmTime !== null && alarmTime <= now + 7 * 24 * 60 * 60 * 1000 + 1000,
        }
      })

      expect(result.alarmSet).toBe(true)
      expect(result.alarmInFuture).toBe(true)
      expect(result.alarmWithinWeek).toBe(true)
    })

    it('should update alarm time when additional schedules are registered', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as any).$
        const state = (instance as any).state as DurableObjectState

        // Register a daily schedule
        $.every.day(async () => {})
        await new Promise(resolve => setTimeout(resolve, 10))
        const firstAlarm = await state.storage.getAlarm()

        // Register a more frequent schedule (every hour)
        $.every.hour(async () => {})
        await new Promise(resolve => setTimeout(resolve, 10))
        const secondAlarm = await state.storage.getAlarm()

        return {
          firstAlarmSet: firstAlarm !== null,
          secondAlarmSet: secondAlarm !== null,
          // The alarm should have been updated to the earlier time (hourly is sooner than daily)
          alarmUpdated: secondAlarm !== null && firstAlarm !== null && secondAlarm <= firstAlarm,
        }
      })

      expect(result.firstAlarmSet).toBe(true)
      expect(result.secondAlarmSet).toBe(true)
      expect(result.alarmUpdated).toBe(true)
    })
  })
})
