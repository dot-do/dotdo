// RPC Input Validation - validates method arguments against schemas
// Provides type-safe validation for RPC method parameters
// Supports both custom ArgSchema validation and Zod schema validation

import { z, ZodType, ZodError, ZodIssue } from 'zod'
import { ValidationError } from './errors'

// ============================================================================
// RPC Method Validation
// ============================================================================

/**
 * Type guard that validates an RPC method name.
 *
 * A valid RPC method name:
 * - Must be a string
 * - Must be non-empty
 * - Must start with a letter (a-z, A-Z)
 * - Can only contain alphanumeric characters and dots (for namespacing)
 * - Must not start with underscore (private method convention)
 *
 * @param method - The value to check
 * @returns True if method is a valid RPC method name string
 *
 * @example
 * ```typescript
 * isValidRPCMethod('users.create')  // true
 * isValidRPCMethod('getProfile')    // true
 * isValidRPCMethod('v2.api.list')   // true
 *
 * isValidRPCMethod('')              // false - empty
 * isValidRPCMethod('_private')      // false - starts with underscore
 * isValidRPCMethod('123method')     // false - starts with number
 * isValidRPCMethod('has space')     // false - contains space
 * isValidRPCMethod(null)            // false - not a string
 * ```
 */
export function isValidRPCMethod(method: unknown): method is string {
  return typeof method === 'string' &&
         method.length > 0 &&
         !method.startsWith('_') &&
         /^[a-zA-Z][a-zA-Z0-9.]*$/.test(method)
}

/**
 * Supported primitive types for validation
 */
export type SchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'any'

/**
 * Schema definition for a single argument
 */
export interface ArgSchema {
  /** Argument name for error messages */
  name: string
  /** Expected type of the argument */
  type: SchemaType | SchemaType[]
  /** Whether this argument is required (default: true) */
  required?: boolean
  /** Minimum value for numbers */
  min?: number
  /** Maximum value for numbers */
  max?: number
  /** Minimum length for strings/arrays */
  minLength?: number
  /** Maximum length for strings/arrays */
  maxLength?: number
  /** Regex pattern for strings */
  pattern?: RegExp
  /** Custom validator function */
  validate?: (value: unknown) => boolean | string
}

/**
 * Method schema definition - maps method names to their argument schemas
 */
export interface MethodSchema {
  /** Array of argument schemas in order */
  args: ArgSchema[]
}

/**
 * Registry of method schemas for an RPC target
 */
export type MethodSchemaRegistry = Record<string, MethodSchema>

/**
 * Validation error detail for a single argument
 */
export interface ArgValidationError {
  /** Argument name */
  arg: string
  /** Argument index */
  index: number
  /** Error message */
  message: string
  /** Received value (may be omitted for security) */
  received?: unknown
}

/**
 * Get the runtime type of a value
 */
function getType(value: unknown): SchemaType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'object') {
    return t as SchemaType
  }
  return 'any'
}

/**
 * Check if a value matches the expected type(s)
 */
function matchesType(value: unknown, expectedType: SchemaType | SchemaType[]): boolean {
  const types = Array.isArray(expectedType) ? expectedType : [expectedType]
  const actualType = getType(value)
  return types.some(t => t === 'any' || t === actualType)
}

/**
 * Validate a single argument against its schema
 */
