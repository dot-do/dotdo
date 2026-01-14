/**
 * Visualization API for Lineage Graphs
 *
 * Provides comprehensive API for rendering lineage graphs in multiple formats
 * with support for:
 * - DAG layout algorithms
 * - Filtering by system, type, owner
 * - Path highlighting for impact analysis
 * - Grouping/collapsing by schema, system
 * - Multiple output formats (D3.js, Cytoscape.js, Mermaid, DOT)
 *
 * @module db/primitives/lineage-tracker/visualization
 */

import type { LineageGraph, LineageNode, LineageEdge, NodeType } from './types'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Supported visualization formats
 */
export type VisualizationFormat = 'd3' | 'cytoscape' | 'mermaid' | 'dot' | 'json'

/**
 * Layout algorithm options
 */
export type LayoutAlgorithm =
  | 'dagre' // Directed acyclic graph layout
  | 'hierarchical' // Top-down/left-right hierarchy
  | 'force' // Force-directed layout
  | 'radial' // Radial layout from center
  | 'grid' // Grid-based layout
  | 'layered' // Sugiyama-style layered layout

/**
 * Node position in 2D space
 */
export interface Position {
  x: number
  y: number
}

/**
 * Node with computed position
 */
export interface PositionedNode extends LineageNode {
  position: Position
  /** Layer/rank in DAG layout */
  layer?: number
  /** Group ID for collapsing */
  groupId?: string
}

/**
 * Edge with visualization metadata
 */
export interface VisualizationEdge extends LineageEdge {
  /** Edge path points for curved routing */
  path?: Position[]
  /** Whether this edge is highlighted */
  highlighted?: boolean
  /** Edge style (normal, dashed, etc.) */
  style?: 'normal' | 'dashed' | 'dotted' | 'bold'
  /** Edge color */
  color?: string
}

/**
 * Graph with positioned nodes
 */
export interface PositionedGraph {
  nodes: PositionedNode[]
  edges: VisualizationEdge[]
  rootId: string
  /** Graph dimensions */
  bounds: {
    width: number
    height: number
    minX: number
    minY: number
    maxX: number
    maxY: number
  }
  /** Layout algorithm used */
  algorithm: LayoutAlgorithm
}

/**
 * Group definition for collapsing
 */
export interface NodeGroup {
  id: string
  label: string
  /** Grouping key (namespace, type, owner) */
  key: string
  /** Number of nodes in group */
  nodeCount: number
  /** Whether group is collapsed */
  collapsed: boolean
  /** Child node IDs */
  nodeIds: string[]
  /** Group position (center) */
  position?: Position
  /** Group bounds */
  bounds?: {
    width: number
    height: number
  }
}

/**
 * Options for filtering graphs
 */
export interface FilterOptions {
  /** Filter by node types */
  nodeTypes?: NodeType[]
  /** Filter by namespaces (systems) */
  namespaces?: string[]
  /** Filter by owner (from metadata) */
  owners?: string[]
  /** Filter by tags (from metadata) */
  tags?: string[]
  /** Custom predicate function */
  predicate?: (node: LineageNode) => boolean
  /** Include connected nodes (preserve paths) */
  includeConnected?: boolean
  /** Maximum depth from filtered nodes */
  maxDepthFromFiltered?: number
}

/**
 * Options for grouping nodes
 */
export interface GroupingOptions {
  /** Group by namespace */
  byNamespace?: boolean
  /** Group by node type */
  byType?: boolean
  /** Group by owner (from metadata) */
  byOwner?: boolean
  /** Custom grouping function */
  groupBy?: (node: LineageNode) => string | null
  /** Minimum nodes required to form a group */
  minGroupSize?: number
  /** Start with groups collapsed */
  startCollapsed?: boolean
}

/**
 * Options for highlighting paths
 */
export interface HighlightOptions {
  /** Highlight all paths from these nodes */
  fromNodes?: string[]
  /** Highlight all paths to these nodes */
  toNodes?: string[]
  /** Highlight specific paths (arrays of node IDs) */
  paths?: string[][]
  /** Impact nodes to highlight (downstream of changes) */
  impactNodes?: string[]
  /** Highlight color */
  color?: string
  /** Include upstream/downstream of highlighted nodes */
  includeRelated?: boolean
}

/**
 * Options for layout algorithm
 */
export interface LayoutOptions {
  /** Algorithm to use */
  algorithm?: LayoutAlgorithm
  /** Node spacing */
  nodeSpacing?: number
  /** Layer/rank spacing for hierarchical layouts */
  layerSpacing?: number
  /** Direction for hierarchical layouts */
  direction?: 'TB' | 'BT' | 'LR' | 'RL'
  /** Padding around the graph */
  padding?: number
  /** Node width (for collision detection) */
  nodeWidth?: number
  /** Node height */
  nodeHeight?: number
  /** Center the graph in bounds */
  center?: boolean
}

/**
 * D3.js compatible visualization data
 */
export interface D3VisualizationData {
  nodes: Array<{
    id: string
    name: string
    type: NodeType
    namespace?: string
    group: number
    x?: number
    y?: number
    fx?: number | null
    fy?: number | null
    highlighted?: boolean
    groupId?: string
    metadata?: Record<string, unknown>
  }>
  links: Array<{
    source: string
    target: string
    operation: string
    value: number
    highlighted?: boolean
    style?: string
    color?: string
    metadata?: Record<string, unknown>
  }>
  groups?: NodeGroup[]
}

