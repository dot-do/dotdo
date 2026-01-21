// Schema validation layer for @dotdo/db
// Lightweight Zod-like patterns for entity type safety
// See do-qz6x

import type { JsonValue, StorableData } from './types'

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
// Index Definitions (do-rljr.6)
// ============================================================================

/**
 * Index definition for creating database indexes on entity fields
 */
export interface IndexDefinition {
  /** Name of the index (will be prefixed with idx_ and table name) */
  name: string
  /** Fields to include in the index (supports composite indexes) */
  fields: string[]
  /** Whether the index enforces uniqueness */
  unique?: boolean | undefined
}

/**
 * Common index patterns for quick setup
 */
export const CommonIndexes = {
  /** Index on $type field for filtering by entity type */
  TYPE: { name: 'type', fields: ['$type'], unique: false } as IndexDefinition,
  /** Index on $createdAt for temporal queries (descending) */
  CREATED_AT: { name: 'created_at', fields: ['$createdAt'], unique: false } as IndexDefinition,
  /** Index on $updatedAt for finding recently modified entities */
  UPDATED_AT: { name: 'updated_at', fields: ['$updatedAt'], unique: false } as IndexDefinition,
  /** Composite index on $type and $createdAt for type-filtered temporal queries */
  TYPE_CREATED: { name: 'type_created', fields: ['$type', '$createdAt'], unique: false } as IndexDefinition,
} as const

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
  /** Index definitions for this entity type (do-rljr.6) */
  indexes?: IndexDefinition[]
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
  /** Index definitions for this entity type (do-rljr.6) */
  readonly indexes: IndexDefinition[]

  /**
   * Validate data against the schema
   * Accepts Record<string, unknown> since input may contain non-JSON values before validation
   * After validation passes, data is guaranteed to be StorableData (JSON-safe)
   */
  validate(data: Record<string, unknown>): ValidationResult

  /**
   * Validate and throw if invalid
   * Accepts Record<string, unknown> since input may contain non-JSON values before validation
   * Returns T (extends StorableData) guaranteeing JSON-safe values
   */
  parse(data: Record<string, unknown>): T

  /**
   * Validate without throwing, return typed result
   * Accepts Record<string, unknown> since input may contain non-JSON values before validation
   * On success, returns T (extends StorableData) guaranteeing JSON-safe values
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
  const { $type, fields, strict = false, indexes = [] } = def

  return {
    $type,
    fields,
    strict,
    indexes,

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

import type { ThingsStore, Thing, ThingInput, ThingUpdate } from './things'

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

    async getMany(ids) {
      return store.getMany(ids)
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

    async listWithCursor(options) {
      return store.listWithCursor(options)
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

// ============================================================================
// Index SQL Generation (do-rljr.6)
// ============================================================================

/**
 * Maps schema field names to SQLite column names
 * System fields ($id, $type, etc.) map to column names
 * Custom fields are accessed via json_extract
 */
function mapFieldToSqlColumn(field: string): string {
  switch (field) {
    case '$id':
      return 'id'
    case '$type':
      return 'type'
    case '$createdAt':
      return 'created_at'
    case '$updatedAt':
      return 'updated_at'
    default:
      // Custom fields are stored in JSON 'data' column
      return `json_extract(data, '$.${field}')`
  }
}

/**
 * Generate a CREATE INDEX SQL statement for a given index definition
 *
 * @param tableName - The name of the table to create the index on
 * @param index - The index definition
 * @returns SQL CREATE INDEX statement
 *
 * @example
 * ```typescript
 * // Simple index
 * generateIndexSql('things', { name: 'email', fields: ['email'] })
 * // => 'CREATE INDEX IF NOT EXISTS idx_things_email ON things(json_extract(data, '$.email'))'
 *
 * // Composite unique index
 * generateIndexSql('things', { name: 'tenant_email', fields: ['tenantId', 'email'], unique: true })
 * // => 'CREATE UNIQUE INDEX IF NOT EXISTS idx_things_tenant_email ON things(json_extract(data, '$.tenantId'), json_extract(data, '$.email'))'
 *
 * // System field index
 * generateIndexSql('things', { name: 'type', fields: ['$type'] })
 * // => 'CREATE INDEX IF NOT EXISTS idx_things_type ON things(type)'
 * ```
 */
