/**
 * Schema Definition DSL for DataContract
 *
 * Provides a fluent API for defining schemas with support for:
 * - Zod schema generation
 * - JSON Schema generation
 * - TypeScript type inference
 * - Field types, constraints, defaults
 * - Required/optional fields
 * - Nested object support
 */

import { z, type ZodType, type ZodTypeAny, type ZodObject, type ZodRawShape } from 'zod'
import type { JSONSchema, SchemaMetadata, DataContract } from './index'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Metadata for data contracts including SLA and ownership
 */
export interface ContractMetadata extends SchemaMetadata {
  team?: string
  sla?: {
    freshness?: string // e.g., "1h", "24h"
    availability?: number // e.g., 0.999
    latency?: string // e.g., "<100ms"
  }
}

/**
 * Contract definition input
 */
export interface ContractDefinition<T = unknown> {
  name: string
  version: string
  schema: FieldBuilder<T> | ZodType<T> | JSONSchema
  metadata?: ContractMetadata
}

/**
 * Extended DataContract with Zod support
 */
export interface ZodDataContract<T = unknown> extends DataContract {
  zodSchema: ZodType<T>
  jsonSchema: JSONSchema
}

// ============================================================================
// FIELD BUILDERS
// ============================================================================

/**
 * Base field builder interface
 */
interface BaseFieldBuilder<T> {
  optional(): BaseFieldBuilder<T | undefined>
  nullable(): BaseFieldBuilder<T | null>
  default(value: T): BaseFieldBuilder<T>
  description(desc: string): BaseFieldBuilder<T>
  toZod(): ZodType<T>
  toJSONSchema(): JSONSchema
}

/**
 * String field builder
 */
class StringFieldBuilder implements BaseFieldBuilder<string> {
  private _optional = false
  private _nullable = false
  private _default?: string
  private _description?: string
  private _minLength?: number
  private _maxLength?: number
  private _pattern?: string
  private _format?: 'email' | 'uri' | 'uuid' | 'date' | 'date-time' | 'time'
  private _enum?: string[]

  optional(): StringFieldBuilder {
    this._optional = true
    return this
  }

  nullable(): StringFieldBuilder {
    this._nullable = true
    return this
  }

  default(value: string): StringFieldBuilder {
    this._default = value
    return this
  }

  description(desc: string): StringFieldBuilder {
    this._description = desc
    return this
  }

  min(length: number): StringFieldBuilder {
    this._minLength = length
    return this
  }

  max(length: number): StringFieldBuilder {
    this._maxLength = length
    return this
  }

  length(min: number, max?: number): StringFieldBuilder {
    this._minLength = min
    this._maxLength = max ?? min
    return this
  }

  pattern(regex: string | RegExp): StringFieldBuilder {
    this._pattern = typeof regex === 'string' ? regex : regex.source
    return this
  }

  email(): StringFieldBuilder {
    this._format = 'email'
    return this
  }

  url(): StringFieldBuilder {
    this._format = 'uri'
    return this
  }

  uuid(): StringFieldBuilder {
    this._format = 'uuid'
    return this
  }

  date(): StringFieldBuilder {
    this._format = 'date'
    return this
  }

  datetime(): StringFieldBuilder {
    this._format = 'date-time'
    return this
  }

  time(): StringFieldBuilder {
    this._format = 'time'
    return this
  }

  enum<E extends string>(values: readonly E[]): StringFieldBuilder {
    this._enum = [...values]
    return this
  }

  toZod(): ZodType<string> {
    let schema: ZodTypeAny = z.string()

    if (this._minLength !== undefined) {
      schema = (schema as z.ZodString).min(this._minLength)
    }
    if (this._maxLength !== undefined) {
      schema = (schema as z.ZodString).max(this._maxLength)
    }
    if (this._pattern !== undefined) {
      schema = (schema as z.ZodString).regex(new RegExp(this._pattern))
    }
    if (this._format === 'email') {
      schema = (schema as z.ZodString).email()
    }
    if (this._format === 'uri') {
      schema = (schema as z.ZodString).url()
    }
    if (this._format === 'uuid') {
      schema = (schema as z.ZodString).uuid()
    }
    if (this._format === 'date-time') {
      schema = (schema as z.ZodString).datetime()
    }
    if (this._enum) {
      schema = z.enum(this._enum as [string, ...string[]])
    }
    if (this._description) {
      schema = schema.describe(this._description)
    }
    if (this._default !== undefined) {
      schema = schema.default(this._default)
    }
    if (this._nullable) {
      schema = schema.nullable()
    }
    if (this._optional) {
      schema = schema.optional()
    }

    return schema as ZodType<string>
  }