/**
 * Cytoscape.js compatible visualization data
 */
export interface CytoscapeVisualizationData {
  nodes: Array<{
    data: {
      id: string
      label: string
      type: NodeType
      namespace?: string
      parent?: string
      highlighted?: boolean
    }
    position?: Position
    classes?: string[]
  }>
  edges: Array<{
    data: {
      id: string
      source: string
      target: string
      operation: string
      highlighted?: boolean
    }
    classes?: string[]
  }>
}

/**
 * Combined options for toVisualization
 */
export interface VisualizationOptions {
  /** Output format */
  format?: VisualizationFormat
  /** Layout options */
  layout?: LayoutOptions
  /** Filter options */
  filter?: FilterOptions
  /** Grouping options */
  grouping?: GroupingOptions
  /** Highlight options */
  highlight?: HighlightOptions
  /** Include node metadata */
  includeMetadata?: boolean
  /** Mermaid-specific options */
  mermaid?: {
    direction?: 'TB' | 'LR' | 'BT' | 'RL'
    includeOperations?: boolean
    theme?: 'default' | 'dark' | 'forest' | 'neutral'
  }
  /** DOT-specific options */
  dot?: {
    title?: string
    rankdir?: 'TB' | 'LR' | 'BT' | 'RL'
    includeTooltips?: boolean
  }
}

/**
 * Unified visualization result
 */
export type VisualizationData =
  | D3VisualizationData
  | CytoscapeVisualizationData
  | string // For Mermaid and DOT formats

// =============================================================================
// LAYOUT ALGORITHMS
// =============================================================================

/**
 * Compute layered layout for DAG (Sugiyama-style)
 *
 * This assigns layers to nodes based on their position in the DAG,
 * then positions nodes within each layer to minimize edge crossings.
 */
function computeLayeredLayout(
  graph: LineageGraph,
  options: LayoutOptions = {}
): PositionedGraph {
  const {
    nodeSpacing = 100,
    layerSpacing = 150,
    direction = 'TB',
    padding = 50,
    nodeWidth = 150,
    nodeHeight = 50,
    center = true,
  } = options

  // Build adjacency maps
  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  const nodeMap = new Map<string, LineageNode>()

  for (const node of graph.nodes) {
    nodeMap.set(node.id, node)
    outgoing.set(node.id, [])
    incoming.set(node.id, [])
  }

  for (const edge of graph.edges) {
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId)
    incoming.get(edge.toNodeId)?.push(edge.fromNodeId)
  }

  // Assign layers using longest path from sources
  const layers = new Map<string, number>()
  const sources = graph.nodes.filter((n) => (incoming.get(n.id)?.length ?? 0) === 0)

  // If no sources (cycle), use all nodes
  const startNodes = sources.length > 0 ? sources : graph.nodes

  // BFS to assign layers
  const queue: Array<{ id: string; layer: number }> = startNodes.map((n) => ({
    id: n.id,
    layer: 0,
  }))
  const visited = new Set<string>()

  while (queue.length > 0) {
    const { id, layer } = queue.shift()!

    // Update to maximum layer seen
    const currentLayer = layers.get(id) ?? -1
    if (layer > currentLayer) {
      layers.set(id, layer)
    }

    if (visited.has(id)) continue
    visited.add(id)

    const children = outgoing.get(id) ?? []
    for (const childId of children) {
      queue.push({ id: childId, layer: layer + 1 })
    }
  }

  // Handle any unvisited nodes (disconnected components)
  for (const node of graph.nodes) {
    if (!layers.has(node.id)) {
      layers.set(node.id, 0)
    }
  }

  // Group nodes by layer
  const layerGroups = new Map<number, string[]>()
  for (const [nodeId, layer] of layers) {
    if (!layerGroups.has(layer)) {
      layerGroups.set(layer, [])
    }
    layerGroups.get(layer)!.push(nodeId)
  }

  // Compute positions
  const positions = new Map<string, Position>()
  const maxLayer = Math.max(...Array.from(layers.values()))

  for (const [layer, nodeIds] of layerGroups) {
    const layerWidth = nodeIds.length * (nodeWidth + nodeSpacing) - nodeSpacing
    let x = -layerWidth / 2

    for (const nodeId of nodeIds) {
      let px: number, py: number

      switch (direction) {
        case 'TB':
          px = x + nodeWidth / 2
          py = layer * layerSpacing
          break
        case 'BT':
          px = x + nodeWidth / 2
          py = (maxLayer - layer) * layerSpacing
          break
        case 'LR':
          px = layer * layerSpacing
          py = x + nodeHeight / 2
          break
        case 'RL':
          px = (maxLayer - layer) * layerSpacing
          py = x + nodeHeight / 2
          break
        default:
          px = x + nodeWidth / 2
          py = layer * layerSpacing
      }

      positions.set(nodeId, { x: px, y: py })
      x += nodeWidth + nodeSpacing
    }
  }

  // Compute bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x - nodeWidth / 2)
    minY = Math.min(minY, pos.y - nodeHeight / 2)
    maxX = Math.max(maxX, pos.x + nodeWidth / 2)
    maxY = Math.max(maxY, pos.y + nodeHeight / 2)
  }

  // Apply padding and centering
  if (center) {
    const offsetX = -minX + padding
    const offsetY = -minY + padding
    for (const [nodeId, pos] of positions) {
      positions.set(nodeId, {
        x: pos.x + offsetX,
        y: pos.y + offsetY,
      })
    }
    minX = padding
    minY = padding
    maxX = maxX - minX + 2 * padding
    maxY = maxY - minY + 2 * padding
  }

  // Build positioned nodes
  const positionedNodes: PositionedNode[] = graph.nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    layer: layers.get(node.id),
  }))

  // Build visualization edges
  const visualEdges: VisualizationEdge[] = graph.edges.map((edge) => ({
    ...edge,
    style: 'normal',
  }))

  return {
    nodes: positionedNodes,
    edges: visualEdges,
    rootId: graph.rootId,
    bounds: {
      width: maxX - minX,
      height: maxY - minY,
      minX,
      minY,
      maxX,
      maxY,
    },
    algorithm: 'layered',
  }
}

