/**
 * SchemaEvolution - Schema evolution and compatibility checking for DataContract
 *
 * Provides:
 * - Backward compatibility checking (new schema can read old data)
 * - Forward compatibility checking (old schema can read new data)
 * - Full compatibility mode (both directions)
 * - Breaking change detection
 * - Migration path suggestions
 */

import type { DataContract, JSONSchema, SchemaDiff } from './index'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Compatibility mode for schema evolution
 */
export type CompatibilityMode =
  | 'backward' // New schema can read old data
  | 'forward' // Old schema can read new data
  | 'full' // Both directions
  | 'none' // No guarantees

/**
 * Evolution policy configuration
 */
export interface EvolutionPolicy {
  mode: CompatibilityMode
  /** Allow removing optional fields */
  allowFieldRemoval: boolean
  /** Allow narrowing types (e.g., number -> integer) */
  allowTypeNarrowing: boolean
  /** Require default values for new required fields */
  requireDefaults: boolean
}

/**
 * Policy violation details
 */
export interface PolicyViolation {
  type: 'breaking_change' | 'policy_violation' | 'warning'
  field?: string
  message: string
  rule: string
}

/**
 * Suggested fix for a policy violation
 */
export interface SuggestedFix {
  violation: PolicyViolation
  suggestion: string
  autoFixable: boolean
  fix?: (schema: JSONSchema) => JSONSchema
}

/**
 * Evolution result from compatibility checking
 */
export interface EvolutionResult {
  allowed: boolean
  violations: PolicyViolation[]
  suggestedFixes: SuggestedFix[]
  breakingChanges: string[]
  warnings: string[]
  /** Schema diff details for visualization */
  diff: SchemaDiff
}

/**
 * Migration operation
 */
export interface MigrationOperation {
  type: 'add' | 'remove' | 'rename' | 'transform' | 'coerce'
  field?: string
  fromField?: string
  toField?: string
  defaultValue?: unknown
  transform?: (value: unknown) => unknown
  targetType?: string
}

/**
 * Migration script for transforming data
 */
export interface MigrationScript {
  fromVersion: string
  toVersion: string
  operations: MigrationOperation[]
  isReversible: boolean
  reverseOperations?: MigrationOperation[]
}

// ============================================================================
// DEFAULT POLICIES
// ============================================================================

/**
 * Default policies for each compatibility mode
 */
export const DEFAULT_POLICIES: Record<CompatibilityMode, EvolutionPolicy> = {
  backward: {
    mode: 'backward',
    allowFieldRemoval: true, // Can remove fields - old data won't have them
    allowTypeNarrowing: false, // Cannot narrow types - would break reading old data
    requireDefaults: true, // New required fields need defaults
  },
  forward: {
    mode: 'forward',
    allowFieldRemoval: false, // Cannot remove fields - old schema expects them
    allowTypeNarrowing: true, // Can narrow - old schema will handle wider type
    requireDefaults: false, // Not needed for forward compat
  },
  full: {
    mode: 'full',
    allowFieldRemoval: false, // Cannot remove in either direction
    allowTypeNarrowing: false, // Cannot narrow in either direction
    requireDefaults: true, // Safest default
  },
  none: {
    mode: 'none',
    allowFieldRemoval: true,
    allowTypeNarrowing: true,
    requireDefaults: false,
  },
}

// ============================================================================
// TYPE COMPATIBILITY
// ============================================================================

/**
 * Type widening hierarchy (narrower -> wider)
 */
const TYPE_HIERARCHY: Record<string, string[]> = {
  integer: ['number'],
  number: [],
  string: [],
  boolean: [],
  null: [],
  object: [],
  array: [],
}

/**
 * Safe type coercions
 */
const SAFE_COERCIONS: Record<string, string[]> = {
  integer: ['number', 'string'],
  number: ['string'],
  boolean: ['string'],
  string: [],
  null: ['string'],
}

/**
 * Check if type can be widened (e.g., integer -> number)
 */
function canWidenType(from: string, to: string): boolean {
  if (from === to) return true
  const widerTypes = TYPE_HIERARCHY[from] || []
  return widerTypes.includes(to)
}

/**
 * Check if type can be safely coerced
 */
function canCoerceType(from: string, to: string): boolean {
  if (from === to) return true
  const coercibleTypes = SAFE_COERCIONS[from] || []
  return coercibleTypes.includes(to)
}

/**
 * Check if type change is narrowing (e.g., number -> integer)
 */
