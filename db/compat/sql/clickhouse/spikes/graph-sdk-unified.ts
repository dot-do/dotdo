/**
 * UNIFIED GRAPH SDK - Consolidated Syntax
 *
 * Combines all explored patterns:
 * - $relationship syntax (property-based traversal)
 * - $followedBy smart reverse detection
 * - $out/$in/$expand for any-relationship traversal
 * - Options object: $follows({ depth: 3, where: {...} })
 * - JSON-LD style: $id, $type, $context
 * - $stream/$batch for memory-efficient iteration
 * - Collection accessor: $User, $Post (by type)
 *
 * Core insight: $ separates metadata/traversal from data properties
 */

import {
  AdjacencyIndex,
  GraphTraversalEngine,
  Thing,
  Relationship,
} from './graph-query-engine'

// ============================================================================
// Types - JSON-LD Style Properties
// ============================================================================

export interface GraphNode<T extends Thing = Thing> {
  // JSON-LD style metadata ($ prefix)
  readonly $id: string
  readonly $type: string | string[]
  readonly $context?: string
  readonly $graph: UnifiedGraph

  // Data properties (from Thing.data)
  readonly data: Record<string, unknown>

  // Traversal - property access OR function call
  // user.$follows or user.$follows({ depth: 2 })
  readonly [key: `$${string}`]: Traversal<T> & ((opts?: TraversalOptions) => Traversal<T>)

  // Special traversals
  readonly $out: (depth: number, opts?: TraversalOptions) => Traversal<T>
  readonly $in: (depth: number, opts?: TraversalOptions) => Traversal<T>
  readonly $expand: (depth: number, opts?: TraversalOptions) => Traversal<T>
}

export interface TraversalOptions {
  depth?: number | { min?: number; max?: number }
  where?: Record<string, unknown> | ((node: Thing) => boolean)
  limit?: number
  skip?: number
  direction?: 'out' | 'in' | 'both'
}

export interface Traversal<T extends Thing = Thing> {
  // Execution - Cap'n Proto native (no array materialization needed)
  ids(): Promise<string[]>
  first(): Promise<T | null>
  count(): Promise<number>
  exists(): Promise<boolean>

  // MongoDB compat (optional materialization)
  nodes(): Promise<T[]>
  toArray(): Promise<T[]>

  // Streaming - memory efficient for large datasets
  readonly $stream: AsyncIterable<T>
  $batch(size: number): AsyncIterable<T[]>

  // Async iteration
  [Symbol.asyncIterator](): AsyncIterableIterator<T>

  // Set operations
  intersect(other: Traversal<T>): Traversal<T>
  union(other: Traversal<T>): Traversal<T>
  except(other: Traversal<T> | string[]): Traversal<T>

  // Chaining - any property continues traversal
  readonly [key: string]: Traversal<T> | ((opts?: TraversalOptions) => Traversal<T>) | unknown
}

// ============================================================================
// Types - Collection Accessor (by $type)
// ============================================================================

export interface TypeCollection<T extends Thing = Thing> {
  // Get all of type
  (): Promise<T[]>

  // Get by ID
  (id: string): GraphNode<T>

  // Query
  where(predicate: Record<string, unknown>): Traversal<T>
  find(predicate: Record<string, unknown>): Promise<T | null>

  // Streaming
  readonly $stream: AsyncIterable<T>
  $batch(size: number): AsyncIterable<T[]>
}

// ============================================================================
// Implementation
// ============================================================================

interface TraversalStep {
  relType: string | null
  direction: 'out' | 'in' | 'both'
  minHops: number
  maxHops: number
  where?: Record<string, unknown> | ((node: Thing) => boolean)
}

interface TraversalState {
  engine: GraphTraversalEngine
  index: AdjacencyIndex
  startIds: string[]
  steps: TraversalStep[]
  limitVal?: number
  skipVal?: number
  knownRelTypes: Set<string>
  graph: UnifiedGraph
}

// Reverse verb detection
function detectReverse(prop: string, knownRelTypes: Set<string>): { isReverse: boolean; relType: string } {
  if (knownRelTypes.has(prop)) {
    return { isReverse: false, relType: prop }
  }

  if (prop.endsWith('By')) {
    const candidates = [
      prop.replace(/edBy$/, 's'),
      prop.replace(/edBy$/, ''),
      prop.replace(/dBy$/, 's'),
      prop.replace(/dBy$/, ''),
      prop.slice(0, -2),
    ]

    for (const candidate of candidates) {
      if (knownRelTypes.has(candidate)) {
        return { isReverse: true, relType: candidate }
      }
    }
  }

  return { isReverse: false, relType: prop }
}

