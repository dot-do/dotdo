/**
 * SchemaEvolution - Dynamic schema management primitive
 *
 * Provides automatic schema evolution capabilities:
 * - Infer schema from JSON data samples
 * - Detect schema differences (added/removed/changed fields)
 * - Check compatibility between schema versions
 * - Apply schema evolutions
 * - Schema versioning with rollback support
 */

import { Duration, toMillis } from './utils/duration'

// Re-export Duration for backwards compatibility
export type { Duration } from './utils/duration'

// ============================================================================
// FIELD TYPES
// ============================================================================

export type PrimitiveFieldType =
  | 'string'
  | 'int'
  | 'float'
  | 'boolean'
  | 'null'
  | 'timestamp'
  | 'date'
  | 'binary'

export interface ArrayFieldType {
  type: 'array'
  elementType: FieldType
}

export interface MapFieldType {
  type: 'map'
  keyType: FieldType
  valueType: FieldType
}

export interface StructFieldType {
  type: 'struct'
  fields: Map<string, FieldType>
}

export type FieldType = PrimitiveFieldType | ArrayFieldType | MapFieldType | StructFieldType

// ============================================================================
// SCHEMA TYPES
// ============================================================================

export interface Schema {
  fields: Map<string, FieldType>
  requiredFields: Set<string>
  version: number
}

export interface SchemaDiff {
  addedFields: Map<string, FieldType>
  removedFields: Set<string>
  changedTypes: Map<string, { from: FieldType; to: FieldType }>
  nullabilityChanges: Map<string, boolean> // true = became nullable, false = became required
}

export interface CompatibilityResult {
  compatible: boolean
  breakingChanges: string[]
  warnings: string[]
}

export interface SchemaVersion {
  version: number
  schema: Schema
  createdAt: number
  description?: string
}

/**
 * Retention policy for controlling history memory usage
 */
export interface HistoryRetentionPolicy {
  /** Keep only the last N schema versions in history */
  maxVersions?: number
  /** Keep versions newer than this duration */
  maxAge?: Duration
}

/**
 * Statistics about history pruning operations
 */
export interface HistoryPruneStats {
  /** Number of versions removed from history */
  versionsRemoved: number
  /** Oldest remaining version number */
  oldestVersion: number | null
  /** Newest remaining version number */
  newestVersion: number | null
}

export interface SchemaEvolutionOptions {
  strictMode?: boolean
  allowTypeWidening?: boolean
  /** Retention policy for schema history */
  retention?: HistoryRetentionPolicy
}

// ============================================================================
// SCHEMA EVOLUTION INTERFACE
// ============================================================================

export interface SchemaEvolution {
  // Infer schema from data samples
  inferSchema(sample: unknown[]): Schema

  // Detect changes between schemas
  diff(oldSchema: Schema, newSchema: Schema): SchemaDiff

  // Check if evolution is compatible (backward/forward)
  isCompatible(oldSchema: Schema, newSchema: Schema): CompatibilityResult

  // Apply schema evolution
  evolve(diff: SchemaDiff): Promise<void>

  // Schema versioning
  getVersion(): number
  getHistory(): SchemaVersion[]
  rollback(version: number): Promise<void>

  // Get current schema
  getSchema(): Schema

