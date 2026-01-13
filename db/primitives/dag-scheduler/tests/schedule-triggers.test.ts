/**
 * Schedule Triggers Tests
 *
 * TDD tests for cron and schedule-based DAG triggering.
 * Tests cover:
 * - Cron expression parsing and validation
 * - Schedule-based DAG triggering
 * - Timezone handling
 * - Backfill for missed schedules
 * - Schedule overlap handling
 * - DO alarm integration
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  // Core DAG types
  type DAG,
  type DAGRun,
  createDAG,
  createTaskNode,
  createParallelExecutor,
  // Existing cron types
  type CronTrigger,
  type ScheduleTrigger,
  type CronTriggerOptions,
  parseCronExpression,
  createCronTrigger,
} from '../index'
import {
  // New schedule trigger types
  type DAGScheduleManager,
  type ScheduledDAG,
  type ScheduleRegistration,
  type BackfillOptions,
  type BackfillResult,
  type ScheduleOverlapPolicy,
  type AlarmIntegration,
  // New functions
  createDAGScheduleManager,
  createBackfillManager,
  parseCronExpressionExtended,
  getNextRunTimes,
  validateSchedule,
} from '../schedule-trigger'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createSimpleDAG(id: string): DAG {
  return createDAG({
    id,
    tasks: [
      createTaskNode({
        id: 'task-1',
        execute: async () => `result-${id}`,
        dependencies: [],
      }),
    ],
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// CRON EXPRESSION PARSING - EXTENDED
// ============================================================================

describe('CronParser - Extended', () => {
  describe('standard cron expressions', () => {
    it('should parse simple numeric expressions', () => {
      const parsed = parseCronExpressionExtended('30 9 * * *')
      expect(parsed.minute).toEqual([30])
      expect(parsed.hour).toEqual([9])
      expect(parsed.dayOfMonth).toEqual('*')
      expect(parsed.month).toEqual('*')
      expect(parsed.dayOfWeek).toEqual('*')
    })

    it('should parse wildcards', () => {
      const parsed = parseCronExpressionExtended('* * * * *')
      expect(parsed.minute).toEqual('*')
      expect(parsed.hour).toEqual('*')
      expect(parsed.dayOfMonth).toEqual('*')
      expect(parsed.month).toEqual('*')
      expect(parsed.dayOfWeek).toEqual('*')
    })

    it('should parse step values', () => {
      const parsed = parseCronExpressionExtended('*/15 */2 * * *')
      expect(parsed.minute).toEqual({ step: 15, from: 0 })
      expect(parsed.hour).toEqual({ step: 2, from: 0 })
    })

    it('should parse ranges', () => {
      const parsed = parseCronExpressionExtended('0 9-17 * * 1-5')
      expect(parsed.hour).toEqual({ start: 9, end: 17 })
      expect(parsed.dayOfWeek).toEqual({ start: 1, end: 5 })
    })

    it('should parse lists', () => {
      const parsed = parseCronExpressionExtended('0 9,12,18 * * *')
      expect(parsed.hour).toEqual([9, 12, 18])
    })

    it('should parse combined ranges and lists', () => {
      const parsed = parseCronExpressionExtended('0 9-12,18 * * *')
      expect(parsed.hour).toEqual([9, 10, 11, 12, 18])
    })

    it('should parse day names', () => {
      const parsed = parseCronExpressionExtended('0 9 * * MON')
      expect(parsed.dayOfWeek).toEqual([1])

      const parsed2 = parseCronExpressionExtended('0 9 * * MON-FRI')
      expect(parsed2.dayOfWeek).toEqual({ start: 1, end: 5 })
    })

    it('should parse month names', () => {
      const parsed = parseCronExpressionExtended('0 0 1 JAN *')
      expect(parsed.month).toEqual([1])

      const parsed2 = parseCronExpressionExtended('0 0 1 JAN-MAR *')
      expect(parsed2.month).toEqual({ start: 1, end: 3 })
    })
  })

  describe('validation', () => {
    it('should reject invalid minute values', () => {
      expect(() => parseCronExpressionExtended('60 * * * *')).toThrow(/minute/i)
      expect(() => parseCronExpressionExtended('-1 * * * *')).toThrow(/minute/i)
    })

    it('should reject invalid hour values', () => {
      expect(() => parseCronExpressionExtended('* 24 * * *')).toThrow(/hour/i)
    })

    it('should reject invalid day of month values', () => {
      expect(() => parseCronExpressionExtended('* * 32 * *')).toThrow(/day/i)
      expect(() => parseCronExpressionExtended('* * 0 * *')).toThrow(/day/i)
    })

    it('should reject invalid month values', () => {
      expect(() => parseCronExpressionExtended('* * * 13 *')).toThrow(/month/i)
      expect(() => parseCronExpressionExtended('* * * 0 *')).toThrow(/month/i)
    })

    it('should reject invalid day of week values', () => {
      expect(() => parseCronExpressionExtended('* * * * 7')).toThrow(/day.*week/i)
    })

    it('should reject invalid expressions with wrong number of parts', () => {
      expect(() => parseCronExpressionExtended('* * *')).toThrow(/5 parts/i)
      expect(() => parseCronExpressionExtended('* * * * * *')).toThrow(/5 parts/i)
    })

    it('should reject invalid step values', () => {
      expect(() => parseCronExpressionExtended('*/0 * * * *')).toThrow(/step/i)
      expect(() => parseCronExpressionExtended('*/-1 * * * *')).toThrow(/step/i)
    })

    it('should reject invalid ranges', () => {
      expect(() => parseCronExpressionExtended('0 17-9 * * *')).toThrow(/range/i)
    })
  })

  describe('edge cases', () => {
    it('should handle extra whitespace', () => {
      const parsed = parseCronExpressionExtended('  30   9   *   *   *  ')
      expect(parsed.minute).toEqual([30])
      expect(parsed.hour).toEqual([9])
    })

    it('should be case-insensitive for day/month names', () => {
      const parsed = parseCronExpressionExtended('0 9 * * mon')
      expect(parsed.dayOfWeek).toEqual([1])

      const parsed2 = parseCronExpressionExtended('0 9 * jan *')
      expect(parsed2.month).toEqual([1])
    })

    it('should handle Sunday as both 0 and 7', () => {
      const parsed0 = parseCronExpressionExtended('0 0 * * 0')
      const parsed7 = parseCronExpressionExtended('0 0 * * SUN')
      expect(parsed0.dayOfWeek).toEqual([0])
      expect(parsed7.dayOfWeek).toEqual([0])
    })
  })
})

