/**
 * SchedulerEngine - Comprehensive Job Scheduling System
 *
 * A powerful job scheduler with support for cron expressions, intervals,
 * one-time jobs, retries, timeouts, priority queuing, and timezone handling.
 */

import type {
  Job,
  JobSchedule,
  JobExecution,
  JobStatus,
  SchedulerConfig,
  CronExpression,
  JobContext,
  ScheduledJob,
  JobStatusInfo,
  JobOptions,
  JobHandler,
} from './types'

// Re-export types
export type {
  Job,
  JobSchedule,
  JobExecution,
  JobStatus,
  SchedulerConfig,
  CronExpression,
  JobContext,
  ScheduledJob,
  JobStatusInfo,
  JobOptions,
  JobHandler,
}

// ===========================================================================
// TimezoneHandler - Timezone-aware date handling
// ===========================================================================

export class TimezoneHandler {
  /**
   * Convert a UTC date to a specific timezone
   */
  toTimezone(date: Date, timezone: string): Date {
    if (timezone === 'UTC') {
      return new Date(date)
    }

    try {
      // Validate timezone by attempting to use it
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })

      const parts = formatter.formatToParts(date)
      const get = (type: string) => parts.find((p) => p.type === type)?.value || '0'

      const year = parseInt(get('year'))
      const month = parseInt(get('month')) - 1
      const day = parseInt(get('day'))
      const hour = parseInt(get('hour'))
      const minute = parseInt(get('minute'))
      const second = parseInt(get('second'))

      return new Date(year, month, day, hour, minute, second)
    } catch {
      throw new Error(`Invalid timezone: ${timezone}`)
    }
  }

  /**
   * Convert a local date in a timezone to UTC
   */
  toUTC(date: Date, timezone: string): Date {
    if (timezone === 'UTC') {
      return new Date(date)
    }

    try {
      // Get the timezone offset for this date
      const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
      const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }))
      const offset = utcDate.getTime() - tzDate.getTime()

      return new Date(date.getTime() + offset)
    } catch {
      throw new Error(`Invalid timezone: ${timezone}`)
    }
  }
}

// ===========================================================================
// CronParser - Parse and evaluate cron expressions
// ===========================================================================

export class CronParser {
  private static FIELD_RANGES = {
    minute: { min: 0, max: 59 },
    hour: { min: 0, max: 23 },
    day: { min: 1, max: 31 },
    month: { min: 1, max: 12 },
    weekday: { min: 0, max: 6 },
  }

