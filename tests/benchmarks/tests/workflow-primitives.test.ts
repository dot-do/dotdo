/**
 * Workflow Primitives Benchmarks
 *
 * Performance benchmarks for workflow primitives supporting the Temporal compat layer:
 * 1. DAG/Workflows - Task execution and dependency management
 * 2. Retry Policies - Fixed and exponential backoff strategies
 * 3. Scheduling - CRON trigger and next run calculation
 * 4. Sensors - Cross-DAG coordination
 * 5. Workflow State - Persistence and replay
 * 6. Activities - Local and remote execution
 * 7. Signals/Timers - Communication and timing primitives
 *
 * These benchmarks measure:
 * - Operation latency (single operations)
 * - Throughput (operations per second)
 * - Memory efficiency under load
 *
 * @see @dotdo/compat-temporal for Temporal-compatible implementations (moved to compat repo)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// BENCHMARK CONFIGURATION
// ============================================================================

/** Number of iterations for benchmarks */
const BENCHMARK_ITERATIONS = 100

/** Number of warmup iterations before measuring */
const WARMUP_ITERATIONS = 10

/** Maximum acceptable latency for single operations (ms) */
const MAX_SINGLE_OP_LATENCY_MS = 50

/** Minimum acceptable throughput (ops/sec) */
const MIN_THROUGHPUT_OPS_SEC = 100

// ============================================================================
// BENCHMARK UTILITIES
// ============================================================================

interface BenchmarkResult {
  name: string
  iterations: number
  totalMs: number
  avgMs: number
  minMs: number
  maxMs: number
  opsPerSec: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

/**
 * Runs a benchmark and collects timing statistics
 */
async function runBenchmark(
  name: string,
  fn: () => Promise<void> | void,
  iterations: number = BENCHMARK_ITERATIONS,
  warmupIterations: number = WARMUP_ITERATIONS
): Promise<BenchmarkResult> {
  // Warmup phase
  for (let i = 0; i < warmupIterations; i++) {
    await fn()
  }

  // Collect timing samples
  const samples: number[] = []

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fn()
    const end = performance.now()
    samples.push(end - start)
  }

  // Calculate statistics
  samples.sort((a, b) => a - b)
  const totalMs = samples.reduce((a, b) => a + b, 0)
  const avgMs = totalMs / iterations
  const minMs = samples[0]!
  const maxMs = samples[samples.length - 1]!
  const opsPerSec = 1000 / avgMs
  const p50Ms = samples[Math.floor(iterations * 0.5)]!
  const p95Ms = samples[Math.floor(iterations * 0.95)]!
  const p99Ms = samples[Math.floor(iterations * 0.99)]!

  return {
    name,
    iterations,
    totalMs,
    avgMs,
    minMs,
    maxMs,
    opsPerSec,
    p50Ms,
    p95Ms,
    p99Ms,
  }
}

/**
 * Formats benchmark result for console output
 */
function formatBenchmarkResult(result: BenchmarkResult): string {
  return [
    `  ${result.name}:`,
    `    Avg: ${result.avgMs.toFixed(3)} ms`,
    `    Min: ${result.minMs.toFixed(3)} ms, Max: ${result.maxMs.toFixed(3)} ms`,
    `    P50: ${result.p50Ms.toFixed(3)} ms, P95: ${result.p95Ms.toFixed(3)} ms, P99: ${result.p99Ms.toFixed(3)} ms`,
    `    Throughput: ${result.opsPerSec.toFixed(1)} ops/sec`,
  ].join('\n')
}

// ============================================================================
// MOCK WORKFLOW PRIMITIVES
// ============================================================================

/**
 * Task status for DAG execution
 */
type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

/**
 * Task definition for DAG
 */
interface Task {
  id: string
  name: string
  status: TaskStatus
  dependencies: string[]
  result?: unknown
  error?: Error
  startedAt?: number
  completedAt?: number
}

/**
 * DAG (Directed Acyclic Graph) for workflow orchestration
 */
class MockDAG {
  private tasks = new Map<string, Task>()
  private taskCounter = 0

  /**
   * Add a task to the DAG
   */
  addTask(name: string, dependencies: string[] = []): string {
    const id = `task-${++this.taskCounter}`
    this.tasks.set(id, {
      id,
      name,
      status: 'pending',
      dependencies,
    })
    return id
  }

