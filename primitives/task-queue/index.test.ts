import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TaskQueue,
  PriorityQueue,
  RetryManager,
  ConcurrencyLimiter,
  ProgressTracker,
  CronScheduler,
  DeadLetterQueue,
} from './index'
import type { Task, TaskHandler, QueueConfig, TaskContext } from './types'

describe('TaskQueue', () => {
  let queue: TaskQueue

  beforeEach(() => {
    queue = new TaskQueue()
  })

  afterEach(async () => {
    await queue.stop()
  })

  describe('Basic enqueue and process', () => {
    it('should enqueue a task and return task id', async () => {
      const taskId = await queue.enqueue({ type: 'test', payload: { data: 'hello' } })
      expect(taskId).toBeDefined()
      expect(typeof taskId).toBe('string')
    })

    it('should process an enqueued task', async () => {
      const handler = vi.fn().mockResolvedValue('done')
      queue.registerHandler('test', handler)

      await queue.enqueue({ type: 'test', payload: { value: 42 } })
      await queue.process()

      // Give some time for processing
      await new Promise((r) => setTimeout(r, 50))

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler.mock.calls[0][0].payload).toEqual({ value: 42 })
    })

    it('should get task status', async () => {
      queue.registerHandler('test', vi.fn().mockResolvedValue('done'))

      const taskId = await queue.enqueue({ type: 'test', payload: {} })
      const status = await queue.getStatus(taskId)

      expect(status).toBe('pending')
    })

    it('should update task status to completed after processing', async () => {
      const handler = vi.fn().mockResolvedValue('done')
      queue.registerHandler('test', handler)

      const taskId = await queue.enqueue({ type: 'test', payload: {} })
      await queue.process()

      // Wait for processing
      await new Promise((r) => setTimeout(r, 50))

      const status = await queue.getStatus(taskId)
      expect(status).toBe('completed')
    })

    it('should emit task:enqueued event', async () => {
      const listener = vi.fn()
      queue.on('task:enqueued', listener)

      await queue.enqueue({ type: 'test', payload: { x: 1 } })

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0][0].type).toBe('test')
    })

    it('should emit task:completed event', async () => {
      const listener = vi.fn()
      queue.on('task:completed', listener)
      queue.registerHandler('test', vi.fn().mockResolvedValue('result'))

      await queue.enqueue({ type: 'test', payload: {} })
      await queue.process()

      await new Promise((r) => setTimeout(r, 50))

      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe('Handler registration', () => {
    it('should register a handler for a task type', () => {
      const handler: TaskHandler = vi.fn()
      queue.registerHandler('email', handler)

      expect(queue.hasHandler('email')).toBe(true)
    })

    it('should throw if no handler registered for task type', async () => {
      await queue.enqueue({ type: 'unknown', payload: {} })
      await queue.process()

      await new Promise((r) => setTimeout(r, 50))

      const taskId = (await queue.enqueue({ type: 'unknown', payload: {} }))
      await new Promise((r) => setTimeout(r, 50))

      // Should mark as failed
      const status = await queue.getStatus(taskId)
      expect(status).toBe('failed')
    })

    it('should process tasks with correct handler based on type', async () => {
      const emailHandler = vi.fn().mockResolvedValue('email sent')
      const smsHandler = vi.fn().mockResolvedValue('sms sent')

      queue.registerHandler('email', emailHandler)
      queue.registerHandler('sms', smsHandler)

      await queue.enqueue({ type: 'email', payload: { to: 'user@test.com' } })
      await queue.enqueue({ type: 'sms', payload: { to: '+1234567890' } })

      await queue.process()
      await new Promise((r) => setTimeout(r, 100))

      expect(emailHandler).toHaveBeenCalledTimes(1)
      expect(smsHandler).toHaveBeenCalledTimes(1)
    })
  })
})

describe('PriorityQueue', () => {
  let pq: PriorityQueue<Task>

  beforeEach(() => {
    pq = new PriorityQueue((a, b) => b.priority - a.priority)
  })

  it('should enqueue and dequeue in priority order', () => {
    const low = { id: '1', priority: 1 } as Task
    const high = { id: '2', priority: 10 } as Task
    const medium = { id: '3', priority: 5 } as Task

    pq.enqueue(low)
    pq.enqueue(high)
    pq.enqueue(medium)

    expect(pq.dequeue()?.id).toBe('2') // high
    expect(pq.dequeue()?.id).toBe('3') // medium
    expect(pq.dequeue()?.id).toBe('1') // low
  })

  it('should return undefined when empty', () => {
    expect(pq.dequeue()).toBeUndefined()
  })

  it('should report correct size', () => {
    expect(pq.size).toBe(0)

    pq.enqueue({ id: '1', priority: 1 } as Task)
    expect(pq.size).toBe(1)

    pq.enqueue({ id: '2', priority: 2 } as Task)
    expect(pq.size).toBe(2)

    pq.dequeue()
    expect(pq.size).toBe(1)
  })

  it('should peek without removing', () => {
    pq.enqueue({ id: '1', priority: 5 } as Task)
    pq.enqueue({ id: '2', priority: 10 } as Task)

    expect(pq.peek()?.id).toBe('2')
    expect(pq.size).toBe(2)
  })

  it('should remove a specific item', () => {
    const task1 = { id: '1', priority: 1 } as Task
    const task2 = { id: '2', priority: 2 } as Task

    pq.enqueue(task1)
    pq.enqueue(task2)

    const removed = pq.remove((t) => t.id === '1')
    expect(removed?.id).toBe('1')
    expect(pq.size).toBe(1)
  })
})

describe('ConcurrencyLimiter', () => {
  it('should limit concurrent executions', async () => {
    const limiter = new ConcurrencyLimiter(2)
    let concurrent = 0
    let maxConcurrent = 0

    const task = async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 50))
      concurrent--
    }

    const promises = [
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
    ]

    await Promise.all(promises)

    expect(maxConcurrent).toBe(2)
  })

  it('should return task result', async () => {
    const limiter = new ConcurrencyLimiter(1)

    const result = await limiter.run(async () => 'hello')
    expect(result).toBe('hello')
  })

  it('should report current count', async () => {
    const limiter = new ConcurrencyLimiter(2)

    expect(limiter.running).toBe(0)

    const promise = limiter.run(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(limiter.running).toBe(1)

    await promise
    expect(limiter.running).toBe(0)
  })
})

