/**
 * DataContract - Schema validation, versioning, and evolution
 *
 * Provides:
 * - Schema Definition - JSON Schema based schema definitions with metadata
 * - Versioning - Semantic versioning with breaking change detection
 * - Evolution - Schema migrations and backwards compatibility checks
 * - Registry - Schema catalog with discovery and search
 * - Validation - Runtime validation with detailed errors
 * - TypeScript Generation - Generate TypeScript interfaces from schemas
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * JSON Schema type definitions (subset of JSON Schema Draft 7)
 */
export interface JSONSchema {
  type?: JSONSchemaType | JSONSchemaType[]
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  additionalProperties?: boolean | JSONSchema
  enum?: (string | number | boolean | null)[]
  format?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: boolean | number
  exclusiveMaximum?: boolean | number
  minLength?: number
  maxLength?: number
  pattern?: string
  minItems?: number
  maxItems?: number
  description?: string
  default?: unknown
  $ref?: string
  definitions?: Record<string, JSONSchema>
}

export type JSONSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'

/**
 * Schema metadata for organization and discovery
 */
export interface SchemaMetadata {
  description?: string
  owner?: string
  namespace?: string
  tags?: string[]
  deprecated?: boolean
  deprecationMessage?: string
}

/**
 * Data contract schema definition
 */
export interface DataContract {
  name: string
  version: string
  schema: JSONSchema
  metadata?: SchemaMetadata
  createdAt?: Date
  updatedAt?: Date
}

/**
 * Input for creating a schema
 */
export interface CreateSchemaInput {
  name: string
  version: string
  schema: JSONSchema
  metadata?: SchemaMetadata
}

/**
 * Validation error details
 */
export interface ValidationError {
  path: string
  message: string
  keyword?: string
  params?: Record<string, unknown>
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  data?: unknown
}

/**
 * Schema diff result
 */
export interface SchemaDiff {
  addedFields: string[]
  removedFields: string[]
  changedTypes: Array<{ field: string; from: string; to: string }>
  changedRequired: Array<{ field: string; wasRequired: boolean; isRequired: boolean }>
}

/**
 * Compatibility check result
 */
export interface CompatibilityCheck {
  compatible: boolean
  breakingChanges: string[]
  warnings: string[]
  suggestedVersionBump: 'major' | 'minor' | 'patch'
}

/**
 * Schema version history entry
 */
export interface SchemaVersionEntry {
  version: string
  schema: JSONSchema
  metadata?: SchemaMetadata
  createdAt: Date
}

/**
 * Migration change operation
 */
export interface MigrationChange {
  type: 'add' | 'remove' | 'rename' | 'transform'
  field?: string
  from?: string
  to?: string
  defaultValue?: unknown
  transform?: (value: unknown) => unknown
}

/**
 * Migration definition
 */
export interface Migration {
  fromVersion: string
  toVersion: string
  changes: MigrationChange[]
}

/**
 * Registry list options
 */
export interface ListOptions {
  namespace?: string
  search?: string
  tags?: string[]
  limit?: number
  offset?: number
}

// ============================================================================
// SCHEMA VERSION UTILITIES
// ============================================================================

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

/**
 * Semantic version utilities
 */
export const SchemaVersion = {
  /**
   * Parse a semver string into components
   */
  parse(version: string): ParsedVersion {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
    if (!match) {
      throw new Error(`Invalid version format: ${version}. Expected format: X.Y.Z`)
    }
    return {
      major: parseInt(match[1]!, 10),
      minor: parseInt(match[2]!, 10),
      patch: parseInt(match[3]!, 10),
    }
  },

  /**
   * Compare two versions
   * Returns: negative if a < b, positive if a > b, 0 if equal
   */
  compare(a: string, b: string): number {
    const parsedA = SchemaVersion.parse(a)
    const parsedB = SchemaVersion.parse(b)

    if (parsedA.major !== parsedB.major) {
      return parsedA.major - parsedB.major
    }
    if (parsedA.minor !== parsedB.minor) {
      return parsedA.minor - parsedB.minor
    }
    return parsedA.patch - parsedB.patch
  },

  /**
   * Check if version string is valid
   */
  isValid(version: string): boolean {
    return /^\d+\.\d+\.\d+$/.test(version)
  },

  /**
   * Get the next version given a bump type
   */
  bump(version: string, type: 'major' | 'minor' | 'patch'): string {
    const parsed = SchemaVersion.parse(version)
    switch (type) {
      case 'major':
        return `${parsed.major + 1}.0.0`
      case 'minor':
        return `${parsed.major}.${parsed.minor + 1}.0`
      case 'patch':
        return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
    }
  },
}

