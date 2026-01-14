/**
 * SPIKE: Magic $ Graph SDK
 *
 * Ultra-simple graph traversal SDK where relationship types become properties
 *
 * Key Design:
 * - `user.$.follows` - traverse outgoing 'follows' edges
 * - `user.$.follows.in` - traverse incoming 'follows' edges
 * - `user.$.follows.follows` - chain traversals (friends of friends)
 * - `user.$.pathTo(target)` - shortest path finding
 * - `user.$.follows.intersect(other.$.follows)` - set operations
 */

import {
  AdjacencyIndex,
  GraphTraversalEngine,
  Thing,
  Relationship,
  GraphPath,
  Direction
} from './graph-query-engine'

// ============================================================================
// Types - SDK Schema
// ============================================================================

/**
 * Define your graph schema for full type safety
 *
 * @example
 * interface MyGraph extends GraphSchema {
 *   User: { follows: 'User', likes: 'Post' }
 *   Post: { author: 'User', comments: 'Comment' }
 * }
 */
export interface GraphSchema {
  [nodeType: string]: {
    [relType: string]: string  // relationship type -> target node type
  }
}

export interface TraversalOptions {
  /** Filter nodes by predicate */
  where?: Record<string, unknown> | ((node: Thing) => boolean)
  /** Limit results */
  limit?: number
  /** Skip results */
  skip?: number
  /** Sort by field */
  sort?: Record<string, 1 | -1>
  /** Traversal depth range */
  depth?: { min?: number; max?: number } | number
}

export interface PathOptions {
  /** Maximum depth to search */
  maxDepth?: number
  /** Return all paths (up to limit) */
  all?: boolean
  /** Edge types to traverse */
  edgeTypes?: string[]
}

// ============================================================================
// Traversal Builder - The fluent chain
// ============================================================================

export class Traversal<T extends Thing = Thing> {
  private engine: GraphTraversalEngine
  private index: AdjacencyIndex
  private steps: TraversalStep[] = []
  private startIds: string[]
  private _direction: Direction = 'out'
  private thingResolver?: (ids: string[]) => Promise<T[]>

  constructor(
    engine: GraphTraversalEngine,
    index: AdjacencyIndex,
    startIds: string[],
    thingResolver?: (ids: string[]) => Promise<T[]>
  ) {
    this.engine = engine
    this.index = index
    this.startIds = startIds
    this.thingResolver = thingResolver
  }

  /** Add a traversal step for a relationship type */
  private addStep(relType: string, direction: Direction, options?: TraversalOptions): Traversal<T> {
    const clone = this.clone()
    clone.steps.push({
      relType,
      direction,
      options: options ?? {},
    })
    return clone
  }

  private clone(): Traversal<T> {
    const t = new Traversal<T>(this.engine, this.index, this.startIds, this.thingResolver)
    t.steps = [...this.steps]
    t._direction = this._direction
    return t
  }

  /**
   * Traverse outgoing edges of given type
   * @example user.$.out('follows')
   */
  out(relType: string, options?: TraversalOptions): Traversal<T> {
    return this.addStep(relType, 'out', options)
  }

  /**
   * Traverse incoming edges of given type
   * @example user.$.in('follows') // followers
   */
  in(relType: string, options?: TraversalOptions): Traversal<T> {
    return this.addStep(relType, 'in', options)
  }

  /**
   * Traverse edges in both directions
   * @example user.$.both('knows')
   */
  both(relType: string, options?: TraversalOptions): Traversal<T> {
    return this.addStep(relType, 'both', options)
  }

  /**
   * Filter nodes at current position
   * @example user.$.follows.where({ verified: true })
   */
  where(predicate: Record<string, unknown> | ((node: Thing) => boolean)): Traversal<T> {
    const clone = this.clone()
    if (clone.steps.length > 0) {
      const lastStep = clone.steps[clone.steps.length - 1]
      lastStep.options.where = predicate
    }
    return clone
  }

  /**
   * Alias for where()
   */
  filter(predicate: Record<string, unknown> | ((node: Thing) => boolean)): Traversal<T> {
    return this.where(predicate)
  }

  /**
   * Limit number of results
   * @example user.$.follows.limit(10)
   */
  limit(n: number): Traversal<T> {
    const clone = this.clone()
    if (clone.steps.length > 0) {
      clone.steps[clone.steps.length - 1].options.limit = n
    }
    return clone
  }

