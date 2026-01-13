/**
 * LineageTracker Export - Visualization and Export Formats
 *
 * Provides export capabilities for lineage graphs in multiple formats:
 * - DOT (Graphviz) for static visualization
 * - Mermaid for Markdown-embedded diagrams
 * - JSON for external tools and APIs
 * - D3 for web visualization
 * - ASCII for terminal display
 *
 * @module db/primitives/lineage-tracker/export
 */

import type { LineageGraph, LineageNode, LineageEdge, NodeType } from './types'

// =============================================================================
// EXPORT OPTIONS
// =============================================================================

/**
 * Options for DOT export
 */
export interface DotOptions {
  /** Graph title */
  title?: string
  /** Graph direction (TB = top-bottom, LR = left-right, etc.) */
  rankdir?: 'TB' | 'LR' | 'BT' | 'RL'
  /** Custom node shapes by type */
  shapes?: Partial<Record<NodeType, string>>
  /** Custom node colors by type */
  colors?: Partial<Record<NodeType, string>>
  /** Include metadata as tooltips */
  includeMetadata?: boolean
  /** Font name */
  fontName?: string
  /** Font size */
  fontSize?: number
}

/**
 * Options for Mermaid export
 */
export interface MermaidOptions {
  /** Graph direction */
  direction?: 'TB' | 'LR' | 'BT' | 'RL'
  /** Custom node shapes by type */
  shapes?: Partial<Record<NodeType, 'rect' | 'round' | 'stadium' | 'subroutine' | 'cylinder' | 'circle' | 'rhombus' | 'hexagon' | 'parallelogram' | 'trapezoid'>>
  /** Include operation labels on edges */
  includeOperations?: boolean
}

/**
 * D3 compatible graph format
 */
export interface D3Graph {
  nodes: Array<{
    id: string
    name: string
    type: NodeType
    namespace?: string
    group: number
    metadata?: Record<string, unknown>
  }>
  links: Array<{
    source: string
    target: string
    operation: string
    value: number
    metadata?: Record<string, unknown>
  }>
}

/**
 * Options for ASCII export
 */
export interface AsciiOptions {
  /** Maximum width of the output */
  maxWidth?: number
  /** Character for horizontal lines */
  horizontalChar?: string
  /** Character for vertical lines */
  verticalChar?: string
  /** Character for connections */
  connectionChar?: string
}

// =============================================================================
// DEFAULT CONFIGURATIONS
// =============================================================================

const DEFAULT_DOT_SHAPES: Record<NodeType, string> = {
  entity: 'box',
  transformation: 'ellipse',
  source: 'cylinder',
  sink: 'house',
}

const DEFAULT_DOT_COLORS: Record<NodeType, string> = {
  entity: '#4A90D9',
  transformation: '#7B68EE',
  source: '#32CD32',
  sink: '#FF6347',
}

const DEFAULT_MERMAID_SHAPES: Record<NodeType, 'rect' | 'round' | 'stadium' | 'subroutine' | 'cylinder' | 'circle' | 'rhombus' | 'hexagon' | 'parallelogram' | 'trapezoid'> = {
  entity: 'rect',
  transformation: 'round',
  source: 'cylinder',
  sink: 'stadium',
}

// =============================================================================
// LINEAGE EXPORTER CLASS
// =============================================================================

/**
 * LineageExporter - Export lineage graphs to various formats
 */
