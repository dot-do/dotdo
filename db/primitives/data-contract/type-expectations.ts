/**
 * Type Expectations - Fluent schema type and nullability validation
 *
 * Provides a fluent API for validating JSON Schema types:
 * - Type assertions (string, number, boolean, date, array, object)
 * - Nullability constraints (required, nullable)
 * - Array type validation (item types, min/max items)
 * - Object type validation (properties, required properties)
 * - Schema evolution compatibility checking
 */

import type { JSONSchema, JSONSchemaType } from './index'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Type expectation error reason codes
 */
export type TypeErrorReason =
  | 'column_not_found'
  | 'type_mismatch'
  | 'format_mismatch'
  | 'nullable_violation'
  | 'array_items_mismatch'
  | 'constraint_mismatch'
  | 'property_not_found'
  | 'property_not_required'
  | 'schema_mismatch'
  | 'incompatible_type_change'
  | 'nullable_removed'

/**
 * Type validation error
 */
export interface TypeValidationError {
  column: string
  reason: TypeErrorReason
  message: string
  expected?: string | string[] | number
  actual?: string | string[] | number | undefined
}

/**
 * Type validation result
 */
export interface TypeValidationResult {
  valid: boolean
  errors: TypeValidationError[]
}

/**
 * Schema evolution compatibility mode
 */
export type CompatibilityMode = 'backward' | 'forward' | 'full'

/**
 * Type expectation specification
 */
export interface TypeExpectation {
  columnName: string
  expectedType?: JSONSchemaType | JSONSchemaType[]
  expectedFormat?: string | string[]
  nullable?: boolean
  required?: boolean
  arrayItemType?: JSONSchemaType | 'object'
  minItems?: number
  maxItems?: number
  properties?: string[]
  requiredProperty?: string
  hasProperty?: string
  schemaMatch?: JSONSchema
}

// ============================================================================
// TYPE EXPECTATION BUILDER
// ============================================================================

/**
 * Fluent builder for type expectations
 */
export class TypeExpectationBuilder {
  private _columnName: string
  private _expectations: TypeExpectation[] = []
  private _currentExpectation: Partial<TypeExpectation> = {}

  constructor(columnName: string) {
    this._columnName = columnName
    this._currentExpectation = { columnName }
  }

  /**
   * Get the column name
   */
  getColumnName(): string {
    return this._columnName
  }

  /**
   * Get all expectations
   */
  getExpectations(): TypeExpectation[] {
    return [...this._expectations, this._currentExpectation as TypeExpectation]
  }

  // ==========================================================================
  // TYPE ASSERTIONS
  // ==========================================================================

  /**
   * Expect the column to be string type
   */
  toBeString(): TypeExpectationBuilder {
    this._currentExpectation.expectedType = 'string'
    return this
  }

  /**
   * Expect the column to be number type (includes integer)
   */
  toBeNumber(): TypeExpectationBuilder {
    this._currentExpectation.expectedType = ['number', 'integer']
    return this
  }

  /**
   * Expect the column to be integer type
   */
  toBeInteger(): TypeExpectationBuilder {
    this._currentExpectation.expectedType = 'integer'
    return this
  }

  /**
   * Expect the column to be boolean type
   */
  toBeBoolean(): TypeExpectationBuilder {
    this._currentExpectation.expectedType = 'boolean'
    return this
  }

  /**
   * Expect the column to be date format (string with date or date-time format)
   */
  toBeDate(): TypeExpectationBuilder {
    this._currentExpectation.expectedType = 'string'
    this._currentExpectation.expectedFormat = ['date', 'date-time']
    return this
  }

  /**
   * Expect the column to be array type
   */
  toBeArray(): TypeExpectationBuilder {
    this._currentExpectation.expectedType = 'array'
    return this
  }

  /**
   * Expect the column to be object type
   */
  toBeObject(): TypeExpectationBuilder {
    this._currentExpectation.expectedType = 'object'
    return this
  }

  // ==========================================================================
  // NULLABILITY CONSTRAINTS
  // ==========================================================================

  /**
   * Expect the column to not allow null values
   */
  toBeRequired(): TypeExpectationBuilder {
    this._currentExpectation.required = true
    return this
  }

  /**
   * Alias for toBeRequired()
   */
  toBeNotNull(): TypeExpectationBuilder {
    return this.toBeRequired()
  }

  /**
   * Expect the column to allow null values
   */
  toBeNullable(): TypeExpectationBuilder {
    this._currentExpectation.nullable = true
    return this
  }

