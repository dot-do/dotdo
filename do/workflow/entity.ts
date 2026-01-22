/**
 * Entity Proxy for WorkflowContext
 *
 * Provides a typed entity access pattern via the $ context:
 *   $.Product.define(schema)  // Register schema
 *   $.Product.create(data)    // Create with $type: 'Product'
 *   $.Product.list(opts)      // List where $type = 'Product'
 *   $.Product(id).get()       // Get single entity
 *   $.Product(id).update(d)   // Update single entity
 *   $.Product(id).delete()    // Delete single entity
 *
 * @module do/workflow/entity
 */

import type { ThingsStore, Thing, StorableData } from '@dotdo/db'
import type { EntitySchema as UnifiedEntitySchema } from '../schema/types'
import type { EntitySchema, FieldDefinition } from './types'

// Re-export for backwards compatibility
export type { EntitySchema, FieldDefinition }

/**
 * Options for listing entities
 */
export interface EntityListOptions {
  limit?: number
  offset?: number
}

/**
 * Single entity accessor returned by $.Entity(id)
 */
export interface EntityInstance<T extends StorableData = StorableData> {
  /** Get the entity by ID */
  get(): Promise<Thing<T> | null>
  /** Update the entity */
  update(data: Partial<T>): Promise<Thing<T>>
  /** Delete the entity */
  delete(): Promise<void>
}

/**
 * Entity type accessor returned by $.Entity
 */
export interface EntityAccessor<T extends StorableData = StorableData> {
  /** Define the schema for this entity type */
  define(schema: EntitySchema): void
  /** Create a new entity */
  create(data: T): Promise<Thing<T>>
  /** List entities of this type */
  list(options?: EntityListOptions): Promise<Thing<T>[]>
}

/**
 * Combined type that is both an accessor and callable for single-entity access
 */
export type EntityProxy<T extends StorableData = StorableData> =
  EntityAccessor<T> & ((id: string) => EntityInstance<T>)

/**
 * Configuration for the entity proxy
 */
export interface EntityProxyConfig {
  /** The things store to delegate to */
  things: ThingsStore
  /** Schema registry (legacy format) */
  schemas: Map<string, EntitySchema>
  /** Unified entity schemas with relation definitions and AI field support (optional) */
  unifiedSchemas?: Map<string, UnifiedEntitySchema>
}

/**
 * Create an entity accessor for a specific entity type
 *
 * @param config - Entity proxy configuration
 * @param entityName - Name of the entity type (e.g., 'Product')
 * @returns EntityProxy that can be used as both accessor and function
 */
export function createEntityAccessor<T extends StorableData = StorableData>(
  config: EntityProxyConfig,
  entityName: string
): EntityProxy<T> {
  const { things, schemas } = config

  // Create the instance accessor factory
  const instanceAccessor = (id: string): EntityInstance<T> => ({
    async get(): Promise<Thing<T> | null> {
      return things.get(id) as Promise<Thing<T> | null>
    },

    async update(data: Partial<T>): Promise<Thing<T>> {
      return things.update(id, data) as Promise<Thing<T>>
    },

    async delete(): Promise<void> {
      return things.delete(id)
    },
  })

  // Create the type-level accessor methods
  const typeAccessor: EntityAccessor<T> = {
    define(schema: EntitySchema): void {
      schemas.set(entityName, { ...schema, name: entityName })
    },

    async create(data: T): Promise<Thing<T>> {
      return things.create({ $type: entityName, ...data }) as Promise<Thing<T>>
    },

    async list(options?: EntityListOptions): Promise<Thing<T>[]> {
      return things.list({
        type: entityName,
        limit: options?.limit,
        offset: options?.offset,
      }) as Promise<Thing<T>[]>
    },
  }

  // Combine function and object properties
  // The proxy is callable as a function for instance access
  // and has methods for type-level operations
  const proxy = Object.assign(instanceAccessor, typeAccessor)

  return proxy as EntityProxy<T>
}

/**
 * Check if a property name looks like an entity name (PascalCase or starts with uppercase)
 *
 * @param name - Property name to check
 * @returns true if the name looks like an entity name
 */
export function isEntityName(name: string): boolean {
  // Entity names are PascalCase (start with uppercase letter)
  return /^[A-Z]/.test(name)
}

/**
 * Known context properties that should NOT be treated as entity names
 */
const RESERVED_CONTEXT_PROPERTIES = new Set([
  // Methods
  'send',
  'try',
  'do',
  'run',
  'getRequestId',
  'getMetadata',
  'setMetadata',
  'hasContext',
  // Properties
  'on',
  'every',
  'integrations',
  'fs',
  'git',
  'bash',
  'npm',
  // Internal properties (prefixed with _)
  // These are handled by checking for _ prefix
])

/**
 * Check if a property is a reserved context property
 *
 * @param name - Property name to check
 * @returns true if the property is reserved
 */
export function isReservedProperty(name: string): boolean {
  return RESERVED_CONTEXT_PROPERTIES.has(name) || name.startsWith('_')
}

// =============================================================================
// TYPE-SAFE ENTITY ACCESSOR TYPES (do-b1tuz)
// =============================================================================

/**
 * Typed single entity accessor returned by $.Entity(id)
 *
 * Provides compile-time type safety for entity operations.
 *
 * @template T - The entity data type
 *
 * @example
 * ```typescript
 * interface ProductData {
 *   name: string
 *   price: number
 *   sku: string
 * }
 *
 * // TypedEntityInstance<ProductData> ensures:
 * // - get() returns Promise<Thing<ProductData> | null>
 * // - update() accepts Partial<ProductData>
 * // - delete() returns Promise<void>
 *
 * const instance: TypedEntityInstance<ProductData> = $.Product('prod-123')
 * const product = await instance.get() // Thing<ProductData> | null
 * ```
 */
