/**
 * Join Path Resolution - Intelligent multi-cube join handling
 *
 * Features:
 * - Build join graph from cube relationships
 * - Find shortest path between cubes for multi-cube queries
 * - Handle ambiguous join paths with explicit resolution
 * - Fan-out detection and handling (avoid incorrect aggregations)
 * - Symmetric aggregates for many-to-many joins
 * - Join pruning for unused dimensions
 *
 * @example
 * ```typescript
 * const resolver = new JoinPathResolver({ cubes })
 *
 * // Find join path between cubes
 * const path = resolver.findPath('Orders', 'Categories')
 * // Returns: Orders -> OrderItems -> Products -> Categories
 *
 * // Resolve paths for a multi-cube query
 * const resolved = resolver.resolveForQuery({
 *   primaryCube: 'Orders',
 *   requiredCubes: ['Customers', 'Categories'],
 *   measures: ['Orders.revenue'],
 *   dimensions: ['Customers.country', 'Categories.name'],
 * })
 *
 * // Analyze fan-out risk
 * const analysis = resolver.analyzeFanOut({
 *   primaryCube: 'Orders',
 *   measures: ['Orders.revenue'],
 *   dimensions: ['OrderItems.productId'],
 * })
 * ```
 *
 * @see dotdo-nksp0
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Join cardinality types
 */
export enum JoinCardinality {
  OneToOne = 'oneToOne',
  OneToMany = 'oneToMany',
  ManyToOne = 'manyToOne',
  ManyToMany = 'manyToMany',
}

/**
 * Edge in the join graph
 */
export interface JoinEdge {
  from: string
  to: string
  cardinality: JoinCardinality
  sql: string
  relationship: string
}

/**
 * A resolved join path between cubes
 */
export interface JoinPath {
  cubes: string[]
  edges: JoinEdge[]
  length: number
  isSelfReferential?: boolean
}

/**
 * Filter specification for queries
 */
export interface QueryFilter {
  cube: string
  dimension: string
  value: string | string[]
}

/**
 * Options for path finding
 */
export interface PathFindingOptions {
  via?: string[]
  preferVia?: string
  maxDepth?: number
}

/**
 * Resolved join information for a query
 */
export interface ResolvedJoinPath {
  paths: JoinPath[]
  joinOrder: JoinOrderEntry[]
  allCubes: string[]
  warnings: string[]
}

/**
 * Join order entry for SQL generation
 */
export interface JoinOrderEntry {
  from: string
  to: string
  sql: string
  type: 'LEFT' | 'INNER' | 'RIGHT'
  cardinality: JoinCardinality
}

/**
 * Fan-out analysis result
 */
export interface FanOutAnalysis {
  hasFanOut: boolean
  fanOutEdges: JoinEdge[]
  fanOutPath?: JoinPath
  mitigation?: {
    type: 'preAggregate' | 'subquery' | 'cte'
    suggestedCube?: string
    description: string
  }
}

/**
 * Symmetric aggregate result
 */
export interface SymmetricAggregate {
  sql: string
  usesDistinct: boolean
  warning?: string
}

/**
 * Join strategy analysis
 */
export interface JoinStrategyAnalysis {
  canUseSemiJoin: Record<string, boolean>
  suggestedJoinType: Record<string, 'LEFT' | 'INNER'>
}

/**
 * Join optimization result
 */
export interface JoinOptimization {
  passThrough: string[]
  required: string[]
}

/**
 * Graph configuration
 */
export interface JoinGraphConfig {
  cubes: Map<string, CubeDefinition>
  strictMode?: boolean
  strictFanOut?: boolean
}

/**
 * Cube definition interface
 */
export interface CubeDefinition {
  name: string
  sql: string
  measures: Record<string, MeasureDefinition>
  dimensions: Record<string, DimensionDefinition>
  joins?: Record<string, JoinDefinition>
}

