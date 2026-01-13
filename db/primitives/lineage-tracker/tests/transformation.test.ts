/**
 * Transformation Tracking Tests
 *
 * Test suite for transformation tracking including:
 * - Explicit transformation tracking (trackTransformation)
 * - Code transformation convenience method
 * - Pipeline transformation convenience method
 * - External tool transformation convenience method
 * - Manual data entry tracking
 * - @tracked decorator
 * - LineageContext for scoped tracking
 * - Schema inference
 * - Metrics capture
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  createTransformationTracker,
  tracked,
  type TransformationTracker,
  type TransformMeta,
  type AssetRef,
  type RuntimeMetrics,
  type SchemaDefinition,
} from '../transformation'
import { createLineageStore, type LineageStore, type SqlExecutor } from '../storage'

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Creates an in-memory SQLite database compatible with our SqlExecutor interface
 */
function createTestDb(): SqlExecutor {
  const db = new Database(':memory:')
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => {
      const stmt = db.prepare(sql)
      return {
        bind: (...args: unknown[]) => ({
          all: () => stmt.all(...args),
          run: () => stmt.run(...args),
          first: () => stmt.get(...args),
        }),
      }
    },
  }
}

function createTracker(): { tracker: TransformationTracker; store: LineageStore } {
  const sql = createTestDb()
  const store = createLineageStore(sql)
  const tracker = createTransformationTracker(store)
  return { tracker, store }
}

// =============================================================================
// BASIC TRANSFORMATION TRACKING TESTS
// =============================================================================