  // History retention management
  /** Prune old versions from history based on retention policy */
  prune(policy?: HistoryRetentionPolicy): Promise<HistoryPruneStats>
  /** Alias for prune() - compact old versions from history based on retention policy */
  compact(policy?: HistoryRetentionPolicy): Promise<HistoryPruneStats>
  /** Get current retention policy */
  getRetentionPolicy(): HistoryRetentionPolicy | undefined
  /** Set retention policy */
  setRetentionPolicy(policy: HistoryRetentionPolicy | undefined): void
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create an empty schema
 */
export function createEmptySchema(): Schema {
  return {
    fields: new Map(),
    requiredFields: new Set(),
    version: 0,
  }
}

/**
 * Check if a FieldType is a primitive
 */
function isPrimitive(type: FieldType): type is PrimitiveFieldType {
  return typeof type === 'string'
}

/**
 * Check if two field types are equal
 */
export function fieldTypesEqual(a: FieldType, b: FieldType): boolean {
  // Both primitives
  if (isPrimitive(a) && isPrimitive(b)) {
    return a === b
  }

  // One primitive, one complex - not equal
  if (isPrimitive(a) || isPrimitive(b)) {
    return false
  }

  // Both complex types
  if (a.type !== b.type) {
    return false
  }

  // Array comparison
  if (a.type === 'array' && b.type === 'array') {
    return fieldTypesEqual(a.elementType, b.elementType)
  }

  // Map comparison
  if (a.type === 'map' && b.type === 'map') {
    return fieldTypesEqual(a.keyType, b.keyType) && fieldTypesEqual(a.valueType, b.valueType)
  }

  // Struct comparison
  if (a.type === 'struct' && b.type === 'struct') {
    if (a.fields.size !== b.fields.size) {
      return false
    }
    for (const [key, aType] of a.fields) {
      const bType = b.fields.get(key)
      if (!bType || !fieldTypesEqual(aType, bType)) {
        return false
      }
    }
    return true
  }

  return false
}

/**
 * Check if type A can be widened to type B (e.g., int -> float)
 * Returns true only for valid widening (not same type)
 */
export function canWiden(from: FieldType, to: FieldType): boolean {
  // Only handle primitive widening
  if (!isPrimitive(from) || !isPrimitive(to)) {
    // For complex types, check element/value types
    if (!isPrimitive(from) && !isPrimitive(to)) {
      if (from.type === 'array' && to.type === 'array') {
        return canWiden(from.elementType, to.elementType)
      }
      if (from.type === 'map' && to.type === 'map') {
        return canWiden(from.valueType, to.valueType)
      }
    }
    return false
  }

  // Same type is not widening
  if (from === to) {
    return false
  }

  // int -> float is valid widening
  if (from === 'int' && to === 'float') {
    return true
  }

  return false
}

/**
 * Check if type change is narrowing (incompatible)
 */
function isNarrowing(from: FieldType, to: FieldType): boolean {
  if (!isPrimitive(from) || !isPrimitive(to)) {
    // For complex types, check element/value types
    if (!isPrimitive(from) && !isPrimitive(to)) {
      if (from.type === 'array' && to.type === 'array') {
        return isNarrowing(from.elementType, to.elementType)
      }
      if (from.type === 'map' && to.type === 'map') {
        return isNarrowing(from.valueType, to.valueType)
      }
      // Struct field changes need deeper comparison
      if (from.type === 'struct' && to.type === 'struct') {
        // Check for narrowing in any nested fields
        for (const [key, fromType] of from.fields) {
          const toType = to.fields.get(key)
          if (toType && isNarrowing(fromType, toType)) {
            return true
          }
          // Field type change that's not widening is incompatible
          if (toType && !fieldTypesEqual(fromType, toType) && !canWiden(fromType, toType)) {
            return true
          }
        }
        return false
      }
    }
    return false
  }

  // Same type is not narrowing
  if (from === to) {
    return false
  }

  // float -> int is narrowing
  if (from === 'float' && to === 'int') {
    return true
  }

  // Different types that aren't widening are incompatible
  if (!canWiden(from, to)) {
    return true
  }

  return false
}

/**
 * Get a human-readable string representation of a field type
 */
export function fieldTypeToString(type: FieldType): string {
  if (isPrimitive(type)) {
    return type
  }

  if (type.type === 'array') {
    return `array<${fieldTypeToString(type.elementType)}>`
  }

  if (type.type === 'map') {
    return `map<${fieldTypeToString(type.keyType)}, ${fieldTypeToString(type.valueType)}>`
  }

  if (type.type === 'struct') {
    const fields = Array.from(type.fields.entries())
      .map(([name, t]) => `${name}: ${fieldTypeToString(t)}`)
      .join(', ')
    return `struct{${fields}}`
  }

  return 'unknown'
}

/**
 * Clone a schema deeply
 */
function cloneSchema(schema: Schema): Schema {
  return {
    fields: cloneFieldsMap(schema.fields),
    requiredFields: new Set(schema.requiredFields),
    version: schema.version,
  }
}

/**
 * Clone fields map deeply
 */
function cloneFieldsMap(fields: Map<string, FieldType>): Map<string, FieldType> {
  const cloned = new Map<string, FieldType>()
  for (const [key, value] of fields) {
    cloned.set(key, cloneFieldType(value))
  }
  return cloned
}

/**
 * Clone a field type deeply
 */
function cloneFieldType(type: FieldType): FieldType {
  if (isPrimitive(type)) {
    return type
  }

  if (type.type === 'array') {
    return {
      type: 'array',
      elementType: cloneFieldType(type.elementType),
    }
  }

  if (type.type === 'map') {
    return {
      type: 'map',
      keyType: cloneFieldType(type.keyType),
      valueType: cloneFieldType(type.valueType),
    }
  }

  if (type.type === 'struct') {
    return {
      type: 'struct',
      fields: cloneFieldsMap(type.fields),
    }
  }

  return type
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * In-memory implementation of SchemaEvolution
 */
class SchemaEvolutionImpl implements SchemaEvolution {
  private options: SchemaEvolutionOptions
  private currentSchema: Schema | null = null
  private history: SchemaVersion[] = []
  private retentionPolicy: HistoryRetentionPolicy | undefined

  constructor(options: SchemaEvolutionOptions = {}) {
    this.options = options
    this.retentionPolicy = options.retention
  }

  /**
   * Infer schema from data samples
   */
  inferSchema(sample: unknown[]): Schema {
    if (sample.length === 0) {
      const emptySchema: Schema = {
        fields: new Map(),
        requiredFields: new Set(),
        version: 1,
      }
      this.currentSchema = emptySchema
      this.history.push({
        version: 1,
        schema: cloneSchema(emptySchema),
        createdAt: Date.now(),
      })
      return emptySchema
    }

    // Track field presence across all samples
    const fieldPresence = new Map<string, number>()
    const fieldTypes = new Map<string, FieldType[]>()

    for (const obj of sample) {
      if (typeof obj !== 'object' || obj === null) continue

      const record = obj as Record<string, unknown>
      for (const [key, value] of Object.entries(record)) {
        // Track presence
        fieldPresence.set(key, (fieldPresence.get(key) ?? 0) + 1)

        // Track types
        if (!fieldTypes.has(key)) {
          fieldTypes.set(key, [])
        }
        const inferredType = this.inferValueType(value)
        if (inferredType !== null) {
          fieldTypes.get(key)!.push(inferredType)
        }
      }
    }

    // Determine final types and required fields
    const fields = new Map<string, FieldType>()
    const requiredFields = new Set<string>()

    for (const [key, types] of fieldTypes) {
      const presence = fieldPresence.get(key) ?? 0

      // If field is present in all samples (and not null), it's required
      const nonNullTypes = types.filter((t) => t !== 'null')
      if (presence === sample.length && nonNullTypes.length === sample.length) {
        requiredFields.add(key)
      }

      // Merge types
      const mergedType = this.mergeTypes(types)
      if (mergedType !== null) {
        fields.set(key, mergedType)
      }
    }

    const schema: Schema = {
      fields,
      requiredFields,
      version: 1,
    }

    this.currentSchema = schema
    this.history.push({
      version: 1,
      schema: cloneSchema(schema),
      createdAt: Date.now(),
    })

    return schema
  }

  /**
   * Infer the type of a single value
   */
  private inferValueType(value: unknown): FieldType | null {
    if (value === null) {
      return 'null'
    }

    if (typeof value === 'boolean') {
      return 'boolean'
    }

    if (typeof value === 'number') {
      // Check if it's an integer or float
      return Number.isInteger(value) ? 'int' : 'float'
    }

    if (typeof value === 'string') {
      // Check for timestamp (ISO 8601 with time)
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        return 'timestamp'
      }
      // Check for date only (YYYY-MM-DD)
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return 'date'
      }
      return 'string'
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        // Empty array - element type unknown, will be determined from other samples
        return { type: 'array', elementType: 'null' }
      }

      // Infer element type from array contents
      const elementTypes = value.map((v) => this.inferValueType(v)).filter((t): t is FieldType => t !== null)
      const mergedElement = this.mergeTypes(elementTypes) ?? 'null'

      return {
        type: 'array',
        elementType: mergedElement,
      }
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>
      const structFields = new Map<string, FieldType>()

      for (const [key, val] of Object.entries(record)) {
        const fieldType = this.inferValueType(val)
        if (fieldType !== null) {
          structFields.set(key, fieldType)
        }
      }

      return {
        type: 'struct',
        fields: structFields,
      }
    }

