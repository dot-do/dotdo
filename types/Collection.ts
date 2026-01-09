/**
 * Collection - Homogeneous typed container interface
 *
 * A Collection is a typed container where:
 * - All items are of the same type (itemType)
 * - IDs are constructed as `ns/id` (no type in path)
 * - CRUD operations don't require type parameter
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const COLLECTION_TYPE = 'https://schema.org.ai/Collection'

// ============================================================================
// COLLECTION DATA - Base data structure
// ============================================================================

/**
 * CollectionData represents the stored data for a Collection
 */
export interface CollectionData {
  readonly $id: string // Full physical ID: ns + qualifiers
  readonly $type: typeof COLLECTION_TYPE // Always 'https://schema.org.ai/Collection'
  readonly ns: string // Logical namespace: 'https://crm.headless.ly/acme'
  readonly itemType: string // Type of contained items: 'https://startups.studio/Startup'
  name?: string
  description?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Runtime sentinel for CollectionData type.
 * Used for type checking at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export const CollectionData = class CollectionData {
  static readonly $type = COLLECTION_TYPE
}

// ============================================================================
// THING BASE TYPE - For collection items
// ============================================================================

/**
 * Base Thing interface for items in a collection
 */
export interface Thing {
  $id: string
  $type: string
  name?: string
  [key: string]: unknown
}

// ============================================================================
// COLLECTION INTERFACE - With CRUD operations
// ============================================================================

/**
 * Collection interface with CRUD and query operations
 */
export interface Collection<T extends Thing = Thing> extends CollectionData {
  // ID construction
  buildItemId(id: string): string // Constructs `${this.ns}/${id}`

  // CRUD - no type parameter needed
  get(id: string): Promise<T | null>
  create(id: string, data: Partial<Omit<T, '$id' | '$type'>>): Promise<T>
  update(id: string, data: Partial<T>): Promise<T>
  delete(id: string): Promise<void>

  // Query
  list(options?: { limit?: number; cursor?: string }): Promise<{ items: T[]; cursor?: string }>
  find(query: Record<string, unknown>): Promise<T[]>
  count(query?: Record<string, unknown>): Promise<number>
}

/**
 * Runtime sentinel for Collection type.
 * Used for type checking at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export const Collection = class Collection {
  static readonly $type = COLLECTION_TYPE
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Build an item ID in ns/id format (no type in path)
 *
 * @param ns - The namespace URL (e.g., 'https://startups.studio')
 * @param id - The local ID (e.g., 'acme')
 * @returns Full ID in format `ns/id` (e.g., 'https://startups.studio/acme')
 */
export function buildItemId(ns: string, id: string): string {
  return `${ns}/${id}`
}

// ============================================================================
// FACTORY TYPE
// ============================================================================

/**
 * Factory function type for creating typed collections
 */
export type CollectionFactory = <T extends Thing = Thing>(type: string) => Collection<T>

/**
 * Placeholder for the collection factory function
 * This will be implemented in the DO class
 */
export const collection: CollectionFactory = <T extends Thing = Thing>(_type: string): Collection<T> => {
  // This is a placeholder - the actual implementation is in DO
  throw new Error('collection() must be called on a DO instance')
}