export interface MeasureDefinition {
  type: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'countDistinct' | 'number'
  sql?: string
}

export interface DimensionDefinition {
  type: 'string' | 'number' | 'time' | 'boolean' | 'geo'
  sql: string
  primaryKey?: boolean
}

export interface JoinDefinition {
  relationship: 'belongsTo' | 'hasMany' | 'hasOne' | 'manyToMany'
  sql: string
}

/**
 * Query resolution options
 */
export interface QueryResolutionOptions {
  primaryCube: string
  requiredCubes: string[]
  measures?: string[]
  dimensions?: string[]
  filters?: QueryFilter[]
  pruneUnused?: boolean
  allowFanOut?: boolean
}

// =============================================================================
// ERROR CLASSES
// =============================================================================

/**
 * Error thrown when no join path exists between cubes
 */
export class NoJoinPathError extends Error {
  public readonly from: string
  public readonly to: string

  constructor(from: string, to: string) {
    super(`No join path found from '${from}' to '${to}'`)
    this.name = 'NoJoinPathError'
    this.from = from
    this.to = to
  }
}

/**
 * Error thrown when multiple ambiguous join paths exist
 */
export class AmbiguousJoinPathError extends Error {
  public readonly from: string
  public readonly to: string
  public readonly paths: JoinPath[]

  constructor(from: string, to: string, paths: JoinPath[]) {
    super(
      `Ambiguous join path from '${from}' to '${to}'. ` +
        `Found ${paths.length} possible paths. Use 'via' option to specify explicit path.`
    )
    this.name = 'AmbiguousJoinPathError'
    this.from = from
    this.to = to
    this.paths = paths
  }
}

/**
 * Error thrown when a fan-out condition is detected in strict mode
 */
export class FanOutError extends Error {
  public readonly analysis: FanOutAnalysis

  constructor(analysis: FanOutAnalysis) {
    super(
      `Fan-out detected: aggregating measures across one-to-many join may produce incorrect results. ` +
        `${analysis.mitigation?.description || 'Consider restructuring the query.'}`
    )
    this.name = 'FanOutError'
    this.analysis = analysis
  }
}

// =============================================================================
// JOIN GRAPH CLASS
// =============================================================================

/**
 * Graph representation of cube join relationships
 */
export class JoinGraph {
  private nodes: Set<string> = new Set()
  private edges: Map<string, JoinEdge[]> = new Map()
  private cubeDefinitions: Map<string, CubeDefinition> = new Map()

  /**
   * Add a cube to the graph, creating edges for its joins
   */
  addCube(cube: CubeDefinition): void {
    this.nodes.add(cube.name)
    this.cubeDefinitions.set(cube.name, cube)

    if (!this.edges.has(cube.name)) {
      this.edges.set(cube.name, [])
    }

    // Process joins defined in the cube
    if (cube.joins) {
      for (const [targetCube, joinDef] of Object.entries(cube.joins)) {
        const cardinality = this.relationshipToCardinality(joinDef.relationship)

        // Add forward edge
        const forwardEdge: JoinEdge = {
          from: cube.name,
          to: targetCube,
          cardinality,
          sql: joinDef.sql,
          relationship: joinDef.relationship,
        }
        this.edges.get(cube.name)!.push(forwardEdge)

        // Add reverse edge if target cube exists
        if (!this.edges.has(targetCube)) {
          this.edges.set(targetCube, [])
        }

        const inverseCardinality = this.invertCardinality(cardinality)
        const reverseEdge: JoinEdge = {
          from: targetCube,
          to: cube.name,
          cardinality: inverseCardinality,
          sql: this.invertJoinSQL(joinDef.sql, cube.name, targetCube),
          relationship: this.invertRelationship(joinDef.relationship),
        }

        // Only add if not already exists
        const existingEdges = this.edges.get(targetCube)!
        if (!existingEdges.some((e) => e.to === cube.name)) {
          existingEdges.push(reverseEdge)
        }
      }
    }
  }

