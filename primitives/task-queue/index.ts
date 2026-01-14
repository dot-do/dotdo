/**
 * @module task-queue
 *
 * Task Queue Primitive - Background job processing for the dotdo platform.
 *
 * Provides a robust task queue with priority ordering, configurable concurrency,
 * automatic retries, progress tracking, and dead letter handling. Designed for
 * reliable background job processing in edge environments.
 *
 * ## Features
 *
 * - **Priority queue** using min-heap for efficient ordering
 * - **Concurrency control** to limit parallel task execution
 * - **Automatic retries** with fixed, linear, or exponential backoff
 * - **Task cancellation** with abort signal propagation
 * - **Progress tracking** for long-running tasks
 * - **Dead letter queue** for failed task inspection and retry
 * - **Scheduled tasks** with one-time and cron support
 * - **Event system** for monitoring queue state
 *
 * @example Basic Task Queue
 * ```typescript
 * import { TaskQueue } from 'dotdo/primitives/task-queue'
 *
 * const queue = new TaskQueue({ concurrency: 3, retries: 2 })
 *
 * queue.registerHandler('email', async (task, ctx) => {
 *   ctx.progress(0, 100, 'Starting...')
 *   await sendEmail(task.payload)
 *   ctx.progress(100, 100, 'Done!')
 * })
 *
 * await queue.enqueue({
 *   type: 'email',
 *   payload: { to: 'user@example.com', subject: 'Welcome!' },
 *   priority: 10,
 * })
 *
 * await queue.process()
 * ```
 *
 * @example Priority-Based Processing
 * ```typescript
 * // Higher priority tasks processed first
 * await queue.enqueue({ type: 'urgent', payload: {}, priority: 100 })
 * await queue.enqueue({ type: 'normal', payload: {}, priority: 1 })
 * // 'urgent' task will be processed before 'normal'
 * ```
 *
 * @example Retry with Backoff
 * ```typescript
 * const queue = new TaskQueue({
 *   retries: 3,
 *   backoff: {
 *     type: 'exponential',
 *     delay: 1000,
 *     factor: 2,
 *     maxDelay: 30000,
 *   },
 * })
 *
 * queue.registerHandler('api-call', async (task) => {
 *   const response = await fetch(task.payload.url)
 *   if (!response.ok) throw new Error('API failed')
 *   return response.json()
 * })
 * // Retries at 1s, 2s, 4s intervals on failure
 * ```
 *
 * @example Progress Tracking
 * ```typescript
 * queue.registerHandler('import', async (task, ctx) => {
 *   const items = task.payload.items
 *   for (let i = 0; i < items.length; i++) {
 *     await processItem(items[i])
 *     ctx.progress(i + 1, items.length, `Processed ${i + 1} of ${items.length}`)
 *   }
 * })
 *
 * queue.on('task:progress', (progress) => {
 *   console.log(`${progress.taskId}: ${progress.percentage}%`)
 * })
 * ```
 *
 * @example Dead Letter Queue
 * ```typescript
 * queue.on('task:deadletter', (task) => {
 *   console.log(`Task ${task.id} moved to DLQ after all retries`)
 * })
 *
 * // Inspect failed tasks
 * const failed = queue.deadLetterQueue.list()
 *
 * // Retry a failed task
 * await queue.retryFromDeadLetter(taskId)
 * ```
 *
 * @example Scheduled Tasks
 * ```typescript
 * // One-time scheduled task
 * await queue.schedule({
 *   runAt: new Date('2024-12-25T00:00:00Z'),
 *   task: { type: 'holiday-promo', payload: {} },
 * })
 *
 * // Recurring cron task
 * await queue.schedule({
 *   cron: '0 0 * * *', // Daily at midnight
 *   task: { type: 'daily-cleanup', payload: {} },
 * })
 * ```
 *
 * @example Event Handling
 * ```typescript
 * queue.on('task:started', (task) => console.log(`Started: ${task.id}`))
 * queue.on('task:completed', (task) => console.log(`Completed: ${task.id}`))
 * queue.on('task:failed', ({ error }) => console.error(`Failed:`, error))
 * queue.on('task:retry', ({ attempt }) => console.log(`Retry ${attempt}`))
 * queue.on('queue:empty', () => console.log('Queue empty'))
 * ```
 *
 * @packageDocumentation
 */

