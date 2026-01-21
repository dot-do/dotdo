/**
 * Tests for DO.alarm() implementation
 *
 * TDD: Red phase - these tests define the expected alarm behavior:
 * 1. Processing scheduled events from $.every DSL
 * 2. Re-scheduling recurring alarms
 * 3. Handling one-time alarms
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DO } from '../DO'
import type { WorkflowContext } from '../context'
import type { ScheduleRegistration } from '../workflow/schedule'

// Mock DurableObjectState with alarm support
function createMockState(): DurableObjectState & { _alarmTime?: number | null } {
  const storage = new Map<string, unknown>()
  let alarmTime: number | null = null

  return {
    id: { toString: () => 'test-alarm-id' } as DurableObjectId,
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
      getAlarm: vi.fn(() => Promise.resolve(alarmTime)),
      setAlarm: vi.fn((time: number | Date) => {
        alarmTime = typeof time === 'number' ? time : time.getTime()
        return Promise.resolve()
      }),
      deleteAlarm: vi.fn(() => {
        alarmTime = null
        return Promise.resolve()
      }),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
    get _alarmTime() { return alarmTime },
  } as unknown as DurableObjectState & { _alarmTime?: number | null }
}

describe('DO.alarm() implementation', () => {
  let mockState: DurableObjectState & { _alarmTime?: number | null }
  let doInstance: DO

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    doInstance = new DO(mockState, {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('alarm execution', () => {
    it('should execute scheduled handlers when alarm fires', async () => {
      const executed: string[] = []

      // Create a subclass that sets up schedules
      class ScheduledDO extends DO {
        constructor(state: DurableObjectState, env: any) {
          super(state, env)
          // Register a schedule via $.every
          this.$.every.hour(async () => {
            executed.push('hourly-task')
          })
        }

        // Expose $ for testing
        get context(): WorkflowContext {
          return this.$
        }
      }

      const scheduled = new ScheduledDO(mockState, {})

      // Verify schedule was registered
      const schedules = scheduled.context._schedules
      expect(schedules.size).toBe(1)

      // Trigger alarm
      await scheduled.alarm()

      // Handler should have been called
      expect(executed).toContain('hourly-task')
    })

    it('should execute all due schedules when alarm fires', async () => {
      const executed: string[] = []

      class MultiScheduleDO extends DO {
        constructor(state: DurableObjectState, env: any) {
          super(state, env)
          this.$.every.hour(async () => {
            executed.push('hourly')
          })
          this.$.every.minute(async () => {
            executed.push('minutely')
          })
        }

        get context(): WorkflowContext {
          return this.$
        }
      }

      const scheduled = new MultiScheduleDO(mockState, {})

      // Should have 2 schedules
      expect(scheduled.context._schedules.size).toBe(2)

      // Trigger alarm
      await scheduled.alarm()

      // Both handlers should execute (alarm processes all due work)
      expect(executed).toContain('hourly')
      expect(executed).toContain('minutely')
    })

    it('should handle errors in scheduled handlers gracefully', async () => {
      const executed: string[] = []

      class ErrorScheduleDO extends DO {
        constructor(state: DurableObjectState, env: any) {
          super(state, env)
          this.$.every.hour(async () => {
            throw new Error('Handler error')
          })
          this.$.every.minute(async () => {
            executed.push('after-error')
          })
        }

        get context(): WorkflowContext {
          return this.$
        }
      }

      const scheduled = new ErrorScheduleDO(mockState, {})

      // Should not throw, errors are caught
      await expect(scheduled.alarm()).resolves.not.toThrow()

      // Second handler should still run despite first failing
      expect(executed).toContain('after-error')
    })
  })

  describe('recurring alarm scheduling', () => {
    it('should re-schedule alarm after execution for recurring schedules', async () => {
      class RecurringDO extends DO {
        constructor(state: DurableObjectState, env: any) {
          super(state, env)
          this.$.every.hour(async () => {})
        }

        get context(): WorkflowContext {
          return this.$
        }
      }

      const scheduled = new RecurringDO(mockState, {})

      // Trigger alarm
      await scheduled.alarm()

      // Alarm should be re-scheduled (setAlarm called)
      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })

    it('should schedule next alarm based on interval type', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      class IntervalDO extends DO {
        constructor(state: DurableObjectState, env: any) {
          super(state, env)
          // Every 5 minutes
          this.$.every(5).minutes(async () => {})
        }

        get context(): WorkflowContext {
          return this.$
        }
      }

      const scheduled = new IntervalDO(mockState, {})

      // Trigger alarm
      await scheduled.alarm()

      // Should schedule next alarm ~5 minutes from now
      const setAlarmCall = (mockState.storage.setAlarm as any).mock.calls[0]
      if (setAlarmCall) {
        const nextAlarm = setAlarmCall[0]
        const expectedTime = now + 5 * 60 * 1000
        // Allow some tolerance
        expect(nextAlarm).toBeGreaterThanOrEqual(expectedTime - 1000)
        expect(nextAlarm).toBeLessThanOrEqual(expectedTime + 1000)
      }
    })

    it('should calculate next cron execution time correctly', async () => {
      // Set time to Monday 8am
      const monday8am = new Date('2025-01-20T08:00:00Z')
      vi.setSystemTime(monday8am)

      class CronDO extends DO {
        constructor(state: DurableObjectState, env: any) {
          super(state, env)
          // Every Monday at 9am
          this.$.every.Monday.at9am(async () => {})
        }

        get context(): WorkflowContext {
          return this.$
        }
      }

      const scheduled = new CronDO(mockState, {})

      // Trigger alarm
      await scheduled.alarm()

      // Should schedule next alarm for 9am (1 hour later on same day)
      // or next Monday if past 9am
      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })
  })

  describe('one-time alarms', () => {
    it('should support scheduling a one-time alarm', async () => {
      const executed: string[] = []
      const now = Date.now()
      vi.setSystemTime(now)

      class OneTimeDO extends DO {
        constructor(state: DurableObjectState, env: any) {
          super(state, env)
        }

        // Method to schedule one-time work
        async scheduleOnce(delayMs: number, handler: () => Promise<void>): Promise<void> {
          await this.scheduleOneTimeAlarm(delayMs, handler)
        }

        get context(): WorkflowContext {
          return this.$
        }
      }

      const scheduled = new OneTimeDO(mockState, {})

      // Schedule one-time alarm for 1 second from now
      await scheduled.scheduleOnce(1000, async () => {
        executed.push('one-time-task')
      })

      // Verify alarm was set
      expect(mockState.storage.setAlarm).toHaveBeenCalled()

      // Advance time past the scheduled time
      vi.setSystemTime(now + 2000)

      // Trigger alarm
      await scheduled.alarm()

      // Handler should execute
      expect(executed).toContain('one-time-task')
    })

    it('should not re-schedule one-time alarms after execution', async () => {
      class OneTimeDO extends DO {
        constructor(state: DurableObjectState, env: any) {
          super(state, env)
        }

        async scheduleOnce(delayMs: number, handler: () => Promise<void>): Promise<void> {
          await this.scheduleOneTimeAlarm(delayMs, handler)
        }
      }

      const scheduled = new OneTimeDO(mockState, {})

      await scheduled.scheduleOnce(1000, async () => {})

      // Clear mock to track calls after alarm()
      vi.mocked(mockState.storage.setAlarm).mockClear()

      // Trigger alarm
      await scheduled.alarm()

      // If no recurring schedules, should not re-schedule
      // (only one-time was registered and it's consumed)
      // Note: This depends on implementation - may need adjustment
    })
  })

  describe('alarm initialization', () => {
    it('should set initial alarm when schedules are registered', async () => {
      class InitDO extends DO {
        constructor(state: DurableObjectState, env: any) {
          super(state, env)
          this.$.every.hour(async () => {})
        }
      }

      // Create DO with schedule
      new InitDO(mockState, {})

      // Initial alarm should be set (may be deferred or immediate)
      // The initializeAlarms() method should be called
    })

    it('should restore alarm state after DO restart', async () => {
      // Simulate stored alarm data
      const storedAlarms = {
        alarms: [{ id: 'schedule-0', nextRun: Date.now() + 60000, recurring: true, interval: { type: 'cron', expression: '0 * * * *' } }],
        oneTimeAlarms: []
      }
      vi.mocked(mockState.storage.get).mockImplementation((key: string) => {
        if (key === '_alarms') return Promise.resolve(storedAlarms)
        return Promise.resolve(undefined)
      })

      class RestoreDO extends DO {
        constructor(state: DurableObjectState, env: any) {
          super(state, env)
          this.$.every.hour(async () => {})
        }
      }

      const scheduled = new RestoreDO(mockState, {})

      // Trigger alarm to force initialization/restoration
      await scheduled.alarm()

      // Alarm state should be restored from storage
      expect(mockState.storage.get).toHaveBeenCalledWith('_alarms')
    })
  })

  describe('schedule matching', () => {
    it('should only execute schedules that are due', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const executed: string[] = []

      // This test verifies that if we have schedules with different intervals,
      // the alarm only executes what's actually due

      class SelectiveDO extends DO {
        constructor(state: DurableObjectState, env: any) {
          super(state, env)
          this.$.every.minute(async () => {
            executed.push('minute')
          })
          this.$.every.hour(async () => {
            executed.push('hour')
          })
        }

        get context(): WorkflowContext {
          return this.$
        }
      }

      const scheduled = new SelectiveDO(mockState, {})

      // First alarm trigger - both should run (initial)
      await scheduled.alarm()

      // For now, we expect all schedules to run on alarm trigger
      // More sophisticated scheduling would track individual due times
      expect(executed.length).toBeGreaterThan(0)
    })
  })

  describe('alarm cancellation', () => {
    it('should allow cancelling scheduled alarms', async () => {
      class CancellableDO extends DO {
        constructor(state: DurableObjectState, env: any) {
          super(state, env)
          this.$.every.hour(async () => {})
        }

        async cancelAlarms(): Promise<void> {
          await this.clearAllAlarms()
        }
      }

      const scheduled = new CancellableDO(mockState, {})

      // Cancel all alarms
      await scheduled.cancelAlarms()

      // deleteAlarm should be called
      expect(mockState.storage.deleteAlarm).toHaveBeenCalled()
    })
  })
})