  // ==========================================================================
  // ARRAY TYPE VALIDATION
  // ==========================================================================

  /**
   * Expect the array to contain items of the specified type
   */
  toBeArrayOf(itemType: JSONSchemaType | 'object'): TypeExpectationBuilder {
    this._currentExpectation.expectedType = 'array'
    this._currentExpectation.arrayItemType = itemType
    return this
  }

  /**
   * Expect the array to have a minimum number of items
   */
  toHaveMinItems(min: number): TypeExpectationBuilder {
    this._currentExpectation.minItems = min
    return this
  }

  /**
   * Expect the array to have a maximum number of items
   */
  toHaveMaxItems(max: number): TypeExpectationBuilder {
    this._currentExpectation.maxItems = max
    return this
  }

  // ==========================================================================
  // OBJECT TYPE VALIDATION
  // ==========================================================================

  /**
   * Expect the object to have a specific property
   */
  toHaveProperty(propertyName: string): TypeExpectationBuilder {
    this._currentExpectation.expectedType = 'object'
    this._currentExpectation.hasProperty = propertyName
    return this
  }

  /**
   * Expect the object to have all specified properties
   */
  toHaveProperties(propertyNames: string[]): TypeExpectationBuilder {
    this._currentExpectation.expectedType = 'object'
    this._currentExpectation.properties = propertyNames
    return this
  }

  /**
   * Expect the object to have a required property
   */
  toHaveRequiredProperty(propertyName: string): TypeExpectationBuilder {
    this._currentExpectation.expectedType = 'object'
    this._currentExpectation.requiredProperty = propertyName
    return this
  }

  // ==========================================================================
  // SCHEMA VALIDATION
  // ==========================================================================

  /**
   * Expect the column to match a specific JSON Schema
   */
  toHaveType(schema: JSONSchema): TypeExpectationBuilder {
    this._currentExpectation.schemaMatch = schema
    return this
  }

  /**
   * Build the final expectation
   */
  build(): TypeExpectation {
    return { ...this._currentExpectation, columnName: this._columnName } as TypeExpectation
  }
}

// ============================================================================
// SCHEMA BUILDER
// ============================================================================

/**
 * Multi-column schema expectation builder
 */
export class SchemaExpectationBuilder {
  private _expectations: TypeExpectationBuilder[] = []
  private _current?: TypeExpectationBuilder

  /**
   * Start a new column expectation
   */
  column(name: string): SchemaExpectationBuilder {
    if (this._current) {
      this._expectations.push(this._current)
    }
    this._current = new TypeExpectationBuilder(name)
    return this
  }

  /**
   * Expect the column to be string type
   */
  toBeString(): SchemaExpectationBuilder {
    this._current?.toBeString()
    return this
  }

  /**
   * Expect the column to be number type
   */
  toBeNumber(): SchemaExpectationBuilder {
    this._current?.toBeNumber()
    return this
  }

  /**
   * Expect the column to be boolean type
   */
  toBeBoolean(): SchemaExpectationBuilder {
    this._current?.toBeBoolean()
    return this
  }

  /**
   * Expect the column to be array type
   */
  toBeArray(): SchemaExpectationBuilder {
    this._current?.toBeArray()
    return this
  }

  /**
   * Expect the column to be object type
   */
  toBeObject(): SchemaExpectationBuilder {
    this._current?.toBeObject()
    return this
  }

  /**
   * Build all expectations
   */
  build(): TypeExpectation[] {
    if (this._current) {
      this._expectations.push(this._current)
    }
    return this._expectations.map((b) => b.build())
  }
}

// ============================================================================
// SCHEMA TYPE VALIDATOR
// ============================================================================

/**
 * Schema type validator
 */
