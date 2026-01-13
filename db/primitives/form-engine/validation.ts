/**
 * FormEngine Validation Module
 *
 * Field validation with sync/async support, custom validators, and cross-field validation
 */

import type {
  FormSchema,
  FormField,
  FormData,
  ValidationRule,
  ValidationRuleType,
  FieldError,
  ValidationResult,
  GroupField,
  DateTimeField,
} from './types'
import { getAllFields, getFieldById } from './schema'
import { evaluateConditions } from './conditional'

// ============================================================================
// VALIDATION CONTEXT
// ============================================================================

export interface ValidationContext {
  data: FormData
  schema: FormSchema
  visibility: Record<string, boolean>
  required: Record<string, boolean>
}

// ============================================================================
// VALIDATOR CLASS
// ============================================================================

export interface ValidatorOptions {
  stopOnFirstError?: boolean
}

export class FormValidator {
  private schema: FormSchema
  private options: ValidatorOptions

  constructor(schema: FormSchema, options: ValidatorOptions = {}) {
    this.schema = schema
    this.options = options
  }

  /**
   * Validate form data synchronously
   */
  validate(data: FormData): ValidationResult {
    const errors: FieldError[] = []
    const warnings: FieldError[] = []

    // Evaluate conditional logic to determine visibility and required state
    const conditionState = evaluateConditions(this.schema, data)

    const context: ValidationContext = {
      data,
      schema: this.schema,
      visibility: conditionState.visibility,
      required: conditionState.required,
    }

    // Validate all fields
    const fields = getAllFields(this.schema)

    for (const field of fields) {
      // Skip hidden fields
      if (context.visibility[field.id] === false) {
        continue
      }

      const fieldErrors = this.validateField(field, data, context)
      errors.push(...fieldErrors)

      if (this.options.stopOnFirstError && errors.length > 0) {
        break
      }
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Validate form data asynchronously (for async validators)
   */
  async validateAsync(data: FormData): Promise<ValidationResult> {
    // First run sync validation
    const syncResult = this.validate(data)

    // If sync validation fails and stopOnFirstError is set, return early
    if (!syncResult.valid && this.options.stopOnFirstError) {
      return syncResult
    }

    const errors = [...syncResult.errors]
    const warnings: FieldError[] = [...(syncResult.warnings || [])]

    const conditionState = evaluateConditions(this.schema, data)
    const context: ValidationContext = {
      data,
      schema: this.schema,
      visibility: conditionState.visibility,
      required: conditionState.required,
    }

    // Run async validators
    const fields = getAllFields(this.schema)
    const asyncValidations: Promise<FieldError | null>[] = []

    for (const field of fields) {
      if (context.visibility[field.id] === false) continue

      if (field.validation) {
        for (const rule of field.validation) {
          if (rule.async && rule.type === 'custom' && rule.validate) {
            asyncValidations.push(
              this.runAsyncValidator(field, rule, data, context)
            )
          }
        }
      }
    }

    try {
      const asyncResults = await Promise.all(asyncValidations)
      for (const result of asyncResults) {
        if (result) {
          errors.push(result)
        }
      }
    } catch {
      errors.push({
        field: 'form',
        rule: 'custom',
        message: 'Validation failed due to an error',
      })
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Run an async validator
   */
  private async runAsyncValidator(
    field: FormField,
    rule: ValidationRule,
    data: FormData,
    context: ValidationContext
  ): Promise<FieldError | null> {
    const value = this.getFieldValue(field.id, data)

    try {
      const isValid = await rule.validate!(value, field, context)
      if (!isValid) {
        return {
          field: field.id,
          rule: rule.type,
          message: rule.message || `${field.label} validation failed`,
          value,
        }
      }
    } catch {
      return {
        field: field.id,
        rule: rule.type,
        message: rule.message || `${field.label} validation failed`,
        value,
      }
    }

    return null
  }

  /**
   * Validate a single field
   */
  private validateField(
    field: FormField,
    data: FormData,
    context: ValidationContext
  ): FieldError[] {
    const errors: FieldError[] = []
    const value = this.getFieldValue(field.id, data)
    const path = field.id

    // Check required
    const isRequired = field.required || context.required[field.id]
    if (isRequired) {
      const requiredError = this.validateRequired(field, value, path)
      if (requiredError) {
        errors.push(requiredError)
        // Return early if required fails and we have explicit required rule message
        if (this.options.stopOnFirstError) return errors
      }
    }

    // Skip further validation if value is empty and not required
    // Exception: minLength validation should still apply for empty values
    const hasMinLengthRule = field.validation?.some((r) => r.type === 'minLength')
    if (this.isEmpty(value) && !isRequired && !hasMinLengthRule) {
      return errors
    }

    // Run type-specific validation
    const typeErrors = this.validateByType(field, value, path, context)
    errors.push(...typeErrors)

    // Run custom validation rules
    if (field.validation) {
      for (const rule of field.validation) {
        if (rule.async) continue // Skip async validators in sync validation

        const ruleError = this.validateRule(field, rule, value, path, context)
        if (ruleError) {
          errors.push(ruleError)
          if (this.options.stopOnFirstError) break
        }
      }
    }

    // Validate nested fields in groups
    if (field.type === 'group' && (field as GroupField).fields) {
      const groupField = field as GroupField
      const groupValue = (value as Record<string, unknown>) || {}

      for (const nestedField of groupField.fields) {
        const nestedErrors = this.validateField(nestedField, groupValue, context)
        // Update paths for nested fields
        for (const error of nestedErrors) {
          error.field = `${path}.${error.field}`
        }
        errors.push(...nestedErrors)
      }
    }

    return errors
  }

  /**
   * Validate required field
   */
  private validateRequired(
    field: FormField,
    value: unknown,
    path: string
  ): FieldError | null {
    // For checkboxes with required, they must be checked (true)
    if (field.type === 'checkbox' && !Array.isArray(value)) {
      if (value !== true) {
        return {
          field: path,
          rule: 'required',
          message: `${field.label} is required`,
          value,
        }
      }
      return null
    }

    if (this.isEmpty(value)) {
      return {
        field: path,
        rule: 'required',
        message: `${field.label} is required`,
        value,
      }
    }

    return null
  }

  /**
   * Run type-specific validation
   */
  private validateByType(
    field: FormField,
    value: unknown,
    path: string,
    context: ValidationContext
  ): FieldError[] {
    const errors: FieldError[] = []

    switch (field.type) {
      case 'email':
        if (!this.isValidEmail(value as string)) {
          errors.push({
            field: path,
            rule: 'email',
            message: `${field.label} must be a valid email address`,
            value,
          })
        }
        break

      case 'url':
        if (!this.isValidUrl(value as string)) {
          errors.push({
            field: path,
            rule: 'url',
            message: `${field.label} must be a valid URL`,
            value,
          })
        }
        break

      case 'phone':
        if (!this.isValidPhone(value as string)) {
          errors.push({
            field: path,
            rule: 'phone',
            message: `${field.label} must be a valid phone number`,
            value,
          })
        }
        break

      case 'date':
      case 'datetime':
        const dateField = field as DateTimeField
        const dateErrors = this.validateDate(value as string, dateField, path)
        errors.push(...dateErrors)
        break

      case 'number':
        // Validate min/max from field definition
        if ('min' in field && field.min !== undefined) {
          if ((value as number) < field.min) {
            errors.push({
              field: path,
              rule: 'min',
              message: `${field.label} must be at least ${field.min}`,
              value,
            })
          }
        }
        if ('max' in field && field.max !== undefined) {
          if ((value as number) > field.max) {
            errors.push({
              field: path,
              rule: 'max',
              message: `${field.label} must be at most ${field.max}`,
              value,
            })
          }
        }
        break
    }

    return errors
  }

  /**
   * Validate a single rule
   */
  private validateRule(
    field: FormField,
    rule: ValidationRule,
    value: unknown,
    path: string,
    context: ValidationContext
  ): FieldError | null {
    const str = String(value ?? '')
    const num = typeof value === 'number' ? value : parseFloat(str)

    switch (rule.type) {
      case 'required':
        if (this.isEmpty(value)) {
          return {
            field: path,
            rule: 'required',
            message: rule.message || `${field.label} is required`,
            value,
          }
        }
        break

      case 'minLength':
        if (str.length < (rule.value as number)) {
          return {
            field: path,
            rule: 'minLength',
            message: rule.message || `${field.label} must be at least ${rule.value} characters`,
            value,
          }
        }
        break

      case 'maxLength':
        if (str.length > (rule.value as number)) {
          return {
            field: path,
            rule: 'maxLength',
            message: rule.message || `${field.label} must be at most ${rule.value} characters`,
            value,
          }
        }
        break

      case 'min':
        if (!isNaN(num) && num < (rule.value as number)) {
          return {
            field: path,
            rule: 'min',
            message: rule.message || `${field.label} must be at least ${rule.value}`,
            value,
          }
        }
        break

      case 'max':
        if (!isNaN(num) && num > (rule.value as number)) {
          return {
            field: path,
            rule: 'max',
            message: rule.message || `${field.label} must be at most ${rule.value}`,
            value,
          }
        }
        break

      case 'pattern':
        const pattern = rule.value instanceof RegExp ? rule.value : new RegExp(rule.value as string)
        if (!pattern.test(str)) {
          return {
            field: path,
            rule: 'pattern',
            message: rule.message || `${field.label} format is invalid`,
            value,
          }
        }
        break

      case 'email':
        if (!this.isValidEmail(str)) {
          return {
            field: path,
            rule: 'email',
            message: rule.message || `${field.label} must be a valid email`,
            value,
          }
        }
        break

      case 'url':
        if (!this.isValidUrl(str)) {
          return {
            field: path,
            rule: 'url',
            message: rule.message || `${field.label} must be a valid URL`,
            value,
          }
        }
        break

      case 'phone':
        if (!this.isValidPhone(str)) {
          return {
            field: path,
            rule: 'phone',
            message: rule.message || `${field.label} must be a valid phone number`,
            value,
          }
        }
        break

      case 'date':
        if (!this.isValidDateString(str)) {
          return {
            field: path,
            rule: 'date',
            message: rule.message || `${field.label} must be a valid date`,
            value,
          }
        }
        break

      case 'integer':
        if (!Number.isInteger(num)) {
          return {
            field: path,
            rule: 'integer',
            message: rule.message || `${field.label} must be an integer`,
            value,
          }
        }
        break

      case 'decimal':
        const decimalPlaces = rule.value as number
        const decimalParts = str.split('.')
        if (decimalParts.length === 2 && decimalParts[1].length > decimalPlaces) {
          return {
            field: path,
            rule: 'decimal',
            message: rule.message || `${field.label} must have at most ${decimalPlaces} decimal places`,
            value,
          }
        }
        break

      case 'custom':
        if (rule.validate) {
          const isValid = rule.validate(value, field, context)
          if (isValid instanceof Promise) {
            // Skip async in sync validation
            break
          }
          if (!isValid) {
            return {
              field: path,
              rule: 'custom',
              message: rule.message || `${field.label} is invalid`,
              value,
            }
          }
        }
        break
    }

    return null
  }

  /**
   * Validate date with range constraints
   */
  private validateDate(value: string, field: DateTimeField, path: string): FieldError[] {
    const errors: FieldError[] = []

    if (!this.isValidDateString(value)) {
      errors.push({
        field: path,
        rule: 'date',
        message: `${field.label} must be a valid date`,
        value,
      })
      return errors
    }

    const date = new Date(value)

    if (field.min) {
      const minDate = new Date(field.min)
      if (date < minDate) {
        errors.push({
          field: path,
          rule: 'min',
          message: `${field.label} must be on or after ${field.min}`,
          value,
        })
      }
    }

    if (field.max) {
      const maxDate = new Date(field.max)
      if (date > maxDate) {
        errors.push({
          field: path,
          rule: 'max',
          message: `${field.label} must be on or before ${field.max}`,
          value,
        })
      }
    }

    return errors
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private getFieldValue(fieldId: string, data: FormData): unknown {
    // Handle nested field paths (e.g., "address.city")
    const parts = fieldId.split('.')
    let value: unknown = data

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part]
      } else {
        return undefined
      }
    }

    return value
  }

  private isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === 'string' && value.trim() === '') return true
    if (Array.isArray(value) && value.length === 0) return true
    return false
  }

  private isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  }

  private isValidUrl(value: string): boolean {
    // Must start with http:// or https://
    if (!/^https?:\/\//i.test(value)) {
      return false
    }
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }

  private isValidPhone(value: string): boolean {
    // Allow various phone formats
    const cleaned = value.replace(/[\s\-\(\)\.]/g, '')
    return /^\+?\d{7,15}$/.test(cleaned)
  }

  private isValidDateString(value: string): boolean {
    if (!value) return false

    // Check format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return false

    const date = new Date(value)
    if (isNaN(date.getTime())) return false

    // Validate the date is real (e.g., not Feb 30)
    const [year, month, day] = value.split('-').map(Number)
    const reconstructed = new Date(year, month - 1, day)

    return (
      reconstructed.getFullYear() === year &&
      reconstructed.getMonth() === month - 1 &&
      reconstructed.getDate() === day
    )
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a form validator
 */
export function createValidator(schema: FormSchema, options?: ValidatorOptions): FormValidator {
  return new FormValidator(schema, options)
}

/**
 * Quick validation helper
 */
export function validate(schema: FormSchema, data: FormData, options?: ValidatorOptions): ValidationResult {
  const validator = createValidator(schema, options)
  return validator.validate(data)
}
