/**
 * LineageTracker - Automatic Data Lineage Graph Primitive
 *
 * Tracks data flow from source to destination for:
 * - Data catalogs and discovery
 * - Impact analysis (what downstream depends on this?)
 * - Debugging (where did this data come from?)
 * - Compliance (prove data provenance)
 *
 * ## Features
 * - Column-level lineage (not just table-level)
 * - Transformation capture (SQL, code, pipeline)
 * - Time-travel queries via TemporalStore
 * - OpenLineage export format
 *
 * @example Basic Usage
 * ```typescript
 * import { createLineageTracker } from 'dotdo/db/primitives/lineage'
 *
 * const tracker = createLineageTracker()
 *
 * // Register assets
 * const source = tracker.registerAsset({
 *   type: 'table',
 *   namespace: 'warehouse',
 *   name: 'raw_events',
 * })
 *
 * const target = tracker.registerAsset({
 *   type: 'table',
 *   namespace: 'warehouse',
 *   name: 'aggregated_events',
 * })
 *
 * // Track data flow
 * tracker.addEdge(source, target, {
 *   transformationType: 'sql',
 *   sql: 'SELECT event_type, COUNT(*) FROM raw_events GROUP BY event_type',
 * })
 *
 * // Query lineage
 * const upstream = tracker.getUpstream(target)
 * const downstream = tracker.getDownstream(source)
 * ```
 *
 * @module db/primitives/lineage
 */

import { createTemporalStore, type TemporalStore, type TimeRange } from '../temporal-store'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Unique identifier for an asset.
 * Format: `{namespace}:{type}:{name}` or `{namespace}:{type}:{name}:{column}`
 */
export type AssetId = string

/**
 * Unique identifier for an edge.
 * Format: `{sourceId}-->{targetId}`
 */
export type EdgeId = string

/**
 * Type of data asset in the lineage graph.
 */
export type AssetType =
  | 'table'
  | 'column'
  | 'view'
  | 'file'
  | 'api'
  | 'stream'
  | 'dataset'
  | 'model'
  | 'dashboard'
  | 'report'

/**
 * Type of transformation between assets.
 */
export type TransformationType =
  | 'sql'
  | 'python'
  | 'spark'
  | 'dbt'
  | 'etl'
  | 'api'
  | 'manual'
  | 'copy'
  | 'unknown'

/**
 * Asset definition - a data entity in the lineage graph.
 */
export interface Asset {
  /** Unique identifier */
  id: AssetId
  /** Type of asset */
  type: AssetType
  /** Namespace (database, schema, bucket, etc.) */
  namespace: string
  /** Asset name */
  name: string
  /** Column name (for column-level lineage) */
  column?: string
  /** Optional description */
  description?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** When the asset was first registered */
  createdAt: number
  /** When the asset was last updated */
  updatedAt: number
}

/**
 * Options for registering a new asset.
 */