export class SchemaTypeValidator {
  /**
   * Validate a single column expectation
   */
  validate(jsonSchema: JSONSchema, expectation: TypeExpectationBuilder): TypeValidationResult {
    const exp = expectation.build()
    const errors: TypeValidationError[] = []
    const columnName = exp.columnName

    // Get the column schema
    const columnSchema = jsonSchema.properties?.[columnName]

    if (!columnSchema) {
      errors.push({
        column: columnName,
        reason: 'column_not_found',
        message: `Column '${columnName}' not found in schema`,
      })
      return { valid: false, errors }
    }

    // Validate type
    if (exp.expectedType !== undefined) {
      const typeError = this.validateType(columnName, columnSchema, exp.expectedType)
      if (typeError) {
        errors.push(typeError)
      }
    }

    // Validate format (for date types)
    if (exp.expectedFormat !== undefined) {
      const formatError = this.validateFormat(columnName, columnSchema, exp.expectedFormat)
      if (formatError) {
        errors.push(formatError)
      }
    }

    // Validate required (not nullable)
    if (exp.required === true) {
      const requiredError = this.validateRequired(columnName, columnSchema)
      if (requiredError) {
        errors.push(requiredError)
      }
    }

    // Validate nullable
    if (exp.nullable === true) {
      const nullableError = this.validateNullable(columnName, columnSchema)
      if (nullableError) {
        errors.push(nullableError)
      }
    }

    // Validate array item type
    if (exp.arrayItemType !== undefined) {
      const arrayError = this.validateArrayItemType(columnName, columnSchema, exp.arrayItemType)
      if (arrayError) {
        errors.push(arrayError)
      }
    }

    // Validate min items
    if (exp.minItems !== undefined) {
      const minError = this.validateMinItems(columnName, columnSchema, exp.minItems)
      if (minError) {
        errors.push(minError)
      }
    }

    // Validate max items
    if (exp.maxItems !== undefined) {
      const maxError = this.validateMaxItems(columnName, columnSchema, exp.maxItems)
      if (maxError) {
        errors.push(maxError)
      }
    }

    // Validate has property
    if (exp.hasProperty !== undefined) {
      const propError = this.validateHasProperty(columnName, columnSchema, exp.hasProperty)
      if (propError) {
        errors.push(propError)
      }
    }

    // Validate properties
    if (exp.properties !== undefined) {
      for (const prop of exp.properties) {
        const propError = this.validateHasProperty(columnName, columnSchema, prop)
        if (propError) {
          errors.push(propError)
          break
        }
      }
    }

    // Validate required property
    if (exp.requiredProperty !== undefined) {
      const reqPropError = this.validateRequiredProperty(columnName, columnSchema, exp.requiredProperty)
      if (reqPropError) {
        errors.push(reqPropError)
      }
    }

    // Validate schema match
    if (exp.schemaMatch !== undefined) {
      const schemaError = this.validateSchemaMatch(columnName, columnSchema, exp.schemaMatch)
      if (schemaError) {
        errors.push(schemaError)
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Validate multiple column expectations
   */
  validateSchema(jsonSchema: JSONSchema, expectations: TypeExpectation[]): TypeValidationResult {
    const errors: TypeValidationError[] = []

    for (const exp of expectations) {
      const builder = new TypeExpectationBuilder(exp.columnName)

      // Apply expectations
      if (exp.expectedType) {
        const types = Array.isArray(exp.expectedType) ? exp.expectedType : [exp.expectedType]
        if (types.includes('string')) builder.toBeString()
        else if (types.includes('number') || types.includes('integer')) builder.toBeNumber()
        else if (types.includes('boolean')) builder.toBeBoolean()
        else if (types.includes('array')) builder.toBeArray()
        else if (types.includes('object')) builder.toBeObject()
      }

      const result = this.validate(jsonSchema, builder)
      errors.push(...result.errors)
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Check evolution compatibility between two schemas
   */
  checkEvolutionCompatibility(
    oldSchema: JSONSchema,
    newSchema: JSONSchema,
    columnName: string,
    mode: CompatibilityMode
  ): TypeValidationResult {
    const errors: TypeValidationError[] = []

    const oldColumnSchema = oldSchema.properties?.[columnName]
    const newColumnSchema = newSchema.properties?.[columnName]

    if (!oldColumnSchema || !newColumnSchema) {
      errors.push({
        column: columnName,
        reason: 'column_not_found',
        message: `Column '${columnName}' not found in one of the schemas`,
      })
      return { valid: false, errors }
    }

    const oldType = this.getSchemaType(oldColumnSchema)
    const newType = this.getSchemaType(newColumnSchema)
    const oldNullable = this.isNullable(oldColumnSchema)
    const newNullable = this.isNullable(newColumnSchema)

    // Full compatibility: no type changes allowed
    if (mode === 'full') {
      if (oldType !== newType) {
        errors.push({
          column: columnName,
          reason: 'incompatible_type_change',
          message: `Column '${columnName}' type changed from '${oldType}' to '${newType}' - full compatibility requires no changes`,
          expected: oldType,
          actual: newType,
        })
      }
      if (oldNullable !== newNullable) {
        errors.push({
          column: columnName,
          reason: 'nullable_removed',
          message: `Column '${columnName}' nullability changed - full compatibility requires no changes`,
        })
      }
    }

    // Backward compatibility: old consumers can read new data
    if (mode === 'backward') {
      // Type narrowing breaks backward compat (number -> integer)
      if (this.isTypeNarrowing(oldType, newType)) {
        errors.push({
          column: columnName,
          reason: 'incompatible_type_change',
          message: `Column '${columnName}' type narrowed from '${oldType}' to '${newType}' - breaks backward compatibility`,
          expected: oldType,
          actual: newType,
        })
      }
      // Removing nullable breaks backward compat
      if (oldNullable && !newNullable) {
        errors.push({
          column: columnName,
          reason: 'nullable_removed',
          message: `Column '${columnName}' nullable removed - breaks backward compatibility`,
        })
      }
    }

    // Forward compatibility: new consumers can read old data
    if (mode === 'forward') {
      // Type widening breaks forward compat (integer -> number)
      if (this.isTypeWidening(oldType, newType)) {
        errors.push({
          column: columnName,
          reason: 'incompatible_type_change',
          message: `Column '${columnName}' type widened from '${oldType}' to '${newType}' - breaks forward compatibility`,
          expected: oldType,
          actual: newType,
        })
      }
    }

    return { valid: errors.length === 0, errors }
  }

  // ==========================================================================
  // PRIVATE VALIDATION METHODS
  // ==========================================================================

  private validateType(
    columnName: string,
    columnSchema: JSONSchema,
    expectedType: JSONSchemaType | JSONSchemaType[]
  ): TypeValidationError | null {
    const actualType = this.getSchemaType(columnSchema)
    const expectedTypes = Array.isArray(expectedType) ? expectedType : [expectedType]

    // Special case: integer is compatible with number expectation
    if (expectedTypes.includes('number') && (actualType === 'integer' || actualType === 'number')) {
      return null
    }

    if (!expectedTypes.includes(actualType as JSONSchemaType)) {
      return {
        column: columnName,
        reason: 'type_mismatch',
        message: `Column '${columnName}' expected type '${expectedTypes.join(' | ')}' but got '${actualType}'`,
        expected: expectedTypes.length === 1 ? expectedTypes[0] : expectedTypes.join(' | '),
        actual: actualType,
      }
    }

    return null
  }

  private validateFormat(
    columnName: string,
    columnSchema: JSONSchema,
    expectedFormat: string | string[]
  ): TypeValidationError | null {
    const actualFormat = columnSchema.format
    const expectedFormats = Array.isArray(expectedFormat) ? expectedFormat : [expectedFormat]

    if (!actualFormat || !expectedFormats.includes(actualFormat)) {
      return {
        column: columnName,
        reason: 'format_mismatch',
        message: `Column '${columnName}' expected format '${expectedFormats.join(' | ')}' but got '${actualFormat || 'none'}' - date format required`,
        expected: expectedFormats.join(' | '),
        actual: actualFormat,
      }
    }

    return null
  }

  private validateRequired(
    columnName: string,
    columnSchema: JSONSchema
  ): TypeValidationError | null {
    if (this.isNullable(columnSchema)) {
      return {
        column: columnName,
        reason: 'nullable_violation',
        message: `Column '${columnName}' should not be nullable but allows null values`,
      }
    }
    return null
  }

  private validateNullable(
    columnName: string,
    columnSchema: JSONSchema
  ): TypeValidationError | null {
    if (!this.isNullable(columnSchema)) {
      return {
        column: columnName,
        reason: 'nullable_violation',
        message: `Column '${columnName}' should be nullable but does not allow null values`,
      }
    }
    return null
  }

  private validateArrayItemType(
    columnName: string,
    columnSchema: JSONSchema,
    expectedItemType: JSONSchemaType | 'object'
  ): TypeValidationError | null {
    const actualType = this.getSchemaType(columnSchema)

    if (actualType !== 'array') {
      return {
        column: columnName,
        reason: 'type_mismatch',
        message: `Column '${columnName}' expected type 'array' but got '${actualType}'`,
        expected: 'array',
        actual: actualType,
      }
    }

    const itemsSchema = columnSchema.items
    if (!itemsSchema) {
      return {
        column: columnName,
        reason: 'array_items_mismatch',
        message: `Column '${columnName}' array has no items schema defined`,
        expected: expectedItemType,
        actual: undefined,
      }
    }

    const actualItemType = this.getSchemaType(itemsSchema)
    if (actualItemType !== expectedItemType) {
      return {
        column: columnName,
        reason: 'array_items_mismatch',
        message: `Column '${columnName}' array items expected type '${expectedItemType}' but got '${actualItemType}'`,
        expected: expectedItemType,
        actual: actualItemType,
      }
    }

    return null
  }

  private validateMinItems(
    columnName: string,
    columnSchema: JSONSchema,
    expectedMin: number
  ): TypeValidationError | null {
    const actualMin = columnSchema.minItems

    if (actualMin === undefined || actualMin < expectedMin) {
      return {
        column: columnName,
        reason: 'constraint_mismatch',
        message: `Column '${columnName}' expected minItems >= ${expectedMin} but got ${actualMin ?? 'undefined'}`,
        expected: expectedMin,
        actual: actualMin,
      }
    }

    return null
  }

  private validateMaxItems(
    columnName: string,
    columnSchema: JSONSchema,
    expectedMax: number
  ): TypeValidationError | null {
    const actualMax = columnSchema.maxItems

    if (actualMax === undefined || actualMax > expectedMax) {
      return {
        column: columnName,
        reason: 'constraint_mismatch',
        message: `Column '${columnName}' expected maxItems <= ${expectedMax} but got ${actualMax ?? 'undefined'}`,
        expected: expectedMax,
        actual: actualMax,
      }
    }

    return null
  }

  private validateHasProperty(
    columnName: string,
    columnSchema: JSONSchema,
    propertyName: string
  ): TypeValidationError | null {
    const actualType = this.getSchemaType(columnSchema)

    if (actualType !== 'object') {
      return {
        column: columnName,
        reason: 'type_mismatch',
        message: `Column '${columnName}' expected type 'object' but got '${actualType}'`,
        expected: 'object',
        actual: actualType,
      }
    }

    const properties = columnSchema.properties || {}
    if (!(propertyName in properties)) {
      return {
        column: columnName,
        reason: 'property_not_found',
        message: `Column '${columnName}' object does not have property '${propertyName}'`,
      }
    }

    return null
  }

  private validateRequiredProperty(
    columnName: string,
    columnSchema: JSONSchema,
    propertyName: string
  ): TypeValidationError | null {
    const actualType = this.getSchemaType(columnSchema)

    if (actualType !== 'object') {
      return {
        column: columnName,
        reason: 'type_mismatch',
        message: `Column '${columnName}' expected type 'object' but got '${actualType}'`,
        expected: 'object',
        actual: actualType,
      }
    }

    const required = columnSchema.required || []
    if (!required.includes(propertyName)) {
      return {
        column: columnName,
        reason: 'property_not_required',
        message: `Column '${columnName}' property '${propertyName}' is not in required array`,
      }
    }

    return null
  }

  private validateSchemaMatch(
    columnName: string,
    columnSchema: JSONSchema,
    expectedSchema: JSONSchema
  ): TypeValidationError | null {
    // Compare type
    const actualType = this.getSchemaType(columnSchema)
    const expectedType = this.getSchemaType(expectedSchema)

    if (actualType !== expectedType) {
      return {
        column: columnName,
        reason: 'schema_mismatch',
        message: `Column '${columnName}' schema type '${actualType}' does not match expected '${expectedType}'`,
        expected: expectedType,
        actual: actualType,
      }
    }

    // Compare format
    if (expectedSchema.format && columnSchema.format !== expectedSchema.format) {
      return {
        column: columnName,
        reason: 'schema_mismatch',
        message: `Column '${columnName}' schema format '${columnSchema.format}' does not match expected '${expectedSchema.format}'`,
        expected: expectedSchema.format,
        actual: columnSchema.format,
      }
    }

    return null
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  private getSchemaType(schema: JSONSchema): string {
    if (Array.isArray(schema.type)) {
      // Return non-null type
      return schema.type.find((t) => t !== 'null') || schema.type[0] || 'unknown'
    }
    return schema.type || 'unknown'
  }

  private isNullable(schema: JSONSchema): boolean {
    if (Array.isArray(schema.type)) {
      return schema.type.includes('null')
    }
    return false
  }

  private isTypeNarrowing(oldType: string, newType: string): boolean {
    // number -> integer is narrowing
    if (oldType === 'number' && newType === 'integer') return true
    return false
  }

  private isTypeWidening(oldType: string, newType: string): boolean {
    // integer -> number is widening
    if (oldType === 'integer' && newType === 'number') return true
    return false
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a column expectation builder
 */
export function column(name: string): TypeExpectationBuilder {
  return new TypeExpectationBuilder(name)
}

/**
 * Create a schema expectation builder
 */
export function schema(): SchemaExpectationBuilder {
  return new SchemaExpectationBuilder()
}

/**
 * Create a type validator
 */
export function createTypeValidator(): SchemaTypeValidator {
  return new SchemaTypeValidator()
}
