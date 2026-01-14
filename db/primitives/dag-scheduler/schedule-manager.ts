/**
 * DAGScheduleManager - Manages scheduled DAG execution
 *
 * Provides:
 * - Registration of DAGs with cron/interval triggers
 * - Next run time calculation with timezone support
 * - DO alarm integration for execution
 * - Catchup handling for missed runs
 * - Integration with $.every fluent API
 *
 * @module db/primitives/dag-scheduler/schedule-manager
 */

/// <reference types="@cloudflare/workers-types" />

import type { DAG, DAGRun, ScheduleTrigger, CronScheduleTrigger, IntervalScheduleTrigger, EventScheduleTrigger, ParallelExecutor } from './index'
import { createCronTrigger, createParallelExecutor } from './index'

// ============================================================================
// TYPES
// ============================================================================

/** Scheduled DAG entry */
export interface ScheduledDAG {
  dagId: string
  dag: DAG
  trigger: ScheduleTrigger
  nextRunAt: Date | null
  lastRunAt: Date | null
  runCount: number
  status: 'active' | 'paused'
  createdAt: Date
  updatedAt: Date
}

/** Options for registering a DAG */
export interface RegisterOptions {
  /** Start paused (won't schedule until resumed) */
  paused?: boolean
}

/** Result of a scheduled execution */
export interface ScheduledRunResult {
  dagId: string
  runId: string
  status: 'completed' | 'failed' | 'cancelled'
  startedAt: Date
  completedAt: Date
  isCatchup: boolean
}

/** Event emitted when a scheduled DAG runs */
export interface ScheduledRunEvent {
  type: 'scheduled-run'
  dagId: string
  run: DAGRun
  isCatchup: boolean
  scheduledAt: Date
  actualAt: Date
}

/** DAGScheduleManager configuration */
export interface DAGScheduleManagerConfig {
  state: DurableObjectState
  executor?: ParallelExecutor
  onRun?: (event: ScheduledRunEvent) => void | Promise<void>
}

// ============================================================================
// STORAGE KEYS
// ============================================================================

const SCHEDULE_PREFIX = 'dag-schedule:'
const LAST_RUN_PREFIX = 'dag-last-run:'

function scheduleKey(dagId: string): string {
  return `${SCHEDULE_PREFIX}${dagId}`
}

function lastRunKey(dagId: string): string {
  return `${LAST_RUN_PREFIX}${dagId}`
}

// ============================================================================
// DAG SCHEDULE MANAGER INTERFACE
// ============================================================================

export interface DAGScheduleManager {
  /**
   * Register a DAG with a schedule trigger
   */
  register(dag: DAG, trigger: ScheduleTrigger, options?: RegisterOptions): Promise<ScheduledDAG>

  /**
   * Unregister a DAG from scheduling
   */
  unregister(dagId: string): Promise<void>

  /**
   * Get the next scheduled run time for a DAG
   */
  getNextRun(dagId: string): Promise<Date | null>

  /**
   * List all scheduled DAGs
   */
  listScheduled(filter?: { status?: 'active' | 'paused' }): Promise<ScheduledDAG[]>

  /**
   * Pause a scheduled DAG
   */
  pause(dagId: string): Promise<void>

  /**
   * Resume a paused DAG
   */
  resume(dagId: string): Promise<void>

  /**
   * Manually trigger a DAG run
   */
  trigger(dagId: string): Promise<DAGRun>

  /**
   * Handle DO alarm - triggers due schedules
   */
  handleAlarm(): Promise<ScheduledRunResult[]>

  /**
   * Get a scheduled DAG by ID
   */
  getScheduled(dagId: string): Promise<ScheduledDAG | null>

  /**
   * Update a DAG's trigger
   */
  updateTrigger(dagId: string, trigger: ScheduleTrigger): Promise<ScheduledDAG>
}

// ============================================================================
// NEXT RUN CALCULATION
// ============================================================================

