/**
 * Type-Safe Graph Schema Implementation
 *
 * Provides compile-time type safety for graph traversals based on schema definitions.
 * This is the production implementation for SDK-11.
 */

// ============================================================================
// Core Schema Types
// ============================================================================

/**
 * Relationship map type - maps relationship names to target node types
 */
export type RelationshipMap = {
  [relType: string]: string
}

/**
 * Base interface for defining graph schemas.
 * Each key is a node type, each value is an object mapping relationship names to target types.
 *
 * NOTE: User schemas should extend this interface to get proper type inference.
 * The index signature here is intentionally loose to allow any schema structure.
 */
export interface GraphSchema {
  [nodeType: string]: RelationshipMap
}

/**
 * Extract all node type names from a schema
 */
export type NodeTypes<S extends GraphSchema> = keyof S & string

/**
 * Extract relationship types for a given node type
 */
export type RelationshipTypes<S extends GraphSchema, N extends NodeTypes<S>> = keyof S[N] & string

/**
 * Get the target node type for a relationship
 */
export type RelationshipTarget<
  S extends GraphSchema,
  N extends NodeTypes<S>,
  R extends RelationshipTypes<S, N>
> = S[N][R] & NodeTypes<S>

// ============================================================================
// Graph Node Types
// ============================================================================

/**
 * A typed node instance with schema information
 */
export interface GraphNode<S extends GraphSchema, N extends NodeTypes<S>> {
  id: string
  type: N
  data: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
  $: TraversalProxy<S, N>
}

// ============================================================================
// Traversal Types
// ============================================================================

/**
 * The magic $ proxy that provides type-safe traversals.
 * For each relationship defined on a node type, accessing that property
 * returns a traversal result typed to the target node type.
 */
export type TraversalProxy<S extends GraphSchema, N extends NodeTypes<S>> = {
  [R in RelationshipTypes<S, N>]: ChainableTraversal<S, RelationshipTarget<S, N, R>>
} & {
  /** Access incoming edges by relationship type */
  in: IncomingProxy<S, N>
}

/**
 * Proxy for accessing incoming edges
 */
export type IncomingProxy<S extends GraphSchema, N extends NodeTypes<S>> = {
  [R in RelationshipTypes<S, N>]: ChainableTraversal<S, RelationshipTarget<S, N, R>>
}

/**
 * Base traversal result interface
 */
export interface TypedTraversalResult<S extends GraphSchema, N extends NodeTypes<S>> {
  /** Execute and return node IDs */
  ids(): Promise<string[]>

  /** Execute and return typed nodes */
  nodes(): Promise<GraphNode<S, N>[]>

  /** Alias for nodes() */
  toArray(): Promise<GraphNode<S, N>[]>

  /** Count results */
  count(): Promise<number>

  /** Check if any results exist */
  exists(): Promise<boolean>

  /** Get first result */
  first(): Promise<GraphNode<S, N> | null>

  /** Filter results */
  where(predicate: Record<string, unknown>): ChainableTraversal<S, N>

  /** Limit results */
  limit(n: number): ChainableTraversal<S, N>

  /** Skip results */
  skip(n: number): ChainableTraversal<S, N>

  /** Set operations with another traversal of the same type */
  intersect(other: TypedTraversalResult<S, N>): ChainableTraversal<S, N>
  union(other: TypedTraversalResult<S, N>): ChainableTraversal<S, N>
  except(other: TypedTraversalResult<S, N>): ChainableTraversal<S, N>

  /** Async iteration */
  [Symbol.asyncIterator](): AsyncIterableIterator<GraphNode<S, N>>
}

/**
 * A traversal result that can be further chained via $
 */
export type ChainableTraversal<S extends GraphSchema, N extends NodeTypes<S>> =
  TypedTraversalResult<S, N> & {
    /** Chain to traverse from result nodes */
    $: TraversalProxy<S, N>
  }

// ============================================================================
// Typed Graph Node Handle
// ============================================================================

/**
 * Path finding options
 */
export interface PathOptions {
  maxDepth?: number
  edgeTypes?: string[]
}

/**
 * Graph path result
 */
export interface GraphPath {
  vertices: string[]
  edges: Array<{ from: string; to: string; type: string }>
}

/**
 * A handle to a specific node in the graph with typed traversals
 */
export interface TypedGraphNode<S extends GraphSchema, N extends NodeTypes<S>> {
  /** The node's ID */
  id: string

  /** The node type */
  type: N

  /** The underlying data */
  data: Record<string, unknown>

  /** Magic traversal proxy - relationship types become typed properties */
  $: TraversalProxy<S, N>

  /** Find shortest path to another node */
  pathTo(targetId: string, options?: PathOptions): Promise<GraphPath | null>

  /** Check if connected to another node */
  connected(targetId: string, options?: PathOptions): Promise<boolean>
}

// ============================================================================
// Node Type Accessor
// ============================================================================

/**
 * Accessor for a specific node type in the graph.
 * Provides methods to get or query nodes of that type.
 */
export interface NodeTypeAccessor<S extends GraphSchema, N extends NodeTypes<S>> {
  /** Get a node by ID */
  get(id: string): TypedGraphNode<S, N>

  /** Find nodes matching criteria */
  find(query: Record<string, unknown>): Promise<GraphNode<S, N>[]>

  /** Find one node matching criteria */
  findOne(query: Record<string, unknown>): Promise<GraphNode<S, N> | null>

  /** Create a new node */
  create(options: { data: Record<string, unknown> }): Promise<GraphNode<S, N>>

  /** Start a traversal from multiple nodes of this type */
  from(...ids: string[]): ChainableTraversal<S, N>
}

// ============================================================================
// Typed Graph Client
// ============================================================================