export class LineageExporter {
  /**
   * Export to Graphviz DOT format
   *
   * @example
   * ```typescript
   * const dot = exporter.toDot(graph, { rankdir: 'LR' })
   * // digraph Lineage {
   * //   rankdir=LR;
   * //   "node-1" [label="users" shape=box fillcolor="#4A90D9"];
   * //   "node-1" -> "node-2" [label="read"];
   * // }
   * ```
   */
  toDot(graph: LineageGraph, options?: DotOptions): string {
    const {
      title = 'Lineage',
      rankdir = 'TB',
      shapes = DEFAULT_DOT_SHAPES,
      colors = DEFAULT_DOT_COLORS,
      includeMetadata = false,
      fontName = 'Helvetica',
      fontSize = 12,
    } = options ?? {}

    const lines: string[] = []

    // Graph header
    lines.push(`digraph ${this.escapeId(title)} {`)
    lines.push(`  rankdir=${rankdir};`)
    lines.push(`  fontname="${fontName}";`)
    lines.push(`  fontsize=${fontSize};`)
    lines.push(`  node [style=filled fontname="${fontName}" fontsize=${fontSize}];`)
    lines.push(`  edge [fontname="${fontName}" fontsize=${fontSize - 2}];`)
    lines.push('')

    // Node definitions
    for (const node of graph.nodes) {
      const shape = shapes[node.type] ?? DEFAULT_DOT_SHAPES[node.type]
      const color = colors[node.type] ?? DEFAULT_DOT_COLORS[node.type]
      const label = this.escapeLabel(node.name)
      const nodeId = this.escapeId(node.id)

      let attrs = `label="${label}" shape=${shape} fillcolor="${color}"`

      if (includeMetadata && Object.keys(node.metadata).length > 0) {
        const tooltip = this.formatMetadataTooltip(node.metadata)
        attrs += ` tooltip="${tooltip}"`
      }

      // Add namespace as a subgraph cluster if present
      if (node.namespace) {
        attrs += ` xlabel="${this.escapeLabel(node.namespace)}"`
      }

      lines.push(`  "${nodeId}" [${attrs}];`)
    }

    lines.push('')

    // Edge definitions
    for (const edge of graph.edges) {
      const fromId = this.escapeId(edge.fromNodeId)
      const toId = this.escapeId(edge.toNodeId)
      const label = this.escapeLabel(edge.operation)

      let attrs = `label="${label}"`

      if (includeMetadata && Object.keys(edge.metadata).length > 0) {
        const tooltip = this.formatMetadataTooltip(edge.metadata)
        attrs += ` tooltip="${tooltip}"`
      }

      lines.push(`  "${fromId}" -> "${toId}" [${attrs}];`)
    }

    lines.push('}')

    return lines.join('\n')
  }

  /**
   * Export to Mermaid diagram format
   *
   * @example
   * ```typescript
   * const mermaid = exporter.toMermaid(graph)
   * // graph TB
   * //   node-1[users]
   * //   node-1 -->|read| node-2
   * ```
   */
  toMermaid(graph: LineageGraph, options?: MermaidOptions): string {
    const {
      direction = 'TB',
      shapes = DEFAULT_MERMAID_SHAPES,
      includeOperations = true,
    } = options ?? {}

    const lines: string[] = []

    // Graph header
    lines.push(`graph ${direction}`)

    // Node definitions with shapes
    for (const node of graph.nodes) {
      const nodeId = this.sanitizeMermaidId(node.id)
      const label = this.escapeLabel(node.name)
      const shape = shapes[node.type] ?? DEFAULT_MERMAID_SHAPES[node.type]

      const nodeStr = this.formatMermaidNode(nodeId, label, shape)
      lines.push(`  ${nodeStr}`)
    }

    lines.push('')

    // Edge definitions
    for (const edge of graph.edges) {
      const fromId = this.sanitizeMermaidId(edge.fromNodeId)
      const toId = this.sanitizeMermaidId(edge.toNodeId)

      if (includeOperations && edge.operation) {
        lines.push(`  ${fromId} -->|${this.escapeLabel(edge.operation)}| ${toId}`)
      } else {
        lines.push(`  ${fromId} --> ${toId}`)
      }
    }

    return lines.join('\n')
  }

  /**
   * Export to JSON format
   *
   * @example
   * ```typescript
   * const json = exporter.toJSON(graph)
   * // { "nodes": [...], "edges": [...], "rootId": "..." }
   * ```
   */
  toJSON(graph: LineageGraph): string {
    return JSON.stringify(graph, null, 2)
  }