  /**
   * Check if a cube exists in the graph
   */
  hasCube(name: string): boolean {
    return this.nodes.has(name)
  }

  /**
   * Check if an edge exists between two cubes
   */
  hasEdge(from: string, to: string): boolean {
    const edges = this.edges.get(from)
    return edges ? edges.some((e) => e.to === to) : false
  }

  /**
   * Get the edge between two cubes
   */
  getEdge(from: string, to: string): JoinEdge | undefined {
    const edges = this.edges.get(from)
    return edges?.find((e) => e.to === to)
  }

  /**
   * Get all edges from a cube
   */
  getEdgesFrom(cube: string): JoinEdge[] {
    return this.edges.get(cube) || []
  }

  /**
   * Get all cubes in the graph
   */
  getCubes(): string[] {
    return Array.from(this.nodes)
  }

  /**
   * Get all cubes directly connected to a given cube
   */
  getConnectedCubes(cube: string): string[] {
    const edges = this.edges.get(cube)
    return edges ? edges.map((e) => e.to) : []
  }

  /**
   * Check if the graph contains cycles
   */
  hasCycle(): boolean {
    const visited = new Set<string>()
    const recStack = new Set<string>()

    const dfs = (node: string): boolean => {
      visited.add(node)
      recStack.add(node)

      const edges = this.edges.get(node) || []
      for (const edge of edges) {
        if (!visited.has(edge.to)) {
          if (dfs(edge.to)) return true
        } else if (recStack.has(edge.to)) {
          return true
        }
      }

      recStack.delete(node)
      return false
    }

    for (const node of this.nodes) {
      if (!visited.has(node)) {
        if (dfs(node)) return true
      }
    }

    return false
  }

  /**
   * Get many-to-many path between cubes via junction table
   */
  getManyToManyPath(
    from: string,
    to: string
  ): { through: string; path: JoinPath } | undefined {
    // Look for a junction table pattern: from -> junction -> to
    const fromEdges = this.edges.get(from) || []

    for (const edge of fromEdges) {
      if (edge.cardinality === JoinCardinality.OneToMany) {
        const junctionEdges = this.edges.get(edge.to) || []
        const toEdge = junctionEdges.find(
          (e) => e.to === to && e.cardinality === JoinCardinality.ManyToOne
        )

        if (toEdge) {
          return {
            through: edge.to,
            path: {
              cubes: [from, edge.to, to],
              edges: [edge, toEdge],
              length: 2,
            },
          }
        }
      }
    }

    return undefined
  }

  /**
   * Export graph structure for debugging
   */
  toJSON(): { nodes: string[]; edges: JoinEdge[] } {
    const allEdges: JoinEdge[] = []
    this.edges.forEach((edges) => {
      allEdges.push(...edges)
    })

    return {
      nodes: Array.from(this.nodes),
      edges: allEdges,
    }
  }

  // Private helper methods

  private relationshipToCardinality(
    relationship: string
  ): JoinCardinality {
    switch (relationship) {
      case 'belongsTo':
        return JoinCardinality.ManyToOne
      case 'hasMany':
        return JoinCardinality.OneToMany
      case 'hasOne':
        return JoinCardinality.OneToOne
      case 'manyToMany':
        return JoinCardinality.ManyToMany
      default:
        return JoinCardinality.ManyToOne
    }
  }

  private invertCardinality(cardinality: JoinCardinality): JoinCardinality {
    switch (cardinality) {
      case JoinCardinality.OneToMany:
        return JoinCardinality.ManyToOne
      case JoinCardinality.ManyToOne:
        return JoinCardinality.OneToMany
      case JoinCardinality.OneToOne:
        return JoinCardinality.OneToOne
      case JoinCardinality.ManyToMany:
        return JoinCardinality.ManyToMany
      default:
        return cardinality
    }
  }

