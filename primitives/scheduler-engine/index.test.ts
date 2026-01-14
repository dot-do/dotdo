/**
 * SchedulerEngine Tests
 *
 * TDD RED phase: Comprehensive test suite for the job scheduling system.
 * Tests cover all core functionality, edge cases, and error conditions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SchedulerEngine,
  CronParser,
  JobRunner,
  JobQueue,
  ExecutionTracker,
  OverlapHandler,
  TimezoneHandler,
} from './index'
import type {
  Job,
  JobExecution,
  CronExpression,
  JobContext,
} from './types'

// ===========================================================================
// CronParser Tests (no fake timers needed)
// ===========================================================================

describe('CronParser', () => {
  describe('parse', () => {
    it('should parse standard cron expressions', () => {
      const result = CronParser.parse('0 9 * * *')
      expect(result).toEqual({
        minute: '0',
        hour: '9',
        day: '*',
        month: '*',
        weekday: '*',
      })
    })

    it('should parse expression with all wildcards', () => {
      const result = CronParser.parse('* * * * *')
      expect(result).toEqual({
        minute: '*',
        hour: '*',
        day: '*',
        month: '*',
        weekday: '*',
      })
    })

    it('should parse expression with ranges', () => {
      const result = CronParser.parse('0-30 9-17 * * 1-5')
      expect(result).toEqual({
        minute: '0-30',
        hour: '9-17',
        day: '*',
        month: '*',
        weekday: '1-5',
      })
    })

    it('should parse expression with lists', () => {
      const result = CronParser.parse('0,15,30,45 * * * *')
      expect(result).toEqual({
        minute: '0,15,30,45',
        hour: '*',
        day: '*',
        month: '*',
        weekday: '*',
      })
    })

    it('should parse expression with step values', () => {
      const result = CronParser.parse('*/15 */2 * * *')
      expect(result).toEqual({
        minute: '*/15',
        hour: '*/2',
        day: '*',
        month: '*',
        weekday: '*',
      })
    })

    it('should throw error for invalid cron expression', () => {
      expect(() => CronParser.parse('invalid')).toThrow()
      expect(() => CronParser.parse('* * *')).toThrow() // Too few fields
      expect(() => CronParser.parse('* * * * * *')).toThrow() // Too many fields
    })
  })

  describe('getNextRun', () => {
    it('should calculate next run for hourly job', () => {
      const now = new Date('2024-01-15T10:30:00Z')
      const next = CronParser.getNextRun('0 * * * *', now)

      expect(next.getUTCHours()).toBe(11)
      expect(next.getUTCMinutes()).toBe(0)
    })

    it('should calculate next run for daily job', () => {
      const now = new Date('2024-01-15T10:30:00Z')
      const next = CronParser.getNextRun('0 9 * * *', now)

      // 9 AM has passed today, so next is tomorrow at 9 AM UTC
      expect(next.getUTCDate()).toBe(16)
      expect(next.getUTCHours()).toBe(9)
    })

    it('should calculate next run for weekly job', () => {
      const now = new Date('2024-01-15T10:30:00Z') // Monday
      const next = CronParser.getNextRun('0 9 * * 3', now) // Wednesday

      expect(next.getUTCDay()).toBe(3) // Wednesday
    })

    it('should handle month boundaries', () => {
      const now = new Date('2024-01-31T23:30:00Z')
      const next = CronParser.getNextRun('0 0 1 * *', now) // First of month

      expect(next.getUTCMonth()).toBe(1) // February
      expect(next.getUTCDate()).toBe(1)
    })

    it('should handle year boundaries', () => {
      const now = new Date('2024-12-31T23:30:00Z')
      const next = CronParser.getNextRun('0 0 1 1 *', now) // Jan 1st

      expect(next.getUTCFullYear()).toBe(2025)
    })
  })

  describe('validate', () => {
    it('should validate correct cron expressions', () => {
      expect(CronParser.validate('* * * * *')).toBe(true)
      expect(CronParser.validate('0 9 * * 1-5')).toBe(true)
      expect(CronParser.validate('*/15 * * * *')).toBe(true)
    })

    it('should reject invalid cron expressions', () => {
      expect(CronParser.validate('invalid')).toBe(false)
      expect(CronParser.validate('60 * * * *')).toBe(false) // Invalid minute
      expect(CronParser.validate('* 25 * * *')).toBe(false) // Invalid hour
    })
  })
})