// ============================================================================
// SCHEMA FACTORY
// ============================================================================

/**
 * Create a data contract schema
 */
export function createSchema(input: CreateSchemaInput): DataContract {
  if (!SchemaVersion.isValid(input.version)) {
    throw new Error(`Invalid version format: ${input.version}. Expected format: X.Y.Z`)
  }

  return {
    name: input.name,
    version: input.version,
    schema: input.schema,
    metadata: input.metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * JSON Schema validator
 */
class Validator {
  /**
   * Validate data against a JSON Schema
   */
  validate(schema: JSONSchema, data: unknown, path = ''): ValidationError[] {
    const errors: ValidationError[] = []

    // Handle type validation
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type]
      const actualType = this.getType(data)

      if (!types.includes(actualType as JSONSchemaType)) {
        // Special case: integer is also valid as number
        if (!(actualType === 'number' && types.includes('integer') && Number.isInteger(data))) {
          // Check if null is allowed
          if (!(data === null && types.includes('null'))) {
            errors.push({
              path: path || 'root',
              message: `Expected ${types.join(' | ')}, got ${actualType}`,
              keyword: 'type',
              params: { expected: types, actual: actualType },
            })
            return errors
          }
        }
      }
    }

    // Handle null
    if (data === null) {
      return errors
    }

    // Object validation
    if (schema.type === 'object' || (typeof data === 'object' && !Array.isArray(data) && data !== null)) {
      errors.push(...this.validateObject(schema, data as Record<string, unknown>, path))
    }

    // Array validation
    if (schema.type === 'array' || Array.isArray(data)) {
      errors.push(...this.validateArray(schema, data as unknown[], path))
    }

    // String validation
    if (typeof data === 'string') {
      errors.push(...this.validateString(schema, data, path))
    }

    // Number validation
    if (typeof data === 'number') {
      errors.push(...this.validateNumber(schema, data, path))
    }

    // Enum validation
    if (schema.enum !== undefined && !schema.enum.includes(data as string | number | boolean | null)) {
      errors.push({
        path: path || 'root',
        message: `Value must be one of: ${schema.enum.join(', ')}`,
        keyword: 'enum',
        params: { allowedValues: schema.enum },
      })
    }

    return errors
  }

  private getType(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'number' && Number.isInteger(value)) return 'integer'
    return typeof value
  }

  private validateObject(schema: JSONSchema, data: Record<string, unknown>, path: string): ValidationError[] {
    const errors: ValidationError[] = []

    // Required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (data[field] === undefined) {
          errors.push({
            path: path ? `${path}.${field}` : field,
            message: `Missing required field: ${field}`,
            keyword: 'required',
            params: { missingProperty: field },
          })
        }
      }
    }

    // Property validation
    if (schema.properties) {
      for (const [key, value] of Object.entries(data)) {
        const propSchema = schema.properties[key]
        if (propSchema) {
          const propPath = path ? `${path}.${key}` : key
          errors.push(...this.validate(propSchema, value, propPath))
        } else if (schema.additionalProperties === false) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Additional property not allowed: ${key}`,
            keyword: 'additionalProperties',
            params: { additionalProperty: key },
          })
        }
      }
    }

    return errors
  }

  private validateArray(schema: JSONSchema, data: unknown[], path: string): ValidationError[] {
    const errors: ValidationError[] = []

    // minItems
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({
        path: path || 'root',
        message: `Array must have at least ${schema.minItems} items`,
        keyword: 'minItems',
        params: { limit: schema.minItems },
      })
    }

    // maxItems
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({
        path: path || 'root',
        message: `Array must have at most ${schema.maxItems} items`,
        keyword: 'maxItems',
        params: { limit: schema.maxItems },
      })
    }

    // Items validation
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        const itemPath = path ? `${path}[${i}]` : `[${i}]`
        errors.push(...this.validate(schema.items, data[i], itemPath))
      }
    }

    return errors
  }

  private validateString(schema: JSONSchema, data: string, path: string): ValidationError[] {
    const errors: ValidationError[] = []

    // minLength
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({
        path: path || 'root',
        message: `String must be at least ${schema.minLength} characters`,
        keyword: 'minLength',
        params: { limit: schema.minLength },
      })
    }

    // maxLength
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({
        path: path || 'root',
        message: `String must be at most ${schema.maxLength} characters`,
        keyword: 'maxLength',
        params: { limit: schema.maxLength },
      })
    }

    // pattern
    if (schema.pattern !== undefined) {
      const regex = new RegExp(schema.pattern)
      if (!regex.test(data)) {
        errors.push({
          path: path || 'root',
          message: `String must match pattern: ${schema.pattern}`,
          keyword: 'pattern',
          params: { pattern: schema.pattern },
        })
      }
    }

    // format validation
    if (schema.format !== undefined) {
      const formatError = this.validateFormat(schema.format, data, path)
      if (formatError) {
        errors.push(formatError)
      }
    }

    return errors
  }

  private validateNumber(schema: JSONSchema, data: number, path: string): ValidationError[] {
    const errors: ValidationError[] = []

    // minimum
    if (schema.minimum !== undefined) {
      if (schema.exclusiveMinimum === true) {
        if (data <= schema.minimum) {
          errors.push({
            path: path || 'root',
            message: `Number must be greater than ${schema.minimum}`,
            keyword: 'exclusiveMinimum',
            params: { limit: schema.minimum },
          })
        }
      } else if (data < schema.minimum) {
        errors.push({
          path: path || 'root',
          message: `Number must be at least ${schema.minimum}`,
          keyword: 'minimum',
          params: { limit: schema.minimum },
        })
      }
    }

    // maximum
    if (schema.maximum !== undefined) {
      if (schema.exclusiveMaximum === true) {
        if (data >= schema.maximum) {
          errors.push({
            path: path || 'root',
            message: `Number must be less than ${schema.maximum}`,
            keyword: 'exclusiveMaximum',
            params: { limit: schema.maximum },
          })
        }
      } else if (data > schema.maximum) {
        errors.push({
          path: path || 'root',
          message: `Number must be at most ${schema.maximum}`,
          keyword: 'maximum',
          params: { limit: schema.maximum },
        })
      }
    }

    // Integer check
    if (schema.type === 'integer' && !Number.isInteger(data)) {
      errors.push({
        path: path || 'root',
        message: 'Number must be an integer',
        keyword: 'type',
        params: { expected: 'integer' },
      })
    }

    return errors
  }

  private validateFormat(format: string, data: string, path: string): ValidationError | null {
    const formatValidators: Record<string, (value: string) => boolean> = {
      email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      uri: (v) => {
        try {
          new URL(v)
          return true
        } catch {
          return false
        }
      },
      'date-time': (v) => !isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v),
      date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
      time: (v) => /^\d{2}:\d{2}:\d{2}/.test(v),
      uuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v),
    }

    const validator = formatValidators[format]
    if (validator && !validator(data)) {
      return {
        path: path || 'root',
        message: `Invalid ${format} format`,
        keyword: 'format',
        params: { format },
      }
    }

    return null
  }
}

// ============================================================================
// SCHEMA REGISTRY
// ============================================================================

/**
 * Schema registry interface
 */
export interface SchemaRegistry {
  // Registration
  register(input: CreateSchemaInput): Promise<DataContract>

  // Retrieval
  get(name: string, version?: string): Promise<DataContract>
  exists(name: string, version?: string): Promise<boolean>

  // Listing
  list(options?: ListOptions): Promise<DataContract[]>
  getVersionHistory(name: string): Promise<SchemaVersionEntry[]>

  // Deletion
  delete(name: string, version: string): Promise<void>

  // Validation
  validate(name: string, data: unknown, version?: string): Promise<ValidationResult>

  // Compatibility
  checkCompatibility(name: string, newVersion: string, newSchema: JSONSchema): Promise<CompatibilityCheck>
  diff(oldSchema: JSONSchema, newSchema: JSONSchema): SchemaDiff

  // TypeScript generation
  generateTypes(name: string, version?: string): Promise<string>

  // Migration
  generateMigration(name: string, fromVersion: string, toSchema: JSONSchema): Promise<Migration>
  applyMigration(data: Record<string, unknown>, migration: Migration): Record<string, unknown>
}

/**
 * In-memory schema registry implementation
 */
class InMemorySchemaRegistry implements SchemaRegistry {
  private schemas: Map<string, Map<string, DataContract>> = new Map()
  private validator = new Validator()

  async register(input: CreateSchemaInput): Promise<DataContract> {
    const contract = createSchema(input)

    if (!this.schemas.has(input.name)) {
      this.schemas.set(input.name, new Map())
    }

    this.schemas.get(input.name)!.set(input.version, contract)
    return contract
  }

  async get(name: string, version?: string): Promise<DataContract> {
    const versions = this.schemas.get(name)
    if (!versions || versions.size === 0) {
      throw new Error(`Schema not found: ${name}`)
    }

    if (version) {
      const schema = versions.get(version)
      if (!schema) {
        throw new Error(`Schema version not found: ${name}@${version}`)
      }
      return schema
    }

    // Get latest version
    const sortedVersions = Array.from(versions.keys()).sort(SchemaVersion.compare)
    const latestVersion = sortedVersions[sortedVersions.length - 1]!
    return versions.get(latestVersion)!
  }

  async exists(name: string, version?: string): Promise<boolean> {
    const versions = this.schemas.get(name)
    if (!versions || versions.size === 0) {
      return false
    }
    if (version) {
      return versions.has(version)
    }
    return true
  }

  async list(options?: ListOptions): Promise<DataContract[]> {
    const results: DataContract[] = []

    const schemaEntries = Array.from(this.schemas.entries())
    for (const entry of schemaEntries) {
      const versions = entry[1]
      // Get latest version of each schema
      const sortedVersions = Array.from(versions.values()).sort((a: DataContract, b: DataContract) =>
        SchemaVersion.compare(a.version, b.version)
      )
      const latest = sortedVersions[sortedVersions.length - 1]
      if (latest) {
        results.push(latest)
      }
    }

    // Apply filters
    return results.filter((schema) => {
      if (options?.namespace && schema.metadata?.namespace !== options.namespace) {
        return false
      }
      if (options?.search && !schema.name.toLowerCase().includes(options.search.toLowerCase())) {
        return false
      }
      if (options?.tags && options.tags.length > 0) {
        const schemaTags = schema.metadata?.tags || []
        if (!options.tags.some((tag) => schemaTags.includes(tag))) {
          return false
        }
      }
      return true
    })
  }

  async getVersionHistory(name: string): Promise<SchemaVersionEntry[]> {
    const versions = this.schemas.get(name)
    if (!versions) {
      return []
    }

    return Array.from(versions.values())
      .map((contract) => ({
        version: contract.version,
        schema: contract.schema,
        metadata: contract.metadata,
        createdAt: contract.createdAt || new Date(),
      }))
      .sort((a, b) => SchemaVersion.compare(a.version, b.version))
  }

  async delete(name: string, version: string): Promise<void> {
    const versions = this.schemas.get(name)
    if (versions) {
      versions.delete(version)
    }
  }

  async validate(name: string, data: unknown, version?: string): Promise<ValidationResult> {
    const contract = await this.get(name, version)
    const errors = this.validator.validate(contract.schema, data)

    return {
      valid: errors.length === 0,
      errors,
      data: errors.length === 0 ? data : undefined,
    }
  }

  async checkCompatibility(name: string, newVersion: string, newSchema: JSONSchema): Promise<CompatibilityCheck> {
    const breakingChanges: string[] = []
    const warnings: string[] = []

    try {
      const current = await this.get(name)
      const schemaDiff = this.diff(current.schema, newSchema)

      // Check for breaking changes
      for (const field of schemaDiff.removedFields) {
        const wasRequired = current.schema.required?.includes(field)
        if (wasRequired) {
          breakingChanges.push(`Breaking: Required field '${field}' was removed`)
        } else {
          warnings.push(`Warning: Optional field '${field}' was removed`)
        }
      }

      for (const change of schemaDiff.changedRequired) {
        if (!change.wasRequired && change.isRequired) {
          breakingChanges.push(`Breaking: Field '${change.field}' became required`)
        } else if (change.wasRequired && !change.isRequired) {
          warnings.push(`Info: Field '${change.field}' became optional`)
        }
      }

      for (const change of schemaDiff.changedTypes) {
        breakingChanges.push(`Breaking: Field '${change.field}' type changed from ${change.from} to ${change.to}`)
      }

      for (const field of schemaDiff.addedFields) {
        const isRequired = newSchema.required?.includes(field)
        if (isRequired) {
          breakingChanges.push(`Breaking: New required field '${field}' was added`)
        }
      }

      // Determine suggested version bump
      let suggestedVersionBump: 'major' | 'minor' | 'patch' = 'patch'
      if (breakingChanges.length > 0) {
        suggestedVersionBump = 'major'
      } else if (schemaDiff.addedFields.length > 0 || warnings.length > 0) {
        suggestedVersionBump = 'minor'
      }

      return {
        compatible: breakingChanges.length === 0,
        breakingChanges,
        warnings,
        suggestedVersionBump,
      }
    } catch {
      // No existing schema, so any schema is compatible
      return {
        compatible: true,
        breakingChanges: [],
        warnings: [],
        suggestedVersionBump: 'minor',
      }
    }
  }

  diff(oldSchema: JSONSchema, newSchema: JSONSchema): SchemaDiff {
    const addedFields: string[] = []
    const removedFields: string[] = []
    const changedTypes: Array<{ field: string; from: string; to: string }> = []
    const changedRequired: Array<{ field: string; wasRequired: boolean; isRequired: boolean }> = []

    const oldProps = oldSchema.properties || {}
    const newProps = newSchema.properties || {}
    const oldRequired = new Set(oldSchema.required || [])
    const newRequired = new Set(newSchema.required || [])

    // Find added and changed fields
    for (const field of Object.keys(newProps)) {
      if (!(field in oldProps)) {
        addedFields.push(field)
      } else {
        // Check type changes
        const oldType = this.getSchemaType(oldProps[field]!)
        const newType = this.getSchemaType(newProps[field]!)
        if (oldType !== newType) {
          changedTypes.push({ field, from: oldType, to: newType })
        }
      }
    }

    // Find removed fields
    for (const field of Object.keys(oldProps)) {
      if (!(field in newProps)) {
        removedFields.push(field)
      }
    }

    // Find required changes (for fields that exist in both)
    const allFieldsSet = new Set([...Object.keys(oldProps), ...Object.keys(newProps)])
    const allFields = Array.from(allFieldsSet)
    for (const field of allFields) {
      const wasRequired = oldRequired.has(field)
      const isRequired = newRequired.has(field)
      if (wasRequired !== isRequired && field in oldProps && field in newProps) {
        changedRequired.push({ field, wasRequired, isRequired })
      }
    }

    return { addedFields, removedFields, changedTypes, changedRequired }
  }

  private getSchemaType(schema: JSONSchema): string {
    if (Array.isArray(schema.type)) {
      return schema.type.join(' | ')
    }
    return schema.type || 'any'
  }

  async generateTypes(name: string, version?: string): Promise<string> {
    const contract = await this.get(name, version)
    const interfaceName = this.toPascalCase(name)

    return this.generateTypeForSchema(contract.schema, interfaceName, contract.schema.required || [])
  }

  private generateTypeForSchema(schema: JSONSchema, name: string, required: string[], indent = ''): string {
    const lines: string[] = []
    lines.push(`${indent}interface ${name} {`)

    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const isRequired = required.includes(propName)
        const optional = isRequired ? '' : '?'
        const propType = this.schemaToTypeScript(propSchema)
        lines.push(`${indent}  ${propName}${optional}: ${propType};`)
      }
    }

    lines.push(`${indent}}`)
    return lines.join('\n')
  }

  private schemaToTypeScript(schema: JSONSchema): string {
    // Handle arrays of types (nullable)
    if (Array.isArray(schema.type)) {
      const types = schema.type.map((t) => this.primitiveTypeToTS(t))
      return types.join(' | ')
    }

    // Handle enums
    if (schema.enum) {
      return schema.enum.map((v) => (typeof v === 'string' ? `'${v}'` : String(v))).join(' | ')
    }

    // Handle arrays
    if (schema.type === 'array' && schema.items) {
      const itemType = this.schemaToTypeScript(schema.items)
      return `${itemType}[]`
    }

    // Handle objects
    if (schema.type === 'object' && schema.properties) {
      const props: string[] = []
      const required = schema.required || []
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const isRequired = required.includes(propName)
        const optional = isRequired ? '' : '?'
        const propType = this.schemaToTypeScript(propSchema)
        props.push(`${propName}${optional}: ${propType}`)
      }
      return `{ ${props.join('; ')} }`
    }

    // Handle primitives
    return this.primitiveTypeToTS(schema.type)
  }

  private primitiveTypeToTS(type?: JSONSchemaType | string): string {
    switch (type) {
      case 'string':
        return 'string'
      case 'number':
      case 'integer':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'null':
        return 'null'
      case 'object':
        return 'Record<string, unknown>'
      case 'array':
        return 'unknown[]'
      default:
        return 'unknown'
    }
  }

  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('')
  }

  async generateMigration(name: string, fromVersion: string, toSchema: JSONSchema): Promise<Migration> {
    const fromContract = await this.get(name, fromVersion)
    const diff = this.diff(fromContract.schema, toSchema)
    const changes: MigrationChange[] = []

    // Add removals
    for (const field of diff.removedFields) {
      changes.push({ type: 'remove', field })
    }

    // Add additions
    for (const field of diff.addedFields) {
      const propSchema = toSchema.properties?.[field]
      changes.push({
        type: 'add',
        field,
        defaultValue: propSchema?.default ?? this.getDefaultValue(propSchema),
      })
    }

    return {
      fromVersion,
      toVersion: SchemaVersion.bump(fromVersion, 'major'),
      changes,
    }
  }

  private getDefaultValue(schema?: JSONSchema): unknown {
    if (!schema) return undefined
    switch (schema.type) {
      case 'string':
        return ''
      case 'number':
      case 'integer':
        return 0
      case 'boolean':
        return false
      case 'array':
        return []
      case 'object':
        return {}
      default:
        return null
    }
  }

  applyMigration(data: Record<string, unknown>, migration: Migration): Record<string, unknown> {
    const result = { ...data }

    for (const change of migration.changes) {
      switch (change.type) {
        case 'remove':
          if (change.field) {
            delete result[change.field]
          }
          break
        case 'add':
          if (change.field && !(change.field in result)) {
            result[change.field] = change.defaultValue
          }
          break
        case 'rename':
          if (change.from && change.to && change.from in result) {
            result[change.to] = result[change.from]
            delete result[change.from]
          }
          break
        case 'transform':
          if (change.field && change.transform && change.field in result) {
            result[change.field] = change.transform(result[change.field])
          }
          break
      }
    }

    return result
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new schema registry
 */
export function createRegistry(): SchemaRegistry {
  return new InMemorySchemaRegistry()
}

// Re-export types used by tests
export type { DataContract as Schema }

// Re-export versioning module
export * from './versioning'

// Re-export registry for DO-backed contract storage
export * from './registry'

// Re-export evolution module
export {
  SchemaEvolution,
  createSchemaEvolution,
  isBackwardCompatible,
  isForwardCompatible,
  isFullyCompatible,
  detectBreakingChanges,
  suggestMigration,
  detectPotentialRenames,
  createMigrationScript,
  migrateData,
  formatSchemaDiff,
  DEFAULT_POLICIES,
} from './evolution'

export type {
  CompatibilityMode,
  EvolutionPolicy,
  PolicyViolation,
  SuggestedFix,
  EvolutionResult,
  MigrationOperation,
  MigrationScript,
  FieldRename,
  MigrationOptions,
} from './evolution'

// Re-export runtime validator
export {
  ContractValidator,
  ValidationException,
  createValidator,
  validateData,
  validateBatch,
} from './validator'

export type {
  StrictnessLevel,
  ErrorStrategy,
  ValidationOptions,
  DeadLetterQueue,
  ValidationTiming,
  RuntimeValidationResult,
  BatchValidationResult,
  CustomValidator,
  CustomValidationRule,
  StreamValidationResult,
  StreamValidationSummary,
  StreamValidationOptions,
} from './validator'

// Re-export schema DSL for fluent schema definition
export {
  s,
  contract,
  fromZod,
  fromJSONSchema,
  zodToJSONSchema,
  jsonSchemaToZod,
  StringFieldBuilder,
  NumberFieldBuilder,
  BooleanFieldBuilder,
  ArrayFieldBuilder,
  ObjectFieldBuilder,
} from './schema-dsl'

export type {
  ContractMetadata,
  ContractDefinition,
  ZodDataContract,
  FieldBuilder,
} from './schema-dsl'
