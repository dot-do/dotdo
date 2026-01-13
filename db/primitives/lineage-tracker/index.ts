/**
 * LineageTracker - Data Provenance & Dependency Tracking Primitive
 *
 * A foundational primitive for tracking data lineage, dependencies, and provenance
 * across the dotdo platform. LineageTracker enables understanding of how data flows
 * through the system, what transformations were applied, and maintaining audit trails
 * for compliance and debugging.
 *
 * ## Key Capabilities
 * - Track data origins and transformations
 * - Build dependency graphs between entities
 * - Enable impact analysis (what breaks if X changes)
 * - Support audit/compliance requirements
 * - Power debugging by tracing data flow
 * - Enable cache invalidation through dependency tracking
 *
 * @example Basic Usage
 * ```typescript
 * import { createLineageTracker } from 'dotdo/db/primitives/lineage-tracker'
 *
 * // Create tracker with SQLite storage
 * const tracker = createLineageTracker(ctx.storage.sql)
 *
 * // Create nodes
 * const source = tracker.createNode({
 *   type: 'source',
 *   name: 'raw_events',
 *   namespace: 'warehouse',
 * })
 *
 * const transform = tracker.createNode({
 *   type: 'transformation',
 *   name: 'aggregate_events',
 *   metadata: { sql: 'SELECT event_type, COUNT(*) ...' },
 * })
 *
 * const sink = tracker.createNode({
 *   type: 'sink',
 *   name: 'event_summary',
 *   namespace: 'warehouse',
 * })
 *
 * // Create edges (data flows)
 * tracker.createEdge({
 *   fromNodeId: source.id,
 *   toNodeId: transform.id,
 *   operation: 'read',
 * })
 *
 * tracker.createEdge({
 *   fromNodeId: transform.id,
 *   toNodeId: sink.id,
 *   operation: 'write',
 * })
 *
 * // Query lineage
 * const upstream = tracker.getUpstream(sink.id)
 * const downstream = tracker.getDownstream(source.id)
 *
 * // Impact analysis
 * const impact = tracker.analyzeImpact(source.id)
 * console.log(`Changing ${source.name} affects ${impact.totalAffected} nodes`)
 * ```
 *
 * @module db/primitives/lineage-tracker
 */

// =============================================================================
// RE-EXPORTS
// =============================================================================

// Types
export type {
  NodeType,
  LineageNode,
  LineageEdge,
  CreateNodeInput,
  CreateEdgeInput,
  NodeQuery,
  EdgeQuery,
  LineageQuery,
  LineageGraph,
  LineagePath,
  TraversalOptions,
  ImpactType,
  AffectedNode,
  BlastRadiusMetrics,
  ImpactAnalysis,
  ImpactOptions,
  LineageTrackerConfig,
  LineageStats,
} from './types'

// Storage
export {
  LineageStore,
  createLineageStore,
  LINEAGE_SCHEMA,
  type SqlExecutor,
} from './storage'

// Drizzle-based Store (type-safe ORM implementation)
export {
  DrizzleLineageStore,
  createDrizzleLineageStore,
  type DrizzleDatabase,
  type DrizzleLineageStoreConfig,
} from './store'

// Drizzle Schema (for use with Drizzle ORM)
export {
  lineageNodes,
  lineageEdges,
  LINEAGE_NODES_SQL,
  LINEAGE_EDGES_SQL,
  LINEAGE_DRIZZLE_SCHEMA,
  type NodeType as SchemaNodeType,
  type LineageNodeRecord,
  type NewLineageNodeRecord,
  type LineageEdgeRecord,
  type NewLineageEdgeRecord,
} from './schema'

// Queries
export {
  LineageTraversal,
  ImpactAnalyzer,
  createLineageTraversal,
  createImpactAnalyzer,
} from './queries'

// Export (visualization)
export {
  LineageExporter,
  createLineageExporter,
  type DotOptions,
  type MermaidOptions,
  type D3Graph,
  type AsciiOptions,
} from './export'