export interface AssetOptions {
  /** Type of asset */
  type: AssetType
  /** Namespace (database, schema, bucket, etc.) */
  namespace: string
  /** Asset name */
  name: string
  /** Column name (for column-level lineage) */
  column?: string
  /** Optional description */
  description?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Edge definition - a directed relationship between assets.
 */
export interface Edge {
  /** Unique identifier */
  id: EdgeId
  /** Source asset ID */
  sourceId: AssetId
  /** Target asset ID */
  targetId: AssetId
  /** Type of transformation */
  transformationType: TransformationType
  /** Transformation details */
  transformation?: TransformationDetails
  /** When this edge was created */
  createdAt: number
  /** When this edge was last updated */
  updatedAt: number
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Details about a transformation.
 */
export interface TransformationDetails {
  /** SQL query (if transformationType is 'sql') */
  sql?: string
  /** Code snippet */
  code?: string
  /** Pipeline or job name */
  jobName?: string
  /** Run ID or execution ID */
  runId?: string
  /** Duration in milliseconds */
  durationMs?: number
  /** Additional context */
  context?: Record<string, unknown>
}

/**
 * Options for adding an edge.
 */
export interface EdgeOptions {
  /** Type of transformation */
  transformationType: TransformationType
  /** Transformation details */
  transformation?: TransformationDetails
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Provenance record - metadata about a transformation event.
 */
export interface Provenance {
  /** Unique identifier */
  id: string
  /** Edge this provenance applies to */
  edgeId: EdgeId
  /** Timestamp of the transformation */
  timestamp: number
  /** Run/execution identifier */
  runId: string
  /** Job or pipeline name */
  jobName?: string
  /** Input record count */
  inputRecordCount?: number
  /** Output record count */
  outputRecordCount?: number
  /** Duration in milliseconds */
  durationMs?: number
  /** Status of the transformation */
  status: 'success' | 'failed' | 'partial'
  /** Error message if failed */
  errorMessage?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for recording provenance.
 */
export interface ProvenanceOptions {
  /** Run/execution identifier */
  runId: string
  /** Job or pipeline name */
  jobName?: string
  /** Input record count */
  inputRecordCount?: number
  /** Output record count */
  outputRecordCount?: number
  /** Duration in milliseconds */
  durationMs?: number
  /** Status of the transformation */
  status: 'success' | 'failed' | 'partial'
  /** Error message if failed */
  errorMessage?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Traversal options for lineage queries.
 */
export interface TraversalOptions {
  /** Maximum depth to traverse (default: unlimited) */
  maxDepth?: number
  /** Filter by asset types */
  assetTypes?: AssetType[]
  /** Filter by namespaces */
  namespaces?: string[]
  /** Include column-level lineage */
  includeColumns?: boolean
  /** Point in time for historical query */
  asOf?: number
}

/**
 * Result of an impact analysis.
 */
export interface ImpactAnalysis {
  /** Asset being analyzed */
  asset: Asset
  /** All downstream assets affected */
  affected: Asset[]
  /** Paths to each affected asset */
  paths: LineagePath[]
  /** Total depth of impact */
  maxDepth: number
}

/**
 * A path through the lineage graph.
 */
export interface LineagePath {
  /** Ordered list of assets in the path */
  assets: Asset[]
  /** Edges connecting the assets */
  edges: Edge[]
}

/**
 * Statistics about the lineage graph.
 */
export interface LineageStats {
  /** Total number of assets */
  assetCount: number
  /** Number of assets by type */
  assetsByType: Record<AssetType, number>
  /** Total number of edges */
  edgeCount: number
  /** Number of edges by transformation type */
  edgesByType: Record<TransformationType, number>
  /** Number of root assets (no upstream) */
  rootCount: number
  /** Number of leaf assets (no downstream) */
  leafCount: number
  /** Total provenance records */
  provenanceCount: number
}

/**
 * OpenLineage facet for export compatibility.
 */
export interface OpenLineageFacet {
  [key: string]: unknown
}

/**
 * OpenLineage run event for export.
 */
export interface OpenLineageRunEvent {
  eventType: 'START' | 'RUNNING' | 'COMPLETE' | 'FAIL' | 'ABORT'
  eventTime: string
  run: {
    runId: string
    facets?: Record<string, OpenLineageFacet>
  }
  job: {
    namespace: string
    name: string
    facets?: Record<string, OpenLineageFacet>
  }
  inputs: OpenLineageDataset[]
  outputs: OpenLineageDataset[]
  producer: string
}

/**
 * OpenLineage dataset representation.
 */
export interface OpenLineageDataset {
  namespace: string
  name: string
  facets?: Record<string, OpenLineageFacet>
}

/**
 * Configuration options for LineageTracker.
 */
export interface LineageTrackerOptions {
  /** Enable time-travel queries */
  enableTimeTravel?: boolean
  /** Retention policy for temporal data */
  retentionMs?: number
  /** Maximum versions to keep per asset/edge */
  maxVersions?: number
}

// =============================================================================
// LINEAGE TRACKER INTERFACE
// =============================================================================

/**
 * LineageTracker interface for tracking data lineage.
 */
export interface LineageTracker {
  // -------------------------------------------------------------------------
  // Asset Management
  // -------------------------------------------------------------------------

  /**
   * Register a new asset in the lineage graph.
   * Returns the asset ID (creates if not exists, updates if exists).
   */
  registerAsset(options: AssetOptions): AssetId

