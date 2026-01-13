/**
 * DataContract Pipeline Integration
 *
 * Provides DataContract validation as composable pipeline stages.
 *
 * Features:
 * - DataContract as composable pipeline stage
 * - Fail pipeline on validation errors
 * - Pass validation results downstream
 * - Support conditional validation
 *
 * @example
 * ```typescript
 * const pipeline = pipe(
 *   extract(source),
 *   validate(dataContract),  // <-- DataContract stage
 *   transform(mappings),
 *   load(destination)
 * )
 * ```
 */

import { createValidator, type DataContract, type ValidationError, type ValidationOptions, type RuntimeValidationResult } from './index'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result from a validation stage with metadata
 */
export interface ValidationStageResult<T = unknown> {
  /** Whether the data passed validation */
  valid: boolean
  /** The original input data */
  data?: T
  /** Data after type coercion (if coercion enabled) */
  coercedData?: T
  /** Validation errors */
  errors: ValidationError[]
  /** Validation warnings */
  warnings: ValidationError[]
  /** Contract name for traceability */
  contractName: string
  /** Contract version for traceability */
  contractVersion: string
  /** Timing information */
  timing: {
    parseMs: number
    validateMs: number
    totalMs: number
  }
}

/**
 * Options for validation stage
 */
export interface ValidationStageOptions extends Partial<ValidationOptions> {
  /** Callback when validation fails */
  onInvalid?: (data: unknown, errors: ValidationError[]) => void | Promise<void>
  /** Callback when validation succeeds */
  onValid?: (data: unknown) => void | Promise<void>
}

/**
 * Result from conditional validation
 */
export interface ConditionalValidationResult<T = unknown> {
  /** Whether validation was performed */
  validated: boolean
  /** Whether validation was skipped due to condition */
  skipped: boolean
  /** The validation result (if validated) */
  result?: ValidationStageResult<T>
  /** The original data (if skipped) */
  data?: T
}

/**
 * Options for conditional validation
 */
export type ConditionalValidationOptions =
  | { field: string; equals: unknown }
  | { field: string; notEquals: unknown }
  | { field: string; exists: boolean }

/**
 * Condition function type
 */
export type ConditionFn<T = unknown> = (data: T) => boolean | Promise<boolean>

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Error thrown when validation fails in a pipeline
 */
export class DataContractValidationError extends Error {
  public readonly name = 'DataContractValidationError'
  public readonly errors: ValidationError[]
  public readonly contractName: string
  public readonly contractVersion: string
  public readonly data: unknown

  constructor(
    contractName: string,
    contractVersion: string,
    errors: ValidationError[],
    data: unknown
  ) {
    const errorMessages = errors.map((e) => `${e.path}: ${e.message}`).join('; ')
    super(`Validation failed for ${contractName}@${contractVersion}: ${errorMessages}`)
    this.contractName = contractName
    this.contractVersion = contractVersion
    this.errors = errors
    this.data = data
  }
}

// ============================================================================
// SIMPLE VALIDATION STAGE
// ============================================================================

/**
 * Create a simple validation stage that throws on invalid data.
 *
 * Use this when you want validation to fail the pipeline immediately.
 *
 * @example
 * ```typescript
 * const validateUser = validate(userContract)
 *
 * // In a pipeline:
 * const extracted = await extract(source)
 * const validated = await validateUser(extracted)  // throws if invalid
 * const transformed = await transform(validated)
 * ```
 */
export function validate<T = unknown>(
  contract: DataContract,
  options?: Partial<ValidationOptions>
): (data: unknown) => Promise<T> {
  const validator = createValidator<T>(contract, options)

  return async (data: unknown): Promise<T> => {
    const result = validator.validate(data)

    if (!result.valid) {
      throw new DataContractValidationError(
        contract.name,
        contract.version,
        result.errors,
        data
      )
    }

    return (result.coercedData || result.data) as T
  }
}

// ============================================================================
// VALIDATION STAGE WITH RESULTS
// ============================================================================

/**
 * Create a validation stage that returns detailed results without throwing.
 *
 * Use this when you want to handle validation results downstream.
 *
 * @example
 * ```typescript
 * const validateUser = validateStage(userContract)
 *
 * const result = await validateUser(data)
 * if (result.valid) {
 *   await processValidRecord(result.data)
 * } else {
 *   await handleInvalidRecord(result.data, result.errors)
 * }
 * ```
 */
export function validateStage<T = unknown>(
  contract: DataContract,
  options?: ValidationStageOptions
): (data: unknown) => Promise<ValidationStageResult<T>> {
  const validator = createValidator<T>(contract, options)

  return async (data: unknown): Promise<ValidationStageResult<T>> => {
    const result = validator.validate(data)

    // Call callbacks if provided
    if (result.valid && options?.onValid) {
      await options.onValid(data)
    }
    if (!result.valid && options?.onInvalid) {
      await options.onInvalid(data, result.errors)
    }

    return {
      valid: result.valid,
      data: result.data,
      coercedData: result.coercedData,
      errors: result.errors,
      warnings: result.warnings,
      contractName: contract.name,
      contractVersion: contract.version,
      timing: result.timing,
    }
  }
}

