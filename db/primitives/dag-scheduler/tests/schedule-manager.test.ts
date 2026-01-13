/**
 * DAGScheduleManager Tests
 *
 * Tests for cron and schedule triggers for DAG execution.
 *
 * TDD GREEN phase - implementation to pass:
 * - Parse cron expressions correctly
 * - Calculate next run time with timezone
 * - Trigger DAG at scheduled time
 * - Handle catchup for missed runs
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createDAGScheduleManager,
  createDAGScheduleEveryProxy,
  type DAGScheduleManager,
  type ScheduledDAG,
  type ScheduledRunEvent,
} from '../schedule-manager'
import { createDAG, createTaskNode, type DAG, type ScheduleTrigger } from '../index'

// ============================================================================
// MOCK DO STATE
// ============================================================================

function createMockStorage() {
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
    },
    alarms,
    _storage: storage,
  }
}

function createMockState() {
  const { storage, alarms, _storage } = createMockStorage()
  return {
    id: { toString: () => 'test-dag-schedule-manager-id' },
    storage,
    alarms,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { alarms: { time: number | null }; _storage: Map<string, unknown> }
}

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

// ============================================================================
// DAG SCHEDULE MANAGER - REGISTRATION
// ============================================================================

describe('DAGScheduleManager', () => {
  let mockState: ReturnType<typeof createMockState>
  let manager: DAGScheduleManager

  beforeEach(() => {
    mockState = createMockState()
    manager = createDAGScheduleManager({ state: mockState })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-12T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('register', () => {
    it('should register a DAG with cron trigger', async () => {
      const dag = createSimpleDAG('my-dag')
      const trigger: ScheduleTrigger = {
        type: 'cron',
        cron: '0 9 * * *', // Every day at 9am
      }

      const schedule = await manager.register(dag, trigger)

      expect(schedule.dagId).toBe('my-dag')
      expect(schedule.trigger).toEqual(trigger)
      expect(schedule.status).toBe('active')
      expect(schedule.runCount).toBe(0)
    })

    it('should calculate next run time on registration', async () => {
      const dag = createSimpleDAG('my-dag')
      const trigger: ScheduleTrigger = {
        type: 'cron',
        cron: '0 15 * * *', // Every day at 3pm
      }

      const schedule = await manager.register(dag, trigger)

      // Current time is 12:00, so next run is today at 15:00
      expect(schedule.nextRunAt).toEqual(new Date('2026-01-12T15:00:00.000Z'))
    })

    it('should set DO alarm on registration', async () => {
      const dag = createSimpleDAG('my-dag')
      const trigger: ScheduleTrigger = {
        type: 'cron',
        cron: '0 15 * * *',
      }

      await manager.register(dag, trigger)

      expect(mockState.storage.setAlarm).toHaveBeenCalled()
      expect(mockState.alarms.time).toBe(new Date('2026-01-12T15:00:00.000Z').getTime())
    })

    it('should reject duplicate DAG registration', async () => {
      const dag = createSimpleDAG('my-dag')
      const trigger: ScheduleTrigger = { type: 'cron', cron: '0 9 * * *' }

      await manager.register(dag, trigger)
      await expect(manager.register(dag, trigger)).rejects.toThrow(/already registered/)
    })

    it('should register DAG as paused when specified', async () => {
      const dag = createSimpleDAG('my-dag')
      const trigger: ScheduleTrigger = { type: 'cron', cron: '0 9 * * *' }

      const schedule = await manager.register(dag, trigger, { paused: true })

      expect(schedule.status).toBe('paused')
      expect(schedule.nextRunAt).toBeNull()
    })

    it('should register DAG with interval trigger', async () => {
      const dag = createSimpleDAG('interval-dag')
      const trigger: ScheduleTrigger = {
        type: 'interval',
        interval: 5 * 60 * 1000, // 5 minutes
      }

      const schedule = await manager.register(dag, trigger)

      expect(schedule.trigger.type).toBe('interval')
      // Next run should be 5 minutes from now
      expect(schedule.nextRunAt).toEqual(new Date('2026-01-12T12:05:00.000Z'))
    })
  })

  describe('unregister', () => {
    it('should unregister a DAG', async () => {
      const dag = createSimpleDAG('my-dag')
      await manager.register(dag, { type: 'cron', cron: '0 9 * * *' })

      await manager.unregister('my-dag')

      const schedule = await manager.getScheduled('my-dag')
      expect(schedule).toBeNull()
    })

    it('should throw when unregistering non-existent DAG', async () => {
      await expect(manager.unregister('non-existent')).rejects.toThrow(/not registered/)
    })

    it('should update alarm after unregister', async () => {
      const dag1 = createSimpleDAG('dag-1')
      const dag2 = createSimpleDAG('dag-2')
      await manager.register(dag1, { type: 'cron', cron: '0 9 * * *' })
      await manager.register(dag2, { type: 'cron', cron: '0 15 * * *' })

      await manager.unregister('dag-2')

      // Alarm should be set to dag-1's next run (tomorrow at 9am since it's 12pm now)
      expect(mockState.alarms.time).toBe(new Date('2026-01-13T09:00:00.000Z').getTime())
    })
  })

  describe('getNextRun', () => {
    it('should return next run time for registered DAG', async () => {
      const dag = createSimpleDAG('my-dag')
      await manager.register(dag, { type: 'cron', cron: '0 15 * * *' })

      const nextRun = await manager.getNextRun('my-dag')

      expect(nextRun).toEqual(new Date('2026-01-12T15:00:00.000Z'))
    })

    it('should return null for non-existent DAG', async () => {
      const nextRun = await manager.getNextRun('non-existent')
      expect(nextRun).toBeNull()
    })

    it('should return null for paused DAG', async () => {
      const dag = createSimpleDAG('my-dag')
      await manager.register(dag, { type: 'cron', cron: '0 15 * * *' }, { paused: true })

      const nextRun = await manager.getNextRun('my-dag')
      expect(nextRun).toBeNull()
    })
  })

  describe('listScheduled', () => {
    it('should list all scheduled DAGs', async () => {
      const dag1 = createSimpleDAG('dag-1')
      const dag2 = createSimpleDAG('dag-2')
      await manager.register(dag1, { type: 'cron', cron: '0 9 * * *' })
      await manager.register(dag2, { type: 'cron', cron: '0 15 * * *' })

      const schedules = await manager.listScheduled()

      expect(schedules).toHaveLength(2)
      expect(schedules.map(s => s.dagId).sort()).toEqual(['dag-1', 'dag-2'])
    })

    it('should filter by status', async () => {
      const dag1 = createSimpleDAG('dag-1')
      const dag2 = createSimpleDAG('dag-2')
      await manager.register(dag1, { type: 'cron', cron: '0 9 * * *' })
      await manager.register(dag2, { type: 'cron', cron: '0 15 * * *' }, { paused: true })

      const activeSchedules = await manager.listScheduled({ status: 'active' })
      const pausedSchedules = await manager.listScheduled({ status: 'paused' })

      expect(activeSchedules).toHaveLength(1)
      expect(activeSchedules[0]!.dagId).toBe('dag-1')
      expect(pausedSchedules).toHaveLength(1)
      expect(pausedSchedules[0]!.dagId).toBe('dag-2')
    })

    it('should return empty array when no DAGs registered', async () => {
      const schedules = await manager.listScheduled()
      expect(schedules).toEqual([])
    })
  })

  describe('pause and resume', () => {
    it('should pause a scheduled DAG', async () => {
      const dag = createSimpleDAG('my-dag')
      await manager.register(dag, { type: 'cron', cron: '0 15 * * *' })

      await manager.pause('my-dag')

      const schedule = await manager.getScheduled('my-dag')
      expect(schedule?.status).toBe('paused')
      expect(schedule?.nextRunAt).toBeNull()
    })

    it('should resume a paused DAG', async () => {
      const dag = createSimpleDAG('my-dag')
      await manager.register(dag, { type: 'cron', cron: '0 15 * * *' }, { paused: true })

      await manager.resume('my-dag')

      const schedule = await manager.getScheduled('my-dag')
      expect(schedule?.status).toBe('active')
      expect(schedule?.nextRunAt).toEqual(new Date('2026-01-12T15:00:00.000Z'))
    })

    it('should throw when pausing non-existent DAG', async () => {
      await expect(manager.pause('non-existent')).rejects.toThrow(/not registered/)
    })

    it('should throw when resuming non-existent DAG', async () => {
      await expect(manager.resume('non-existent')).rejects.toThrow(/not registered/)
    })
  })

  describe('updateTrigger', () => {
    it('should update DAG trigger', async () => {
      const dag = createSimpleDAG('my-dag')
      await manager.register(dag, { type: 'cron', cron: '0 9 * * *' })

      const updated = await manager.updateTrigger('my-dag', { type: 'cron', cron: '0 18 * * *' })

      expect(updated.trigger.cron).toBe('0 18 * * *')
      // Next run should be today at 6pm
      expect(updated.nextRunAt).toEqual(new Date('2026-01-12T18:00:00.000Z'))
    })

    it('should throw when updating non-existent DAG', async () => {
      await expect(manager.updateTrigger('non-existent', { type: 'cron', cron: '0 9 * * *' })).rejects.toThrow(/not registered/)
    })
  })
})

// ============================================================================
// CRON PARSING AND NEXT RUN CALCULATION
// ============================================================================

describe('Cron Schedule Triggers', () => {
  let mockState: ReturnType<typeof createMockState>
  let manager: DAGScheduleManager

  beforeEach(() => {
    mockState = createMockState()
    manager = createDAGScheduleManager({ state: mockState })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-12T12:00:00.000Z')) // Monday, noon UTC
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('cron expression parsing', () => {
    it('should schedule daily at 9am', async () => {
      const dag = createSimpleDAG('daily-9am')
      const schedule = await manager.register(dag, {
        type: 'cron',
        cron: '0 9 * * *',
      })

      // 9am has passed today, so next run is tomorrow
      expect(schedule.nextRunAt).toEqual(new Date('2026-01-13T09:00:00.000Z'))
    })

    it('should schedule weekly on Monday at 9am', async () => {
      const dag = createSimpleDAG('weekly-monday')
      const schedule = await manager.register(dag, {
        type: 'cron',
        cron: '0 9 * * 1', // Monday
      })

      // It's Monday 12pm, so next Monday at 9am is next week
      expect(schedule.nextRunAt).toEqual(new Date('2026-01-19T09:00:00.000Z'))
    })

    it('should schedule every 15 minutes', async () => {
      const dag = createSimpleDAG('every-15min')
      const schedule = await manager.register(dag, {
        type: 'cron',
        cron: '*/15 * * * *',
      })

      // Current time is 12:00, next 15min interval is 12:15
      expect(schedule.nextRunAt).toEqual(new Date('2026-01-12T12:15:00.000Z'))
    })

    it('should schedule first day of month at 6am', async () => {
      const dag = createSimpleDAG('monthly')
      const schedule = await manager.register(dag, {
        type: 'cron',
        cron: '0 6 1 * *',
      })

      // Jan 12, so next 1st is Feb 1
      expect(schedule.nextRunAt).toEqual(new Date('2026-02-01T06:00:00.000Z'))
    })
  })

  describe('timezone support', () => {
    it('should calculate next run with timezone', async () => {
      const dag = createSimpleDAG('tz-dag')
      const schedule = await manager.register(dag, {
        type: 'cron',
        cron: '0 9 * * *',
        timezone: 'America/New_York',
      })

      // 9am EST = 14:00 UTC (during standard time)
      // Current time is 12:00 UTC, so 9am EST today is 14:00 UTC
      expect(schedule.nextRunAt).toEqual(new Date('2026-01-12T14:00:00.000Z'))
    })
  })
})

