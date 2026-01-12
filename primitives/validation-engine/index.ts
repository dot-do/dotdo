/**
 * ValidationEngine - Comprehensive Schema Validation Primitives
 *
 * A Zod-like validation library for the dotdo platform providing:
 * - Type-safe schema validation
 * - Chainable constraint builders
 * - Coercion and transformation
 * - Custom validators
 * - Async validation support
 */

export * from './types'

import type {
  Schema,
  SchemaType,
  ValidationResult,
  ValidationError,
  ValidationErrorCode,
  SafeParseResult,
  CustomValidator,
  AsyncCustomValidator,
  ValidationContext,
  RefinementContext,
  RefinementFunction,
  StringSchema,
  NumberSchema,
  BooleanSchema,
  ObjectSchema,
  ArraySchema,
  DateSchema,
  LiteralSchema,
  EnumSchema,
  UnionSchema,
  IntersectionSchema,
  TupleSchema,
  RecordSchema,
  NullSchema,
  UndefinedSchema,
  AnySchema,
  StringConstraints,
  NumberConstraints,
  ArrayConstraints,
  ObjectConstraints,
  DateConstraints,
  CoercionConfig,
  IValidationEngine,
} from './types'

// =============================================================================
// Utility Functions
// =============================================================================

function getType(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  return typeof value
}

function formatPath(path: string[]): string {
  return path.reduce((acc, part, idx) => {
    if (part.startsWith('[')) return acc + part
    return idx === 0 ? part : `${acc}.${part}`
  }, '')
}

function createError(
  path: string[],
  message: string,
  code: ValidationErrorCode,
  expected?: string,
  received?: string
): ValidationError {
  return {
    path: formatPath(path),
    message,
    code,
    expected,
    received,
  }
}

// Email regex (simplified but effective)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// UUID regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// CUID regex
const CUID_REGEX = /^c[a-z0-9]{24}$/i

// ULID regex
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i

// =============================================================================
// Validation Engine
// =============================================================================

// Helper to extract schema from validator or schema object
function resolveSchema(schemaOrValidator: Schema | { build(): Schema } | { schema: Schema }): Schema {
  // If it has a build method, call it
  if (typeof schemaOrValidator === 'object' && 'build' in schemaOrValidator && typeof schemaOrValidator.build === 'function') {
    return schemaOrValidator.build()
  }
  // If it has a schema property (internal validator), access it directly
  if (typeof schemaOrValidator === 'object' && 'schema' in schemaOrValidator) {
    return schemaOrValidator.schema as Schema
  }
  // Otherwise it's already a schema
  return schemaOrValidator as Schema
}

/**
 * Main validation engine class
 */
export class ValidationEngine implements IValidationEngine {
  private customValidators = new Map<string, CustomValidator>()

  /**
   * Register a custom validator by name
   */
  register(name: string, validator: CustomValidator): void {
    this.customValidators.set(name, validator)
  }

  /**
   * Get a registered custom validator
   */
  getValidator(name: string): CustomValidator | undefined {
    return this.customValidators.get(name)
  }

  /**
   * Validate data against a schema
   */
  validate<T>(data: unknown, schemaOrValidator: Schema | { build(): Schema }): ValidationResult<T> {
    const schema = resolveSchema(schemaOrValidator)
    const errors: ValidationError[] = []
    const value = this.validateValue(data, schema, [], errors)

    return {
      valid: errors.length === 0,
      errors,
      value: errors.length === 0 ? value as T : undefined,
    }
  }

  /**
   * Parse and transform data (throws on error)
   */
  parse<T>(data: unknown, schemaOrValidator: Schema | { build(): Schema }): T {
    const result = this.validate<T>(data, schemaOrValidator)
    if (!result.valid) {
      throw result.errors
    }
    return result.value as T
  }

  /**
   * Safe parse - non-throwing version
   */
  safeParse<T>(data: unknown, schemaOrValidator: Schema | { build(): Schema }): SafeParseResult<T> {
    const result = this.validate<T>(data, schemaOrValidator)
    if (result.valid) {
      return { success: true, data: result.value as T }
    }
    return { success: false, error: result.errors }
  }

  /**
   * Async validation
   */
  async validateAsync<T>(data: unknown, schemaOrValidator: Schema | { build(): Schema }): Promise<ValidationResult<T>> {
    const schema = resolveSchema(schemaOrValidator)
    const errors: ValidationError[] = []
    const value = await this.validateValueAsync(data, schema, [], errors)

    return {
      valid: errors.length === 0,
      errors,
      value: errors.length === 0 ? value as T : undefined,
    }
  }

  /**
   * Async parse
   */
  async parseAsync<T>(data: unknown, schemaOrValidator: Schema | { build(): Schema }): Promise<T> {
    const result = await this.validateAsync<T>(data, schemaOrValidator)
    if (!result.valid) {
      throw result.errors
    }
    return result.value as T
  }

  /**
   * Safe async parse
   */
  async safeParseAsync<T>(data: unknown, schemaOrValidator: Schema | { build(): Schema }): Promise<SafeParseResult<T>> {
    const result = await this.validateAsync<T>(data, schemaOrValidator)
    if (result.valid) {
      return { success: true, data: result.value as T }
    }
    return { success: false, error: result.errors }
  }

