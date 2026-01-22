// Input validation for @dotdo/db - see do-c8s8
// Provides runtime validation for Things, IDs, and query parameters
// Uses existing Zod schemas from schemas.ts and branded-types from branded-types.ts

import { z } from 'zod'
import { DbValidationError } from './errors'
import { createLogger } from './logger'

// Create a scoped logger for validation warnings (using local db logger)
const logger = createLogger('[db/validation]')
import { isThingId, type ThingId } from './branded-types'
import type { StorableData, JsonValue } from './types'
import {
  ThingInputSchema,
  ThingUpdateSchema,
  ThingListOptionsSchema,
  JsonValueSchema,
  AnyIdSchema
} from './schemas'
import {
  DEFAULT_MAX_STRING_LENGTH,
  DEFAULT_MAX_OBJECT_DEPTH,
  DEFAULT_MAX_OBJECT_KEYS,
  DEFAULT_MAX_ARRAY_LENGTH,
  MAX_ID_LENGTH,
  MAX_TYPE_NAME_LENGTH,
  MAX_PAGINATION_LIMIT,
} from './constants'

// =============================================================================
// Validation Configuration
// =============================================================================

/**
 * Configuration for validation behavior
 */
export interface ValidationConfig {
  /** Maximum length for string values (default: 10000) */
  maxStringLength?: number
  /** Maximum depth for nested objects (default: 10) */
  maxObjectDepth?: number
  /** Maximum number of keys in an object (default: 100) */
  maxObjectKeys?: number
  /** Maximum number of items in an array (default: 1000) */
  maxArrayLength?: number
  /** Whether to validate ID format strictly (default: false for backward compatibility) */
  strictIdValidation?: boolean
}

// Track if deprecation warning has been shown to avoid spam (per function)
const _deprecationWarningsShown = new Set<string>()

// Check if we're in a test environment (works in both Node.js and workers)
function isTestEnvironment(): boolean {
  // Check for Node.js process.env (using type assertion for workers compatibility)
  const proc = (globalThis as unknown as { process?: { env?: { NODE_ENV?: string } } }).process
  if (proc?.env?.NODE_ENV === 'test') {
    return true
  }
  // Check for vitest globals
  if (typeof globalThis !== 'undefined' && 'vi' in globalThis) {
    return true
  }
  return false
}

function showDeprecationWarning(functionName: string): void {
  if (!_deprecationWarningsShown.has(functionName) && !isTestEnvironment()) {
    logger.warn(
      `[DEPRECATION] ${functionName}() is deprecated. ` +
      `Use createValidationContext() for context-based validation instead. ` +
      `Global validation config will be removed in v4.0.0.`
    )
    _deprecationWarningsShown.add(functionName)
  }
}

/**
 * Configure global validation settings
 *
 * @deprecated Use createValidationContext() for context-based validation instead.
 * This function is now a no-op. Global validation config has been removed.
 * All validation now uses context-based approach.
 */
export function configureValidation(_config: ValidationConfig): void {
  showDeprecationWarning('configureValidation')
  // No-op: Global config has been removed in favor of context-based validation
  // This function exists only for backward compatibility during migration
}

/**
 * Get current validation configuration
 *
 * @deprecated Use createValidationContext().config for context-based validation instead.
 * This function now always returns the default configuration.
 * Global validation config has been removed.
 */
export function getValidationConfig(): Required<ValidationConfig> {
  showDeprecationWarning('getValidationConfig')
  // Always return defaults - global config has been removed
  return { ...DEFAULT_VALIDATION_CONFIG }
}

/**
 * Reset validation configuration to defaults
 *
 * @deprecated Context-based validation does not require reset.
 * This function is now a no-op since global config has been removed.
 */
export function resetValidationConfig(): void {
  // No-op: Global config has been removed
  // This function exists only for backward compatibility during migration
  _deprecationWarningsShown.clear()
}

// =============================================================================
// Default Validation Config Export
// =============================================================================