  toJSONSchema(): JSONSchema {
    const jsonSchema: JSONSchema = { type: 'string' }

    if (this._minLength !== undefined) {
      jsonSchema.minLength = this._minLength
    }
    if (this._maxLength !== undefined) {
      jsonSchema.maxLength = this._maxLength
    }
    if (this._pattern !== undefined) {
      jsonSchema.pattern = this._pattern
    }
    if (this._format !== undefined) {
      jsonSchema.format = this._format
    }
    if (this._enum !== undefined) {
      jsonSchema.enum = this._enum
    }
    if (this._description !== undefined) {
      jsonSchema.description = this._description
    }
    if (this._default !== undefined) {
      jsonSchema.default = this._default
    }
    if (this._nullable) {
      jsonSchema.type = ['string', 'null']
    }

    return jsonSchema
  }

  isOptional(): boolean {
    return this._optional
  }
}

/**
 * Number field builder
 */
class NumberFieldBuilder implements BaseFieldBuilder<number> {
  private _optional = false
  private _nullable = false
  private _default?: number
  private _description?: string
  private _minimum?: number
  private _maximum?: number
  private _exclusiveMinimum?: number
  private _exclusiveMaximum?: number
  private _integer = false

  optional(): NumberFieldBuilder {
    this._optional = true
    return this
  }

  nullable(): NumberFieldBuilder {
    this._nullable = true
    return this
  }

  default(value: number): NumberFieldBuilder {
    this._default = value
    return this
  }

  description(desc: string): NumberFieldBuilder {
    this._description = desc
    return this
  }

  min(value: number): NumberFieldBuilder {
    this._minimum = value
    return this
  }

  max(value: number): NumberFieldBuilder {
    this._maximum = value
    return this
  }

  range(min: number, max: number): NumberFieldBuilder {
    this._minimum = min
    this._maximum = max
    return this
  }

  gt(value: number): NumberFieldBuilder {
    this._exclusiveMinimum = value
    return this
  }

  lt(value: number): NumberFieldBuilder {
    this._exclusiveMaximum = value
    return this
  }

  positive(): NumberFieldBuilder {
    this._exclusiveMinimum = 0
    return this
  }

  negative(): NumberFieldBuilder {
    this._exclusiveMaximum = 0
    return this
  }

  nonnegative(): NumberFieldBuilder {
    this._minimum = 0
    return this
  }

  integer(): NumberFieldBuilder {
    this._integer = true
    return this
  }

  toZod(): ZodType<number> {
    let schema: ZodTypeAny = this._integer ? z.number().int() : z.number()

    if (this._minimum !== undefined) {
      schema = (schema as z.ZodNumber).min(this._minimum)
    }
    if (this._maximum !== undefined) {
      schema = (schema as z.ZodNumber).max(this._maximum)
    }
    if (this._exclusiveMinimum !== undefined) {
      schema = (schema as z.ZodNumber).gt(this._exclusiveMinimum)
    }
    if (this._exclusiveMaximum !== undefined) {
      schema = (schema as z.ZodNumber).lt(this._exclusiveMaximum)
    }
    if (this._description) {
      schema = schema.describe(this._description)
    }
    if (this._default !== undefined) {
      schema = schema.default(this._default)
    }
    if (this._nullable) {
      schema = schema.nullable()
    }
    if (this._optional) {
      schema = schema.optional()
    }

    return schema as ZodType<number>
  }