  /**
   * Export to D3-compatible format
   *
   * @example
   * ```typescript
   * const d3Data = exporter.toD3(graph)
   * // Pass to d3.forceSimulation()
   * ```
   */
  toD3(graph: LineageGraph): D3Graph {
    const typeToGroup: Record<NodeType, number> = {
      source: 0,
      transformation: 1,
      entity: 2,
      sink: 3,
    }

    return {
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        type: node.type,
        namespace: node.namespace,
        group: typeToGroup[node.type],
        metadata: node.metadata,
      })),
      links: graph.edges.map((edge) => ({
        source: edge.fromNodeId,
        target: edge.toNodeId,
        operation: edge.operation,
        value: 1,
        metadata: edge.metadata,
      })),
    }
  }

  /**
   * Generate ASCII art representation for terminal display
   *
   * @example
   * ```typescript
   * const ascii = exporter.toAscii(graph)
   * // +--------+     +----------+     +------+
   * // | Source | --> | Transform| --> | Sink |
   * // +--------+     +----------+     +------+
   * ```
   */
  toAscii(graph: LineageGraph, options?: AsciiOptions): string {
    const {
      maxWidth = 80,
      horizontalChar = '-',
      verticalChar = '|',
      connectionChar = '+',
    } = options ?? {}

    if (graph.nodes.length === 0) {
      return '(empty graph)'
    }

    // Build adjacency map for layout
    const adjacency = new Map<string, string[]>()
    for (const edge of graph.edges) {
      if (!adjacency.has(edge.fromNodeId)) {
        adjacency.set(edge.fromNodeId, [])
      }
      adjacency.get(edge.fromNodeId)!.push(edge.toNodeId)
    }

    // Find root nodes (no incoming edges)
    const hasIncoming = new Set(graph.edges.map((e) => e.toNodeId))
    const roots = graph.nodes.filter((n) => !hasIncoming.has(n.id))

    if (roots.length === 0) {
      // If no roots, pick the first node
      roots.push(graph.nodes[0])
    }

    // Build levels using BFS
    const levels: LineageNode[][] = []
    const visited = new Set<string>()
    let currentLevel = roots

    while (currentLevel.length > 0) {
      levels.push(currentLevel)
      for (const node of currentLevel) {
        visited.add(node.id)
      }

      const nextLevel: LineageNode[] = []
      for (const node of currentLevel) {
        const children = adjacency.get(node.id) ?? []
        for (const childId of children) {
          if (!visited.has(childId)) {
            const child = graph.nodes.find((n) => n.id === childId)
            if (child) {
              nextLevel.push(child)
              visited.add(childId)
            }
          }
        }
      }
      currentLevel = nextLevel
    }

    // Render ASCII
    const lines: string[] = []
    const minNodeWidth = 16

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i]

      // Calculate widths for each node in this level
      const nodeWidths = level.map((n) => {
        const name = n.name.slice(0, minNodeWidth - 4)
        const typeLabel = `[${n.type}]`
        // Width must accommodate both name and type label
        return Math.max(name.length + 4, typeLabel.length + 4, 8)
      })

      // Top border
      const topLine = level.map((n, idx) => {
        const width = nodeWidths[idx]
        return connectionChar + horizontalChar.repeat(width - 2) + connectionChar
      }).join('     ')
      lines.push(topLine)

      // Node name
      const nameLine = level.map((n, idx) => {
        const name = n.name.slice(0, minNodeWidth - 4)
        const width = nodeWidths[idx]
        const padding = Math.max(0, width - 2 - name.length)
        const leftPad = Math.floor(padding / 2)
        const rightPad = Math.max(0, padding - leftPad)
        return verticalChar + ' '.repeat(leftPad) + name + ' '.repeat(rightPad) + verticalChar
      }).join('     ')
      lines.push(nameLine)

      // Type annotation
      const typeLine = level.map((n, idx) => {
        const typeLabel = `[${n.type}]`
        const width = nodeWidths[idx]
        const padding = Math.max(0, width - 2 - typeLabel.length)
        const leftPad = Math.floor(padding / 2)
        const rightPad = Math.max(0, padding - leftPad)
        return verticalChar + ' '.repeat(leftPad) + typeLabel + ' '.repeat(rightPad) + verticalChar
      }).join('     ')
      lines.push(typeLine)

      // Bottom border
      const bottomLine = level.map((_, idx) => {
        const width = nodeWidths[idx]
        return connectionChar + horizontalChar.repeat(width - 2) + connectionChar
      }).join('     ')
      lines.push(bottomLine)

      // Connection arrows to next level
      if (i < levels.length - 1) {
        const arrowLine = level.map((_, idx) => {
          const width = nodeWidths[idx]
          const leftPad = Math.floor((width - 1) / 2)
          return ' '.repeat(leftPad) + verticalChar
        }).join('     ')
        lines.push(arrowLine)
        lines.push(arrowLine.replace(new RegExp(`\\${verticalChar}`, 'g'), 'v'))
        lines.push('')
      }
    }

    // Trim lines to maxWidth
    return lines.map((line) => line.slice(0, maxWidth)).join('\n')
  }

  /**
   * Export to Cytoscape.js format
   */
  toCytoscape(graph: LineageGraph): {
    nodes: Array<{ data: { id: string; label: string; type: NodeType; namespace?: string } }>
    edges: Array<{ data: { id: string; source: string; target: string; operation: string } }>
  } {
    return {
      nodes: graph.nodes.map((node) => ({
        data: {
          id: node.id,
          label: node.name,
          type: node.type,
          namespace: node.namespace,
        },
      })),
      edges: graph.edges.map((edge) => ({
        data: {
          id: edge.id,
          source: edge.fromNodeId,
          target: edge.toNodeId,
          operation: edge.operation,
        },
      })),
    }
  }

  /**
   * Export to PlantUML format
   */
  toPlantUML(graph: LineageGraph): string {
    const lines: string[] = []

    lines.push('@startuml')
    lines.push('left to right direction')
    lines.push('')

    // Define node types with icons
    const typeIcons: Record<NodeType, string> = {
      source: 'database',
      transformation: 'rectangle',
      entity: 'entity',
      sink: 'queue',
    }

    // Group by namespace
    const byNamespace = new Map<string, LineageNode[]>()
    for (const node of graph.nodes) {
      const ns = node.namespace ?? ''
      if (!byNamespace.has(ns)) {
        byNamespace.set(ns, [])
      }
      byNamespace.get(ns)!.push(node)
    }

    // Render namespaces as packages
    for (const [namespace, nodes] of Array.from(byNamespace.entries())) {
      if (namespace) {
        lines.push(`package "${namespace}" {`)
      }

      for (const node of nodes) {
        const icon = typeIcons[node.type]
        lines.push(`  ${icon} "${node.name}" as ${this.sanitizePlantUMLId(node.id)}`)
      }

      if (namespace) {
        lines.push('}')
      }
    }

    lines.push('')

    // Render edges
    for (const edge of graph.edges) {
      const from = this.sanitizePlantUMLId(edge.fromNodeId)
      const to = this.sanitizePlantUMLId(edge.toNodeId)
      lines.push(`${from} --> ${to} : ${edge.operation}`)
    }

    lines.push('@enduml')

    return lines.join('\n')
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private escapeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_')
  }

  private escapeLabel(label: string): string {
    return label.replace(/"/g, '\\"').replace(/\n/g, '\\n')
  }

  private sanitizeMermaidId(id: string): string {
    // Mermaid IDs can't have special characters
    return id.replace(/[^a-zA-Z0-9]/g, '_')
  }

  private sanitizePlantUMLId(id: string): string {
    // PlantUML IDs need to be simple identifiers
    return id.replace(/[^a-zA-Z0-9]/g, '_')
  }

  private formatMetadataTooltip(metadata: Record<string, unknown>): string {
    return Object.entries(metadata)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\\n')
  }

  private formatMermaidNode(id: string, label: string, shape: string): string {
    switch (shape) {
      case 'rect':
        return `${id}[${label}]`
      case 'round':
        return `${id}(${label})`
      case 'stadium':
        return `${id}([${label}])`
      case 'subroutine':
        return `${id}[[${label}]]`
      case 'cylinder':
        return `${id}[(${label})]`
      case 'circle':
        return `${id}((${label}))`
      case 'rhombus':
        return `${id}{${label}}`
      case 'hexagon':
        return `${id}{{${label}}}`
      case 'parallelogram':
        return `${id}[/${label}/]`
      case 'trapezoid':
        return `${id}[/${label}\\]`
      default:
        return `${id}[${label}]`
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new LineageExporter instance
 */
export function createLineageExporter(): LineageExporter {
  return new LineageExporter()
}