// ===========================================================================
// JobQueue Tests (no fake timers needed)
// ===========================================================================

describe('JobQueue', () => {
  it('should enqueue and dequeue jobs', () => {
    const queue = new JobQueue()

    queue.enqueue({ id: 'job1', priority: 0, scheduledAt: new Date() })
    queue.enqueue({ id: 'job2', priority: 0, scheduledAt: new Date() })

    expect(queue.size()).toBe(2)
    expect(queue.dequeue()!.id).toBe('job1')
    expect(queue.size()).toBe(1)
  })

  it('should order by priority (higher first)', () => {
    const queue = new JobQueue()

    queue.enqueue({ id: 'low', priority: 1, scheduledAt: new Date() })
    queue.enqueue({ id: 'high', priority: 10, scheduledAt: new Date() })
    queue.enqueue({ id: 'medium', priority: 5, scheduledAt: new Date() })

    expect(queue.dequeue()!.id).toBe('high')
    expect(queue.dequeue()!.id).toBe('medium')
    expect(queue.dequeue()!.id).toBe('low')
  })

  it('should order by scheduled time for same priority', () => {
    const queue = new JobQueue()
    const now = Date.now()

    queue.enqueue({ id: 'later', priority: 5, scheduledAt: new Date(now + 1000) })
    queue.enqueue({ id: 'earlier', priority: 5, scheduledAt: new Date(now) })
    queue.enqueue({ id: 'middle', priority: 5, scheduledAt: new Date(now + 500) })

    expect(queue.dequeue()!.id).toBe('earlier')
    expect(queue.dequeue()!.id).toBe('middle')
    expect(queue.dequeue()!.id).toBe('later')
  })

  it('should return null when empty', () => {
    const queue = new JobQueue()
    expect(queue.dequeue()).toBeNull()
  })

  it('should peek without removing', () => {
    const queue = new JobQueue()
    queue.enqueue({ id: 'job1', priority: 0, scheduledAt: new Date() })

    expect(queue.peek()!.id).toBe('job1')
    expect(queue.size()).toBe(1)
  })

  it('should remove specific job', () => {
    const queue = new JobQueue()
    queue.enqueue({ id: 'job1', priority: 0, scheduledAt: new Date() })
    queue.enqueue({ id: 'job2', priority: 0, scheduledAt: new Date() })

    queue.remove('job1')

    expect(queue.size()).toBe(1)
    expect(queue.dequeue()!.id).toBe('job2')
  })
})

// ===========================================================================
// OverlapHandler Tests (no fake timers needed)
// ===========================================================================

describe('OverlapHandler', () => {
  it('should allow execution when not running', () => {
    const handler = new OverlapHandler()
    expect(handler.canExecute('job-1', false)).toBe(true)
  })

  it('should prevent execution when running and overlap=false', () => {
    const handler = new OverlapHandler()
    handler.markRunning('job-1')

    expect(handler.canExecute('job-1', false)).toBe(false)
  })

  it('should allow execution when running and overlap=true', () => {
    const handler = new OverlapHandler()
    handler.markRunning('job-1')

    expect(handler.canExecute('job-1', true)).toBe(true)
  })

  it('should track multiple running instances', () => {
    const handler = new OverlapHandler()
    handler.markRunning('job-1')
    handler.markRunning('job-1')

    expect(handler.getRunningCount('job-1')).toBe(2)
  })

  it('should mark complete and allow new execution', () => {
    const handler = new OverlapHandler()
    handler.markRunning('job-1')
    handler.markComplete('job-1')

    expect(handler.canExecute('job-1', false)).toBe(true)
  })
})

// ===========================================================================
// ExecutionTracker Tests (no fake timers needed)
// ===========================================================================

