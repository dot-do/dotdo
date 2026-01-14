/**
 * @dotdo/flink - State Migration Module
 *
 * Provides state migration capabilities for Flink-compatible streaming applications
 * on Durable Objects. Enables schema evolution, state migration between checkpoints,
 * backward-compatible state changes, and serialization versioning.
 *
 * Features:
 * - State schema evolution with compatibility rules
 * - State migration between checkpoint versions
 * - Backward-compatible state changes
 * - State serialization versioning
 * - Migration validation and verification
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/fault-tolerance/state_schema_evolution/
 */

// ===========================================================================
// Schema Compatibility Types
// ===========================================================================

/**
 * Schema compatibility result types
 */
export enum CompatibilityResult {
  /** Schemas are identical - no migration needed */
  COMPATIBLE = 'COMPATIBLE',
  /** Schema change is backward compatible - can read old data */
  COMPATIBLE_AS_IS = 'COMPATIBLE_AS_IS',
  /** Schema change requires migration but is safe */
  COMPATIBLE_WITH_EVOLVING_MIGRATION = 'COMPATIBLE_WITH_EVOLVING_MIGRATION',
  /** Schema change requires migration and may lose data */
  COMPATIBLE_WITH_MIGRATION = 'COMPATIBLE_WITH_MIGRATION',
  /** Schemas are incompatible - migration not possible */
  INCOMPATIBLE = 'INCOMPATIBLE',
}

/**
 * Result of a schema compatibility check
 */
export interface SchemaCompatibilityCheckResult {
  /** The compatibility result */
  result: CompatibilityResult
  /** Whether migration is required */
  requiresMigration: boolean
  /** Description of the compatibility check */
  message?: string
  /** List of incompatible changes if INCOMPATIBLE */
  incompatibleChanges?: SchemaChange[]
  /** Suggested migration path */
  migrationPath?: MigrationStep[]
}

/**
 * Represents a single schema change
 */
export interface SchemaChange {
  /** Type of change */
  changeType: 'ADD_FIELD' | 'REMOVE_FIELD' | 'MODIFY_FIELD' | 'RENAME_FIELD' | 'CHANGE_TYPE'
  /** Field name affected */
  fieldName: string
  /** Old value (for modify/rename/change type) */
  oldValue?: unknown
  /** New value (for modify/rename/change type) */
  newValue?: unknown
  /** Whether the change is backward compatible */
  isBackwardCompatible: boolean
  /** Whether the change is forward compatible */
  isForwardCompatible: boolean
}

/**
 * A step in a migration path
 */
export interface MigrationStep {
  /** Step identifier */
  stepId: string
  /** Description of the migration step */
  description: string
  /** Function to perform the migration */
  migrate: (state: unknown) => unknown
  /** Function to validate the migration result */
  validate?: (state: unknown) => boolean
}

// ===========================================================================
// Schema Version Types
// ===========================================================================

/**
 * Schema version information
 */
export interface SchemaVersion {
  /** Major version - breaking changes */
  major: number
  /** Minor version - backward compatible additions */
  minor: number
  /** Patch version - backward compatible fixes */
  patch: number
}

/**
 * Schema information with version
 */
export interface Schema {
  /** Unique schema identifier */
  id: string
  /** Schema version */
  version: SchemaVersion
  /** Schema definition */
  definition: SchemaDefinition
  /** Created timestamp */
  createdAt: number
  /** Optional description */
  description?: string
}

/**
 * Schema definition describing the structure
 */
export interface SchemaDefinition {
  /** Type of the schema */
  type: 'object' | 'array' | 'primitive'
  /** Fields for object type */
  fields?: SchemaField[]
  /** Element schema for array type */
  elementSchema?: SchemaDefinition
  /** Primitive type name */
  primitiveType?: string
}

/**
 * A field in a schema
 */
export interface SchemaField {
  /** Field name */
  name: string
  /** Field type */
  type: string
  /** Whether the field is required */
  required: boolean
  /** Default value if not required */
  defaultValue?: unknown
  /** Nested schema for complex types */
  nestedSchema?: SchemaDefinition
  /** Field metadata */
  metadata?: Record<string, unknown>
}