  /**
   * Core validation logic
   */
  private validateValue(
    value: unknown,
    schema: Schema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    // Handle default values
    if (value === undefined && '_default' in schema && schema._default !== undefined) {
      return schema._default
    }

    // Handle undefined
    if (value === undefined) {
      if (schema._optional) {
        return undefined
      }
      errors.push(createError(path, 'Required', 'required'))
      return undefined
    }

    // Handle null - but allow coercion to transform null first
    if (value === null) {
      // Check if schema has coercion enabled - if so, let the type-specific validator handle it
      const hasCoercion = 'coercion' in schema && schema.coercion && (schema.coercion as { cast?: boolean }).cast
      if (!hasCoercion) {
        if (schema._nullable) {
          return null
        }
        errors.push(createError(path, 'Expected non-null value', 'invalid_type', schema._type, 'null'))
        return null
      }
    }

    // Type-specific validation
    switch (schema._type) {
      case 'string':
        return this.validateString(value, schema as StringSchema, path, errors)
      case 'number':
        return this.validateNumber(value, schema as NumberSchema, path, errors)
      case 'boolean':
        return this.validateBoolean(value, schema as BooleanSchema, path, errors)
      case 'object':
        return this.validateObject(value, schema as ObjectSchema, path, errors)
      case 'array':
        return this.validateArray(value, schema as ArraySchema, path, errors)
      case 'date':
        return this.validateDate(value, schema as DateSchema, path, errors)
      case 'literal':
        return this.validateLiteral(value, schema as LiteralSchema, path, errors)
      case 'enum':
        return this.validateEnum(value, schema as EnumSchema, path, errors)
      case 'union':
        return this.validateUnion(value, schema as UnionSchema, path, errors)
      case 'intersection':
        return this.validateIntersection(value, schema as IntersectionSchema, path, errors)
      case 'tuple':
        return this.validateTuple(value, schema as TupleSchema, path, errors)
      case 'record':
        return this.validateRecord(value, schema as RecordSchema, path, errors)
      case 'null':
        return this.validateNull(value, path, errors)
      case 'undefined':
        return this.validateUndefined(value, path, errors)
      case 'any':
        return value
      default:
        return value
    }
  }

  /**
   * Async validation logic
   */
  private async validateValueAsync(
    value: unknown,
    schema: Schema,
    path: string[],
    errors: ValidationError[]
  ): Promise<unknown> {
    // First run sync validation
    const syncResult = this.validateValue(value, schema, path, errors)

    // Then run async validators if present
    if ('asyncRefines' in schema && Array.isArray(schema.asyncRefines)) {
      const context: ValidationContext = { path, root: value }
      for (const refinement of schema.asyncRefines) {
        const result = await refinement.fn(syncResult, context)
        if (result === false || typeof result === 'string') {
          errors.push(createError(
            path,
            typeof result === 'string' ? result : refinement.message || 'Async validation failed',
            'async_validation_failed'
          ))
        }
      }
    }

    return syncResult
  }

  /**
   * Validate string
   */
  private validateString(
    value: unknown,
    schema: StringSchema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    // Coercion
    if (schema.coercion?.cast && typeof value !== 'string') {
      value = String(value)
    }

    if (typeof value !== 'string') {
      errors.push(createError(path, `Expected string, received ${getType(value)}`, 'invalid_type', 'string', getType(value)))
      return value
    }

    let result = value

    // Transformations
    if (schema.constraints?.trim) {
      result = result.trim()
    }
    if (schema.constraints?.toLowerCase) {
      result = result.toLowerCase()
    }
    if (schema.constraints?.toUpperCase) {
      result = result.toUpperCase()
    }

    const constraints = schema.constraints

    if (constraints) {
      // Length constraints
      if (constraints.minLength !== undefined && result.length < constraints.minLength) {
        errors.push(createError(
          path,
          constraints.message || `String must be at least ${constraints.minLength} characters`,
          'too_small'
        ))
      }

      if (constraints.maxLength !== undefined && result.length > constraints.maxLength) {
        errors.push(createError(
          path,
          constraints.message || `String must be at most ${constraints.maxLength} characters`,
          'too_big'
        ))
      }

      if (constraints.length !== undefined && result.length !== constraints.length) {
        errors.push(createError(
          path,
          constraints.message || `String must be exactly ${constraints.length} characters`,
          'too_small'
        ))
      }

      // Pattern constraints
      if (constraints.email && !EMAIL_REGEX.test(result)) {
        errors.push(createError(path, constraints.message || 'Invalid email format', 'invalid_string'))
      }

      if (constraints.url) {
        try {
          new URL(result)
        } catch {
          errors.push(createError(path, constraints.message || 'Invalid URL format', 'invalid_string'))
        }
      }

      if (constraints.uuid && !UUID_REGEX.test(result)) {
        errors.push(createError(path, constraints.message || 'Invalid UUID format', 'invalid_string'))
      }

      if (constraints.cuid && !CUID_REGEX.test(result)) {
        errors.push(createError(path, constraints.message || 'Invalid CUID format', 'invalid_string'))
      }

      if (constraints.ulid && !ULID_REGEX.test(result)) {
        errors.push(createError(path, constraints.message || 'Invalid ULID format', 'invalid_string'))
      }

      if (constraints.pattern && !constraints.pattern.test(result)) {
        errors.push(createError(path, constraints.message || 'String does not match pattern', 'invalid_string'))
      }

      if (constraints.startsWith && !result.startsWith(constraints.startsWith)) {
        errors.push(createError(path, constraints.message || `String must start with "${constraints.startsWith}"`, 'invalid_string'))
      }

      if (constraints.endsWith && !result.endsWith(constraints.endsWith)) {
        errors.push(createError(path, constraints.message || `String must end with "${constraints.endsWith}"`, 'invalid_string'))
      }

      if (constraints.includes && !result.includes(constraints.includes)) {
        errors.push(createError(path, constraints.message || `String must contain "${constraints.includes}"`, 'invalid_string'))
      }
    }

    // Custom validators
    if (schema.customs) {
      const context: ValidationContext = { path }
      for (const validator of schema.customs) {
        const validatorResult = validator(result, context)
        if (validatorResult === false) {
          errors.push(createError(path, 'Custom validation failed', 'custom'))
        } else if (typeof validatorResult === 'string') {
          errors.push(createError(path, validatorResult, 'custom'))
        }
      }
    }

    // Run refinements
    if ('refines' in schema && Array.isArray(schema.refines)) {
      this.runRefinements(result, schema.refines, path, errors)
    }

    // Run transformations
    if ('transforms' in schema && Array.isArray(schema.transforms)) {
      for (const transform of schema.transforms) {
        result = transform(result)
      }
    }

    // Pipe to next schema
    if ('pipe' in schema && schema.pipe) {
      const pipeSchema = resolveSchema(schema.pipe as Schema)
      return this.validateValue(result, pipeSchema, path, errors)
    }

    return result
  }

