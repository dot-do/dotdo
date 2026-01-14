/**
 * Schema Expectations - Schema-level validation for data contracts
 *
 * Provides validation for schema structure, not just data values:
 * - Column Expectations: Required columns, column types, nullable rules
 * - Table Expectations: Primary key, foreign keys, unique constraints
 * - Relationship Expectations: Referential integrity rules
 * - SchemaValidator: Validates schemas against expectations
 */

import type { JSONSchema, JSONSchemaType } from './index'

// ============================================================================
// TYPES - Column Expectations
// ============================================================================

/**
 * Expected type for a column - can be a single type or array of allowed types
 */
export type ExpectedColumnType = JSONSchemaType | JSONSchemaType[]

/**
 * Column-level expectation definition
 */
export interface ColumnDefinition {
  /** Column name */
  name: string
  /** Whether the column must exist in the schema */
  required?: boolean
  /** Expected JSON Schema type(s) */
  expectedType?: ExpectedColumnType
  /** Whether the column should allow null values */
  nullable?: boolean
  /** Expected format constraint (e.g., 'email', 'date-time', 'uuid') */
  expectedFormat?: string
  /** Expected pattern constraint (regex pattern) */
  expectedPattern?: string
  /** Expected enum values (must match exactly) */
  expectedEnum?: (string | number | boolean | null)[]
  /** Expected minimum value for numeric types */
  expectedMinimum?: number
  /** Expected maximum value for numeric types */
  expectedMaximum?: number
}

/**
 * Column-level expectations for schema validation
 */
export interface ColumnExpectation {
  type: 'column'
  columns: ColumnDefinition[]
}

// ============================================================================
// TYPES - Table/Constraint Expectations
// ============================================================================

/**
 * Table-level constraint expectations
 */
export interface TableExpectation {
  type: 'table'
  /** Fields that must be in the schema's required array */
  requiredFields?: string[]
  /** Fields that should enforce uniqueness (via format, pattern, etc.) */
  uniqueFields?: string[]
  /** Whether additional properties should be allowed */
  additionalProperties?: boolean
  /** Minimum number of properties the schema should define */
  minProperties?: number
  /** Maximum number of properties the schema should define */
  maxProperties?: number
}

// ============================================================================
// TYPES - Relationship Expectations
// ============================================================================

/**
 * Reference endpoint in a relationship
 */
export interface RelationshipEndpoint {
  /** Schema name */
  schema: string
  /** Field name */
  field: string
}

/**
 * Relationship cardinality type
 */
export type RelationshipType = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'

/**
 * Single relationship definition
 */
export interface RelationshipDefinition {
  /** Source of the relationship (the referencing side) */
  from: RelationshipEndpoint
  /** Target of the relationship (the referenced side) */
  to: RelationshipEndpoint
  /** Cardinality of the relationship */
  type: RelationshipType
  /** Whether types must match exactly */
  requireTypeMatch?: boolean
}

/**
 * Relationship expectations for schema validation
 */
export interface RelationshipExpectation {
  type: 'relationship'
  relationships: RelationshipDefinition[]
}

// ============================================================================
// TYPES - Combined Schema Expectation
// ============================================================================

/**
 * Full schema expectation combining columns, constraints, and relationships
 */
export interface SchemaExpectation {
  /** Column-level expectations */
  columns?: ColumnExpectation
  /** Table/constraint-level expectations */
  constraints?: TableExpectation
  /** Relationship expectations (for multi-schema validation) */
  relationships?: RelationshipExpectation
}

// ============================================================================
// TYPES - Error Types
// ============================================================================

/**
 * Reason codes for column expectation errors
 */
export type ColumnErrorReason =
  | 'missing'
  | 'type_mismatch'
  | 'nullable_mismatch'
  | 'format_mismatch'
  | 'pattern_mismatch'
  | 'enum_mismatch'
  | 'constraint_mismatch'

/**
 * Error from column expectation validation
 */
export interface ColumnExpectationError {
  column: string
  reason: ColumnErrorReason
  message: string
  expected?: string | string[] | number | boolean | (string | number | boolean | null)[]
  actual?: string | string[] | number | boolean | (string | number | boolean | null)[] | undefined
}