// ===========================================================================
// State Serializer Types
// ===========================================================================

/**
 * State serializer interface for versioned serialization
 */
export interface StateSerializer<T> {
  /** Serialize state to bytes */
  serialize(state: T): Uint8Array
  /** Deserialize bytes to state */
  deserialize(data: Uint8Array): T
  /** Get the schema for this serializer */
  getSchema(): Schema
  /** Check compatibility with another serializer's schema */
  checkCompatibility(other: Schema): SchemaCompatibilityCheckResult
  /** Get the serializer version */
  getVersion(): number
  /** Create a migrator to migrate from an older version */
  createMigrator(fromVersion: number): StateMigrator<unknown, T> | null
}

/**
 * Configuration for a state serializer
 */
export interface SerializerConfig {
  /** Enable schema evolution support */
  enableSchemaEvolution?: boolean
  /** Maximum supported version for migration */
  maxMigrationVersion?: number
  /** Custom type converters */
  typeConverters?: TypeConverter[]
}

/**
 * Type converter for custom types
 */
export interface TypeConverter {
  /** Source type name */
  sourceType: string
  /** Target type name */
  targetType: string
  /** Conversion function */
  convert: (value: unknown) => unknown
  /** Reverse conversion function */
  reverse?: (value: unknown) => unknown
}

// ===========================================================================
// State Migration Types
// ===========================================================================

/**
 * State migrator interface
 */
export interface StateMigrator<TFrom, TTo> {
  /** Source schema version */
  fromVersion: number
  /** Target schema version */
  toVersion: number
  /** Migrate state from source to target format */
  migrate(state: TFrom): TTo
  /** Validate the migration result */
  validate?(state: TTo): boolean
}

/**
 * Migration context provided during migration
 */
export interface MigrationContext {
  /** Source checkpoint ID */
  sourceCheckpointId: number
  /** Target checkpoint ID (if known) */
  targetCheckpointId?: number
  /** Source schema version */
  sourceVersion: number
  /** Target schema version */
  targetVersion: number
  /** State name being migrated */
  stateName: string
  /** Operator ID */
  operatorId: string
  /** Whether to fail on validation errors */
  failOnValidationError: boolean
}

/**
 * Result of a state migration operation
 */
export interface StateMigrationResult<T> {
  /** Whether migration was successful */
  success: boolean
  /** Migrated state */
  state?: T
  /** Migration error if failed */
  error?: StateMigrationError
  /** Validation results */
  validationResults?: ValidationResult[]
  /** Source version */
  sourceVersion: number
  /** Target version */
  targetVersion: number
  /** Migration duration in ms */
  durationMs: number
}

/**
 * Validation result for migrated state
 */
export interface ValidationResult {
  /** Field or path being validated */
  path: string
  /** Whether validation passed */
  valid: boolean
  /** Validation message */
  message?: string
  /** Expected value */
  expected?: unknown
  /** Actual value */
  actual?: unknown
}

// ===========================================================================
// State Migration Error Types
// ===========================================================================

/**
 * Error codes for state migration
 */
export enum MigrationErrorCode {
  /** Schema is incompatible */
  SCHEMA_INCOMPATIBLE = 'SCHEMA_INCOMPATIBLE',
  /** Migration path not found */
  NO_MIGRATION_PATH = 'NO_MIGRATION_PATH',
  /** Migration step failed */
  MIGRATION_STEP_FAILED = 'MIGRATION_STEP_FAILED',
  /** Validation failed */
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  /** Deserialization failed */
  DESERIALIZATION_FAILED = 'DESERIALIZATION_FAILED',
  /** Serialization failed */
  SERIALIZATION_FAILED = 'SERIALIZATION_FAILED',
  /** State not found */
  STATE_NOT_FOUND = 'STATE_NOT_FOUND',
  /** Checkpoint not found */
  CHECKPOINT_NOT_FOUND = 'CHECKPOINT_NOT_FOUND',
  /** Version not supported */
  VERSION_NOT_SUPPORTED = 'VERSION_NOT_SUPPORTED',
}

