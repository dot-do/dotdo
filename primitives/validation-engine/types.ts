/**
 * ValidationEngine Types - Comprehensive Schema Validation Primitives
 *
 * Provides types for Zod-like validation with:
 * - Schema definitions and builders
 * - Validation results and errors
 * - Constraints and coercion
 * - Custom validators
 * - Type inference
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Supported schema types
 */
export type SchemaType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'date'
  | 'any'
  | 'null'
  | 'undefined'
  | 'literal'
  | 'enum'
  | 'union'
  | 'intersection'
  | 'tuple'
  | 'record'

/**
 * Validation error with path, message, and code
 */
export interface ValidationError {
  /** Path to the invalid value (e.g., 'user.email', 'items[0].name') */
  path: string
  /** Human-readable error message */
  message: string
  /** Machine-readable error code */
  code: ValidationErrorCode
  /** Expected value or type */
  expected?: string
  /** Received value or type */
  received?: string
}

/**
 * Standard validation error codes
 */
export type ValidationErrorCode =
  | 'invalid_type'
  | 'required'
  | 'too_small'
  | 'too_big'
  | 'invalid_string'
  | 'invalid_enum'
  | 'invalid_literal'
  | 'invalid_union'
  | 'invalid_intersection'
  | 'unrecognized_keys'
  | 'invalid_date'
  | 'custom'
  | 'async_validation_failed'

/**
 * Result of a validation operation
 */
export interface ValidationResult<T = unknown> {
  /** Whether the validation passed */
  valid: boolean
  /** Array of validation errors (empty if valid) */
  errors: ValidationError[]
  /** The validated/transformed value (undefined if invalid) */
  value?: T
}

/**
 * Safe parse result (discriminated union)
 */
export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: ValidationError[] }

// =============================================================================
// Constraints
// =============================================================================

/**
 * String-specific constraints
 */
export interface StringConstraints {
  /** Minimum length */
  minLength?: number
  /** Maximum length */
  maxLength?: number
  /** Exact length */
  length?: number
  /** Regex pattern */
  pattern?: RegExp
  /** Email format */
  email?: boolean
  /** URL format */
  url?: boolean
  /** UUID format */
  uuid?: boolean
  /** CUID format */
  cuid?: boolean
  /** ULID format */
  ulid?: boolean
  /** ISO datetime format */
  datetime?: boolean
  /** IP address format */
  ip?: boolean | { version?: 'v4' | 'v6' }
  /** Emoji validation */
  emoji?: boolean
  /** Starts with */
  startsWith?: string
  /** Ends with */
  endsWith?: string
  /** Contains substring */
  includes?: string
  /** Trim whitespace */
  trim?: boolean
  /** Convert to lowercase */
  toLowerCase?: boolean
  /** Convert to uppercase */
  toUpperCase?: boolean
  /** Custom error message */
  message?: string
}

/**
 * Number-specific constraints
 */
export interface NumberConstraints {
  /** Minimum value */
  min?: number
  /** Maximum value */
  max?: number
  /** Greater than */
  gt?: number
  /** Greater than or equal */
  gte?: number
  /** Less than */
  lt?: number
  /** Less than or equal */
  lte?: number
  /** Must be integer */
  int?: boolean
  /** Must be positive */
  positive?: boolean
  /** Must be negative */
  negative?: boolean
  /** Must be non-negative (>= 0) */
  nonNegative?: boolean
  /** Must be non-positive (<= 0) */
  nonPositive?: boolean
  /** Must be finite */
  finite?: boolean
  /** Must be safe integer */
  safe?: boolean
  /** Must be multiple of */
  multipleOf?: number
  /** Custom error message */
  message?: string
}

/**
 * Array-specific constraints
 */
export interface ArrayConstraints {
  /** Minimum length */
  minLength?: number
  /** Maximum length */
  maxLength?: number
  /** Exact length */
  length?: number
  /** Must be non-empty */
  nonEmpty?: boolean
  /** Elements must be unique */
  unique?: boolean
  /** Custom error message */
  message?: string
}

/**
 * Object-specific constraints
 */
export interface ObjectConstraints {
  /** Strict mode - fail on unknown keys */
  strict?: boolean
  /** Passthrough unknown keys */
  passthrough?: boolean
  /** Strip unknown keys */
  strip?: boolean
  /** Catch all for unknown keys */
  catchall?: Schema
  /** Custom error message */
  message?: string
}