function isTypeNarrowing(from: string, to: string): boolean {
  if (from === to) return false
  // Check if 'to' can be widened to 'from'
  return canWidenType(to, from)
}

// ============================================================================
// SCHEMA EVOLUTION CLASS
// ============================================================================

/**
 * SchemaEvolution - Manages schema evolution with compatibility checking
 */
export class SchemaEvolution {
  private policy: EvolutionPolicy

  constructor(policy: EvolutionPolicy | CompatibilityMode = 'backward') {
    if (typeof policy === 'string') {
      this.policy = { ...DEFAULT_POLICIES[policy] }
    } else {
      this.policy = { ...policy }
    }
  }

  /**
   * Get the current evolution policy
   */
  getPolicy(): EvolutionPolicy {
    return { ...this.policy }
  }

  /**
   * Set the evolution policy
   */
  setPolicy(policy: EvolutionPolicy | CompatibilityMode): void {
    if (typeof policy === 'string') {
      this.policy = { ...DEFAULT_POLICIES[policy] }
    } else {
      this.policy = { ...policy }
    }
  }

  /**
   * Check compatibility between old and new schemas
   */
  checkCompatibility(oldSchema: DataContract, newSchema: DataContract): EvolutionResult {
    const violations: PolicyViolation[] = []
    const suggestedFixes: SuggestedFix[] = []
    const breakingChanges: string[] = []
    const warnings: string[] = []

    const diff = this.diffSchemas(oldSchema.schema, newSchema.schema)

    // Check removed fields
    for (const field of diff.removedFields) {
      const wasRequired = oldSchema.schema.required?.includes(field) ?? false

      if (wasRequired) {
        const violation: PolicyViolation = {
          type: 'breaking_change',
          field,
          message: `Required field '${field}' was removed`,
          rule: 'no_remove_required',
        }
        violations.push(violation)
        breakingChanges.push(violation.message)

        // Suggest making it optional first
        suggestedFixes.push({
          violation,
          suggestion: `Make field '${field}' optional before removing it`,
          autoFixable: false,
        })
      } else if (!this.policy.allowFieldRemoval) {
        // In forward/full mode, removing optional fields is a breaking change
        const violation: PolicyViolation = {
          type: 'breaking_change',
          field,
          message: `Optional field '${field}' was removed (not allowed by ${this.policy.mode} compatibility mode)`,
          rule: 'no_field_removal',
        }
        violations.push(violation)
        breakingChanges.push(violation.message)
      } else {
        warnings.push(`Optional field '${field}' was removed`)
      }
    }

    // Check added fields
    for (const field of diff.addedFields) {
      const isRequired = newSchema.schema.required?.includes(field) ?? false
      const hasDefault = newSchema.schema.properties?.[field]?.default !== undefined

      if (isRequired && !hasDefault) {
        if (this.policy.mode === 'backward' || this.policy.mode === 'full') {
          const violation: PolicyViolation = {
            type: 'breaking_change',
            field,
            message: `New required field '${field}' without default value breaks backward compatibility`,
            rule: 'new_required_needs_default',
          }
          violations.push(violation)
          breakingChanges.push(violation.message)

          suggestedFixes.push({
            violation,
            suggestion: `Add a default value for field '${field}' or make it optional`,
            autoFixable: true,
            fix: (schema) => this.addDefaultValue(schema, field),
          })
        }
      }
    }

    // Check type changes
    for (const change of diff.changedTypes) {
      const fromType = change.from
      const toType = change.to

      if (isTypeNarrowing(fromType, toType)) {
        if (!this.policy.allowTypeNarrowing) {
          const violation: PolicyViolation = {
            type: 'breaking_change',
            field: change.field,
            message: `Field '${change.field}' type narrowed from ${fromType} to ${toType}`,
            rule: 'no_type_narrowing',
          }
          violations.push(violation)
          breakingChanges.push(violation.message)

          suggestedFixes.push({
            violation,
            suggestion: `Keep field '${change.field}' as ${fromType} or use a union type`,
            autoFixable: false,
          })
        } else {
          warnings.push(`Field '${change.field}' type narrowed from ${fromType} to ${toType}`)
        }
      } else if (canWidenType(fromType, toType)) {
        warnings.push(`Field '${change.field}' type widened from ${fromType} to ${toType}`)
      } else if (canCoerceType(fromType, toType)) {
        warnings.push(`Field '${change.field}' type changed from ${fromType} to ${toType} (coercible)`)
      } else {
        // Incompatible type change
        const violation: PolicyViolation = {
          type: 'breaking_change',
          field: change.field,
          message: `Field '${change.field}' type changed incompatibly from ${fromType} to ${toType}`,
          rule: 'incompatible_type_change',
        }
        violations.push(violation)
        breakingChanges.push(violation.message)

        if (canCoerceType(fromType, toType)) {
          suggestedFixes.push({
            violation,
            suggestion: `Add a migration to coerce ${fromType} to ${toType}`,
            autoFixable: true,
          })
        }
      }
    }

    // Check required changes
    for (const change of diff.changedRequired) {
      if (!change.wasRequired && change.isRequired) {
        // Field became required
        const hasDefault = newSchema.schema.properties?.[change.field]?.default !== undefined

        if (!hasDefault && (this.policy.mode === 'backward' || this.policy.mode === 'full')) {
          const violation: PolicyViolation = {
            type: 'breaking_change',
            field: change.field,
            message: `Field '${change.field}' became required without a default value`,
            rule: 'required_needs_default',
          }
          violations.push(violation)
          breakingChanges.push(violation.message)

          suggestedFixes.push({
            violation,
            suggestion: `Add a default value for field '${change.field}'`,
            autoFixable: true,
            fix: (schema) => this.addDefaultValue(schema, change.field),
          })
        }
      } else if (change.wasRequired && !change.isRequired) {
        // Field became optional - generally safe
        warnings.push(`Field '${change.field}' became optional`)
      }
    }

    // Determine if evolution is allowed
    const hasBreakingChanges = violations.some((v) => v.type === 'breaking_change')
    const allowed = this.policy.mode === 'none' || !hasBreakingChanges

    return {
      allowed,
      violations,
      suggestedFixes,
      breakingChanges,
      warnings,
      diff,
    }
  }

