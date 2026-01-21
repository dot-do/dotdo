/**
 * @dotdo/api - Resource Definition DSL
 *
 * Provides a fluent API for defining REST resources with automatic
 * Zod schema generation, route definitions, and CRUD operations.
 *
 * @module @dotdo/api/resource
 *
 * @example
 * ```typescript
 * import { defineResource } from '@dotdo/api'
 *
 * const CustomerResource = defineResource<CustomerData>('Customer')
 *   .fields({
 *     name: { type: 'string', required: true },
 *     email: { type: 'string', format: 'email', required: true },
 *     status: { type: 'enum', values: ['active', 'inactive'] }
 *   })
 *   .relations({
 *     orders: { type: 'hasMany', resource: 'Order' }
 *   })
 *   .build()
 * ```
 */
import { z } from 'zod'
import type { Context } from 'hono'
import type { JsonValue, StorableData } from '@dotdo/db'

/**
 * Supported field types for resource definitions.
 * Maps to both Zod schemas and OpenAPI types.
 */
export type FieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'enum'
  | 'date'

/**
 * Base field definition with common properties for all field types.
 */
export interface BaseFieldDef {
  /** The field's data type */
  type: FieldType
  /** Whether the field is required (default: false) */
  required?: boolean
  /** Default value if not provided */
  default?: JsonValue
}

/**
 * String field definition with validation options.
 */
export interface StringFieldDef extends BaseFieldDef {
  type: 'string'
  /** Minimum string length */
  minLength?: number
  /** Maximum string length */
  maxLength?: number
  /** Regular expression pattern for validation */
  pattern?: RegExp
  /** Special string format for validation */
  format?: 'email' | 'url' | 'uuid' | 'date-time'
}

/**
 * Number field definition with range validation.
 */
export interface NumberFieldDef extends BaseFieldDef {
  type: 'number' | 'integer'
  /** Minimum value */
  min?: number
  /** Maximum value */
  max?: number
}

/**
 * Array field definition with item type and length constraints.
 */
export interface ArrayFieldDef extends BaseFieldDef {
  type: 'array'
  /** Type of array items */
  items?: FieldType | z.ZodType
  /** Minimum number of items */
  minItems?: number
  /** Maximum number of items */
  maxItems?: number
}

/**
 * Enum field definition with allowed values.
 */
export interface EnumFieldDef extends BaseFieldDef {
  type: 'enum'
  /** Allowed enum values */
  values: readonly string[]
}

/**
 * Object field definition with nested schema.
 */
export interface ObjectFieldDef extends BaseFieldDef {
  type: 'object'
  /** Zod schema for the object structure */
  schema?: z.ZodType
}

/**
 * Union type of all field definition types.
 */
export type FieldDef =
  | StringFieldDef
  | NumberFieldDef
  | ArrayFieldDef
  | EnumFieldDef
  | ObjectFieldDef
  | BaseFieldDef

/**
 * Relationship definition between resources.
 */
export interface RelationDef {
  /** Relationship type */
  type: 'hasOne' | 'hasMany' | 'belongsTo'
  /** Related resource name */
  resource: string
  /** Foreign key field name (optional) */
  foreignKey?: string
}

/**
 * Custom action definition for a resource.
 */
export interface ActionDef {
  /** HTTP method for the action */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Request handler function */
  handler: (ctx: Context) => Promise<unknown>
  /** Custom path override (optional) */
  path?: string
  /** Action description for documentation */
  description?: string
}

/**
 * Lifecycle hooks for resource CRUD operations.
 * @template T - The resource data type
 */
export interface HookDef<T extends StorableData = StorableData> {
  /** Called before validation on create/update */
  beforeValidate?: (data: Partial<T>) => Promise<Partial<T>>
  /** Called before creating a new resource */
  beforeCreate?: (data: T) => Promise<T>
  /** Called after creating a new resource */
  afterCreate?: (data: T) => Promise<T>
  /** Called before updating an existing resource */
  beforeUpdate?: (id: string, data: Partial<T>) => Promise<Partial<T>>
  /** Called after updating an existing resource */
  afterUpdate?: (id: string, data: T) => Promise<T>
  /** Called before deleting a resource */
  beforeDelete?: (id: string) => Promise<void>
  /** Called after deleting a resource */
  afterDelete?: (id: string) => Promise<void>
}

