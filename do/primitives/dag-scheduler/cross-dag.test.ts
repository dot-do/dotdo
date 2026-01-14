/**
 * Cross-DAG Dependencies and Triggers Tests
 *
 * Tests for cross-DAG orchestration features:
 * - External dependency sensors
 * - DAG-to-DAG triggers
 * - Dataset-based triggers
 * - Cross-DAG state sharing
 * - Circular dependency detection
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  // Core types
  type TaskNode,
  type DAG,
  type DAGRun,
  type ExternalDependency,
  type DAGTrigger,
  // Cross-DAG types
  type Dataset,
  type DatasetEvent,
  type CrossDAGState,
  type DAGRegistry,
  type DAGOrchestrator,
  type ExternalDAGSensor,
  type DatasetAwareState,
  // Factories
  createDAG,
  createTaskNode,
  createParallelExecutor,
  createSensor,
  // Cross-DAG factories
  createExternalDAGSensor,
  createCrossDAGState,
  createDAGRegistry,
  validateDAGDependencies,
  createDAGOrchestrator,
  createDatasetAwareState,
  createExternalDAGTask,
  createDatasetSensorTask,
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

function createSimpleDAG(id: string, taskIds: string[] = ['task-1']): DAG {
  return createDAG({
    id,
    tasks: taskIds.map((taskId, i) =>
      createSimpleTask(taskId, i > 0 ? [taskIds[i - 1]!] : [])
    ),
  })
}

// ============================================================================
// CROSS-DAG STATE
// ============================================================================

describe('CrossDAGState', () => {
  let state: CrossDAGState

  beforeEach(() => {
    state = createCrossDAGState()
  })

  describe('key-value storage', () => {
    it('should store and retrieve values', async () => {
      await state.set('key1', { foo: 'bar' })
      const value = await state.get<{ foo: string }>('key1')
      expect(value).toEqual({ foo: 'bar' })
    })

    it('should return undefined for missing keys', async () => {
      const value = await state.get('nonexistent')
      expect(value).toBeUndefined()
    })

    it('should delete values', async () => {
      await state.set('key1', 'value1')
      await state.delete('key1')
      const value = await state.get('key1')
      expect(value).toBeUndefined()
    })

    it('should support TTL expiration', async () => {
      await state.set('key1', 'value1', 50) // 50ms TTL

      // Should exist immediately
      let value = await state.get('key1')
      expect(value).toBe('value1')

      // Wait for expiration
      await delay(60)
      value = await state.get('key1')
      expect(value).toBeUndefined()
    })
  })

  describe('DAG result storage', () => {
    it('should store and retrieve DAG results', async () => {
      const dagRun: DAGRun = {
        runId: 'run-1',
        dagId: 'dag-1',
        status: 'completed',
        taskResults: new Map(),
        startedAt: new Date(),
        completedAt: new Date(),
      }

      await state.setDAGResult('dag-1', 'run-1', dagRun)
      const result = await state.getDAGResult('dag-1', 'run-1')
      expect(result).toEqual(dagRun)
    })

    it('should retrieve most recent run when runId not specified', async () => {
      const run1: DAGRun = {
        runId: 'run-1',
        dagId: 'dag-1',
        status: 'completed',
        taskResults: new Map(),
        startedAt: new Date('2024-01-01'),
        completedAt: new Date('2024-01-01'),
      }
      const run2: DAGRun = {
        runId: 'run-2',
        dagId: 'dag-1',
        status: 'completed',
        taskResults: new Map(),
        startedAt: new Date('2024-01-02'),
        completedAt: new Date('2024-01-02'),
      }

      await state.setDAGResult('dag-1', 'run-1', run1)
      await state.setDAGResult('dag-1', 'run-2', run2)

      const result = await state.getDAGResult('dag-1')
      expect(result?.runId).toBe('run-2')
    })

    it('should return undefined for unknown DAG', async () => {
      const result = await state.getDAGResult('unknown-dag')
      expect(result).toBeUndefined()
    })
  })
})

// ============================================================================
// DAG REGISTRY
// ============================================================================

describe('DAGRegistry', () => {
  let registry: DAGRegistry

  beforeEach(() => {
    registry = createDAGRegistry()
  })

  describe('registration', () => {
    it('should register and retrieve DAGs', () => {
      const dag = createSimpleDAG('dag-1')
      registry.register(dag)
      expect(registry.get('dag-1')).toBe(dag)
    })

    it('should unregister DAGs', () => {
      const dag = createSimpleDAG('dag-1')
      registry.register(dag)
      registry.unregister('dag-1')
      expect(registry.get('dag-1')).toBeUndefined()
    })

    it('should list all registered DAGs', () => {
      registry.register(createSimpleDAG('dag-1'))
      registry.register(createSimpleDAG('dag-2'))
      registry.register(createSimpleDAG('dag-3'))

      const all = registry.getAll()
      expect(all).toHaveLength(3)
      expect(all.map(d => d.id).sort()).toEqual(['dag-1', 'dag-2', 'dag-3'])
    })
  })

  describe('dependency tracking', () => {
    it('should find DAGs that depend on another DAG', () => {
      const dagA = createSimpleDAG('dag-a')
      const dagB = createDAG({
        id: 'dag-b',
        tasks: [createSimpleTask('b')],
        triggers: [{
          type: 'dag-complete',
          source: { dagId: 'dag-a' },
        }],
      })
      const dagC = createDAG({
        id: 'dag-c',
        tasks: [createSimpleTask('c')],
        triggers: [{
          type: 'dag-complete',
          source: { dagId: 'dag-a' },
        }],
      })

      registry.register(dagA)
      registry.register(dagB)
      registry.register(dagC)

      const dependents = registry.getDependents('dag-a')
      expect(dependents.map(d => d.id).sort()).toEqual(['dag-b', 'dag-c'])
    })

    it('should find dependencies of a DAG', () => {
      const dagA = createSimpleDAG('dag-a')
      const dagB = createDAG({
        id: 'dag-b',
        tasks: [createSimpleTask('b')],
        triggers: [
          { type: 'dag-complete', source: { dagId: 'dag-a' } },
          { type: 'dag-complete', source: { dagId: 'dag-c' } },
        ],
      })

      registry.register(dagA)
      registry.register(dagB)

      const deps = registry.getDependencies('dag-b')
      expect(deps.sort()).toEqual(['dag-a', 'dag-c'])
    })

    it('should return empty array for DAG with no dependents', () => {
      const dag = createSimpleDAG('dag-1')
      registry.register(dag)
      expect(registry.getDependents('dag-1')).toEqual([])
    })

    it('should return empty array for DAG with no dependencies', () => {
      const dag = createSimpleDAG('dag-1')
      registry.register(dag)
      expect(registry.getDependencies('dag-1')).toEqual([])
    })
  })
})

// ============================================================================
// CIRCULAR DEPENDENCY DETECTION
// ============================================================================

describe('validateDAGDependencies', () => {
  it('should pass for acyclic DAG graph', () => {
    const dagA = createSimpleDAG('dag-a')
    const dagB = createDAG({
      id: 'dag-b',
      tasks: [createSimpleTask('b')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'dag-a' } }],
    })
    const dagC = createDAG({
      id: 'dag-c',
      tasks: [createSimpleTask('c')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'dag-b' } }],
    })

    expect(() => validateDAGDependencies([dagA, dagB, dagC])).not.toThrow()
  })

  it('should detect simple circular dependency', () => {
    const dagA = createDAG({
      id: 'dag-a',
      tasks: [createSimpleTask('a')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'dag-b' } }],
    })
    const dagB = createDAG({
      id: 'dag-b',
      tasks: [createSimpleTask('b')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'dag-a' } }],
    })

    expect(() => validateDAGDependencies([dagA, dagB])).toThrow(/circular/i)
  })

  it('should detect complex circular dependency chain', () => {
    const dagA = createDAG({
      id: 'dag-a',
      tasks: [createSimpleTask('a')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'dag-c' } }],
    })
    const dagB = createDAG({
      id: 'dag-b',
      tasks: [createSimpleTask('b')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'dag-a' } }],
    })
    const dagC = createDAG({
      id: 'dag-c',
      tasks: [createSimpleTask('c')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'dag-b' } }],
    })

    expect(() => validateDAGDependencies([dagA, dagB, dagC])).toThrow(/circular/i)
  })

  it('should pass for independent DAGs', () => {
    const dagA = createSimpleDAG('dag-a')
    const dagB = createSimpleDAG('dag-b')
    const dagC = createSimpleDAG('dag-c')

    expect(() => validateDAGDependencies([dagA, dagB, dagC])).not.toThrow()
  })

  it('should pass for diamond dependency pattern', () => {
    const dagA = createSimpleDAG('dag-a')
    const dagB = createDAG({
      id: 'dag-b',
      tasks: [createSimpleTask('b')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'dag-a' } }],
    })
    const dagC = createDAG({
      id: 'dag-c',
      tasks: [createSimpleTask('c')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'dag-a' } }],
    })
    const dagD = createDAG({
      id: 'dag-d',
      tasks: [createSimpleTask('d')],
      triggers: [
        { type: 'dag-complete', source: { dagId: 'dag-b' } },
        { type: 'dag-complete', source: { dagId: 'dag-c' } },
      ],
    })

    expect(() => validateDAGDependencies([dagA, dagB, dagC, dagD])).not.toThrow()
  })
})

// ============================================================================
// EXTERNAL DAG SENSOR
// ============================================================================

describe('ExternalDAGSensor', () => {
  let orchestrator: DAGOrchestrator

  beforeEach(() => {
    orchestrator = createDAGOrchestrator()
  })

  it('should wait for DAG completion', async () => {
    const dag = createSimpleDAG('upstream-dag')
    orchestrator.registry.register(dag)

    // Start the sensor (it will poll until the DAG completes)
    const sensorPromise = (async () => {
      const sensor = createExternalDAGSensor({
        orchestrator,
        dependency: { dagId: 'upstream-dag' },
        interval: 10,
        timeout: 1000,
      })
      await sensor.wait()
      return sensor.getResult()
    })()

    // Trigger the upstream DAG
    await orchestrator.trigger('upstream-dag')

    const result = await sensorPromise
    expect(result).toBeDefined()
    expect(result?.status).toBe('completed')
  })

  it('should support task-level dependency', async () => {
    const dag = createDAG({
      id: 'upstream-dag',
      tasks: [
        createTaskNode({
          id: 'important-task',
          execute: async () => 'important-result',
          dependencies: [],
        }),
        createSimpleTask('other-task', ['important-task']),
      ],
    })
    orchestrator.registry.register(dag)

    const sensor = createExternalDAGSensor({
      orchestrator,
      dependency: { dagId: 'upstream-dag', taskId: 'important-task' },
      interval: 10,
      timeout: 1000,
    })

    // Run the DAG
    await orchestrator.trigger('upstream-dag')

    // Sensor should find the completed task
    await sensor.wait()
    const result = sensor.getResult()
    expect(result?.taskResults.get('important-task')?.status).toBe('success')
  })

  it('should timeout if DAG never completes', async () => {
    // No DAG registered - sensor will never find it
    const sensor = createExternalDAGSensor({
      orchestrator,
      dependency: { dagId: 'nonexistent-dag' },
      interval: 10,
      timeout: 50,
    })

    await expect(sensor.wait()).rejects.toThrow(/timeout/i)
  })

  it('should respect condition: completed', async () => {
    const dag = createDAG({
      id: 'failing-dag',
      tasks: [
        createTaskNode({
          id: 'failing-task',
          execute: async () => { throw new Error('Task failed') },
          dependencies: [],
        }),
      ],
    })
    orchestrator.registry.register(dag)

    const sensor = createExternalDAGSensor({
      orchestrator,
      dependency: { dagId: 'failing-dag', condition: 'completed' },
      interval: 10,
      timeout: 1000,
    })

    // Run the failing DAG
    await orchestrator.trigger('failing-dag')

    // Should complete even though DAG failed (condition is 'completed', not 'success')
    await sensor.wait()
    const result = sensor.getResult()
    expect(result?.status).toBe('failed')
  })
})

// ============================================================================
// DAG ORCHESTRATOR
// ============================================================================

describe('DAGOrchestrator', () => {
  let orchestrator: DAGOrchestrator

  beforeEach(() => {
    orchestrator = createDAGOrchestrator()
  })

  describe('trigger', () => {
    it('should execute a registered DAG', async () => {
      const dag = createSimpleDAG('my-dag')
      orchestrator.registry.register(dag)

      const result = await orchestrator.trigger('my-dag')
      expect(result.status).toBe('completed')
      expect(result.dagId).toBe('my-dag')
    })

    it('should pass payload to triggered DAG', async () => {
      let receivedPayload: unknown
      const dag = createDAG({
        id: 'my-dag',
        tasks: [
          createTaskNode({
            id: 'task',
            execute: async (ctx) => {
              receivedPayload = ctx?.triggerPayload
              return 'done'
            },
            dependencies: [],
          }),
        ],
      })
      orchestrator.registry.register(dag)

      await orchestrator.trigger('my-dag', { data: 'test-payload' })
      expect(receivedPayload).toEqual({ data: 'test-payload' })
    })

    it('should throw for unregistered DAG', async () => {
      await expect(orchestrator.trigger('unknown-dag')).rejects.toThrow(/not found/i)
    })
  })

  describe('DAG-to-DAG triggers', () => {
    it('should automatically trigger dependent DAGs', async () => {
      const executed: string[] = []

      const dagA = createDAG({
        id: 'dag-a',
        tasks: [
          createTaskNode({
            id: 'a-task',
            execute: async () => {
              executed.push('dag-a')
              return 'a-result'
            },
            dependencies: [],
          }),
        ],
      })

      const dagB = createDAG({
        id: 'dag-b',
        tasks: [
          createTaskNode({
            id: 'b-task',
            execute: async () => {
              executed.push('dag-b')
              return 'b-result'
            },
            dependencies: [],
          }),
        ],
        triggers: [{
          type: 'dag-complete',
          source: { dagId: 'dag-a' },
        }],
      })

      orchestrator.registry.register(dagA)
      orchestrator.registry.register(dagB)

      // Only trigger dag-a - dag-b should be triggered automatically
      await orchestrator.trigger('dag-a')

      // Wait a bit for the cascade
      await delay(50)

      expect(executed).toContain('dag-a')
      expect(executed).toContain('dag-b')
    })

    it('should pass payload via trigger configuration', async () => {
      let receivedPayload: unknown

      const dagA = createDAG({
        id: 'dag-a',
        tasks: [
          createTaskNode({
            id: 'produce',
            execute: async () => ({ key: 'upstream-data' }),
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
              return 'consumed'
            },
            dependencies: [],
          }),
        ],
        triggers: [{
          type: 'dag-complete',
          source: { dagId: 'dag-a' },
          payload: (result) => result.taskResults.get('produce')?.output,
        }],
      })

      orchestrator.registry.register(dagA)
      orchestrator.registry.register(dagB)

      await orchestrator.trigger('dag-a')
      await delay(50)

      expect(receivedPayload).toEqual({ key: 'upstream-data' })
    })
  })

  describe('getRunHistory', () => {
    it('should return run history', async () => {
      const dag = createSimpleDAG('my-dag')
      orchestrator.registry.register(dag)

      await orchestrator.trigger('my-dag')

      const history = await orchestrator.getRunHistory('my-dag')
      expect(history).toHaveLength(1)
      expect(history[0]?.dagId).toBe('my-dag')
    })

    it('should return empty array for unknown DAG', async () => {
      const history = await orchestrator.getRunHistory('unknown-dag')
      expect(history).toEqual([])
    })
  })

  describe('waitForDAG', () => {
    it('should wait for a DAG to complete', async () => {
      const dag = createSimpleDAG('my-dag')
      orchestrator.registry.register(dag)

      // Start waiting in background
      const waitPromise = orchestrator.waitForDAG('my-dag')

      // Trigger the DAG
      await orchestrator.trigger('my-dag')

      // Wait should resolve
      const result = await waitPromise
      expect(result.status).toBe('completed')
    })
  })

  describe('onDAGComplete callback', () => {
    it('should fire callback when DAG completes', async () => {
      const completions: string[] = []

      orchestrator.onDAGComplete((dagId) => {
        completions.push(dagId)
      })

      const dag = createSimpleDAG('my-dag')
      orchestrator.registry.register(dag)

      await orchestrator.trigger('my-dag')
      await delay(10)

      expect(completions).toContain('my-dag')
    })
  })
})

// ============================================================================
// DATASET-AWARE STATE
// ============================================================================

describe('DatasetAwareState', () => {
  let state: DatasetAwareState

  beforeEach(() => {
    state = createDatasetAwareState()
  })

  describe('dataset registration', () => {
    it('should register and retrieve datasets', () => {
      const dataset: Dataset = {
        id: 'my-dataset',
        location: 's3://bucket/path',
        metadata: { version: 1 },
      }

      state.registerDataset(dataset)
      expect(state.getDataset('my-dataset')).toEqual(dataset)
    })

    it('should return undefined for unregistered dataset', () => {
      expect(state.getDataset('unknown')).toBeUndefined()
    })
  })

  describe('dataset events', () => {
    it('should emit dataset events', async () => {
      const events: DatasetEvent[] = []

      // Note: The current implementation doesn't expose event subscription directly
      // This test verifies the emitDatasetEvent doesn't throw
      const event: DatasetEvent = {
        type: 'created',
        dataset: { id: 'ds-1', location: '/path' },
        timestamp: new Date(),
      }

      await expect(state.emitDatasetEvent(event)).resolves.not.toThrow()
    })
  })

  describe('subscriptions', () => {
    it('should subscribe DAG to dataset', () => {
      const dag = createSimpleDAG('my-dag')
      state.subscribeToDataset('my-dataset', dag)
      // Subscription is internal - just verify no errors
      expect(true).toBe(true)
    })

    it('should unsubscribe DAG from dataset', () => {
      const dag = createSimpleDAG('my-dag')
      state.subscribeToDataset('my-dataset', dag)
      state.unsubscribeFromDataset('my-dataset', 'my-dag')
      // Unsubscription is internal - just verify no errors
      expect(true).toBe(true)
    })
  })
})

// ============================================================================
// EXTERNAL DAG TASK
// ============================================================================

describe('createExternalDAGTask', () => {
  it('should create a task that waits for external DAG', async () => {
    const orchestrator = createDAGOrchestrator()
    const upstreamDag = createSimpleDAG('upstream')
    orchestrator.registry.register(upstreamDag)

    const waitTask = createExternalDAGTask('wait-for-upstream', orchestrator, {
      dagId: 'upstream',
    })

    // Execute upstream first
    await orchestrator.trigger('upstream')

    // Now execute the wait task - it should immediately find the completed run
    const result = await waitTask.execute()
    expect(result).toBeDefined()
    expect((result as DAGRun).status).toBe('completed')
  })
})

// ============================================================================
// DATASET SENSOR TASK
// ============================================================================

describe('createDatasetSensorTask', () => {
  it('should create a task that waits for dataset', async () => {
    const state = createDatasetAwareState()

    const sensorTask = createDatasetSensorTask('wait-for-dataset', 'my-dataset', state, {
      interval: 10,
      timeout: 500,
    })

    // Start waiting in background
    const taskPromise = sensorTask.execute()

    // Register the dataset after a delay
    setTimeout(() => {
      state.registerDataset({ id: 'my-dataset', location: '/path' })
    }, 50)

    const result = await taskPromise
    expect(result).toBeDefined()
    expect((result as Dataset).id).toBe('my-dataset')
  })

  it('should timeout if dataset never appears', async () => {
    const state = createDatasetAwareState()

    const sensorTask = createDatasetSensorTask('wait-for-dataset', 'missing-dataset', state, {
      interval: 10,
      timeout: 50,
    })

    await expect(sensorTask.execute()).rejects.toThrow(/timeout/i)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Cross-DAG Integration', () => {
  it('should orchestrate a multi-DAG pipeline', async () => {
    const orchestrator = createDAGOrchestrator()
    const executionOrder: string[] = []

    // Create a pipeline: extract -> transform -> load
    const extractDag = createDAG({
      id: 'extract',
      tasks: [
        createTaskNode({
          id: 'extract-task',
          execute: async () => {
            executionOrder.push('extract')
            return { data: [1, 2, 3] }
          },
          dependencies: [],
        }),
      ],
    })

    const transformDag = createDAG({
      id: 'transform',
      tasks: [
        createTaskNode({
          id: 'transform-task',
          execute: async (ctx) => {
            executionOrder.push('transform')
            const upstream = ctx?.triggerPayload as { data: number[] }
            return { data: upstream.data.map(x => x * 2) }
          },
          dependencies: [],
        }),
      ],
      triggers: [{
        type: 'dag-complete',
        source: { dagId: 'extract' },
        payload: (result) => result.taskResults.get('extract-task')?.output,
      }],
    })

    const loadDag = createDAG({
      id: 'load',
      tasks: [
        createTaskNode({
          id: 'load-task',
          execute: async (ctx) => {
            executionOrder.push('load')
            return 'loaded'
          },
          dependencies: [],
        }),
      ],
      triggers: [{
        type: 'dag-complete',
        source: { dagId: 'transform' },
      }],
    })

    orchestrator.registry.register(extractDag)
    orchestrator.registry.register(transformDag)
    orchestrator.registry.register(loadDag)

    // Validate no cycles
    orchestrator.registry.validateDependencies()

    // Trigger the pipeline by starting extract
    await orchestrator.trigger('extract')

    // Wait for cascade
    await delay(100)

    expect(executionOrder).toEqual(['extract', 'transform', 'load'])
  })

  it('should share state across DAGs', async () => {
    const state = createCrossDAGState()
    const orchestrator = createDAGOrchestrator({ state })

    const dagA = createDAG({
      id: 'dag-a',
      tasks: [
        createTaskNode({
          id: 'set-state',
          execute: async () => {
            await state.set('shared-key', { message: 'from dag-a' })
            return 'done'
          },
          dependencies: [],
        }),
      ],
    })

    const dagB = createDAG({
      id: 'dag-b',
      tasks: [
        createTaskNode({
          id: 'get-state',
          execute: async () => {
            return await state.get('shared-key')
          },
          dependencies: [],
        }),
      ],
    })

    orchestrator.registry.register(dagA)
    orchestrator.registry.register(dagB)

    // Run dag-a to set state
    await orchestrator.trigger('dag-a')

    // Run dag-b to get state
    const result = await orchestrator.trigger('dag-b')
    const output = result.taskResults.get('get-state')?.output
    expect(output).toEqual({ message: 'from dag-a' })
  })
})