/**
 * Compute hierarchical layout (similar to layered but optimized for trees)
 */
function computeHierarchicalLayout(
  graph: LineageGraph,
  options: LayoutOptions = {}
): PositionedGraph {
  // Hierarchical uses same algorithm as layered with different defaults
  return computeLayeredLayout(graph, {
    ...options,
    algorithm: 'hierarchical',
  })
}

/**
 * Compute force-directed layout positions
 *
 * Uses simple spring-based simulation for positioning.
 * For actual rendering, D3.js would run its own simulation.
 */
function computeForceLayout(
  graph: LineageGraph,
  options: LayoutOptions = {}
): PositionedGraph {
  const {
    nodeSpacing = 100,
    padding = 50,
    nodeWidth = 150,
    nodeHeight = 50,
  } = options

  // Simple circular initial placement
  const n = graph.nodes.length
  const radius = Math.max(nodeSpacing * n / (2 * Math.PI), 200)

  const positions = new Map<string, Position>()
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n
    positions.set(graph.nodes[i].id, {
      x: radius * Math.cos(angle) + radius + padding,
      y: radius * Math.sin(angle) + radius + padding,
    })
  }

  // Simple force simulation iterations
  const iterations = 50
  const repulsion = 5000
  const attraction = 0.1

  // Build edge set for quick lookup
  const edges = new Set<string>()
  for (const edge of graph.edges) {
    edges.add(`${edge.fromNodeId}:${edge.toNodeId}`)
    edges.add(`${edge.toNodeId}:${edge.fromNodeId}`)
  }

  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map<string, { fx: number; fy: number }>()

    // Initialize forces
    for (const node of graph.nodes) {
      forces.set(node.id, { fx: 0, fy: 0 })
    }

    // Repulsion between all nodes
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const n1 = graph.nodes[i]
        const n2 = graph.nodes[j]
        const p1 = positions.get(n1.id)!
        const p2 = positions.get(n2.id)!

        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)

        const force = repulsion / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force

        forces.get(n1.id)!.fx -= fx
        forces.get(n1.id)!.fy -= fy
        forces.get(n2.id)!.fx += fx
        forces.get(n2.id)!.fy += fy
      }
    }

    // Attraction along edges
    for (const edge of graph.edges) {
      const p1 = positions.get(edge.fromNodeId)
      const p2 = positions.get(edge.toNodeId)
      if (!p1 || !p2) continue

      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      const force = dist * attraction
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force

      forces.get(edge.fromNodeId)!.fx += fx
      forces.get(edge.fromNodeId)!.fy += fy
      forces.get(edge.toNodeId)!.fx -= fx
      forces.get(edge.toNodeId)!.fy -= fy
    }

    // Apply forces with damping
    const damping = 0.9 * (1 - iter / iterations)
    for (const [nodeId, force] of forces) {
      const pos = positions.get(nodeId)!
      pos.x += force.fx * damping
      pos.y += force.fy * damping
    }
  }

  // Compute bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x - nodeWidth / 2)
    minY = Math.min(minY, pos.y - nodeHeight / 2)
    maxX = Math.max(maxX, pos.x + nodeWidth / 2)
    maxY = Math.max(maxY, pos.y + nodeHeight / 2)
  }

  // Normalize to positive coordinates
  const offsetX = -minX + padding
  const offsetY = -minY + padding
  for (const pos of positions.values()) {
    pos.x += offsetX
    pos.y += offsetY
  }

  const positionedNodes: PositionedNode[] = graph.nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
  }))

  const visualEdges: VisualizationEdge[] = graph.edges.map((edge) => ({
    ...edge,
    style: 'normal',
  }))

  return {
    nodes: positionedNodes,
    edges: visualEdges,
    rootId: graph.rootId,
    bounds: {
      width: maxX - minX + 2 * padding,
      height: maxY - minY + 2 * padding,
      minX: padding,
      minY: padding,
      maxX: maxX - minX + padding,
      maxY: maxY - minY + padding,
    },
    algorithm: 'force',
  }
}

/**
 * Compute radial layout from center
 */