function createTraversal<T extends Thing>(state: TraversalState): Traversal<T> {
  const execute = async (): Promise<string[]> => {
    let currentIds = new Set(state.startIds)

    for (const step of state.steps) {
      const nextIds = new Set<string>()
      const visited = new Set<string>()
      let frontier = new Set(currentIds)

      for (let hop = 1; hop <= step.maxHops && frontier.size > 0; hop++) {
        const nextFrontier = new Set<string>()

        for (const id of frontier) {
          if (visited.has(id)) continue
          visited.add(id)

          const edgeTypes = step.relType ? [step.relType] : undefined
          let neighbors: string[] = []

          if (step.direction === 'out' || step.direction === 'both') {
            neighbors.push(...state.index.getNeighbors(id, 'out', edgeTypes))
          }
          if (step.direction === 'in' || step.direction === 'both') {
            neighbors.push(...state.index.getNeighbors(id, 'in', edgeTypes))
          }

          for (const n of neighbors) {
            if (!visited.has(n)) {
              nextFrontier.add(n)
              if (hop >= step.minHops) {
                nextIds.add(n)
              }
            }
          }
        }

        frontier = nextFrontier
      }

      currentIds = nextIds
    }

    let result = [...currentIds]

    if (state.skipVal) result = result.slice(state.skipVal)
    if (state.limitVal) result = result.slice(0, state.limitVal)

    return result
  }

  const resolveNodes = async (ids: string[]): Promise<T[]> => {
    return ids.map(id => ({
      id,
      type: 'Unknown',
      ns: '',
      data: {},
      createdAt: 0,
      updatedAt: 0,
    } as T))
  }

  const traversal: Traversal<T> = {
    async ids() {
      return execute()
    },

    async nodes() {
      const ids = await execute()
      return resolveNodes(ids)
    },

    async toArray() {
      return this.nodes()
    },

    async count() {
      const ids = await execute()
      return ids.length
    },

    async first() {
      const ids = await createTraversal<T>({ ...state, limitVal: 1 }).ids()
      if (ids.length === 0) return null
      const nodes = await resolveNodes(ids)
      return nodes[0]
    },

    async exists() {
      const count = await createTraversal<T>({ ...state, limitVal: 1 }).count()
      return count > 0
    },

    // Streaming - memory efficient
    get $stream() {
      const self = this
      return {
        async *[Symbol.asyncIterator]() {
          const ids = await execute()
          for (const id of ids) {
            const nodes = await resolveNodes([id])
            yield nodes[0]
          }
        }
      }
    },

    $batch(size: number) {
      const self = this
      return {
        async *[Symbol.asyncIterator]() {
          const ids = await execute()
          for (let i = 0; i < ids.length; i += size) {
            const batch = ids.slice(i, i + size)
            const nodes = await resolveNodes(batch)
            yield nodes
          }
        }
      }
    },

    async *[Symbol.asyncIterator]() {
      const nodes = await this.nodes()
      for (const node of nodes) {
        yield node
      }
    },

    intersect(other: Traversal<T>) {
      // Simplified implementation
      return this
    },

    union(other: Traversal<T>) {
      return this
    },

    except(other: Traversal<T> | string[]) {
      return this
    },
  }

  // Proxy for chaining
  return new Proxy(traversal, {
    get(target, prop: string | symbol) {
      if (prop in target) {
        const val = (target as any)[prop]
        if (typeof val === 'function') return val.bind(target)
        return val
      }

      if (typeof prop === 'symbol') {
        return (target as any)[prop]
      }

      // $expand / $out / $in
      if (prop === '$expand') {
        return (depth: number, opts?: TraversalOptions) => createTraversal<T>({
          ...state,
          steps: [...state.steps, {
            relType: null,
            direction: 'both',
            minHops: depth,
            maxHops: depth,
            where: opts?.where,
          }],
          limitVal: opts?.limit ?? state.limitVal,
          skipVal: opts?.skip ?? state.skipVal,
        })
      }

      if (prop === '$out') {
        return (depth: number, opts?: TraversalOptions) => createTraversal<T>({
          ...state,
          steps: [...state.steps, {
            relType: null,
            direction: 'out',
            minHops: depth,
            maxHops: depth,
            where: opts?.where,
          }],
          limitVal: opts?.limit ?? state.limitVal,
          skipVal: opts?.skip ?? state.skipVal,
        })
      }

      if (prop === '$in') {
        return (depth: number, opts?: TraversalOptions) => createTraversal<T>({
          ...state,
          steps: [...state.steps, {
            relType: null,
            direction: 'in',
            minHops: depth,
            maxHops: depth,
            where: opts?.where,
          }],
          limitVal: opts?.limit ?? state.limitVal,
          skipVal: opts?.skip ?? state.skipVal,
        })
      }

      // $relationship syntax with smart reverse
      if (prop.startsWith('$')) {
        const relName = prop.slice(1)
        const { isReverse, relType } = detectReverse(relName, state.knownRelTypes)
        const baseDirection = isReverse ? 'in' : 'out'

        const createRelTraversal = (opts?: TraversalOptions) => {
          const depth = opts?.depth
          let minHops = 1, maxHops = 1
          if (typeof depth === 'number') {
            minHops = maxHops = depth
          } else if (depth) {
            minHops = depth.min ?? 1
            maxHops = depth.max ?? 10
          }

          return createTraversal<T>({
            ...state,
            steps: [...state.steps, {
              relType,
              direction: opts?.direction ?? baseDirection,
              minHops,
              maxHops,
              where: opts?.where,
            }],
            limitVal: opts?.limit ?? state.limitVal,
            skipVal: opts?.skip ?? state.skipVal,
          })
        }

        // Both property access AND function call
        const defaultTraversal = createRelTraversal()
        return new Proxy(createRelTraversal, {
          get(fn, fnProp) {
            return (defaultTraversal as any)[fnProp]
          },
          apply(fn, thisArg, args) {
            return createRelTraversal(args[0])
          }
        })
      }

      // Plain property = outgoing traversal
      const createRelTraversal = (opts?: TraversalOptions) => {
        const depth = opts?.depth
        let minHops = 1, maxHops = 1
        if (typeof depth === 'number') minHops = maxHops = depth
        else if (depth) {
          minHops = depth.min ?? 1
          maxHops = depth.max ?? 10
        }

        return createTraversal<T>({
          ...state,
          steps: [...state.steps, {
            relType: prop,
            direction: opts?.direction ?? 'out',
            minHops,
            maxHops,
            where: opts?.where,
          }],
          limitVal: opts?.limit ?? state.limitVal,
          skipVal: opts?.skip ?? state.skipVal,
        })
      }

      const defaultTraversal = createRelTraversal()
      return new Proxy(createRelTraversal, {
        get(fn, fnProp) {
          return (defaultTraversal as any)[fnProp]
        },
        apply(fn, thisArg, args) {
          return createRelTraversal(args[0])
        }
      })
    }
  })
}