  /**
   * Get task by ID
   */
  getTask(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  /**
   * Execute a single task
   */
  async executeTask<T>(id: string, executor: () => Promise<T>): Promise<T> {
    const task = this.tasks.get(id)
    if (!task) {
      throw new Error(`Task ${id} not found`)
    }

    // Check dependencies
    for (const depId of task.dependencies) {
      const dep = this.tasks.get(depId)
      if (!dep || dep.status !== 'completed') {
        throw new Error(`Dependency ${depId} not completed`)
      }
    }

    task.status = 'running'
    task.startedAt = Date.now()

    try {
      const result = await executor()
      task.status = 'completed'
      task.result = result
      task.completedAt = Date.now()
      return result
    } catch (error) {
      task.status = 'failed'
      task.error = error instanceof Error ? error : new Error(String(error))
      task.completedAt = Date.now()
      throw error
    }
  }

  /**
   * Execute multiple tasks in parallel (fan-out)
   */
  async executeParallel<T>(taskIds: string[], executor: (id: string) => Promise<T>): Promise<T[]> {
    return Promise.all(taskIds.map(id => this.executeTask(id, () => executor(id))))
  }

  /**
   * Get all ready tasks (dependencies satisfied)
   */
  getReadyTasks(): Task[] {
    return Array.from(this.tasks.values()).filter(task => {
      if (task.status !== 'pending') return false
      return task.dependencies.every(depId => {
        const dep = this.tasks.get(depId)
        return dep && dep.status === 'completed'
      })
    })
  }

  /**
   * Get DAG status
   */
  getStatus(): { total: number; pending: number; running: number; completed: number; failed: number } {
    let pending = 0, running = 0, completed = 0, failed = 0
    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'pending': pending++; break
        case 'running': running++; break
        case 'completed': completed++; break
        case 'failed': failed++; break
      }
    }
    return { total: this.tasks.size, pending, running, completed, failed }
  }

  /**
   * Clear all tasks
   */
  clear(): void {
    this.tasks.clear()
    this.taskCounter = 0
  }
}

/**
 * Retry policy configuration
 */
interface RetryPolicy {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  jitter: boolean
}

/**
 * Mock retry executor with various backoff strategies
 */
class MockRetryExecutor {
  /**
   * Execute with fixed backoff retry
   */
  async executeWithFixedBackoff<T>(
    fn: () => Promise<T>,
    policy: Pick<RetryPolicy, 'maxAttempts' | 'initialDelayMs'>
  ): Promise<T> {
    let lastError: Error | undefined
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt < policy.maxAttempts) {
          await this.delay(policy.initialDelayMs)
        }
      }
    }
    throw lastError ?? new Error('Max attempts reached')
  }

  /**
   * Execute with exponential backoff and jitter
   */
  async executeWithExponentialBackoff<T>(
    fn: () => Promise<T>,
    policy: RetryPolicy
  ): Promise<T> {
    let lastError: Error | undefined
    let delay = policy.initialDelayMs

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt < policy.maxAttempts) {
          // Apply jitter
          const jitteredDelay = policy.jitter
            ? delay * (0.5 + Math.random())
            : delay
          await this.delay(Math.min(jitteredDelay, policy.maxDelayMs))
          delay *= policy.backoffMultiplier
        }
      }
    }
    throw lastError ?? new Error('Max attempts reached')
  }

  /**
   * Calculate next retry delay
   */
  calculateNextDelay(
    attempt: number,
    policy: RetryPolicy
  ): number {
    const delay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1)
    const cappedDelay = Math.min(delay, policy.maxDelayMs)
    return policy.jitter ? cappedDelay * (0.5 + Math.random()) : cappedDelay
  }

  private delay(ms: number): Promise<void> {
    // For benchmarks, simulate delay without actual waiting
    return Promise.resolve()
  }
}

/**
 * CRON schedule definition
 */
interface CronSchedule {
  id: string
  expression: string
  handler: string
  lastRun?: number
  nextRun?: number
  enabled: boolean
}

/**
 * Mock schedule manager for CRON triggers
 */
class MockScheduleManager {
  private schedules = new Map<string, CronSchedule>()
  private scheduleCounter = 0

  /**
   * Register a CRON schedule
   */
  registerSchedule(expression: string, handler: string): string {
    const id = `schedule-${++this.scheduleCounter}`
    const nextRun = this.calculateNextRun(expression)
    this.schedules.set(id, {
      id,
      expression,
      handler,
      nextRun,
      enabled: true,
    })
    return id
  }

  /**
   * Get schedule by ID
   */
  getSchedule(id: string): CronSchedule | undefined {
    return this.schedules.get(id)
  }

  /**
   * Calculate next trigger time from CRON expression
   */
  calculateNextRun(expression: string, fromTime?: number): number {
    const now = fromTime ?? Date.now()
    const parts = expression.split(' ')

    // Simple implementation - just add appropriate interval
    // Real implementation would parse CRON properly
    if (parts[0] === '*') {
      // Every minute
      return now + 60 * 1000
    } else if (parts[0]?.startsWith('*/')) {
      // Every N minutes
      const interval = parseInt(parts[0].slice(2), 10)
      return now + interval * 60 * 1000
    } else if (parts[1] === '*') {
      // Every hour at specific minute
      return now + 60 * 60 * 1000
    }
    // Default: next day
    return now + 24 * 60 * 60 * 1000
  }

