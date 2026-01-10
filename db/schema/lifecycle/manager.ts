/**
 * Lifecycle Manager for Cascade Generation System
 *
 * Provides lifecycle hooks for entity management:
 * - $created: After entity creation
 * - $updated: After entity update (with previous state)
 * - $deleted: Before entity deletion
 *
 * Also provides schema-level hooks:
 * - $seeded: After all seeds complete
 * - $ready: When DB is initialized
 * - $error: Global error handler
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Base entity interface with required metadata fields
 */
export interface Entity {
  $id: string
  $type: string
  [key: string]: unknown
}

/**
 * Entity metadata interface
 */
export interface EntityMeta {
  $id: string
  $type: string
}

/**
 * Transaction interface for database operations
 */
export interface Transaction {
  commit: () => Promise<void> | void
  rollback: () => Promise<void> | void
  savepoint: (name: string) => Promise<void> | void
}

/**
 * Schema interface for type introspection
 */
export interface Schema {
  types: Record<string, unknown>
  getType: (name: string) => unknown
}

/**
 * Result of cascade operations
 */
export interface CascadeResult {
  cascaded: Entity[]
}

/**
 * Context object passed to lifecycle handlers
 * Provides access to other entity types, transaction, schema, and utilities
 */
export interface LifecycleContext {
  /** Transaction context for database operations */
  tx: Transaction

  /** Schema for type introspection */
  schema: Schema

  /** Query entities of a type */
  query: (type: string, filter: Record<string, unknown>) => Promise<Entity[]>

  /** Delete an entity */
  delete: (type: string, id: string) => Promise<void>

  /** Generate a unique ID */
  generateId: () => string

  /** Get list of changed fields between entity and previous state */
  getChangedFields: (entity: Entity, previous: Entity) => string[]

  /** Check if a specific field changed */
  hasChanged: (field: string, entity: Entity, previous: Entity) => boolean

  /** Dynamic type accessors - $.TypeName(id, data) */
  [typeName: string]: unknown
}

/**
 * Handler function signatures for lifecycle events
 */
export type CreatedHandler = (
  entity: Entity,
  $: LifecycleContext
) => void | Promise<void> | CascadeResult | Promise<CascadeResult | void>

export type UpdatedHandler = (entity: Entity, previous: Entity, $: LifecycleContext) => void | Promise<void>

export type DeletedHandler = (entity: Entity, $: LifecycleContext) => void | Promise<void>

/**
 * Lifecycle hooks configuration for a type
 */
export interface LifecycleHooks {
  $created?: CreatedHandler
  $updated?: UpdatedHandler
  $deleted?: DeletedHandler
}

/**
 * Schema-level hook handler
 */
export type SchemaHookHandler = (data: unknown) => void | Promise<void>

// ============================================================================
// LIFECYCLE MANAGER IMPLEMENTATION
// ============================================================================

/**
 * Manages lifecycle hooks for entity types
 */
export class LifecycleManager {
  private hooks = new Map<string, LifecycleHooks>()
  private additionalHandlers = new Map<string, Map<string, Array<CreatedHandler | UpdatedHandler | DeletedHandler>>>()
  private schemaHooks = new Map<string, SchemaHookHandler[]>()

  /**
   * Register lifecycle hooks for a type
   */
  register(typeName: string, hooks: LifecycleHooks): void {
    this.hooks.set(typeName, hooks)
  }

  /**
   * Add an additional handler for a specific lifecycle event
   */
  addHandler(typeName: string, event: '$created' | '$updated' | '$deleted', handler: CreatedHandler | UpdatedHandler | DeletedHandler): void {
    if (!this.additionalHandlers.has(typeName)) {
      this.additionalHandlers.set(typeName, new Map())
    }
    const typeHandlers = this.additionalHandlers.get(typeName)!
    if (!typeHandlers.has(event)) {
      typeHandlers.set(event, [])
    }
    typeHandlers.get(event)!.push(handler)
  }

  /**
   * Unregister all hooks for a type
   */
  unregister(typeName: string): void {
    this.hooks.delete(typeName)
    this.additionalHandlers.delete(typeName)
  }

  /**
   * Check if a type has registered hooks
   */
  hasHooks(typeName: string): boolean {
    return this.hooks.has(typeName)
  }

  /**
   * Get list of types with registered hooks
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.hooks.keys())
  }

  /**
   * Register a schema-level hook
   */
  registerSchemaHook(hookName: string, handler: SchemaHookHandler): void {
    if (!this.schemaHooks.has(hookName)) {
      this.schemaHooks.set(hookName, [])
    }
    this.schemaHooks.get(hookName)!.push(handler)
  }