// SQL Lineage Parser
export {
  SqlLineageParser,
  parseSqlLineage,
  createSqlLineageParser,
  type SqlLineage,
  type TableRef,
  type ColumnRef,
  type ColumnMapping,
  type CteDefinition,
  type SqlStatementType,
} from './sql-lineage-parser'

// OpenLineage format export
export {
  OpenLineageExporter,
  createOpenLineageExporter,
  importFromOpenLineage,
  OPENLINEAGE_SCHEMA_URL,
  type OpenLineageEventType,
  type BaseFacet,
  type NominalTimeRunFacet,
  type ParentRunFacet,
  type ErrorMessageRunFacet,
  type ProcessingEngineRunFacet,
  type RunFacets,
  type SourceCodeLocationJobFacet,
  type SqlJobFacet,
  type DocumentationJobFacet,
  type JobTypeJobFacet,
  type OwnershipJobFacet,
  type JobFacets,
  type SchemaField as OpenLineageSchemaField,
  type SchemaDatasetFacet,
  type DataSourceDatasetFacet,
  type LifecycleStateChangeDatasetFacet,
  type ColumnLineageDatasetFacet,
  type OwnershipDatasetFacet,
  type DatasetVersionDatasetFacet,
  type DatasetFacets,
  type InputDatasetFacets,
  type OutputDatasetFacets,
  type OpenLineageRun,
  type OpenLineageJob,
  type OpenLineageDataset,
  type OpenLineageInputDataset,
  type OpenLineageOutputDataset,
  type OpenLineageRunEvent,
  type OpenLineageExportOptions,
  type OpenLineageIncrementalExportOptions,
  type OpenLineageImportOptions,
  type OpenLineageImportResult,
} from './openlineage'

// Impact Analysis (advanced queries)
export {
  ImpactAnalyzer as AdvancedImpactAnalyzer,
  createImpactAnalyzer as createAdvancedImpactAnalyzer,
  type ImpactReport,
  type CoverageReport,
  type ImpactedAsset,
  type ImpactSeverity,
  type OrphanAsset,
  type CircularDependency,
  type NamespaceCoverage,
  type NodePredicate,
  type AnalysisOptions,
} from './impact-analysis'

// Column Lineage (extraction)
export {
  extractColumnLineage,
  type Column,
  type ColumnMapping,
  type MappingType,
  type Schema,
  type TableSchema,
} from './column-lineage'

// Asset model (URN-based identification)
export {
  // URN utilities
  parseURN,
  buildURN,
  validateURN,
  areRelatedURNs,
  getParentURN,
  inferAssetType,
  extractNameFromURN,
  // Asset functions
  createAsset,
  // Edge functions
  createEdgeV2,
  validateConfidence,
  isValidTransformationType,
  // Types
  type ParsedURN,
  type URNValidation,
  type URNScheme,
  type AssetType,
  type AssetOwnership,
  type AssetSchema,
  type AssetTags,
  type AssetQuality,
  type Asset,
  type CreateAssetInput,
  type AssetQuery,
  type TransformationType,
  type LineageSource,
  type TransformationMetadata,
  type LineageEdgeV2,
  type CreateEdgeV2Input,
  type EdgeV2Query,
} from './asset'

// =============================================================================
// IMPORTS
// =============================================================================

import { LineageStore, createLineageStore, type SqlExecutor } from './storage'
import { LineageTraversal, ImpactAnalyzer } from './queries'
import { LineageExporter, type DotOptions, type MermaidOptions, type AsciiOptions, type D3Graph } from './export'
import {
  OpenLineageExporter,
  type OpenLineageExportOptions,
  type OpenLineageRunEvent,
} from './openlineage'
import type {
  LineageNode,
  LineageEdge,
  CreateNodeInput,
  CreateEdgeInput,
  NodeQuery,
  EdgeQuery,
  LineageGraph,
  TraversalOptions,
  ImpactAnalysis,
  ImpactOptions,
  LineageTrackerConfig,
  LineageStats,
  LineagePath,
} from './types'