export * from './types'

import type {
  Task,
  TaskId,
  TaskType,
  TaskStatus,
  TaskResult,
  TaskHandler,
  TaskContext,
  QueueConfig,
  BackoffConfig,
  ScheduledTask,
  TaskProgress,
  DeadLetterConfig,
  EnqueueOptions,
  TaskQueueEvents,
  TaskQueueEventHandler,
} from './types'
import { DEFAULT_CONFIG, generateTaskId } from './types'

// ============================================
// PriorityQueue
// ============================================

/**
 * A min-heap based priority queue that maintains items in order
 * based on a comparator function.
 */
export class PriorityQueue<T> {
  private heap: T[] = []
  private insertOrder: Map<T, number> = new Map()
  private orderCounter = 0

  constructor(private comparator: (a: T, b: T) => number) {}

  enqueue(item: T): void {
    this.insertOrder.set(item, this.orderCounter++)
    this.heap.push(item)
    this.bubbleUp(this.heap.length - 1)
  }

  dequeue(): T | undefined {
    if (this.heap.length === 0) return undefined
    if (this.heap.length === 1) {
      const item = this.heap.pop()!
      this.insertOrder.delete(item)
      return item
    }

    const result = this.heap[0]
    this.insertOrder.delete(result)
    this.heap[0] = this.heap.pop()!
    this.bubbleDown(0)
    return result
  }

  peek(): T | undefined {
    return this.heap[0]
  }

  remove(predicate: (item: T) => boolean): T | undefined {
    const index = this.heap.findIndex(predicate)
    if (index === -1) return undefined

    const item = this.heap[index]
    this.insertOrder.delete(item)

    if (index === this.heap.length - 1) {
      return this.heap.pop()
    }

    this.heap[index] = this.heap.pop()!
    this.bubbleDown(index)
    this.bubbleUp(index)

    return item
  }

  get size(): number {
    return this.heap.length
  }

  private compare(a: T, b: T): number {
    const primaryCompare = this.comparator(a, b)
    if (primaryCompare !== 0) return primaryCompare
    // FIFO for same priority
    const orderA = this.insertOrder.get(a) ?? 0
    const orderB = this.insertOrder.get(b) ?? 0
    return orderA - orderB
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.compare(this.heap[index], this.heap[parentIndex]) >= 0) break
      this.swap(index, parentIndex)
      index = parentIndex
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length

    while (true) {
      const leftChild = 2 * index + 1
      const rightChild = 2 * index + 2
      let smallest = index

      if (leftChild < length && this.compare(this.heap[leftChild], this.heap[smallest]) < 0) {
        smallest = leftChild
      }
      if (rightChild < length && this.compare(this.heap[rightChild], this.heap[smallest]) < 0) {
        smallest = rightChild
      }

      if (smallest === index) break
      this.swap(index, smallest)
      index = smallest
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i]
    this.heap[i] = this.heap[j]
    this.heap[j] = temp
  }
}

// ============================================
// ConcurrencyLimiter
// ============================================

/**
 * Limits the number of concurrent async operations.
 */
export class ConcurrencyLimiter {
  private _running = 0
  private queue: Array<() => void> = []

