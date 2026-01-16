/**
 * Thing Creation Validation
 *
 * Schema validation for Thing creation to ensure data integrity.
 * Uses Zod for runtime validation with helpful error messages.
 *
 * @module lib/validation/thing-validation
 */

import { z } from 'zod'

// ============================================================================
// Constants
// ============================================================================

/**
 * PascalCase regex pattern - must start with uppercase letter
 * followed by alphanumeric characters
 */
const PASCAL_CASE_PATTERN = /^[A-Z][a-zA-Z0-9]*$/

/**
 * Reserved $-prefixed property names that have special meaning
 */
const RESERVED_PROPERTIES = ['$id', '$type', '$version', '$createdAt', '$updatedAt', '_tier'] as const

// ============================================================================
// Validation Schemas
// ============================================================================

/**
 * Schema for validating $type field
 * - Required
 * - Must be a non-empty string
 * - Must be PascalCase (e.g., Customer, Order, ProductItem)
 */
export const thingTypeSchema = z
  .string({
    required_error: '$type is required',
    invalid_type_error: '$type must be a string',
  })
  .min(1, '$type cannot be empty')
  .regex(PASCAL_CASE_PATTERN, '$type must be PascalCase (e.g., Customer, Order)')

/**
 * Schema for validating $id field
 * - Optional (will be auto-generated if not provided)
 * - Must be a non-empty string when provided
 */
export const thingIdSchema = z
  .string({
    invalid_type_error: '$id must be a string',
  })
  .min(1, '$id cannot be empty')
  .optional()

/**
 * Schema for validating Thing creation input
 * - $type: Required, PascalCase
 * - $id: Optional, non-empty string
 * - Additional fields: Validated dynamically (passthrough)
 */
export const createThingInputSchema = z
  .object({
    $type: thingTypeSchema,
    $id: thingIdSchema,
  })
  .passthrough()

/**
 * Schema for validating Thing data (after creation)
 * - $id: Required
 * - $type: Required, PascalCase
 * - $version: Optional, positive integer
 * - $createdAt: Optional, ISO 8601 string
 * - $updatedAt: Optional, ISO 8601 string
 */
export const thingDataSchema = z
  .object({
    $id: z.string().min(1, '$id is required'),
    $type: thingTypeSchema,
    $version: z.number().int().positive().optional(),
    $createdAt: z.string().datetime().optional(),
    $updatedAt: z.string().datetime().optional(),
  })
  .passthrough()

// ============================================================================
// Validation Error Types
// ============================================================================

/**
 * Detailed validation error with field path and message
 */
export interface ValidationErrorDetail {
  field: string
  message: string
  code: string
}

/**
 * Result of Thing validation
 */
export interface ThingValidationResult<T> {
  success: boolean
  data?: T
  errors?: ValidationErrorDetail[]
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate Thing creation input
 *
 * @param input - The input data to validate
 * @returns Validation result with parsed data or errors
 *
 * @example
 * const result = validateCreateThingInput({ $type: 'Customer', name: 'Alice' })
 * if (!result.success) {
 *   console.error(result.errors)
 * }
 */
export function validateCreateThingInput<T extends Record<string, unknown>>(
  input: unknown
): ThingValidationResult<T> {
  const result = createThingInputSchema.safeParse(input)

  if (result.success) {
    return {
      success: true,
      data: result.data as unknown as T,
    }
  }

  return {
    success: false,
    errors: formatZodErrors(result.error),
  }
}

/**
 * Validate Thing data (after creation)
 *
 * @param data - The Thing data to validate
 * @returns Validation result with parsed data or errors
 */
export function validateThingData<T extends Record<string, unknown>>(
  data: unknown
): ThingValidationResult<T> {
  const result = thingDataSchema.safeParse(data)

  if (result.success) {
    return {
      success: true,
      data: result.data as unknown as T,
    }
  }

  return {
    success: false,
    errors: formatZodErrors(result.error),
  }
}

/**
 * Validate that $type is PascalCase
 *
 * @param type - The type string to validate
 * @returns true if valid, error message if invalid
 */
export function validateType(type: unknown): true | string {
  const result = thingTypeSchema.safeParse(type)
  if (result.success) return true
  return result.error.errors[0]?.message ?? '$type validation failed'
}

/**
 * Assert that Thing creation input is valid
 * Throws ThingValidationError if invalid
 *
 * @param input - The input to validate
 * @throws ThingValidationError if validation fails
 */
export function assertValidCreateThingInput(input: unknown): asserts input is Record<string, unknown> & { $type: string } {
  const result = validateCreateThingInput(input)
  if (!result.success) {
    throw new ThingValidationError(result.errors ?? [])
  }
}

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Format Zod errors into ValidationErrorDetail array
 */
function formatZodErrors(error: z.ZodError): ValidationErrorDetail[] {
  return error.errors.map((e) => ({
    field: e.path.join('.') || 'root',
    message: e.message,
    code: e.code,
  }))
}

// ============================================================================
// Custom Error
// ============================================================================

/**
 * Error thrown when Thing validation fails
 */
export class ThingValidationError extends Error {
  public readonly errors: ValidationErrorDetail[]

  constructor(errors: ValidationErrorDetail[]) {
    const messages = errors.map((e) => `${e.field}: ${e.message}`).join('; ')
    super(`Thing validation failed: ${messages}`)
    this.name = 'ThingValidationError'
    this.errors = errors
  }

  /**
   * Get user-friendly error messages
   */
  getMessages(): string[] {
    return this.errors.map((e) => {
      // Format as helpful messages
      if (e.field === '$type' || e.field.includes('$type')) {
        if (e.message.includes('required')) {
          return '$type is required'
        }
        if (e.message.includes('PascalCase')) {
          return '$type must be PascalCase (e.g., Customer, Order)'
        }
      }
      return e.message
    })
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a valid Thing creation input
 */
export function isValidCreateThingInput(input: unknown): input is Record<string, unknown> & { $type: string } {
  return validateCreateThingInput(input).success
}

/**
 * Check if a type string is valid (PascalCase)
 */
export function isValidType(type: unknown): type is string {
  return validateType(type) === true
}

// ============================================================================
// Backward Compatibility Aliases
// ============================================================================

/** @deprecated Use ThingValidationError instead */
export const ThingValidationException = ThingValidationError