  private invertRelationship(relationship: string): string {
    switch (relationship) {
      case 'belongsTo':
        return 'hasMany'
      case 'hasMany':
        return 'belongsTo'
      case 'hasOne':
        return 'hasOne'
      case 'manyToMany':
        return 'manyToMany'
      default:
        return relationship
    }
  }

  private invertJoinSQL(sql: string, from: string, to: string): string {
    // SQL is symmetric, just return as is
    return sql
  }
}

// =============================================================================
// JOIN PATH RESOLVER CLASS
// =============================================================================

/**
 * Resolver for finding and optimizing join paths between cubes
 */
export class JoinPathResolver {
  private graph: JoinGraph
  private cubes: Map<string, CubeDefinition>
  private strictMode: boolean
  private strictFanOut: boolean

  constructor(config: JoinGraphConfig) {
    this.cubes = config.cubes
    this.strictMode = config.strictMode ?? false
    this.strictFanOut = config.strictFanOut ?? false

    // Build the graph from cube definitions
    this.graph = new JoinGraph()
    for (const cube of config.cubes.values()) {
      this.graph.addCube(cube)
    }
  }

  /**
   * Find the shortest join path between two cubes
   */
  findPath(
    from: string,
    to: string,
    options?: PathFindingOptions
  ): JoinPath {
    // Validate cubes exist
    if (!this.cubes.has(from)) {
      throw new Error(`Cube '${from}' not found`)
    }
    if (!this.cubes.has(to)) {
      throw new Error(`Cube '${to}' not found`)
    }

    // Identity path
    if (from === to) {
      return {
        cubes: [from],
        edges: [],
        length: 0,
      }
    }

    // Handle explicit path via option
    if (options?.via) {
      return this.findExplicitPath(from, to, options.via)
    }

    // Find all paths and pick the best one
    const allPaths = this.findAllPaths(from, to, options)

    if (allPaths.length === 0) {
      throw new NoJoinPathError(from, to)
    }

    // Handle ambiguity
    if (allPaths.length > 1 && this.strictMode) {
      // Check if paths have same length
      const shortestLength = Math.min(...allPaths.map((p) => p.length))
      const shortestPaths = allPaths.filter((p) => p.length === shortestLength)

      if (shortestPaths.length > 1) {
        throw new AmbiguousJoinPathError(from, to, shortestPaths)
      }
    }

    // If preferVia is specified, prefer that path
    if (options?.preferVia) {
      const preferredPath = allPaths.find((p) =>
        p.cubes.includes(options.preferVia!)
      )
      if (preferredPath) {
        return preferredPath
      }
    }

    // Return shortest path
    return allPaths.reduce((shortest, current) =>
      current.length < shortest.length ? current : shortest
    )
  }

  /**
   * Find all possible paths between two cubes
   */
  findAllPaths(
    from: string,
    to: string,
    options?: PathFindingOptions
  ): JoinPath[] {
    const maxDepth = options?.maxDepth ?? 10
    const paths: JoinPath[] = []
    const visited = new Set<string>()

    const dfs = (current: string, path: string[], edges: JoinEdge[]): void => {
      if (path.length > maxDepth) return

      if (current === to) {
        paths.push({
          cubes: [...path],
          edges: [...edges],
          length: edges.length,
          isSelfReferential: this.isSelfReferentialPath(edges),
        })
        return
      }

      visited.add(current)

      const outEdges = this.graph.getEdgesFrom(current)
      for (const edge of outEdges) {
        if (!visited.has(edge.to) || edge.to === to) {
          path.push(edge.to)
          edges.push(edge)
          dfs(edge.to, path, edges)
          path.pop()
          edges.pop()
        }
      }

      visited.delete(current)
    }

    dfs(from, [from], [])
    return paths
  }