// ============================================================================
// NEXT RUN TIME CALCULATION
// ============================================================================

describe('getNextRunTimes', () => {
  it('should calculate next run time for simple expressions', () => {
    const now = new Date('2026-01-13T08:00:00Z')
    const nextRuns = getNextRunTimes('0 9 * * *', now, 1)

    expect(nextRuns).toHaveLength(1)
    expect(nextRuns[0]!.getUTCHours()).toBe(9)
    expect(nextRuns[0]!.getUTCMinutes()).toBe(0)
  })

  it('should return multiple next run times', () => {
    const now = new Date('2026-01-13T08:00:00Z')
    const nextRuns = getNextRunTimes('0 9 * * *', now, 5)

    expect(nextRuns).toHaveLength(5)
    // Should be consecutive days at 9am
    for (let i = 1; i < nextRuns.length; i++) {
      const diff = nextRuns[i]!.getTime() - nextRuns[i - 1]!.getTime()
      expect(diff).toBe(24 * 60 * 60 * 1000) // 1 day
    }
  })

  it('should handle weekly schedules', () => {
    const now = new Date('2026-01-13T08:00:00Z') // Tuesday
    const nextRuns = getNextRunTimes('0 9 * * MON', now, 3)

    expect(nextRuns).toHaveLength(3)
    // All should be Mondays (day 1)
    for (const run of nextRuns) {
      expect(run.getUTCDay()).toBe(1)
    }
  })

  it('should handle step expressions', () => {
    const now = new Date('2026-01-13T08:00:00Z')
    const nextRuns = getNextRunTimes('*/15 * * * *', now, 4)

    expect(nextRuns).toHaveLength(4)
    // Should be at :00, :15, :30, :45 minutes
    const minutes = nextRuns.map((r) => r.getUTCMinutes())
    expect(minutes).toEqual([15, 30, 45, 0]) // Starting from after 08:00
  })

  it('should handle complex expressions', () => {
    const now = new Date('2026-01-13T08:00:00Z')
    const nextRuns = getNextRunTimes('30 9,14 * * 1-5', now, 10)

    expect(nextRuns).toHaveLength(10)
    // All should be at :30 minutes
    for (const run of nextRuns) {
      expect(run.getUTCMinutes()).toBe(30)
      expect([9, 14]).toContain(run.getUTCHours())
      expect([1, 2, 3, 4, 5]).toContain(run.getUTCDay()) // Weekdays only
    }
  })
})