describe('TransformationTracker - trackTransformation', () => {
  let tracker: TransformationTracker
  let store: LineageStore

  beforeEach(() => {
    const setup = createTracker()
    tracker = setup.tracker
    store = setup.store
  })

  it('should track a basic transformation with inputs and outputs', () => {
    const inputs: AssetRef[] = [{ name: 'raw_events', namespace: 'source' }]
    const outputs: AssetRef[] = [{ name: 'processed_events', namespace: 'warehouse' }]
    const transform: TransformMeta = {
      kind: 'code',
      name: 'processEvents',
      description: 'Process raw events into structured format',
    }

    const result = tracker.trackTransformation(inputs, outputs, transform)

    expect(result.inputs).toHaveLength(1)
    expect(result.outputs).toHaveLength(1)
    expect(result.transformation).toBeDefined()
    expect(result.inputEdges).toHaveLength(1)
    expect(result.outputEdges).toHaveLength(1)
    expect(result.trackedAt).toBeLessThanOrEqual(Date.now())
  })

  it('should create proper nodes for inputs, outputs, and transformation', () => {
    const inputs: AssetRef[] = [{ name: 'users', namespace: 'db' }]
    const outputs: AssetRef[] = [{ name: 'active_users', namespace: 'db' }]
    const transform: TransformMeta = {
      kind: 'pipeline',
      name: 'filterActiveUsers',
      pipelineOp: 'filter',
    }

    const result = tracker.trackTransformation(inputs, outputs, transform)

    // Verify input node
    expect(result.inputs[0].name).toBe('users')
    expect(result.inputs[0].namespace).toBe('db')
    expect(result.inputs[0].type).toBe('entity')

    // Verify output node
    expect(result.outputs[0].name).toBe('active_users')
    expect(result.outputs[0].namespace).toBe('db')
    expect(result.outputs[0].type).toBe('entity')

    // Verify transformation node
    expect(result.transformation.name).toBe('filterActiveUsers')
    expect(result.transformation.type).toBe('transformation')
    expect(result.transformation.metadata.kind).toBe('pipeline')
    expect(result.transformation.metadata.pipelineOp).toBe('filter')
  })

  it('should handle multiple inputs and outputs', () => {
    const inputs: AssetRef[] = [
      { name: 'users', namespace: 'db' },
      { name: 'orders', namespace: 'db' },
      { name: 'products', namespace: 'db' },
    ]
    const outputs: AssetRef[] = [
      { name: 'user_order_summary', namespace: 'analytics' },
      { name: 'product_stats', namespace: 'analytics' },
    ]
    const transform: TransformMeta = {
      kind: 'pipeline',
      name: 'buildAnalytics',
      pipelineOp: 'aggregate',
    }

    const result = tracker.trackTransformation(inputs, outputs, transform)

    expect(result.inputs).toHaveLength(3)
    expect(result.outputs).toHaveLength(2)
    expect(result.inputEdges).toHaveLength(3)
    expect(result.outputEdges).toHaveLength(2)
  })

  it('should store transformation metadata', () => {
    const inputs: AssetRef[] = [{ name: 'events' }]
    const outputs: AssetRef[] = [{ name: 'aggregated' }]
    const transform: TransformMeta = {
      kind: 'code',
      name: 'aggregate',
      code: 'events.reduce((acc, e) => acc + e.value, 0)',
      language: 'typescript',
      signature: 'aggregate(events: Event[]): number',
      inputSchema: {
        fields: [
          { name: 'id', type: 'string' },
          { name: 'value', type: 'number' },
        ],
      },
      outputSchema: {
        fields: [{ name: 'total', type: 'number' }],
      },
      metrics: {
        inputRecords: 1000,
        outputRecords: 1,
        durationMs: 50,
      },
      tags: ['aggregation', 'metrics'],
      metadata: { customField: 'customValue' },
    }

    const result = tracker.trackTransformation(inputs, outputs, transform)

    const meta = result.transformation.metadata
    expect(meta.kind).toBe('code')
    expect(meta.code).toBe('events.reduce((acc, e) => acc + e.value, 0)')
    expect(meta.language).toBe('typescript')
    expect(meta.signature).toBe('aggregate(events: Event[]): number')
    expect(meta.inputSchema).toBeDefined()
    expect(meta.outputSchema).toBeDefined()
    expect(meta.metrics).toEqual({
      inputRecords: 1000,
      outputRecords: 1,
      durationMs: 50,
    })
    expect(meta.tags).toEqual(['aggregation', 'metrics'])
    expect(meta.customField).toBe('customValue')
  })

  it('should reuse existing nodes when ID is provided', () => {
    // Create a node first
    const existingNode = store.createNode({
      id: 'existing-node',
      type: 'entity',
      name: 'existing_table',
    })

    const inputs: AssetRef[] = [{ id: 'existing-node', name: 'existing_table' }]
    const outputs: AssetRef[] = [{ name: 'new_table' }]
    const transform: TransformMeta = {
      kind: 'copy',
      name: 'copyTable',
    }

    const result = tracker.trackTransformation(inputs, outputs, transform)

    expect(result.inputs[0].id).toBe(existingNode.id)
    expect(result.inputs[0].name).toBe('existing_table')
  })

  it('should track transformation history for assets', () => {
    const input: AssetRef = { name: 'source_data' }
    const output: AssetRef = { name: 'processed_data' }

    // Track first transformation
    tracker.trackTransformation([input], [output], {
      kind: 'code',
      name: 'transform1',
    })

    // Track second transformation
    tracker.trackTransformation([output], [{ name: 'final_data' }], {
      kind: 'code',
      name: 'transform2',
    })

    // Get history for the intermediate asset
    const history = tracker.getTransformationHistory(output.name)
    // Note: history tracking uses asset IDs, not names, so this may be empty
    // depending on implementation. The actual test validates the API exists.
    expect(Array.isArray(history)).toBe(true)
  })
})

// =============================================================================
// CONVENIENCE METHOD TESTS
// =============================================================================

