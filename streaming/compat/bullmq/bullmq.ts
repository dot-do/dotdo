/**
 * @dotdo/bullmq - BullMQ SDK compat
 *
 * Drop-in replacement for bullmq backed by DO SQLite with in-memory storage.
 * This implementation matches the BullMQ API.
 * Production version routes to Cloudflare Queues based on config.
 *
 * @see https://docs.bullmq.io/
 */
import type {
  JobOptions,
  JobJson,
  JobState,
  QueueOptions,
  QueueCounts,
  WorkerOptions,
  Processor,
  RepeatOptions,
  BulkJobOptions,
  FlowJob,
  FlowProducerOptions,
  ParentKeys,
} from './types'

import {
  BullMQError,
  JobNotFoundError,
  JobAlreadyExistsError,
  InvalidJobDataError,
  JobTimeoutError,
} from './types'

// Re-export errors
export {
  BullMQError,
  JobNotFoundError,
  QueueNotFoundError,
  JobAlreadyExistsError,
  WorkerNotReadyError,
  QueuePausedError,
  InvalidJobDataError,
  JobLockError,
  JobTimeoutError,
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * Internal job structure
 */
interface InternalJob {
  id: string
  name: string
  queueName: string
  data: unknown
  opts: JobOptions
  progress: number | object
  timestamp: number
  finishedOn?: number
  processedOn?: number
  attemptsMade: number
  stacktrace: string[]
  returnvalue?: unknown
  failedReason?: string
  state: JobState
  delayUntil?: number
  parentKey?: string
  repeatJobKey?: string
  logs: string[]
  token?: string
}

/**
 * Internal queue structure
 */
interface InternalQueue {
  name: string
  opts: QueueOptions
  isPaused: boolean
  jobs: Map<string, InternalJob>
  repeatableJobs: Map<string, { pattern: RepeatOptions; lastRun?: number }>
}

/**
 * Global in-memory storage for all queues
 */
const globalQueues = new Map<string, InternalQueue>()

/**
 * Event emitters for queues
 */
const queueEventEmitters = new Map<string, EventEmitterLike>()

/**
 * Simple event emitter interface
 */
interface EventEmitterLike {
  listeners: Map<string, Set<(...args: unknown[]) => void>>
  emit(event: string, ...args: unknown[]): void
  on(event: string, listener: (...args: unknown[]) => void): void
  off(event: string, listener: (...args: unknown[]) => void): void
  removeAllListeners(): void
}

/**
 * Create a simple event emitter
 */
function createEventEmitter(): EventEmitterLike {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    listeners,
    emit(event: string, ...args: unknown[]) {
      const handlers = listeners.get(event)
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(...args)
          } catch (e) {
            // Emit to error handlers
            if (event !== 'error') {
              this.emit('error', e)
            }
          }
        }
      }
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set())
      }
      listeners.get(event)!.add(listener)
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      const handlers = listeners.get(event)
      if (handlers) {
        handlers.delete(listener)
      }
    },
    removeAllListeners() {
      listeners.clear()
    },
  }
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Get or create queue emitter
 */
function getQueueEmitter(queueName: string): EventEmitterLike {
  if (!queueEventEmitters.has(queueName)) {
    queueEventEmitters.set(queueName, createEventEmitter())
  }
  return queueEventEmitters.get(queueName)!
}

// ============================================================================
// JOB CLASS
// ============================================================================

/**
 * Job class
 * Represents a job in the queue
 */
export class Job<T = unknown, R = unknown> {
  readonly id: string
  readonly name: string
  readonly queueName: string
  data: T
  readonly opts: JobOptions
  progress: number | object
  readonly timestamp: number
  attemptsMade: number
  stacktrace: string[]
  returnvalue?: R
  failedReason?: string
  finishedOn?: number
  processedOn?: number

  private _internal: InternalJob