// ============================================================================
// ALARM HANDLING AND EXECUTION
// ============================================================================

describe('handleAlarm', () => {
  let mockState: ReturnType<typeof createMockState>
  let manager: DAGScheduleManager
  let runEvents: ScheduledRunEvent[]

  beforeEach(() => {
    mockState = createMockState()
    runEvents = []
    manager = createDAGScheduleManager({
      state: mockState,
      onRun: (event) => {
        runEvents.push(event)
      },
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-12T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should execute DAG when alarm fires', async () => {
    const dag = createSimpleDAG('alarm-dag')
    await manager.register(dag, { type: 'cron', cron: '0 12 * * *' })

    // Fast forward to scheduled time
    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'))
    const results = await manager.handleAlarm()

    expect(results).toHaveLength(1)
    expect(results[0]!.dagId).toBe('alarm-dag')
    expect(results[0]!.status).toBe('completed')
  })

  it('should fire onRun callback', async () => {
    const dag = createSimpleDAG('callback-dag')
    await manager.register(dag, { type: 'cron', cron: '0 12 * * *' })

    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'))
    await manager.handleAlarm()

    expect(runEvents).toHaveLength(1)
    expect(runEvents[0]!.dagId).toBe('callback-dag')
    expect(runEvents[0]!.isCatchup).toBe(false)
  })

  it('should update lastRunAt and runCount after execution', async () => {
    const dag = createSimpleDAG('run-count-dag')
    await manager.register(dag, { type: 'cron', cron: '0 12 * * *' })

    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'))
    await manager.handleAlarm()

    const schedule = await manager.getScheduled('run-count-dag')
    expect(schedule?.lastRunAt).toEqual(new Date('2026-01-13T12:00:00.000Z'))
    expect(schedule?.runCount).toBe(1)
  })

  it('should reschedule alarm after execution', async () => {
    const dag = createSimpleDAG('reschedule-dag')
    await manager.register(dag, { type: 'cron', cron: '0 12 * * *' })

    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'))
    await manager.handleAlarm()

    const schedule = await manager.getScheduled('reschedule-dag')
    // Next run should be tomorrow at noon
    expect(schedule?.nextRunAt).toEqual(new Date('2026-01-14T12:00:00.000Z'))
  })

  it('should not execute paused DAGs', async () => {
    const dag = createSimpleDAG('paused-dag')
    await manager.register(dag, { type: 'cron', cron: '0 12 * * *' })
    await manager.pause('paused-dag')

    vi.setSystemTime(new Date('2026-01-13T12:00:00.000Z'))
    const results = await manager.handleAlarm()

    expect(results).toHaveLength(0)
  })
})

// ============================================================================
// CATCHUP HANDLING
// ============================================================================

describe('Catchup for missed runs', () => {
  let mockState: ReturnType<typeof createMockState>
  let manager: DAGScheduleManager
  let runEvents: ScheduledRunEvent[]

  beforeEach(() => {
    mockState = createMockState()
    runEvents = []
    manager = createDAGScheduleManager({
      state: mockState,
      onRun: (event) => {
        runEvents.push(event)
      },
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-12T09:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should catch up missed runs when enabled', async () => {
    const dag = createSimpleDAG('catchup-dag')
    // Set up the schedule with a time that will be in the past
    await manager.register(dag, {
      type: 'cron',
      cron: '0 * * * *', // Every hour
      catchup: true,
    })

    // Simulate last run was 3 hours ago by manipulating the stored schedule
    const schedule = await manager.getScheduled('catchup-dag')
    if (schedule) {
      schedule.lastRunAt = new Date('2026-01-12T06:00:00.000Z')
      // Set nextRunAt to 9am (current time) so handleAlarm will process it
      schedule.nextRunAt = new Date('2026-01-12T09:00:00.000Z')
      await mockState.storage.put('dag-schedule:catchup-dag', schedule)
    }

    // Fast forward to 9am - should catch up 7am, 8am, and run 9am
    vi.setSystemTime(new Date('2026-01-12T09:00:00.000Z'))
    const results = await manager.handleAlarm()

    // Should have executed - catchup runs for 7am, 8am, plus the scheduled 9am run
    expect(results.length).toBeGreaterThanOrEqual(1)
    // At least one should be a catchup run (7am and/or 8am)
    const catchupRuns = results.filter(r => r.isCatchup)
    expect(catchupRuns.length).toBeGreaterThan(0)
  })

  it('should not catch up when disabled', async () => {
    const dag = createSimpleDAG('no-catchup-dag')
    await manager.register(dag, {
      type: 'cron',
      cron: '0 * * * *',
      catchup: false, // explicitly disabled
    })

    // Simulate last run was 3 hours ago
    const schedule = await manager.getScheduled('no-catchup-dag')
    if (schedule) {
      schedule.lastRunAt = new Date('2026-01-12T06:00:00.000Z')
      schedule.nextRunAt = new Date('2026-01-12T09:00:00.000Z')
      await mockState.storage.put('dag-schedule:no-catchup-dag', schedule)
    }

    vi.setSystemTime(new Date('2026-01-12T09:00:00.000Z'))
    const results = await manager.handleAlarm()

    // Should only execute once (no catchup)
    expect(results.every(r => !r.isCatchup)).toBe(true)
  })
})

// ============================================================================
// FLUENT API - $.every.day.at('9am').run(myDAG)
// ============================================================================

describe('Fluent API Integration', () => {
  let mockState: ReturnType<typeof createMockState>
  let manager: DAGScheduleManager

  beforeEach(() => {
    mockState = createMockState()
    manager = createDAGScheduleManager({ state: mockState })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-12T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('$.every.day.at(time).run(dag)', () => {
    it("should schedule $.every.day.at('9am').run(dag)", async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('fluent-dag')

      const schedule = await every.day.at('9am').run(dag)

      expect(schedule.trigger.type).toBe('cron')
      expect(schedule.trigger.type === 'cron' && schedule.trigger.cron).toBe('0 9 * * *')
    })

    it('should schedule $.every.day.at9am.run(dag)', async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('fluent-dag')

      const schedule = await every.day.at9am.run(dag)

      expect(schedule.trigger.type === 'cron' && schedule.trigger.cron).toBe('0 9 * * *')
    })

    it("should schedule $.every.day.at('noon').run(dag)", async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('noon-dag')

      const schedule = await every.day.at('noon').run(dag)

      expect(schedule.trigger.cron).toBe('0 12 * * *')
    })

    it("should schedule $.every.day.at('9:30am').run(dag)", async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('time-dag')

      const schedule = await every.day.at('9:30am').run(dag)

      expect(schedule.trigger.cron).toBe('30 9 * * *')
    })
  })

  describe('$.every.{Day}.at(time).run(dag)', () => {
    it("should schedule $.every.Monday.at('9am').run(dag)", async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('monday-dag')

      const schedule = await every.Monday.at('9am').run(dag)

      expect(schedule.trigger.cron).toBe('0 9 * * 1')
    })

    it('should schedule $.every.Friday.at5pm.run(dag)', async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('friday-dag')

      const schedule = await every.Friday.at5pm.run(dag)

      expect(schedule.trigger.cron).toBe('0 17 * * 5')
    })

    it("should schedule $.every.weekday.at('8am').run(dag)", async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('weekday-dag')

      const schedule = await every.weekday.at('8am').run(dag)

      expect(schedule.trigger.cron).toBe('0 8 * * 1-5')
    })

    it("should schedule $.every.weekend.at('10am').run(dag)", async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('weekend-dag')

      const schedule = await every.weekend.at('10am').run(dag)

      expect(schedule.trigger.cron).toBe('0 10 * * 0,6')
    })
  })

  describe("$.every('interval').run(dag)", () => {
    it("should schedule $.every('5m').run(dag)", async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('interval-dag')

      const schedule = await every('5m').run(dag)

      expect(schedule.trigger.type).toBe('interval')
      expect(schedule.trigger.interval).toBe(5 * 60 * 1000)
    })

    it("should schedule $.every('1h').run(dag)", async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('hourly-dag')

      const schedule = await every('1h').run(dag)

      expect(schedule.trigger.interval).toBe(60 * 60 * 1000)
    })

    it("should schedule $.every('30s').run(dag)", async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('seconds-dag')

      const schedule = await every('30s').run(dag)

      expect(schedule.trigger.interval).toBe(30 * 1000)
    })
  })

  describe('$.every.hour/minute shortcuts', () => {
    it('should schedule $.every.hour.run(dag)', async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('hourly-dag')

      const schedule = await every.hour.run(dag)

      expect(schedule.trigger.cron).toBe('0 * * * *')
    })

    it('should schedule $.every.minute.run(dag)', async () => {
      const every = createDAGScheduleEveryProxy(manager)
      const dag = createSimpleDAG('minute-dag')

      const schedule = await every.minute.run(dag)

      expect(schedule.trigger.cron).toBe('* * * * *')
    })
  })

  describe('options', () => {
    it('should apply timezone option', async () => {
      const every = createDAGScheduleEveryProxy(manager, { timezone: 'America/New_York' })
      const dag = createSimpleDAG('tz-dag')

      const schedule = await every.day.at('9am').run(dag)

      expect(schedule.trigger.timezone).toBe('America/New_York')
    })

    it('should apply catchup option', async () => {
      const every = createDAGScheduleEveryProxy(manager, { catchup: true })
      const dag = createSimpleDAG('catchup-dag')

      const schedule = await every.day.at('9am').run(dag)

      expect(schedule.trigger.catchup).toBe(true)
    })
  })
})