  toJSONSchema(): JSONSchema {
    const jsonSchema: JSONSchema = {
      type: this._integer ? 'integer' : 'number',
    }

    if (this._minimum !== undefined) {
      jsonSchema.minimum = this._minimum
    }
    if (this._maximum !== undefined) {
      jsonSchema.maximum = this._maximum
    }
    if (this._exclusiveMinimum !== undefined) {
      jsonSchema.minimum = this._exclusiveMinimum
      jsonSchema.exclusiveMinimum = true
    }
    if (this._exclusiveMaximum !== undefined) {
      jsonSchema.maximum = this._exclusiveMaximum
      jsonSchema.exclusiveMaximum = true
    }
    if (this._description !== undefined) {
      jsonSchema.description = this._description
    }
    if (this._default !== undefined) {
      jsonSchema.default = this._default
    }
    if (this._nullable) {
      jsonSchema.type = [this._integer ? 'integer' : 'number', 'null']
    }

    return jsonSchema
  }

  isOptional(): boolean {
    return this._optional
  }

  isInteger(): boolean {
    return this._integer
  }
}

/**
 * Boolean field builder
 */
class BooleanFieldBuilder implements BaseFieldBuilder<boolean> {
  private _optional = false
  private _nullable = false
  private _default?: boolean
  private _description?: string

  optional(): BooleanFieldBuilder {
    this._optional = true
    return this
  }

  nullable(): BooleanFieldBuilder {
    this._nullable = true
    return this
  }

  default(value: boolean): BooleanFieldBuilder {
    this._default = value
    return this
  }

  description(desc: string): BooleanFieldBuilder {
    this._description = desc
    return this
  }

  toZod(): ZodType<boolean> {
    let schema: ZodTypeAny = z.boolean()

    if (this._description) {
      schema = schema.describe(this._description)
    }
    if (this._default !== undefined) {
      schema = schema.default(this._default)
    }
    if (this._nullable) {
      schema = schema.nullable()
    }
    if (this._optional) {
      schema = schema.optional()
    }

    return schema as ZodType<boolean>
  }

  toJSONSchema(): JSONSchema {
    const jsonSchema: JSONSchema = { type: 'boolean' }

    if (this._description !== undefined) {
      jsonSchema.description = this._description
    }
    if (this._default !== undefined) {
      jsonSchema.default = this._default
    }
    if (this._nullable) {
      jsonSchema.type = ['boolean', 'null']
    }

    return jsonSchema
  }

  isOptional(): boolean {
    return this._optional
  }
}

/**
 * Array field builder
 */
class ArrayFieldBuilder<T> implements BaseFieldBuilder<T[]> {
  private _optional = false
  private _nullable = false
  private _default?: T[]
  private _description?: string
  private _minItems?: number
  private _maxItems?: number
  private _itemBuilder: FieldBuilder<T>

  constructor(itemBuilder: FieldBuilder<T>) {
    this._itemBuilder = itemBuilder
  }

  optional(): ArrayFieldBuilder<T> {
    this._optional = true
    return this
  }

  nullable(): ArrayFieldBuilder<T> {
    this._nullable = true
    return this
  }

  default(value: T[]): ArrayFieldBuilder<T> {
    this._default = value
    return this
  }

  description(desc: string): ArrayFieldBuilder<T> {
    this._description = desc
    return this
  }

  min(length: number): ArrayFieldBuilder<T> {
    this._minItems = length
    return this
  }

  max(length: number): ArrayFieldBuilder<T> {
    this._maxItems = length
    return this
  }

  length(min: number, max?: number): ArrayFieldBuilder<T> {
    this._minItems = min
    this._maxItems = max ?? min
    return this
  }

  nonempty(): ArrayFieldBuilder<T> {
    this._minItems = 1
    return this
  }

  toZod(): ZodType<T[]> {
    let schema: ZodTypeAny = z.array(this._itemBuilder.toZod())

    if (this._minItems !== undefined) {
      schema = (schema as z.ZodArray<ZodTypeAny>).min(this._minItems)
    }
    if (this._maxItems !== undefined) {
      schema = (schema as z.ZodArray<ZodTypeAny>).max(this._maxItems)
    }
    if (this._description) {
      schema = schema.describe(this._description)
    }
    if (this._default !== undefined) {
      schema = schema.default(this._default)
    }
    if (this._nullable) {
      schema = schema.nullable()
    }
    if (this._optional) {
      schema = schema.optional()
    }

    return schema as ZodType<T[]>
  }

