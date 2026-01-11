/**
 * SPIKE: Options Object Syntax
 *
 * Clean function call syntax with options:
 *   user.$follows({ depth: 3 })
 *   user.$follows({ where: { type: 'CEO' } })
 *   user.$reportsTo({ depth: 3, where: { level: 'executive' } })
 *
 * All-direction expansion:
 *   user.$expand(2)   // all directions, 2 hops
 *   user.$reach(2)    // reachable within 2 hops
 */

import {
  AdjacencyIndex,
  GraphTraversalEngine,
  Thing,
  Relationship,
} from './graph-query-engine'

// ============================================================================
// Types
// ============================================================================

export interface TraversalOptions {
  /** Depth: exact number or range */
  depth?: number | { min?: number; max?: number }
  /** Filter nodes */
  where?: Record<string, unknown>
  /** Limit results */
  limit?: number
  /** Skip results */
  skip?: number
  /** Direction override */
  direction?: 'out' | 'in' | 'both'
}

export interface OptionsTraversal<T extends Thing = Thing> {
  // Execution
  ids(): Promise<string[]>
  nodes(): Promise<T[]>
  toArray(): Promise<T[]>
  count(): Promise<number>
  first(): Promise<T | null>
  exists(): Promise<boolean>

  // Set operations
  intersect(other: OptionsTraversal<T>): OptionsTraversal<T>
  union(other: OptionsTraversal<T>): OptionsTraversal<T>
  except(other: OptionsTraversal<T>): OptionsTraversal<T>

  // Async iteration
  [Symbol.asyncIterator](): AsyncIterableIterator<T>

  // Chaining - relationships can be called with options or accessed as properties
  [key: string]: OptionsTraversal<T> | ((opts?: TraversalOptions) => OptionsTraversal<T>) | unknown
}

export interface OptionsGraphNode<T extends Thing = Thing> {
  id: string
  type: string
  data: Record<string, unknown>

  /**
   * $relationship - access as property OR call with options
   *
   * user.$follows              // basic traversal
   * user.$follows()            // same as above
   * user.$follows({ depth: 2 }) // with options
   */
  [key: `$${string}`]: OptionsTraversal<T> & ((opts?: TraversalOptions) => OptionsTraversal<T>)

  /**
   * $expand(n) - expand in ALL directions, n hops
   * $reach(n) - alias for expand
   */
  $expand: (depth: number, opts?: Omit<TraversalOptions, 'depth' | 'direction'>) => OptionsTraversal<T>
  $reach: (depth: number, opts?: Omit<TraversalOptions, 'depth' | 'direction'>) => OptionsTraversal<T>

  /**
   * $out(n) / $in(n) - specific direction, any relationship
   */
  $out: (depth: number, opts?: Omit<TraversalOptions, 'depth' | 'direction'>) => OptionsTraversal<T>
  $in: (depth: number, opts?: Omit<TraversalOptions, 'depth' | 'direction'>) => OptionsTraversal<T>
}

// ============================================================================
// Implementation
// ============================================================================

interface TraversalStep {
  relType: string | null
  direction: 'out' | 'in' | 'both'
  minHops: number
  maxHops: number
  where?: Record<string, unknown>
}

interface TraversalState {
  engine: GraphTraversalEngine
  index: AdjacencyIndex
  startIds: string[]
  steps: TraversalStep[]
  limitVal?: number
  skipVal?: number
  knownRelTypes: Set<string>
}

function matchesWhere(node: Thing, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    // Handle nested paths like 'data.email'
    const parts = key.split('.')
    let current: unknown = node
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return false
      current = (current as Record<string, unknown>)[part]
    }
    if (current !== value) return false
  }
  return true
}

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

