/**
 * SPIKE: $prefix Graph SDK Syntax
 *
 * New syntax where $ prefixes the relationship name:
 * - user.$follows        → outgoing 'follows' edges
 * - user.$[follows]      → incoming 'follows' edges (reverse lookup)
 * - user.$follows.likes  → chain naturally
 *
 * The bracket notation $[rel] = "reverse lookup" like array indexing
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

export interface GraphNode<T extends Thing = Thing> {
  id: string
  type: string
  data: Record<string, unknown>

  // Any $property becomes a traversal
  // $[property] becomes a reverse traversal
  [key: `$${string}`]: DollarTraversal<T>
}

export interface DollarTraversal<T extends Thing = Thing> {
  // Chain more relationships
  [key: string]: DollarTraversal<T>

  // Execution
  ids(): Promise<string[]>
  nodes(): Promise<T[]>
  toArray(): Promise<T[]>
  count(): Promise<number>
  first(): Promise<T | null>
  exists(): Promise<boolean>

  // Modifiers
  limit(n: number): DollarTraversal<T>
  skip(n: number): DollarTraversal<T>
  where(predicate: Record<string, unknown>): DollarTraversal<T>

  // Set operations
  intersect(other: DollarTraversal<T>): DollarTraversal<T>
  union(other: DollarTraversal<T>): DollarTraversal<T>
  except(other: DollarTraversal<T>): DollarTraversal<T>

  // Async iteration
  [Symbol.asyncIterator](): AsyncIterableIterator<T>
}

// ============================================================================
// Implementation
// ============================================================================

interface TraversalStep {
  relType: string
  direction: 'out' | 'in'
}

interface TraversalState {
  engine: GraphTraversalEngine
  index: AdjacencyIndex
  startIds: string[]
  steps: TraversalStep[]
  limitVal?: number
  skipVal?: number
  whereVal?: Record<string, unknown>
}

function createDollarTraversal<T extends Thing>(state: TraversalState): DollarTraversal<T> {
  const execute = async (): Promise<string[]> => {
    let currentIds = new Set(state.startIds)

    for (const step of state.steps) {
      const nextIds = new Set<string>()

      for (const id of currentIds) {
        const neighbors = state.index.getNeighbors(id, step.direction, [step.relType])
        for (const n of neighbors) {
          nextIds.add(n)
        }
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

  const traversal: DollarTraversal<T> = {
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
      return createDollarTraversal({ ...state, limitVal: n })
    },

    skip(n: number) {
      return createDollarTraversal({ ...state, skipVal: n })
    },

    where(predicate: Record<string, unknown>) {
      return createDollarTraversal({ ...state, whereVal: predicate })
    },

    intersect(other: DollarTraversal<T>) {
      // Simplified: would need proper implementation
      return this
    },

    union(other: DollarTraversal<T>) {
      return this
    },

    except(other: DollarTraversal<T>) {
      return this
    },

    async *[Symbol.asyncIterator]() {
      const nodes = await this.nodes()
      for (const node of nodes) {
        yield node
      }
    },
  }

  // Proxy to handle property access for chaining
  return new Proxy(traversal, {
    get(target, prop: string | symbol) {
      // Return built-in methods
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

      // Handle $[rel] syntax for reverse lookup in chain
      const bracketMatch = prop.match(/^\$\[(\w+)\]$/)
      if (bracketMatch) {
        const relType = bracketMatch[1]
        return createDollarTraversal<T>({
          ...state,
          steps: [...state.steps, { relType, direction: 'in' }],
        })
      }

      // Handle $rel syntax for outgoing in chain
      if (prop.startsWith('$')) {
        const relType = prop.slice(1)
        return createDollarTraversal<T>({
          ...state,
          steps: [...state.steps, { relType, direction: 'out' }],
        })
      }

      // Chain another relationship (outgoing) - plain property name
      return createDollarTraversal<T>({
        ...state,
        steps: [...state.steps, { relType: prop, direction: 'out' }],
      })
    }
  })
}

function createGraphNode<T extends Thing>(
  id: string,
  engine: GraphTraversalEngine,
  index: AdjacencyIndex,
  data?: Partial<T>
): GraphNode<T> {
  const baseNode = {
    id,
    type: data?.type ?? 'Unknown',
    data: data?.data ?? {},
  }

  return new Proxy(baseNode as GraphNode<T>, {
    get(target, prop: string | symbol) {
      // Return base properties
      if (prop === 'id' || prop === 'type' || prop === 'data') {
        return (target as any)[prop]
      }

      if (typeof prop === 'symbol') {
        return undefined
      }

      // Handle $relationship (outgoing)
      if (prop.startsWith('$')) {
        // Check for $[rel] syntax (reverse lookup)
        const bracketMatch = prop.match(/^\$\[(\w+)\]$/)
        if (bracketMatch) {
          const relType = bracketMatch[1]
          return createDollarTraversal<T>({
            engine,
            index,
            startIds: [id],
            steps: [{ relType, direction: 'in' }],
          })
        }

        // Regular $rel syntax (outgoing)
        const relType = prop.slice(1) // Remove $
        return createDollarTraversal<T>({
          engine,
          index,
          startIds: [id],
          steps: [{ relType, direction: 'out' }],
        })
      }

      return undefined
    }
  })
}

// ============================================================================
// Graph Client
// ============================================================================

export interface DollarGraph {
  node<T extends Thing = Thing>(id: string): GraphNode<T>
  addRelationship(rel: Relationship): void
  addRelationships(rels: Relationship[]): void
}

export function createDollarGraph(options: { namespace: string }): DollarGraph {
  const index = new AdjacencyIndex()
  const engine = new GraphTraversalEngine(index)

  return {
    node<T extends Thing>(id: string) {
      return createGraphNode<T>(id, engine, index)
    },

    addRelationship(rel: Relationship) {
      index.addEdge(rel)
    },

    addRelationships(rels: Relationship[]) {
      for (const rel of rels) {
        index.addEdge(rel)
      }
    },
  }
}

// ============================================================================
// Usage Examples
// ============================================================================

/**
 * @example Basic syntax comparison
 *
 * ```typescript
 * // OLD: $.property syntax
 * user.$.follows
 * user.$.follows.likes
 * user.$.in.follows
 * user.$.follows.in.likes
 *
 * // NEW: $property syntax
 * user.$follows
 * user.$follows.likes
 * user.$[follows]           // ← bracket = reverse lookup
 * user.$follows.$[likes]    // ← reverse mid-chain
 * ```
 */

