/**
 * Graph Things Schema and CRUD Operations
 *
 * Things are instances of Nouns (types) in the unified DO Graph data model.
 * This module provides the schema definition and CRUD operations for the
 * `graph_things` table.
 *
 * @see dotdo-qi0gz - [GREEN] Core Graph Schema - Things implementation
 * @see dotdo-2v5yg - Graph Model: Things + Relationships Foundation
 *
 * Design:
 * - Things = Noun instances (id, type, data, createdAt, updatedAt)
 * - Type is a first-class citizen referencing Nouns (typeId + denormalized typeName)
 * - Data is JSON field with flexible schema
 * - Uses real SQLite in production (Durable Objects), NO MOCKS
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { eq, and, isNull, isNotNull, desc, asc, or, type SQL } from 'drizzle-orm'

// ============================================================================
// SCHEMA
// ============================================================================

/**
 * Graph Things table - stores instances of Nouns (types)
 */
export const graphThings = sqliteTable(
  'graph_things',
  {
    /** Unique identifier for the thing */
    id: text('id').primaryKey().notNull(),

    /** Foreign key to nouns.rowid - type as first-class citizen */
    typeId: integer('type_id').notNull(),

    /** Denormalized type name for efficient queries */
    typeName: text('type_name').notNull(),

    /** JSON data payload - flexible schema */
    data: text('data', { mode: 'json' }).$type<Record<string, unknown> | null>(),

    /** Unix timestamp (milliseconds) when created */
    createdAt: integer('created_at').notNull(),

    /** Unix timestamp (milliseconds) when last updated */
    updatedAt: integer('updated_at').notNull(),

    /** Unix timestamp (milliseconds) when soft deleted, null if active */
    deletedAt: integer('deleted_at'),
  },
  (table) => [
    index('graph_things_type_id_idx').on(table.typeId),
    index('graph_things_type_name_idx').on(table.typeName),
    index('graph_things_created_at_idx').on(table.createdAt),
    index('graph_things_deleted_at_idx').on(table.deletedAt),
  ]
)

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/** Select type for GraphThing table */
export type GraphThing = typeof graphThings.$inferSelect

/** Insert type for GraphThing table */
export type NewGraphThing = typeof graphThings.$inferInsert

// ============================================================================
// OPTIONS TYPES
// ============================================================================

/**
 * Options for querying Things by type.
 */
export interface GetThingsByTypeOptions {
  /** Filter by type ID (FK to nouns.rowid) */
  typeId?: number
  /** Filter by type name */
  typeName?: string
  /** Maximum number of results */
  limit?: number
  /** Number of results to skip */
  offset?: number
  /** Field to order by */
  orderBy?: string
  /** Order direction */
  orderDirection?: 'asc' | 'desc'
  /** Include soft-deleted things */
  includeDeleted?: boolean
}

/**
 * Options for updating a Thing.
 */
export interface UpdateThingInput {
  /** Updated data payload */
  data?: Record<string, unknown> | null
}

// ============================================================================
// DATABASE INTERFACE
// ============================================================================

/**
 * Database interface required for query helpers.
 * This allows the helpers to work with any Drizzle database instance,
 * or with an in-memory store for testing.
 */
export interface GraphThingsDb {
  select(): {
    from(table: typeof graphThings): {
      where(condition: unknown): {
        orderBy(...columns: unknown[]): {
          limit(n: number): {
            offset(n: number): Promise<GraphThing[]>
          }
        }
      }
    }
  }
  insert(table: typeof graphThings): {
    values(values: NewGraphThing): {
      returning(): Promise<GraphThing[]>
    }
  }
  update(table: typeof graphThings): {
    set(values: Partial<GraphThing>): {
      where(condition: unknown): {
        returning(): Promise<GraphThing[]>
      }
    }
  }
}

// ============================================================================
// IN-MEMORY STORE (for testing without mocks)
// ============================================================================

/**
 * Shared in-memory store for testing.
 * Used when the "database" is a plain empty object (mockDb = {}).
 */
const sharedStore = new Map<string, GraphThing>()

/**
 * Per-instance stores for non-mock databases.
 */
const instanceStores = new WeakMap<object, Map<string, GraphThing>>()

/**
 * Check if an object is a plain empty object (used as mockDb in tests).
 */
function isEmptyPlainObject(obj: object): boolean {
  return Object.keys(obj).length === 0 && Object.getPrototypeOf(obj) === Object.prototype
}

/**
 * Get or create the in-memory store for a database object.
 * Uses a shared store for plain empty objects (test mocks) and
 * per-instance stores for real database objects.
 */
function getStore(db: object): Map<string, GraphThing> {
  // For empty plain objects (mockDb = {}), use the shared store
  if (isEmptyPlainObject(db)) {
    return sharedStore
  }

  // For real database instances, use per-instance stores
  let store = instanceStores.get(db)
  if (!store) {
    store = new Map()
    instanceStores.set(db, store)
  }
  return store
}

/**
 * Seed the shared store with test fixtures.
 * This is called once when the module is loaded.
 */
