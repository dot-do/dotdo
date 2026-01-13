/**
 * Schema Evolution for CDC
 *
 * Handles schema changes (DDL) during CDC streaming without interrupting the change stream.
 *
 * Features:
 * - Detect schema changes from DDL events in WAL
 * - Track schema versions with timestamps
 * - Transform events to match current or historical schema
 * - Support column additions, removals, and type changes
 * - Emit schema change events for downstream consumers
 *
 * @module db/primitives/cdc/schema-evolution
 */

import { type ChangeEvent, ChangeOperation } from './change-event'

// ============================================================================
// TYPES
// ============================================================================

/** Field type definitions */
export type FieldType =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'timestamp'
  | 'date'
  | 'binary'
  | 'array'
  | 'object'
  | 'null'

/** Schema field definition */
export interface SchemaField {
  name: string
  type: FieldType
  required: boolean
  default?: unknown
  items?: FieldType | string // For array types
  properties?: SchemaField[] // For object types
}

/** Schema version with metadata */
export interface SchemaVersion {
  version: number
  name: string
  timestamp: number
  fields: SchemaField[]
  namespace?: string
  doc?: string
  migrations?: SchemaMigration[]
}

/** Migration definition for schema changes */
export interface SchemaMigration {
  column: string
  from?: FieldType
  to?: FieldType
  computed?: boolean
  transformer?: (value: unknown, row: Record<string, unknown>) => unknown
  rename?: string
}

/** DDL event types */
export const DDLEventTypes = {
  ADD_COLUMN: 'ADD_COLUMN',
  DROP_COLUMN: 'DROP_COLUMN',
  MODIFY_COLUMN: 'MODIFY_COLUMN',
  RENAME_COLUMN: 'RENAME_COLUMN',
  RENAME_TABLE: 'RENAME_TABLE',
  ADD_INDEX: 'ADD_INDEX',
  DROP_INDEX: 'DROP_INDEX',
} as const

export type DDLEventType = (typeof DDLEventTypes)[keyof typeof DDLEventTypes]

/** DDL event from WAL */
export interface DDLEvent {
  type: DDLEventType
  table: string
  column?: string
  columnType?: FieldType
  nullable?: boolean
  default?: unknown
  previousType?: FieldType
  newName?: string
  newTableName?: string
  timestamp: number
  lsn?: string
}

/** Schema change event for downstream consumers */
export interface SchemaChangeNotification {
  type: DDLEventType
  table: string
  column?: string
  previousType?: FieldType
  newType?: FieldType
  newVersion: number
  timestamp: number
  lsn?: string
}

/** Compatibility modes */
export const CompatibilityModes = {
  BACKWARD: 'BACKWARD',
  FORWARD: 'FORWARD',
  FULL: 'FULL',
  NONE: 'NONE',
} as const

export type SchemaCompatibility = (typeof CompatibilityModes)[keyof typeof CompatibilityModes]

/** Result of DDL processing */
export interface EvolutionResult {
  success: boolean
  newVersion?: number
  schemaChange?: SchemaChangeNotification
  error?: string
}

/** Result of schema transformation */
export interface TransformResult<T = unknown> {
  success: boolean
  event: ChangeEvent<T>
  error?: string
  transformations?: string[]
}

/** Compatibility check result */
export interface CompatibilityResult {
  compatible: boolean
  errors?: string[]
  breakingChanges?: string[]
  warnings?: string[]
}

/** Schema Evolution options */
export interface SchemaEvolutionOptions {
  initialSchema: SchemaVersion
  registry?: SchemaRegistry
  onSchemaChange?: (change: SchemaChangeNotification) => void
  strictMode?: boolean
}

/** Schema Registry options */
export interface SchemaRegistryOptions {
  persistence?: 'memory' | 'durable'
}

/** Schema Transformer options */
export interface SchemaTransformerOptions {
  registry: SchemaRegistry
  strictMode?: boolean
}

// ============================================================================
// SCHEMA REGISTRY
// ============================================================================

/**
 * Schema Registry - tracks schema versions with timestamps
 */
export class SchemaRegistry {
  private schemas: Map<string, Map<number, SchemaVersion>> = new Map()
  private latestVersions: Map<string, number> = new Map()

  constructor(private options?: SchemaRegistryOptions) {}