function validateArg(value: unknown, schema: ArgSchema, index: number): ArgValidationError | null {
  const { name, type, required = true, min, max, minLength, maxLength, pattern, validate } = schema

  // Check required
  if (value === undefined) {
    if (required) {
      return { arg: name, index, message: `is required` }
    }
    return null // Optional and not provided - skip other validations
  }

  // Check type
  if (!matchesType(value, type)) {
    const expectedTypes = Array.isArray(type) ? type.join(' | ') : type
    return { arg: name, index, message: `expected ${expectedTypes}, got ${getType(value)}`, received: value }
  }

  // Number validations
  if (typeof value === 'number') {
    if (min !== undefined && value < min) {
      return { arg: name, index, message: `must be at least ${min}`, received: value }
    }
    if (max !== undefined && value > max) {
      return { arg: name, index, message: `must be at most ${max}`, received: value }
    }
    if (!Number.isFinite(value)) {
      return { arg: name, index, message: `must be a finite number`, received: value }
    }
  }

  // String validations
  if (typeof value === 'string') {
    if (minLength !== undefined && value.length < minLength) {
      return { arg: name, index, message: `must be at least ${minLength} characters`, received: value }
    }
    if (maxLength !== undefined && value.length > maxLength) {
      return { arg: name, index, message: `must be at most ${maxLength} characters`, received: value }
    }
    if (pattern !== undefined && !pattern.test(value)) {
      return { arg: name, index, message: `does not match required pattern`, received: value }
    }
  }

  // Array validations
  if (Array.isArray(value)) {
    if (minLength !== undefined && value.length < minLength) {
      return { arg: name, index, message: `must have at least ${minLength} items`, received: value }
    }
    if (maxLength !== undefined && value.length > maxLength) {
      return { arg: name, index, message: `must have at most ${maxLength} items`, received: value }
    }
  }

  // Custom validation
  if (validate) {
    const result = validate(value)
    if (result !== true) {
      const message = typeof result === 'string' ? result : 'failed custom validation'
      return { arg: name, index, message, received: value }
    }
  }

  return null
}

/**
 * Validate RPC method arguments against a schema
 *
 * @param args - The arguments array to validate
 * @param schema - The method schema with argument definitions
 * @throws ValidationError if validation fails
 *
 * @example
 * ```typescript
 * const schema: MethodSchema = {
 *   args: [
 *     { name: 'email', type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
 *     { name: 'age', type: 'number', min: 0, max: 150 },
 *     { name: 'tags', type: 'array', required: false }
 *   ]
 * }
 *
 * validateArgs(['user@example.com', 25], schema) // OK
 * validateArgs(['invalid-email', -5], schema) // Throws ValidationError
 * ```
 */
export function validateArgs(args: unknown[], schema: MethodSchema): void {
  const errors: ArgValidationError[] = []

  // Validate each defined argument
  for (let i = 0; i < schema.args.length; i++) {
    const argSchema = schema.args[i]
    // This should never be undefined since we're iterating within bounds,
    // but TypeScript needs the assertion for strict mode
    if (!argSchema) continue
    const value = args[i]
    const error = validateArg(value, argSchema, i)
    if (error) {
      errors.push(error)
    }
  }

  // If there are errors, throw a ValidationError with all of them
  if (errors.length > 0) {
    const fieldErrors = errors.map(e => ({
      field: `args[${e.index}] (${e.arg})`,
      message: e.message
    }))
    throw ValidationError.withErrors(fieldErrors)
  }
}

/**
 * Create a method schema from a simple definition
 *
 * @example
 * ```typescript
 * const schema = defineMethodSchema([
 *   { name: 'id', type: 'string' },
 *   { name: 'data', type: 'object' }
 * ])
 * ```
 */
export function defineMethodSchema(args: ArgSchema[]): MethodSchema {
  return { args }
}

/**
 * Create a complete schema registry for an RPC target
 *
 * @example
 * ```typescript
 * const schemas = createSchemaRegistry({
 *   'users.create': {
 *     args: [
 *       { name: 'data', type: 'object' }
 *     ]
 *   },
 *   'users.get': {
 *     args: [
 *       { name: 'id', type: 'string', minLength: 1 }
 *     ]
 *   }
 * })
 * ```
 */
export function createSchemaRegistry(schemas: MethodSchemaRegistry): MethodSchemaRegistry {
  return schemas
}

/**
 * Lookup a method schema from a registry, supporting nested paths
 *
 * @param registry - The schema registry
 * @param methodPath - The method path (e.g., 'users.create')
 * @returns The method schema or undefined if not found
 */
export function getMethodSchema(registry: MethodSchemaRegistry, methodPath: string): MethodSchema | undefined {
  return registry[methodPath]
}

/**
 * Helper to create common argument schemas
 */