/**
 * State migration error
 */
export class StateMigrationError extends Error {
  constructor(
    message: string,
    public readonly code: MigrationErrorCode,
    public readonly stateName?: string,
    public readonly sourceVersion?: number,
    public readonly targetVersion?: number,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'StateMigrationError'
  }
}

// ===========================================================================
// Schema Evolution Rules
// ===========================================================================

/**
 * Rules for schema evolution
 */
export class SchemaEvolutionRules {
  /**
   * Check if a field addition is backward compatible
   */
  static isFieldAdditionCompatible(field: SchemaField): boolean {
    // Field addition is compatible if the field has a default value or is optional
    return !field.required || field.defaultValue !== undefined
  }

  /**
   * Check if a field removal is backward compatible
   */
  static isFieldRemovalCompatible(field: SchemaField): boolean {
    // Field removal is backward compatible (old data can still be read)
    // but not forward compatible (new data won't have the field)
    return true
  }

  /**
   * Check if a type change is compatible
   */
  static isTypeChangeCompatible(oldType: string, newType: string): boolean {
    // Define compatible type widening rules
    const wideningRules: Record<string, string[]> = {
      int: ['long', 'float', 'double'],
      long: ['float', 'double'],
      float: ['double'],
      short: ['int', 'long', 'float', 'double'],
      byte: ['short', 'int', 'long', 'float', 'double'],
    }

    return wideningRules[oldType]?.includes(newType) ?? false
  }

  /**
   * Get compatibility result for schema changes
   */
  static getCompatibility(changes: SchemaChange[]): CompatibilityResult {
    if (changes.length === 0) {
      return CompatibilityResult.COMPATIBLE
    }

    const hasIncompatible = changes.some(
      (c) => !c.isBackwardCompatible && !c.isForwardCompatible
    )
    if (hasIncompatible) {
      return CompatibilityResult.INCOMPATIBLE
    }

    const requiresMigration = changes.some(
      (c) => !c.isBackwardCompatible || !c.isForwardCompatible
    )
    if (requiresMigration) {
      return CompatibilityResult.COMPATIBLE_WITH_MIGRATION
    }

    const hasEvolution = changes.some(
      (c) => c.changeType === 'ADD_FIELD' || c.changeType === 'REMOVE_FIELD'
    )
    if (hasEvolution) {
      return CompatibilityResult.COMPATIBLE_WITH_EVOLVING_MIGRATION
    }

    return CompatibilityResult.COMPATIBLE_AS_IS
  }
}

// ===========================================================================
// Schema Comparator
// ===========================================================================

/**
 * Compares schemas and detects changes
 */
export class SchemaComparator {
  /**
   * Compare two schemas and return the changes
   */
  static compare(oldSchema: Schema, newSchema: Schema): SchemaChange[] {
    const changes: SchemaChange[] = []

    if (oldSchema.definition.type !== newSchema.definition.type) {
      changes.push({
        changeType: 'CHANGE_TYPE',
        fieldName: '$root',
        oldValue: oldSchema.definition.type,
        newValue: newSchema.definition.type,
        isBackwardCompatible: false,
        isForwardCompatible: false,
      })
      return changes
    }

    if (oldSchema.definition.type === 'object') {
      this.compareFields(
        oldSchema.definition.fields ?? [],
        newSchema.definition.fields ?? [],
        changes
      )
    }

    return changes
  }

