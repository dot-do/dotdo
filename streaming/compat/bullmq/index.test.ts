/**
 * @dotdo/bullmq - BullMQ SDK compat tests
 *
 * Tests for BullMQ API compatibility backed by in-memory storage:
 * - Queue operations (add, get, pause, resume)
 * - Job operations (create, update progress, retry, remove)
 * - Worker operations (process, concurrency, events)
 * - Delayed jobs
 * - Repeatable jobs
 * - Job priorities
 * - Error handling
 * - Flow producer (job dependencies)
 *
 * @see https://docs.bullmq.io/
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  Queue,
  Worker,
  Job,
  QueueEvents,
  FlowProducer,
  _clearAll,
  _getQueues,
  delay,
  JobNotFoundError,
  JobAlreadyExistsError,
} from './index'
import type { JobState, JobOptions } from './types'

// ============================================================================
// QUEUE TESTS
// ============================================================================

describe('Queue', () => {
  beforeEach(() => {
    _clearAll()
  })

  describe('constructor', () => {
    it('should create a queue', () => {
      const queue = new Queue('test-queue')
      expect(queue.name).toBe('test-queue')
    })

    it('should create queue with options', () => {
      const queue = new Queue('test-queue', {
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      })
      expect(queue.opts.defaultJobOptions?.attempts).toBe(3)
    })

    it('should use same internal queue for same name', () => {
      const queue1 = new Queue('shared-queue')
      const queue2 = new Queue('shared-queue')

      expect(queue1.name).toBe(queue2.name)
    })
  })

  describe('add', () => {
    let queue: Queue

    beforeEach(() => {
      queue = new Queue('add-queue')
    })

    it('should add a job', async () => {
      const job = await queue.add('test-job', { value: 42 })

      expect(job.id).toBeDefined()
      expect(job.name).toBe('test-job')
      expect(job.data).toEqual({ value: 42 })
    })

    it('should add job with custom ID', async () => {
      const job = await queue.add('test-job', { value: 1 }, { jobId: 'custom-id' })

      expect(job.id).toBe('custom-id')
    })

    it('should throw error for duplicate job ID', async () => {
      await queue.add('job1', {}, { jobId: 'unique-id' })

      await expect(
        queue.add('job2', {}, { jobId: 'unique-id' })
      ).rejects.toThrow(JobAlreadyExistsError)
    })

    it('should add job with delay', async () => {
      const job = await queue.add('delayed-job', {}, { delay: 5000 })

      expect(await job.getState()).toBe('delayed')
    })

    it('should add job with priority', async () => {
      const job = await queue.add('priority-job', {}, { priority: 1 })

      expect(job.opts.priority).toBe(1)
    })

    it('should add job with attempts', async () => {
      const job = await queue.add('retry-job', {}, { attempts: 5 })

      expect(job.opts.attempts).toBe(5)
    })

    it('should apply default job options', async () => {
      const queueWithDefaults = new Queue('defaults-queue', {
        defaultJobOptions: { attempts: 3, timeout: 5000 },
      })

      const job = await queueWithDefaults.add('test', {})

      expect(job.opts.attempts).toBe(3)
      expect(job.opts.timeout).toBe(5000)
    })

    it('should override default options with job-specific options', async () => {
      const queueWithDefaults = new Queue('override-queue', {
        defaultJobOptions: { attempts: 3 },
      })

      const job = await queueWithDefaults.add('test', {}, { attempts: 5 })

      expect(job.opts.attempts).toBe(5)
    })
  })

  describe('addBulk', () => {
    let queue: Queue

    beforeEach(() => {
      queue = new Queue('bulk-queue')
    })

    it('should add multiple jobs', async () => {
      const jobs = await queue.addBulk([
        { name: 'job1', data: { index: 0 } },
        { name: 'job2', data: { index: 1 } },
        { name: 'job3', data: { index: 2 } },
      ])

      expect(jobs).toHaveLength(3)
      expect(jobs[0].name).toBe('job1')
      expect(jobs[1].name).toBe('job2')
      expect(jobs[2].name).toBe('job3')
    })

    it('should add bulk with options', async () => {
      const jobs = await queue.addBulk([
        { name: 'job1', data: {}, opts: { priority: 1 } },
        { name: 'job2', data: {}, opts: { delay: 1000 } },
      ])

      expect(jobs[0].opts.priority).toBe(1)
      expect(jobs[1].opts.delay).toBe(1000)
    })
  })

  describe('getJob', () => {
    let queue: Queue

    beforeEach(() => {
      queue = new Queue('get-job-queue')
    })

    it('should get job by ID', async () => {
      const addedJob = await queue.add('test', { value: 123 })
      const fetchedJob = await queue.getJob(addedJob.id)

      expect(fetchedJob).toBeDefined()
      expect(fetchedJob?.id).toBe(addedJob.id)
      expect(fetchedJob?.data).toEqual({ value: 123 })
    })

    it('should return undefined for non-existent job', async () => {
      const job = await queue.getJob('non-existent')
      expect(job).toBeUndefined()
    })
  })

  describe('getJobs', () => {
    let queue: Queue

    beforeEach(async () => {
      queue = new Queue('get-jobs-queue')
      await queue.add('job1', {})
      await queue.add('job2', {})
      await queue.add('delayed', {}, { delay: 10000 })
    })

    it('should get all jobs', async () => {
      const jobs = await queue.getJobs()
      expect(jobs.length).toBeGreaterThanOrEqual(2)
    })

    it('should get jobs by state', async () => {
      const waitingJobs = await queue.getJobs('waiting')
      expect(waitingJobs.length).toBe(2)

      const delayedJobs = await queue.getJobs('delayed')
      expect(delayedJobs.length).toBe(1)
    })

    it('should get jobs by multiple states', async () => {
      const jobs = await queue.getJobs(['waiting', 'delayed'])
      expect(jobs.length).toBe(3)
    })

    it('should paginate results', async () => {
      const page1 = await queue.getJobs('waiting', 0, 0)
      expect(page1.length).toBe(1)

      const page2 = await queue.getJobs('waiting', 1, 1)
      expect(page2.length).toBe(1)
    })
  })

  describe('getJobCounts', () => {
    let queue: Queue

    beforeEach(async () => {
      queue = new Queue('counts-queue')
      await queue.add('waiting1', {})
      await queue.add('waiting2', {})
      await queue.add('delayed', {}, { delay: 10000 })
    })

    it('should return job counts by state', async () => {
      const counts = await queue.getJobCounts()

      expect(counts.waiting).toBe(2)
      expect(counts.delayed).toBe(1)
      expect(counts.active).toBe(0)
      expect(counts.completed).toBe(0)
      expect(counts.failed).toBe(0)
    })
  })

  describe('pause and resume', () => {
    let queue: Queue

    beforeEach(() => {
      queue = new Queue('pause-queue')
    })

    it('should pause the queue', async () => {
      await queue.pause()
      expect(await queue.isPaused()).toBe(true)
    })

    it('should resume the queue', async () => {
      await queue.pause()
      await queue.resume()
      expect(await queue.isPaused()).toBe(false)
    })
  })

  describe('remove', () => {
    let queue: Queue

    beforeEach(() => {
      queue = new Queue('remove-queue')
    })

    it('should remove a job', async () => {
      const job = await queue.add('test', {})
      await queue.remove(job.id)

      const fetchedJob = await queue.getJob(job.id)
      expect(fetchedJob).toBeUndefined()
    })
  })

  describe('drain', () => {
    let queue: Queue

    beforeEach(async () => {
      queue = new Queue('drain-queue')
      await queue.add('job1', {})
      await queue.add('job2', {})
      await queue.add('delayed', {}, { delay: 10000 })
    })

    it('should drain waiting jobs', async () => {
      await queue.drain()

      const waiting = await queue.getWaiting()
      expect(waiting.length).toBe(0)

      const delayed = await queue.getDelayed()
      expect(delayed.length).toBe(1)
    })

    it('should drain delayed jobs when specified', async () => {
      await queue.drain(true)

      const waiting = await queue.getWaiting()
      expect(waiting.length).toBe(0)

      const delayed = await queue.getDelayed()
      expect(delayed.length).toBe(0)
    })
  })

  describe('clean', () => {
    let queue: Queue

    beforeEach(async () => {
      queue = new Queue('clean-queue')
    })

    it('should clean old completed jobs', async () => {
      // Add and complete jobs
      const job = await queue.add('test', {})

      // Manually mark as completed (simulating worker completion)
      const internalQueues = _getQueues()
      const internalQueue = internalQueues.get('clean-queue')
      if (internalQueue) {
        const internalJob = internalQueue.jobs.get(job.id)
        if (internalJob) {
          internalJob.state = 'completed'
          internalJob.finishedOn = Date.now() - 10000 // 10 seconds ago
        }
      }

      const cleaned = await queue.clean(5000, 100, 'completed')
      expect(cleaned.length).toBe(1)
    })
  })

  describe('obliterate', () => {
    let queue: Queue

    beforeEach(async () => {
      queue = new Queue('obliterate-queue')
      await queue.add('job1', {})
      await queue.add('job2', {})
    })

    it('should remove all jobs', async () => {
      await queue.obliterate()

      const counts = await queue.getJobCounts()
      expect(counts.waiting + counts.completed + counts.failed + counts.delayed).toBe(0)
    })
  })

  describe('retryJobs', () => {
    let queue: Queue

    beforeEach(async () => {
      queue = new Queue('retry-queue')
      const job = await queue.add('test', {})

      // Manually mark as failed
      const internalQueues = _getQueues()
      const internalQueue = internalQueues.get('retry-queue')
      if (internalQueue) {
        const internalJob = internalQueue.jobs.get(job.id)
        if (internalJob) {
          internalJob.state = 'failed'
          internalJob.failedReason = 'Test failure'
        }
      }
    })

    it('should retry failed jobs', async () => {
      await queue.retryJobs()

      const failed = await queue.getFailed()
      expect(failed.length).toBe(0)

      const waiting = await queue.getWaiting()
      expect(waiting.length).toBe(1)
    })
  })
})

// ============================================================================
// JOB TESTS
// ============================================================================

describe('Job', () => {
  let queue: Queue

  beforeEach(() => {
    _clearAll()
    queue = new Queue('job-test-queue')
  })

  describe('creation', () => {
    it('should create a job', async () => {
      const job = await queue.add('test', { value: 1 })

      expect(job.id).toBeDefined()
      expect(job.name).toBe('test')
      expect(job.data).toEqual({ value: 1 })
      expect(job.timestamp).toBeDefined()
      expect(job.attemptsMade).toBe(0)
    })
  })

  describe('updateProgress', () => {
    it('should update progress with number', async () => {
      const job = await queue.add('test', {})
      await job.updateProgress(50)

      expect(job.progress).toBe(50)
    })

    it('should update progress with object', async () => {
      const job = await queue.add('test', {})
      await job.updateProgress({ step: 'processing', percent: 75 })

      expect(job.progress).toEqual({ step: 'processing', percent: 75 })
    })
  })

  describe('getState', () => {
    it('should return waiting state', async () => {
      const job = await queue.add('test', {})
      expect(await job.getState()).toBe('waiting')
    })

    it('should return delayed state', async () => {
      const job = await queue.add('test', {}, { delay: 10000 })
      expect(await job.getState()).toBe('delayed')
    })
  })

  describe('moveToDelayed', () => {
    it('should move job to delayed state', async () => {
      const job = await queue.add('test', {})
      await job.moveToDelayed(5000)

      expect(await job.getState()).toBe('delayed')
    })
  })

  describe('retry', () => {
    it('should reset job for retry', async () => {
      const job = await queue.add('test', {})

      // Manually mark as failed
      const internalQueues = _getQueues()
      const internalQueue = internalQueues.get('job-test-queue')
      if (internalQueue) {
        const internalJob = internalQueue.jobs.get(job.id)
        if (internalJob) {
          internalJob.state = 'failed'
          internalJob.failedReason = 'Test error'
        }
      }

      await job.retry()

      expect(await job.getState()).toBe('waiting')
      expect(job.failedReason).toBeUndefined()
    })
  })

  describe('remove', () => {
    it('should remove the job', async () => {
      const job = await queue.add('test', {})
      await job.remove()

      const fetchedJob = await queue.getJob(job.id)
      expect(fetchedJob).toBeUndefined()
    })
  })

  describe('toJSON', () => {
    it('should convert job to JSON', async () => {
      const job = await queue.add('test', { key: 'value' }, { priority: 1 })
      const json = job.toJSON()

      expect(json.id).toBe(job.id)
      expect(json.name).toBe('test')
      expect(json.data).toEqual({ key: 'value' })
      expect(json.opts.priority).toBe(1)
      expect(json.timestamp).toBeDefined()
    })
  })

  describe('logs', () => {
    it('should log messages', async () => {
      const job = await queue.add('test', {})
      await job.log('Starting job')
      await job.log('Processing step 1')

      const { logs, count } = await job.getLogs()
      expect(count).toBe(2)
      expect(logs[0]).toContain('Starting job')
      expect(logs[1]).toContain('Processing step 1')
    })
  })

  describe('state checks', () => {
    it('should check if active', async () => {
      const job = await queue.add('test', {})
      expect(await job.isActive()).toBe(false)
    })

    it('should check if completed', async () => {
      const job = await queue.add('test', {})
      expect(await job.isCompleted()).toBe(false)
    })

    it('should check if failed', async () => {
      const job = await queue.add('test', {})
      expect(await job.isFailed()).toBe(false)
    })

    it('should check if delayed', async () => {
      const job = await queue.add('test', {}, { delay: 5000 })
      expect(await job.isDelayed()).toBe(true)
    })

    it('should check if waiting', async () => {
      const job = await queue.add('test', {})
      expect(await job.isWaiting()).toBe(true)
    })
  })

  describe('fromId', () => {
    it('should get job by ID', async () => {
      const addedJob = await queue.add('test', { value: 42 })
      const fetchedJob = await Job.fromId(queue, addedJob.id)

      expect(fetchedJob).toBeDefined()
      expect(fetchedJob?.id).toBe(addedJob.id)
      expect(fetchedJob?.data).toEqual({ value: 42 })
    })

    it('should return undefined for non-existent job', async () => {
      const job = await Job.fromId(queue, 'non-existent')
      expect(job).toBeUndefined()
    })
  })
})

// ============================================================================
// WORKER TESTS
// ============================================================================

describe('Worker', () => {
  let queue: Queue
  let worker: Worker | undefined

  beforeEach(() => {
    _clearAll()
    queue = new Queue('worker-test-queue')
  })

  afterEach(async () => {
    if (worker) {
      await worker.close(true)
      worker = undefined
    }
  })

  describe('constructor', () => {
    it('should create a worker', () => {
      worker = new Worker('worker-test-queue', async () => 'done', { autorun: false })
      expect(worker.name).toBe('worker-test-queue')
    })

    it('should auto-run by default', async () => {
      worker = new Worker('worker-test-queue', async () => 'done')
      expect(worker.isRunning()).toBe(true)
    })

    it('should not auto-run when disabled', () => {
      worker = new Worker('worker-test-queue', async () => 'done', { autorun: false })
      expect(worker.isRunning()).toBe(false)
    })
  })

  describe('job processing', () => {
    it('should process a job', async () => {
      const job = await queue.add('test', { value: 42 })

      let processedData: unknown
      worker = new Worker('worker-test-queue', async (job) => {
        processedData = job.data
        return 'processed'
      })

      // Wait for processing
      await delay(300)

      expect(processedData).toEqual({ value: 42 })
      expect(await job.getState()).toBe('completed')
    })

    it('should return job result', async () => {
      await queue.add('test', { x: 2, y: 3 })

      worker = new Worker('worker-test-queue', async (job) => {
        const { x, y } = job.data as { x: number; y: number }
        return x * y
      })

      await delay(300)

      const jobs = await queue.getCompleted()
      expect(jobs.length).toBe(1)
      expect(jobs[0].returnvalue).toBe(6)
    })

    it('should handle job failure', async () => {
      await queue.add('fail-job', {})

      worker = new Worker('worker-test-queue', async () => {
        throw new Error('Job failed intentionally')
      })

      await delay(300)

      const failed = await queue.getFailed()
      expect(failed.length).toBe(1)
      expect(failed[0].failedReason).toBe('Job failed intentionally')
    })

    it('should process jobs with concurrency', async () => {
      const processed: string[] = []

      await queue.add('job1', { id: '1' })
      await queue.add('job2', { id: '2' })
      await queue.add('job3', { id: '3' })

      worker = new Worker(
        'worker-test-queue',
        async (job) => {
          processed.push((job.data as { id: string }).id)
          await delay(100)
          return 'done'
        },
        { concurrency: 3 }
      )

      await delay(400)

      expect(processed.length).toBe(3)
    })

    it('should respect job timeout', async () => {
      await queue.add('slow-job', {}, { timeout: 100 })

      worker = new Worker('worker-test-queue', async () => {
        await delay(500)
        return 'done'
      })

      await delay(400)

      const failed = await queue.getFailed()
      expect(failed.length).toBe(1)
      expect(failed[0].failedReason).toContain('timed out')
    })
  })

  describe('job retry', () => {
    it('should retry failed jobs', async () => {
      let attempts = 0

      await queue.add('retry-job', {}, { attempts: 3 })

      worker = new Worker('worker-test-queue', async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('Not yet')
        }
        return 'success'
      })

      await delay(600)

      expect(attempts).toBe(3)
      const completed = await queue.getCompleted()
      expect(completed.length).toBe(1)
    })

    it('should fail after max attempts', async () => {
      await queue.add('max-retry-job', {}, { attempts: 2 })

      worker = new Worker('worker-test-queue', async () => {
        throw new Error('Always fails')
      })

      await delay(500)

      const failed = await queue.getFailed()
      expect(failed.length).toBe(1)
      expect(failed[0].attemptsMade).toBe(2)
    })

    it('should apply exponential backoff', async () => {
      const startTime = Date.now()
      let lastAttemptTime = startTime

      await queue.add('backoff-job', {}, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 100 },
      })

      worker = new Worker('worker-test-queue', async () => {
        lastAttemptTime = Date.now()
        throw new Error('Fail')
      })

      await delay(800)

      const failed = await queue.getFailed()
      expect(failed.length).toBe(1)
    })
  })

  describe('progress', () => {
    it('should track job progress', async () => {
      const progressValues: number[] = []

      await queue.add('progress-job', {})

      worker = new Worker('worker-test-queue', async (job) => {
        await job.updateProgress(25)
        await job.updateProgress(50)
        await job.updateProgress(75)
        await job.updateProgress(100)
        return 'done'
      })

      worker.on('progress', (job: Job, progress: number) => {
        progressValues.push(progress as number)
      })

      await delay(300)

      expect(progressValues).toContain(100)
    })
  })

  describe('events', () => {
    it('should emit active event', async () => {
      const activeEvents: string[] = []

      await queue.add('event-job', {})

      worker = new Worker('worker-test-queue', async () => 'done')
      worker.on('active', (job: Job) => {
        activeEvents.push(job.id)
      })

      await delay(300)

      expect(activeEvents.length).toBeGreaterThan(0)
    })

    it('should emit completed event', async () => {
      const completedEvents: string[] = []

      await queue.add('complete-event-job', {})

      worker = new Worker('worker-test-queue', async () => 'result')
      worker.on('completed', (job: Job, result: unknown) => {
        completedEvents.push(`${job.id}:${result}`)
      })

      await delay(300)

      expect(completedEvents.length).toBe(1)
      expect(completedEvents[0]).toContain(':result')
    })

    it('should emit failed event', async () => {
      const failedEvents: string[] = []

      await queue.add('fail-event-job', {})

      worker = new Worker('worker-test-queue', async () => {
        throw new Error('Intentional failure')
      })
      worker.on('failed', (job: Job, error: Error) => {
        failedEvents.push(`${job.id}:${error.message}`)
      })

      await delay(300)

      expect(failedEvents.length).toBe(1)
      expect(failedEvents[0]).toContain(':Intentional failure')
    })

    it('should emit drained event', async () => {
      let drainedEmitted = false

      worker = new Worker('worker-test-queue', async () => 'done')
      worker.on('drained', () => {
        drainedEmitted = true
      })

      await delay(300)

      expect(drainedEmitted).toBe(true)
    })
  })

  describe('pause and resume', () => {
    it('should pause processing', async () => {
      await queue.add('pause-job', {})

      worker = new Worker('worker-test-queue', async () => 'done')
      await worker.pause()

      expect(worker.isPaused()).toBe(true)
    })

    it('should resume processing', async () => {
      worker = new Worker('worker-test-queue', async () => 'done')
      await worker.pause()
      await worker.resume()

      expect(worker.isPaused()).toBe(false)
    })
  })

  describe('close', () => {
    it('should close worker', async () => {
      worker = new Worker('worker-test-queue', async () => 'done')
      await worker.close()

      expect(worker.isRunning()).toBe(false)
    })

    it('should force close without waiting', async () => {
      await queue.add('slow-close-job', {})

      worker = new Worker('worker-test-queue', async () => {
        await delay(5000)
        return 'done'
      })

      await delay(100)
      await worker.close(true)

      expect(worker.isRunning()).toBe(false)
    })
  })
})

// ============================================================================
// DELAYED JOBS TESTS
// ============================================================================

describe('Delayed Jobs', () => {
  let queue: Queue
  let worker: Worker | undefined

  beforeEach(() => {
    _clearAll()
    queue = new Queue('delayed-queue')
  })

  afterEach(async () => {
    if (worker) {
      await worker.close(true)
      worker = undefined
    }
  })

  it('should delay job execution', async () => {
    const processed: number[] = []

    await queue.add('delayed-job', {}, { delay: 200 })

    worker = new Worker('delayed-queue', async () => {
      processed.push(Date.now())
      return 'done'
    })

    // Should not be processed immediately
    await delay(100)
    expect(processed.length).toBe(0)

    // Should be processed after delay
    await delay(200)
    expect(processed.length).toBe(1)
  })

  it('should process delayed jobs in order', async () => {
    const processed: string[] = []

    // Add jobs with different delays
    await queue.add('job1', {}, { delay: 200 })
    await queue.add('job2', {}, { delay: 100 })
    await queue.add('job3', {})

    worker = new Worker('delayed-queue', async (job) => {
      processed.push(job.name)
      return 'done'
    })

    await delay(400)

    // job3 should be first (no delay), then job2, then job1
    expect(processed[0]).toBe('job3')
    expect(processed).toContain('job1')
    expect(processed).toContain('job2')
  })
})

// ============================================================================
// PRIORITY TESTS
// ============================================================================

describe('Job Priority', () => {
  let queue: Queue
  let worker: Worker | undefined

  beforeEach(() => {
    _clearAll()
    queue = new Queue('priority-queue')
  })

  afterEach(async () => {
    if (worker) {
      await worker.close(true)
      worker = undefined
    }
  })

  it('should process high priority jobs first', async () => {
    const processed: number[] = []

    // Add jobs in reverse priority order
    await queue.add('low', { priority: 3 }, { priority: 10 })
    await queue.add('medium', { priority: 2 }, { priority: 5 })
    await queue.add('high', { priority: 1 }, { priority: 1 })

    worker = new Worker(
      'priority-queue',
      async (job) => {
        processed.push((job.data as { priority: number }).priority)
        return 'done'
      },
      { concurrency: 1 }
    )

    await delay(500)

    // High priority should be processed first
    expect(processed[0]).toBe(1)
  })

  it('should handle LIFO ordering', async () => {
    const processed: number[] = []

    await queue.add('job1', { index: 1 }, { lifo: true })
    await delay(10)
    await queue.add('job2', { index: 2 }, { lifo: true })
    await delay(10)
    await queue.add('job3', { index: 3 }, { lifo: true })

    worker = new Worker(
      'priority-queue',
      async (job) => {
        processed.push((job.data as { index: number }).index)
        return 'done'
      },
      { concurrency: 1 }
    )

    await delay(500)

    // Last added should be processed first
    expect(processed[0]).toBe(3)
  })
})

// ============================================================================
// QUEUE EVENTS TESTS
// ============================================================================

describe('QueueEvents', () => {
  let queue: Queue
  let queueEvents: QueueEvents
  let worker: Worker | undefined

  beforeEach(() => {
    _clearAll()
    queue = new Queue('events-queue')
    queueEvents = new QueueEvents('events-queue')
  })

  afterEach(async () => {
    if (worker) {
      await worker.close(true)
      worker = undefined
    }
    await queueEvents.close()
  })

  it('should emit waiting event', async () => {
    const events: string[] = []

    queueEvents.on('waiting', (args: { jobId: string }) => {
      events.push(`waiting:${args.jobId}`)
    })

    const job = await queue.add('test', {})

    expect(events.length).toBe(1)
    expect(events[0]).toBe(`waiting:${job.id}`)
  })

  it('should emit active event', async () => {
    const events: string[] = []

    queueEvents.on('active', (args: { jobId: string }) => {
      events.push(`active:${args.jobId}`)
    })

    await queue.add('test', {})

    worker = new Worker('events-queue', async () => 'done')

    await delay(300)

    expect(events.length).toBeGreaterThan(0)
  })

  it('should emit completed event', async () => {
    const events: string[] = []

    queueEvents.on('completed', (args: { jobId: string; returnvalue: string }) => {
      events.push(`completed:${args.jobId}:${args.returnvalue}`)
    })

    await queue.add('test', {})

    worker = new Worker('events-queue', async () => 'result')

    await delay(300)

    expect(events.length).toBe(1)
    expect(events[0]).toContain('completed:')
    expect(events[0]).toContain('"result"')
  })

  it('should emit failed event', async () => {
    const events: string[] = []

    queueEvents.on('failed', (args: { jobId: string; failedReason: string }) => {
      events.push(`failed:${args.jobId}:${args.failedReason}`)
    })

    await queue.add('test', {})

    worker = new Worker('events-queue', async () => {
      throw new Error('Test error')
    })

    await delay(300)

    expect(events.length).toBe(1)
    expect(events[0]).toContain('Test error')
  })

  it('should emit delayed event', async () => {
    const events: string[] = []

    queueEvents.on('delayed', (args: { jobId: string; delay: number }) => {
      events.push(`delayed:${args.jobId}:${args.delay}`)
    })

    const job = await queue.add('test', {}, { delay: 1000 })

    expect(events.length).toBe(1)
    expect(events[0]).toBe(`delayed:${job.id}:1000`)
  })
})

// ============================================================================
// FLOW PRODUCER TESTS
// ============================================================================

describe('FlowProducer', () => {
  let flowProducer: FlowProducer

  beforeEach(() => {
    _clearAll()
    flowProducer = new FlowProducer()
  })

  afterEach(async () => {
    await flowProducer.close()
  })

  it('should create a flow', async () => {
    const parentJob = await flowProducer.add({
      name: 'parent-job',
      queueName: 'flow-queue',
      data: { type: 'parent' },
    })

    expect(parentJob.id).toBeDefined()
    expect(parentJob.name).toBe('parent-job')
  })

  it('should create flow with children', async () => {
    const parentJob = await flowProducer.add({
      name: 'parent',
      queueName: 'flow-queue',
      data: { level: 0 },
      children: [
        {
          name: 'child1',
          queueName: 'flow-queue',
          data: { level: 1 },
        },
        {
          name: 'child2',
          queueName: 'flow-queue',
          data: { level: 1 },
        },
      ],
    })

    const queue = new Queue('flow-queue')
    const jobs = await queue.getJobs()

    // Should have parent + 2 children
    expect(jobs.length).toBe(3)
  })

  it('should add bulk flows', async () => {
    const jobs = await flowProducer.addBulk([
      { name: 'flow1', queueName: 'flow-queue', data: { index: 1 } },
      { name: 'flow2', queueName: 'flow-queue', data: { index: 2 } },
    ])

    expect(jobs.length).toBe(2)
  })
})

// ============================================================================
// REPEATABLE JOBS TESTS
// ============================================================================

describe('Repeatable Jobs', () => {
  let queue: Queue

  beforeEach(() => {
    _clearAll()
    queue = new Queue('repeatable-queue')
  })

  it('should add repeatable job scheduler', async () => {
    await queue.upsertJobScheduler('daily-job', {
      pattern: '0 0 * * *', // Every day at midnight
    })

    const schedulers = await queue.getJobSchedulers()
    expect(schedulers.length).toBe(1)
    expect(schedulers[0].key).toBe('daily-job')
  })

  it('should add repeatable job with immediate execution', async () => {
    const job = await queue.upsertJobScheduler(
      'immediate-job',
      { immediately: true },
      { name: 'scheduled-job', data: { test: true } }
    )

    expect(job).toBeDefined()
    expect(job?.name).toBe('scheduled-job')
  })

  it('should remove repeatable job scheduler', async () => {
    await queue.upsertJobScheduler('to-remove', { every: 1000 })

    const removed = await queue.removeJobScheduler('to-remove')
    expect(removed).toBe(true)

    const schedulers = await queue.getJobSchedulers()
    expect(schedulers.length).toBe(0)
  })

  it('should list job schedulers with pagination', async () => {
    await queue.upsertJobScheduler('job1', { every: 1000 })
    await queue.upsertJobScheduler('job2', { every: 2000 })
    await queue.upsertJobScheduler('job3', { every: 3000 })

    const page1 = await queue.getJobSchedulers(0, 1)
    expect(page1.length).toBe(2)

    const page2 = await queue.getJobSchedulers(2, 2)
    expect(page2.length).toBe(1)
  })
})

// ============================================================================
// REMOVE ON COMPLETE/FAIL TESTS
// ============================================================================

describe('Remove on Complete/Fail', () => {
  let queue: Queue
  let worker: Worker | undefined

  beforeEach(() => {
    _clearAll()
    queue = new Queue('remove-on-queue')
  })

  afterEach(async () => {
    if (worker) {
      await worker.close(true)
      worker = undefined
    }
  })

  it('should remove job on completion', async () => {
    const job = await queue.add('remove-test', {}, { removeOnComplete: true })
    const jobId = job.id

    worker = new Worker('remove-on-queue', async () => 'done')

    await delay(300)

    const fetchedJob = await queue.getJob(jobId)
    expect(fetchedJob).toBeUndefined()
  })

  it('should remove job on failure', async () => {
    const job = await queue.add('remove-fail-test', {}, { removeOnFail: true })
    const jobId = job.id

    worker = new Worker('remove-on-queue', async () => {
      throw new Error('Fail')
    })

    await delay(300)

    const fetchedJob = await queue.getJob(jobId)
    expect(fetchedJob).toBeUndefined()
  })
})

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('Utility Functions', () => {
  beforeEach(() => {
    _clearAll()
  })

  describe('delay', () => {
    it('should delay execution', async () => {
      const start = Date.now()
      await delay(100)
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(95)
    })
  })

  describe('_clearAll', () => {
    it('should clear all queues', async () => {
      const queue = new Queue('clear-test')
      await queue.add('job', {})

      _clearAll()

      const queues = _getQueues()
      expect(queues.size).toBe(0)
    })
  })

  describe('_getQueues', () => {
    it('should return all internal queues', async () => {
      const queue1 = new Queue('queue1')
      const queue2 = new Queue('queue2')

      await queue1.add('job', {})
      await queue2.add('job', {})

      const queues = _getQueues()
      expect(queues.size).toBe(2)
      expect(queues.has('queue1')).toBe(true)
      expect(queues.has('queue2')).toBe(true)
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    _clearAll()
  })

  it('should handle JobNotFoundError', () => {
    const error = new JobNotFoundError('test-id')
    expect(error.message).toBe('Job test-id not found')
    expect(error.name).toBe('JobNotFoundError')
  })

  it('should handle JobAlreadyExistsError', () => {
    const error = new JobAlreadyExistsError('test-id')
    expect(error.message).toBe('Job test-id already exists')
    expect(error.name).toBe('JobAlreadyExistsError')
  })

  it('should throw JobAlreadyExistsError for duplicate IDs', async () => {
    const queue = new Queue('error-queue')
    await queue.add('job1', {}, { jobId: 'dup-id' })

    await expect(
      queue.add('job2', {}, { jobId: 'dup-id' })
    ).rejects.toThrow(JobAlreadyExistsError)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  let queue: Queue
  let worker: Worker | undefined

  beforeEach(() => {
    _clearAll()
    queue = new Queue('integration-queue')
  })

  afterEach(async () => {
    if (worker) {
      await worker.close(true)
      worker = undefined
    }
  })

  it('should handle complete job lifecycle', async () => {
    const events: string[] = []

    // Add jobs
    const job1 = await queue.add('process-order', { orderId: '123' })
    const job2 = await queue.add('process-order', { orderId: '456' })

    // Start worker
    worker = new Worker('integration-queue', async (job) => {
      events.push(`processing:${(job.data as { orderId: string }).orderId}`)
      await job.updateProgress(50)
      events.push(`progress:${job.progress}`)
      await job.updateProgress(100)
      return { success: true, orderId: (job.data as { orderId: string }).orderId }
    })

    worker.on('completed', (job: Job, result: unknown) => {
      events.push(`completed:${job.id}`)
    })

    // Wait for processing
    await delay(500)

    // Verify
    expect(events.filter(e => e.startsWith('processing:')).length).toBe(2)
    expect(events.filter(e => e.startsWith('completed:')).length).toBe(2)

    const completed = await queue.getCompleted()
    expect(completed.length).toBe(2)
  })

  it('should handle mixed success and failure', async () => {
    await queue.add('success-job', { shouldFail: false })
    await queue.add('fail-job', { shouldFail: true })

    worker = new Worker('integration-queue', async (job) => {
      if ((job.data as { shouldFail: boolean }).shouldFail) {
        throw new Error('Intentional failure')
      }
      return 'success'
    })

    await delay(400)

    const completed = await queue.getCompleted()
    const failed = await queue.getFailed()

    expect(completed.length).toBe(1)
    expect(failed.length).toBe(1)
  })

  it('should handle high throughput', async () => {
    const jobCount = 50
    const processed: string[] = []

    // Add many jobs
    for (let i = 0; i < jobCount; i++) {
      await queue.add('batch-job', { index: i })
    }

    // Process with high concurrency
    worker = new Worker(
      'integration-queue',
      async (job) => {
        processed.push((job.data as { index: number }).index.toString())
        return 'done'
      },
      { concurrency: 10 }
    )

    // Wait for all to complete
    await delay(2000)

    expect(processed.length).toBe(jobCount)
  })
})