  toJSONSchema(): JSONSchema {
    const jsonSchema: JSONSchema = {
      type: 'array',
      items: this._itemBuilder.toJSONSchema(),
    }

    if (this._minItems !== undefined) {
      jsonSchema.minItems = this._minItems
    }
    if (this._maxItems !== undefined) {
      jsonSchema.maxItems = this._maxItems
    }
    if (this._description !== undefined) {
      jsonSchema.description = this._description
    }
    if (this._default !== undefined) {
      jsonSchema.default = this._default
    }
    if (this._nullable) {
      jsonSchema.type = ['array', 'null']
    }

    return jsonSchema
  }

  isOptional(): boolean {
    return this._optional
  }
}

/**
 * Object field builder (for nested objects)
 */
class ObjectFieldBuilder<T extends Record<string, unknown>> implements BaseFieldBuilder<T> {
  private _optional = false
  private _nullable = false
  private _default?: T
  private _description?: string
  private _fields: Record<string, FieldBuilder<unknown>>
  private _additionalProperties: boolean | FieldBuilder<unknown> = true

  constructor(fields: Record<string, FieldBuilder<unknown>>) {
    this._fields = fields
  }

  optional(): ObjectFieldBuilder<T> {
    this._optional = true
    return this
  }

  nullable(): ObjectFieldBuilder<T> {
    this._nullable = true
    return this
  }

  default(value: T): ObjectFieldBuilder<T> {
    this._default = value
    return this
  }

  description(desc: string): ObjectFieldBuilder<T> {
    this._description = desc
    return this
  }

  strict(): ObjectFieldBuilder<T> {
    this._additionalProperties = false
    return this
  }

  passthrough(): ObjectFieldBuilder<T> {
    this._additionalProperties = true
    return this
  }

  toZod(): ZodType<T> {
    const shape: ZodRawShape = {}

    for (const [key, builder] of Object.entries(this._fields)) {
      shape[key] = builder.toZod()
    }

    let schema: ZodTypeAny = z.object(shape)

    if (this._additionalProperties === false) {
      schema = (schema as ZodObject<ZodRawShape>).strict()
    } else if (this._additionalProperties === true) {
      schema = (schema as ZodObject<ZodRawShape>).passthrough()
    }

    if (this._description) {
      schema = schema.describe(this._description)
    }
    if (this._default !== undefined) {
      schema = schema.default(this._default)
    }
    if (this._nullable) {
      schema = schema.nullable()
    }
    if (this._optional) {
      schema = schema.optional()
    }

    return schema as ZodType<T>
  }

  toJSONSchema(): JSONSchema {
    const properties: Record<string, JSONSchema> = {}
    const required: string[] = []

    for (const [key, builder] of Object.entries(this._fields)) {
      properties[key] = builder.toJSONSchema()
      if (!builder.isOptional()) {
        required.push(key)
      }
    }

    const jsonSchema: JSONSchema = {
      type: 'object',
      properties,
    }

    if (required.length > 0) {
      jsonSchema.required = required
    }

    if (this._additionalProperties === false) {
      jsonSchema.additionalProperties = false
    }

    if (this._description !== undefined) {
      jsonSchema.description = this._description
    }
    if (this._default !== undefined) {
      jsonSchema.default = this._default
    }
    if (this._nullable) {
      jsonSchema.type = ['object', 'null']
    }

    return jsonSchema
  }

  isOptional(): boolean {
    return this._optional
  }

  getFields(): Record<string, FieldBuilder<unknown>> {
    return this._fields
  }
}

// ============================================================================
// FIELD BUILDER TYPE
// ============================================================================

/**
 * Union type for all field builders
 */
