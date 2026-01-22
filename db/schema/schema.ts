// Schema validation layer for @dotdo/db
// Lightweight Zod-like patterns for entity type safety
// See do-qz6x

import type { JsonValue, StorableData } from '../utils/types'

// ============================================================================
// Field Type Definitions
// ============================================================================

/**
 * Supported field types for schema definition
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object'

/**
 * Supported format validations for string fields
 */
export type StringFormat = 'email' | 'url' | 'uuid' | 'date' | 'datetime' | 'phone'

/**
 * Base field definition shared by all field types
 */
interface BaseFieldDef {
  required?: boolean
  description?: string
}

/**
 * String field definition
 */
export interface StringFieldDef extends BaseFieldDef {
  type: 'string'
  format?: StringFormat
  minLength?: number
  maxLength?: number
  pattern?: string
  enum?: string[]
}

/**
 * Number field definition
 */
export interface NumberFieldDef extends BaseFieldDef {
  type: 'number'
  min?: number
  max?: number
  integer?: boolean
}

/**
 * Boolean field definition
 */
export interface BooleanFieldDef extends BaseFieldDef {
  type: 'boolean'
}

/**
 * Array field definition
 */
export interface ArrayFieldDef extends BaseFieldDef {
  type: 'array'
  items?: FieldDef
  minItems?: number
  maxItems?: number
}

/**
 * Object field definition
 */
export interface ObjectFieldDef extends BaseFieldDef {
  type: 'object'
  properties?: Record<string, FieldDef>
}

/**
 * Union of all field definition types
 */
export type FieldDef =
  | StringFieldDef
  | NumberFieldDef
  | BooleanFieldDef
  | ArrayFieldDef
  | ObjectFieldDef

// ============================================================================
// Schema Definition
// ============================================================================

/**
 * Schema definition input
 */
export interface SchemaDef<T extends string = string> {
  $type: T
  fields: Record<string, FieldDef>
  strict?: boolean  // If true, reject unknown fields
}

/**
 * Validation error for a single field
 */
export interface ValidationError {
  field: string
  message: string
  value?: JsonValue
}

/**
 * Result of schema validation
 */
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

/**
 * Compiled schema with validation methods
 */
export interface Schema<T extends StorableData = StorableData> {
  readonly $type: string
  readonly fields: Record<string, FieldDef>
  readonly strict: boolean

  /**
   * Validate data against the schema
   */
  validate(data: Record<string, unknown>): ValidationResult

  /**
   * Validate and throw if invalid
   */
  parse(data: Record<string, unknown>): T

  /**
   * Validate without throwing, return typed result
   */
  safeParse(data: Record<string, unknown>): { success: true; data: T } | { success: false; errors: ValidationError[] }
}

// ============================================================================
// Type Inference
// ============================================================================

/**
 * Infer TypeScript type from a field definition
 */
type InferFieldType<F extends FieldDef> =
  F extends StringFieldDef ? (F['enum'] extends string[] ? F['enum'][number] : string) :
  F extends NumberFieldDef ? number :
  F extends BooleanFieldDef ? boolean :
  F extends ArrayFieldDef ? (F['items'] extends FieldDef ? InferFieldType<F['items']>[] : JsonValue[]) :
  F extends ObjectFieldDef ? (F['properties'] extends Record<string, FieldDef> ? { [K in keyof F['properties']]: InferFieldType<F['properties'][K]> } : Record<string, JsonValue>) :
  never

/**
 * Infer TypeScript type from a schema definition
 * Handles required vs optional fields
 */
export type InferSchema<S extends SchemaDef> = {
  [K in keyof S['fields'] as S['fields'][K]['required'] extends true ? K : never]: InferFieldType<S['fields'][K]>
} & {
  [K in keyof S['fields'] as S['fields'][K]['required'] extends true ? never : K]?: InferFieldType<S['fields'][K]>
}

// ============================================================================
// Format Validators
// ============================================================================

const FORMAT_VALIDATORS: Record<StringFormat, (value: string) => boolean> = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  url: (v) => {
    try {
      new URL(v)
      return true
    } catch {
      return false
    }
  },
  uuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v),
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)),
  datetime: (v) => !isNaN(Date.parse(v)),
  phone: (v) => /^\+?[\d\s-()]{7,}$/.test(v)
}

// ============================================================================
// Field Validation
// ============================================================================

/**
 * Validate a single field value against its definition
 */
