// Resource definition DSL - see do-7rf.7.4
import { z } from 'zod'
import type { Context } from 'hono'

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
  default?: unknown
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
export interface HookDef {
  beforeValidate?: (data: any) => Promise<any>
  beforeCreate?: (data: any) => Promise<any>
  afterCreate?: (data: any) => Promise<any>
  beforeUpdate?: (id: string, data: any) => Promise<any>
  afterUpdate?: (id: string, data: any) => Promise<any>
  beforeDelete?: (id: string) => Promise<void>
  afterDelete?: (id: string) => Promise<void>
}

// Computed Field Types
export type ComputedFieldDef = {
  [key: string]: (data: any) => any
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

// Resource Definition
export interface ResourceDefinition {
  name: string
  fields: Record<string, FieldDef>
  schema: z.ZodType
  relations?: Record<string, RelationDef>
  actions?: Record<string, ActionDef>
  hooks?: HookDef
  computed?: ComputedFieldDef
  routes: RouteDefinitions
}

// Resource Builder (Fluent API)
export class ResourceBuilder {
  private name: string
  private _fields: Record<string, FieldDef> = {}
  private _relations?: Record<string, RelationDef>
  private _actions?: Record<string, ActionDef>
  private _hooks?: HookDef
  private _computed?: ComputedFieldDef

  constructor(name: string) {
    this.name = name
  }

  fields(fields: Record<string, FieldDef>): this {
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

  hooks(hooks: HookDef): this {
    this._hooks = hooks
    return this
  }

  computed(computed: ComputedFieldDef): this {
    this._computed = computed
    return this
  }

  build(): ResourceDefinition {
    const schema = buildZodSchema(this._fields)
    const routes = generateRoutes(this.name, this._actions, this._relations)

    const definition: ResourceDefinition = {
      name: this.name,
      fields: this._fields,
      schema,
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
    for (const [relationName, relationDef] of Object.entries(relations)) {
      routes.relations[relationName] = {
        method: 'GET',
        path: `${basePath}/:id/${relationName}`,
      }
    }
  }

  return routes
}

// Global Resource Registry
const resourceRegistry: Map<string, ResourceDefinition> = new Map()

function registerResource(name: string, definition: ResourceDefinition): void {
  resourceRegistry.set(name, definition)
}

export function getResource(name: string): ResourceDefinition | undefined {
  return resourceRegistry.get(name)
}

export function getAllResources(): Record<string, ResourceDefinition> {
  return Object.fromEntries(resourceRegistry.entries())
}

export function clearRegistry(): void {
  resourceRegistry.clear()
}

// Main export - fluent API entry point
export function defineResource(name: string): ResourceBuilder {
  return new ResourceBuilder(name)
}