  /**
   * Validate number
   */
  private validateNumber(
    value: unknown,
    schema: NumberSchema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    // Coercion
    if (schema.coercion?.cast && typeof value !== 'number') {
      const parsed = Number(value)
      if (!Number.isNaN(parsed)) {
        value = parsed
      }
    }

    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push(createError(path, `Expected number, received ${getType(value)}`, 'invalid_type', 'number', getType(value)))
      return value
    }

    const constraints = schema.constraints

    if (constraints) {
      // Range constraints
      if (constraints.min !== undefined && value < constraints.min) {
        errors.push(createError(path, constraints.message || `Number must be at least ${constraints.min}`, 'too_small'))
      }

      if (constraints.max !== undefined && value > constraints.max) {
        errors.push(createError(path, constraints.message || `Number must be at most ${constraints.max}`, 'too_big'))
      }

      if (constraints.gt !== undefined && value <= constraints.gt) {
        errors.push(createError(path, constraints.message || `Number must be greater than ${constraints.gt}`, 'too_small'))
      }

      if (constraints.gte !== undefined && value < constraints.gte) {
        errors.push(createError(path, constraints.message || `Number must be greater than or equal to ${constraints.gte}`, 'too_small'))
      }

      if (constraints.lt !== undefined && value >= constraints.lt) {
        errors.push(createError(path, constraints.message || `Number must be less than ${constraints.lt}`, 'too_big'))
      }

      if (constraints.lte !== undefined && value > constraints.lte) {
        errors.push(createError(path, constraints.message || `Number must be less than or equal to ${constraints.lte}`, 'too_big'))
      }

      // Integer constraint
      if (constraints.int && !Number.isInteger(value)) {
        errors.push(createError(path, constraints.message || 'Number must be an integer', 'invalid_type'))
      }

      // Sign constraints
      if (constraints.positive && value <= 0) {
        errors.push(createError(path, constraints.message || 'Number must be positive', 'too_small'))
      }

      if (constraints.negative && value >= 0) {
        errors.push(createError(path, constraints.message || 'Number must be negative', 'too_big'))
      }

      if (constraints.nonNegative && value < 0) {
        errors.push(createError(path, constraints.message || 'Number must be non-negative', 'too_small'))
      }

      if (constraints.nonPositive && value > 0) {
        errors.push(createError(path, constraints.message || 'Number must be non-positive', 'too_big'))
      }

      // Finite constraint
      if (constraints.finite && !Number.isFinite(value)) {
        errors.push(createError(path, constraints.message || 'Number must be finite', 'invalid_type'))
      }

      // Safe integer constraint
      if (constraints.safe && !Number.isSafeInteger(value)) {
        errors.push(createError(path, constraints.message || 'Number must be a safe integer', 'invalid_type'))
      }

      // Multiple of constraint
      if (constraints.multipleOf !== undefined && value % constraints.multipleOf !== 0) {
        errors.push(createError(path, constraints.message || `Number must be a multiple of ${constraints.multipleOf}`, 'invalid_type'))
      }
    }

    // Custom validators
    if (schema.customs) {
      const context: ValidationContext = { path }
      for (const validator of schema.customs) {
        const validatorResult = validator(value, context)
        if (validatorResult === false) {
          errors.push(createError(path, 'Custom validation failed', 'custom'))
        } else if (typeof validatorResult === 'string') {
          errors.push(createError(path, validatorResult, 'custom'))
        }
      }
    }

    // Run registered validators by name
    if ('useValidators' in schema && Array.isArray(schema.useValidators)) {
      const context: ValidationContext = { path }
      for (const name of schema.useValidators) {
        const validator = this.customValidators.get(name)
        if (validator) {
          const validatorResult = validator(value, context)
          if (validatorResult === false) {
            errors.push(createError(path, `Validation failed: ${name}`, 'custom'))
          } else if (typeof validatorResult === 'string') {
            errors.push(createError(path, validatorResult, 'custom'))
          }
        }
      }
    }

    // Run refinements
    if ('refines' in schema && Array.isArray(schema.refines)) {
      this.runRefinements(value, schema.refines, path, errors)
    }

    // Run transformations
    if ('transforms' in schema && Array.isArray(schema.transforms)) {
      let result: unknown = value
      for (const transform of schema.transforms) {
        result = transform(result)
      }
      return result
    }