function validateField(
  fieldName: string,
  value: unknown,
  def: FieldDef
): ValidationError[] {
  const errors: ValidationError[] = []

  // Handle null/undefined
  if (value === null || value === undefined) {
    if (def.required) {
      errors.push({
        field: fieldName,
        message: `Field is required`,
        value: value as JsonValue
      })
    }
    return errors
  }

  // Type validation
  switch (def.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push({
          field: fieldName,
          message: `Expected string, got ${typeof value}`,
          value: value as JsonValue
        })
        return errors
      }

      // String-specific validations
      if (def.minLength !== undefined && value.length < def.minLength) {
        errors.push({
          field: fieldName,
          message: `String must be at least ${def.minLength} characters`,
          value
        })
      }

      if (def.maxLength !== undefined && value.length > def.maxLength) {
        errors.push({
          field: fieldName,
          message: `String must be at most ${def.maxLength} characters`,
          value
        })
      }

      if (def.pattern !== undefined) {
        const regex = new RegExp(def.pattern)
        if (!regex.test(value)) {
          errors.push({
            field: fieldName,
            message: `String does not match pattern ${def.pattern}`,
            value
          })
        }
      }

      if (def.format !== undefined) {
        const validator = FORMAT_VALIDATORS[def.format]
        if (validator && !validator(value)) {
          errors.push({
            field: fieldName,
            message: `Invalid ${def.format} format`,
            value
          })
        }
      }

      if (def.enum !== undefined && !def.enum.includes(value)) {
        errors.push({
          field: fieldName,
          message: `Value must be one of: ${def.enum.join(', ')}`,
          value
        })
      }
      break

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push({
          field: fieldName,
          message: `Expected number, got ${typeof value}`,
          value: value as JsonValue
        })
        return errors
      }

      // Number-specific validations
      if (def.min !== undefined && value < def.min) {
        errors.push({
          field: fieldName,
          message: `Number must be at least ${def.min}`,
          value
        })
      }

      if (def.max !== undefined && value > def.max) {
        errors.push({
          field: fieldName,
          message: `Number must be at most ${def.max}`,
          value
        })
      }

      if (def.integer && !Number.isInteger(value)) {
        errors.push({
          field: fieldName,
          message: `Number must be an integer`,
          value
        })
      }
      break

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push({
          field: fieldName,
          message: `Expected boolean, got ${typeof value}`,
          value: value as JsonValue
        })
      }
      break

    case 'array':
      if (!Array.isArray(value)) {
        errors.push({
          field: fieldName,
          message: `Expected array, got ${typeof value}`,
          value: value as JsonValue
        })
        return errors
      }

      // Array-specific validations
      if (def.minItems !== undefined && value.length < def.minItems) {
        errors.push({
          field: fieldName,
          message: `Array must have at least ${def.minItems} items`,
          value: value as JsonValue[]
        })
      }

      if (def.maxItems !== undefined && value.length > def.maxItems) {
        errors.push({
          field: fieldName,
          message: `Array must have at most ${def.maxItems} items`,
          value: value as JsonValue[]
        })
      }

      // Validate items if schema is defined
      if (def.items) {
        for (let i = 0; i < value.length; i++) {
          const itemErrors = validateField(`${fieldName}[${i}]`, value[i], def.items)
          errors.push(...itemErrors)
        }
      }
      break

    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push({
          field: fieldName,
          message: `Expected object, got ${Array.isArray(value) ? 'array' : typeof value}`,
          value: value as JsonValue
        })
        return errors
      }

      // Validate nested properties if defined
      if (def.properties) {
        for (const [propName, propDef] of Object.entries(def.properties)) {
          const propErrors = validateField(
            `${fieldName}.${propName}`,
            (value as Record<string, unknown>)[propName],
            propDef
          )
          errors.push(...propErrors)
        }
      }
      break
  }

  return errors
}

// ============================================================================
// Schema Factory
// ============================================================================

/**
 * Define a schema for an entity type
 *
 * @example
 * ```typescript
 * const CustomerSchema = defineSchema({
 *   $type: 'Customer',
 *   fields: {
 *     name: { type: 'string', required: true },
 *     email: { type: 'string', format: 'email' },
 *     age: { type: 'number', min: 0 }
 *   }
 * })
 *
 * // Type inference
 * type Customer = InferSchema<typeof CustomerSchema>
 * // { name: string; email?: string; age?: number }
 * ```
 */