/**
 * @example Social network queries
 *
 * ```typescript
 * const graph = createDollarGraph({ namespace: 'social' })
 * const user = graph.node('user-123')
 *
 * // Who I follow
 * const following = await user.$follows.toArray()
 *
 * // Who follows me (reverse lookup)
 * const followers = await user.$[follows].toArray()
 *
 * // Friends of friends
 * const fof = await user.$follows.$follows.toArray()
 *
 * // Posts liked by people I follow
 * const posts = await user.$follows.$likes.toArray()
 *
 * // People who liked my posts (reverse chain)
 * const likers = await user.$authored.$[likes].toArray()
 *
 * // Mutual friends
 * const me = graph.node('me')
 * const them = graph.node('them')
 * const mutual = await me.$follows.intersect(them.$follows).toArray()
 *
 * // Friend suggestions (FoF who aren't friends)
 * const suggestions = await me.$follows.$follows
 *   .except(me.$follows)
 *   .limit(10)
 *   .toArray()
 * ```
 */

/**
 * @example E-commerce queries
 *
 * ```typescript
 * const product = graph.node('product-456')
 *
 * // Who bought this product
 * const buyers = await product.$[purchased].toArray()
 *
 * // Products bought by people who bought this
 * const alsoBought = await product.$[purchased].$purchased.toArray()
 *
 * // Reviews for this product
 * const reviews = await product.$[reviewed].toArray()
 *
 * // Categories this product belongs to
 * const categories = await product.$inCategory.toArray()
 *
 * // All products in same categories
 * const related = await product.$inCategory.$[inCategory].toArray()
 * ```
 */

/**
 * @example Content/media queries
 *
 * ```typescript
 * const article = graph.node('article-789')
 *
 * // Author of article
 * const author = await article.$author.first()
 *
 * // Comments on article
 * const comments = await article.$[commentOn].toArray()
 *
 * // People mentioned in article
 * const mentioned = await article.$mentions.toArray()
 *
 * // Articles that mention the same people
 * const related = await article.$mentions.$[mentions].toArray()
 * ```
 */

/**
 * @example Organization hierarchy
 *
 * ```typescript
 * const employee = graph.node('emp-123')
 *
 * // Direct manager
 * const manager = await employee.$reportsTo.first()
 *
 * // Direct reports (reverse)
 * const reports = await employee.$[reportsTo].toArray()
 *
 * // All reports recursively (with depth)
 * // const allReports = await employee.$[reportsTo].depth({ max: 10 }).toArray()
 *
 * // Teammates (same manager)
 * const teammates = await employee.$reportsTo.$[reportsTo]
 *   .except([employee.id])
 *   .toArray()
 * ```
 */

/**
 * Visual comparison:
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Pattern              │  Old ($.prop)        │  New ($prop)     │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  Outgoing            │  user.$.follows      │  user.$follows   │
 * │  Incoming (reverse)  │  user.$.in.follows   │  user.$[follows] │
 * │  Chain               │  user.$.follows.likes│  user.$follows.likes│
 * │  Mixed direction     │  user.$.follows.in.x │  user.$follows.$[x]│
 * │  Properties          │  user.id             │  user.id         │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * The bracket notation $[rel] reads as "reverse lookup" or "who has this rel to me"
 */