    return value
  }

  /**
   * Validate boolean
   */
  private validateBoolean(
    value: unknown,
    schema: BooleanSchema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    // Coercion
    if (schema.coercion?.cast && typeof value !== 'boolean') {
      if (value === 'true' || value === 'yes' || value === 1) {
        value = true
      } else if (value === 'false' || value === 'no' || value === 0 || value === '' || value === null) {
        value = false
      } else {
        value = Boolean(value)
      }
    }

    if (typeof value !== 'boolean') {
      errors.push(createError(path, `Expected boolean, received ${getType(value)}`, 'invalid_type', 'boolean', getType(value)))
      return value
    }

    // Custom validators
    if (schema.customs) {
      const context: ValidationContext = { path }
      for (const validator of schema.customs) {
        const validatorResult = validator(value, context)
        if (validatorResult === false) {
          errors.push(createError(path, 'Custom validation failed', 'custom'))
        } else if (typeof validatorResult === 'string') {
          errors.push(createError(path, validatorResult, 'custom'))
        }
      }
    }

    return value
  }

  /**
   * Validate object
   */
  private validateObject(
    value: unknown,
    schema: ObjectSchema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(createError(path, `Expected object, received ${getType(value)}`, 'invalid_type', 'object', getType(value)))
      return value
    }

    const result: Record<string, unknown> = {}
    const inputKeys = new Set(Object.keys(value as object))
    const shapeKeys = new Set(Object.keys(schema.shape))

    // Validate shape fields
    for (const [key, fieldSchemaOrValidator] of Object.entries(schema.shape)) {
      const fieldSchema = resolveSchema(fieldSchemaOrValidator)
      const fieldValue = (value as Record<string, unknown>)[key]
      const fieldPath = [...path, key]
      result[key] = this.validateValue(fieldValue, fieldSchema, fieldPath, errors)
      inputKeys.delete(key)
    }

    // Handle unknown keys
    const unknownKeys = [...inputKeys]
    if (unknownKeys.length > 0) {
      if (schema.constraints?.strict) {
        errors.push(createError(
          path,
          `Unrecognized keys: ${unknownKeys.join(', ')}`,
          'unrecognized_keys'
        ))
      } else if (schema.constraints?.passthrough) {
        for (const key of unknownKeys) {
          result[key] = (value as Record<string, unknown>)[key]
        }
      }
      // Default is strip mode - unknown keys are not included
    }

    // Custom validators
    if (schema.customs) {
      const context: ValidationContext = { path }
      for (const validator of schema.customs) {
        const validatorResult = validator(result as Record<string, unknown>, context)
        if (validatorResult === false) {
          errors.push(createError(path, 'Custom validation failed', 'custom'))
        } else if (typeof validatorResult === 'string') {
          errors.push(createError(path, validatorResult, 'custom'))
        }
      }
    }

    // Run refinements
    if ('refines' in schema && Array.isArray(schema.refines)) {
      this.runRefinements(result, schema.refines, path, errors)
    }

    return result
  }

  /**
   * Validate array
   */
  private validateArray(
    value: unknown,
    schema: ArraySchema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    if (!Array.isArray(value)) {
      errors.push(createError(path, `Expected array, received ${getType(value)}`, 'invalid_type', 'array', getType(value)))
      return value
    }

    const constraints = schema.constraints

    if (constraints) {
      // Length constraints
      if (constraints.minLength !== undefined && value.length < constraints.minLength) {
        errors.push(createError(
          path,
          constraints.message || `Array must have at least ${constraints.minLength} items`,
          'too_small'
        ))
      }

      if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
        errors.push(createError(
          path,
          constraints.message || `Array must have at most ${constraints.maxLength} items`,
          'too_big'
        ))
      }

      if (constraints.length !== undefined && value.length !== constraints.length) {
        errors.push(createError(
          path,
          constraints.message || `Array must have exactly ${constraints.length} items`,
          'too_small'
        ))
      }

      if (constraints.nonEmpty && value.length === 0) {
        errors.push(createError(path, constraints.message || 'Array must not be empty', 'too_small'))
      }

      if (constraints.unique) {
        const seen = new Set()
        for (const item of value) {
          const key = typeof item === 'object' ? JSON.stringify(item) : item
          if (seen.has(key)) {
            errors.push(createError(path, constraints.message || 'Array elements must be unique', 'custom'))
            break
          }
          seen.add(key)
        }
      }
    }

    // Validate elements
    const result: unknown[] = []
    const elementSchema = resolveSchema(schema.element)
    for (let i = 0; i < value.length; i++) {
      const elementPath = [...path, `[${i}]`]
      result.push(this.validateValue(value[i], elementSchema, elementPath, errors))
    }

    // Custom validators
    if (schema.customs) {
      const context: ValidationContext = { path }
      for (const validator of schema.customs) {
        const validatorResult = validator(result, context)
        if (validatorResult === false) {
          errors.push(createError(path, 'Custom validation failed', 'custom'))
        } else if (typeof validatorResult === 'string') {
          errors.push(createError(path, validatorResult, 'custom'))
        }
      }
    }

    // Run refinements
    if ('refines' in schema && Array.isArray(schema.refines)) {
      this.runRefinements(result, schema.refines, path, errors)
    }

    return result
  }

  /**
   * Validate date
   */
  private validateDate(
    value: unknown,
    schema: DateSchema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    // Coercion
    if (schema.coercion?.parseDate && !(value instanceof Date)) {
      if (typeof value === 'string' || typeof value === 'number') {
        value = new Date(value)
      }
    }

    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      errors.push(createError(path, `Expected valid date, received ${getType(value)}`, 'invalid_type', 'date', getType(value)))
      return value
    }

    const constraints = schema.constraints

    if (constraints) {
      if (constraints.min && value < constraints.min) {
        errors.push(createError(path, constraints.message || `Date must be after ${constraints.min.toISOString()}`, 'too_small'))
      }

      if (constraints.max && value > constraints.max) {
        errors.push(createError(path, constraints.message || `Date must be before ${constraints.max.toISOString()}`, 'too_big'))
      }
    }

    // Custom validators
    if (schema.customs) {
      const context: ValidationContext = { path }
      for (const validator of schema.customs) {
        const validatorResult = validator(value, context)
        if (validatorResult === false) {
          errors.push(createError(path, 'Custom validation failed', 'custom'))
        } else if (typeof validatorResult === 'string') {
          errors.push(createError(path, validatorResult, 'custom'))
        }
      }
    }

    return value
  }

  /**
   * Validate literal
   */
  private validateLiteral(
    value: unknown,
    schema: LiteralSchema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    if (value !== schema.value) {
      errors.push(createError(
        path,
        `Expected literal ${JSON.stringify(schema.value)}, received ${JSON.stringify(value)}`,
        'invalid_literal',
        String(schema.value),
        String(value)
      ))
    }
    return value
  }

  /**
   * Validate enum
   */
  private validateEnum(
    value: unknown,
    schema: EnumSchema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    if (!schema.values.includes(value as string | number)) {
      errors.push(createError(
        path,
        `Invalid enum value. Expected one of: ${schema.values.join(', ')}`,
        'invalid_enum'
      ))
    }
    return value
  }

  /**
   * Validate union
   */
  private validateUnion(
    value: unknown,
    schema: UnionSchema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    const unionErrors: ValidationError[][] = []

    for (const optionOrValidator of schema.options) {
      const option = resolveSchema(optionOrValidator)
      const optionErrors: ValidationError[] = []
      const result = this.validateValue(value, option, path, optionErrors)
      if (optionErrors.length === 0) {
        return result
      }
      unionErrors.push(optionErrors)
    }

    errors.push(createError(path, 'Invalid union - none of the options matched', 'invalid_union'))
    return value
  }

  /**
   * Validate intersection
   */
  private validateIntersection(
    value: unknown,
    schema: IntersectionSchema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    // For intersection, we validate the ORIGINAL value against each schema
    // and merge the results for objects
    const results: unknown[] = []

    for (const subSchemaOrValidator of schema.schemas) {
      const subSchema = resolveSchema(subSchemaOrValidator)
      // Each schema validates against the original value
      const result = this.validateValue(value, subSchema, path, errors)
      results.push(result)
    }

    // If all results are objects, merge them
    if (results.every(r => typeof r === 'object' && r !== null && !Array.isArray(r))) {
      return Object.assign({}, ...results)
    }

    // Otherwise return the last result
    return results[results.length - 1]
  }

  /**
   * Validate tuple
   */
  private validateTuple(
    value: unknown,
    schema: TupleSchema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    if (!Array.isArray(value)) {
      errors.push(createError(path, `Expected tuple, received ${getType(value)}`, 'invalid_type', 'tuple', getType(value)))
      return value
    }

    const minLength = schema.items.length
    const hasRest = !!schema.rest

    if (value.length < minLength) {
      errors.push(createError(path, `Tuple must have at least ${minLength} items`, 'too_small'))
    }

    if (!hasRest && value.length > minLength) {
      errors.push(createError(path, `Tuple must have exactly ${minLength} items`, 'too_big'))
    }

    const result: unknown[] = []

    // Validate fixed items
    for (let i = 0; i < schema.items.length; i++) {
      if (i < value.length) {
        const elementPath = [...path, `[${i}]`]
        const itemSchema = resolveSchema(schema.items[i])
        result.push(this.validateValue(value[i], itemSchema, elementPath, errors))
      }
    }

    // Validate rest items
    if (hasRest) {
      const restSchema = resolveSchema(schema.rest!)
      for (let i = schema.items.length; i < value.length; i++) {
        const elementPath = [...path, `[${i}]`]
        result.push(this.validateValue(value[i], restSchema, elementPath, errors))
      }
    }

    return result
  }

  /**
   * Validate record
   */
  private validateRecord(
    value: unknown,
    schema: RecordSchema,
    path: string[],
    errors: ValidationError[]
  ): unknown {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(createError(path, `Expected record, received ${getType(value)}`, 'invalid_type', 'record', getType(value)))
      return value
    }

    const result: Record<string, unknown> = {}
    const keySchema = resolveSchema(schema.keySchema)
    const valueSchema = resolveSchema(schema.valueSchema)

    for (const [key, val] of Object.entries(value)) {
      // Validate key
      const keyErrors: ValidationError[] = []
      this.validateValue(key, keySchema, [...path, key], keyErrors)
      if (keyErrors.length > 0) {
        errors.push(...keyErrors)
      }

      // Validate value
      const valPath = [...path, key]
      result[key] = this.validateValue(val, valueSchema, valPath, errors)
    }

    return result
  }

  /**
   * Validate null
   */
  private validateNull(value: unknown, path: string[], errors: ValidationError[]): unknown {
    if (value !== null) {
      errors.push(createError(path, `Expected null, received ${getType(value)}`, 'invalid_type', 'null', getType(value)))
    }
    return value
  }

  /**
   * Validate undefined
   */
  private validateUndefined(value: unknown, path: string[], errors: ValidationError[]): unknown {
    if (value !== undefined) {
      errors.push(createError(path, `Expected undefined, received ${getType(value)}`, 'invalid_type', 'undefined', getType(value)))
    }
    return value
  }

  /**
   * Run refinement functions
   */
  private runRefinements(
    value: unknown,
    refines: Array<{ fn: RefinementFunction; message?: string }>,
    path: string[],
    errors: ValidationError[]
  ): void {
    for (const refinement of refines) {
      const issues: ValidationError[] = []
      const ctx: RefinementContext = {
        path,
        addIssue: (issue) => {
          issues.push(createError(
            issue.path || path,
            issue.message,
            issue.code || 'custom'
          ))
        },
      }

      const result = refinement.fn(value, ctx)
      if (result === false) {
        errors.push(createError(path, refinement.message || 'Validation failed', 'custom'))
      }
      errors.push(...issues)
    }
  }
}

