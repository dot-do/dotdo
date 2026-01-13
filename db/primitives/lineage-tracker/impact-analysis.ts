/**
 * Impact Analysis Queries - Advanced lineage analysis capabilities
 *
 * This module provides comprehensive impact analysis queries for answering
 * "what if" questions about data changes in the lineage graph.
 *
 * ## Query Types
 * - **Upstream impact**: What sources feed this asset?
 * - **Downstream impact**: What will break if I change this?
 * - **Root cause**: Where did this bad data originate?
 * - **Coverage**: What percentage of data is tracked?
 *
 * ## Analysis Features
 * - Dependency depth calculation
 * - Critical path identification
 * - Orphan detection (assets with no lineage)
 * - Circular dependency detection
 *
 * @module db/primitives/lineage-tracker/impact-analysis
 */

import type { LineageStore } from './storage'
import type {
  LineageNode,
  LineageEdge,
  LineageGraph,
  LineagePath,
  NodeType,
  ImpactAnalysis,
  AffectedNode,
  BlastRadiusMetrics,
} from './types'

// =============================================================================
// IMPACT REPORT TYPES
// =============================================================================

/**
 * Severity level for impact assessment
 */
export type ImpactSeverity = 'critical' | 'high' | 'medium' | 'low' | 'none'

/**
 * An affected asset with detailed impact information
 */
export interface ImpactedAsset {
  /** The affected node */
  node: LineageNode
  /** Distance (hops) from the source */
  distance: number
  /** Number of distinct paths to this node */
  pathCount: number
  /** Whether the impact is direct or indirect */
  impactType: 'direct' | 'indirect'
  /** Severity based on node type and distance */
  severity: ImpactSeverity
  /** Owners/teams that should be notified */
  owners: string[]
  /** Recommended action */
  recommendedAction: string
}

/**
 * Comprehensive impact report
 */
export interface ImpactReport {
  /** The asset being analyzed */
  sourceAsset: LineageNode
  /** Direction of analysis */
  direction: 'upstream' | 'downstream'
  /** All affected assets (direct and transitive) */
  affectedAssets: ImpactedAsset[]
  /** Total count of affected assets */
  totalAffected: number
  /** Breakdown by severity */
  bySeverity: Record<ImpactSeverity, number>
  /** Breakdown by node type */
  byType: Record<string, number>
  /** Critical paths (most important dependency chains) */
  criticalPaths: LineagePath[]
  /** Maximum dependency depth */
  maxDepth: number
  /** Recommended actions based on impact */
  recommendedActions: string[]
  /** Teams/owners that need to be notified */
  affectedOwners: string[]
  /** Timestamp of analysis */
  analyzedAt: number
}

/**
 * Coverage statistics for lineage tracking
 */
export interface CoverageReport {
  /** Total number of assets in the graph */
  totalAssets: number
  /** Assets with at least one upstream connection */
  assetsWithUpstream: number
  /** Assets with at least one downstream connection */
  assetsWithDownstream: number
  /** Assets with both upstream and downstream connections */
  fullyConnected: number
  /** Orphan assets (no connections at all) */
  orphans: OrphanAsset[]
  /** Root assets (sources - no upstream) */
  roots: LineageNode[]
  /** Leaf assets (sinks - no downstream) */
  leaves: LineageNode[]
  /** Overall coverage percentage (0-1) */
  coveragePercentage: number
  /** Coverage by namespace */
  coverageByNamespace: Map<string, NamespaceCoverage>
  /** Coverage by node type */
  coverageByType: Map<NodeType, number>
  /** Timestamp of analysis */
  analyzedAt: number
}

/**
 * Coverage metrics for a namespace
 */
export interface NamespaceCoverage {
  namespace: string
  totalAssets: number
  trackedAssets: number
  coveragePercentage: number
}

/**
 * An orphan asset with reason
 */
export interface OrphanAsset {
  node: LineageNode
  reason: 'no_upstream' | 'no_downstream' | 'isolated'
}

/**
 * Circular dependency information
 */
