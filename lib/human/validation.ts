/**
 * Human Input Validation
 *
 * Shared validation logic for human responses including:
 * - Action validation
 * - Form field validation
 * - Schema validation
 * - Custom validation functions
 *
 * Used by both HumanFunctionExecutor and Human DO.
 *
 * @module lib/human/validation
 */

import type { FormDefinition, FormFieldDefinition, HumanResponse } from './channels'

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Error thrown when human response validation fails
 */
export class HumanValidationError extends Error {
  fields?: string[]

  constructor(message: string, fields?: string[]) {
    super(message)
    this.name = 'HumanValidationError'
    this.fields = fields
  }
}

// ============================================================================
// ACTION VALIDATION
// ============================================================================

/**
 * Action definition - can be string or object with value/label
 */
export type ActionDefinition = string | { value: string; label: string; style?: 'primary' | 'danger' | 'default' }

/**
 * Validate that a response action is one of the allowed actions
 */
export function validateAction(
  responseAction: string,
  allowedActions: ActionDefinition[]
): { valid: true } | { valid: false; error: HumanValidationError } {
  const validActions = allowedActions.map((a) => (typeof a === 'string' ? a : a.value))

  if (!validActions.includes(responseAction)) {
    return {
      valid: false,
      error: new HumanValidationError(
        `Invalid action: ${responseAction}. Expected one of: ${validActions.join(', ')}`
      ),
    }
  }

  return { valid: true }
}

// ============================================================================
// FORM VALIDATION
// ============================================================================

/**
 * Result of form validation
 */
export interface FormValidationResult {
  valid: boolean
  error?: HumanValidationError
  data?: Record<string, unknown>
}

/**
 * Validate form data against a form definition
 */
export async function validateForm(
  form: FormDefinition,
  data: Record<string, unknown>,
  applyDefaults: boolean = false
): Promise<FormValidationResult> {
  const errors: string[] = []
  const errorFields: string[] = []
  const processedData = { ...data }

  for (const field of form.fields) {
    let value = data[field.name]

    // Apply defaults if configured
    if (applyDefaults && value === undefined && field.default !== undefined) {
      processedData[field.name] = field.default
      value = field.default
    }

    // Required field validation
    if (field.required) {
      if (value === undefined || value === null || value === '') {
        errors.push(`required field ${field.name} is missing or empty`)
        errorFields.push(field.name)
        continue
      }
    }

    // Skip type validation if no value
    if (value === undefined || value === null) {
      continue
    }

    // Type validation
    const typeError = validateFieldType(field, value)
    if (typeError) {
      errors.push(typeError)
      errorFields.push(field.name)
      continue
    }

    // Custom validation
    if (field.validation && !errorFields.includes(field.name)) {
      const result = await field.validation(value)
      if (result !== true) {
        const message = typeof result === 'string' ? result : `Field '${field.name}' failed validation`
        errors.push(message)
        errorFields.push(field.name)
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: new HumanValidationError(errors.join('; '), errorFields),
    }
  }

  return { valid: true, data: processedData }
}

/**
 * Validate a single field's type
 */
function validateFieldType(field: FormFieldDefinition, value: unknown): string | null {
  switch (field.type) {
    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        return `Field '${field.name}' must be a number but got type ${typeof value}`
      }
      break

    case 'boolean':
      if (typeof value !== 'boolean') {
        return `Field '${field.name}' must be a boolean but got type ${typeof value}`
      }
      break

    case 'select':
      if (field.options && !field.options.includes(value as string)) {
        return `Field '${field.name}' has invalid option '${value}'. Must be one of: ${field.options.join(', ')}`
      }
      break

    case 'multiselect':
      if (!Array.isArray(value)) {
        return `Field '${field.name}' must be an array`
      }
      if (field.options) {
        const invalidOptions = (value as string[]).filter((v) => !field.options!.includes(v))
        if (invalidOptions.length > 0) {
          return `Field '${field.name}' has invalid options: ${invalidOptions.join(', ')}`
        }
      }
      break
  }

  return null
}

