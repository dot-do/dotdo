/**
 * OpenLineage Export Tests
 *
 * Tests for OpenLineage format export functionality including event generation,
 * facet mapping, roundtrip (export -> import), and edge cases.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  createLineageTracker,
  LineageTracker,
  OpenLineageExporter,
  createOpenLineageExporter,
  importFromOpenLineage,
  OPENLINEAGE_SCHEMA_URL,
  type SqlExecutor,
  type LineageGraph,
  type OpenLineageRunEvent,
} from '../index'

// =============================================================================
// TEST UTILITIES
// =============================================================================

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

function createTracker(): LineageTracker {
  const sql = createTestDb()
  return createLineageTracker(sql)
}

function buildTestGraph(tracker: LineageTracker): LineageGraph {
  // Create a simple ETL pipeline:
  //   Source (raw_events) -> Transform (aggregate) -> Sink (summary)
  const source = tracker.createNode({
    id: 'source-1',
    type: 'source',
    name: 'raw_events',
    namespace: 'warehouse',
    metadata: {
      uri: 'postgres://db.example.com/warehouse/raw_events',
      rowCount: 1000000,
      bytes: 52428800,
    },
  })

  const transform = tracker.createNode({
    id: 'transform-1',
    type: 'transformation',
    name: 'aggregate_events',
    namespace: 'etl',
    metadata: {
      sql: 'SELECT event_type, COUNT(*) as count FROM raw_events GROUP BY event_type',
      description: 'Aggregates events by type',
      owner: 'data-team',
    },
  })

  const sink = tracker.createNode({
    id: 'sink-1',
    type: 'sink',
    name: 'event_summary',
    namespace: 'reporting',
    metadata: {
      uri: 'bigquery://project.dataset.event_summary',
      lifecycleState: 'CREATE',
      rowCount: 50,
      bytes: 4096,
    },
  })

  tracker.createEdge({ fromNodeId: 'source-1', toNodeId: 'transform-1', operation: 'read' })
  tracker.createEdge({ fromNodeId: 'transform-1', toNodeId: 'sink-1', operation: 'write' })

  return {
    nodes: [source, transform, sink],
    edges: tracker.findEdges(),
    rootId: 'transform-1',
  }
}

// =============================================================================
// OPENLINEAGE EXPORTER TESTS
// =============================================================================

describe('OpenLineageExporter', () => {
  let tracker: LineageTracker
  let exporter: OpenLineageExporter

  beforeEach(() => {
    tracker = createTracker()
    exporter = createOpenLineageExporter()
  })

  describe('exportGraph', () => {
    it('should export graph to OpenLineage events', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      expect(events).toHaveLength(1) // One job (transformation)
      expect(events[0].eventType).toBe('COMPLETE')
    })

    it('should include schema URL', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      expect(events[0].schemaURL).toBe(OPENLINEAGE_SCHEMA_URL)
    })

    it('should include job with namespace and name', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      expect(events[0].job.namespace).toBe('etl')
      expect(events[0].job.name).toBe('aggregate_events')
    })

    it('should include run with UUID', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      expect(events[0].run.runId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    })

    it('should include input datasets', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      expect(events[0].inputs).toHaveLength(1)
      expect(events[0].inputs[0].namespace).toBe('warehouse')
      expect(events[0].inputs[0].name).toBe('raw_events')
    })

    it('should include output datasets', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      expect(events[0].outputs).toHaveLength(1)
      expect(events[0].outputs[0].namespace).toBe('reporting')
      expect(events[0].outputs[0].name).toBe('event_summary')
    })

    it('should include producer URI', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph, {
        producer: 'https://my-org.com/my-pipeline',
      })

      expect(events[0].producer).toBe('https://my-org.com/my-pipeline')
    })

    it('should use custom namespace', () => {
      // Create a graph without namespaces
      const source = tracker.createNode({ id: 's1', type: 'source', name: 'data' })
      const transform = tracker.createNode({ id: 't1', type: 'transformation', name: 'process' })
      tracker.createEdge({ fromNodeId: 's1', toNodeId: 't1', operation: 'read' })

      const graph: LineageGraph = {
        nodes: [source, transform],
        edges: tracker.findEdges(),
        rootId: 't1',
      }

      const events = exporter.exportGraph(graph, { namespace: 'custom-ns' })

      expect(events[0].job.namespace).toBe('custom-ns')
      expect(events[0].inputs[0].namespace).toBe('custom-ns')
    })

    it('should use custom event time', () => {
      const graph = buildTestGraph(tracker)
      const eventTime = '2025-01-01T00:00:00.000Z'
      const events = exporter.exportGraph(graph, { eventTime })

      expect(events[0].eventTime).toBe(eventTime)
    })

    it('should use custom event type', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph, { eventType: 'START' })

      expect(events[0].eventType).toBe('START')
    })
  })

  describe('facets', () => {
    it('should include SQL facet when metadata contains sql', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      expect(events[0].job.facets?.sql).toBeDefined()
      expect(events[0].job.facets?.sql?.query).toBe(
        'SELECT event_type, COUNT(*) as count FROM raw_events GROUP BY event_type',
      )
    })

    it('should include documentation facet when requested', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph, { includeDocumentation: true })

      expect(events[0].job.facets?.documentation).toBeDefined()
      expect(events[0].job.facets?.documentation?.description).toBe('Aggregates events by type')
    })

    it('should include ownership facet when requested', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph, { includeOwnership: true })

      expect(events[0].job.facets?.ownership).toBeDefined()
      expect(events[0].job.facets?.ownership?.owners).toEqual([{ name: 'data-team' }])
    })

    it('should include jobType facet', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      expect(events[0].job.facets?.jobType).toBeDefined()
      expect(events[0].job.facets?.jobType?.processingType).toBe('BATCH')
      expect(events[0].job.facets?.jobType?.integration).toBe('dotdo-lineage-tracker')
    })

    it('should include dataSource facet for datasets', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      const input = events[0].inputs[0]
      expect(input.facets?.dataSource).toBeDefined()
      expect(input.facets?.dataSource?.uri).toBe('postgres://db.example.com/warehouse/raw_events')
    })

    it('should include inputStatistics facet', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      const input = events[0].inputs[0]
      expect(input.inputFacets?.inputStatistics).toBeDefined()
      expect(input.inputFacets?.inputStatistics?.rowCount).toBe(1000000)
      expect(input.inputFacets?.inputStatistics?.bytes).toBe(52428800)
    })

    it('should include outputStatistics facet', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      const output = events[0].outputs[0]
      expect(output.outputFacets?.outputStatistics).toBeDefined()
      expect(output.outputFacets?.outputStatistics?.rowCount).toBe(50)
      expect(output.outputFacets?.outputStatistics?.bytes).toBe(4096)
    })

    it('should include lifecycleStateChange facet', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      const output = events[0].outputs[0]
      expect(output.facets?.lifecycleStateChange).toBeDefined()
      expect(output.facets?.lifecycleStateChange?.lifecycleStateChange).toBe('CREATE')
    })

    it('should include processing_engine run facet', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)

      expect(events[0].run.facets?.processing_engine).toBeDefined()
      expect(events[0].run.facets?.processing_engine?.name).toBe('dotdo-lineage-tracker')
    })
  })

  describe('event types', () => {
    it('should create START event', () => {
      const jobNode = tracker.createNode({ id: 'job-1', type: 'transformation', name: 'etl_job' })
      const inputNode = tracker.createNode({ id: 'in-1', type: 'source', name: 'input_table' })

      const event = exporter.createStartEvent(jobNode, [inputNode])

      expect(event.eventType).toBe('START')
      expect(event.inputs).toHaveLength(1)
      expect(event.outputs).toHaveLength(0)
    })

    it('should create COMPLETE event', () => {
      const jobNode = tracker.createNode({ id: 'job-1', type: 'transformation', name: 'etl_job' })
      const inputNode = tracker.createNode({ id: 'in-1', type: 'source', name: 'input_table' })
      const outputNode = tracker.createNode({ id: 'out-1', type: 'sink', name: 'output_table' })

      const event = exporter.createCompleteEvent(jobNode, [inputNode], [outputNode])

      expect(event.eventType).toBe('COMPLETE')
      expect(event.inputs).toHaveLength(1)
      expect(event.outputs).toHaveLength(1)
    })

    it('should create FAIL event with error facet', () => {
      const jobNode = tracker.createNode({ id: 'job-1', type: 'transformation', name: 'etl_job' })
      const inputNode = tracker.createNode({ id: 'in-1', type: 'source', name: 'input_table' })

      const event = exporter.createFailEvent(jobNode, [inputNode], 'Connection timeout', {
        stackTrace: 'Error at line 42',
      })

      expect(event.eventType).toBe('FAIL')
      expect(event.run.facets?.errorMessage).toBeDefined()
      expect(event.run.facets?.errorMessage?.message).toBe('Connection timeout')
      expect(event.run.facets?.errorMessage?.stackTrace).toBe('Error at line 42')
    })
  })

  describe('serialization', () => {
    it('should export to JSON string', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)
      const json = exporter.toJSON(events)

      expect(() => JSON.parse(json)).not.toThrow()
      const parsed = JSON.parse(json)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed).toHaveLength(1)
    })

    it('should export single event to JSON', () => {
      const graph = buildTestGraph(tracker)
      const events = exporter.exportGraph(graph)
      const json = exporter.toJSON(events[0])

      expect(() => JSON.parse(json)).not.toThrow()
      const parsed = JSON.parse(json)
      expect(parsed.eventType).toBe('COMPLETE')
    })

    it('should export to NDJSON', () => {
      // Create multiple jobs
      const source = tracker.createNode({ id: 's1', type: 'source', name: 'source' })
      const t1 = tracker.createNode({ id: 't1', type: 'transformation', name: 'job1' })
      const t2 = tracker.createNode({ id: 't2', type: 'transformation', name: 'job2' })
      const sink = tracker.createNode({ id: 'sk1', type: 'sink', name: 'sink' })

      tracker.createEdge({ fromNodeId: 's1', toNodeId: 't1', operation: 'read' })
      tracker.createEdge({ fromNodeId: 't1', toNodeId: 't2', operation: 'transform' })
      tracker.createEdge({ fromNodeId: 't2', toNodeId: 'sk1', operation: 'write' })

      const graph: LineageGraph = {
        nodes: [source, t1, t2, sink],
        edges: tracker.findEdges(),
        rootId: 't1',
      }

      const events = exporter.exportGraph(graph)
      const ndjson = exporter.toNDJSON(events)

      const lines = ndjson.split('\n')
      expect(lines.length).toBeGreaterThanOrEqual(1)

      // Each line should be valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    })
  })

  describe('schema parsing', () => {
    it('should parse array schema', () => {
      const node = tracker.createNode({
        id: 'n1',
        type: 'source',
        name: 'table',
        metadata: {
          schema: [
            { name: 'id', type: 'integer', description: 'Primary key' },
            { name: 'name', type: 'string' },
          ],
        },
      })

      const transform = tracker.createNode({ id: 't1', type: 'transformation', name: 'job' })
      tracker.createEdge({ fromNodeId: 'n1', toNodeId: 't1', operation: 'read' })

      const graph: LineageGraph = {
        nodes: [node, transform],
        edges: tracker.findEdges(),
        rootId: 't1',
      }

      const events = exporter.exportGraph(graph, { includeSchema: true })
      const input = events[0].inputs[0]

      expect(input.facets?.schema?.fields).toHaveLength(2)
      expect(input.facets?.schema?.fields[0]).toEqual({
        name: 'id',
        type: 'integer',
        description: 'Primary key',
      })
    })

    it('should parse object schema', () => {
      const node = tracker.createNode({
        id: 'n1',
        type: 'source',
        name: 'table',
        metadata: {
          schema: {
            id: 'integer',
            name: 'string',
          },
        },
      })

      const transform = tracker.createNode({ id: 't1', type: 'transformation', name: 'job' })
      tracker.createEdge({ fromNodeId: 'n1', toNodeId: 't1', operation: 'read' })

      const graph: LineageGraph = {
        nodes: [node, transform],
        edges: tracker.findEdges(),
        rootId: 't1',
      }

      const events = exporter.exportGraph(graph, { includeSchema: true })
      const input = events[0].inputs[0]

      expect(input.facets?.schema?.fields).toHaveLength(2)
    })
  })
})

// =============================================================================
// IMPORT TESTS
// =============================================================================

describe('importFromOpenLineage', () => {
  it('should import OpenLineage events to nodes and edges', () => {
    const events: OpenLineageRunEvent[] = [
      {
        eventType: 'COMPLETE',
        eventTime: '2025-01-01T00:00:00.000Z',
        run: { runId: '12345678-1234-4123-8123-123456789abc' },
        job: { namespace: 'etl', name: 'my_job' },
        inputs: [{ namespace: 'warehouse', name: 'source_table' }],
        outputs: [{ namespace: 'warehouse', name: 'target_table' }],
        producer: 'https://example.com',
        schemaURL: OPENLINEAGE_SCHEMA_URL,
      },
    ]

    const result = importFromOpenLineage(events)

    // Should have 3 nodes: 1 job + 1 input + 1 output
    expect(result.nodes).toHaveLength(3)

    // Should have 2 edges: input->job, job->output
    expect(result.edges).toHaveLength(2)
  })

  it('should preserve job metadata', () => {
    const events: OpenLineageRunEvent[] = [
      {
        eventType: 'COMPLETE',
        eventTime: '2025-01-01T00:00:00.000Z',
        run: { runId: '12345678-1234-4123-8123-123456789abc' },
        job: {
          namespace: 'etl',
          name: 'my_job',
          facets: {
            sql: {
              _producer: 'test',
              _schemaURL: 'test',
              query: 'SELECT * FROM table',
            },
            documentation: {
              _producer: 'test',
              _schemaURL: 'test',
              description: 'My job description',
            },
          },
        },
        inputs: [],
        outputs: [],
        producer: 'https://example.com',
        schemaURL: OPENLINEAGE_SCHEMA_URL,
      },
    ]

    const result = importFromOpenLineage(events)
    const jobNode = result.nodes.find((n) => n.type === 'transformation')

    expect(jobNode?.metadata.sql).toBe('SELECT * FROM table')
    expect(jobNode?.metadata.description).toBe('My job description')
  })

  it('should preserve dataset metadata', () => {
    const events: OpenLineageRunEvent[] = [
      {
        eventType: 'COMPLETE',
        eventTime: '2025-01-01T00:00:00.000Z',
        run: { runId: '12345678-1234-4123-8123-123456789abc' },
        job: { namespace: 'etl', name: 'job' },
        inputs: [
          {
            namespace: 'warehouse',
            name: 'source',
            facets: {
              dataSource: {
                _producer: 'test',
                _schemaURL: 'test',
                name: 'source',
                uri: 'postgres://db/source',
              },
              schema: {
                _producer: 'test',
                _schemaURL: 'test',
                fields: [{ name: 'id', type: 'int' }],
              },
            },
            inputFacets: {
              inputStatistics: {
                _producer: 'test',
                _schemaURL: 'test',
                rowCount: 1000,
                bytes: 4096,
              },
            },
          },
        ],
        outputs: [],
        producer: 'https://example.com',
        schemaURL: OPENLINEAGE_SCHEMA_URL,
      },
    ]

    const result = importFromOpenLineage(events)
    const sourceNode = result.nodes.find((n) => n.type === 'source')

    expect(sourceNode?.metadata.uri).toBe('postgres://db/source')
    expect(sourceNode?.metadata.schema).toEqual([{ name: 'id', type: 'int' }])
    expect(sourceNode?.metadata.rowCount).toBe(1000)
    expect(sourceNode?.metadata.bytes).toBe(4096)
  })

  it('should use custom ID prefix', () => {
    const events: OpenLineageRunEvent[] = [
      {
        eventType: 'COMPLETE',
        eventTime: '2025-01-01T00:00:00.000Z',
        run: { runId: '12345678-1234-4123-8123-123456789abc' },
        job: { namespace: 'etl', name: 'job' },
        inputs: [{ namespace: 'warehouse', name: 'source' }],
        outputs: [],
        producer: 'https://example.com',
        schemaURL: OPENLINEAGE_SCHEMA_URL,
      },
    ]

    const result = importFromOpenLineage(events, { idPrefix: 'custom' })

    for (const node of result.nodes) {
      expect(node.id).toMatch(/^custom-/)
    }
  })

  it('should deduplicate nodes by ID', () => {
    // Two events referencing the same dataset
    const events: OpenLineageRunEvent[] = [
      {
        eventType: 'COMPLETE',
        eventTime: '2025-01-01T00:00:00.000Z',
        run: { runId: '11111111-1111-4111-8111-111111111111' },
        job: { namespace: 'etl', name: 'job1' },
        inputs: [{ namespace: 'warehouse', name: 'shared_table' }],
        outputs: [],
        producer: 'https://example.com',
        schemaURL: OPENLINEAGE_SCHEMA_URL,
      },
      {
        eventType: 'COMPLETE',
        eventTime: '2025-01-01T00:00:00.000Z',
        run: { runId: '22222222-2222-4222-8222-222222222222' },
        job: { namespace: 'etl', name: 'job2' },
        inputs: [{ namespace: 'warehouse', name: 'shared_table' }],
        outputs: [],
        producer: 'https://example.com',
        schemaURL: OPENLINEAGE_SCHEMA_URL,
      },
    ]

    const result = importFromOpenLineage(events)

    // Should have 3 unique nodes: shared_table + job1 + job2
    expect(result.nodes).toHaveLength(3)

    // Should have 2 edges
    expect(result.edges).toHaveLength(2)
  })
})

// =============================================================================
// ROUNDTRIP TESTS
// =============================================================================

describe('OpenLineage roundtrip', () => {
  let tracker: LineageTracker
  let exporter: OpenLineageExporter

  beforeEach(() => {
    tracker = createTracker()
    exporter = createOpenLineageExporter()
  })

  it('should preserve graph structure through export/import', () => {
    // Create original graph
    const originalGraph = buildTestGraph(tracker)

    // Export to OpenLineage
    const events = exporter.exportGraph(originalGraph, {
      namespace: 'test',
      includeSchema: true,
      includeOwnership: true,
    })

    // Import back
    const imported = importFromOpenLineage(events)

    // Verify structure is preserved
    expect(imported.nodes).toHaveLength(3) // source, transform, sink
    expect(imported.edges).toHaveLength(2) // source->transform, transform->sink

    // Verify node types
    const nodeTypes = imported.nodes.map((n) => n.type).sort()
    expect(nodeTypes).toEqual(['sink', 'source', 'transformation'])
  })

  it('should preserve job names through roundtrip', () => {
    const originalGraph = buildTestGraph(tracker)
    const events = exporter.exportGraph(originalGraph)
    const imported = importFromOpenLineage(events)

    const jobNode = imported.nodes.find((n) => n.type === 'transformation')
    expect(jobNode?.name).toBe('aggregate_events')
  })

  it('should preserve dataset names through roundtrip', () => {
    const originalGraph = buildTestGraph(tracker)
    const events = exporter.exportGraph(originalGraph)
    const imported = importFromOpenLineage(events)

    const sourceNode = imported.nodes.find((n) => n.type === 'source')
    const sinkNode = imported.nodes.find((n) => n.type === 'sink')

    expect(sourceNode?.name).toBe('raw_events')
    expect(sinkNode?.name).toBe('event_summary')
  })

  it('should preserve namespaces through roundtrip', () => {
    const originalGraph = buildTestGraph(tracker)
    const events = exporter.exportGraph(originalGraph)
    const imported = importFromOpenLineage(events)

    const sourceNode = imported.nodes.find((n) => n.type === 'source')
    const jobNode = imported.nodes.find((n) => n.type === 'transformation')
    const sinkNode = imported.nodes.find((n) => n.type === 'sink')

    expect(sourceNode?.namespace).toBe('warehouse')
    expect(jobNode?.namespace).toBe('etl')
    expect(sinkNode?.namespace).toBe('reporting')
  })
})

// =============================================================================
// LINEAGE TRACKER INTEGRATION TESTS
// =============================================================================

describe('LineageTracker OpenLineage integration', () => {
  let tracker: LineageTracker

  beforeEach(() => {
    tracker = createTracker()
  })

  it('should export via tracker.exportToOpenLineage', () => {
    const graph = buildTestGraph(tracker)
    const events = tracker.exportToOpenLineage(graph)

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('COMPLETE')
  })

  it('should export via tracker.exportToOpenLineageJSON', () => {
    const graph = buildTestGraph(tracker)
    const json = tracker.exportToOpenLineageJSON(graph)

    expect(() => JSON.parse(json)).not.toThrow()
    const parsed = JSON.parse(json)
    expect(Array.isArray(parsed)).toBe(true)
  })

  it('should export via tracker.exportToOpenLineageNDJSON', () => {
    const graph = buildTestGraph(tracker)
    const ndjson = tracker.exportToOpenLineageNDJSON(graph)

    const lines = ndjson.split('\n')
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('should get OpenLineage exporter via tracker.getOpenLineageExporter', () => {
    const olExporter = tracker.getOpenLineageExporter()

    expect(olExporter).toBeInstanceOf(OpenLineageExporter)
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('OpenLineage edge cases', () => {
  let exporter: OpenLineageExporter
  let tracker: LineageTracker

  beforeEach(() => {
    tracker = createTracker()
    exporter = createOpenLineageExporter()
  })

  it('should handle empty graph', () => {
    const emptyGraph: LineageGraph = {
      nodes: [],
      edges: [],
      rootId: '',
    }

    const events = exporter.exportGraph(emptyGraph)
    expect(events).toHaveLength(0)
  })

  it('should handle graph with only datasets (no jobs)', () => {
    const source = tracker.createNode({ id: 's1', type: 'source', name: 'source' })
    const sink = tracker.createNode({ id: 'sk1', type: 'sink', name: 'sink' })
    tracker.createEdge({ fromNodeId: 's1', toNodeId: 'sk1', operation: 'copy' })

    const graph: LineageGraph = {
      nodes: [source, sink],
      edges: tracker.findEdges(),
      rootId: 's1',
    }

    const events = exporter.exportGraph(graph)

    // Should create a synthetic job from root node
    expect(events).toHaveLength(1)
    expect(events[0].job.name).toBe('source')
  })

  it('should handle graph with multiple independent jobs', () => {
    // Job 1: s1 -> t1 -> sk1
    // Job 2: s2 -> t2 -> sk2
    const s1 = tracker.createNode({ id: 's1', type: 'source', name: 'source1' })
    const t1 = tracker.createNode({ id: 't1', type: 'transformation', name: 'job1' })
    const sk1 = tracker.createNode({ id: 'sk1', type: 'sink', name: 'sink1' })

    const s2 = tracker.createNode({ id: 's2', type: 'source', name: 'source2' })
    const t2 = tracker.createNode({ id: 't2', type: 'transformation', name: 'job2' })
    const sk2 = tracker.createNode({ id: 'sk2', type: 'sink', name: 'sink2' })

    tracker.createEdge({ fromNodeId: 's1', toNodeId: 't1', operation: 'read' })
    tracker.createEdge({ fromNodeId: 't1', toNodeId: 'sk1', operation: 'write' })
    tracker.createEdge({ fromNodeId: 's2', toNodeId: 't2', operation: 'read' })
    tracker.createEdge({ fromNodeId: 't2', toNodeId: 'sk2', operation: 'write' })

    const graph: LineageGraph = {
      nodes: [s1, t1, sk1, s2, t2, sk2],
      edges: tracker.findEdges(),
      rootId: 't1',
    }

    const events = exporter.exportGraph(graph)

    expect(events).toHaveLength(2)
    const jobNames = events.map((e) => e.job.name).sort()
    expect(jobNames).toEqual(['job1', 'job2'])
  })

  it('should handle nodes with special characters', () => {
    const node = tracker.createNode({
      id: 'node-1',
      type: 'transformation',
      name: 'Job with "quotes" and spaces',
      namespace: 'ns/with/slashes',
    })

    const graph: LineageGraph = {
      nodes: [node],
      edges: [],
      rootId: 'node-1',
    }

    const events = exporter.exportGraph(graph)
    const json = exporter.toJSON(events)

    expect(() => JSON.parse(json)).not.toThrow()
    expect(events[0].job.name).toBe('Job with "quotes" and spaces')
    expect(events[0].job.namespace).toBe('ns/with/slashes')
  })

  it('should handle very long node names', () => {
    const longName = 'A'.repeat(1000)
    const node = tracker.createNode({
      id: 'node-1',
      type: 'transformation',
      name: longName,
    })

    const graph: LineageGraph = {
      nodes: [node],
      edges: [],
      rootId: 'node-1',
    }

    const events = exporter.exportGraph(graph)
    expect(events[0].job.name).toBe(longName)
  })

  it('should handle Date objects for eventTime', () => {
    const graph = buildTestGraph(tracker)
    const date = new Date('2025-06-15T12:00:00.000Z')
    const events = exporter.exportGraph(graph, { eventTime: date })

    expect(events[0].eventTime).toBe('2025-06-15T12:00:00.000Z')
  })

  it('should use custom runId', () => {
    const jobNode = tracker.createNode({ id: 'j1', type: 'transformation', name: 'job' })
    const customRunId = '00000000-0000-4000-8000-000000000001'

    const event = exporter.exportTransformation(jobNode, [], [], { runId: customRunId })

    expect(event.run.runId).toBe(customRunId)
  })
})