// =============================================================================
// LINEAGE TRACKER CLASS
// =============================================================================

/**
 * LineageTracker - Unified API for data lineage tracking
 *
 * Provides a high-level interface combining storage, traversal, and impact
 * analysis capabilities.
 */
export class LineageTracker {
  private store: LineageStore
  private traversal: LineageTraversal
  private analyzer: ImpactAnalyzer
  private exporter: LineageExporter
  private openLineageExporter: OpenLineageExporter

  constructor(sql: SqlExecutor, config?: LineageTrackerConfig) {
    this.store = createLineageStore(sql, config)
    this.traversal = new LineageTraversal(this.store)
    this.analyzer = new ImpactAnalyzer(this.store)
    this.exporter = new LineageExporter()
    this.openLineageExporter = new OpenLineageExporter()
  }

  // ===========================================================================
  // NODE OPERATIONS
  // ===========================================================================

  /**
   * Create a new node in the lineage graph
   */
  createNode(input: CreateNodeInput): LineageNode {
    return this.store.createNode(input)
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): LineageNode | null {
    return this.store.getNode(id)
  }

  /**
   * Update an existing node
   */
  updateNode(id: string, updates: Partial<Omit<LineageNode, 'id' | 'createdAt'>>): LineageNode | null {
    return this.store.updateNode(id, updates)
  }

  /**
   * Delete a node and all its edges
   */
  deleteNode(id: string): boolean {
    return this.store.deleteNode(id)
  }

  /**
   * Find nodes matching query criteria
   */
  findNodes(query?: NodeQuery): LineageNode[] {
    return this.store.findNodes(query)
  }

  /**
   * Bulk create nodes
   */
  createNodes(inputs: CreateNodeInput[]): LineageNode[] {
    return this.store.createNodes(inputs)
  }

  // ===========================================================================
  // EDGE OPERATIONS
  // ===========================================================================

  /**
   * Create a new edge in the lineage graph
   */
  createEdge(input: CreateEdgeInput): LineageEdge {
    return this.store.createEdge(input)
  }

  /**
   * Get an edge by ID
   */
  getEdge(id: string): LineageEdge | null {
    return this.store.getEdge(id)
  }

  /**
   * Delete an edge
   */
  deleteEdge(id: string): boolean {
    return this.store.deleteEdge(id)
  }

  /**
   * Find edges matching query criteria
   */
  findEdges(query?: EdgeQuery): LineageEdge[] {
    return this.store.findEdges(query)
  }

  /**
   * Bulk create edges
   */
  createEdges(inputs: CreateEdgeInput[]): LineageEdge[] {
    return this.store.createEdges(inputs)
  }

  // ===========================================================================
  // LINEAGE QUERIES
  // ===========================================================================

  /**
   * Get all nodes upstream of the given node (what this node depends on)
   *
   * Traverses the graph backwards from the given node to find all sources.
   */
  getUpstream(nodeId: string, options?: TraversalOptions): LineageGraph {
    return this.traversal.getUpstream(nodeId, options)
  }

  /**
   * Get all nodes downstream of the given node (what depends on this node)
   *
   * Traverses the graph forward from the given node to find all dependents.
   */
  getDownstream(nodeId: string, options?: TraversalOptions): LineageGraph {
    return this.traversal.getDownstream(nodeId, options)
  }

  /**
   * Get the full lineage graph in both directions
   */
  getFullLineage(nodeId: string, options?: TraversalOptions): LineageGraph {
    return this.traversal.getFullLineage(nodeId, options)
  }

  /**
   * Find all paths between two nodes
   */
  findPaths(fromId: string, toId: string, maxDepth?: number): LineagePath[] {
    return this.traversal.findPaths(fromId, toId, maxDepth)
  }

