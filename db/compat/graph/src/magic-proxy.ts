/**
 * Magic $ Proxy - Ergonomic graph traversal through property access
 *
 * Enables syntax like:
 * - `user.$.follows` - traverse outgoing 'follows' edges
 * - `user.$.in.follows` - traverse incoming 'follows' edges (followers)
 * - `user.$.follows.follows` - chain traversals (friends of friends)
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A Thing (node) in the graph
 */
export interface Thing {
  id: string
  type: string
  ns: string
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/**
 * A Relationship (edge) in the graph
 */
export interface Relationship {
  id: string
  type: string
  from: string
  to: string
  data: Record<string, unknown>
  createdAt: number
}

/**
 * Context providing graph data access for traversal
 */
export interface TraversalContext {
  addRelationship(rel: Relationship): void
  addThing(thing: Thing): void
  getRelationships(): Relationship[]
  getThing(id: string): Thing | undefined
  getThings(ids: string[]): Thing[]
}

/**
 * Direction of edge traversal
 */
type Direction = 'out' | 'in'

/**
 * Internal state for a traversal
 */
interface TraversalState {
  ctx: TraversalContext
  sourceIds: string[]
  steps: TraversalStep[]
  skipCount: number
  limitCount: number | undefined
}

interface TraversalStep {
  relType: string
  direction: Direction
}

// ============================================================================
// MagicTraversal Interface
// ============================================================================

/**
 * MagicTraversal provides both traversal methods and dynamic property access
 * for relationship types
 */
export interface MagicTraversal {
  // Termination methods
  ids(): Promise<string[]>
  nodes(): Promise<Thing[]>
  toArray(): Promise<Thing[]>
  count(): Promise<number>
  first(): Promise<Thing | null>
  exists(): Promise<boolean>

  // Pagination methods
  limit(n: number): MagicTraversal
  skip(n: number): MagicTraversal

  // Direction modifier
  in: MagicTraversal

  // Async iteration
  [Symbol.asyncIterator](): AsyncIterableIterator<Thing>

  // Dynamic property access for relationship types
  // Union includes all method return types for type compatibility
  [relType: string]: MagicTraversal | ((...args: unknown[]) => unknown) | ((n: number) => MagicTraversal) | Promise<string[]> | Promise<Thing[]> | Promise<number> | Promise<Thing | null> | Promise<boolean> | (() => AsyncIterableIterator<Thing>)
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Execute traversal steps and return resulting node IDs
 */
function executeTraversal(state: TraversalState): string[] {
  const { ctx, sourceIds, steps, skipCount, limitCount } = state
  const relationships = ctx.getRelationships()

  let currentIds = new Set(sourceIds)

  for (const step of steps) {
    const nextIds = new Set<string>()

    for (const id of currentIds) {
      for (const rel of relationships) {
        if (rel.type !== step.relType) continue

        if (step.direction === 'out') {
          if (rel.from === id) {
            nextIds.add(rel.to)
          }
        } else {
          // direction === 'in'
          if (rel.to === id) {
            nextIds.add(rel.from)
          }
        }
      }
    }

    currentIds = nextIds
  }

  let result = [...currentIds]

  // Apply skip
  if (skipCount > 0) {
    result = result.slice(skipCount)
  }

  // Apply limit
  if (limitCount !== undefined) {
    result = result.slice(0, limitCount)
  }

  return result
}

/**
 * Create a traversal proxy with given state
 */
function createTraversalProxy(state: TraversalState): MagicTraversal {
  // Methods that should NOT be treated as relationship types
  const reservedMethods = new Set([
    'ids',
    'nodes',
    'toArray',
    'count',
    'first',
    'exists',
    'limit',
    'skip',
    'in',
    'then',
    'catch',
    'finally',
  ])

  const handler: ProxyHandler<object> = {
    get(_target, prop: string | symbol): unknown {
      // Handle Symbol.asyncIterator
      if (prop === Symbol.asyncIterator) {
        return async function* (): AsyncIterableIterator<Thing> {
          const ids = executeTraversal(state)
          const nodes = state.ctx.getThings(ids)
          for (const node of nodes) {
            yield node
          }
        }
      }

      // Non-string properties
      if (typeof prop !== 'string') {
        return undefined
      }

      // Handle 'in' - returns a proxy that uses 'in' direction
      if (prop === 'in') {
        return createInDirectionProxy(state)
      }

      // Handle termination methods
      if (prop === 'ids') {
        return async (): Promise<string[]> => {
          return executeTraversal(state)
        }
      }

      if (prop === 'nodes' || prop === 'toArray') {
        return async (): Promise<Thing[]> => {
          const ids = executeTraversal(state)
          return state.ctx.getThings(ids)
        }
      }

      if (prop === 'count') {
        return async (): Promise<number> => {
          const ids = executeTraversal(state)
          return ids.length
        }
      }

      if (prop === 'first') {
        return async (): Promise<Thing | null> => {
          const limitedState = { ...state, limitCount: 1 }
          const ids = executeTraversal(limitedState)
          if (ids.length === 0) return null
          const things = state.ctx.getThings(ids)
          return things[0] ?? null
        }
      }

      if (prop === 'exists') {
        return async (): Promise<boolean> => {
          const ids = executeTraversal(state)
          return ids.length > 0
        }
      }

      // Handle pagination methods
      if (prop === 'limit') {
        return (n: number): MagicTraversal => {
          const newState: TraversalState = {
            ...state,
            limitCount: n,
          }
          return createTraversalProxy(newState)
        }
      }

      if (prop === 'skip') {
        return (n: number): MagicTraversal => {
          const newState: TraversalState = {
            ...state,
            skipCount: n,
          }
          return createTraversalProxy(newState)
        }
      }

      // Any other property is treated as a relationship type
      const newState: TraversalState = {
        ...state,
        steps: [...state.steps, { relType: prop, direction: 'out' }],
        skipCount: 0,
        limitCount: undefined,
      }
      return createTraversalProxy(newState)
    },
  }

  return new Proxy({}, handler) as MagicTraversal
}

/**
 * Create a proxy for the 'in' direction that captures the next property access
 * as a relationship type with 'in' direction
 */
function createInDirectionProxy(state: TraversalState): MagicTraversal {
  const handler: ProxyHandler<object> = {
    get(_target, prop: string | symbol): unknown {
      if (typeof prop !== 'string') {
        return undefined
      }

      // Any property access after .in is a relationship type with 'in' direction
      const newState: TraversalState = {
        ...state,
        steps: [...state.steps, { relType: prop, direction: 'in' }],
        skipCount: 0,
        limitCount: undefined,
      }
      return createTraversalProxy(newState)
    },
  }

  return new Proxy({}, handler) as MagicTraversal
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a magic proxy for graph traversal starting from given node IDs
 *
 * @param ctx - The traversal context providing graph data access
 * @param startIds - Array of node IDs to start traversal from
 * @returns A MagicTraversal proxy
 *
 * @example
 * const $ = createMagicProxy(ctx, ['alice'])
 * const followingIds = await $.follows.ids()
 * const followers = await $.in.follows.nodes()
 * const fof = await $.follows.follows.toArray()
 */
export function createMagicProxy(
  ctx: TraversalContext,
  startIds: string[]
): MagicTraversal {
  const state: TraversalState = {
    ctx,
    sourceIds: startIds,
    steps: [],
    skipCount: 0,
    limitCount: undefined,
  }

  return createTraversalProxy(state)
}