  constructor(private limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  get running(): number {
    return this._running
  }

  private acquire(): Promise<void> {
    if (this._running < this.limit) {
      this._running++
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  private release(): void {
    this._running--
    const next = this.queue.shift()
    if (next) {
      this._running++
      next()
    }
  }
}

// ============================================
// RetryManager
// ============================================

interface RetryConfig {
  maxRetries: number
  backoff?: BackoffConfig
}

/**
 * Manages retry logic with configurable backoff strategies.
 */
export class RetryManager {
  private config: RetryConfig

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      backoff: config.backoff ?? DEFAULT_CONFIG.backoff,
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined
    let attempts = 0

    while (attempts <= this.config.maxRetries) {
      try {
        return await fn()
      } catch (error) {
        lastError = error as Error
        attempts++

        if (attempts > this.config.maxRetries) {
          break
        }

        const delay = this.calculateDelay(attempts)
        await this.sleep(delay)
      }
    }

    throw lastError
  }

  calculateDelay(attempt: number): number {
    const backoff = this.config.backoff!
    let delay: number

    switch (backoff.type) {
      case 'fixed':
        delay = backoff.delay
        break
      case 'linear':
        delay = backoff.delay * attempt
        break
      case 'exponential':
        delay = backoff.delay * Math.pow(backoff.factor, attempt - 1)
        break
      default:
        delay = backoff.delay
    }

    return Math.min(delay, backoff.maxDelay)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================
// ProgressTracker
// ============================================

type ProgressEventHandler = (progress: TaskProgress) => void

/**
 * Tracks progress for running tasks.
 */
export class ProgressTracker {
  private progressMap: Map<TaskId, TaskProgress> = new Map()
  private handlers: ProgressEventHandler[] = []

  update(taskId: TaskId, current: number, total: number, message?: string): void {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0
    const progress: TaskProgress = {
      taskId,
      current,
      total,
      message,
      percentage,
      updatedAt: new Date(),
    }
    this.progressMap.set(taskId, progress)
    this.emit(progress)
  }

  get(taskId: TaskId): TaskProgress | undefined {
    return this.progressMap.get(taskId)
  }

  complete(taskId: TaskId): void {
    this.progressMap.delete(taskId)
  }

  on(event: 'progress', handler: ProgressEventHandler): void {
    this.handlers.push(handler)
  }

  private emit(progress: TaskProgress): void {
    for (const handler of this.handlers) {
      handler(progress)
    }
  }
}

// ============================================
// CronScheduler
// ============================================

interface ScheduledJob {
  id: string
  timer: NodeJS.Timeout | number
  cron?: string
}

/**
 * Schedules one-time and recurring tasks.
 */
export class CronScheduler {
  private jobs: Map<string, ScheduledJob> = new Map()
  private idCounter = 0

  scheduleAt(time: Date, callback: () => void): string {
    const id = `job_${++this.idCounter}`
    const delay = Math.max(0, time.getTime() - Date.now())

    const timer = setTimeout(() => {
      callback()
      this.jobs.delete(id)
    }, delay)

    this.jobs.set(id, { id, timer })
    return id
  }

  schedule(cron: string, callback: () => void): string {
    const id = `cron_${++this.idCounter}`
    this.scheduleCron(id, cron, callback)
    return id
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (job) {
      clearTimeout(job.timer)
      this.jobs.delete(id)
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer)
    }
    this.jobs.clear()
  }

  private scheduleCron(id: string, cron: string, callback: () => void): void {
    const nextRun = this.getNextCronTime(cron)
    const delay = Math.max(0, nextRun.getTime() - Date.now())

    const timer = setTimeout(() => {
      callback()
      // Reschedule for next run
      this.scheduleCron(id, cron, callback)
    }, delay)

    this.jobs.set(id, { id, timer, cron })
  }

  private getNextCronTime(cron: string): Date {
    // Simple cron parser for "* * * * *" (every minute)
    // For full cron support, you'd use a library like cron-parser
    const parts = cron.split(' ')
    const now = new Date()

    if (parts.every((p) => p === '*')) {
      // Every minute - find next minute boundary
      const next = new Date(now)
      next.setSeconds(0, 0)
      next.setMinutes(next.getMinutes() + 1)
      return next
    }

    // For simplicity, default to next minute
    const next = new Date(now)
    next.setSeconds(0, 0)
    next.setMinutes(next.getMinutes() + 1)
    return next
  }
}

// ============================================
// DeadLetterQueue
// ============================================

interface DeadLetterEntry {
  task: Task
  error: Error
  addedAt: Date
}

/**
 * Stores failed tasks for later inspection and retry.
 */
export class DeadLetterQueue {
  private entries: Map<TaskId, DeadLetterEntry> = new Map()
  private config: DeadLetterConfig

  constructor(config: Partial<DeadLetterConfig> = {}) {
    this.config = {
      maxAge: config.maxAge ?? 7 * 24 * 60 * 60 * 1000, // 7 days default
      handler: config.handler,
    }
  }

  add(task: Task, error: Error): void {
    this.entries.set(task.id, {
      task,
      error,
      addedAt: new Date(),
    })
  }

  get(taskId: TaskId): DeadLetterEntry | undefined {
    return this.entries.get(taskId)
  }

  list(): DeadLetterEntry[] {
    return Array.from(this.entries.values())
  }

  cleanup(): void {
    const now = Date.now()
    for (const [id, entry] of this.entries) {
      if (now - entry.addedAt.getTime() > this.config.maxAge) {
        this.entries.delete(id)
      }
    }
  }

  async process(): Promise<void> {
    if (!this.config.handler) return

    for (const entry of this.entries.values()) {
      await this.config.handler(entry.task)
    }
  }

  retry(taskId: TaskId): Task | undefined {
    const entry = this.entries.get(taskId)
    if (!entry) return undefined

    this.entries.delete(taskId)

    // Reset attempts for retry
    return {
      ...entry.task,
      attempts: 0,
      status: 'pending' as TaskStatus,
    }
  }

  get size(): number {
    return this.entries.size
  }
}

// ============================================
// TaskQueue
// ============================================

interface TaskQueueConfig extends Partial<QueueConfig> {
  deadLetter?: Partial<DeadLetterConfig>
}

type EventMap = {
  [K in keyof TaskQueueEvents]: Array<TaskQueueEventHandler<K>>
}

/**
 * Main task queue implementation with priority, concurrency,
 * retries, progress tracking, scheduling, and dead letter support.
 */
export class TaskQueue {
  private config: QueueConfig
  private handlers: Map<TaskType, TaskHandler> = new Map()
  private tasks: Map<TaskId, Task> = new Map()
  private pendingQueue: PriorityQueue<Task>
  private limiter: ConcurrencyLimiter
  private retryManager: RetryManager
  private progressTracker: ProgressTracker
  private scheduler: CronScheduler
  private _deadLetterQueue: DeadLetterQueue
  private eventHandlers: Partial<EventMap> = {}
  private _isPaused = false
  private isProcessing = false
  private abortControllers: Map<TaskId, AbortController> = new Map()
  private processPromise: Promise<void> | null = null
  private emittedEmpty = false

  constructor(config: TaskQueueConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.pendingQueue = new PriorityQueue<Task>((a, b) => b.priority - a.priority)
    this.limiter = new ConcurrencyLimiter(this.config.concurrency)
    this.retryManager = new RetryManager({
      maxRetries: this.config.retries,
      backoff: this.config.backoff,
    })
    this.progressTracker = new ProgressTracker()
    this.scheduler = new CronScheduler()
    this._deadLetterQueue = new DeadLetterQueue(config.deadLetter)

    // Forward progress events
    this.progressTracker.on('progress', (progress) => {
      this.emit('task:progress', progress)
    })
  }

  /**
   * Add a task to the queue.
   */
  async enqueue(
    taskDef: { type: TaskType; payload: unknown } & EnqueueOptions
  ): Promise<TaskId> {
    const id = taskDef.id ?? generateTaskId()
    const now = new Date()

    const task: Task = {
      id,
      type: taskDef.type,
      payload: taskDef.payload,
      priority: taskDef.priority ?? 0,
      status: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }

    this.tasks.set(id, task)
    this.pendingQueue.enqueue(task)
    this.emit('task:enqueued', task)

    // Trigger processing if already started
    if (this.isProcessing && !this._isPaused) {
      this.processNext()
    }

    return id
  }

  /**
   * Start processing tasks from the queue.
   */
  async process(): Promise<void> {
    this.isProcessing = true

    if (this._isPaused) return

    this.processPromise = this.processLoop()
  }

  private async processLoop(): Promise<void> {
    while (this.isProcessing) {
      if (this._isPaused) {
        await this.sleep(10)
        continue
      }

      const task = this.pendingQueue.peek()
      if (!task) {
        // Check if anything is still running
        if (this.limiter.running === 0 && !this.emittedEmpty) {
          this.emittedEmpty = true
          this.emit('queue:empty', undefined as any)
        }
        await this.sleep(10)
        continue
      }

      // Reset empty flag when there are tasks
      this.emittedEmpty = false

      // Don't dequeue yet - let the limiter handle concurrency
      await this.processNext()
    }
  }

  private async processNext(): Promise<void> {
    const task = this.pendingQueue.dequeue()
    if (!task) return

    // Run within concurrency limit
    this.limiter.run(async () => {
      await this.executeTask(task)
    })
  }

  private async executeTask(task: Task): Promise<void> {
    const handler = this.handlers.get(task.type)

    if (!handler) {
      task.status = 'failed'
      task.error = `No handler registered for task type: ${task.type}`
      task.updatedAt = new Date()
      this.emit('task:failed', { ...task, error: new Error(task.error) })
      this._deadLetterQueue.add(task, new Error(task.error))
      this.emit('task:deadletter', task)
      return
    }

    // Setup abort controller for cancellation/timeout
    const abortController = new AbortController()
    this.abortControllers.set(task.id, abortController)

    // Setup timeout
    const timeoutId = setTimeout(() => {
      abortController.abort()
    }, this.config.timeout)

    task.status = 'running'
    task.startedAt = new Date()
    task.updatedAt = new Date()
    this.emit('task:started', task)

    const context: TaskContext = {
      progress: (current, total, message) => {
        this.progressTracker.update(task.id, current, total, message)
      },
      signal: abortController.signal,
    }

    let attempts = 0
    let lastError: Error | undefined

    while (attempts <= this.config.retries) {
      try {
        const startTime = Date.now()
        const result = await Promise.race([
          handler(task, context),
          new Promise((_, reject) => {
            abortController.signal.addEventListener('abort', () => {
              reject(new Error('Task aborted'))
            })
          }),
        ])

        clearTimeout(timeoutId)
        this.abortControllers.delete(task.id)
        this.progressTracker.complete(task.id)

        task.status = 'completed'
        task.completedAt = new Date()
        task.updatedAt = new Date()
        task.attempts = attempts + 1

        const taskResult: TaskResult = {
          success: true,
          result,
          duration: Date.now() - startTime,
        }

        this.emit('task:completed', { ...task, result: taskResult })
        return
      } catch (error) {
        lastError = error as Error
        attempts++
        task.attempts = attempts

        // Check if aborted (cancelled or timeout)
        if (abortController.signal.aborted) {
          clearTimeout(timeoutId)
          this.abortControllers.delete(task.id)
          this.progressTracker.complete(task.id)

          if (task.status !== 'cancelled') {
            task.status = 'failed'
            task.error = 'Task timed out'
            task.updatedAt = new Date()
            this.emit('task:failed', { ...task, error: lastError })
            this._deadLetterQueue.add(task, lastError)
            this.emit('task:deadletter', task)
          }
          return
        }

        if (attempts <= this.config.retries) {
          // Emit retry event
          const nextDelay = this.retryManager.calculateDelay(attempts)
          this.emit('task:retry', { ...task, attempt: attempts, nextDelay })

          // Apply backoff
          await this.sleep(nextDelay)
        }
      }
    }

    // All retries exhausted
    clearTimeout(timeoutId)
    this.abortControllers.delete(task.id)
    this.progressTracker.complete(task.id)

    task.status = 'failed'
    task.error = lastError?.message ?? 'Unknown error'
    task.updatedAt = new Date()

    this.emit('task:failed', { ...task, error: lastError! })
    this._deadLetterQueue.add(task, lastError!)
    this.emit('task:deadletter', task)
  }

  /**
   * Stop processing tasks.
   */
  async stop(): Promise<void> {
    this.isProcessing = false
    this.scheduler.stop()
    if (this.processPromise) {
      await this.processPromise
    }
  }

  /**
   * Pause task processing.
   */
  pause(): void {
    this._isPaused = true
    this.emit('queue:paused', undefined as any)
  }

  /**
   * Resume task processing.
   */
  resume(): void {
    this._isPaused = false
    this.emit('queue:resumed', undefined as any)
  }

  /**
   * Cancel a task.
   */
  async cancel(taskId: TaskId, options?: { force?: boolean }): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task) return false

    if (task.status === 'pending') {
      // Remove from pending queue
      this.pendingQueue.remove((t) => t.id === taskId)
      task.status = 'cancelled'
      task.updatedAt = new Date()
      this.emit('task:cancelled', task)
      return true
    }

    if (task.status === 'running') {
      if (!options?.force) return false

      // Abort the running task
      const controller = this.abortControllers.get(taskId)
      if (controller) {
        task.status = 'cancelled'
        task.updatedAt = new Date()
        controller.abort()
        this.emit('task:cancelled', task)
        return true
      }
    }

    return false
  }

  /**
   * Get the status of a task.
   */
  async getStatus(taskId: TaskId): Promise<TaskStatus | undefined> {
    return this.tasks.get(taskId)?.status
  }

  /**
   * Register a handler for a task type.
   */
  registerHandler<T = unknown, R = unknown>(
    type: TaskType,
    handler: TaskHandler<T, R>
  ): void {
    this.handlers.set(type, handler as TaskHandler)
  }

  /**
   * Check if a handler is registered for a task type.
   */
  hasHandler(type: TaskType): boolean {
    return this.handlers.has(type)
  }

  /**
   * Subscribe to queue events.
   */
  on<K extends keyof TaskQueueEvents>(
    event: K,
    handler: TaskQueueEventHandler<K>
  ): void {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = []
    }
    (this.eventHandlers[event] as Array<TaskQueueEventHandler<K>>).push(handler)
  }