describe('RetryManager', () => {
  it('should retry on failure', async () => {
    const manager = new RetryManager({ maxRetries: 3 })
    let attempts = 0

    const result = await manager.execute(async () => {
      attempts++
      if (attempts < 3) throw new Error('fail')
      return 'success'
    })

    expect(result).toBe('success')
    expect(attempts).toBe(3)
  })

  it('should throw after max retries', async () => {
    const manager = new RetryManager({ maxRetries: 2 })
    let attempts = 0

    await expect(
      manager.execute(async () => {
        attempts++
        throw new Error('always fail')
      })
    ).rejects.toThrow('always fail')

    expect(attempts).toBe(3) // Initial + 2 retries
  })

  it('should apply exponential backoff', async () => {
    const manager = new RetryManager({
      maxRetries: 2,
      backoff: { type: 'exponential', delay: 10, maxDelay: 1000, factor: 2 },
    })

    const delays: number[] = []
    let lastTime = Date.now()

    await expect(
      manager.execute(async () => {
        const now = Date.now()
        delays.push(now - lastTime)
        lastTime = now
        throw new Error('fail')
      })
    ).rejects.toThrow()

    // First call is immediate, then delays should roughly follow 10ms, 20ms pattern
    expect(delays.length).toBe(3)
    expect(delays[1]).toBeGreaterThanOrEqual(8) // ~10ms with some tolerance
    expect(delays[2]).toBeGreaterThanOrEqual(18) // ~20ms with some tolerance
  })

  it('should apply fixed backoff', async () => {
    const manager = new RetryManager({
      maxRetries: 2,
      backoff: { type: 'fixed', delay: 20, maxDelay: 1000, factor: 1 },
    })

    const delays: number[] = []
    let lastTime = Date.now()

    await expect(
      manager.execute(async () => {
        const now = Date.now()
        delays.push(now - lastTime)
        lastTime = now
        throw new Error('fail')
      })
    ).rejects.toThrow()

    // Fixed delays should be consistent
    expect(delays[1]).toBeGreaterThanOrEqual(18)
    expect(delays[2]).toBeGreaterThanOrEqual(18)
  })

  it('should respect maxDelay', async () => {
    const manager = new RetryManager({
      maxRetries: 5,
      backoff: { type: 'exponential', delay: 100, maxDelay: 150, factor: 2 },
    })

    const delays: number[] = []
    let lastTime = Date.now()

    await expect(
      manager.execute(async () => {
        const now = Date.now()
        delays.push(now - lastTime)
        lastTime = now
        throw new Error('fail')
      })
    ).rejects.toThrow()

    // Delays should be capped at maxDelay
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeLessThanOrEqual(180) // maxDelay + tolerance
    }
  })
})