  /**
   * Migrate data from one schema version to another
   */
  migrate(data: unknown, from: DataContract, to: DataContract): unknown {
    if (typeof data !== 'object' || data === null) {
      return data
    }

    const script = this.generateMigration(from, to)
    return this.applyMigration(data as Record<string, unknown>, script)
  }

  /**
   * Generate a migration script between two schemas
   */
  generateMigration(from: DataContract, to: DataContract): MigrationScript {
    const operations: MigrationOperation[] = []
    const reverseOperations: MigrationOperation[] = []
    let isReversible = true

    const diff = this.diffSchemas(from.schema, to.schema)

    // Handle removed fields
    for (const field of diff.removedFields) {
      operations.push({
        type: 'remove',
        field,
      })

      // Reverse: add the field back (but we lose the data)
      const fieldSchema = from.schema.properties?.[field]
      reverseOperations.unshift({
        type: 'add',
        field,
        defaultValue: fieldSchema?.default ?? this.getDefaultForType(this.getSchemaType(fieldSchema)),
      })
      isReversible = false // Data loss
    }

    // Handle added fields
    for (const field of diff.addedFields) {
      const fieldSchema = to.schema.properties?.[field]
      const defaultValue = fieldSchema?.default ?? this.getDefaultForType(this.getSchemaType(fieldSchema))

      operations.push({
        type: 'add',
        field,
        defaultValue,
      })

      // Reverse: remove the field
      reverseOperations.unshift({
        type: 'remove',
        field,
      })
    }

    // Handle type changes
    for (const change of diff.changedTypes) {
      if (canCoerceType(change.from, change.to)) {
        operations.push({
          type: 'coerce',
          field: change.field,
          targetType: change.to,
          transform: (value) => this.coerceValue(value, change.from, change.to),
        })

        // Reverse coercion may not always be possible
        if (canCoerceType(change.to, change.from)) {
          reverseOperations.unshift({
            type: 'coerce',
            field: change.field,
            targetType: change.from,
            transform: (value) => this.coerceValue(value, change.to, change.from),
          })
        } else {
          isReversible = false
        }
      } else {
        // Add a transform operation
        operations.push({
          type: 'transform',
          field: change.field,
          targetType: change.to,
          transform: (value) => this.coerceValue(value, change.from, change.to),
        })
        isReversible = false
      }
    }

    return {
      fromVersion: from.version,
      toVersion: to.version,
      operations,
      isReversible,
      reverseOperations: isReversible ? reverseOperations : undefined,
    }
  }