  private static compareFields(
    oldFields: SchemaField[],
    newFields: SchemaField[],
    changes: SchemaChange[],
    prefix = ''
  ): void {
    const oldFieldMap = new Map(oldFields.map((f) => [f.name, f]))
    const newFieldMap = new Map(newFields.map((f) => [f.name, f]))

    // Check for removed fields
    for (const [name, field] of oldFieldMap) {
      if (!newFieldMap.has(name)) {
        changes.push({
          changeType: 'REMOVE_FIELD',
          fieldName: prefix ? `${prefix}.${name}` : name,
          oldValue: field,
          isBackwardCompatible: true, // Can still read old data
          isForwardCompatible: false, // New data won't have field
        })
      }
    }

    // Check for added and modified fields
    for (const [name, newField] of newFieldMap) {
      const oldField = oldFieldMap.get(name)
      const fullName = prefix ? `${prefix}.${name}` : name

      if (!oldField) {
        changes.push({
          changeType: 'ADD_FIELD',
          fieldName: fullName,
          newValue: newField,
          isBackwardCompatible: SchemaEvolutionRules.isFieldAdditionCompatible(newField),
          isForwardCompatible: true, // Old code can ignore new fields
        })
      } else if (oldField.type !== newField.type) {
        changes.push({
          changeType: 'CHANGE_TYPE',
          fieldName: fullName,
          oldValue: oldField.type,
          newValue: newField.type,
          isBackwardCompatible: SchemaEvolutionRules.isTypeChangeCompatible(
            oldField.type,
            newField.type
          ),
          isForwardCompatible: SchemaEvolutionRules.isTypeChangeCompatible(
            newField.type,
            oldField.type
          ),
        })
      }

      // Recursively compare nested schemas
      if (oldField?.nestedSchema && newField.nestedSchema) {
        this.compareFields(
          oldField.nestedSchema.fields ?? [],
          newField.nestedSchema.fields ?? [],
          changes,
          fullName
        )
      }
    }
  }

  /**
   * Check compatibility between two schemas
   */
  static checkCompatibility(
    oldSchema: Schema,
    newSchema: Schema
  ): SchemaCompatibilityCheckResult {
    const changes = this.compare(oldSchema, newSchema)
    const result = SchemaEvolutionRules.getCompatibility(changes)

    return {
      result,
      requiresMigration: result !== CompatibilityResult.COMPATIBLE &&
        result !== CompatibilityResult.COMPATIBLE_AS_IS,
      message: this.getCompatibilityMessage(result, changes),
      incompatibleChanges:
        result === CompatibilityResult.INCOMPATIBLE
          ? changes.filter((c) => !c.isBackwardCompatible && !c.isForwardCompatible)
          : undefined,
      migrationPath:
        result !== CompatibilityResult.INCOMPATIBLE
          ? this.buildMigrationPath(changes)
          : undefined,
    }
  }

  private static getCompatibilityMessage(
    result: CompatibilityResult,
    changes: SchemaChange[]
  ): string {
    switch (result) {
      case CompatibilityResult.COMPATIBLE:
        return 'Schemas are identical, no migration needed'
      case CompatibilityResult.COMPATIBLE_AS_IS:
        return 'Schema is compatible, no migration needed'
      case CompatibilityResult.COMPATIBLE_WITH_EVOLVING_MIGRATION:
        return `Schema evolution detected with ${changes.length} change(s), migration will apply defaults`
      case CompatibilityResult.COMPATIBLE_WITH_MIGRATION:
        return `Schema requires migration with ${changes.length} change(s)`
      case CompatibilityResult.INCOMPATIBLE:
        return `Schemas are incompatible: ${changes.filter((c) => !c.isBackwardCompatible && !c.isForwardCompatible).map((c) => c.fieldName).join(', ')}`
    }
  }