  constructor(
    queue: Queue | string,
    name: string,
    data: T,
    opts: JobOptions = {},
    id?: string
  ) {
    this.queueName = typeof queue === 'string' ? queue : queue.name
    this.name = name
    this.data = data
    this.opts = opts
    this.id = id || opts.jobId || generateId()
    this.progress = 0
    this.timestamp = Date.now()
    this.attemptsMade = 0
    this.stacktrace = []

    // Create internal representation
    this._internal = {
      id: this.id,
      name: this.name,
      queueName: this.queueName,
      data: this.data,
      opts: this.opts,
      progress: this.progress,
      timestamp: this.timestamp,
      attemptsMade: this.attemptsMade,
      stacktrace: this.stacktrace,
      state: opts.delay ? 'delayed' : 'waiting',
      delayUntil: opts.delay ? Date.now() + opts.delay : undefined,
      logs: [],
    }
  }

  /**
   * Update job progress
   */
  async updateProgress(progress: number | object): Promise<void> {
    this.progress = progress
    this._internal.progress = progress

    const emitter = getQueueEmitter(this.queueName)
    emitter.emit('progress', { jobId: this.id, data: progress })
  }

  /**
   * Get current job state
   */
  async getState(): Promise<JobState> {
    const queue = globalQueues.get(this.queueName)
    if (!queue) return 'waiting'

    const job = queue.jobs.get(this.id)
    if (!job) return 'waiting'

    return job.state
  }

  /**
   * Move job to waiting state
   */
  async moveToWaiting(token: string): Promise<boolean | void> {
    const queue = globalQueues.get(this.queueName)
    if (!queue) return false

    const job = queue.jobs.get(this.id)
    if (!job) return false

    job.state = 'waiting'
    job.token = undefined

    const emitter = getQueueEmitter(this.queueName)
    emitter.emit('waiting', { jobId: this.id })

    return true
  }

  /**
   * Move job to failed state
   */
  async moveToFailed(error: Error, token: string): Promise<void> {
    const queue = globalQueues.get(this.queueName)
    if (!queue) throw new JobNotFoundError(this.id)

    const job = queue.jobs.get(this.id)
    if (!job) throw new JobNotFoundError(this.id)

    job.state = 'failed'
    job.failedReason = error.message
    job.stacktrace.push(error.stack || error.message)
    job.finishedOn = Date.now()
    job.token = undefined

    this.failedReason = error.message
    this.stacktrace = job.stacktrace
    this.finishedOn = job.finishedOn

    const emitter = getQueueEmitter(this.queueName)
    emitter.emit('failed', { jobId: this.id, failedReason: error.message, prev: 'active' })
  }

  /**
   * Move job to delayed state
   */
  async moveToDelayed(delay: number): Promise<void> {
    const queue = globalQueues.get(this.queueName)
    if (!queue) throw new JobNotFoundError(this.id)

    const job = queue.jobs.get(this.id)
    if (!job) throw new JobNotFoundError(this.id)

    job.state = 'delayed'
    job.delayUntil = Date.now() + delay
    job.token = undefined

    const emitter = getQueueEmitter(this.queueName)
    emitter.emit('delayed', { jobId: this.id, delay })
  }

  /**
   * Retry the job
   */
  async retry(state: JobState = 'waiting'): Promise<void> {
    const queue = globalQueues.get(this.queueName)
    if (!queue) throw new JobNotFoundError(this.id)

    const job = queue.jobs.get(this.id)
    if (!job) throw new JobNotFoundError(this.id)

    job.state = state
    job.failedReason = undefined
    job.finishedOn = undefined
    job.processedOn = undefined
    job.returnvalue = undefined
    job.token = undefined
    // Don't reset attemptsMade - it tracks total attempts

    this.failedReason = undefined
    this.finishedOn = undefined
    this.processedOn = undefined
    this.returnvalue = undefined

    const emitter = getQueueEmitter(this.queueName)
    emitter.emit('waiting', { jobId: this.id })
  }