// =============================================================================
// Schema Builders
// =============================================================================

/**
 * String schema builder
 */
export class StringValidator {
  private schema: StringSchema & {
    refines?: Array<{ fn: RefinementFunction; message?: string }>
    asyncRefines?: Array<{ fn: AsyncCustomValidator; message?: string }>
    transforms?: Array<(val: string) => unknown>
    pipe?: Schema
    useValidators?: string[]
  } = {
    _type: 'string',
    _output: '' as string,
    _input: undefined,
    constraints: {},
  }

  min(length: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, minLength: length, message }
    return this
  }

  max(length: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, maxLength: length, message }
    return this
  }

  length(length: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, length, message }
    return this
  }

  email(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, email: true, message }
    return this
  }

  url(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, url: true, message }
    return this
  }

  uuid(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, uuid: true, message }
    return this
  }

  cuid(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, cuid: true, message }
    return this
  }

  ulid(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, ulid: true, message }
    return this
  }

  regex(pattern: RegExp, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, pattern, message }
    return this
  }

  startsWith(prefix: string, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, startsWith: prefix, message }
    return this
  }

  endsWith(suffix: string, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, endsWith: suffix, message }
    return this
  }

  includes(substring: string, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, includes: substring, message }
    return this
  }

  ip(options?: { version?: 'v4' | 'v6' }, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, ip: options || true, message }
    return this
  }

  datetime(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, datetime: true, message }
    return this
  }

  trim(): this {
    this.schema.constraints = { ...this.schema.constraints, trim: true }
    return this
  }

  toLowerCase(): this {
    this.schema.constraints = { ...this.schema.constraints, toLowerCase: true }
    return this
  }

  toUpperCase(): this {
    this.schema.constraints = { ...this.schema.constraints, toUpperCase: true }
    return this
  }

  optional(): this {
    (this.schema as { _optional: boolean })._optional = true
    return this
  }

  nullable(): this {
    (this.schema as { _nullable: boolean })._nullable = true
    return this
  }

  nullish(): this {
    (this.schema as { _optional: boolean; _nullable: boolean })._optional = true
    ;(this.schema as { _optional: boolean; _nullable: boolean })._nullable = true
    return this
  }

  default(value: string): this {
    (this.schema as { _default: string })._default = value
    ;(this.schema as { _optional: boolean })._optional = true
    return this
  }

  describe(description: string): this {
    (this.schema as { _description: string })._description = description
    return this
  }

  refine(fn: (val: string) => boolean, message?: string): this {
    if (!this.schema.refines) this.schema.refines = []
    this.schema.refines.push({ fn: fn as RefinementFunction, message })
    return this
  }

  superRefine(fn: (val: string, ctx: RefinementContext) => void): this {
    if (!this.schema.refines) this.schema.refines = []
    this.schema.refines.push({ fn: fn as RefinementFunction })
    return this
  }

  refineAsync(fn: AsyncCustomValidator<string>, message?: string): this {
    if (!this.schema.asyncRefines) this.schema.asyncRefines = []
    this.schema.asyncRefines.push({ fn, message })
    return this
  }

  transform<T>(fn: (val: string) => T): this {
    if (!this.schema.transforms) this.schema.transforms = []
    this.schema.transforms.push(fn as (val: string) => unknown)
    return this
  }

  pipe(schema: Schema): this {
    this.schema.pipe = schema
    return this
  }

  or(schema: Schema): UnionValidator {
    return new UnionValidator([this.build(), schema])
  }

  and(schema: Schema): IntersectionValidator {
    return new IntersectionValidator([this.build(), schema])
  }

  use(validatorName: string): this {
    if (!this.schema.useValidators) this.schema.useValidators = []
    this.schema.useValidators.push(validatorName)
    return this
  }

  brand<B extends string>(): this {
    // Brand is a type-level feature, no runtime changes needed
    return this
  }

  build(): StringSchema {
    return this.schema as StringSchema
  }
}