export function defineSchema<S extends SchemaDef>(def: S): Schema<InferSchema<S>> {
  const { $type, fields, strict = false } = def

  return {
    $type,
    fields,
    strict,

    validate(data: Record<string, unknown>): ValidationResult {
      const errors: ValidationError[] = []

      // Validate each defined field
      for (const [fieldName, fieldDef] of Object.entries(fields)) {
        const fieldErrors = validateField(fieldName, data[fieldName], fieldDef)
        errors.push(...fieldErrors)
      }

      // Check for unknown fields in strict mode
      if (strict) {
        for (const key of Object.keys(data)) {
          // Skip system fields
          if (key.startsWith('$')) continue

          if (!(key in fields)) {
            errors.push({
              field: key,
              message: `Unknown field (strict mode)`,
              value: data[key] as JsonValue
            })
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors
      }
    },

    parse(data: Record<string, unknown>): InferSchema<S> {
      const result = this.validate(data)
      if (!result.valid) {
        const messages = result.errors.map(e => `${e.field}: ${e.message}`).join('; ')
        throw new SchemaValidationError(`Validation failed: ${messages}`, result.errors)
      }
      return data as InferSchema<S>
    },

    safeParse(data: Record<string, unknown>): { success: true; data: InferSchema<S> } | { success: false; errors: ValidationError[] } {
      const result = this.validate(data)
      if (result.valid) {
        return { success: true, data: data as InferSchema<S> }
      }
      return { success: false, errors: result.errors }
    }
  }
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when schema validation fails
 */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ValidationError[]
  ) {
    super(message)
    this.name = 'SchemaValidationError'
  }
}

// ============================================================================
// Schema Registry
// ============================================================================

/**
 * Registry for managing multiple schemas
 */
export class SchemaRegistry {
  private schemas = new Map<string, Schema>()

  /**
   * Register a schema for a type
   */
  register<S extends SchemaDef>(schema: Schema<InferSchema<S>>): void {
    this.schemas.set(schema.$type, schema as Schema)
  }

  /**
   * Get a schema by type name
   */
  get(type: string): Schema | undefined {
    return this.schemas.get(type)
  }

  /**
   * Check if a schema exists for a type
   */
  has(type: string): boolean {
    return this.schemas.has(type)
  }

  /**
   * Remove a schema
   */
  unregister(type: string): boolean {
    return this.schemas.delete(type)
  }

  /**
   * Get all registered type names
   */
  types(): string[] {
    return Array.from(this.schemas.keys())
  }

  /**
   * Validate data against its registered schema
   * Returns undefined if no schema is registered for the type
   */
  validate(data: { $type: string } & Record<string, unknown>): ValidationResult | undefined {
    const schema = this.schemas.get(data.$type)
    if (!schema) return undefined
    return schema.validate(data)
  }

  /**
   * Clear all registered schemas
   */
  clear(): void {
    this.schemas.clear()
  }
}

/**
 * Create a new schema registry
 */
export function createSchemaRegistry(): SchemaRegistry {
  return new SchemaRegistry()
}

// ============================================================================
// Validated Store Wrapper
// ============================================================================

import type { ThingsStore, Thing, ThingInput, ThingUpdate } from '../entities/things'

/**
 * Options for creating a validated store
 */
export interface ValidatedStoreOptions {
  /**
   * If true, skip validation for types without registered schemas
   * If false, throw an error for unregistered types
   * @default true
   */
  allowUnregistered?: boolean
}

/**
 * Wrap a ThingsStore with schema validation
 * Validates data on create and update operations
 */
export function createValidatedStore(
  store: ThingsStore,
  registry: SchemaRegistry,
  options: ValidatedStoreOptions = {}
): ThingsStore {
  const { allowUnregistered = true } = options

  function validateOrThrow(type: string, data: Record<string, unknown>): void {
    const schema = registry.get(type)

    if (!schema) {
      if (!allowUnregistered) {
        throw new Error(`No schema registered for type: ${type}`)
      }
      return // Skip validation for unregistered types
    }

    const result = schema.validate(data)
    if (!result.valid) {
      const messages = result.errors.map(e => `${e.field}: ${e.message}`).join('; ')
      throw new SchemaValidationError(`Validation failed for ${type}: ${messages}`, result.errors)
    }
  }

  return {
    async create(data) {
      validateOrThrow(data.$type, data)
      return store.create(data)
    },

    async get(id) {
      return store.get(id)
    },

    async update(id, data) {
      // Get existing thing to know its type and merge data for validation
      const existing = await store.get(id)
      if (!existing) {
        throw new Error(`Thing not found: ${id}`)
      }

      // Merge existing data with updates for validation
      const merged = { ...existing, ...data }
      validateOrThrow(existing.$type, merged)

      return store.update(id, data)
    },

    async delete(id) {
      return store.delete(id)
    },

    async list(options) {
      return store.list(options)
    },

    async bulkCreate(items) {
      // Validate all items before creating any
      for (const data of items) {
        validateOrThrow(data.$type, data)
      }
      return store.bulkCreate(items)
    },

    async bulkUpdate(items) {
      // Get all existing things first
      const existingThings = await Promise.all(
        items.map(async ({ id }) => {
          const thing = await store.get(id)
          if (!thing) {
            throw new Error(`Thing not found: ${id}`)
          }
          return thing
        })
      )

      // Validate all updates
      for (let i = 0; i < items.length; i++) {
        const existing = existingThings[i]!
        const item = items[i]!
        const merged = { ...existing, ...item.data }
        validateOrThrow(existing.$type, merged)
      }

      return store.bulkUpdate(items)
    },

    async bulkDelete(ids) {
      return store.bulkDelete(ids)
    }
  }
}