function calculateNextRunFromTrigger(trigger: ScheduleTrigger, from: Date = new Date()): Date | null {
  switch (trigger.type) {
    case 'cron': {
      const cronTrigger = createCronTrigger(trigger.cron!, {
        timezone: trigger.timezone,
        catchup: trigger.catchup,
      })
      return cronTrigger.getNextRun(from)
    }
    case 'interval': {
      const interval = (trigger as IntervalScheduleTrigger).interval
      return new Date(from.getTime() + interval)
    }
    case 'event': {
      // Event triggers don't have a scheduled time - they fire on events
      return null
    }
    default:
      return null
  }
}

function getMissedRunsFromTrigger(trigger: ScheduleTrigger, lastRun: Date, now: Date): Date[] {
  if (trigger.type !== 'cron' || !trigger.catchup) {
    return []
  }

  const cronTrigger = createCronTrigger(trigger.cron!, {
    timezone: trigger.timezone,
    catchup: true,
  })

  return cronTrigger.getMissedRuns(lastRun, now)
}

// ============================================================================
// DAG SCHEDULE MANAGER IMPLEMENTATION
// ============================================================================

export function createDAGScheduleManager(config: DAGScheduleManagerConfig): DAGScheduleManager {
  const { state, onRun } = config
  const storage = state.storage
  const executor = config.executor ?? createParallelExecutor()

  // In-memory cache of registered DAGs (for running them)
  const dagRegistry = new Map<string, DAG>()

  /**
   * Update the DO alarm to fire at the next scheduled time
   */
  async function updateAlarm(): Promise<void> {
    const schedules = await listScheduledInternal({ status: 'active' })

    if (schedules.length === 0) {
      await storage.deleteAlarm()
      return
    }

    // Find the earliest next run time
    let earliestTime: Date | null = null
    for (const schedule of schedules) {
      if (schedule.nextRunAt) {
        if (!earliestTime || schedule.nextRunAt.getTime() < earliestTime.getTime()) {
          earliestTime = schedule.nextRunAt
        }
      }
    }

    if (earliestTime) {
      await storage.setAlarm(earliestTime)
    } else {
      await storage.deleteAlarm()
    }
  }

  /**
   * Internal list function that doesn't require await
   */
  async function listScheduledInternal(filter?: { status?: 'active' | 'paused' }): Promise<ScheduledDAG[]> {
    const map = await storage.list({ prefix: SCHEDULE_PREFIX })
    const schedules: ScheduledDAG[] = []

    for (const [, value] of map) {
      const schedule = value as ScheduledDAG
      if (!filter?.status || schedule.status === filter.status) {
        schedules.push(schedule)
      }
    }

    return schedules
  }

  /**
   * Execute a scheduled DAG
   */
  async function executeScheduledDAG(schedule: ScheduledDAG, isCatchup: boolean): Promise<ScheduledRunResult> {
    const dag = dagRegistry.get(schedule.dagId)
    if (!dag) {
      throw new Error(`DAG '${schedule.dagId}' not found in registry`)
    }

    const startedAt = new Date()
    const run = await executor.execute(dag)

    // Update last run time and run count
    const now = new Date()
    schedule.lastRunAt = now
    schedule.runCount += 1
    schedule.nextRunAt = calculateNextRunFromTrigger(schedule.trigger, now)
    schedule.updatedAt = now

    await storage.put(scheduleKey(schedule.dagId), schedule)
    await storage.put(lastRunKey(schedule.dagId), now.toISOString())

    // Fire callback
    if (onRun) {
      const event: ScheduledRunEvent = {
        type: 'scheduled-run',
        dagId: schedule.dagId,
        run,
        isCatchup,
        scheduledAt: schedule.lastRunAt,
        actualAt: startedAt,
      }
      await onRun(event)
    }

    return {
      dagId: schedule.dagId,
      runId: run.runId,
      status: run.status === 'completed' ? 'completed' : run.status === 'cancelled' ? 'cancelled' : 'failed',
      startedAt,
      completedAt: now,
      isCatchup,
    }
  }

  return {
    async register(dag: DAG, trigger: ScheduleTrigger, options?: RegisterOptions): Promise<ScheduledDAG> {
      // Check for duplicate
      const existing = await storage.get(scheduleKey(dag.id))
      if (existing) {
        throw new Error(`DAG '${dag.id}' is already registered`)
      }

      // Register DAG in memory
      dagRegistry.set(dag.id, dag)

      const now = new Date()
      const isPaused = options?.paused ?? false
      const nextRunAt = isPaused ? null : calculateNextRunFromTrigger(trigger, now)

      const schedule: ScheduledDAG = {
        dagId: dag.id,
        dag,
        trigger,
        nextRunAt,
        lastRunAt: null,
        runCount: 0,
        status: isPaused ? 'paused' : 'active',
        createdAt: now,
        updatedAt: now,
      }

      await storage.put(scheduleKey(dag.id), schedule)

      if (!isPaused) {
        await updateAlarm()
      }

      return schedule
    },

    async unregister(dagId: string): Promise<void> {
      const existing = await storage.get(scheduleKey(dagId))
      if (!existing) {
        throw new Error(`DAG '${dagId}' is not registered`)
      }

      dagRegistry.delete(dagId)
      await storage.delete(scheduleKey(dagId))
      await storage.delete(lastRunKey(dagId))
      await updateAlarm()
    },

    async getNextRun(dagId: string): Promise<Date | null> {
      const schedule = await storage.get(scheduleKey(dagId)) as ScheduledDAG | undefined
      return schedule?.nextRunAt ?? null
    },

    async listScheduled(filter?: { status?: 'active' | 'paused' }): Promise<ScheduledDAG[]> {
      return listScheduledInternal(filter)
    },

    async pause(dagId: string): Promise<void> {
      const schedule = await storage.get(scheduleKey(dagId)) as ScheduledDAG | undefined
      if (!schedule) {
        throw new Error(`DAG '${dagId}' is not registered`)
      }

      schedule.status = 'paused'
      schedule.nextRunAt = null
      schedule.updatedAt = new Date()

      await storage.put(scheduleKey(dagId), schedule)
      await updateAlarm()
    },

    async resume(dagId: string): Promise<void> {
      const schedule = await storage.get(scheduleKey(dagId)) as ScheduledDAG | undefined
      if (!schedule) {
        throw new Error(`DAG '${dagId}' is not registered`)
      }

      const now = new Date()
      schedule.status = 'active'
      schedule.nextRunAt = calculateNextRunFromTrigger(schedule.trigger, now)
      schedule.updatedAt = now

      await storage.put(scheduleKey(dagId), schedule)
      await updateAlarm()
    },

    async trigger(dagId: string): Promise<DAGRun> {
      const dag = dagRegistry.get(dagId)
      if (!dag) {
        throw new Error(`DAG '${dagId}' not found in registry`)
      }

      return executor.execute(dag)
    },

    async handleAlarm(): Promise<ScheduledRunResult[]> {
      const now = new Date()
      const schedules = await listScheduledInternal({ status: 'active' })
      const results: ScheduledRunResult[] = []

      // Find all schedules due to run
      for (const schedule of schedules) {
        if (!schedule.nextRunAt) continue
        if (schedule.nextRunAt.getTime() > now.getTime()) continue

        // Handle catchup for missed runs
        if (schedule.trigger.type === 'cron' && schedule.trigger.catchup && schedule.lastRunAt) {
          const missedRuns = getMissedRunsFromTrigger(schedule.trigger, schedule.lastRunAt, now)
          for (const missedTime of missedRuns) {
            const result = await executeScheduledDAG(schedule, true)
            results.push(result)
          }
        }

        // Execute the scheduled run
        const result = await executeScheduledDAG(schedule, false)
        results.push(result)
      }

      // Update alarm for next schedules
      await updateAlarm()

      return results
    },

    async getScheduled(dagId: string): Promise<ScheduledDAG | null> {
      const schedule = await storage.get(scheduleKey(dagId)) as ScheduledDAG | undefined
      return schedule ?? null
    },

    async updateTrigger(dagId: string, trigger: ScheduleTrigger): Promise<ScheduledDAG> {
      const schedule = await storage.get(scheduleKey(dagId)) as ScheduledDAG | undefined
      if (!schedule) {
        throw new Error(`DAG '${dagId}' is not registered`)
      }

      const now = new Date()
      schedule.trigger = trigger
      schedule.nextRunAt = schedule.status === 'active' ? calculateNextRunFromTrigger(trigger, now) : null
      schedule.updatedAt = now

      await storage.put(scheduleKey(dagId), schedule)
      await updateAlarm()

      return schedule
    },
  }
}

