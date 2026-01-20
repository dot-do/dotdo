// Resource definition DSL - see do-7rf.7.4
import { z } from 'zod'
import type { Context } from 'hono'
import type { JsonValue, StorableData } from '@dotdo/db'

// Field Types
export type FieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'enum'
  | 'date'

export interface BaseFieldDef {
  type: FieldType
  required?: boolean
  default?: JsonValue
}

export interface StringFieldDef extends BaseFieldDef {
  type: 'string'
  minLength?: number
  maxLength?: number
  pattern?: RegExp
  format?: 'email' | 'url' | 'uuid' | 'date-time'
}

export interface NumberFieldDef extends BaseFieldDef {
  type: 'number' | 'integer'
  min?: number
  max?: number
}

export interface ArrayFieldDef extends BaseFieldDef {
  type: 'array'
  items?: FieldType | z.ZodType
  minItems?: number
  maxItems?: number
}

export interface EnumFieldDef extends BaseFieldDef {
  type: 'enum'
  values: readonly string[]
}

export interface ObjectFieldDef extends BaseFieldDef {
  type: 'object'
  schema?: z.ZodType
}

export type FieldDef =
  | StringFieldDef
  | NumberFieldDef
  | ArrayFieldDef
  | EnumFieldDef
  | ObjectFieldDef
  | BaseFieldDef

// Relation Types
export interface RelationDef {
  type: 'hasOne' | 'hasMany' | 'belongsTo'
  resource: string
  foreignKey?: string
}

// Action Types
export interface ActionDef {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  handler: (ctx: Context) => Promise<unknown>
  path?: string
  description?: string
}

// Hook Types
export interface HookDef<T extends StorableData = StorableData> {
  beforeValidate?: (data: Partial<T>) => Promise<Partial<T>>
  beforeCreate?: (data: T) => Promise<T>
  afterCreate?: (data: T) => Promise<T>
  beforeUpdate?: (id: string, data: Partial<T>) => Promise<Partial<T>>
  afterUpdate?: (id: string, data: T) => Promise<T>
  beforeDelete?: (id: string) => Promise<void>
  afterDelete?: (id: string) => Promise<void>
}

// Computed Field Types
export type ComputedFieldDef<T extends StorableData = StorableData> = {
  [key: string]: (data: T) => JsonValue
}

// Route Definitions
export interface RouteDefinitions {
  list: { method: 'GET'; path: string }
  create: { method: 'POST'; path: string }
  get: { method: 'GET'; path: string }
  update: { method: 'PUT'; path: string }
  delete: { method: 'DELETE'; path: string }
  actions?: Record<string, { method: string; path: string }>
  relations?: Record<string, { method: 'GET'; path: string }>
}

// Type-safe field definitions that match the resource data type
// When T is provided, fields must be a subset of T's keys (excluding $id)
// When T is StorableData (default), any field names are allowed
export type ResourceFields<T extends StorableData = StorableData> =
  T extends StorableData
    ? keyof T extends string
      ? { [K in Exclude<keyof T, '$id'>]?: FieldDef } & Record<string, FieldDef>
      : Record<string, FieldDef>
    : Record<string, FieldDef>

// Resource Definition
export interface ResourceDefinition<T extends StorableData = StorableData> {
  name: string
  fields: ResourceFields<T>
  schema: z.ZodType<T>
  relations?: Record<string, RelationDef>
  actions?: Record<string, ActionDef>
  hooks?: HookDef<T>
  computed?: ComputedFieldDef<T>
  routes?: RouteDefinitions
}

// Resource Builder (Fluent API)
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

  fields(fields: ResourceFields<T>): this {
    this._fields = fields
    return this
  }

  relations(relations: Record<string, RelationDef>): this {
    this._relations = relations
    return this
  }

  actions(actions: Record<string, ActionDef>): this {
    this._actions = actions
    return this
  }

  hooks(hooks: HookDef<T>): this {
    this._hooks = hooks
    return this
  }

  computed(computed: ComputedFieldDef<T>): this {
    this._computed = computed
    return this
  }

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

// Build Zod schema from field definitions
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