  /**
   * Register a new schema version
   */
  async register(schema: SchemaVersion): Promise<void> {
    const key = this.getKey(schema.name, schema.namespace)

    if (!this.schemas.has(key)) {
      this.schemas.set(key, new Map())
    }

    this.schemas.get(key)!.set(schema.version, schema)

    const currentLatest = this.latestVersions.get(key) ?? 0
    if (schema.version > currentLatest) {
      this.latestVersions.set(key, schema.version)
    }
  }

  /**
   * Get a specific schema version
   */
  async getSchema(name: string, version: number, namespace?: string): Promise<SchemaVersion> {
    const key = this.getKey(name, namespace)
    const tableSchemas = this.schemas.get(key)

    if (!tableSchemas || !tableSchemas.has(version)) {
      throw new Error(`Schema version ${version} not found for ${key}`)
    }

    return tableSchemas.get(version)!
  }

  /**
   * Get the latest schema version
   */
  async getLatestSchema(name: string, namespace?: string): Promise<SchemaVersion> {
    const key = this.getKey(name, namespace)
    const latestVersion = this.latestVersions.get(key)

    if (latestVersion === undefined) {
      throw new Error(`No schema found for ${key}`)
    }

    return this.getSchema(name, latestVersion, namespace)
  }

  /**
   * Get schema history for a table
   */
  async getSchemaHistory(name: string, namespace?: string): Promise<SchemaVersion[]> {
    const key = this.getKey(name, namespace)
    const tableSchemas = this.schemas.get(key)

    if (!tableSchemas) {
      return []
    }

    return Array.from(tableSchemas.values()).sort((a, b) => a.version - b.version)
  }

  /**
   * Get schema valid at a specific timestamp
   */
  async getSchemaAtTimestamp(name: string, timestamp: number, namespace?: string): Promise<SchemaVersion> {
    const history = await this.getSchemaHistory(name, namespace)

    // Find the most recent schema that was created before or at the timestamp
    let validSchema: SchemaVersion | null = null

    for (const schema of history) {
      if (schema.timestamp <= timestamp) {
        validSchema = schema
      } else {
        break
      }
    }

    if (!validSchema) {
      throw new Error(`No schema found for ${name} at timestamp ${timestamp}`)
    }

    return validSchema
  }

  /**
   * Check compatibility of a new schema with existing versions
   */
  async checkCompatibility(
    name: string,
    newSchema: SchemaVersion,
    mode: SchemaCompatibility,
    namespace?: string
  ): Promise<CompatibilityResult> {
    const key = this.getKey(name, namespace)
    const latestVersion = this.latestVersions.get(key)

    if (latestVersion === undefined) {
      // No existing schema, always compatible
      return { compatible: true }
    }

    const currentSchema = await this.getSchema(name, latestVersion, namespace)
    return this.checkSchemaCompatibility(currentSchema, newSchema, mode)
  }