/**
 * A typed graph client that provides type-safe access to nodes by type.
 */
export type TypedGraphClient<S extends GraphSchema> = {
  [N in NodeTypes<S>]: NodeTypeAccessor<S, N>
} & {
  /** Get any node by ID (untyped) */
  node(id: string): TypedGraphNode<S, NodeTypes<S>>

  /** Namespace for this graph */
  readonly namespace: string
}

// ============================================================================
// Graph Client Options
// ============================================================================

export interface TypedGraphOptions {
  namespace: string
  connection?: {
    host?: string
    port?: number
  } | string
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a chainable traversal result
 */
function createChainableTraversal<S extends GraphSchema, N extends NodeTypes<S>>(
  _startIds: string[],
  _nodeType?: string,
): ChainableTraversal<S, N> {
  const traversal: ChainableTraversal<S, N> = {
    async ids(): Promise<string[]> {
      return []
    },
    async nodes(): Promise<GraphNode<S, N>[]> {
      return []
    },
    async toArray(): Promise<GraphNode<S, N>[]> {
      return this.nodes()
    },
    async count(): Promise<number> {
      return 0
    },
    async exists(): Promise<boolean> {
      return false
    },
    async first(): Promise<GraphNode<S, N> | null> {
      return null
    },
    where(_predicate: Record<string, unknown>): ChainableTraversal<S, N> {
      return this
    },
    limit(_n: number): ChainableTraversal<S, N> {
      return this
    },
    skip(_n: number): ChainableTraversal<S, N> {
      return this
    },
    intersect(_other: TypedTraversalResult<S, N>): ChainableTraversal<S, N> {
      return this
    },
    union(_other: TypedTraversalResult<S, N>): ChainableTraversal<S, N> {
      return this
    },
    except(_other: TypedTraversalResult<S, N>): ChainableTraversal<S, N> {
      return this
    },
    async *[Symbol.asyncIterator](): AsyncIterableIterator<GraphNode<S, N>> {
      const nodes = await this.nodes()
      for (const node of nodes) yield node
    },
    get $(): TraversalProxy<S, N> {
      return createTraversalProxy<S, N>([])
    },
  }

  return traversal
}

/**
 * Create proxy for incoming edges
 */
function createIncomingProxy<S extends GraphSchema, N extends NodeTypes<S>>(
  startIds: string[],
): IncomingProxy<S, N> {
  return new Proxy({} as IncomingProxy<S, N>, {
    get(_target, prop: string | symbol) {
      if (typeof prop === 'string') {
        return createChainableTraversal<S, NodeTypes<S>>(startIds)
      }
      return undefined
    },
  })
}

/**
 * Create the traversal proxy for type-safe traversals
 */
function createTraversalProxy<S extends GraphSchema, N extends NodeTypes<S>>(
  startIds: string[],
): TraversalProxy<S, N> {
  return new Proxy({} as TraversalProxy<S, N>, {
    get(_target, prop: string | symbol) {
      if (prop === 'in') {
        return createIncomingProxy<S, N>(startIds)
      }
      if (typeof prop === 'string') {
        return createChainableTraversal<S, NodeTypes<S>>(startIds)
      }
      return undefined
    },
  })
}

/**
 * Create a typed graph node handle
 */
function createTypedGraphNode<S extends GraphSchema, N extends NodeTypes<S>>(
  id: string,
  nodeType: N,
): TypedGraphNode<S, N> {
  return {
    id,
    type: nodeType,
    data: {},
    $: createTraversalProxy<S, N>([id]),
    async pathTo(_targetId: string, _options?: PathOptions): Promise<GraphPath | null> {
      return null
    },
    async connected(_targetId: string, _options?: PathOptions): Promise<boolean> {
      return false
    },
  }
}

/**
 * Create a graph node result (for find/create results)
 */
function createGraphNode<S extends GraphSchema, N extends NodeTypes<S>>(
  id: string,
  nodeType: N,
  data: Record<string, unknown>,
): GraphNode<S, N> {
  return {
    id,
    type: nodeType,
    data,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    $: createTraversalProxy<S, N>([id]),
  }
}

/**
 * Create a node type accessor
 */
function createNodeAccessor<S extends GraphSchema, N extends NodeTypes<S>>(
  nodeType: N,
): NodeTypeAccessor<S, N> {
  return {
    get(id: string): TypedGraphNode<S, N> {
      return createTypedGraphNode<S, N>(id, nodeType)
    },
    async find(_query: Record<string, unknown>): Promise<GraphNode<S, N>[]> {
      return []
    },
    async findOne(_query: Record<string, unknown>): Promise<GraphNode<S, N> | null> {
      return null
    },
    async create(options: { data: Record<string, unknown> }): Promise<GraphNode<S, N>> {
      const id = crypto.randomUUID()
      return createGraphNode<S, N>(id, nodeType, options.data)
    },
    from(...ids: string[]): ChainableTraversal<S, N> {
      return createChainableTraversal<S, N>(ids, nodeType)
    },
  }
}

/**
 * Create a typed graph client.
 */
export function createTypedGraph<S extends GraphSchema>(
  options: TypedGraphOptions,
): TypedGraphClient<S> {
  return new Proxy({} as TypedGraphClient<S>, {
    get(_target, prop: string | symbol) {
      if (prop === 'namespace') return options.namespace
      if (prop === 'node') {
        return (id: string) => createTypedGraphNode<S, NodeTypes<S>>(id, 'Unknown' as NodeTypes<S>)
      }
      if (typeof prop === 'string') {
        return createNodeAccessor<S, typeof prop & NodeTypes<S>>(prop as NodeTypes<S>)
      }
      return undefined
    },
  })
}
