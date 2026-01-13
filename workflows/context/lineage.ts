/**
 * Lineage Context API for $.lineage namespace
 *
 * Integrates LineageTracker with the $ workflow context for data lineage tracking:
 * - $.lineage.track(inputs, outputs, transform) - Track data transformations
 * - $.lineage.record(source, target, operation) - Convenience method for simple flows
 * - $.lineage.upstream(nodeId) - Get upstream dependencies
 * - $.lineage.downstream(nodeId) - Get downstream dependents
 * - $.lineage.impact(nodeId) - Analyze impact of changes
 * - $.lineage.createContext(name) - Create scoped lineage context
 *
 * Automatic tracking integration:
 * - $.lineage.wrap(fn, options) - Wrap function with automatic lineage tracking
 * - Tracks $.do() and $.try() calls with lineage metadata
 *
 * @module workflows/context/lineage
 */

import type {
  LineageNode,
  LineageEdge,
  CreateNodeInput,
  CreateEdgeInput,
  LineageGraph,
  TraversalOptions,
  ImpactAnalysis,
  ImpactOptions,
  LineageStats,
  LineagePath,
} from '../../db/primitives/lineage-tracker'

import type {
  TransformMeta,
  TrackingResult,
  AssetRef,
  LineageContext as TransformationLineageContext,
  LineageContextOptions,
  TransformationScope,
  RuntimeMetrics,
  PipelineOperation,
  ExternalTool,
} from '../../db/primitives/lineage-tracker/transformation'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Options for tracking a transformation in the workflow context
 */
export interface TrackTransformOptions extends Partial<TransformMeta> {
  /** Human-readable name for the transformation */
  name: string
  /** Description of what the transformation does */
  description?: string
  /** Capture runtime metrics automatically */
  captureMetrics?: boolean
}

/**
 * Options for the record() convenience method
 */
export interface RecordOptions {
  /** Operation name (e.g., 'read', 'write', 'transform') */
  operation: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for wrapping a function with lineage tracking
 */
export interface WrapOptions {
  /** Name for the transformation (defaults to function name) */
  name?: string
  /** Input asset names or refs */
  inputs?: (string | AssetRef)[]
  /** Output asset names or refs */
  outputs?: (string | AssetRef)[]
  /** Automatically capture metrics */
  captureMetrics?: boolean
  /** Automatically capture schemas from input/output */
  captureSchemas?: boolean
  /** Tags for categorization */
  tags?: string[]
}

/**
 * Export formats for lineage data
 */
export type ExportFormat = 'dot' | 'mermaid' | 'json' | 'd3' | 'ascii' | 'openlineage'

/**
 * Options for exporting lineage data
 */
export interface ExportOptions {
  /** Export format */
  format?: ExportFormat
  /** For OpenLineage: namespace for the export */
  namespace?: string
  /** For OpenLineage: producer URL */
  producer?: string
  /** For Mermaid/DOT: graph direction */
  direction?: 'TB' | 'BT' | 'LR' | 'RL'
}

/**
 * Scoped context for tracking transformations within a pipeline
 */
export interface LineageScopedContext {
  /** Context ID */
  readonly id: string
  /** Context name */
  readonly name: string
  /** Begin tracking a transformation within this context */
  begin(name: string, options?: { description?: string; inputs?: AssetRef[] }): TransformationScope
  /** Record a simple transformation */
  record(inputs: AssetRef[], outputs: AssetRef[], transform: Partial<TransformMeta>): TrackingResult
  /** Get all transformations tracked in this context */
  getTransformations(): TrackingResult[]
  /** End the context */
  end(): void
}

/**
 * Main lineage API for the $ workflow context
 */
export interface LineageAPI {
  // ═══════════════════════════════════════════════════════════════════════════
  // CORE TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Track a data transformation between assets
   *
   * @example
   * ```typescript
   * $.lineage.track(
   *   [{ name: 'raw_events' }],
   *   [{ name: 'processed_events' }],
   *   { name: 'processEvents', kind: 'code' }
   * )
   * ```
   */
  track(inputs: AssetRef[], outputs: AssetRef[], options: TrackTransformOptions): TrackingResult

  /**
   * Record a simple data flow (convenience method)
   *
   * @example
   * ```typescript
   * $.lineage.record(
   *   { name: 'users' },
   *   { name: 'active_users' },
   *   { operation: 'filter' }
   * )
   * ```
   */
  record(
    source: AssetRef | string,
    target: AssetRef | string,
    options: RecordOptions
  ): { source: LineageNode; target: LineageNode; edge: LineageEdge }

  /**
   * Track a code transformation (convenience method)
   */
  trackCode(
    inputs: AssetRef[],
    outputs: AssetRef[],
    options: {
      name: string
      code?: string
      language?: 'typescript' | 'javascript' | 'python' | 'sql' | 'other'
      description?: string
      metrics?: RuntimeMetrics
    }
  ): TrackingResult