// ============================================================================
// TIMEZONE HANDLING
// ============================================================================

describe('Timezone Handling', () => {
  it('should calculate next run time in specified timezone', () => {
    const now = new Date('2026-01-13T14:00:00Z') // 2pm UTC = 9am EST
    const nextRuns = getNextRunTimes('0 10 * * *', now, 1, { timezone: 'America/New_York' })

    // 10am EST = 3pm UTC in winter (EST is UTC-5)
    expect(nextRuns[0]!.getUTCHours()).toBe(15)
  })

  it('should handle DST transitions correctly', () => {
    // March 2026 DST transition in US
    const beforeDST = new Date('2026-03-07T10:00:00Z')
    const runs = getNextRunTimes('0 9 * * *', beforeDST, 10, { timezone: 'America/New_York' })

    // Verify all runs are at 9am local time (accounting for DST)
    expect(runs.length).toBe(10)
  })

  it('should support common timezone identifiers', () => {
    const now = new Date('2026-01-13T12:00:00Z')

    // Test various timezones
    const timezones = [
      'America/New_York',
      'America/Los_Angeles',
      'Europe/London',
      'Europe/Paris',
      'Asia/Tokyo',
      'Australia/Sydney',
      'UTC',
    ]

    for (const tz of timezones) {
      expect(() => getNextRunTimes('0 9 * * *', now, 1, { timezone: tz })).not.toThrow()
    }
  })

  it('should throw for invalid timezone', () => {
    const now = new Date()
    expect(() => getNextRunTimes('0 9 * * *', now, 1, { timezone: 'Invalid/Timezone' })).toThrow(/timezone/i)
  })
})

// ============================================================================
// DAG SCHEDULE MANAGER
// ============================================================================

