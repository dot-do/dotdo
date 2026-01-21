/**
 * @dotdo/db - Abstract Storage Layer
 *
 * Provides a unified storage abstraction for Durable Objects with support for:
 * - Things: Generic entity storage with CRUD operations
 * - Relationships: Graph-like relationships between entities
 * - Events: Event sourcing and audit logging
 * - Query: Fluent query builder for complex queries
 *
 * This module is the base for database.do managed service.
 *
 * @module @dotdo/db
 *
 * @example
 * ```typescript
 * import { createThingsStore, createEventsStore, createRelationshipsStore } from '@dotdo/db'
 *
 * // Create stores backed by SQLite
 * const things = createThingsStoreWithAdapter(sqliteAdapter)
 * const events = createEventsStore(sqliteAdapter)
 *
 * // CRUD operations
 * const customer = await things.create({ $type: 'Customer', name: 'Alice' })
 * const updated = await things.update(customer.$id, { email: 'alice@example.com' })
 *
 * // Bulk operations
 * const customers = await things.bulkCreate([
 *   { $type: 'Customer', name: 'Bob' },
 *   { $type: 'Customer', name: 'Charlie' }
 * ])
 *
 * // Query with filters
 * const results = await things.list({ type: 'Customer', limit: 100 })
 * ```
 */

/** Core types for storable data and JSON values */
export * from './types'

/** Error classes for storage operations */
export * from './errors'

/** Branded types for type-safe IDs (ThingId, EventId, RelationshipId) */
export * from './branded-types'

/** Storage adapter interface and implementations */
export * from './storage'

/** Concrete storage adapters (SQLite, Memory) */
export * from './adapters'

/** ID generation utilities */
export * from './id'

/**
 * Things store for generic entity storage.
 * Provides CRUD, bulk operations, and cursor-based pagination.
 */
export * from './things'

/**
 * Relationships store for graph-like connections between entities.
 * Supports directional relationships with types.
 */
export * from './relationships'

/**
 * Events store for event sourcing and audit logging.
 * Provides immutable event storage with timestamps.
 */
export * from './events'

/**
 * Query builder for complex queries across stores.
 * Supports filtering, sorting, and joining.
 */
export * from './query'

// Digital Objects integration excluded from build - requires primitives submodule
// Import directly from ./digital-objects.ts for primitives integration

/** SQLite-specific utilities and helpers */
export * from './sqlite'

/** Database migrations system */
export * from './migrations'

/** Audit logging for compliance and debugging */
export * from './audit'

/** Schema validation and type inference */
export * from './schema'

/** Cursor-based pagination utilities */
export * from './pagination'

/** Input validation utilities */
export {
  // Configuration
  configureValidation,
  getValidationConfig,
  resetValidationConfig,
  type ValidationConfig,
  // Value validation
  validateJsonValue,
  // ID validation
  validateId,
  validateIds,
  // Type validation
  validateType,
  // Thing validation
  validateThingInput,
  validateThingUpdate,
  safeValidateThingInput,
  safeValidateThingUpdate,
  // List/Query options validation
  validateListOptions,
  // Bulk operation validation
  validateBulkUpdateItems,
  // Note: ValidationResult is not exported here to avoid conflict with schema.ts
  // Use the ValidationResult from schema.ts instead, or import directly from validation.ts
} from './validation'