  /**
   * Check if there are ambiguous paths between cubes
   */
  hasAmbiguousPaths(from: string, to: string): boolean {
    const paths = this.findAllPaths(from, to)
    if (paths.length <= 1) return false

    // Check if multiple paths have the same shortest length
    const shortestLength = Math.min(...paths.map((p) => p.length))
    const shortestPaths = paths.filter((p) => p.length === shortestLength)
    return shortestPaths.length > 1
  }

  /**
   * Resolve join paths for a multi-cube query
   */
  resolveForQuery(options: QueryResolutionOptions): ResolvedJoinPath {
    const {
      primaryCube,
      requiredCubes,
      measures = [],
      dimensions = [],
      filters = [],
      pruneUnused = false,
      allowFanOut = false,
    } = options

    const warnings: string[] = []
    const paths: JoinPath[] = []
    const allCubesSet = new Set<string>([primaryCube])

    // Deduplicate required cubes
    const uniqueRequired = [...new Set(requiredCubes)].filter(
      (c) => c !== primaryCube
    )

    // Find paths to each required cube
    for (const targetCube of uniqueRequired) {
      try {
        const path = this.findPath(primaryCube, targetCube)
        paths.push(path)
        path.cubes.forEach((c) => allCubesSet.add(c))
      } catch (error) {
        if (error instanceof NoJoinPathError) {
          warnings.push(`No path found to ${targetCube}`)
        } else {
          throw error
        }
      }
    }

    // Check for fan-out if measures and dimensions are provided
    if (measures.length > 0 && dimensions.length > 0) {
      const fanOutAnalysis = this.analyzeFanOut({
        primaryCube,
        measures,
        dimensions,
      })

      if (fanOutAnalysis.hasFanOut) {
        if (this.strictFanOut && !allowFanOut) {
          throw new FanOutError(fanOutAnalysis)
        }
        warnings.push('fan-out')
      }
    }

    // Build join order
    const joinOrder = this.buildJoinOrder(primaryCube, paths)

    // Prune if requested
    let finalCubes = Array.from(allCubesSet)
    if (pruneUnused) {
      const neededCubes = this.getNeededCubes(
        primaryCube,
        measures,
        dimensions,
        filters
      )
      finalCubes = finalCubes.filter(
        (c) => c === primaryCube || neededCubes.has(c)
      )
    }

    return {
      paths,
      joinOrder,
      allCubes: finalCubes,
      warnings,
    }
  }

  /**
   * Analyze fan-out risk for a query
   */
  analyzeFanOut(options: {
    primaryCube: string
    measures: string[]
    dimensions: string[]
  }): FanOutAnalysis {
    const { primaryCube, measures, dimensions } = options

    // Extract cube names from measures and dimensions
    const measureCubes = new Set(measures.map((m) => m.split('.')[0]))
    const dimensionCubes = new Set(dimensions.map((d) => d.split('.')[0]))

    const fanOutEdges: JoinEdge[] = []
    let fanOutPath: JoinPath | undefined

    // Check paths from measure cubes to dimension cubes
    for (const measureCube of measureCubes) {
      for (const dimensionCube of dimensionCubes) {
        if (measureCube === dimensionCube) continue

        try {
          const path = this.findPath(measureCube, dimensionCube)

          // Check for one-to-many edges in the path
          for (const edge of path.edges) {
            if (edge.cardinality === JoinCardinality.OneToMany) {
              if (!fanOutEdges.some((e) => e.from === edge.from && e.to === edge.to)) {
                fanOutEdges.push(edge)
              }
              if (!fanOutPath) {
                fanOutPath = path
              }
            }
          }
        } catch {
          // No path found, no fan-out risk from this pair
        }
      }
    }

    const hasFanOut = fanOutEdges.length > 0

    let mitigation: FanOutAnalysis['mitigation'] | undefined
    if (hasFanOut && fanOutEdges.length > 0) {
      const firstFanOut = fanOutEdges[0]
      if (fanOutEdges.length === 1) {
        mitigation = {
          type: 'preAggregate',
          suggestedCube: firstFanOut.to,
          description: `Pre-aggregate measures at ${firstFanOut.to} level before joining`,
        }
      } else {
        mitigation = {
          type: 'cte',
          description: 'Use CTEs or subqueries to aggregate at each level before joining',
        }
      }
    }

    return {
      hasFanOut,
      fanOutEdges,
      fanOutPath,
      mitigation,
    }
  }