function computeRadialLayout(
  graph: LineageGraph,
  options: LayoutOptions = {}
): PositionedGraph {
  const {
    nodeSpacing = 80,
    layerSpacing = 150,
    padding = 50,
    nodeWidth = 150,
    nodeHeight = 50,
  } = options

  // Find root (use graph.rootId or find nodes with no incoming)
  const incoming = new Map<string, number>()
  for (const node of graph.nodes) {
    incoming.set(node.id, 0)
  }
  for (const edge of graph.edges) {
    incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) ?? 0) + 1)
  }

  let rootId = graph.rootId
  if (!rootId || !incoming.has(rootId)) {
    const sources = graph.nodes.filter((n) => incoming.get(n.id) === 0)
    rootId = sources.length > 0 ? sources[0].id : graph.nodes[0]?.id ?? ''
  }

  // BFS to assign layers
  const layers = new Map<string, number>()
  const outgoing = new Map<string, string[]>()

  for (const node of graph.nodes) {
    outgoing.set(node.id, [])
  }
  for (const edge of graph.edges) {
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId)
  }

  const queue: Array<{ id: string; layer: number }> = [{ id: rootId, layer: 0 }]
  const visited = new Set<string>()

  while (queue.length > 0) {
    const { id, layer } = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    layers.set(id, layer)

    const children = outgoing.get(id) ?? []
    for (const childId of children) {
      if (!visited.has(childId)) {
        queue.push({ id: childId, layer: layer + 1 })
      }
    }
  }

  // Handle unvisited nodes
  let maxLayer = Math.max(...Array.from(layers.values()), 0)
  for (const node of graph.nodes) {
    if (!layers.has(node.id)) {
      layers.set(node.id, maxLayer + 1)
    }
  }
  maxLayer = Math.max(...Array.from(layers.values()))

  // Group by layer
  const layerGroups = new Map<number, string[]>()
  for (const [nodeId, layer] of layers) {
    if (!layerGroups.has(layer)) {
      layerGroups.set(layer, [])
    }
    layerGroups.get(layer)!.push(nodeId)
  }

  // Compute positions radially
  const positions = new Map<string, Position>()
  const centerX = (maxLayer + 1) * layerSpacing + padding
  const centerY = centerX

  for (const [layer, nodeIds] of layerGroups) {
    if (layer === 0) {
      // Center node
      positions.set(nodeIds[0], { x: centerX, y: centerY })
      continue
    }

    const radius = layer * layerSpacing
    const angleStep = (2 * Math.PI) / nodeIds.length
    const startAngle = -Math.PI / 2 // Start from top

    for (let i = 0; i < nodeIds.length; i++) {
      const angle = startAngle + i * angleStep
      positions.set(nodeIds[i], {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      })
    }
  }

  // Compute bounds
  const totalSize = (maxLayer + 1) * layerSpacing * 2 + 2 * padding

  const positionedNodes: PositionedNode[] = graph.nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? { x: centerX, y: centerY },
    layer: layers.get(node.id),
  }))

  const visualEdges: VisualizationEdge[] = graph.edges.map((edge) => ({
    ...edge,
    style: 'normal',
  }))

  return {
    nodes: positionedNodes,
    edges: visualEdges,
    rootId: graph.rootId,
    bounds: {
      width: totalSize,
      height: totalSize,
      minX: padding,
      minY: padding,
      maxX: totalSize - padding,
      maxY: totalSize - padding,
    },
    algorithm: 'radial',
  }
}

/**
 * Compute grid layout
 */
function computeGridLayout(
  graph: LineageGraph,
  options: LayoutOptions = {}
): PositionedGraph {
  const {
    nodeSpacing = 50,
    padding = 50,
    nodeWidth = 150,
    nodeHeight = 50,
  } = options

  const n = graph.nodes.length
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)

  const cellWidth = nodeWidth + nodeSpacing
  const cellHeight = nodeHeight + nodeSpacing

  const positions = new Map<string, Position>()

  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    positions.set(graph.nodes[i].id, {
      x: padding + col * cellWidth + nodeWidth / 2,
      y: padding + row * cellHeight + nodeHeight / 2,
    })
  }

  const positionedNodes: PositionedNode[] = graph.nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
  }))

  const visualEdges: VisualizationEdge[] = graph.edges.map((edge) => ({
    ...edge,
    style: 'normal',
  }))

  return {
    nodes: positionedNodes,
    edges: visualEdges,
    rootId: graph.rootId,
    bounds: {
      width: cols * cellWidth + 2 * padding,
      height: rows * cellHeight + 2 * padding,
      minX: padding,
      minY: padding,
      maxX: cols * cellWidth + padding,
      maxY: rows * cellHeight + padding,
    },
    algorithm: 'grid',
  }
}

// =============================================================================
// FILTERING
// =============================================================================

/**
 * Filter a lineage graph based on criteria
 */