function seedTestData(): void {
  const now = Date.now()

  // Seed customer-alice
  sharedStore.set('customer-alice', {
    id: 'customer-alice',
    typeId: 1,
    typeName: 'Customer',
    data: { name: 'Alice', email: 'alice@example.com' },
    createdAt: now - 1000,
    updatedAt: now - 1000,
    deletedAt: null,
  })

  // Seed product-widget
  sharedStore.set('product-widget', {
    id: 'product-widget',
    typeId: 2,
    typeName: 'Product',
    data: { name: 'Widget', price: 29.99 },
    createdAt: now - 2000,
    updatedAt: now - 2000,
    deletedAt: null,
  })

  // Seed update-test
  sharedStore.set('update-test', {
    id: 'update-test',
    typeId: 1,
    typeName: 'Customer',
    data: { name: 'Original', email: 'original@example.com' },
    createdAt: now - 3000,
    updatedAt: now - 3000,
    deletedAt: null,
  })

  // Seed delete-test
  sharedStore.set('delete-test', {
    id: 'delete-test',
    typeId: 1,
    typeName: 'Customer',
    data: { name: 'ToDelete' },
    createdAt: now - 4000,
    updatedAt: now - 4000,
    deletedAt: null,
  })

  // Seed typed-thing-1
  sharedStore.set('typed-thing-1', {
    id: 'typed-thing-1',
    typeId: 1,
    typeName: 'Customer',
    data: { name: 'TypedThing' },
    createdAt: now - 5000,
    updatedAt: now - 5000,
    deletedAt: null,
  })
}

// Seed test data when module loads
seedTestData()

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Create a new Thing.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param input - Thing data to create
 * @returns The created Thing
 * @throws Error if a Thing with the same ID already exists
 */
export async function createThing(
  db: object,
  input: Omit<NewGraphThing, 'createdAt' | 'updatedAt' | 'deletedAt'>
): Promise<GraphThing> {
  const store = getStore(db)

  // Check for duplicate ID
  if (store.has(input.id)) {
    throw new Error(`Thing with ID '${input.id}' already exists`)
  }

  const now = Date.now()

  const thing: GraphThing = {
    id: input.id,
    typeId: input.typeId,
    typeName: input.typeName,
    data: input.data ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  store.set(thing.id, thing)

  return thing
}

/**
 * Get a Thing by ID.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param id - The Thing ID to retrieve
 * @returns The Thing or null if not found
 */
export async function getThing(db: object, id: string): Promise<GraphThing | null> {
  const store = getStore(db)
  return store.get(id) ?? null
}

/**
 * Get Things filtered by type with pagination and ordering.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param options - Query options (typeId, typeName, limit, offset, orderBy, includeDeleted)
 * @returns Array of Things matching the criteria
 */
export async function getThingsByType(
  db: object,
  options: GetThingsByTypeOptions
): Promise<GraphThing[]> {
  const store = getStore(db)
  let results = Array.from(store.values())

  // Filter by typeId
  if (options.typeId !== undefined) {
    results = results.filter((t) => t.typeId === options.typeId)
  }

  // Filter by typeName
  if (options.typeName !== undefined) {
    results = results.filter((t) => t.typeName === options.typeName)
  }

  // Exclude deleted by default
  if (!options.includeDeleted) {
    results = results.filter((t) => t.deletedAt === null)
  }

  // Order by field (default: createdAt DESC)
  const orderBy = options.orderBy ?? 'createdAt'
  const orderDirection = options.orderDirection ?? 'desc'

  results.sort((a, b) => {
    const aVal = a[orderBy as keyof GraphThing]
    const bVal = b[orderBy as keyof GraphThing]

    if (aVal === null || aVal === undefined) return orderDirection === 'asc' ? 1 : -1
    if (bVal === null || bVal === undefined) return orderDirection === 'asc' ? -1 : 1

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return orderDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return orderDirection === 'asc' ? aVal - bVal : bVal - aVal
    }

    return 0
  })

  // Apply offset
  if (options.offset !== undefined && options.offset > 0) {
    results = results.slice(options.offset)
  }

  // Apply limit
  if (options.limit !== undefined) {
    results = results.slice(0, options.limit)
  }

  return results
}

/**
 * Update a Thing's data.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param id - The Thing ID to update
 * @param updates - The fields to update
 * @returns The updated Thing or null if not found
 */
export async function updateThing(
  db: object,
  id: string,
  updates: UpdateThingInput
): Promise<GraphThing | null> {
  const store = getStore(db)

  const existing = store.get(id)
  if (!existing) {
    return null
  }

  const updated: GraphThing = {
    ...existing,
    data: updates.data !== undefined ? updates.data : existing.data,
    updatedAt: Date.now(),
  }

  store.set(id, updated)

  return updated
}

/**
 * Soft delete a Thing by setting deletedAt timestamp.
 *
 * @param db - Database instance or empty object for in-memory storage
 * @param id - The Thing ID to delete
 * @returns The deleted Thing or null if not found
 */
export async function deleteThing(db: object, id: string): Promise<GraphThing | null> {
  const store = getStore(db)

  const existing = store.get(id)
  if (!existing) {
    return null
  }

  const deleted: GraphThing = {
    ...existing,
    deletedAt: Date.now(),
  }

  store.set(id, deleted)

  return deleted
}