/**
 * Reason codes for constraint expectation errors
 */
export type ConstraintErrorReason =
  | 'not_required'
  | 'field_not_found'
  | 'additional_properties_mismatch'
  | 'insufficient_properties'
  | 'excess_properties'

/**
 * Error from constraint expectation validation
 */
export interface ConstraintExpectationError {
  field?: string
  reason: ConstraintErrorReason
  message: string
  expected?: unknown
  actual?: unknown
}

/**
 * Reason codes for relationship expectation errors
 */
export type RelationshipErrorReason =
  | 'schema_not_found'
  | 'source_field_not_found'
  | 'target_field_not_found'
  | 'type_incompatible'

/**
 * Error from relationship expectation validation
 */
export interface RelationshipExpectationError {
  schema?: string
  field?: string
  reason: RelationshipErrorReason
  message: string
  expected?: string
  actual?: string
}

// ============================================================================
// TYPES - Validation Results
// ============================================================================

/**
 * Result of column validation
 */
export interface ColumnValidationResult {
  valid: boolean
  errors: ColumnExpectationError[]
}

/**
 * Result of constraint validation
 */
export interface ConstraintValidationResult {
  valid: boolean
  errors: ConstraintExpectationError[]
}

/**
 * Result of relationship validation
 */
export interface RelationshipValidationResult {
  valid: boolean
  errors: RelationshipExpectationError[]
}

/**
 * Full schema expectation validation result
 */
export interface SchemaExpectationResult {
  valid: boolean
  columnErrors: ColumnExpectationError[]
  constraintErrors: ConstraintExpectationError[]
  relationshipErrors: RelationshipExpectationError[]
}

// ============================================================================
// SCHEMA VALIDATOR INTERFACE
// ============================================================================

/**
 * Schema validator interface
 */
export interface SchemaValidator {
  /** Validate column expectations */
  validateColumns(schema: JSONSchema, expectation: ColumnExpectation): ColumnValidationResult

  /** Validate constraint expectations */
  validateConstraints(schema: JSONSchema, expectation: TableExpectation): ConstraintValidationResult

  /** Validate relationship expectations across multiple schemas */
  validateRelationships(
    schemas: Record<string, JSONSchema>,
    expectation: RelationshipExpectation
  ): RelationshipValidationResult

  /** Validate full schema expectation */
  validate(schema: JSONSchema, expectation: SchemaExpectation): SchemaExpectationResult

  /** Validate full schema expectation including relationships */
  validateWithRelationships(
    schema: JSONSchema,
    schemas: Record<string, JSONSchema>,
    expectation: SchemaExpectation
  ): SchemaExpectationResult
}

// ============================================================================
// SCHEMA VALIDATOR IMPLEMENTATION
// ============================================================================

/**
 * Default implementation of SchemaValidator
 */
class SchemaValidatorImpl implements SchemaValidator {
  // ==========================================================================
  // COLUMN VALIDATION
  // ==========================================================================