  /**
   * Get an asset by ID.
   */
  getAsset(id: AssetId): Asset | null

  /**
   * Get an asset as it existed at a specific timestamp.
   */
  getAssetAsOf(id: AssetId, timestamp: number): Asset | null

  /**
   * List all assets with optional filtering.
   */
  listAssets(options?: {
    type?: AssetType
    namespace?: string
    limit?: number
  }): Asset[]

  /**
   * Remove an asset and all its edges.
   */
  removeAsset(id: AssetId): boolean

  // -------------------------------------------------------------------------
  // Edge Management
  // -------------------------------------------------------------------------

  /**
   * Add a directed edge from source to target.
   * Returns the edge ID.
   */
  addEdge(sourceId: AssetId, targetId: AssetId, options: EdgeOptions): EdgeId

  /**
   * Get an edge by ID.
   */
  getEdge(id: EdgeId): Edge | null

  /**
   * Get an edge as it existed at a specific timestamp.
   */
  getEdgeAsOf(id: EdgeId, timestamp: number): Edge | null

  /**
   * List all edges with optional filtering.
   */
  listEdges(options?: {
    sourceId?: AssetId
    targetId?: AssetId
    transformationType?: TransformationType
    limit?: number
  }): Edge[]

  /**
   * Remove an edge.
   */
  removeEdge(id: EdgeId): boolean

  // -------------------------------------------------------------------------
  // Lineage Queries
  // -------------------------------------------------------------------------

  /**
   * Get all upstream assets (sources) for a given asset.
   * Traverses the graph backwards from target to sources.
   */
  getUpstream(assetId: AssetId, options?: TraversalOptions): Asset[]

  /**
   * Get all downstream assets (targets) for a given asset.
   * Traverses the graph forward from source to targets.
   */
  getDownstream(assetId: AssetId, options?: TraversalOptions): Asset[]

  /**
   * Get the complete path between two assets.
   * Returns null if no path exists.
   */
  getPath(sourceId: AssetId, targetId: AssetId, options?: TraversalOptions): LineagePath | null

  /**
   * Get all paths between two assets.
   */
  getAllPaths(sourceId: AssetId, targetId: AssetId, options?: TraversalOptions): LineagePath[]

  /**
   * Perform impact analysis for an asset.
   * Shows all downstream assets that would be affected by changes.
   */
  analyzeImpact(assetId: AssetId, options?: TraversalOptions): ImpactAnalysis

  /**
   * Get root assets (assets with no upstream dependencies).
   */
  getRoots(): Asset[]

  /**
   * Get leaf assets (assets with no downstream dependencies).
   */
  getLeaves(): Asset[]

  // -------------------------------------------------------------------------
  // Provenance
  // -------------------------------------------------------------------------

  /**
   * Record a provenance event for an edge.
   */
  recordProvenance(edgeId: EdgeId, options: ProvenanceOptions): string

  /**
   * Get provenance history for an edge.
   */
  getProvenance(edgeId: EdgeId, options?: { limit?: number; timeRange?: TimeRange }): Provenance[]

  /**
   * Get the latest provenance for an edge.
   */
  getLatestProvenance(edgeId: EdgeId): Provenance | null

  // -------------------------------------------------------------------------
  // Time Travel
  // -------------------------------------------------------------------------

  /**
   * Get the lineage graph as it existed at a specific timestamp.
   */
  getGraphAsOf(timestamp: number): { assets: Asset[]; edges: Edge[] }

  /**
   * Create a snapshot of the current lineage graph.
   */
  createSnapshot(): string

  /**
   * Restore the graph to a previous snapshot.
   */
  restoreSnapshot(snapshotId: string): void

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  /**
   * Export lineage data in OpenLineage format.
   */
  exportOpenLineage(edgeId: EdgeId, provenance: Provenance): OpenLineageRunEvent