export interface CircularDependency {
  /** Node IDs forming the cycle */
  nodeIds: string[]
  /** Edge IDs forming the cycle */
  edgeIds: string[]
  /** Length of the cycle */
  cycleLength: number
  /** Starting node */
  startNode: LineageNode
}

/**
 * Predicate function for filtering nodes
 */
export type NodePredicate = (node: LineageNode) => boolean

/**
 * Options for impact analysis
 */
export interface AnalysisOptions {
  /** Maximum depth to traverse (default: unlimited) */
  maxDepth?: number
  /** Filter to specific node types */
  nodeTypes?: NodeType[]
  /** Include indirect impacts (default: true) */
  includeIndirect?: boolean
  /** Minimum severity to include (default: 'low') */
  minSeverity?: ImpactSeverity
  /** Include owner information from metadata (default: true) */
  includeOwners?: boolean
  /** Include recommended actions (default: true) */
  includeRecommendations?: boolean
}

// =============================================================================
// IMPACT ANALYZER CLASS
// =============================================================================

/**
 * ImpactAnalyzer - Advanced impact analysis for lineage graphs
 */
export class ImpactAnalyzer {
  constructor(private store: LineageStore) {}

  // ===========================================================================
  // UPSTREAM IMPACT ANALYSIS
  // ===========================================================================

  /**
   * Analyze upstream impact - What sources feed this asset?
   *
   * Returns a comprehensive report of all upstream dependencies,
   * including sources, transformations, and their relationships.
   *
   * @param assetId - The ID of the asset to analyze
   * @param options - Analysis options
   * @returns Impact report for upstream dependencies
   *
   * @example
   * ```typescript
   * const report = analyzer.analyzeUpstreamImpact('sink-1')
   * console.log(`This asset depends on ${report.totalAffected} upstream assets`)
   * ```
   */
  analyzeUpstreamImpact(assetId: string, options?: AnalysisOptions): ImpactReport {
    const sourceNode = this.store.getNode(assetId)
    if (!sourceNode) {
      throw new Error(`Asset not found: ${assetId}`)
    }

    const maxDepth = options?.maxDepth ?? Number.POSITIVE_INFINITY
    const nodeTypes = options?.nodeTypes
    const includeIndirect = options?.includeIndirect ?? true
    const includeOwners = options?.includeOwners ?? true
    const includeRecommendations = options?.includeRecommendations ?? true

    // Track affected nodes with distances and path counts
    const affectedMap = new Map<string, { distance: number; pathCount: number }>()
    const visited = new Set<string>()

    // BFS traversal upstream
    this.bfsUpstream(assetId, 0, maxDepth, visited, affectedMap, nodeTypes)

    // Build affected assets list
    const affectedAssets: ImpactedAsset[] = []
    const bySeverity: Record<ImpactSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      none: 0,
    }
    const byType: Record<string, number> = {}
    const ownerSet = new Set<string>()

    for (const [id, info] of Array.from(affectedMap.entries())) {
      const node = this.store.getNode(id)
      if (!node) continue

      const isDirectParent = info.distance === 1
      if (!includeIndirect && !isDirectParent) continue

      const severity = this.calculateSeverity(node, info.distance, 'upstream')
      const owners = includeOwners ? this.extractOwners(node) : []

      owners.forEach((owner) => ownerSet.add(owner))

      affectedAssets.push({
        node,
        distance: info.distance,
        pathCount: info.pathCount,
        impactType: isDirectParent ? 'direct' : 'indirect',
        severity,
        owners,
        recommendedAction: includeRecommendations
          ? this.getRecommendedAction(node, severity, 'upstream')
          : '',
      })

      bySeverity[severity]++
      byType[node.type] = (byType[node.type] ?? 0) + 1
    }