export function generateIndexSql(tableName: string, index: IndexDefinition): string {
  const indexType = index.unique ? 'UNIQUE INDEX' : 'INDEX'
  const indexName = `idx_${tableName}_${index.name}`

  // Map fields to SQL column expressions
  const columns = index.fields.map(mapFieldToSqlColumn).join(', ')

  return `CREATE ${indexType} IF NOT EXISTS ${indexName} ON ${tableName}(${columns})`
}

/**
 * Generate DROP INDEX SQL statement
 *
 * @param tableName - The name of the table the index is on
 * @param index - The index definition
 * @returns SQL DROP INDEX statement
 */
export function generateDropIndexSql(tableName: string, index: IndexDefinition): string {
  const indexName = `idx_${tableName}_${index.name}`
  return `DROP INDEX IF EXISTS ${indexName}`
}

/**
 * Generate CREATE INDEX statements for all indexes in a schema
 *
 * @param schema - The schema containing index definitions
 * @param tableName - The table name (defaults to 'things')
 * @returns Array of SQL CREATE INDEX statements
 *
 * @example
 * ```typescript
 * const CustomerSchema = defineSchema({
 *   $type: 'Customer',
 *   fields: {
 *     email: { type: 'string', format: 'email' },
 *     status: { type: 'string', enum: ['active', 'inactive'] }
 *   },
 *   indexes: [
 *     { name: 'email', fields: ['email'], unique: true },
 *     { name: 'status', fields: ['status'] }
 *   ]
 * })
 *
 * generateSchemaIndexesSql(CustomerSchema)
 * // => [
 * //   'CREATE UNIQUE INDEX IF NOT EXISTS idx_things_email ON things(json_extract(data, '$.email'))',
 * //   'CREATE INDEX IF NOT EXISTS idx_things_status ON things(json_extract(data, '$.status'))'
 * // ]
 * ```
 */
export function generateSchemaIndexesSql(schema: Schema, tableName: string = 'things'): string[] {
  return schema.indexes.map(index => generateIndexSql(tableName, index))
}

/**
 * Generate DROP INDEX statements for all indexes in a schema
 *
 * @param schema - The schema containing index definitions
 * @param tableName - The table name (defaults to 'things')
 * @returns Array of SQL DROP INDEX statements
 */
export function generateSchemaDropIndexesSql(schema: Schema, tableName: string = 'things'): string[] {
  return schema.indexes.map(index => generateDropIndexSql(tableName, index))
}

/**
 * Create a migration for schema indexes
 * This generates both up (CREATE INDEX) and down (DROP INDEX) SQL
 *
 * @param schema - The schema containing index definitions
 * @param version - The migration version number
 * @param tableName - The table name (defaults to 'things')
 * @returns Migration object for use with MigrationRunner
 *
 * @example
 * ```typescript
 * const CustomerSchema = defineSchema({
 *   $type: 'Customer',
 *   fields: { email: { type: 'string' } },
 *   indexes: [{ name: 'email', fields: ['email'], unique: true }]
 * })
 *
 * const migration = createIndexMigration(CustomerSchema, 10)
 * // Use with MigrationRunner:
 * // await migrationRunner.runMigrations([...coreMigrations, migration])
 * ```
 */
export function createIndexMigration(
  schema: Schema,
  version: number,
  tableName: string = 'things'
): { version: number; name: string; up: string; down: string } {
  const upStatements = generateSchemaIndexesSql(schema, tableName)
  const downStatements = generateSchemaDropIndexesSql(schema, tableName)

  return {
    version,
    name: `create_${schema.$type.toLowerCase()}_indexes`,
    up: upStatements.join(';\n'),
    down: downStatements.join(';\n')
  }
}

/**
 * Helper to create an index definition
 *
 * @example
 * ```typescript
 * const emailIndex = createIndex('email', ['email'], { unique: true })
 * const compositeIndex = createIndex('tenant_user', ['tenantId', 'userId'])
 * ```
 */
export function createIndex(
  name: string,
  fields: string[],
  options: { unique?: boolean } = {}
): IndexDefinition {
  return {
    name,
    fields,
    unique: options.unique
  }
}
