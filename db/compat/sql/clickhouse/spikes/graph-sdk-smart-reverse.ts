/**
 * SPIKE: Smart Reverse + Depth Traversal
 *
 * Two new ideas:
 * 1. $followedBy auto-resolves to reverse of $follows (smart verb detection)
 * 2. $out(n) / $in(n) for "any edges, N hops" without specifying predicates
 *
 * Syntax:
 *   user.$follows           → outgoing 'follows'
 *   user.$followedBy        → incoming 'follows' (smart reverse!)
 *   user.$likedBy           → incoming 'likes'
 *   user.$out(2)            → any outgoing, 2 hops
 *   user.$in(3)             → any incoming, 3 hops
 *   user.$follows.$out(2)   → follows, then any 2 more hops out
 */

import {
  AdjacencyIndex,
  GraphTraversalEngine,
  Thing,
  Relationship,
} from './graph-query-engine'

// ============================================================================
// Reverse Verb Detection
// ============================================================================

/**
 * Common verb patterns and their reverse forms
 */
const REVERSE_PATTERNS: [RegExp, string][] = [
  // verbBy -> verb (followedBy -> follows, likedBy -> likes)
  [/^(.+)edBy$/, '$1ed'],      // followedBy -> followed (then strip ed for follows)
  [/^(.+)dBy$/, '$1d'],        // likedBy -> liked
  [/^(.+)By$/, '$1s'],         // followsBy -> follows (fallback)

  // Past tense variations
  [/^(.+)iedBy$/, '$1y'],      // repliedBy -> reply
]

/**
 * Detect if a property name is a reverse form of a known relationship
 */
function detectReverse(prop: string, knownRelTypes: Set<string>): { isReverse: boolean; relType: string } {
  // Direct check: is it a known relationship?
  if (knownRelTypes.has(prop)) {
    return { isReverse: false, relType: prop }
  }

  // Check if it ends with "By" pattern
  if (prop.endsWith('By')) {
    // Try common transformations
    const candidates = [
      prop.slice(0, -2),                    // removeBy: followedBy -> followed
      prop.slice(0, -2) + 's',              // follows: followedBy -> followeds -> follows
      prop.slice(0, -4) + 's',              // likes: likedBy -> lik + s = liks (wrong)
      prop.replace(/edBy$/, 's'),           // followedBy -> follows
      prop.replace(/edBy$/, ''),            // authored -> author... authoredBy -> author
      prop.replace(/dBy$/, 's'),            // likedBy -> likes
      prop.replace(/dBy$/, ''),             // liked -> like
    ]

    for (const candidate of candidates) {
      if (knownRelTypes.has(candidate)) {
        return { isReverse: true, relType: candidate }
      }
    }

    // Fallback: strip "By" and check
    const baseForm = prop.slice(0, -2)
    if (knownRelTypes.has(baseForm)) {
      return { isReverse: true, relType: baseForm }
    }
  }

  // Not a reverse, treat as unknown relationship
  return { isReverse: false, relType: prop }
}

// ============================================================================
// Types
// ============================================================================

export interface SmartTraversal<T extends Thing = Thing> {
  // Execution
  ids(): Promise<string[]>
  nodes(): Promise<T[]>
  toArray(): Promise<T[]>
  count(): Promise<number>
  first(): Promise<T | null>
  exists(): Promise<boolean>

  // Modifiers
  limit(n: number): SmartTraversal<T>
  skip(n: number): SmartTraversal<T>
  where(predicate: Record<string, unknown>): SmartTraversal<T>
  depth(d: number | { min?: number; max?: number }): SmartTraversal<T>

  // Set operations
  intersect(other: SmartTraversal<T>): SmartTraversal<T>
  union(other: SmartTraversal<T>): SmartTraversal<T>
  except(other: SmartTraversal<T>): SmartTraversal<T>

  // Async iteration
  [Symbol.asyncIterator](): AsyncIterableIterator<T>

  // Chaining (via proxy)
  [key: string]: SmartTraversal<T> | ((...args: unknown[]) => SmartTraversal<T>) | unknown
}

export interface SmartGraphNode<T extends Thing = Thing> {
  id: string
  type: string
  data: Record<string, unknown>

  // $relationship -> outgoing
  // $relationshipBy -> incoming (smart reverse)
  // $out(n) -> any outgoing, n hops
  // $in(n) -> any incoming, n hops
  [key: `$${string}`]: SmartTraversal<T> | ((depth: number) => SmartTraversal<T>)
}

// ============================================================================
// Implementation
// ============================================================================

interface TraversalStep {
  relType: string | null  // null = any relationship
  direction: 'out' | 'in'
  minHops: number
  maxHops: number
}