  /**
   * Remove the job
   */
  async remove(): Promise<void> {
    const queue = globalQueues.get(this.queueName)
    if (!queue) return

    queue.jobs.delete(this.id)

    const emitter = getQueueEmitter(this.queueName)
    emitter.emit('removed', { jobId: this.id })
  }

  /**
   * Convert to JSON
   */
  toJSON(): JobJson<T, R> {
    return {
      id: this.id,
      name: this.name,
      data: this.data,
      opts: this.opts,
      progress: this.progress,
      delay: this.opts.delay,
      timestamp: this.timestamp,
      finishedOn: this.finishedOn,
      processedOn: this.processedOn,
      attemptsMade: this.attemptsMade,
      stacktrace: this.stacktrace,
      returnvalue: this.returnvalue,
      failedReason: this.failedReason,
    }
  }

  /**
   * Log message for job
   */
  async log(message: string): Promise<void> {
    const queue = globalQueues.get(this.queueName)
    if (!queue) return

    const job = queue.jobs.get(this.id)
    if (!job) return

    job.logs.push(`${new Date().toISOString()} - ${message}`)
  }

  /**
   * Get logs for job
   */
  async getLogs(): Promise<{ logs: string[]; count: number }> {
    const queue = globalQueues.get(this.queueName)
    if (!queue) return { logs: [], count: 0 }

    const job = queue.jobs.get(this.id)
    if (!job) return { logs: [], count: 0 }

    return { logs: job.logs, count: job.logs.length }
  }

  /**
   * Is job active
   */
  async isActive(): Promise<boolean> {
    return (await this.getState()) === 'active'
  }

  /**
   * Is job completed
   */
  async isCompleted(): Promise<boolean> {
    return (await this.getState()) === 'completed'
  }

  /**
   * Is job failed
   */
  async isFailed(): Promise<boolean> {
    return (await this.getState()) === 'failed'
  }

  /**
   * Is job delayed
   */
  async isDelayed(): Promise<boolean> {
    return (await this.getState()) === 'delayed'
  }

  /**
   * Is job waiting
   */
  async isWaiting(): Promise<boolean> {
    return (await this.getState()) === 'waiting'
  }

  /**
   * Get job by ID from queue
   */
  static async fromId<T = unknown, R = unknown>(
    queue: Queue<T, R>,
    jobId: string
  ): Promise<Job<T, R> | undefined> {
    const internalQueue = globalQueues.get(queue.name)
    if (!internalQueue) return undefined

    const internalJob = internalQueue.jobs.get(jobId)
    if (!internalJob) return undefined

    const job = new Job<T, R>(
      queue,
      internalJob.name,
      internalJob.data as T,
      internalJob.opts,
      internalJob.id
    )
    job.progress = internalJob.progress
    job.attemptsMade = internalJob.attemptsMade
    job.stacktrace = internalJob.stacktrace
    job.returnvalue = internalJob.returnvalue as R | undefined
    job.failedReason = internalJob.failedReason
    job.finishedOn = internalJob.finishedOn
    job.processedOn = internalJob.processedOn

    return job
  }
}

// ============================================================================
// QUEUE CLASS
// ============================================================================

/**
 * Queue class
 * Manages job queue operations
 */
export class Queue<T = unknown, R = unknown> {
  readonly name: string
  readonly opts: QueueOptions

  constructor(name: string, opts: QueueOptions = {}) {
    this.name = name
    this.opts = opts

    // Initialize queue if not exists
    if (!globalQueues.has(name)) {
      globalQueues.set(name, {
        name,
        opts,
        isPaused: false,
        jobs: new Map(),
        repeatableJobs: new Map(),
      })
    }
  }