// ============================================================================
// FLUENT API INTEGRATION - $.every.day.at('9am').run(myDAG)
// ============================================================================

export interface DAGScheduleBuilder {
  run(dag: DAG): Promise<ScheduledDAG>
}

export interface DAGScheduleTimeProxy {
  (dag: DAG): Promise<ScheduledDAG>
  at(time: string): DAGScheduleBuilder
  at6am: DAGScheduleBuilder
  at7am: DAGScheduleBuilder
  at8am: DAGScheduleBuilder
  at9am: DAGScheduleBuilder
  at10am: DAGScheduleBuilder
  at11am: DAGScheduleBuilder
  at12pm: DAGScheduleBuilder
  at1pm: DAGScheduleBuilder
  at2pm: DAGScheduleBuilder
  at3pm: DAGScheduleBuilder
  at4pm: DAGScheduleBuilder
  at5pm: DAGScheduleBuilder
  at6pm: DAGScheduleBuilder
  atnoon: DAGScheduleBuilder
  atmidnight: DAGScheduleBuilder
}

export interface DAGScheduleEveryProxy {
  (interval: string): DAGScheduleBuilder
  Monday: DAGScheduleTimeProxy
  Tuesday: DAGScheduleTimeProxy
  Wednesday: DAGScheduleTimeProxy
  Thursday: DAGScheduleTimeProxy
  Friday: DAGScheduleTimeProxy
  Saturday: DAGScheduleTimeProxy
  Sunday: DAGScheduleTimeProxy
  day: DAGScheduleTimeProxy
  weekday: DAGScheduleTimeProxy
  weekend: DAGScheduleTimeProxy
  hour: DAGScheduleBuilder
  minute: DAGScheduleBuilder
}

