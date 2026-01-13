/**
 * DAGScheduler Tests
 *
 * RED phase: These tests define the expected behavior of DAGScheduler.
 * All tests should FAIL until implementation is complete.
 *
 * DAGScheduler provides workflow orchestration with:
 * - Directed Acyclic Graph (DAG) task definitions
 * - Dependency resolution with topological sort
 * - Cycle detection with meaningful error messages
 * - Parallel execution with concurrency limits
 * - Retry policies with exponential backoff
 * - State persistence for recovery
 * - Cron scheduling
 * - Dynamic task generation
 * - Cross-DAG dependencies
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  // Core types
  type TaskNode,
  type DAG,
  type DAGRun,
  type TaskResult,
  type TaskStatus,
  // Dependency resolution
  type DependencyResolver,
  createDependencyResolver,
  // Retry policies
  type RetryPolicy,
  type BackoffStrategy,
  createRetryPolicy,
  // Parallel executor
  type ParallelExecutor,
  type ExecutorOptions,
  createParallelExecutor,
  // State persistence
  type DAGStateStore,
  type DAGRunState,
  createInMemoryStateStore,
  // Cron triggers
  type CronTrigger,
  type ScheduleTrigger,
  createCronTrigger,
  parseCronExpression,
  // Dynamic tasks
  type DynamicTaskGenerator,
  // Cross-DAG dependencies
  type ExternalDependency,
  type DAGTrigger,
  type Sensor,
  createSensor,
  // Factories
  createDAG,
  createTaskNode,
  dag,
  task,
} from './index'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createSimpleTask(id: string, deps: string[] = []): TaskNode {
  return createTaskNode({
    id,
    execute: async () => `result-${id}`,
    dependencies: deps,
  })
}

// ============================================================================
// TASK NODE - INDIVIDUAL TASK DEFINITION
// ============================================================================

describe('TaskNode', () => {
  describe('creation and validation', () => {
    it('should create a task with required fields', () => {
      const task = createTaskNode({
        id: 'task-1',
        execute: async () => 'result',
        dependencies: [],
      })
      expect(task.id).toBe('task-1')
      expect(task.dependencies).toEqual([])
      expect(typeof task.execute).toBe('function')
    })

    it('should create a task with optional fields', () => {
      const retryPolicy: RetryPolicy = {
        maxAttempts: 3,
        backoff: { type: 'fixed', delay: 100 },
      }
      const task = createTaskNode({
        id: 'task-1',
        execute: async () => 'result',
        dependencies: ['dep-1', 'dep-2'],
        retryPolicy,
        timeout: 5000,
        metadata: { priority: 'high' },
      })
      expect(task.dependencies).toEqual(['dep-1', 'dep-2'])
      expect(task.retryPolicy).toEqual(retryPolicy)
      expect(task.timeout).toBe(5000)
      expect(task.metadata).toEqual({ priority: 'high' })
    })

    it('should reject task with empty id', () => {
      expect(() =>
        createTaskNode({
          id: '',
          execute: async () => 'result',
          dependencies: [],
        })
      ).toThrow('Task id cannot be empty')
    })

    it('should reject task with duplicate dependencies', () => {
      expect(() =>
        createTaskNode({
          id: 'task-1',
          execute: async () => 'result',
          dependencies: ['dep-1', 'dep-1'],
        })
      ).toThrow('Duplicate dependency')
    })

    it('should reject task depending on itself', () => {
      expect(() =>
        createTaskNode({
          id: 'task-1',
          execute: async () => 'result',
          dependencies: ['task-1'],
        })
      ).toThrow('Task cannot depend on itself')
    })
  })

  describe('execution', () => {
    it('should execute and return result', async () => {
      const task = createTaskNode({
        id: 'task-1',
        execute: async () => 42,
        dependencies: [],
      })
      const result = await task.execute()
      expect(result).toBe(42)
    })

    it('should pass context to execute function', async () => {
      let receivedContext: unknown
      const task = createTaskNode({
        id: 'task-1',
        execute: async (ctx) => {
          receivedContext = ctx
          return 'done'
        },
        dependencies: [],
      })
      await task.execute({ runId: 'run-1', dagId: 'dag-1' })
      expect(receivedContext).toEqual({ runId: 'run-1', dagId: 'dag-1' })
    })

    it('should propagate errors from execute', async () => {
      const task = createTaskNode({
        id: 'task-1',
        execute: async () => {
          throw new Error('Task failed')
        },
        dependencies: [],
      })
      await expect(task.execute()).rejects.toThrow('Task failed')
    })
  })
})

// ============================================================================
// DAG - DIRECTED ACYCLIC GRAPH
// ============================================================================

describe('DAG', () => {
  describe('creation', () => {
    it('should create a DAG with tasks', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
          createSimpleTask('c', ['a']),
          createSimpleTask('d', ['b', 'c']),
        ],
      })
      expect(d.id).toBe('dag-1')
      expect(d.tasks.size).toBe(4)
      expect(d.tasks.get('a')).toBeDefined()
    })

    it('should create a DAG with schedule', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
        schedule: '0 9 * * MON', // Every Monday at 9am
      })
      expect(d.schedule).toBe('0 9 * * MON')
    })

    it('should reject DAG with duplicate task ids', () => {
      expect(() =>
        createDAG({
          id: 'dag-1',
          tasks: [createSimpleTask('a'), createSimpleTask('a')],
        })
      ).toThrow('Duplicate task id')
    })

    it('should reject DAG with missing dependencies', () => {
      expect(() =>
        createDAG({
          id: 'dag-1',
          tasks: [createSimpleTask('a', ['nonexistent'])],
        })
      ).toThrow("Task 'a' depends on unknown task 'nonexistent'")
    })

    it('should detect cycles at creation time', () => {
      expect(() =>
        createDAG({
          id: 'dag-1',
          tasks: [
            createSimpleTask('a', ['c']),
            createSimpleTask('b', ['a']),
            createSimpleTask('c', ['b']),
          ],
        })
      ).toThrow(/cycle/i)
    })
  })

  describe('fluent builder (dag/task)', () => {
    it('should build DAG with fluent API', () => {
      const d = dag('my-dag')
        .task('extract', async () => 'data')
        .task('transform', async () => 'transformed', { deps: ['extract'] })
        .task('load', async () => 'loaded', { deps: ['transform'] })
        .build()

      expect(d.id).toBe('my-dag')
      expect(d.tasks.size).toBe(3)
      expect(d.tasks.get('transform')?.dependencies).toContain('extract')
    })

    it('should support task decorator pattern', () => {
      const extract = task('extract', async () => 'data')
      const transform = task('transform', async () => 'transformed', { deps: [extract] })
      const load = task('load', async () => 'loaded', { deps: [transform] })

      const d = dag('etl', [extract, transform, load]).build()
      expect(d.tasks.size).toBe(3)
    })
  })

  describe('run', () => {
    it('should execute all tasks and return DAGRun', async () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
        ],
      })
      const run = await d.run()
      expect(run.dagId).toBe('dag-1')
      expect(run.status).toBe('completed')
      expect(run.taskResults.get('a')?.status).toBe('success')
      expect(run.taskResults.get('b')?.status).toBe('success')
    })

    it('should fail run if any task fails', async () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'a',
            execute: async () => {
              throw new Error('Task A failed')
            },
            dependencies: [],
          }),
          createSimpleTask('b', ['a']),
        ],
      })
      const run = await d.run()
      expect(run.status).toBe('failed')
      expect(run.taskResults.get('a')?.status).toBe('failed')
      expect(run.taskResults.get('b')?.status).toBe('skipped')
    })
  })
})

// ============================================================================
// DEPENDENCY RESOLVER - TOPOLOGICAL SORT AND CYCLE DETECTION
// ============================================================================

describe('DependencyResolver', () => {
  let resolver: DependencyResolver

  beforeEach(() => {
    resolver = createDependencyResolver()
  })

  describe('getExecutionOrder', () => {
    it('should return tasks in topological order', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('d', ['b', 'c']),
          createSimpleTask('b', ['a']),
          createSimpleTask('c', ['a']),
          createSimpleTask('a'),
        ],
      })
      const order = resolver.getExecutionOrder(d)
      const orderIds = order.map((t) => t.id)

      // 'a' must come before 'b' and 'c'
      expect(orderIds.indexOf('a')).toBeLessThan(orderIds.indexOf('b'))
      expect(orderIds.indexOf('a')).toBeLessThan(orderIds.indexOf('c'))
      // 'b' and 'c' must come before 'd'
      expect(orderIds.indexOf('b')).toBeLessThan(orderIds.indexOf('d'))
      expect(orderIds.indexOf('c')).toBeLessThan(orderIds.indexOf('d'))
    })

    it('should handle linear chain', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
          createSimpleTask('c', ['b']),
        ],
      })
      const order = resolver.getExecutionOrder(d)
      expect(order.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    })

    it('should handle diamond pattern', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
          createSimpleTask('c', ['a']),
          createSimpleTask('d', ['b', 'c']),
        ],
      })
      const order = resolver.getExecutionOrder(d)
      const orderIds = order.map((t) => t.id)

      expect(orderIds[0]).toBe('a')
      expect(orderIds[3]).toBe('d')
      // b and c can be in either order
      expect(orderIds.slice(1, 3).sort()).toEqual(['b', 'c'])
    })

    it('should handle independent tasks', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b'),
          createSimpleTask('c'),
        ],
      })
      const order = resolver.getExecutionOrder(d)
      expect(order).toHaveLength(3)
      // Order doesn't matter for independent tasks, just verify all present
      expect(order.map((t) => t.id).sort()).toEqual(['a', 'b', 'c'])
    })

    it('should handle empty DAG', () => {
      const d = createDAG({ id: 'dag-1', tasks: [] })
      const order = resolver.getExecutionOrder(d)
      expect(order).toEqual([])
    })

    it('should handle single task', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
      })
      const order = resolver.getExecutionOrder(d)
      expect(order.map((t) => t.id)).toEqual(['a'])
    })
  })

  describe('detectCycles', () => {
    it('should return null for acyclic graph', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
          createSimpleTask('c', ['b']),
        ],
      })
      const cycles = resolver.detectCycles(d)
      expect(cycles).toBeNull()
    })

    it('should detect simple cycle', () => {
      // Note: createDAG validates cycles, so we test the resolver directly
      const tasks = new Map<string, TaskNode>()
      tasks.set('a', { id: 'a', execute: async () => {}, dependencies: ['b'] })
      tasks.set('b', { id: 'b', execute: async () => {}, dependencies: ['a'] })
      const d: DAG = { id: 'dag-1', tasks, run: async () => ({} as DAGRun) }

      const cycles = resolver.detectCycles(d)
      expect(cycles).not.toBeNull()
      expect(cycles).toContainEqual(expect.arrayContaining(['a', 'b']))
    })

    it('should detect complex cycle', () => {
      const tasks = new Map<string, TaskNode>()
      tasks.set('a', { id: 'a', execute: async () => {}, dependencies: ['c'] })
      tasks.set('b', { id: 'b', execute: async () => {}, dependencies: ['a'] })
      tasks.set('c', { id: 'c', execute: async () => {}, dependencies: ['b'] })
      const d: DAG = { id: 'dag-1', tasks, run: async () => ({} as DAGRun) }

      const cycles = resolver.detectCycles(d)
      expect(cycles).not.toBeNull()
      expect(cycles!.length).toBeGreaterThan(0)
    })

    it('should detect self-referential cycle', () => {
      const tasks = new Map<string, TaskNode>()
      tasks.set('a', { id: 'a', execute: async () => {}, dependencies: ['a'] })
      const d: DAG = { id: 'dag-1', tasks, run: async () => ({} as DAGRun) }

      const cycles = resolver.detectCycles(d)
      expect(cycles).not.toBeNull()
    })
  })

  describe('getReadyTasks', () => {
    it('should return tasks with no dependencies initially', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b'),
          createSimpleTask('c', ['a', 'b']),
        ],
      })
      const ready = resolver.getReadyTasks(d, new Set())
      expect(ready.map((t) => t.id).sort()).toEqual(['a', 'b'])
    })

    it('should return dependent tasks when dependencies complete', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
          createSimpleTask('c', ['a']),
        ],
      })
      const ready = resolver.getReadyTasks(d, new Set(['a']))
      expect(ready.map((t) => t.id).sort()).toEqual(['b', 'c'])
    })

    it('should not return tasks with incomplete dependencies', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b'),
          createSimpleTask('c', ['a', 'b']),
        ],
      })
      const ready = resolver.getReadyTasks(d, new Set(['a']))
      expect(ready.map((t) => t.id)).not.toContain('c')
    })

    it('should not return already completed tasks', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
        ],
      })
      const ready = resolver.getReadyTasks(d, new Set(['a']))
      expect(ready.map((t) => t.id)).not.toContain('a')
    })

    it('should return empty array when all tasks complete', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
        ],
      })
      const ready = resolver.getReadyTasks(d, new Set(['a', 'b']))
      expect(ready).toEqual([])
    })
  })

  describe('getDependents', () => {
    it('should return all tasks that depend on given task', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
          createSimpleTask('c', ['a']),
          createSimpleTask('d', ['b']),
        ],
      })
      const dependents = resolver.getDependents(d, 'a')
      expect(dependents.map((t) => t.id).sort()).toEqual(['b', 'c'])
    })

    it('should return empty array for leaf tasks', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
        ],
      })
      const dependents = resolver.getDependents(d, 'b')
      expect(dependents).toEqual([])
    })

    it('should return transitive dependents when requested', () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
          createSimpleTask('c', ['b']),
        ],
      })
      const dependents = resolver.getDependents(d, 'a', { transitive: true })
      expect(dependents.map((t) => t.id).sort()).toEqual(['b', 'c'])
    })
  })
})

// ============================================================================
// PARALLEL EXECUTOR - CONCURRENT TASK EXECUTION
// ============================================================================

describe('ParallelExecutor', () => {
  let executor: ParallelExecutor

  beforeEach(() => {
    executor = createParallelExecutor()
  })

  describe('execute', () => {
    it('should execute all tasks in dependency order', async () => {
      const executionOrder: string[] = []
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'a',
            execute: async () => {
              executionOrder.push('a')
              return 'a'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'b',
            execute: async () => {
              executionOrder.push('b')
              return 'b'
            },
            dependencies: ['a'],
          }),
        ],
      })

      const run = await executor.execute(d)
      expect(run.status).toBe('completed')
      expect(executionOrder).toEqual(['a', 'b'])
    })

    it('should execute independent tasks in parallel', async () => {
      const startTimes: Map<string, number> = new Map()
      const endTimes: Map<string, number> = new Map()

      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'a',
            execute: async () => {
              startTimes.set('a', Date.now())
              await delay(50)
              endTimes.set('a', Date.now())
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'b',
            execute: async () => {
              startTimes.set('b', Date.now())
              await delay(50)
              endTimes.set('b', Date.now())
            },
            dependencies: [],
          }),
        ],
      })

      const start = Date.now()
      await executor.execute(d)
      const duration = Date.now() - start

      // Should complete in ~50ms (parallel) not ~100ms (serial)
      expect(duration).toBeLessThan(100)
      // Both should have started around the same time
      expect(Math.abs(startTimes.get('a')! - startTimes.get('b')!)).toBeLessThan(20)
    })

    it('should respect maxConcurrency limit', async () => {
      let concurrent = 0
      let maxConcurrent = 0

      const tasks = Array.from({ length: 5 }, (_, i) =>
        createTaskNode({
          id: `task-${i}`,
          execute: async () => {
            concurrent++
            maxConcurrent = Math.max(maxConcurrent, concurrent)
            await delay(30)
            concurrent--
          },
          dependencies: [],
        })
      )

      const d = createDAG({ id: 'dag-1', tasks })
      await executor.execute(d, { maxConcurrency: 2 })

      expect(maxConcurrent).toBe(2)
    })

    it('should handle task timeout', async () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'slow',
            execute: async () => {
              await delay(500)
              return 'done'
            },
            dependencies: [],
            timeout: 50,
          }),
        ],
      })

      const run = await executor.execute(d)
      expect(run.status).toBe('failed')
      expect(run.taskResults.get('slow')?.status).toBe('failed')
      expect(run.taskResults.get('slow')?.error?.message).toMatch(/timeout/i)
    })

    it('should skip downstream tasks when upstream fails', async () => {
      const executed: string[] = []
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'a',
            execute: async () => {
              executed.push('a')
              throw new Error('A failed')
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'b',
            execute: async () => {
              executed.push('b')
              return 'b'
            },
            dependencies: ['a'],
          }),
          createTaskNode({
            id: 'c',
            execute: async () => {
              executed.push('c')
              return 'c'
            },
            dependencies: [],
          }),
        ],
      })

      const run = await executor.execute(d)
      expect(executed).toContain('a')
      expect(executed).toContain('c')
      expect(executed).not.toContain('b')
      expect(run.taskResults.get('b')?.status).toBe('skipped')
    })

    it('should pass upstream results to downstream tasks', async () => {
      let receivedResults: unknown
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'a',
            execute: async () => 'result-a',
            dependencies: [],
          }),
          createTaskNode({
            id: 'b',
            execute: async (ctx) => {
              receivedResults = ctx?.upstreamResults
              return 'result-b'
            },
            dependencies: ['a'],
          }),
        ],
      })

      await executor.execute(d)
      expect(receivedResults).toEqual({ a: 'result-a' })
    })
  })

  describe('callbacks', () => {
    it('should call onTaskStart before task execution', async () => {
      const starts: string[] = []
      const d = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a'), createSimpleTask('b', ['a'])],
      })

      await executor.execute(d, {
        onTaskStart: (task) => starts.push(task.id),
      })

      expect(starts).toEqual(['a', 'b'])
    })

    it('should call onTaskComplete after task execution', async () => {
      const completions: { id: string; status: TaskStatus }[] = []
      const d = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a'), createSimpleTask('b', ['a'])],
      })

      await executor.execute(d, {
        onTaskComplete: (task, result) =>
          completions.push({ id: task.id, status: result.status }),
      })

      expect(completions).toContainEqual({ id: 'a', status: 'success' })
      expect(completions).toContainEqual({ id: 'b', status: 'success' })
    })
  })

  describe('cancellation', () => {
    it('should cancel running DAG', async () => {
      const executed: string[] = []
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'a',
            execute: async () => {
              executed.push('a')
              await delay(100)
              return 'a'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'b',
            execute: async () => {
              executed.push('b')
              return 'b'
            },
            dependencies: ['a'],
          }),
        ],
      })

      const runPromise = executor.execute(d)
      await delay(20)
      await executor.cancel()
      const run = await runPromise

      expect(run.status).toBe('cancelled')
      expect(executed).toContain('a')
      expect(executed).not.toContain('b')
    })

    it('should support pause and resume', async () => {
      const executed: string[] = []
      const d = createDAG({
        id: 'dag-1',
        tasks: Array.from({ length: 3 }, (_, i) =>
          createTaskNode({
            id: `task-${i}`,
            execute: async () => {
              executed.push(`task-${i}`)
              await delay(20)
            },
            dependencies: i > 0 ? [`task-${i - 1}`] : [],
          })
        ),
      })

      const runPromise = executor.execute(d)
      await delay(30)
      executor.pause()
      const pausedCount = executed.length
      await delay(50)
      expect(executed.length).toBe(pausedCount) // No progress while paused
      executor.resume()
      await runPromise
      expect(executed.length).toBe(3)
    })
  })
})

// ============================================================================
// RETRY POLICY - BACKOFF STRATEGIES
// ============================================================================

describe('RetryPolicy', () => {
  describe('createRetryPolicy', () => {
    it('should create policy with fixed backoff', () => {
      const policy = createRetryPolicy({
        maxAttempts: 3,
        backoff: { type: 'fixed', delay: 100 },
      })
      expect(policy.maxAttempts).toBe(3)
      expect(policy.getDelay(1)).toBe(100)
      expect(policy.getDelay(2)).toBe(100)
      expect(policy.getDelay(3)).toBe(100)
    })

    it('should create policy with exponential backoff', () => {
      const policy = createRetryPolicy({
        maxAttempts: 5,
        backoff: { type: 'exponential', base: 100, max: 5000 },
      })
      expect(policy.getDelay(1)).toBe(100) // 100 * 2^0
      expect(policy.getDelay(2)).toBe(200) // 100 * 2^1
      expect(policy.getDelay(3)).toBe(400) // 100 * 2^2
      expect(policy.getDelay(4)).toBe(800) // 100 * 2^3
      expect(policy.getDelay(5)).toBe(1600) // 100 * 2^4
      expect(policy.getDelay(10)).toBe(5000) // Capped at max
    })

    it('should create policy with exponential + jitter backoff', () => {
      const policy = createRetryPolicy({
        maxAttempts: 3,
        backoff: { type: 'exponential-jitter', base: 100, max: 1000 },
      })
      // Jitter adds randomness, so we check range
      const delays = Array.from({ length: 100 }, () => policy.getDelay(2))
      const min = Math.min(...delays)
      const max = Math.max(...delays)
      // Base delay at attempt 2 is 200, jitter should vary it
      expect(min).toBeGreaterThanOrEqual(0)
      expect(max).toBeLessThanOrEqual(400) // 200 * 2 max with jitter
    })

    it('should create policy with custom delays', () => {
      const policy = createRetryPolicy({
        maxAttempts: 4,
        backoff: { type: 'custom', delays: [100, 500, 2000, 5000] },
      })
      expect(policy.getDelay(1)).toBe(100)
      expect(policy.getDelay(2)).toBe(500)
      expect(policy.getDelay(3)).toBe(2000)
      expect(policy.getDelay(4)).toBe(5000)
    })
  })

  describe('shouldRetry', () => {
    it('should retry until maxAttempts', () => {
      const policy = createRetryPolicy({
        maxAttempts: 3,
        backoff: { type: 'fixed', delay: 100 },
      })
      expect(policy.shouldRetry(1, new Error())).toBe(true)
      expect(policy.shouldRetry(2, new Error())).toBe(true)
      expect(policy.shouldRetry(3, new Error())).toBe(false)
    })

    it('should respect retryableErrors filter', () => {
      const policy = createRetryPolicy({
        maxAttempts: 3,
        backoff: { type: 'fixed', delay: 100 },
        retryableErrors: (err) => err.message.includes('retryable'),
      })
      expect(policy.shouldRetry(1, new Error('retryable error'))).toBe(true)
      expect(policy.shouldRetry(1, new Error('fatal error'))).toBe(false)
    })
  })

  describe('onRetry callback', () => {
    it('should call onRetry hook', async () => {
      const retries: { attempt: number; error: Error }[] = []
      const policy = createRetryPolicy({
        maxAttempts: 3,
        backoff: { type: 'fixed', delay: 10 },
        onRetry: (attempt, error) => {
          retries.push({ attempt, error })
        },
      })

      // Simulate retries
      let attempt = 0
      const error = new Error('Retry me')
      while (policy.shouldRetry(++attempt, error)) {
        policy.onRetry?.(attempt, error)
        await delay(policy.getDelay(attempt))
      }

      expect(retries).toHaveLength(2)
      expect(retries[0].attempt).toBe(1)
      expect(retries[1].attempt).toBe(2)
    })
  })

  describe('custom delays edge cases', () => {
    it('should use last delay for attempts beyond array length', () => {
      const policy = createRetryPolicy({
        maxAttempts: 10,
        backoff: { type: 'custom', delays: [100, 200] },
      })
      expect(policy.getDelay(1)).toBe(100)
      expect(policy.getDelay(2)).toBe(200)
      expect(policy.getDelay(3)).toBe(200) // Falls back to last
      expect(policy.getDelay(10)).toBe(200) // Falls back to last
    })

    it('should handle empty custom delays array', () => {
      const policy = createRetryPolicy({
        maxAttempts: 3,
        backoff: { type: 'custom', delays: [] },
      })
      expect(policy.getDelay(1)).toBe(0)
      expect(policy.getDelay(2)).toBe(0)
    })
  })

  describe('exponential backoff cap', () => {
    it('should cap exponential delays at max value', () => {
      const policy = createRetryPolicy({
        maxAttempts: 10,
        backoff: { type: 'exponential', base: 100, max: 1000 },
      })
      // 100 * 2^0 = 100
      expect(policy.getDelay(1)).toBe(100)
      // 100 * 2^3 = 800
      expect(policy.getDelay(4)).toBe(800)
      // 100 * 2^4 = 1600 -> capped to 1000
      expect(policy.getDelay(5)).toBe(1000)
      // Should stay capped
      expect(policy.getDelay(6)).toBe(1000)
      expect(policy.getDelay(10)).toBe(1000)
    })

    it('should cap exponential-jitter delays at max value', () => {
      const policy = createRetryPolicy({
        maxAttempts: 10,
        backoff: { type: 'exponential-jitter', base: 100, max: 500 },
      })
      // With jitter, delays should never exceed max
      for (let i = 0; i < 50; i++) {
        expect(policy.getDelay(10)).toBeLessThanOrEqual(500)
      }
    })
  })

  describe('integration with executor', () => {
    it('should apply backoff delays during execution', async () => {
      const attemptTimes: number[] = []
      let attempts = 0

      const d = createDAG({
        id: 'backoff-test',
        tasks: [
          createTaskNode({
            id: 'flaky',
            execute: async () => {
              attemptTimes.push(Date.now())
              attempts++
              if (attempts < 3) throw new Error('Flaky')
              return 'success'
            },
            dependencies: [],
            retryPolicy: {
              maxAttempts: 3,
              backoff: { type: 'fixed', delay: 50 },
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(attemptTimes.length).toBe(3)
      // Check delays between attempts (should be ~50ms)
      const delay1 = attemptTimes[1]! - attemptTimes[0]!
      const delay2 = attemptTimes[2]! - attemptTimes[1]!
      expect(delay1).toBeGreaterThanOrEqual(40) // Allow some timing variance
      expect(delay1).toBeLessThan(100)
      expect(delay2).toBeGreaterThanOrEqual(40)
      expect(delay2).toBeLessThan(100)
    })

    it('should not retry non-retryable errors', async () => {
      let attempts = 0

      const d = createDAG({
        id: 'non-retryable-test',
        tasks: [
          createTaskNode({
            id: 'fatal',
            execute: async () => {
              attempts++
              throw new Error('FATAL: unrecoverable error')
            },
            dependencies: [],
            retryPolicy: {
              maxAttempts: 5,
              backoff: { type: 'fixed', delay: 10 },
              retryableErrors: (err) => !err.message.includes('FATAL'),
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('failed')
      expect(attempts).toBe(1) // Should not retry fatal errors
      expect(run.taskResults.get('fatal')?.attempts).toBe(1)
    })

    it('should call onRetry callback during executor retries', async () => {
      const retryLog: { attempt: number; message: string }[] = []
      let attempts = 0

      const d = createDAG({
        id: 'onretry-test',
        tasks: [
          createTaskNode({
            id: 'retryable',
            execute: async () => {
              attempts++
              if (attempts < 3) throw new Error(`Attempt ${attempts} failed`)
              return 'success'
            },
            dependencies: [],
            retryPolicy: {
              maxAttempts: 3,
              backoff: { type: 'fixed', delay: 10 },
              onRetry: (attempt, error) => {
                retryLog.push({ attempt, message: error.message })
              },
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(retryLog).toHaveLength(2)
      expect(retryLog[0]).toEqual({ attempt: 1, message: 'Attempt 1 failed' })
      expect(retryLog[1]).toEqual({ attempt: 2, message: 'Attempt 2 failed' })
    })

    it('should apply exponential backoff with increasing delays', async () => {
      const attemptTimes: number[] = []
      let attempts = 0

      const d = createDAG({
        id: 'exponential-test',
        tasks: [
          createTaskNode({
            id: 'exponential-retry',
            execute: async () => {
              attemptTimes.push(Date.now())
              attempts++
              if (attempts < 4) throw new Error('Retry me')
              return 'success'
            },
            dependencies: [],
            retryPolicy: {
              maxAttempts: 4,
              backoff: { type: 'exponential', base: 20, max: 1000 },
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(attemptTimes.length).toBe(4)

      // Check that delays are increasing (exponential pattern)
      const delay1 = attemptTimes[1]! - attemptTimes[0]! // ~20ms
      const delay2 = attemptTimes[2]! - attemptTimes[1]! // ~40ms
      const delay3 = attemptTimes[3]! - attemptTimes[2]! // ~80ms

      expect(delay2).toBeGreaterThan(delay1 * 1.5) // Should be roughly double
      expect(delay3).toBeGreaterThan(delay2 * 1.5) // Should be roughly double
    })

    it('should fail after exhausting maxAttempts', async () => {
      let attempts = 0

      const d = createDAG({
        id: 'exhaust-test',
        tasks: [
          createTaskNode({
            id: 'always-fails',
            execute: async () => {
              attempts++
              throw new Error('Always fails')
            },
            dependencies: [],
            retryPolicy: {
              maxAttempts: 3,
              backoff: { type: 'fixed', delay: 5 },
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('failed')
      expect(attempts).toBe(3) // Should try exactly maxAttempts times
      expect(run.taskResults.get('always-fails')?.status).toBe('failed')
      expect(run.taskResults.get('always-fails')?.attempts).toBe(3)
      expect(run.taskResults.get('always-fails')?.error?.message).toBe('Always fails')
    })

    it('should track attempt count in TaskResult', async () => {
      let attempts = 0

      const d = createDAG({
        id: 'attempt-count-test',
        tasks: [
          createTaskNode({
            id: 'retry-twice',
            execute: async () => {
              attempts++
              if (attempts < 3) throw new Error('Not yet')
              return 'done'
            },
            dependencies: [],
            retryPolicy: {
              maxAttempts: 5,
              backoff: { type: 'fixed', delay: 5 },
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(run.taskResults.get('retry-twice')?.attempts).toBe(3)
      expect(run.taskResults.get('retry-twice')?.status).toBe('success')
    })
  })
})

// ============================================================================
// STATE PERSISTENCE - TRACK TASK STATES ACROSS RESTARTS
// ============================================================================

describe('DAGStateStore', () => {
  let store: DAGStateStore

  beforeEach(() => {
    store = createInMemoryStateStore()
  })

  describe('saveRun and loadRun', () => {
    it('should save and load DAG run state', async () => {
      const state: DAGRunState = {
        runId: 'run-1',
        dagId: 'dag-1',
        status: 'running',
        taskResults: new Map([
          ['task-1', { taskId: 'task-1', status: 'success', output: 'result', attempts: 1 }],
        ]),
        startedAt: new Date(),
      }

      await store.saveRun('run-1', state)
      const loaded = await store.loadRun('run-1')

      expect(loaded).not.toBeNull()
      expect(loaded?.runId).toBe('run-1')
      expect(loaded?.dagId).toBe('dag-1')
      expect(loaded?.taskResults.get('task-1')?.output).toBe('result')
    })

    it('should return null for non-existent run', async () => {
      const loaded = await store.loadRun('nonexistent')
      expect(loaded).toBeNull()
    })

    it('should overwrite existing run state', async () => {
      const state1: DAGRunState = {
        runId: 'run-1',
        dagId: 'dag-1',
        status: 'running',
        taskResults: new Map(),
        startedAt: new Date(),
      }
      const state2: DAGRunState = {
        ...state1,
        status: 'completed',
        completedAt: new Date(),
      }

      await store.saveRun('run-1', state1)
      await store.saveRun('run-1', state2)
      const loaded = await store.loadRun('run-1')

      expect(loaded?.status).toBe('completed')
      expect(loaded?.completedAt).toBeDefined()
    })
  })

  describe('updateTask', () => {
    it('should update individual task result', async () => {
      const state: DAGRunState = {
        runId: 'run-1',
        dagId: 'dag-1',
        status: 'running',
        taskResults: new Map([
          ['task-1', { taskId: 'task-1', status: 'pending', attempts: 0 }],
        ]),
        startedAt: new Date(),
      }
      await store.saveRun('run-1', state)

      await store.updateTask('run-1', 'task-1', {
        taskId: 'task-1',
        status: 'success',
        output: 'result',
        attempts: 1,
        completedAt: new Date(),
      })

      const loaded = await store.loadRun('run-1')
      expect(loaded?.taskResults.get('task-1')?.status).toBe('success')
      expect(loaded?.taskResults.get('task-1')?.output).toBe('result')
    })

    it('should add new task result if not exists', async () => {
      const state: DAGRunState = {
        runId: 'run-1',
        dagId: 'dag-1',
        status: 'running',
        taskResults: new Map(),
        startedAt: new Date(),
      }
      await store.saveRun('run-1', state)

      await store.updateTask('run-1', 'task-1', {
        taskId: 'task-1',
        status: 'running',
        attempts: 1,
        startedAt: new Date(),
      })

      const loaded = await store.loadRun('run-1')
      expect(loaded?.taskResults.has('task-1')).toBe(true)
    })
  })

  describe('listRuns', () => {
    it('should list runs for a DAG', async () => {
      await store.saveRun('run-1', {
        runId: 'run-1',
        dagId: 'dag-1',
        status: 'completed',
        taskResults: new Map(),
        startedAt: new Date(),
      })
      await store.saveRun('run-2', {
        runId: 'run-2',
        dagId: 'dag-1',
        status: 'running',
        taskResults: new Map(),
        startedAt: new Date(),
      })
      await store.saveRun('run-3', {
        runId: 'run-3',
        dagId: 'dag-2',
        status: 'completed',
        taskResults: new Map(),
        startedAt: new Date(),
      })

      const runs = await store.listRuns('dag-1')
      expect(runs).toHaveLength(2)
      expect(runs.map((r) => r.runId)).toContain('run-1')
      expect(runs.map((r) => r.runId)).toContain('run-2')
    })

    it('should support limit option', async () => {
      for (let i = 0; i < 5; i++) {
        await store.saveRun(`run-${i}`, {
          runId: `run-${i}`,
          dagId: 'dag-1',
          status: 'completed',
          taskResults: new Map(),
          startedAt: new Date(),
        })
      }

      const runs = await store.listRuns('dag-1', { limit: 2 })
      expect(runs).toHaveLength(2)
    })

    it('should return empty array for unknown DAG', async () => {
      const runs = await store.listRuns('unknown-dag')
      expect(runs).toEqual([])
    })
  })

  describe('recovery', () => {
    it('should recover partially completed run', async () => {
      const state: DAGRunState = {
        runId: 'run-1',
        dagId: 'dag-1',
        status: 'running',
        taskResults: new Map([
          ['a', { taskId: 'a', status: 'success', output: 'a-result', attempts: 1 }],
          ['b', { taskId: 'b', status: 'running', attempts: 1 }],
        ]),
        startedAt: new Date(),
      }
      await store.saveRun('run-1', state)

      const loaded = await store.loadRun('run-1')
      const completedTasks = [...loaded!.taskResults.entries()]
        .filter(([_, r]) => r.status === 'success')
        .map(([id]) => id)

      expect(completedTasks).toEqual(['a'])
    })
  })
})

// ============================================================================
// CRON TRIGGER - SCHEDULE DAGs WITH CRON EXPRESSIONS
// ============================================================================

describe('CronTrigger', () => {
  describe('parseCronExpression', () => {
    it('should parse standard cron expression', () => {
      const parsed = parseCronExpression('0 9 * * MON')
      expect(parsed.minute).toBe(0)
      expect(parsed.hour).toBe(9)
      expect(parsed.dayOfMonth).toBe('*')
      expect(parsed.month).toBe('*')
      expect(parsed.dayOfWeek).toBe(1) // Monday
    })

    it('should parse cron with ranges', () => {
      const parsed = parseCronExpression('0 9-17 * * 1-5')
      expect(parsed.hour).toEqual({ start: 9, end: 17 })
      expect(parsed.dayOfWeek).toEqual({ start: 1, end: 5 })
    })

    it('should parse cron with steps', () => {
      const parsed = parseCronExpression('*/15 * * * *')
      expect(parsed.minute).toEqual({ step: 15 })
    })

    it('should reject invalid cron expression', () => {
      expect(() => parseCronExpression('invalid')).toThrow()
      expect(() => parseCronExpression('60 * * * *')).toThrow() // minute > 59
    })
  })

  describe('createCronTrigger', () => {
    it('should calculate next run time', () => {
      const trigger = createCronTrigger('0 9 * * *') // Every day at 9am
      const now = new Date('2026-01-12T08:00:00Z')
      const next = trigger.getNextRun(now)
      expect(next.getUTCHours()).toBe(9)
      expect(next.getUTCMinutes()).toBe(0)
    })

    it('should respect timezone', () => {
      const trigger = createCronTrigger('0 9 * * *', { timezone: 'America/New_York' })
      const now = new Date('2026-01-12T08:00:00Z')
      const next = trigger.getNextRun(now)
      // 9am EST is 14:00 UTC in January (EST is UTC-5)
      expect(next.getUTCHours()).toBe(14)
    })

    it('should handle catchup for missed runs', async () => {
      const trigger = createCronTrigger('0 * * * *', { catchup: true }) // Every hour
      const now = new Date('2026-01-12T12:30:00Z')
      const lastRun = new Date('2026-01-12T09:00:00Z')
      const missedRuns = trigger.getMissedRuns(lastRun, now)
      // Missed: 10:00, 11:00, 12:00
      expect(missedRuns).toHaveLength(3)
    })

    it('should not catchup when disabled', () => {
      const trigger = createCronTrigger('0 * * * *', { catchup: false })
      const now = new Date('2026-01-12T12:30:00Z')
      const lastRun = new Date('2026-01-12T09:00:00Z')
      const missedRuns = trigger.getMissedRuns(lastRun, now)
      expect(missedRuns).toHaveLength(0)
    })
  })

  describe('ScheduleTrigger types', () => {
    it('should support interval trigger', () => {
      const trigger: ScheduleTrigger = {
        type: 'interval',
        interval: 5 * 60 * 1000, // 5 minutes
      }
      expect(trigger.type).toBe('interval')
    })

    it('should support event trigger', () => {
      const trigger: ScheduleTrigger = {
        type: 'event',
        event: 'dag.complete',
        filter: { dagId: 'upstream-dag' },
      }
      expect(trigger.type).toBe('event')
    })
  })
})