  /**
   * Skip results (for pagination)
   * @example user.$.follows.skip(20).limit(10)
   */
  skip(n: number): Traversal<T> {
    const clone = this.clone()
    if (clone.steps.length > 0) {
      clone.steps[clone.steps.length - 1].options.skip = n
    }
    return clone
  }

  /**
   * Set traversal depth
   * @example user.$.follows.depth(2) // exactly 2 hops
   * @example user.$.follows.depth({ min: 1, max: 3 }) // 1-3 hops
   */
  depth(d: number | { min?: number; max?: number }): Traversal<T> {
    const clone = this.clone()
    if (clone.steps.length > 0) {
      clone.steps[clone.steps.length - 1].options.depth = d
    }
    return clone
  }

  /**
   * Remove duplicate nodes
   */
  unique(): Traversal<T> {
    const clone = this.clone()
    clone.steps.push({ type: 'unique' } as any)
    return clone
  }

  // =========================================================================
  // Set Operations
  // =========================================================================

  /**
   * Intersection with another traversal (mutual friends, etc.)
   * @example user.$.follows.intersect(other.$.follows)
   */
  intersect(other: Traversal<T>): Traversal<T> {
    const clone = this.clone()
    clone.steps.push({
      type: 'intersect',
      other,
    } as any)
    return clone
  }

  /**
   * Union with another traversal
   * @example user.$.follows.union(other.$.follows)
   */
  union(other: Traversal<T>): Traversal<T> {
    const clone = this.clone()
    clone.steps.push({
      type: 'union',
      other,
    } as any)
    return clone
  }

  /**
   * Exclude nodes from another traversal
   * @example user.$.follows.follows.except(user.$.follows) // fof not already friends
   */
  except(other: Traversal<T>): Traversal<T> {
    const clone = this.clone()
    clone.steps.push({
      type: 'except',
      other,
    } as any)
    return clone
  }

  // =========================================================================
  // Path Finding
  // =========================================================================

  /**
   * Find shortest path to target
   * @example user.$.pathTo('user-456')
   */
  async pathTo(targetId: string, options?: PathOptions): Promise<GraphPath | null> {
    const startId = this.startIds[0]
    if (!startId) return null

    return this.engine.shortestPath(
      startId,
      targetId,
      options?.maxDepth ?? 10,
      options?.edgeTypes
    )
  }

  /**
   * Find all paths to target
   * @example user.$.allPathsTo('user-456', { maxDepth: 4 })
   */
  async allPathsTo(targetId: string, options?: PathOptions): Promise<GraphPath[]> {
    const startId = this.startIds[0]
    if (!startId) return []

    return this.engine.allPaths(
      startId,
      targetId,
      options?.maxDepth ?? 5,
      100,
      options?.edgeTypes
    )
  }

  /**
   * Check if path exists to target
   * @example user.$.connected('user-456')
   */
  async connected(targetId: string, options?: PathOptions): Promise<boolean> {
    const startId = this.startIds[0]
    if (!startId) return false

    return this.engine.pathExists(
      startId,
      targetId,
      options?.maxDepth ?? 6,
      options?.edgeTypes
    )
  }

  // =========================================================================
  // Execution - Materialize results
  // =========================================================================

  /**
   * Execute traversal and return node IDs
   */
  async ids(): Promise<string[]> {
    let currentIds = new Set(this.startIds)

    for (const step of this.steps) {
      if ('type' in step) {
        // Set operations
        if (step.type === 'unique') {
          // Already a Set, no-op
          continue
        }
        if (step.type === 'intersect') {
          const otherIds = new Set(await (step as any).other.ids())
          currentIds = new Set([...currentIds].filter(id => otherIds.has(id)))
          continue
        }
        if (step.type === 'union') {
          const otherIds = await (step as any).other.ids()
          for (const id of otherIds) currentIds.add(id)
          continue
        }
        if (step.type === 'except') {
          const otherIds = new Set(await (step as any).other.ids())
          currentIds = new Set([...currentIds].filter(id => !otherIds.has(id)))
          continue
        }
        continue
      }

      const nextIds = new Set<string>()
      const { relType, direction, options } = step
      const minHops = typeof options.depth === 'number' ? options.depth : options.depth?.min ?? 1
      const maxHops = typeof options.depth === 'number' ? options.depth : options.depth?.max ?? 1

      for (const id of currentIds) {
        const result = this.engine.bfs([id], {
          direction,
          edgeTypes: relType ? [relType] : undefined,
          minHops,
          maxHops,
          limit: options.limit,
        })

        for (const vertexId of result.vertices) {
          nextIds.add(vertexId)
        }
      }

      currentIds = nextIds

      // Apply skip if specified
      if (options.skip) {
        const arr = [...currentIds]
        currentIds = new Set(arr.slice(options.skip))
      }
    }

    return [...currentIds]
  }