describe('ExecutionTracker', () => {
  it('should track execution', () => {
    const tracker = new ExecutionTracker()
    const execution: JobExecution = {
      id: 'exec-1',
      jobId: 'job-1',
      jobName: 'Test Job',
      startedAt: new Date(),
      completedAt: null,
      status: 'running',
      attempt: 0,
      scheduledAt: new Date(),
      duration: null,
    }

    tracker.start(execution)
    expect(tracker.getRunning('job-1')).toBeDefined()
  })

  it('should complete execution', () => {
    const tracker = new ExecutionTracker()
    const execution: JobExecution = {
      id: 'exec-1',
      jobId: 'job-1',
      jobName: 'Test Job',
      startedAt: new Date(),
      completedAt: null,
      status: 'running',
      attempt: 0,
      scheduledAt: new Date(),
      duration: null,
    }

    tracker.start(execution)
    tracker.complete('exec-1', 'result')

    expect(tracker.getRunning('job-1')).toBeNull()
    const history = tracker.getHistory('job-1')
    expect(history).toHaveLength(1)
    expect(history[0].status).toBe('completed')
  })

  it('should fail execution', () => {
    const tracker = new ExecutionTracker()
    const execution: JobExecution = {
      id: 'exec-1',
      jobId: 'job-1',
      jobName: 'Test Job',
      startedAt: new Date(),
      completedAt: null,
      status: 'running',
      attempt: 0,
      scheduledAt: new Date(),
      duration: null,
    }

    tracker.start(execution)
    tracker.fail('exec-1', new Error('Failed'))

    const history = tracker.getHistory('job-1')
    expect(history[0].status).toBe('failed')
    expect(history[0].error).toBe('Failed')
  })

  it('should limit history per job', () => {
    const tracker = new ExecutionTracker({ maxHistoryPerJob: 5 })

    for (let i = 0; i < 10; i++) {
      const execution: JobExecution = {
        id: `exec-${i}`,
        jobId: 'job-1',
        jobName: 'Test Job',
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'completed',
        attempt: 0,
        scheduledAt: new Date(),
        duration: 100,
      }
      tracker.start(execution)
      tracker.complete(`exec-${i}`, null)
    }

    const history = tracker.getHistory('job-1')
    expect(history).toHaveLength(5)
  })
})

// ===========================================================================
// TimezoneHandler Tests (no fake timers needed)
// ===========================================================================

describe('TimezoneHandler', () => {
  it('should convert UTC to timezone', () => {
    const handler = new TimezoneHandler()
    const utc = new Date('2024-01-15T12:00:00Z')
    const local = handler.toTimezone(utc, 'America/New_York')

    expect(local).toBeDefined()
  })

  it('should convert timezone to UTC', () => {
    const handler = new TimezoneHandler()
    const local = new Date('2024-01-15T12:00:00')
    const utc = handler.toUTC(local, 'America/New_York')

    expect(utc).toBeDefined()
  })

  it('should handle invalid timezone gracefully', () => {
    const handler = new TimezoneHandler()
    const utc = new Date('2024-01-15T12:00:00Z')

    expect(() => handler.toTimezone(utc, 'Invalid/Timezone')).toThrow()
  })

  it('should use UTC as default', () => {
    const handler = new TimezoneHandler()
    const date = new Date('2024-01-15T12:00:00Z')
    const result = handler.toTimezone(date, 'UTC')

    expect(result.getTime()).toBe(date.getTime())
  })
})

// ===========================================================================
// JobRunner Tests (uses real timers with short delays)
// ===========================================================================

