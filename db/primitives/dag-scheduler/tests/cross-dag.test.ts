/**
 * Cross-DAG Dependencies and Triggers Tests
 *
 * RED phase: These tests define the expected behavior of cross-DAG dependencies.
 * All tests should FAIL until implementation is complete.
 *
 * Features tested:
 * - ExternalTaskSensor for cross-DAG polling
 * - DatasetTrigger for data-driven execution
 * - DAGRegistry for cross-DAG discovery
 * - Dependency resolution across DAGs
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  // Existing types
  type DAG,
  type DAGRun,
  type TaskNode,
  type ExternalDependency,
  type DAGTrigger,
  createDAG,
  createTaskNode,
  createParallelExecutor,
  createSensor,
  // New cross-DAG types to be implemented
} from '../index'
import {
  // Cross-DAG module exports
  createDAGRegistry,
  createExternalTaskSensor,
  createDatasetTrigger,
  createCrossDAGDependencyResolver,
  validateCrossDAGDependencies,
  type DAGRegistry,
  type DAGRegistryOptions,
  type ExternalTaskSensor,
  type ExternalTaskSensorOptions,
  type DatasetTrigger,
  type DatasetTriggerOptions,
  type Dataset,
  type DatasetEvent,
  type CrossDAGDependencyResolver,
  type CrossDAGDependency,
  type DAGExecutionContext,
} from '../cross-dag'

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
// DAG REGISTRY - DISCOVER AND MANAGE DAGs
// ============================================================================

describe('DAGRegistry', () => {
  let registry: DAGRegistry

  beforeEach(() => {
    registry = createDAGRegistry()
  })

  describe('registration', () => {
    it('should register a DAG', () => {
      const dag = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
      })
      registry.register(dag)
      expect(registry.has('dag-1')).toBe(true)
    })

    it('should get a registered DAG', () => {
      const dag = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
      })
      registry.register(dag)
      const retrieved = registry.get('dag-1')
      expect(retrieved).toBe(dag)
    })

    it('should return undefined for unregistered DAG', () => {
      expect(registry.get('nonexistent')).toBeUndefined()
    })

    it('should list all registered DAGs', () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({ id: 'dag-2', tasks: [createSimpleTask('b')] })
      registry.register(dag1)
      registry.register(dag2)
      expect(registry.list()).toHaveLength(2)
      expect(registry.list().map((d) => d.id).sort()).toEqual(['dag-1', 'dag-2'])
    })

    it('should unregister a DAG', () => {
      const dag = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      registry.register(dag)
      registry.unregister('dag-1')
      expect(registry.has('dag-1')).toBe(false)
    })

    it('should reject duplicate registration', () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('b')] })
      registry.register(dag1)
      expect(() => registry.register(dag2)).toThrow(/already registered/i)
    })

    it('should allow forced re-registration', () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('b')] })
      registry.register(dag1)
      registry.register(dag2, { force: true })
      expect(registry.get('dag-1')?.tasks.has('b')).toBe(true)
    })
  })

  describe('run tracking', () => {
    it('should track DAG run status', async () => {
      const dag = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
      })
      registry.register(dag)

      const executor = createParallelExecutor()
      const run = await executor.execute(dag)
      registry.recordRun('dag-1', run)

      expect(registry.getLastRun('dag-1')).toBe(run)
    })

    it('should get latest successful run', async () => {
      const successDag = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
      })
      registry.register(successDag)

      const executor = createParallelExecutor()
      const run1 = await executor.execute(successDag)
      registry.recordRun('dag-1', run1)

      const successfulRun = registry.getLastSuccessfulRun('dag-1')
      expect(successfulRun?.status).toBe('completed')
    })

    it('should list run history', async () => {
      const dag = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
      })
      registry.register(dag)

      const executor = createParallelExecutor()
      const run1 = await executor.execute(dag)
      const run2 = await executor.execute(dag)
      registry.recordRun('dag-1', run1)
      registry.recordRun('dag-1', run2)

      const history = registry.getRunHistory('dag-1')
      expect(history).toHaveLength(2)
    })

    it('should limit run history', async () => {
      const dag = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
      })
      registry.register(dag)

      const executor = createParallelExecutor()
      for (let i = 0; i < 5; i++) {
        const run = await executor.execute(dag)
        registry.recordRun('dag-1', run)
      }

      const history = registry.getRunHistory('dag-1', { limit: 3 })
      expect(history).toHaveLength(3)
    })
  })

  describe('task status queries', () => {
    it('should get task status from specific run', async () => {
      const dag = createDAG({
        id: 'dag-1',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
        ],
      })
      registry.register(dag)

      const executor = createParallelExecutor()
      const run = await executor.execute(dag)
      registry.recordRun('dag-1', run)

      const taskStatus = registry.getTaskStatus('dag-1', 'a', run.runId)
      expect(taskStatus?.status).toBe('success')
    })

    it('should get latest task status', async () => {
      const dag = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
      })
      registry.register(dag)

      const executor = createParallelExecutor()
      const run = await executor.execute(dag)
      registry.recordRun('dag-1', run)

      const taskStatus = registry.getLatestTaskStatus('dag-1', 'a')
      expect(taskStatus?.status).toBe('success')
    })
  })

  describe('events', () => {
    it('should emit event on DAG completion', async () => {
      const events: { dagId: string; status: string }[] = []
      registry.on('dag:complete', (dagId, run) => {
        events.push({ dagId, status: run.status })
      })

      const dag = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
      })
      registry.register(dag)

      const executor = createParallelExecutor()
      const run = await executor.execute(dag)
      registry.recordRun('dag-1', run)

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ dagId: 'dag-1', status: 'completed' })
    })

    it('should emit event on task completion', async () => {
      const events: { dagId: string; taskId: string; status: string }[] = []
      registry.on('task:complete', (dagId, taskId, result) => {
        events.push({ dagId, taskId, status: result.status })
      })

      const dag = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a'), createSimpleTask('b', ['a'])],
      })
      registry.register(dag)

      const executor = createParallelExecutor()
      const run = await executor.execute(dag)
      registry.recordRun('dag-1', run)

      expect(events).toHaveLength(2)
      expect(events.map((e) => e.taskId).sort()).toEqual(['a', 'b'])
    })
  })
})

// ============================================================================
// EXTERNAL TASK SENSOR - POLL FOR CROSS-DAG TASK COMPLETION
// ============================================================================

describe('ExternalTaskSensor', () => {
  let registry: DAGRegistry

  beforeEach(() => {
    registry = createDAGRegistry()
  })

  describe('creation', () => {
    it('should create sensor with required options', () => {
      const sensor = createExternalTaskSensor({
        externalDagId: 'upstream-dag',
        externalTaskId: 'final-task',
        registry,
      })
      expect(sensor.externalDagId).toBe('upstream-dag')
      expect(sensor.externalTaskId).toBe('final-task')
    })

    it('should create sensor for entire DAG (no task specified)', () => {
      const sensor = createExternalTaskSensor({
        externalDagId: 'upstream-dag',
        registry,
      })
      expect(sensor.externalTaskId).toBeUndefined()
    })

    it('should support custom polling interval', () => {
      const sensor = createExternalTaskSensor({
        externalDagId: 'upstream-dag',
        registry,
        pollInterval: 5000,
      })
      expect(sensor.pollInterval).toBe(5000)
    })

    it('should support custom timeout', () => {
      const sensor = createExternalTaskSensor({
        externalDagId: 'upstream-dag',
        registry,
        timeout: 60000,
      })
      expect(sensor.timeout).toBe(60000)
    })
  })

  describe('polling', () => {
    it('should wait until external task succeeds', async () => {
      const upstreamDag = createDAG({
        id: 'upstream-dag',
        tasks: [createSimpleTask('final-task')],
      })
      registry.register(upstreamDag)

      const sensor = createExternalTaskSensor({
        externalDagId: 'upstream-dag',
        externalTaskId: 'final-task',
        registry,
        pollInterval: 10,
        timeout: 1000,
      })

      // Start polling
      const waitPromise = sensor.wait()

      // Execute upstream DAG after a short delay
      setTimeout(async () => {
        const executor = createParallelExecutor()
        const run = await executor.execute(upstreamDag)
        registry.recordRun('upstream-dag', run)
      }, 50)

      const result = await waitPromise
      expect(result).toBe(true)
    })

    it('should wait until entire DAG succeeds when no task specified', async () => {
      const upstreamDag = createDAG({
        id: 'upstream-dag',
        tasks: [
          createSimpleTask('a'),
          createSimpleTask('b', ['a']),
        ],
      })
      registry.register(upstreamDag)

      const sensor = createExternalTaskSensor({
        externalDagId: 'upstream-dag',
        registry,
        pollInterval: 10,
        timeout: 1000,
      })

      setTimeout(async () => {
        const executor = createParallelExecutor()
        const run = await executor.execute(upstreamDag)
        registry.recordRun('upstream-dag', run)
      }, 50)

      const result = await sensor.wait()
      expect(result).toBe(true)
    })

    it('should timeout if external task never completes', async () => {
      registry.register(
        createDAG({
          id: 'upstream-dag',
          tasks: [createSimpleTask('final-task')],
        })
      )

      const sensor = createExternalTaskSensor({
        externalDagId: 'upstream-dag',
        externalTaskId: 'final-task',
        registry,
        pollInterval: 10,
        timeout: 50,
      })

      await expect(sensor.wait()).rejects.toThrow(/timeout/i)
    })

    it('should fail if external task fails', async () => {
      const upstreamDag = createDAG({
        id: 'upstream-dag',
        tasks: [
          createTaskNode({
            id: 'failing-task',
            execute: async () => {
              throw new Error('Task failed')
            },
            dependencies: [],
          }),
        ],
      })
      registry.register(upstreamDag)

      const sensor = createExternalTaskSensor({
        externalDagId: 'upstream-dag',
        externalTaskId: 'failing-task',
        registry,
        pollInterval: 10,
        timeout: 1000,
        failOnExternalFailure: true,
      })

      setTimeout(async () => {
        const executor = createParallelExecutor()
        const run = await executor.execute(upstreamDag)
        registry.recordRun('upstream-dag', run)
      }, 50)

      await expect(sensor.wait()).rejects.toThrow(/external task failed/i)
    })

    it('should support condition filter', async () => {
      const upstreamDag = createDAG({
        id: 'upstream-dag',
        tasks: [createSimpleTask('task-a')],
      })
      registry.register(upstreamDag)

      const sensor = createExternalTaskSensor({
        externalDagId: 'upstream-dag',
        externalTaskId: 'task-a',
        registry,
        pollInterval: 10,
        timeout: 1000,
        condition: 'success', // Only succeed when task is successful
      })

      setTimeout(async () => {
        const executor = createParallelExecutor()
        const run = await executor.execute(upstreamDag)
        registry.recordRun('upstream-dag', run)
      }, 50)

      const result = await sensor.wait()
      expect(result).toBe(true)
    })

    it('should check specific execution date', async () => {
      const upstreamDag = createDAG({
        id: 'upstream-dag',
        tasks: [createSimpleTask('task-a')],
      })
      registry.register(upstreamDag)

      const executionDate = new Date()
      const sensor = createExternalTaskSensor({
        externalDagId: 'upstream-dag',
        externalTaskId: 'task-a',
        registry,
        pollInterval: 10,
        timeout: 1000,
        executionDate,
      })

      setTimeout(async () => {
        const executor = createParallelExecutor()
        const run = await executor.execute(upstreamDag)
        registry.recordRun('upstream-dag', run, { executionDate })
      }, 50)

      const result = await sensor.wait()
      expect(result).toBe(true)
    })
  })

  describe('as task', () => {
    it('should be usable as a task in a DAG', async () => {
      const upstreamDag = createDAG({
        id: 'upstream-dag',
        tasks: [createSimpleTask('produce-data')],
      })
      registry.register(upstreamDag)

      const sensor = createExternalTaskSensor({
        externalDagId: 'upstream-dag',
        externalTaskId: 'produce-data',
        registry,
        pollInterval: 10,
        timeout: 1000,
      })

      const downstreamDag = createDAG({
        id: 'downstream-dag',
        tasks: [
          createTaskNode({
            id: 'wait-for-upstream',
            execute: async () => sensor.wait(),
            dependencies: [],
          }),
          createSimpleTask('process', ['wait-for-upstream']),
        ],
      })

      // Start upstream first
      const upstreamExecutor = createParallelExecutor()
      const upstreamPromise = upstreamExecutor.execute(upstreamDag).then((run) => {
        registry.recordRun('upstream-dag', run)
      })

      // Start downstream
      const downstreamExecutor = createParallelExecutor()
      const downstreamRun = await downstreamExecutor.execute(downstreamDag)

      await upstreamPromise

      expect(downstreamRun.status).toBe('completed')
      expect(downstreamRun.taskResults.get('process')?.status).toBe('success')
    })
  })
})

// ============================================================================
// DATASET TRIGGER - DATA-DRIVEN DAG EXECUTION
// ============================================================================

describe('DatasetTrigger', () => {
  let registry: DAGRegistry

  beforeEach(() => {
    registry = createDAGRegistry()
  })

  describe('dataset creation', () => {
    it('should create a dataset with URI', () => {
      const trigger = createDatasetTrigger({
        dataset: { uri: 's3://bucket/path/data.parquet' },
        registry,
      })
      expect(trigger.dataset.uri).toBe('s3://bucket/path/data.parquet')
    })

    it('should create a dataset with name', () => {
      const trigger = createDatasetTrigger({
        dataset: { name: 'customer_data', uri: 'internal://datasets/customers' },
        registry,
      })
      expect(trigger.dataset.name).toBe('customer_data')
    })
  })

  describe('producer registration', () => {
    it('should register a DAG as dataset producer', () => {
      const producerDag = createDAG({
        id: 'producer-dag',
        tasks: [createSimpleTask('write-data')],
      })
      registry.register(producerDag)

      const trigger = createDatasetTrigger({
        dataset: { uri: 's3://bucket/data.parquet' },
        registry,
      })

      trigger.registerProducer('producer-dag', 'write-data')
      expect(trigger.getProducers()).toContainEqual({
        dagId: 'producer-dag',
        taskId: 'write-data',
      })
    })

    it('should support multiple producers for same dataset', () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('write')] })
      const dag2 = createDAG({ id: 'dag-2', tasks: [createSimpleTask('write')] })
      registry.register(dag1)
      registry.register(dag2)

      const trigger = createDatasetTrigger({
        dataset: { uri: 's3://bucket/data.parquet' },
        registry,
      })

      trigger.registerProducer('dag-1', 'write')
      trigger.registerProducer('dag-2', 'write')

      expect(trigger.getProducers()).toHaveLength(2)
    })
  })

  describe('consumer registration', () => {
    it('should register a DAG as dataset consumer', () => {
      const consumerDag = createDAG({
        id: 'consumer-dag',
        tasks: [createSimpleTask('read-data')],
      })
      registry.register(consumerDag)

      const trigger = createDatasetTrigger({
        dataset: { uri: 's3://bucket/data.parquet' },
        registry,
      })

      trigger.registerConsumer('consumer-dag')
      expect(trigger.getConsumers()).toContain('consumer-dag')
    })
  })

  describe('triggering', () => {
    it('should trigger consumer DAG when producer completes', async () => {
      let consumerTriggered = false

      const producerDag = createDAG({
        id: 'producer-dag',
        tasks: [createSimpleTask('write-data')],
      })
      const consumerDag = createDAG({
        id: 'consumer-dag',
        tasks: [
          createTaskNode({
            id: 'read-data',
            execute: async () => {
              consumerTriggered = true
              return 'data'
            },
            dependencies: [],
          }),
        ],
      })

      registry.register(producerDag)
      registry.register(consumerDag)

      const trigger = createDatasetTrigger({
        dataset: { uri: 's3://bucket/data.parquet' },
        registry,
      })

      trigger.registerProducer('producer-dag', 'write-data')
      trigger.registerConsumer('consumer-dag')

      // Execute producer
      const executor = createParallelExecutor()
      const run = await executor.execute(producerDag)
      registry.recordRun('producer-dag', run)

      // Trigger should fire
      await trigger.checkAndTrigger()

      expect(consumerTriggered).toBe(true)
    })

    it('should pass dataset event to consumer', async () => {
      let receivedEvent: DatasetEvent | undefined

      const producerDag = createDAG({
        id: 'producer-dag',
        tasks: [createSimpleTask('write-data')],
      })
      const consumerDag = createDAG({
        id: 'consumer-dag',
        tasks: [
          createTaskNode({
            id: 'read-data',
            execute: async (ctx) => {
              receivedEvent = ctx?.triggerPayload as DatasetEvent
              return 'processed'
            },
            dependencies: [],
          }),
        ],
      })

      registry.register(producerDag)
      registry.register(consumerDag)

      const trigger = createDatasetTrigger({
        dataset: { uri: 's3://bucket/data.parquet' },
        registry,
      })

      trigger.registerProducer('producer-dag', 'write-data')
      trigger.registerConsumer('consumer-dag')

      const executor = createParallelExecutor()
      const run = await executor.execute(producerDag)
      registry.recordRun('producer-dag', run)

      await trigger.checkAndTrigger()

      expect(receivedEvent?.dataset.uri).toBe('s3://bucket/data.parquet')
      expect(receivedEvent?.producerDagId).toBe('producer-dag')
      expect(receivedEvent?.producerTaskId).toBe('write-data')
    })

    it('should require all datasets when multiple defined', async () => {
      const producer1 = createDAG({ id: 'producer-1', tasks: [createSimpleTask('write')] })
      const producer2 = createDAG({ id: 'producer-2', tasks: [createSimpleTask('write')] })
      const consumer = createDAG({ id: 'consumer', tasks: [createSimpleTask('read')] })

      registry.register(producer1)
      registry.register(producer2)
      registry.register(consumer)

      const trigger1 = createDatasetTrigger({
        dataset: { uri: 'data1.parquet' },
        registry,
      })
      const trigger2 = createDatasetTrigger({
        dataset: { uri: 'data2.parquet' },
        registry,
      })

      trigger1.registerProducer('producer-1', 'write')
      trigger2.registerProducer('producer-2', 'write')

      // Create composite trigger that requires both datasets
      const compositeTrigger = createDatasetTrigger({
        datasets: [
          { uri: 'data1.parquet' },
          { uri: 'data2.parquet' },
        ],
        registry,
        requireAll: true,
      })

      compositeTrigger.registerConsumer('consumer')

      // Execute only first producer
      const executor = createParallelExecutor()
      const run1 = await executor.execute(producer1)
      registry.recordRun('producer-1', run1)
      trigger1.notifyUpdate()

      // Consumer should NOT trigger yet
      const triggered = await compositeTrigger.checkAndTrigger()
      expect(triggered).toBe(false)

      // Execute second producer
      const run2 = await executor.execute(producer2)
      registry.recordRun('producer-2', run2)
      trigger2.notifyUpdate()

      // Now consumer should trigger
      const triggeredAfterBoth = await compositeTrigger.checkAndTrigger()
      expect(triggeredAfterBoth).toBe(true)
    })
  })

  describe('scheduling modes', () => {
    it('should support immediate triggering', async () => {
      const producer = createDAG({ id: 'producer', tasks: [createSimpleTask('write')] })
      const consumer = createDAG({ id: 'consumer', tasks: [createSimpleTask('read')] })

      registry.register(producer)
      registry.register(consumer)

      const trigger = createDatasetTrigger({
        dataset: { uri: 'data.parquet' },
        registry,
        triggerMode: 'immediate',
      })

      trigger.registerProducer('producer', 'write')
      trigger.registerConsumer('consumer')

      const executor = createParallelExecutor()
      const run = await executor.execute(producer)
      registry.recordRun('producer', run)

      // With immediate mode, trigger fires right away
      const pendingTriggers = trigger.getPendingTriggers()
      expect(pendingTriggers).toHaveLength(1)
    })

    it('should support batched triggering', async () => {
      const producer = createDAG({ id: 'producer', tasks: [createSimpleTask('write')] })
      const consumer = createDAG({ id: 'consumer', tasks: [createSimpleTask('read')] })

      registry.register(producer)
      registry.register(consumer)

      const trigger = createDatasetTrigger({
        dataset: { uri: 'data.parquet' },
        registry,
        triggerMode: 'batched',
        batchWindow: 100, // 100ms window
      })

      trigger.registerProducer('producer', 'write')
      trigger.registerConsumer('consumer')

      const executor = createParallelExecutor()

      // Multiple rapid updates
      for (let i = 0; i < 3; i++) {
        const run = await executor.execute(producer)
        registry.recordRun('producer', run)
        trigger.notifyUpdate()
      }

      // Should batch into single trigger
      await delay(150)
      const pendingTriggers = trigger.getPendingTriggers()
      expect(pendingTriggers).toHaveLength(1)
    })
  })
})

// ============================================================================
// CROSS-DAG DEPENDENCY RESOLVER - RESOLVE DEPENDENCIES ACROSS DAGS
// ============================================================================

describe('CrossDAGDependencyResolver', () => {
  let registry: DAGRegistry
  let resolver: CrossDAGDependencyResolver

  beforeEach(() => {
    registry = createDAGRegistry()
    resolver = createCrossDAGDependencyResolver(registry)
  })

  describe('dependency declaration', () => {
    it('should declare cross-DAG dependency', () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('b')],
        triggers: [
          {
            type: 'dag-complete',
            source: { dagId: 'dag-1' },
          },
        ],
      })

      registry.register(dag1)
      registry.register(dag2)

      const deps = resolver.getDependencies('dag-2')
      expect(deps).toContainEqual({ dagId: 'dag-1', type: 'dag-complete' })
    })

    it('should declare task-level cross-DAG dependency', () => {
      const dag1 = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('final-task')],
      })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('dependent')],
        triggers: [
          {
            type: 'task-complete',
            source: { dagId: 'dag-1', taskId: 'final-task' },
          },
        ],
      })

      registry.register(dag1)
      registry.register(dag2)

      const deps = resolver.getDependencies('dag-2')
      expect(deps).toContainEqual({
        dagId: 'dag-1',
        taskId: 'final-task',
        type: 'task-complete',
      })
    })
  })

  describe('dependency graph', () => {
    it('should build dependency graph', () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('b')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
      })
      const dag3 = createDAG({
        id: 'dag-3',
        tasks: [createSimpleTask('c')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-2' } }],
      })

      registry.register(dag1)
      registry.register(dag2)
      registry.register(dag3)

      const graph = resolver.buildDependencyGraph()
      expect(graph.nodes).toContain('dag-1')
      expect(graph.nodes).toContain('dag-2')
      expect(graph.nodes).toContain('dag-3')
      expect(graph.edges).toContainEqual({ from: 'dag-2', to: 'dag-1' })
      expect(graph.edges).toContainEqual({ from: 'dag-3', to: 'dag-2' })
    })

    it('should get upstream DAGs', () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('b')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
      })
      const dag3 = createDAG({
        id: 'dag-3',
        tasks: [createSimpleTask('c')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-2' } }],
      })

      registry.register(dag1)
      registry.register(dag2)
      registry.register(dag3)

      const upstream = resolver.getUpstreamDAGs('dag-3')
      expect(upstream.sort()).toEqual(['dag-1', 'dag-2'])
    })

    it('should get downstream DAGs', () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('b')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
      })
      const dag3 = createDAG({
        id: 'dag-3',
        tasks: [createSimpleTask('c')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
      })

      registry.register(dag1)
      registry.register(dag2)
      registry.register(dag3)

      const downstream = resolver.getDownstreamDAGs('dag-1')
      expect(downstream.sort()).toEqual(['dag-2', 'dag-3'])
    })
  })

  describe('cycle detection', () => {
    it('should detect circular dependencies', () => {
      const dag1 = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-2' } }],
      })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('b')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
      })

      registry.register(dag1)
      registry.register(dag2)

      const cycles = resolver.detectCycles()
      expect(cycles).not.toBeNull()
      expect(cycles).toHaveLength(1)
    })

    it('should return null for acyclic dependencies', () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('b')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
      })

      registry.register(dag1)
      registry.register(dag2)

      const cycles = resolver.detectCycles()
      expect(cycles).toBeNull()
    })

    it('should detect multi-node cycles', () => {
      const dag1 = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-3' } }],
      })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('b')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
      })
      const dag3 = createDAG({
        id: 'dag-3',
        tasks: [createSimpleTask('c')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-2' } }],
      })

      registry.register(dag1)
      registry.register(dag2)
      registry.register(dag3)

      const cycles = resolver.detectCycles()
      expect(cycles).not.toBeNull()
    })
  })

  describe('validation', () => {
    it('should validate all cross-DAG dependencies exist', () => {
      const dag1 = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('a')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'nonexistent' } }],
      })

      registry.register(dag1)

      const result = resolver.validate()
      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          dagId: 'dag-1',
          message: expect.stringContaining('nonexistent'),
        })
      )
    })

    it('should validate referenced tasks exist', () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('b')],
        triggers: [
          {
            type: 'task-complete',
            source: { dagId: 'dag-1', taskId: 'nonexistent-task' },
          },
        ],
      })

      registry.register(dag1)
      registry.register(dag2)

      const result = resolver.validate()
      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          dagId: 'dag-2',
          message: expect.stringContaining('nonexistent-task'),
        })
      )
    })

    it('should pass validation for valid dependencies', () => {
      const dag1 = createDAG({
        id: 'dag-1',
        tasks: [createSimpleTask('final-task')],
      })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('b')],
        triggers: [
          {
            type: 'task-complete',
            source: { dagId: 'dag-1', taskId: 'final-task' },
          },
        ],
      })

      registry.register(dag1)
      registry.register(dag2)

      const result = resolver.validate()
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('execution order', () => {
    it('should return DAGs in topological order', () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('b')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
      })
      const dag3 = createDAG({
        id: 'dag-3',
        tasks: [createSimpleTask('c')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-2' } }],
      })

      registry.register(dag1)
      registry.register(dag2)
      registry.register(dag3)

      const order = resolver.getExecutionOrder()
      expect(order.indexOf('dag-1')).toBeLessThan(order.indexOf('dag-2'))
      expect(order.indexOf('dag-2')).toBeLessThan(order.indexOf('dag-3'))
    })

    it('should handle independent DAGs', () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({ id: 'dag-2', tasks: [createSimpleTask('b')] })
      const dag3 = createDAG({
        id: 'dag-3',
        tasks: [createSimpleTask('c')],
        triggers: [
          { type: 'dag-complete', source: { dagId: 'dag-1' } },
          { type: 'dag-complete', source: { dagId: 'dag-2' } },
        ],
      })

      registry.register(dag1)
      registry.register(dag2)
      registry.register(dag3)

      const order = resolver.getExecutionOrder()
      expect(order.indexOf('dag-1')).toBeLessThan(order.indexOf('dag-3'))
      expect(order.indexOf('dag-2')).toBeLessThan(order.indexOf('dag-3'))
    })
  })

  describe('ready DAGs', () => {
    it('should get DAGs ready for execution', async () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('b')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
      })
      const dag3 = createDAG({ id: 'dag-3', tasks: [createSimpleTask('c')] })

      registry.register(dag1)
      registry.register(dag2)
      registry.register(dag3)

      // No DAGs executed yet
      const ready = resolver.getReadyDAGs()
      expect(ready.sort()).toEqual(['dag-1', 'dag-3'])
      expect(ready).not.toContain('dag-2')
    })

    it('should update ready DAGs after execution', async () => {
      const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [createSimpleTask('b')],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
      })

      registry.register(dag1)
      registry.register(dag2)

      // Execute dag-1
      const executor = createParallelExecutor()
      const run = await executor.execute(dag1)
      registry.recordRun('dag-1', run)

      const ready = resolver.getReadyDAGs()
      expect(ready).toContain('dag-2')
    })
  })
})

// ============================================================================
// DAG-TO-DAG COMMUNICATION - PASS DATA BETWEEN DAGS
// ============================================================================

describe('DAGCommunication', () => {
  let registry: DAGRegistry

  beforeEach(() => {
    registry = createDAGRegistry()
  })

  describe('result passing', () => {
    it('should pass DAG result to downstream DAG', async () => {
      let receivedData: unknown

      const producerDag = createDAG({
        id: 'producer',
        tasks: [
          createTaskNode({
            id: 'produce',
            execute: async () => ({ data: 'from-producer' }),
            dependencies: [],
          }),
        ],
      })

      const consumerDag = createDAG({
        id: 'consumer',
        tasks: [
          createTaskNode({
            id: 'consume',
            execute: async (ctx) => {
              receivedData = ctx?.triggerPayload
              return 'consumed'
            },
            dependencies: [],
          }),
        ],
        triggers: [
          {
            type: 'dag-complete',
            source: { dagId: 'producer' },
            payload: (run) => run.taskResults.get('produce')?.output,
          },
        ],
      })

      registry.register(producerDag)
      registry.register(consumerDag)

      const resolver = createCrossDAGDependencyResolver(registry)

      // Execute producer
      const executor = createParallelExecutor()
      const producerRun = await executor.execute(producerDag)
      registry.recordRun('producer', producerRun)

      // Get payload for consumer
      const trigger = consumerDag.triggers![0]!
      const payload = trigger.payload?.(producerRun)

      // Execute consumer with payload
      const consumerRun = await executor.execute(consumerDag, {
        triggerPayload: payload,
      })
      registry.recordRun('consumer', consumerRun)

      expect(receivedData).toEqual({ data: 'from-producer' })
    })

    it('should pass specific task result to downstream', async () => {
      let receivedData: unknown

      const producerDag = createDAG({
        id: 'producer',
        tasks: [
          createTaskNode({
            id: 'step-1',
            execute: async () => 'intermediate',
            dependencies: [],
          }),
          createTaskNode({
            id: 'step-2',
            execute: async () => ({ final: 'result' }),
            dependencies: ['step-1'],
          }),
        ],
      })

      const consumerDag = createDAG({
        id: 'consumer',
        tasks: [
          createTaskNode({
            id: 'consume',
            execute: async (ctx) => {
              receivedData = ctx?.triggerPayload
              return 'done'
            },
            dependencies: [],
          }),
        ],
        triggers: [
          {
            type: 'task-complete',
            source: { dagId: 'producer', taskId: 'step-2' },
            payload: (run) => run.taskResults.get('step-2')?.output,
          },
        ],
      })

      registry.register(producerDag)
      registry.register(consumerDag)

      const executor = createParallelExecutor()
      const producerRun = await executor.execute(producerDag)
      registry.recordRun('producer', producerRun)

      const trigger = consumerDag.triggers![0]!
      const payload = trigger.payload?.(producerRun)

      const consumerRun = await executor.execute(consumerDag, {
        triggerPayload: payload,
      })

      expect(receivedData).toEqual({ final: 'result' })
    })
  })

  describe('context sharing', () => {
    it('should share execution context across DAGs', async () => {
      const context: DAGExecutionContext = {
        executionDate: new Date('2026-01-12'),
        params: { environment: 'production' },
      }

      let receivedContext: DAGExecutionContext | undefined

      const dag1 = createDAG({
        id: 'dag-1',
        tasks: [
          createTaskNode({
            id: 'task-1',
            execute: async (ctx) => {
              return ctx?.executionContext
            },
            dependencies: [],
          }),
        ],
      })

      const dag2 = createDAG({
        id: 'dag-2',
        tasks: [
          createTaskNode({
            id: 'task-2',
            execute: async (ctx) => {
              receivedContext = ctx?.executionContext as DAGExecutionContext
              return 'done'
            },
            dependencies: [],
          }),
        ],
        triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
      })

      registry.register(dag1)
      registry.register(dag2)

      const resolver = createCrossDAGDependencyResolver(registry)
      resolver.setExecutionContext(context)

      const executor = createParallelExecutor()

      // Execute both DAGs with shared context
      const run1 = await executor.execute(dag1, {
        triggerPayload: { executionContext: context },
      })
      registry.recordRun('dag-1', run1)

      const run2 = await executor.execute(dag2, {
        triggerPayload: { executionContext: context },
      })
      registry.recordRun('dag-2', run2)

      expect(receivedContext?.executionDate).toEqual(context.executionDate)
      expect(receivedContext?.params).toEqual(context.params)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('CrossDAG Integration', () => {
  let registry: DAGRegistry

  beforeEach(() => {
    registry = createDAGRegistry()
  })

  describe('ETL pipeline with cross-DAG dependencies', () => {
    it('should orchestrate multi-DAG ETL pipeline', async () => {
      const executionLog: string[] = []

      // Stage 1: Extract DAG
      const extractDag = createDAG({
        id: 'extract',
        tasks: [
          createTaskNode({
            id: 'extract-api',
            execute: async () => {
              executionLog.push('extract-api')
              return { api: 'data' }
            },
            dependencies: [],
          }),
          createTaskNode({
            id: 'extract-db',
            execute: async () => {
              executionLog.push('extract-db')
              return { db: 'data' }
            },
            dependencies: [],
          }),
        ],
      })

      // Stage 2: Transform DAG (depends on Extract)
      const transformDag = createDAG({
        id: 'transform',
        tasks: [
          createTaskNode({
            id: 'transform-data',
            execute: async (ctx) => {
              executionLog.push('transform-data')
              return { transformed: ctx?.triggerPayload }
            },
            dependencies: [],
          }),
        ],
        triggers: [
          {
            type: 'dag-complete',
            source: { dagId: 'extract' },
            payload: (run) => ({
              api: run.taskResults.get('extract-api')?.output,
              db: run.taskResults.get('extract-db')?.output,
            }),
          },
        ],
      })

      // Stage 3: Load DAG (depends on Transform)
      const loadDag = createDAG({
        id: 'load',
        tasks: [
          createTaskNode({
            id: 'load-warehouse',
            execute: async (ctx) => {
              executionLog.push('load-warehouse')
              return { loaded: ctx?.triggerPayload }
            },
            dependencies: [],
          }),
        ],
        triggers: [
          {
            type: 'dag-complete',
            source: { dagId: 'transform' },
            payload: (run) => run.taskResults.get('transform-data')?.output,
          },
        ],
      })

      registry.register(extractDag)
      registry.register(transformDag)
      registry.register(loadDag)

      const resolver = createCrossDAGDependencyResolver(registry)
      const executor = createParallelExecutor()

      // Execute in order
      const order = resolver.getExecutionOrder()
      expect(order).toEqual(['extract', 'transform', 'load'])

      // Run pipeline
      let previousRun: DAGRun | undefined
      for (const dagId of order) {
        const dag = registry.get(dagId)!
        let triggerPayload: unknown

        if (previousRun && dag.triggers?.[0]?.payload) {
          triggerPayload = dag.triggers[0].payload(previousRun)
        }

        const run = await executor.execute(dag, { triggerPayload })
        registry.recordRun(dagId, run)
        previousRun = run
      }

      expect(executionLog).toEqual([
        'extract-api',
        'extract-db',
        'transform-data',
        'load-warehouse',
      ])
    })
  })

  describe('parallel DAG orchestration', () => {
    it('should handle diamond pattern across DAGs', async () => {
      const executionLog: string[] = []

      // Root DAG
      const rootDag = createDAG({
        id: 'root',
        tasks: [
          createTaskNode({
            id: 'start',
            execute: async () => {
              executionLog.push('root:start')
              return 'started'
            },
            dependencies: [],
          }),
        ],
      })

      // Branch A (depends on root)
      const branchA = createDAG({
        id: 'branch-a',
        tasks: [
          createTaskNode({
            id: 'process-a',
            execute: async () => {
              executionLog.push('branch-a:process')
              return 'a-result'
            },
            dependencies: [],
          }),
        ],
        triggers: [{ type: 'dag-complete', source: { dagId: 'root' } }],
      })

      // Branch B (depends on root)
      const branchB = createDAG({
        id: 'branch-b',
        tasks: [
          createTaskNode({
            id: 'process-b',
            execute: async () => {
              executionLog.push('branch-b:process')
              return 'b-result'
            },
            dependencies: [],
          }),
        ],
        triggers: [{ type: 'dag-complete', source: { dagId: 'root' } }],
      })

      // Merge DAG (depends on both branches)
      const mergeDag = createDAG({
        id: 'merge',
        tasks: [
          createTaskNode({
            id: 'merge-results',
            execute: async (ctx) => {
              executionLog.push('merge:merge-results')
              return ctx?.triggerPayload
            },
            dependencies: [],
          }),
        ],
        triggers: [
          { type: 'dag-complete', source: { dagId: 'branch-a' } },
          { type: 'dag-complete', source: { dagId: 'branch-b' } },
        ],
      })

      registry.register(rootDag)
      registry.register(branchA)
      registry.register(branchB)
      registry.register(mergeDag)

      const resolver = createCrossDAGDependencyResolver(registry)
      const executor = createParallelExecutor()

      // Validate structure
      expect(resolver.detectCycles()).toBeNull()
      expect(resolver.getReadyDAGs()).toContain('root')

      // Execute root
      const rootRun = await executor.execute(rootDag)
      registry.recordRun('root', rootRun)

      // Now branches should be ready
      const readyAfterRoot = resolver.getReadyDAGs()
      expect(readyAfterRoot.sort()).toEqual(['branch-a', 'branch-b'])

      // Execute branches in parallel
      const [branchARun, branchBRun] = await Promise.all([
        executor.execute(branchA),
        executor.execute(branchB),
      ])
      registry.recordRun('branch-a', branchARun)
      registry.recordRun('branch-b', branchBRun)

      // Now merge should be ready
      expect(resolver.getReadyDAGs()).toContain('merge')

      // Execute merge
      const mergeRun = await executor.execute(mergeDag)
      registry.recordRun('merge', mergeRun)

      expect(mergeRun.status).toBe('completed')
      expect(executionLog).toContain('root:start')
      expect(executionLog).toContain('branch-a:process')
      expect(executionLog).toContain('branch-b:process')
      expect(executionLog).toContain('merge:merge-results')
    })
  })

  describe('error handling across DAGs', () => {
    it('should handle failure propagation', async () => {
      const failingDag = createDAG({
        id: 'failing',
        tasks: [
          createTaskNode({
            id: 'fail-task',
            execute: async () => {
              throw new Error('DAG failed')
            },
            dependencies: [],
          }),
        ],
      })

      const dependentDag = createDAG({
        id: 'dependent',
        tasks: [createSimpleTask('should-not-run')],
        triggers: [
          {
            type: 'dag-complete',
            source: { dagId: 'failing', condition: 'success' },
          },
        ],
      })

      registry.register(failingDag)
      registry.register(dependentDag)

      const resolver = createCrossDAGDependencyResolver(registry)
      const executor = createParallelExecutor()

      const failingRun = await executor.execute(failingDag)
      registry.recordRun('failing', failingRun)

      expect(failingRun.status).toBe('failed')

      // Dependent should not be ready (requires success)
      const ready = resolver.getReadyDAGs({ condition: 'success' })
      expect(ready).not.toContain('dependent')
    })
  })
})

// ============================================================================
// VALIDATECROSSDAGDEPENDENCIES HELPER
// ============================================================================

describe('validateCrossDAGDependencies', () => {
  it('should validate array of DAGs', () => {
    const dag1 = createDAG({ id: 'dag-1', tasks: [createSimpleTask('a')] })
    const dag2 = createDAG({
      id: 'dag-2',
      tasks: [createSimpleTask('b')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
    })

    expect(() => validateCrossDAGDependencies([dag1, dag2])).not.toThrow()
  })

  it('should detect circular dependencies', () => {
    const dag1 = createDAG({
      id: 'dag-1',
      tasks: [createSimpleTask('a')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'dag-2' } }],
    })
    const dag2 = createDAG({
      id: 'dag-2',
      tasks: [createSimpleTask('b')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'dag-1' } }],
    })

    expect(() => validateCrossDAGDependencies([dag1, dag2])).toThrow(/circular/i)
  })

  it('should detect missing dependencies', () => {
    const dag1 = createDAG({
      id: 'dag-1',
      tasks: [createSimpleTask('a')],
      triggers: [{ type: 'dag-complete', source: { dagId: 'nonexistent' } }],
    })

    expect(() => validateCrossDAGDependencies([dag1])).toThrow(/nonexistent/i)
  })
})
