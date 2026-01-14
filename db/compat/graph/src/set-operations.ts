/**
 * SDK-8: Set Operations - Production Implementation
 *
 * Graph traversal SDK with set operations (intersect, union, except).
 * This implements the GREEN phase of TDD - minimal code to pass all tests.
 */

// ============================================================================
// Types
// ============================================================================

export interface Thing {
  id: string
  type: string
  ns: string
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface Relationship {
  id: string
  type: string
  from: string
  to: string
  data?: Record<string, unknown>
  createdAt: number
}

export interface GraphOptions {
  namespace: string
}

// ============================================================================
// Traversal - Core traversal class with set operations
// ============================================================================

export class Traversal<T extends Thing = Thing> implements AsyncIterable<T> {
  constructor(
    protected graph: Graph,
    protected startIds: string[],
    protected steps: TraversalStep[] = []
  ) {}

  /**
   * Clone the traversal with additional steps
   */
  protected clone(additionalSteps: TraversalStep[] = []): Traversal<T> {
    return new Traversal<T>(this.graph, this.startIds, [...this.steps, ...additionalSteps])
  }

  /**
   * Add outgoing traversal step
   */
  out(relType: string): MagicTraversal<T> {
    const newTraversal = this.clone([{ type: 'traverse', direction: 'out', relType }])
    return createMagicProxy(newTraversal) as MagicTraversal<T>
  }

  /**
   * Add incoming traversal step
   */
  in(relType: string): MagicTraversal<T> {
    const newTraversal = this.clone([{ type: 'traverse', direction: 'in', relType }])
    return createMagicProxy(newTraversal) as MagicTraversal<T>
  }

  /**
   * Limit results
   */
  limit(n: number): MagicTraversal<T> {
    const newTraversal = this.clone([{ type: 'limit', count: n }])
    return createMagicProxy(newTraversal) as MagicTraversal<T>
  }

  /**
   * Intersect with another traversal or array of IDs
   */
  intersect(other: Traversal<T> | string[]): MagicTraversal<T> {
    const newTraversal = this.clone([{ type: 'intersect', other }])
    return createMagicProxy(newTraversal) as MagicTraversal<T>
  }

  /**
   * Union with another traversal or array of IDs
   */
  union(other: Traversal<T> | string[]): MagicTraversal<T> {
    const newTraversal = this.clone([{ type: 'union', other }])
    return createMagicProxy(newTraversal) as MagicTraversal<T>
  }

  /**
   * Exclude nodes from another traversal or array of IDs
   */
  except(other: Traversal<T> | string[]): MagicTraversal<T> {
    const newTraversal = this.clone([{ type: 'except', other }])
    return createMagicProxy(newTraversal) as MagicTraversal<T>
  }

  /**
   * Execute traversal and return node IDs
   */
  async ids(): Promise<string[]> {
    let currentIds = new Set(this.startIds)

    for (const step of this.steps) {
      switch (step.type) {
        case 'traverse': {
          const nextIds = new Set<string>()
          for (const id of currentIds) {
            const neighbors = this.graph.getNeighbors(id, step.direction, step.relType)
            for (const neighbor of neighbors) {
              nextIds.add(neighbor)
            }
          }
          currentIds = nextIds
          break
        }
        case 'limit': {
          const arr = [...currentIds]
          currentIds = new Set(arr.slice(0, step.count))
          break
        }
        case 'intersect': {
          const otherIds = new Set(
            Array.isArray(step.other) ? step.other : await step.other.ids()
          )
          currentIds = new Set([...currentIds].filter(id => otherIds.has(id)))
          break
        }
        case 'union': {
          const otherIds = Array.isArray(step.other) ? step.other : await step.other.ids()
          for (const id of otherIds) {
            currentIds.add(id)
          }
          break
        }
        case 'except': {
          const otherIds = new Set(
            Array.isArray(step.other) ? step.other : await step.other.ids()
          )
          currentIds = new Set([...currentIds].filter(id => !otherIds.has(id)))
          break
        }
      }
    }

    return [...currentIds]
  }