describe('TaskQueue - Cancellation', () => {
  let queue: TaskQueue

  beforeEach(() => {
    queue = new TaskQueue()
  })

  afterEach(async () => {
    await queue.stop()
  })

  it('should cancel a pending task', async () => {
    queue.registerHandler('test', vi.fn())

    const taskId = await queue.enqueue({ type: 'test', payload: {} })
    const cancelled = await queue.cancel(taskId)

    expect(cancelled).toBe(true)
    expect(await queue.getStatus(taskId)).toBe('cancelled')
  })

  it('should not cancel a running task by default', async () => {
    queue.registerHandler(
      'test',
      vi.fn().mockImplementation(
        () => new Promise((r) => setTimeout(r, 1000))
      )
    )

    const taskId = await queue.enqueue({ type: 'test', payload: {} })
    await queue.process()

    // Wait for task to start
    await new Promise((r) => setTimeout(r, 20))

    const cancelled = await queue.cancel(taskId)
    expect(cancelled).toBe(false)
  })

  it('should cancel a running task with force option', async () => {
    queue.registerHandler(
      'test',
      vi.fn().mockImplementation(async (_task, ctx: TaskContext) => {
        while (!ctx.signal.aborted) {
          await new Promise((r) => setTimeout(r, 10))
        }
        throw new Error('Aborted')
      })
    )

    const taskId = await queue.enqueue({ type: 'test', payload: {} })
    await queue.process()

    await new Promise((r) => setTimeout(r, 30))

    const cancelled = await queue.cancel(taskId, { force: true })
    expect(cancelled).toBe(true)

    await new Promise((r) => setTimeout(r, 50))
    expect(await queue.getStatus(taskId)).toBe('cancelled')
  })

  it('should emit task:cancelled event', async () => {
    const listener = vi.fn()
    queue.on('task:cancelled', listener)
    queue.registerHandler('test', vi.fn())

    const taskId = await queue.enqueue({ type: 'test', payload: {} })
    await queue.cancel(taskId)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].id).toBe(taskId)
  })
})

describe('TaskQueue - Pause/Resume', () => {
  let queue: TaskQueue

  beforeEach(() => {
    queue = new TaskQueue()
  })

  afterEach(async () => {
    await queue.stop()
  })

  it('should pause processing', async () => {
    const handler = vi.fn().mockResolvedValue('done')
    queue.registerHandler('test', handler)

    await queue.enqueue({ type: 'test', payload: {} })
    await queue.process()
    queue.pause()

    await queue.enqueue({ type: 'test', payload: {} })

    await new Promise((r) => setTimeout(r, 50))

    // Only first task should be processed
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should resume processing', async () => {
    const handler = vi.fn().mockResolvedValue('done')
    queue.registerHandler('test', handler)

    await queue.process()
    queue.pause()

    await queue.enqueue({ type: 'test', payload: {} })
    await queue.enqueue({ type: 'test', payload: {} })

    await new Promise((r) => setTimeout(r, 50))
    expect(handler).toHaveBeenCalledTimes(0)

    queue.resume()

    await new Promise((r) => setTimeout(r, 50))
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('should emit queue:paused event', async () => {
    const listener = vi.fn()
    queue.on('queue:paused', listener)

    queue.pause()

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should emit queue:resumed event', async () => {
    const listener = vi.fn()
    queue.on('queue:resumed', listener)

    queue.pause()
    queue.resume()

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should report paused state', () => {
    expect(queue.isPaused).toBe(false)
    queue.pause()
    expect(queue.isPaused).toBe(true)
    queue.resume()
    expect(queue.isPaused).toBe(false)
  })
})

describe('ProgressTracker', () => {
  it('should track progress for a task', () => {
    const tracker = new ProgressTracker()

    tracker.update('task1', 0, 100)
    expect(tracker.get('task1')?.percentage).toBe(0)

    tracker.update('task1', 50, 100)
    expect(tracker.get('task1')?.percentage).toBe(50)

    tracker.update('task1', 100, 100)
    expect(tracker.get('task1')?.percentage).toBe(100)
  })

  it('should include message in progress', () => {
    const tracker = new ProgressTracker()

    tracker.update('task1', 5, 10, 'Processing item 5')
    expect(tracker.get('task1')?.message).toBe('Processing item 5')
  })

  it('should emit progress events', () => {
    const tracker = new ProgressTracker()
    const listener = vi.fn()

    tracker.on('progress', listener)
    tracker.update('task1', 25, 100)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].taskId).toBe('task1')
    expect(listener.mock.calls[0][0].percentage).toBe(25)
  })

  it('should clear progress on completion', () => {
    const tracker = new ProgressTracker()

    tracker.update('task1', 50, 100)
    tracker.complete('task1')

    expect(tracker.get('task1')).toBeUndefined()
  })
})