  /**
   * Check compatibility between two schemas
   */
  private checkSchemaCompatibility(
    oldSchema: SchemaVersion,
    newSchema: SchemaVersion,
    mode: SchemaCompatibility
  ): CompatibilityResult {
    const errors: string[] = []
    const breakingChanges: string[] = []
    const warnings: string[] = []

    const oldFields = new Map(oldSchema.fields.map((f) => [f.name, f]))
    const newFields = new Map(newSchema.fields.map((f) => [f.name, f]))

    // Check for removed fields
    for (const [name, field] of oldFields) {
      if (!newFields.has(name)) {
        if (field.required) {
          breakingChanges.push(`Removed required field: ${name}`)
          if (mode === 'BACKWARD' || mode === 'FULL') {
            errors.push(`Removing required field '${name}' breaks backward compatibility`)
          }
        } else {
          warnings.push(`Removed optional field: ${name}`)
        }
      }
    }

    // Check for added fields
    for (const [name, field] of newFields) {
      if (!oldFields.has(name)) {
        if (field.required && field.default === undefined) {
          breakingChanges.push(`Added required field without default: ${name}`)
          errors.push('Adding required field without default breaks backward compatibility')
        }
      }
    }

    // Check for type changes
    for (const [name, newField] of newFields) {
      const oldField = oldFields.get(name)
      if (oldField && oldField.type !== newField.type) {
        if (!this.isCompatibleTypeChange(oldField.type, newField.type)) {
          breakingChanges.push(`Incompatible type change for ${name}: ${oldField.type} -> ${newField.type}`)
          errors.push(`Type change from ${oldField.type} to ${newField.type} is not compatible`)
        }
      }
    }

    return {
      compatible: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      breakingChanges: breakingChanges.length > 0 ? breakingChanges : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  /**
   * Check if type change is compatible
   */
  private isCompatibleTypeChange(from: FieldType, to: FieldType): boolean {
    // String can be converted to most types (with parsing)
    if (from === 'string') {
      return ['integer', 'float', 'boolean', 'timestamp', 'date'].includes(to)
    }

    // Numbers can be widened
    if (from === 'integer' && to === 'float') return true
    if (from === 'integer' && to === 'string') return true
    if (from === 'float' && to === 'string') return true

    // Boolean to string
    if (from === 'boolean' && to === 'string') return true

    // Timestamp conversions
    if (from === 'timestamp' && to === 'string') return true
    if (from === 'date' && to === 'string') return true

    return false
  }

  private getKey(name: string, namespace?: string): string {
    return namespace ? `${namespace}:${name}` : name
  }
}

/**
 * Create a new schema registry
 */
export function createSchemaRegistry(options?: SchemaRegistryOptions): SchemaRegistry {
  return new SchemaRegistry(options)
}

// ============================================================================
// SCHEMA EVOLUTION
// ============================================================================

/**
 * SchemaEvolution - handles DDL events and schema transformations
 */
export class SchemaEvolution {
  private registry: SchemaRegistry
  private currentSchemas: Map<string, SchemaVersion> = new Map()
  private schemaChangeHandlers: ((change: SchemaChangeNotification) => void)[] = []
  private strictMode: boolean

  constructor(private options: SchemaEvolutionOptions) {
    this.registry = options.registry ?? createSchemaRegistry()
    this.strictMode = options.strictMode ?? false

    // Register initial schema
    const initial = options.initialSchema
    this.currentSchemas.set(initial.name, initial)
    this.registry.register(initial)

    if (options.onSchemaChange) {
      this.schemaChangeHandlers.push(options.onSchemaChange)
    }
  }

  /**
   * Process a DDL event from WAL
   */
  async processDDL(event: DDLEvent): Promise<EvolutionResult> {
    try {
      switch (event.type) {
        case DDLEventTypes.ADD_COLUMN:
          return this.handleAddColumn(event)
        case DDLEventTypes.DROP_COLUMN:
          return this.handleDropColumn(event)
        case DDLEventTypes.MODIFY_COLUMN:
          return this.handleModifyColumn(event)
        case DDLEventTypes.RENAME_COLUMN:
          return this.handleRenameColumn(event)
        default:
          return { success: true }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Handle ADD COLUMN DDL
   */
  private async handleAddColumn(event: DDLEvent): Promise<EvolutionResult> {
    const current = this.currentSchemas.get(event.table)
    if (!current) {
      return { success: false, error: `Table ${event.table} not found` }
    }

    const newField: SchemaField = {
      name: event.column!,
      type: event.columnType!,
      required: !event.nullable,
      default: event.default,
    }

    const newSchema: SchemaVersion = {
      ...current,
      version: current.version + 1,
      timestamp: event.timestamp,
      fields: [...current.fields, newField],
    }

    await this.registry.register(newSchema)
    this.currentSchemas.set(event.table, newSchema)

    const notification: SchemaChangeNotification = {
      type: event.type,
      table: event.table,
      column: event.column,
      newType: event.columnType,
      newVersion: newSchema.version,
      timestamp: event.timestamp,
      lsn: event.lsn,
    }

    this.emitSchemaChange(notification)

    return {
      success: true,
      newVersion: newSchema.version,
      schemaChange: notification,
    }
  }

  /**
   * Handle DROP COLUMN DDL
   */
  private async handleDropColumn(event: DDLEvent): Promise<EvolutionResult> {
    const current = this.currentSchemas.get(event.table)
    if (!current) {
      return { success: false, error: `Table ${event.table} not found` }
    }

    const newSchema: SchemaVersion = {
      ...current,
      version: current.version + 1,
      timestamp: event.timestamp,
      fields: current.fields.filter((f) => f.name !== event.column),
    }

    await this.registry.register(newSchema)
    this.currentSchemas.set(event.table, newSchema)

    const notification: SchemaChangeNotification = {
      type: event.type,
      table: event.table,
      column: event.column,
      newVersion: newSchema.version,
      timestamp: event.timestamp,
      lsn: event.lsn,
    }

    this.emitSchemaChange(notification)

    return {
      success: true,
      newVersion: newSchema.version,
      schemaChange: notification,
    }
  }

  /**
   * Handle MODIFY COLUMN DDL
   */
  private async handleModifyColumn(event: DDLEvent): Promise<EvolutionResult> {
    const current = this.currentSchemas.get(event.table)
    if (!current) {
      return { success: false, error: `Table ${event.table} not found` }
    }

    // Check if type change is compatible
    if (this.strictMode && event.previousType && event.columnType) {
      if (!this.isCompatibleTypeChange(event.previousType, event.columnType)) {
        return {
          success: false,
          error: `Type change from ${event.previousType} to ${event.columnType} is incompatible`,
        }
      }
    }

    const newSchema: SchemaVersion = {
      ...current,
      version: current.version + 1,
      timestamp: event.timestamp,
      fields: current.fields.map((f) =>
        f.name === event.column ? { ...f, type: event.columnType! } : f
      ),
      migrations: [
        {
          column: event.column!,
          from: event.previousType,
          to: event.columnType,
        },
      ],
    }

    await this.registry.register(newSchema)
    this.currentSchemas.set(event.table, newSchema)

    const notification: SchemaChangeNotification = {
      type: event.type,
      table: event.table,
      column: event.column,
      previousType: event.previousType,
      newType: event.columnType,
      newVersion: newSchema.version,
      timestamp: event.timestamp,
      lsn: event.lsn,
    }

    this.emitSchemaChange(notification)

    return {
      success: true,
      newVersion: newSchema.version,
      schemaChange: notification,
    }
  }

  /**
   * Handle RENAME COLUMN DDL
   */
  private async handleRenameColumn(event: DDLEvent): Promise<EvolutionResult> {
    const current = this.currentSchemas.get(event.table)
    if (!current) {
      return { success: false, error: `Table ${event.table} not found` }
    }

    const newSchema: SchemaVersion = {
      ...current,
      version: current.version + 1,
      timestamp: event.timestamp,
      fields: current.fields.map((f) =>
        f.name === event.column ? { ...f, name: event.newName! } : f
      ),
      migrations: [
        {
          column: event.column!,
          rename: event.newName,
        },
      ],
    }

    await this.registry.register(newSchema)
    this.currentSchemas.set(event.table, newSchema)

    const notification: SchemaChangeNotification = {
      type: event.type,
      table: event.table,
      column: event.column,
      newVersion: newSchema.version,
      timestamp: event.timestamp,
      lsn: event.lsn,
    }

    this.emitSchemaChange(notification)

    return {
      success: true,
      newVersion: newSchema.version,
      schemaChange: notification,
    }
  }

  /**
   * Check if type change is compatible
   */
  private isCompatibleTypeChange(from: FieldType, to: FieldType): boolean {
    // Object to scalar types are incompatible
    if (from === 'object' && !['object', 'array', 'string'].includes(to)) {
      return false
    }

    // Array to non-array (except string) is incompatible
    if (from === 'array' && !['array', 'string'].includes(to)) {
      return false
    }

    return true
  }

  /**
   * Get current schema for a table
   */
  getCurrentSchema(table: string): SchemaVersion {
    const schema = this.currentSchemas.get(table)
    if (!schema) {
      throw new Error(`Table ${table} not found`)
    }
    return schema
  }

  /**
   * Transform an event to match the current schema
   */
  async transformToCurrentSchema<T>(event: ChangeEvent<T>): Promise<ChangeEvent<T>> {
    const table = event.table
    const currentSchema = this.currentSchemas.get(table)

    if (!currentSchema) {
      return event
    }

    return this.transformEvent(event, currentSchema)
  }

  /**
   * Transform an event to match a specific schema version
   */
  async transformToSchemaVersion<T>(event: ChangeEvent<T>, version: number): Promise<ChangeEvent<T>> {
    const table = event.table
    const targetSchema = await this.registry.getSchema(table, version)

    return this.transformEvent(event, targetSchema)
  }

  /**
   * Transform event to match target schema
   */
  private transformEvent<T>(event: ChangeEvent<T>, targetSchema: SchemaVersion): ChangeEvent<T> {
    const transformRecord = (record: T | null): T | null => {
      if (record === null) return null

      const result: Record<string, unknown> = {}
      const recordObj = record as Record<string, unknown>

      for (const field of targetSchema.fields) {
        if (field.name in recordObj) {
          result[field.name] = recordObj[field.name]
        } else if (field.default !== undefined) {
          result[field.name] = field.default
        } else if (!field.required) {
          result[field.name] = null
        }
      }

      // Apply type coercions if there are migrations
      if (targetSchema.migrations) {
        for (const migration of targetSchema.migrations) {
          if (migration.from && migration.to && migration.column in result) {
            result[migration.column] = this.coerceValue(
              result[migration.column],
              migration.from,
              migration.to
            )
          }
        }
      }

      return result as T
    }

    return {
      ...event,
      before: transformRecord(event.before),
      after: transformRecord(event.after),
    }
  }

  /**
   * Coerce a value from one type to another
   */
  private coerceValue(value: unknown, from: FieldType, to: FieldType): unknown {
    if (value === null || value === undefined) return value

    // String to other types
    if (from === 'string' && typeof value === 'string') {
      switch (to) {
        case 'integer':
          return parseInt(value, 10)
        case 'float':
          return parseFloat(value)
        case 'boolean':
          return value.toLowerCase() === 'true' || value === '1'
        default:
          return value
      }
    }

    // Number to string
    if ((from === 'integer' || from === 'float') && to === 'string') {
      return String(value)
    }

    // Boolean to string
    if (from === 'boolean' && to === 'string') {
      return String(value)
    }

    // Timestamp to string
    if (from === 'timestamp' && to === 'string') {
      return new Date(value as number).toISOString()
    }

    return value
  }

  /**
   * Register a schema change handler
   */
  onSchemaChange(handler: (change: SchemaChangeNotification) => void): void {
    this.schemaChangeHandlers.push(handler)
  }

  /**
   * Emit schema change to all handlers
   */
  private emitSchemaChange(change: SchemaChangeNotification): void {
    for (const handler of this.schemaChangeHandlers) {
      handler(change)
    }
  }
}

/**
 * Create a new schema evolution instance
 */
export function createSchemaEvolution(options: SchemaEvolutionOptions): SchemaEvolution {
  return new SchemaEvolution(options)
}

// ============================================================================
// SCHEMA TRANSFORMER
// ============================================================================

/**
 * SchemaTransformer - transforms events between schema versions
 */
export class SchemaTransformer {
  private registry: SchemaRegistry
  private strictMode: boolean

  constructor(private options: SchemaTransformerOptions) {
    this.registry = options.registry
    this.strictMode = options.strictMode ?? false
  }

  /**
   * Register a schema version
   */
  async registerSchema(schema: SchemaVersion): Promise<void> {
    await this.registry.register(schema)
  }

  /**
   * Transform an event to a target schema version
   */
  async transform<T>(event: ChangeEvent<T>, targetVersion: number): Promise<TransformResult<T>> {
    const table = event.table
    const transformations: string[] = []

    try {
      const targetSchema = await this.registry.getSchema(table, targetVersion)
      const history = await this.registry.getSchemaHistory(table)

      // Determine source version - either explicit or detected from event fields
      let sourceVersion = event.schema?.version
      if (!sourceVersion) {
        // Detect version by finding the best matching schema based on fields
        sourceVersion = this.detectSchemaVersion(event, history)
      }
      const sourceSchema = await this.registry.getSchema(table, sourceVersion)

      if (sourceVersion === targetVersion) {
        // Still project to ensure only schema fields are included
        const projected = this.projectToSchema(event, targetSchema)
        return { success: true, event: projected, transformations: [] }
      }

      // Get schemas in between
      const schemasToApply = this.getSchemasInRange(history, sourceVersion, targetVersion)

      // Apply transformations
      let currentEvent = event

      if (targetVersion > sourceVersion) {
        // Forward transformation (upgrading)
        for (const schema of schemasToApply) {
          currentEvent = await this.applySchemaUpgrade(currentEvent, schema, transformations)
        }
      } else {
        // Backward transformation (downgrading)
        for (const schema of schemasToApply.reverse()) {
          currentEvent = await this.applySchemaDowngrade(currentEvent, schema, transformations)
        }
      }

      // Final transformation to target schema
      currentEvent = this.projectToSchema(currentEvent, targetSchema)

      return { success: true, event: currentEvent, transformations }
    } catch (error) {
      return {
        success: false,
        event,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Detect schema version from event fields
   */
  private detectSchemaVersion<T>(event: ChangeEvent<T>, history: SchemaVersion[]): number {
    const record = event.after ?? event.before
    if (!record) {
      return history[0]?.version ?? 1
    }

    const eventFields = new Set(Object.keys(record as Record<string, unknown>))

    // Find the schema version that best matches the event fields
    // We look for the schema where all event fields exist, preferring the latest version
    let bestMatch = history[0]?.version ?? 1
    let bestScore = -1

    for (const schema of history) {
      const schemaFields = new Set(schema.fields.map((f) => f.name))

      // Count how many event fields exist in schema
      let matchScore = 0
      let hasAllRequired = true

      for (const field of eventFields) {
        if (schemaFields.has(field)) {
          matchScore++
        }
      }

      // Check if schema has all required fields from event
      for (const field of schema.fields) {
        if (field.required && !eventFields.has(field.name)) {
          hasAllRequired = false
          break
        }
      }

      // Prefer schemas where all event fields match and all required fields are present
      if (hasAllRequired && matchScore > bestScore) {
        bestScore = matchScore
        bestMatch = schema.version
      }
    }

    return bestMatch
  }

  /**
   * Get schemas in range
   */
  private getSchemasInRange(
    history: SchemaVersion[],
    from: number,
    to: number
  ): SchemaVersion[] {
    if (to > from) {
      return history.filter((s) => s.version > from && s.version <= to)
    } else {
      return history.filter((s) => s.version >= to && s.version < from)
    }
  }

  /**
   * Apply schema upgrade (forward compatibility)
   */
  private async applySchemaUpgrade<T>(
    event: ChangeEvent<T>,
    schema: SchemaVersion,
    transformations: string[]
  ): Promise<ChangeEvent<T>> {
    // Get the previous schema to detect implicit renames
    const previousVersion = schema.version - 1
    let previousSchema: SchemaVersion | null = null
    try {
      previousSchema = await this.registry.getSchema(event.table, previousVersion)
    } catch {
      // Previous schema not found, continue without rename detection
    }

    const transformRecord = (record: T | null): T | null => {
      if (record === null) return null

      const result = { ...(record as Record<string, unknown>) }

      // Detect and apply implicit renames (field in old schema but not in new, field in new but not in old)
      if (previousSchema) {
        const prevFieldNames = new Set(previousSchema.fields.map((f) => f.name))
        const currFieldNames = new Set(schema.fields.map((f) => f.name))

        // Fields removed from previous schema
        const removedFields = [...prevFieldNames].filter((f) => !currFieldNames.has(f))
        // Fields added to current schema
        const addedFields = [...currFieldNames].filter((f) => !prevFieldNames.has(f))

        // If there's exactly one removed and one added of the same type, it's likely a rename
        if (removedFields.length === 1 && addedFields.length === 1) {
          const removedField = previousSchema.fields.find((f) => f.name === removedFields[0])
          const addedField = schema.fields.find((f) => f.name === addedFields[0])

          if (
            removedField &&
            addedField &&
            removedField.type === addedField.type &&
            removedFields[0] in result
          ) {
            result[addedFields[0]] = result[removedFields[0]]
            delete result[removedFields[0]]
            transformations.push(`Renamed ${removedFields[0]} to ${addedFields[0]}`)
          }
        }
      }

      // Add new fields with defaults
      for (const field of schema.fields) {
        if (!(field.name in result)) {
          if (field.default !== undefined) {
            result[field.name] = field.default
            transformations.push(`Added field ${field.name} with default ${field.default}`)
          } else if (!field.required) {
            result[field.name] = null
            transformations.push(`Added optional field ${field.name} as null`)
          }
        }
      }

      // Detect and apply implicit type changes
      if (previousSchema) {
        for (const currField of schema.fields) {
          const prevField = previousSchema.fields.find((f) => f.name === currField.name)
          if (prevField && prevField.type !== currField.type && currField.name in result) {
            // Type changed - need to coerce
            const oldValue = result[currField.name]
            result[currField.name] = this.coerceValue(oldValue, prevField.type, currField.type)
            transformations.push(
              `Auto-coerced ${currField.name} from ${prevField.type} to ${currField.type}`
            )
          }
        }
      }

      // Apply migrations
      if (schema.migrations) {
        for (const migration of schema.migrations) {
          if (migration.computed && migration.transformer) {
            result[migration.column] = migration.transformer(null, result)
            transformations.push(`Computed field ${migration.column}`)
          } else if (migration.from && migration.to) {
            if (migration.column in result) {
              const oldValue = result[migration.column]
              result[migration.column] = this.coerceValue(
                oldValue,
                migration.from,
                migration.to
              )
              transformations.push(
                `Coerced ${migration.column} from ${migration.from} to ${migration.to}`
              )
            }
          } else if (migration.rename) {
            if (migration.column in result) {
              result[migration.rename] = result[migration.column]
              delete result[migration.column]
              transformations.push(`Renamed ${migration.column} to ${migration.rename}`)
            }
          }
        }
      }

      return result as T
    }

    return {
      ...event,
      before: transformRecord(event.before),
      after: transformRecord(event.after),
    }
  }

  /**
   * Apply schema downgrade (backward compatibility)
   */
  private async applySchemaDowngrade<T>(
    event: ChangeEvent<T>,
    schema: SchemaVersion,
    transformations: string[]
  ): Promise<ChangeEvent<T>> {
    // Get the previous schema (the one we're downgrading to)
    const previousVersion = schema.version - 1
    let targetFields: Set<string>

    try {
      const previousSchema = await this.registry.getSchema(event.table, previousVersion)
      targetFields = new Set(previousSchema.fields.map((f) => f.name))
    } catch {
      // If we can't get previous schema, use current schema's fields
      targetFields = new Set(schema.fields.map((f) => f.name))
    }

    const transformRecord = (record: T | null): T | null => {
      if (record === null) return null

      const result: Record<string, unknown> = {}
      const recordObj = record as Record<string, unknown>

      // Handle reverse migrations (renames need to be reversed)
      let workingRecord = { ...recordObj }
      if (schema.migrations) {
        for (const migration of schema.migrations) {
          if (migration.rename && migration.rename in workingRecord) {
            // Reverse the rename
            workingRecord[migration.column] = workingRecord[migration.rename]
            delete workingRecord[migration.rename]
            transformations.push(`Reversed rename ${migration.rename} to ${migration.column}`)
          }
        }
      }

      // Only keep fields that exist in the target (previous) schema
      for (const [key, value] of Object.entries(workingRecord)) {
        if (targetFields.has(key)) {
          result[key] = value
        } else {
          transformations.push(`Removed field ${key}`)
        }
      }

      return result as T
    }

    return {
      ...event,
      before: transformRecord(event.before),
      after: transformRecord(event.after),
    }
  }

  /**
   * Project event to only include fields in schema
   */
  private projectToSchema<T>(event: ChangeEvent<T>, schema: SchemaVersion): ChangeEvent<T> {
    const fieldNames = new Set(schema.fields.map((f) => f.name))

    const projectRecord = (record: T | null): T | null => {
      if (record === null) return null

      const result: Record<string, unknown> = {}
      const recordObj = record as Record<string, unknown>

      for (const field of schema.fields) {
        if (field.name in recordObj) {
          result[field.name] = recordObj[field.name]
        } else if (field.default !== undefined) {
          result[field.name] = field.default
        } else if (!field.required) {
          result[field.name] = null
        }
      }

      return result as T
    }

    return {
      ...event,
      before: projectRecord(event.before),
      after: projectRecord(event.after),
    }
  }

  /**
   * Coerce a value from one type to another
   */
  private coerceValue(value: unknown, from: FieldType, to: FieldType): unknown {
    if (value === null || value === undefined) return value

    // String to other types
    if (from === 'string' && typeof value === 'string') {
      switch (to) {
        case 'integer': {
          const parsed = parseInt(value, 10)
          if (isNaN(parsed)) {
            throw new Error(`Cannot coerce "${value}" from string to integer`)
          }
          return parsed
        }
        case 'float': {
          const parsed = parseFloat(value)
          if (isNaN(parsed)) {
            throw new Error(`Cannot coerce "${value}" from string to float`)
          }
          return parsed
        }
        case 'boolean':
          return value.toLowerCase() === 'true' || value === '1'
        default:
          return value
      }
    }

    // Integer/Float to other types
    if (from === 'integer' || from === 'float') {
      if (to === 'string') return String(value)
      if (to === 'boolean') return value !== 0
    }

    // Boolean to string
    if (from === 'boolean' && to === 'string') {
      return String(value)
    }

    // Timestamp to string
    if (from === 'timestamp' && to === 'string') {
      return new Date(value as number).toISOString()
    }

    return value
  }
}

/**
 * Create a new schema transformer
 */
export function createSchemaTransformer(options: SchemaTransformerOptions): SchemaTransformer {
  return new SchemaTransformer(options)
}