// ============================================================================
// DAY AND TIME MAPPINGS
// ============================================================================

const DAYS: Record<string, string> = {
  Sunday: '0',
  Monday: '1',
  Tuesday: '2',
  Wednesday: '3',
  Thursday: '4',
  Friday: '5',
  Saturday: '6',
  day: '*',
  weekday: '1-5',
  weekend: '0,6',
}

const TIMES: Record<string, { minute: string; hour: string }> = {
  at6am: { minute: '0', hour: '6' },
  at7am: { minute: '0', hour: '7' },
  at8am: { minute: '0', hour: '8' },
  at9am: { minute: '0', hour: '9' },
  at10am: { minute: '0', hour: '10' },
  at11am: { minute: '0', hour: '11' },
  at12pm: { minute: '0', hour: '12' },
  at1pm: { minute: '0', hour: '13' },
  at2pm: { minute: '0', hour: '14' },
  at3pm: { minute: '0', hour: '15' },
  at4pm: { minute: '0', hour: '16' },
  at5pm: { minute: '0', hour: '17' },
  at6pm: { minute: '0', hour: '18' },
  atnoon: { minute: '0', hour: '12' },
  atmidnight: { minute: '0', hour: '0' },
}

/**
 * Parse a time string like '9am', '9:30am', 'noon', 'midnight'
 */
