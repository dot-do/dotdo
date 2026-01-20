// RPC Input Validation - validates method arguments against schemas
// Provides type-safe validation for RPC method parameters

import { ValidationError } from './errors'

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
