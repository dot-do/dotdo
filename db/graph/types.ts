/**
 * Graph Module - Common Types
 *
 * This file contains shared types and interfaces for the DO Graph data model.
 * The graph module provides a unified way to work with Things (nodes) and
 * Relationships (edges) in a graph structure.
 *
 * @module db/graph/types
 */

import type { GraphThing, NewGraphThing, GetThingsByTypeOptions, UpdateThingInput } from './things'
import type { GraphRelationship, CreateRelationshipInput, RelationshipQueryOptions } from './relationships'

// ============================================================================
// RE-EXPORT COMPONENT TYPES
// ============================================================================

// Re-export for convenience
export type { GraphThing, NewGraphThing, GetThingsByTypeOptions, UpdateThingInput }
export type { GraphRelationship, CreateRelationshipInput, RelationshipQueryOptions }

// ============================================================================
// GRAPH NODE AND EDGE ALIASES
// ============================================================================

/**
 * GraphNode is an alias for GraphThing - represents a node in the graph.
 * In the DO Graph model, nodes are Things (instances of Nouns/types).
 */
export type GraphNode = GraphThing

/**
 * GraphEdge is an alias for GraphRelationship - represents an edge in the graph.
 * In the DO Graph model, edges are Relationships with verb-based predicates.
 */
export type GraphEdge = GraphRelationship

// ============================================================================
// GRAPHSTORE INTERFACE
// ============================================================================

/**
 * GraphStore provides an abstract interface for graph storage backends.
 *
 * This interface allows different storage implementations (in-memory, SQLite,
 * Durable Objects) to be used interchangeably while maintaining the same API.
 *
 * @example
 * ```typescript
 * const store: GraphStore = new DOGraphStore(ctx)
 *
 * // Create a thing
 * const customer = await store.createThing({
 *   id: 'customer-alice',
 *   typeId: 1,
 *   typeName: 'Customer',
 *   data: { name: 'Alice', email: 'alice@example.com' }
 * })
 *
 * // Create a relationship
 * const rel = await store.createRelationship({
 *   id: 'rel-1',
 *   verb: 'purchased',
 *   from: 'do://tenant/customers/alice',
 *   to: 'do://tenant/products/widget'
 * })
 *
 * // Query relationships
 * const purchases = await store.queryRelationshipsFrom(
 *   'do://tenant/customers/alice',
 *   { verb: 'purchased' }
 * )
 * ```
 */
export interface GraphStore {
  // -------------------------------------------------------------------------
  // THINGS OPERATIONS
  // -------------------------------------------------------------------------

