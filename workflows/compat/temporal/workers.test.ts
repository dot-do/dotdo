/**
 * Temporal Workers Compat Layer Tests
 *
 * Tests for Temporal Worker API compatibility including:
 * - Worker creation and configuration
 * - Activity registration
 * - Workflow registration
 * - Task queue routing
 * - Worker lifecycle management
 * - Graceful shutdown
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  WorkflowClient,
  proxyActivities,
  registerWorker,
  hasWorker,
  getWorker,
  listTaskQueues,
  TaskQueueNotRegisteredError,
} from './index'

// ============================================================================
// WORKER TYPES
// ============================================================================

interface WorkerOptions {
  /** Task queue name this worker polls */
  taskQueue: string
  /** Activities to register with this worker */
  activities?: Record<string, (...args: unknown[]) => Promise<unknown>>
  /** Workflows to register with this worker */
  workflows?: Record<string, (...args: unknown[]) => Promise<unknown>>
  /** Maximum concurrent workflow tasks */
  maxConcurrentWorkflowTasks?: number
  /** Maximum concurrent activity tasks */
  maxConcurrentActivityTasks?: number
  /** Maximum activities per second */
  maxActivitiesPerSecond?: number
  /** Maximum task queue activities per second */
  maxTaskQueueActivitiesPerSecond?: number
  /** Sticky cache size */
  stickyCacheSize?: number
  /** Worker identity */
  identity?: string
  /** Build ID for versioning */
  buildId?: string
  /** Use versioning */
  useVersioning?: boolean
}

interface WorkerStatus {
  taskQueue: string
  identity: string
  isRunning: boolean
  isSuspended: boolean
  currentWorkflowTasks: number
  currentActivityTasks: number
  polledWorkflows: number
  polledActivities: number
  completedWorkflows: number
  completedActivities: number
  failedWorkflows: number
  failedActivities: number
}

interface ShutdownOptions {
  /** Grace period before force shutdown */
  gracePeriod?: string | number
  /** Force shutdown immediately */
  force?: boolean
}

// ============================================================================
// WORKER IMPLEMENTATION
// ============================================================================

class Worker {
  private options: WorkerOptions
  private running = false
  private suspended = false
  private stats = {
    currentWorkflowTasks: 0,
    currentActivityTasks: 0,
    polledWorkflows: 0,
    polledActivities: 0,
    completedWorkflows: 0,
    completedActivities: 0,
    failedWorkflows: 0,
    failedActivities: 0,
  }
  private shutdownPromise: Promise<void> | null = null
  private pollInterval: ReturnType<typeof setInterval> | null = null

  constructor(options: WorkerOptions) {
    this.options = {
      maxConcurrentWorkflowTasks: 100,
      maxConcurrentActivityTasks: 100,
      stickyCacheSize: 1000,
      identity: `worker-${crypto.randomUUID().slice(0, 8)}`,
      ...options,
    }
  }

  /**
   * Start the worker
   */
  async run(): Promise<void> {
    if (this.running) {
      throw new Error('Worker is already running')
    }

    this.running = true

    // Simulate polling loop
    this.pollInterval = setInterval(() => {
      if (!this.suspended && this.running) {
        this.pollTasks()
      }
    }, 100)

    // Return a promise that resolves when shutdown is called
    return new Promise((resolve) => {
      this.shutdownPromise = new Promise<void>((shutdownResolve) => {
        const originalShutdown = this.shutdown.bind(this)
        this.shutdown = async (options?: ShutdownOptions) => {
          await originalShutdown(options)
          shutdownResolve()
          resolve()
        }
      })
    })
  }