/**
 * Date-specific constraints
 */
export interface DateConstraints {
  /** Minimum date */
  min?: Date
  /** Maximum date */
  max?: Date
  /** Custom error message */
  message?: string
}

/**
 * Combined constraint type
 */
export type Constraint =
  | StringConstraints
  | NumberConstraints
  | ArrayConstraints
  | ObjectConstraints
  | DateConstraints

// =============================================================================
// Coercion
// =============================================================================

/**
 * Coercion configuration for automatic type conversion
 */
export interface CoercionConfig {
  /** Trim string whitespace */
  trim?: boolean
  /** Convert to lowercase */
  lowercase?: boolean
  /** Convert to uppercase */
  uppercase?: boolean
  /** Cast to target type (e.g., string "123" to number 123) */
  cast?: boolean
  /** Parse dates from strings */
  parseDate?: boolean
  /** Parse JSON strings */
  parseJson?: boolean
}

// =============================================================================
// Custom Validators
// =============================================================================

/**
 * Context passed to custom validators
 */
export interface ValidationContext {
  /** Current path in the object */
  path: string[]
  /** Parent object */
  parent?: unknown
  /** Root object */
  root?: unknown
  /** Additional metadata */
  meta?: Record<string, unknown>
}

/**
 * Custom validator function (sync)
 * Returns true for valid, string for error message
 */
export type CustomValidator<T = unknown> = (
  value: T,
  context: ValidationContext
) => boolean | string

/**
 * Async custom validator function
 */
export type AsyncCustomValidator<T = unknown> = (
  value: T,
  context: ValidationContext
) => Promise<boolean | string>

/**
 * Refinement function for additional validation
 */
export type RefinementFunction<T = unknown> = (
  value: T,
  ctx: RefinementContext
) => void | boolean | Promise<void | boolean>

/**
 * Context for refinement functions
 */
export interface RefinementContext {
  addIssue: (issue: { message: string; path?: string[]; code?: ValidationErrorCode }) => void
  path: string[]
}

// =============================================================================
// Schema Definition
// =============================================================================

/**
 * Base schema interface
 */
export interface BaseSchema<T = unknown> {
  /** Schema type identifier */
  readonly _type: SchemaType
  /** Output type (for inference) */
  readonly _output: T
  /** Input type (for inference) */
  readonly _input: unknown
  /** Whether the schema is optional */
  readonly _optional?: boolean
  /** Whether the schema is nullable */
  readonly _nullable?: boolean
  /** Default value */
  readonly _default?: T
  /** Description */
  readonly _description?: string
}

/**
 * String schema definition
 */
export interface StringSchema extends BaseSchema<string> {
  readonly _type: 'string'
  readonly constraints?: StringConstraints
  readonly coercion?: CoercionConfig
  readonly customs?: CustomValidator<string>[]
}

/**
 * Number schema definition
 */
export interface NumberSchema extends BaseSchema<number> {
  readonly _type: 'number'
  readonly constraints?: NumberConstraints
  readonly coercion?: CoercionConfig
  readonly customs?: CustomValidator<number>[]
}

/**
 * Boolean schema definition
 */
export interface BooleanSchema extends BaseSchema<boolean> {
  readonly _type: 'boolean'
  readonly coercion?: CoercionConfig
  readonly customs?: CustomValidator<boolean>[]
}

/**
 * Object schema definition
 */
export interface ObjectSchema<T extends Record<string, unknown> = Record<string, unknown>> extends BaseSchema<T> {
  readonly _type: 'object'
  readonly shape: Record<string, Schema>
  readonly constraints?: ObjectConstraints
  readonly customs?: CustomValidator<T>[]
}

/**
 * Array schema definition
 */
export interface ArraySchema<T = unknown> extends BaseSchema<T[]> {
  readonly _type: 'array'
  readonly element: Schema
  readonly constraints?: ArrayConstraints
  readonly customs?: CustomValidator<T[]>[]
}

/**
 * Date schema definition
 */
export interface DateSchema extends BaseSchema<Date> {
  readonly _type: 'date'
  readonly constraints?: DateConstraints
  readonly coercion?: CoercionConfig
  readonly customs?: CustomValidator<Date>[]
}