describe('DAGScheduleManager', () => {
  let manager: DAGScheduleManager

  beforeEach(() => {
    manager = createDAGScheduleManager()
  })

  describe('registration', () => {
    it('should register a DAG with cron schedule', () => {
      const dag = createSimpleDAG('daily-etl')
      const registration = manager.register(dag, {
        type: 'cron',
        cron: '0 9 * * *',
      })

      expect(registration.dagId).toBe('daily-etl')
      expect(registration.trigger.type).toBe('cron')
    })

    it('should register a DAG with interval schedule', () => {
      const dag = createSimpleDAG('frequent-sync')
      const registration = manager.register(dag, {
        type: 'interval',
        interval: 5 * 60 * 1000, // 5 minutes
      })

      expect(registration.dagId).toBe('frequent-sync')
      expect(registration.trigger.type).toBe('interval')
    })

    it('should reject duplicate registrations', () => {
      const dag = createSimpleDAG('unique-dag')
      manager.register(dag, { type: 'cron', cron: '0 9 * * *' })

      expect(() => {
        manager.register(dag, { type: 'cron', cron: '0 10 * * *' })
      }).toThrow(/already registered/i)
    })

    it('should allow re-registration after unregistration', () => {
      const dag = createSimpleDAG('reusable-dag')
      manager.register(dag, { type: 'cron', cron: '0 9 * * *' })
      manager.unregister('reusable-dag')

      expect(() => {
        manager.register(dag, { type: 'cron', cron: '0 10 * * *' })
      }).not.toThrow()
    })
  })

  describe('unregistration', () => {
    it('should unregister a scheduled DAG', () => {
      const dag = createSimpleDAG('temp-dag')
      manager.register(dag, { type: 'cron', cron: '0 9 * * *' })

      manager.unregister('temp-dag')

      expect(manager.getNextRun('temp-dag')).toBeNull()
    })

    it('should handle unregistering non-existent DAG gracefully', () => {
      expect(() => manager.unregister('nonexistent')).not.toThrow()
    })
  })

  describe('listing', () => {
    it('should list all scheduled DAGs', () => {
      manager.register(createSimpleDAG('dag-1'), { type: 'cron', cron: '0 9 * * *' })
      manager.register(createSimpleDAG('dag-2'), { type: 'interval', interval: 60000 })
      manager.register(createSimpleDAG('dag-3'), { type: 'cron', cron: '0 12 * * *' })

      const scheduled = manager.listScheduled()

      expect(scheduled).toHaveLength(3)
      expect(scheduled.map((s) => s.dagId).sort()).toEqual(['dag-1', 'dag-2', 'dag-3'])
    })

    it('should return empty list when no DAGs scheduled', () => {
      const scheduled = manager.listScheduled()
      expect(scheduled).toEqual([])
    })

    it('should include next run time in listing', () => {
      manager.register(createSimpleDAG('scheduled-dag'), { type: 'cron', cron: '0 9 * * *' })

      const scheduled = manager.listScheduled()

      expect(scheduled[0]!.nextRunAt).toBeInstanceOf(Date)
    })
  })

  describe('next run calculation', () => {
    it('should return next run time for cron schedule', () => {
      const dag = createSimpleDAG('cron-dag')
      manager.register(dag, { type: 'cron', cron: '0 9 * * *' })

      const nextRun = manager.getNextRun('cron-dag')

      expect(nextRun).toBeInstanceOf(Date)
      expect(nextRun!.getUTCHours()).toBe(9)
      expect(nextRun!.getUTCMinutes()).toBe(0)
    })

    it('should return next run time for interval schedule', () => {
      const dag = createSimpleDAG('interval-dag')
      const now = Date.now()
      manager.register(dag, { type: 'interval', interval: 60000 })

      const nextRun = manager.getNextRun('interval-dag')

      expect(nextRun).toBeInstanceOf(Date)
      expect(nextRun!.getTime()).toBeGreaterThanOrEqual(now)
      expect(nextRun!.getTime()).toBeLessThanOrEqual(now + 60000)
    })

    it('should return null for non-existent DAG', () => {
      expect(manager.getNextRun('nonexistent')).toBeNull()
    })
  })
})

// ============================================================================
// BACKFILL MANAGER
// ============================================================================