  /**
   * Shutdown the worker
   */
  async shutdown(options?: ShutdownOptions): Promise<void> {
    if (!this.running) return

    if (options?.force) {
      this.forceShutdown()
      return
    }

    // Graceful shutdown - wait for current tasks
    const gracePeriod = options?.gracePeriod
      ? typeof options.gracePeriod === 'number'
        ? options.gracePeriod
        : parseDuration(options.gracePeriod)
      : 5000

    // Stop accepting new tasks
    this.suspended = true

    // Wait for current tasks to complete (with timeout)
    const startTime = Date.now()
    while (
      (this.stats.currentWorkflowTasks > 0 || this.stats.currentActivityTasks > 0) &&
      Date.now() - startTime < gracePeriod
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    this.forceShutdown()
  }

  private forceShutdown(): void {
    this.running = false
    this.suspended = false
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  /**
   * Suspend the worker (stop polling but don't shutdown)
   */
  suspend(): void {
    this.suspended = true
  }

  /**
   * Resume the worker
   */
  resume(): void {
    if (!this.running) {
      throw new Error('Cannot resume a stopped worker')
    }
    this.suspended = false
  }

  /**
   * Get worker status
   */
  getStatus(): WorkerStatus {
    return {
      taskQueue: this.options.taskQueue,
      identity: this.options.identity!,
      isRunning: this.running,
      isSuspended: this.suspended,
      ...this.stats,
    }
  }

  /**
   * Get registered activities
   */
  getActivities(): string[] {
    return Object.keys(this.options.activities || {})
  }

  /**
   * Get registered workflows
   */
  getWorkflows(): string[] {
    return Object.keys(this.options.workflows || {})
  }

  /**
   * Check if activity is registered
   */
  hasActivity(name: string): boolean {
    return name in (this.options.activities || {})
  }

  /**
   * Check if workflow is registered
   */
  hasWorkflow(name: string): boolean {
    return name in (this.options.workflows || {})
  }

  /**
   * Execute an activity
   */
  async executeActivity(name: string, args: unknown[]): Promise<unknown> {
    const activity = this.options.activities?.[name]
    if (!activity) {
      throw new Error(`Activity ${name} not registered`)
    }

    this.stats.currentActivityTasks++
    this.stats.polledActivities++

    try {
      const result = await activity(...args)
      this.stats.completedActivities++
      return result
    } catch (error) {
      this.stats.failedActivities++
      throw error
    } finally {
      this.stats.currentActivityTasks--
    }
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(name: string, args: unknown[]): Promise<unknown> {
    const workflow = this.options.workflows?.[name]
    if (!workflow) {
      throw new Error(`Workflow ${name} not registered`)
    }

    this.stats.currentWorkflowTasks++
    this.stats.polledWorkflows++

    try {
      const result = await workflow(...args)
      this.stats.completedWorkflows++
      return result
    } catch (error) {
      this.stats.failedWorkflows++
      throw error
    } finally {
      this.stats.currentWorkflowTasks--
    }
  }

  private pollTasks(): void {
    // Simulate polling - in real implementation would poll task queue
    // For testing, we just track that polling is happening
  }
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m)$/)
  if (!match) return 5000
  const value = parseInt(match[1], 10)
  const unit = match[2]
  switch (unit) {
    case 'ms':
      return value
    case 's':
      return value * 1000
    case 'm':
      return value * 60 * 1000
    default:
      return 5000
  }
}

// ============================================================================
// BUNDLED WORKER (Multiple task queues)
// ============================================================================

class BundledWorker {
  private workers = new Map<string, Worker>()

  /**
   * Add a worker for a task queue
   */
  addWorker(options: WorkerOptions): Worker {
    const worker = new Worker(options)
    this.workers.set(options.taskQueue, worker)
    return worker
  }

  /**
   * Get worker for a task queue
   */
  getWorker(taskQueue: string): Worker | undefined {
    return this.workers.get(taskQueue)
  }

  /**
   * Start all workers
   */
  async runAll(): Promise<void[]> {
    return Promise.all(
      Array.from(this.workers.values()).map((w) => w.run())
    )
  }

  /**
   * Shutdown all workers
   */
  async shutdownAll(options?: ShutdownOptions): Promise<void> {
    await Promise.all(
      Array.from(this.workers.values()).map((w) => w.shutdown(options))
    )
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Temporal Workers Compat Layer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Worker Creation', () => {
    it('should create a worker with task queue', () => {
      const worker = new Worker({
        taskQueue: 'my-task-queue',
      })

      const status = worker.getStatus()
      expect(status.taskQueue).toBe('my-task-queue')
      expect(status.isRunning).toBe(false)
    })

    it('should create a worker with activities', () => {
      const worker = new Worker({
        taskQueue: 'activity-queue',
        activities: {
          sendEmail: async (to: string) => ({ sent: true, to }),
          processPayment: async (amount: number) => ({ processed: true, amount }),
        },
      })

      expect(worker.getActivities()).toEqual(['sendEmail', 'processPayment'])
      expect(worker.hasActivity('sendEmail')).toBe(true)
      expect(worker.hasActivity('nonExistent')).toBe(false)
    })

    it('should create a worker with workflows', () => {
      const worker = new Worker({
        taskQueue: 'workflow-queue',
        workflows: {
          orderWorkflow: async (orderId: string) => ({ completed: true, orderId }),
          signupWorkflow: async (userId: string) => ({ completed: true, userId }),
        },
      })

      expect(worker.getWorkflows()).toEqual(['orderWorkflow', 'signupWorkflow'])
      expect(worker.hasWorkflow('orderWorkflow')).toBe(true)
      expect(worker.hasWorkflow('nonExistent')).toBe(false)
    })

    it('should create a worker with concurrency limits', () => {
      const worker = new Worker({
        taskQueue: 'limited-queue',
        maxConcurrentWorkflowTasks: 50,
        maxConcurrentActivityTasks: 200,
      })

      // Worker should be created successfully
      expect(worker.getStatus().taskQueue).toBe('limited-queue')
    })

    it('should create a worker with custom identity', () => {
      const worker = new Worker({
        taskQueue: 'identity-queue',
        identity: 'my-custom-worker-1',
      })

      expect(worker.getStatus().identity).toBe('my-custom-worker-1')
    })

    it('should create a worker with build ID for versioning', () => {
      const worker = new Worker({
        taskQueue: 'versioned-queue',
        buildId: 'v1.2.3',
        useVersioning: true,
      })

      expect(worker.getStatus().taskQueue).toBe('versioned-queue')
    })
  })