// ============================================================================
// DYNAMIC TASKS - GENERATE TASKS AT RUNTIME
// ============================================================================

describe('DynamicTasks', () => {
  describe('fan-out pattern', () => {
    it('should expand dynamic tasks based on parent output', async () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'get-files',
            execute: async () => ['file1.csv', 'file2.csv', 'file3.csv'],
            dependencies: [],
          }),
          createTaskNode({
            id: 'process-files',
            execute: async () => {},
            dependencies: ['get-files'],
            dynamic: {
              expand: (files: string[]) =>
                files.map((file) =>
                  createTaskNode({
                    id: `process-${file}`,
                    execute: async () => `processed-${file}`,
                    dependencies: [],
                  })
                ),
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.taskResults.has('process-file1.csv')).toBe(true)
      expect(run.taskResults.has('process-file2.csv')).toBe(true)
      expect(run.taskResults.has('process-file3.csv')).toBe(true)
    })
  })

  describe('fan-in pattern', () => {
    it('should collect results from dynamic tasks', async () => {
      let collectedResults: unknown[]
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'generate',
            execute: async () => [1, 2, 3],
            dependencies: [],
          }),
          createTaskNode({
            id: 'process',
            execute: async () => {},
            dependencies: ['generate'],
            dynamic: {
              expand: (nums: number[]) =>
                nums.map((n) =>
                  createTaskNode({
                    id: `process-${n}`,
                    execute: async () => n * 2,
                    dependencies: [],
                  })
                ),
            },
          }),
          createTaskNode({
            id: 'collect',
            execute: async (ctx) => {
              collectedResults = ctx?.dynamicResults ?? []
              return collectedResults
            },
            dependencies: ['process'],
            collectDynamic: true,
          }),
        ],
      })

      const executor = createParallelExecutor()
      await executor.execute(d)

      expect(collectedResults!.sort()).toEqual([2, 4, 6])
    })
  })

  describe('conditional branching', () => {
    it('should generate tasks based on condition', async () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'check',
            execute: async () => ({ success: true, value: 42 }),
            dependencies: [],
          }),
          createTaskNode({
            id: 'branch',
            execute: async () => {},
            dependencies: ['check'],
            dynamic: {
              expand: (result: { success: boolean }) =>
                result.success
                  ? [
                      createTaskNode({
                        id: 'success-path',
                        execute: async () => 'success',
                        dependencies: [],
                      }),
                    ]
                  : [
                      createTaskNode({
                        id: 'failure-path',
                        execute: async () => 'failure',
                        dependencies: [],
                      }),
                    ],
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.taskResults.has('success-path')).toBe(true)
      expect(run.taskResults.has('failure-path')).toBe(false)
    })
  })

  describe('limits', () => {
    it('should limit maximum expanded tasks', async () => {
      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'generate',
            execute: async () => Array.from({ length: 1000 }, (_, i) => i),
            dependencies: [],
          }),
          createTaskNode({
            id: 'process',
            execute: async () => {},
            dependencies: ['generate'],
            dynamic: {
              expand: (nums: number[]) =>
                nums.map((n) =>
                  createTaskNode({
                    id: `task-${n}`,
                    execute: async () => n,
                    dependencies: [],
                  })
                ),
              maxExpansion: 100,
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      const expandedCount = [...run.taskResults.keys()].filter((k) =>
        k.startsWith('task-')
      ).length
      expect(expandedCount).toBe(100)
    })
  })
})