// Generate route definitions
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
// Request-Scoped Resource Context
// ============================================================================
// The global registry pattern causes tenant state leakage in multi-tenant
// environments. This module provides request-scoped contexts for isolation.
// See do-9jh4 for the original bug report.

/**
 * Request-scoped resource context that contains isolated state
 */
export interface ResourceContext {
  /**
   * Register a resource in this context
   */
  registerResource<T extends StorableData>(name: string, definition: ResourceDefinition<T>): void

  /**
   * Get a resource by name from this context
   */
  getResource(name: string): ResourceDefinition<StorableData> | undefined

  /**
   * Get all resources from this context
   */
  getAllResources(): Record<string, ResourceDefinition<StorableData>>

  /**
   * Clear all resources from this context
   */
  clearRegistry(): void

  /**
   * Cleanup this context (alias for clearRegistry)
   */
  cleanup(): void
}

/**
 * Create a new request-scoped resource context with isolated state.
 *
 * Each context has its own resource registry, preventing resources
 * defined by one tenant from leaking to another.
 *
 * @returns A new isolated ResourceContext
 *
 * @example
 * ```ts
 * // Per-request usage
 * export async function handleRequest(request: Request) {
 *   const ctx = createResourceContext()
 *
 *   try {
 *     // Define resources for this tenant
 *     ctx.registerResource('CustomResource', definition)
 *     return await processRequest(ctx, request)
 *   } finally {
 *     ctx.cleanup()
 *   }
 * }
 * ```
 */
export function createResourceContext(): ResourceContext {
  // Private state for this context
  const registry = new Map<string, ResourceDefinition<StorableData>>()

  return {
    registerResource<T extends StorableData>(name: string, definition: ResourceDefinition<T>): void {
      registry.set(name, definition as unknown as ResourceDefinition<StorableData>)
    },

    getResource(name: string): ResourceDefinition<StorableData> | undefined {
      return registry.get(name)
    },

    getAllResources(): Record<string, ResourceDefinition<StorableData>> {
      return Object.fromEntries(registry.entries())
    },

    clearRegistry(): void {
      registry.clear()
    },

    cleanup(): void {
      registry.clear()
    },
  }
}

/**
 * Minimal AsyncLocalStorage interface for type safety.
 * Compatible with Node.js AsyncLocalStorage and Cloudflare Workers.
 */
interface AsyncLocalStorageInterface<T> {
  run<R>(store: T, callback: () => R): R
  getStore(): T | undefined
}

/**
 * AsyncLocalStorage instance - lazily initialized.
 * Works in Node.js, Cloudflare Workers, and other compatible runtimes.
 */
let asyncLocalStorage: AsyncLocalStorageInterface<ResourceContext> | null = null

// Lazy initialization to avoid issues in environments without AsyncLocalStorage
async function getAsyncLocalStorage(): Promise<AsyncLocalStorageInterface<ResourceContext>> {
  if (!asyncLocalStorage) {
    try {
      // Try dynamic import for Node.js/Workers environments
      const moduleName = 'node:async_hooks'
      const asyncHooks = await (import(moduleName) as Promise<{
        AsyncLocalStorage: new <T>() => AsyncLocalStorageInterface<T>
      }>)
      asyncLocalStorage = new asyncHooks.AsyncLocalStorage<ResourceContext>()
    } catch {
      // Fallback: Simple implementation using a stack for non-ALS environments
      const contextStack: ResourceContext[] = []
      asyncLocalStorage = {
        run<R>(store: ResourceContext, callback: () => R): R {
          contextStack.push(store)
          try {
            return callback()
          } finally {
            contextStack.pop()
          }
        },
        getStore(): ResourceContext | undefined {
          return contextStack[contextStack.length - 1]
        },
      }
    }
  }
  return asyncLocalStorage!
}

/**
 * Run a function with a new request-scoped resource context.
 * The context is automatically available via getCurrentResourceContext().
 *
 * @param fn - The async function to run with the context
 * @returns The result of the function
 *
 * @example
 * ```ts
 * // In middleware
 * app.use(async (c, next) => {
 *   await runWithResourceContext(async () => {
 *     await next()
 *   })
 * })
 *
 * // In handler - resources are isolated per request
 * const ctx = getCurrentResourceContext()
 * const resource = ctx?.getResource('CustomResource')
 * ```
 */