  /**
   * Track a pipeline stage (convenience method)
   */
  trackPipeline(
    inputs: AssetRef[],
    outputs: AssetRef[],
    options: {
      name: string
      operation: PipelineOperation
      config?: Record<string, unknown>
      metrics?: RuntimeMetrics
    }
  ): TrackingResult

  /**
   * Track an external tool execution (convenience method)
   */
  trackExternal(
    inputs: AssetRef[],
    outputs: AssetRef[],
    options: {
      name: string
      tool: ExternalTool
      jobName?: string
      runId?: string
      metadata?: Record<string, unknown>
      metrics?: RuntimeMetrics
    }
  ): TrackingResult

  /**
   * Track manual data entry/modification
   */
  trackManual(
    outputs: AssetRef[],
    options: {
      name: string
      description?: string
      modifiedBy?: string
      reason?: string
    }
  ): TrackingResult

  // ═══════════════════════════════════════════════════════════════════════════
  // NODE & EDGE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a lineage node
   */
  createNode(input: CreateNodeInput): LineageNode

  /**
   * Get a node by ID
   */
  getNode(id: string): LineageNode | null

  /**
   * Create an edge between nodes
   */
  createEdge(input: CreateEdgeInput): LineageEdge

  /**
   * Get an edge by ID
   */
  getEdge(id: string): LineageEdge | null

  // ═══════════════════════════════════════════════════════════════════════════
  // LINEAGE QUERIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get upstream dependencies of a node
   *
   * @example
   * ```typescript
   * const upstream = $.lineage.upstream('processed_events')
   * console.log(`Depends on ${upstream.nodes.length} sources`)
   * ```
   */
  upstream(nodeId: string, options?: TraversalOptions): LineageGraph

  /**
   * Get downstream dependents of a node
   */
  downstream(nodeId: string, options?: TraversalOptions): LineageGraph

  /**
   * Get full lineage graph in both directions
   */
  full(nodeId: string, options?: TraversalOptions): LineageGraph

  /**
   * Find all paths between two nodes
   */
  paths(fromId: string, toId: string, maxDepth?: number): LineagePath[]

  /**
   * Get immediate parents of a node
   */
  parents(nodeId: string): LineageNode[]

  /**
   * Get immediate children of a node
   */
  children(nodeId: string): LineageNode[]

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPACT ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Analyze the impact of changing a node
   *
   * @example
   * ```typescript
   * const impact = $.lineage.impact('raw_events')
   * console.log(`Changing raw_events affects ${impact.totalAffected} nodes`)
   * ```
   */
  impact(nodeId: string, options?: ImpactOptions): ImpactAnalysis

  /**
   * Get blast radius metrics for a node
   */
  blastRadius(
    nodeId: string,
    options?: ImpactOptions
  ): { totalAffected: number; maxDepth: number; criticalPathCount: number }

  // ═══════════════════════════════════════════════════════════════════════════
  // GRAPH OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all root nodes (nodes with no upstream dependencies)
   */
  roots(): LineageNode[]

  /**
   * Get all leaf nodes (nodes with no downstream dependents)
   */
  leaves(): LineageNode[]

  /**
   * Get statistics about the lineage graph
   */
  stats(): LineageStats

  /**
   * Clear all lineage data
   */
  clear(): void

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXT & SCOPING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a scoped lineage context for tracking transformations within a pipeline
   *
   * @example
   * ```typescript
   * const ctx = $.lineage.createContext({ name: 'etl-pipeline' })
   * const scope = ctx.begin('extract')
   * scope.addInput({ name: 'source_db' })
   * scope.addOutput({ name: 'staging_table' })
   * scope.complete()
   * ctx.end()
   * ```
   */
  createContext(options: LineageContextOptions): LineageScopedContext

