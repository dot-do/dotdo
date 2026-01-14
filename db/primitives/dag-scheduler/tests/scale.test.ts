/**
 * DAG Scheduler Scale Tests (1000+ Tasks)
 *
 * Prototype tests to verify DAGScheduler performance at scale.
 * Part of spike dotdo-d5fq7: DAG state at scale.
 *
 * Tests cover:
 * - DAG creation with 1000 tasks
 * - State read/write performance
 * - Concurrent task updates
 * - Memory footprint validation
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDAG,
  createTaskNode,
  createParallelExecutor,
  createInMemoryStateStore,
  type TaskNode,
  type DAGStateStore,
  type DAGRunState,
} from '../index'

// ============================================================================
// TEST HELPERS
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createChainedTasks(count: number): TaskNode[] {
  return Array.from({ length: count }, (_, i) =>
    createTaskNode({
      id: `task-${i}`,
      execute: async () => i,
      dependencies: i > 0 ? [`task-${i - 1}`] : [],
    })
  )
}

function createParallelTasks(count: number, rootId: string = 'root'): TaskNode[] {
  const root = createTaskNode({
    id: rootId,
    execute: async () => 'start',
    dependencies: [],
  })

  const parallel = Array.from({ length: count }, (_, i) =>
    createTaskNode({
      id: `parallel-${i}`,
      execute: async () => i,
      dependencies: [rootId],
    })
  )

  const final = createTaskNode({
    id: 'final',
    execute: async () => 'done',
    dependencies: parallel.map((t) => t.id),
  })

  return [root, ...parallel, final]
}

function createDiamondTasks(width: number, depth: number): TaskNode[] {
  const tasks: TaskNode[] = []

  // Root
  tasks.push(
    createTaskNode({
      id: 'root',
      execute: async () => 'root',
      dependencies: [],
    })
  )

  // Create layers
  let previousLayer: string[] = ['root']
  for (let layer = 0; layer < depth; layer++) {
    const currentLayer: string[] = []
    for (let i = 0; i < width; i++) {
      const taskId = `layer-${layer}-task-${i}`
      currentLayer.push(taskId)
      tasks.push(
        createTaskNode({
          id: taskId,
          execute: async () => `${taskId}`,
          dependencies: previousLayer,
        })
      )
    }
    previousLayer = currentLayer
  }

  // Final convergence
  tasks.push(
    createTaskNode({
      id: 'final',
      execute: async () => 'done',
      dependencies: previousLayer,
    })
  )

  return tasks
}

// ============================================================================
// SCALE TESTS - DAG CREATION
// ============================================================================

describe('DAGScheduler at Scale - Creation', () => {
  it('should create a 1000-task chain DAG in <100ms', () => {
    const start = performance.now()
    const tasks = createChainedTasks(1000)
    const dag = createDAG({ id: 'scale-chain', tasks })
    const duration = performance.now() - start

    expect(dag.tasks.size).toBe(1000)
    expect(duration).toBeLessThan(100)
  })

  it('should create a 1000-task parallel DAG in <100ms', () => {
    const start = performance.now()
    const tasks = createParallelTasks(1000)
    const dag = createDAG({ id: 'scale-parallel', tasks })
    const duration = performance.now() - start

    expect(dag.tasks.size).toBe(1002) // root + 1000 parallel + final
    expect(duration).toBeLessThan(100)
  })

  it('should create a diamond DAG (10 wide x 100 deep) in <200ms', () => {
    const start = performance.now()
    const tasks = createDiamondTasks(10, 100)
    const dag = createDAG({ id: 'scale-diamond', tasks })
    const duration = performance.now() - start

    // root + (10 * 100 layers) + final = 1002 tasks
    expect(dag.tasks.size).toBe(1002)
    expect(duration).toBeLessThan(200)
  })

  it('should validate 1000-task DAG dependencies efficiently', () => {
    const tasks = createChainedTasks(1000)

    const start = performance.now()
    // createDAG validates dependencies and detects cycles
    const dag = createDAG({ id: 'validate-test', tasks })
    const duration = performance.now() - start

    expect(dag.tasks.size).toBe(1000)
    // Validation should complete in reasonable time
    expect(duration).toBeLessThan(100)
  })
})

// ============================================================================
// SCALE TESTS - EXECUTION
// ============================================================================

describe('DAGScheduler at Scale - Execution', () => {
  it('should execute 1000-task chain with concurrency 1', async () => {
    const tasks = createChainedTasks(1000)
    const dag = createDAG({ id: 'exec-chain', tasks })
    const executor = createParallelExecutor({ maxConcurrency: 1 })

    const start = performance.now()
    const run = await executor.execute(dag)
    const duration = performance.now() - start

    expect(run.status).toBe('completed')
    expect(run.taskResults.size).toBe(1000)
    // Chain execution at concurrency 1 should still complete in reasonable time
    expect(duration).toBeLessThan(5000)
  })

  it('should execute 1000 parallel tasks with concurrency 50', async () => {
    const tasks = createParallelTasks(1000)
    const dag = createDAG({ id: 'exec-parallel', tasks })
    const executor = createParallelExecutor({ maxConcurrency: 50 })

    const start = performance.now()
    const run = await executor.execute(dag)
    const duration = performance.now() - start

    expect(run.status).toBe('completed')
    expect(run.taskResults.size).toBe(1002) // root + 1000 + final
    // Should leverage parallelism effectively
    expect(duration).toBeLessThan(5000)
  })

  it('should execute diamond DAG (10x100) with concurrency 10', async () => {
    const tasks = createDiamondTasks(10, 100)
    const dag = createDAG({ id: 'exec-diamond', tasks })
    const executor = createParallelExecutor({ maxConcurrency: 10 })

    const start = performance.now()
    const run = await executor.execute(dag)
    const duration = performance.now() - start

    expect(run.status).toBe('completed')
    expect(run.taskResults.size).toBe(1002)
    expect(duration).toBeLessThan(10000)
  })

  it('should track max concurrent tasks correctly at scale', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const maxConcurrency = 50

    const tasks = [
      createTaskNode({
        id: 'root',
        execute: async () => 'start',
        dependencies: [],
      }),
      ...Array.from({ length: 200 }, (_, i) =>
        createTaskNode({
          id: `task-${i}`,
          execute: async () => {
            concurrent++
            maxConcurrent = Math.max(maxConcurrent, concurrent)
            await delay(1) // Small delay to allow overlap
            concurrent--
            return i
          },
          dependencies: ['root'],
        })
      ),
    ]

    const dag = createDAG({ id: 'concurrency-test', tasks })
    const executor = createParallelExecutor({ maxConcurrency })

    await executor.execute(dag)

    expect(maxConcurrent).toBeLessThanOrEqual(maxConcurrency)
    expect(maxConcurrent).toBeGreaterThan(1) // Verify parallelism occurred
  })
})

// ============================================================================
// SCALE TESTS - STATE PERSISTENCE
// ============================================================================

describe('DAGScheduler at Scale - State Persistence', () => {
  let store: DAGStateStore

  beforeEach(() => {
    store = createInMemoryStateStore()
  })

  it('should save and load 1000-task run state efficiently', async () => {
    const taskResults = new Map<string, { taskId: string; status: 'success'; output: number; attempts: number }>()
    for (let i = 0; i < 1000; i++) {
      taskResults.set(`task-${i}`, {
        taskId: `task-${i}`,
        status: 'success',
        output: i,
        attempts: 1,
      })
    }

    const state: DAGRunState = {
      runId: 'run-1000',
      dagId: 'scale-dag',
      status: 'completed',
      taskResults,
      startedAt: new Date(),
      completedAt: new Date(),
    }

    // Save
    const saveStart = performance.now()
    await store.saveRun('run-1000', state)
    const saveDuration = performance.now() - saveStart

    // Load
    const loadStart = performance.now()
    const loaded = await store.loadRun('run-1000')
    const loadDuration = performance.now() - loadStart

    expect(loaded).not.toBeNull()
    expect(loaded!.taskResults.size).toBe(1000)
    expect(saveDuration).toBeLessThan(50)
    expect(loadDuration).toBeLessThan(50)
  })

  it('should handle rapid task status updates at scale', async () => {
    // Create initial state
    const taskResults = new Map<string, { taskId: string; status: 'pending'; attempts: number }>()
    for (let i = 0; i < 500; i++) {
      taskResults.set(`task-${i}`, {
        taskId: `task-${i}`,
        status: 'pending',
        attempts: 0,
      })
    }

    const state: DAGRunState = {
      runId: 'run-updates',
      dagId: 'update-dag',
      status: 'running',
      taskResults,
      startedAt: new Date(),
    }
    await store.saveRun('run-updates', state)

    // Perform 500 individual task updates
    const updateStart = performance.now()
    for (let i = 0; i < 500; i++) {
      await store.updateTask('run-updates', `task-${i}`, {
        taskId: `task-${i}`,
        status: 'success',
        output: i * 2,
        attempts: 1,
        completedAt: new Date(),
      })
    }
    const updateDuration = performance.now() - updateStart

    // Verify all updates
    const loaded = await store.loadRun('run-updates')
    const successCount = [...loaded!.taskResults.values()].filter((r) => r.status === 'success').length
    expect(successCount).toBe(500)
    // 500 updates should complete in reasonable time
    expect(updateDuration).toBeLessThan(500)
  })

  it('should list multiple runs efficiently', async () => {
    // Create 100 runs
    for (let i = 0; i < 100; i++) {
      const taskResults = new Map<string, { taskId: string; status: 'success'; attempts: number }>()
      taskResults.set('task-0', { taskId: 'task-0', status: 'success', attempts: 1 })

      await store.saveRun(`run-${i}`, {
        runId: `run-${i}`,
        dagId: 'list-dag',
        status: 'completed',
        taskResults,
        startedAt: new Date(),
      })
    }

    const listStart = performance.now()
    const runs = await store.listRuns('list-dag')
    const listDuration = performance.now() - listStart

    expect(runs.length).toBe(100)
    expect(listDuration).toBeLessThan(50)
  })
})

// ============================================================================
// SCALE TESTS - CONCURRENT OPERATIONS
// ============================================================================

describe('DAGScheduler at Scale - Concurrent Operations', () => {
  it('should handle concurrent DAG executions', async () => {
    const executor1 = createParallelExecutor({ maxConcurrency: 10 })
    const executor2 = createParallelExecutor({ maxConcurrency: 10 })
    const executor3 = createParallelExecutor({ maxConcurrency: 10 })

    const tasks = createChainedTasks(100)
    const dag1 = createDAG({ id: 'concurrent-1', tasks })
    const dag2 = createDAG({ id: 'concurrent-2', tasks: createChainedTasks(100) })
    const dag3 = createDAG({ id: 'concurrent-3', tasks: createChainedTasks(100) })

    const start = performance.now()
    const [run1, run2, run3] = await Promise.all([
      executor1.execute(dag1),
      executor2.execute(dag2),
      executor3.execute(dag3),
    ])
    const duration = performance.now() - start

    expect(run1.status).toBe('completed')
    expect(run2.status).toBe('completed')
    expect(run3.status).toBe('completed')
    // Concurrent execution should complete faster than sequential
    expect(duration).toBeLessThan(5000)
  })

  it('should handle concurrent state store operations', async () => {
    const store = createInMemoryStateStore()

    // Create multiple concurrent state operations
    const operations: Promise<void>[] = []
    for (let i = 0; i < 100; i++) {
      const taskResults = new Map<string, { taskId: string; status: 'success'; attempts: number }>()
      taskResults.set('task', { taskId: 'task', status: 'success', attempts: 1 })

      operations.push(
        store.saveRun(`concurrent-run-${i}`, {
          runId: `concurrent-run-${i}`,
          dagId: 'concurrent-dag',
          status: 'completed',
          taskResults,
          startedAt: new Date(),
        })
      )
    }

    const start = performance.now()
    await Promise.all(operations)
    const duration = performance.now() - start

    // 100 concurrent saves should complete quickly
    expect(duration).toBeLessThan(100)

    // Verify all were saved
    const runs = await store.listRuns('concurrent-dag')
    expect(runs.length).toBe(100)
  })
})

// ============================================================================
// SCALE TESTS - MEMORY FOOTPRINT
// ============================================================================

describe('DAGScheduler at Scale - Memory Footprint', () => {
  it('should estimate memory footprint for 1000-task DAG', () => {
    const tasks = createChainedTasks(1000)
    const dag = createDAG({ id: 'memory-test', tasks })

    // Rough estimate: each TaskNode contains id, execute fn, deps array
    // Expected ~1-2 KB per task based on SCALE_FINDINGS.md
    // We can't directly measure memory in JS, but we can verify structure
    expect(dag.tasks.size).toBe(1000)

    // Count total dependencies in DAG
    let totalDeps = 0
    for (const [_, task] of dag.tasks) {
      totalDeps += task.dependencies.length
    }
    expect(totalDeps).toBe(999) // Chain has 999 deps (each task depends on previous)
  })

  it('should handle DAG with high dependency count per task', () => {
    // Create a DAG where final task depends on 500 tasks
    const tasks: TaskNode[] = []
    const depIds: string[] = []

    for (let i = 0; i < 500; i++) {
      const id = `producer-${i}`
      depIds.push(id)
      tasks.push(
        createTaskNode({
          id,
          execute: async () => i,
          dependencies: [],
        })
      )
    }

    tasks.push(
      createTaskNode({
        id: 'consumer',
        execute: async () => 'done',
        dependencies: depIds,
      })
    )

    const start = performance.now()
    const dag = createDAG({ id: 'high-deps', tasks })
    const duration = performance.now() - start

    expect(dag.tasks.size).toBe(501)
    expect(dag.tasks.get('consumer')?.dependencies.length).toBe(500)
    expect(duration).toBeLessThan(50)
  })
})

// ============================================================================
// SCALE TESTS - EDGE CASES
// ============================================================================

describe('DAGScheduler at Scale - Edge Cases', () => {
  it('should handle empty DAG', () => {
    const dag = createDAG({ id: 'empty', tasks: [] })
    expect(dag.tasks.size).toBe(0)
  })

  it('should handle single task DAG at scale repetition', async () => {
    // Execute single-task DAGs many times
    const executor = createParallelExecutor()
    const results: boolean[] = []

    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      const dag = createDAG({
        id: `single-${i}`,
        tasks: [createTaskNode({ id: 'task', execute: async () => i, dependencies: [] })],
      })
      const run = await executor.execute(dag)
      results.push(run.status === 'completed')
    }
    const duration = performance.now() - start

    expect(results.every((r) => r)).toBe(true)
    expect(duration).toBeLessThan(2000)
  })

  it('should handle DAG with long task IDs', () => {
    const longId = 'a'.repeat(1000)
    const tasks = [
      createTaskNode({
        id: longId,
        execute: async () => 'done',
        dependencies: [],
      }),
      createTaskNode({
        id: `depends-on-${longId}`,
        execute: async () => 'also done',
        dependencies: [longId],
      }),
    ]

    const dag = createDAG({ id: 'long-ids', tasks })
    expect(dag.tasks.size).toBe(2)
    expect(dag.tasks.get(longId)).toBeDefined()
  })
})