/**
 * Computed field definitions - derived values calculated from resource data.
 * @template T - The resource data type
 */
export type ComputedFieldDef<T extends StorableData = StorableData> = {
  [key: string]: (data: T) => JsonValue
}

/**
 * Generated route definitions for a resource.
 */
export interface RouteDefinitions {
  /** List all resources */
  list: { method: 'GET'; path: string }
  /** Create a new resource */
  create: { method: 'POST'; path: string }
  /** Get a single resource */
  get: { method: 'GET'; path: string }
  /** Update a resource */
  update: { method: 'PUT'; path: string }
  /** Delete a resource */
  delete: { method: 'DELETE'; path: string }
  /** Custom action routes */
  actions?: Record<string, { method: string; path: string }>
  /** Relationship routes */
  relations?: Record<string, { method: 'GET'; path: string }>
}

/**
 * Type-safe field definitions that match the resource data type.
 * When T is provided, fields must be a subset of T's keys (excluding $id).
 * @template T - The resource data type
 */
export type ResourceFields<T extends StorableData = StorableData> =
  T extends StorableData
    ? keyof T extends string
      ? { [K in Exclude<keyof T, '$id'>]?: FieldDef } & Record<string, FieldDef>
      : Record<string, FieldDef>
    : Record<string, FieldDef>

/**
 * Complete resource definition including fields, relations, actions, hooks, and routes.
 * @template T - The resource data type
 */
export interface ResourceDefinition<T extends StorableData = StorableData> {
  /** Resource name */
  name: string
  /** Field definitions */
  fields: ResourceFields<T>
  /** Zod validation schema (auto-generated from fields) */
  schema: z.ZodType<T>
  /** Relationship definitions */
  relations?: Record<string, RelationDef>
  /** Custom action definitions */
  actions?: Record<string, ActionDef>
  /** Lifecycle hooks */
  hooks?: HookDef<T>
  /** Computed field definitions */
  computed?: ComputedFieldDef<T>
  /** Generated route definitions */
  routes?: RouteDefinitions
}

/**
 * Fluent builder for creating resource definitions.
 *
 * @template T - The resource data type
 *
 * @example
 * ```typescript
 * const CustomerResource = defineResource<CustomerData>('Customer')
 *   .fields({
 *     name: { type: 'string', required: true },
 *     email: { type: 'string', format: 'email' }
 *   })
 *   .relations({
 *     orders: { type: 'hasMany', resource: 'Order' }
 *   })
 *   .hooks({
 *     afterCreate: async (data) => {
 *       await sendWelcomeEmail(data.email)
 *       return data
 *     }
 *   })
 *   .build()
 * ```
 */
export class ResourceBuilder<T extends StorableData = StorableData> {
  private name: string
  private _fields: ResourceFields<T> = {} as ResourceFields<T>
  private _relations?: Record<string, RelationDef>
  private _actions?: Record<string, ActionDef>
  private _hooks?: HookDef<T>
  private _computed?: ComputedFieldDef<T>

  constructor(name: string) {
    this.name = name
  }

  /**
   * Define the resource fields.
   * @param fields - Field definitions
   */
  fields(fields: ResourceFields<T>): this {
    this._fields = fields
    return this
  }

  /**
   * Define resource relationships.
   * @param relations - Relationship definitions
   */
  relations(relations: Record<string, RelationDef>): this {
    this._relations = relations
    return this
  }

  /**
   * Define custom actions.
   * @param actions - Action definitions
   */
  actions(actions: Record<string, ActionDef>): this {
    this._actions = actions
    return this
  }

  /**
   * Define lifecycle hooks.
   * @param hooks - Hook definitions
   */
  hooks(hooks: HookDef<T>): this {
    this._hooks = hooks
    return this
  }

  /**
   * Define computed fields.
   * @param computed - Computed field definitions
   */
  computed(computed: ComputedFieldDef<T>): this {
    this._computed = computed
    return this
  }