  // ═══════════════════════════════════════════════════════════════════════════
  // FUNCTION WRAPPING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Wrap a function with automatic lineage tracking
   *
   * @example
   * ```typescript
   * const trackedProcess = $.lineage.wrap(processEvents, {
   *   name: 'processEvents',
   *   inputs: ['raw_events'],
   *   outputs: ['processed_events'],
   *   captureMetrics: true,
   * })
   *
   * await trackedProcess(events) // Automatically tracked
   * ```
   */
  wrap<T extends (...args: unknown[]) => unknown>(fn: T, options?: WrapOptions): T

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Export lineage graph to various formats
   *
   * @example
   * ```typescript
   * const graph = $.lineage.downstream('source')
   * const mermaid = $.lineage.export(graph, { format: 'mermaid' })
   * console.log(mermaid)
   * ```
   */
  export(graph: LineageGraph, options?: ExportOptions): string
}

/**
 * Full context interface returned by createLineageContext
 */
export interface LineageContextResult {
  lineage: LineageAPI
  _storage: LineageStorage
}

// ============================================================================
// STORAGE TYPES
// ============================================================================

/**
 * In-memory storage for lineage data (used in mock context)
 */
export interface LineageStorage {
  nodes: Map<string, LineageNode>
  edges: Map<string, LineageEdge>
  transformationHistory: Map<string, TransformMeta[]>
  contexts: Map<string, LineageScopedContext>
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique ID
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Normalize an asset reference from string or AssetRef
 */
function normalizeAssetRef(ref: string | AssetRef): AssetRef {
  if (typeof ref === 'string') {
    return { name: ref }
  }
  return ref
}

/**
 * Create a node from an AssetRef
 */
function createNodeFromRef(storage: LineageStorage, ref: AssetRef): LineageNode {
  // Check if node already exists by name
  for (const node of storage.nodes.values()) {
    if (node.name === ref.name && node.namespace === ref.namespace) {
      return node
    }
  }

  // Create new node
  const now = Date.now()
  const node: LineageNode = {
    id: ref.id ?? generateId('node'),
    type: ref.type ?? 'entity',
    name: ref.name,
    namespace: ref.namespace,
    metadata: ref.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  }

  storage.nodes.set(node.id, node)
  return node
}

// ============================================================================
// SCOPED CONTEXT IMPLEMENTATION
// ============================================================================

/**
 * Create a scoped lineage context implementation
 */
function createScopedContext(
  storage: LineageStorage,
  options: LineageContextOptions,
  trackFn: (inputs: AssetRef[], outputs: AssetRef[], transform: Partial<TransformMeta>) => TrackingResult
): LineageScopedContext {
  const id = generateId('ctx')
  const transformations: TrackingResult[] = []
  let ended = false

  const scopedContext: LineageScopedContext = {
    get id() {
      return id
    },
    get name() {
      return options.name
    },

    begin(name: string, beginOptions?: { description?: string; inputs?: AssetRef[] }): TransformationScope {
      if (ended) {
        throw new Error('Cannot begin transformation in ended context')
      }

      const scopeId = generateId('scope')
      const inputs: AssetRef[] = beginOptions?.inputs ?? []
      const outputs: AssetRef[] = []
      const startTime = Date.now()
      let code: string | undefined
      let language: 'typescript' | 'javascript' | 'python' | 'sql' | 'other' | undefined
      let metrics: RuntimeMetrics | undefined
      let inputSchema: unknown
      let outputSchema: unknown
      let completed = false
      let aborted = false

      const scope: TransformationScope = {
        get id() {
          return scopeId
        },

        addInput(asset: AssetRef): void {
          if (completed || aborted) {
            throw new Error('Cannot modify completed or aborted scope')
          }
          inputs.push(asset)
        },

        addOutput(asset: AssetRef): void {
          if (completed || aborted) {
            throw new Error('Cannot modify completed or aborted scope')
          }
          outputs.push(asset)
        },

        setCode(newCode: string, newLanguage?: 'typescript' | 'javascript' | 'python' | 'sql' | 'other'): void {
          if (completed || aborted) {
            throw new Error('Cannot modify completed or aborted scope')
          }
          code = newCode
          if (newLanguage) {
            language = newLanguage
          }
        },

        setMetrics(newMetrics: RuntimeMetrics): void {
          if (completed || aborted) {
            throw new Error('Cannot modify completed or aborted scope')
          }
          metrics = newMetrics
        },

        setSchemas(input?: unknown, output?: unknown): void {
          if (completed || aborted) {
            throw new Error('Cannot modify completed or aborted scope')
          }
          if (input) inputSchema = input
          if (output) outputSchema = output
        },

        complete(): TrackingResult {
          if (completed) {
            throw new Error('Scope already completed')
          }
          if (aborted) {
            throw new Error('Cannot complete aborted scope')
          }

          completed = true
          const endTime = Date.now()

          const result = trackFn(inputs, outputs, {
            kind: options.defaultKind ?? 'code',
            name,
            description: beginOptions?.description,
            code,
            language,
            metrics: metrics ?? { durationMs: endTime - startTime },
            inputSchema: inputSchema as Record<string, unknown> | undefined,
            outputSchema: outputSchema as Record<string, unknown> | undefined,
            executedAt: startTime,
            tags: options.tags,
            metadata: {
              contextId: id,
              contextName: options.name,
            },
          })

          transformations.push(result)
          return result
        },

        abort(error?: Error): void {
          if (completed) {
            throw new Error('Cannot abort completed scope')
          }
          aborted = true
        },
      }

      return scope
    },

    record(inputs: AssetRef[], outputs: AssetRef[], transform: Partial<TransformMeta>): TrackingResult {
      if (ended) {
        throw new Error('Cannot record transformation in ended context')
      }

      const result = trackFn(inputs, outputs, {
        kind: transform.kind ?? options.defaultKind ?? 'code',
        name: transform.name ?? 'unnamed',
        ...transform,
        tags: [...(options.tags ?? []), ...(transform.tags ?? [])],
        metadata: {
          ...transform.metadata,
          contextId: id,
          contextName: options.name,
        },
      })

      transformations.push(result)
      return result
    },

    getTransformations(): TrackingResult[] {
      return [...transformations]
    },

    end(): void {
      ended = true
    },
  }

  storage.contexts.set(id, scopedContext)
  return scopedContext
}

// ============================================================================
// LINEAGE API IMPLEMENTATION
// ============================================================================

/**
 * Create the lineage API implementation
 */
function createLineageAPI(storage: LineageStorage): LineageAPI {
  /**
   * Track a transformation (core implementation)
   */
  function trackTransformation(
    inputs: AssetRef[],
    outputs: AssetRef[],
    transform: Partial<TransformMeta>
  ): TrackingResult {
    const trackedAt = Date.now()

    // Create or get input nodes
    const inputNodes = inputs.map((input) => createNodeFromRef(storage, input))

    // Create or get output nodes
    const outputNodes = outputs.map((output) => createNodeFromRef(storage, output))

    // Create transformation node
    const transformNode: LineageNode = {
      id: generateId('transform'),
      type: 'transformation',
      name: transform.name ?? 'unnamed',
      namespace: transform.metadata?.['namespace'] as string | undefined,
      metadata: {
        kind: transform.kind ?? 'code',
        description: transform.description,
        code: transform.code,
        language: transform.language,
        pipelineOp: transform.pipelineOp,
        pipelineConfig: transform.pipelineConfig,
        externalTool: transform.externalTool,
        jobName: transform.jobName,
        runId: transform.runId,
        externalMeta: transform.externalMeta,
        executedAt: transform.executedAt ?? trackedAt,
        executedBy: transform.executedBy,
        metrics: transform.metrics,
        tags: transform.tags,
        inputSchema: transform.inputSchema,
        outputSchema: transform.outputSchema,
        ...transform.metadata,
      },
      createdAt: trackedAt,
      updatedAt: trackedAt,
    }
    storage.nodes.set(transformNode.id, transformNode)

    // Create edges from inputs to transformation
    const inputEdges = inputNodes.map((input) => {
      const edge: LineageEdge = {
        id: generateId('edge'),
        fromNodeId: input.id,
        toNodeId: transformNode.id,
        operation: 'input',
        metadata: { transformKind: transform.kind, trackedAt },
        timestamp: trackedAt,
      }
      storage.edges.set(edge.id, edge)
      return { id: edge.id, fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId }
    })

    // Create edges from transformation to outputs
    const outputEdges = outputNodes.map((output) => {
      const edge: LineageEdge = {
        id: generateId('edge'),
        fromNodeId: transformNode.id,
        toNodeId: output.id,
        operation: 'output',
        metadata: { transformKind: transform.kind, trackedAt },
        timestamp: trackedAt,
      }
      storage.edges.set(edge.id, edge)
      return { id: edge.id, fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId }
    })

    // Update transformation history
    const allAssetIds = [...inputNodes, ...outputNodes].map((n) => n.id)
    for (const assetId of allAssetIds) {
      const history = storage.transformationHistory.get(assetId) ?? []
      history.push(transform as TransformMeta)
      storage.transformationHistory.set(assetId, history)
    }

    return {
      inputs: inputNodes,
      outputs: outputNodes,
      transformation: transformNode,
      inputEdges,
      outputEdges,
      trackedAt,
    }
  }

  /**
   * Get upstream nodes via BFS traversal
   */
  function getUpstream(nodeId: string, options?: TraversalOptions): LineageGraph {
    const visited = new Set<string>()
    const nodes: LineageNode[] = []
    const edges: LineageEdge[] = []
    const queue: { id: string; depth: number }[] = [{ id: nodeId, depth: 0 }]
    const maxDepth = options?.maxDepth ?? Infinity

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!
      if (visited.has(id) || depth > maxDepth) continue
      visited.add(id)

      const node = storage.nodes.get(id)
      if (node) {
        if (options?.nodeTypes && !options.nodeTypes.includes(node.type)) continue
        nodes.push(node)
      }

      // Find edges where this node is the target
      for (const edge of storage.edges.values()) {
        if (edge.toNodeId === id) {
          edges.push(edge)
          queue.push({ id: edge.fromNodeId, depth: depth + 1 })
        }
      }
    }

    return { nodes, edges, rootId: nodeId }
  }