// ============================================================================
// COMPOSABLE VALIDATION STAGE FACTORY
// ============================================================================

/**
 * Factory for creating reusable validation stages with configured options.
 *
 * @example
 * ```typescript
 * const userValidationStage = createValidationStage(userContract, {
 *   strictness: 'lenient',
 *   coerce: true,
 *   onInvalid: (data, errors) => console.warn('Invalid user:', errors),
 * })
 *
 * // Use multiple times
 * await userValidationStage(user1)
 * await userValidationStage(user2)
 * ```
 */
export function createValidationStage<T = unknown>(
  contract: DataContract,
  options?: ValidationStageOptions
): (data: unknown) => Promise<ValidationStageResult<T>> {
  return validateStage<T>(contract, options)
}

// ============================================================================
// CONDITIONAL VALIDATION
// ============================================================================

/**
 * Create a validation stage that only validates when a condition is met.
 *
 * @example
 * ```typescript
 * // Validate only premium users
 * const validatePremiumUser = conditionalValidate(
 *   userContract,
 *   (data) => data.tier === 'premium'
 * )
 *
 * // Using field-based condition
 * const validateActiveUsers = conditionalValidate(
 *   userContract,
 *   { field: 'status', equals: 'active' }
 * )
 * ```
 */
export function conditionalValidate<T = unknown>(
  contract: DataContract,
  condition: ConditionFn<T> | ConditionalValidationOptions,
  options?: ValidationStageOptions
): (data: T) => Promise<ConditionalValidationResult<T>> {
  const validateFn = validateStage<T>(contract, options)

  const evaluateCondition = async (data: T): Promise<boolean> => {
    if (typeof condition === 'function') {
      return condition(data)
    }

    const record = data as Record<string, unknown>
    const fieldValue = record[condition.field]

    if ('equals' in condition) {
      return fieldValue === condition.equals
    }
    if ('notEquals' in condition) {
      return fieldValue !== condition.notEquals
    }
    if ('exists' in condition) {
      return condition.exists ? fieldValue !== undefined : fieldValue === undefined
    }

    return false
  }

  return async (data: T): Promise<ConditionalValidationResult<T>> => {
    const shouldValidate = await evaluateCondition(data)

    if (!shouldValidate) {
      return {
        validated: false,
        skipped: true,
        data,
      }
    }

    const result = await validateFn(data)

    return {
      validated: true,
      skipped: false,
      result,
    }
  }
}

// ============================================================================
// BATCH VALIDATION STAGE
// ============================================================================

/**
 * Create a validation stage for batch processing.
 *
 * @example
 * ```typescript
 * const batchValidate = validateBatch(userContract)
 *
 * const results = await batchValidate(users)
 * const validUsers = results.filter(r => r.valid).map(r => r.data)
 * ```
 */
export function validateBatch<T = unknown>(
  contract: DataContract,
  options?: ValidationStageOptions
): (records: unknown[]) => Promise<ValidationStageResult<T>[]> {
  const validateFn = validateStage<T>(contract, options)

  return async (records: unknown[]): Promise<ValidationStageResult<T>[]> => {
    return Promise.all(records.map((record) => validateFn(record)))
  }
}

// ============================================================================
// VALIDATION STAGE WITH RECOVERY
// ============================================================================

/**
 * Create a validation stage with error recovery.
 *
 * @example
 * ```typescript
 * const validateWithRecovery = recoverableValidate(userContract, {
 *   recover: (data, errors) => ({
 *     ...data,
 *     email: data.email || 'unknown@example.com',
 *   })
 * })
 * ```
 */
export function recoverableValidate<T = unknown>(
  contract: DataContract,
  config: {
    recover: (data: unknown, errors: ValidationError[]) => T
    maxRetries?: number
  },
  options?: ValidationStageOptions
): (data: unknown) => Promise<T> {
  const validateFn = validateStage<T>(contract, options)
  const maxRetries = config.maxRetries ?? 1

  return async (data: unknown): Promise<T> => {
    let currentData = data
    let lastResult: ValidationStageResult<T> | null = null

    for (let i = 0; i <= maxRetries; i++) {
      lastResult = await validateFn(currentData)

      if (lastResult.valid) {
        return (lastResult.coercedData || lastResult.data) as T
      }

      if (i < maxRetries) {
        currentData = config.recover(currentData, lastResult.errors)
      }
    }

    // Final attempt failed
    throw new DataContractValidationError(
      contract.name,
      contract.version,
      lastResult!.errors,
      currentData
    )
  }
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type {
  ValidationStageResult,
  ValidationStageOptions,
  ConditionalValidationResult,
  ConditionalValidationOptions,
  ConditionFn,
}