/**
 * Default validation configuration values.
 * Exported for use with context-based validation.
 */
export const DEFAULT_VALIDATION_CONFIG: Readonly<Required<ValidationConfig>> = Object.freeze({
  maxStringLength: DEFAULT_MAX_STRING_LENGTH,
  maxObjectDepth: DEFAULT_MAX_OBJECT_DEPTH,
  maxObjectKeys: DEFAULT_MAX_OBJECT_KEYS,
  maxArrayLength: DEFAULT_MAX_ARRAY_LENGTH,
  strictIdValidation: false
})

// Internal default context used by module-level validation functions
// This ensures no global mutable state while maintaining backward compatibility
let _defaultContext: ValidationContext | null = null
function getDefaultContext(): ValidationContext {
  if (!_defaultContext) {
    _defaultContext = createValidationContext()
  }
  return _defaultContext
}

// =============================================================================
// Context-Based Validation (Recommended)
// =============================================================================

/**
 * Validation context that encapsulates configuration and validation methods.
 * Provides isolated validation state without global side effects.
 *
 * @example
 * ```typescript
 * const ctx = createValidationContext({ maxStringLength: 100 })
 * ctx.validateJsonValue(myData) // Uses context-specific config
 * ```
 */
export interface ValidationContext {
  /** The immutable configuration for this context */
  readonly config: Readonly<Required<ValidationConfig>>

  /** Validate that a value is JSON-serializable and within size limits */
  validateJsonValue(value: unknown, path?: string, depth?: number): void

  /** Validate an ID string */
  validateId(id: unknown, fieldName?: string): string

  /** Validate an array of IDs */
  validateIds(ids: unknown, fieldName?: string): string[]

  /** Validate a $type string */
  validateType(type: unknown): string

  /** Validate Thing input data for create operations */
  validateThingInput<T extends StorableData>(data: unknown): T & { $type: string }

  /** Validate Thing update data */
  validateThingUpdate<T extends StorableData>(data: unknown): Partial<T>

  /** Validate list options */
  validateListOptions(options: unknown): { type?: string; limit?: number; offset?: number }

  /** Validate bulk update items */
  validateBulkUpdateItems<T extends StorableData>(items: unknown): Array<{ id: string; data: Partial<T> }>
}

/**
 * Create a validation context with the specified configuration.
 * The returned context is isolated and does not affect global state.
 *
 * @param config - Optional partial configuration to override defaults
 * @returns A new ValidationContext with the merged configuration
 *
 * @example
 * ```typescript
 * // Create context with stricter limits for a specific DO
 * const strictCtx = createValidationContext({
 *   maxStringLength: 100,
 *   maxObjectDepth: 3,
 *   strictIdValidation: true
 * })
 *
 * // Use context for validation
 * strictCtx.validateThingInput({ $type: 'Test', name: 'Alice' })
 * ```
 */