function parseTime(timeStr: string): { minute: string; hour: string } {
  const lower = timeStr.toLowerCase().trim()

  if (lower === 'noon') return { minute: '0', hour: '12' }
  if (lower === 'midnight') return { minute: '0', hour: '0' }

  const match = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}`)
  }

  let hour = parseInt(match[1]!, 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const meridiem = match[3]

  if (meridiem) {
    if (hour < 1 || hour > 12) throw new Error(`Invalid hour: ${hour}`)
    if (meridiem === 'pm' && hour !== 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
  } else {
    if (hour < 0 || hour > 23) throw new Error(`Invalid hour: ${hour}`)
  }

  return { minute: String(minute), hour: String(hour) }
}

/**
 * Parse interval string like '5m', '1h', '30s'
 */
function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)\s*(s|m|h|d)$/)
  if (!match) {
    throw new Error(`Invalid interval format: ${interval}`)
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2]

  switch (unit) {
    case 's': return value * 1000
    case 'm': return value * 60 * 1000
    case 'h': return value * 60 * 60 * 1000
    case 'd': return value * 24 * 60 * 60 * 1000
    default: throw new Error(`Unknown interval unit: ${unit}`)
  }
}

/**
 * Convert day and time to cron expression
 */
function toCron(day: string, time?: string | { minute: string; hour: string }): string {
  const dayNum = DAYS[day] ?? '*'

  if (day === 'hour') return '0 * * * *'
  if (day === 'minute') return '* * * * *'

  if (!time) return `0 0 * * ${dayNum}`

  if (typeof time === 'string') {
    const timeInfo = TIMES[time]
    if (timeInfo) {
      return `${timeInfo.minute} ${timeInfo.hour} * * ${dayNum}`
    }
    const parsed = parseTime(time)
    return `${parsed.minute} ${parsed.hour} * * ${dayNum}`
  }

  return `${time.minute} ${time.hour} * * ${dayNum}`
}

/**
 * Create a fluent API proxy for DAG scheduling
 *
 * Usage:
 * ```typescript
 * const every = createDAGScheduleEveryProxy(manager)
 * await every.day.at('9am').run(myDAG)
 * await every.Monday.at9am.run(myDAG)
 * await every('5m').run(myDAG)
 * ```
 */
export function createDAGScheduleEveryProxy(
  manager: DAGScheduleManager,
  options?: { timezone?: string; catchup?: boolean }
): DAGScheduleEveryProxy {
  const createScheduleBuilder = (cron: string): DAGScheduleBuilder => ({
    run: (dag: DAG) => manager.register(dag, {
      type: 'cron',
      cron,
      timezone: options?.timezone,
      catchup: options?.catchup ?? false,
    }),
  })

  const createIntervalBuilder = (interval: number): DAGScheduleBuilder => ({
    run: (dag: DAG) => manager.register(dag, {
      type: 'interval',
      interval,
    }),
  })

  const createTimeProxy = (day: string): DAGScheduleTimeProxy => {
    const baseHandler = (dag: DAG): Promise<ScheduledDAG> => {
      const cron = toCron(day)
      return manager.register(dag, {
        type: 'cron',
        cron,
        timezone: options?.timezone,
        catchup: options?.catchup ?? false,
      })
    }

    return new Proxy(baseHandler as DAGScheduleTimeProxy, {
      get(_, prop: string) {
        if (prop === 'at') {
          return (time: string): DAGScheduleBuilder => {
            const cron = toCron(day, time)
            return createScheduleBuilder(cron)
          }
        }

        if (TIMES[prop]) {
          const cron = toCron(day, prop)
          return createScheduleBuilder(cron)
        }

        return undefined
      },
    })
  }

  const baseHandler = (interval: string): DAGScheduleBuilder => {
    const ms = parseInterval(interval)
    return createIntervalBuilder(ms)
  }

  return new Proxy(baseHandler as DAGScheduleEveryProxy, {
    get(_, prop: string) {
      if (prop === 'hour') {
        return createScheduleBuilder('0 * * * *')
      }

      if (prop === 'minute') {
        return createScheduleBuilder('* * * * *')
      }

      if (DAYS[prop] !== undefined) {
        return createTimeProxy(prop)
      }

      return undefined
    },
  })
}

export default createDAGScheduleManager