export type FieldBuilder<T = unknown> =
  | StringFieldBuilder
  | NumberFieldBuilder
  | BooleanFieldBuilder
  | ArrayFieldBuilder<T extends (infer U)[] ? U : unknown>
  | ObjectFieldBuilder<T extends Record<string, unknown> ? T : Record<string, unknown>>

// ============================================================================
// SCHEMA DSL API
// ============================================================================

/**
 * Schema DSL entry point
 */
export const s = {
  /**
   * String field
   */
  string(): StringFieldBuilder {
    return new StringFieldBuilder()
  },

  /**
   * Number field
   */
  number(): NumberFieldBuilder {
    return new NumberFieldBuilder()
  },

  /**
   * Integer field (shorthand for number().integer())
   */
  int(): NumberFieldBuilder {
    return new NumberFieldBuilder().integer()
  },

  /**
   * Boolean field
   */
  boolean(): BooleanFieldBuilder {
    return new BooleanFieldBuilder()
  },

  /**
   * Boolean field (alias)
   */
  bool(): BooleanFieldBuilder {
    return new BooleanFieldBuilder()
  },

  /**
   * Array field
   */
  array<T>(itemBuilder: FieldBuilder<T>): ArrayFieldBuilder<T> {
    return new ArrayFieldBuilder(itemBuilder)
  },

  /**
   * Object field (for nested objects)
   */
  object<T extends Record<string, unknown>>(fields: Record<string, FieldBuilder<unknown>>): ObjectFieldBuilder<T> {
    return new ObjectFieldBuilder<T>(fields)
  },

  /**
   * Enum field (string enum)
   */
  enum<E extends string>(values: readonly E[]): StringFieldBuilder {
    return new StringFieldBuilder().enum(values)
  },

  /**
   * Email field (shorthand for string().email())
   */
  email(): StringFieldBuilder {
    return new StringFieldBuilder().email()
  },

  /**
   * URL field (shorthand for string().url())
   */
  url(): StringFieldBuilder {
    return new StringFieldBuilder().url()
  },

  /**
   * UUID field (shorthand for string().uuid())
   */
  uuid(): StringFieldBuilder {
    return new StringFieldBuilder().uuid()
  },

  /**
   * Date field (shorthand for string().date())
   */
  date(): StringFieldBuilder {
    return new StringFieldBuilder().date()
  },

  /**
   * DateTime field (shorthand for string().datetime())
   */
  datetime(): StringFieldBuilder {
    return new StringFieldBuilder().datetime()
  },
}

// ============================================================================
// CONTRACT FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a data contract from a schema definition
 */