export function createValidationContext(config: ValidationConfig = {}): ValidationContext {
  // Merge with defaults and freeze to prevent mutation
  const mergedConfig: Readonly<Required<ValidationConfig>> = Object.freeze({
    ...DEFAULT_VALIDATION_CONFIG,
    ...config
  })

  // Internal validation functions that use the context's config
  function validateJsonValueInternal(value: unknown, path: string = '', depth: number = 0): void {
    // Check depth
    if (depth > mergedConfig.maxObjectDepth) {
      throw DbValidationError.forField(path || 'root', `exceeds maximum nesting depth of ${mergedConfig.maxObjectDepth}`)
    }

    // Null is valid
    if (value === null) {
      return
    }

    // Undefined is not valid JSON
    if (value === undefined) {
      throw DbValidationError.forField(path || 'root', 'undefined is not a valid JSON value')
    }

    // Primitives
    if (typeof value === 'string') {
      if (value.length > mergedConfig.maxStringLength) {
        throw DbValidationError.forField(path || 'root', `string length ${value.length} exceeds maximum of ${mergedConfig.maxStringLength}`)
      }
      return
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw DbValidationError.forField(path || 'root', 'Infinity and NaN are not valid JSON values')
      }
      return
    }

    if (typeof value === 'boolean') {
      return
    }

    // Arrays
    if (Array.isArray(value)) {
      if (value.length > mergedConfig.maxArrayLength) {
        throw DbValidationError.forField(path || 'root', `array length ${value.length} exceeds maximum of ${mergedConfig.maxArrayLength}`)
      }
      for (let i = 0; i < value.length; i++) {
        validateJsonValueInternal(value[i], `${path}[${i}]`, depth + 1)
      }
      return
    }

    // Objects
    if (typeof value === 'object') {
      const keys = Object.keys(value as object)
      if (keys.length > mergedConfig.maxObjectKeys) {
        throw DbValidationError.forField(path || 'root', `object has ${keys.length} keys, exceeds maximum of ${mergedConfig.maxObjectKeys}`)
      }
      for (const key of keys) {
        const fieldPath = path ? `${path}.${key}` : key
        validateJsonValueInternal((value as Record<string, unknown>)[key], fieldPath, depth + 1)
      }
      return
    }

    // Functions, symbols, etc. are not valid JSON
    throw DbValidationError.forField(path || 'root', `${typeof value} is not a valid JSON value`)
  }

  function validateIdInternal(id: unknown, fieldName: string = 'id'): string {
    if (typeof id !== 'string') {
      throw DbValidationError.forField(fieldName, 'must be a string', id)
    }

    if (id.length === 0) {
      throw DbValidationError.forField(fieldName, 'cannot be empty')
    }

    // Max ID length to prevent abuse
    if (id.length > MAX_ID_LENGTH) {
      throw DbValidationError.forField(fieldName, `exceeds maximum length of ${MAX_ID_LENGTH} characters`)
    }

    // If strict validation is enabled, check ID format
    if (mergedConfig.strictIdValidation && !isThingId(id)) {
      throw DbValidationError.forField(fieldName, 'must match ThingId format (timestamp-random)')
    }

    return id
  }

  function validateIdsInternal(ids: unknown, fieldName: string = 'ids'): string[] {
    if (!Array.isArray(ids)) {
      throw DbValidationError.forField(fieldName, 'must be an array')
    }

    return ids.map((id, index) => validateIdInternal(id, `${fieldName}[${index}]`))
  }

  function validateTypeInternal(type: unknown): string {
    if (typeof type !== 'string') {
      throw DbValidationError.forField('$type', 'must be a string', type)
    }

    if (type.length === 0) {
      throw DbValidationError.forField('$type', 'is required')
    }

    if (type.length > MAX_TYPE_NAME_LENGTH) {
      throw DbValidationError.forField('$type', `exceeds maximum length of ${MAX_TYPE_NAME_LENGTH} characters`)
    }

    // Type should be alphanumeric with optional underscores/hyphens
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(type)) {
      throw DbValidationError.forField(
        '$type',
        'must start with a letter and contain only alphanumeric characters, underscores, or hyphens',
        type
      )
    }

    return type
  }

  function validateThingInputInternal<T extends StorableData = StorableData>(
    data: unknown
  ): T & { $type: string } {
    if (data === null || data === undefined) {
      throw new DbValidationError('Input data is required')
    }

    if (typeof data !== 'object') {
      throw new DbValidationError('Input data must be an object')
    }

    const obj = data as Record<string, unknown>

    // Validate $type is present and valid
    validateTypeInternal(obj['$type'])

    // Validate that user data is JSON-serializable
    for (const [key, value] of Object.entries(obj)) {
      // Skip $type as we've already validated it
      if (key === '$type') continue

      // Disallow overriding system fields
      if (key === '$id' || key === '$createdAt' || key === '$updatedAt') {
        throw DbValidationError.forField(key, 'is a system field and cannot be set on create')
      }

      // Validate the value is JSON-serializable
      validateJsonValueInternal(value, key)
    }

    return data as T & { $type: string }
  }

  function validateThingUpdateInternal<T extends StorableData = StorableData>(
    data: unknown
  ): Partial<T> {
    if (data === null || data === undefined) {
      throw new DbValidationError('Update data is required')
    }

    if (typeof data !== 'object') {
      throw new DbValidationError('Update data must be an object')
    }

    const obj = data as Record<string, unknown>

    // Check for disallowed system field updates
    if ('$id' in obj) {
      throw DbValidationError.forField('$id', 'is immutable and cannot be updated')
    }
    if ('$type' in obj) {
      throw DbValidationError.forField('$type', 'is immutable and cannot be updated')
    }
    if ('$createdAt' in obj) {
      throw DbValidationError.forField('$createdAt', 'is immutable and cannot be updated')
    }

    // Validate each field value
    for (const [key, value] of Object.entries(obj)) {
      // Skip $updatedAt - it's managed by the system but sometimes passed through
      if (key === '$updatedAt') continue

      validateJsonValueInternal(value, key)
    }

    return data as Partial<T>
  }

  function validateListOptionsInternal(options: unknown): { type?: string; limit?: number; offset?: number } {
    if (options === null || options === undefined) {
      return {}
    }

    if (typeof options !== 'object') {
      throw new DbValidationError('List options must be an object')
    }

    const obj = options as Record<string, unknown>
    const validated: { type?: string; limit?: number; offset?: number } = {}

    // Validate type
    if ('type' in obj && obj['type'] !== undefined) {
      if (typeof obj['type'] !== 'string') {
        throw DbValidationError.forField('type', 'must be a string', obj['type'])
      }
      validated.type = obj['type']
    }

    // Validate limit
    if ('limit' in obj && obj['limit'] !== undefined) {
      if (typeof obj['limit'] !== 'number') {
        throw DbValidationError.forField('limit', 'must be a number', obj['limit'])
      }
      if (!Number.isInteger(obj['limit']) || obj['limit'] < 1) {
        throw DbValidationError.forField('limit', 'must be a positive integer', obj['limit'])
      }
      if (obj['limit'] > MAX_PAGINATION_LIMIT) {
        throw DbValidationError.forField('limit', `exceeds maximum of ${MAX_PAGINATION_LIMIT}`, obj['limit'])
      }
      validated.limit = obj['limit']
    }

    // Validate offset
    if ('offset' in obj && obj['offset'] !== undefined) {
      if (typeof obj['offset'] !== 'number') {
        throw DbValidationError.forField('offset', 'must be a number', obj['offset'])
      }
      if (!Number.isInteger(obj['offset']) || obj['offset'] < 0) {
        throw DbValidationError.forField('offset', 'must be a non-negative integer', obj['offset'])
      }
      validated.offset = obj['offset']
    }

    return validated
  }

  function validateBulkUpdateItemsInternal<T extends StorableData = StorableData>(
    items: unknown
  ): Array<{ id: string; data: Partial<T> }> {
    if (!Array.isArray(items)) {
      throw new DbValidationError('Bulk update items must be an array')
    }

    return items.map((item, index) => {
      if (item === null || item === undefined || typeof item !== 'object') {
        throw DbValidationError.forField(`items[${index}]`, 'must be an object')
      }

      const obj = item as Record<string, unknown>

      if (!('id' in obj)) {
        throw DbValidationError.forField(`items[${index}].id`, 'is required')
      }

      if (!('data' in obj)) {
        throw DbValidationError.forField(`items[${index}].data`, 'is required')
      }

      const id = validateIdInternal(obj['id'], `items[${index}].id`)
      const data = validateThingUpdateInternal<T>(obj['data'])

      return { id, data }
    })
  }

  // Return the context object
  return {
    config: mergedConfig,
    validateJsonValue: validateJsonValueInternal,
    validateId: validateIdInternal,
    validateIds: validateIdsInternal,
    validateType: validateTypeInternal,
    validateThingInput: validateThingInputInternal,
    validateThingUpdate: validateThingUpdateInternal,
    validateListOptions: validateListOptionsInternal,
    validateBulkUpdateItems: validateBulkUpdateItemsInternal,
  }
}