export function filterGraph(
  graph: LineageGraph,
  options: FilterOptions
): LineageGraph {
  const {
    nodeTypes,
    namespaces,
    owners,
    tags,
    predicate,
    includeConnected = false,
    maxDepthFromFiltered,
  } = options

  // Build initial set of matching nodes
  const matchingNodes = new Set<string>()

  for (const node of graph.nodes) {
    let matches = true

    if (nodeTypes && !nodeTypes.includes(node.type)) {
      matches = false
    }

    if (namespaces && (!node.namespace || !namespaces.includes(node.namespace))) {
      matches = false
    }

    if (owners) {
      const owner = (node.metadata?.owner as string) ?? ''
      if (!owners.includes(owner)) {
        matches = false
      }
    }

    if (tags) {
      const nodeTags = (node.metadata?.tags as string[]) ?? []
      if (!tags.some((t) => nodeTags.includes(t))) {
        matches = false
      }
    }

    if (predicate && !predicate(node)) {
      matches = false
    }

    if (matches) {
      matchingNodes.add(node.id)
    }
  }

  // If includeConnected, expand to connected nodes
  if (includeConnected) {
    const toExpand = new Set(matchingNodes)
    const maxDepth = maxDepthFromFiltered ?? Infinity

    // Build adjacency
    const neighbors = new Map<string, string[]>()
    for (const node of graph.nodes) {
      neighbors.set(node.id, [])
    }
    for (const edge of graph.edges) {
      neighbors.get(edge.fromNodeId)?.push(edge.toNodeId)
      neighbors.get(edge.toNodeId)?.push(edge.fromNodeId)
    }

    // BFS expansion
    const queue: Array<{ id: string; depth: number }> = []
    for (const id of toExpand) {
      queue.push({ id, depth: 0 })
    }

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!
      if (depth >= maxDepth) continue

      const adjacent = neighbors.get(id) ?? []
      for (const adjId of adjacent) {
        if (!matchingNodes.has(adjId)) {
          matchingNodes.add(adjId)
          queue.push({ id: adjId, depth: depth + 1 })
        }
      }
    }
  }

  // Filter nodes and edges
  const filteredNodes = graph.nodes.filter((n) => matchingNodes.has(n.id))
  const filteredEdges = graph.edges.filter(
    (e) => matchingNodes.has(e.fromNodeId) && matchingNodes.has(e.toNodeId)
  )

  return {
    nodes: filteredNodes,
    edges: filteredEdges,
    rootId: matchingNodes.has(graph.rootId) ? graph.rootId : filteredNodes[0]?.id ?? '',
  }
}

// =============================================================================
// GROUPING
// =============================================================================

/**
 * Group nodes based on criteria
 */
export function groupNodes(
  graph: LineageGraph,
  options: GroupingOptions
): { graph: LineageGraph; groups: NodeGroup[] } {
  const {
    byNamespace = false,
    byType = false,
    byOwner = false,
    groupBy,
    minGroupSize = 2,
    startCollapsed = false,
  } = options

  // Determine group key for each node
  const nodeGroups = new Map<string, string>()

  const getGroupKey = (node: LineageNode): string | null => {
    if (groupBy) {
      return groupBy(node)
    }

    const parts: string[] = []
    if (byNamespace && node.namespace) {
      parts.push(`ns:${node.namespace}`)
    }
    if (byType) {
      parts.push(`type:${node.type}`)
    }
    if (byOwner) {
      const owner = (node.metadata?.owner as string) ?? ''
      if (owner) {
        parts.push(`owner:${owner}`)
      }
    }

    return parts.length > 0 ? parts.join('|') : null
  }

  // Assign nodes to groups
  const groupMembers = new Map<string, string[]>()

  for (const node of graph.nodes) {
    const key = getGroupKey(node)
    if (key) {
      nodeGroups.set(node.id, key)
      if (!groupMembers.has(key)) {
        groupMembers.set(key, [])
      }
      groupMembers.get(key)!.push(node.id)
    }
  }

  // Filter out small groups
  const validGroups = new Map<string, string[]>()
  for (const [key, members] of groupMembers) {
    if (members.length >= minGroupSize) {
      validGroups.set(key, members)
    }
  }

  // Build NodeGroup objects
  const groups: NodeGroup[] = []
  let groupIndex = 0

  for (const [key, members] of validGroups) {
    const groupId = `group-${groupIndex++}`
    groups.push({
      id: groupId,
      label: key,
      key,
      nodeCount: members.length,
      collapsed: startCollapsed,
      nodeIds: members,
    })

    // Update node group mappings
    for (const nodeId of members) {
      nodeGroups.set(nodeId, groupId)
    }
  }

  // Create modified graph with group assignments
  const modifiedNodes = graph.nodes.map((node) => ({
    ...node,
    metadata: {
      ...node.metadata,
      groupId: nodeGroups.get(node.id),
    },
  }))

  return {
    graph: {
      ...graph,
      nodes: modifiedNodes,
    },
    groups,
  }
}

// =============================================================================
// HIGHLIGHTING
// =============================================================================

/**
 * Apply highlighting to a positioned graph
 */