  /**
   * Build the resource definition.
   * Generates Zod schema and route definitions, and registers the resource.
   * @returns Complete ResourceDefinition
   */
  build(): ResourceDefinition<T> {
    const schema = buildZodSchema(this._fields as Record<string, FieldDef>)
    const routes = generateRoutes(this.name, this._actions, this._relations)

    const definition: ResourceDefinition<T> = {
      name: this.name,
      fields: this._fields,
      schema: schema as z.ZodType<T>,
      routes,
    }

    if (this._relations) {
      definition.relations = this._relations
    }

    if (this._actions) {
      definition.actions = this._actions
    }

    if (this._hooks) {
      definition.hooks = this._hooks
    }

    if (this._computed) {
      definition.computed = this._computed
    }

    // Register in global registry
    registerResource(this.name, definition)

    return definition
  }
}

/**
 * Build a Zod schema from field definitions.
 * @internal
 */
function buildZodSchema(fields: Record<string, FieldDef>): z.ZodType {
  const shape: Record<string, z.ZodType> = {}

  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    let fieldSchema: z.ZodType

    switch (fieldDef.type) {
      case 'string': {
        const stringDef = fieldDef as StringFieldDef
        let schema = z.string()

        if (stringDef.minLength !== undefined) {
          schema = schema.min(stringDef.minLength)
        }
        if (stringDef.maxLength !== undefined) {
          schema = schema.max(stringDef.maxLength)
        }
        if (stringDef.pattern !== undefined) {
          schema = schema.regex(stringDef.pattern)
        }
        if (stringDef.format === 'email') {
          schema = schema.email()
        }
        if (stringDef.format === 'url') {
          schema = schema.url()
        }
        if (stringDef.format === 'uuid') {
          schema = schema.uuid()
        }

        fieldSchema = schema
        break
      }

      case 'number': {
        const numberDef = fieldDef as NumberFieldDef
        let schema = z.number()

        if (numberDef.min !== undefined) {
          schema = schema.min(numberDef.min)
        }
        if (numberDef.max !== undefined) {
          schema = schema.max(numberDef.max)
        }

        fieldSchema = schema
        break
      }

      case 'integer': {
        const numberDef = fieldDef as NumberFieldDef
        let schema = z.number().int()

        if (numberDef.min !== undefined) {
          schema = schema.min(numberDef.min)
        }
        if (numberDef.max !== undefined) {
          schema = schema.max(numberDef.max)
        }

        fieldSchema = schema
        break
      }

      case 'boolean':
        fieldSchema = z.boolean()
        break

      case 'array': {
        const arrayDef = fieldDef as ArrayFieldDef
        let itemSchema: z.ZodType

        if (arrayDef.items === 'string') {
          itemSchema = z.string()
        } else if (arrayDef.items === 'number') {
          itemSchema = z.number()
        } else if (arrayDef.items && typeof arrayDef.items === 'object') {
          itemSchema = arrayDef.items
        } else {
          itemSchema = z.any()
        }

        let schema = z.array(itemSchema)

        if (arrayDef.minItems !== undefined) {
          schema = schema.min(arrayDef.minItems)
        }
        if (arrayDef.maxItems !== undefined) {
          schema = schema.max(arrayDef.maxItems)
        }

        fieldSchema = schema
        break
      }

      case 'object': {
        const objectDef = fieldDef as ObjectFieldDef
        fieldSchema = objectDef.schema || z.object({}).passthrough()
        break
      }

      case 'enum': {
        const enumDef = fieldDef as EnumFieldDef
        fieldSchema = z.enum(enumDef.values as [string, ...string[]])
        break
      }

      case 'date':
        fieldSchema = z.date()
        break

      default:
        fieldSchema = z.any()
    }

    // Handle optional vs required
    if (fieldDef.required === false || fieldDef.required === undefined) {
      fieldSchema = fieldSchema.optional()
    }

    // Handle default values
    if (fieldDef.default !== undefined) {
      fieldSchema = fieldSchema.default(fieldDef.default)
    }

    shape[fieldName] = fieldSchema
  }

  return z.object(shape)
}

/**
 * Generate route definitions for a resource.
 * @internal
 */
