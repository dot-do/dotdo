/**
 * Schema Validator - JSON Schema validation for unified storage
 *
 * Provides comprehensive schema validation with:
 * - JSON Schema registration per entity type
 * - Schema versioning with semantic version support
 * - Migration registration and execution
 * - Strict vs permissive validation modes
 * - Default value application from schema
 * - Type coercion support
 * - Schema introspection API
 *
 * Uses Ajv for JSON Schema validation (draft 2020-12 compatible).
 *
 * @module objects/unified-storage/schema-validator
 */

import Ajv, { type ValidateFunction, type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * JSON Schema type with common properties
 */
export interface JSONSchema {
  $id?: string
  $schema?: string
  $defs?: Record<string, JSONSchema>
  type?: string | string[]
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
  format?: string
  enum?: unknown[]
  default?: unknown
  additionalProperties?: boolean | JSONSchema
  $ref?: string
  anyOf?: JSONSchema[]
  oneOf?: JSONSchema[]
  allOf?: JSONSchema[]
  not?: JSONSchema
}

/**
 * Schema version tracking
 */
export interface SchemaVersion {
  version: string
  schema: JSONSchema
  registeredAt: number
}

/**
 * Migration path between versions
 */
export interface MigrationPath {
  from: string
  to: string
  migrate: MigrationFn
}

/**
 * Migration function signature
 */
export type MigrationFn = (data: Record<string, unknown>) => Record<string, unknown>

/**
 * Validation mode
 */
export type ValidationMode = 'strict' | 'permissive'

/**
 * Validation options
 */
export interface ValidationOptions {
  mode?: ValidationMode
  stripUnknown?: boolean
  coerce?: boolean
  coerceDates?: boolean
  applyDefaults?: boolean
  version?: string
}

/**
 * Validation error
 */
export interface ValidationError {
  path: string
  message: string
  keyword?: string
  schemaPath?: string
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors?: ValidationError[]
  data?: Record<string, unknown>
}

/**
 * Schema introspection result
 */
export interface SchemaIntrospection {
  fields: string[]
  requiredFields: string[]
  fieldTypes: Record<string, string>
  constraints: Record<string, FieldConstraints>
  defaults: Record<string, unknown>
  nestedSchemas?: Record<string, SchemaIntrospection>
  arrayItemSchemas?: Record<string, SchemaIntrospection>
  jsonSchema: JSONSchema
}

/**
 * Field constraints extracted from schema
 */
export interface FieldConstraints {
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
  format?: string
  enum?: unknown[]
}

/**
 * Schema version diff result
 */
export interface SchemaDiff {
  addedFields: string[]
  removedFields: string[]
  changedFields: Array<{ field: string; from: string; to: string }>
  breaking: boolean
  breakingChanges: Array<{ type: string; field: string; details?: string }>
}

/**
 * Schema validator configuration
 */
export interface SchemaValidatorConfig {
  defaultMode?: ValidationMode
}

// ============================================================================
// MOCK STORE TYPE (for compatibility)
// ============================================================================

interface MockStore {
  things?: Map<string, unknown>
  schemas?: Map<string, JSONSchema>
  schemaVersions?: Map<string, SchemaVersion[]>
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Clean a schema for Ajv compilation by removing incompatible meta properties
 */
function cleanSchemaForAjv(schema: JSONSchema): JSONSchema {
  const cleaned = { ...schema }
  // Remove $schema as it can cause issues with Ajv strict mode
  delete cleaned.$schema
  return cleaned
}

/**
 * Deep clone with cleaning for Ajv
 */
function deepCloneSchema(schema: JSONSchema): JSONSchema {
  const copy: JSONSchema = { ...schema }

  // Remove $schema from root
  delete copy.$schema

  if (copy.properties) {
    copy.properties = {}
    for (const [key, value] of Object.entries(schema.properties!)) {
      copy.properties[key] = deepCloneSchema(value)
    }
  }

  if (copy.items && typeof copy.items === 'object') {
    copy.items = deepCloneSchema(copy.items)
  }

  if (copy.$defs) {
    copy.$defs = {}
    for (const [key, value] of Object.entries(schema.$defs!)) {
      copy.$defs[key] = deepCloneSchema(value)
    }
  }

  return copy
}

// ============================================================================
// SCHEMA VALIDATOR CLASS
// ============================================================================

/**
 * Schema validator for unified storage entities
 */
export class SchemaValidator {
  private schemas: Map<string, SchemaVersion[]> = new Map()
  private migrations: Map<string, MigrationPath[]> = new Map()
  private ajvStrict: Ajv
  private ajvPermissive: Ajv
  private ajvCoerce: Ajv
  private compiledSchemas: Map<string, Map<string, ValidateFunction>> = new Map()
  private defaultMode: ValidationMode

  constructor(
    private store?: MockStore,
    config: SchemaValidatorConfig = {}
  ) {
    this.defaultMode = config.defaultMode ?? 'permissive'

    // Strict mode: no additional properties, no coercion
    this.ajvStrict = new Ajv({
      strict: false, // Disable Ajv strict mode to allow our schemas
      allErrors: true,
      useDefaults: false,
      coerceTypes: false,
      removeAdditional: false,
    })
    addFormats(this.ajvStrict)

    // Permissive mode: allow additional properties
    this.ajvPermissive = new Ajv({
      strict: false,
      allErrors: true,
      useDefaults: true,
      coerceTypes: false,
      removeAdditional: false,
    })
    addFormats(this.ajvPermissive)

    // Coerce mode: type coercion enabled
    this.ajvCoerce = new Ajv({
      strict: false,
      allErrors: true,
      useDefaults: true,
      coerceTypes: true,
      removeAdditional: false,
    })
    addFormats(this.ajvCoerce)
  }

  /**
   * Register a JSON Schema for an entity type
   */
  register(entityType: string, schema: JSONSchema, options?: { version?: string }): void {
    const version = options?.version ?? '1.0.0'

    // Validate the schema itself
    this.validateSchemaDefinition(schema)

    // Check for duplicate registration without version
    const existing = this.schemas.get(entityType)
    if (existing && !options?.version) {
      const hasDefault = existing.some(v => v.version === '1.0.0')
      if (hasDefault) {
        throw new Error(`Schema for '${entityType}' already registered. Use version option to register new version.`)
      }
    }

    // Store the schema version
    const versions = this.schemas.get(entityType) ?? []
    versions.push({
      version,
      schema,
      registeredAt: Date.now(),
    })
    this.schemas.set(entityType, versions)

    // Clear compiled schema cache for this entity
    this.compiledSchemas.delete(entityType)
  }

  /**
   * Validate schema definition
   */
  private validateSchemaDefinition(schema: JSONSchema): void {
    // Check for invalid type
    if (schema.type && typeof schema.type === 'string') {
      const validTypes = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']
      if (!validTypes.includes(schema.type)) {
        throw new Error(`Invalid schema type: ${schema.type}`)
      }
    }
  }

  /**
   * Check if a schema exists for an entity type
   */
  hasSchema(entityType: string): boolean {
    return this.schemas.has(entityType)
  }

  /**
   * Get the schema for an entity type (optionally by version)
   */
  getSchema(entityType: string, version?: string): JSONSchema | undefined {
    const versions = this.schemas.get(entityType)
    if (!versions?.length) return undefined

    if (version) {
      const found = versions.find(v => v.version === version)
      return found?.schema
    }

    // Return latest version
    return versions[versions.length - 1].schema
  }

  /**
   * Get the current version for an entity type
   */
  getVersion(entityType: string): string | undefined {
    const versions = this.schemas.get(entityType)
    if (!versions?.length) return undefined
    return versions[versions.length - 1].version
  }

  /**
   * Get all version history for an entity type
   */
  getVersionHistory(entityType: string): string[] {
    const versions = this.schemas.get(entityType) ?? []
    return versions.map(v => v.version)
  }

  /**
   * List all registered entity types
   */
  listTypes(): string[] {
    return Array.from(this.schemas.keys())
  }

  /**
   * Unregister a schema
   */
  unregister(entityType: string): void {
    this.schemas.delete(entityType)
    this.compiledSchemas.delete(entityType)
    this.migrations.delete(entityType)
  }

  /**
   * Get or compile a validation function for a schema
   */
  private getValidator(entityType: string, version: string, mode: ValidationMode, coerce: boolean, applyDefaults: boolean = true): ValidateFunction | null {
    const cacheKey = `${version}:${mode}:${coerce}:${applyDefaults}`
    let versionCache = this.compiledSchemas.get(entityType)
    if (!versionCache) {
      versionCache = new Map()
      this.compiledSchemas.set(entityType, versionCache)
    }

    let validator = versionCache.get(cacheKey)
    if (validator) return validator

    const schema = this.getSchema(entityType, version)
    if (!schema) return null

    // Deep clone and clean schema for Ajv
    const schemaCopy = deepCloneSchema(schema)

    // Also remove $id to avoid conflicts when compiling the same schema multiple times
    delete schemaCopy.$id

    if (mode === 'strict') {
      schemaCopy.additionalProperties = false
      // Also set additionalProperties=false for nested objects
      this.setAdditionalPropertiesFalse(schemaCopy)
    }

    // Create a fresh Ajv instance for this specific combination to avoid $id conflicts
    let ajv: Ajv
    if (coerce) {
      ajv = new Ajv({
        strict: false,
        allErrors: true,
        useDefaults: applyDefaults,
        coerceTypes: true,
        removeAdditional: false,
      })
    } else if (mode === 'strict') {
      ajv = new Ajv({
        strict: false,
        allErrors: true,
        useDefaults: applyDefaults,
        coerceTypes: false,
        removeAdditional: false,
      })
    } else {
      ajv = new Ajv({
        strict: false,
        allErrors: true,
        useDefaults: applyDefaults,
        coerceTypes: false,
        removeAdditional: false,
      })
    }
    addFormats(ajv)

    try {
      validator = ajv.compile(schemaCopy)
      versionCache.set(cacheKey, validator)
      return validator
    } catch (e) {
      console.error('Failed to compile schema:', e)
      return null
    }
  }

  /**
   * Recursively set additionalProperties=false for strict mode
   */
  private setAdditionalPropertiesFalse(schema: JSONSchema): void {
    if (schema.properties) {
      schema.additionalProperties = false
      for (const prop of Object.values(schema.properties)) {
        if (prop.type === 'object' || prop.properties) {
          this.setAdditionalPropertiesFalse(prop)
        }
      }
    }
    if (schema.items && typeof schema.items === 'object') {
      if (schema.items.type === 'object' || schema.items.properties) {
        this.setAdditionalPropertiesFalse(schema.items)
      }
    }
    if (schema.$defs) {
      for (const def of Object.values(schema.$defs)) {
        this.setAdditionalPropertiesFalse(def)
      }
    }
  }

  /**
   * Validate data against a schema
   */
  async validate(entityType: string, data: unknown, options: ValidationOptions = {}): Promise<ValidationResult> {
    // Handle null/undefined
    if (data === null || data === undefined) {
      return {
        valid: false,
        errors: [{ path: '', message: 'Data is null or undefined' }],
      }
    }

    // Check if schema exists
    if (!this.hasSchema(entityType)) {
      return {
        valid: false,
        errors: [{ path: '', message: `Schema for '${entityType}' not found or not registered` }],
      }
    }

    const mode = options.mode ?? this.defaultMode
    const version = options.version ?? this.getVersion(entityType)!
    const coerce = options.coerce ?? false
    const applyDefaults = options.applyDefaults ?? false
    const stripUnknown = options.stripUnknown ?? false

    // Get validator - pass applyDefaults to control Ajv's useDefaults behavior
    const validator = this.getValidator(entityType, version, mode, coerce, applyDefaults)
    if (!validator) {
      return {
        valid: false,
        errors: [{ path: '', message: `Failed to compile schema for '${entityType}'` }],
      }
    }

    // Clone data for validation (to avoid mutating original)
    let validationData: Record<string, unknown>
    try {
      validationData = JSON.parse(JSON.stringify(data))
    } catch {
      // Handle circular references - do a shallow copy
      validationData = { ...(data as Record<string, unknown>) }
    }

    // Apply our own defaults if requested (in addition to Ajv's useDefaults)
    if (applyDefaults) {
      this.applyDefaultValues(entityType, validationData, version)
    }

    // Handle manual type coercion for edge cases before validation
    if (coerce) {
      this.manualCoercion(entityType, validationData, version)
    }

    // Perform validation
    const valid = validator(validationData)

    if (!valid) {
      const errors = this.formatErrors(validator.errors ?? [])
      return { valid: false, errors }
    }

    // Handle type coercion for dates
    if (coerce && options.coerceDates) {
      this.coerceDates(entityType, validationData, version)
    }

    // Strip unknown properties if requested
    if (stripUnknown) {
      this.stripUnknownProperties(entityType, validationData, version)
    }

    return {
      valid: true,
      data: validationData,
    }
  }

  /**
   * Validate data or throw an error
   */
  async validateOrThrow(entityType: string, data: unknown, options: ValidationOptions = {}): Promise<Record<string, unknown>> {
    const result = await this.validate(entityType, data, options)
    if (!result.valid) {
      const message = result.errors?.map(e => `${e.path}: ${e.message}`).join('; ') ?? 'Validation failed'
      throw new Error(`Schema validation failed for '${entityType}': ${message}`)
    }
    return result.data!
  }

  /**
   * Format Ajv errors into ValidationError format
   */
  private formatErrors(errors: ErrorObject[]): ValidationError[] {
    return errors.map(err => {
      // Convert instancePath (e.g., "/name" or "/items/0/quantity") to readable path
      let path = err.instancePath.replace(/^\//,'').replace(/\//g, '.')
      if (path === '') path = err.params?.missingProperty ?? 'root'

      // Handle array indices - convert .0. to [0].
      path = path.replace(/\.(\d+)\./g, '[$1].').replace(/\.(\d+)$/, '[$1]')

      let message = err.message ?? 'Validation error'

      // Enhance messages for common error types
      if (err.keyword === 'required') {
        const field = err.params?.missingProperty ?? 'unknown'
        path = path === 'root' ? field : `${path}.${field}`
        message = `Required property '${field}' is missing`
      } else if (err.keyword === 'enum') {
        message = `Value must be one of enum values`
      } else if (err.keyword === 'additionalProperties') {
        const prop = err.params?.additionalProperty ?? 'unknown'
        message = `Additional property '${prop}' is not allowed (unknown property)`
      }

      return {
        path,
        message,
        keyword: err.keyword,
        schemaPath: err.schemaPath,
      }
    })
  }

  /**
   * Manual type coercion for edge cases that Ajv doesn't handle well
   */
  private manualCoercion(entityType: string, data: Record<string, unknown>, version: string): void {
    const schema = this.getSchema(entityType, version)
    if (!schema?.properties) return

    this.manualCoercionRecursive(schema, data)
  }

  /**
   * Recursively apply manual coercion
   */
  private manualCoercionRecursive(schema: JSONSchema, data: Record<string, unknown>): void {
    if (!schema.properties) return

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const value = data[key]

      // Coerce string '0', '1', 'true', 'false' to boolean
      if (propSchema.type === 'boolean' && typeof value === 'string') {
        const lower = value.toLowerCase()
        if (lower === 'true' || lower === '1') {
          data[key] = true
        } else if (lower === 'false' || lower === '0') {
          data[key] = false
        }
      }

      // Recurse into nested objects
      if (propSchema.type === 'object' && propSchema.properties && value && typeof value === 'object') {
        this.manualCoercionRecursive(propSchema, value as Record<string, unknown>)
      }
    }
  }

  /**
   * Apply default values from schema
   */
  private applyDefaultValues(entityType: string, data: Record<string, unknown>, version: string): void {
    const schema = this.getSchema(entityType, version)
    if (!schema?.properties) return

    this.applyDefaultsRecursive(schema, data)
  }

  /**
   * Recursively apply defaults
   */
  private applyDefaultsRecursive(schema: JSONSchema, data: Record<string, unknown>): void {
    if (!schema.properties) return

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      // Apply default if property is missing and has default
      if (data[key] === undefined && propSchema.default !== undefined) {
        data[key] = JSON.parse(JSON.stringify(propSchema.default))
      }

      // If the default was an object, apply nested defaults
      if (propSchema.type === 'object' && propSchema.properties) {
        if (data[key] === undefined && propSchema.default !== undefined) {
          // Already applied above
        } else if (data[key] === undefined) {
          // No default for the object itself, but check if it has nested defaults
          // Only create the object if there are nested defaults to apply
          const hasNestedDefaults = Object.values(propSchema.properties).some(p => p.default !== undefined)
          if (hasNestedDefaults) {
            data[key] = {}
          }
        }

        if (data[key] && typeof data[key] === 'object') {
          this.applyDefaultsRecursive(propSchema, data[key] as Record<string, unknown>)
        }
      }
    }
  }

  /**
   * Coerce date strings to Date objects
   */
  private coerceDates(entityType: string, data: Record<string, unknown>, version: string): void {
    const schema = this.getSchema(entityType, version)
    if (!schema?.properties) return

    this.coerceDatesRecursive(schema, data)
  }

  /**
   * Recursively coerce dates
   */
  private coerceDatesRecursive(schema: JSONSchema, data: Record<string, unknown>): void {
    if (!schema.properties) return

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (propSchema.format === 'date-time' && typeof data[key] === 'string') {
        data[key] = new Date(data[key] as string)
      }

      if (propSchema.type === 'object' && propSchema.properties && data[key] && typeof data[key] === 'object') {
        this.coerceDatesRecursive(propSchema, data[key] as Record<string, unknown>)
      }
    }
  }

  /**
   * Strip unknown properties from data
   */
  private stripUnknownProperties(entityType: string, data: Record<string, unknown>, version: string): void {
    const schema = this.getSchema(entityType, version)
    if (!schema?.properties) return

    this.stripUnknownRecursive(schema, data)
  }

  /**
   * Recursively strip unknown properties
   */
  private stripUnknownRecursive(schema: JSONSchema, data: Record<string, unknown>): void {
    if (!schema.properties) return

    const knownKeys = new Set(Object.keys(schema.properties))

    // Also keep system fields
    const systemFields = ['$id', '$type', '$version', '$createdAt', '$updatedAt']
    for (const field of systemFields) {
      knownKeys.add(field)
    }

    for (const key of Object.keys(data)) {
      if (!knownKeys.has(key)) {
        delete data[key]
      } else {
        const propSchema = schema.properties[key]
        if (propSchema?.type === 'object' && propSchema.properties && data[key] && typeof data[key] === 'object') {
          this.stripUnknownRecursive(propSchema, data[key] as Record<string, unknown>)
        }
      }
    }
  }

  // ============================================================================
  // MIGRATION METHODS
  // ============================================================================

  /**
   * Register a migration between schema versions
   */
  registerMigration(entityType: string, from: string, to: string, migrate: MigrationFn): void {
    const migrations = this.migrations.get(entityType) ?? []
    migrations.push({ from, to, migrate })
    this.migrations.set(entityType, migrations)
  }

  /**
   * Get all migrations for an entity type
   */
  getMigrations(entityType: string): MigrationPath[] {
    return this.migrations.get(entityType) ?? []
  }

  /**
   * Migrate data from one version to another
   */
  async migrate(
    entityType: string,
    data: Record<string, unknown>,
    fromVersion: string,
    toVersion: string
  ): Promise<Record<string, unknown>> {
    // Find migration path
    const path = this.findMigrationPath(entityType, fromVersion, toVersion)

    if (!path.length) {
      throw new Error(`No migration path found from version ${fromVersion} to ${toVersion} for '${entityType}'`)
    }

    // Execute migrations in sequence
    let current = { ...data }
    for (const migration of path) {
      current = migration.migrate(current)
    }

    return current
  }

  /**
   * Migrate and validate data
   */
  async migrateAndValidate(
    entityType: string,
    data: Record<string, unknown>,
    fromVersion: string,
    toVersion: string
  ): Promise<Record<string, unknown>> {
    const migrated = await this.migrate(entityType, data, fromVersion, toVersion)
    return this.validateOrThrow(entityType, migrated, { version: toVersion })
  }

  /**
   * Find migration path between versions
   */
  private findMigrationPath(entityType: string, from: string, to: string): MigrationPath[] {
    const migrations = this.migrations.get(entityType) ?? []

    // BFS to find shortest path
    const visited = new Set<string>()
    const queue: Array<{ version: string; path: MigrationPath[] }> = [{ version: from, path: [] }]

    while (queue.length > 0) {
      const { version, path } = queue.shift()!

      if (version === to) {
        return path
      }

      if (visited.has(version)) continue
      visited.add(version)

      for (const migration of migrations) {
        if (migration.from === version && !visited.has(migration.to)) {
          queue.push({
            version: migration.to,
            path: [...path, migration],
          })
        }
      }
    }

    return []
  }

  // ============================================================================
  // INTROSPECTION METHODS
  // ============================================================================

  /**
   * Introspect a schema
   */
  introspect(entityType: string): SchemaIntrospection {
    const schema = this.getSchema(entityType)
    if (!schema) {
      throw new Error(`Schema for '${entityType}' not found`)
    }

    return this.introspectSchema(schema)
  }

  /**
   * Introspect a schema recursively
   */
  private introspectSchema(schema: JSONSchema): SchemaIntrospection {
    const properties = schema.properties ?? {}
    const required = new Set(schema.required ?? [])

    const fields: string[] = []
    const requiredFields: string[] = []
    const fieldTypes: Record<string, string> = {}
    const constraints: Record<string, FieldConstraints> = {}
    const defaults: Record<string, unknown> = {}
    const nestedSchemas: Record<string, SchemaIntrospection> = {}
    const arrayItemSchemas: Record<string, SchemaIntrospection> = {}

    for (const [key, propSchema] of Object.entries(properties)) {
      fields.push(key)

      if (required.has(key)) {
        requiredFields.push(key)
      }

      // Get type
      fieldTypes[key] = typeof propSchema.type === 'string' ? propSchema.type : 'unknown'

      // Get constraints
      const fieldConstraints: FieldConstraints = {}
      if (propSchema.minLength !== undefined) fieldConstraints.minLength = propSchema.minLength
      if (propSchema.maxLength !== undefined) fieldConstraints.maxLength = propSchema.maxLength
      if (propSchema.minimum !== undefined) fieldConstraints.minimum = propSchema.minimum
      if (propSchema.maximum !== undefined) fieldConstraints.maximum = propSchema.maximum
      if (propSchema.pattern !== undefined) fieldConstraints.pattern = propSchema.pattern
      if (propSchema.format !== undefined) fieldConstraints.format = propSchema.format
      if (propSchema.enum !== undefined) fieldConstraints.enum = propSchema.enum

      if (Object.keys(fieldConstraints).length > 0) {
        constraints[key] = fieldConstraints
      }

      // Get defaults
      if (propSchema.default !== undefined) {
        defaults[key] = propSchema.default
      }

      // Handle nested objects
      if (propSchema.type === 'object' && propSchema.properties) {
        nestedSchemas[key] = this.introspectSchema(propSchema)
      }

      // Handle arrays with object items
      if (propSchema.type === 'array' && propSchema.items && typeof propSchema.items === 'object') {
        if (propSchema.items.type === 'object' && propSchema.items.properties) {
          arrayItemSchemas[key] = this.introspectSchema(propSchema.items)
        }
      }
    }

    return {
      fields,
      requiredFields,
      fieldTypes,
      constraints,
      defaults,
      nestedSchemas: Object.keys(nestedSchemas).length > 0 ? nestedSchemas : undefined,
      arrayItemSchemas: Object.keys(arrayItemSchemas).length > 0 ? arrayItemSchemas : undefined,
      jsonSchema: schema,
    }
  }

  /**
   * Compare two schema versions
   */
  compareVersions(entityType: string, fromVersion: string, toVersion: string): SchemaDiff {
    const fromSchema = this.getSchema(entityType, fromVersion)
    const toSchema = this.getSchema(entityType, toVersion)

    if (!fromSchema || !toSchema) {
      throw new Error(`Schema version not found for '${entityType}'`)
    }

    const fromProps = fromSchema.properties ?? {}
    const toProps = toSchema.properties ?? {}
    const fromRequired = new Set(fromSchema.required ?? [])
    const toRequired = new Set(toSchema.required ?? [])

    const fromKeys = new Set(Object.keys(fromProps))
    const toKeys = new Set(Object.keys(toProps))

    const addedFields: string[] = []
    const removedFields: string[] = []
    const changedFields: Array<{ field: string; from: string; to: string }> = []
    const breakingChanges: Array<{ type: string; field: string; details?: string }> = []

    // Find added fields
    for (const key of toKeys) {
      if (!fromKeys.has(key)) {
        addedFields.push(key)

        // Breaking: new required field
        if (toRequired.has(key)) {
          breakingChanges.push({
            type: 'required_field_added',
            field: key,
            details: `New required field '${key}' added`,
          })
        }
      }
    }

    // Find removed fields
    for (const key of fromKeys) {
      if (!toKeys.has(key)) {
        removedFields.push(key)

        // Breaking: required field removed
        if (fromRequired.has(key)) {
          breakingChanges.push({
            type: 'required_field_removed',
            field: key,
            details: `Required field '${key}' removed`,
          })
        }
      }
    }

    // Find changed field types
    for (const key of fromKeys) {
      if (toKeys.has(key)) {
        const fromType = typeof fromProps[key].type === 'string' ? fromProps[key].type : 'unknown'
        const toType = typeof toProps[key].type === 'string' ? toProps[key].type : 'unknown'

        if (fromType !== toType) {
          changedFields.push({ field: key, from: fromType!, to: toType! })

          // Breaking: type change
          breakingChanges.push({
            type: 'type_changed',
            field: key,
            details: `Type changed from '${fromType}' to '${toType}'`,
          })
        }

        // Check if field became required
        if (!fromRequired.has(key) && toRequired.has(key)) {
          breakingChanges.push({
            type: 'required_field_added',
            field: key,
            details: `Field '${key}' became required`,
          })
        }
      }
    }

    return {
      addedFields,
      removedFields,
      changedFields,
      breaking: breakingChanges.length > 0,
      breakingChanges,
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new schema validator
 */
export function createSchemaValidator(store?: MockStore, config?: SchemaValidatorConfig): SchemaValidator {
  return new SchemaValidator(store, config)
}