describe('TaskQueue - Progress Tracking', () => {
  let queue: TaskQueue

  beforeEach(() => {
    queue = new TaskQueue()
  })

  afterEach(async () => {
    await queue.stop()
  })

  it('should allow handlers to report progress', async () => {
    const progressUpdates: number[] = []

    queue.on('task:progress', (progress) => {
      progressUpdates.push(progress.percentage)
    })

    queue.registerHandler('test', async (_task, ctx: TaskContext) => {
      ctx.progress(0, 3)
      await new Promise((r) => setTimeout(r, 10))
      ctx.progress(1, 3)
      await new Promise((r) => setTimeout(r, 10))
      ctx.progress(2, 3)
      await new Promise((r) => setTimeout(r, 10))
      ctx.progress(3, 3)
      return 'done'
    })

    await queue.enqueue({ type: 'test', payload: {} })
    await queue.process()

    await new Promise((r) => setTimeout(r, 100))

    expect(progressUpdates).toEqual([0, 33, 67, 100])
  })

  it('should get current progress for a task', async () => {
    let resolveTask: () => void
    const taskPromise = new Promise<void>((r) => {
      resolveTask = r
    })

    queue.registerHandler('test', async (_task, ctx: TaskContext) => {
      ctx.progress(50, 100, 'Halfway there')
      await taskPromise
      return 'done'
    })

    const taskId = await queue.enqueue({ type: 'test', payload: {} })
    await queue.process()

    await new Promise((r) => setTimeout(r, 30))

    const progress = queue.getProgress(taskId)
    expect(progress?.percentage).toBe(50)
    expect(progress?.message).toBe('Halfway there')

    resolveTask!()
  })
})

describe('CronScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should schedule a task at a specific time', async () => {
    const scheduler = new CronScheduler()
    const callback = vi.fn()

    const runAt = new Date(Date.now() + 1000)
    scheduler.scheduleAt(runAt, callback)

    vi.advanceTimersByTime(500)
    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(600)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('should parse and execute cron expressions', async () => {
    const scheduler = new CronScheduler()
    const callback = vi.fn()

    // Every minute
    scheduler.schedule('* * * * *', callback)

    // Advance to next minute
    const now = new Date()
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds()

    vi.advanceTimersByTime(msToNextMinute + 100)
    expect(callback).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60000)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('should cancel a scheduled task', () => {
    const scheduler = new CronScheduler()
    const callback = vi.fn()

    const id = scheduler.scheduleAt(new Date(Date.now() + 1000), callback)
    scheduler.cancel(id)

    vi.advanceTimersByTime(2000)
    expect(callback).not.toHaveBeenCalled()
  })

  it('should stop all scheduled tasks', () => {
    const scheduler = new CronScheduler()
    const callback1 = vi.fn()
    const callback2 = vi.fn()

    scheduler.scheduleAt(new Date(Date.now() + 1000), callback1)
    scheduler.schedule('* * * * *', callback2)

    scheduler.stop()

    vi.advanceTimersByTime(120000)
    expect(callback1).not.toHaveBeenCalled()
    expect(callback2).not.toHaveBeenCalled()
  })
})

describe('TaskQueue - Scheduled Tasks', () => {
  let queue: TaskQueue

  beforeEach(() => {
    queue = new TaskQueue()
  })

  afterEach(async () => {
    await queue.stop()
  })

  it('should schedule a task for later execution', async () => {
    const handler = vi.fn().mockResolvedValue('done')
    queue.registerHandler('test', handler)

    await queue.process()

    // Schedule for 100ms from now (short delay for real timer testing)
    await queue.schedule({
      task: { type: 'test', payload: {}, priority: 0 },
      runAt: new Date(Date.now() + 100),
    })

    // Should not be called immediately
    expect(handler).not.toHaveBeenCalled()

    // Wait for scheduled time + processing
    await new Promise((r) => setTimeout(r, 200))

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should enqueue task via scheduler callback', async () => {
    const handler = vi.fn().mockResolvedValue('done')
    queue.registerHandler('test', handler)

    await queue.process()

    // Schedule for immediate execution
    await queue.schedule({
      task: { type: 'test', payload: { scheduled: true }, priority: 0 },
      runAt: new Date(Date.now() + 50),
    })

    await new Promise((r) => setTimeout(r, 150))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].payload).toEqual({ scheduled: true })
  })
})