  /**
   * Trigger a schema-level hook
   */
  async triggerSchemaHook(hookName: string, data: unknown): Promise<void> {
    const handlers = this.schemaHooks.get(hookName) || []
    for (const handler of handlers) {
      await handler(data)
    }
  }

  /**
   * Called after an entity is created
   */
  async onCreated(entity: Entity, $: LifecycleContext): Promise<CascadeResult | void> {
    const hooks = this.hooks.get(entity.$type)
    let result: CascadeResult | void = undefined

    if (hooks?.$created) {
      result = await hooks.$created(entity, $)
    }

    // Call additional handlers
    const additionalTypeHandlers = this.additionalHandlers.get(entity.$type)
    if (additionalTypeHandlers) {
      const createdHandlers = additionalTypeHandlers.get('$created') || []
      for (const handler of createdHandlers) {
        await (handler as CreatedHandler)(entity, $)
      }
    }

    return result
  }

  /**
   * Called after an entity is updated
   */
  async onUpdated(entity: Entity, previous: Entity, $: LifecycleContext): Promise<void> {
    const hooks = this.hooks.get(entity.$type)

    if (hooks?.$updated) {
      await hooks.$updated(entity, previous, $)
    }

    // Call additional handlers
    const additionalTypeHandlers = this.additionalHandlers.get(entity.$type)
    if (additionalTypeHandlers) {
      const updatedHandlers = additionalTypeHandlers.get('$updated') || []
      for (const handler of updatedHandlers) {
        await (handler as UpdatedHandler)(entity, previous, $)
      }
    }
  }

  /**
   * Called before an entity is deleted
   */
  async onDeleted(entity: Entity, $: LifecycleContext): Promise<void> {
    const hooks = this.hooks.get(entity.$type)

    if (hooks?.$deleted) {
      await hooks.$deleted(entity, $)
    }

    // Call additional handlers
    const additionalTypeHandlers = this.additionalHandlers.get(entity.$type)
    if (additionalTypeHandlers) {
      const deletedHandlers = additionalTypeHandlers.get('$deleted') || []
      for (const handler of deletedHandlers) {
        await (handler as DeletedHandler)(entity, $)
      }
    }
  }
}

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

/**
 * Options for creating a lifecycle context
 */
export interface CreateContextOptions {
  tx: Transaction
  schema: Schema
  query: (type: string, filter: Record<string, unknown>) => Promise<Entity[]>
  delete: (type: string, id: string) => Promise<void>
  generateId: () => string
  typeAccessors?: Record<string, (id: string, data?: Partial<Entity>) => Promise<Entity>>
}

/**
 * Create a lifecycle context with all required utilities
 */
export function createContext(options: CreateContextOptions): LifecycleContext {
  const context: LifecycleContext = {
    tx: options.tx,
    schema: options.schema,
    query: options.query,
    delete: options.delete,
    generateId: options.generateId,

    getChangedFields: (entity: Entity, previous: Entity): string[] => {
      const changed: string[] = []
      const allKeys = new Set([...Object.keys(entity), ...Object.keys(previous)])

      for (const key of allKeys) {
        if (key.startsWith('$')) continue // Skip meta fields
        if (!deepEqual(entity[key], previous[key])) {
          changed.push(key)
        }
      }

      return changed
    },

    hasChanged: (field: string, entity: Entity, previous: Entity): boolean => {
      // Support dot notation for nested fields
      const entityValue = getNestedValue(entity, field)
      const previousValue = getNestedValue(previous, field)
      return !deepEqual(entityValue, previousValue)
    },
  }

  // Add type accessors
  if (options.typeAccessors) {
    for (const [typeName, accessor] of Object.entries(options.typeAccessors)) {
      context[typeName] = accessor
    }
  }

  return context
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Deep equality check for comparing entity values
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a !== typeof b) return false

  if (typeof a === 'object') {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      return a.every((item, index) => deepEqual(item, b[index]))
    }

    if (Array.isArray(a) !== Array.isArray(b)) return false

    const aObj = a as Record<string, unknown>
    const bObj = b as Record<string, unknown>
    const aKeys = Object.keys(aObj)
    const bKeys = Object.keys(bObj)

    if (aKeys.length !== bKeys.length) return false

    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]))
  }

  return false
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}