  private static buildMigrationPath(changes: SchemaChange[]): MigrationStep[] {
    const steps: MigrationStep[] = []

    for (const change of changes) {
      switch (change.changeType) {
        case 'ADD_FIELD':
          steps.push({
            stepId: `add-${change.fieldName}`,
            description: `Add field ${change.fieldName}`,
            migrate: (state: unknown) => {
              if (typeof state === 'object' && state !== null) {
                const field = change.newValue as SchemaField
                return {
                  ...state,
                  [change.fieldName.split('.').pop()!]: field.defaultValue,
                }
              }
              return state
            },
          })
          break

        case 'REMOVE_FIELD':
          steps.push({
            stepId: `remove-${change.fieldName}`,
            description: `Remove field ${change.fieldName}`,
            migrate: (state: unknown) => {
              if (typeof state === 'object' && state !== null) {
                const fieldName = change.fieldName.split('.').pop()!
                const { [fieldName]: _, ...rest } = state as Record<string, unknown>
                return rest
              }
              return state
            },
          })
          break

        case 'CHANGE_TYPE':
          steps.push({
            stepId: `convert-${change.fieldName}`,
            description: `Convert ${change.fieldName} from ${change.oldValue} to ${change.newValue}`,
            migrate: (state: unknown) => {
              if (typeof state === 'object' && state !== null) {
                const fieldName = change.fieldName.split('.').pop()!
                const obj = state as Record<string, unknown>
                const value = obj[fieldName]
                return {
                  ...obj,
                  [fieldName]: this.convertType(value, change.oldValue as string, change.newValue as string),
                }
              }
              return state
            },
          })
          break
      }
    }

    return steps
  }

  private static convertType(value: unknown, fromType: string, toType: string): unknown {
    if (value === null || value === undefined) return value

    // Numeric conversions
    if (['int', 'long', 'short', 'byte'].includes(fromType) &&
        ['int', 'long', 'float', 'double', 'short', 'byte'].includes(toType)) {
      return Number(value)
    }

    // Float/double conversions
    if (['float', 'double'].includes(fromType) && ['float', 'double'].includes(toType)) {
      return Number(value)
    }

    return value
  }
}

// ===========================================================================
// Versioned State Serializer
// ===========================================================================

/**
 * JSON-based state serializer with versioning support
 */
export class VersionedJsonSerializer<T> implements StateSerializer<T> {
  private version: number
  private schema: Schema
  private migrators: Map<number, StateMigrator<unknown, T>> = new Map()
  private encoder = new TextEncoder()
  private decoder = new TextDecoder()

  constructor(
    schema: Schema,
    version: number = 1,
    migrators?: StateMigrator<unknown, T>[]
  ) {
    this.schema = schema
    this.version = version
    if (migrators) {
      for (const migrator of migrators) {
        this.migrators.set(migrator.fromVersion, migrator)
      }
    }
  }

  serialize(state: T): Uint8Array {
    const wrapper = {
      version: this.version,
      schemaId: this.schema.id,
      data: state,
      timestamp: Date.now(),
    }
    return this.encoder.encode(JSON.stringify(wrapper))
  }

  deserialize(data: Uint8Array): T {
    const json = this.decoder.decode(data)
    const wrapper = JSON.parse(json) as {
      version: number
      schemaId: string
      data: unknown
      timestamp: number
    }

    // Check if migration is needed
    if (wrapper.version !== this.version) {
      const migrator = this.createMigrator(wrapper.version)
      if (migrator) {
        return migrator.migrate(wrapper.data)
      }
      throw new StateMigrationError(
        `Cannot migrate from version ${wrapper.version} to ${this.version}`,
        MigrationErrorCode.NO_MIGRATION_PATH,
        undefined,
        wrapper.version,
        this.version
      )
    }

    return wrapper.data as T
  }

  getSchema(): Schema {
    return this.schema
  }

  getVersion(): number {
    return this.version
  }

  checkCompatibility(other: Schema): SchemaCompatibilityCheckResult {
    return SchemaComparator.checkCompatibility(other, this.schema)
  }

  createMigrator(fromVersion: number): StateMigrator<unknown, T> | null {
    // Check for direct migrator that goes directly to target version
    const direct = this.migrators.get(fromVersion)
    if (direct && direct.toVersion === this.version) {
      return direct
    }

    // Build migration chain
    const chain: StateMigrator<unknown, unknown>[] = []
    let currentVersion = fromVersion

    while (currentVersion < this.version) {
      const migrator = this.migrators.get(currentVersion)
      if (!migrator) return null
      chain.push(migrator)
      currentVersion = migrator.toVersion
    }

    if (chain.length === 0) return null

    // Create composite migrator
    return {
      fromVersion,
      toVersion: this.version,
      migrate: (state: unknown): T => {
        let result = state
        for (const migrator of chain) {
          result = migrator.migrate(result)
        }
        return result as T
      },
    }
  }