// ============================================================================
// SCHEMA VALIDATION
// ============================================================================

/**
 * JSON Schema for validation
 */
export interface ValidationSchema {
  type?: string
  properties?: Record<string, { type: string }>
  required?: string[]
}

/**
 * Schema validation result
 */
export interface SchemaValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validate data against a JSON schema
 */
export function validateSchema(schema: ValidationSchema, data: Record<string, unknown>): SchemaValidationResult {
  const properties = schema.properties
  const required = schema.required

  if (!properties) {
    return { valid: true }
  }

  // Check required fields
  if (required) {
    for (const field of required) {
      if (data[field] === undefined) {
        return { valid: false, error: `Required field '${field}' is missing` }
      }
    }
  }

  // Validate types
  for (const [field, fieldSchema] of Object.entries(properties)) {
    const value = data[field]
    if (value === undefined) continue

    const expectedType = fieldSchema.type
    const actualType = typeof value

    if (expectedType && actualType !== expectedType) {
      return { valid: false, error: `Field '${field}' should be ${expectedType} but got ${actualType}` }
    }
  }

  return { valid: true }
}

// ============================================================================
// CUSTOM VALIDATION
// ============================================================================

/**
 * Context passed to custom validators
 */
export interface ValidationContext {
  taskId: string
  invocationId: string
  channel: string
}

/**
 * Custom validator function signature
 */
export type CustomValidator = (
  response: HumanResponse,
  context?: ValidationContext
) => boolean | string | Promise<boolean | string>

/**
 * Run a custom validator
 */
export async function runCustomValidator(
  validator: CustomValidator,
  response: HumanResponse,
  context?: ValidationContext
): Promise<{ valid: true } | { valid: false; error: HumanValidationError }> {
  // Only pass context if the validator function explicitly accepts 2 args
  const result = validator.length > 1 ? await validator(response, context) : await validator(response)

  if (result !== true) {
    const errorMessage = typeof result === 'string' ? result : 'Validation failed'
    return {
      valid: false,
      error: new HumanValidationError(errorMessage),
    }
  }

  return { valid: true }
}

// ============================================================================
// RESPONSE VALIDATION
// ============================================================================

/**
 * Options for validating a human response
 */
export interface ValidateResponseOptions {
  response: HumanResponse
  actions?: ActionDefinition[]
  form?: FormDefinition
  schema?: ValidationSchema
  customValidator?: CustomValidator
  applyDefaults?: boolean
  context?: ValidationContext
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  error?: HumanValidationError
  processedResponse?: HumanResponse
}

/**
 * Validate a complete human response
 */
export async function validateResponse(options: ValidateResponseOptions): Promise<ValidationResult> {
  const { response, actions, form, schema, customValidator, applyDefaults, context } = options

  let processedResponse = { ...response }

  // Validate action if actions are specified
  if (actions && actions.length > 0) {
    const actionResult = validateAction(response.action, actions)
    if (!actionResult.valid) {
      return { valid: false, error: actionResult.error }
    }
  }

  // Validate form if specified
  if (form) {
    const formResult = await validateForm(form, response.data, applyDefaults)
    if (!formResult.valid) {
      return { valid: false, error: formResult.error }
    }
    if (formResult.data) {
      processedResponse = { ...processedResponse, data: formResult.data }
    }
  }

  // Validate schema if specified
  if (schema) {
    const schemaResult = validateSchema(schema, response.data)
    if (!schemaResult.valid) {
      return { valid: false, error: new HumanValidationError(schemaResult.error!) }
    }
  }

  // Run custom validator if specified
  if (customValidator) {
    const customResult = await runCustomValidator(customValidator, processedResponse, context)
    if (!customResult.valid) {
      return { valid: false, error: customResult.error }
    }
  }

  return { valid: true, processedResponse }
}

export default {
  HumanValidationError,
  validateAction,
  validateForm,
  validateSchema,
  runCustomValidator,
  validateResponse,
}