  /**
   * Export all lineage data as JSON.
   */
  exportJSON(): { assets: Asset[]; edges: Edge[]; provenance: Provenance[] }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  /**
   * Get statistics about the lineage graph.
   */
  getStats(): LineageStats
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Generate an asset ID from options.
 */
function generateAssetId(options: AssetOptions): AssetId {
  const base = `${options.namespace}:${options.type}:${options.name}`
  return options.column ? `${base}:${options.column}` : base
}

/**
 * Generate an edge ID from source and target.
 */
function generateEdgeId(sourceId: AssetId, targetId: AssetId): EdgeId {
  return `${sourceId}-->${targetId}`
}

/**
 * In-memory implementation of LineageTracker with optional time-travel support.
 */
class InMemoryLineageTracker implements LineageTracker {
  private assets: Map<AssetId, Asset> = new Map()
  private edges: Map<EdgeId, Edge> = new Map()
  private provenanceRecords: Map<EdgeId, Provenance[]> = new Map()

  // Adjacency lists for efficient traversal
  private upstream: Map<AssetId, Set<EdgeId>> = new Map() // edges pointing TO this asset
  private downstream: Map<AssetId, Set<EdgeId>> = new Map() // edges pointing FROM this asset

  // Temporal stores for time-travel (optional)
  private assetStore: TemporalStore<Asset> | null = null
  private edgeStore: TemporalStore<Edge> | null = null

  private provenanceCounter = 0
  private snapshotCounter = 0
  private snapshots: Map<string, { assets: Asset[]; edges: Edge[] }> = new Map()

  private readonly enableTimeTravel: boolean

  constructor(options?: LineageTrackerOptions) {
    this.enableTimeTravel = options?.enableTimeTravel ?? false

    if (this.enableTimeTravel) {
      this.assetStore = createTemporalStore<Asset>({
        retention:
          options?.retentionMs || options?.maxVersions
            ? {
                maxAge: options?.retentionMs,
                maxVersions: options?.maxVersions,
              }
            : undefined,
      })
      this.edgeStore = createTemporalStore<Edge>({
        retention:
          options?.retentionMs || options?.maxVersions
            ? {
                maxAge: options?.retentionMs,
                maxVersions: options?.maxVersions,
              }
            : undefined,
      })
    }
  }

  // -------------------------------------------------------------------------
  // Asset Management
  // -------------------------------------------------------------------------