  /**
   * Register a migrator for a specific version
   */
  registerMigrator(migrator: StateMigrator<unknown, T>): void {
    this.migrators.set(migrator.fromVersion, migrator)
  }
}

// ===========================================================================
// State Migration Manager
// ===========================================================================

/**
 * Manages state migrations across checkpoints
 */
export class StateMigrationManager {
  private serializers: Map<string, StateSerializer<unknown>> = new Map()
  private schemaHistory: Map<string, Schema[]> = new Map()
  private validationEnabled = true

  constructor(private config?: { enableValidation?: boolean }) {
    if (config?.enableValidation !== undefined) {
      this.validationEnabled = config.enableValidation
    }
  }

  /**
   * Register a serializer for a state name
   */
  registerSerializer<T>(stateName: string, serializer: StateSerializer<T>): void {
    this.serializers.set(stateName, serializer as StateSerializer<unknown>)

    // Track schema history
    const history = this.schemaHistory.get(stateName) ?? []
    const schema = serializer.getSchema()
    if (!history.some((s) => s.id === schema.id)) {
      history.push(schema)
      this.schemaHistory.set(stateName, history)
    }
  }

  /**
   * Get serializer for a state
   */
  getSerializer<T>(stateName: string): StateSerializer<T> | undefined {
    return this.serializers.get(stateName) as StateSerializer<T> | undefined
  }