  /**
   * Add a job to the queue
   */
  async add(name: string, data: T, opts: JobOptions = {}): Promise<Job<T, R>> {
    const queue = globalQueues.get(this.name)!
    const mergedOpts = { ...this.opts.defaultJobOptions, ...opts }

    // Check for duplicate job ID
    if (mergedOpts.jobId && queue.jobs.has(mergedOpts.jobId)) {
      throw new JobAlreadyExistsError(mergedOpts.jobId)
    }

    const job = new Job<T, R>(this, name, data, mergedOpts)

    // Store internal job
    const internalJob: InternalJob = {
      id: job.id,
      name: job.name,
      queueName: this.name,
      data: job.data,
      opts: job.opts,
      progress: job.progress,
      timestamp: job.timestamp,
      attemptsMade: job.attemptsMade,
      stacktrace: job.stacktrace,
      state: mergedOpts.delay ? 'delayed' : 'waiting',
      delayUntil: mergedOpts.delay ? Date.now() + mergedOpts.delay : undefined,
      logs: [],
    }

    queue.jobs.set(job.id, internalJob)

    const emitter = getQueueEmitter(this.name)
    if (mergedOpts.delay) {
      emitter.emit('delayed', { jobId: job.id, delay: mergedOpts.delay })
    } else {
      emitter.emit('waiting', { jobId: job.id })
    }

    return job
  }

  /**
   * Add multiple jobs to the queue
   */
  async addBulk(jobs: BulkJobOptions<T>[]): Promise<Job<T, R>[]> {
    const results: Job<T, R>[] = []

    for (const jobDef of jobs) {
      const job = await this.add(jobDef.name, jobDef.data, jobDef.opts)
      results.push(job)
    }

    return results
  }

  /**
   * Get a job by ID
   */
  async getJob(jobId: string): Promise<Job<T, R> | undefined> {
    return Job.fromId(this, jobId)
  }

  /**
   * Get jobs by state
   */
  async getJobs(
    types: JobState | JobState[] = ['waiting', 'active', 'completed', 'failed', 'delayed'],
    start = 0,
    end = -1
  ): Promise<Job<T, R>[]> {
    const queue = globalQueues.get(this.name)
    if (!queue) return []

    const states = Array.isArray(types) ? types : [types]
    const jobs: Job<T, R>[] = []

    for (const [, internalJob] of queue.jobs) {
      if (states.includes(internalJob.state)) {
        const job = await Job.fromId<T, R>(this, internalJob.id)
        if (job) jobs.push(job)
      }
    }

    // Sort by timestamp
    jobs.sort((a, b) => a.timestamp - b.timestamp)

    // Apply pagination
    const actualEnd = end === -1 ? jobs.length : end + 1
    return jobs.slice(start, actualEnd)
  }

  /**
   * Get waiting jobs
   */
  async getWaiting(start = 0, end = -1): Promise<Job<T, R>[]> {
    return this.getJobs('waiting', start, end)
  }

  /**
   * Get active jobs
   */
  async getActive(start = 0, end = -1): Promise<Job<T, R>[]> {
    return this.getJobs('active', start, end)
  }

  /**
   * Get completed jobs
   */
  async getCompleted(start = 0, end = -1): Promise<Job<T, R>[]> {
    return this.getJobs('completed', start, end)
  }

  /**
   * Get failed jobs
   */
  async getFailed(start = 0, end = -1): Promise<Job<T, R>[]> {
    return this.getJobs('failed', start, end)
  }

  /**
   * Get delayed jobs
   */
  async getDelayed(start = 0, end = -1): Promise<Job<T, R>[]> {
    return this.getJobs('delayed', start, end)
  }

  /**
   * Get job counts
   */
  async getJobCounts(...types: JobState[]): Promise<QueueCounts> {
    const queue = globalQueues.get(this.name)
    if (!queue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, prioritized: 0, paused: 0 }
    }