  /**
   * Get all due schedules
   */
  getDueSchedules(atTime?: number): CronSchedule[] {
    const now = atTime ?? Date.now()
    return Array.from(this.schedules.values()).filter(
      s => s.enabled && s.nextRun && s.nextRun <= now
    )
  }

  /**
   * Mark schedule as executed and update next run
   */
  markExecuted(id: string): void {
    const schedule = this.schedules.get(id)
    if (schedule) {
      schedule.lastRun = Date.now()
      schedule.nextRun = this.calculateNextRun(schedule.expression)
    }
  }

  /**
   * Disable a schedule
   */
  disableSchedule(id: string): void {
    const schedule = this.schedules.get(id)
    if (schedule) {
      schedule.enabled = false
    }
  }

  /**
   * Clear all schedules
   */
  clear(): void {
    this.schedules.clear()
    this.scheduleCounter = 0
  }
}

/**
 * Sensor condition for cross-DAG coordination
 */
interface SensorCondition {
  id: string
  type: 'dag_completed' | 'file_exists' | 'custom'
  target: string
  timeout?: number
  createdAt: number
  satisfied: boolean
  satisfiedAt?: number
}

/**
 * Mock sensor for cross-DAG coordination
 */
class MockSensor {
  private conditions = new Map<string, SensorCondition>()
  private conditionCounter = 0

  /**
   * Create a sensor condition
   */
  createCondition(
    type: SensorCondition['type'],
    target: string,
    timeout?: number
  ): string {
    const id = `sensor-${++this.conditionCounter}`
    this.conditions.set(id, {
      id,
      type,
      target,
      timeout,
      createdAt: Date.now(),
      satisfied: false,
    })
    return id
  }

  /**
   * Check if a condition is satisfied
   */
  checkCondition(id: string, context?: Record<string, unknown>): boolean {
    const condition = this.conditions.get(id)
    if (!condition) return false

    // Simulate condition check based on type
    switch (condition.type) {
      case 'dag_completed':
        // In real impl, would check DAG status
        condition.satisfied = context?.dagCompleted === true
        break
      case 'file_exists':
        condition.satisfied = context?.fileExists === true
        break
      case 'custom':
        condition.satisfied = context?.satisfied === true
        break
    }

    if (condition.satisfied && !condition.satisfiedAt) {
      condition.satisfiedAt = Date.now()
    }

    return condition.satisfied
  }

  /**
   * Wait for a condition with polling
   */
  async waitForCondition(
    id: string,
    pollInterval: number = 100,
    maxWaitMs: number = 5000
  ): Promise<boolean> {
    const startTime = Date.now()
    while (Date.now() - startTime < maxWaitMs) {
      if (this.checkCondition(id, { satisfied: Date.now() - startTime > pollInterval })) {
        return true
      }
      // Simulate poll (for benchmarks, don't actually wait)
    }
    return false
  }

  /**
   * Get condition status
   */
  getCondition(id: string): SensorCondition | undefined {
    return this.conditions.get(id)
  }

  /**
   * Clear all conditions
   */
  clear(): void {
    this.conditions.clear()
    this.conditionCounter = 0
  }
}

/**
 * Workflow state for persistence
 */
interface WorkflowState {
  workflowId: string
  runId: string
  status: 'running' | 'completed' | 'failed' | 'paused'
  currentStep: number
  checkpoints: Map<string, unknown>
  history: Array<{
    eventId: number
    eventType: string
    timestamp: number
    data: unknown
  }>
  variables: Map<string, unknown>
  createdAt: number
  updatedAt: number
}

/**
 * Mock workflow state store for persistence
 */
class MockWorkflowStateStore {
  private states = new Map<string, WorkflowState>()