export function contract<T>(definition: ContractDefinition<T>): ZodDataContract<T> {
  const { name, version, schema, metadata } = definition

  // Handle different schema types
  if (isFieldBuilder(schema)) {
    // DSL builder
    const zodSchema = schema.toZod() as ZodType<T>
    const jsonSchema = schema.toJSONSchema()

    return {
      name,
      version,
      schema: jsonSchema,
      metadata,
      zodSchema,
      jsonSchema,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  } else if (isZodSchema(schema)) {
    // Zod schema
    const jsonSchema = zodToJSONSchema(schema)

    return {
      name,
      version,
      schema: jsonSchema,
      metadata,
      zodSchema: schema,
      jsonSchema,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  } else {
    // JSON Schema
    const zodSchema = jsonSchemaToZod(schema) as ZodType<T>

    return {
      name,
      version,
      schema,
      metadata,
      zodSchema,
      jsonSchema: schema,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }
}

/**
 * Create a data contract from a Zod schema
 */
export function fromZod<T>(schema: ZodType<T>, options: { name: string; version: string; metadata?: ContractMetadata }): ZodDataContract<T> {
  const jsonSchema = zodToJSONSchema(schema)

  return {
    name: options.name,
    version: options.version,
    schema: jsonSchema,
    metadata: options.metadata,
    zodSchema: schema,
    jsonSchema,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

/**
 * Create a data contract from a JSON Schema
 */
export function fromJSONSchema(schema: JSONSchema, options: { name: string; version: string; metadata?: ContractMetadata }): ZodDataContract<unknown> {
  const zodSchema = jsonSchemaToZod(schema)

  return {
    name: options.name,
    version: options.version,
    schema,
    metadata: options.metadata,
    zodSchema,
    jsonSchema: schema,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

function isFieldBuilder(value: unknown): value is FieldBuilder<unknown> {
  return (
    value instanceof StringFieldBuilder ||
    value instanceof NumberFieldBuilder ||
    value instanceof BooleanFieldBuilder ||
    value instanceof ArrayFieldBuilder ||
    value instanceof ObjectFieldBuilder
  )
}

function isZodSchema(value: unknown): value is ZodType<unknown> {
  return value !== null && typeof value === 'object' && '_def' in value && 'parse' in value
}

// ============================================================================
// CONVERSION UTILITIES
// ============================================================================

/**
 * Convert Zod schema to JSON Schema
 */
export function zodToJSONSchema(zodSchema: ZodType<unknown>): JSONSchema {
  const def = (zodSchema as ZodTypeAny)._def

  switch (def.typeName) {
    case 'ZodString': {
      const schema: JSONSchema = { type: 'string' }
      if (def.checks) {
        for (const check of def.checks) {
          switch (check.kind) {
            case 'min':
              schema.minLength = check.value
              break
            case 'max':
              schema.maxLength = check.value
              break
            case 'email':
              schema.format = 'email'
              break
            case 'url':
              schema.format = 'uri'
              break
            case 'uuid':
              schema.format = 'uuid'
              break
            case 'datetime':
              schema.format = 'date-time'
              break
            case 'regex':
              schema.pattern = check.regex.source
              break
          }
        }
      }
      if (def.description) {
        schema.description = def.description
      }
      return schema
    }

    case 'ZodNumber': {
      const schema: JSONSchema = { type: 'number' }
      if (def.checks) {
        for (const check of def.checks) {
          switch (check.kind) {
            case 'min':
              if (check.inclusive) {
                schema.minimum = check.value
              } else {
                schema.minimum = check.value
                schema.exclusiveMinimum = true
              }
              break
            case 'max':
              if (check.inclusive) {
                schema.maximum = check.value
              } else {
                schema.maximum = check.value
                schema.exclusiveMaximum = true
              }
              break
            case 'int':
              schema.type = 'integer'
              break
          }
        }
      }
      if (def.description) {
        schema.description = def.description
      }
      return schema
    }

    case 'ZodBoolean': {
      const schema: JSONSchema = { type: 'boolean' }
      if (def.description) {
        schema.description = def.description
      }
      return schema
    }

    case 'ZodArray': {
      const schema: JSONSchema = {
        type: 'array',
        items: zodToJSONSchema(def.type),
      }
      if (def.minLength) {
        schema.minItems = def.minLength.value
      }
      if (def.maxLength) {
        schema.maxItems = def.maxLength.value
      }
      if (def.description) {
        schema.description = def.description
      }
      return schema
    }

    case 'ZodObject': {
      const schema: JSONSchema = {
        type: 'object',
        properties: {},
        required: [],
      }

      const shape = def.shape()
      for (const [key, value] of Object.entries(shape)) {
        schema.properties![key] = zodToJSONSchema(value as ZodType<unknown>)
        // Check if field is optional
        const fieldDef = (value as ZodTypeAny)._def
        if (fieldDef.typeName !== 'ZodOptional' && fieldDef.typeName !== 'ZodDefault') {
          schema.required!.push(key)
        }
      }

      if (schema.required!.length === 0) {
        delete schema.required
      }

      if (def.unknownKeys === 'strict') {
        schema.additionalProperties = false
      }

      if (def.description) {
        schema.description = def.description
      }
      return schema
    }

    case 'ZodOptional':
      return zodToJSONSchema(def.innerType)

    case 'ZodNullable': {
      const inner = zodToJSONSchema(def.innerType)
      const innerType = inner.type
      if (typeof innerType === 'string') {
        inner.type = [innerType, 'null'] as unknown as 'object'
      }
      return inner
    }

    case 'ZodDefault':
      const inner = zodToJSONSchema(def.innerType)
      inner.default = def.defaultValue()
      return inner

    case 'ZodEnum': {
      return {
        type: 'string',
        enum: def.values,
      }
    }

    case 'ZodNull':
      return { type: 'null' }

    default:
      return {}
  }
}

/**
 * Convert JSON Schema to Zod schema
 */
export function jsonSchemaToZod(jsonSchema: JSONSchema): ZodType<unknown> {
  const type = Array.isArray(jsonSchema.type) ? jsonSchema.type[0] : jsonSchema.type
  const isNullable = Array.isArray(jsonSchema.type) && jsonSchema.type.includes('null')

  let schema: ZodTypeAny

  switch (type) {
    case 'string': {
      let strSchema = z.string()
      if (jsonSchema.minLength !== undefined) {
        strSchema = strSchema.min(jsonSchema.minLength)
      }
      if (jsonSchema.maxLength !== undefined) {
        strSchema = strSchema.max(jsonSchema.maxLength)
      }
      if (jsonSchema.pattern !== undefined) {
        strSchema = strSchema.regex(new RegExp(jsonSchema.pattern))
      }
      if (jsonSchema.format === 'email') {
        strSchema = strSchema.email()
      }
      if (jsonSchema.format === 'uri') {
        strSchema = strSchema.url()
      }
      if (jsonSchema.format === 'uuid') {
        strSchema = strSchema.uuid()
      }
      if (jsonSchema.format === 'date-time') {
        strSchema = strSchema.datetime()
      }
      if (jsonSchema.enum) {
        schema = z.enum(jsonSchema.enum as [string, ...string[]])
      } else {
        schema = strSchema
      }
      break
    }

    case 'number':
    case 'integer': {
      let numSchema = z.number()
      if (type === 'integer') {
        numSchema = numSchema.int()
      }
      if (jsonSchema.minimum !== undefined) {
        if (jsonSchema.exclusiveMinimum === true) {
          numSchema = numSchema.gt(jsonSchema.minimum)
        } else {
          numSchema = numSchema.min(jsonSchema.minimum)
        }
      }
      if (jsonSchema.maximum !== undefined) {
        if (jsonSchema.exclusiveMaximum === true) {
          numSchema = numSchema.lt(jsonSchema.maximum)
        } else {
          numSchema = numSchema.max(jsonSchema.maximum)
        }
      }
      schema = numSchema
      break
    }

    case 'boolean':
      schema = z.boolean()
      break

    case 'array': {
      const itemSchema = jsonSchema.items ? jsonSchemaToZod(jsonSchema.items) : z.unknown()
      let arrSchema = z.array(itemSchema)
      if (jsonSchema.minItems !== undefined) {
        arrSchema = arrSchema.min(jsonSchema.minItems)
      }
      if (jsonSchema.maxItems !== undefined) {
        arrSchema = arrSchema.max(jsonSchema.maxItems)
      }
      schema = arrSchema
      break
    }

    case 'object': {
      const shape: ZodRawShape = {}
      const required = new Set(jsonSchema.required || [])

      if (jsonSchema.properties) {
        for (const [key, propSchema] of Object.entries(jsonSchema.properties)) {
          let fieldSchema = jsonSchemaToZod(propSchema)
          if (!required.has(key)) {
            fieldSchema = fieldSchema.optional()
          }
          shape[key] = fieldSchema
        }
      }

      let objSchema: ZodTypeAny = z.object(shape)
      if (jsonSchema.additionalProperties === false) {
        objSchema = (objSchema as ZodObject<ZodRawShape>).strict()
      }
      schema = objSchema
      break
    }

    case 'null':
      schema = z.null()
      break

    default:
      schema = z.unknown()
  }

  if (jsonSchema.description) {
    schema = schema.describe(jsonSchema.description)
  }
  if (jsonSchema.default !== undefined) {
    schema = schema.default(jsonSchema.default)
  }
  if (isNullable) {
    schema = schema.nullable()
  }

  return schema
}

// Export field builder classes for type checking
export { StringFieldBuilder, NumberFieldBuilder, BooleanFieldBuilder, ArrayFieldBuilder, ObjectFieldBuilder }