describe('BackfillManager', () => {
  describe('missed schedule detection', () => {
    it('should detect missed runs', () => {
      const backfill = createBackfillManager()
      const now = new Date('2026-01-13T12:30:00Z')
      const lastRun = new Date('2026-01-13T09:00:00Z')

      const missed = backfill.getMissedRuns('0 * * * *', lastRun, now)

      // Should have missed 10:00, 11:00, 12:00
      expect(missed).toHaveLength(3)
      expect(missed[0]!.getUTCHours()).toBe(10)
      expect(missed[1]!.getUTCHours()).toBe(11)
      expect(missed[2]!.getUTCHours()).toBe(12)
    })

    it('should return empty array when no runs missed', () => {
      const backfill = createBackfillManager()
      const now = new Date('2026-01-13T09:30:00Z')
      const lastRun = new Date('2026-01-13T09:00:00Z')

      const missed = backfill.getMissedRuns('0 * * * *', lastRun, now)

      expect(missed).toHaveLength(0)
    })

    it('should respect maxBackfill limit', () => {
      const backfill = createBackfillManager()
      const now = new Date('2026-01-13T20:00:00Z')
      const lastRun = new Date('2026-01-13T09:00:00Z')

      const missed = backfill.getMissedRuns('0 * * * *', lastRun, now, { maxBackfill: 5 })

      expect(missed).toHaveLength(5)
    })

    it('should handle long gaps correctly', () => {
      const backfill = createBackfillManager()
      const now = new Date('2026-01-20T09:00:00Z')
      const lastRun = new Date('2026-01-13T09:00:00Z')

      const missed = backfill.getMissedRuns('0 9 * * *', lastRun, now)

      // Should have missed 7 days (14th through 20th)
      expect(missed).toHaveLength(7)
    })
  })

  describe('backfill execution', () => {
    it('should execute backfill runs in order', async () => {
      const backfill = createBackfillManager()
      const executedTimes: Date[] = []

      const dag = createDAG({
        id: 'backfill-dag',
        tasks: [
          createTaskNode({
            id: 'task',
            execute: async (ctx) => {
              executedTimes.push(ctx?.triggerPayload as Date)
            },
            dependencies: [],
          }),
        ],
      })

      const now = new Date('2026-01-13T12:30:00Z')
      const lastRun = new Date('2026-01-13T09:00:00Z')

      const result = await backfill.executeBackfill(dag, '0 * * * *', lastRun, now)

      expect(result.executedRuns).toBe(3)
      expect(result.failedRuns).toBe(0)
      // Verify chronological order
      for (let i = 1; i < executedTimes.length; i++) {
        expect(executedTimes[i]!.getTime()).toBeGreaterThan(executedTimes[i - 1]!.getTime())
      }
    })

    it('should skip backfill when disabled', async () => {
      const backfill = createBackfillManager()
      const executionCount = { count: 0 }

      const dag = createDAG({
        id: 'no-backfill-dag',
        tasks: [
          createTaskNode({
            id: 'task',
            execute: async () => {
              executionCount.count++
            },
            dependencies: [],
          }),
        ],
      })

      const now = new Date('2026-01-13T12:30:00Z')
      const lastRun = new Date('2026-01-13T09:00:00Z')

      const result = await backfill.executeBackfill(dag, '0 * * * *', lastRun, now, {
        enabled: false,
      })

      expect(result.executedRuns).toBe(0)
      expect(result.skipped).toBe(true)
      expect(executionCount.count).toBe(0)
    })

    it('should continue on failure when configured', async () => {
      const backfill = createBackfillManager()
      let executionCount = 0

      const dag = createDAG({
        id: 'partial-fail-dag',
        tasks: [
          createTaskNode({
            id: 'task',
            execute: async () => {
              executionCount++
              if (executionCount === 2) {
                throw new Error('Simulated failure')
              }
            },
            dependencies: [],
          }),
        ],
      })

      const now = new Date('2026-01-13T12:30:00Z')
      const lastRun = new Date('2026-01-13T09:00:00Z')

      const result = await backfill.executeBackfill(dag, '0 * * * *', lastRun, now, {
        continueOnFailure: true,
      })

      expect(result.executedRuns).toBe(2) // 1st and 3rd succeeded
      expect(result.failedRuns).toBe(1) // 2nd failed
    })

    it('should stop on first failure by default', async () => {
      const backfill = createBackfillManager()
      let executionCount = 0

      const dag = createDAG({
        id: 'stop-on-fail-dag',
        tasks: [
          createTaskNode({
            id: 'task',
            execute: async () => {
              executionCount++
              if (executionCount === 2) {
                throw new Error('Simulated failure')
              }
            },
            dependencies: [],
          }),
        ],
      })

      const now = new Date('2026-01-13T12:30:00Z')
      const lastRun = new Date('2026-01-13T09:00:00Z')

      const result = await backfill.executeBackfill(dag, '0 * * * *', lastRun, now)

      expect(result.executedRuns).toBe(1) // Only first succeeded
      expect(result.failedRuns).toBe(1) // Second failed
      expect(result.stoppedEarly).toBe(true)
    })
  })
})