// ============================================================================
// CROSS-DAG DEPENDENCIES - DEPENDENCIES ACROSS DAG BOUNDARIES
// ============================================================================

describe('CrossDAGDependencies', () => {
  describe('DAG triggers', () => {
    it('should trigger DAG when another DAG completes', async () => {
      let dagBTriggered = false

      const dagA = createDAG({
        id: 'dag-a',
        tasks: [createSimpleTask('a')],
      })

      const dagB = createDAG({
        id: 'dag-b',
        tasks: [createSimpleTask('b')],
        triggers: [
          {
            type: 'dag-complete',
            source: { dagId: 'dag-a' },
          },
        ],
      })

      const executor = createParallelExecutor()

      // Register DAG-complete handler
      executor.onDAGComplete((dagId) => {
        if (dagId === 'dag-a') {
          dagBTriggered = true
          executor.execute(dagB)
        }
      })

      await executor.execute(dagA)
      await delay(10) // Allow trigger to fire

      expect(dagBTriggered).toBe(true)
    })

    it('should pass data between DAGs via payload', async () => {
      let receivedPayload: unknown

      const dagA = createDAG({
        id: 'dag-a',
        tasks: [
          createTaskNode({
            id: 'produce',
            execute: async () => ({ result: 'from-dag-a' }),
            dependencies: [],
          }),
        ],
      })

      const dagB = createDAG({
        id: 'dag-b',
        tasks: [
          createTaskNode({
            id: 'consume',
            execute: async (ctx) => {
              receivedPayload = ctx?.triggerPayload
            },
            dependencies: [],
          }),
        ],
        triggers: [
          {
            type: 'dag-complete',
            source: { dagId: 'dag-a' },
            payload: (result) => result.taskResults.get('produce')?.output,
          },
        ],
      })

      const executor = createParallelExecutor()

      executor.onDAGComplete(async (dagId, result) => {
        if (dagId === 'dag-a') {
          const trigger = dagB.triggers?.[0]
          const payload = trigger?.payload?.(result)
          await executor.execute(dagB, { triggerPayload: payload })
        }
      })

      await executor.execute(dagA)
      await delay(10)

      expect(receivedPayload).toEqual({ result: 'from-dag-a' })
    })
  })

  describe('Sensor', () => {
    it('should poll until condition is met', async () => {
      let counter = 0
      const sensor = createSensor({
        id: 'wait-for-condition',
        poke: async () => {
          counter++
          return counter >= 3
        },
        interval: 10,
        timeout: 1000,
      })

      const result = await sensor.wait()
      expect(result).toBe(true)
      expect(counter).toBe(3)
    })

    it('should timeout if condition never met', async () => {
      const sensor = createSensor({
        id: 'wait-forever',
        poke: async () => false,
        interval: 10,
        timeout: 50,
      })

      await expect(sensor.wait()).rejects.toThrow(/timeout/i)
    })

    it('should support sensor as task', async () => {
      let fileExists = false
      setTimeout(() => {
        fileExists = true
      }, 30)

      const d = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'wait-for-file',
            execute: async () => {
              const sensor = createSensor({
                id: 'file-sensor',
                poke: async () => fileExists,
                interval: 10,
                timeout: 1000,
              })
              return sensor.wait()
            },
            dependencies: [],
          }),
          createSimpleTask('process', ['wait-for-file']),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(run.taskResults.get('wait-for-file')?.status).toBe('success')
    })
  })

  describe('External dependencies', () => {
    it('should define external dependency', () => {
      const extDep: ExternalDependency = {
        dagId: 'upstream-dag',
        taskId: 'final-task',
        condition: 'success',
      }
      expect(extDep.dagId).toBe('upstream-dag')
    })

    it('should handle circular DAG dependencies', () => {
      // This should be detected and rejected
      const dagA: DAGTrigger = {
        type: 'dag-complete',
        source: { dagId: 'dag-b' },
      }
      const dagB: DAGTrigger = {
        type: 'dag-complete',
        source: { dagId: 'dag-a' },
      }

      // A depends on B, B depends on A - should detect cycle
      expect(() => {
        const dags = [
          createDAG({ id: 'dag-a', tasks: [], triggers: [dagA] }),
          createDAG({ id: 'dag-b', tasks: [], triggers: [dagB] }),
        ]
        // Validate cross-DAG dependencies
        validateDAGDependencies(dags)
      }).toThrow(/circular/i)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  describe('ETL Pipeline', () => {
    it('should execute extract -> transform -> load pipeline', async () => {
      const results: string[] = []

      const d = createDAG({
        id: 'etl-pipeline',
        tasks: [
          createTaskNode({
            id: 'extract-api',
            execute: async () => {
              results.push('extract-api')
              return { api: 'data' }
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'extract-db',
            execute: async () => {
              results.push('extract-db')
              return { db: 'data' }
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'transform',
            execute: async (ctx) => {
              results.push('transform')
              return { ...ctx?.upstreamResults }
            },
            dependencies: ['extract-api', 'extract-db'],
          }),
          createTaskNode({
            id: 'load',
            execute: async () => {
              results.push('load')
              return 'loaded'
            },
            dependencies: ['transform'],
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      // Extract tasks can be in any order, but must come before transform
      expect(results.indexOf('transform')).toBeGreaterThan(results.indexOf('extract-api'))
      expect(results.indexOf('transform')).toBeGreaterThan(results.indexOf('extract-db'))
      expect(results.indexOf('load')).toBeGreaterThan(results.indexOf('transform'))
    })
  })

  describe('Retry and Recovery', () => {
    it('should retry failed task and succeed', async () => {
      let attempts = 0

      const d = createDAG({
        id: 'retry-dag',
        tasks: [
          createTaskNode({
            id: 'flaky-task',
            execute: async () => {
              attempts++
              if (attempts < 3) throw new Error('Flaky failure')
              return 'success'
            },
            dependencies: [],
            retryPolicy: {
              maxAttempts: 3,
              backoff: { type: 'fixed', delay: 10 },
            },
          }),
        ],
      })

      const executor = createParallelExecutor()
      const run = await executor.execute(d)

      expect(run.status).toBe('completed')
      expect(run.taskResults.get('flaky-task')?.attempts).toBe(3)
    })

    it('should recover from checkpoint and resume', async () => {
      const store = createInMemoryStateStore()
      const executed: string[] = []

      // Simulate crash after task-1
      const checkpointState: DAGRunState = {
        runId: 'run-1',
        dagId: 'recovery-dag',
        status: 'running',
        taskResults: new Map([
          ['task-1', { taskId: 'task-1', status: 'success', output: 'result-1', attempts: 1 }],
          ['task-2', { taskId: 'task-2', status: 'running', attempts: 1 }],
        ]),
        startedAt: new Date(),
      }
      await store.saveRun('run-1', checkpointState)

      const d = createDAG({
        id: 'recovery-dag',
        tasks: [
          createTaskNode({
            id: 'task-1',
            execute: async () => {
              executed.push('task-1')
              return 'result-1'
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'task-2',
            execute: async () => {
              executed.push('task-2')
              return 'result-2'
            },
            dependencies: ['task-1'],
          }),
          createTaskNode({
            id: 'task-3',
            execute: async () => {
              executed.push('task-3')
              return 'result-3'
            },
            dependencies: ['task-2'],
          }),
        ],
      })

      const executor = createParallelExecutor({ stateStore: store })
      const run = await executor.resume('run-1', d)

      // Should NOT re-execute task-1 (already complete)
      expect(executed).not.toContain('task-1')
      // Should resume task-2 and continue to task-3
      expect(executed).toContain('task-2')
      expect(executed).toContain('task-3')
      expect(run.status).toBe('completed')
    })
  })

  describe('Large DAG', () => {
    it('should handle 100+ tasks efficiently', async () => {
      const taskCount = 100
      const tasks: TaskNode[] = []

      // Create chain of tasks
      for (let i = 0; i < taskCount; i++) {
        tasks.push(
          createTaskNode({
            id: `task-${i}`,
            execute: async () => i,
            dependencies: i > 0 ? [`task-${i - 1}`] : [],
          })
        )
      }

      const d = createDAG({ id: 'large-dag', tasks })
      const executor = createParallelExecutor()

      const start = Date.now()
      const run = await executor.execute(d)
      const duration = Date.now() - start

      expect(run.status).toBe('completed')
      expect(run.taskResults.size).toBe(taskCount)
      // Should complete in reasonable time (<5s)
      expect(duration).toBeLessThan(5000)
    })

    it('should handle wide parallel DAG', async () => {
      const parallelCount = 50
      const tasks: TaskNode[] = [createSimpleTask('start')]

      // Many parallel tasks
      for (let i = 0; i < parallelCount; i++) {
        tasks.push(
          createTaskNode({
            id: `parallel-${i}`,
            execute: async () => {
              await delay(10)
              return i
            },
            dependencies: ['start'],
          })
        )
      }

      // Final task depends on all parallel
      tasks.push(
        createTaskNode({
          id: 'end',
          execute: async () => 'done',
          dependencies: Array.from({ length: parallelCount }, (_, i) => `parallel-${i}`),
        })
      )

      const d = createDAG({ id: 'wide-dag', tasks })
      const executor = createParallelExecutor({ maxConcurrency: 10 })

      const start = Date.now()
      const run = await executor.execute(d)
      const duration = Date.now() - start

      expect(run.status).toBe('completed')
      // With concurrency 10 and 50 parallel tasks @ 10ms each, should take ~50ms
      expect(duration).toBeLessThan(200)
    })
  })
})

// Helper function for cross-DAG validation
function validateDAGDependencies(dags: DAG[]): void {
  const dagMap = new Map(dags.map((d) => [d.id, d]))
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  function detectCycle(dagId: string): boolean {
    visited.add(dagId)
    recursionStack.add(dagId)

    const dag = dagMap.get(dagId)
    for (const trigger of dag?.triggers ?? []) {
      if (trigger.type === 'dag-complete') {
        const depId = trigger.source.dagId
        if (!visited.has(depId)) {
          if (detectCycle(depId)) return true
        } else if (recursionStack.has(depId)) {
          return true
        }
      }
    }

    recursionStack.delete(dagId)
    return false
  }

  for (const dag of dags) {
    if (!visited.has(dag.id)) {
      if (detectCycle(dag.id)) {
        throw new Error('Circular DAG dependency detected')
      }
    }
  }
}