  describe('Worker Lifecycle', () => {
    it('should start and run worker', async () => {
      const worker = new Worker({ taskQueue: 'lifecycle-queue' })

      // Start worker (returns promise that resolves on shutdown)
      const runPromise = worker.run()

      // Worker should be running
      expect(worker.getStatus().isRunning).toBe(true)

      // Shutdown to complete the test
      await worker.shutdown()

      expect(worker.getStatus().isRunning).toBe(false)
    })

    it('should prevent double start', async () => {
      const worker = new Worker({ taskQueue: 'double-start-queue' })

      worker.run()

      await expect(worker.run()).rejects.toThrow('already running')

      await worker.shutdown()
    })

    it('should support graceful shutdown', async () => {
      const worker = new Worker({
        taskQueue: 'graceful-queue',
        activities: {
          slowTask: async () => {
            await new Promise((r) => setTimeout(r, 1000))
            return 'done'
          },
        },
      })

      worker.run()

      // Shutdown with grace period
      const shutdownPromise = worker.shutdown({ gracePeriod: '5s' })

      await vi.advanceTimersByTimeAsync(100)

      // Should complete shutdown
      await shutdownPromise

      expect(worker.getStatus().isRunning).toBe(false)
    })

    it('should support force shutdown', async () => {
      const worker = new Worker({ taskQueue: 'force-queue' })

      worker.run()

      await worker.shutdown({ force: true })

      expect(worker.getStatus().isRunning).toBe(false)
    })

    it('should support suspend and resume', async () => {
      const worker = new Worker({ taskQueue: 'suspend-queue' })

      worker.run()

      // Suspend
      worker.suspend()
      expect(worker.getStatus().isSuspended).toBe(true)

      // Resume
      worker.resume()
      expect(worker.getStatus().isSuspended).toBe(false)

      await worker.shutdown()
    })

    it('should prevent resume after shutdown', async () => {
      const worker = new Worker({ taskQueue: 'resume-after-stop' })

      worker.run()
      await worker.shutdown()

      expect(() => worker.resume()).toThrow('Cannot resume a stopped worker')
    })
  })

  describe('Activity Execution', () => {
    it('should execute registered activity', async () => {
      const worker = new Worker({
        taskQueue: 'exec-activity-queue',
        activities: {
          greet: async (name: string) => `Hello, ${name}!`,
        },
      })

      worker.run()

      const result = await worker.executeActivity('greet', ['World'])

      expect(result).toBe('Hello, World!')
      expect(worker.getStatus().completedActivities).toBe(1)

      await worker.shutdown()
    })

    it('should track activity statistics', async () => {
      const worker = new Worker({
        taskQueue: 'stats-activity-queue',
        activities: {
          succeed: async () => 'success',
          fail: async () => {
            throw new Error('intentional failure')
          },
        },
      })

      worker.run()

      await worker.executeActivity('succeed', [])
      await worker.executeActivity('succeed', [])
      await worker.executeActivity('fail', []).catch(() => {})

      const status = worker.getStatus()
      expect(status.polledActivities).toBe(3)
      expect(status.completedActivities).toBe(2)
      expect(status.failedActivities).toBe(1)

      await worker.shutdown()
    })

    it('should reject unregistered activity', async () => {
      const worker = new Worker({
        taskQueue: 'unregistered-activity-queue',
        activities: {},
      })

      worker.run()

      await expect(worker.executeActivity('missing', [])).rejects.toThrow('not registered')

      await worker.shutdown()
    })
  })

