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

// ============================================================================
// Utils - Core types, errors, branded types, ID generation
// ============================================================================

/** Core types for storable data and JSON values */
export * from './utils/types'

/** Error classes for storage operations */
export * from './utils/errors'

/** Branded types for type-safe IDs (ThingId, EventId, RelationshipId) */
export * from './utils/branded-types'

/** ID generation utilities */
export * from './utils/id'

/** Logging utilities */
export * from './utils/logger'

/** Constants */
export * from './utils/constants'

/** Database migrations system */
export * from './utils/migrations'

// ============================================================================
// Entities - Things, Events, Relationships
// ============================================================================

/**
 * Things store for generic entity storage.
 * Provides CRUD, bulk operations, and cursor-based pagination.
 */
export * from './entities/things'

/**
 * Relationships store for graph-like connections between entities.
 * Supports directional relationships with types.
 */
export * from './entities/relationships'

/**
 * Events store for event sourcing and audit logging.
 * Provides immutable event storage with timestamps.
 */
export * from './entities/events'

// ============================================================================
// Query - Query builder and pagination
// ============================================================================

/**
 * Query builder for complex queries across stores.
 * Supports filtering, sorting, and joining.
 */
export * from './query/query'

/** Cursor-based pagination utilities */
export * from './query/pagination'

// ============================================================================
// Storage - Storage adapters and implementations
// ============================================================================

/** Storage adapter interface and implementations */
export * from './storage/storage'

/** SQLite-specific utilities and helpers */
export * from './storage/sqlite'

/** Tiered storage for hot/warm/cold data */
export * from './storage/tiered-storage'

/** Event sourcing utilities */
export * from './storage/event-sourcing'

/** Concrete storage adapters (SQLite, Memory) */
export * from './adapters'

// ============================================================================
// Schema - Validation and schemas
// ============================================================================

/** Schema validation and type inference */
export * from './schema/schema'

/** Schema definitions */
export * from './schema/schemas'

/** Input validation utilities */
export {
  // Context-based validation (recommended)
  createValidationContext,
  withValidationContext,
  DEFAULT_VALIDATION_CONFIG,
  type ValidationContext,
  // Legacy global configuration (deprecated, use context-based validation instead)
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
} from './schema/validation'

// ============================================================================
// Integrations - AI, Audit, Digital Objects
// ============================================================================

/** Audit logging for compliance and debugging */
export * from './integrations/audit'

// Digital Objects integration excluded from build - requires primitives submodule
// Import directly from ./integrations/digital-objects.ts for primitives integration

// AI integration excluded from default export - import directly if needed
// export * from './integrations/ai-integration'