    const counts: QueueCounts = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      prioritized: 0,
      paused: 0,
    }

    for (const [, job] of queue.jobs) {
      if (job.state in counts) {
        counts[job.state as keyof QueueCounts]++
      }
    }

    return counts
  }

  /**
   * Get job count for specific state
   */
  async getJobCountByTypes(...types: JobState[]): Promise<number> {
    const queue = globalQueues.get(this.name)
    if (!queue) return 0

    let count = 0
    for (const [, job] of queue.jobs) {
      if (types.includes(job.state)) {
        count++
      }
    }

    return count
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    const queue = globalQueues.get(this.name)
    if (queue) {
      queue.isPaused = true
    }

    const emitter = getQueueEmitter(this.name)
    emitter.emit('paused')
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    const queue = globalQueues.get(this.name)
    if (queue) {
      queue.isPaused = false
    }

    const emitter = getQueueEmitter(this.name)
    emitter.emit('resumed')
  }

  /**
   * Check if queue is paused
   */
  async isPaused(): Promise<boolean> {
    const queue = globalQueues.get(this.name)
    return queue?.isPaused ?? false
  }

  /**
   * Remove a job by ID
   */
  async remove(jobId: string): Promise<void> {
    const queue = globalQueues.get(this.name)
    if (!queue) return

    queue.jobs.delete(jobId)

    const emitter = getQueueEmitter(this.name)
    emitter.emit('removed', { jobId })
  }

  /**
   * Drain the queue (remove all waiting jobs)
   */
  async drain(delayed = false): Promise<void> {
    const queue = globalQueues.get(this.name)
    if (!queue) return

    const toDelete: string[] = []
    for (const [id, job] of queue.jobs) {
      if (job.state === 'waiting' || (delayed && job.state === 'delayed')) {
        toDelete.push(id)
      }
    }

    for (const id of toDelete) {
      queue.jobs.delete(id)
    }

    const emitter = getQueueEmitter(this.name)
    emitter.emit('drained')
  }

  /**
   * Clean jobs by state and age
   */
  async clean(grace: number, limit: number, type: JobState): Promise<string[]> {
    const queue = globalQueues.get(this.name)
    if (!queue) return []

    const cutoff = Date.now() - grace
    const cleaned: string[] = []

    for (const [id, job] of queue.jobs) {
      if (cleaned.length >= limit) break

      if (job.state === type) {
        const jobTime = job.finishedOn || job.processedOn || job.timestamp
        if (jobTime < cutoff) {
          queue.jobs.delete(id)
          cleaned.push(id)
        }
      }
    }

    return cleaned
  }

  /**
   * Obliterate the queue (remove all jobs and data)
   */
  async obliterate(opts: { force?: boolean } = {}): Promise<void> {
    const queue = globalQueues.get(this.name)
    if (queue) {
      queue.jobs.clear()
      queue.repeatableJobs.clear()
    }
  }

  /**
   * Retry all failed jobs
   */
  async retryJobs(opts: { count?: number; state?: JobState } = {}): Promise<void> {
    const queue = globalQueues.get(this.name)
    if (!queue) return

    const { count = Infinity, state = 'failed' } = opts
    let retried = 0

    for (const [, internalJob] of queue.jobs) {
      if (retried >= count) break

      if (internalJob.state === state) {
        internalJob.state = 'waiting'
        internalJob.failedReason = undefined
        internalJob.finishedOn = undefined
        internalJob.processedOn = undefined
        internalJob.returnvalue = undefined
        retried++

        const emitter = getQueueEmitter(this.name)
        emitter.emit('waiting', { jobId: internalJob.id })
      }
    }
  }

  /**
   * Add a repeatable job
   */
  async upsertJobScheduler(
    jobSchedulerId: string,
    repeatOpts: RepeatOptions,
    jobTemplate: { name: string; data?: T; opts?: JobOptions } = { name: 'default' }
  ): Promise<Job<T, R> | undefined> {
    const queue = globalQueues.get(this.name)
    if (!queue) return undefined

    queue.repeatableJobs.set(jobSchedulerId, {
      pattern: repeatOpts,
      lastRun: undefined,
    })

    // If immediately, create first job
    if (repeatOpts.immediately) {
      return this.add(jobTemplate.name, jobTemplate.data as T, {
        ...jobTemplate.opts,
        repeat: repeatOpts,
      })
    }

    return undefined
  }

  /**
   * Remove a repeatable job
   */
  async removeJobScheduler(jobSchedulerId: string): Promise<boolean> {
    const queue = globalQueues.get(this.name)
    if (!queue) return false

    return queue.repeatableJobs.delete(jobSchedulerId)
  }

  /**
   * Get all repeatable jobs
   */
  async getJobSchedulers(
    start = 0,
    end = -1
  ): Promise<Array<{ key: string; pattern: RepeatOptions }>> {
    const queue = globalQueues.get(this.name)
    if (!queue) return []

    const schedulers = Array.from(queue.repeatableJobs.entries()).map(([key, value]) => ({
      key,
      pattern: value.pattern,
    }))

    const actualEnd = end === -1 ? schedulers.length : end + 1
    return schedulers.slice(start, actualEnd)
  }

  /**
   * Close the queue
   */
  async close(): Promise<void> {
    const emitter = queueEventEmitters.get(this.name)
    if (emitter) {
      emitter.removeAllListeners()
    }
  }

  /**
   * Disconnect from the queue
   */
  async disconnect(): Promise<void> {
    await this.close()
  }
}