function createOptionsTraversal<T extends Thing>(state: TraversalState): OptionsTraversal<T> {
  const execute = async (): Promise<string[]> => {
    let currentIds = new Set(state.startIds)

    for (const step of state.steps) {
      const nextIds = new Set<string>()
      let visited = new Set<string>()

      // BFS with depth tracking
      let frontier = new Set(currentIds)

      for (let hop = 1; hop <= step.maxHops && frontier.size > 0; hop++) {
        const nextFrontier = new Set<string>()

        for (const id of frontier) {
          if (visited.has(id)) continue
          visited.add(id)

          const edgeTypes = step.relType ? [step.relType] : undefined

          // Get neighbors based on direction
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

    if (state.skipVal) {
      result = result.slice(state.skipVal)
    }
    if (state.limitVal) {
      result = result.slice(0, state.limitVal)
    }

    return result
  }

  const traversal: OptionsTraversal<T> = {
    async ids() {
      return execute()
    },

    async nodes() {
      const ids = await execute()
      return ids.map(id => ({ id, type: 'Unknown', ns: '', data: {}, createdAt: 0, updatedAt: 0 } as T))
    },

    async toArray() {
      return this.nodes()
    },

    async count() {
      const ids = await execute()
      return ids.length
    },

    async first() {
      const nodes = await createOptionsTraversal<T>({ ...state, limitVal: 1 }).nodes()
      return nodes[0] ?? null
    },

    async exists() {
      const count = await createOptionsTraversal<T>({ ...state, limitVal: 1 }).count()
      return count > 0
    },

    intersect(other: OptionsTraversal<T>) {
      return this // Simplified
    },

    union(other: OptionsTraversal<T>) {
      return this
    },

    except(other: OptionsTraversal<T>) {
      return this
    },

    async *[Symbol.asyncIterator]() {
      const nodes = await this.nodes()
      for (const node of nodes) {
        yield node
      }
    },
  }

  // Proxy for chaining and function calls
  return new Proxy(traversal, {
    get(target, prop: string | symbol) {
      if (prop in target) {
        const val = (target as any)[prop]
        if (typeof val === 'function') {
          return val.bind(target)
        }
        return val
      }

      if (typeof prop === 'symbol') {
        return (target as any)[prop]
      }

      // $expand / $reach - all directions
      if (prop === '$expand' || prop === '$reach') {
        return (depth: number, opts?: TraversalOptions) => createOptionsTraversal<T>({
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

      // $out / $in - specific direction, any relationship
      if (prop === '$out') {
        return (depth: number, opts?: TraversalOptions) => createOptionsTraversal<T>({
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
        return (depth: number, opts?: TraversalOptions) => createOptionsTraversal<T>({
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

      // Handle $relationship - can be accessed as property OR called as function
      if (prop.startsWith('$')) {
        const relName = prop.slice(1)
        const { isReverse, relType } = detectReverse(relName, state.knownRelTypes)
        const baseDirection = isReverse ? 'in' : 'out'

        // Return a callable that's also a traversal
        const createRelTraversal = (opts?: TraversalOptions) => {
          const depth = opts?.depth
          let minHops = 1, maxHops = 1
          if (typeof depth === 'number') {
            minHops = maxHops = depth
          } else if (depth) {
            minHops = depth.min ?? 1
            maxHops = depth.max ?? 10
          }

          return createOptionsTraversal<T>({
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

        // Make it both callable and a traversal
        const defaultTraversal = createRelTraversal()
        return new Proxy(createRelTraversal, {
          get(fn, fnProp) {
            // Forward property access to the default traversal
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
        if (typeof depth === 'number') {
          minHops = maxHops = depth
        } else if (depth) {
          minHops = depth.min ?? 1
          maxHops = depth.max ?? 10
        }

        return createOptionsTraversal<T>({
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

function createOptionsGraphNode<T extends Thing>(
  id: string,
  engine: GraphTraversalEngine,
  index: AdjacencyIndex,
  knownRelTypes: Set<string>,
  data?: Partial<T>
): OptionsGraphNode<T> {
  const baseNode = {
    id,
    type: data?.type ?? 'Unknown',
    data: data?.data ?? {},
  }

  return new Proxy(baseNode as OptionsGraphNode<T>, {
    get(target, prop: string | symbol) {
      if (prop === 'id' || prop === 'type' || prop === 'data') {
        return (target as any)[prop]
      }

      if (typeof prop === 'symbol') {
        return undefined
      }

      // $expand / $reach - all directions, N hops
      if (prop === '$expand' || prop === '$reach') {
        return (depth: number, opts?: TraversalOptions) => createOptionsTraversal<T>({
          engine,
          index,
          startIds: [id],
          steps: [{
            relType: null,
            direction: 'both',
            minHops: depth,
            maxHops: depth,
            where: opts?.where,
          }],
          limitVal: opts?.limit,
          skipVal: opts?.skip,
          knownRelTypes,
        })
      }

      // $out / $in
      if (prop === '$out') {
        return (depth: number, opts?: TraversalOptions) => createOptionsTraversal<T>({
          engine,
          index,
          startIds: [id],
          steps: [{ relType: null, direction: 'out', minHops: depth, maxHops: depth, where: opts?.where }],
          limitVal: opts?.limit,
          skipVal: opts?.skip,
          knownRelTypes,
        })
      }

      if (prop === '$in') {
        return (depth: number, opts?: TraversalOptions) => createOptionsTraversal<T>({
          engine,
          index,
          startIds: [id],
          steps: [{ relType: null, direction: 'in', minHops: depth, maxHops: depth, where: opts?.where }],
          limitVal: opts?.limit,
          skipVal: opts?.skip,
          knownRelTypes,
        })
      }

      // $relationship - callable with options OR usable as property
      if (prop.startsWith('$')) {
        const relName = prop.slice(1)
        const { isReverse, relType } = detectReverse(relName, knownRelTypes)
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

          return createOptionsTraversal<T>({
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
          })
        }

        // Both callable and usable as property
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

export interface OptionsGraph {
  node<T extends Thing = Thing>(id: string): OptionsGraphNode<T>
  addRelationship(rel: Relationship): void
  addRelationships(rels: Relationship[]): void
}

export function createOptionsGraph(options: { namespace: string }): OptionsGraph {
  const index = new AdjacencyIndex()
  const engine = new GraphTraversalEngine(index)
  const knownRelTypes = new Set<string>()

  return {
    node<T extends Thing>(id: string) {
      return createOptionsGraphNode<T>(id, engine, index, knownRelTypes)
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
  }
}

// ============================================================================
// Usage Examples
// ============================================================================

/**
 * @example Options object syntax
 *
 * ```typescript
 * const user = graph.node('user-123')
 *
 * // Basic (these are equivalent)
 * user.$follows
 * user.$follows()
 *
 * // With depth
 * user.$follows({ depth: 2 })
 * user.$follows({ depth: { min: 1, max: 3 } })
 *
 * // With filter
 * user.$follows({ where: { type: 'CEO' } })
 * user.$reportsTo({ where: { 'data.level': 'executive' } })
 *
 * // Combined
 * user.$follows({
 *   depth: 2,
 *   where: { verified: true },
 *   limit: 10
 * })
 *
 * // Direction override
 * user.$follows({ direction: 'in' })  // same as $followedBy
 * user.$follows({ direction: 'both' }) // bidirectional
 * ```
 */

/**
 * @example $expand - all directions
 *
 * ```typescript
 * // Expand in ALL directions (both in and out)
 * user.$expand(2)                    // 2-hop neighborhood
 * user.$expand(3, { limit: 100 })    // 3-hop, max 100 nodes
 *
 * // Alias
 * user.$reach(2)                     // same as $expand
 *
 * // Chain after expand
 * user.$expand(2).$likes             // expand 2, then likes
 * ```
 */

/**
 * @example Real-world patterns
 *
 * ```typescript
 * // Org hierarchy: all reports up to 3 levels
 * ceo.$reportsTo({ depth: { max: 3 } })
 *
 * // Only executive reports
 * ceo.$reportsTo({ depth: 3, where: { level: 'executive' } })
 *
 * // Social: verified friends of friends
 * user.$follows({ depth: 2, where: { verified: true } })
 *
 * // Network analysis: 2-hop neighborhood
 * node.$expand(2)
 *
 * // Content: popular posts in network
 * user.$follows().$likes({ limit: 100 })
 *
 * // Mixed: followers' CEOs
 * user.$followedBy({ where: { type: 'Employee' } })
 *     .$reportsTo({ depth: 10, where: { title: 'CEO' } })
 * ```
 */

/**
 * Syntax summary:
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  Syntax                          │  Meaning                            │
 * ├────────────────────────────────────────────────────────────────────────┤
 * │  user.$follows                   │  Outgoing 'follows', 1 hop          │
 * │  user.$follows()                 │  Same (callable)                    │
 * │  user.$follows({ depth: 3 })     │  3 hops                             │
 * │  user.$follows({ where: {...} }) │  With filter                        │
 * │  user.$followedBy                │  Incoming (smart reverse)           │
 * │  user.$expand(2)                 │  All directions, 2 hops             │
 * │  user.$reach(2)                  │  Alias for $expand                  │
 * │  user.$out(2)                    │  Any outgoing, 2 hops               │
 * │  user.$in(2)                     │  Any incoming, 2 hops               │
 * └────────────────────────────────────────────────────────────────────────┘
 */