/**
 * Number schema builder
 */
export class NumberValidator {
  private schema: NumberSchema & {
    refines?: Array<{ fn: RefinementFunction; message?: string }>
    asyncRefines?: Array<{ fn: AsyncCustomValidator; message?: string }>
    transforms?: Array<(val: number) => unknown>
    useValidators?: string[]
  } = {
    _type: 'number',
    _output: 0 as number,
    _input: undefined,
    constraints: {},
  }

  min(value: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, min: value, message }
    return this
  }

  max(value: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, max: value, message }
    return this
  }

  gt(value: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, gt: value, message }
    return this
  }

  gte(value: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, gte: value, message }
    return this
  }

  lt(value: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, lt: value, message }
    return this
  }

  lte(value: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, lte: value, message }
    return this
  }

  int(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, int: true, message }
    return this
  }

  positive(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, positive: true, message }
    return this
  }

  negative(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, negative: true, message }
    return this
  }

  nonNegative(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, nonNegative: true, message }
    return this
  }

  nonPositive(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, nonPositive: true, message }
    return this
  }

  finite(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, finite: true, message }
    return this
  }

  safe(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, safe: true, message }
    return this
  }

  multipleOf(value: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, multipleOf: value, message }
    return this
  }

  optional(): this {
    (this.schema as { _optional: boolean })._optional = true
    return this
  }

  nullable(): this {
    (this.schema as { _nullable: boolean })._nullable = true
    return this
  }

  nullish(): this {
    (this.schema as { _optional: boolean; _nullable: boolean })._optional = true
    ;(this.schema as { _optional: boolean; _nullable: boolean })._nullable = true
    return this
  }

  default(value: number): this {
    (this.schema as { _default: number })._default = value
    ;(this.schema as { _optional: boolean })._optional = true
    return this
  }

  describe(description: string): this {
    (this.schema as { _description: string })._description = description
    return this
  }

  refine(fn: (val: number) => boolean, message?: string): this {
    if (!this.schema.refines) this.schema.refines = []
    this.schema.refines.push({ fn: fn as RefinementFunction, message })
    return this
  }

  superRefine(fn: (val: number, ctx: RefinementContext) => void): this {
    if (!this.schema.refines) this.schema.refines = []
    this.schema.refines.push({ fn: fn as RefinementFunction })
    return this
  }

  transform<T>(fn: (val: number) => T): this {
    if (!this.schema.transforms) this.schema.transforms = []
    this.schema.transforms.push(fn as (val: number) => unknown)
    return this
  }

  use(validatorName: string): this {
    if (!this.schema.useValidators) this.schema.useValidators = []
    this.schema.useValidators.push(validatorName)
    return this
  }

  build(): NumberSchema {
    return this.schema as NumberSchema
  }
}

/**
 * Boolean schema builder
 */
export class BooleanValidator {
  private schema: BooleanSchema = {
    _type: 'boolean',
    _output: false as boolean,
    _input: undefined,
  }

  optional(): this {
    (this.schema as { _optional: boolean })._optional = true
    return this
  }

  nullable(): this {
    (this.schema as { _nullable: boolean })._nullable = true
    return this
  }

  nullish(): this {
    (this.schema as { _optional: boolean; _nullable: boolean })._optional = true
    ;(this.schema as { _optional: boolean; _nullable: boolean })._nullable = true
    return this
  }

  default(value: boolean): this {
    (this.schema as { _default: boolean })._default = value
    ;(this.schema as { _optional: boolean })._optional = true
    return this
  }

  describe(description: string): this {
    (this.schema as { _description: string })._description = description
    return this
  }

  build(): BooleanSchema {
    return this.schema
  }
}

/**
 * Object schema builder
 */
export class ObjectValidator<T extends Record<string, unknown> = Record<string, unknown>> {
  private schema: ObjectSchema<T> & {
    refines?: Array<{ fn: RefinementFunction; message?: string }>
  }

  constructor(shape: Record<string, Schema>) {
    this.schema = {
      _type: 'object',
      _output: {} as T,
      _input: undefined,
      shape,
      constraints: {},
    }
  }

  strict(): this {
    this.schema.constraints = { ...this.schema.constraints, strict: true }
    return this
  }

  passthrough(): this {
    this.schema.constraints = { ...this.schema.constraints, passthrough: true }
    return this
  }

  strip(): this {
    this.schema.constraints = { ...this.schema.constraints, strip: true }
    return this
  }

  catchall(schema: Schema): this {
    this.schema.constraints = { ...this.schema.constraints, catchall: schema }
    return this
  }

  extend(additionalShape: Record<string, Schema>): ObjectValidator {
    return new ObjectValidator({ ...this.schema.shape, ...additionalShape })
  }