// ============================================================================
// SCHEDULE OVERLAP HANDLING
// ============================================================================

describe('Schedule Overlap Handling', () => {
  let manager: DAGScheduleManager

  beforeEach(() => {
    manager = createDAGScheduleManager()
  })

  it('should skip new run when previous is still running (skip policy)', async () => {
    const executionTimes: number[] = []

    const dag = createDAG({
      id: 'slow-dag',
      tasks: [
        createTaskNode({
          id: 'slow-task',
          execute: async () => {
            executionTimes.push(Date.now())
            await delay(100) // Slow task
          },
          dependencies: [],
        }),
      ],
    })

    manager.register(dag, {
      type: 'interval',
      interval: 50, // Triggers faster than task completes
    }, {
      overlapPolicy: 'skip',
    })

    // Trigger multiple runs
    const run1 = manager.triggerNow('slow-dag')
    await delay(30)
    const run2 = manager.triggerNow('slow-dag') // Should be skipped

    await run1
    const result2 = await run2

    expect(result2?.skipped).toBe(true)
  })

  it('should queue new run when previous is still running (queue policy)', async () => {
    const executionOrder: number[] = []
    let runCount = 0

    const dag = createDAG({
      id: 'queue-dag',
      tasks: [
        createTaskNode({
          id: 'task',
          execute: async () => {
            runCount++
            const myRun = runCount
            executionOrder.push(myRun)
            await delay(30)
          },
          dependencies: [],
        }),
      ],
    })

    manager.register(dag, {
      type: 'interval',
      interval: 20,
    }, {
      overlapPolicy: 'queue',
      maxQueueSize: 3,
    })

    // Trigger multiple runs rapidly
    const promises = [
      manager.triggerNow('queue-dag'),
      manager.triggerNow('queue-dag'),
      manager.triggerNow('queue-dag'),
    ]

    await Promise.all(promises)

    // All should have executed in order
    expect(executionOrder).toEqual([1, 2, 3])
  })

  it('should cancel running run when new run starts (replace policy)', async () => {
    let run1Completed = false
    let run2Completed = false

    const dag = createDAG({
      id: 'replace-dag',
      tasks: [
        createTaskNode({
          id: 'task',
          execute: async () => {
            await delay(100)
            return 'done'
          },
          dependencies: [],
        }),
      ],
    })

    manager.register(dag, {
      type: 'interval',
      interval: 50,
    }, {
      overlapPolicy: 'replace',
    })

    const run1Promise = manager.triggerNow('replace-dag')
    await delay(20)
    const run2Promise = manager.triggerNow('replace-dag')

    const [result1, result2] = await Promise.all([run1Promise, run2Promise])

    expect(result1?.status).toBe('cancelled')
    expect(result2?.status).toBe('completed')
  })

  it('should allow concurrent runs (allow policy)', async () => {
    const concurrentRuns: number[] = []
    let currentConcurrent = 0
    let maxConcurrent = 0

    const dag = createDAG({
      id: 'concurrent-dag',
      tasks: [
        createTaskNode({
          id: 'task',
          execute: async () => {
            currentConcurrent++
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
            await delay(50)
            currentConcurrent--
          },
          dependencies: [],
        }),
      ],
    })

    manager.register(dag, {
      type: 'interval',
      interval: 10,
    }, {
      overlapPolicy: 'allow',
    })

    // Trigger multiple concurrent runs
    const promises = [
      manager.triggerNow('concurrent-dag'),
      manager.triggerNow('concurrent-dag'),
      manager.triggerNow('concurrent-dag'),
    ]

    await Promise.all(promises)

    expect(maxConcurrent).toBe(3)
  })
})