    // Sort by distance (closest first), then by severity
    affectedAssets.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance
      return this.severityOrder(a.severity) - this.severityOrder(b.severity)
    })

    // Filter by minimum severity if specified
    const filteredAssets = options?.minSeverity
      ? affectedAssets.filter(
          (a) => this.severityOrder(a.severity) <= this.severityOrder(options.minSeverity!)
        )
      : affectedAssets

    // Find critical paths
    const criticalPaths = this.findCriticalPathsUpstream(assetId, affectedMap)

    // Calculate max depth
    const maxDepthReached = Math.max(0, ...filteredAssets.map((a) => a.distance))

    return {
      sourceAsset: sourceNode,
      direction: 'upstream',
      affectedAssets: filteredAssets,
      totalAffected: filteredAssets.length,
      bySeverity,
      byType,
      criticalPaths,
      maxDepth: maxDepthReached,
      recommendedActions: includeRecommendations ? this.generateRecommendations(filteredAssets, 'upstream') : [],
      affectedOwners: Array.from(ownerSet),
      analyzedAt: Date.now(),
    }
  }

  private bfsUpstream(
    startId: string,
    startDepth: number,
    maxDepth: number,
    visited: Set<string>,
    affectedMap: Map<string, { distance: number; pathCount: number }>,
    nodeTypes?: NodeType[]
  ): void {
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: startDepth }]
    visited.add(startId)

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!

      if (depth >= maxDepth) continue

      const incoming = this.store.getIncomingEdges(id)
      for (const edge of incoming) {
        const sourceNode = this.store.getNode(edge.fromNodeId)
        if (!sourceNode) continue

        const newDepth = depth + 1
        const passesFilter = !nodeTypes || nodeTypes.includes(sourceNode.type)

        if (passesFilter) {
          if (!affectedMap.has(edge.fromNodeId)) {
            affectedMap.set(edge.fromNodeId, { distance: newDepth, pathCount: 1 })
          } else {
            const existing = affectedMap.get(edge.fromNodeId)!
            existing.pathCount++
          }
        }

        if (!visited.has(edge.fromNodeId)) {
          visited.add(edge.fromNodeId)
          queue.push({ id: edge.fromNodeId, depth: newDepth })
        }
      }
    }
  }

  // ===========================================================================
  // DOWNSTREAM IMPACT ANALYSIS
  // ===========================================================================

  /**
   * Analyze downstream impact - What will break if I change this?
   *
   * Returns a comprehensive report of all downstream dependents,
   * useful for understanding the blast radius of a change.
   *
   * @param assetId - The ID of the asset to analyze
   * @param options - Analysis options
   * @returns Impact report for downstream dependents
   *
   * @example
   * ```typescript
   * const report = analyzer.analyzeDownstreamImpact('source-1')
   * console.log(`Changing this asset will affect ${report.totalAffected} downstream assets`)
   * for (const owner of report.affectedOwners) {
   *   console.log(`Notify: ${owner}`)
   * }
   * ```
   */
  analyzeDownstreamImpact(assetId: string, options?: AnalysisOptions): ImpactReport {
    const sourceNode = this.store.getNode(assetId)
    if (!sourceNode) {
      throw new Error(`Asset not found: ${assetId}`)
    }

    const maxDepth = options?.maxDepth ?? Number.POSITIVE_INFINITY
    const nodeTypes = options?.nodeTypes
    const includeIndirect = options?.includeIndirect ?? true
    const includeOwners = options?.includeOwners ?? true
    const includeRecommendations = options?.includeRecommendations ?? true

    // Track affected nodes with distances and path counts
    const affectedMap = new Map<string, { distance: number; pathCount: number }>()
    const visited = new Set<string>()

    // BFS traversal downstream
    this.bfsDownstream(assetId, 0, maxDepth, visited, affectedMap, nodeTypes)

    // Build affected assets list
    const affectedAssets: ImpactedAsset[] = []
    const bySeverity: Record<ImpactSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      none: 0,
    }
    const byType: Record<string, number> = {}
    const ownerSet = new Set<string>()

    for (const [id, info] of Array.from(affectedMap.entries())) {
      const node = this.store.getNode(id)
      if (!node) continue

      const isDirectChild = info.distance === 1
      if (!includeIndirect && !isDirectChild) continue

      const severity = this.calculateSeverity(node, info.distance, 'downstream')
      const owners = includeOwners ? this.extractOwners(node) : []

      owners.forEach((owner) => ownerSet.add(owner))

      affectedAssets.push({
        node,
        distance: info.distance,
        pathCount: info.pathCount,
        impactType: isDirectChild ? 'direct' : 'indirect',
        severity,
        owners,
        recommendedAction: includeRecommendations
          ? this.getRecommendedAction(node, severity, 'downstream')
          : '',
      })

      bySeverity[severity]++
      byType[node.type] = (byType[node.type] ?? 0) + 1
    }

    // Sort by distance (closest first), then by severity
    affectedAssets.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance
      return this.severityOrder(a.severity) - this.severityOrder(b.severity)
    })

    // Filter by minimum severity if specified
    const filteredAssets = options?.minSeverity
      ? affectedAssets.filter(
          (a) => this.severityOrder(a.severity) <= this.severityOrder(options.minSeverity!)
        )
      : affectedAssets

    // Find critical paths
    const criticalPaths = this.findCriticalPathsDownstream(assetId, affectedMap)

    // Calculate max depth
    const maxDepthReached = Math.max(0, ...filteredAssets.map((a) => a.distance))

    return {
      sourceAsset: sourceNode,
      direction: 'downstream',
      affectedAssets: filteredAssets,
      totalAffected: filteredAssets.length,
      bySeverity,
      byType,
      criticalPaths,
      maxDepth: maxDepthReached,
      recommendedActions: includeRecommendations ? this.generateRecommendations(filteredAssets, 'downstream') : [],
      affectedOwners: Array.from(ownerSet),
      analyzedAt: Date.now(),
    }
  }

  private bfsDownstream(
    startId: string,
    startDepth: number,
    maxDepth: number,
    visited: Set<string>,
    affectedMap: Map<string, { distance: number; pathCount: number }>,
    nodeTypes?: NodeType[]
  ): void {
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: startDepth }]
    visited.add(startId)

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!

      if (depth >= maxDepth) continue

      const outgoing = this.store.getOutgoingEdges(id)
      for (const edge of outgoing) {
        const targetNode = this.store.getNode(edge.toNodeId)
        if (!targetNode) continue

        const newDepth = depth + 1
        const passesFilter = !nodeTypes || nodeTypes.includes(targetNode.type)

        if (passesFilter) {
          if (!affectedMap.has(edge.toNodeId)) {
            affectedMap.set(edge.toNodeId, { distance: newDepth, pathCount: 1 })
          } else {
            const existing = affectedMap.get(edge.toNodeId)!
            existing.pathCount++
          }
        }

        if (!visited.has(edge.toNodeId)) {
          visited.add(edge.toNodeId)
          queue.push({ id: edge.toNodeId, depth: newDepth })
        }
      }
    }
  }

  // ===========================================================================
  // ROOT CAUSE ANALYSIS
  // ===========================================================================

  /**
   * Find root cause - Where did bad data originate?
   *
   * Traverses upstream to find source nodes matching a condition.
   * Useful for debugging data quality issues.
   *
   * @param assetId - The ID of the asset with bad data
   * @param predicate - Function to test if a node is a potential root cause
   * @returns Array of nodes matching the predicate on the upstream path
   *
   * @example
   * ```typescript
   * // Find all sources that might have caused bad data
   * const causes = analyzer.findRootCause('problematic-sink', (node) => {
   *   return node.type === 'source' || node.metadata.hasQualityIssues === true
   * })
   * ```
   */
  findRootCause(assetId: string, predicate: NodePredicate): LineageNode[] {
    const startNode = this.store.getNode(assetId)
    if (!startNode) {
      throw new Error(`Asset not found: ${assetId}`)
    }

    const matchingNodes: LineageNode[] = []
    const visited = new Set<string>()

    this.dfsRootCause(assetId, predicate, visited, matchingNodes)

    return matchingNodes
  }

  private dfsRootCause(
    nodeId: string,
    predicate: NodePredicate,
    visited: Set<string>,
    matchingNodes: LineageNode[]
  ): void {
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    const node = this.store.getNode(nodeId)
    if (!node) return

    // Check if this node matches the predicate
    if (predicate(node)) {
      matchingNodes.push(node)
    }

    // Continue traversing upstream
    const incoming = this.store.getIncomingEdges(nodeId)
    for (const edge of incoming) {
      this.dfsRootCause(edge.fromNodeId, predicate, visited, matchingNodes)
    }
  }

  /**
   * Find all source nodes (roots) upstream of an asset
   */
  findSourcesFor(assetId: string): LineageNode[] {
    return this.findRootCause(assetId, (node) => {
      const incoming = this.store.getIncomingEdges(node.id)
      return incoming.length === 0
    })
  }

  // ===========================================================================
  // LINEAGE COVERAGE ANALYSIS
  // ===========================================================================

  /**
   * Get lineage coverage - What percentage of data is tracked?
   *
   * Returns a comprehensive report on lineage tracking coverage,
   * including orphan detection and coverage by namespace/type.
   *
   * @returns Coverage report with detailed statistics
   *
   * @example
   * ```typescript
   * const coverage = analyzer.getLineageCoverage()
   * console.log(`Lineage coverage: ${(coverage.coveragePercentage * 100).toFixed(1)}%`)
   * console.log(`Orphan assets: ${coverage.orphans.length}`)
   * ```
   */
  getLineageCoverage(): CoverageReport {
    const allNodes = this.store.findNodes()
    const totalAssets = allNodes.length

    if (totalAssets === 0) {
      return {
        totalAssets: 0,
        assetsWithUpstream: 0,
        assetsWithDownstream: 0,
        fullyConnected: 0,
        orphans: [],
        roots: [],
        leaves: [],
        coveragePercentage: 0,
        coverageByNamespace: new Map(),
        coverageByType: new Map(),
        analyzedAt: Date.now(),
      }
    }

    const roots: LineageNode[] = []
    const leaves: LineageNode[] = []
    const orphans: OrphanAsset[] = []
    let assetsWithUpstream = 0
    let assetsWithDownstream = 0
    let fullyConnected = 0

    const namespaceStats = new Map<string, { total: number; tracked: number }>()
    const typeStats = new Map<NodeType, number>()

    for (const node of allNodes) {
      const incoming = this.store.getIncomingEdges(node.id)
      const outgoing = this.store.getOutgoingEdges(node.id)

      const hasUpstream = incoming.length > 0
      const hasDownstream = outgoing.length > 0

      if (hasUpstream) assetsWithUpstream++
      if (hasDownstream) assetsWithDownstream++
      if (hasUpstream && hasDownstream) fullyConnected++

      if (!hasUpstream && !hasDownstream) {
        orphans.push({ node, reason: 'isolated' })
      } else if (!hasUpstream) {
        roots.push(node)
      } else if (!hasDownstream) {
        leaves.push(node)
      }

      // Track namespace coverage
      const ns = node.namespace ?? '_default_'
      if (!namespaceStats.has(ns)) {
        namespaceStats.set(ns, { total: 0, tracked: 0 })
      }
      const nsStat = namespaceStats.get(ns)!
      nsStat.total++
      if (hasUpstream || hasDownstream) {
        nsStat.tracked++
      }

      // Track type coverage
      const typeCount = typeStats.get(node.type) ?? 0
      if (hasUpstream || hasDownstream) {
        typeStats.set(node.type, typeCount + 1)
      } else {
        typeStats.set(node.type, typeCount)
      }
    }

    // Build namespace coverage map
    const coverageByNamespace = new Map<string, NamespaceCoverage>()
    for (const [ns, stats] of Array.from(namespaceStats.entries())) {
      coverageByNamespace.set(ns, {
        namespace: ns,
        totalAssets: stats.total,
        trackedAssets: stats.tracked,
        coveragePercentage: stats.total > 0 ? stats.tracked / stats.total : 0,
      })
    }

    // Calculate overall coverage (assets with at least one connection)
    const trackedAssets = assetsWithUpstream + assetsWithDownstream - fullyConnected
    const coveragePercentage = totalAssets > 0 ? (totalAssets - orphans.length) / totalAssets : 0

    return {
      totalAssets,
      assetsWithUpstream,
      assetsWithDownstream,
      fullyConnected,
      orphans,
      roots,
      leaves,
      coveragePercentage,
      coverageByNamespace,
      coverageByType: typeStats,
      analyzedAt: Date.now(),
    }
  }

  // ===========================================================================
  // CIRCULAR DEPENDENCY DETECTION
  // ===========================================================================

  /**
   * Detect circular dependencies in the lineage graph
   *
   * Uses Tarjan's algorithm to find strongly connected components,
   * which indicate cycles in the graph.
   *
   * @returns Array of circular dependencies found
   *
   * @example
   * ```typescript
   * const cycles = analyzer.detectCircularDependencies()
   * if (cycles.length > 0) {
   *   console.log(`Found ${cycles.length} circular dependencies`)
   * }
   * ```
   */
  detectCircularDependencies(): CircularDependency[] {
    const allNodes = this.store.findNodes()
    const cycles: CircularDependency[] = []

    // Track state for Tarjan's algorithm
    let index = 0
    const nodeIndex = new Map<string, number>()
    const nodeLowLink = new Map<string, number>()
    const onStack = new Set<string>()
    const stack: string[] = []

    const strongConnect = (nodeId: string): void => {
      nodeIndex.set(nodeId, index)
      nodeLowLink.set(nodeId, index)
      index++
      stack.push(nodeId)
      onStack.add(nodeId)

      const outgoing = this.store.getOutgoingEdges(nodeId)
      for (const edge of outgoing) {
        const targetId = edge.toNodeId
        if (!nodeIndex.has(targetId)) {
          strongConnect(targetId)
          nodeLowLink.set(nodeId, Math.min(nodeLowLink.get(nodeId)!, nodeLowLink.get(targetId)!))
        } else if (onStack.has(targetId)) {
          nodeLowLink.set(nodeId, Math.min(nodeLowLink.get(nodeId)!, nodeIndex.get(targetId)!))
        }
      }

      // If this is a root of a SCC
      if (nodeLowLink.get(nodeId) === nodeIndex.get(nodeId)) {
        const scc: string[] = []
        let w: string
        do {
          w = stack.pop()!
          onStack.delete(w)
          scc.push(w)
        } while (w !== nodeId)

        // Only report if SCC has more than one node (actual cycle)
        if (scc.length > 1) {
          const startNode = this.store.getNode(scc[0])
          if (startNode) {
            // Find edges that form the cycle
            const edgeIds: string[] = []
            for (let i = 0; i < scc.length; i++) {
              const fromId = scc[i]
              const toId = scc[(i + 1) % scc.length]
              const edges = this.store.findEdges({ fromNodeId: fromId, toNodeId: toId })
              if (edges.length > 0) {
                edgeIds.push(edges[0].id)
              }
            }

            cycles.push({
              nodeIds: scc,
              edgeIds,
              cycleLength: scc.length,
              startNode,
            })
          }
        }
      }
    }

    // Run Tarjan's algorithm on all unvisited nodes
    for (const node of allNodes) {
      if (!nodeIndex.has(node.id)) {
        strongConnect(node.id)
      }
    }

    return cycles
  }

  /**
   * Check if a specific node is part of a circular dependency
   */
  isInCycle(nodeId: string): boolean {
    const cycles = this.detectCircularDependencies()
    return cycles.some((cycle) => cycle.nodeIds.includes(nodeId))
  }

  // ===========================================================================
  // ORPHAN DETECTION
  // ===========================================================================

  /**
   * Find all orphan assets (assets with no lineage connections)
   *
   * @returns Array of orphan assets with reasons
   *
   * @example
   * ```typescript
   * const orphans = analyzer.findOrphans()
   * console.log(`Found ${orphans.length} orphan assets that need lineage`)
   * ```
   */
  findOrphans(): OrphanAsset[] {
    const allNodes = this.store.findNodes()
    const orphans: OrphanAsset[] = []

    for (const node of allNodes) {
      const incoming = this.store.getIncomingEdges(node.id)
      const outgoing = this.store.getOutgoingEdges(node.id)

      if (incoming.length === 0 && outgoing.length === 0) {
        orphans.push({ node, reason: 'isolated' })
      } else if (incoming.length === 0 && node.type !== 'source') {
        // Not a source but has no upstream - might be missing lineage
        orphans.push({ node, reason: 'no_upstream' })
      } else if (outgoing.length === 0 && node.type !== 'sink') {
        // Not a sink but has no downstream - might be missing lineage
        orphans.push({ node, reason: 'no_downstream' })
      }
    }

    return orphans
  }

  /**
   * Find isolated assets (completely disconnected)
   */
  findIsolatedAssets(): LineageNode[] {
    return this.findOrphans()
      .filter((o) => o.reason === 'isolated')
      .map((o) => o.node)
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private calculateSeverity(
    node: LineageNode,
    distance: number,
    direction: 'upstream' | 'downstream'
  ): ImpactSeverity {
    // Base severity on node type
    let baseSeverity: number
    switch (node.type) {
      case 'sink':
        baseSeverity = direction === 'downstream' ? 4 : 1 // Sinks are critical when downstream
        break
      case 'source':
        baseSeverity = direction === 'upstream' ? 4 : 1 // Sources are critical when upstream
        break
      case 'entity':
        baseSeverity = 3
        break
      case 'transformation':
        baseSeverity = 2
        break
      default:
        baseSeverity = 2
    }

    // Reduce severity for indirect impacts
    const distanceReduction = Math.min(distance - 1, 2)
    const adjustedSeverity = Math.max(0, baseSeverity - distanceReduction)

    // Map to severity levels
    if (adjustedSeverity >= 4) return 'critical'
    if (adjustedSeverity >= 3) return 'high'
    if (adjustedSeverity >= 2) return 'medium'
    if (adjustedSeverity >= 1) return 'low'
    return 'none'
  }

  private severityOrder(severity: ImpactSeverity): number {
    switch (severity) {
      case 'critical':
        return 0
      case 'high':
        return 1
      case 'medium':
        return 2
      case 'low':
        return 3
      case 'none':
        return 4
    }
  }

  private extractOwners(node: LineageNode): string[] {
    const owners: string[] = []
    const metadata = node.metadata as Record<string, unknown>

    if (typeof metadata.owner === 'string') owners.push(metadata.owner)
    if (typeof metadata.team === 'string') owners.push(metadata.team)
    if (Array.isArray(metadata.owners)) {
      owners.push(...metadata.owners.filter((o): o is string => typeof o === 'string'))
    }

    return [...new Set(owners)]
  }

  private getRecommendedAction(
    node: LineageNode,
    severity: ImpactSeverity,
    direction: 'upstream' | 'downstream'
  ): string {
    if (direction === 'downstream') {
      switch (severity) {
        case 'critical':
          return `Coordinate with ${node.type} owners before making changes`
        case 'high':
          return `Notify ${node.type} owners about upcoming changes`
        case 'medium':
          return `Verify ${node.type} compatibility after changes`
        case 'low':
          return `Monitor ${node.type} for any issues`
        default:
          return 'No action required'
      }
    } else {
      switch (severity) {
        case 'critical':
          return `Investigate ${node.type} as potential root cause`
        case 'high':
          return `Review ${node.type} data quality`
        case 'medium':
          return `Check ${node.type} for data issues`
        case 'low':
          return `Consider ${node.type} in debugging`
        default:
          return 'No action required'
      }
    }
  }

  private generateRecommendations(
    affectedAssets: ImpactedAsset[],
    direction: 'upstream' | 'downstream'
  ): string[] {
    const recommendations: string[] = []

    const criticalCount = affectedAssets.filter((a) => a.severity === 'critical').length
    const highCount = affectedAssets.filter((a) => a.severity === 'high').length

    if (direction === 'downstream') {
      if (criticalCount > 0) {
        recommendations.push(`${criticalCount} critical downstream asset(s) require coordination before changes`)
      }
      if (highCount > 0) {
        recommendations.push(`${highCount} high-impact downstream asset(s) should be notified`)
      }
      if (affectedAssets.length > 10) {
        recommendations.push('Consider a phased rollout due to large blast radius')
      }
    } else {
      if (criticalCount > 0) {
        recommendations.push(`${criticalCount} critical upstream source(s) should be investigated`)
      }
      if (highCount > 0) {
        recommendations.push(`${highCount} high-priority upstream asset(s) may contain data quality issues`)
      }
    }

    return recommendations
  }

  private findCriticalPathsUpstream(
    startId: string,
    affectedMap: Map<string, { distance: number; pathCount: number }>
  ): LineagePath[] {
    // Find all root nodes among affected (nodes with no further upstream in affected set)
    const roots: string[] = []
    for (const [nodeId] of Array.from(affectedMap.entries())) {
      const incoming = this.store.getIncomingEdges(nodeId)
      const upstreamInAffected = incoming.filter((e) => affectedMap.has(e.fromNodeId))
      if (upstreamInAffected.length === 0) {
        roots.push(nodeId)
      }
    }

    // Find paths from roots to start node
    const criticalPaths: LineagePath[] = []
    for (const rootId of roots) {
      const paths = this.findPathsTo(rootId, startId)
      criticalPaths.push(...paths)
    }

    // Sort by length (longest first)
    return criticalPaths.sort((a, b) => b.nodeIds.length - a.nodeIds.length)
  }

  private findCriticalPathsDownstream(
    startId: string,
    affectedMap: Map<string, { distance: number; pathCount: number }>
  ): LineagePath[] {
    // Find all leaf nodes among affected (nodes with no further downstream in affected set)
    const leaves: string[] = []
    for (const [nodeId] of Array.from(affectedMap.entries())) {
      const outgoing = this.store.getOutgoingEdges(nodeId)
      const downstreamInAffected = outgoing.filter((e) => affectedMap.has(e.toNodeId))
      if (downstreamInAffected.length === 0) {
        leaves.push(nodeId)
      }
    }

    // Find paths from start node to leaves
    const criticalPaths: LineagePath[] = []
    for (const leafId of leaves) {
      const paths = this.findPathsTo(startId, leafId)
      criticalPaths.push(...paths)
    }

    // Sort by length (longest first)
    return criticalPaths.sort((a, b) => b.nodeIds.length - a.nodeIds.length)
  }

  private findPathsTo(fromId: string, toId: string, maxDepth = 100): LineagePath[] {
    const paths: LineagePath[] = []
    const currentPath: string[] = [fromId]
    const currentEdges: string[] = []
    const visited = new Set<string>()

    this.dfsPath(fromId, toId, currentPath, currentEdges, visited, paths, 0, maxDepth)

    return paths
  }

  private dfsPath(
    current: string,
    target: string,
    currentPath: string[],
    currentEdges: string[],
    visited: Set<string>,
    paths: LineagePath[],
    depth: number,
    maxDepth: number
  ): void {
    if (depth > maxDepth) return

    if (current === target) {
      paths.push({
        nodeIds: [...currentPath],
        edgeIds: [...currentEdges],
      })
      return
    }

    visited.add(current)

    const outgoing = this.store.getOutgoingEdges(current)
    for (const edge of outgoing) {
      if (!visited.has(edge.toNodeId)) {
        currentPath.push(edge.toNodeId)
        currentEdges.push(edge.id)

        this.dfsPath(edge.toNodeId, target, currentPath, currentEdges, visited, paths, depth + 1, maxDepth)

        currentPath.pop()
        currentEdges.pop()
      }
    }

    visited.delete(current)
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create an ImpactAnalyzer instance
 */
export function createImpactAnalyzer(store: LineageStore): ImpactAnalyzer {
  return new ImpactAnalyzer(store)
}