  /**
   * Check if relationship is many-to-many
   */
  isManyToMany(from: string, to: string): boolean {
    const path = this.graph.getManyToManyPath(from, to)
    return path !== undefined
  }

  /**
   * Get the junction table for a many-to-many relationship
   */
  getJunctionTable(from: string, to: string): string | undefined {
    const path = this.graph.getManyToManyPath(from, to)
    return path?.through
  }

  /**
   * Generate symmetric aggregate SQL for many-to-many relationship
   */
  getSymmetricAggregate(options: {
    leftCube: string
    rightCube: string
    measure: string
    dimension: string
  }): SymmetricAggregate {
    const { leftCube, rightCube, measure, dimension } = options
    const measureParts = measure.split('.')
    const measureName = measureParts[1]

    const leftCubeDef = this.cubes.get(leftCube)
    const measureDef = leftCubeDef?.measures[measureName]

    // For count, use COUNT(DISTINCT)
    const usesDistinct = measureDef?.type === 'count'
    let sql: string
    let warning: string | undefined

    if (measureDef?.type === 'count') {
      sql = `COUNT(DISTINCT ${leftCube.toLowerCase()}.id)`
    } else if (measureDef?.type === 'avg') {
      sql = `AVG(${leftCube.toLowerCase()}.${measureDef.sql || measureName})`
      warning =
        'AVG across many-to-many may not give expected results due to symmetric aggregation'
    } else if (measureDef?.type === 'sum') {
      // Sum needs special handling to avoid double-counting
      const junctionTable = this.getJunctionTable(leftCube, rightCube)
      sql = `SUM(DISTINCT ${leftCube.toLowerCase()}.${measureDef.sql || measureName})`
      warning =
        'SUM across many-to-many uses DISTINCT which may not be what you want'
    } else {
      sql = `${measureDef?.type?.toUpperCase() || 'COUNT'}(${leftCube.toLowerCase()}.${measureDef?.sql || 'id'})`
    }

    return {
      sql,
      usesDistinct,
      warning,
    }
  }

  /**
   * Optimize joins by identifying pass-through cubes
   */
  optimizeJoins(options: {
    primaryCube: string
    paths: JoinPath[]
    selectedColumns: Record<string, string[]>
  }): JoinOptimization {
    const { primaryCube, paths, selectedColumns } = options

    const allCubes = new Set<string>([primaryCube])
    paths.forEach((p) => p.cubes.forEach((c) => allCubes.add(c)))

    const passThrough: string[] = []
    const required: string[] = [primaryCube]

    for (const cube of allCubes) {
      if (cube === primaryCube) continue

      const hasSelectedColumns =
        selectedColumns[cube] && selectedColumns[cube].length > 0
      if (hasSelectedColumns) {
        required.push(cube)
      } else {
        passThrough.push(cube)
      }
    }

    return { passThrough, required }
  }

  /**
   * Analyze join strategy for optimization
   */
  analyzeJoinStrategy(options: QueryResolutionOptions): JoinStrategyAnalysis {
    const { primaryCube, requiredCubes, dimensions = [], filters = [] } = options

    const canUseSemiJoin: Record<string, boolean> = {}
    const suggestedJoinType: Record<string, 'LEFT' | 'INNER'> = {}

    for (const cube of requiredCubes) {
      // Check if cube is only used for filtering
      const hasSelectedDimensions = dimensions.some((d) =>
        d.startsWith(`${cube}.`)
      )
      const hasFilters = filters.some((f) => f.cube === cube)

      if (hasFilters && !hasSelectedDimensions) {
        canUseSemiJoin[cube] = true
        suggestedJoinType[cube] = 'INNER'
      } else if (hasFilters) {
        canUseSemiJoin[cube] = false
        suggestedJoinType[cube] = 'INNER'
      } else {
        canUseSemiJoin[cube] = false
        suggestedJoinType[cube] = 'LEFT'
      }
    }

    return { canUseSemiJoin, suggestedJoinType }
  }