interface TraversalState {
  engine: GraphTraversalEngine
  index: AdjacencyIndex
  startIds: string[]
  steps: TraversalStep[]
  limitVal?: number
  skipVal?: number
  whereVal?: Record<string, unknown>
  knownRelTypes: Set<string>
}

function createSmartTraversal<T extends Thing>(state: TraversalState): SmartTraversal<T> {
  const execute = async (): Promise<string[]> => {
    let currentIds = new Set(state.startIds)

    for (const step of state.steps) {
      const nextIds = new Set<string>()

      // BFS for each hop range
      for (let hop = 1; hop <= step.maxHops; hop++) {
        const hopIds = new Set<string>()

        for (const id of currentIds) {
          const edgeTypes = step.relType ? [step.relType] : undefined
          const neighbors = state.index.getNeighbors(id, step.direction, edgeTypes)
          for (const n of neighbors) {
            hopIds.add(n)
          }
        }

        if (hop >= step.minHops) {
          for (const id of hopIds) {
            nextIds.add(id)
          }
        }

        currentIds = hopIds
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

  const traversal: SmartTraversal<T> = {
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
      const nodes = await this.limit(1).nodes()
      return nodes[0] ?? null
    },

    async exists() {
      const count = await this.limit(1).count()
      return count > 0
    },

    limit(n: number) {
      return createSmartTraversal({ ...state, limitVal: n })
    },

    skip(n: number) {
      return createSmartTraversal({ ...state, skipVal: n })
    },

    where(predicate: Record<string, unknown>) {
      return createSmartTraversal({ ...state, whereVal: predicate })
    },

    depth(d: number | { min?: number; max?: number }) {
      const newSteps = [...state.steps]
      if (newSteps.length > 0) {
        const last = { ...newSteps[newSteps.length - 1] }
        if (typeof d === 'number') {
          last.minHops = d
          last.maxHops = d
        } else {
          last.minHops = d.min ?? 1
          last.maxHops = d.max ?? 10
        }
        newSteps[newSteps.length - 1] = last
      }
      return createSmartTraversal({ ...state, steps: newSteps })
    },

    intersect(other: SmartTraversal<T>) {
      return this // Simplified
    },

    union(other: SmartTraversal<T>) {
      return this
    },

    except(other: SmartTraversal<T>) {
      return this
    },

    async *[Symbol.asyncIterator]() {
      const nodes = await this.nodes()
      for (const node of nodes) {
        yield node
      }
    },
  }

  // Proxy for chaining
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

      // Handle $out(n) / $in(n) in chain
      if (prop === '$out') {
        return (depth: number) => createSmartTraversal<T>({
          ...state,
          steps: [...state.steps, { relType: null, direction: 'out', minHops: depth, maxHops: depth }],
        })
      }

      if (prop === '$in') {
        return (depth: number) => createSmartTraversal<T>({
          ...state,
          steps: [...state.steps, { relType: null, direction: 'in', minHops: depth, maxHops: depth }],
        })
      }

      // Handle $[rel] bracket syntax
      const bracketMatch = prop.match(/^\$\[(\w+)\]$/)
      if (bracketMatch) {
        const relType = bracketMatch[1]
        return createSmartTraversal<T>({
          ...state,
          steps: [...state.steps, { relType, direction: 'in', minHops: 1, maxHops: 1 }],
        })
      }

      // Handle $rel with smart reverse detection
      if (prop.startsWith('$')) {
        const relName = prop.slice(1)
        const { isReverse, relType } = detectReverse(relName, state.knownRelTypes)

        return createSmartTraversal<T>({
          ...state,
          steps: [...state.steps, {
            relType,
            direction: isReverse ? 'in' : 'out',
            minHops: 1,
            maxHops: 1,
          }],
        })
      }

      // Plain property = outgoing traversal
      return createSmartTraversal<T>({
        ...state,
        steps: [...state.steps, { relType: prop, direction: 'out', minHops: 1, maxHops: 1 }],
      })
    }
  })
}