  merge(otherSchema: ObjectSchema | ObjectValidator): ObjectValidator {
    const other = otherSchema instanceof ObjectValidator ? otherSchema.build() : otherSchema
    return new ObjectValidator({ ...this.schema.shape, ...other.shape })
  }

  pick(keys: string[]): ObjectValidator {
    const newShape: Record<string, Schema> = {}
    for (const key of keys) {
      if (key in this.schema.shape) {
        newShape[key] = this.schema.shape[key]
      }
    }
    return new ObjectValidator(newShape)
  }

  omit(keys: string[]): ObjectValidator {
    const keysSet = new Set(keys)
    const newShape: Record<string, Schema> = {}
    for (const [key, value] of Object.entries(this.schema.shape)) {
      if (!keysSet.has(key)) {
        newShape[key] = value
      }
    }
    return new ObjectValidator(newShape)
  }

  partial(): ObjectValidator {
    const newShape: Record<string, Schema> = {}
    for (const [key, value] of Object.entries(this.schema.shape)) {
      const resolvedSchema = resolveSchema(value)
      newShape[key] = { ...resolvedSchema, _optional: true } as Schema
    }
    return new ObjectValidator(newShape)
  }

  required(): ObjectValidator {
    const newShape: Record<string, Schema> = {}
    for (const [key, value] of Object.entries(this.schema.shape)) {
      const resolvedSchema = resolveSchema(value)
      const { _optional, ...rest } = resolvedSchema as Schema & { _optional?: boolean }
      newShape[key] = rest as Schema
    }
    return new ObjectValidator(newShape)
  }

  optional(): this {
    (this.schema as { _optional: boolean })._optional = true
    return this
  }

  nullable(): this {
    (this.schema as { _nullable: boolean })._nullable = true
    return this
  }

  nullish(): this {
    (this.schema as { _optional: boolean; _nullable: boolean })._optional = true
    ;(this.schema as { _optional: boolean; _nullable: boolean })._nullable = true
    return this
  }

  default(value: T): this {
    (this.schema as { _default: T })._default = value
    ;(this.schema as { _optional: boolean })._optional = true
    return this
  }

  describe(description: string): this {
    (this.schema as { _description: string })._description = description
    return this
  }

  refine(fn: (val: T) => boolean, message?: string): this {
    if (!this.schema.refines) this.schema.refines = []
    this.schema.refines.push({ fn: fn as RefinementFunction, message })
    return this
  }

  superRefine(fn: (val: T, ctx: RefinementContext) => void): this {
    if (!this.schema.refines) this.schema.refines = []
    this.schema.refines.push({ fn: fn as RefinementFunction })
    return this
  }

  and(schema: Schema | ObjectValidator): IntersectionValidator {
    const other = schema instanceof ObjectValidator ? schema.build() : schema
    return new IntersectionValidator([this.build(), other])
  }

  build(): ObjectSchema<T> {
    return this.schema as ObjectSchema<T>
  }
}

/**
 * Array schema builder
 */
export class ArrayValidator<T = unknown> {
  private schema: ArraySchema<T> & {
    refines?: Array<{ fn: RefinementFunction; message?: string }>
  }

  constructor(element: Schema) {
    this.schema = {
      _type: 'array',
      _output: [] as T[],
      _input: undefined,
      element,
      constraints: {},
    }
  }

  min(length: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, minLength: length, message }
    return this
  }

  max(length: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, maxLength: length, message }
    return this
  }

  length(length: number, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, length, message }
    return this
  }

  nonEmpty(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, nonEmpty: true, message }
    return this
  }

  unique(message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, unique: true, message }
    return this
  }

  optional(): this {
    (this.schema as { _optional: boolean })._optional = true
    return this
  }

  nullable(): this {
    (this.schema as { _nullable: boolean })._nullable = true
    return this
  }

  nullish(): this {
    (this.schema as { _optional: boolean; _nullable: boolean })._optional = true
    ;(this.schema as { _optional: boolean; _nullable: boolean })._nullable = true
    return this
  }

  default(value: T[]): this {
    (this.schema as { _default: T[] })._default = value
    ;(this.schema as { _optional: boolean })._optional = true
    return this
  }

  describe(description: string): this {
    (this.schema as { _description: string })._description = description
    return this
  }

  refine(fn: (val: T[]) => boolean, message?: string): this {
    if (!this.schema.refines) this.schema.refines = []
    this.schema.refines.push({ fn: fn as RefinementFunction, message })
    return this
  }

  build(): ArraySchema<T> {
    return this.schema as ArraySchema<T>
  }
}

/**
 * Date schema builder
 */
export class DateValidator {
  private schema: DateSchema & {
    refines?: Array<{ fn: RefinementFunction; message?: string }>
  } = {
    _type: 'date',
    _output: new Date() as Date,
    _input: undefined,
    constraints: {},
  }

  min(date: Date, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, min: date, message }
    return this
  }

  max(date: Date, message?: string): this {
    this.schema.constraints = { ...this.schema.constraints, max: date, message }
    return this
  }

  optional(): this {
    (this.schema as { _optional: boolean })._optional = true
    return this
  }

  nullable(): this {
    (this.schema as { _nullable: boolean })._nullable = true
    return this
  }

  nullish(): this {
    (this.schema as { _optional: boolean; _nullable: boolean })._optional = true
    ;(this.schema as { _optional: boolean; _nullable: boolean })._nullable = true
    return this
  }

  default(value: Date): this {
    (this.schema as { _default: Date })._default = value
    ;(this.schema as { _optional: boolean })._optional = true
    return this
  }

  describe(description: string): this {
    (this.schema as { _description: string })._description = description
    return this
  }

  build(): DateSchema {
    return this.schema as DateSchema
  }
}

/**
 * Tuple schema builder
 */
export class TupleValidator<T extends readonly unknown[] = readonly unknown[]> {
  private schema: TupleSchema<T>

  constructor(items: readonly Schema[]) {
    this.schema = {
      _type: 'tuple',
      _output: [] as unknown as T,
      _input: undefined,
      items,
    }
  }

  rest(schema: Schema): this {
    (this.schema as { rest: Schema }).rest = schema
    return this
  }

  optional(): this {
    (this.schema as { _optional: boolean })._optional = true
    return this
  }