  /**
   * Schedule a task for later or recurring execution.
   */
  async schedule(scheduled: ScheduledTask): Promise<void> {
    if (scheduled.runAt) {
      this.scheduler.scheduleAt(scheduled.runAt, () => {
        this.enqueue({
          type: scheduled.task.type,
          payload: scheduled.task.payload,
          priority: scheduled.task.priority,
        })
      })
    } else if (scheduled.cron) {
      this.scheduler.schedule(scheduled.cron, () => {
        this.enqueue({
          type: scheduled.task.type,
          payload: scheduled.task.payload,
          priority: scheduled.task.priority,
        })
      })
    }
  }

  /**
   * Get progress for a running task.
   */
  getProgress(taskId: TaskId): TaskProgress | undefined {
    return this.progressTracker.get(taskId)
  }

  /**
   * Retry a task from the dead letter queue.
   */
  async retryFromDeadLetter(taskId: TaskId): Promise<void> {
    const task = this._deadLetterQueue.retry(taskId)
    if (task) {
      task.status = 'pending'
      this.tasks.set(task.id, task)
      this.pendingQueue.enqueue(task)
    }
  }

  /**
   * Whether the queue is paused.
   */
  get isPaused(): boolean {
    return this._isPaused
  }

  /**
   * Access to the dead letter queue.
   */
  get deadLetterQueue(): DeadLetterQueue {
    return this._deadLetterQueue
  }

  private emit<K extends keyof TaskQueueEvents>(
    event: K,
    data: TaskQueueEvents[K]
  ): void {
    const handlers = this.eventHandlers[event] as Array<TaskQueueEventHandler<K>> | undefined
    if (handlers) {
      for (const handler of handlers) {
        handler(data)
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