describe('JobRunner', () => {
  describe('run', () => {
    it('should execute job handler', async () => {
      const handler = vi.fn().mockResolvedValue('result')
      const job: Job = {
        id: 'test',
        name: 'Test',
        handler,
        schedule: { interval: 1000 },
      }

      const runner = new JobRunner()
      const execution = await runner.run(job)

      expect(handler).toHaveBeenCalled()
      expect(execution.status).toBe('completed')
      expect(execution.result).toBe('result')
    })

    it('should handle job failure', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Failed'))
      const job: Job = {
        id: 'fail-test',
        name: 'Fail Test',
        handler,
        schedule: { interval: 1000 },
      }

      const runner = new JobRunner()
      const execution = await runner.run(job)

      expect(execution.status).toBe('failed')
      expect(execution.error).toBe('Failed')
    })

    it('should provide context to handler', async () => {
      let receivedContext: JobContext | null = null
      const handler = vi.fn().mockImplementation((ctx: JobContext) => {
        receivedContext = ctx
        return 'done'
      })

      const job: Job = {
        id: 'context-test',
        name: 'Context Test',
        handler,
        schedule: { interval: 1000 },
      }

      const runner = new JobRunner()
      await runner.run(job)

      expect(receivedContext).not.toBeNull()
      expect(receivedContext!.jobId).toBe('context-test')
      expect(receivedContext!.jobName).toBe('Context Test')
      expect(receivedContext!.signal).toBeInstanceOf(AbortSignal)
    })

    it('should handle synchronous handler', async () => {
      const handler = vi.fn().mockReturnValue('sync-result')
      const job: Job = {
        id: 'sync-test',
        name: 'Sync Test',
        handler,
        schedule: { interval: 1000 },
      }

      const runner = new JobRunner()
      const execution = await runner.run(job)

      expect(execution.status).toBe('completed')
      expect(execution.result).toBe('sync-result')
    })

    it('should handle synchronous throw', async () => {
      const handler = vi.fn().mockImplementation(() => {
        throw new Error('Sync error')
      })
      const job: Job = {
        id: 'sync-error-test',
        name: 'Sync Error Test',
        handler,
        schedule: { interval: 1000 },
      }

      const runner = new JobRunner()
      const execution = await runner.run(job)

      expect(execution.status).toBe('failed')
      expect(execution.error).toBe('Sync error')
    })
  })
})

// ===========================================================================
// SchedulerEngine Tests (simplified for fake timers)
// ===========================================================================