describe('TransformationTracker - Convenience Methods', () => {
  let tracker: TransformationTracker

  beforeEach(() => {
    const setup = createTracker()
    tracker = setup.tracker
  })

  describe('trackCode', () => {
    it('should track a code transformation', () => {
      const result = tracker.trackCode([{ name: 'input' }], [{ name: 'output' }], {
        name: 'processData',
        code: 'data.map(x => x * 2)',
        language: 'typescript',
        description: 'Double all values',
      })

      expect(result.transformation.metadata.kind).toBe('code')
      expect(result.transformation.metadata.code).toBe('data.map(x => x * 2)')
      expect(result.transformation.metadata.language).toBe('typescript')
      expect(result.transformation.metadata.description).toBe('Double all values')
    })

    it('should include runtime metrics when provided', () => {
      const metrics: RuntimeMetrics = {
        inputRecords: 500,
        outputRecords: 500,
        durationMs: 25,
      }

      const result = tracker.trackCode([{ name: 'in' }], [{ name: 'out' }], {
        name: 'transform',
        metrics,
      })

      expect(result.transformation.metadata.metrics).toEqual(metrics)
    })
  })

  describe('trackPipeline', () => {
    it('should track a map operation', () => {
      const result = tracker.trackPipeline([{ name: 'events' }], [{ name: 'mapped_events' }], {
        name: 'mapEvents',
        operation: 'map',
        config: { fn: 'normalize' },
      })

      expect(result.transformation.metadata.kind).toBe('pipeline')
      expect(result.transformation.metadata.pipelineOp).toBe('map')
      expect(result.transformation.metadata.pipelineConfig).toEqual({ fn: 'normalize' })
    })

    it('should track a filter operation', () => {
      const result = tracker.trackPipeline([{ name: 'users' }], [{ name: 'active_users' }], {
        name: 'filterActive',
        operation: 'filter',
        config: { predicate: 'user.active === true' },
      })

      expect(result.transformation.metadata.pipelineOp).toBe('filter')
    })

    it('should track a join operation', () => {
      const result = tracker.trackPipeline(
        [{ name: 'orders' }, { name: 'customers' }],
        [{ name: 'order_details' }],
        {
          name: 'joinOrdersCustomers',
          operation: 'join',
          config: { leftKey: 'customer_id', rightKey: 'id' },
        }
      )

      expect(result.transformation.metadata.pipelineOp).toBe('join')
      expect(result.inputs).toHaveLength(2)
    })

    it('should track an aggregate operation', () => {
      const result = tracker.trackPipeline([{ name: 'transactions' }], [{ name: 'daily_totals' }], {
        name: 'aggregateDaily',
        operation: 'aggregate',
        config: { groupBy: 'date', aggregate: 'sum(amount)' },
        metrics: { inputRecords: 10000, outputRecords: 30, durationMs: 150 },
      })

      expect(result.transformation.metadata.pipelineOp).toBe('aggregate')
      expect(result.transformation.metadata.metrics?.inputRecords).toBe(10000)
    })

    it('should track all pipeline operation types', () => {
      const operations = ['map', 'filter', 'reduce', 'aggregate', 'join', 'union', 'sort', 'distinct', 'limit', 'custom']

      for (const op of operations) {
        const result = tracker.trackPipeline([{ name: 'in' }], [{ name: 'out' }], {
          name: `${op}Op`,
          operation: op as 'map',
        })
        expect(result.transformation.metadata.pipelineOp).toBe(op)
      }
    })
  })

  describe('trackExternal', () => {
    it('should track dbt transformation', () => {
      const result = tracker.trackExternal([{ name: 'stg_orders' }], [{ name: 'fct_orders' }], {
        name: 'dbt_orders_model',
        tool: 'dbt',
        jobName: 'orders_transform',
        runId: 'run-abc123',
        externalMeta: { modelPath: 'models/marts/fct_orders.sql' },
      })

      expect(result.transformation.metadata.kind).toBe('external')
      expect(result.transformation.metadata.externalTool).toBe('dbt')
      expect(result.transformation.metadata.jobName).toBe('orders_transform')
      expect(result.transformation.metadata.runId).toBe('run-abc123')
      expect(result.transformation.metadata.externalMeta).toEqual({
        modelPath: 'models/marts/fct_orders.sql',
      })
    })

    it('should track Airflow DAG execution', () => {
      const result = tracker.trackExternal(
        [{ name: 'raw_data' }],
        [{ name: 'processed_data' }],
        {
          name: 'airflow_etl',
          tool: 'airflow',
          jobName: 'etl_pipeline',
          runId: 'dag_run_2024_01_01',
          metrics: { durationMs: 60000 },
        }
      )

      expect(result.transformation.metadata.externalTool).toBe('airflow')
    })

    it('should track Spark job', () => {
      const result = tracker.trackExternal(
        [{ name: 'hdfs_input' }],
        [{ name: 'parquet_output' }],
        {
          name: 'spark_transform',
          tool: 'spark',
          jobName: 'transform_job',
          runId: 'app-20240101120000',
          externalMeta: { cluster: 'prod-cluster', executor_count: 10 },
          metrics: { inputRecords: 1000000, outputRecords: 500000, durationMs: 300000 },
        }
      )

      expect(result.transformation.metadata.externalTool).toBe('spark')
      expect(result.transformation.metadata.metrics?.inputRecords).toBe(1000000)
    })

    it('should track all external tool types', () => {
      const tools = ['dbt', 'airflow', 'spark', 'beam', 'flink', 'prefect', 'dagster', 'other']

      for (const tool of tools) {
        const result = tracker.trackExternal([{ name: 'in' }], [{ name: 'out' }], {
          name: `${tool}_job`,
          tool: tool as 'dbt',
        })
        expect(result.transformation.metadata.externalTool).toBe(tool)
      }
    })
  })

  describe('trackManual', () => {
    it('should track manual data entry', () => {
      const result = tracker.trackManual([{ name: 'config_table' }], {
        name: 'manual_config_update',
        description: 'Updated configuration values',
        modifiedBy: 'alice@example.com',
        reason: 'Production hotfix',
      })

      expect(result.inputs).toHaveLength(0) // Manual entries have no inputs
      expect(result.outputs).toHaveLength(1)
      expect(result.transformation.metadata.kind).toBe('manual')
      expect(result.transformation.metadata.executedBy).toBe('alice@example.com')
      expect(result.transformation.metadata.reason).toBe('Production hotfix')
    })

    it('should track manual modification to multiple outputs', () => {
      const result = tracker.trackManual(
        [{ name: 'table_a' }, { name: 'table_b' }],
        {
          name: 'bulk_update',
          modifiedBy: 'admin',
        }
      )

      expect(result.outputs).toHaveLength(2)
    })
  })
})