  /**
   * Execute traversal and return full Thing objects
   */
  async nodes(): Promise<T[]> {
    const ids = await this.ids()
    if (this.thingResolver) {
      return this.thingResolver(ids)
    }
    // Return stub objects if no resolver
    return ids.map(id => ({ id, type: 'Unknown', ns: '', data: {}, createdAt: 0, updatedAt: 0 } as T))
  }

  /**
   * Alias for nodes()
   */
  async toArray(): Promise<T[]> {
    return this.nodes()
  }

  /**
   * Count results without materializing (index-only when possible)
   */
  async count(): Promise<number> {
    const ids = await this.ids()
    return ids.length
  }

  /**
   * Check if any results exist
   */
  async exists(): Promise<boolean> {
    const ids = await this.ids()
    return ids.length > 0
  }

  /**
   * Get first result
   */
  async first(): Promise<T | null> {
    const nodes = await this.limit(1).nodes()
    return nodes[0] ?? null
  }

  /**
   * Async iterator support
   */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    const nodes = await this.nodes()
    for (const node of nodes) {
      yield node
    }
  }
}

interface TraversalStep {
  relType: string
  direction: Direction
  options: TraversalOptions
}

// ============================================================================
// Magic $ Proxy - Relationship types become properties
// ============================================================================

export type MagicTraversal<T extends Thing = Thing> = Traversal<T> & {
  /** Reverse direction - get incoming edges */
  in: MagicTraversal<T>
  /** Access any relationship type as a property */
  [relType: string]: MagicTraversal<T>
}

/**
 * Create a magic proxy that turns relationship types into properties
 */
export function createMagicTraversal<T extends Thing = Thing>(
  engine: GraphTraversalEngine,
  index: AdjacencyIndex,
  startIds: string[],
  thingResolver?: (ids: string[]) => Promise<T[]>,
  pendingRelType?: string,
  pendingDirection?: Direction
): MagicTraversal<T> {
  const traversal = new Traversal<T>(engine, index, startIds, thingResolver)

  // If we have a pending relationship, add it as a step
  if (pendingRelType) {
    const withStep = traversal.out(pendingRelType)
    if (pendingDirection === 'in') {
      return createMagicProxy(traversal.in(pendingRelType), engine, index, thingResolver)
    }
    return createMagicProxy(withStep, engine, index, thingResolver)
  }

  return createMagicProxy(traversal, engine, index, thingResolver)
}

function createMagicProxy<T extends Thing>(
  traversal: Traversal<T>,
  engine: GraphTraversalEngine,
  index: AdjacencyIndex,
  thingResolver?: (ids: string[]) => Promise<T[]>
): MagicTraversal<T> {
  // Methods that should NOT be treated as relationship types
  const traversalMethods = new Set([
    'out', 'both', 'where', 'filter', 'limit', 'skip', 'depth', 'unique',
    'intersect', 'union', 'except', 'pathTo', 'allPathsTo', 'connected',
    'ids', 'nodes', 'toArray', 'count', 'exists', 'first',
    'then', 'catch', 'finally', // Promise-like
    Symbol.asyncIterator, Symbol.toStringTag,
  ])

  return new Proxy(traversal as MagicTraversal<T>, {
    get(target, prop: string | symbol) {
      // Symbol properties (like Symbol.asyncIterator)
      if (typeof prop === 'symbol') {
        const value = (target as any)[prop]
        if (typeof value === 'function') {
          return value.bind(target)
        }
        return value
      }

      // 'in' switches to incoming direction for next relationship
      // Check this BEFORE checking target methods since Traversal has an .in() method
      if (prop === 'in') {
        // Capture current traversal for the closure
        const currentTraversal = target
        // Return a proxy that will use 'in' direction for the next relationship access
        const inProxy = new Proxy(function () {} as unknown as MagicTraversal<T>, {
          get(_t, relType: string | symbol) {
            if (typeof relType === 'symbol') return undefined
            if (typeof relType !== 'string') return undefined
            // Use currentTraversal to call .in()
            const newTraversal = currentTraversal.in(relType)
            return createMagicProxy(newTraversal, engine, index, thingResolver)
          },
          apply() {
            // Allow $.in('relType') syntax as well
            return currentTraversal
          }
        })
        return inProxy
      }

      // Return actual traversal methods (but not as relationship traversals)
      if (traversalMethods.has(prop) || prop in target) {
        const value = (target as any)[prop]
        if (typeof value === 'function') {
          return value.bind(target)
        }
        return value
      }

      // Any other string property is treated as a relationship type
      const newTraversal = target.out(prop as string)
      return createMagicProxy(newTraversal, engine, index, thingResolver)
    }
  })
}