export const ArgSchemas = {
  /** Required string argument */
  string(name: string, options: Partial<ArgSchema> = {}): ArgSchema {
    return { name, type: 'string', required: true, ...options }
  },

  /** Required number argument */
  number(name: string, options: Partial<ArgSchema> = {}): ArgSchema {
    return { name, type: 'number', required: true, ...options }
  },

  /** Required boolean argument */
  boolean(name: string, options: Partial<ArgSchema> = {}): ArgSchema {
    return { name, type: 'boolean', required: true, ...options }
  },

  /** Required object argument */
  object(name: string, options: Partial<ArgSchema> = {}): ArgSchema {
    return { name, type: 'object', required: true, ...options }
  },

  /** Required array argument */
  array(name: string, options: Partial<ArgSchema> = {}): ArgSchema {
    return { name, type: 'array', required: true, ...options }
  },

  /** Optional string argument */
  optionalString(name: string, options: Partial<ArgSchema> = {}): ArgSchema {
    return { name, type: 'string', required: false, ...options }
  },

  /** Optional number argument */
  optionalNumber(name: string, options: Partial<ArgSchema> = {}): ArgSchema {
    return { name, type: 'number', required: false, ...options }
  },

  /** ID argument (non-empty string) */
  id(name: string = 'id'): ArgSchema {
    return { name, type: 'string', required: true, minLength: 1 }
  },

  /** Email argument with pattern validation */
  email(name: string = 'email'): ArgSchema {
    return {
      name,
      type: 'string',
      required: true,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    }
  },

  /** Positive number argument */
  positiveNumber(name: string): ArgSchema {
    return { name, type: 'number', required: true, min: 0 }
  },

  /** Integer argument */
  integer(name: string, options: Partial<ArgSchema> = {}): ArgSchema {
    return {
      name,
      type: 'number',
      required: true,
      ...options,
      validate: (value) => Number.isInteger(value) || 'must be an integer'
    }
  }
}

// ============================================================================
// Zod Schema Validation
// ============================================================================

/**
 * A Zod schema for a single RPC method argument
 */
export interface ZodArgSchema {
  /** Argument name for error messages */
  name: string
  /** Zod schema for validation */
  schema: ZodType
}

/**
 * Zod-based method schema definition
 */
export interface ZodMethodSchema {
  /** Array of Zod argument schemas in order */
  args: ZodArgSchema[]
}

/**
 * Registry of Zod method schemas for an RPC target
 */
export type ZodMethodSchemaRegistry = Record<string, ZodMethodSchema>

/**
 * Format a Zod error issue into a human-readable message
 */
function formatZodIssue(issue: ZodIssue): string {
  // Handle different issue types with appropriate messages
  switch (issue.code) {
    case 'invalid_type':
      return `expected ${issue.expected}, got ${issue.received}`
    case 'invalid_string':
      if (issue.validation === 'email') return 'invalid email format'
      if (issue.validation === 'url') return 'invalid URL format'
      if (issue.validation === 'uuid') return 'invalid UUID format'
      if (issue.validation === 'regex') return 'does not match required pattern'
      return `invalid string (${issue.validation})`
    case 'too_small':
      if (issue.type === 'string') {
        return issue.minimum === 1 ? 'cannot be empty' : `must be at least ${issue.minimum} characters`
      }
      if (issue.type === 'array') {
        return `must have at least ${issue.minimum} items`
      }
      if (issue.type === 'number') {
        return `must be ${issue.inclusive ? 'at least' : 'greater than'} ${issue.minimum}`
      }
      return `too small (minimum: ${issue.minimum})`
    case 'too_big':
      if (issue.type === 'string') {
        return `must be at most ${issue.maximum} characters`
      }
      if (issue.type === 'array') {
        return `must have at most ${issue.maximum} items`
      }
      if (issue.type === 'number') {
        return `must be ${issue.inclusive ? 'at most' : 'less than'} ${issue.maximum}`
      }
      return `too big (maximum: ${issue.maximum})`
    case 'invalid_enum_value':
      return `must be one of: ${issue.options.join(', ')}`
    case 'invalid_union':
      return 'does not match any of the expected types'
    case 'invalid_literal':
      return `must be ${JSON.stringify(issue.expected)}`
    case 'custom':
      return issue.message
    default:
      return issue.message
  }
}

