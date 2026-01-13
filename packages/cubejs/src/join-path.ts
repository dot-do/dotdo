/**
 * @dotdo/cubejs - Join Path Resolution
 *
 * Provides intelligent join path resolution for multi-cube queries:
 * - Build join graph from cube relationships
 * - Find shortest path between cubes (BFS)
 * - Handle ambiguous join paths with explicit resolution
 * - Fan-out detection and handling
 * - Symmetric aggregates for many-to-many joins
 * - Join pruning for unused dimensions
 *
 * @example
 * ```typescript
 * import { JoinGraph } from '@dotdo/cubejs'
 *
 * const graph = new JoinGraph(schemas)
 *
 * // Find shortest path
 * const path = graph.findShortestPath('Orders', 'Categories')
 * // Returns: { cubes: ['Orders', 'Products', 'Categories'], edges: [...] }
 *
 * // Detect fan-out
 * const fanOut = graph.detectFanOut('Customers', 'Orders')
 * // Returns warning about 1:N relationship
 *
 * // Resolve query joins
 * const resolution = graph.resolveQueryJoins({
 *   measures: ['Orders.revenue'],
 *   dimensions: ['Categories.name'],
 * })
 * ```
 */

import type { CubeSchema, JoinRelationship, Join } from './schema'

// =============================================================================
// Types
// =============================================================================

/**
 * Represents an edge (join) in the join graph
 */
export interface JoinEdge {
  /** Source cube name */
  from: string
  /** Target cube name */
  to: string
  /** Relationship type (belongsTo, hasMany, hasOne) */
  relationship: JoinRelationship
  /** SQL join condition */
  sql: string
}

/**
 * Represents a path through the join graph
 */
export interface JoinPath {
  /** Ordered list of cubes in the path */
  cubes: string[]
  /** Edges traversed in the path */
  edges: JoinEdge[]
}

/**
 * Warning about fan-out in joins
 */
export interface FanOutWarning {
  /** Type of fan-out */
  type: 'one-to-many' | 'many-to-many'
  /** Source cube */
  fromCube: string
  /** Target cube */
  toCube: string
  /** Human-readable warning message */
  warning: string
}

/**
 * Error for ambiguous join paths
 */
export interface AmbiguousPathError {
  /** Human-readable error message */
  message: string
  /** All possible paths of equal length */
  paths: JoinPath[]
}

/**
 * Aggregation recommendation for fan-out scenarios
 */
export interface AggregationRecommendation {
  /** Whether symmetric aggregate is needed */
  useSymmetricAggregate: boolean
  /** Which cube to aggregate on */
  aggregateOn: string
  /** Explanation of why */
  reason: string
}

/**
 * Query resolution result
 */
export interface QueryJoinResolution {
  /** Primary join path */
  path: JoinPath
  /** All required cubes */
  requiredCubes: Set<string>
  /** Warnings about the query */
  warnings: QueryWarning[]
}

/**
 * Warning about a query
 */
export interface QueryWarning {
  type: 'fan-out' | 'ambiguous-path' | 'missing-cube'
  message: string
  details?: unknown
}

/**
 * Options for path finding
 */
export interface PathFindingOptions {
  /** Maximum path length to consider */
  maxLength?: number
}

/**
 * Simple query structure for resolution
 */
export interface SimpleQuery {
  measures?: string[]
  dimensions?: string[]
  segments?: string[]
}

// =============================================================================
// JoinGraph Class
// =============================================================================

/**
 * Graph representation of cube relationships for join path resolution
 */
export class JoinGraph {
  private schemas: Map<string, CubeSchema>
  private adjacencyList: Map<string, JoinEdge[]>

  /**
   * Create a new JoinGraph from cube schemas
   */
  constructor(schemas: Map<string, CubeSchema>) {
    this.schemas = schemas
    this.adjacencyList = new Map()
    this.buildGraph()
  }

  /**
   * Build the adjacency list from cube schemas
   */
  private buildGraph(): void {
    // Initialize adjacency list for all cubes
    for (const name of Array.from(this.schemas.keys())) {
      this.adjacencyList.set(name, [])
    }

    // Add edges from each cube's joins
    for (const [cubeName, schema] of Array.from(this.schemas.entries())) {
      if (!schema.joins) continue

      for (const [targetCube, join] of Object.entries(schema.joins) as [string, Join][]) {
        // Skip if target cube doesn't exist in schemas
        if (!this.schemas.has(targetCube)) continue

        const edge: JoinEdge = {
          from: cubeName,
          to: targetCube,
          relationship: join.relationship,
          sql: join.sql,
        }

        this.adjacencyList.get(cubeName)!.push(edge)
      }
    }
  }