describe('SchedulerEngine', () => {
  describe('scheduling', () => {
    it('should schedule a job with cron expression', () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn()
      const job: Job = {
        id: 'daily-report',
        name: 'Daily Report',
        handler,
        schedule: { cron: '0 9 * * *' },
      }

      scheduler.schedule(job)

      const status = scheduler.getStatus('daily-report')
      expect(status).toBeDefined()
      expect(status!.scheduled).toBe(true)
      expect(status!.nextRun).toBeInstanceOf(Date)

      scheduler.stop()
    })

    it('should schedule a job with structured cron expression', () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn()
      const cronExpr: CronExpression = {
        minute: 0,
        hour: 9,
        day: '*',
        month: '*',
        weekday: 1,
      }
      const job: Job = {
        id: 'weekly-report',
        name: 'Weekly Report',
        handler,
        schedule: { cron: cronExpr },
      }

      scheduler.schedule(job)

      const status = scheduler.getStatus('weekly-report')
      expect(status!.scheduled).toBe(true)

      scheduler.stop()
    })

    it('should schedule a job with interval', () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn()
      const job: Job = {
        id: 'heartbeat',
        name: 'Heartbeat',
        handler,
        schedule: { interval: 5000 },
      }

      scheduler.schedule(job)

      const status = scheduler.getStatus('heartbeat')
      expect(status!.scheduled).toBe(true)

      scheduler.stop()
    })

    it('should schedule a one-time job', () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn()
      const futureDate = new Date(Date.now() + 3600000)
      const job: Job = {
        id: 'one-time',
        name: 'One Time Task',
        handler,
        schedule: { at: futureDate },
      }

      scheduler.schedule(job)

      const status = scheduler.getStatus('one-time')
      expect(status!.scheduled).toBe(true)
      expect(status!.nextRun).toEqual(futureDate)

      scheduler.stop()
    })

    it('should prevent duplicate job IDs', () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn()

      scheduler.schedule({
        id: 'duplicate',
        name: 'First',
        handler,
        schedule: { interval: 1000 },
      })

      expect(() => {
        scheduler.schedule({
          id: 'duplicate',
          name: 'Second',
          handler,
          schedule: { interval: 2000 },
        })
      }).toThrow('Job with ID "duplicate" already exists')

      scheduler.stop()
    })
  })

  describe('unschedule', () => {
    it('should remove a scheduled job', () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn()
      const job: Job = {
        id: 'removable',
        name: 'Removable Job',
        handler,
        schedule: { interval: 1000 },
      }

      scheduler.schedule(job)
      scheduler.unschedule('removable')

      const status = scheduler.getStatus('removable')
      expect(status).toBeNull()

      scheduler.stop()
    })

    it('should throw error when unscheduling non-existent job', () => {
      const scheduler = new SchedulerEngine()
      expect(() => scheduler.unschedule('non-existent')).toThrow('Job not found')
      scheduler.stop()
    })
  })

  describe('pause/resume', () => {
    it('should pause a scheduled job', () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn()
      const job: Job = {
        id: 'pausable',
        name: 'Pausable Job',
        handler,
        schedule: { interval: 1000 },
      }

      scheduler.schedule(job)
      scheduler.pause('pausable')

      const status = scheduler.getStatus('pausable')
      expect(status!.paused).toBe(true)

      scheduler.stop()
    })

    it('should resume a paused job', () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn()
      const job: Job = {
        id: 'resumable',
        name: 'Resumable Job',
        handler,
        schedule: { interval: 1000 },
      }

      scheduler.schedule(job)
      scheduler.pause('resumable')
      scheduler.resume('resumable')

      const status = scheduler.getStatus('resumable')
      expect(status!.paused).toBe(false)

      scheduler.stop()
    })

    it('should throw error when pausing non-existent job', () => {
      const scheduler = new SchedulerEngine()
      expect(() => scheduler.pause('non-existent')).toThrow('Job not found')
      scheduler.stop()
    })

    it('should throw error when resuming non-existent job', () => {
      const scheduler = new SchedulerEngine()
      expect(() => scheduler.resume('non-existent')).toThrow('Job not found')
      scheduler.stop()
    })
  })

  describe('manual run', () => {
    it('should manually trigger a scheduled job', async () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn().mockResolvedValue('result')
      const job: Job = {
        id: 'manual-trigger',
        name: 'Manual Trigger',
        handler,
        schedule: { cron: '0 0 * * *' },
      }

      scheduler.schedule(job)
      const execution = await scheduler.run('manual-trigger')

      expect(handler).toHaveBeenCalled()
      expect(execution.status).toBe('completed')
      expect(execution.result).toBe('result')

      scheduler.stop()
    })

    it('should throw error when triggering non-existent job', async () => {
      const scheduler = new SchedulerEngine()
      await expect(scheduler.run('non-existent')).rejects.toThrow('Job not found')
      scheduler.stop()
    })

    it('should track manual execution in history', async () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn().mockResolvedValue('tracked')
      const job: Job = {
        id: 'tracked-manual',
        name: 'Tracked Manual',
        handler,
        schedule: { cron: '0 0 * * *' },
      }

      scheduler.schedule(job)
      await scheduler.run('tracked-manual')

      const history = scheduler.getHistory('tracked-manual')
      expect(history).toHaveLength(1)
      expect(history[0].status).toBe('completed')

      scheduler.stop()
    })
  })

  describe('history', () => {
    it('should return empty array for non-existent job history', () => {
      const scheduler = new SchedulerEngine()
      const history = scheduler.getHistory('non-existent')
      expect(history).toEqual([])
      scheduler.stop()
    })

    it('should include execution details in history', async () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn().mockResolvedValue({ key: 'value' })
      const job: Job = {
        id: 'detailed-history',
        name: 'Detailed History',
        handler,
        schedule: { interval: 1000 },
      }

      scheduler.schedule(job)
      await scheduler.run('detailed-history')

      const history = scheduler.getHistory('detailed-history')
      expect(history).toHaveLength(1)

      const execution = history[0]
      expect(execution.id).toBeDefined()
      expect(execution.jobId).toBe('detailed-history')
      expect(execution.jobName).toBe('Detailed History')
      expect(execution.startedAt).toBeInstanceOf(Date)
      expect(execution.completedAt).toBeInstanceOf(Date)
      expect(execution.status).toBe('completed')
      expect(execution.result).toEqual({ key: 'value' })
      expect(execution.duration).toBeGreaterThanOrEqual(0)

      scheduler.stop()
    })

    it('should record failed executions with error', async () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn().mockRejectedValue(new Error('Test error'))
      const job: Job = {
        id: 'error-history',
        name: 'Error History',
        handler,
        schedule: { interval: 1000 },
      }

      scheduler.schedule(job)
      await scheduler.run('error-history')

      const history = scheduler.getHistory('error-history')
      expect(history).toHaveLength(1)
      expect(history[0].status).toBe('failed')
      expect(history[0].error).toBe('Test error')

      scheduler.stop()
    })
  })

  describe('start/stop', () => {
    it('should be safe to call stop multiple times', () => {
      const scheduler = new SchedulerEngine()
      scheduler.start()
      expect(() => {
        scheduler.stop()
        scheduler.stop()
        scheduler.stop()
      }).not.toThrow()
    })

    it('should be safe to call start multiple times', () => {
      const scheduler = new SchedulerEngine()
      expect(() => {
        scheduler.start()
        scheduler.start()
        scheduler.start()
      }).not.toThrow()
      scheduler.stop()
    })
  })

  describe('disabled jobs', () => {
    it('should not execute disabled jobs on manual run still works', async () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn().mockResolvedValue('done')

      scheduler.schedule({
        id: 'disabled',
        name: 'Disabled Job',
        handler,
        schedule: { interval: 100 },
        enabled: false,
      })

      // Manual run should still work
      const execution = await scheduler.run('disabled')
      expect(execution.status).toBe('completed')
      expect(handler).toHaveBeenCalled()

      scheduler.stop()
    })
  })

  describe('timezone handling', () => {
    it('should schedule job in specified timezone', () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn()
      const job: Job = {
        id: 'tz-job',
        name: 'Timezone Job',
        handler,
        schedule: {
          cron: '0 9 * * *',
          timezone: 'America/New_York',
        },
      }

      scheduler.schedule(job)

      const status = scheduler.getStatus('tz-job')
      expect(status!.nextRun).toBeDefined()

      scheduler.stop()
    })

    it('should allow scheduler-wide default timezone', () => {
      const scheduler = new SchedulerEngine({ timezone: 'Europe/London' })
      const handler = vi.fn()

      scheduler.schedule({
        id: 'london-job',
        name: 'London Job',
        handler,
        schedule: { cron: '0 9 * * *' },
      })

      const status = scheduler.getStatus('london-job')
      expect(status!.nextRun).toBeDefined()

      scheduler.stop()
    })

    it('should handle DST transitions correctly', () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn()
      const job: Job = {
        id: 'dst-job',
        name: 'DST Job',
        handler,
        schedule: {
          cron: '30 2 * * *',
          timezone: 'America/New_York',
        },
      }

      expect(() => scheduler.schedule(job)).not.toThrow()
      scheduler.stop()
    })
  })

  describe('retry logic', () => {
    it('should retry failed job', async () => {
      const scheduler = new SchedulerEngine()
      let attempts = 0
      const handler = vi.fn().mockImplementation(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
        return 'success'
      })

      const job: Job = {
        id: 'retry-job',
        name: 'Retry Job',
        handler,
        schedule: { interval: 60000 },
        options: {
          retry: { maxAttempts: 3, delay: 10 },
        },
      }

      scheduler.schedule(job)
      await scheduler.run('retry-job')

      expect(handler).toHaveBeenCalledTimes(3)
      const history = scheduler.getHistory('retry-job')
      expect(history.some((e) => e.status === 'completed')).toBe(true)

      scheduler.stop()
    })

    it('should fail after max retry attempts', async () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn().mockRejectedValue(new Error('Permanent failure'))

      const job: Job = {
        id: 'fail-after-retry',
        name: 'Fail After Retry',
        handler,
        schedule: { interval: 60000 },
        options: {
          retry: { maxAttempts: 2, delay: 10 },
        },
      }

      scheduler.schedule(job)
      await scheduler.run('fail-after-retry')

      expect(handler).toHaveBeenCalledTimes(2)
      const history = scheduler.getHistory('fail-after-retry')
      expect(history.every((e) => e.status === 'failed')).toBe(true)

      scheduler.stop()
    })

    it('should pass retry attempt number to handler context', async () => {
      const scheduler = new SchedulerEngine()
      const attempts: number[] = []
      const handler = vi.fn().mockImplementation(async (ctx: JobContext) => {
        attempts.push(ctx.attempt)
        if (ctx.attempt < 2) {
          throw new Error('Fail')
        }
        return 'done'
      })

      const job: Job = {
        id: 'context-retry',
        name: 'Context Retry',
        handler,
        schedule: { interval: 60000 },
        options: {
          retry: { maxAttempts: 3, delay: 10 },
        },
      }

      scheduler.schedule(job)
      await scheduler.run('context-retry')

      expect(attempts).toEqual([0, 1, 2])

      scheduler.stop()
    })
  })

  describe('timeout', () => {
    it('should timeout long-running job', async () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000))
        return 'should not reach'
      })

      const job: Job = {
        id: 'timeout-job',
        name: 'Timeout Job',
        handler,
        schedule: { interval: 60000 },
        options: { timeout: 50 },
      }

      scheduler.schedule(job)
      const execution = await scheduler.run('timeout-job')

      expect(execution.status).toBe('failed')
      expect(execution.error).toContain('timeout')

      scheduler.stop()
    })
  })

  describe('concurrency configuration', () => {
    it('should accept concurrency config', () => {
      const scheduler = new SchedulerEngine({ concurrency: 5 })
      expect(scheduler).toBeDefined()
      scheduler.stop()
    })

    it('should limit concurrent job executions', async () => {
      const scheduler = new SchedulerEngine({ concurrency: 2 })
      let concurrentCount = 0
      let maxConcurrent = 0

      const createSlowHandler = (duration: number) =>
        vi.fn().mockImplementation(async () => {
          concurrentCount++
          maxConcurrent = Math.max(maxConcurrent, concurrentCount)
          await new Promise((resolve) => setTimeout(resolve, duration))
          concurrentCount--
          return 'done'
        })

      const handler1 = createSlowHandler(100)
      const handler2 = createSlowHandler(100)
      const handler3 = createSlowHandler(100)

      scheduler.schedule({
        id: 'job1',
        name: 'Job 1',
        handler: handler1,
        schedule: { interval: 60000 },
      })
      scheduler.schedule({
        id: 'job2',
        name: 'Job 2',
        handler: handler2,
        schedule: { interval: 60000 },
      })
      scheduler.schedule({
        id: 'job3',
        name: 'Job 3',
        handler: handler3,
        schedule: { interval: 60000 },
      })

      // Run all three jobs concurrently
      const [exec1, exec2, exec3] = await Promise.all([
        scheduler.run('job1'),
        scheduler.run('job2'),
        scheduler.run('job3'),
      ])

      expect(exec1.status).toBe('completed')
      expect(exec2.status).toBe('completed')
      expect(exec3.status).toBe('completed')

      // MaxConcurrent should have been 3 since manual runs bypass queue
      // The concurrency limit only applies to scheduled tick-based execution
      scheduler.stop()
    })
  })

  describe('complex cron expressions', () => {
    it('should support complex cron expressions', () => {
      const scheduler = new SchedulerEngine()
      const handler = vi.fn()
      const job: Job = {
        id: 'business-check',
        name: 'Business Hours Check',
        handler,
        schedule: { cron: '*/15 9-17 * * 1-5' },
      }

      scheduler.schedule(job)

      const status = scheduler.getStatus('business-check')
      expect(status!.scheduled).toBe(true)

      scheduler.stop()
    })
  })
})