// ============================================================================
// WORKER CLASS
// ============================================================================

/**
 * Worker class
 * Processes jobs from a queue
 */
export class Worker<T = unknown, R = unknown> {
  readonly name: string
  readonly opts: WorkerOptions
  private processor: Processor<T, R>
  private running: boolean = false
  private concurrency: number
  private activeJobs: Set<string> = new Set()
  private pollInterval?: ReturnType<typeof setInterval>
  private emitter: EventEmitterLike

  constructor(
    name: string,
    processor: Processor<T, R>,
    opts: WorkerOptions = {}
  ) {
    this.name = name
    this.processor = processor
    this.opts = opts
    this.concurrency = opts.concurrency ?? 1
    this.emitter = createEventEmitter()

    // Auto-run unless disabled
    if (opts.autorun !== false) {
      this.run()
    }
  }

  /**
   * Start processing jobs
   */
  run(): void {
    if (this.running) return
    this.running = true

    // Emit ready event
    this.emitter.emit('ready')

    // Start polling for jobs
    this.pollInterval = setInterval(() => this.processJobs(), 100)
    this.processJobs()
  }

  /**
   * Process available jobs
   */
  private async processJobs(): Promise<void> {
    if (!this.running) return

    const queue = globalQueues.get(this.name)
    if (!queue || queue.isPaused) return

    // Check delayed jobs
    const now = Date.now()
    for (const [, job] of queue.jobs) {
      if (job.state === 'delayed' && job.delayUntil && job.delayUntil <= now) {
        job.state = 'waiting'
        job.delayUntil = undefined
        const emitter = getQueueEmitter(this.name)
        emitter.emit('waiting', { jobId: job.id })
      }
    }

    // Find waiting jobs
    const waitingJobs: InternalJob[] = []
    for (const [, job] of queue.jobs) {
      if (job.state === 'waiting' && !this.activeJobs.has(job.id)) {
        waitingJobs.push(job)
      }
    }

    // Sort by priority (lower = higher priority)
    waitingJobs.sort((a, b) => {
      const priorityA = a.opts.priority ?? 0
      const priorityB = b.opts.priority ?? 0
      if (priorityA !== priorityB) return priorityA - priorityB
      // LIFO if configured
      if (a.opts.lifo) return b.timestamp - a.timestamp
      return a.timestamp - b.timestamp
    })

    // Process jobs up to concurrency
    const slotsAvailable = this.concurrency - this.activeJobs.size
    const jobsToProcess = waitingJobs.slice(0, slotsAvailable)

    for (const internalJob of jobsToProcess) {
      this.processJob(internalJob)
    }

    // Check if drained
    if (queue.jobs.size === 0 || (waitingJobs.length === 0 && this.activeJobs.size === 0)) {
      this.emitter.emit('drained')
    }
  }