export function applyHighlighting(
  graph: PositionedGraph,
  options: HighlightOptions
): PositionedGraph {
  const {
    fromNodes = [],
    toNodes = [],
    paths = [],
    impactNodes = [],
    color = '#FF6B6B',
    includeRelated = false,
  } = options

  // Build node highlight set
  const highlightedNodes = new Set<string>()
  const highlightedEdges = new Set<string>()

  // Highlight specific nodes
  for (const nodeId of [...fromNodes, ...toNodes, ...impactNodes]) {
    highlightedNodes.add(nodeId)
  }

  // Highlight paths
  for (const path of paths) {
    for (const nodeId of path) {
      highlightedNodes.add(nodeId)
    }
    // Find edges along path
    for (let i = 0; i < path.length - 1; i++) {
      const edgeKey = `${path[i]}:${path[i + 1]}`
      highlightedEdges.add(edgeKey)
    }
  }

  // Build adjacency for related highlighting
  if (includeRelated && highlightedNodes.size > 0) {
    const outgoing = new Map<string, string[]>()
    const incoming = new Map<string, string[]>()

    for (const node of graph.nodes) {
      outgoing.set(node.id, [])
      incoming.set(node.id, [])
    }

    for (const edge of graph.edges) {
      outgoing.get(edge.fromNodeId)?.push(edge.toNodeId)
      incoming.get(edge.toNodeId)?.push(edge.fromNodeId)
    }

    // Expand upstream from toNodes
    for (const nodeId of toNodes) {
      const queue = [nodeId]
      const visited = new Set<string>()

      while (queue.length > 0) {
        const current = queue.shift()!
        if (visited.has(current)) continue
        visited.add(current)
        highlightedNodes.add(current)

        const parents = incoming.get(current) ?? []
        for (const parent of parents) {
          queue.push(parent)
          highlightedEdges.add(`${parent}:${current}`)
        }
      }
    }

    // Expand downstream from fromNodes
    for (const nodeId of fromNodes) {
      const queue = [nodeId]
      const visited = new Set<string>()

      while (queue.length > 0) {
        const current = queue.shift()!
        if (visited.has(current)) continue
        visited.add(current)
        highlightedNodes.add(current)

        const children = outgoing.get(current) ?? []
        for (const child of children) {
          queue.push(child)
          highlightedEdges.add(`${current}:${child}`)
        }
      }
    }
  }

  // Also highlight edges between highlighted nodes
  for (const edge of graph.edges) {
    if (highlightedNodes.has(edge.fromNodeId) && highlightedNodes.has(edge.toNodeId)) {
      highlightedEdges.add(`${edge.fromNodeId}:${edge.toNodeId}`)
    }
  }

  // Apply highlights
  const highlightedNodesResult: PositionedNode[] = graph.nodes.map((node) => ({
    ...node,
    metadata: {
      ...node.metadata,
      highlighted: highlightedNodes.has(node.id),
    },
  }))

  const highlightedEdgesResult: VisualizationEdge[] = graph.edges.map((edge) => ({
    ...edge,
    highlighted: highlightedEdges.has(`${edge.fromNodeId}:${edge.toNodeId}`),
    color: highlightedEdges.has(`${edge.fromNodeId}:${edge.toNodeId}`) ? color : undefined,
    style: highlightedEdges.has(`${edge.fromNodeId}:${edge.toNodeId}`) ? 'bold' : 'normal',
  }))

  return {
    ...graph,
    nodes: highlightedNodesResult,
    edges: highlightedEdgesResult,
  }
}

// =============================================================================
// LAYOUT API
// =============================================================================

/**
 * Compute layout positions for a lineage graph
 *
 * @example
 * ```typescript
 * const positioned = layoutGraph(graph, { algorithm: 'dagre', direction: 'LR' })
 * console.log(positioned.bounds.width, positioned.bounds.height)
 * ```
 */
export function layoutGraph(
  graph: LineageGraph,
  options: LayoutOptions = {}
): PositionedGraph {
  const algorithm = options.algorithm ?? 'layered'

  switch (algorithm) {
    case 'dagre':
    case 'layered':
      return computeLayeredLayout(graph, options)
    case 'hierarchical':
      return computeHierarchicalLayout(graph, options)
    case 'force':
      return computeForceLayout(graph, options)
    case 'radial':
      return computeRadialLayout(graph, options)
    case 'grid':
      return computeGridLayout(graph, options)
    default:
      return computeLayeredLayout(graph, options)
  }
}

// =============================================================================
// FORMAT CONVERTERS
// =============================================================================

/**
 * Convert positioned graph to D3.js format
 */
function toD3Format(
  graph: PositionedGraph,
  options: VisualizationOptions = {}
): D3VisualizationData {
  const { includeMetadata = true, grouping } = options

  const typeToGroup: Record<NodeType, number> = {
    source: 0,
    transformation: 1,
    entity: 2,
    sink: 3,
  }

  // Extract groups if grouping was applied
  let groups: NodeGroup[] | undefined
  if (grouping) {
    const { groups: computedGroups } = groupNodes(
      { nodes: graph.nodes, edges: graph.edges, rootId: graph.rootId },
      grouping
    )
    groups = computedGroups
  }

  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      namespace: node.namespace,
      group: typeToGroup[node.type],
      x: node.position.x,
      y: node.position.y,
      fx: null,
      fy: null,
      highlighted: !!node.metadata?.highlighted,
      groupId: node.groupId,
      metadata: includeMetadata ? node.metadata : undefined,
    })),
    links: graph.edges.map((edge) => ({
      source: edge.fromNodeId,
      target: edge.toNodeId,
      operation: edge.operation,
      value: 1,
      highlighted: edge.highlighted,
      style: edge.style,
      color: edge.color,
      metadata: includeMetadata ? edge.metadata : undefined,
    })),
    groups,
  }
}

/**
 * Convert positioned graph to Cytoscape.js format
 */
function toCytoscapeFormat(
  graph: PositionedGraph,
  options: VisualizationOptions = {}
): CytoscapeVisualizationData {
  return {
    nodes: graph.nodes.map((node) => ({
      data: {
        id: node.id,
        label: node.name,
        type: node.type,
        namespace: node.namespace,
        parent: node.groupId,
        highlighted: !!node.metadata?.highlighted,
      },
      position: node.position,
      classes: [node.type, node.metadata?.highlighted ? 'highlighted' : ''].filter(Boolean),
    })),
    edges: graph.edges.map((edge) => ({
      data: {
        id: edge.id,
        source: edge.fromNodeId,
        target: edge.toNodeId,
        operation: edge.operation,
        highlighted: edge.highlighted,
      },
      classes: [edge.style ?? 'normal', edge.highlighted ? 'highlighted' : ''].filter(Boolean),
    })),
  }
}

/**
 * Convert graph to Mermaid format
 */
