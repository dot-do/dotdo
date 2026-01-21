// RPC Input Validation - validates method arguments against schemas
// Provides type-safe validation for RPC method parameters

import { ValidationError } from './errors'
import type { RPCMessage } from './transport/types'

// ============================================================================
// URL Validation
// ============================================================================

/**
 * Options for URL validation
 */
export interface URLValidationOptions {
  /**
   * Strict mode requires HTTPS except for localhost/development hosts.
   * @default false
   */
  strict?: boolean
  /**
   * Additional hosts to allow HTTP connections to (in strict mode).
   * Localhost and 127.0.0.1 are always allowed.
   */
  allowedHosts?: string[]
}

/**
 * Localhost patterns that are always allowed with HTTP
 */
const LOCALHOST_PATTERNS = [
  'localhost',
  '127.0.0.1',
  '[::1]',
]

/**
 * Validates an RPC endpoint URL.
 *
 * A valid RPC URL:
 * - Must be a string
 * - Must be a valid URL format
 * - Must use http: or https: protocol
 * - In strict mode, must use https: unless connecting to localhost
 * - Must not contain path traversal sequences
 *
 * @param url - The URL to validate
 * @param options - Validation options
 * @returns True if the URL is valid for RPC communication
 *
 * @example
 * ```typescript
 * isValidRPCUrl('https://api.example.com')           // true
 * isValidRPCUrl('http://api.example.com')            // true (default)
 * isValidRPCUrl('http://api.example.com', { strict: true }) // false
 * isValidRPCUrl('http://localhost:8787', { strict: true })  // true (localhost allowed)
 * isValidRPCUrl('ftp://example.com')                 // false
 * ```
 */
export function isValidRPCUrl(url: unknown, options: URLValidationOptions = {}): url is string {
  // Must be a non-empty string
  if (typeof url !== 'string' || url.length === 0) {
    return false
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return false
  }

  // Only allow http: and https: protocols
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return false
  }

  // Check for path traversal attempts
  // Check the original URL string before parsing, as URL normalization may remove '..'
  const lowerUrl = url.toLowerCase()
  if (
    lowerUrl.includes('..') ||
    lowerUrl.includes('%2e%2e') ||
    lowerUrl.includes('%2e.') ||
    lowerUrl.includes('.%2e')
  ) {
    return false
  }

  // In strict mode, require HTTPS unless connecting to localhost
  if (options.strict && parsedUrl.protocol === 'http:') {
    const hostname = parsedUrl.hostname

    // Check if it's a localhost pattern
    const isLocalhost = LOCALHOST_PATTERNS.some(pattern =>
      hostname === pattern || hostname.startsWith(`${pattern}:`)
    )

    // Check if it's in the allowed hosts list
    const allowedHosts = options.allowedHosts ?? []
    const isAllowedHost = allowedHosts.includes(hostname)

    if (!isLocalhost && !isAllowedHost) {
      return false
    }
  }

  return true
}

// ============================================================================
// Circular Reference Detection
// ============================================================================

/**
 * Checks for circular references in an object graph.
 * Throws an error if a circular reference is detected.
 *
 * This is important for RPC args validation because circular references
 * will cause JSON.stringify to throw an error.
 *
 * @param value - The value to check for circular references
 * @throws Error with 'circular' in the message if a circular reference is found
 *
 * @example
 * ```typescript
 * const obj = { a: 1 }
 * checkCircularReferences(obj) // OK
 *
 * const circular = { a: 1 }
 * circular.self = circular
 * checkCircularReferences(circular) // throws "Detected circular reference"
 * ```
 */
export function checkCircularReferences(value: unknown): void {
  const seen = new Set<object>()

  function check(current: unknown): void {
    // Primitives cannot have circular references
    if (current === null || typeof current !== 'object') {
      return
    }

    // If we've seen this object before, it's a circular reference
    if (seen.has(current)) {
      throw new Error('Detected circular reference in RPC arguments')
    }

    // Mark as seen and recurse into children
    seen.add(current)

    if (Array.isArray(current)) {
      for (const item of current) {
        check(item)
      }
    } else {
      for (const key in current) {
        if (Object.prototype.hasOwnProperty.call(current, key)) {
          check((current as Record<string, unknown>)[key])
        }
      }
    }

    // Note: We do NOT remove from 'seen' after recursion
    // This ensures we detect multiple references to the same object,
    // which while not strictly circular, still breaks JSON.stringify
  }

  check(value)
}

// ============================================================================
// RPC Message Validation
// ============================================================================

/**
 * Validates a complete RPC message before sending.
 *
 * Performs the following validations:
 * 1. Method name is valid (no path traversal, injection, etc.)
 * 2. Args array doesn't contain circular references
 *
 * @param message - The RPC message to validate
 * @throws ValidationError if the message is invalid
 *
 * @example
 * ```typescript
 * validateRPCMessage({ method: 'users.create', args: [{ name: 'Alice' }] }) // OK
 * validateRPCMessage({ method: '../etc/passwd', args: [] }) // throws
 * ```
 */
export function validateRPCMessage(message: RPCMessage): void {
  // Validate method name
  if (!isValidRPCMethod(message.method)) {
    throw ValidationError.forField(
      'method',
      'must start with a letter and contain only alphanumeric characters and dots',
      message.method
    )
  }

  // Validate args don't have circular references
  for (let i = 0; i < message.args.length; i++) {
    try {
      checkCircularReferences(message.args[i])
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      // Rethrow with 'circular' in the message for consistent error handling
      throw new Error(`Detected circular reference at args[${i}]: ${errorMessage}`)
    }
  }
}

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
