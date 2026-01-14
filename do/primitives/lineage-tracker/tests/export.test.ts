/**
 * LineageTracker Export Tests
 *
 * Tests for export functionality including DOT, Mermaid, JSON, D3, and ASCII formats.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  createLineageTracker,
  LineageTracker,
  LineageExporter,
  createLineageExporter,
  type SqlExecutor,
  type LineageGraph,
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
  // Create a simple graph:
  //   Source -> Transform -> Sink
  const source = tracker.createNode({ id: 'source-1', type: 'source', name: 'Raw Events', namespace: 'warehouse' })
  const transform = tracker.createNode({ id: 'transform-1', type: 'transformation', name: 'Aggregate', namespace: 'etl' })
  const sink = tracker.createNode({ id: 'sink-1', type: 'sink', name: 'Dashboard', namespace: 'reporting' })

  tracker.createEdge({ fromNodeId: 'source-1', toNodeId: 'transform-1', operation: 'read' })
  tracker.createEdge({ fromNodeId: 'transform-1', toNodeId: 'sink-1', operation: 'write' })

  // Build a complete graph with all nodes and edges (getFullLineage excludes the root node)
  return {
    nodes: [source, transform, sink],
    edges: tracker.findEdges(),
    rootId: 'transform-1'
  }
}

// =============================================================================
// DOT EXPORT TESTS
// =============================================================================

describe('LineageExporter - DOT Format', () => {
  let tracker: LineageTracker
  let exporter: LineageExporter

  beforeEach(() => {
    tracker = createTracker()
    exporter = createLineageExporter()
  })

  it('should export basic graph to DOT format', () => {
    const graph = buildTestGraph(tracker)
    const dot = exporter.toDot(graph)

    expect(dot).toContain('digraph')
    expect(dot).toContain('rankdir=TB')
    expect(dot).toContain('source_1')
    expect(dot).toContain('transform_1')
    expect(dot).toContain('sink_1')
    expect(dot).toContain('->')
  })

  it('should respect custom rankdir option', () => {
    const graph = buildTestGraph(tracker)
    const dot = exporter.toDot(graph, { rankdir: 'LR' })

    expect(dot).toContain('rankdir=LR')
  })

  it('should use custom title', () => {
    const graph = buildTestGraph(tracker)
    const dot = exporter.toDot(graph, { title: 'MyGraph' })

    expect(dot).toContain('digraph MyGraph')
  })

  it('should include node labels', () => {
    const graph = buildTestGraph(tracker)
    const dot = exporter.toDot(graph)

    expect(dot).toContain('label="Raw Events"')
    expect(dot).toContain('label="Aggregate"')
    expect(dot).toContain('label="Dashboard"')
  })

  it('should include edge labels', () => {
    const graph = buildTestGraph(tracker)
    const dot = exporter.toDot(graph)

    expect(dot).toContain('label="read"')
    expect(dot).toContain('label="write"')
  })

  it('should apply shapes based on node type', () => {
    const graph = buildTestGraph(tracker)
    const dot = exporter.toDot(graph)

    expect(dot).toContain('shape=cylinder') // source
    expect(dot).toContain('shape=ellipse')  // transformation
    expect(dot).toContain('shape=house')    // sink
  })

  it('should include metadata as tooltips when enabled', () => {
    const node = tracker.createNode({
      id: 'meta-node',
      type: 'entity',
      name: 'With Metadata',
      metadata: { key: 'value' }
    })

    // Build a graph with the node included
    const graph: LineageGraph = {
      nodes: [node],
      edges: [],
      rootId: 'meta-node'
    }
    const dot = exporter.toDot(graph, { includeMetadata: true })

    expect(dot).toContain('tooltip')
  })

  it('should be accessible via tracker.exportToDot', () => {
    const graph = buildTestGraph(tracker)
    const dot = tracker.exportToDot(graph)

    expect(dot).toContain('digraph')
  })
})

// =============================================================================
// MERMAID EXPORT TESTS
// =============================================================================

describe('LineageExporter - Mermaid Format', () => {
  let tracker: LineageTracker
  let exporter: LineageExporter

  beforeEach(() => {
    tracker = createTracker()
    exporter = createLineageExporter()
  })

  it('should export basic graph to Mermaid format', () => {
    const graph = buildTestGraph(tracker)
    const mermaid = exporter.toMermaid(graph)

    expect(mermaid).toContain('graph TB')
    expect(mermaid).toContain('source_1')
    expect(mermaid).toContain('transform_1')
    expect(mermaid).toContain('sink_1')
    expect(mermaid).toContain('-->')
  })

  it('should respect custom direction', () => {
    const graph = buildTestGraph(tracker)
    const mermaid = exporter.toMermaid(graph, { direction: 'LR' })

    expect(mermaid).toContain('graph LR')
  })

  it('should include operation labels by default', () => {
    const graph = buildTestGraph(tracker)
    const mermaid = exporter.toMermaid(graph)

    expect(mermaid).toContain('|read|')
    expect(mermaid).toContain('|write|')
  })

  it('should omit operation labels when disabled', () => {
    const graph = buildTestGraph(tracker)
    const mermaid = exporter.toMermaid(graph, { includeOperations: false })

    expect(mermaid).not.toContain('|read|')
    expect(mermaid).not.toContain('|write|')
  })

  it('should use correct node shapes by type', () => {
    const graph = buildTestGraph(tracker)
    const mermaid = exporter.toMermaid(graph)

    // Source uses cylinder shape
    expect(mermaid).toMatch(/source_1\[\(.*\)\]/)
    // Transformation uses round shape
    expect(mermaid).toMatch(/transform_1\(.*\)/)
    // Sink uses stadium shape
    expect(mermaid).toMatch(/sink_1\(\[.*\]\)/)
  })

  it('should be accessible via tracker.exportToMermaid', () => {
    const graph = buildTestGraph(tracker)
    const mermaid = tracker.exportToMermaid(graph)

    expect(mermaid).toContain('graph TB')
  })
})

// =============================================================================
// JSON EXPORT TESTS
// =============================================================================

describe('LineageExporter - JSON Format', () => {
  let tracker: LineageTracker
  let exporter: LineageExporter

  beforeEach(() => {
    tracker = createTracker()
    exporter = createLineageExporter()
  })

  it('should export to valid JSON', () => {
    const graph = buildTestGraph(tracker)
    const json = exporter.toJSON(graph)

    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('should preserve all graph data', () => {
    const graph = buildTestGraph(tracker)
    const json = exporter.toJSON(graph)
    const parsed = JSON.parse(json)

    expect(parsed.nodes).toHaveLength(graph.nodes.length)
    expect(parsed.edges).toHaveLength(graph.edges.length)
    expect(parsed.rootId).toBe(graph.rootId)
  })

  it('should preserve node properties', () => {
    const graph = buildTestGraph(tracker)
    const json = exporter.toJSON(graph)
    const parsed = JSON.parse(json)

    const sourceNode = parsed.nodes.find((n: any) => n.id === 'source-1')
    expect(sourceNode).toBeDefined()
    expect(sourceNode.name).toBe('Raw Events')
    expect(sourceNode.type).toBe('source')
    expect(sourceNode.namespace).toBe('warehouse')
  })

  it('should preserve edge properties', () => {
    const graph = buildTestGraph(tracker)
    const json = exporter.toJSON(graph)
    const parsed = JSON.parse(json)

    const readEdge = parsed.edges.find((e: any) => e.operation === 'read')
    expect(readEdge).toBeDefined()
    expect(readEdge.fromNodeId).toBe('source-1')
    expect(readEdge.toNodeId).toBe('transform-1')
  })

  it('should be accessible via tracker.exportToJSON', () => {
    const graph = buildTestGraph(tracker)
    const json = tracker.exportToJSON(graph)

    expect(() => JSON.parse(json)).not.toThrow()
  })
})

// =============================================================================
// D3 EXPORT TESTS
// =============================================================================

describe('LineageExporter - D3 Format', () => {
  let tracker: LineageTracker
  let exporter: LineageExporter

  beforeEach(() => {
    tracker = createTracker()
    exporter = createLineageExporter()
  })

  it('should export to D3 format with nodes and links', () => {
    const graph = buildTestGraph(tracker)
    const d3 = exporter.toD3(graph)

    expect(d3).toHaveProperty('nodes')
    expect(d3).toHaveProperty('links')
    expect(Array.isArray(d3.nodes)).toBe(true)
    expect(Array.isArray(d3.links)).toBe(true)
  })

  it('should include all required node properties', () => {
    const graph = buildTestGraph(tracker)
    const d3 = exporter.toD3(graph)

    const node = d3.nodes[0]
    expect(node).toHaveProperty('id')
    expect(node).toHaveProperty('name')
    expect(node).toHaveProperty('type')
    expect(node).toHaveProperty('group')
  })

  it('should assign group numbers based on type', () => {
    const graph = buildTestGraph(tracker)
    const d3 = exporter.toD3(graph)

    const sourceNode = d3.nodes.find(n => n.type === 'source')
    const transformNode = d3.nodes.find(n => n.type === 'transformation')
    const sinkNode = d3.nodes.find(n => n.type === 'sink')

    expect(sourceNode?.group).toBe(0)
    expect(transformNode?.group).toBe(1)
    expect(sinkNode?.group).toBe(3)
  })

  it('should include all required link properties', () => {
    const graph = buildTestGraph(tracker)
    const d3 = exporter.toD3(graph)

    const link = d3.links[0]
    expect(link).toHaveProperty('source')
    expect(link).toHaveProperty('target')
    expect(link).toHaveProperty('operation')
    expect(link).toHaveProperty('value')
  })

  it('should preserve metadata in D3 format', () => {
    const metaNode = tracker.createNode({
      id: 'meta-node',
      type: 'entity',
      name: 'With Metadata',
      metadata: { key: 'value' }
    })

    // Build a graph with the node included
    const graph: LineageGraph = {
      nodes: [metaNode],
      edges: [],
      rootId: 'meta-node'
    }
    const d3 = exporter.toD3(graph)

    const node = d3.nodes.find(n => n.id === 'meta-node')
    expect(node?.metadata).toEqual({ key: 'value' })
  })

  it('should be accessible via tracker.exportToD3', () => {
    const graph = buildTestGraph(tracker)
    const d3 = tracker.exportToD3(graph)

    expect(d3.nodes).toBeDefined()
    expect(d3.links).toBeDefined()
  })
})

// =============================================================================
// ASCII EXPORT TESTS
// =============================================================================

describe('LineageExporter - ASCII Format', () => {
  let tracker: LineageTracker
  let exporter: LineageExporter

  beforeEach(() => {
    tracker = createTracker()
    exporter = createLineageExporter()
  })

  it('should export to ASCII format', () => {
    const graph = buildTestGraph(tracker)
    const ascii = exporter.toAscii(graph)

    expect(typeof ascii).toBe('string')
    expect(ascii.length).toBeGreaterThan(0)
  })

  it('should include node names', () => {
    const graph = buildTestGraph(tracker)
    const ascii = exporter.toAscii(graph)

    // Node names should appear in the ASCII output
    expect(ascii).toContain('Raw Events')
  })

  it('should include type annotations', () => {
    const graph = buildTestGraph(tracker)
    const ascii = exporter.toAscii(graph)

    expect(ascii).toContain('[source]')
  })

  it('should use box drawing characters', () => {
    const graph = buildTestGraph(tracker)
    const ascii = exporter.toAscii(graph)

    expect(ascii).toContain('+')
    expect(ascii).toContain('-')
    expect(ascii).toContain('|')
  })

  it('should handle empty graph', () => {
    const emptyGraph: LineageGraph = {
      nodes: [],
      edges: [],
      rootId: '',
    }
    const ascii = exporter.toAscii(emptyGraph)

    expect(ascii).toBe('(empty graph)')
  })

  it('should respect maxWidth option', () => {
    const graph = buildTestGraph(tracker)
    const ascii = exporter.toAscii(graph, { maxWidth: 40 })

    const lines = ascii.split('\n')
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(40)
    }
  })

  it('should be accessible via tracker.exportToAscii', () => {
    const graph = buildTestGraph(tracker)
    const ascii = tracker.exportToAscii(graph)

    expect(typeof ascii).toBe('string')
  })
})

// =============================================================================
// CYTOSCAPE EXPORT TESTS
// =============================================================================

describe('LineageExporter - Cytoscape Format', () => {
  let exporter: LineageExporter
  let tracker: LineageTracker

  beforeEach(() => {
    tracker = createTracker()
    exporter = createLineageExporter()
  })

  it('should export to Cytoscape format', () => {
    const graph = buildTestGraph(tracker)
    const cyto = exporter.toCytoscape(graph)

    expect(cyto).toHaveProperty('nodes')
    expect(cyto).toHaveProperty('edges')
  })

  it('should wrap nodes in data objects', () => {
    const graph = buildTestGraph(tracker)
    const cyto = exporter.toCytoscape(graph)

    expect(cyto.nodes[0]).toHaveProperty('data')
    expect(cyto.nodes[0].data).toHaveProperty('id')
    expect(cyto.nodes[0].data).toHaveProperty('label')
    expect(cyto.nodes[0].data).toHaveProperty('type')
  })

  it('should wrap edges in data objects', () => {
    const graph = buildTestGraph(tracker)
    const cyto = exporter.toCytoscape(graph)

    expect(cyto.edges[0]).toHaveProperty('data')
    expect(cyto.edges[0].data).toHaveProperty('source')
    expect(cyto.edges[0].data).toHaveProperty('target')
    expect(cyto.edges[0].data).toHaveProperty('operation')
  })
})

// =============================================================================
// PLANTUML EXPORT TESTS
// =============================================================================

describe('LineageExporter - PlantUML Format', () => {
  let exporter: LineageExporter
  let tracker: LineageTracker

  beforeEach(() => {
    tracker = createTracker()
    exporter = createLineageExporter()
  })

  it('should export to PlantUML format', () => {
    const graph = buildTestGraph(tracker)
    const plantuml = exporter.toPlantUML(graph)

    expect(plantuml).toContain('@startuml')
    expect(plantuml).toContain('@enduml')
  })

  it('should include edges with operations', () => {
    const graph = buildTestGraph(tracker)
    const plantuml = exporter.toPlantUML(graph)

    expect(plantuml).toContain('-->')
    expect(plantuml).toContain(': read')
    expect(plantuml).toContain(': write')
  })

  it('should group nodes by namespace as packages', () => {
    const graph = buildTestGraph(tracker)
    const plantuml = exporter.toPlantUML(graph)

    expect(plantuml).toContain('package "warehouse"')
    expect(plantuml).toContain('package "etl"')
    expect(plantuml).toContain('package "reporting"')
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('LineageExporter - Edge Cases', () => {
  let exporter: LineageExporter

  beforeEach(() => {
    exporter = createLineageExporter()
  })

  it('should handle nodes with special characters in names', () => {
    const graph: LineageGraph = {
      nodes: [
        { id: 'node-1', type: 'entity', name: 'User "Data"', namespace: undefined, metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
        { id: 'node-2', type: 'entity', name: "Customer's Orders", namespace: undefined, metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
      ],
      edges: [
        { id: 'edge-1', fromNodeId: 'node-1', toNodeId: 'node-2', operation: 'join', metadata: {}, timestamp: Date.now() },
      ],
      rootId: 'node-1',
    }

    // Should not throw
    expect(() => exporter.toDot(graph)).not.toThrow()
    expect(() => exporter.toMermaid(graph)).not.toThrow()
    expect(() => exporter.toJSON(graph)).not.toThrow()
  })

  it('should handle nodes with newlines in names', () => {
    const graph: LineageGraph = {
      nodes: [
        { id: 'node-1', type: 'entity', name: 'Multi\nLine', namespace: undefined, metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
      ],
      edges: [],
      rootId: 'node-1',
    }

    const dot = exporter.toDot(graph)
    expect(dot).not.toContain('Multi\nLine') // Should be escaped
    expect(dot).toContain('Multi\\nLine')
  })

  it('should handle very long node names', () => {
    const longName = 'A'.repeat(200)
    const graph: LineageGraph = {
      nodes: [
        { id: 'node-1', type: 'entity', name: longName, namespace: undefined, metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
      ],
      edges: [],
      rootId: 'node-1',
    }

    // Should not throw
    expect(() => exporter.toDot(graph)).not.toThrow()
    expect(() => exporter.toAscii(graph)).not.toThrow()
  })

  it('should handle graph with only nodes (no edges)', () => {
    const graph: LineageGraph = {
      nodes: [
        { id: 'node-1', type: 'entity', name: 'Lonely Node', namespace: undefined, metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
      ],
      edges: [],
      rootId: 'node-1',
    }

    const dot = exporter.toDot(graph)
    expect(dot).toContain('Lonely Node')
    expect(dot).not.toContain('->')

    const mermaid = exporter.toMermaid(graph)
    expect(mermaid).toContain('Lonely Node')
    expect(mermaid).not.toContain('-->')
  })
})