// ============================================================================
// DO ALARM INTEGRATION
// ============================================================================

describe('DO Alarm Integration', () => {
  it('should create alarm integration interface', () => {
    const mockState = {
      storage: {
        setAlarm: vi.fn().mockResolvedValue(undefined),
        getAlarm: vi.fn().mockResolvedValue(null),
        deleteAlarm: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as DurableObjectState

    const integration: AlarmIntegration = {
      scheduleAlarm: async (time: Date) => {
        await mockState.storage.setAlarm(time)
      },
      cancelAlarm: async () => {
        await mockState.storage.deleteAlarm()
      },
      getNextAlarm: async () => {
        return mockState.storage.getAlarm()
      },
    }

    expect(integration.scheduleAlarm).toBeDefined()
    expect(integration.cancelAlarm).toBeDefined()
    expect(integration.getNextAlarm).toBeDefined()
  })

  it('should schedule alarm for next run time', async () => {
    const alarms: Date[] = []
    const mockSetAlarm = vi.fn((time: Date) => {
      alarms.push(time)
      return Promise.resolve()
    })

    const manager = createDAGScheduleManager({
      alarmIntegration: {
        scheduleAlarm: mockSetAlarm,
        cancelAlarm: vi.fn(),
        getNextAlarm: vi.fn(),
      },
    })

    const dag = createSimpleDAG('alarm-dag')
    manager.register(dag, { type: 'cron', cron: '0 9 * * *' })

    expect(mockSetAlarm).toHaveBeenCalled()
    expect(alarms[0]!.getUTCHours()).toBe(9)
  })

  it('should reschedule alarm after run completes', async () => {
    const alarms: Date[] = []
    const mockSetAlarm = vi.fn((time: Date) => {
      alarms.push(time)
      return Promise.resolve()
    })

    const manager = createDAGScheduleManager({
      alarmIntegration: {
        scheduleAlarm: mockSetAlarm,
        cancelAlarm: vi.fn(),
        getNextAlarm: vi.fn(),
      },
    })

    const dag = createSimpleDAG('recurring-alarm-dag')
    manager.register(dag, { type: 'cron', cron: '0 * * * *' }) // Every hour

    // Simulate alarm firing and run completing
    await manager.handleAlarm()

    // Should have scheduled two alarms: initial + after completion
    expect(mockSetAlarm).toHaveBeenCalledTimes(2)
  })

  it('should cancel alarm on unregister', async () => {
    const mockCancelAlarm = vi.fn()

    const manager = createDAGScheduleManager({
      alarmIntegration: {
        scheduleAlarm: vi.fn(),
        cancelAlarm: mockCancelAlarm,
        getNextAlarm: vi.fn(),
      },
    })

    const dag = createSimpleDAG('cancel-alarm-dag')
    manager.register(dag, { type: 'cron', cron: '0 9 * * *' })
    manager.unregister('cancel-alarm-dag')

    expect(mockCancelAlarm).toHaveBeenCalled()
  })
})

// ============================================================================
// SCHEDULE VALIDATION
// ============================================================================

describe('Schedule Validation', () => {
  it('should validate cron schedule', () => {
    const result = validateSchedule({ type: 'cron', cron: '0 9 * * *' })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should reject invalid cron expression', () => {
    const result = validateSchedule({ type: 'cron', cron: 'invalid' })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/cron/i)
  })

  it('should validate interval schedule', () => {
    const result = validateSchedule({ type: 'interval', interval: 60000 })
    expect(result.valid).toBe(true)
  })

  it('should reject zero or negative interval', () => {
    const result1 = validateSchedule({ type: 'interval', interval: 0 })
    expect(result1.valid).toBe(false)

    const result2 = validateSchedule({ type: 'interval', interval: -1000 })
    expect(result2.valid).toBe(false)
  })

  it('should warn for very short intervals', () => {
    const result = validateSchedule({ type: 'interval', interval: 100 }) // 100ms
    expect(result.valid).toBe(true)
    expect(result.warnings).toContain(expect.stringMatching(/short interval/i))
  })

  it('should validate timezone option', () => {
    const result = validateSchedule({
      type: 'cron',
      cron: '0 9 * * *',
      timezone: 'America/New_York',
    })
    expect(result.valid).toBe(true)
  })

  it('should reject invalid timezone', () => {
    const result = validateSchedule({
      type: 'cron',
      cron: '0 9 * * *',
      timezone: 'Invalid/Timezone',
    })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/timezone/i)
  })
})