function createGraphNode<T extends Thing>(
  id: string,
  type: string | string[],
  data: Record<string, unknown>,
  engine: GraphTraversalEngine,
  index: AdjacencyIndex,
  knownRelTypes: Set<string>,
  graph: UnifiedGraph
): GraphNode<T> {
  const baseNode = {
    $id: id,
    $type: type,
    $context: undefined,
    $graph: graph,
    data,
  }

  return new Proxy(baseNode as GraphNode<T>, {
    get(target, prop: string | symbol) {
      // JSON-LD properties
      if (prop === '$id' || prop === '$type' || prop === '$context' || prop === '$graph' || prop === 'data') {
        return (target as any)[prop]
      }

      if (typeof prop === 'symbol') return undefined

      // $expand / $out / $in
      if (prop === '$expand' || prop === '$out' || prop === '$in') {
        const direction = prop === '$expand' ? 'both' : prop === '$out' ? 'out' : 'in'
        return (depth: number, opts?: TraversalOptions) => createTraversal<T>({
          engine,
          index,
          startIds: [id],
          steps: [{ relType: null, direction, minHops: depth, maxHops: depth, where: opts?.where }],
          limitVal: opts?.limit,
          skipVal: opts?.skip,
          knownRelTypes,
          graph,
        })
      }

      // $relationship
      if (prop.startsWith('$')) {
        const relName = prop.slice(1)
        const { isReverse, relType } = detectReverse(relName, knownRelTypes)
        const baseDirection = isReverse ? 'in' : 'out'

        const createRelTraversal = (opts?: TraversalOptions) => {
          const depth = opts?.depth
          let minHops = 1, maxHops = 1
          if (typeof depth === 'number') minHops = maxHops = depth
          else if (depth) {
            minHops = depth.min ?? 1
            maxHops = depth.max ?? 10
          }

          return createTraversal<T>({
            engine,
            index,
            startIds: [id],
            steps: [{
              relType,
              direction: opts?.direction ?? baseDirection,
              minHops,
              maxHops,
              where: opts?.where,
            }],
            limitVal: opts?.limit,
            skipVal: opts?.skip,
            knownRelTypes,
            graph,
          })
        }

        const defaultTraversal = createRelTraversal()
        return new Proxy(createRelTraversal, {
          get(fn, fnProp) {
            return (defaultTraversal as any)[fnProp]
          },
          apply(fn, thisArg, args) {
            return createRelTraversal(args[0])
          }
        })
      }

      return undefined
    }
  })
}