function createSmartGraphNode<T extends Thing>(
  id: string,
  engine: GraphTraversalEngine,
  index: AdjacencyIndex,
  knownRelTypes: Set<string>,
  data?: Partial<T>
): SmartGraphNode<T> {
  const baseNode = {
    id,
    type: data?.type ?? 'Unknown',
    data: data?.data ?? {},
  }

  return new Proxy(baseNode as SmartGraphNode<T>, {
    get(target, prop: string | symbol) {
      // Return base properties
      if (prop === 'id' || prop === 'type' || prop === 'data') {
        return (target as any)[prop]
      }

      if (typeof prop === 'symbol') {
        return undefined
      }

      // Handle $out(n) - any outgoing, n hops
      if (prop === '$out') {
        return (depth: number) => createSmartTraversal<T>({
          engine,
          index,
          startIds: [id],
          steps: [{ relType: null, direction: 'out', minHops: depth, maxHops: depth }],
          knownRelTypes,
        })
      }

      // Handle $in(n) - any incoming, n hops
      if (prop === '$in') {
        return (depth: number) => createSmartTraversal<T>({
          engine,
          index,
          startIds: [id],
          steps: [{ relType: null, direction: 'in', minHops: depth, maxHops: depth }],
          knownRelTypes,
        })
      }

      // Handle $[rel] bracket syntax
      if (prop.startsWith('$[') && prop.endsWith(']')) {
        const relType = prop.slice(2, -1)
        return createSmartTraversal<T>({
          engine,
          index,
          startIds: [id],
          steps: [{ relType, direction: 'in', minHops: 1, maxHops: 1 }],
          knownRelTypes,
        })
      }

      // Handle $relationship with smart reverse detection
      if (prop.startsWith('$')) {
        const relName = prop.slice(1)
        const { isReverse, relType } = detectReverse(relName, knownRelTypes)

        return createSmartTraversal<T>({
          engine,
          index,
          startIds: [id],
          steps: [{
            relType,
            direction: isReverse ? 'in' : 'out',
            minHops: 1,
            maxHops: 1,
          }],
          knownRelTypes,
        })
      }

      return undefined
    }
  })
}

// ============================================================================
// Graph Client
// ============================================================================

export interface SmartGraph {
  node<T extends Thing = Thing>(id: string): SmartGraphNode<T>
  addRelationship(rel: Relationship): void
  addRelationships(rels: Relationship[]): void
}

export function createSmartGraph(options: { namespace: string }): SmartGraph {
  const index = new AdjacencyIndex()
  const engine = new GraphTraversalEngine(index)
  const knownRelTypes = new Set<string>()

  return {
    node<T extends Thing>(id: string) {
      return createSmartGraphNode<T>(id, engine, index, knownRelTypes)
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
 * @example Smart reverse detection
 *
 * ```typescript
 * const graph = createSmartGraph({ namespace: 'social' })
 * // Relationships: follows, likes, authored
 *
 * const user = graph.node('user-123')
 *
 * // Outgoing (normal)
 * user.$follows              // who I follow
 * user.$likes                // what I like
 * user.$authored             // what I authored
 *
 * // Incoming (smart reverse - detected from verb form!)
 * user.$followedBy           // who follows ME (reverse of 'follows')
 * user.$likedBy              // who likes MY stuff (reverse of 'likes')
 * user.$authoredBy           // who authored... (reverse of 'authored')
 *
 * // The system detects "followedBy" is the reverse form of "follows"
 * // No need for $[follows] bracket syntax!
 * ```
 */

/**
 * @example Depth traversal without predicates
 *
 * ```typescript
 * const user = graph.node('user-123')
 *
 * // Any outgoing edges, 2 hops
 * const twoHopsOut = await user.$out(2).toArray()
 *
 * // Any incoming edges, 3 hops
 * const threeHopsIn = await user.$in(3).toArray()
 *
 * // Chain: follows, then any 2 more hops
 * const extended = await user.$follows.$out(2).toArray()
 *
 * // Chain: any 2 out, then specific relationship
 * const mixed = await user.$out(2).$likes.toArray()
 *
 * // Depth range on specific relationship
 * const network = await user.$follows.depth({ min: 1, max: 3 }).toArray()
 * ```
 */

/**
 * @example Combined patterns
 *
 * ```typescript
 * // Friends of friends (specific)
 * await user.$follows.$follows.toArray()
 *
 * // 2-hop network (any edges)
 * await user.$out(2).toArray()
 *
 * // Followers of followers (smart reverse)
 * await user.$followedBy.$followedBy.toArray()
 *
 * // Mixed: my followers' likes
 * await user.$followedBy.$likes.toArray()
 *
 * // Posts liked by people 2 hops away
 * await user.$out(2).$likes.toArray()
 * ```
 */

/**
 * Visual syntax summary:
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Syntax              │  Meaning                                  │
 * ├──────────────────────────────────────────────────────────────────┤
 * │  user.$follows       │  Outgoing 'follows' edges                 │
 * │  user.$followedBy    │  Incoming 'follows' edges (smart!)        │
 * │  user.$[follows]     │  Incoming 'follows' (explicit bracket)    │
 * │  user.$out(2)        │  Any outgoing edges, 2 hops               │
 * │  user.$in(3)         │  Any incoming edges, 3 hops               │
 * │  user.$follows.depth(2) │ 'follows' edges, exactly 2 hops        │
 * └──────────────────────────────────────────────────────────────────┘
 */