  /**
   * Parse a cron expression string into structured format
   */
  static parse(expression: string): CronExpression {
    const parts = expression.trim().split(/\s+/)

    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`)
    }

    return {
      minute: parts[0],
      hour: parts[1],
      day: parts[2],
      month: parts[3],
      weekday: parts[4],
    }
  }

  /**
   * Validate a cron expression
   */
  static validate(expression: string): boolean {
    try {
      const parsed = this.parse(expression)
      return (
        this.validateField(String(parsed.minute), 'minute') &&
        this.validateField(String(parsed.hour), 'hour') &&
        this.validateField(String(parsed.day), 'day') &&
        this.validateField(String(parsed.month), 'month') &&
        this.validateField(String(parsed.weekday), 'weekday')
      )
    } catch {
      return false
    }
  }

  private static validateField(value: string, field: keyof typeof CronParser.FIELD_RANGES): boolean {
    const range = this.FIELD_RANGES[field]

    // Handle wildcard
    if (value === '*') return true

    // Handle step values (*/5, 0-30/5)
    const stepMatch = value.match(/^(.+)\/(\d+)$/)
    if (stepMatch) {
      const step = parseInt(stepMatch[2])
      if (step < 1) return false
      return this.validateField(stepMatch[1], field)
    }

    // Handle ranges (0-30)
    const rangeMatch = value.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1])
      const end = parseInt(rangeMatch[2])
      return start >= range.min && end <= range.max && start <= end
    }

    // Handle lists (0,15,30,45)
    if (value.includes(',')) {
      return value.split(',').every((v) => this.validateField(v.trim(), field))
    }

    // Handle single number
    const num = parseInt(value)
    return !isNaN(num) && num >= range.min && num <= range.max
  }

  /**
   * Get the next run time for a cron expression
   */
  static getNextRun(expression: string, from: Date = new Date(), timezone?: string): Date {
    const parsed = typeof expression === 'string' ? this.parse(expression) : expression
    const tzHandler = new TimezoneHandler()

    // Work in UTC for consistency
    let current = new Date(from)

    // Move to next minute
    current.setUTCSeconds(0, 0)
    current.setUTCMinutes(current.getUTCMinutes() + 1)

    // Search for next matching time (limit iterations to prevent infinite loop)
    for (let i = 0; i < 366 * 24 * 60; i++) {
      if (this.matchesUTC(parsed, current)) {
        return current
      }
      current.setUTCMinutes(current.getUTCMinutes() + 1)
    }

    throw new Error('Could not find next run time within a year')
  }

  /**
   * Check if a date matches the cron expression (using UTC)
   */
  private static matchesUTC(cron: CronExpression, date: Date): boolean {
    return (
      this.fieldMatches(String(cron.minute), date.getUTCMinutes(), 'minute') &&
      this.fieldMatches(String(cron.hour), date.getUTCHours(), 'hour') &&
      this.fieldMatches(String(cron.day), date.getUTCDate(), 'day') &&
      this.fieldMatches(String(cron.month), date.getUTCMonth() + 1, 'month') &&
      this.fieldMatches(String(cron.weekday), date.getUTCDay(), 'weekday')
    )
  }

  /**
   * Check if a date matches the cron expression
   */
  private static matches(cron: CronExpression, date: Date): boolean {
    return (
      this.fieldMatches(String(cron.minute), date.getMinutes(), 'minute') &&
      this.fieldMatches(String(cron.hour), date.getHours(), 'hour') &&
      this.fieldMatches(String(cron.day), date.getDate(), 'day') &&
      this.fieldMatches(String(cron.month), date.getMonth() + 1, 'month') &&
      this.fieldMatches(String(cron.weekday), date.getDay(), 'weekday')
    )
  }

  private static fieldMatches(pattern: string, value: number, _field: keyof typeof CronParser.FIELD_RANGES): boolean {
    // Wildcard matches everything
    if (pattern === '*') return true

    // Handle step values
    const stepMatch = pattern.match(/^(.+)\/(\d+)$/)
    if (stepMatch) {
      const basePattern = stepMatch[1]
      const step = parseInt(stepMatch[2])

      if (basePattern === '*') {
        return value % step === 0
      }

      const rangeMatch = basePattern.match(/^(\d+)-(\d+)$/)
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1])
        const end = parseInt(rangeMatch[2])
        return value >= start && value <= end && (value - start) % step === 0
      }
    }

    // Handle ranges
    const rangeMatch = pattern.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1])
      const end = parseInt(rangeMatch[2])
      return value >= start && value <= end
    }

    // Handle lists
    if (pattern.includes(',')) {
      return pattern.split(',').some((v) => this.fieldMatches(v.trim(), value, _field))
    }

    // Handle single value
    return parseInt(pattern) === value
  }
}

// ===========================================================================
// JobQueue - Priority queue for job scheduling
// ===========================================================================

export interface QueuedJob {
  id: string
  priority: number
  scheduledAt: Date
}

export class JobQueue {
  private queue: QueuedJob[] = []

  /**
   * Add a job to the queue
   */
  enqueue(job: QueuedJob): void {
    this.queue.push(job)
    this.sortQueue()
  }

  /**
   * Remove and return the highest priority job
   */
  dequeue(): QueuedJob | null {
    return this.queue.shift() || null
  }

  /**
   * View the highest priority job without removing
   */
  peek(): QueuedJob | null {
    return this.queue[0] || null
  }

  /**
   * Remove a specific job from the queue
   */
  remove(id: string): void {
    this.queue = this.queue.filter((j) => j.id !== id)
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.queue.length
  }

  /**
   * Sort queue by priority (higher first) then by scheduled time (earlier first)
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      // Higher priority first
      if (b.priority !== a.priority) {
        return b.priority - a.priority
      }
      // Earlier scheduled time first
      return a.scheduledAt.getTime() - b.scheduledAt.getTime()
    })
  }
}

// ===========================================================================
// OverlapHandler - Track and manage concurrent job executions
// ===========================================================================

export class OverlapHandler {
  private runningJobs = new Map<string, number>()

  /**
   * Check if a job can execute based on overlap settings
   */
  canExecute(jobId: string, allowOverlap: boolean): boolean {
    if (allowOverlap) return true
    return (this.runningJobs.get(jobId) || 0) === 0
  }

  /**
   * Mark a job as running
   */
  markRunning(jobId: string): void {
    const current = this.runningJobs.get(jobId) || 0
    this.runningJobs.set(jobId, current + 1)
  }

  /**
   * Mark a job as complete
   */
  markComplete(jobId: string): void {
    const current = this.runningJobs.get(jobId) || 0
    if (current > 0) {
      this.runningJobs.set(jobId, current - 1)
    }
  }

  /**
   * Get the count of running instances for a job
   */
  getRunningCount(jobId: string): number {
    return this.runningJobs.get(jobId) || 0
  }
}

// ===========================================================================
// ExecutionTracker - Track job execution history
// ===========================================================================

export interface ExecutionTrackerOptions {
  maxHistoryPerJob?: number
}

export class ExecutionTracker {
  private running = new Map<string, JobExecution>()
  private history = new Map<string, JobExecution[]>()
  private maxHistoryPerJob: number

  constructor(options: ExecutionTrackerOptions = {}) {
    this.maxHistoryPerJob = options.maxHistoryPerJob ?? 100
  }

  /**
   * Start tracking an execution
   */
  start(execution: JobExecution): void {
    this.running.set(execution.id, { ...execution })
  }

  /**
   * Mark execution as completed
   */
  complete(executionId: string, result: unknown): void {
    const execution = this.running.get(executionId)
    if (!execution) return

    execution.completedAt = new Date()
    execution.status = 'completed'
    execution.result = result
    execution.duration = execution.completedAt.getTime() - execution.startedAt.getTime()

    this.running.delete(executionId)
    this.addToHistory(execution)
  }

  /**
   * Mark execution as failed
   */
  fail(executionId: string, error: Error): void {
    const execution = this.running.get(executionId)
    if (!execution) return

    execution.completedAt = new Date()
    execution.status = 'failed'
    execution.error = error.message
    execution.duration = execution.completedAt.getTime() - execution.startedAt.getTime()

    this.running.delete(executionId)
    this.addToHistory(execution)
  }

  /**
   * Mark execution as cancelled
   */
  cancel(executionId: string): void {
    const execution = this.running.get(executionId)
    if (!execution) return

    execution.completedAt = new Date()
    execution.status = 'cancelled'
    execution.duration = execution.completedAt.getTime() - execution.startedAt.getTime()

    this.running.delete(executionId)
    this.addToHistory(execution)
  }

  /**
   * Get running execution for a job
   */
  getRunning(jobId: string): JobExecution | null {
    for (const execution of this.running.values()) {
      if (execution.jobId === jobId) {
        return execution
      }
    }
    return null
  }

  /**
   * Get execution history for a job
   */
  getHistory(jobId: string): JobExecution[] {
    return this.history.get(jobId) || []
  }

  /**
   * Add an already-completed execution directly to history
   */
  addCompletedExecution(execution: JobExecution): void {
    this.addToHistory(execution)
  }

  private addToHistory(execution: JobExecution): void {
    const jobHistory = this.history.get(execution.jobId) || []
    jobHistory.push({ ...execution })

    // Limit history size
    if (jobHistory.length > this.maxHistoryPerJob) {
      jobHistory.shift()
    }

    this.history.set(execution.jobId, jobHistory)
  }
}

// ===========================================================================
// JobRunner - Execute jobs with retry and timeout support
// ===========================================================================

export class JobRunner {
  private abortControllers = new Map<string, AbortController>()

  /**
   * Run a job and return the execution result
   */
  async run(job: Job, options: { scheduledAt?: Date; attempt?: number } = {}): Promise<JobExecution> {
    const executionId = this.generateId()
    const abortController = new AbortController()
    this.abortControllers.set(job.id, abortController)

    const scheduledAt = options.scheduledAt || new Date()
    const startedAt = new Date()

    const execution: JobExecution = {
      id: executionId,
      jobId: job.id,
      jobName: job.name,
      startedAt,
      completedAt: null,
      status: 'running',
      attempt: options.attempt || 0,
      scheduledAt,
      duration: null,
    }

    const context: JobContext = {
      jobId: job.id,
      jobName: job.name,
      executionId,
      scheduledAt,
      startedAt,
      attempt: options.attempt || 0,
      signal: abortController.signal,
    }

    const timeout = job.options?.timeout ?? 30000

    try {
      const result = await Promise.race([
        Promise.resolve(job.handler(context)),
        this.createTimeout(timeout, abortController),
      ])

      execution.completedAt = new Date()
      execution.status = 'completed'
      execution.result = result
      execution.duration = execution.completedAt.getTime() - startedAt.getTime()
    } catch (error) {
      execution.completedAt = new Date()
      execution.status = 'failed'
      execution.error = error instanceof Error ? error.message : String(error)
      execution.duration = execution.completedAt.getTime() - startedAt.getTime()
    } finally {
      this.abortControllers.delete(job.id)
    }

    return execution
  }

  /**
   * Cancel a running job
   */
  cancel(jobId: string): void {
    const controller = this.abortControllers.get(jobId)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(jobId)
    }
  }

  private createTimeout(ms: number, controller: AbortController): Promise<never> {
    return new Promise((_, reject) => {
      const timeout = setTimeout(() => {
        controller.abort()
        reject(new Error(`Job timeout after ${ms}ms`))
      }, ms)

      controller.signal.addEventListener('abort', () => {
        clearTimeout(timeout)
      })
    })
  }

  private generateId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }
}

// ===========================================================================
// SchedulerEngine - Main scheduler class
// ===========================================================================

export class SchedulerEngine {
  private jobs = new Map<string, ScheduledJob>()
  private config: Required<SchedulerConfig>
  private running = false
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private pendingQueue = new JobQueue()
  private overlapHandler = new OverlapHandler()
  private executionTracker: ExecutionTracker
  private jobRunner = new JobRunner()
  private runningCount = 0
  private executionPromises = new Map<string, Promise<JobExecution>>()

  constructor(config: SchedulerConfig = {}) {
    this.config = {
      concurrency: config.concurrency ?? 10,
      timezone: config.timezone ?? 'UTC',
      persistence: config.persistence ?? false,
      tickInterval: config.tickInterval ?? 1000,
      onError: config.onError ?? (() => {}),
    }
    this.executionTracker = new ExecutionTracker()
  }

  /**
   * Schedule a new job
   */
  schedule<T = unknown>(job: Job<T>): void {
    if (this.jobs.has(job.id)) {
      throw new Error(`Job with ID "${job.id}" already exists`)
    }

    // For interval jobs, set nextRun to now (execute immediately on first tick)
    let nextRun: Date | null
    if (job.schedule.interval) {
      nextRun = new Date() // Execute immediately
    } else {
      nextRun = this.calculateNextRun(job.schedule)
    }

    const scheduledJob: ScheduledJob<T> = {
      job,
      nextRun,
      lastRun: null,
      paused: false,
      currentExecution: null,
    }

    this.jobs.set(job.id, scheduledJob as ScheduledJob)
  }

  /**
   * Unschedule (remove) a job
   */
  unschedule(jobId: string): void {
    const scheduledJob = this.jobs.get(jobId)
    if (!scheduledJob) {
      throw new Error('Job not found')
    }

    // Cancel any running execution
    this.jobRunner.cancel(jobId)

    // If there's a current execution, mark it as cancelled in history
    if (scheduledJob.currentExecution) {
      const cancelledExecution: JobExecution = {
        ...scheduledJob.currentExecution,
        completedAt: new Date(),
        status: 'cancelled',
        duration: Date.now() - scheduledJob.currentExecution.startedAt.getTime(),
      }
      this.executionTracker.addCompletedExecution(cancelledExecution)
    }

    this.jobs.delete(jobId)
    this.pendingQueue.remove(jobId)
  }

  /**
   * Manually run a job
   */
  async run(jobId: string): Promise<JobExecution> {
    const scheduledJob = this.jobs.get(jobId)
    if (!scheduledJob) {
      throw new Error('Job not found')
    }

    return this.executeJob(scheduledJob, new Date())
  }

  /**
   * Pause a job
   */
  pause(jobId: string): void {
    const scheduledJob = this.jobs.get(jobId)
    if (!scheduledJob) {
      throw new Error('Job not found')
    }

    scheduledJob.paused = true
  }

  /**
   * Resume a paused job
   */
  resume(jobId: string): void {
    const scheduledJob = this.jobs.get(jobId)
    if (!scheduledJob) {
      throw new Error('Job not found')
    }

    scheduledJob.paused = false

    // Recalculate next run time
    if (scheduledJob.job.schedule.interval) {
      scheduledJob.nextRun = new Date() // Execute immediately
    } else {
      scheduledJob.nextRun = this.calculateNextRun(scheduledJob.job.schedule)
    }
  }

  /**
   * Get status of a job
   */
  getStatus(jobId: string): JobStatusInfo | null {
    const scheduledJob = this.jobs.get(jobId)
    if (!scheduledJob) {
      return null
    }

    const history = this.executionTracker.getHistory(jobId)
    const lastExecution = history.length > 0 ? history[history.length - 1] : null

    return {
      id: jobId,
      name: scheduledJob.job.name,
      scheduled: true,
      paused: scheduledJob.paused,
      running: scheduledJob.currentExecution !== null,
      nextRun: scheduledJob.nextRun,
      lastRun: scheduledJob.lastRun,
      lastStatus: lastExecution?.status ?? null,
    }
  }

  /**
   * Get execution history for a job
   */
  getHistory(jobId: string): JobExecution[] {
    return this.executionTracker.getHistory(jobId)
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) return

    this.running = true

    // Initial tick to execute any immediately due jobs
    this.tick()

    // Set up periodic tick
    this.tickTimer = setInterval(() => {
      this.tick()
    }, this.config.tickInterval)
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) return

    this.running = false

    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  }

  /**
   * Calculate the next run time for a schedule
   */
  private calculateNextRun(schedule: JobSchedule): Date | null {
    const timezone = schedule.timezone || this.config.timezone

    // One-time job
    if (schedule.at) {
      const atTime = schedule.at instanceof Date ? schedule.at : new Date(schedule.at)
      return atTime
    }

    // Interval job - calculate from now
    if (schedule.interval) {
      return new Date(Date.now() + schedule.interval)
    }

    // Cron job
    if (schedule.cron) {
      const cronExpr =
        typeof schedule.cron === 'string'
          ? schedule.cron
          : `${schedule.cron.minute} ${schedule.cron.hour} ${schedule.cron.day} ${schedule.cron.month} ${schedule.cron.weekday}`

      return CronParser.getNextRun(cronExpr, new Date(), timezone)
    }

    return null
  }

  /**
   * Scheduler tick - check for due jobs and execute
   */
  private tick(): void {
    if (!this.running) return

    const now = Date.now()

    // Check all jobs for due execution
    for (const scheduledJob of this.jobs.values()) {
      // Skip disabled jobs
      if (scheduledJob.job.enabled === false) continue

      // Skip paused jobs
      if (scheduledJob.paused) continue

      // Check if job is due
      if (scheduledJob.nextRun && scheduledJob.nextRun.getTime() <= now) {
        // Check overlap
        const allowOverlap = scheduledJob.job.options?.overlap ?? false
        if (!this.overlapHandler.canExecute(scheduledJob.job.id, allowOverlap)) {
          // Skip this execution, recalculate next run
          this.updateNextRun(scheduledJob)
          continue
        }

        // Queue for execution with priority
        const priority = scheduledJob.job.options?.priority ?? 0
        this.pendingQueue.enqueue({
          id: scheduledJob.job.id,
          priority,
          scheduledAt: scheduledJob.nextRun,
        })

        // Update next run immediately to avoid re-queuing
        this.updateNextRun(scheduledJob)
      }
    }

    // Process queue within concurrency limits
    this.processQueue()
  }

  /**
   * Process the pending job queue
   */
  private processQueue(): void {
    while (this.runningCount < this.config.concurrency && this.pendingQueue.size() > 0) {
      const queuedJob = this.pendingQueue.dequeue()
      if (!queuedJob) break

      const scheduledJob = this.jobs.get(queuedJob.id)
      if (!scheduledJob) continue

      // Execute the job
      this.runningCount++

      const promise = this.executeJob(scheduledJob, queuedJob.scheduledAt)
        .finally(() => {
          this.runningCount--
          this.executionPromises.delete(queuedJob.id)
          // Try to process more jobs after one completes
          if (this.running) {
            this.processQueue()
          }
        })
        .catch(() => {
          // Error already handled in executeJob
        })

      this.executionPromises.set(queuedJob.id, promise)
    }
  }

  /**
   * Execute a job with retry support
   */
  private async executeJob(scheduledJob: ScheduledJob, scheduledAt: Date): Promise<JobExecution> {
    const job = scheduledJob.job
    const retryConfig = job.options?.retry
    const maxAttempts = retryConfig?.maxAttempts ?? 1
    const retryDelay = retryConfig?.delay ?? 1000
    const backoff = retryConfig?.backoff ?? 1

    this.overlapHandler.markRunning(job.id)

    let lastExecution: JobExecution | null = null

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const execution = await this.jobRunner.run(job, {
        scheduledAt,
        attempt,
      })

      scheduledJob.currentExecution = execution

      // Add to history
      this.executionTracker.addCompletedExecution(execution)

      if (execution.status === 'completed') {
        scheduledJob.lastRun = execution.completedAt
        scheduledJob.currentExecution = null
        this.overlapHandler.markComplete(job.id)
        return execution
      }

      // Failed - continue to retry if possible
      lastExecution = execution

      // If we have retries left, wait before next attempt
      if (attempt < maxAttempts - 1) {
        const delay = retryDelay * Math.pow(backoff, attempt)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    // All attempts failed
    scheduledJob.lastRun = lastExecution?.completedAt ?? new Date()
    scheduledJob.currentExecution = null
    this.overlapHandler.markComplete(job.id)

    // Call error handler
    if (lastExecution) {
      this.config.onError(new Error(lastExecution.error || 'Job failed'), job, lastExecution)
    }

    return lastExecution!
  }

  /**
   * Update the next run time for a job
   */
  private updateNextRun(scheduledJob: ScheduledJob): void {
    const schedule = scheduledJob.job.schedule

    // One-time jobs don't reschedule
    if (schedule.at) {
      scheduledJob.nextRun = null
      return
    }

    // Recalculate next run
    scheduledJob.nextRun = this.calculateNextRun(schedule)
  }
}