  /**
   * Migrate state from one checkpoint to another
   */
  async migrateState<T>(
    stateName: string,
    stateData: Uint8Array,
    context: MigrationContext
  ): Promise<StateMigrationResult<T>> {
    const startTime = Date.now()
    const serializer = this.serializers.get(stateName)

    if (!serializer) {
      return {
        success: false,
        error: new StateMigrationError(
          `No serializer registered for state: ${stateName}`,
          MigrationErrorCode.STATE_NOT_FOUND,
          stateName,
          context.sourceVersion,
          context.targetVersion
        ),
        sourceVersion: context.sourceVersion,
        targetVersion: context.targetVersion,
        durationMs: Date.now() - startTime,
      }
    }

    try {
      // Deserialize (which may trigger migration)
      const state = serializer.deserialize(stateData) as T

      // Validate if enabled
      const validationResults: ValidationResult[] = []
      if (this.validationEnabled) {
        const validation = this.validateMigratedState(stateName, state)
        validationResults.push(...validation)

        if (context.failOnValidationError && validation.some((v) => !v.valid)) {
          return {
            success: false,
            error: new StateMigrationError(
              'Validation failed after migration',
              MigrationErrorCode.VALIDATION_FAILED,
              stateName,
              context.sourceVersion,
              context.targetVersion
            ),
            validationResults,
            sourceVersion: context.sourceVersion,
            targetVersion: context.targetVersion,
            durationMs: Date.now() - startTime,
          }
        }
      }

      return {
        success: true,
        state,
        validationResults,
        sourceVersion: context.sourceVersion,
        targetVersion: context.targetVersion,
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof StateMigrationError
            ? error
            : new StateMigrationError(
                `Migration failed: ${(error as Error).message}`,
                MigrationErrorCode.MIGRATION_STEP_FAILED,
                stateName,
                context.sourceVersion,
                context.targetVersion,
                error as Error
              ),
        sourceVersion: context.sourceVersion,
        targetVersion: context.targetVersion,
        durationMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Validate migrated state against schema
   */
  private validateMigratedState(stateName: string, state: unknown): ValidationResult[] {
    const results: ValidationResult[] = []
    const serializer = this.serializers.get(stateName)

    if (!serializer) {
      results.push({
        path: '$root',
        valid: false,
        message: 'No serializer found for validation',
      })
      return results
    }

    const schema = serializer.getSchema()
    this.validateAgainstSchema(state, schema.definition, '$root', results)

    return results
  }

  private validateAgainstSchema(
    value: unknown,
    schema: SchemaDefinition,
    path: string,
    results: ValidationResult[]
  ): void {
    if (schema.type === 'object') {
      if (typeof value !== 'object' || value === null) {
        results.push({
          path,
          valid: false,
          message: `Expected object, got ${typeof value}`,
          expected: 'object',
          actual: typeof value,
        })
        return
      }

      const obj = value as Record<string, unknown>

      for (const field of schema.fields ?? []) {
        const fieldPath = `${path}.${field.name}`
        const fieldValue = obj[field.name]

        if (field.required && fieldValue === undefined) {
          results.push({
            path: fieldPath,
            valid: false,
            message: `Required field is missing`,
            expected: field.type,
            actual: undefined,
          })
        } else if (fieldValue !== undefined && field.nestedSchema) {
          this.validateAgainstSchema(fieldValue, field.nestedSchema, fieldPath, results)
        } else if (fieldValue !== undefined) {
          results.push({
            path: fieldPath,
            valid: true,
          })
        }
      }
    } else if (schema.type === 'array') {
      if (!Array.isArray(value)) {
        results.push({
          path,
          valid: false,
          message: `Expected array, got ${typeof value}`,
          expected: 'array',
          actual: typeof value,
        })
        return
      }

      if (schema.elementSchema) {
        for (let i = 0; i < value.length; i++) {
          this.validateAgainstSchema(value[i], schema.elementSchema, `${path}[${i}]`, results)
        }
      }
    }
  }

  /**
   * Check if migration is possible between versions
   */
  canMigrate(stateName: string, fromVersion: number, toVersion: number): boolean {
    const serializer = this.serializers.get(stateName)
    if (!serializer) return false

    const migrator = serializer.createMigrator(fromVersion)
    return migrator !== null && migrator.toVersion === toVersion
  }

  /**
   * Get schema history for a state
   */
  getSchemaHistory(stateName: string): Schema[] {
    return this.schemaHistory.get(stateName) ?? []
  }

  /**
   * Clear all registered serializers
   */
  clear(): void {
    this.serializers.clear()
    this.schemaHistory.clear()
  }
}

// ===========================================================================
// Checkpoint State Migration
// ===========================================================================

/**
 * Options for checkpoint migration
 */
export interface CheckpointMigrationOptions {
  /** Allow partial migration (skip failed states) */
  allowPartialMigration?: boolean
  /** Validate all states after migration */
  validateAfterMigration?: boolean
  /** Create backup before migration */
  createBackup?: boolean
  /** Dry run - don't actually modify state */
  dryRun?: boolean
}

/**
 * Result of checkpoint migration
 */
export interface CheckpointMigrationResult {
  /** Whether migration was successful */
  success: boolean
  /** Number of states migrated */
  statesMigrated: number
  /** Number of states skipped */
  statesSkipped: number
  /** Number of states failed */
  statesFailed: number
  /** Individual state migration results */
  stateResults: Map<string, StateMigrationResult<unknown>>
  /** Source checkpoint ID */
  sourceCheckpointId: number
  /** Target checkpoint ID */
  targetCheckpointId: number
  /** Total duration in ms */
  durationMs: number
  /** Backup ID if backup was created */
  backupId?: string
}

/**
 * Migrates entire checkpoint state
 */
export class CheckpointMigrator {
  constructor(private migrationManager: StateMigrationManager) {}

  /**
   * Migrate all states from a checkpoint
   */
  async migrateCheckpoint(
    sourceCheckpointId: number,
    targetCheckpointId: number,
    states: Map<string, { data: Uint8Array; version: number }>,
    options?: CheckpointMigrationOptions
  ): Promise<CheckpointMigrationResult> {
    const startTime = Date.now()
    const stateResults = new Map<string, StateMigrationResult<unknown>>()
    let statesMigrated = 0
    let statesSkipped = 0
    let statesFailed = 0

    for (const [stateName, { data, version }] of states) {
      const serializer = this.migrationManager.getSerializer(stateName)
      if (!serializer) {
        statesSkipped++
        continue
      }

      const targetVersion = serializer.getVersion()
      if (version === targetVersion) {
        statesSkipped++
        continue
      }

      const context: MigrationContext = {
        sourceCheckpointId,
        targetCheckpointId,
        sourceVersion: version,
        targetVersion,
        stateName,
        operatorId: 'checkpoint-migrator',
        failOnValidationError: !options?.allowPartialMigration,
      }

      if (options?.dryRun) {
        // Just check if migration is possible
        const canMigrate = this.migrationManager.canMigrate(stateName, version, targetVersion)
        stateResults.set(stateName, {
          success: canMigrate,
          sourceVersion: version,
          targetVersion,
          durationMs: 0,
        })
        if (canMigrate) {
          statesMigrated++
        } else {
          statesFailed++
        }
        continue
      }

      const result = await this.migrationManager.migrateState(stateName, data, context)
      stateResults.set(stateName, result)

      if (result.success) {
        statesMigrated++
      } else {
        statesFailed++
        if (!options?.allowPartialMigration) {
          return {
            success: false,
            statesMigrated,
            statesSkipped,
            statesFailed,
            stateResults,
            sourceCheckpointId,
            targetCheckpointId,
            durationMs: Date.now() - startTime,
          }
        }
      }
    }

    return {
      success: statesFailed === 0 || (options?.allowPartialMigration ?? false),
      statesMigrated,
      statesSkipped,
      statesFailed,
      stateResults,
      sourceCheckpointId,
      targetCheckpointId,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Validate that migration is possible for all states
   */
  validateMigration(
    states: Map<string, { version: number }>,
    targetVersions?: Map<string, number>
  ): Map<string, SchemaCompatibilityCheckResult> {
    const results = new Map<string, SchemaCompatibilityCheckResult>()

    for (const [stateName, { version }] of states) {
      const serializer = this.migrationManager.getSerializer(stateName)
      if (!serializer) {
        results.set(stateName, {
          result: CompatibilityResult.INCOMPATIBLE,
          requiresMigration: false,
          message: 'No serializer registered',
        })
        continue
      }

      const targetVersion = targetVersions?.get(stateName) ?? serializer.getVersion()

      if (version === targetVersion) {
        results.set(stateName, {
          result: CompatibilityResult.COMPATIBLE,
          requiresMigration: false,
          message: 'Versions match, no migration needed',
        })
        continue
      }

      const canMigrate = this.migrationManager.canMigrate(stateName, version, targetVersion)
      results.set(stateName, {
        result: canMigrate
          ? CompatibilityResult.COMPATIBLE_WITH_MIGRATION
          : CompatibilityResult.INCOMPATIBLE,
        requiresMigration: true,
        message: canMigrate
          ? `Migration available from v${version} to v${targetVersion}`
          : `No migration path from v${version} to v${targetVersion}`,
      })
    }

    return results
  }
}

// ===========================================================================
// Backward Compatible State Wrapper
// ===========================================================================

/**
 * Wrapper for backward-compatible state access
 */
export class BackwardCompatibleState<T> {
  private currentVersion: number
  private data: T
  private defaults: Partial<T>

  constructor(data: T, version: number, defaults: Partial<T> = {}) {
    this.data = data
    this.currentVersion = version
    this.defaults = defaults
  }

  /**
   * Get a field value with fallback to default
   */
  get<K extends keyof T>(key: K): T[K] | undefined {
    if (this.data[key] !== undefined) {
      return this.data[key]
    }
    return this.defaults[key] as T[K] | undefined
  }

  /**
   * Get the underlying data
   */
  getData(): T {
    return { ...this.defaults, ...this.data } as T
  }

  /**
   * Get the version
   */
  getVersion(): number {
    return this.currentVersion
  }

  /**
   * Check if a field exists in the current version
   */
  hasField(key: keyof T): boolean {
    return key in this.data
  }
}