// ============================================================================
// GraphNode - Entry point with Magic $
// ============================================================================

export interface GraphNode<T extends Thing = Thing> {
  /** The node's ID */
  id: string
  /** The underlying Thing data (if loaded) */
  data?: T
  /** Magic traversal proxy - relationship types become properties */
  $: MagicTraversal<T>
  /** Find shortest path to another node */
  pathTo(targetId: string, options?: PathOptions): Promise<GraphPath | null>
  /** Check if connected to another node */
  connected(targetId: string, options?: PathOptions): Promise<boolean>
  /** Get all paths to another node */
  allPathsTo(targetId: string, options?: PathOptions): Promise<GraphPath[]>
}

export function createGraphNode<T extends Thing = Thing>(
  id: string,
  engine: GraphTraversalEngine,
  index: AdjacencyIndex,
  thingResolver?: (ids: string[]) => Promise<T[]>,
  data?: T
): GraphNode<T> {
  const $ = createMagicTraversal<T>(engine, index, [id], thingResolver)

  return {
    id,
    data,
    $,
    async pathTo(targetId: string, options?: PathOptions) {
      return engine.shortestPath(id, targetId, options?.maxDepth ?? 10, options?.edgeTypes)
    },
    async connected(targetId: string, options?: PathOptions) {
      return engine.pathExists(id, targetId, options?.maxDepth ?? 6, options?.edgeTypes)
    },
    async allPathsTo(targetId: string, options?: PathOptions) {
      return engine.allPaths(id, targetId, options?.maxDepth ?? 5, 100, options?.edgeTypes)
    },
  }
}

// ============================================================================
// Graph Client - Main entry point
// ============================================================================

export interface GraphOptions {
  namespace: string
  /** Optional function to resolve Thing data from IDs */
  thingResolver?: (ids: string[]) => Promise<Thing[]>
}

export class Graph<Schema extends GraphSchema = GraphSchema> {
  private index: AdjacencyIndex
  private engine: GraphTraversalEngine
  private thingResolver?: (ids: string[]) => Promise<Thing[]>
  readonly namespace: string

  constructor(options: GraphOptions) {
    this.namespace = options.namespace
    this.index = new AdjacencyIndex()
    this.engine = new GraphTraversalEngine(this.index)
    this.thingResolver = options.thingResolver
  }

  /**
   * Get a graph node by ID
   * @example const user = graph.node('user-123')
   */
  node<T extends Thing = Thing>(id: string): GraphNode<T> {
    return createGraphNode<T>(id, this.engine, this.index, this.thingResolver as any)
  }

  /**
   * Alias for node()
   */
  thing<T extends Thing = Thing>(id: string): GraphNode<T> {
    return this.node<T>(id)
  }

  /**
   * Start a traversal from multiple nodes
   * @example graph.from(['user-1', 'user-2']).out('follows')
   */
  from<T extends Thing = Thing>(...ids: string[]): MagicTraversal<T> {
    return createMagicTraversal<T>(this.engine, this.index, ids, this.thingResolver as any)
  }

  /**
   * Add a relationship to the graph index
   */
  addRelationship(rel: Relationship): void {
    this.index.addEdge(rel)
  }

  /**
   * Add multiple relationships
   */
  addRelationships(rels: Relationship[]): void {
    for (const rel of rels) {
      this.index.addEdge(rel)
    }
  }