/**
 * Execute a function with a specific validation context.
 * Provides a convenient way to run validation with temporary config.
 *
 * @param config - Configuration for the validation context
 * @param fn - Function to execute with the validation context
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * const result = withValidationContext({ maxStringLength: 100 }, (ctx) => {
 *   ctx.validateThingInput({ $type: 'Test', name: 'Alice' })
 *   return 'validated'
 * })
 * ```
 */
export function withValidationContext<T>(
  config: ValidationConfig,
  fn: (ctx: ValidationContext) => T
): T {
  const ctx = createValidationContext(config)
  return fn(ctx)
}

// =============================================================================
// Value Validation
// =============================================================================

/**
 * Validate that a value is JSON-serializable and within size limits
 * @param value - The value to validate
 * @param path - Current path for error messages
 * @param depth - Current nesting depth
 * @throws DbValidationError if validation fails
 */
export function validateJsonValue(value: unknown, path: string = '', depth: number = 0): void {
  const config = getValidationConfig()

  // Check depth
  if (depth > config.maxObjectDepth) {
    throw DbValidationError.forField(path || 'root', `exceeds maximum nesting depth of ${config.maxObjectDepth}`)
  }

  // Null is valid
  if (value === null) {
    return
  }

  // Undefined is not valid JSON
  if (value === undefined) {
    throw DbValidationError.forField(path || 'root', 'undefined is not a valid JSON value')
  }

  // Primitives
  if (typeof value === 'string') {
    if (value.length > config.maxStringLength) {
      throw DbValidationError.forField(path || 'root', `string length ${value.length} exceeds maximum of ${config.maxStringLength}`)
    }
    return
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw DbValidationError.forField(path || 'root', 'Infinity and NaN are not valid JSON values')
    }
    return
  }

  if (typeof value === 'boolean') {
    return
  }

  // Arrays
  if (Array.isArray(value)) {
    if (value.length > config.maxArrayLength) {
      throw DbValidationError.forField(path || 'root', `array length ${value.length} exceeds maximum of ${config.maxArrayLength}`)
    }
    for (let i = 0; i < value.length; i++) {
      validateJsonValue(value[i], `${path}[${i}]`, depth + 1)
    }
    return
  }

  // Objects
  if (typeof value === 'object') {
    const keys = Object.keys(value as object)
    if (keys.length > config.maxObjectKeys) {
      throw DbValidationError.forField(path || 'root', `object has ${keys.length} keys, exceeds maximum of ${config.maxObjectKeys}`)
    }
    for (const key of keys) {
      const fieldPath = path ? `${path}.${key}` : key
      validateJsonValue((value as Record<string, unknown>)[key], fieldPath, depth + 1)
    }
    return
  }

  // Functions, symbols, etc. are not valid JSON
  throw DbValidationError.forField(path || 'root', `${typeof value} is not a valid JSON value`)
}

