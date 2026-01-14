/**
 * Visualization API Tests
 *
 * Tests for the lineage graph visualization API including:
 * - Format conversions (D3, Cytoscape, Mermaid, DOT)
 * - Layout algorithms (layered, hierarchical, force, radial, grid)
 * - Filtering by system, type, owner
 * - Grouping and collapsing
 * - Path highlighting for impact analysis
 * - Large graph handling (1000+ nodes)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  toVisualization,
  toMermaid,
  layoutGraph,
  filterGraph,
  groupNodes,
  applyHighlighting,
  createVisualization,
  LineageVisualization,
  type PositionedGraph,
  type D3VisualizationData,
  type CytoscapeVisualizationData,
  type FilterOptions,
  type GroupingOptions,
  type HighlightOptions,
  type LayoutOptions,
} from '../visualization'
import type { LineageGraph, LineageNode, LineageEdge, NodeType } from '../types'

// =============================================================================
// TEST UTILITIES
// =============================================================================

function createTestGraph(): LineageGraph {
  const now = Date.now()
  return {
    nodes: [
      { id: 'source-1', type: 'source', name: 'Raw Events', namespace: 'warehouse', metadata: { owner: 'data-team' }, createdAt: now, updatedAt: now },
      { id: 'source-2', type: 'source', name: 'User Data', namespace: 'warehouse', metadata: { owner: 'data-team' }, createdAt: now, updatedAt: now },
      { id: 'transform-1', type: 'transformation', name: 'Join Events', namespace: 'etl', metadata: { owner: 'etl-team' }, createdAt: now, updatedAt: now },
      { id: 'transform-2', type: 'transformation', name: 'Aggregate', namespace: 'etl', metadata: { owner: 'etl-team' }, createdAt: now, updatedAt: now },
      { id: 'sink-1', type: 'sink', name: 'Dashboard', namespace: 'reporting', metadata: { owner: 'analytics-team' }, createdAt: now, updatedAt: now },
    ],
    edges: [
      { id: 'edge-1', fromNodeId: 'source-1', toNodeId: 'transform-1', operation: 'read', metadata: {}, timestamp: now },
      { id: 'edge-2', fromNodeId: 'source-2', toNodeId: 'transform-1', operation: 'read', metadata: {}, timestamp: now },
      { id: 'edge-3', fromNodeId: 'transform-1', toNodeId: 'transform-2', operation: 'process', metadata: {}, timestamp: now },
      { id: 'edge-4', fromNodeId: 'transform-2', toNodeId: 'sink-1', operation: 'write', metadata: {}, timestamp: now },
    ],
    rootId: 'transform-1',
  }
}

function createLargeGraph(nodeCount: number): LineageGraph {
  const now = Date.now()
  const nodes: LineageNode[] = []
  const edges: LineageEdge[] = []
  const types: NodeType[] = ['source', 'transformation', 'entity', 'sink']

  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `node-${i}`,
      type: types[i % 4],
      name: `Node ${i}`,
      namespace: `ns-${i % 10}`,
      metadata: { owner: `team-${i % 5}` },
      createdAt: now,
      updatedAt: now,
    })
  }

  // Create edges to form a DAG
  for (let i = 1; i < nodeCount; i++) {
    // Connect to 1-3 previous nodes
    const connectionCount = Math.min(3, i)
    for (let j = 0; j < connectionCount; j++) {
      const sourceIndex = Math.max(0, i - 1 - j * (Math.floor(i / 10) + 1))
      if (sourceIndex < i) {
        edges.push({
          id: `edge-${i}-${j}`,
          fromNodeId: `node-${sourceIndex}`,
          toNodeId: `node-${i}`,
          operation: 'transform',
          metadata: {},
          timestamp: now,
        })
      }
    }
  }

  return {
    nodes,
    edges,
    rootId: 'node-0',
  }
}

// =============================================================================
// FORMAT CONVERSION TESTS
// =============================================================================

describe('toVisualization - Format Conversions', () => {
  let graph: LineageGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  describe('D3 Format', () => {
    it('should convert to D3 format with nodes and links', () => {
      const result = toVisualization(graph, { format: 'd3' }) as D3VisualizationData

      expect(result).toHaveProperty('nodes')
      expect(result).toHaveProperty('links')
      expect(result.nodes).toHaveLength(5)
      expect(result.links).toHaveLength(4)
    })

    it('should include required D3 node properties', () => {
      const result = toVisualization(graph, { format: 'd3' }) as D3VisualizationData

      const node = result.nodes[0]
      expect(node).toHaveProperty('id')
      expect(node).toHaveProperty('name')
      expect(node).toHaveProperty('type')
      expect(node).toHaveProperty('group')
      expect(node).toHaveProperty('x')
      expect(node).toHaveProperty('y')
    })

    it('should assign group numbers by node type', () => {
      const result = toVisualization(graph, { format: 'd3' }) as D3VisualizationData

      const sourceNode = result.nodes.find((n) => n.type === 'source')
      const transformNode = result.nodes.find((n) => n.type === 'transformation')
      const sinkNode = result.nodes.find((n) => n.type === 'sink')

      expect(sourceNode?.group).toBe(0)
      expect(transformNode?.group).toBe(1)
      expect(sinkNode?.group).toBe(3)
    })

    it('should include positions from layout', () => {
      const result = toVisualization(graph, { format: 'd3' }) as D3VisualizationData

      for (const node of result.nodes) {
        expect(typeof node.x).toBe('number')
        expect(typeof node.y).toBe('number')
        expect(Number.isFinite(node.x)).toBe(true)
        expect(Number.isFinite(node.y)).toBe(true)
      }
    })

    it('should include metadata when requested', () => {
      const result = toVisualization(graph, { format: 'd3', includeMetadata: true }) as D3VisualizationData

      const nodeWithMeta = result.nodes.find((n) => n.id === 'source-1')
      expect(nodeWithMeta?.metadata).toBeDefined()
      expect(nodeWithMeta?.metadata?.owner).toBe('data-team')
    })
  })

  describe('Cytoscape Format', () => {
    it('should convert to Cytoscape format', () => {
      const result = toVisualization(graph, { format: 'cytoscape' }) as CytoscapeVisualizationData

      expect(result).toHaveProperty('nodes')
      expect(result).toHaveProperty('edges')
      expect(result.nodes).toHaveLength(5)
      expect(result.edges).toHaveLength(4)
    })

    it('should wrap nodes in data objects', () => {
      const result = toVisualization(graph, { format: 'cytoscape' }) as CytoscapeVisualizationData

      const node = result.nodes[0]
      expect(node).toHaveProperty('data')
      expect(node.data).toHaveProperty('id')
      expect(node.data).toHaveProperty('label')
      expect(node.data).toHaveProperty('type')
    })

    it('should include positions', () => {
      const result = toVisualization(graph, { format: 'cytoscape' }) as CytoscapeVisualizationData

      const node = result.nodes[0]
      expect(node).toHaveProperty('position')
      expect(node.position).toHaveProperty('x')
      expect(node.position).toHaveProperty('y')
    })

    it('should include edge data', () => {
      const result = toVisualization(graph, { format: 'cytoscape' }) as CytoscapeVisualizationData

      const edge = result.edges[0]
      expect(edge).toHaveProperty('data')
      expect(edge.data).toHaveProperty('source')
      expect(edge.data).toHaveProperty('target')
      expect(edge.data).toHaveProperty('operation')
    })
  })

  describe('Mermaid Format', () => {
    it('should convert to Mermaid format', () => {
      const result = toVisualization(graph, { format: 'mermaid' }) as string

      expect(typeof result).toBe('string')
      expect(result).toContain('graph TB')
    })

    it('should include node definitions', () => {
      const result = toVisualization(graph, { format: 'mermaid' }) as string

      expect(result).toContain('source_1')
      expect(result).toContain('transform_1')
      expect(result).toContain('sink_1')
    })

    it('should include edges', () => {
      const result = toVisualization(graph, { format: 'mermaid' }) as string

      expect(result).toContain('-->')
    })

    it('should use correct node shapes', () => {
      const result = toVisualization(graph, { format: 'mermaid' }) as string

      // Source uses cylinder: [( )]
      expect(result).toMatch(/source_1\[\(/)
      // Sink uses stadium: ([ ])
      expect(result).toMatch(/sink_1\(\[/)
    })

    it('should include operations when enabled', () => {
      const result = toVisualization(graph, {
        format: 'mermaid',
        mermaid: { includeOperations: true },
      }) as string

      expect(result).toContain('|"read"|')
      expect(result).toContain('|"process"|')
    })

    it('should respect direction option', () => {
      const result = toVisualization(graph, {
        format: 'mermaid',
        mermaid: { direction: 'LR' },
      }) as string

      expect(result).toContain('graph LR')
    })

    it('should support theme directive', () => {
      const result = toVisualization(graph, {
        format: 'mermaid',
        mermaid: { theme: 'dark' },
      }) as string

      expect(result).toContain("%%{init: {'theme': 'dark'}}%%")
    })
  })

  describe('DOT Format', () => {
    it('should convert to DOT/Graphviz format', () => {
      const result = toVisualization(graph, { format: 'dot' }) as string

      expect(typeof result).toBe('string')
      expect(result).toContain('digraph')
      expect(result).toContain('rankdir=TB')
    })

    it('should include node definitions with shapes', () => {
      const result = toVisualization(graph, { format: 'dot' }) as string

      expect(result).toContain('shape=cylinder') // source
      expect(result).toContain('shape=ellipse') // transformation
      expect(result).toContain('shape=house') // sink
    })

    it('should include edges with operations', () => {
      const result = toVisualization(graph, { format: 'dot' }) as string

      expect(result).toContain('->')
      expect(result).toContain('label="read"')
      expect(result).toContain('label="process"')
    })

    it('should group by namespace as clusters', () => {
      const result = toVisualization(graph, { format: 'dot' }) as string

      expect(result).toContain('subgraph cluster_warehouse')
      expect(result).toContain('subgraph cluster_etl')
      expect(result).toContain('subgraph cluster_reporting')
    })

    it('should support custom title', () => {
      const result = toVisualization(graph, {
        format: 'dot',
        dot: { title: 'MyLineage' },
      }) as string

      expect(result).toContain('digraph MyLineage')
    })
  })

  describe('JSON Format', () => {
    it('should convert to JSON format', () => {
      const result = toVisualization(graph, { format: 'json' }) as string

      expect(typeof result).toBe('string')
      expect(() => JSON.parse(result)).not.toThrow()
    })

    it('should include all graph data', () => {
      const result = toVisualization(graph, { format: 'json' }) as string
      const parsed = JSON.parse(result)

      expect(parsed.nodes).toHaveLength(5)
      expect(parsed.edges).toHaveLength(4)
      expect(parsed.rootId).toBe('transform-1')
    })
  })
})

// =============================================================================
// LAYOUT ALGORITHM TESTS
// =============================================================================

describe('layoutGraph - Layout Algorithms', () => {
  let graph: LineageGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  describe('Layered Layout (dagre)', () => {
    it('should compute positions for all nodes', () => {
      const positioned = layoutGraph(graph, { algorithm: 'layered' })

      expect(positioned.nodes).toHaveLength(5)
      for (const node of positioned.nodes) {
        expect(node.position).toBeDefined()
        expect(typeof node.position.x).toBe('number')
        expect(typeof node.position.y).toBe('number')
      }
    })

    it('should assign layers based on DAG depth', () => {
      const positioned = layoutGraph(graph, { algorithm: 'layered' })

      // Sources should be at layer 0
      const source1 = positioned.nodes.find((n) => n.id === 'source-1')
      const source2 = positioned.nodes.find((n) => n.id === 'source-2')
      expect(source1?.layer).toBe(0)
      expect(source2?.layer).toBe(0)

      // First transform at layer 1
      const transform1 = positioned.nodes.find((n) => n.id === 'transform-1')
      expect(transform1?.layer).toBe(1)

      // Second transform at layer 2
      const transform2 = positioned.nodes.find((n) => n.id === 'transform-2')
      expect(transform2?.layer).toBe(2)

      // Sink at layer 3
      const sink = positioned.nodes.find((n) => n.id === 'sink-1')
      expect(sink?.layer).toBe(3)
    })

    it('should compute graph bounds', () => {
      const positioned = layoutGraph(graph, { algorithm: 'layered' })

      expect(positioned.bounds).toBeDefined()
      expect(positioned.bounds.width).toBeGreaterThan(0)
      expect(positioned.bounds.height).toBeGreaterThan(0)
      expect(positioned.bounds.minX).toBeDefined()
      expect(positioned.bounds.minY).toBeDefined()
    })

    it('should respect direction option', () => {
      const tbLayout = layoutGraph(graph, { algorithm: 'layered', direction: 'TB' })
      const lrLayout = layoutGraph(graph, { algorithm: 'layered', direction: 'LR' })

      // TB: Y values should increase with layer
      const source1_TB = tbLayout.nodes.find((n) => n.id === 'source-1')
      const sink_TB = tbLayout.nodes.find((n) => n.id === 'sink-1')
      expect(sink_TB!.position.y).toBeGreaterThan(source1_TB!.position.y)

      // LR: X values should increase with layer
      const source1_LR = lrLayout.nodes.find((n) => n.id === 'source-1')
      const sink_LR = lrLayout.nodes.find((n) => n.id === 'sink-1')
      expect(sink_LR!.position.x).toBeGreaterThan(source1_LR!.position.x)
    })
  })

  describe('Hierarchical Layout', () => {
    it('should produce similar results to layered', () => {
      const layered = layoutGraph(graph, { algorithm: 'layered' })
      const hierarchical = layoutGraph(graph, { algorithm: 'hierarchical' })

      expect(hierarchical.nodes).toHaveLength(layered.nodes.length)
      expect(hierarchical.algorithm).toBe('layered') // hierarchical uses layered internally
    })
  })

  describe('Force Layout', () => {
    it('should compute positions using force simulation', () => {
      const positioned = layoutGraph(graph, { algorithm: 'force' })

      expect(positioned.nodes).toHaveLength(5)
      expect(positioned.algorithm).toBe('force')

      for (const node of positioned.nodes) {
        expect(node.position).toBeDefined()
        expect(Number.isFinite(node.position.x)).toBe(true)
        expect(Number.isFinite(node.position.y)).toBe(true)
      }
    })

    it('should separate disconnected nodes', () => {
      const positioned = layoutGraph(graph, { algorithm: 'force' })

      // All positions should be different
      const positions = positioned.nodes.map((n) => `${n.position.x.toFixed(2)},${n.position.y.toFixed(2)}`)
      const unique = new Set(positions)
      expect(unique.size).toBe(5)
    })
  })

  describe('Radial Layout', () => {
    it('should position nodes in concentric circles', () => {
      const positioned = layoutGraph(graph, { algorithm: 'radial' })

      expect(positioned.nodes).toHaveLength(5)
      expect(positioned.algorithm).toBe('radial')

      // Root should be at center (or close to it)
      // Nodes at same layer should be at similar distance from center
      const layerDistances = new Map<number, number[]>()

      const centerX = positioned.bounds.width / 2
      const centerY = positioned.bounds.height / 2

      for (const node of positioned.nodes) {
        const dist = Math.sqrt(
          Math.pow(node.position.x - centerX, 2) + Math.pow(node.position.y - centerY, 2)
        )
        const layer = node.layer ?? 0
        if (!layerDistances.has(layer)) {
          layerDistances.set(layer, [])
        }
        layerDistances.get(layer)!.push(dist)
      }

      // Layer 0 (sources) should be at similar distance
      const layer0 = layerDistances.get(0) ?? []
      if (layer0.length > 1) {
        const variance = Math.abs(layer0[0] - layer0[1])
        // Allow some variance due to centering
        expect(variance).toBeLessThan(200)
      }
    })
  })

  describe('Grid Layout', () => {
    it('should position nodes in a grid pattern', () => {
      const positioned = layoutGraph(graph, { algorithm: 'grid' })

      expect(positioned.nodes).toHaveLength(5)
      expect(positioned.algorithm).toBe('grid')

      // Positions should be regularly spaced
      const xPositions = positioned.nodes.map((n) => n.position.x).sort((a, b) => a - b)
      const yPositions = positioned.nodes.map((n) => n.position.y).sort((a, b) => a - b)

      // Check that we have distinct positions
      expect(new Set(xPositions).size).toBeGreaterThan(1)
    })
  })
})

// =============================================================================
// FILTERING TESTS
// =============================================================================

describe('filterGraph - Filtering', () => {
  let graph: LineageGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  describe('Filter by Node Types', () => {
    it('should filter to specific node types', () => {
      const filtered = filterGraph(graph, { nodeTypes: ['source'] })

      expect(filtered.nodes).toHaveLength(2)
      expect(filtered.nodes.every((n) => n.type === 'source')).toBe(true)
    })

    it('should filter to multiple node types', () => {
      const filtered = filterGraph(graph, { nodeTypes: ['source', 'sink'] })

      expect(filtered.nodes).toHaveLength(3)
      expect(filtered.nodes.every((n) => n.type === 'source' || n.type === 'sink')).toBe(true)
    })

    it('should remove edges that connect to filtered-out nodes', () => {
      const filtered = filterGraph(graph, { nodeTypes: ['source'] })

      // No edges should exist between sources only
      expect(filtered.edges).toHaveLength(0)
    })
  })

  describe('Filter by Namespace', () => {
    it('should filter to specific namespaces', () => {
      const filtered = filterGraph(graph, { namespaces: ['warehouse'] })

      expect(filtered.nodes).toHaveLength(2)
      expect(filtered.nodes.every((n) => n.namespace === 'warehouse')).toBe(true)
    })

    it('should filter to multiple namespaces', () => {
      const filtered = filterGraph(graph, { namespaces: ['warehouse', 'etl'] })

      expect(filtered.nodes).toHaveLength(4)
    })
  })

  describe('Filter by Owner', () => {
    it('should filter by owner from metadata', () => {
      const filtered = filterGraph(graph, { owners: ['data-team'] })

      expect(filtered.nodes).toHaveLength(2)
      expect(filtered.nodes.every((n) => n.metadata?.owner === 'data-team')).toBe(true)
    })
  })

  describe('Custom Predicate', () => {
    it('should support custom filter predicate', () => {
      const filtered = filterGraph(graph, {
        predicate: (node) => node.name.includes('Events'),
      })

      expect(filtered.nodes).toHaveLength(2) // Raw Events, Join Events
    })
  })

  describe('Include Connected', () => {
    it('should include connected nodes when enabled', () => {
      // Start with just sources, but include connected nodes
      const filtered = filterGraph(graph, {
        nodeTypes: ['source'],
        includeConnected: true,
      })

      // Should include all nodes since graph is connected
      expect(filtered.nodes.length).toBeGreaterThan(2)
    })

    it('should respect maxDepthFromFiltered', () => {
      const filtered = filterGraph(graph, {
        nodeTypes: ['source'],
        includeConnected: true,
        maxDepthFromFiltered: 1,
      })

      // Should include sources and immediate neighbors only
      // Sources: source-1, source-2
      // Depth 1: transform-1 (connected to both sources)
      expect(filtered.nodes.length).toBe(3)
    })
  })
})

// =============================================================================
// GROUPING TESTS
// =============================================================================

describe('groupNodes - Grouping', () => {
  let graph: LineageGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should group by namespace', () => {
    const { groups } = groupNodes(graph, { byNamespace: true })

    expect(groups.length).toBeGreaterThan(0)

    const warehouseGroup = groups.find((g) => g.label.includes('warehouse'))
    expect(warehouseGroup).toBeDefined()
    expect(warehouseGroup?.nodeCount).toBe(2)
  })

  it('should group by type', () => {
    const { groups } = groupNodes(graph, { byType: true })

    const transformGroup = groups.find((g) => g.label.includes('transformation'))
    expect(transformGroup).toBeDefined()
    expect(transformGroup?.nodeCount).toBe(2)
  })

  it('should group by owner', () => {
    const { groups } = groupNodes(graph, { byOwner: true })

    const dataTeamGroup = groups.find((g) => g.label.includes('data-team'))
    expect(dataTeamGroup).toBeDefined()
    expect(dataTeamGroup?.nodeCount).toBe(2)
  })

  it('should support custom groupBy function', () => {
    const { groups } = groupNodes(graph, {
      groupBy: (node) => (node.name.includes('Events') ? 'events' : 'other'),
    })

    const eventsGroup = groups.find((g) => g.key === 'events')
    expect(eventsGroup).toBeDefined()
    expect(eventsGroup?.nodeCount).toBe(2)
  })

  it('should respect minGroupSize', () => {
    const { groups } = groupNodes(graph, {
      byNamespace: true,
      minGroupSize: 3,
    })

    // No groups with < 3 members
    expect(groups.every((g) => g.nodeCount >= 3)).toBe(true)
  })

  it('should add groupId to node metadata', () => {
    const { graph: modifiedGraph, groups } = groupNodes(graph, {
      byNamespace: true,
      minGroupSize: 1,
    })

    // Nodes in groups should have groupId in metadata
    const warehouseNodes = modifiedGraph.nodes.filter((n) => n.namespace === 'warehouse')
    expect(warehouseNodes.every((n) => n.metadata?.groupId !== undefined)).toBe(true)
  })
})

// =============================================================================
// HIGHLIGHTING TESTS
// =============================================================================

describe('applyHighlighting - Path Highlighting', () => {
  let graph: LineageGraph
  let positioned: PositionedGraph

  beforeEach(() => {
    graph = createTestGraph()
    positioned = layoutGraph(graph)
  })

  it('should highlight specified nodes', () => {
    const highlighted = applyHighlighting(positioned, {
      impactNodes: ['source-1', 'transform-1'],
    })

    const source1 = highlighted.nodes.find((n) => n.id === 'source-1')
    const transform1 = highlighted.nodes.find((n) => n.id === 'transform-1')
    const sink = highlighted.nodes.find((n) => n.id === 'sink-1')

    expect(source1?.metadata?.highlighted).toBe(true)
    expect(transform1?.metadata?.highlighted).toBe(true)
    expect(sink?.metadata?.highlighted).toBe(false)
  })

  it('should highlight edges between highlighted nodes', () => {
    const highlighted = applyHighlighting(positioned, {
      impactNodes: ['source-1', 'transform-1'],
    })

    const edge = highlighted.edges.find(
      (e) => e.fromNodeId === 'source-1' && e.toNodeId === 'transform-1'
    )
    expect(edge?.highlighted).toBe(true)
  })

  it('should highlight specific paths', () => {
    const highlighted = applyHighlighting(positioned, {
      paths: [['source-1', 'transform-1', 'transform-2']],
    })

    // All nodes in path should be highlighted
    expect(highlighted.nodes.find((n) => n.id === 'source-1')?.metadata?.highlighted).toBe(true)
    expect(highlighted.nodes.find((n) => n.id === 'transform-1')?.metadata?.highlighted).toBe(true)
    expect(highlighted.nodes.find((n) => n.id === 'transform-2')?.metadata?.highlighted).toBe(true)

    // Edges in path should be highlighted
    const edge1 = highlighted.edges.find(
      (e) => e.fromNodeId === 'source-1' && e.toNodeId === 'transform-1'
    )
    const edge2 = highlighted.edges.find(
      (e) => e.fromNodeId === 'transform-1' && e.toNodeId === 'transform-2'
    )
    expect(edge1?.highlighted).toBe(true)
    expect(edge2?.highlighted).toBe(true)
  })

  it('should expand upstream when includeRelated is true', () => {
    const highlighted = applyHighlighting(positioned, {
      toNodes: ['sink-1'],
      includeRelated: true,
    })

    // All upstream nodes should be highlighted
    expect(highlighted.nodes.find((n) => n.id === 'sink-1')?.metadata?.highlighted).toBe(true)
    expect(highlighted.nodes.find((n) => n.id === 'transform-2')?.metadata?.highlighted).toBe(true)
    expect(highlighted.nodes.find((n) => n.id === 'transform-1')?.metadata?.highlighted).toBe(true)
    expect(highlighted.nodes.find((n) => n.id === 'source-1')?.metadata?.highlighted).toBe(true)
  })

  it('should expand downstream when includeRelated is true', () => {
    const highlighted = applyHighlighting(positioned, {
      fromNodes: ['source-1'],
      includeRelated: true,
    })

    // All downstream nodes should be highlighted
    expect(highlighted.nodes.find((n) => n.id === 'source-1')?.metadata?.highlighted).toBe(true)
    expect(highlighted.nodes.find((n) => n.id === 'transform-1')?.metadata?.highlighted).toBe(true)
    expect(highlighted.nodes.find((n) => n.id === 'transform-2')?.metadata?.highlighted).toBe(true)
    expect(highlighted.nodes.find((n) => n.id === 'sink-1')?.metadata?.highlighted).toBe(true)
  })

  it('should apply highlight color to edges', () => {
    const highlighted = applyHighlighting(positioned, {
      impactNodes: ['source-1', 'transform-1'],
      color: '#FF0000',
    })

    const edge = highlighted.edges.find(
      (e) => e.fromNodeId === 'source-1' && e.toNodeId === 'transform-1'
    )
    expect(edge?.color).toBe('#FF0000')
  })

  it('should apply bold style to highlighted edges', () => {
    const highlighted = applyHighlighting(positioned, {
      impactNodes: ['source-1', 'transform-1'],
    })

    const edge = highlighted.edges.find(
      (e) => e.fromNodeId === 'source-1' && e.toNodeId === 'transform-1'
    )
    expect(edge?.style).toBe('bold')
  })
})

// =============================================================================
// LARGE GRAPH HANDLING TESTS
// =============================================================================

describe('Large Graph Handling (1000+ nodes)', () => {
  it('should handle layout of 1000 nodes', () => {
    const largeGraph = createLargeGraph(1000)
    const positioned = layoutGraph(largeGraph, { algorithm: 'layered' })

    expect(positioned.nodes).toHaveLength(1000)
    expect(positioned.bounds.width).toBeGreaterThan(0)
    expect(positioned.bounds.height).toBeGreaterThan(0)
  })

  it('should handle filtering of 1000 nodes', () => {
    const largeGraph = createLargeGraph(1000)
    const filtered = filterGraph(largeGraph, { nodeTypes: ['source'] })

    expect(filtered.nodes.length).toBeLessThan(1000)
    expect(filtered.nodes.every((n) => n.type === 'source')).toBe(true)
  })

  it('should handle grouping of 1000 nodes', () => {
    const largeGraph = createLargeGraph(1000)
    const { groups } = groupNodes(largeGraph, { byNamespace: true })

    // Should have groups by namespace
    expect(groups.length).toBeGreaterThan(0)
    expect(groups.length).toBeLessThanOrEqual(10) // 10 namespaces
  })

  it('should convert 1000 nodes to D3 format', () => {
    const largeGraph = createLargeGraph(1000)
    const result = toVisualization(largeGraph, { format: 'd3' }) as D3VisualizationData

    expect(result.nodes).toHaveLength(1000)
  })

  it('should handle layout of 2000 nodes', () => {
    const largeGraph = createLargeGraph(2000)
    const positioned = layoutGraph(largeGraph, { algorithm: 'grid' })

    expect(positioned.nodes).toHaveLength(2000)
  })
})

// =============================================================================
// FLUENT API (LineageVisualization) TESTS
// =============================================================================

describe('LineageVisualization - Fluent API', () => {
  let graph: LineageGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should support fluent chaining', () => {
    const viz = createVisualization(graph)
      .filter({ nodeTypes: ['source', 'transformation'] })
      .layout('hierarchical', { direction: 'LR' })
      .highlight({ impactNodes: ['source-1'] })
      .format('d3')

    expect(viz).toBeInstanceOf(LineageVisualization)
  })

  it('should build D3 format', () => {
    const result = createVisualization(graph).toD3()

    expect(result).toHaveProperty('nodes')
    expect(result).toHaveProperty('links')
  })

  it('should build Cytoscape format', () => {
    const result = createVisualization(graph).toCytoscape()

    expect(result).toHaveProperty('nodes')
    expect(result).toHaveProperty('edges')
  })

  it('should build Mermaid format', () => {
    const result = createVisualization(graph).toMermaid()

    expect(typeof result).toBe('string')
    expect(result).toContain('graph TB')
  })

  it('should build DOT format', () => {
    const result = createVisualization(graph).toDot()

    expect(typeof result).toBe('string')
    expect(result).toContain('digraph')
  })

  it('should build JSON format', () => {
    const result = createVisualization(graph).toJSON()

    expect(typeof result).toBe('string')
    expect(() => JSON.parse(result)).not.toThrow()
  })

  it('should apply filter before layout', () => {
    const result = createVisualization(graph)
      .filter({ nodeTypes: ['source'] })
      .toD3()

    expect(result.nodes).toHaveLength(2)
  })

  it('should apply grouping', () => {
    const result = createVisualization(graph)
      .group({ byNamespace: true })
      .toD3()

    // Groups should be included
    expect(result.groups).toBeDefined()
    expect(result.groups!.length).toBeGreaterThan(0)
  })

  it('should apply highlighting', () => {
    const result = createVisualization(graph)
      .highlight({ impactNodes: ['source-1'] })
      .toD3()

    const highlighted = result.nodes.find((n) => n.id === 'source-1')
    expect(highlighted?.highlighted).toBe(true)
  })

  it('should chain multiple operations', () => {
    const result = createVisualization(graph)
      .filter({ namespaces: ['warehouse', 'etl'] })
      .layout('hierarchical', { direction: 'LR' })
      .highlight({ fromNodes: ['source-1'], includeRelated: true })
      .includeMetadata(true)
      .toD3()

    expect(result.nodes.length).toBeLessThanOrEqual(4)
    expect(result.nodes.some((n) => n.highlighted)).toBe(true)
  })
})

// =============================================================================
// CONVENIENCE FUNCTION TESTS
// =============================================================================

describe('toMermaid - Convenience Function', () => {
  let graph: LineageGraph

  beforeEach(() => {
    graph = createTestGraph()
  })

  it('should convert graph to Mermaid', () => {
    const result = toMermaid(graph)

    expect(typeof result).toBe('string')
    expect(result).toContain('graph TB')
  })

  it('should support direction option', () => {
    const result = toMermaid(graph, { direction: 'LR' })

    expect(result).toContain('graph LR')
  })

  it('should support theme option', () => {
    const result = toMermaid(graph, { theme: 'forest' })

    expect(result).toContain("%%{init: {'theme': 'forest'}}%%")
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
  it('should handle empty graph', () => {
    const emptyGraph: LineageGraph = {
      nodes: [],
      edges: [],
      rootId: '',
    }

    const positioned = layoutGraph(emptyGraph)
    expect(positioned.nodes).toHaveLength(0)

    const d3 = toVisualization(emptyGraph, { format: 'd3' }) as D3VisualizationData
    expect(d3.nodes).toHaveLength(0)
  })

  it('should handle single node graph', () => {
    const singleNode: LineageGraph = {
      nodes: [{ id: 'single', type: 'entity', name: 'Single', metadata: {}, createdAt: Date.now(), updatedAt: Date.now() }],
      edges: [],
      rootId: 'single',
    }

    const positioned = layoutGraph(singleNode)
    expect(positioned.nodes).toHaveLength(1)
    expect(positioned.nodes[0].position).toBeDefined()
  })

  it('should handle disconnected nodes', () => {
    const now = Date.now()
    const disconnected: LineageGraph = {
      nodes: [
        { id: 'a', type: 'source', name: 'A', metadata: {}, createdAt: now, updatedAt: now },
        { id: 'b', type: 'sink', name: 'B', metadata: {}, createdAt: now, updatedAt: now },
      ],
      edges: [],
      rootId: 'a',
    }

    const positioned = layoutGraph(disconnected)
    expect(positioned.nodes).toHaveLength(2)

    // Both should have valid positions
    for (const node of positioned.nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true)
      expect(Number.isFinite(node.position.y)).toBe(true)
    }
  })

  it('should handle nodes with special characters', () => {
    const now = Date.now()
    const specialChars: LineageGraph = {
      nodes: [
        { id: 'node-with-dashes', type: 'entity', name: 'Node "with" quotes', metadata: {}, createdAt: now, updatedAt: now },
        { id: 'node.with.dots', type: 'entity', name: "Node's apostrophe", metadata: {}, createdAt: now, updatedAt: now },
      ],
      edges: [
        { id: 'e1', fromNodeId: 'node-with-dashes', toNodeId: 'node.with.dots', operation: 'process', metadata: {}, timestamp: now },
      ],
      rootId: 'node-with-dashes',
    }

    // Should not throw
    expect(() => toVisualization(specialChars, { format: 'mermaid' })).not.toThrow()
    expect(() => toVisualization(specialChars, { format: 'dot' })).not.toThrow()
    expect(() => toVisualization(specialChars, { format: 'd3' })).not.toThrow()
  })

  it('should handle cyclic graphs', () => {
    const now = Date.now()
    const cyclic: LineageGraph = {
      nodes: [
        { id: 'a', type: 'entity', name: 'A', metadata: {}, createdAt: now, updatedAt: now },
        { id: 'b', type: 'entity', name: 'B', metadata: {}, createdAt: now, updatedAt: now },
        { id: 'c', type: 'entity', name: 'C', metadata: {}, createdAt: now, updatedAt: now },
      ],
      edges: [
        { id: 'e1', fromNodeId: 'a', toNodeId: 'b', operation: 'to-b', metadata: {}, timestamp: now },
        { id: 'e2', fromNodeId: 'b', toNodeId: 'c', operation: 'to-c', metadata: {}, timestamp: now },
        { id: 'e3', fromNodeId: 'c', toNodeId: 'a', operation: 'to-a', metadata: {}, timestamp: now }, // cycle
      ],
      rootId: 'a',
    }

    // Should not throw or infinite loop
    const positioned = layoutGraph(cyclic)
    expect(positioned.nodes).toHaveLength(3)
  })
})