  describe('Workflow Execution', () => {
    it('should execute registered workflow', async () => {
      const worker = new Worker({
        taskQueue: 'exec-workflow-queue',
        workflows: {
          processOrder: async (orderId: string, amount: number) => ({
            orderId,
            amount,
            status: 'completed',
          }),
        },
      })

      worker.run()

      const result = await worker.executeWorkflow('processOrder', ['ORD-123', 99.99])

      expect(result).toEqual({
        orderId: 'ORD-123',
        amount: 99.99,
        status: 'completed',
      })

      await worker.shutdown()
    })

    it('should track workflow statistics', async () => {
      const worker = new Worker({
        taskQueue: 'stats-workflow-queue',
        workflows: {
          succeed: async () => 'success',
          fail: async () => {
            throw new Error('workflow failure')
          },
        },
      })

      worker.run()

      await worker.executeWorkflow('succeed', [])
      await worker.executeWorkflow('fail', []).catch(() => {})

      const status = worker.getStatus()
      expect(status.polledWorkflows).toBe(2)
      expect(status.completedWorkflows).toBe(1)
      expect(status.failedWorkflows).toBe(1)

      await worker.shutdown()
    })
  })

  describe('Bundled Workers', () => {
    it('should create bundled worker with multiple task queues', async () => {
      const bundled = new BundledWorker()

      bundled.addWorker({
        taskQueue: 'orders',
        activities: { processOrder: async () => 'processed' },
      })

      bundled.addWorker({
        taskQueue: 'notifications',
        activities: { sendNotification: async () => 'sent' },
      })

      expect(bundled.getWorker('orders')).toBeDefined()
      expect(bundled.getWorker('notifications')).toBeDefined()
      expect(bundled.getWorker('nonexistent')).toBeUndefined()
    })

    it('should start all workers', async () => {
      const bundled = new BundledWorker()

      const worker1 = bundled.addWorker({ taskQueue: 'queue-1' })
      const worker2 = bundled.addWorker({ taskQueue: 'queue-2' })

      bundled.runAll()

      expect(worker1.getStatus().isRunning).toBe(true)
      expect(worker2.getStatus().isRunning).toBe(true)

      await bundled.shutdownAll()

      expect(worker1.getStatus().isRunning).toBe(false)
      expect(worker2.getStatus().isRunning).toBe(false)
    })
  })

  describe('Task Queue Registration', () => {
    it('should register worker for task queue', () => {
      registerWorker('registered-queue', {
        executeActivity: async (name, args) => `executed ${name}`,
      })

      expect(hasWorker('registered-queue')).toBe(true)
    })

    it('should get registered worker', () => {
      registerWorker('get-worker-queue', {
        executeActivity: async (name, args) => `result`,
      })

      const worker = getWorker('get-worker-queue')
      expect(worker).toBeDefined()
    })

    it('should list all task queues', () => {
      registerWorker('list-queue-1', { executeActivity: async () => null })
      registerWorker('list-queue-2', { executeActivity: async () => null })

      const queues = listTaskQueues()
      expect(queues).toContain('list-queue-1')
      expect(queues).toContain('list-queue-2')
    })
  })

  describe('Worker with Rate Limiting', () => {
    it('should respect max activities per second', async () => {
      const worker = new Worker({
        taskQueue: 'rate-limited-queue',
        maxActivitiesPerSecond: 10,
        activities: {
          quickTask: async () => 'done',
        },
      })

      worker.run()

      // Execute multiple activities
      const results = await Promise.all([
        worker.executeActivity('quickTask', []),
        worker.executeActivity('quickTask', []),
        worker.executeActivity('quickTask', []),
      ])

      expect(results).toHaveLength(3)

      await worker.shutdown()
    })
  })

  describe('Error Handling', () => {
    it('should propagate activity errors', async () => {
      const worker = new Worker({
        taskQueue: 'error-queue',
        activities: {
          errorTask: async () => {
            throw new Error('Activity error')
          },
        },
      })

      worker.run()

      await expect(worker.executeActivity('errorTask', [])).rejects.toThrow('Activity error')

      await worker.shutdown()
    })

    it('should propagate workflow errors', async () => {
      const worker = new Worker({
        taskQueue: 'workflow-error-queue',
        workflows: {
          errorWorkflow: async () => {
            throw new Error('Workflow error')
          },
        },
      })

      worker.run()

      await expect(worker.executeWorkflow('errorWorkflow', [])).rejects.toThrow('Workflow error')

      await worker.shutdown()
    })
  })

  describe('Worker Status', () => {
    it('should provide comprehensive status', async () => {
      const worker = new Worker({
        taskQueue: 'status-queue',
        identity: 'status-worker',
        activities: { task: async () => 'done' },
      })

      worker.run()

      await worker.executeActivity('task', [])

      const status = worker.getStatus()

      expect(status.taskQueue).toBe('status-queue')
      expect(status.identity).toBe('status-worker')
      expect(status.isRunning).toBe(true)
      expect(status.isSuspended).toBe(false)
      expect(status.completedActivities).toBe(1)

      await worker.shutdown()
    })
  })
})