function generateRoutes(
  resourceName: string,
  actions?: Record<string, ActionDef>,
  relations?: Record<string, RelationDef>
): RouteDefinitions {
  const basePath = `/${resourceName.toLowerCase()}`

  const routes: RouteDefinitions = {
    list: { method: 'GET', path: basePath },
    create: { method: 'POST', path: basePath },
    get: { method: 'GET', path: `${basePath}/:id` },
    update: { method: 'PUT', path: `${basePath}/:id` },
    delete: { method: 'DELETE', path: `${basePath}/:id` },
  }

  if (actions) {
    routes.actions = {}
    for (const [actionName, actionDef] of Object.entries(actions)) {
      const path = actionDef.path || `${basePath}/:id/${actionName}`
      routes.actions[actionName] = {
        method: actionDef.method,
        path,
      }
    }
  }

  if (relations) {
    routes.relations = {}
    for (const [relationName, _relationDef] of Object.entries(relations)) {
      routes.relations[relationName] = {
        method: 'GET',
        path: `${basePath}/:id/${relationName}`,
      }
    }
  }

  return routes
}

// ============================================================================
// Request-Scoped Resource Context (do-73qn)
// ============================================================================
// The global registry pattern causes state leakage between requests/tenants.
// This module provides request-scoped contexts for proper isolation.

/**
 * Minimal AsyncLocalStorage interface for type safety.
 * Compatible with Node.js AsyncLocalStorage and Cloudflare Workers.
 */
interface AsyncLocalStorageInterface<T> {
  run<R>(store: T, callback: () => R): R
  getStore(): T | undefined
}

/**
 * AsyncLocalStorage instance for resource context - lazily initialized.
 */
let resourceContextALS: AsyncLocalStorageInterface<Map<string, ResourceDefinition<StorableData>>> | null = null

/**
 * Initialize the AsyncLocalStorage lazily to avoid issues in environments without it.
 * Uses a stack-based fallback for non-ALS environments.
 */
function getResourceContextALS(): AsyncLocalStorageInterface<Map<string, ResourceDefinition<StorableData>>> {
  if (!resourceContextALS) {
    try {
      // Try to use globalThis.AsyncLocalStorage (available in Node.js and Cloudflare Workers)
      const ALS = (globalThis as { AsyncLocalStorage?: new <T>() => AsyncLocalStorageInterface<T> }).AsyncLocalStorage

      if (typeof ALS === 'function') {
        resourceContextALS = new ALS<Map<string, ResourceDefinition<StorableData>>>()
      } else {
        throw new Error('AsyncLocalStorage not available')
      }
    } catch {
      // Fallback: Simple stack-based implementation for non-ALS environments
      const contextStack: Map<string, ResourceDefinition<StorableData>>[] = []

      resourceContextALS = {
        run<R>(store: Map<string, ResourceDefinition<StorableData>>, callback: () => R): R {
          contextStack.push(store)

          try {
            const result = callback()

            // Handle promises
            const isPromiseLike = (val: unknown): val is PromiseLike<unknown> =>
              val !== null &&
              typeof val === 'object' &&
              typeof (val as PromiseLike<unknown>).then === 'function'

            if (isPromiseLike(result)) {
              const resultPromise = Promise.resolve(result).finally(() => {
                contextStack.pop()
              })
              return resultPromise as unknown as R
            }

            contextStack.pop()
            return result
          } catch (error) {
            contextStack.pop()
            throw error
          }
        },
        getStore(): Map<string, ResourceDefinition<StorableData>> | undefined {
          return contextStack[contextStack.length - 1]
        },
      }
    }
  }
  return resourceContextALS
}

/**
 * Run a function with a resource registry scoped to this request.
 *
 * Resources defined within the context are isolated from other requests,
 * preventing tenant data leakage in multi-tenant environments.
 *
 * @param fn - The async function to run with the scoped registry
 * @returns The result of the function
 *
 * @example
 * ```ts
 * // In middleware - ensures tenant isolation
 * app.use(async (c, next) => {
 *   await runWithResourceContext(async () => {
 *     await next()
 *   })
 * })
 *
 * // In handler - resources are isolated per request
 * await runWithResourceContext(async () => {
 *   const Customer = defineResource('Customer')
 *     .fields({ name: { type: 'string' } })
 *     .build()
 *
 *   // This Customer is only visible within this context
 * })
 * ```
 */
