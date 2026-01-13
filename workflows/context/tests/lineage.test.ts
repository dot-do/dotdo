/**
 * Tests for Lineage Context API ($.lineage)
 *
 * Tests the integration of LineageTracker with the $ workflow context.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createLineageContext, type LineageContextResult } from '../lineage'

describe('Lineage Context API', () => {
  let $: LineageContextResult

  beforeEach(() => {
    $ = createLineageContext()
  })

  describe('Core Tracking', () => {
    it('should track a transformation between assets', () => {
      const result = $.lineage.track(
        [{ name: 'raw_events' }],
        [{ name: 'processed_events' }],
        { name: 'processEvents', kind: 'code' }
      )

      expect(result.inputs).toHaveLength(1)
      expect(result.outputs).toHaveLength(1)
      expect(result.transformation).toBeDefined()
      expect(result.transformation.name).toBe('processEvents')
      expect(result.transformation.type).toBe('transformation')
      expect(result.inputEdges).toHaveLength(1)
      expect(result.outputEdges).toHaveLength(1)
    })

    it('should track multiple inputs and outputs', () => {
      const result = $.lineage.track(
        [{ name: 'users' }, { name: 'orders' }],
        [{ name: 'user_orders' }],
        { name: 'joinUsersOrders', kind: 'pipeline' }
      )

      expect(result.inputs).toHaveLength(2)
      expect(result.outputs).toHaveLength(1)
      expect(result.inputEdges).toHaveLength(2)
      expect(result.outputEdges).toHaveLength(1)
    })

    it('should reuse existing nodes by name', () => {
      // First transformation
      $.lineage.track(
        [{ name: 'source' }],
        [{ name: 'intermediate' }],
        { name: 'step1' }
      )

      // Second transformation using same intermediate node
      $.lineage.track(
        [{ name: 'intermediate' }],
        [{ name: 'final' }],
        { name: 'step2' }
      )

      const stats = $.lineage.stats()
      // source, intermediate, final + 2 transformation nodes = 5
      expect(stats.nodeCount).toBe(5)
    })
  })

  describe('record() convenience method', () => {
    it('should record a simple data flow', () => {
      const result = $.lineage.record('users', 'active_users', {
        operation: 'filter',
      })

      expect(result.source.name).toBe('users')
      expect(result.target.name).toBe('active_users')
      expect(result.edge.operation).toBe('filter')
    })

    it('should accept AssetRef objects', () => {
      const result = $.lineage.record(
        { name: 'orders', namespace: 'sales' },
        { name: 'order_summary', namespace: 'analytics' },
        { operation: 'aggregate', metadata: { period: 'daily' } }
      )

      expect(result.source.namespace).toBe('sales')
      expect(result.target.namespace).toBe('analytics')
      expect(result.edge.metadata).toEqual({ period: 'daily' })
    })
  })

  describe('Convenience tracking methods', () => {
    it('should track code transformations', () => {
      const result = $.lineage.trackCode(
        [{ name: 'input' }],
        [{ name: 'output' }],
        {
          name: 'transform',
          code: 'data.map(x => x * 2)',
          language: 'typescript',
        }
      )

      expect(result.transformation.metadata.kind).toBe('code')
      expect(result.transformation.metadata.language).toBe('typescript')
      expect(result.transformation.metadata.code).toBe('data.map(x => x * 2)')
    })

    it('should track pipeline stages', () => {
      const result = $.lineage.trackPipeline(
        [{ name: 'data' }],
        [{ name: 'filtered_data' }],
        {
          name: 'filterActive',
          operation: 'filter',
          config: { field: 'status', value: 'active' },
        }
      )

      expect(result.transformation.metadata.kind).toBe('pipeline')
      expect(result.transformation.metadata.pipelineOp).toBe('filter')
    })

    it('should track external tool executions', () => {
      const result = $.lineage.trackExternal(
        [{ name: 'staging' }],
        [{ name: 'warehouse' }],
        {
          name: 'dbt_transform',
          tool: 'dbt',
          jobName: 'staging_to_warehouse',
          runId: 'run-123',
        }
      )

      expect(result.transformation.metadata.kind).toBe('external')
      expect(result.transformation.metadata.externalTool).toBe('dbt')
      expect(result.transformation.metadata.runId).toBe('run-123')
    })

    it('should track manual data entry', () => {
      const result = $.lineage.trackManual([{ name: 'corrections' }], {
        name: 'manual_correction',
        description: 'Fixed invalid data',
        modifiedBy: 'admin',
        reason: 'Data quality issue',
      })

      expect(result.inputs).toHaveLength(0) // Manual has no inputs
      expect(result.transformation.metadata.kind).toBe('manual')
      expect(result.transformation.metadata.reason).toBe('Data quality issue')
    })
  })

  describe('Node & Edge Operations', () => {
    it('should create and retrieve nodes', () => {
      const node = $.lineage.createNode({
        type: 'source',
        name: 'external_api',
        namespace: 'integrations',
        metadata: { url: 'https://api.example.com' },
      })

      expect(node.id).toBeDefined()
      expect(node.name).toBe('external_api')

      const retrieved = $.lineage.getNode(node.id)
      expect(retrieved).toEqual(node)
    })

    it('should create and retrieve edges', () => {
      const source = $.lineage.createNode({ type: 'source', name: 'source' })
      const target = $.lineage.createNode({ type: 'sink', name: 'sink' })

      const edge = $.lineage.createEdge({
        fromNodeId: source.id,
        toNodeId: target.id,
        operation: 'write',
        metadata: { format: 'parquet' },
      })

      expect(edge.id).toBeDefined()
      expect(edge.operation).toBe('write')

      const retrieved = $.lineage.getEdge(edge.id)
      expect(retrieved).toEqual(edge)
    })

    it('should return null for non-existent nodes and edges', () => {
      expect($.lineage.getNode('non-existent')).toBeNull()
      expect($.lineage.getEdge('non-existent')).toBeNull()
    })
  })

  describe('Lineage Queries', () => {
    beforeEach(() => {
      // Build a sample lineage graph:
      // source_a -> transform_1 -> intermediate
      // source_b -> transform_1
      // intermediate -> transform_2 -> final
      $.lineage.track(
        [{ name: 'source_a' }, { name: 'source_b' }],
        [{ name: 'intermediate' }],
        { name: 'transform_1' }
      )
      $.lineage.track(
        [{ name: 'intermediate' }],
        [{ name: 'final' }],
        { name: 'transform_2' }
      )
    })

    it('should get upstream dependencies', () => {
      // Find the intermediate node
      const intermediate = [...$._storage.nodes.values()].find(
        (n) => n.name === 'intermediate'
      )!

      const upstream = $.lineage.upstream(intermediate.id)

      expect(upstream.rootId).toBe(intermediate.id)
      // Should include source_a, source_b, transform_1, and intermediate
      expect(upstream.nodes.length).toBeGreaterThanOrEqual(3)
    })

    it('should get downstream dependents', () => {
      const sourceA = [...$._storage.nodes.values()].find(
        (n) => n.name === 'source_a'
      )!

      const downstream = $.lineage.downstream(sourceA.id)

      expect(downstream.rootId).toBe(sourceA.id)
      // Should include transform_1, intermediate, transform_2, final
      expect(downstream.nodes.length).toBeGreaterThanOrEqual(3)
    })

    it('should get full lineage in both directions', () => {
      const intermediate = [...$._storage.nodes.values()].find(
        (n) => n.name === 'intermediate'
      )!

      const full = $.lineage.full(intermediate.id)

      // Should include all nodes
      expect(full.nodes.length).toBeGreaterThanOrEqual(5)
    })

    it('should respect maxDepth option', () => {
      const sourceA = [...$._storage.nodes.values()].find(
        (n) => n.name === 'source_a'
      )!

      const shallow = $.lineage.downstream(sourceA.id, { maxDepth: 1 })
      const deep = $.lineage.downstream(sourceA.id, { maxDepth: 10 })

      expect(shallow.nodes.length).toBeLessThanOrEqual(deep.nodes.length)
    })

    it('should find paths between nodes', () => {
      const sourceA = [...$._storage.nodes.values()].find(
        (n) => n.name === 'source_a'
      )!
      const final = [...$._storage.nodes.values()].find(
        (n) => n.name === 'final'
      )!

      const paths = $.lineage.paths(sourceA.id, final.id)

      expect(paths.length).toBeGreaterThanOrEqual(1)
      expect(paths[0].nodeIds[0]).toBe(sourceA.id)
    })

    it('should get immediate parents and children', () => {
      const intermediate = [...$._storage.nodes.values()].find(
        (n) => n.name === 'intermediate'
      )!

      const parents = $.lineage.parents(intermediate.id)
      const children = $.lineage.children(intermediate.id)

      // Parent should be transform_1
      expect(parents.length).toBe(1)
      expect(parents[0].type).toBe('transformation')

      // Child should be transform_2
      expect(children.length).toBe(1)
      expect(children[0].type).toBe('transformation')
    })
  })

  describe('Impact Analysis', () => {
    beforeEach(() => {
      // Build a diamond graph:
      // source -> t1 -> intermediate1 -> t3 -> final
      //        -> t2 -> intermediate2 -> t3
      $.lineage.track([{ name: 'source' }], [{ name: 'intermediate1' }], {
        name: 't1',
      })
      $.lineage.track([{ name: 'source' }], [{ name: 'intermediate2' }], {
        name: 't2',
      })
      $.lineage.track(
        [{ name: 'intermediate1' }, { name: 'intermediate2' }],
        [{ name: 'final' }],
        { name: 't3' }
      )
    })

    it('should analyze impact of changes', () => {
      const source = [...$._storage.nodes.values()].find(
        (n) => n.name === 'source'
      )!

      const impact = $.lineage.impact(source.id)

      expect(impact.sourceNode.id).toBe(source.id)
      expect(impact.totalAffected).toBeGreaterThan(0)
      expect(impact.metrics.maxDepth).toBeGreaterThan(0)
    })

    it('should calculate blast radius', () => {
      const source = [...$._storage.nodes.values()].find(
        (n) => n.name === 'source'
      )!

      const blast = $.lineage.blastRadius(source.id)

      expect(blast.totalAffected).toBeGreaterThan(0)
      expect(blast.maxDepth).toBeGreaterThan(0)
    })

    it('should throw for non-existent node', () => {
      expect(() => $.lineage.impact('non-existent')).toThrow('Node not found')
    })
  })

  describe('Graph Operations', () => {
    it('should find root nodes', () => {
      $.lineage.track([{ name: 'root1' }], [{ name: 'child' }], { name: 't1' })
      $.lineage.track([{ name: 'root2' }], [{ name: 'child' }], { name: 't2' })

      const roots = $.lineage.roots()

      const rootNames = roots.map((r) => r.name)
      expect(rootNames).toContain('root1')
      expect(rootNames).toContain('root2')
    })

    it('should find leaf nodes', () => {
      $.lineage.track([{ name: 'parent' }], [{ name: 'leaf1' }], { name: 't1' })
      $.lineage.track([{ name: 'parent' }], [{ name: 'leaf2' }], { name: 't2' })

      const leaves = $.lineage.leaves()

      const leafNames = leaves.map((l) => l.name)
      expect(leafNames).toContain('leaf1')
      expect(leafNames).toContain('leaf2')
    })

    it('should return graph statistics', () => {
      $.lineage.track([{ name: 'source' }], [{ name: 'target' }], {
        name: 'transform',
      })

      const stats = $.lineage.stats()

      expect(stats.nodeCount).toBeGreaterThan(0)
      expect(stats.edgeCount).toBeGreaterThan(0)
      expect(stats.nodesByType.entity).toBeGreaterThan(0)
      expect(stats.nodesByType.transformation).toBeGreaterThan(0)
    })

    it('should clear all lineage data', () => {
      $.lineage.track([{ name: 'source' }], [{ name: 'target' }], {
        name: 'transform',
      })

      $.lineage.clear()

      const stats = $.lineage.stats()
      expect(stats.nodeCount).toBe(0)
      expect(stats.edgeCount).toBe(0)
    })
  })

  describe('Scoped Context', () => {
    it('should create a scoped context', () => {
      const ctx = $.lineage.createContext({ name: 'etl-pipeline' })

      expect(ctx.id).toBeDefined()
      expect(ctx.name).toBe('etl-pipeline')
    })

    it('should track transformations within a scope', () => {
      const ctx = $.lineage.createContext({ name: 'etl-pipeline' })

      const scope = ctx.begin('extract', { inputs: [{ name: 'source_db' }] })
      scope.addOutput({ name: 'staging_table' })
      const result = scope.complete()

      expect(result.transformation.name).toBe('extract')
      expect(result.inputs).toHaveLength(1)
      expect(result.outputs).toHaveLength(1)
    })

    it('should record transformations directly', () => {
      const ctx = $.lineage.createContext({ name: 'etl-pipeline' })

      const result = ctx.record(
        [{ name: 'input' }],
        [{ name: 'output' }],
        { name: 'quick-transform' }
      )

      expect(result.transformation.name).toBe('quick-transform')
    })

    it('should track all transformations in context', () => {
      const ctx = $.lineage.createContext({ name: 'etl-pipeline' })

      ctx.record([{ name: 'a' }], [{ name: 'b' }], { name: 't1' })
      ctx.record([{ name: 'b' }], [{ name: 'c' }], { name: 't2' })

      const transformations = ctx.getTransformations()
      expect(transformations).toHaveLength(2)
    })

    it('should prevent modifications after end()', () => {
      const ctx = $.lineage.createContext({ name: 'pipeline' })
      ctx.end()

      expect(() => ctx.begin('step')).toThrow('ended context')
      expect(() =>
        ctx.record([{ name: 'a' }], [{ name: 'b' }], { name: 't' })
      ).toThrow('ended context')
    })

    it('should handle scope completion with metrics', () => {
      const ctx = $.lineage.createContext({ name: 'pipeline' })
      const scope = ctx.begin('transform')

      scope.addInput({ name: 'input' })
      scope.addOutput({ name: 'output' })
      scope.setMetrics({ inputRecords: 100, outputRecords: 95, durationMs: 150 })
      scope.setCode('data.filter(x => x.valid)', 'typescript')

      const result = scope.complete()

      expect(result.transformation.metadata.metrics).toEqual({
        inputRecords: 100,
        outputRecords: 95,
        durationMs: 150,
      })
    })

    it('should prevent scope modifications after complete()', () => {
      const ctx = $.lineage.createContext({ name: 'pipeline' })
      const scope = ctx.begin('step')
      scope.addOutput({ name: 'output' })
      scope.complete()

      expect(() => scope.addInput({ name: 'late_input' })).toThrow('completed')
      expect(() => scope.complete()).toThrow('already completed')
    })

    it('should handle scope abort', () => {
      const ctx = $.lineage.createContext({ name: 'pipeline' })
      const scope = ctx.begin('step')
      scope.abort(new Error('Failed'))

      expect(() => scope.complete()).toThrow('aborted')
    })
  })

  describe('Function Wrapping', () => {
    it('should wrap a function with lineage tracking', async () => {
      const processData = (data: number[]) => data.map((x) => x * 2)

      const trackedProcess = $.lineage.wrap(processData, {
        name: 'doubleValues',
        inputs: ['raw_numbers'],
        outputs: ['doubled_numbers'],
        captureMetrics: true,
      })

      const result = await trackedProcess([1, 2, 3])

      expect(result).toEqual([2, 4, 6])

      const stats = $.lineage.stats()
      expect(stats.nodeCount).toBeGreaterThan(0)
    })

    it('should capture metrics when enabled', async () => {
      const slowProcess = async (data: number[]) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return data.filter((x) => x > 0)
      }

      const tracked = $.lineage.wrap(slowProcess, {
        name: 'filterPositive',
        inputs: ['input'],
        outputs: ['output'],
        captureMetrics: true,
      })

      await tracked([1, -2, 3, -4, 5])

      // Check that transformation was recorded with metrics
      const transforms = [...$._storage.nodes.values()].filter(
        (n) => n.type === 'transformation'
      )
      expect(transforms.length).toBeGreaterThan(0)

      const metrics = transforms[0].metadata.metrics as Record<string, number> | undefined
      expect(metrics?.durationMs).toBeGreaterThanOrEqual(10)
    })
  })

  describe('Export', () => {
    beforeEach(() => {
      $.lineage.track([{ name: 'source' }], [{ name: 'target' }], {
        name: 'transform',
      })
    })

    it('should export to Mermaid format', () => {
      const graph = $.lineage.full(
        [...$._storage.nodes.values()].find((n) => n.name === 'source')!.id
      )
      const mermaid = $.lineage.export(graph, { format: 'mermaid' })

      expect(mermaid).toContain('graph TB')
      expect(mermaid).toContain('source')
      expect(mermaid).toContain('target')
      expect(mermaid).toContain('-->')
    })

    it('should export to DOT format', () => {
      const graph = $.lineage.full(
        [...$._storage.nodes.values()].find((n) => n.name === 'source')!.id
      )
      const dot = $.lineage.export(graph, { format: 'dot' })

      expect(dot).toContain('digraph lineage')
      expect(dot).toContain('rankdir=TB')
      expect(dot).toContain('->')
    })

    it('should export to JSON format', () => {
      const graph = $.lineage.full(
        [...$._storage.nodes.values()].find((n) => n.name === 'source')!.id
      )
      const json = $.lineage.export(graph, { format: 'json' })

      const parsed = JSON.parse(json)
      expect(parsed.nodes).toBeDefined()
      expect(parsed.edges).toBeDefined()
    })

    it('should export to D3 format', () => {
      const graph = $.lineage.full(
        [...$._storage.nodes.values()].find((n) => n.name === 'source')!.id
      )
      const d3 = $.lineage.export(graph, { format: 'd3' })

      const parsed = JSON.parse(d3)
      expect(parsed.nodes).toBeDefined()
      expect(parsed.links).toBeDefined()
    })

    it('should export to ASCII format', () => {
      const graph = $.lineage.full(
        [...$._storage.nodes.values()].find((n) => n.name === 'source')!.id
      )
      const ascii = $.lineage.export(graph, { format: 'ascii' })

      expect(ascii).toContain('source')
    })

    it('should export to OpenLineage format', () => {
      const graph = $.lineage.full(
        [...$._storage.nodes.values()].find((n) => n.name === 'source')!.id
      )
      const openlineage = $.lineage.export(graph, {
        format: 'openlineage',
        namespace: 'test-ns',
        producer: 'test-producer',
      })

      const events = JSON.parse(openlineage)
      expect(events).toBeInstanceOf(Array)
      if (events.length > 0) {
        expect(events[0].eventType).toBe('COMPLETE')
        expect(events[0].job.namespace).toBe('test-ns')
        expect(events[0].producer).toBe('test-producer')
      }
    })

    it('should respect direction option', () => {
      const graph = $.lineage.full(
        [...$._storage.nodes.values()].find((n) => n.name === 'source')!.id
      )

      const lr = $.lineage.export(graph, { format: 'mermaid', direction: 'LR' })
      const tb = $.lineage.export(graph, { format: 'mermaid', direction: 'TB' })

      expect(lr).toContain('graph LR')
      expect(tb).toContain('graph TB')
    })
  })

  describe('Integration with $.do() and $.try()', () => {
    it('should track transformations with workflow correlation', () => {
      // Simulate a workflow step that tracks lineage
      const workflowId = 'wf-123'
      const stepId = 'step-456'

      $.lineage.track(
        [{ name: 'input_data' }],
        [{ name: 'output_data' }],
        {
          name: 'processStep',
          kind: 'code',
          metadata: {
            workflowId,
            stepId,
            correlationId: `${workflowId}:${stepId}`,
          },
        }
      )

      const transform = [...$._storage.nodes.values()].find(
        (n) => n.name === 'processStep'
      )!

      expect(transform.metadata.workflowId).toBe(workflowId)
      expect(transform.metadata.stepId).toBe(stepId)
    })
  })
})