  /**
   * Get immediate parents of a node (one hop upstream)
   */
  getParents(nodeId: string): LineageNode[] {
    return this.traversal.getParents(nodeId)
  }

  /**
   * Get immediate children of a node (one hop downstream)
   */
  getChildren(nodeId: string): LineageNode[] {
    return this.traversal.getChildren(nodeId)
  }

  // ===========================================================================
  // IMPACT ANALYSIS
  // ===========================================================================

  /**
   * Analyze the impact of changing a node
   *
   * Returns all downstream nodes that would be affected, with details about
   * distance, path count, and impact classification.
   */
  analyzeImpact(nodeId: string, options?: ImpactOptions): ImpactAnalysis {
    return this.analyzer.analyze(nodeId, options)
  }

  /**
   * Get affected nodes grouped by type
   */
  getAffectedByType(nodeId: string, options?: ImpactOptions): Map<string, LineageNode[]> {
    return this.analyzer.getAffectedByType(nodeId, options)
  }

  /**
   * Get blast radius metrics (lightweight version of analyzeImpact)
   */
  getBlastRadius(nodeId: string, options?: ImpactOptions) {
    return this.analyzer.getBlastRadius(nodeId, options)
  }

  // ===========================================================================
  // GRAPH OPERATIONS
  // ===========================================================================

  /**
   * Get all root nodes (nodes with no upstream dependencies)
   */
  getRootNodes(): LineageNode[] {
    return this.store.getRootNodes()
  }

  /**
   * Get all leaf nodes (nodes with no downstream dependents)
   */
  getLeafNodes(): LineageNode[] {
    return this.store.getLeafNodes()
  }

  /**
   * Get statistics about the lineage graph
   */
  getStats(): LineageStats {
    return this.store.getStats()
  }

  /**
   * Clear all lineage data
   */
  clear(): void {
    this.store.clear()
  }

  // ===========================================================================
  // CONVENIENCE METHODS
  // ===========================================================================

  /**
   * Record a data transformation (creates nodes and edge)
   *
   * Convenience method for recording a complete data flow in one call.
   */
  record(input: {
    source: CreateNodeInput | string
    target: CreateNodeInput | string
    operation: string
    metadata?: Record<string, unknown>
  }): { source: LineageNode; target: LineageNode; edge: LineageEdge } {
    // Get or create source node
    const source =
      typeof input.source === 'string'
        ? this.getNode(input.source)
        : this.createNode(input.source)

    if (!source) {
      throw new Error(`Source node not found: ${input.source}`)
    }

    // Get or create target node
    const target =
      typeof input.target === 'string'
        ? this.getNode(input.target)
        : this.createNode(input.target)

    if (!target) {
      throw new Error(`Target node not found: ${input.target}`)
    }

    // Create edge
    const edge = this.createEdge({
      fromNodeId: source.id,
      toNodeId: target.id,
      operation: input.operation,
      metadata: input.metadata,
    })

    return { source, target, edge }
  }

  /**
   * Get the underlying store for advanced operations
   */
  getStore(): LineageStore {
    return this.store
  }

  // ===========================================================================
  // EXPORT METHODS
  // ===========================================================================

  /**
   * Export a lineage graph to Graphviz DOT format
   *
   * @example
   * ```typescript
   * const graph = tracker.getFullLineage('node-1')
   * const dot = tracker.exportToDot(graph, { rankdir: 'LR' })
   * ```
   */
  exportToDot(graph: LineageGraph, options?: DotOptions): string {
    return this.exporter.toDot(graph, options)
  }

  /**
   * Export a lineage graph to Mermaid diagram format
   *
   * @example
   * ```typescript
   * const graph = tracker.getDownstream('source-1')
   * const mermaid = tracker.exportToMermaid(graph)
   * // Use in Markdown: ```mermaid\n${mermaid}\n```
   * ```
   */
  exportToMermaid(graph: LineageGraph, options?: MermaidOptions): string {
    return this.exporter.toMermaid(graph, options)
  }