  /**
   * Create a new Thing (graph node).
   *
   * @param input - The Thing data to create (id, typeId, typeName, data)
   * @returns The created Thing with timestamps populated
   * @throws Error if a Thing with the same ID already exists
   */
  createThing(input: Omit<NewGraphThing, 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<GraphThing>

  /**
   * Get a Thing by its unique ID.
   *
   * @param id - The unique identifier of the Thing
   * @returns The Thing if found, null otherwise
   */
  getThing(id: string): Promise<GraphThing | null>

  /**
   * Query Things by type with optional filtering and pagination.
   *
   * @param options - Query options including typeId, typeName, limit, offset, orderBy
   * @returns Array of Things matching the criteria
   */
  getThingsByType(options: GetThingsByTypeOptions): Promise<GraphThing[]>

  /**
   * Update a Thing's data.
   *
   * @param id - The Thing ID to update
   * @param updates - The fields to update (currently only data is supported)
   * @returns The updated Thing if found, null otherwise
   */
  updateThing(id: string, updates: UpdateThingInput): Promise<GraphThing | null>

  /**
   * Soft delete a Thing by setting its deletedAt timestamp.
   *
   * @param id - The Thing ID to delete
   * @returns The deleted Thing if found, null otherwise
   */
  deleteThing(id: string): Promise<GraphThing | null>

  // -------------------------------------------------------------------------
  // BATCH THINGS OPERATIONS (N+1 elimination)
  // -------------------------------------------------------------------------

  /**
   * Get multiple Things by their IDs in a single query.
   * Returns a Map for O(1) lookup by ID.
   *
   * @param ids - Array of Thing IDs to fetch
   * @returns Map of ID to GraphThing (missing IDs are not in the map)
   */
  getThings(ids: string[]): Promise<Map<string, GraphThing>>

  /**
   * Get multiple Things by their IDs, preserving order.
   * Returns an array in the same order as input IDs.
   *
   * @param ids - Array of Thing IDs to fetch
   * @returns Array of GraphThings in same order as input (nulls for missing)
   */
  getThingsByIds(ids: string[]): Promise<(GraphThing | null)[]>

  // -------------------------------------------------------------------------
  // RELATIONSHIPS OPERATIONS
  // -------------------------------------------------------------------------

  /**
   * Create a new Relationship (graph edge).
   *
   * @param input - The Relationship data (id, verb, from, to, data)
   * @returns The created Relationship
   * @throws Error if unique constraint violated (duplicate verb+from+to)
   */
  createRelationship(input: CreateRelationshipInput): Promise<GraphRelationship>

  /**
   * Query relationships by source URL (forward graph traversal).
   *
   * @param url - The source URL to query from
   * @param options - Optional verb filter
   * @returns Array of relationships originating from the URL
   */
  queryRelationshipsFrom(url: string, options?: RelationshipQueryOptions): Promise<GraphRelationship[]>

  /**
   * Query relationships by target URL (backward graph traversal).
   *
   * @param url - The target URL to query to
   * @param options - Optional verb filter
   * @returns Array of relationships pointing to the URL
   */
  queryRelationshipsTo(url: string, options?: RelationshipQueryOptions): Promise<GraphRelationship[]>

  /**
   * Query all relationships with a specific verb.
   *
   * @param verb - The verb to query by
   * @returns Array of relationships with the given verb
   */
  queryRelationshipsByVerb(verb: string): Promise<GraphRelationship[]>

  /**
   * Delete a relationship by its ID.
   *
   * @param id - The Relationship ID to delete
   * @returns true if deleted, false if not found
   */
  deleteRelationship(id: string): Promise<boolean>

  // -------------------------------------------------------------------------
  // BATCH RELATIONSHIPS OPERATIONS (N+1 elimination)
  // -------------------------------------------------------------------------

  /**
   * Query relationships from multiple source URLs in a single query.
   * Eliminates N+1 queries when traversing from multiple nodes.
   *
   * @param urls - Array of source URLs to query from
   * @param options - Optional verb filter
   * @returns Array of all relationships originating from any of the URLs
   */
  queryRelationshipsFromMany(urls: string[], options?: RelationshipQueryOptions): Promise<GraphRelationship[]>
}

// ============================================================================
// GRAPH OPERATION OPTIONS
// ============================================================================

/**
 * Options for graph traversal operations.
 */
export interface GraphTraversalOptions {
  /** Maximum depth to traverse */
  maxDepth?: number
  /** Filter by relationship verb(s) */
  verbs?: string | string[]
  /** Direction of traversal */
  direction?: 'outgoing' | 'incoming' | 'both'
}

/**
 * Result of a graph traversal operation.
 */
export interface GraphTraversalResult {
  /** Nodes visited during traversal */
  nodes: GraphNode[]
  /** Edges traversed */
  edges: GraphEdge[]
  /** Depth at which each node was found */
  depths: Map<string, number>
}

// ============================================================================
// GRAPH STATISTICS
// ============================================================================

/**
 * Statistics about the graph.
 */
export interface GraphStatistics {
  /** Total number of Things (nodes) */
  thingCount: number
  /** Total number of Relationships (edges) */
  relationshipCount: number
  /** Count of Things by type name */
  thingsByType: Record<string, number>
  /** Count of Relationships by verb */
  relationshipsByVerb: Record<string, number>
}