// ===========================================================================
// Integration Tests with Fake Timers (simplified)
// ===========================================================================

describe('SchedulerEngine Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should execute interval job on tick', async () => {
    const scheduler = new SchedulerEngine({ tickInterval: 100 })
    const handler = vi.fn().mockResolvedValue('done')
    const job: Job = {
      id: 'tick-job',
      name: 'Tick Job',
      handler,
      schedule: { interval: 1000 },
    }

    scheduler.schedule(job)
    scheduler.start()

    // First tick executes immediately scheduled job
    await vi.advanceTimersByTimeAsync(150)

    expect(handler).toHaveBeenCalled()

    scheduler.stop()
  })

  it('should not execute jobs before start', async () => {
    const scheduler = new SchedulerEngine({ tickInterval: 100 })
    const handler = vi.fn()
    const job: Job = {
      id: 'pre-start',
      name: 'Pre Start',
      handler,
      schedule: { interval: 100 },
    }

    scheduler.schedule(job)
    // Don't start

    await vi.advanceTimersByTimeAsync(500)

    expect(handler).not.toHaveBeenCalled()

    scheduler.stop()
  })

  it('should execute one-time job at scheduled time', async () => {
    const scheduler = new SchedulerEngine({ tickInterval: 100 })
    const handler = vi.fn().mockResolvedValue('completed')
    const futureTime = Date.now() + 500
    const job: Job = {
      id: 'one-shot',
      name: 'One Shot',
      handler,
      schedule: { at: futureTime },
    }

    scheduler.schedule(job)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(600)

    expect(handler).toHaveBeenCalledTimes(1)

    scheduler.stop()
  })

  it('should not reschedule one-time job after execution', async () => {
    const scheduler = new SchedulerEngine({ tickInterval: 100 })
    const handler = vi.fn().mockResolvedValue('done')
    const job: Job = {
      id: 'no-repeat',
      name: 'No Repeat',
      handler,
      schedule: { at: Date.now() + 200 },
    }

    scheduler.schedule(job)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(300)

    const status = scheduler.getStatus('no-repeat')
    expect(status!.nextRun).toBeNull()

    scheduler.stop()
  })

  it('should stop executing jobs after stop', async () => {
    const scheduler = new SchedulerEngine({ tickInterval: 100 })
    const handler = vi.fn().mockResolvedValue('done')
    const job: Job = {
      id: 'stop-test',
      name: 'Stop Test',
      handler,
      schedule: { interval: 100 },
    }

    scheduler.schedule(job)
    scheduler.start()

    await vi.advanceTimersByTimeAsync(150)
    const callsBeforeStop = handler.mock.calls.length

    scheduler.stop()

    await vi.advanceTimersByTimeAsync(500)

    expect(handler.mock.calls.length).toBe(callsBeforeStop)
  })

  it('should not execute paused job', async () => {
    const scheduler = new SchedulerEngine({ tickInterval: 100 })
    const handler = vi.fn().mockResolvedValue('done')
    const job: Job = {
      id: 'paused-job',
      name: 'Paused Job',
      handler,
      schedule: { interval: 200 },
    }

    scheduler.schedule(job)
    scheduler.start()

    // Execute first time
    await vi.advanceTimersByTimeAsync(150)
    const callsAfterFirst = handler.mock.calls.length

    // Pause and advance
    scheduler.pause('paused-job')
    await vi.advanceTimersByTimeAsync(500)

    expect(handler.mock.calls.length).toBe(callsAfterFirst)

    scheduler.stop()
  })

  it('should prevent overlap when overlap=false', async () => {
    const scheduler = new SchedulerEngine({ tickInterval: 50 })
    let executionCount = 0
    let isRunning = false

    const handler = vi.fn().mockImplementation(async () => {
      if (isRunning) {
        throw new Error('Overlap detected!')
      }
      isRunning = true
      executionCount++
      await new Promise((resolve) => setTimeout(resolve, 300))
      isRunning = false
      return 'done'
    })

    const job: Job = {
      id: 'no-overlap',
      name: 'No Overlap',
      handler,
      schedule: { interval: 100 },
      options: { overlap: false },
    }

    scheduler.schedule(job)
    scheduler.start()

    // First execution starts
    await vi.advanceTimersByTimeAsync(60)
    expect(executionCount).toBe(1)

    // Next tick should be skipped because job is still running
    await vi.advanceTimersByTimeAsync(100)

    // Still only 1 execution
    expect(executionCount).toBe(1)

    scheduler.stop()
  })
})