describe('DeadLetterQueue', () => {
  it('should store failed tasks', () => {
    const dlq = new DeadLetterQueue()

    const task = { id: 'task1', type: 'test', status: 'failed' } as Task
    dlq.add(task, new Error('Processing failed'))

    expect(dlq.size).toBe(1)
    expect(dlq.get('task1')?.task.id).toBe('task1')
  })

  it('should include error information', () => {
    const dlq = new DeadLetterQueue()

    const task = { id: 'task1', type: 'test', status: 'failed' } as Task
    const error = new Error('Oops!')
    dlq.add(task, error)

    const entry = dlq.get('task1')
    expect(entry?.error.message).toBe('Oops!')
  })

  it('should list all dead letter entries', () => {
    const dlq = new DeadLetterQueue()

    dlq.add({ id: 'task1' } as Task, new Error('err1'))
    dlq.add({ id: 'task2' } as Task, new Error('err2'))

    const entries = dlq.list()
    expect(entries.length).toBe(2)
  })

  it('should remove old entries based on maxAge', () => {
    vi.useFakeTimers()

    const dlq = new DeadLetterQueue({ maxAge: 1000 })

    dlq.add({ id: 'task1' } as Task, new Error('err1'))

    vi.advanceTimersByTime(500)
    dlq.add({ id: 'task2' } as Task, new Error('err2'))

    vi.advanceTimersByTime(600) // task1 is now > 1000ms old
    dlq.cleanup()

    expect(dlq.size).toBe(1)
    expect(dlq.get('task1')).toBeUndefined()
    expect(dlq.get('task2')).toBeDefined()

    vi.useRealTimers()
  })

  it('should call handler for dead letter entries', async () => {
    const handler = vi.fn()
    const dlq = new DeadLetterQueue({ handler })

    const task = { id: 'task1' } as Task
    dlq.add(task, new Error('err'))

    await dlq.process()

    expect(handler).toHaveBeenCalledWith(task)
  })

  it('should retry from dead letter queue', async () => {
    const dlq = new DeadLetterQueue()

    const task = { id: 'task1', type: 'test', attempts: 3 } as Task
    dlq.add(task, new Error('err'))

    const retryTask = dlq.retry('task1')

    expect(retryTask).toBeDefined()
    expect(retryTask?.attempts).toBe(0)
    expect(dlq.size).toBe(0)
  })
})