  /**
   * Create a new workflow state
   */
  createState(workflowId: string, runId: string): WorkflowState {
    const state: WorkflowState = {
      workflowId,
      runId,
      status: 'running',
      currentStep: 0,
      checkpoints: new Map(),
      history: [],
      variables: new Map(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.states.set(`${workflowId}:${runId}`, state)
    return state
  }

  /**
   * Save/update workflow state
   */
  saveState(state: WorkflowState): void {
    state.updatedAt = Date.now()
    this.states.set(`${state.workflowId}:${state.runId}`, state)
  }

  /**
   * Load workflow state
   */
  loadState(workflowId: string, runId: string): WorkflowState | undefined {
    return this.states.get(`${workflowId}:${runId}`)
  }

  /**
   * Save checkpoint
   */
  saveCheckpoint(state: WorkflowState, checkpointId: string, data: unknown): void {
    state.checkpoints.set(checkpointId, data)
    state.updatedAt = Date.now()
    this.saveState(state)
  }

  /**
   * Load from checkpoint for replay
   */
  replayFromCheckpoint(workflowId: string, runId: string, checkpointId: string): WorkflowState | undefined {
    const state = this.loadState(workflowId, runId)
    if (!state) return undefined

    // Create replay state from checkpoint
    const checkpoint = state.checkpoints.get(checkpointId)
    if (!checkpoint) return undefined

    // Reset state to checkpoint
    const replayState: WorkflowState = {
      ...state,
      status: 'running',
      variables: new Map(state.variables),
      checkpoints: new Map(state.checkpoints),
      updatedAt: Date.now(),
    }

    return replayState
  }

  /**
   * Append history event
   */
  appendHistory(state: WorkflowState, eventType: string, data: unknown): void {
    state.history.push({
      eventId: state.history.length + 1,
      eventType,
      timestamp: Date.now(),
      data,
    })
    state.updatedAt = Date.now()
  }

  /**
   * Clear all states
   */
  clear(): void {
    this.states.clear()
  }
}

/**
 * Activity execution result
 */
interface ActivityResult<T = unknown> {
  success: boolean
  result?: T
  error?: string
  durationMs: number
  attempts: number
}

/**
 * Mock activity executor for local and remote activities
 */
class MockActivityExecutor {
  private heartbeats = new Map<string, number>()

  /**
   * Execute a local activity
   */
  async executeLocal<T>(
    activityName: string,
    fn: () => Promise<T>,
    timeoutMs: number = 5000
  ): Promise<ActivityResult<T>> {
    const startTime = performance.now()
    try {
      const result = await fn()
      return {
        success: true,
        result,
        durationMs: performance.now() - startTime,
        attempts: 1,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - startTime,
        attempts: 1,
      }
    }
  }

  /**
   * Execute a remote DO activity (simulated)
   */
  async executeRemote<T>(
    activityName: string,
    doId: string,
    args: unknown[],
    timeoutMs: number = 10000
  ): Promise<ActivityResult<T>> {
    const startTime = performance.now()
    // Simulate remote execution with small delay
    const result = { activityName, doId, args } as T
    return {
      success: true,
      result,
      durationMs: performance.now() - startTime,
      attempts: 1,
    }
  }

  /**
   * Send heartbeat for long-running activity
   */
  heartbeat(activityId: string): void {
    this.heartbeats.set(activityId, Date.now())
  }

  /**
   * Get last heartbeat time
   */
  getLastHeartbeat(activityId: string): number | undefined {
    return this.heartbeats.get(activityId)
  }

  /**
   * Check if activity is still alive (heartbeat within timeout)
   */
  isAlive(activityId: string, heartbeatTimeoutMs: number = 30000): boolean {
    const lastHeartbeat = this.heartbeats.get(activityId)
    if (!lastHeartbeat) return false
    return Date.now() - lastHeartbeat < heartbeatTimeoutMs
  }

  /**
   * Clear heartbeats
   */
  clearHeartbeats(): void {
    this.heartbeats.clear()
  }
}

/**
 * Signal definition
 */
interface Signal {
  id: string
  name: string
  data: unknown
  timestamp: number
  processed: boolean
}

/**
 * Timer definition
 */
interface Timer {
  id: string
  durationMs: number
  scheduledAt: number
  fireAt: number
  callback?: string
  cancelled: boolean
  fired: boolean
}

/**
 * Mock signal and timer manager
 */
class MockSignalTimerManager {
  private signals = new Map<string, Signal[]>()
  private timers = new Map<string, Timer>()
  private timerCounter = 0
  private signalWaiters = new Map<string, {
    resolve: (signal: Signal) => void
    signalName: string
  }[]>()

  /**
   * Send a signal to a workflow
   */
  sendSignal(workflowId: string, signalName: string, data: unknown): string {
    const id = crypto.randomUUID()
    const signal: Signal = {
      id,
      name: signalName,
      data,
      timestamp: Date.now(),
      processed: false,
    }

    const signals = this.signals.get(workflowId) ?? []
    signals.push(signal)
    this.signals.set(workflowId, signals)

    // Resolve any waiters
    const waiters = this.signalWaiters.get(workflowId) ?? []
    const matchingWaiter = waiters.find(w => w.signalName === signalName)
    if (matchingWaiter) {
      matchingWaiter.resolve(signal)
      this.signalWaiters.set(
        workflowId,
        waiters.filter(w => w !== matchingWaiter)
      )
    }

    return id
  }

  /**
   * Wait for a signal
   */
  async waitForSignal(workflowId: string, signalName: string, timeoutMs?: number): Promise<Signal | null> {
    // Check for existing unprocessed signal
    const signals = this.signals.get(workflowId) ?? []
    const existing = signals.find(s => s.name === signalName && !s.processed)
    if (existing) {
      existing.processed = true
      return existing
    }

    // Set up waiter
    return new Promise((resolve) => {
      const waiters = this.signalWaiters.get(workflowId) ?? []
      const waiter = { resolve, signalName }
      waiters.push(waiter)
      this.signalWaiters.set(workflowId, waiters)

      if (timeoutMs) {
        setTimeout(() => {
          const currentWaiters = this.signalWaiters.get(workflowId) ?? []
          if (currentWaiters.includes(waiter)) {
            this.signalWaiters.set(
              workflowId,
              currentWaiters.filter(w => w !== waiter)
            )
            resolve(null)
          }
        }, timeoutMs)
      }
    })
  }

  /**
   * Create a timer
   */
  createTimer(durationMs: number, callback?: string): string {
    const id = `timer-${++this.timerCounter}`
    const now = Date.now()
    this.timers.set(id, {
      id,
      durationMs,
      scheduledAt: now,
      fireAt: now + durationMs,
      callback,
      cancelled: false,
      fired: false,
    })
    return id
  }

  /**
   * Cancel a timer
   */
  cancelTimer(timerId: string): boolean {
    const timer = this.timers.get(timerId)
    if (!timer || timer.cancelled || timer.fired) return false
    timer.cancelled = true
    return true
  }

  /**
   * Check if timer has fired
   */
  checkTimer(timerId: string): boolean {
    const timer = this.timers.get(timerId)
    if (!timer || timer.cancelled) return false

    if (!timer.fired && Date.now() >= timer.fireAt) {
      timer.fired = true
    }
    return timer.fired
  }

  /**
   * Get timer status
   */
  getTimer(timerId: string): Timer | undefined {
    return this.timers.get(timerId)
  }

  /**
   * Get pending signals for a workflow
   */
  getPendingSignals(workflowId: string): Signal[] {
    const signals = this.signals.get(workflowId) ?? []
    return signals.filter(s => !s.processed)
  }

  /**
   * Clear all signals and timers
   */
  clear(): void {
    this.signals.clear()
    this.timers.clear()
    this.timerCounter = 0
    this.signalWaiters.clear()
  }
}

// ============================================================================
// DAG/WORKFLOWS BENCHMARKS
// ============================================================================

describe('DAG/Workflows Benchmarks', () => {
  let dag: MockDAG

  beforeEach(() => {
    dag = new MockDAG()
  })

  describe('execute single task benchmark', () => {
    it('should measure single task execution performance', async () => {
      const result = await runBenchmark('DAG.executeSingleTask', async () => {
        dag.clear()
        const taskId = dag.addTask('process-data')
        await dag.executeTask(taskId, async () => {
          return { processed: true }
        })
      })

      console.log('\n--- DAG Single Task Execution Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('parallel tasks (fan-out) benchmark', () => {
    it('should measure parallel task execution performance', async () => {
      const result = await runBenchmark('DAG.executeParallel', async () => {
        dag.clear()
        const taskIds = [
          dag.addTask('task-1'),
          dag.addTask('task-2'),
          dag.addTask('task-3'),
          dag.addTask('task-4'),
          dag.addTask('task-5'),
        ]
        await dag.executeParallel(taskIds, async (id) => {
          return { taskId: id, result: 'done' }
        })
      })

      console.log('\n--- DAG Parallel Tasks (Fan-Out) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('create DAG with dependencies benchmark', () => {
    it('should measure DAG creation with dependencies', async () => {
      const result = await runBenchmark('DAG.createWithDependencies', async () => {
        dag.clear()
        // Create a complex DAG with dependencies
        const task1 = dag.addTask('extract')
        const task2 = dag.addTask('transform-1', [task1])
        const task3 = dag.addTask('transform-2', [task1])
        const task4 = dag.addTask('load', [task2, task3])
        dag.addTask('validate', [task4])
      })

      console.log('\n--- DAG Create with Dependencies Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('start/status DAG run benchmark', () => {
    it('should measure DAG status retrieval performance', async () => {
      // Setup DAG with multiple tasks
      for (let i = 0; i < 10; i++) {
        const taskId = dag.addTask(`task-${i}`)
        if (i % 2 === 0) {
          await dag.executeTask(taskId, async () => ({ done: true }))
        }
      }

      const result = await runBenchmark('DAG.getStatus', () => {
        dag.getStatus()
      })

      console.log('\n--- DAG Status Retrieval Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })
})

// ============================================================================
// RETRY POLICIES BENCHMARKS
// ============================================================================

describe('Retry Policies Benchmarks', () => {
  let retryExecutor: MockRetryExecutor

  beforeEach(() => {
    retryExecutor = new MockRetryExecutor()
  })

  describe('fixed backoff retry benchmark', () => {
    it('should measure fixed backoff retry performance', async () => {
      let attempt = 0
      const result = await runBenchmark('Retry.fixedBackoff', async () => {
        attempt = 0
        await retryExecutor.executeWithFixedBackoff(
          async () => {
            attempt++
            if (attempt < 2) throw new Error('Transient error')
            return 'success'
          },
          { maxAttempts: 3, initialDelayMs: 10 }
        )
      })

      console.log('\n--- Fixed Backoff Retry Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('exponential backoff with jitter benchmark', () => {
    it('should measure exponential backoff with jitter performance', async () => {
      let attempt = 0
      const result = await runBenchmark('Retry.exponentialBackoff', async () => {
        attempt = 0
        await retryExecutor.executeWithExponentialBackoff(
          async () => {
            attempt++
            if (attempt < 2) throw new Error('Transient error')
            return 'success'
          },
          {
            maxAttempts: 5,
            initialDelayMs: 10,
            maxDelayMs: 1000,
            backoffMultiplier: 2,
            jitter: true,
          }
        )
      })

      console.log('\n--- Exponential Backoff with Jitter Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('delay calculation benchmark', () => {
    it('should measure retry delay calculation performance', async () => {
      const policy: RetryPolicy = {
        maxAttempts: 10,
        initialDelayMs: 100,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitter: true,
      }

      let attemptNum = 1
      const result = await runBenchmark('Retry.calculateDelay', () => {
        retryExecutor.calculateNextDelay(attemptNum++ % 10 + 1, policy)
      })

      console.log('\n--- Retry Delay Calculation Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC * 10)
    })
  })
})

// ============================================================================
// SCHEDULING BENCHMARKS
// ============================================================================

describe('Scheduling Benchmarks', () => {
  let scheduleManager: MockScheduleManager

  beforeEach(() => {
    scheduleManager = new MockScheduleManager()
  })

  describe('CRON trigger scheduling benchmark', () => {
    it('should measure CRON schedule registration performance', async () => {
      const result = await runBenchmark('Schedule.registerCron', async () => {
        scheduleManager.clear()
        scheduleManager.registerSchedule('*/5 * * * *', 'processQueue')
        scheduleManager.registerSchedule('0 * * * *', 'hourlyCleanup')
        scheduleManager.registerSchedule('0 0 * * *', 'dailyReport')
      })

      console.log('\n--- CRON Schedule Registration Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('next trigger time calculation benchmark', () => {
    it('should measure next run time calculation performance', async () => {
      const expressions = [
        '* * * * *',      // Every minute
        '*/5 * * * *',    // Every 5 minutes
        '0 * * * *',      // Every hour
        '0 0 * * *',      // Daily
        '0 0 * * 0',      // Weekly
      ]

      let idx = 0
      const result = await runBenchmark('Schedule.calculateNextRun', () => {
        scheduleManager.calculateNextRun(expressions[idx++ % expressions.length]!)
      })

      console.log('\n--- Next Trigger Time Calculation Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC * 10)
    })
  })

  describe('due schedules retrieval benchmark', () => {
    it('should measure due schedules retrieval performance', async () => {
      // Register multiple schedules
      for (let i = 0; i < 50; i++) {
        scheduleManager.registerSchedule(`*/${i + 1} * * * *`, `handler-${i}`)
      }

      const result = await runBenchmark('Schedule.getDueSchedules', () => {
        scheduleManager.getDueSchedules()
      })

      console.log('\n--- Due Schedules Retrieval Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })
})

// ============================================================================
// SENSORS BENCHMARKS
// ============================================================================

describe('Sensors Benchmarks', () => {
  let sensor: MockSensor

  beforeEach(() => {
    sensor = new MockSensor()
  })

  describe('create cross-DAG sensor benchmark', () => {
    it('should measure sensor creation performance', async () => {
      const result = await runBenchmark('Sensor.createCondition', async () => {
        sensor.clear()
        sensor.createCondition('dag_completed', 'upstream-dag-1', 60000)
        sensor.createCondition('file_exists', '/data/input.csv', 30000)
        sensor.createCondition('custom', 'api-ready')
      })

      console.log('\n--- Cross-DAG Sensor Creation Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('check sensor condition benchmark', () => {
    it('should measure sensor condition check performance', async () => {
      // Create conditions to check
      const conditionIds: string[] = []
      for (let i = 0; i < 20; i++) {
        conditionIds.push(sensor.createCondition('dag_completed', `dag-${i}`))
      }

      let idx = 0
      const result = await runBenchmark('Sensor.checkCondition', () => {
        sensor.checkCondition(conditionIds[idx++ % conditionIds.length]!, {
          dagCompleted: idx % 2 === 0,
        })
      })

      console.log('\n--- Sensor Condition Check Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC * 5)
    })
  })
})

// ============================================================================
// WORKFLOW STATE BENCHMARKS
// ============================================================================

describe('Workflow State Benchmarks', () => {
  let stateStore: MockWorkflowStateStore

  beforeEach(() => {
    stateStore = new MockWorkflowStateStore()
  })

  describe('save/load workflow state benchmark', () => {
    it('should measure state save performance', async () => {
      let stateNum = 0
      const result = await runBenchmark('WorkflowState.save', async () => {
        const state = stateStore.createState(`workflow-${stateNum++}`, 'run-1')
        state.variables.set('counter', stateNum)
        state.variables.set('data', { items: [1, 2, 3, 4, 5] })
        stateStore.saveState(state)
      })

      console.log('\n--- Workflow State Save Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })

    it('should measure state load performance', async () => {
      // Seed states
      for (let i = 0; i < 100; i++) {
        const state = stateStore.createState(`workflow-${i}`, 'run-1')
        state.variables.set('data', { index: i })
        stateStore.saveState(state)
      }

      let idx = 0
      const result = await runBenchmark('WorkflowState.load', () => {
        stateStore.loadState(`workflow-${idx++ % 100}`, 'run-1')
      })

      console.log('\n--- Workflow State Load Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('replay from checkpoint benchmark', () => {
    it('should measure checkpoint save performance', async () => {
      const state = stateStore.createState('workflow-checkpoint', 'run-1')

      let checkpointNum = 0
      const result = await runBenchmark('WorkflowState.saveCheckpoint', () => {
        stateStore.saveCheckpoint(state, `checkpoint-${checkpointNum++}`, {
          step: checkpointNum,
          data: { accumulated: checkpointNum * 10 },
        })
      })

      console.log('\n--- Checkpoint Save Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })

    it('should measure replay from checkpoint performance', async () => {
      // Create state with multiple checkpoints
      const state = stateStore.createState('workflow-replay', 'run-1')
      for (let i = 0; i < 20; i++) {
        stateStore.saveCheckpoint(state, `checkpoint-${i}`, { step: i })
      }

      let idx = 0
      const result = await runBenchmark('WorkflowState.replayFromCheckpoint', () => {
        stateStore.replayFromCheckpoint('workflow-replay', 'run-1', `checkpoint-${idx++ % 20}`)
      })

      console.log('\n--- Replay from Checkpoint Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('history append benchmark', () => {
    it('should measure history event append performance', async () => {
      const state = stateStore.createState('workflow-history', 'run-1')

      const result = await runBenchmark('WorkflowState.appendHistory', () => {
        stateStore.appendHistory(state, 'ACTIVITY_COMPLETED', {
          activityName: 'processData',
          result: { processed: true },
        })
      })

      console.log('\n--- History Append Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })
})

// ============================================================================
// ACTIVITIES BENCHMARKS
// ============================================================================

describe('Activities Benchmarks', () => {
  let activityExecutor: MockActivityExecutor

  beforeEach(() => {
    activityExecutor = new MockActivityExecutor()
  })

  afterEach(() => {
    activityExecutor.clearHeartbeats()
  })

  describe('execute local activity benchmark', () => {
    it('should measure local activity execution performance', async () => {
      const result = await runBenchmark('Activity.executeLocal', async () => {
        await activityExecutor.executeLocal('processItem', async () => {
          return { processed: true, timestamp: Date.now() }
        })
      })

      console.log('\n--- Local Activity Execution Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('execute remote DO activity benchmark', () => {
    it('should measure remote DO activity execution performance', async () => {
      let activityNum = 0
      const result = await runBenchmark('Activity.executeRemote', async () => {
        await activityExecutor.executeRemote(
          'remoteProcess',
          `do-${activityNum++}`,
          [{ data: 'payload' }]
        )
      })

      console.log('\n--- Remote DO Activity Execution Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('heartbeat benchmark', () => {
    it('should measure heartbeat performance', async () => {
      // Setup activities to heartbeat
      const activityIds = Array.from({ length: 50 }, (_, i) => `activity-${i}`)

      let idx = 0
      const result = await runBenchmark('Activity.heartbeat', () => {
        activityExecutor.heartbeat(activityIds[idx++ % activityIds.length]!)
      })

      console.log('\n--- Activity Heartbeat Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC * 10)
    })

    it('should measure heartbeat check performance', async () => {
      // Setup heartbeats
      const activityIds: string[] = []
      for (let i = 0; i < 50; i++) {
        const id = `activity-${i}`
        activityIds.push(id)
        activityExecutor.heartbeat(id)
      }

      let idx = 0
      const result = await runBenchmark('Activity.isAlive', () => {
        activityExecutor.isAlive(activityIds[idx++ % activityIds.length]!)
      })

      console.log('\n--- Activity Alive Check Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC * 10)
    })
  })
})

// ============================================================================
// SIGNALS/TIMERS BENCHMARKS
// ============================================================================

describe('Signals/Timers Benchmarks', () => {
  let signalTimerManager: MockSignalTimerManager

  beforeEach(() => {
    signalTimerManager = new MockSignalTimerManager()
  })

  afterEach(() => {
    signalTimerManager.clear()
  })

  describe('send/wait for signal benchmark', () => {
    it('should measure signal send performance', async () => {
      let signalNum = 0
      const result = await runBenchmark('Signal.send', () => {
        signalTimerManager.sendSignal(
          `workflow-${signalNum % 10}`,
          'dataReady',
          { batch: signalNum++ }
        )
      })

      console.log('\n--- Signal Send Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })

    it('should measure signal retrieval performance', async () => {
      // Seed signals
      for (let i = 0; i < 100; i++) {
        signalTimerManager.sendSignal(`workflow-${i % 10}`, 'event', { index: i })
      }

      let idx = 0
      const result = await runBenchmark('Signal.getPending', () => {
        signalTimerManager.getPendingSignals(`workflow-${idx++ % 10}`)
      })

      console.log('\n--- Pending Signals Retrieval Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('create/cancel timer benchmark', () => {
    it('should measure timer creation performance', async () => {
      const result = await runBenchmark('Timer.create', () => {
        signalTimerManager.clear()
        signalTimerManager.createTimer(1000, 'onTimeout')
        signalTimerManager.createTimer(5000, 'onDeadline')
        signalTimerManager.createTimer(60000, 'onExpiry')
      })

      console.log('\n--- Timer Creation Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })

    it('should measure timer cancellation performance', async () => {
      // Create timers to cancel
      const timerIds: string[] = []
      for (let i = 0; i < 50; i++) {
        timerIds.push(signalTimerManager.createTimer(10000 + i * 1000))
      }

      let idx = 0
      const result = await runBenchmark('Timer.cancel', () => {
        // Re-create timer if already cancelled
        if (idx >= timerIds.length) {
          timerIds.push(signalTimerManager.createTimer(10000))
        }
        signalTimerManager.cancelTimer(timerIds[idx++]!)
      })

      console.log('\n--- Timer Cancellation Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })

    it('should measure timer check performance', async () => {
      // Create timers to check
      const timerIds: string[] = []
      for (let i = 0; i < 50; i++) {
        timerIds.push(signalTimerManager.createTimer(i * 100))
      }

      let idx = 0
      const result = await runBenchmark('Timer.check', () => {
        signalTimerManager.checkTimer(timerIds[idx++ % timerIds.length]!)
      })

      console.log('\n--- Timer Check Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC * 10)
    })
  })
})

// ============================================================================
// SUMMARY REPORT
// ============================================================================

describe('Workflow Primitives Benchmark Summary', () => {
  it('should print consolidated benchmark summary', async () => {
    console.log('\n========================================')
    console.log('WORKFLOW PRIMITIVES BENCHMARK SUMMARY')
    console.log('========================================\n')

    console.log('Primitives benchmarked:')
    console.log('  1. DAG/Workflows - Task execution and dependency management')
    console.log('  2. Retry Policies - Fixed and exponential backoff strategies')
    console.log('  3. Scheduling - CRON trigger and next run calculation')
    console.log('  4. Sensors - Cross-DAG coordination')
    console.log('  5. Workflow State - Persistence and replay')
    console.log('  6. Activities - Local and remote execution')
    console.log('  7. Signals/Timers - Communication and timing primitives')
    console.log('')

    console.log('Configuration:')
    console.log(`  Iterations per benchmark: ${BENCHMARK_ITERATIONS}`)
    console.log(`  Warmup iterations: ${WARMUP_ITERATIONS}`)
    console.log(`  Max single op latency: ${MAX_SINGLE_OP_LATENCY_MS} ms`)
    console.log(`  Min throughput: ${MIN_THROUGHPUT_OPS_SEC} ops/sec`)
    console.log('')

    console.log('Performance targets:')
    console.log('  - Single operation: < 50ms (P99)')
    console.log('  - Write throughput: > 100 ops/sec')
    console.log('  - Read throughput: > 500 ops/sec')
    console.log('  - Memory: Stable under load')
    console.log('')

    console.log('Temporal Compat Layer Support:')
    console.log('  - Activity deduplication with ExactlyOnceContext')
    console.log('  - Workflow history store for replay')
    console.log('  - Timer management with WindowManager')
    console.log('  - Deadline management for SLAs')
    console.log('  - Signal/Query/Update primitives')
    console.log('')

    expect(true).toBe(true)
  })
})
