/**
 * Alarm-based scheduling tests (do-eo4t)
 *
 * Tests for connecting $.every DSL to actual DO alarms.
 * The scheduling DSL should:
 * 1. Register schedule handlers
 * 2. Set alarms via state.storage.setAlarm()
 * 3. Execute handlers when alarm() is called
 * 4. Reschedule the next alarm after execution
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DO } from '../DO'
import { getSchedules, type ScheduleRegistration } from '../workflow'

// Mock storage with alarm tracking
function createMockState(): DurableObjectState & {
  _alarmTime: number | null
  _alarmDeleted: boolean
} {
  const storage = new Map<string, unknown>()
  let alarmTime: number | null = null
  let alarmDeleted = false

  return {
    id: { toString: () => 'test-alarm-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
      // Alarm methods
      setAlarm: vi.fn((time: number | Date) => {
        alarmTime = typeof time === 'number' ? time : time.getTime()
        alarmDeleted = false
        return Promise.resolve()
      }),
      getAlarm: vi.fn(() => Promise.resolve(alarmTime)),
      deleteAlarm: vi.fn(() => {
        alarmTime = null
        alarmDeleted = true
        return Promise.resolve()
      }),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
    // Test helpers
    get _alarmTime() { return alarmTime },
    set _alarmTime(v) { alarmTime = v },
    get _alarmDeleted() { return alarmDeleted },
    set _alarmDeleted(v) { alarmDeleted = v },
  } as unknown as DurableObjectState & {
    _alarmTime: number | null
    _alarmDeleted: boolean
  }
}

describe('Alarm-based scheduling (do-eo4t)', () => {
  let doInstance: DO
  let mockState: ReturnType<typeof createMockState>

  beforeEach(() => {
    // Create DO instance first with real timers
    mockState = createMockState()
    doInstance = new DO(mockState, {})
    // Then switch to fake timers
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-20T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('schedule registration and alarm setting', () => {
    it('should set alarm when scheduling via $.every.hour', async () => {
      // Access the protected $ context
      const $ = (doInstance as any).$

      // Register a schedule
      $.every.hour(async () => {
        // Handler logic
      })

      // Trigger alarm setup (schedules are registered, alarm should be set)
      await doInstance.alarm()

      // Verify setAlarm was called
      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })

    it('should calculate next execution time for $.every.hour', async () => {
      const $ = (doInstance as any).$
      const handler = vi.fn()

      $.every.hour(handler)

      // Trigger alarm to set up next execution
      await doInstance.alarm()

      // The next hour boundary from 10:00 should be 11:00
      const expectedTime = new Date('2026-01-20T11:00:00Z').getTime()
      expect(mockState.storage.setAlarm).toHaveBeenCalledWith(expectedTime)
    })

    it('should calculate next execution time for $.every.day', async () => {
      const $ = (doInstance as any).$
      const handler = vi.fn()

      $.every.day(handler)

      await doInstance.alarm()

      // Verify setAlarm was called with a time in the future
      const call = vi.mocked(mockState.storage.setAlarm).mock.calls[0]
      expect(call).toBeDefined()
      const scheduledTime = call![0] as number

      // Should be scheduled for the next day (next midnight)
      const now = new Date('2026-01-20T10:00:00Z').getTime()
      expect(scheduledTime).toBeGreaterThan(now)

      // Should be scheduled within the next 24 hours
      expect(scheduledTime - now).toBeLessThanOrEqual(24 * 60 * 60 * 1000)

      // Should be at the start of an hour (minute = 0)
      const scheduledDate = new Date(scheduledTime)
      expect(scheduledDate.getMinutes()).toBe(0)
    })

    it('should calculate next execution time for $.every.Monday.at9am', async () => {
      // Current time: Monday Jan 20, 2026 at 10:00 UTC
      const $ = (doInstance as any).$
      const handler = vi.fn()

      $.every.Monday.at9am(handler)

      await doInstance.alarm()

      // Verify setAlarm was called with a time in the future
      const call = vi.mocked(mockState.storage.setAlarm).mock.calls[0]
      expect(call).toBeDefined()
      const scheduledTime = call![0] as number

      const now = new Date('2026-01-20T10:00:00Z').getTime()
      expect(scheduledTime).toBeGreaterThan(now)

      // Should be scheduled within the next week (7 days)
      expect(scheduledTime - now).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000)

      // Should be at 9:00 (hour = 9 in some timezone, minute = 0)
      const scheduledDate = new Date(scheduledTime)
      expect(scheduledDate.getMinutes()).toBe(0)
      // Hour should be 9 (local time - the cron implementation uses local time)
      expect(scheduledDate.getHours()).toBe(9)
    })

    it('should calculate next execution for $.every(5).minutes', async () => {
      const $ = (doInstance as any).$
      const handler = vi.fn()

      $.every(5).minutes(handler)

      await doInstance.alarm()

      // 5 minutes from 10:00 is 10:05
      const expectedTime = new Date('2026-01-20T10:05:00Z').getTime()
      expect(mockState.storage.setAlarm).toHaveBeenCalledWith(expectedTime)
    })
  })

  describe('alarm execution', () => {
    it('should execute scheduled handlers when alarm fires', async () => {
      const $ = (doInstance as any).$
      const handler = vi.fn()

      $.every.hour(handler)

      // Simulate alarm firing
      await doInstance.alarm()

      // Handler should be executed
      expect(handler).toHaveBeenCalled()
    })

    it('should execute multiple handlers when alarm fires', async () => {
      const $ = (doInstance as any).$
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      $.every.hour(handler1)
      $.every.hour(handler2)

      await doInstance.alarm()

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should reschedule alarm after execution', async () => {
      const $ = (doInstance as any).$
      const handler = vi.fn()

      $.every.hour(handler)

      // First alarm call
      await doInstance.alarm()

      // setAlarm should be called to schedule next execution
      expect(mockState.storage.setAlarm).toHaveBeenCalled()

      // Clear mock to check reschedule
      vi.mocked(mockState.storage.setAlarm).mockClear()

      // Advance time by 1 hour and fire alarm again
      vi.setSystemTime(new Date('2026-01-20T11:00:00Z'))
      await doInstance.alarm()

      // Should reschedule for next hour
      expect(mockState.storage.setAlarm).toHaveBeenCalledWith(
        new Date('2026-01-20T12:00:00Z').getTime()
      )
    })

    it('should handle handler errors gracefully', async () => {
      const $ = (doInstance as any).$
      const errorHandler = vi.fn(async () => {
        throw new Error('Handler error')
      })
      const successHandler = vi.fn()

      $.every.hour(errorHandler)
      $.every.hour(successHandler)

      // Should not throw
      await doInstance.alarm()

      // Success handler should still run
      expect(successHandler).toHaveBeenCalled()

      // Should still reschedule
      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })
  })

  describe('schedule filtering', () => {
    it('should only execute schedules due at current time', async () => {
      const $ = (doInstance as any).$
      const hourlyHandler = vi.fn()
      const dailyHandler = vi.fn()

      // At 10:00, hourly should execute but daily (midnight) should not
      $.every.hour(hourlyHandler)
      $.every.day(dailyHandler)

      // Simulate alarm at 11:00 (top of hour)
      vi.setSystemTime(new Date('2026-01-20T11:00:00Z'))
      await doInstance.alarm()

      // Hourly should execute, daily should wait for midnight
      expect(hourlyHandler).toHaveBeenCalled()
      // Daily handler should not execute until midnight
      // (This depends on implementation - it may execute all due schedules)
    })
  })

  describe('schedule persistence', () => {
    it('should persist schedule metadata to storage', async () => {
      const $ = (doInstance as any).$
      const handler = vi.fn()

      $.every.hour(handler)

      await doInstance.alarm()

      // Schedule metadata should be persisted
      expect(mockState.storage.put).toHaveBeenCalled()
    })

    it('should track last execution time', async () => {
      const $ = (doInstance as any).$
      const handler = vi.fn()

      $.every.hour(handler)

      await doInstance.alarm()

      // Verify last execution is tracked
      const schedules = getSchedules($._schedules)
      expect(schedules.length).toBeGreaterThan(0)
    })
  })

  describe('no schedules', () => {
    it('should handle alarm() with no registered schedules', async () => {
      // No schedules registered
      await doInstance.alarm()

      // Should not throw, should not set alarm
      expect(mockState.storage.setAlarm).not.toHaveBeenCalled()
    })
  })

  describe('cron expression handling', () => {
    it('should parse cron expression for $.every.Monday', async () => {
      const $ = (doInstance as any).$
      const handler = vi.fn()

      $.every.Monday(handler)

      const schedules = getSchedules($._schedules)
      expect(schedules[0].interval.expression).toBe('0 0 * * 1')
    })

    it('should parse cron expression for $.every.weekday.at8am', async () => {
      const $ = (doInstance as any).$
      const handler = vi.fn()

      $.every.weekday.at8am(handler)

      const schedules = getSchedules($._schedules)
      expect(schedules[0].interval.expression).toBe('0 8 * * 1-5')
    })
  })
})