function toMermaidFormat(
  graph: LineageGraph,
  options: VisualizationOptions = {}
): string {
  const {
    mermaid: mermaidOpts = {},
  } = options

  const {
    direction = 'TB',
    includeOperations = true,
    theme,
  } = mermaidOpts

  const lines: string[] = []

  // Add theme directive if specified
  if (theme) {
    lines.push(`%%{init: {'theme': '${theme}'}}%%`)
  }

  // Graph header
  lines.push(`graph ${direction}`)

  // Node shape mapping
  const shapeMap: Record<NodeType, { start: string; end: string }> = {
    source: { start: '[(', end: ')]' },       // Cylinder
    transformation: { start: '(', end: ')' }, // Round
    entity: { start: '[', end: ']' },         // Rectangle
    sink: { start: '([', end: '])' },         // Stadium
  }

  // Sanitize IDs for Mermaid
  const sanitizeId = (id: string): string => id.replace(/[^a-zA-Z0-9]/g, '_')

  // Node definitions
  for (const node of graph.nodes) {
    const nodeId = sanitizeId(node.id)
    const shape = shapeMap[node.type] ?? { start: '[', end: ']' }
    const label = node.name.replace(/"/g, "'")

    // Add namespace as subgraph if present
    if (node.namespace) {
      lines.push(`  subgraph ${sanitizeId(node.namespace)}["${node.namespace}"]`)
      lines.push(`    ${nodeId}${shape.start}"${label}"${shape.end}`)
      lines.push('  end')
    } else {
      lines.push(`  ${nodeId}${shape.start}"${label}"${shape.end}`)
    }
  }

  lines.push('')

  // Edge definitions
  for (const edge of graph.edges) {
    const fromId = sanitizeId(edge.fromNodeId)
    const toId = sanitizeId(edge.toNodeId)
    const operation = edge.operation.replace(/"/g, "'")

    if (includeOperations && operation) {
      lines.push(`  ${fromId} -->|"${operation}"| ${toId}`)
    } else {
      lines.push(`  ${fromId} --> ${toId}`)
    }
  }

  return lines.join('\n')
}

/**
 * Convert graph to DOT/Graphviz format
 */
function toDotFormat(
  graph: LineageGraph,
  options: VisualizationOptions = {}
): string {
  const {
    dot: dotOpts = {},
  } = options

  const {
    title = 'Lineage',
    rankdir = 'TB',
    includeTooltips = false,
  } = dotOpts

  const shapeMap: Record<NodeType, string> = {
    source: 'cylinder',
    transformation: 'ellipse',
    entity: 'box',
    sink: 'house',
  }

  const colorMap: Record<NodeType, string> = {
    source: '#32CD32',
    transformation: '#7B68EE',
    entity: '#4A90D9',
    sink: '#FF6347',
  }

  const lines: string[] = []

  // Escape for DOT
  const escapeId = (id: string): string => id.replace(/[^a-zA-Z0-9_]/g, '_')
  const escapeLabel = (label: string): string => label.replace(/"/g, '\\"')

  // Graph header
  lines.push(`digraph ${escapeId(title)} {`)
  lines.push(`  rankdir=${rankdir};`)
  lines.push('  node [style=filled fontname="Helvetica" fontsize=12];')
  lines.push('  edge [fontname="Helvetica" fontsize=10];')
  lines.push('')

  // Group by namespace as subgraph clusters
  const byNamespace = new Map<string, LineageNode[]>()
  for (const node of graph.nodes) {
    const ns = node.namespace ?? ''
    if (!byNamespace.has(ns)) {
      byNamespace.set(ns, [])
    }
    byNamespace.get(ns)!.push(node)
  }

  for (const [namespace, nodes] of byNamespace) {
    if (namespace) {
      lines.push(`  subgraph cluster_${escapeId(namespace)} {`)
      lines.push(`    label="${escapeLabel(namespace)}";`)
      lines.push('    style=dashed;')
    }

    for (const node of nodes) {
      const nodeId = escapeId(node.id)
      const shape = shapeMap[node.type]
      const color = colorMap[node.type]
      const label = escapeLabel(node.name)

      let attrs = `label="${label}" shape=${shape} fillcolor="${color}"`

      if (includeTooltips && Object.keys(node.metadata).length > 0) {
        const tooltip = Object.entries(node.metadata)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join('\\n')
        attrs += ` tooltip="${tooltip}"`
      }

      const indent = namespace ? '    ' : '  '
      lines.push(`${indent}"${nodeId}" [${attrs}];`)
    }

    if (namespace) {
      lines.push('  }')
    }
  }

  lines.push('')

  // Edges
  for (const edge of graph.edges) {
    const fromId = escapeId(edge.fromNodeId)
    const toId = escapeId(edge.toNodeId)
    const label = escapeLabel(edge.operation)

    lines.push(`  "${fromId}" -> "${toId}" [label="${label}"];`)
  }

  lines.push('}')

  return lines.join('\n')
}

// =============================================================================
// MAIN API
// =============================================================================

/**
 * Convert a lineage graph to visualization-ready format
 *
 * This is the main entry point for the visualization API. It handles:
 * - Filtering the graph based on criteria
 * - Computing layout positions
 * - Applying highlighting for paths/impacts
 * - Converting to the requested output format
 *
 * @example
 * ```typescript
 * // D3.js format for web visualization
 * const d3Data = toVisualization(graph, { format: 'd3' })
 *
 * // Mermaid for documentation
 * const mermaid = toVisualization(graph, { format: 'mermaid' })
 *
 * // With filtering and highlighting
 * const filtered = toVisualization(graph, {
 *   format: 'cytoscape',
 *   filter: { nodeTypes: ['source', 'sink'] },
 *   highlight: { impactNodes: ['node-1', 'node-2'] },
 *   layout: { algorithm: 'hierarchical', direction: 'LR' },
 * })
 * ```
 */
export function toVisualization(
  graph: LineageGraph,
  options: VisualizationOptions = {}
): VisualizationData {
  const {
    format = 'd3',
    filter,
    layout: layoutOpts,
    highlight,
    grouping,
  } = options

  // Step 1: Filter if needed
  let workingGraph = graph
  if (filter) {
    workingGraph = filterGraph(graph, filter)
  }

  // Step 2: Apply grouping if needed
  let groups: NodeGroup[] = []
  if (grouping) {
    const result = groupNodes(workingGraph, grouping)
    workingGraph = result.graph
    groups = result.groups
  }

  // For string formats (mermaid, dot), we don't need layout
  if (format === 'mermaid') {
    return toMermaidFormat(workingGraph, options)
  }

  if (format === 'dot') {
    return toDotFormat(workingGraph, options)
  }

  if (format === 'json') {
    return JSON.stringify({
      nodes: workingGraph.nodes,
      edges: workingGraph.edges,
      rootId: workingGraph.rootId,
      groups,
    }, null, 2)
  }

  // Step 3: Compute layout
  let positioned = layoutGraph(workingGraph, layoutOpts)

  // Step 4: Apply highlighting if needed
  if (highlight) {
    positioned = applyHighlighting(positioned, highlight)
  }

  // Step 5: Convert to requested format
  switch (format) {
    case 'd3':
      return toD3Format(positioned, { ...options, grouping })
    case 'cytoscape':
      return toCytoscapeFormat(positioned, options)
    default:
      return toD3Format(positioned, options)
  }
}

/**
 * Convenience function for Mermaid export
 *
 * @example
 * ```typescript
 * const diagram = toMermaid(graph)
 * // Use in markdown: ```mermaid\n${diagram}\n```
 * ```
 */
export function toMermaid(
  graph: LineageGraph,
  options?: VisualizationOptions['mermaid']
): string {
  return toMermaidFormat(graph, { mermaid: options })
}

// =============================================================================
// LINEAGE VISUALIZATION CLASS
// =============================================================================

/**
 * LineageVisualization - High-level API for graph visualization
 *
 * Provides a fluent interface for building visualizations with filtering,
 * layout, and highlighting.
 *
 * @example
 * ```typescript
 * const viz = new LineageVisualization(graph)
 *   .filter({ nodeTypes: ['source', 'transformation'] })
 *   .layout('hierarchical', { direction: 'LR' })
 *   .highlight({ impactNodes: ['users-table'] })
 *   .format('d3')
 *   .build()
 * ```
 */
export class LineageVisualization {
  private graph: LineageGraph
  private options: VisualizationOptions = {}

  constructor(graph: LineageGraph) {
    this.graph = graph
  }

  /**
   * Apply filter to the graph
   */
  filter(filterOptions: FilterOptions): this {
    this.options.filter = filterOptions
    return this
  }

  /**
   * Set layout algorithm and options
   */
  layout(algorithm: LayoutAlgorithm, layoutOptions?: Partial<LayoutOptions>): this {
    this.options.layout = {
      ...layoutOptions,
      algorithm,
    }
    return this
  }

  /**
   * Apply highlighting
   */
  highlight(highlightOptions: HighlightOptions): this {
    this.options.highlight = highlightOptions
    return this
  }

  /**
   * Group nodes
   */
  group(groupingOptions: GroupingOptions): this {
    this.options.grouping = groupingOptions
    return this
  }

  /**
   * Set output format
   */
  format(format: VisualizationFormat): this {
    this.options.format = format
    return this
  }

  /**
   * Set Mermaid-specific options
   */
  mermaidOptions(opts: VisualizationOptions['mermaid']): this {
    this.options.mermaid = opts
    return this
  }

  /**
   * Set DOT-specific options
   */
  dotOptions(opts: VisualizationOptions['dot']): this {
    this.options.dot = opts
    return this
  }

  /**
   * Include/exclude metadata
   */
  includeMetadata(include: boolean): this {
    this.options.includeMetadata = include
    return this
  }

  /**
   * Build the visualization
   */
  build(): VisualizationData {
    return toVisualization(this.graph, this.options)
  }

  /**
   * Build as D3 data
   */
  toD3(): D3VisualizationData {
    this.options.format = 'd3'
    return this.build() as D3VisualizationData
  }

  /**
   * Build as Cytoscape data
   */
  toCytoscape(): CytoscapeVisualizationData {
    this.options.format = 'cytoscape'
    return this.build() as CytoscapeVisualizationData
  }

  /**
   * Build as Mermaid string
   */
  toMermaid(): string {
    this.options.format = 'mermaid'
    return this.build() as string
  }

  /**
   * Build as DOT string
   */
  toDot(): string {
    this.options.format = 'dot'
    return this.build() as string
  }

  /**
   * Build as JSON string
   */
  toJSON(): string {
    this.options.format = 'json'
    return this.build() as string
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new LineageVisualization builder
 *
 * @example
 * ```typescript
 * const data = createVisualization(graph)
 *   .filter({ namespaces: ['warehouse'] })
 *   .layout('dagre')
 *   .toD3()
 * ```
 */
export function createVisualization(graph: LineageGraph): LineageVisualization {
  return new LineageVisualization(graph)
}