/**
 * Literal schema definition
 */
export interface LiteralSchema<T extends string | number | boolean | null | undefined = string> extends BaseSchema<T> {
  readonly _type: 'literal'
  readonly value: T
}

/**
 * Enum schema definition
 */
export interface EnumSchema<T extends string | number = string> extends BaseSchema<T> {
  readonly _type: 'enum'
  readonly values: readonly T[]
}

/**
 * Union schema definition
 */
export interface UnionSchema<T = unknown> extends BaseSchema<T> {
  readonly _type: 'union'
  readonly options: readonly Schema[]
}

/**
 * Intersection schema definition
 */
export interface IntersectionSchema<T = unknown> extends BaseSchema<T> {
  readonly _type: 'intersection'
  readonly schemas: readonly Schema[]
}

/**
 * Tuple schema definition
 */
export interface TupleSchema<T extends readonly unknown[] = readonly unknown[]> extends BaseSchema<T> {
  readonly _type: 'tuple'
  readonly items: readonly Schema[]
  readonly rest?: Schema
}

/**
 * Record schema definition
 */
export interface RecordSchema<K extends string = string, V = unknown> extends BaseSchema<Record<K, V>> {
  readonly _type: 'record'
  readonly keySchema: Schema
  readonly valueSchema: Schema
}

/**
 * Null schema definition
 */
export interface NullSchema extends BaseSchema<null> {
  readonly _type: 'null'
}

/**
 * Undefined schema definition
 */
export interface UndefinedSchema extends BaseSchema<undefined> {
  readonly _type: 'undefined'
}

/**
 * Any schema definition
 */
export interface AnySchema extends BaseSchema<unknown> {
  readonly _type: 'any'
}

/**
 * Union type of all schema types
 */
export type Schema =
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | ObjectSchema
  | ArraySchema
  | DateSchema
  | LiteralSchema
  | EnumSchema
  | UnionSchema
  | IntersectionSchema
  | TupleSchema
  | RecordSchema
  | NullSchema
  | UndefinedSchema
  | AnySchema

// =============================================================================
// Type Inference
// =============================================================================

/**
 * Infer the output type from a schema
 */
export type Infer<S extends Schema> = S['_output']

/**
 * Infer the input type from a schema
 */
export type InferInput<S extends Schema> = S['_input']

// =============================================================================
// Validation Engine Interface
// =============================================================================

/**
 * Validation engine interface
 */
export interface IValidationEngine {
  /**
   * Validate data against a schema
   * @param data The data to validate
   * @param schema The schema to validate against
   * @returns Validation result
   */
  validate<T>(data: unknown, schema: Schema): ValidationResult<T>

  /**
   * Parse and transform data (throws on error)
   * @param data The data to parse
   * @param schema The schema to validate against
   * @returns The parsed value
   * @throws ValidationError[] on validation failure
   */
  parse<T>(data: unknown, schema: Schema): T

  /**
   * Safe parse - non-throwing version
   * @param data The data to parse
   * @param schema The schema to validate against
   * @returns SafeParseResult with success flag
   */
  safeParse<T>(data: unknown, schema: Schema): SafeParseResult<T>

  /**
   * Register a custom validator by name
   * @param name The validator name
   * @param validator The validator function
   */
  register(name: string, validator: CustomValidator): void

  /**
   * Async validation
   * @param data The data to validate
   * @param schema The schema to validate against
   * @returns Promise of validation result
   */
  validateAsync<T>(data: unknown, schema: Schema): Promise<ValidationResult<T>>

  /**
   * Async parse
   * @param data The data to parse
   * @param schema The schema to validate against
   * @returns Promise of parsed value
   */
  parseAsync<T>(data: unknown, schema: Schema): Promise<T>

  /**
   * Safe async parse
   * @param data The data to parse
   * @param schema The schema to validate against
   * @returns Promise of SafeParseResult
   */
  safeParseAsync<T>(data: unknown, schema: Schema): Promise<SafeParseResult<T>>
}

// =============================================================================
// Schema Builder Interface
// =============================================================================

/**
 * String schema builder interface
 */
