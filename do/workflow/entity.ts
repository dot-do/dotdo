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

import type { ThingsStore, Thing, StorableData } from '../../db'

/**
 * Schema definition for an entity type.
 * Currently a placeholder - can be extended for validation.
 */
export interface EntitySchema {
  /** Entity type name */
  name?: string
  /** Field definitions (for future validation) */
  fields?: Record<string, FieldDefinition>
  /** Whether to validate on create/update */
  strict?: boolean
}

/**
 * Field definition for schema validation.
 */
export interface FieldDefinition {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required?: boolean
  default?: unknown
}

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
  /** Schema registry */
  schemas: Map<string, EntitySchema>
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