  /**
   * Export a lineage graph to JSON format
   */
  exportToJSON(graph: LineageGraph): string {
    return this.exporter.toJSON(graph)
  }

  /**
   * Export a lineage graph to D3-compatible format
   *
   * @example
   * ```typescript
   * const graph = tracker.getFullLineage('node-1')
   * const d3Data = tracker.exportToD3(graph)
   * // Pass to d3.forceSimulation()
   * ```
   */
  exportToD3(graph: LineageGraph): D3Graph {
    return this.exporter.toD3(graph)
  }

  /**
   * Export a lineage graph to ASCII art for terminal display
   *
   * @example
   * ```typescript
   * const graph = tracker.getDownstream('source-1')
   * console.log(tracker.exportToAscii(graph))
   * ```
   */
  exportToAscii(graph: LineageGraph, options?: AsciiOptions): string {
    return this.exporter.toAscii(graph, options)
  }

  /**
   * Get the underlying exporter for advanced operations
   */
  getExporter(): LineageExporter {
    return this.exporter
  }

  // ===========================================================================
  // OPENLINEAGE EXPORT METHODS
  // ===========================================================================

  /**
   * Export a lineage graph to OpenLineage format
   *
   * Generates one RunEvent for each transformation (job) in the graph,
   * with its input and output datasets. This is the industry standard format
   * for lineage interoperability with data catalogs and observability tools.
   *
   * @example
   * ```typescript
   * const graph = tracker.getFullLineage('transform-1')
   * const events = tracker.exportToOpenLineage(graph, {
   *   namespace: 'warehouse',
   *   producer: 'https://my-org/my-app',
   * })
   *
   * // Send to OpenLineage-compatible endpoint (e.g., Marquez, DataHub)
   * for (const event of events) {
   *   await fetch('https://marquez.example.com/api/v1/lineage', {
   *     method: 'POST',
   *     headers: { 'Content-Type': 'application/json' },
   *     body: JSON.stringify(event),
   *   })
   * }
   * ```
   */
  exportToOpenLineage(graph: LineageGraph, options?: OpenLineageExportOptions): OpenLineageRunEvent[] {
    return this.openLineageExporter.exportGraph(graph, options)
  }

  /**
   * Export a lineage graph to OpenLineage JSON string
   *
   * @example
   * ```typescript
   * const graph = tracker.getFullLineage('transform-1')
   * const json = tracker.exportToOpenLineageJSON(graph)
   * await Bun.write('lineage.json', json)
   * ```
   */
  exportToOpenLineageJSON(graph: LineageGraph, options?: OpenLineageExportOptions): string {
    const events = this.openLineageExporter.exportGraph(graph, options)
    return this.openLineageExporter.toJSON(events)
  }

  /**
   * Export a lineage graph to OpenLineage NDJSON format for streaming
   *
   * NDJSON (Newline Delimited JSON) is ideal for streaming lineage events
   * to message queues or bulk import endpoints.
   *
   * @example
   * ```typescript
   * const graph = tracker.getFullLineage('transform-1')
   * const ndjson = tracker.exportToOpenLineageNDJSON(graph)
   * // Each line is a valid JSON event
   * await kafka.send({ topic: 'lineage', messages: ndjson.split('\n') })
   * ```
   */
  exportToOpenLineageNDJSON(graph: LineageGraph, options?: OpenLineageExportOptions): string {
    const events = this.openLineageExporter.exportGraph(graph, options)
    return this.openLineageExporter.toNDJSON(events)
  }