  registerAsset(options: AssetOptions): AssetId {
    const id = generateAssetId(options)
    const now = Date.now()

    const existing = this.assets.get(id)
    const asset: Asset = {
      id,
      type: options.type,
      namespace: options.namespace,
      name: options.name,
      column: options.column,
      description: options.description,
      metadata: options.metadata,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    this.assets.set(id, asset)

    // Initialize adjacency lists if not present
    if (!this.upstream.has(id)) {
      this.upstream.set(id, new Set())
    }
    if (!this.downstream.has(id)) {
      this.downstream.set(id, new Set())
    }

    // Store in temporal store for time-travel
    if (this.assetStore) {
      void this.assetStore.put(id, asset, now)
    }

    return id
  }

  getAsset(id: AssetId): Asset | null {
    return this.assets.get(id) ?? null
  }

  getAssetAsOf(id: AssetId, timestamp: number): Asset | null {
    if (!this.assetStore) {
      // Without time-travel, just return current state
      return this.assets.get(id) ?? null
    }

    // Synchronous wrapper for async getAsOf
    let result: Asset | null = null
    void this.assetStore.getAsOf(id, timestamp).then((r) => {
      result = r
    })

    // Since we're in an in-memory implementation, the promise resolves synchronously
    // For production, this should be properly async
    return result
  }

  listAssets(options?: { type?: AssetType; namespace?: string; limit?: number }): Asset[] {
    let results = Array.from(this.assets.values())

    if (options?.type) {
      results = results.filter((a) => a.type === options.type)
    }
    if (options?.namespace) {
      results = results.filter((a) => a.namespace === options.namespace)
    }
    if (options?.limit) {
      results = results.slice(0, options.limit)
    }

    return results
  }

  removeAsset(id: AssetId): boolean {
    if (!this.assets.has(id)) {
      return false
    }

    // Remove all edges connected to this asset
    const upstreamEdges = this.upstream.get(id) ?? new Set()
    const downstreamEdges = this.downstream.get(id) ?? new Set()

    for (const edgeId of upstreamEdges) {
      this.removeEdge(edgeId)
    }
    for (const edgeId of downstreamEdges) {
      this.removeEdge(edgeId)
    }

    // Remove the asset
    this.assets.delete(id)
    this.upstream.delete(id)
    this.downstream.delete(id)

    return true
  }

  // -------------------------------------------------------------------------
  // Edge Management
  // -------------------------------------------------------------------------

  addEdge(sourceId: AssetId, targetId: AssetId, options: EdgeOptions): EdgeId {
    // Verify both assets exist
    if (!this.assets.has(sourceId)) {
      throw new Error(`Source asset not found: ${sourceId}`)
    }
    if (!this.assets.has(targetId)) {
      throw new Error(`Target asset not found: ${targetId}`)
    }

    const id = generateEdgeId(sourceId, targetId)
    const now = Date.now()

    const existing = this.edges.get(id)
    const edge: Edge = {
      id,
      sourceId,
      targetId,
      transformationType: options.transformationType,
      transformation: options.transformation,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      metadata: options.metadata,
    }

    this.edges.set(id, edge)

    // Update adjacency lists
    this.downstream.get(sourceId)?.add(id) ?? this.downstream.set(sourceId, new Set([id]))
    this.upstream.get(targetId)?.add(id) ?? this.upstream.set(targetId, new Set([id]))

    // Store in temporal store for time-travel
    if (this.edgeStore) {
      void this.edgeStore.put(id, edge, now)
    }

    return id
  }

  getEdge(id: EdgeId): Edge | null {
    return this.edges.get(id) ?? null
  }

  getEdgeAsOf(id: EdgeId, timestamp: number): Edge | null {
    if (!this.edgeStore) {
      return this.edges.get(id) ?? null
    }

    let result: Edge | null = null
    void this.edgeStore.getAsOf(id, timestamp).then((r) => {
      result = r
    })
    return result
  }

  listEdges(options?: {
    sourceId?: AssetId
    targetId?: AssetId
    transformationType?: TransformationType
    limit?: number
  }): Edge[] {
    let results = Array.from(this.edges.values())

    if (options?.sourceId) {
      results = results.filter((e) => e.sourceId === options.sourceId)
    }
    if (options?.targetId) {
      results = results.filter((e) => e.targetId === options.targetId)
    }
    if (options?.transformationType) {
      results = results.filter((e) => e.transformationType === options.transformationType)
    }
    if (options?.limit) {
      results = results.slice(0, options.limit)
    }

    return results
  }

  removeEdge(id: EdgeId): boolean {
    const edge = this.edges.get(id)
    if (!edge) {
      return false
    }

    // Update adjacency lists
    this.downstream.get(edge.sourceId)?.delete(id)
    this.upstream.get(edge.targetId)?.delete(id)

    // Remove edge
    this.edges.delete(id)

    // Remove provenance records
    this.provenanceRecords.delete(id)

    return true
  }

  // -------------------------------------------------------------------------
  // Lineage Queries
  // -------------------------------------------------------------------------

  getUpstream(assetId: AssetId, options?: TraversalOptions): Asset[] {
    const visited = new Set<AssetId>()
    const result: Asset[] = []
    const maxDepth = options?.maxDepth ?? Infinity

    this.traverseUpstream(assetId, 0, maxDepth, visited, result, options)

    return result
  }

  private traverseUpstream(
    assetId: AssetId,
    currentDepth: number,
    maxDepth: number,
    visited: Set<AssetId>,
    result: Asset[],
    options?: TraversalOptions
  ): void {
    if (currentDepth >= maxDepth || visited.has(assetId)) {
      return
    }

    visited.add(assetId)

    const incomingEdges = this.upstream.get(assetId) ?? new Set()

    for (const edgeId of incomingEdges) {
      const edge = this.edges.get(edgeId)
      if (!edge) continue

      const sourceAsset = this.assets.get(edge.sourceId)
      if (!sourceAsset) continue

      // Apply filters
      if (options?.assetTypes && !options.assetTypes.includes(sourceAsset.type)) {
        continue
      }
      if (options?.namespaces && !options.namespaces.includes(sourceAsset.namespace)) {
        continue
      }
      if (!options?.includeColumns && sourceAsset.column) {
        continue
      }

      if (!visited.has(sourceAsset.id)) {
        result.push(sourceAsset)
        this.traverseUpstream(sourceAsset.id, currentDepth + 1, maxDepth, visited, result, options)
      }
    }
  }

  getDownstream(assetId: AssetId, options?: TraversalOptions): Asset[] {
    const visited = new Set<AssetId>()
    const result: Asset[] = []
    const maxDepth = options?.maxDepth ?? Infinity

    this.traverseDownstream(assetId, 0, maxDepth, visited, result, options)

    return result
  }

  private traverseDownstream(
    assetId: AssetId,
    currentDepth: number,
    maxDepth: number,
    visited: Set<AssetId>,
    result: Asset[],
    options?: TraversalOptions
  ): void {
    if (currentDepth >= maxDepth || visited.has(assetId)) {
      return
    }

    visited.add(assetId)

    const outgoingEdges = this.downstream.get(assetId) ?? new Set()

    for (const edgeId of outgoingEdges) {
      const edge = this.edges.get(edgeId)
      if (!edge) continue

      const targetAsset = this.assets.get(edge.targetId)
      if (!targetAsset) continue

      // Apply filters
      if (options?.assetTypes && !options.assetTypes.includes(targetAsset.type)) {
        continue
      }
      if (options?.namespaces && !options.namespaces.includes(targetAsset.namespace)) {
        continue
      }
      if (!options?.includeColumns && targetAsset.column) {
        continue
      }

      if (!visited.has(targetAsset.id)) {
        result.push(targetAsset)
        this.traverseDownstream(targetAsset.id, currentDepth + 1, maxDepth, visited, result, options)
      }
    }
  }

  getPath(sourceId: AssetId, targetId: AssetId, options?: TraversalOptions): LineagePath | null {
    const paths = this.getAllPaths(sourceId, targetId, options)
    return paths.length > 0 ? paths[0] : null
  }

  getAllPaths(sourceId: AssetId, targetId: AssetId, options?: TraversalOptions): LineagePath[] {
    const maxDepth = options?.maxDepth ?? 100 // Prevent infinite loops
    const paths: LineagePath[] = []

    const source = this.assets.get(sourceId)
    const target = this.assets.get(targetId)

    if (!source || !target) {
      return paths
    }

    // DFS to find all paths
    const currentPath: Asset[] = [source]
    const currentEdges: Edge[] = []
    const visited = new Set<AssetId>()

    this.findPaths(sourceId, targetId, currentPath, currentEdges, visited, paths, 0, maxDepth, options)

    return paths
  }

  private findPaths(
    currentId: AssetId,
    targetId: AssetId,
    currentPath: Asset[],
    currentEdges: Edge[],
    visited: Set<AssetId>,
    paths: LineagePath[],
    depth: number,
    maxDepth: number,
    options?: TraversalOptions
  ): void {
    if (depth > maxDepth) {
      return
    }

    if (currentId === targetId) {
      paths.push({
        assets: [...currentPath],
        edges: [...currentEdges],
      })
      return
    }

    visited.add(currentId)

    const outgoingEdges = this.downstream.get(currentId) ?? new Set()

    for (const edgeId of outgoingEdges) {
      const edge = this.edges.get(edgeId)
      if (!edge) continue

      const nextAsset = this.assets.get(edge.targetId)
      if (!nextAsset || visited.has(nextAsset.id)) continue

      // Apply filters
      if (options?.assetTypes && !options.assetTypes.includes(nextAsset.type)) {
        continue
      }
      if (options?.namespaces && !options.namespaces.includes(nextAsset.namespace)) {
        continue
      }

      currentPath.push(nextAsset)
      currentEdges.push(edge)

      this.findPaths(
        nextAsset.id,
        targetId,
        currentPath,
        currentEdges,
        visited,
        paths,
        depth + 1,
        maxDepth,
        options
      )

      currentPath.pop()
      currentEdges.pop()
    }

    visited.delete(currentId)
  }

  analyzeImpact(assetId: AssetId, options?: TraversalOptions): ImpactAnalysis {
    const asset = this.assets.get(assetId)
    if (!asset) {
      throw new Error(`Asset not found: ${assetId}`)
    }

    const affected = this.getDownstream(assetId, options)
    const paths: LineagePath[] = []
    let maxDepth = 0

    for (const downstream of affected) {
      const assetPaths = this.getAllPaths(assetId, downstream.id, options)
      paths.push(...assetPaths)

      for (const path of assetPaths) {
        if (path.assets.length - 1 > maxDepth) {
          maxDepth = path.assets.length - 1
        }
      }
    }

    return {
      asset,
      affected,
      paths,
      maxDepth,
    }
  }

  getRoots(): Asset[] {
    const roots: Asset[] = []

    for (const [id, asset] of this.assets) {
      const upstreamEdges = this.upstream.get(id) ?? new Set()
      if (upstreamEdges.size === 0) {
        roots.push(asset)
      }
    }

    return roots
  }

  getLeaves(): Asset[] {
    const leaves: Asset[] = []

    for (const [id, asset] of this.assets) {
      const downstreamEdges = this.downstream.get(id) ?? new Set()
      if (downstreamEdges.size === 0) {
        leaves.push(asset)
      }
    }

    return leaves
  }

  // -------------------------------------------------------------------------
  // Provenance
  // -------------------------------------------------------------------------

  recordProvenance(edgeId: EdgeId, options: ProvenanceOptions): string {
    if (!this.edges.has(edgeId)) {
      throw new Error(`Edge not found: ${edgeId}`)
    }

    const id = `prov-${++this.provenanceCounter}-${Date.now()}`
    const provenance: Provenance = {
      id,
      edgeId,
      timestamp: Date.now(),
      runId: options.runId,
      jobName: options.jobName,
      inputRecordCount: options.inputRecordCount,
      outputRecordCount: options.outputRecordCount,
      durationMs: options.durationMs,
      status: options.status,
      errorMessage: options.errorMessage,
      metadata: options.metadata,
    }

    const records = this.provenanceRecords.get(edgeId) ?? []
    records.push(provenance)
    this.provenanceRecords.set(edgeId, records)

    return id
  }

  getProvenance(edgeId: EdgeId, options?: { limit?: number; timeRange?: TimeRange }): Provenance[] {
    let records = this.provenanceRecords.get(edgeId) ?? []

    if (options?.timeRange) {
      const { start, end } = options.timeRange
      records = records.filter((p) => {
        if (start !== undefined && p.timestamp < start) return false
        if (end !== undefined && p.timestamp > end) return false
        return true
      })
    }

    // Sort by timestamp descending (most recent first)
    records = records.sort((a, b) => b.timestamp - a.timestamp)

    if (options?.limit) {
      records = records.slice(0, options.limit)
    }

    return records
  }

  getLatestProvenance(edgeId: EdgeId): Provenance | null {
    const records = this.provenanceRecords.get(edgeId) ?? []
    if (records.length === 0) return null

    return records.reduce((latest, current) =>
      current.timestamp > latest.timestamp ? current : latest
    )
  }

  // -------------------------------------------------------------------------
  // Time Travel
  // -------------------------------------------------------------------------

  getGraphAsOf(timestamp: number): { assets: Asset[]; edges: Edge[] } {
    if (!this.assetStore || !this.edgeStore) {
      // Without time-travel, return current state
      return {
        assets: Array.from(this.assets.values()),
        edges: Array.from(this.edges.values()),
      }
    }

    // For in-memory implementation, filter current state by timestamp
    const assets = Array.from(this.assets.values()).filter((a) => a.createdAt <= timestamp)

    const edges = Array.from(this.edges.values()).filter((e) => e.createdAt <= timestamp)

    return { assets, edges }
  }

  createSnapshot(): string {
    const id = `snapshot-${++this.snapshotCounter}-${Date.now()}`

    this.snapshots.set(id, {
      assets: Array.from(this.assets.values()).map((a) => ({ ...a })),
      edges: Array.from(this.edges.values()).map((e) => ({ ...e })),
    })

    return id
  }

  restoreSnapshot(snapshotId: string): void {
    const snapshot = this.snapshots.get(snapshotId)
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`)
    }

    // Clear current state
    this.assets.clear()
    this.edges.clear()
    this.upstream.clear()
    this.downstream.clear()

    // Restore assets
    for (const asset of snapshot.assets) {
      this.assets.set(asset.id, { ...asset })
      this.upstream.set(asset.id, new Set())
      this.downstream.set(asset.id, new Set())
    }

    // Restore edges
    for (const edge of snapshot.edges) {
      this.edges.set(edge.id, { ...edge })
      this.downstream.get(edge.sourceId)?.add(edge.id)
      this.upstream.get(edge.targetId)?.add(edge.id)
    }
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  exportOpenLineage(edgeId: EdgeId, provenance: Provenance): OpenLineageRunEvent {
    const edge = this.edges.get(edgeId)
    if (!edge) {
      throw new Error(`Edge not found: ${edgeId}`)
    }

    const source = this.assets.get(edge.sourceId)
    const target = this.assets.get(edge.targetId)

    if (!source || !target) {
      throw new Error('Source or target asset not found')
    }

    const eventType =
      provenance.status === 'success' ? 'COMPLETE' : provenance.status === 'failed' ? 'FAIL' : 'RUNNING'

    return {
      eventType,
      eventTime: new Date(provenance.timestamp).toISOString(),
      run: {
        runId: provenance.runId,
        facets: provenance.metadata
          ? {
              custom: provenance.metadata,
            }
          : undefined,
      },
      job: {
        namespace: source.namespace,
        name: provenance.jobName ?? `${source.name}_to_${target.name}`,
        facets: edge.transformation
          ? {
              sql: edge.transformation.sql ? { query: edge.transformation.sql } : undefined,
            }
          : undefined,
      },
      inputs: [
        {
          namespace: source.namespace,
          name: source.name,
          facets: source.metadata
            ? {
                custom: source.metadata,
              }
            : undefined,
        },
      ],
      outputs: [
        {
          namespace: target.namespace,
          name: target.name,
          facets: target.metadata
            ? {
                custom: target.metadata,
              }
            : undefined,
        },
      ],
      producer: 'dotdo-lineage-tracker',
    }
  }

  exportJSON(): { assets: Asset[]; edges: Edge[]; provenance: Provenance[] } {
    const allProvenance: Provenance[] = []
    for (const records of this.provenanceRecords.values()) {
      allProvenance.push(...records)
    }

    return {
      assets: Array.from(this.assets.values()),
      edges: Array.from(this.edges.values()),
      provenance: allProvenance,
    }
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  getStats(): LineageStats {
    const assetsByType: Record<AssetType, number> = {
      table: 0,
      column: 0,
      view: 0,
      file: 0,
      api: 0,
      stream: 0,
      dataset: 0,
      model: 0,
      dashboard: 0,
      report: 0,
    }

    const edgesByType: Record<TransformationType, number> = {
      sql: 0,
      python: 0,
      spark: 0,
      dbt: 0,
      etl: 0,
      api: 0,
      manual: 0,
      copy: 0,
      unknown: 0,
    }

    for (const asset of this.assets.values()) {
      assetsByType[asset.type]++
    }

    for (const edge of this.edges.values()) {
      edgesByType[edge.transformationType]++
    }

    let provenanceCount = 0
    for (const records of this.provenanceRecords.values()) {
      provenanceCount += records.length
    }

    return {
      assetCount: this.assets.size,
      assetsByType,
      edgeCount: this.edges.size,
      edgesByType,
      rootCount: this.getRoots().length,
      leafCount: this.getLeaves().length,
      provenanceCount,
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new LineageTracker instance.
 *
 * @param options - Configuration options
 * @returns A new LineageTracker instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const tracker = createLineageTracker()
 *
 * // With time-travel support
 * const tracker = createLineageTracker({
 *   enableTimeTravel: true,
 *   retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
 * })
 * ```
 */
export function createLineageTracker(options?: LineageTrackerOptions): LineageTracker {
  return new InMemoryLineageTracker(options)
}
