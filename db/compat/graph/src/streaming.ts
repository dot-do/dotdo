/**
 * Streaming Interface - Memory-efficient iteration for graph traversals
 *
 * Provides $stream and $batch(n) interfaces for processing large result sets
 * without loading everything into memory.
 *
 * @see Issue dotdo-r22hl
 * @see db/compat/sql/clickhouse/spikes/graph-sdk-unified.ts for API design
 *
 * THIS IS A STUB FILE - Implementation pending (RED phase)
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
 * Context providing graph data access for streaming traversal
 */
export interface StreamingContext {
  addRelationship(rel: Relationship): void
  addThing(thing: Thing): void
  getRelationships(): Relationship[]
  getThing(id: string): Thing | undefined
  getThings(ids: string[]): Thing[]
  streamThings(ids: string[]): AsyncIterableIterator<Thing>
  streamThingsBatched(ids: string[], batchSize: number): AsyncIterableIterator<Thing[]>
}

/**
 * Streaming traversal interface with $stream and $batch support
 */
export interface StreamingTraversal {
  // Standard traversal methods
  ids(): Promise<string[]>
  nodes(): Promise<Thing[]>
  toArray(): Promise<Thing[]>
  count(): Promise<number>
  first(): Promise<Thing | null>
  exists(): Promise<boolean>

  // Pagination
  limit(n: number): StreamingTraversal
  skip(n: number): StreamingTraversal

  // Filtering
  where(predicate: Record<string, unknown>): StreamingTraversal

  // Streaming interface
  readonly $stream: AsyncIterable<Thing>
  $batch(size: number): AsyncIterable<Thing[]>

  // Native async iteration
  [Symbol.asyncIterator](): AsyncIterableIterator<Thing>

  // Set operations
  intersect(other: StreamingTraversal): StreamingTraversal
  union(other: StreamingTraversal): StreamingTraversal
  except(other: StreamingTraversal): StreamingTraversal

  // Direction modifier
  in: StreamingTraversal

  // Type collection accessor
  readonly [key: `$${string}`]: TypeCollectionAccessor

  // Relationship traversal via property access
  [relType: string]: StreamingTraversal | ((...args: unknown[]) => unknown)
}

/**
 * Type collection accessor for $Type pattern
 */
export interface TypeCollectionAccessor {
  readonly $stream: AsyncIterable<Thing>
  $batch(size: number): AsyncIterable<Thing[]>
  [Symbol.asyncIterator](): AsyncIterableIterator<Thing>
}

// ============================================================================
// Implementation Stub
// ============================================================================

/**
 * Create a streaming traversal - STUB IMPLEMENTATION
 *
 * TODO: Implement in GREEN phase
 */
export function createStreamingTraversal(
  _ctx: StreamingContext,
  _startIds: string[]
): StreamingTraversal {
  // Stub: throws to make tests fail
  throw new Error('createStreamingTraversal not implemented - RED phase stub')
}