  nullable(): this {
    (this.schema as { _nullable: boolean })._nullable = true
    return this
  }

  build(): TupleSchema<T> {
    return this.schema
  }
}

/**
 * Record schema builder
 */
export class RecordValidator<K extends string = string, V = unknown> {
  private schema: RecordSchema<K, V>

  constructor(keySchema: Schema, valueSchema: Schema) {
    this.schema = {
      _type: 'record',
      _output: {} as Record<K, V>,
      _input: undefined,
      keySchema,
      valueSchema,
    }
  }

  optional(): this {
    (this.schema as { _optional: boolean })._optional = true
    return this
  }

  nullable(): this {
    (this.schema as { _nullable: boolean })._nullable = true
    return this
  }

  build(): RecordSchema<K, V> {
    return this.schema
  }
}

/**
 * Union schema builder
 */
export class UnionValidator<T = unknown> {
  private schema: UnionSchema<T>

  constructor(options: readonly Schema[]) {
    this.schema = {
      _type: 'union',
      _output: undefined as unknown as T,
      _input: undefined,
      options,
    }
  }

  optional(): this {
    (this.schema as { _optional: boolean })._optional = true
    return this
  }

  nullable(): this {
    (this.schema as { _nullable: boolean })._nullable = true
    return this
  }

  build(): UnionSchema<T> {
    return this.schema
  }
}

/**
 * Intersection schema builder
 */
export class IntersectionValidator<T = unknown> {
  private schema: IntersectionSchema<T>

  constructor(schemas: readonly Schema[]) {
    this.schema = {
      _type: 'intersection',
      _output: undefined as unknown as T,
      _input: undefined,
      schemas,
    }
  }

  optional(): this {
    (this.schema as { _optional: boolean })._optional = true
    return this
  }

  nullable(): this {
    (this.schema as { _nullable: boolean })._nullable = true
    return this
  }

  build(): IntersectionSchema<T> {
    return this.schema
  }
}

/**
 * Any schema builder
 */
export class AnyValidator {
  private schema: AnySchema = {
    _type: 'any',
    _output: undefined,
    _input: undefined,
  }

  optional(): this {
    (this.schema as { _optional: boolean })._optional = true
    return this
  }

  nullable(): this {
    (this.schema as { _nullable: boolean })._nullable = true
    return this
  }

  nullish(): this {
    (this.schema as { _optional: boolean; _nullable: boolean })._optional = true
    ;(this.schema as { _optional: boolean; _nullable: boolean })._nullable = true
    return this
  }

  build(): AnySchema {
    return this.schema
  }
}

// =============================================================================
// z API (Zod-like interface)
// =============================================================================

/**
 * Create a lazy schema for recursive types
 */
function lazy<T>(fn: () => Schema): Schema {
  // Create a proxy that defers schema resolution
  let resolved: Schema | null = null
  return new Proxy({} as Schema, {
    get(target, prop) {
      if (!resolved) resolved = fn()
      return (resolved as Record<string | symbol, unknown>)[prop]
    },
  })
}

/**
 * Coercion schema builders
 */
const coerce = {
  string(): StringValidator {
    const validator = new StringValidator()
    ;(validator as { schema: StringSchema & { coercion?: CoercionConfig } }).schema = {
      ...((validator as { schema: StringSchema }).schema),
      coercion: { cast: true },
    }
    return validator
  },

  number(): NumberValidator {
    const validator = new NumberValidator()
    ;(validator as { schema: NumberSchema & { coercion?: CoercionConfig } }).schema = {
      ...((validator as { schema: NumberSchema }).schema),
      coercion: { cast: true },
    }
    return validator
  },

  boolean(): BooleanValidator {
    const validator = new BooleanValidator()
    ;(validator as { schema: BooleanSchema & { coercion?: CoercionConfig } }).schema = {
      ...((validator as { schema: BooleanSchema }).schema),
      coercion: { cast: true },
    }
    return validator
  },

  date(): DateValidator {
    const validator = new DateValidator()
    ;(validator as { schema: DateSchema & { coercion?: CoercionConfig } }).schema = {
      ...((validator as { schema: DateSchema }).schema),
      coercion: { parseDate: true },
    }
    return validator
  },
}

/**
 * Zod-like schema builder API
 */
export const z = {
  // Primitives
  string: () => new StringValidator(),
  number: () => new NumberValidator(),
  boolean: () => new BooleanValidator(),
  date: () => new DateValidator(),

  // Compound types
  object: <T extends Record<string, Schema>>(shape: T) => new ObjectValidator(shape),
  array: <T>(element: Schema) => new ArrayValidator<T>(element),
  tuple: <T extends readonly Schema[]>(items: T) => new TupleValidator(items),
  record: <K extends string, V>(keySchema: Schema, valueSchema: Schema) => new RecordValidator<K, V>(keySchema, valueSchema),

  // Union and intersection
  union: <T extends readonly Schema[]>(options: T) => new UnionValidator(options),
  intersection: <T extends readonly Schema[]>(schemas: T) => new IntersectionValidator(schemas),

  // Literals and enums
  literal: <T extends string | number | boolean | null | undefined>(value: T): LiteralSchema<T> => ({
    _type: 'literal',
    _output: value,
    _input: undefined,
    value,
  }),

  enum: <T extends string | number>(values: readonly T[]): EnumSchema<T> => ({
    _type: 'enum',
    _output: values[0],
    _input: undefined,
    values,
  }),

  nativeEnum: <T extends Record<string, string | number>>(enumObj: T): EnumSchema<T[keyof T]> => ({
    _type: 'enum',
    _output: Object.values(enumObj)[0] as T[keyof T],
    _input: undefined,
    values: Object.values(enumObj) as T[keyof T][],
  }),

  // Special types
  null: (): NullSchema => ({
    _type: 'null',
    _output: null,
    _input: undefined,
  }),

  undefined: (): UndefinedSchema => ({
    _type: 'undefined',
    _output: undefined,
    _input: undefined,
  }),

  any: () => new AnyValidator(),

  // Recursive schemas
  lazy,

  // Coercion
  coerce,
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new validation engine instance
 */
export function createValidationEngine(): ValidationEngine {
  return new ValidationEngine()
}