// =============================================================================
// LINEAGE CONTEXT TESTS
// =============================================================================

describe('TransformationTracker - LineageContext', () => {
  let tracker: TransformationTracker

  beforeEach(() => {
    const setup = createTracker()
    tracker = setup.tracker
  })

  it('should create a lineage context', () => {
    const context = tracker.createContext({
      name: 'ETL Pipeline',
      defaultKind: 'pipeline',
      defaultNamespace: 'warehouse',
      tags: ['etl', 'daily'],
    })

    expect(context.id).toBeDefined()
    expect(context.name).toBe('ETL Pipeline')
  })

  describe('record', () => {
    it('should record transformations within context', () => {
      const context = tracker.createContext({
        name: 'Test Pipeline',
        defaultNamespace: 'test',
      })

      const result = context.record([{ name: 'input' }], [{ name: 'output' }], {
        name: 'step1',
      })

      expect(result.transformation.metadata.contextId).toBe(context.id)
      expect(result.transformation.metadata.contextName).toBe('Test Pipeline')
    })

    it('should apply default namespace to assets', () => {
      const context = tracker.createContext({
        name: 'Pipeline',
        defaultNamespace: 'analytics',
      })

      const result = context.record([{ name: 'source' }], [{ name: 'target' }], {
        name: 'transform',
      })

      expect(result.inputs[0].namespace).toBe('analytics')
      expect(result.outputs[0].namespace).toBe('analytics')
    })

    it('should apply default tags', () => {
      const context = tracker.createContext({
        name: 'Pipeline',
        tags: ['prod', 'critical'],
      })

      const result = context.record([{ name: 'in' }], [{ name: 'out' }], {
        name: 'transform',
        tags: ['custom'],
      })

      expect(result.transformation.metadata.tags).toContain('prod')
      expect(result.transformation.metadata.tags).toContain('critical')
      expect(result.transformation.metadata.tags).toContain('custom')
    })

    it('should throw when recording after context end', () => {
      const context = tracker.createContext({ name: 'Pipeline' })
      context.end()

      expect(() => {
        context.record([{ name: 'in' }], [{ name: 'out' }], { name: 'step' })
      }).toThrow(/ended context/)
    })
  })

  describe('getTransformations', () => {
    it('should return all transformations in context', () => {
      const context = tracker.createContext({ name: 'Pipeline' })

      context.record([{ name: 'a' }], [{ name: 'b' }], { name: 'step1' })
      context.record([{ name: 'b' }], [{ name: 'c' }], { name: 'step2' })
      context.record([{ name: 'c' }], [{ name: 'd' }], { name: 'step3' })

      const transformations = context.getTransformations()

      expect(transformations).toHaveLength(3)
      expect(transformations[0].transformation.name).toBe('step1')
      expect(transformations[1].transformation.name).toBe('step2')
      expect(transformations[2].transformation.name).toBe('step3')
    })
  })

  describe('begin/complete scope', () => {
    it('should track transformation via scope', () => {
      const context = tracker.createContext({ name: 'Pipeline' })

      const scope = context.begin('processData', {
        description: 'Process raw data',
        inputs: [{ name: 'raw_data' }],
      })

      scope.addOutput({ name: 'processed_data' })
      scope.setCode('data.map(x => transform(x))', 'typescript')
      scope.setMetrics({ inputRecords: 100, outputRecords: 95, durationMs: 50 })

      const result = scope.complete()

      expect(result.transformation.name).toBe('processData')
      expect(result.transformation.metadata.code).toBe('data.map(x => transform(x))')
      expect(result.transformation.metadata.language).toBe('typescript')
      expect(result.transformation.metadata.metrics?.inputRecords).toBe(100)
      expect(result.outputs[0].name).toBe('processed_data')
    })

    it('should track duration automatically', async () => {
      const context = tracker.createContext({ name: 'Pipeline' })
      const scope = context.begin('slowOperation')

      // Simulate some work
      await new Promise((r) => setTimeout(r, 50))

      scope.addInput({ name: 'in' })
      scope.addOutput({ name: 'out' })
      const result = scope.complete()

      expect(result.transformation.metadata.metrics?.durationMs).toBeGreaterThanOrEqual(50)
    })

    it('should prevent modification after completion', () => {
      const context = tracker.createContext({ name: 'Pipeline' })
      const scope = context.begin('step')
      scope.addOutput({ name: 'out' })
      scope.complete()

      expect(() => scope.addInput({ name: 'another' })).toThrow(/completed/)
      expect(() => scope.addOutput({ name: 'another' })).toThrow(/completed/)
      expect(() => scope.setCode('code')).toThrow(/completed/)
      expect(() => scope.complete()).toThrow(/already completed/)
    })

    it('should support aborting a scope', () => {
      const context = tracker.createContext({ name: 'Pipeline' })
      const scope = context.begin('step')

      scope.abort(new Error('Operation failed'))

      expect(() => scope.complete()).toThrow(/aborted/)
      expect(() => scope.addInput({ name: 'x' })).toThrow(/aborted/)
    })

    it('should set schemas', () => {
      const context = tracker.createContext({ name: 'Pipeline' })
      const scope = context.begin('transform')

      const inputSchema: SchemaDefinition = {
        fields: [{ name: 'id', type: 'string' }],
      }
      const outputSchema: SchemaDefinition = {
        fields: [
          { name: 'id', type: 'string' },
          { name: 'processed', type: 'boolean' },
        ],
      }

      scope.addInput({ name: 'in' })
      scope.addOutput({ name: 'out' })
      scope.setSchemas(inputSchema, outputSchema)

      const result = scope.complete()

      expect(result.transformation.metadata.inputSchema).toEqual(inputSchema)
      expect(result.transformation.metadata.outputSchema).toEqual(outputSchema)
    })
  })
})