  /**
   * Check if a direct path exists between two nodes
   */
  async pathExists(from: string, to: string, maxDepth = 6): Promise<boolean> {
    return this.engine.pathExists(from, to, maxDepth)
  }

  /**
   * Find shortest path between two nodes
   */
  async shortestPath(from: string, to: string, maxDepth = 10): Promise<GraphPath | null> {
    return this.engine.shortestPath(from, to, maxDepth)
  }

  /**
   * Find common neighbors between two nodes
   */
  async commonNeighbors(id1: string, id2: string, direction: Direction = 'out'): Promise<string[]> {
    return this.engine.commonNeighbors(id1, id2, direction)
  }

  /**
   * Get index statistics
   */
  getStats() {
    return this.index.getStats()
  }
}

// ============================================================================
// Typed Graph Factory - Full type safety with schema
// ============================================================================

/**
 * Create a typed graph client
 *
 * @example
 * interface MyGraph extends GraphSchema {
 *   User: { follows: 'User', likes: 'Post' }
 *   Post: { author: 'User' }
 * }
 *
 * const graph = createGraph<MyGraph>({ namespace: 'app' })
 * const user = graph.node('user-123')
 * const friends = await user.$.follows.toArray()  // Type: User[]
 */
export function createGraph<Schema extends GraphSchema = GraphSchema>(
  options: GraphOptions
): Graph<Schema> {
  return new Graph<Schema>(options)
}

// ============================================================================
// Usage Examples (for documentation)
// ============================================================================

/**
 * @example Basic traversal
 * ```typescript
 * const graph = createGraph({ namespace: 'social' })
 * const user = graph.node('user-123')
 *
 * // Friends (outgoing 'follows' edges)
 * const friends = await user.$.follows.toArray()
 *
 * // Followers (incoming 'follows' edges)
 * const followers = await user.$.in.follows.toArray()
 *
 * // Friends of friends
 * const fof = await user.$.follows.follows.toArray()
 *
 * // Posts liked by friends
 * const posts = await user.$.follows.likes.toArray()
 * ```
 *
 * @example Filtering and limiting
 * ```typescript
 * // Verified friends only
 * const verified = await user.$.follows
 *   .where({ verified: true })
 *   .toArray()
 *
 * // Top 10 most recent
 * const recent = await user.$.follows
 *   .limit(10)
 *   .toArray()
 *
 * // Paginated
 * const page2 = await user.$.follows
 *   .skip(20)
 *   .limit(10)
 *   .toArray()
 * ```
 *
 * @example Variable depth
 * ```typescript
 * // Exactly 2 hops away
 * const twoHops = await user.$.follows.depth(2).toArray()
 *
 * // 1-3 hops away (social network)
 * const network = await user.$.follows.depth({ min: 1, max: 3 }).toArray()
 * ```
 *
 * @example Set operations
 * ```typescript
 * const user1 = graph.node('user-1')
 * const user2 = graph.node('user-2')
 *
 * // Mutual friends
 * const mutual = await user1.$.follows
 *   .intersect(user2.$.follows)
 *   .toArray()
 *
 * // Combined networks
 * const combined = await user1.$.follows
 *   .union(user2.$.follows)
 *   .toArray()
 *
 * // Friends of friends who aren't already friends
 * const suggestions = await user1.$.follows.follows
 *   .except(user1.$.follows)
 *   .toArray()
 * ```
 *
 * @example Path finding
 * ```typescript
 * const user = graph.node('user-123')
 *
 * // Shortest path to another user
 * const path = await user.pathTo('user-456')
 * console.log(path?.vertices)  // ['user-123', 'user-789', 'user-456']
 *
 * // Check if connected
 * const connected = await user.connected('user-456')
 *
 * // All paths (for visualization)
 * const allPaths = await user.allPathsTo('user-456', { maxDepth: 4 })
 * ```
 *
 * @example Aggregation
 * ```typescript
 * // Count without materializing
 * const friendCount = await user.$.follows.count()
 *
 * // Check existence
 * const hasFriends = await user.$.follows.exists()
 *
 * // Get first match
 * const firstFriend = await user.$.follows.first()
 * ```
 *
 * @example Async iteration
 * ```typescript
 * for await (const friend of user.$.follows) {
 *   console.log(friend.id)
 * }
 * ```
 */
export const _examples = null