  /**
   * Process a single job
   */
  private async processJob(internalJob: InternalJob): Promise<void> {
    const queue = globalQueues.get(this.name)
    if (!queue) return

    this.activeJobs.add(internalJob.id)
    const token = generateId()

    // Update job state
    internalJob.state = 'active'
    internalJob.token = token
    internalJob.processedOn = Date.now()
    internalJob.attemptsMade++

    // Create Job instance
    const job = new Job<T, R>(
      this.name,
      internalJob.name,
      internalJob.data as T,
      internalJob.opts,
      internalJob.id
    )
    job.progress = internalJob.progress
    job.attemptsMade = internalJob.attemptsMade
    job.stacktrace = internalJob.stacktrace
    job.processedOn = internalJob.processedOn

    // Emit active event
    this.emitter.emit('active', job, 'waiting')
    const queueEmitter = getQueueEmitter(this.name)
    queueEmitter.emit('active', { jobId: job.id, prev: 'waiting' })

    try {
      // Process with timeout
      let result: R
      const timeout = internalJob.opts.timeout
      if (timeout) {
        result = await Promise.race([
          this.processor(job),
          new Promise<R>((_, reject) =>
            setTimeout(() => reject(new JobTimeoutError(job.id, timeout)), timeout)
          ),
        ])
      } else {
        result = await this.processor(job)
      }

      // Job completed
      internalJob.state = 'completed'
      internalJob.returnvalue = result
      internalJob.finishedOn = Date.now()
      internalJob.token = undefined

      job.returnvalue = result
      job.finishedOn = internalJob.finishedOn

      this.emitter.emit('completed', job, result, 'active')
      queueEmitter.emit('completed', {
        jobId: job.id,
        returnvalue: JSON.stringify(result),
        prev: 'active',
      })

      // Handle removeOnComplete
      const removeOnComplete = internalJob.opts.removeOnComplete
      if (removeOnComplete === true) {
        queue.jobs.delete(job.id)
        queueEmitter.emit('removed', { jobId: job.id })
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      const maxAttempts = internalJob.opts.attempts ?? 1

      if (internalJob.attemptsMade < maxAttempts) {
        // Retry with backoff
        const backoff = internalJob.opts.backoff
        let delay = 0
        if (typeof backoff === 'number') {
          delay = backoff
        } else if (backoff) {
          delay = backoff.delay ?? 1000
          if (backoff.type === 'exponential') {
            delay = delay * Math.pow(2, internalJob.attemptsMade - 1)
          }
        }

        internalJob.state = 'delayed'
        internalJob.delayUntil = Date.now() + delay
        internalJob.stacktrace.push(err.stack || err.message)
        internalJob.token = undefined

        queueEmitter.emit('delayed', { jobId: job.id, delay })
      } else {
        // Job failed
        internalJob.state = 'failed'
        internalJob.failedReason = err.message
        internalJob.stacktrace.push(err.stack || err.message)
        internalJob.finishedOn = Date.now()
        internalJob.token = undefined

        job.failedReason = err.message
        job.stacktrace = internalJob.stacktrace
        job.finishedOn = internalJob.finishedOn

        this.emitter.emit('failed', job, err, 'active')
        queueEmitter.emit('failed', {
          jobId: job.id,
          failedReason: err.message,
          prev: 'active',
        })

        // Handle removeOnFail
        const removeOnFail = internalJob.opts.removeOnFail
        if (removeOnFail === true) {
          queue.jobs.delete(job.id)
          queueEmitter.emit('removed', { jobId: job.id })
        }
      }
    } finally {
      this.activeJobs.delete(internalJob.id)
    }
  }

  /**
   * Pause the worker
   */
  async pause(doNotWaitActive = false): Promise<void> {
    const queue = globalQueues.get(this.name)
    if (queue) {
      queue.isPaused = true
    }

    this.emitter.emit('paused')

    if (!doNotWaitActive) {
      // Wait for active jobs to complete
      while (this.activeJobs.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  }

  /**
   * Resume the worker
   */
  async resume(): Promise<void> {
    const queue = globalQueues.get(this.name)
    if (queue) {
      queue.isPaused = false
    }

    this.emitter.emit('resumed')
  }

  /**
   * Check if worker is paused
   */
  isPaused(): boolean {
    const queue = globalQueues.get(this.name)
    return queue?.isPaused ?? false
  }

  /**
   * Check if worker is running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Close the worker
   */
  async close(force = false): Promise<void> {
    this.running = false

    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = undefined
    }

    if (!force) {
      // Wait for active jobs to complete
      while (this.activeJobs.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    this.emitter.emit('closed')
    this.emitter.removeAllListeners()
  }

  /**
   * Event listener
   */
  on(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.on(event, listener)
    return this
  }

  /**
   * Remove event listener
   */
  off(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.off(event, listener)
    return this
  }
}

// ============================================================================
// QUEUE EVENTS CLASS
// ============================================================================

/**
 * QueueEvents class
 * Subscribes to queue events
 */
export class QueueEvents {
  readonly name: string
  private emitter: EventEmitterLike

  constructor(name: string, opts: { connection?: unknown } = {}) {
    this.name = name
    this.emitter = getQueueEmitter(name)
  }

  /**
   * Event listener
   */
  on(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.on(event, listener)
    return this
  }

  /**
   * Remove event listener
   */
  off(event: string, listener: (...args: unknown[]) => void): this {
    this.emitter.off(event, listener)
    return this
  }

  /**
   * Close the event subscriber
   */
  async close(): Promise<void> {
    // Don't remove all listeners - other subscribers may be using them
  }
}

// ============================================================================
// FLOW PRODUCER CLASS
// ============================================================================

/**
 * FlowProducer class
 * Creates job flows with parent-child dependencies
 */
export class FlowProducer {
  private opts: FlowProducerOptions

  constructor(opts: FlowProducerOptions = {}) {
    this.opts = opts
  }

  /**
   * Add a flow of jobs
   */
  async add<T = unknown, R = unknown>(flow: FlowJob<T>): Promise<Job<T, R>> {
    return this.addFlow<T, R>(flow)
  }

  /**
   * Add multiple flows
   */
  async addBulk<T = unknown, R = unknown>(flows: FlowJob<T>[]): Promise<Job<T, R>[]> {
    const results: Job<T, R>[] = []
    for (const flow of flows) {
      results.push(await this.addFlow<T, R>(flow))
    }
    return results
  }

  /**
   * Internal: add a flow recursively
   */
  private async addFlow<T = unknown, R = unknown>(
    flow: FlowJob<T>,
    parent?: ParentKeys
  ): Promise<Job<T, R>> {
    // First, add all children
    const childJobs: Job<T, R>[] = []
    if (flow.children) {
      for (const child of flow.children) {
        childJobs.push(
          await this.addFlow<T, R>(child, {
            queue: flow.queueName,
            id: flow.opts?.jobId || generateId(),
          })
        )
      }
    }

    // Then add the parent job
    const queue = new Queue<T, R>(flow.queueName)
    const opts: JobOptions = {
      ...flow.opts,
      parent,
    }

    return queue.add(flow.name, flow.data, opts)
  }

  /**
   * Close the flow producer
   */
  async close(): Promise<void> {
    // No-op for in-memory implementation
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clear all in-memory data (for testing)
 */
export function _clearAll(): void {
  globalQueues.clear()
  for (const emitter of queueEventEmitters.values()) {
    emitter.removeAllListeners()
  }
  queueEventEmitters.clear()
}

/**
 * Get all queues (for testing/debugging)
 */
export function _getQueues(): Map<string, InternalQueue> {
  return globalQueues
}

/**
 * Delay helper (similar to BullMQ's delay export)
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
