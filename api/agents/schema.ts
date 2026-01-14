/**
 * Schema Utilities
 *
 * Provides schema conversion and validation utilities for the unified agent SDK.
 * Supports both Zod schemas and JSON Schema formats.
 *
 * @module agents/schema
 */

import { z } from 'zod'
import type { Schema, JsonSchema } from './types'

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a Zod schema
 *
 * @param schema - The value to check
 * @returns True if the value is a Zod schema instance
 *
 * @example
 * ```ts
 * const zodSchema = z.string()
 * const jsonSchema = { type: 'string' }
 *
 * isZodSchema(zodSchema) // true
 * isZodSchema(jsonSchema) // false
 * ```
 */
export function isZodSchema(schema: unknown): schema is z.ZodType<unknown> {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    '_def' in schema &&
    'parse' in schema
  )
}

/**
 * Check if a value is a JSON Schema
 *
 * @param schema - The value to check
 * @returns True if the value appears to be a JSON Schema object
 */
export function isJsonSchema(schema: unknown): schema is JsonSchema {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    'type' in schema &&
    !('_def' in schema)
  )
}

// ============================================================================
// Zod to JSON Schema Conversion
// ============================================================================

/**
 * Convert a Zod schema to JSON Schema format
 *
 * Supports common Zod types:
 * - Primitives: string, number, boolean
 * - Arrays: z.array()
 * - Objects: z.object()
 * - Enums: z.enum()
 * - Optionals: z.optional(), z.nullable()
 * - Defaults: z.default()
 *
 * @param schema - The Zod schema to convert
 * @returns JSON Schema representation
 *
 * @example
 * ```ts
 * const zodSchema = z.object({
 *   name: z.string().describe('User name'),
 *   age: z.number().optional(),
 * })
 *
 * const jsonSchema = zodToJsonSchema(zodSchema)
 * // {
 * //   type: 'object',
 * //   properties: {
 * //     name: { type: 'string', description: 'User name' },
 * //     age: { type: 'number' }
 * //   },
 * //   required: ['name']
 * // }
 * ```
 */
export function zodToJsonSchema(schema: z.ZodType<unknown>): JsonSchema {
  const def = schema._def as ZodDefType
  const description = (schema as { description?: string }).description
  const zodType = def.type

  switch (zodType) {
    case 'string':
      return buildSchema({ type: 'string', description })

    case 'number':
      return buildSchema({ type: 'number', description })

    case 'boolean':
      return buildSchema({ type: 'boolean', description })

    case 'array':
      return buildSchema({
        type: 'array',
        items: def.element ? zodToJsonSchema(def.element) : { type: 'string' },
        description,
      })

    case 'object':
      return convertZodObject(def, description)

    case 'enum':
      return buildSchema({
        type: 'string',
        enum: def.entries ? Object.values(def.entries) : [],
        description,
      })

    case 'optional':
    case 'nullable':
      return def.innerType ? zodToJsonSchema(def.innerType) : { type: 'string' }

    case 'default':
      if (def.innerType) {
        const jsonSchema = zodToJsonSchema(def.innerType)
        jsonSchema.default = def.defaultValue
        return jsonSchema
      }
      return { type: 'string' }

    default:
      // Fallback for unknown types
      return { type: 'string' }
  }
}

/** Internal type for Zod definition object */
interface ZodDefType {
  type?: string
  shape?: Record<string, z.ZodType<unknown>>
  element?: z.ZodType<unknown>
  entries?: Record<string, string>
  innerType?: z.ZodType<unknown>
  defaultValue?: unknown
}

/** Build a JSON Schema object, filtering out undefined values */
function buildSchema(schema: JsonSchema): JsonSchema {
  return Object.fromEntries(
    Object.entries(schema).filter(([, v]) => v !== undefined)
  ) as JsonSchema
}

/** Convert a Zod object schema to JSON Schema */
function convertZodObject(def: ZodDefType, description?: string): JsonSchema {
  const shape = def.shape ?? {}
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodToJsonSchema(value)
    if (!isOptionalZodType(value)) {
      required.push(key)
    }
  }

  return buildSchema({
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    description,
  })
}

/** Check if a Zod type is optional (optional or has default) */
function isOptionalZodType(schema: z.ZodType<unknown>): boolean {
  const def = schema._def as { type?: string }
  return def.type === 'optional' || def.type === 'default'
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validation result type
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: ValidationError }

/**
 * Custom validation error with path information
 */
export class ValidationError extends Error {
  /** Path to the invalid field */
  readonly path: (string | number)[]
  /** The invalid value that was provided */
  readonly received: unknown
  /** Expected type or constraint */
  readonly expected: string

  constructor(options: {
    message: string
    path: (string | number)[]
    received?: unknown
    expected?: string
  }) {
    super(options.message)
    this.name = 'ValidationError'
    this.path = options.path
    this.received = options.received
    this.expected = options.expected ?? 'unknown'
  }

  /**
   * Format error as a readable string with path
   */
  toString(): string {
    const pathStr = this.path.length > 0 ? ` at "${this.path.join('.')}"` : ''
    return `ValidationError${pathStr}: ${this.message}`
  }
}

/**
 * Validate input against a schema
 *
 * Supports both Zod schemas and JSON Schema (passthrough for JSON Schema).
 * Returns a result object with either the validated data or a detailed error.
 *
 * @param schema - The schema to validate against (Zod or JSON Schema)
 * @param input - The input value to validate
 * @returns Validation result with typed data or error
 *
 * @example
 * ```ts
 * const schema = z.object({
 *   name: z.string(),
 *   age: z.number()
 * })
 *
 * const result = validateInput(schema, { name: 'Alice', age: 30 })
 * if (result.success) {
 *   console.log(result.data.name) // 'Alice'
 * } else {
 *   console.error(result.error.toString())
 * }
 * ```
 */
export function validateInput<T>(
  schema: Schema<T>,
  input: unknown
): ValidationResult<T> {
  if (isZodSchema(schema)) {
    const result = schema.safeParse(input)

    if (result.success) {
      return { success: true, data: result.data }
    }

    // Extract the first error with path info
    const firstIssue = result.error.issues[0]
    const error = new ValidationError({
      message: formatZodError(result.error),
      path: (firstIssue?.path ?? []).filter((p): p is string | number => typeof p === 'string' || typeof p === 'number'),
      received: input,
      expected: firstIssue?.message ?? 'valid input',
    })

    return { success: false, error }
  }

  // For JSON Schema, pass through (would use ajv in production)
  return { success: true, data: input as T }
}

/**
 * Format Zod errors into a readable message with path information
 */
function formatZodError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'root'
    return `${path}: ${issue.message}`
  })

  if (issues.length === 1) {
    return issues[0] ?? 'Unknown validation error'
  }

  return `Validation failed:\n  - ${issues.join('\n  - ')}`
}

// ============================================================================
// Exports
// ============================================================================

export { z }