  /**
   * Apply a migration script to data
   */
  applyMigration(data: Record<string, unknown>, migration: MigrationScript): Record<string, unknown> {
    const result = { ...data }

    for (const op of migration.operations) {
      switch (op.type) {
        case 'add':
          if (op.field && !(op.field in result)) {
            result[op.field] = op.defaultValue
          }
          break

        case 'remove':
          if (op.field) {
            delete result[op.field]
          }
          break

        case 'rename':
          if (op.fromField && op.toField && op.fromField in result) {
            result[op.toField] = result[op.fromField]
            delete result[op.fromField]
          }
          break

        case 'transform':
        case 'coerce':
          if (op.field && op.field in result && op.transform) {
            result[op.field] = op.transform(result[op.field])
          }
          break
      }
    }

    return result
  }

  /**
   * Diff two JSON schemas
   */
  private diffSchemas(
    oldSchema: JSONSchema,
    newSchema: JSONSchema
  ): SchemaDiff {
    const addedFields: string[] = []
    const removedFields: string[] = []
    const changedTypes: Array<{ field: string; from: string; to: string }> = []
    const changedRequired: Array<{ field: string; wasRequired: boolean; isRequired: boolean }> = []

    const oldProps = oldSchema.properties || {}
    const newProps = newSchema.properties || {}
    const oldRequired = new Set(oldSchema.required || [])
    const newRequired = new Set(newSchema.required || [])

    // Find added fields
    for (const field of Object.keys(newProps)) {
      if (!(field in oldProps)) {
        addedFields.push(field)
      }
    }

    // Find removed fields
    for (const field of Object.keys(oldProps)) {
      if (!(field in newProps)) {
        removedFields.push(field)
      }
    }

    // Find type changes (for fields in both)
    for (const field of Object.keys(newProps)) {
      if (field in oldProps) {
        const oldType = this.getSchemaType(oldProps[field])
        const newType = this.getSchemaType(newProps[field])

        if (oldType !== newType) {
          changedTypes.push({ field, from: oldType, to: newType })
        }
      }
    }

    // Find required changes (for fields in both)
    const allFields = new Set([...Object.keys(oldProps), ...Object.keys(newProps)])
    for (const field of allFields) {
      if (field in oldProps && field in newProps) {
        const wasRequired = oldRequired.has(field)
        const isRequired = newRequired.has(field)

        if (wasRequired !== isRequired) {
          changedRequired.push({ field, wasRequired, isRequired })
        }
      }
    }

    return { addedFields, removedFields, changedTypes, changedRequired }
  }

  /**
   * Get the type string from a JSON schema
   */
  private getSchemaType(schema?: JSONSchema): string {
    if (!schema) return 'any'
    if (Array.isArray(schema.type)) {
      return schema.type.join(' | ')
    }
    return schema.type || 'any'
  }

  /**
   * Get default value for a type
   */
  private getDefaultForType(type: string): unknown {
    switch (type) {
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
      case 'null':
        return null
      default:
        return null
    }
  }