  /**
   * Execute traversal and return node objects
   */
  async nodes(): Promise<T[]> {
    const ids = await this.ids()
    // Return stub node objects (in a real implementation, this would fetch from storage)
    return ids.map(id => ({
      id,
      type: 'Unknown',
      ns: this.graph.namespace,
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as T))
  }

  /**
   * Alias for nodes()
   */
  async toArray(): Promise<T[]> {
    return this.nodes()
  }

  /**
   * Count results
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

// ============================================================================
// Traversal Step Types
// ============================================================================

type TraversalStep =
  | { type: 'traverse'; direction: 'out' | 'in'; relType: string }
  | { type: 'limit'; count: number }
  | { type: 'intersect'; other: Traversal | string[] }
  | { type: 'union'; other: Traversal | string[] }
  | { type: 'except'; other: Traversal | string[] }

// ============================================================================
// Magic Traversal - Proxy-based relationship access
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
function createMagicProxy<T extends Thing>(traversal: Traversal<T>): MagicTraversal<T> {
  const traversalMethods = new Set([
    'out', 'in', 'limit', 'intersect', 'union', 'except',
    'ids', 'nodes', 'toArray', 'count', 'exists', 'first',
    'then', 'catch', 'finally',
    Symbol.asyncIterator, Symbol.toStringTag,
  ])

  return new Proxy(traversal as MagicTraversal<T>, {
    get(target, prop: string | symbol) {
      // Handle symbols
      if (typeof prop === 'symbol') {
        const value = (target as any)[prop]
        if (typeof value === 'function') {
          return value.bind(target)
        }
        return value
      }

      // 'in' creates a proxy that will use incoming direction for next relationship
      if (prop === 'in') {
        return new Proxy({} as MagicTraversal<T>, {
          get(_t, relType: string | symbol) {
            if (typeof relType === 'symbol') return undefined
            const newTraversal = target.in(relType)
            return newTraversal
          }
        })
      }

      // Return actual methods from the traversal
      if (traversalMethods.has(prop) || prop in target) {
        const value = (target as any)[prop]
        if (typeof value === 'function') {
          return value.bind(target)
        }
        return value
      }

      // Any other string property is treated as a relationship type (outgoing)
      return target.out(prop)
    }
  })
}

// ============================================================================
// GraphNode - Node with magic $ traversal accessor
// ============================================================================

export interface GraphNode<T extends Thing = Thing> {
  id: string
  $: MagicTraversal<T>
}

// ============================================================================
// Graph - Main graph client
// ============================================================================

export class Graph {
  readonly namespace: string
  private outgoing: Map<string, Array<{ to: string; type: string }>> = new Map()
  private incoming: Map<string, Array<{ from: string; type: string }>> = new Map()

  constructor(options: GraphOptions) {
    this.namespace = options.namespace
  }

  /**
   * Get a graph node by ID
   */
  node<T extends Thing = Thing>(id: string): GraphNode<T> {
    const traversal = new Traversal<T>(this, [id])
    return {
      id,
      $: createMagicProxy(traversal),
    }
  }

  /**
   * Start a traversal from one or more nodes
   */
  from<T extends Thing = Thing>(...ids: string[]): MagicTraversal<T> {
    const traversal = new Traversal<T>(this, ids)
    return createMagicProxy(traversal)
  }

  /**
   * Add relationships to the graph
   */
  addRelationships(rels: Relationship[]): void {
    for (const rel of rels) {
      // Add to outgoing index
      if (!this.outgoing.has(rel.from)) {
        this.outgoing.set(rel.from, [])
      }
      this.outgoing.get(rel.from)!.push({ to: rel.to, type: rel.type })

      // Add to incoming index
      if (!this.incoming.has(rel.to)) {
        this.incoming.set(rel.to, [])
      }
      this.incoming.get(rel.to)!.push({ from: rel.from, type: rel.type })
    }
  }

  /**
   * Get neighbors of a node
   */
  getNeighbors(id: string, direction: 'out' | 'in', relType?: string): string[] {
    if (direction === 'out') {
      const edges = this.outgoing.get(id) ?? []
      const filtered = relType ? edges.filter(e => e.type === relType) : edges
      return filtered.map(e => e.to)
    } else {
      const edges = this.incoming.get(id) ?? []
      const filtered = relType ? edges.filter(e => e.type === relType) : edges
      return filtered.map(e => e.from)
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new graph client
 */
export function createGraph(options: GraphOptions): Graph {
  return new Graph(options)
}