describe('TaskQueue - Dead Letter Queue', () => {
  let queue: TaskQueue

  beforeEach(() => {
    queue = new TaskQueue({
      retries: 0, // No retries - fail immediately to DLQ
      deadLetter: { maxAge: 60000 },
      backoff: { type: 'fixed', delay: 10, maxDelay: 100, factor: 1 },
    })
  })

  afterEach(async () => {
    await queue.stop()
  })

  it('should move failed tasks to dead letter queue', async () => {
    queue.registerHandler('test', vi.fn().mockRejectedValue(new Error('fail')))

    const taskId = await queue.enqueue({ type: 'test', payload: {} })
    await queue.process()

    // Wait for processing
    await new Promise((r) => setTimeout(r, 100))

    expect(queue.deadLetterQueue.size).toBe(1)
    expect(queue.deadLetterQueue.get(taskId)).toBeDefined()
  })

  it('should emit task:deadletter event', async () => {
    const listener = vi.fn()
    queue.on('task:deadletter', listener)
    queue.registerHandler('test', vi.fn().mockRejectedValue(new Error('fail')))

    await queue.enqueue({ type: 'test', payload: {} })
    await queue.process()

    await new Promise((r) => setTimeout(r, 100))

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should retry tasks from dead letter queue', async () => {
    // Create queue with retries for the DLQ retry test
    const retryQueue = new TaskQueue({
      retries: 1,
      deadLetter: { maxAge: 60000 },
      backoff: { type: 'fixed', delay: 10, maxDelay: 100, factor: 1 },
    })

    let attempts = 0
    retryQueue.registerHandler('test', vi.fn().mockImplementation(() => {
      attempts++
      // First 2 attempts fail (initial + 1 retry = fail to DLQ)
      // Then retry from DLQ: 2 more attempts, succeeds on second
      if (attempts < 4) throw new Error('fail')
      return 'success'
    }))

    const taskId = await retryQueue.enqueue({ type: 'test', payload: {} })
    await retryQueue.process()

    // Wait for initial attempts + retry delay
    await new Promise((r) => setTimeout(r, 150))

    // Task should be in DLQ (failed after 2 attempts)
    expect(retryQueue.deadLetterQueue.size).toBe(1)

    // Retry from DLQ
    await retryQueue.retryFromDeadLetter(taskId)

    // Wait for DLQ retry processing
    await new Promise((r) => setTimeout(r, 150))

    expect(retryQueue.deadLetterQueue.size).toBe(0)
    expect(await retryQueue.getStatus(taskId)).toBe('completed')

    await retryQueue.stop()
  })
})

describe('TaskQueue - Timeouts', () => {
  let queue: TaskQueue

  beforeEach(() => {
    queue = new TaskQueue({ timeout: 100 })
  })

  afterEach(async () => {
    await queue.stop()
  })

  it('should timeout long-running tasks', async () => {
    queue.registerHandler(
      'test',
      vi.fn().mockImplementation(
        () => new Promise((r) => setTimeout(r, 500))
      )
    )

    const taskId = await queue.enqueue({ type: 'test', payload: {} })
    await queue.process()

    await new Promise((r) => setTimeout(r, 200))

    const status = await queue.getStatus(taskId)
    expect(status).toBe('failed')
  })

  it('should abort task via signal on timeout', async () => {
    let wasAborted = false

    queue.registerHandler('test', async (_task, ctx: TaskContext) => {
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 500)
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timeout)
            reject(new Error('Aborted'))
          })
        })
      } catch (e: any) {
        wasAborted = e.message === 'Aborted'
        throw e
      }
    })

    await queue.enqueue({ type: 'test', payload: {} })
    await queue.process()

    await new Promise((r) => setTimeout(r, 200))

    expect(wasAborted).toBe(true)
  })
})