    return null
  }

  /**
   * Merge multiple types into one (for when a field has different types across samples)
   */
  private mergeTypes(types: FieldType[]): FieldType | null {
    if (types.length === 0) return null

    // Filter out nulls for type determination
    const nonNullTypes = types.filter((t) => t !== 'null')
    if (nonNullTypes.length === 0) {
      return 'null'
    }

    // All same type
    const first = nonNullTypes[0]
    if (nonNullTypes.every((t) => fieldTypesEqual(t, first))) {
      return first
    }

    // Check for int/float mix - widen to float
    const hasInt = nonNullTypes.some((t) => t === 'int')
    const hasFloat = nonNullTypes.some((t) => t === 'float')
    if (hasInt && hasFloat && nonNullTypes.every((t) => t === 'int' || t === 'float')) {
      return 'float'
    }

    // For arrays with different element types
    if (nonNullTypes.every((t) => !isPrimitive(t) && t.type === 'array')) {
      const elementTypes = nonNullTypes
        .filter((t): t is ArrayFieldType => !isPrimitive(t) && t.type === 'array')
        .map((t) => t.elementType)
      const mergedElement = this.mergeTypes(elementTypes) ?? 'null'
      return { type: 'array', elementType: mergedElement }
    }

    // For structs, merge fields
    if (nonNullTypes.every((t) => !isPrimitive(t) && t.type === 'struct')) {
      const structs = nonNullTypes.filter((t): t is StructFieldType => !isPrimitive(t) && t.type === 'struct')
      const mergedFields = new Map<string, FieldType>()

      // Collect all field types per key
      const fieldsByKey = new Map<string, FieldType[]>()
      for (const struct of structs) {
        for (const [key, type] of struct.fields) {
          if (!fieldsByKey.has(key)) {
            fieldsByKey.set(key, [])
          }
          fieldsByKey.get(key)!.push(type)
        }
      }

      // Merge each field's types
      for (const [key, fieldTypes] of fieldsByKey) {
        const merged = this.mergeTypes(fieldTypes)
        if (merged !== null) {
          mergedFields.set(key, merged)
        }
      }

      return { type: 'struct', fields: mergedFields }
    }

    // Default: return first non-null type
    return first
  }

  /**
   * Detect changes between schemas
   */
  diff(oldSchema: Schema, newSchema: Schema): SchemaDiff {
    const addedFields = new Map<string, FieldType>()
    const removedFields = new Set<string>()
    const changedTypes = new Map<string, { from: FieldType; to: FieldType }>()
    const nullabilityChanges = new Map<string, boolean>()

    // Find added fields (in new but not in old)
    for (const [key, type] of newSchema.fields) {
      if (!oldSchema.fields.has(key)) {
        addedFields.set(key, type)
      }
    }

    // Find removed fields (in old but not in new)
    for (const key of oldSchema.fields.keys()) {
      if (!newSchema.fields.has(key)) {
        removedFields.add(key)
      }
    }

    // Find type changes (in both but different types)
    for (const [key, newType] of newSchema.fields) {
      const oldType = oldSchema.fields.get(key)
      if (oldType && !fieldTypesEqual(oldType, newType)) {
        changedTypes.set(key, { from: oldType, to: newType })
      }
    }

    // Find nullability changes (only for fields that exist in both)
    for (const key of newSchema.fields.keys()) {
      if (oldSchema.fields.has(key)) {
        const wasRequired = oldSchema.requiredFields.has(key)
        const isRequired = newSchema.requiredFields.has(key)

        if (wasRequired && !isRequired) {
          // Became nullable (optional)
          nullabilityChanges.set(key, true)
        } else if (!wasRequired && isRequired) {
          // Became required (non-nullable)
          nullabilityChanges.set(key, false)
        }
      }
    }

    return {
      addedFields,
      removedFields,
      changedTypes,
      nullabilityChanges,
    }
  }

  /**
   * Check if evolution is compatible (backward/forward)
   */
  isCompatible(oldSchema: Schema, newSchema: Schema): CompatibilityResult {
    const diff = this.diff(oldSchema, newSchema)
    const breakingChanges: string[] = []
    const warnings: string[] = []

    // Adding a new required field is breaking
    for (const [key] of diff.addedFields) {
      if (newSchema.requiredFields.has(key)) {
        breakingChanges.push(`Added required field '${key}'`)
      }
    }

    // Removing a required field is breaking
    for (const key of diff.removedFields) {
      if (oldSchema.requiredFields.has(key)) {
        breakingChanges.push(`Removed required field '${key}'`)
      } else {
        warnings.push(`Removed optional field '${key}'`)
      }
    }

    // Type changes
    for (const [key, change] of diff.changedTypes) {
      if (canWiden(change.from, change.to)) {
        warnings.push(`Field '${key}' widened from ${fieldTypeToString(change.from)} to ${fieldTypeToString(change.to)}`)
      } else if (isNarrowing(change.from, change.to)) {
        breakingChanges.push(
          `Field '${key}' narrowed from ${fieldTypeToString(change.from)} to ${fieldTypeToString(change.to)}`
        )
      } else {
        // Incompatible type change
        breakingChanges.push(
          `Field '${key}' changed type from ${fieldTypeToString(change.from)} to ${fieldTypeToString(change.to)}`
        )
      }
    }

    // Nullability changes
    for (const [key, becameNullable] of diff.nullabilityChanges) {
      if (becameNullable) {
        // Became optional/nullable - compatible but warning
        warnings.push(`Field '${key}' became nullable`)
      } else {
        // Became required/non-nullable - breaking
        breakingChanges.push(`Field '${key}' became required (non-nullable)`)
      }
    }

    return {
      compatible: breakingChanges.length === 0,
      breakingChanges,
      warnings,
    }
  }

  /**
   * Apply schema evolution
   */
  async evolve(diff: SchemaDiff): Promise<void> {
    if (!this.currentSchema) {
      throw new Error('No current schema to evolve')
    }

    const newSchema = cloneSchema(this.currentSchema)
    newSchema.version += 1

    // Add new fields
    for (const [key, type] of diff.addedFields) {
      newSchema.fields.set(key, type)
    }

    // Remove fields
    for (const key of diff.removedFields) {
      newSchema.fields.delete(key)
      newSchema.requiredFields.delete(key)
    }

    // Change types
    for (const [key, change] of diff.changedTypes) {
      newSchema.fields.set(key, change.to)
    }

    // Apply nullability changes
    for (const [key, becameNullable] of diff.nullabilityChanges) {
      if (becameNullable) {
        newSchema.requiredFields.delete(key)
      } else {
        newSchema.requiredFields.add(key)
      }
    }

    // Store in history
    this.history.push({
      version: newSchema.version,
      schema: cloneSchema(newSchema),
      createdAt: Date.now(),
    })

    this.currentSchema = newSchema
  }

  /**
   * Get current schema version
   */
  getVersion(): number {
    return this.currentSchema?.version ?? 0
  }

  /**
   * Get schema version history
   */
  getHistory(): SchemaVersion[] {
    return [...this.history]
  }

  /**
   * Rollback to a specific version
   */
  async rollback(version: number): Promise<void> {
    if (version <= 0) {
      throw new Error(`Cannot rollback to version ${version}`)
    }

    const historyEntry = this.history.find((h) => h.version === version)
    if (!historyEntry) {
      throw new Error(`Version ${version} not found in history`)
    }

    // Create a new schema entry based on the historical version
    this.currentSchema = cloneSchema(historyEntry.schema)
  }

  /**
   * Get current schema
   */
  getSchema(): Schema {
    if (!this.currentSchema) {
      return createEmptySchema()
    }
    return this.currentSchema
  }

  /**
   * Prune old versions from history based on retention policy
   * Uses provided policy or falls back to instance retention policy
   */
  async prune(policy?: HistoryRetentionPolicy): Promise<HistoryPruneStats> {
    const effectivePolicy = policy ?? this.retentionPolicy

    // If no policy is set, do nothing (backwards compatible - unlimited retention)
    if (!effectivePolicy) {
      return {
        versionsRemoved: 0,
        oldestVersion: this.history.length > 0 ? this.history[0].version : null,
        newestVersion: this.history.length > 0 ? this.history[this.history.length - 1].version : null,
      }
    }

    const now = Date.now()
    const originalCount = this.history.length
    let filteredHistory = this.history

    // Apply maxAge filter - keep versions newer than cutoff
    if (effectivePolicy.maxAge !== undefined) {
      const maxAgeMs = toMillis(effectivePolicy.maxAge)
      const cutoffTimestamp = now - maxAgeMs
      filteredHistory = filteredHistory.filter(v => v.createdAt >= cutoffTimestamp)
    }

    // Apply maxVersions limit (keep the most recent N versions)
    if (effectivePolicy.maxVersions !== undefined && filteredHistory.length > effectivePolicy.maxVersions) {
      // History is sorted by version (ascending), so slice from the end
      filteredHistory = filteredHistory.slice(-effectivePolicy.maxVersions)
    }

    const versionsRemoved = originalCount - filteredHistory.length
    this.history = filteredHistory

    return {
      versionsRemoved,
      oldestVersion: filteredHistory.length > 0 ? filteredHistory[0].version : null,
      newestVersion: filteredHistory.length > 0 ? filteredHistory[filteredHistory.length - 1].version : null,
    }
  }

  /**
   * Alias for prune() - compact old versions from history based on retention policy
   */
  async compact(policy?: HistoryRetentionPolicy): Promise<HistoryPruneStats> {
    return this.prune(policy)
  }

  /**
   * Get the current retention policy
   */
  getRetentionPolicy(): HistoryRetentionPolicy | undefined {
    return this.retentionPolicy
  }

  /**
   * Set the retention policy
   */
  setRetentionPolicy(policy: HistoryRetentionPolicy | undefined): void {
    this.retentionPolicy = policy
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates a new SchemaEvolution instance
 */
export function createSchemaEvolution(options?: SchemaEvolutionOptions): SchemaEvolution {
  return new SchemaEvolutionImpl(options)
}