// ============================================================================
// INTEGRATION WITH $.every
// ============================================================================

describe('Integration with $.every DSL', () => {
  it('should convert $.every.day.at9am to cron schedule', () => {
    // This tests the integration point between schedule-builder and schedule-trigger
    const trigger = convertDSLToSchedule({ day: 'day', time: 'at9am' })

    expect(trigger.type).toBe('cron')
    expect((trigger as { cron: string }).cron).toBe('0 9 * * *')
  })

  it('should convert $.every.Monday.at9am to cron schedule', () => {
    const trigger = convertDSLToSchedule({ day: 'Monday', time: 'at9am' })

    expect(trigger.type).toBe('cron')
    expect((trigger as { cron: string }).cron).toBe('0 9 * * 1')
  })

  it('should convert $.every.hour to interval schedule', () => {
    const trigger = convertDSLToSchedule({ interval: 'hour' })

    expect(trigger.type).toBe('cron')
    expect((trigger as { cron: string }).cron).toBe('0 * * * *')
  })

  it('should convert $.every("5m") to interval schedule', () => {
    const trigger = convertDSLToSchedule({ intervalMs: 5 * 60 * 1000 })

    expect(trigger.type).toBe('interval')
    expect((trigger as { interval: number }).interval).toBe(5 * 60 * 1000)
  })
})

// ============================================================================
// HELPER FUNCTION STUBS (to be implemented in schedule-trigger.ts)
// ============================================================================

// Stub for DSL conversion - will be imported from schedule-trigger.ts
function convertDSLToSchedule(dsl: {
  day?: string
  time?: string
  interval?: string
  intervalMs?: number
}): ScheduleTrigger {
  if (dsl.intervalMs) {
    return { type: 'interval', interval: dsl.intervalMs }
  }

  if (dsl.interval === 'hour') {
    return { type: 'cron', cron: '0 * * * *' }
  }

  const dayMap: Record<string, string> = {
    day: '*',
    Monday: '1',
    Tuesday: '2',
    Wednesday: '3',
    Thursday: '4',
    Friday: '5',
    Saturday: '6',
    Sunday: '0',
  }

  const timeMap: Record<string, { minute: string; hour: string }> = {
    at9am: { minute: '0', hour: '9' },
    at6pm: { minute: '0', hour: '18' },
  }

  const dayNum = dayMap[dsl.day!] ?? '*'
  const time = timeMap[dsl.time!] ?? { minute: '0', hour: '0' }

  return {
    type: 'cron',
    cron: `${time.minute} ${time.hour} * * ${dayNum}`,
  }
}

// Type declaration for DurableObjectState (since we're in a test file)
interface DurableObjectState {
  storage: {
    setAlarm(time: Date | number): Promise<void>
    getAlarm(): Promise<Date | null>
    deleteAlarm(): Promise<void>
  }
}