// =============================================================================
// ID Validation
// =============================================================================

/**
 * Validate an ID string
 * @param id - The ID to validate
 * @param fieldName - Field name for error messages (default: 'id')
 * @throws DbValidationError if validation fails
 */
export function validateId(id: unknown, fieldName: string = 'id'): string {
  if (typeof id !== 'string') {
    throw DbValidationError.forField(fieldName, 'must be a string', id)
  }

  if (id.length === 0) {
    throw DbValidationError.forField(fieldName, 'cannot be empty')
  }

  // Max ID length to prevent abuse
  if (id.length > MAX_ID_LENGTH) {
    throw DbValidationError.forField(fieldName, `exceeds maximum length of ${MAX_ID_LENGTH} characters`)
  }

  const config = getValidationConfig()

  // If strict validation is enabled, check ID format
  if (config.strictIdValidation && !isThingId(id)) {
    throw DbValidationError.forField(fieldName, 'must match ThingId format (timestamp-random)')
  }

  return id
}

/**
 * Validate an array of IDs
 * @param ids - The IDs to validate
 * @param fieldName - Field name for error messages (default: 'ids')
 * @throws DbValidationError if validation fails
 */
export function validateIds(ids: unknown, fieldName: string = 'ids'): string[] {
  if (!Array.isArray(ids)) {
    throw DbValidationError.forField(fieldName, 'must be an array')
  }

  return ids.map((id, index) => validateId(id, `${fieldName}[${index}]`))
}

