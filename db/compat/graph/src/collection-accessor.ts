/**
 * Collection Accessor - Type-based graph access
 *
 * Enables syntax like:
 * - `graph.$User()` - returns all users
 * - `graph.$User('id')` - returns specific node
 * - `graph.$User.find({...})` - query by predicate
 * - `graph.$User.where({...})` - traversal with filter
 * - `graph.$User.$stream` - streaming access
 *
 * @see Issue: dotdo-oamdb
 * @see Spike: db/compat/sql/clickhouse/spikes/graph-sdk-unified.ts
 *
 * TODO: Implement in GREEN phase
 */

// ============================================================================
// Types (exports for tests)
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
 * Traversal result - fluent interface for graph queries
 */
export interface Traversal<T extends Thing = Thing> {
  ids(): Promise<string[]>
  nodes(): Promise<T[]>
  toArray(): Promise<T[]>
  count(): Promise<number>
  first(): Promise<T | null>
  exists(): Promise<boolean>

  readonly $stream: AsyncIterable<T>
  $batch(size: number): AsyncIterable<T[]>

  [Symbol.asyncIterator](): AsyncIterableIterator<T>

  // Traversal chaining
  readonly [key: `$${string}`]: Traversal<T>
}

/**
 * GraphNode - JSON-LD style node with traversal capabilities
 */
export interface GraphNode<T extends Thing = Thing> {
  readonly $id: string
  readonly $type: string | string[]
  readonly $context?: string
  readonly $graph: CollectionGraph
  readonly data: Record<string, unknown>

  // Traversal methods
  readonly $out: (depth: number) => Traversal<T>
  readonly $in: (depth: number) => Traversal<T>
  readonly $expand: (depth: number) => Traversal<T>

  // Dynamic relationship traversal
  readonly [key: `$${string}`]: Traversal<T>
}

/**
 * TypeCollection - collection accessor for a specific type
 */
export interface TypeCollection<T extends Thing = Thing> {
  // Get all of type
  (): Promise<T[]>

  // Get by ID
  (id: string): GraphNode<T>

  // Query methods
  where(predicate: Record<string, unknown>): Traversal<T>
  find(predicate: Record<string, unknown>): Promise<T | null>

  // Streaming
  readonly $stream: AsyncIterable<T>
  $batch(size: number): AsyncIterable<T[]>
}

/**
 * CollectionGraph - main graph interface with type-based accessors
 */
export interface CollectionGraph {
  node<T extends Thing = Thing>(id: string): GraphNode<T>

  addRelationship(rel: Relationship): void
  addRelationships(rels: Relationship[]): void
  addThing(thing: Thing): void
  addThings(things: Thing[]): void

  // Dynamic type collection accessors
  readonly [key: `$${string}`]: TypeCollection
}

// ============================================================================
// Stub Implementation (RED phase - all methods throw)
// ============================================================================

/**
 * Create a collection graph instance
 *
 * TODO: Implement in GREEN phase
 */
export function createCollectionGraph(_options: { namespace: string; context?: string }): CollectionGraph {
  throw new Error('Not implemented - RED phase')
}