  // Private helper methods

  private findExplicitPath(
    from: string,
    to: string,
    via: string[]
  ): JoinPath {
    const fullPath = [from, ...via.filter((c) => c !== from && c !== to)]
    if (!fullPath.includes(to)) {
      fullPath.push(to)
    }

    const edges: JoinEdge[] = []
    for (let i = 0; i < fullPath.length - 1; i++) {
      const edge = this.graph.getEdge(fullPath[i], fullPath[i + 1])
      if (!edge) {
        throw new Error(
          `No direct join between '${fullPath[i]}' and '${fullPath[i + 1]}'`
        )
      }
      edges.push(edge)
    }

    return {
      cubes: fullPath,
      edges,
      length: edges.length,
    }
  }

  private buildJoinOrder(
    primaryCube: string,
    paths: JoinPath[]
  ): JoinOrderEntry[] {
    const joinOrder: JoinOrderEntry[] = []
    const joined = new Set<string>([primaryCube])

    // Merge all paths and order joins
    const allEdges: JoinEdge[] = []
    for (const path of paths) {
      allEdges.push(...path.edges)
    }

    // Sort edges to respect dependencies
    const sortedEdges = this.topologicalSortEdges(primaryCube, allEdges)

    for (const edge of sortedEdges) {
      if (joined.has(edge.to)) continue

      joined.add(edge.to)
      joinOrder.push({
        from: edge.from,
        to: edge.to,
        sql: edge.sql,
        type: 'LEFT',
        cardinality: edge.cardinality,
      })
    }

    return joinOrder
  }

  private topologicalSortEdges(
    start: string,
    edges: JoinEdge[]
  ): JoinEdge[] {
    const result: JoinEdge[] = []
    const visited = new Set<string>([start])
    const edgeMap = new Map<string, JoinEdge[]>()

    // Group edges by from node
    for (const edge of edges) {
      if (!edgeMap.has(edge.from)) {
        edgeMap.set(edge.from, [])
      }
      edgeMap.get(edge.from)!.push(edge)
    }

    // BFS to order edges
    const queue = [start]
    while (queue.length > 0) {
      const current = queue.shift()!
      const outEdges = edgeMap.get(current) || []

      for (const edge of outEdges) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to)
          result.push(edge)
          queue.push(edge.to)
        }
      }
    }

    return result
  }

  private getNeededCubes(
    primaryCube: string,
    measures: string[],
    dimensions: string[],
    filters: QueryFilter[]
  ): Set<string> {
    const needed = new Set<string>()

    // Add cubes from measures
    for (const m of measures) {
      needed.add(m.split('.')[0])
    }

    // Add cubes from dimensions
    for (const d of dimensions) {
      needed.add(d.split('.')[0])
    }

    // Add cubes from filters
    for (const f of filters) {
      needed.add(f.cube)
    }

    // For each needed cube, add intermediate cubes in the path
    for (const cube of Array.from(needed)) {
      if (cube === primaryCube) continue

      try {
        const path = this.findPath(primaryCube, cube)
        path.cubes.forEach((c) => needed.add(c))
      } catch {
        // Ignore unreachable cubes
      }
    }

    return needed
  }

  private isSelfReferentialPath(edges: JoinEdge[]): boolean {
    for (const edge of edges) {
      // Check if this is a self-join (e.g., Categories -> ParentCategory)
      if (
        edge.to.includes('Parent') ||
        edge.to.includes('Child') ||
        edge.from === edge.to
      ) {
        return true
      }
    }
    return false
  }
}