export interface TypedEntityInstance<T extends StorableData = StorableData> {
  /** Get the entity by ID - returns typed Thing or null */
  get(): Promise<Thing<T> | null>
  /** Update the entity with partial data - returns updated typed Thing */
  update(data: Partial<T>): Promise<Thing<T>>
  /** Delete the entity */
  delete(): Promise<void>
}

/**
 * Typed entity type accessor for collection-level operations
 *
 * Provides compile-time type safety for create and list operations.
 *
 * @template T - The entity data type
 *
 * @example
 * ```typescript
 * interface ProductData {
 *   name: string
 *   price: number
 *   sku: string
 * }
 *
 * // TypedEntityAccessor<ProductData> ensures:
 * // - create() requires all required fields from ProductData
 * // - list() returns Promise<Thing<ProductData>[]>
 *
 * const accessor: TypedEntityAccessor<ProductData> = $.Product
 * const product = await accessor.create({ name: 'Widget', price: 9.99, sku: 'WDG-001' })
 * ```
 */
export interface TypedEntityAccessor<T extends StorableData = StorableData> {
  /** Define the schema for this entity type */
  define(schema: EntitySchema): void
  /** Create a new entity with typed data - returns typed Thing */
  create(data: T): Promise<Thing<T>>
  /** List entities of this type - returns typed Thing array */
  list(options?: EntityListOptions): Promise<Thing<T>[]>
}

/**
 * Combined typed proxy that is both an accessor and callable for single-entity access
 *
 * This is the main type for typed entity accessors on the WorkflowContext.
 *
 * @template T - The entity data type
 *
 * @example
 * ```typescript
 * interface ProductData {
 *   name: string
 *   price: number
 *   sku: string
 * }
 *
 * // TypedEntityProxy<ProductData> provides:
 * // - $.Product.create(data) - collection operations
 * // - $.Product('id').get() - instance operations
 *
 * const proxy: TypedEntityProxy<ProductData> = $.Product
 *
 * // Collection operations
 * const created = await proxy.create({ name: 'Widget', price: 9.99, sku: 'WDG-001' })
 * const list = await proxy.list()
 *
 * // Instance operations via function call
 * const instance = proxy('prod-123')
 * const product = await instance.get()
 * await instance.update({ price: 14.99 })
 * ```
 */
export type TypedEntityProxy<T extends StorableData = StorableData> =
  TypedEntityAccessor<T> & ((id: string) => TypedEntityInstance<T>)

/**
 * Constraint type for entity schema definitions
 *
 * Maps entity names to their data types.
 */
export interface EntityDefinitionsConstraint {
  [entityName: string]: StorableData
}

/**
 * Empty entity definitions for untyped contexts
 */
export type EmptyEntityDefinitions = Record<string, never>

/**
 * Helper type to define entity schemas with compile-time type safety
 *
 * @template T - Map of entity names to their data types
 *
 * @example
 * ```typescript
 * type MyEntities = DefineEntities<{
 *   Product: { name: string; price: number; sku: string }
 *   Customer: { email: string; name: string; tier: 'free' | 'pro' }
 * }>
 * ```
 */
export type DefineEntities<T extends EntityDefinitionsConstraint> = T

/**
 * Schema definition for use with DefineEntities
 *
 * This interface can be extended to include validation rules.
 */
export interface EntitySchemaDefinition<T extends StorableData = StorableData> {
  /** The data type for this entity (for type inference) */
  _type?: T
  /** Runtime validation rules (optional) */
  validation?: EntitySchema
}

/**
 * Type that adds typed entity accessors to the WorkflowContext
 *
 * For each entity name K in T, adds a typed accessor $.K
 *
 * @template T - The entity definitions map type
 */
export type EntityAccessors<T extends EntityDefinitionsConstraint> = {
  [K in keyof T]: TypedEntityProxy<T[K]>
}

/**
 * Fully typed WorkflowContext with entity accessor inference
 *
 * This type extends WorkflowContext with typed entity accessors
 * based on the provided entity definitions.
 *
 * @template E - The entity definitions map type
 *
 * @example
 * ```typescript
 * interface MyEntities {
 *   Product: { name: string; price: number; sku: string; inStock: boolean }
 *   Customer: { email: string; name: string; tier: 'free' | 'pro' | 'enterprise' }
 * }
 *
 * type $ = TypedWorkflowContextWithEntities<MyEntities>
 *
 * // Usage:
 * const product = await $.Product.create({ name: 'Widget', price: 9.99, sku: 'WDG-001', inStock: true })
 * const retrieved = await $.Product('prod-123').get()
 * // retrieved is Thing<{ name: string; price: number; sku: string; inStock: boolean }> | null
 * ```
 */
export type TypedWorkflowContextWithEntities<
  E extends EntityDefinitionsConstraint = EmptyEntityDefinitions
> = import('./types').WorkflowContext & EntityAccessors<E> & {
  // Allow dynamic access for entities not in E (returns untyped proxy)
  [key: string]: unknown
}

/**
 * Helper to create a typed workflow context factory with entity definitions
 *
 * This is a compile-time only helper for type inference.
 *
 * @template E - Entity definitions type
 */
export type CreateTypedEntityContext<E extends EntityDefinitionsConstraint> = (
  state: DurableObjectState,
  env: unknown,
  options?: { things?: ThingsStore }
) => TypedWorkflowContextWithEntities<E>