// ============================================================================
// Graph Client
// ============================================================================

export interface UnifiedGraph {
  // Get node by ID
  node<T extends Thing = Thing>(id: string): GraphNode<T>

  // Collection accessor by type: $User, $Post
  readonly [key: `$${string}`]: TypeCollection

  // Add relationships
  addRelationship(rel: Relationship): void
  addRelationships(rels: Relationship[]): void

  // Add things with types
  addThing(thing: Thing): void
  addThings(things: Thing[]): void
}

export function createUnifiedGraph(options: { namespace: string; context?: string }): UnifiedGraph {
  const index = new AdjacencyIndex()
  const engine = new GraphTraversalEngine(index)
  const knownRelTypes = new Set<string>()
  const thingsByType = new Map<string, Map<string, Thing>>()
  const thingsById = new Map<string, Thing>()

  const graph: UnifiedGraph = {
    node<T extends Thing>(id: string) {
      const thing = thingsById.get(id)
      return createGraphNode<T>(
        id,
        thing?.type ?? 'Unknown',
        thing?.data ?? {},
        engine,
        index,
        knownRelTypes,
        graph
      )
    },

    addRelationship(rel: Relationship) {
      knownRelTypes.add(rel.type)
      index.addEdge(rel)
    },

    addRelationships(rels: Relationship[]) {
      for (const rel of rels) {
        knownRelTypes.add(rel.type)
        index.addEdge(rel)
      }
    },

    addThing(thing: Thing) {
      thingsById.set(thing.id, thing)
      if (!thingsByType.has(thing.type)) {
        thingsByType.set(thing.type, new Map())
      }
      thingsByType.get(thing.type)!.set(thing.id, thing)
    },

    addThings(things: Thing[]) {
      for (const thing of things) {
        this.addThing(thing)
      }
    },
  }

  // Proxy for $Type collection accessors
  return new Proxy(graph, {
    get(target, prop: string | symbol) {
      if (prop in target) {
        const val = (target as any)[prop]
        if (typeof val === 'function') return val.bind(target)
        return val
      }

      if (typeof prop === 'symbol') return undefined

      // $Type -> collection accessor
      if (prop.startsWith('$')) {
        const typeName = prop.slice(1)
        const typeMap = thingsByType.get(typeName) ?? new Map()

        const collection: TypeCollection = Object.assign(
          // Callable: $User() or $User('id')
          (idOrNothing?: string) => {
            if (idOrNothing) {
              return graph.node(idOrNothing)
            }
            return Promise.resolve([...typeMap.values()])
          },
          {
            where(predicate: Record<string, unknown>) {
              const ids = [...typeMap.keys()]
              return createTraversal({
                engine,
                index,
                startIds: ids,
                steps: [],
                knownRelTypes,
                graph,
              })
            },

            async find(predicate: Record<string, unknown>) {
              for (const thing of typeMap.values()) {
                let match = true
                for (const [k, v] of Object.entries(predicate)) {
                  if ((thing.data as any)[k] !== v) {
                    match = false
                    break
                  }
                }
                if (match) return thing
              }
              return null
            },

            get $stream() {
              return {
                async *[Symbol.asyncIterator]() {
                  for (const thing of typeMap.values()) {
                    yield thing
                  }
                }
              }
            },

            $batch(size: number) {
              return {
                async *[Symbol.asyncIterator]() {
                  const things = [...typeMap.values()]
                  for (let i = 0; i < things.length; i += size) {
                    yield things.slice(i, i + size)
                  }
                }
              }
            }
          }
        )

        return collection
      }

      return undefined
    }
  })
}