  /**
   * Coerce a value from one type to another
   */
  private coerceValue(value: unknown, fromType: string, toType: string): unknown {
    if (value === null || value === undefined) {
      return this.getDefaultForType(toType)
    }

    switch (toType) {
      case 'string':
        return String(value)

      case 'number':
        if (typeof value === 'string') {
          const num = parseFloat(value)
          return isNaN(num) ? 0 : num
        }
        if (typeof value === 'boolean') {
          return value ? 1 : 0
        }
        return Number(value)

      case 'integer':
        if (typeof value === 'string') {
          const num = parseInt(value, 10)
          return isNaN(num) ? 0 : num
        }
        if (typeof value === 'number') {
          return Math.round(value)
        }
        if (typeof value === 'boolean') {
          return value ? 1 : 0
        }
        return 0

      case 'boolean':
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true' || value === '1'
        }
        if (typeof value === 'number') {
          return value !== 0
        }
        return Boolean(value)

      case 'array':
        return Array.isArray(value) ? value : [value]

      case 'object':
        return typeof value === 'object' ? value : { value }

      default:
        return value
    }
  }

  /**
   * Add a default value to a field in the schema
   */
  private addDefaultValue(schema: JSONSchema, field: string): JSONSchema {
    const newSchema = { ...schema }
    if (newSchema.properties && newSchema.properties[field]) {
      const fieldSchema = newSchema.properties[field]!
      const type = this.getSchemaType(fieldSchema)
      newSchema.properties = {
        ...newSchema.properties,
        [field]: {
          ...fieldSchema,
          default: this.getDefaultForType(type),
        },
      }
    }
    return newSchema
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a SchemaEvolution instance with a specific compatibility mode
 */
export function createSchemaEvolution(
  policy: EvolutionPolicy | CompatibilityMode = 'backward'
): SchemaEvolution {
  return new SchemaEvolution(policy)
}

/**
 * Quick check if a schema change is backward compatible
 */
export function isBackwardCompatible(
  oldSchema: DataContract,
  newSchema: DataContract
): boolean {
  const evolution = new SchemaEvolution('backward')
  const result = evolution.checkCompatibility(oldSchema, newSchema)
  return result.allowed
}

/**
 * Quick check if a schema change is forward compatible
 */
export function isForwardCompatible(
  oldSchema: DataContract,
  newSchema: DataContract
): boolean {
  const evolution = new SchemaEvolution('forward')
  const result = evolution.checkCompatibility(oldSchema, newSchema)
  return result.allowed
}

/**
 * Quick check if a schema change is fully compatible
 */
export function isFullyCompatible(
  oldSchema: DataContract,
  newSchema: DataContract
): boolean {
  const evolution = new SchemaEvolution('full')
  const result = evolution.checkCompatibility(oldSchema, newSchema)
  return result.allowed
}

/**
 * Detect all breaking changes between two schemas
 */
export function detectBreakingChanges(
  oldSchema: DataContract,
  newSchema: DataContract
): string[] {
  const evolution = new SchemaEvolution('full')
  const result = evolution.checkCompatibility(oldSchema, newSchema)
  return result.breakingChanges
}

/**
 * Generate migration suggestions between two schemas
 */
export function suggestMigration(
  oldSchema: DataContract,
  newSchema: DataContract
): SuggestedFix[] {
  const evolution = new SchemaEvolution('full')
  const result = evolution.checkCompatibility(oldSchema, newSchema)
  return result.suggestedFixes
}

// ============================================================================
// SCHEMA DIFF VISUALIZATION
// ============================================================================

/**
 * Format an EvolutionResult as a human-readable diff visualization
 *
 * Uses git-like prefixes:
 * + for added fields
 * - for removed fields
 * ~ for changed fields (type changes)
 */
export function formatSchemaDiff(result: EvolutionResult): string {
  const { diff, breakingChanges, warnings } = result
  const lines: string[] = []

  // Check if there are any changes
  const hasChanges =
    diff.addedFields.length > 0 ||
    diff.removedFields.length > 0 ||
    diff.changedTypes.length > 0 ||
    diff.changedRequired.length > 0

  if (!hasChanges) {
    return 'No changes detected.'
  }

  // Header
  lines.push('Schema Diff')
  lines.push('===========')
  lines.push('')

  // Added fields
  if (diff.addedFields.length > 0) {
    lines.push('Added Fields:')
    for (const field of diff.addedFields) {
      lines.push(`  + ${field}`)
    }
    lines.push('')
  }

  // Removed fields
  if (diff.removedFields.length > 0) {
    lines.push('Removed Fields:')
    for (const field of diff.removedFields) {
      lines.push(`  - ${field}`)
    }
    lines.push('')
  }

  // Type changes
  if (diff.changedTypes.length > 0) {
    lines.push('Type Changes:')
    for (const change of diff.changedTypes) {
      lines.push(`  ~ ${change.field}: ${change.from} -> ${change.to}`)
    }
    lines.push('')
  }

  // Required changes
  if (diff.changedRequired.length > 0) {
    lines.push('Required Changes:')
    for (const change of diff.changedRequired) {
      const status = change.isRequired ? 'optional -> required' : 'required -> optional'
      lines.push(`  ~ ${change.field}: ${status}`)
    }
    lines.push('')
  }

  // Summary
  lines.push('Summary:')
  lines.push(`  Added:   ${diff.addedFields.length}`)
  lines.push(`  Removed: ${diff.removedFields.length}`)
  lines.push(`  Changed: ${diff.changedTypes.length + diff.changedRequired.length}`)
  lines.push('')

  // Breaking changes
  if (breakingChanges.length > 0) {
    lines.push('Breaking Changes:')
    for (const change of breakingChanges) {
      lines.push(`  ! ${change}`)
    }
    lines.push('')
  }

  // Warnings
  if (warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of warnings) {
      lines.push(`  * ${warning}`)
    }
    lines.push('')
  }

  // Status
  if (result.allowed) {
    lines.push('Status: ALLOWED')
  } else {
    lines.push('Status: BLOCKED (breaking changes detected)')
  }

  return lines.join('\n')
}