  /**
   * Get all cube names in the graph
   */
  getCubes(): string[] {
    return Array.from(this.schemas.keys())
  }

  /**
   * Get all edges (joins) from a cube
   */
  getEdges(cubeName: string): JoinEdge[] {
    return this.adjacencyList.get(cubeName) || []
  }

  // ===========================================================================
  // Shortest Path Finding (BFS)
  // ===========================================================================

  /**
   * Find the shortest path between two cubes using BFS
   */
  findShortestPath(from: string, to: string): JoinPath | undefined {
    // Same cube - return trivial path
    if (from === to) {
      return { cubes: [from], edges: [] }
    }

    // Check if both cubes exist
    if (!this.schemas.has(from) || !this.schemas.has(to)) {
      return undefined
    }

    // BFS for shortest path
    const visited = new Set<string>([from])
    const queue: Array<{ cube: string; path: JoinPath }> = [
      { cube: from, path: { cubes: [from], edges: [] } },
    ]

    while (queue.length > 0) {
      const { cube, path } = queue.shift()!

      const edges = this.getEdges(cube)
      for (const edge of edges) {
        if (visited.has(edge.to)) continue

        const newPath: JoinPath = {
          cubes: [...path.cubes, edge.to],
          edges: [...path.edges, edge],
        }

        if (edge.to === to) {
          return newPath
        }

        visited.add(edge.to)
        queue.push({ cube: edge.to, path: newPath })
      }
    }

    return undefined
  }

  /**
   * Find all paths between two cubes up to a maximum length
   */
  findAllPaths(
    from: string,
    to: string,
    options: PathFindingOptions = {}
  ): JoinPath[] {
    const maxLength = options.maxLength ?? 10

    if (!this.schemas.has(from) || !this.schemas.has(to)) {
      return []
    }

    const paths: JoinPath[] = []

    const dfs = (
      current: string,
      visited: Set<string>,
      path: JoinPath
    ): void => {
      if (path.edges.length > maxLength) return

      if (current === to) {
        paths.push({ ...path })
        return
      }

      const edges = this.getEdges(current)
      for (const edge of edges) {
        if (visited.has(edge.to)) continue

        visited.add(edge.to)
        path.cubes.push(edge.to)
        path.edges.push(edge)

        dfs(edge.to, visited, path)

        path.cubes.pop()
        path.edges.pop()
        visited.delete(edge.to)
      }
    }

    const visited = new Set<string>([from])
    dfs(from, visited, { cubes: [from], edges: [] })

    return paths
  }

  /**
   * Find a path that goes through specific cubes
   */
  findPathThrough(
    from: string,
    to: string,
    through: string[]
  ): JoinPath | undefined {
    if (through.length === 0) {
      return this.findShortestPath(from, to)
    }

    const waypoints = [from, ...through, to]
    const fullPath: JoinPath = { cubes: [from], edges: [] }

    for (let i = 0; i < waypoints.length - 1; i++) {
      const segment = this.findShortestPath(waypoints[i], waypoints[i + 1])
      if (!segment) return undefined

      // Skip first cube of segment (already in path) except for first segment
      const startIndex = i === 0 ? 1 : 1
      fullPath.cubes.push(...segment.cubes.slice(startIndex))
      fullPath.edges.push(...segment.edges)
    }

    return fullPath
  }

  // ===========================================================================
  // Ambiguous Path Detection
  // ===========================================================================

  /**
   * Detect if there are multiple shortest paths between two cubes
   */
  detectAmbiguity(from: string, to: string): AmbiguousPathError | undefined {
    const allPaths = this.findAllPaths(from, to)

    if (allPaths.length <= 1) {
      return undefined
    }

    // Find minimum path length
    const minLength = Math.min(...allPaths.map((p) => p.edges.length))

    // Filter to shortest paths only
    const shortestPaths = allPaths.filter((p) => p.edges.length === minLength)

    if (shortestPaths.length <= 1) {
      return undefined
    }

    return {
      message: `Ambiguous join path from ${from} to ${to}. Found ${shortestPaths.length} paths of equal length (${minLength} hops). Please specify the path explicitly.`,
      paths: shortestPaths,
    }
  }

  // ===========================================================================
  // Fan-out Detection
  // ===========================================================================