describe('TaskQueue - Priority Ordering', () => {
  let queue: TaskQueue

  beforeEach(() => {
    queue = new TaskQueue({ concurrency: 1 })
  })

  afterEach(async () => {
    await queue.stop()
  })

  it('should process higher priority tasks first', async () => {
    const order: number[] = []

    queue.registerHandler('test', async (task) => {
      order.push(task.priority)
    })

    // Enqueue before processing starts
    await queue.enqueue({ type: 'test', payload: {}, priority: 1 })
    await queue.enqueue({ type: 'test', payload: {}, priority: 10 })
    await queue.enqueue({ type: 'test', payload: {}, priority: 5 })

    await queue.process()
    await new Promise((r) => setTimeout(r, 100))

    expect(order).toEqual([10, 5, 1])
  })

  it('should process same priority in FIFO order', async () => {
    const order: string[] = []

    queue.registerHandler('test', async (task) => {
      order.push(task.payload as string)
    })

    await queue.enqueue({ type: 'test', payload: 'first', priority: 5 })
    await queue.enqueue({ type: 'test', payload: 'second', priority: 5 })
    await queue.enqueue({ type: 'test', payload: 'third', priority: 5 })

    await queue.process()
    await new Promise((r) => setTimeout(r, 100))

    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('should respect priority when adding during processing', async () => {
    const order: number[] = []
    let firstTaskStarted = false

    queue.registerHandler('test', async (task) => {
      if (!firstTaskStarted) {
        firstTaskStarted = true
        await new Promise((r) => setTimeout(r, 50))
      }
      order.push(task.priority)
    })

    // Start with one low priority
    await queue.enqueue({ type: 'test', payload: {}, priority: 1 })
    await queue.process()

    // Add high priority while first is processing
    await new Promise((r) => setTimeout(r, 10))
    await queue.enqueue({ type: 'test', payload: {}, priority: 10 })
    await queue.enqueue({ type: 'test', payload: {}, priority: 5 })

    await new Promise((r) => setTimeout(r, 150))

    // First task completes first (was already running)
    // Then high priority, then low priority
    expect(order).toEqual([1, 10, 5])
  })
})

describe('TaskQueue - Concurrent Processing', () => {
  it('should process multiple tasks concurrently', async () => {
    const queue = new TaskQueue({ concurrency: 3 })
    let maxConcurrent = 0
    let concurrent = 0

    queue.registerHandler('test', async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 50))
      concurrent--
    })

    await queue.enqueue({ type: 'test', payload: {} })
    await queue.enqueue({ type: 'test', payload: {} })
    await queue.enqueue({ type: 'test', payload: {} })
    await queue.enqueue({ type: 'test', payload: {} })
    await queue.enqueue({ type: 'test', payload: {} })

    await queue.process()
    await new Promise((r) => setTimeout(r, 200))

    expect(maxConcurrent).toBe(3)

    await queue.stop()
  })

  it('should not exceed concurrency limit', async () => {
    const queue = new TaskQueue({ concurrency: 2 })
    let maxConcurrent = 0
    let concurrent = 0

    queue.registerHandler('test', async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 30))
      concurrent--
    })

    for (let i = 0; i < 10; i++) {
      await queue.enqueue({ type: 'test', payload: {} })
    }

    await queue.process()
    await new Promise((r) => setTimeout(r, 300))

    expect(maxConcurrent).toBeLessThanOrEqual(2)

    await queue.stop()
  })
})

describe('TaskQueue - Retry Events', () => {
  let queue: TaskQueue

  beforeEach(() => {
    queue = new TaskQueue({
      retries: 2,
      backoff: { type: 'fixed', delay: 10, maxDelay: 100, factor: 1 },
    })
  })

  afterEach(async () => {
    await queue.stop()
  })

  it('should emit task:retry events', async () => {
    const retryEvents: any[] = []
    queue.on('task:retry', (event) => retryEvents.push(event))

    let attempts = 0
    queue.registerHandler('test', vi.fn().mockImplementation(() => {
      attempts++
      if (attempts < 3) throw new Error('fail')
      return 'success'
    }))

    await queue.enqueue({ type: 'test', payload: {} })
    await queue.process()

    await new Promise((r) => setTimeout(r, 100))

    expect(retryEvents.length).toBe(2)
    expect(retryEvents[0].attempt).toBe(1)
    expect(retryEvents[1].attempt).toBe(2)
  })

  it('should emit task:failed after all retries exhausted', async () => {
    const failedEvents: any[] = []
    queue.on('task:failed', (event) => failedEvents.push(event))

    queue.registerHandler('test', vi.fn().mockRejectedValue(new Error('always fail')))

    await queue.enqueue({ type: 'test', payload: {} })
    await queue.process()

    await new Promise((r) => setTimeout(r, 100))

    expect(failedEvents.length).toBe(1)
    expect(failedEvents[0].error.message).toBe('always fail')
  })
})

describe('TaskQueue - Queue Empty Event', () => {
  let queue: TaskQueue

  beforeEach(() => {
    queue = new TaskQueue()
  })

  afterEach(async () => {
    await queue.stop()
  })

  it('should emit queue:empty when all tasks complete', async () => {
    const listener = vi.fn()
    queue.on('queue:empty', listener)

    queue.registerHandler('test', vi.fn().mockResolvedValue('done'))

    await queue.enqueue({ type: 'test', payload: {} })
    await queue.enqueue({ type: 'test', payload: {} })

    await queue.process()
    await new Promise((r) => setTimeout(r, 100))

    expect(listener).toHaveBeenCalledTimes(1)
  })
})