  /**
   * Get downstream nodes via BFS traversal
   */
  function getDownstream(nodeId: string, options?: TraversalOptions): LineageGraph {
    const visited = new Set<string>()
    const nodes: LineageNode[] = []
    const edges: LineageEdge[] = []
    const queue: { id: string; depth: number }[] = [{ id: nodeId, depth: 0 }]
    const maxDepth = options?.maxDepth ?? Infinity

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!
      if (visited.has(id) || depth > maxDepth) continue
      visited.add(id)

      const node = storage.nodes.get(id)
      if (node) {
        if (options?.nodeTypes && !options.nodeTypes.includes(node.type)) continue
        nodes.push(node)
      }

      // Find edges where this node is the source
      for (const edge of storage.edges.values()) {
        if (edge.fromNodeId === id) {
          edges.push(edge)
          queue.push({ id: edge.toNodeId, depth: depth + 1 })
        }
      }
    }

    return { nodes, edges, rootId: nodeId }
  }

  const api: LineageAPI = {
    // Core tracking
    track(inputs: AssetRef[], outputs: AssetRef[], options: TrackTransformOptions): TrackingResult {
      return trackTransformation(inputs, outputs, {
        kind: options.kind ?? 'code',
        ...options,
      })
    },

    record(
      source: AssetRef | string,
      target: AssetRef | string,
      options: RecordOptions
    ): { source: LineageNode; target: LineageNode; edge: LineageEdge } {
      const sourceRef = normalizeAssetRef(source)
      const targetRef = normalizeAssetRef(target)

      const sourceNode = createNodeFromRef(storage, sourceRef)
      const targetNode = createNodeFromRef(storage, targetRef)

      const now = Date.now()
      const edge: LineageEdge = {
        id: generateId('edge'),
        fromNodeId: sourceNode.id,
        toNodeId: targetNode.id,
        operation: options.operation,
        metadata: options.metadata ?? {},
        timestamp: now,
      }
      storage.edges.set(edge.id, edge)

      return { source: sourceNode, target: targetNode, edge }
    },

    trackCode(inputs, outputs, options): TrackingResult {
      return trackTransformation(inputs, outputs, {
        kind: 'code',
        name: options.name,
        code: options.code,
        language: options.language,
        description: options.description,
        metrics: options.metrics,
        executedAt: Date.now(),
      })
    },

    trackPipeline(inputs, outputs, options): TrackingResult {
      return trackTransformation(inputs, outputs, {
        kind: 'pipeline',
        name: options.name,
        pipelineOp: options.operation,
        pipelineConfig: options.config,
        metrics: options.metrics,
        executedAt: Date.now(),
      })
    },

    trackExternal(inputs, outputs, options): TrackingResult {
      return trackTransformation(inputs, outputs, {
        kind: 'external',
        name: options.name,
        externalTool: options.tool,
        jobName: options.jobName,
        runId: options.runId,
        externalMeta: options.metadata,
        metrics: options.metrics,
        executedAt: Date.now(),
      })
    },

    trackManual(outputs, options): TrackingResult {
      return trackTransformation([], outputs, {
        kind: 'manual',
        name: options.name,
        description: options.description,
        executedBy: options.modifiedBy,
        metadata: { reason: options.reason },
        executedAt: Date.now(),
      })
    },

    // Node & Edge operations
    createNode(input: CreateNodeInput): LineageNode {
      const now = Date.now()
      const node: LineageNode = {
        id: input.id ?? generateId('node'),
        type: input.type,
        name: input.name,
        namespace: input.namespace,
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      }
      storage.nodes.set(node.id, node)
      return node
    },

    getNode(id: string): LineageNode | null {
      return storage.nodes.get(id) ?? null
    },

    createEdge(input: CreateEdgeInput): LineageEdge {
      const now = Date.now()
      const edge: LineageEdge = {
        id: input.id ?? generateId('edge'),
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        operation: input.operation,
        metadata: input.metadata ?? {},
        timestamp: now,
      }
      storage.edges.set(edge.id, edge)
      return edge
    },

    getEdge(id: string): LineageEdge | null {
      return storage.edges.get(id) ?? null
    },

    // Lineage queries
    upstream: getUpstream,
    downstream: getDownstream,

    full(nodeId: string, options?: TraversalOptions): LineageGraph {
      const up = getUpstream(nodeId, options)
      const down = getDownstream(nodeId, options)

      // Merge, avoiding duplicates
      const nodeIds = new Set([...up.nodes.map((n) => n.id), ...down.nodes.map((n) => n.id)])
      const edgeIds = new Set([...up.edges.map((e) => e.id), ...down.edges.map((e) => e.id)])

      return {
        nodes: [...storage.nodes.values()].filter((n) => nodeIds.has(n.id)),
        edges: [...storage.edges.values()].filter((e) => edgeIds.has(e.id)),
        rootId: nodeId,
      }
    },

    paths(fromId: string, toId: string, maxDepth = 10): LineagePath[] {
      const paths: LineagePath[] = []

      function dfs(current: string, nodeIds: string[], edgeIds: string[], depth: number): void {
        if (depth > maxDepth) return
        if (current === toId) {
          paths.push({ nodeIds: [...nodeIds], edgeIds: [...edgeIds] })
          return
        }

        for (const edge of storage.edges.values()) {
          if (edge.fromNodeId === current && !nodeIds.includes(edge.toNodeId)) {
            dfs(edge.toNodeId, [...nodeIds, edge.toNodeId], [...edgeIds, edge.id], depth + 1)
          }
        }
      }

      dfs(fromId, [fromId], [], 0)
      return paths
    },

    parents(nodeId: string): LineageNode[] {
      const parentIds = new Set<string>()
      for (const edge of storage.edges.values()) {
        if (edge.toNodeId === nodeId) {
          parentIds.add(edge.fromNodeId)
        }
      }
      return [...storage.nodes.values()].filter((n) => parentIds.has(n.id))
    },

    children(nodeId: string): LineageNode[] {
      const childIds = new Set<string>()
      for (const edge of storage.edges.values()) {
        if (edge.fromNodeId === nodeId) {
          childIds.add(edge.toNodeId)
        }
      }
      return [...storage.nodes.values()].filter((n) => childIds.has(n.id))
    },

    // Impact analysis
    impact(nodeId: string, options?: ImpactOptions): ImpactAnalysis {
      const downstream = getDownstream(nodeId, { maxDepth: options?.maxDepth, nodeTypes: options?.nodeTypes })
      const sourceNode = storage.nodes.get(nodeId)

      if (!sourceNode) {
        throw new Error(`Node not found: ${nodeId}`)
      }

      // Calculate distances and path counts
      const nodeDistances = new Map<string, number>()
      const nodePathCounts = new Map<string, number>()

      function bfs(): void {
        const queue: { id: string; distance: number }[] = [{ id: nodeId, distance: 0 }]
        const pathCounts = new Map<string, number>()
        pathCounts.set(nodeId, 1)

        while (queue.length > 0) {
          const { id, distance } = queue.shift()!

          for (const edge of storage.edges.values()) {
            if (edge.fromNodeId === id) {
              const currentDist = nodeDistances.get(edge.toNodeId)
              if (currentDist === undefined) {
                nodeDistances.set(edge.toNodeId, distance + 1)
                nodePathCounts.set(edge.toNodeId, pathCounts.get(id) ?? 1)
                queue.push({ id: edge.toNodeId, distance: distance + 1 })
              } else if (currentDist === distance + 1) {
                // Same distance = additional path
                nodePathCounts.set(
                  edge.toNodeId,
                  (nodePathCounts.get(edge.toNodeId) ?? 0) + (pathCounts.get(id) ?? 1)
                )
              }
              pathCounts.set(edge.toNodeId, nodePathCounts.get(edge.toNodeId) ?? 1)
            }
          }
        }
      }

      bfs()

      const affectedNodes = downstream.nodes
        .filter((n) => n.id !== nodeId)
        .map((n) => ({
          node: n,
          distance: nodeDistances.get(n.id) ?? 0,
          pathCount: nodePathCounts.get(n.id) ?? 1,
          impact: (nodeDistances.get(n.id) ?? 0) === 1 ? ('direct' as const) : ('indirect' as const),
        }))

      // Calculate metrics
      const byDepth = new Map<number, number>()
      const byType = new Map<string, number>()
      let maxDepth = 0

      for (const affected of affectedNodes) {
        const depth = affected.distance
        byDepth.set(depth, (byDepth.get(depth) ?? 0) + 1)
        byType.set(affected.node.type, (byType.get(affected.node.type) ?? 0) + 1)
        maxDepth = Math.max(maxDepth, depth)
      }

      return {
        sourceNode,
        affectedNodes,
        totalAffected: affectedNodes.length,
        criticalPaths: [], // Simplified: could implement critical path detection
        metrics: {
          totalAffected: affectedNodes.length,
          byDepth,
          byType: byType as Map<'entity' | 'transformation' | 'source' | 'sink', number>,
          maxDepth,
          criticalPathCount: 0,
        },
      }
    },

    blastRadius(nodeId: string, options?: ImpactOptions) {
      const impact = api.impact(nodeId, options)
      return {
        totalAffected: impact.totalAffected,
        maxDepth: impact.metrics.maxDepth,
        criticalPathCount: impact.metrics.criticalPathCount,
      }
    },

    // Graph operations
    roots(): LineageNode[] {
      const hasIncoming = new Set<string>()
      for (const edge of storage.edges.values()) {
        hasIncoming.add(edge.toNodeId)
      }
      return [...storage.nodes.values()].filter((n) => !hasIncoming.has(n.id))
    },

    leaves(): LineageNode[] {
      const hasOutgoing = new Set<string>()
      for (const edge of storage.edges.values()) {
        hasOutgoing.add(edge.fromNodeId)
      }
      return [...storage.nodes.values()].filter((n) => !hasOutgoing.has(n.id))
    },

    stats(): LineageStats {
      const nodesByType: Record<string, number> = {
        entity: 0,
        transformation: 0,
        source: 0,
        sink: 0,
      }

      for (const node of storage.nodes.values()) {
        nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1
      }

      const roots = api.roots()
      const leaves = api.leaves()

      // Calculate average connectivity
      let totalConnections = 0
      for (const node of storage.nodes.values()) {
        const inEdges = [...storage.edges.values()].filter((e) => e.toNodeId === node.id).length
        const outEdges = [...storage.edges.values()].filter((e) => e.fromNodeId === node.id).length
        totalConnections += inEdges + outEdges
      }
      const avgConnectivity = storage.nodes.size > 0 ? totalConnections / storage.nodes.size : 0

      return {
        nodeCount: storage.nodes.size,
        nodesByType: nodesByType as Record<'entity' | 'transformation' | 'source' | 'sink', number>,
        edgeCount: storage.edges.size,
        rootCount: roots.length,
        leafCount: leaves.length,
        avgConnectivity,
      }
    },

    clear(): void {
      storage.nodes.clear()
      storage.edges.clear()
      storage.transformationHistory.clear()
      storage.contexts.clear()
    },

    // Context & scoping
    createContext(options: LineageContextOptions): LineageScopedContext {
      return createScopedContext(storage, options, (inputs, outputs, transform) =>
        trackTransformation(inputs, outputs, transform)
      )
    },

    // Function wrapping
    wrap<T extends (...args: unknown[]) => unknown>(fn: T, options?: WrapOptions): T {
      const wrapped = async function (this: unknown, ...args: unknown[]) {
        const startTime = Date.now()
        let result: unknown
        let error: Error | undefined

        try {
          result = await fn.apply(this, args)
        } catch (e) {
          error = e as Error
          throw e
        } finally {
          const endTime = Date.now()

          // Build inputs
          const inputs: AssetRef[] = (options?.inputs ?? []).map((i) =>
            typeof i === 'string' ? { name: i } : i
          )

          // Build outputs
          const outputs: AssetRef[] = (options?.outputs ?? []).map((o) =>
            typeof o === 'string' ? { name: o } : o
          )

          // Build transform metadata
          const transform: Partial<TransformMeta> = {
            kind: 'code',
            name: options?.name ?? fn.name ?? 'anonymous',
            language: 'typescript',
            executedAt: startTime,
            tags: options?.tags,
          }

          // Capture metrics if requested
          if (options?.captureMetrics) {
            transform.metrics = {
              durationMs: endTime - startTime,
              errorCount: error ? 1 : 0,
            }

            if (Array.isArray(result)) {
              transform.metrics.outputRecords = result.length
            }
            if (Array.isArray(args[0])) {
              transform.metrics.inputRecords = args[0].length
            }
          }

          // Track the transformation
          try {
            trackTransformation(inputs, outputs, transform)
          } catch {
            // Don't fail the original function if tracking fails
            console.warn('Failed to track transformation:', options?.name ?? fn.name)
          }
        }

        return result
      }

      return wrapped as T
    },

    // Export
    export(graph: LineageGraph, options?: ExportOptions): string {
      const format = options?.format ?? 'mermaid'

      switch (format) {
        case 'mermaid': {
          const direction = options?.direction ?? 'TB'
          let mermaid = `graph ${direction}\n`
          for (const node of graph.nodes) {
            const label = node.namespace ? `${node.namespace}.${node.name}` : node.name
            const shape = node.type === 'transformation' ? `{{${label}}}` : `[${label}]`
            mermaid += `  ${node.id}${shape}\n`
          }
          for (const edge of graph.edges) {
            mermaid += `  ${edge.fromNodeId} -->|${edge.operation}| ${edge.toNodeId}\n`
          }
          return mermaid
        }

        case 'dot': {
          const direction = options?.direction === 'LR' ? 'LR' : 'TB'
          let dot = `digraph lineage {\n  rankdir=${direction};\n`
          for (const node of graph.nodes) {
            const label = node.namespace ? `${node.namespace}.${node.name}` : node.name
            const shape = node.type === 'transformation' ? 'diamond' : 'box'
            dot += `  "${node.id}" [label="${label}", shape=${shape}];\n`
          }
          for (const edge of graph.edges) {
            dot += `  "${edge.fromNodeId}" -> "${edge.toNodeId}" [label="${edge.operation}"];\n`
          }
          dot += '}\n'
          return dot
        }

        case 'json': {
          return JSON.stringify(graph, null, 2)
        }

        case 'd3': {
          const d3Data = {
            nodes: graph.nodes.map((n) => ({
              id: n.id,
              name: n.name,
              type: n.type,
              namespace: n.namespace,
            })),
            links: graph.edges.map((e) => ({
              source: e.fromNodeId,
              target: e.toNodeId,
              operation: e.operation,
            })),
          }
          return JSON.stringify(d3Data, null, 2)
        }

        case 'ascii': {
          let ascii = ''
          const roots = graph.nodes.filter(
            (n) => !graph.edges.some((e) => e.toNodeId === n.id)
          )

          function printNode(node: LineageNode, indent: number): void {
            const prefix = '  '.repeat(indent) + (indent > 0 ? '|- ' : '')
            ascii += `${prefix}${node.name} (${node.type})\n`

            const children = graph.edges
              .filter((e) => e.fromNodeId === node.id)
              .map((e) => graph.nodes.find((n) => n.id === e.toNodeId))
              .filter((n): n is LineageNode => n !== undefined)

            for (const child of children) {
              printNode(child, indent + 1)
            }
          }

          for (const root of roots) {
            printNode(root, 0)
          }

          return ascii || '(empty graph)'
        }

        case 'openlineage': {
          // Simplified OpenLineage output
          const events = graph.nodes
            .filter((n) => n.type === 'transformation')
            .map((transform) => {
              const inputs = graph.edges
                .filter((e) => e.toNodeId === transform.id)
                .map((e) => graph.nodes.find((n) => n.id === e.fromNodeId))
                .filter((n): n is LineageNode => n !== undefined)

              const outputs = graph.edges
                .filter((e) => e.fromNodeId === transform.id)
                .map((e) => graph.nodes.find((n) => n.id === e.toNodeId))
                .filter((n): n is LineageNode => n !== undefined)

              return {
                eventType: 'COMPLETE',
                eventTime: new Date(transform.createdAt).toISOString(),
                run: { runId: transform.id },
                job: {
                  namespace: options?.namespace ?? 'default',
                  name: transform.name,
                },
                producer: options?.producer ?? 'dotdo/lineage-context',
                inputs: inputs.map((i) => ({
                  namespace: i.namespace ?? options?.namespace ?? 'default',
                  name: i.name,
                })),
                outputs: outputs.map((o) => ({
                  namespace: o.namespace ?? options?.namespace ?? 'default',
                  name: o.name,
                })),
              }
            })
          return JSON.stringify(events, null, 2)
        }

        default:
          throw new Error(`Unsupported export format: ${format}`)
      }
    },
  }