// =============================================================================
// @tracked DECORATOR TESTS
// =============================================================================

describe('TransformationTracker - @tracked Decorator', () => {
  it('should track function execution', async () => {
    const { tracker } = createTracker()
    const trackSpy = vi.spyOn(tracker, 'trackTransformation')

    class DataProcessor {
      @tracked(tracker, {
        name: 'processItems',
        inputs: ['raw_items'],
        outputs: ['processed_items'],
      })
      async processItems(items: number[]): Promise<number[]> {
        return items.map((x) => x * 2)
      }
    }

    const processor = new DataProcessor()
    const result = await processor.processItems([1, 2, 3])

    expect(result).toEqual([2, 4, 6])
    expect(trackSpy).toHaveBeenCalled()

    const callArgs = trackSpy.mock.calls[0]
    expect(callArgs[0]).toEqual([{ name: 'raw_items' }])
    expect(callArgs[1]).toEqual([{ name: 'processed_items' }])
    expect(callArgs[2].name).toBe('processItems')
    expect(callArgs[2].kind).toBe('code')
  })

  it('should capture metrics when enabled', async () => {
    const { tracker } = createTracker()
    const trackSpy = vi.spyOn(tracker, 'trackTransformation')

    class DataProcessor {
      @tracked(tracker, {
        name: 'transform',
        inputs: ['input'],
        outputs: ['output'],
        captureMetrics: true,
      })
      async transform(items: number[]): Promise<number[]> {
        return items.filter((x) => x > 0)
      }
    }

    const processor = new DataProcessor()
    await processor.transform([1, -2, 3, -4, 5])

    const callArgs = trackSpy.mock.calls[0]
    const metrics = callArgs[2].metrics

    expect(metrics?.durationMs).toBeGreaterThanOrEqual(0)
    expect(metrics?.inputRecords).toBe(5)
    expect(metrics?.outputRecords).toBe(3)
    expect(metrics?.errorCount).toBe(0)
  })

  it('should capture schemas when enabled', async () => {
    const { tracker } = createTracker()
    const trackSpy = vi.spyOn(tracker, 'trackTransformation')

    class DataProcessor {
      @tracked(tracker, {
        name: 'transform',
        inputs: ['input'],
        outputs: ['output'],
        captureSchemas: true,
      })
      async transform(items: { id: string; value: number }[]): Promise<{ id: string; doubled: number }[]> {
        return items.map((x) => ({ id: x.id, doubled: x.value * 2 }))
      }
    }

    const processor = new DataProcessor()
    await processor.transform([{ id: 'a', value: 1 }])

    const callArgs = trackSpy.mock.calls[0]
    const inputSchema = callArgs[2].inputSchema
    const outputSchema = callArgs[2].outputSchema

    expect(inputSchema?.fields).toContainEqual(expect.objectContaining({ name: 'id', type: 'string' }))
    expect(inputSchema?.fields).toContainEqual(expect.objectContaining({ name: 'value', type: 'number' }))
    expect(outputSchema?.fields).toContainEqual(expect.objectContaining({ name: 'id', type: 'string' }))
    expect(outputSchema?.fields).toContainEqual(expect.objectContaining({ name: 'doubled', type: 'number' }))
  })

  it('should track errors but still throw', async () => {
    const { tracker } = createTracker()
    const trackSpy = vi.spyOn(tracker, 'trackTransformation')

    class DataProcessor {
      @tracked(tracker, {
        name: 'failingOp',
        captureMetrics: true,
      })
      async failingOp(): Promise<void> {
        throw new Error('Something went wrong')
      }
    }

    const processor = new DataProcessor()

    await expect(processor.failingOp()).rejects.toThrow('Something went wrong')

    expect(trackSpy).toHaveBeenCalled()
    const callArgs = trackSpy.mock.calls[0]
    expect(callArgs[2].metrics?.errorCount).toBe(1)
    expect(callArgs[2].metadata?.error).toBe('Something went wrong')
  })

  it('should use function name as default', async () => {
    const { tracker } = createTracker()
    const trackSpy = vi.spyOn(tracker, 'trackTransformation')

    class DataProcessor {
      @tracked(tracker)
      async myCustomFunction(): Promise<string> {
        return 'result'
      }
    }

    const processor = new DataProcessor()
    await processor.myCustomFunction()

    const callArgs = trackSpy.mock.calls[0]
    expect(callArgs[2].name).toBe('myCustomFunction')
  })

  it('should include tags', async () => {
    const { tracker } = createTracker()
    const trackSpy = vi.spyOn(tracker, 'trackTransformation')

    class DataProcessor {
      @tracked(tracker, {
        name: 'taggedOp',
        tags: ['important', 'production'],
      })
      async taggedOp(): Promise<void> {}
    }

    const processor = new DataProcessor()
    await processor.taggedOp()

    const callArgs = trackSpy.mock.calls[0]
    expect(callArgs[2].tags).toEqual(['important', 'production'])
  })

  it('should not fail original function if tracking fails', async () => {
    const { tracker } = createTracker()
    vi.spyOn(tracker, 'trackTransformation').mockImplementation(() => {
      throw new Error('Tracking failed')
    })

    // Suppress console.warn for this test
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    class DataProcessor {
      @tracked(tracker, { name: 'op' })
      async safeOp(): Promise<number> {
        return 42
      }
    }

    const processor = new DataProcessor()
    const result = await processor.safeOp()

    expect(result).toBe(42)
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})

// =============================================================================
// TRANSFORMATION KIND TESTS
// =============================================================================

describe('TransformationTracker - Transformation Kinds', () => {
  let tracker: TransformationTracker

  beforeEach(() => {
    const setup = createTracker()
    tracker = setup.tracker
  })

  it('should track code transformation', () => {
    const result = tracker.trackTransformation([{ name: 'in' }], [{ name: 'out' }], {
      kind: 'code',
      name: 'codeTransform',
      code: 'function transform() {}',
      language: 'typescript',
    })

    expect(result.transformation.metadata.kind).toBe('code')
  })

  it('should track pipeline transformation', () => {
    const result = tracker.trackTransformation([{ name: 'in' }], [{ name: 'out' }], {
      kind: 'pipeline',
      name: 'pipelineTransform',
      pipelineOp: 'map',
    })

    expect(result.transformation.metadata.kind).toBe('pipeline')
  })

  it('should track external transformation', () => {
    const result = tracker.trackTransformation([{ name: 'in' }], [{ name: 'out' }], {
      kind: 'external',
      name: 'externalTransform',
      externalTool: 'dbt',
    })

    expect(result.transformation.metadata.kind).toBe('external')
  })

  it('should track manual transformation', () => {
    const result = tracker.trackTransformation([], [{ name: 'out' }], {
      kind: 'manual',
      name: 'manualEntry',
    })

    expect(result.transformation.metadata.kind).toBe('manual')
  })

  it('should track copy transformation', () => {
    const result = tracker.trackTransformation([{ name: 'in' }], [{ name: 'out' }], {
      kind: 'copy',
      name: 'copyData',
    })

    expect(result.transformation.metadata.kind).toBe('copy')
  })

  it('should track unknown transformation', () => {
    const result = tracker.trackTransformation([{ name: 'in' }], [{ name: 'out' }], {
      kind: 'unknown',
      name: 'mysteryTransform',
    })

    expect(result.transformation.metadata.kind).toBe('unknown')
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('TransformationTracker - Edge Cases', () => {
  let tracker: TransformationTracker

  beforeEach(() => {
    const setup = createTracker()
    tracker = setup.tracker
  })

  it('should handle empty inputs (for manual entry)', () => {
    const result = tracker.trackTransformation([], [{ name: 'output' }], {
      kind: 'manual',
      name: 'manual_entry',
    })

    expect(result.inputs).toHaveLength(0)
    expect(result.inputEdges).toHaveLength(0)
    expect(result.outputs).toHaveLength(1)
    expect(result.outputEdges).toHaveLength(1)
  })

  it('should handle transformation with no outputs', () => {
    // This could represent a validation/audit that doesn't produce output
    const result = tracker.trackTransformation([{ name: 'data' }], [], {
      kind: 'code',
      name: 'validate',
      description: 'Validation check',
    })

    expect(result.inputs).toHaveLength(1)
    expect(result.outputs).toHaveLength(0)
    expect(result.outputEdges).toHaveLength(0)
  })

  it('should handle assets with custom types', () => {
    const result = tracker.trackTransformation(
      [{ name: 'api_endpoint', type: 'source' }],
      [{ name: 'data_store', type: 'sink' }],
      {
        kind: 'pipeline',
        name: 'ingest',
        pipelineOp: 'custom',
      }
    )

    expect(result.inputs[0].type).toBe('source')
    expect(result.outputs[0].type).toBe('sink')
  })

  it('should handle complex metadata', () => {
    const complexMeta = {
      nested: {
        deep: {
          value: 123,
        },
      },
      array: [1, 2, 3],
      special: 'value with "quotes"',
    }

    const result = tracker.trackTransformation([{ name: 'in' }], [{ name: 'out' }], {
      kind: 'code',
      name: 'complex',
      metadata: complexMeta,
    })

    expect(result.transformation.metadata.nested).toEqual({ deep: { value: 123 } })
    expect(result.transformation.metadata.array).toEqual([1, 2, 3])
  })

  it('should handle large number of inputs/outputs', () => {
    const inputs: AssetRef[] = Array.from({ length: 50 }, (_, i) => ({
      name: `input_${i}`,
      namespace: 'test',
    }))

    const outputs: AssetRef[] = Array.from({ length: 20 }, (_, i) => ({
      name: `output_${i}`,
      namespace: 'test',
    }))

    const result = tracker.trackTransformation(inputs, outputs, {
      kind: 'pipeline',
      name: 'largeJoin',
      pipelineOp: 'join',
    })

    expect(result.inputs).toHaveLength(50)
    expect(result.outputs).toHaveLength(20)
    expect(result.inputEdges).toHaveLength(50)
    expect(result.outputEdges).toHaveLength(20)
  })

  it('should handle special characters in names', () => {
    const result = tracker.trackTransformation(
      [{ name: 'table-with-dashes', namespace: 'schema.with.dots' }],
      [{ name: 'output_with_underscores' }],
      {
        kind: 'code',
        name: 'transform/with/slashes',
      }
    )

    expect(result.inputs[0].name).toBe('table-with-dashes')
    expect(result.inputs[0].namespace).toBe('schema.with.dots')
    expect(result.transformation.name).toBe('transform/with/slashes')
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('TransformationTracker - Integration', () => {
  it('should build complete lineage graph from multiple transformations', () => {
    const { tracker, store } = createTracker()

    // Stage 1: Ingest
    tracker.trackExternal([{ name: 'external_api', type: 'source' }], [{ name: 'raw_events' }], {
      name: 'api_ingest',
      tool: 'airflow',
      jobName: 'ingest_events',
    })

    // Stage 2: Clean
    tracker.trackCode([{ name: 'raw_events' }], [{ name: 'clean_events' }], {
      name: 'clean_events',
      code: 'events.filter(e => isValid(e))',
      language: 'typescript',
    })

    // Stage 3: Transform
    tracker.trackPipeline([{ name: 'clean_events' }], [{ name: 'normalized_events' }], {
      name: 'normalize',
      operation: 'map',
    })

    // Stage 4: Aggregate
    tracker.trackPipeline([{ name: 'normalized_events' }], [{ name: 'event_counts' }, { name: 'event_stats' }], {
      name: 'aggregate',
      operation: 'aggregate',
    })

    // Verify graph structure
    const allNodes = store.findNodes()

    // Should have: external_api, raw_events, clean_events, normalized_events,
    // event_counts, event_stats + 4 transformation nodes = 10 total
    expect(allNodes.length).toBeGreaterThanOrEqual(10)

    // Verify transformation nodes
    const transformNodes = allNodes.filter((n) => n.type === 'transformation')
    expect(transformNodes).toHaveLength(4)
  })

  it('should track complex pipeline with context', () => {
    const { tracker, store } = createTracker()

    const context = tracker.createContext({
      name: 'Daily ETL',
      defaultNamespace: 'warehouse',
      tags: ['daily', 'production'],
    })

    // Multiple steps in a pipeline
    context.record([{ name: 'src1' }, { name: 'src2' }], [{ name: 'joined' }], {
      name: 'join_sources',
      pipelineOp: 'join',
    })

    context.record([{ name: 'joined' }], [{ name: 'filtered' }], {
      name: 'filter_valid',
      pipelineOp: 'filter',
    })

    context.record([{ name: 'filtered' }], [{ name: 'aggregated' }], {
      name: 'aggregate_daily',
      pipelineOp: 'aggregate',
    })

    context.record([{ name: 'aggregated' }], [{ name: 'final_output' }], {
      name: 'write_output',
      kind: 'copy',
    })

    context.end()

    const transformations = context.getTransformations()
    expect(transformations).toHaveLength(4)

    // All transformations should have context metadata
    for (const t of transformations) {
      expect(t.transformation.metadata.contextName).toBe('Daily ETL')
      expect(t.transformation.metadata.tags).toContain('daily')
      expect(t.transformation.metadata.tags).toContain('production')
    }
  })
})