// =============================================================================
// Type Validation
// =============================================================================

/**
 * Validate a $type string
 * @param type - The type to validate
 * @throws DbValidationError if validation fails
 */
export function validateType(type: unknown): string {
  if (typeof type !== 'string') {
    throw DbValidationError.forField('$type', 'must be a string', type)
  }

  if (type.length === 0) {
    throw DbValidationError.forField('$type', 'is required')
  }

  if (type.length > MAX_TYPE_NAME_LENGTH) {
    throw DbValidationError.forField('$type', `exceeds maximum length of ${MAX_TYPE_NAME_LENGTH} characters`)
  }

  // Type should be alphanumeric with optional underscores/hyphens
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(type)) {
    throw DbValidationError.forField(
      '$type',
      'must start with a letter and contain only alphanumeric characters, underscores, or hyphens',
      type
    )
  }

  return type
}

// =============================================================================
// Thing Validation
// =============================================================================

/**
 * Validation result with typed data
 */
export interface ValidationResult<T> {
  success: boolean
  data?: T
  error?: DbValidationError
}

/**
 * Validate Thing input data for create operations
 * @param data - The input data to validate
 * @throws DbValidationError if validation fails
 */
export function validateThingInput<T extends StorableData = StorableData>(
  data: unknown
): T & { $type: string } {
  if (data === null || data === undefined) {
    throw new DbValidationError('Input data is required')
  }

  if (typeof data !== 'object') {
    throw new DbValidationError('Input data must be an object')
  }

  const obj = data as Record<string, unknown>

  // Validate $type is present and valid
  validateType(obj['$type'])

  // Validate that user data is JSON-serializable
  for (const [key, value] of Object.entries(obj)) {
    // Skip $type as we've already validated it
    if (key === '$type') continue

    // Disallow overriding system fields
    if (key === '$id' || key === '$createdAt' || key === '$updatedAt') {
      throw DbValidationError.forField(key, 'is a system field and cannot be set on create')
    }

    // Validate the value is JSON-serializable
    validateJsonValue(value, key)
  }

  return data as T & { $type: string }
}

/**
 * Validate Thing update data
 * @param data - The update data to validate
 * @throws DbValidationError if validation fails
 */
export function validateThingUpdate<T extends StorableData = StorableData>(
  data: unknown
): Partial<T> {
  if (data === null || data === undefined) {
    throw new DbValidationError('Update data is required')
  }

  if (typeof data !== 'object') {
    throw new DbValidationError('Update data must be an object')
  }

  const obj = data as Record<string, unknown>

  // Check for disallowed system field updates
  if ('$id' in obj) {
    throw DbValidationError.forField('$id', 'is immutable and cannot be updated')
  }
  if ('$type' in obj) {
    throw DbValidationError.forField('$type', 'is immutable and cannot be updated')
  }
  if ('$createdAt' in obj) {
    throw DbValidationError.forField('$createdAt', 'is immutable and cannot be updated')
  }

  // Validate each field value
  for (const [key, value] of Object.entries(obj)) {
    // Skip $updatedAt - it's managed by the system but sometimes passed through
    if (key === '$updatedAt') continue

    validateJsonValue(value, key)
  }

  return data as Partial<T>
}

/**
 * Safely validate Thing input without throwing
 * @param data - The input data to validate
 * @returns ValidationResult with either the validated data or error
 */