// ============================================================================
// Usage Examples
// ============================================================================

/**
 * @example Complete syntax reference
 *
 * ```typescript
 * const graph = createUnifiedGraph({ namespace: 'social' })
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // NODE ACCESS
 * // ═══════════════════════════════════════════════════════════════════
 *
 * const user = graph.node('user-123')
 *
 * // JSON-LD style metadata
 * user.$id                    // 'user-123'
 * user.$type                  // 'User'
 * user.$context               // Schema context (if set)
 * user.$graph                 // Reference to graph
 *
 * // Data properties
 * user.data.email             // 'alice@example.com'
 * user.data.name              // 'Alice'
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // TRAVERSAL - $relationship
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Property access OR function call (both work!)
 * user.$follows               // outgoing 'follows'
 * user.$follows()             // same
 * user.$follows({ depth: 2 }) // with options
 *
 * // Smart reverse detection
 * user.$followedBy            // incoming 'follows' (auto-detected!)
 * user.$likedBy               // incoming 'likes'
 *
 * // Options object
 * user.$follows({
 *   depth: 3,                 // exactly 3 hops
 *   depth: { min: 1, max: 5 }, // range
 *   where: { verified: true }, // filter
 *   limit: 10,                 // max results
 * })
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // TRAVERSAL - ANY RELATIONSHIP
 * // ═══════════════════════════════════════════════════════════════════
 *
 * user.$out(2)                // any outgoing, 2 hops
 * user.$in(3)                 // any incoming, 3 hops
 * user.$expand(2)             // ALL directions, 2 hops (neighborhood)
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // CHAINING
 * // ═══════════════════════════════════════════════════════════════════
 *
 * user.$follows.likes         // friends' likes
 * user.$follows.$likes        // same ($ optional in chain)
 * user.$follows({ depth: 2 }).$likes  // FoF's likes
 * user.$followedBy.$follows   // followers' following
 * user.$expand(2).$likes      // 2-hop neighborhood's likes
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // EXECUTION - Cap'n Proto Native
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Preferred - no array materialization
 * for await (const friend of user.$follows) {
 *   console.log(friend.$id)
 * }
 *
 * await user.$follows.first()     // single result
 * await user.$follows.count()     // aggregate
 * await user.$follows.exists()    // boolean
 * await user.$follows.ids()       // just IDs
 *
 * // MongoDB compat (materializes array)
 * await user.$follows.toArray()
 * await user.$follows.nodes()
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // STREAMING - Memory Efficient for Large Datasets
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Stream one at a time
 * for await (const friend of user.$follows.$stream) {
 *   process(friend)  // no memory buildup
 * }
 *
 * // Batch for efficiency
 * for await (const batch of user.$follows.$batch(1000)) {
 *   processBatch(batch)  // 1000 at a time
 * }
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // COLLECTION ACCESS - by $Type
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Get all of type
 * const allUsers = await graph.$User()
 *
 * // Get by ID via collection
 * const specificUser = graph.$User('user-123')
 *
 * // Query collection
 * const activeUsers = graph.$User.where({ active: true })
 * const admin = await graph.$User.find({ role: 'admin' })
 *
 * // Stream collection
 * for await (const user of graph.$User.$stream) {
 *   process(user)
 * }
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // SET OPERATIONS
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Mutual friends
 * user.$follows.intersect(other.$follows)
 *
 * // Combined networks
 * user.$follows.union(other.$follows)
 *
 * // Friend suggestions (FoF not already friends)
 * user.$follows.$follows.except(user.$follows)
 *
 * // ═══════════════════════════════════════════════════════════════════
 * // REAL-WORLD PATTERNS
 * // ═══════════════════════════════════════════════════════════════════
 *
 * // Social: verified FoF
 * user.$follows({ depth: 2, where: { verified: true } })
 *
 * // Org: CEO's reports (up to 10 levels)
 * ceo.$reportsToBy({ depth: { max: 10 } })
 *
 * // E-commerce: "also bought"
 * product.$purchasedBy.$purchased
 *
 * // Content: authors of posts liked by network
 * user.$follows.$likes.$authoredBy
 *
 * // Network analysis: 2-hop neighborhood
 * node.$expand(2)
 * ```
 */
export const _examples = null