  /**
   * Get the underlying OpenLineage exporter for advanced operations
   */
  getOpenLineageExporter(): OpenLineageExporter {
    return this.openLineageExporter
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new LineageTracker instance
 *
 * @param sql - SQLite executor (e.g., ctx.storage.sql from Durable Object)
 * @param config - Optional configuration
 * @returns A new LineageTracker instance
 *
 * @example
 * ```typescript
 * // In a Durable Object
 * const tracker = createLineageTracker(ctx.storage.sql)
 *
 * // With custom configuration
 * const tracker = createLineageTracker(ctx.storage.sql, {
 *   idPrefix: 'myapp',
 *   detectCycles: true,
 *   maxTraversalDepth: 50,
 * })
 * ```
 */
export function createLineageTracker(sql: SqlExecutor, config?: LineageTrackerConfig): LineageTracker {
  return new LineageTracker(sql, config)
}

// =============================================================================
// TIME-TRAVEL RE-EXPORTS
// =============================================================================

export {
  // Types
  type LineageEventType,
  type LineageEvent,
  type TimeTravelOptions,
  type LineageDiff,
  type TimeTravelConfig,
  // Schema
  TIME_TRAVEL_SCHEMA,
  // Implementation
  TimeTravelStore,
  // Factory
  createTimeTravelStore,
} from './time-travel'

// =============================================================================
// TRANSFORMATION TRACKING RE-EXPORTS
// =============================================================================

export {
  // Types
  type TransformKind,
  type PipelineOperation,
  type ExternalTool,
  type AssetRef,
  type SchemaDefinition,
  type SchemaField,
  type RuntimeMetrics,
  type TransformMeta,
  type TrackingResult,
  type TrackedOptions,
  type LineageContextOptions,
  type TransformationTracker,
  type LineageContext,
  type TransformationScope,
  // Implementation
  TransformationTrackerImpl,
  // Decorator
  tracked,
  // Factory
  createTransformationTracker,
} from './transformation'

// =============================================================================
// CROSS-SYSTEM LINEAGE RE-EXPORTS
// =============================================================================

export {
  // Types
  type SystemCategory,
  type SystemType,
  type SystemInfo,
  type NamingConvention,
  type CrossSystemAsset,
  type AssetAlias,
  type CrossSystemEdge,
  type StitchingMethod,
  type ExtractedMetadata,
  type ExtractionError,
  type SystemAdapter,
  type StitchingCandidate,
  type MatchEvidence,
  type StitchingResult,
  type StitchingStats,
  type StitchingConfig,
  type MatchingRule,
  type EndToEndLineage,
  type EndToEndOptions,
  // Implementation
  CrossSystemLineageTracker,
  BaseSystemAdapter,
  // Factory
  createCrossSystemLineageTracker,
  // Utilities
  calculateConfidence,
  normalizeAssetName,
} from './cross-system'

// =============================================================================
// VISUALIZATION API RE-EXPORTS
// =============================================================================

export {
  // Main API
  toVisualization,
  toMermaid,
  layoutGraph,
  filterGraph,
  groupNodes,
  applyHighlighting,
  // Fluent Builder
  LineageVisualization,
  createVisualization,
  // Types
  type VisualizationFormat,
  type LayoutAlgorithm,
  type Position,
  type PositionedNode,
  type VisualizationEdge,
  type PositionedGraph,
  type NodeGroup,
  type FilterOptions,
  type GroupingOptions,
  type HighlightOptions,
  type LayoutOptions,
  type D3VisualizationData,
  type CytoscapeVisualizationData,
  type VisualizationOptions,
  type VisualizationData,
} from './visualization'

// =============================================================================
// DBT DOCS EXPORT RE-EXPORTS
// =============================================================================

export {
  // Implementation
  DbtDocsExporter,
  // Factory
  createDbtDocsExporter,
  // Types
  type DbtResourceType,
  type DbtMaterialization,
  type DbtColumn,
  type DbtTableStats,
  type DbtCatalogNode,
  type DbtCatalogSource,
  type DbtCatalog,
  type DbtNodeConfig,
  type DbtManifestNode,
  type DbtManifestSource,
  type DbtManifestExposure,
  type DbtParentMap,
  type DbtChildMap,
  type DbtManifest,
  type DbtDocsBundle,
  type DbtCatalogOptions,
  type DbtManifestOptions,
  type DbtDocsBundleOptions,
} from './dbt-docs'