export function runWithResourceContext<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const als = getResourceContextALS()
  return als.run(new Map(), fn)
}

/**
 * Get the current resource context from the request scope.
 * Returns undefined if not running within runWithResourceContext().
 *
 * @returns The current context Map or undefined
 */
export function getCurrentResourceContext(): Map<string, ResourceDefinition<StorableData>> | undefined {
  if (!resourceContextALS) {
    return undefined
  }
  return resourceContextALS.getStore()
}

/**
 * Get the active resource registry - context-scoped if available, otherwise global.
 *
 * When running within runWithResourceContext(), returns the request-scoped registry.
 * When running outside a context, falls back to the global registry (deprecated behavior).
 *
 * @returns The active resource registry Map
 * @internal
 */
function getActiveRegistry(): Map<string, ResourceDefinition<StorableData>> {
  const contextStore = resourceContextALS?.getStore()
  return contextStore ?? globalResourceRegistry
}

// ============================================================================
// Global Resource Registry (DEPRECATED - do-73qn)
// ============================================================================
// DEPRECATED: The global registry pattern causes state leakage between
// requests/tenants. Use runWithResourceContext() for proper isolation.
//
// Migration guide:
// 1. Wrap request handlers with runWithResourceContext()
// 2. Resources defined within the context are automatically isolated
// 3. Use getResource() and getAllResources() as before - they now
//    respect the context when available
//
// Example migration:
//   // Before (leaky global state)
//   defineResource('Customer').fields({...}).build()
//
//   // After (isolated per request)
//   await runWithResourceContext(async () => {
//     defineResource('Customer').fields({...}).build()
//   })

/**
 * @deprecated Global registry causes tenant state leakage. Use runWithResourceContext() instead.
 * @internal
 */
const globalResourceRegistry: Map<string, ResourceDefinition<StorableData>> = new Map()

/**
 * Register a resource in the active registry (context-scoped or global).
 * @internal
 */
function registerResource<T extends StorableData>(name: string, definition: ResourceDefinition<T>): void {
  getActiveRegistry().set(name, definition as unknown as ResourceDefinition<StorableData>)
}

/**
 * Get a resource definition by name.
 *
 * When running within runWithResourceContext(), only returns resources from that context.
 * When running outside a context, returns resources from the global registry.
 *
 * @param name - The resource name
 * @returns The resource definition or undefined
 */
export function getResource(name: string): ResourceDefinition<StorableData> | undefined {
  return getActiveRegistry().get(name)
}

/**
 * Get all registered resource definitions.
 *
 * When running within runWithResourceContext(), only returns resources from that context.
 * When running outside a context, returns resources from the global registry.
 *
 * @returns Record of resource name to definition
 */
export function getAllResources(): Record<string, ResourceDefinition<StorableData>> {
  return Object.fromEntries(getActiveRegistry().entries())
}

/**
 * Clear the active resource registry.
 *
 * When running within runWithResourceContext(), clears the context registry.
 * When running outside a context, clears the global registry.
 *
 * @deprecated Use runWithResourceContext() instead - contexts auto-clear when they exit.
 */
export function clearRegistry(): void {
  getActiveRegistry().clear()
}

/**
 * Clear the global resource registry.
 * Useful for testing to reset global state between tests.
 *
 * @deprecated Global registry is deprecated. Use runWithResourceContext() for proper isolation.
 */
export function clearGlobalRegistry(): void {
  globalResourceRegistry.clear()
}

/**
 * Create a new resource definition using the fluent builder API.
 *
 * @template T - The resource data type
 * @param name - The resource name (e.g., 'Customer', 'Order')
 * @returns ResourceBuilder for chaining
 *
 * @example
 * ```typescript
 * const CustomerResource = defineResource('Customer')
 *   .fields({
 *     name: { type: 'string', required: true },
 *     email: { type: 'string', format: 'email' }
 *   })
 *   .build()
 * ```
 */
export function defineResource<T extends StorableData = StorableData>(name: string): ResourceBuilder<T> {
  return new ResourceBuilder<T>(name)
}