  /**
   * Detect fan-out when joining from one cube to another
   */
  detectFanOut(from: string, to: string): FanOutWarning | undefined {
    const edges = this.getEdges(from)
    const directEdge = edges.find((e) => e.to === to)

    if (!directEdge) {
      // Check reverse relationship
      const reverseEdges = this.getEdges(to)
      const reverseEdge = reverseEdges.find((e) => e.to === from)

      if (reverseEdge) {
        // If the reverse is belongsTo, then from->to is hasMany (fan-out)
        if (reverseEdge.relationship === 'belongsTo') {
          return {
            type: 'one-to-many',
            fromCube: from,
            toCube: to,
            warning: `Joining ${from} to ${to} creates a fan-out (one-to-many). This may cause incorrect aggregations if measures from ${from} are summed.`,
          }
        }
      }
      return undefined
    }

    // Check relationship type
    if (directEdge.relationship === 'hasMany') {
      return {
        type: 'one-to-many',
        fromCube: from,
        toCube: to,
        warning: `Joining ${from} to ${to} creates a fan-out (one-to-many). This may cause incorrect aggregations if measures from ${from} are summed.`,
      }
    }

    return undefined
  }

  /**
   * Detect all fan-outs in a path
   */
  detectFanOutsInPath(cubes: string[]): FanOutWarning[] {
    const warnings: FanOutWarning[] = []

    for (let i = 0; i < cubes.length - 1; i++) {
      const fanOut = this.detectFanOut(cubes[i], cubes[i + 1])
      if (fanOut) {
        warnings.push(fanOut)
      }
    }

    return warnings
  }

  /**
   * Get recommendation for how to handle aggregations with fan-out
   */
  getAggregationRecommendation(
    from: string,
    to: string
  ): AggregationRecommendation | undefined {
    const fanOut = this.detectFanOut(from, to)
    if (!fanOut) return undefined

    return {
      useSymmetricAggregate: true,
      aggregateOn: to,
      reason: `Due to ${fanOut.type} relationship, measures should be aggregated on ${to} first to avoid duplication.`,
    }
  }

  // ===========================================================================
  // Symmetric Aggregate Detection
  // ===========================================================================

  /**
   * Check if a symmetric aggregate is needed between two cubes
   */
  needsSymmetricAggregate(from: string, to: string): boolean {
    const path = this.findShortestPath(from, to)
    if (!path) return false

    // Check if path goes through any many-to-many junction
    for (const edge of path.edges) {
      // If we traverse a hasMany, symmetric aggregate may be needed
      if (edge.relationship === 'hasMany') {
        // Check if the target also has a hasMany back (indicating M:N)
        const reverseEdges = this.getEdges(edge.to)
        for (const reverseEdge of reverseEdges) {
          if (reverseEdge.relationship === 'hasMany') {
            return true
          }
          if (reverseEdge.relationship === 'belongsTo') {
            // This is a junction table pattern
            // Check if there's another belongsTo creating M:N
            const junctionEdges = this.getEdges(edge.to)
            const belongsToCount = junctionEdges.filter(
              (e) => e.relationship === 'belongsTo'
            ).length
            if (belongsToCount >= 2) {
              return true
            }
          }
        }
      }
    }

    // Also check for direct M:N pattern
    const fanOuts = this.detectFanOutsInPath(path.cubes)
    return fanOuts.some((f) => f.type === 'many-to-many')
  }

  /**
   * Get the cardinality multiplier for a join
   */
  getCardinalityMultiplier(from: string, to: string): '1' | 'N' {
    const path = this.findShortestPath(from, to)
    if (!path) return '1'

    // Check if any edge in path causes multiplication
    for (const edge of path.edges) {
      if (edge.relationship === 'hasMany') {
        return 'N'
      }
    }

    // Also check for implicit hasMany via reverse relationships
    for (let i = 0; i < path.cubes.length - 1; i++) {
      const fanOut = this.detectFanOut(path.cubes[i], path.cubes[i + 1])
      if (fanOut) {
        return 'N'
      }
    }

    return '1'
  }

  // ===========================================================================
  // Join Pruning
  // ===========================================================================

  /**
   * Get the minimal set of cubes needed for a query
   */
  getRequiredJoins(usedCubes: Set<string>): Set<string> {
    if (usedCubes.size <= 1) {
      return new Set(usedCubes)
    }

    const cubeArray = Array.from(usedCubes)
    const required = new Set<string>()

    // Add all used cubes
    for (const cube of cubeArray) {
      required.add(cube)
    }

    // Add cubes needed to connect them
    // For each pair of cubes, find path and add intermediate cubes
    for (let i = 0; i < cubeArray.length; i++) {
      for (let j = i + 1; j < cubeArray.length; j++) {
        const path = this.findShortestPath(cubeArray[i], cubeArray[j])
        if (path) {
          for (const cube of path.cubes) {
            required.add(cube)
          }
        }
      }
    }

    return required
  }