// ============================================================================
// MANUAL TRIGGER
// ============================================================================

describe('Manual trigger', () => {
  let mockState: ReturnType<typeof createMockState>
  let manager: DAGScheduleManager

  beforeEach(() => {
    mockState = createMockState()
    manager = createDAGScheduleManager({ state: mockState })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-12T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should manually trigger a DAG', async () => {
    const dag = createSimpleDAG('manual-dag')
    await manager.register(dag, { type: 'cron', cron: '0 9 * * *' })

    const run = await manager.trigger('manual-dag')

    expect(run.status).toBe('completed')
    expect(run.dagId).toBe('manual-dag')
  })

  it('should throw when triggering non-existent DAG', async () => {
    await expect(manager.trigger('non-existent')).rejects.toThrow(/not found/)
  })
})

// ============================================================================
// INTERVAL TRIGGERS
// ============================================================================

describe('Interval triggers', () => {
  let mockState: ReturnType<typeof createMockState>
  let manager: DAGScheduleManager

  beforeEach(() => {
    mockState = createMockState()
    manager = createDAGScheduleManager({ state: mockState })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-12T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should schedule next run at current time + interval', async () => {
    const dag = createSimpleDAG('interval-dag')
    const schedule = await manager.register(dag, {
      type: 'interval',
      interval: 5 * 60 * 1000, // 5 minutes
    })

    expect(schedule.nextRunAt).toEqual(new Date('2026-01-12T12:05:00.000Z'))
  })

  it('should reschedule after execution', async () => {
    const dag = createSimpleDAG('interval-dag')
    await manager.register(dag, {
      type: 'interval',
      interval: 5 * 60 * 1000,
    })

    // Fast forward 5 minutes
    vi.setSystemTime(new Date('2026-01-12T12:05:00.000Z'))
    await manager.handleAlarm()

    const schedule = await manager.getScheduled('interval-dag')
    expect(schedule?.nextRunAt).toEqual(new Date('2026-01-12T12:10:00.000Z'))
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge cases', () => {
  let mockState: ReturnType<typeof createMockState>
  let manager: DAGScheduleManager

  beforeEach(() => {
    mockState = createMockState()
    manager = createDAGScheduleManager({ state: mockState })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-12T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should handle multiple DAGs with same schedule', async () => {
    const dag1 = createSimpleDAG('dag-1')
    const dag2 = createSimpleDAG('dag-2')

    await manager.register(dag1, { type: 'cron', cron: '0 9 * * *' })
    await manager.register(dag2, { type: 'cron', cron: '0 9 * * *' })

    const schedules = await manager.listScheduled()
    expect(schedules).toHaveLength(2)
  })

  it('should select earliest alarm when multiple schedules exist', async () => {
    const dag1 = createSimpleDAG('dag-1')
    const dag2 = createSimpleDAG('dag-2')

    await manager.register(dag1, { type: 'cron', cron: '0 15 * * *' }) // 3pm today
    await manager.register(dag2, { type: 'cron', cron: '0 9 * * *' })  // 9am tomorrow

    // Alarm should be set to 3pm today (earliest)
    expect(mockState.alarms.time).toBe(new Date('2026-01-12T15:00:00.000Z').getTime())
  })

  it('should clear alarm when last DAG is unregistered', async () => {
    const dag = createSimpleDAG('only-dag')
    await manager.register(dag, { type: 'cron', cron: '0 9 * * *' })

    await manager.unregister('only-dag')

    expect(mockState.alarms.time).toBeNull()
  })
})