  validateColumns(schema: JSONSchema, expectation: ColumnExpectation): ColumnValidationResult {
    const errors: ColumnExpectationError[] = []
    const properties = schema.properties || {}
    const schemaRequired = new Set(schema.required || [])

    for (const columnDef of expectation.columns) {
      const propSchema = properties[columnDef.name]

      // Check if column exists
      if (!propSchema) {
        if (columnDef.required) {
          errors.push({
            column: columnDef.name,
            reason: 'missing',
            message: `Required column '${columnDef.name}' is missing from schema`,
          })
        }
        continue // Skip other validations if column doesn't exist
      }

      // Check type
      if (columnDef.expectedType !== undefined) {
        const typeError = this.validateColumnType(columnDef.name, propSchema, columnDef.expectedType)
        if (typeError) {
          errors.push(typeError)
        }
      }

      // Check nullable
      if (columnDef.nullable !== undefined) {
        const nullableError = this.validateNullable(columnDef.name, propSchema, columnDef.nullable)
        if (nullableError) {
          errors.push(nullableError)
        }
      }

      // Check format
      if (columnDef.expectedFormat !== undefined) {
        const formatError = this.validateFormat(columnDef.name, propSchema, columnDef.expectedFormat)
        if (formatError) {
          errors.push(formatError)
        }
      }

      // Check pattern
      if (columnDef.expectedPattern !== undefined) {
        const patternError = this.validatePattern(columnDef.name, propSchema, columnDef.expectedPattern)
        if (patternError) {
          errors.push(patternError)
        }
      }

      // Check enum
      if (columnDef.expectedEnum !== undefined) {
        const enumError = this.validateEnum(columnDef.name, propSchema, columnDef.expectedEnum)
        if (enumError) {
          errors.push(enumError)
        }
      }

      // Check minimum
      if (columnDef.expectedMinimum !== undefined) {
        const minError = this.validateMinimum(columnDef.name, propSchema, columnDef.expectedMinimum)
        if (minError) {
          errors.push(minError)
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  private validateColumnType(
    columnName: string,
    propSchema: JSONSchema,
    expectedType: ExpectedColumnType
  ): ColumnExpectationError | null {
    const actualType = this.getSchemaType(propSchema)
    const expectedTypes = Array.isArray(expectedType) ? expectedType : [expectedType]
    const actualTypes = Array.isArray(actualType) ? actualType : [actualType]

    // Check if types match (order-independent comparison for arrays)
    const typesMatch = this.arraysEqual(
      expectedTypes.slice().sort(),
      actualTypes.slice().sort()
    )

    if (!typesMatch) {
      return {
        column: columnName,
        reason: 'type_mismatch',
        message: `Column '${columnName}' has type '${actualTypes.join(' | ')}' but expected '${expectedTypes.join(' | ')}'`,
        expected: expectedTypes.length === 1 ? expectedTypes[0] : expectedTypes,
        actual: actualTypes.length === 1 ? actualTypes[0] : actualTypes,
      }
    }

    return null
  }

  private validateNullable(
    columnName: string,
    propSchema: JSONSchema,
    expectedNullable: boolean
  ): ColumnExpectationError | null {
    const actualType = propSchema.type
    const allowsNull = Array.isArray(actualType) && actualType.includes('null')

    if (expectedNullable && !allowsNull) {
      return {
        column: columnName,
        reason: 'nullable_mismatch',
        message: `Column '${columnName}' should allow null values but does not`,
        expected: true,
        actual: false,
      }
    }

    if (!expectedNullable && allowsNull) {
      return {
        column: columnName,
        reason: 'nullable_mismatch',
        message: `Column '${columnName}' should not allow null values but does`,
        expected: false,
        actual: true,
      }
    }

    return null
  }

  private validateFormat(
    columnName: string,
    propSchema: JSONSchema,
    expectedFormat: string
  ): ColumnExpectationError | null {
    const actualFormat = propSchema.format

    if (actualFormat !== expectedFormat) {
      return {
        column: columnName,
        reason: 'format_mismatch',
        message: `Column '${columnName}' has format '${actualFormat || 'none'}' but expected '${expectedFormat}'`,
        expected: expectedFormat,
        actual: actualFormat,
      }
    }

    return null
  }

  private validatePattern(
    columnName: string,
    propSchema: JSONSchema,
    expectedPattern: string
  ): ColumnExpectationError | null {
    const actualPattern = propSchema.pattern

    if (actualPattern !== expectedPattern) {
      return {
        column: columnName,
        reason: 'pattern_mismatch',
        message: `Column '${columnName}' has pattern '${actualPattern || 'none'}' but expected '${expectedPattern}'`,
        expected: expectedPattern,
        actual: actualPattern,
      }
    }

    return null
  }

  private validateEnum(
    columnName: string,
    propSchema: JSONSchema,
    expectedEnum: (string | number | boolean | null)[]
  ): ColumnExpectationError | null {
    const actualEnum = propSchema.enum

    if (!actualEnum) {
      return {
        column: columnName,
        reason: 'enum_mismatch',
        message: `Column '${columnName}' has no enum constraint but expected [${expectedEnum.join(', ')}]`,
        expected: expectedEnum,
        actual: undefined,
      }
    }

    // Check if enums match exactly (order-independent)
    const expectedSet = new Set(expectedEnum.map(String))
    const actualSet = new Set(actualEnum.map(String))

    if (expectedSet.size !== actualSet.size) {
      return {
        column: columnName,
        reason: 'enum_mismatch',
        message: `Column '${columnName}' enum values do not match. Expected [${expectedEnum.join(', ')}] but got [${actualEnum.join(', ')}]`,
        expected: expectedEnum,
        actual: actualEnum,
      }
    }

    for (const val of expectedSet) {
      if (!actualSet.has(val)) {
        return {
          column: columnName,
          reason: 'enum_mismatch',
          message: `Column '${columnName}' enum values do not match. Expected [${expectedEnum.join(', ')}] but got [${actualEnum.join(', ')}]`,
          expected: expectedEnum,
          actual: actualEnum,
        }
      }
    }

    return null
  }

  private validateMinimum(
    columnName: string,
    propSchema: JSONSchema,
    expectedMinimum: number
  ): ColumnExpectationError | null {
    const actualMinimum = propSchema.minimum

    if (actualMinimum !== expectedMinimum) {
      return {
        column: columnName,
        reason: 'constraint_mismatch',
        message: `Column '${columnName}' has minimum ${actualMinimum ?? 'none'} but expected ${expectedMinimum}`,
        expected: expectedMinimum,
        actual: actualMinimum,
      }
    }

    return null
  }

  // ==========================================================================
  // CONSTRAINT VALIDATION
  // ==========================================================================

  validateConstraints(schema: JSONSchema, expectation: TableExpectation): ConstraintValidationResult {
    const errors: ConstraintExpectationError[] = []
    const properties = schema.properties || {}
    const schemaRequired = new Set(schema.required || [])

    // Check required fields
    if (expectation.requiredFields) {
      for (const field of expectation.requiredFields) {
        if (!schemaRequired.has(field)) {
          errors.push({
            field,
            reason: 'not_required',
            message: `Field '${field}' should be in the required array but is not`,
          })
        }
      }
    }

    // Check unique fields exist
    if (expectation.uniqueFields) {
      for (const field of expectation.uniqueFields) {
        if (!(field in properties)) {
          errors.push({
            field,
            reason: 'field_not_found',
            message: `Unique field '${field}' does not exist in schema`,
          })
        }
      }
    }

    // Check additionalProperties
    if (expectation.additionalProperties !== undefined) {
      const schemaAdditionalProps = schema.additionalProperties ?? true // default is true
      const actualAdditionalProps = schemaAdditionalProps === false ? false : true

      if (actualAdditionalProps !== expectation.additionalProperties) {
        errors.push({
          reason: 'additional_properties_mismatch',
          message: `Schema ${actualAdditionalProps ? 'allows' : 'disallows'} additional properties but expected ${expectation.additionalProperties ? 'allowed' : 'disallowed'}`,
          expected: expectation.additionalProperties,
          actual: actualAdditionalProps,
        })
      }
    }

    // Check minimum properties
    if (expectation.minProperties !== undefined) {
      const propCount = Object.keys(properties).length
      if (propCount < expectation.minProperties) {
        errors.push({
          reason: 'insufficient_properties',
          message: `Schema has ${propCount} properties but expected at least ${expectation.minProperties}`,
          expected: expectation.minProperties,
          actual: propCount,
        })
      }
    }

    // Check maximum properties
    if (expectation.maxProperties !== undefined) {
      const propCount = Object.keys(properties).length
      if (propCount > expectation.maxProperties) {
        errors.push({
          reason: 'excess_properties',
          message: `Schema has ${propCount} properties but expected at most ${expectation.maxProperties}`,
          expected: expectation.maxProperties,
          actual: propCount,
        })
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  // ==========================================================================
  // RELATIONSHIP VALIDATION
  // ==========================================================================

  validateRelationships(
    schemas: Record<string, JSONSchema>,
    expectation: RelationshipExpectation
  ): RelationshipValidationResult {
    const errors: RelationshipExpectationError[] = []

    for (const rel of expectation.relationships) {
      // Check source schema exists
      const sourceSchema = schemas[rel.from.schema]
      if (!sourceSchema) {
        errors.push({
          schema: rel.from.schema,
          reason: 'schema_not_found',
          message: `Source schema '${rel.from.schema}' not found`,
        })
        continue
      }

      // Check target schema exists
      const targetSchema = schemas[rel.to.schema]
      if (!targetSchema) {
        errors.push({
          schema: rel.to.schema,
          reason: 'schema_not_found',
          message: `Target schema '${rel.to.schema}' not found`,
        })
        continue
      }

      // Check source field exists
      const sourceProps = sourceSchema.properties || {}
      if (!(rel.from.field in sourceProps)) {
        errors.push({
          schema: rel.from.schema,
          field: rel.from.field,
          reason: 'source_field_not_found',
          message: `Source field '${rel.from.field}' not found in schema '${rel.from.schema}'`,
        })
        continue
      }

      // Check target field exists
      const targetProps = targetSchema.properties || {}
      if (!(rel.to.field in targetProps)) {
        errors.push({
          schema: rel.to.schema,
          field: rel.to.field,
          reason: 'target_field_not_found',
          message: `Target field '${rel.to.field}' not found in schema '${rel.to.schema}'`,
        })
        continue
      }

      // Check type compatibility if required
      if (rel.requireTypeMatch) {
        const sourceType = this.getSchemaType(sourceProps[rel.from.field]!)
        const targetType = this.getSchemaType(targetProps[rel.to.field]!)

        const sourceTypes = Array.isArray(sourceType) ? sourceType : [sourceType]
        const targetTypes = Array.isArray(targetType) ? targetType : [targetType]

        // Types are compatible if they share at least one common type
        const hasCommonType = sourceTypes.some((st) => targetTypes.includes(st))

        if (!hasCommonType) {
          errors.push({
            field: rel.from.field,
            reason: 'type_incompatible',
            message: `Field '${rel.from.field}' (type: ${sourceTypes.join('|')}) is not compatible with '${rel.to.field}' (type: ${targetTypes.join('|')})`,
            expected: targetTypes.join('|'),
            actual: sourceTypes.join('|'),
          })
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  // ==========================================================================
  // FULL VALIDATION
  // ==========================================================================

  validate(schema: JSONSchema, expectation: SchemaExpectation): SchemaExpectationResult {
    const columnErrors: ColumnExpectationError[] = []
    const constraintErrors: ConstraintExpectationError[] = []
    const relationshipErrors: RelationshipExpectationError[] = []

    // Validate columns
    if (expectation.columns) {
      const columnResult = this.validateColumns(schema, expectation.columns)
      columnErrors.push(...columnResult.errors)
    }

    // Validate constraints
    if (expectation.constraints) {
      const constraintResult = this.validateConstraints(schema, expectation.constraints)
      constraintErrors.push(...constraintResult.errors)
    }

    const valid = columnErrors.length === 0 && constraintErrors.length === 0 && relationshipErrors.length === 0

    return {
      valid,
      columnErrors,
      constraintErrors,
      relationshipErrors,
    }
  }

  validateWithRelationships(
    schema: JSONSchema,
    schemas: Record<string, JSONSchema>,
    expectation: SchemaExpectation
  ): SchemaExpectationResult {
    // Start with base validation
    const baseResult = this.validate(schema, expectation)

    // Add relationship validation if provided
    if (expectation.relationships) {
      const relationshipResult = this.validateRelationships(schemas, expectation.relationships)
      baseResult.relationshipErrors.push(...relationshipResult.errors)
    }

    // Recalculate validity
    baseResult.valid =
      baseResult.columnErrors.length === 0 &&
      baseResult.constraintErrors.length === 0 &&
      baseResult.relationshipErrors.length === 0

    return baseResult
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  private getSchemaType(schema: JSONSchema): JSONSchemaType | JSONSchemaType[] {
    if (Array.isArray(schema.type)) {
      return schema.type
    }
    return schema.type || 'object'
  }

  private arraysEqual(a: unknown[], b: unknown[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new schema validator instance
 */
export function createSchemaValidator(): SchemaValidator {
  return new SchemaValidatorImpl()
}