export async function runWithResourceContext<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = createResourceContext()
  const als = await getAsyncLocalStorage()

  try {
    return await als.run(ctx, fn)
  } finally {
    ctx.cleanup()
  }
}

/**
 * Get the current resource context from AsyncLocalStorage.
 * Returns undefined if not running within runWithResourceContext().
 *
 * @returns The current ResourceContext or undefined
 */
export function getCurrentResourceContext(): ResourceContext | undefined {
  if (!asyncLocalStorage) {
    return undefined
  }
  return asyncLocalStorage.getStore()
}

/**
 * Get or create a resource context for the current request.
 * If running within runWithResourceContext(), returns that context.
 * Otherwise, returns the global registry wrapped as a ResourceContext.
 *
 * This ensures backward compatibility with code that doesn't use
 * the request-scoped pattern.
 *
 * @returns A ResourceContext (existing, new, or global fallback)
 */
export function getOrCreateResourceContext(): ResourceContext {
  const existing = getCurrentResourceContext()
  if (existing) {
    return existing
  }
  // Return global registry wrapped as a context for backward compatibility
  return globalResourceContext
}

// ============================================================================
// Global Resource Registry (for backward compatibility)
// ============================================================================
// WARNING: Using the global registry directly causes state leakage between
// requests/tenants. Prefer using request-scoped contexts via
// runWithResourceContext() for proper isolation.

const resourceRegistry: Map<string, ResourceDefinition<StorableData>> = new Map()

// Global registry wrapped as a ResourceContext for getOrCreateResourceContext()
const globalResourceContext: ResourceContext = {
  registerResource<T extends StorableData>(name: string, definition: ResourceDefinition<T>): void {
    resourceRegistry.set(name, definition as unknown as ResourceDefinition<StorableData>)
  },
  getResource(name: string): ResourceDefinition<StorableData> | undefined {
    return resourceRegistry.get(name)
  },
  getAllResources(): Record<string, ResourceDefinition<StorableData>> {
    return Object.fromEntries(resourceRegistry.entries())
  },
  clearRegistry(): void {
    resourceRegistry.clear()
  },
  cleanup(): void {
    resourceRegistry.clear()
  },
}

function registerResource<T extends StorableData>(name: string, definition: ResourceDefinition<T>): void {
  // If running in a request context, register there
  const ctx = getCurrentResourceContext()
  if (ctx) {
    ctx.registerResource(name, definition)
  } else {
    // Fall back to global registry for backward compatibility
    resourceRegistry.set(name, definition as unknown as ResourceDefinition<StorableData>)
  }
}

export function getResource(name: string): ResourceDefinition<StorableData> | undefined {
  // If running in a request context, get from there first
  const ctx = getCurrentResourceContext()
  if (ctx) {
    const resource = ctx.getResource(name)
    if (resource) {
      return resource
    }
  }
  // Fall back to global registry
  return resourceRegistry.get(name)
}

export function getAllResources(): Record<string, ResourceDefinition<StorableData>> {
  // If running in a request context, merge with global
  const ctx = getCurrentResourceContext()
  if (ctx) {
    // Request context resources override global ones
    return { ...Object.fromEntries(resourceRegistry.entries()), ...ctx.getAllResources() }
  }
  return Object.fromEntries(resourceRegistry.entries())
}

export function clearRegistry(): void {
  // Clear the appropriate registry
  const ctx = getCurrentResourceContext()
  if (ctx) {
    ctx.clearRegistry()
  } else {
    resourceRegistry.clear()
  }
}

/**
 * Clear the global registry explicitly.
 * Use this for testing or when you need to reset global state.
 */
export function clearGlobalRegistry(): void {
  resourceRegistry.clear()
}

// Main export - fluent API entry point
export function defineResource<T extends StorableData = StorableData>(name: string): ResourceBuilder<T> {
  return new ResourceBuilder<T>(name)
}