  return api
}

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

/**
 * Creates a workflow context ($) with lineage tracking support
 *
 * This factory creates a context object with:
 * - $.lineage.track() - Track data transformations
 * - $.lineage.record() - Convenience for simple data flows
 * - $.lineage.upstream() - Get upstream dependencies
 * - $.lineage.downstream() - Get downstream dependents
 * - $.lineage.impact() - Analyze change impact
 * - $.lineage.createContext() - Create scoped tracking context
 * - $.lineage.wrap() - Wrap functions with automatic tracking
 * - $.lineage.export() - Export lineage to various formats
 * - $._storage - Internal storage for test setup
 *
 * @returns A LineageContextResult object with lineage API methods
 *
 * @example
 * ```typescript
 * const $ = createLineageContext()
 *
 * // Track a transformation
 * $.lineage.track(
 *   [{ name: 'raw_events' }],
 *   [{ name: 'processed_events' }],
 *   { name: 'processEvents', kind: 'code' }
 * )
 *
 * // Query lineage
 * const upstream = $.lineage.upstream('processed_events')
 * console.log(`Depends on: ${upstream.nodes.map(n => n.name).join(', ')}`)
 *
 * // Analyze impact
 * const impact = $.lineage.impact('raw_events')
 * console.log(`Changing raw_events affects ${impact.totalAffected} nodes`)
 *
 * // Export to Mermaid
 * const graph = $.lineage.full('raw_events')
 * const mermaid = $.lineage.export(graph, { format: 'mermaid' })
 * ```
 */
export function createLineageContext(): LineageContextResult {
  const storage: LineageStorage = {
    nodes: new Map(),
    edges: new Map(),
    transformationHistory: new Map(),
    contexts: new Map(),
  }

  return {
    lineage: createLineageAPI(storage),
    _storage: storage,
  }
}

/**
 * Alias for createLineageContext for consistency with other context modules
 */
export const createMockContext = createLineageContext