export function safeValidateThingInput<T extends StorableData = StorableData>(
  data: unknown
): ValidationResult<T & { $type: string }> {
  try {
    const validated = validateThingInput<T>(data)
    return { success: true, data: validated }
  } catch (error) {
    if (error instanceof DbValidationError) {
      return { success: false, error }
    }
    return {
      success: false,
      error: new DbValidationError(error instanceof Error ? error.message : String(error))
    }
  }
}

/**
 * Safely validate Thing update without throwing
 * @param data - The update data to validate
 * @returns ValidationResult with either the validated data or error
 */
export function safeValidateThingUpdate<T extends StorableData = StorableData>(
  data: unknown
): ValidationResult<Partial<T>> {
  try {
    const validated = validateThingUpdate<T>(data)
    return { success: true, data: validated }
  } catch (error) {
    if (error instanceof DbValidationError) {
      return { success: false, error }
    }
    return {
      success: false,
      error: new DbValidationError(error instanceof Error ? error.message : String(error))
    }
  }
}

// =============================================================================
// List/Query Options Validation
// =============================================================================

/**
 * Validate list options
 * @param options - The options to validate
 * @throws DbValidationError if validation fails
 */
export function validateListOptions(options: unknown): { type?: string; limit?: number; offset?: number } {
  if (options === null || options === undefined) {
    return {}
  }

  if (typeof options !== 'object') {
    throw new DbValidationError('List options must be an object')
  }

  const obj = options as Record<string, unknown>
  const validated: { type?: string; limit?: number; offset?: number } = {}

  // Validate type
  if ('type' in obj && obj['type'] !== undefined) {
    if (typeof obj['type'] !== 'string') {
      throw DbValidationError.forField('type', 'must be a string', obj['type'])
    }
    validated.type = obj['type']
  }

  // Validate limit
  if ('limit' in obj && obj['limit'] !== undefined) {
    if (typeof obj['limit'] !== 'number') {
      throw DbValidationError.forField('limit', 'must be a number', obj['limit'])
    }
    if (!Number.isInteger(obj['limit']) || obj['limit'] < 1) {
      throw DbValidationError.forField('limit', 'must be a positive integer', obj['limit'])
    }
    if (obj['limit'] > MAX_PAGINATION_LIMIT) {
      throw DbValidationError.forField('limit', `exceeds maximum of ${MAX_PAGINATION_LIMIT}`, obj['limit'])
    }
    validated.limit = obj['limit']
  }

  // Validate offset
  if ('offset' in obj && obj['offset'] !== undefined) {
    if (typeof obj['offset'] !== 'number') {
      throw DbValidationError.forField('offset', 'must be a number', obj['offset'])
    }
    if (!Number.isInteger(obj['offset']) || obj['offset'] < 0) {
      throw DbValidationError.forField('offset', 'must be a non-negative integer', obj['offset'])
    }
    validated.offset = obj['offset']
  }

  return validated
}

// =============================================================================
// Bulk Operation Validation
// =============================================================================

/**
 * Validate bulk update items
 * @param items - The items to validate
 * @throws DbValidationError if validation fails
 */
export function validateBulkUpdateItems<T extends StorableData = StorableData>(
  items: unknown
): Array<{ id: string; data: Partial<T> }> {
  if (!Array.isArray(items)) {
    throw new DbValidationError('Bulk update items must be an array')
  }

  return items.map((item, index) => {
    if (item === null || item === undefined || typeof item !== 'object') {
      throw DbValidationError.forField(`items[${index}]`, 'must be an object')
    }

    const obj = item as Record<string, unknown>

    if (!('id' in obj)) {
      throw DbValidationError.forField(`items[${index}].id`, 'is required')
    }

    if (!('data' in obj)) {
      throw DbValidationError.forField(`items[${index}].data`, 'is required')
    }

    const id = validateId(obj['id'], `items[${index}].id`)
    const data = validateThingUpdate<T>(obj['data'])

    return { id, data }
  })
}