  /**
   * Get optimized join order starting from a primary cube
   */
  getOptimizedJoinOrder(usedCubes: Set<string>, primaryCube: string): string[] {
    const required = this.getRequiredJoins(usedCubes)

    if (!required.has(primaryCube)) {
      required.add(primaryCube)
    }

    // BFS from primary cube to get join order
    const order: string[] = [primaryCube]
    const visited = new Set<string>([primaryCube])
    const queue = [primaryCube]

    while (queue.length > 0) {
      const current = queue.shift()!
      const edges = this.getEdges(current)

      // Sort edges: prefer belongsTo over hasMany (smaller tables first)
      const sortedEdges = [...edges].sort((a, b) => {
        if (a.relationship === 'belongsTo' && b.relationship !== 'belongsTo')
          return -1
        if (b.relationship === 'belongsTo' && a.relationship !== 'belongsTo')
          return 1
        return 0
      })

      for (const edge of sortedEdges) {
        if (visited.has(edge.to)) continue
        if (!required.has(edge.to)) continue

        visited.add(edge.to)
        order.push(edge.to)
        queue.push(edge.to)
      }
    }

    return order
  }

  // ===========================================================================
  // Query Resolution
  // ===========================================================================

  /**
   * Resolve all joins needed for a query
   */
  resolveQueryJoins(query: SimpleQuery): QueryJoinResolution {
    const warnings: QueryWarning[] = []

    // Extract all cubes referenced in the query
    const referencedCubes = this.extractQueryCubes(query)

    if (referencedCubes.size === 0) {
      return {
        path: { cubes: [], edges: [] },
        requiredCubes: new Set(),
        warnings: [],
      }
    }

    // Get primary cube (first measure's cube, or first dimension's cube)
    const primaryCube = this.getPrimaryCube(query)

    // Get all required cubes including intermediates
    const requiredCubes = this.getRequiredJoins(referencedCubes)

    // Build the complete path
    const path = this.buildCompletePath(primaryCube, requiredCubes)

    // Check for fan-outs
    const fanOuts = this.detectFanOutsInPath(path.cubes)
    for (const fanOut of fanOuts) {
      warnings.push({
        type: 'fan-out',
        message: fanOut.warning,
        details: fanOut,
      })
    }

    // Check for ambiguity
    for (const cube of Array.from(referencedCubes)) {
      if (cube === primaryCube) continue
      const ambiguity = this.detectAmbiguity(primaryCube, cube)
      if (ambiguity) {
        warnings.push({
          type: 'ambiguous-path',
          message: ambiguity.message,
          details: ambiguity,
        })
      }
    }

    return {
      path,
      requiredCubes,
      warnings,
    }
  }

  /**
   * Extract all cube names from a query
   */
  private extractQueryCubes(query: SimpleQuery): Set<string> {
    const cubes = new Set<string>()

    const extractCube = (member: string) => {
      const [cube] = member.split('.')
      if (cube && this.schemas.has(cube)) {
        cubes.add(cube)
      }
    }

    query.measures?.forEach(extractCube)
    query.dimensions?.forEach(extractCube)
    query.segments?.forEach(extractCube)

    return cubes
  }

  /**
   * Get the primary cube for a query (usually the measure's cube)
   */
  private getPrimaryCube(query: SimpleQuery): string {
    if (query.measures && query.measures.length > 0) {
      const [cube] = query.measures[0].split('.')
      return cube
    }
    if (query.dimensions && query.dimensions.length > 0) {
      const [cube] = query.dimensions[0].split('.')
      return cube
    }
    return ''
  }

  /**
   * Build a complete path visiting all required cubes
   */
  private buildCompletePath(
    primaryCube: string,
    requiredCubes: Set<string>
  ): JoinPath {
    if (requiredCubes.size === 0) {
      return { cubes: [], edges: [] }
    }

    if (requiredCubes.size === 1) {
      return { cubes: [primaryCube], edges: [] }
    }

    // Use optimized join order
    const order = this.getOptimizedJoinOrder(requiredCubes, primaryCube)

    // Build path following the order
    const path: JoinPath = { cubes: [primaryCube], edges: [] }
    const visited = new Set<string>([primaryCube])

    for (const cube of order.slice(1)) {
      if (visited.has(cube)) continue

      // Find how to connect to this cube from current path
      let connected = false
      for (const existingCube of Array.from(visited)) {
        const segment = this.findShortestPath(existingCube, cube)
        if (segment && segment.edges.length > 0) {
          // Add new cubes from segment
          for (let i = 1; i < segment.cubes.length; i++) {
            if (!visited.has(segment.cubes[i])) {
              path.cubes.push(segment.cubes[i])
              path.edges.push(segment.edges[i - 1])
              visited.add(segment.cubes[i])
            }
          }
          connected = true
          break
        }
      }

      if (!connected) {
        // Could not connect this cube
        visited.add(cube)
      }
    }

    return path
  }
}