/**
 * Convert Zod errors to RPC validation error format
 */
export function formatZodErrors(error: ZodError, argName: string, argIndex: number): Array<{ field: string; message: string }> {
  return error.issues.map(issue => {
    const path = issue.path.length > 0 ? `.${issue.path.join('.')}` : ''
    return {
      field: `args[${argIndex}] (${argName}${path})`,
      message: formatZodIssue(issue)
    }
  })
}

/**
 * Validate a single argument against a Zod schema
 *
 * @param value - The value to validate
 * @param schema - The Zod schema to validate against
 * @param argName - The argument name for error messages
 * @param argIndex - The argument index for error messages
 * @returns Array of validation errors (empty if valid)
 */
export function validateZodArg(
  value: unknown,
  schema: ZodType,
  argName: string,
  argIndex: number
): Array<{ field: string; message: string }> {
  const result = schema.safeParse(value)
  if (result.success) {
    return []
  }
  return formatZodErrors(result.error, argName, argIndex)
}

/**
 * Validate RPC method arguments against a Zod-based schema
 *
 * @param args - The arguments array to validate
 * @param schema - The Zod method schema with argument definitions
 * @throws ValidationError if validation fails
 *
 * @example
 * ```typescript
 * const schema: ZodMethodSchema = {
 *   args: [
 *     { name: 'email', schema: z.string().email() },
 *     { name: 'age', schema: z.number().min(0).max(150) },
 *     { name: 'tags', schema: z.array(z.string()).optional() }
 *   ]
 * }
 *
 * validateZodArgs(['user@example.com', 25], schema) // OK
 * validateZodArgs(['invalid-email', -5], schema) // Throws ValidationError
 * ```
 */
export function validateZodArgs(args: unknown[], schema: ZodMethodSchema): void {
  const errors: Array<{ field: string; message: string }> = []

  // Validate each defined argument
  for (let i = 0; i < schema.args.length; i++) {
    const argSchema = schema.args[i]
    if (!argSchema) continue
    const value = args[i]
    const argErrors = validateZodArg(value, argSchema.schema, argSchema.name, i)
    errors.push(...argErrors)
  }

  // If there are errors, throw a ValidationError with all of them
  if (errors.length > 0) {
    throw ValidationError.withErrors(errors)
  }
}

/**
 * Define a Zod-based method schema
 *
 * @example
 * ```typescript
 * const schema = defineZodMethodSchema([
 *   { name: 'id', schema: z.string().min(1) },
 *   { name: 'data', schema: z.object({ name: z.string() }) }
 * ])
 * ```
 */
export function defineZodMethodSchema(args: ZodArgSchema[]): ZodMethodSchema {
  return { args }
}

/**
 * Create a complete Zod schema registry for an RPC target
 *
 * @example
 * ```typescript
 * const schemas = createZodSchemaRegistry({
 *   'users.create': {
 *     args: [
 *       { name: 'data', schema: z.object({ name: z.string(), email: z.string().email() }) }
 *     ]
 *   },
 *   'users.get': {
 *     args: [
 *       { name: 'id', schema: z.string().min(1) }
 *     ]
 *   }
 * })
 * ```
 */
export function createZodSchemaRegistry(schemas: ZodMethodSchemaRegistry): ZodMethodSchemaRegistry {
  return schemas
}

/**
 * Lookup a Zod method schema from a registry
 *
 * @param registry - The Zod schema registry
 * @param methodPath - The method path (e.g., 'users.create')
 * @returns The Zod method schema or undefined if not found
 */
export function getZodMethodSchema(registry: ZodMethodSchemaRegistry, methodPath: string): ZodMethodSchema | undefined {
  return registry[methodPath]
}

/**
 * Helper to create common Zod-based argument schemas
 */