export interface IStringBuilder {
  // Constraints
  min(length: number, message?: string): IStringBuilder
  max(length: number, message?: string): IStringBuilder
  length(length: number, message?: string): IStringBuilder
  email(message?: string): IStringBuilder
  url(message?: string): IStringBuilder
  uuid(message?: string): IStringBuilder
  cuid(message?: string): IStringBuilder
  ulid(message?: string): IStringBuilder
  regex(pattern: RegExp, message?: string): IStringBuilder
  startsWith(prefix: string, message?: string): IStringBuilder
  endsWith(suffix: string, message?: string): IStringBuilder
  includes(substring: string, message?: string): IStringBuilder
  ip(options?: { version?: 'v4' | 'v6' }, message?: string): IStringBuilder
  datetime(message?: string): IStringBuilder

  // Transformations
  trim(): IStringBuilder
  toLowerCase(): IStringBuilder
  toUpperCase(): IStringBuilder

  // Modifiers
  optional(): IStringBuilder
  nullable(): IStringBuilder
  default(value: string): IStringBuilder
  describe(description: string): IStringBuilder

  // Custom validation
  refine(fn: RefinementFunction<string>, message?: string): IStringBuilder

  // Build
  build(): StringSchema
}

/**
 * Number schema builder interface
 */
export interface INumberBuilder {
  // Constraints
  min(value: number, message?: string): INumberBuilder
  max(value: number, message?: string): INumberBuilder
  gt(value: number, message?: string): INumberBuilder
  gte(value: number, message?: string): INumberBuilder
  lt(value: number, message?: string): INumberBuilder
  lte(value: number, message?: string): INumberBuilder
  int(message?: string): INumberBuilder
  positive(message?: string): INumberBuilder
  negative(message?: string): INumberBuilder
  nonNegative(message?: string): INumberBuilder
  nonPositive(message?: string): INumberBuilder
  finite(message?: string): INumberBuilder
  safe(message?: string): INumberBuilder
  multipleOf(value: number, message?: string): INumberBuilder

  // Modifiers
  optional(): INumberBuilder
  nullable(): INumberBuilder
  default(value: number): INumberBuilder
  describe(description: string): INumberBuilder

  // Custom validation
  refine(fn: RefinementFunction<number>, message?: string): INumberBuilder

  // Build
  build(): NumberSchema
}

/**
 * Object schema builder interface
 */
export interface IObjectBuilder<T extends Record<string, unknown> = Record<string, unknown>> {
  // Constraints
  strict(): IObjectBuilder<T>
  passthrough(): IObjectBuilder<T>
  strip(): IObjectBuilder<T>
  catchall(schema: Schema): IObjectBuilder<T>

  // Shape modifications
  extend<U extends Record<string, Schema>>(shape: U): IObjectBuilder<T>
  merge<U extends Record<string, unknown>>(schema: ObjectSchema<U>): IObjectBuilder<T & U>
  pick<K extends keyof T>(keys: K[]): IObjectBuilder<Pick<T, K>>
  omit<K extends keyof T>(keys: K[]): IObjectBuilder<Omit<T, K>>
  partial(): IObjectBuilder<Partial<T>>
  required(): IObjectBuilder<Required<T>>

  // Modifiers
  optional(): IObjectBuilder<T>
  nullable(): IObjectBuilder<T>
  default(value: T): IObjectBuilder<T>
  describe(description: string): IObjectBuilder<T>

  // Custom validation
  refine(fn: RefinementFunction<T>, message?: string): IObjectBuilder<T>

  // Build
  build(): ObjectSchema<T>
}

/**
 * Array schema builder interface
 */
export interface IArrayBuilder<T = unknown> {
  // Constraints
  min(length: number, message?: string): IArrayBuilder<T>
  max(length: number, message?: string): IArrayBuilder<T>
  length(length: number, message?: string): IArrayBuilder<T>
  nonEmpty(message?: string): IArrayBuilder<T>
  unique(message?: string): IArrayBuilder<T>

  // Modifiers
  optional(): IArrayBuilder<T>
  nullable(): IArrayBuilder<T>
  default(value: T[]): IArrayBuilder<T>
  describe(description: string): IArrayBuilder<T>

  // Custom validation
  refine(fn: RefinementFunction<T[]>, message?: string): IArrayBuilder<T>

  // Build
  build(): ArraySchema<T>
}