export const ZodArgSchemas = {
  /** Required string argument */
  string(name: string): ZodArgSchema {
    return { name, schema: z.string() }
  },

  /** Required non-empty string argument */
  nonEmptyString(name: string): ZodArgSchema {
    return { name, schema: z.string().min(1) }
  },

  /** Required number argument */
  number(name: string): ZodArgSchema {
    return { name, schema: z.number() }
  },

  /** Required finite number argument (rejects NaN and Infinity) */
  finiteNumber(name: string): ZodArgSchema {
    return { name, schema: z.number().finite() }
  },

  /** Required integer argument */
  integer(name: string): ZodArgSchema {
    return { name, schema: z.number().int() }
  },

  /** Required positive integer argument */
  positiveInt(name: string): ZodArgSchema {
    return { name, schema: z.number().int().positive() }
  },

  /** Required non-negative integer argument */
  nonNegativeInt(name: string): ZodArgSchema {
    return { name, schema: z.number().int().nonnegative() }
  },

  /** Required boolean argument */
  boolean(name: string): ZodArgSchema {
    return { name, schema: z.boolean() }
  },

  /** Required object argument (any shape) */
  object(name: string): ZodArgSchema {
    return { name, schema: z.object({}).passthrough() }
  },

  /** Required array argument (any items) */
  array(name: string): ZodArgSchema {
    return { name, schema: z.array(z.unknown()) }
  },

  /** Optional string argument */
  optionalString(name: string): ZodArgSchema {
    return { name, schema: z.string().optional() }
  },

  /** Optional number argument */
  optionalNumber(name: string): ZodArgSchema {
    return { name, schema: z.number().optional() }
  },

  /** Required ID argument (non-empty string) */
  id(name: string = 'id'): ZodArgSchema {
    return { name, schema: z.string().min(1) }
  },

  /** Required email argument */
  email(name: string = 'email'): ZodArgSchema {
    return { name, schema: z.string().email() }
  },

  /** Required URL argument */
  url(name: string = 'url'): ZodArgSchema {
    return { name, schema: z.string().url() }
  },

  /** Required UUID argument */
  uuid(name: string = 'uuid'): ZodArgSchema {
    return { name, schema: z.string().uuid() }
  },

  /** Required date string (ISO format) argument */
  dateString(name: string = 'date'): ZodArgSchema {
    return { name, schema: z.string().datetime() }
  },

  /** Nullable type (string or null) */
  nullable(name: string, schema: ZodType): ZodArgSchema {
    return { name, schema: schema.nullable() }
  },

  /** Custom schema argument */
  custom<T>(name: string, schema: ZodType<T>): ZodArgSchema {
    return { name, schema }
  }
}

// ============================================================================
// Combined Schema Support (Zod + Custom)
// ============================================================================

/**
 * Union type for method schemas - supports both custom ArgSchema and Zod schemas
 */
export type AnyMethodSchema = MethodSchema | ZodMethodSchema

/**
 * Union type for schema registries - supports both custom and Zod registries
 */
export type AnySchemaRegistry = MethodSchemaRegistry | ZodMethodSchemaRegistry

/**
 * Type guard to check if a schema is a Zod-based schema
 */
export function isZodMethodSchema(schema: AnyMethodSchema): schema is ZodMethodSchema {
  if (!schema.args || schema.args.length === 0) return false
  const firstArg = schema.args[0]
  // ZodArgSchema has 'schema' property with a Zod type
  return firstArg !== undefined && 'schema' in firstArg && firstArg.schema instanceof ZodType
}

/**
 * Validate RPC method arguments against any schema type (custom or Zod)
 *
 * @param args - The arguments array to validate
 * @param schema - The method schema (either custom ArgSchema or Zod)
 * @throws ValidationError if validation fails
 */
export function validateAnyArgs(args: unknown[], schema: AnyMethodSchema): void {
  if (isZodMethodSchema(schema)) {
    validateZodArgs(args, schema)
  } else {
    validateArgs(args, schema)
  }
}

/**
 * Get a method schema from either a custom or Zod registry
 */
export function getAnyMethodSchema(
  registry: AnySchemaRegistry,
  methodPath: string
): AnyMethodSchema | undefined {
  return registry[methodPath]
}

// Re-export Zod for convenience
export { z }
export type { ZodType, ZodError, ZodIssue }
