/**
 * Runtime Validator with configurable strictness levels
 *
 * Provides high-performance validation with:
 * - Configurable strictness (strict, warn, permissive, lenient, sample, off)
 * - Custom validation functions for business logic
 * - Type coercion for compatible types
 * - Detailed error messages with path information
 * - Batch validation with partial results
 * - Performance timing metrics
 * - CDC/Sync pipeline integration via dead-letter queues
 */

import type { JSONSchema, JSONSchemaType, DataContract, ValidationError } from './index'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Strictness level for validation
 * - strict: Reject invalid data, fail on any validation error, no coercion
 * - warn: Log warnings but allow data, collect all errors
 * - permissive: Silently ignore invalid fields, pass data through
 * - lenient: Attempt type coercion, fail only on critical errors
 * - sample: Only validate a sample of records (for high-throughput)
 * - off: Skip validation entirely (passthrough mode)
 */
export type StrictnessLevel = 'strict' | 'warn' | 'permissive' | 'lenient' | 'sample' | 'off'

/**
 * Error handling strategy
 * - throw: Throw exception on first error
 * - collect: Collect all errors and return them
 * - dead-letter: Send failed records to dead-letter queue
 */
export type ErrorStrategy = 'throw' | 'collect' | 'dead-letter'

/**
 * Custom validation function signature
 * Returns undefined/null for valid, or error message string for invalid
 */
export type CustomValidator<T = unknown> = (
  value: T,
  path: string,
  data: unknown
) => string | undefined | null | ValidationError | ValidationError[]

/**
 * Custom validation rule definition
 */
export interface CustomValidationRule<T = unknown> {
  /** Field path pattern (supports wildcards like 'items[*].price' or 'user.*.email') */
  path: string
  /** Validation function */
  validate: CustomValidator<T>
  /** Optional error message override */
  message?: string
  /** Whether to stop validation on this error */
  stopOnError?: boolean
}

/**
 * Validation options
 */
export interface ValidationOptions {
  strictness: StrictnessLevel
  sampleRate?: number // For 'sample' mode, 0-1 probability
  onError?: ErrorStrategy
  maxErrors?: number // Stop after this many errors
  coerce?: boolean // Enable type coercion (default: true for lenient)
  stripUnknown?: boolean // Remove unknown properties
  deadLetterQueue?: DeadLetterQueue
  /** Custom validation rules */
  customValidators?: CustomValidationRule[]
  /** Context data passed to custom validators */
  context?: Record<string, unknown>
}

/**
 * Dead letter queue interface for failed records
 */
export interface DeadLetterQueue {
  send(record: unknown, errors: ValidationError[], metadata?: Record<string, unknown>): void | Promise<void>
}

/**
 * Performance timing information
 */
export interface ValidationTiming {
  parseMs: number
  validateMs: number
  totalMs: number
}

/**
 * Single record validation result
 */
export interface RuntimeValidationResult<T = unknown> {
  valid: boolean
  data?: T
  coercedData?: T // Data after type coercion
  errors: ValidationError[]
  warnings: ValidationError[]
  timing: ValidationTiming
}

/**
 * Batch validation result
 */
export interface BatchValidationResult<T = unknown> {
  totalRecords: number
  validRecords: number
  invalidRecords: number
  skippedRecords: number // For sample mode
  results: RuntimeValidationResult<T>[]
  errors: Array<{ index: number; errors: ValidationError[] }>
  timing: ValidationTiming & { avgPerRecordMs: number }
  earlyTerminated: boolean
}

/**
 * Coercion result
 */
interface CoercionResult {
  success: boolean
  value: unknown
  coerced: boolean
}

// ============================================================================
// DEFAULT OPTIONS
// ============================================================================

const DEFAULT_OPTIONS: ValidationOptions = {
  strictness: 'strict',
  sampleRate: 0.1,
  onError: 'collect',
  maxErrors: 100,
  coerce: false,
  stripUnknown: false,
}

// ============================================================================
// CONTRACT VALIDATOR
// ============================================================================

/**
 * High-performance runtime validator with configurable strictness
 */
export class ContractValidator<T = unknown> {
  private schema: JSONSchema
  private options: ValidationOptions
  private sampleCounter = 0

  constructor(contract: DataContract, options?: Partial<ValidationOptions>) {
    this.schema = contract.schema
    this.options = { ...DEFAULT_OPTIONS, ...options }

    // Enable coercion by default in lenient mode
    if (this.options.strictness === 'lenient' && options?.coerce === undefined) {
      this.options.coerce = true
    }
  }

  /**
   * Validate a single record
   */
  validate(data: unknown): RuntimeValidationResult<T> {
    const startTime = performance.now()

    // Handle 'off' mode - passthrough
    if (this.options.strictness === 'off') {
      return {
        valid: true,
        data: data as T,
        errors: [],
        warnings: [],
        timing: this.createTiming(startTime, 0),
      }
    }

    // Handle 'permissive' mode - silently ignore invalid fields, pass data through
    if (this.options.strictness === 'permissive') {
      // Still run validation but only for custom validators (business rules)
      const customErrors = this.runCustomValidators(data)
      return {
        valid: true, // Always valid in permissive mode
        data: data as T,
        errors: [], // Suppress schema errors
        warnings: customErrors, // Custom validator failures become warnings
        timing: this.createTiming(startTime, 0),
      }
    }

    // Handle 'sample' mode
    if (this.options.strictness === 'sample') {
      this.sampleCounter++
      const shouldValidate = Math.random() < (this.options.sampleRate ?? 0.1)
      if (!shouldValidate) {
        return {
          valid: true,
          data: data as T,
          errors: [],
          warnings: [],
          timing: this.createTiming(startTime, 0),
        }
      }
    }

    const parseEndTime = performance.now()
    const errors: ValidationError[] = []
    const warnings: ValidationError[] = []
    let coercedData = this.options.coerce ? this.deepClone(data) : data

    // Run schema validation
    this.validateValue(this.schema, coercedData, '', errors, warnings)

    // Run custom validators
    const customErrors = this.runCustomValidators(data)
    errors.push(...customErrors)

    // Apply coercion if enabled
    if (this.options.coerce && errors.length > 0) {
      coercedData = this.deepClone(data)
      const coercedErrors: ValidationError[] = []
      const coercedWarnings: ValidationError[] = []
      coercedData = this.validateWithCoercion(this.schema, coercedData, '', coercedErrors, coercedWarnings)

      // Re-run custom validators on coerced data
      const coercedCustomErrors = this.runCustomValidators(coercedData)
      coercedErrors.push(...coercedCustomErrors)

      // If coercion resolved all errors, use coerced data
      if (coercedErrors.length < errors.length) {
        const isValid = this.options.strictness === 'warn' || coercedErrors.length === 0
        return {
          valid: isValid,
          data: isValid ? (data as T) : undefined,
          coercedData: coercedData as T,
          errors: coercedErrors,
          warnings: [...warnings, ...coercedWarnings],
          timing: this.createTiming(startTime, parseEndTime),
        }
      }
    }

    // Handle errors based on strategy
    const isValid = this.options.strictness === 'warn' || errors.length === 0

    if (!isValid && this.options.onError === 'throw') {
      throw new ValidationException(errors)
    }

    if (!isValid && this.options.onError === 'dead-letter' && this.options.deadLetterQueue) {
      this.options.deadLetterQueue.send(data, errors)
    }

    return {
      valid: isValid,
      data: isValid ? (data as T) : undefined,
      coercedData: this.options.coerce ? (coercedData as T) : undefined,
      errors,
      warnings,
      timing: this.createTiming(startTime, parseEndTime),
    }
  }

  /**
   * Run custom validation rules against data
   */
  private runCustomValidators(data: unknown): ValidationError[] {
    const errors: ValidationError[] = []
    const customValidators = this.options.customValidators

    if (!customValidators || customValidators.length === 0) {
      return errors
    }

    for (const rule of customValidators) {
      const matchedPaths = this.findMatchingPaths(data, rule.path)

      for (const { path, value } of matchedPaths) {
        const result = rule.validate(value, path, data)

        if (result) {
          if (typeof result === 'string') {
            errors.push({
              path,
              message: rule.message || result,
              keyword: 'custom',
              params: { validator: rule.path },
            })
          } else if (Array.isArray(result)) {
            errors.push(...result)
          } else {
            errors.push(result)
          }

          if (rule.stopOnError) {
            return errors
          }
        }
      }
    }

    return errors
  }

  /**
   * Find all paths in data that match a pattern (supports wildcards)
   */
  private findMatchingPaths(data: unknown, pattern: string): Array<{ path: string; value: unknown }> {
    const results: Array<{ path: string; value: unknown }> = []
    const parts = pattern.split('.')

    const traverse = (obj: unknown, partIndex: number, currentPath: string): void => {
      if (partIndex >= parts.length) {
        results.push({ path: currentPath, value: obj })
        return
      }

      const part = parts[partIndex]
      if (obj === null || obj === undefined) {
        return
      }

      // Handle array wildcard [*]
      if (part === '[*]' || part?.includes('[*]')) {
        const fieldName = part.replace('[*]', '')
        const target = fieldName ? (obj as Record<string, unknown>)[fieldName] : obj

        if (Array.isArray(target)) {
          for (let i = 0; i < target.length; i++) {
            const newPath = fieldName
              ? currentPath ? `${currentPath}.${fieldName}[${i}]` : `${fieldName}[${i}]`
              : currentPath ? `${currentPath}[${i}]` : `[${i}]`
            traverse(target[i], partIndex + 1, newPath)
          }
        }
        return
      }

      // Handle object wildcard *
      if (part === '*') {
        if (typeof obj === 'object' && !Array.isArray(obj)) {
          for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            const newPath = currentPath ? `${currentPath}.${key}` : key
            traverse(value, partIndex + 1, newPath)
          }
        }
        return
      }

      // Handle array index notation field[0]
      const arrayMatch = part?.match(/^(\w+)\[(\d+)\]$/)
      if (arrayMatch) {
        const [, fieldName, indexStr] = arrayMatch
        const index = parseInt(indexStr, 10)
        const arr = (obj as Record<string, unknown>)[fieldName!]
        if (Array.isArray(arr) && index < arr.length) {
          const newPath = currentPath ? `${currentPath}.${fieldName}[${index}]` : `${fieldName}[${index}]`
          traverse(arr[index], partIndex + 1, newPath)
        }
        return
      }

      // Normal field access
      if (typeof obj === 'object' && part && part in (obj as Record<string, unknown>)) {
        const newPath = currentPath ? `${currentPath}.${part}` : part
        traverse((obj as Record<string, unknown>)[part], partIndex + 1, newPath)
      }
    }

    traverse(data, 0, '')
    return results
  }

  /**
   * Async validation (for expensive operations or dead-letter queue)
   */
  async validateAsync(data: unknown): Promise<RuntimeValidationResult<T>> {
    const result = this.validate(data)

    // Handle async dead-letter queue
    if (!result.valid && this.options.onError === 'dead-letter' && this.options.deadLetterQueue) {
      await this.options.deadLetterQueue.send(data, result.errors)
    }

    return result
  }

  /**
   * Batch validation with early termination support
   */
  validateBatch(records: unknown[]): BatchValidationResult<T> {
    const startTime = performance.now()
    const results: RuntimeValidationResult<T>[] = []
    const errors: Array<{ index: number; errors: ValidationError[] }> = []
    let validCount = 0
    let invalidCount = 0
    let skippedCount = 0
    let earlyTerminated = false

    for (let i = 0; i < records.length; i++) {
      // Check early termination
      if (this.options.maxErrors && errors.length >= this.options.maxErrors) {
        earlyTerminated = true
        break
      }

      // Sample mode skip tracking
      if (this.options.strictness === 'sample') {
        const shouldValidate = Math.random() < (this.options.sampleRate ?? 0.1)
        if (!shouldValidate) {
          skippedCount++
          results.push({
            valid: true,
            data: records[i] as T,
            errors: [],
            warnings: [],
            timing: { parseMs: 0, validateMs: 0, totalMs: 0 },
          })
          continue
        }
      }

      const result = this.validate(records[i])
      results.push(result)

      if (result.valid) {
        validCount++
      } else {
        invalidCount++
        errors.push({ index: i, errors: result.errors })
      }
    }

    const endTime = performance.now()
    const totalMs = endTime - startTime
    const processedCount = records.length - (earlyTerminated ? records.length - results.length : 0)

    return {
      totalRecords: records.length,
      validRecords: validCount,
      invalidRecords: invalidCount,
      skippedRecords: skippedCount,
      results,
      errors,
      timing: {
        parseMs: 0,
        validateMs: totalMs,
        totalMs,
        avgPerRecordMs: processedCount > 0 ? totalMs / processedCount : 0,
      },
      earlyTerminated,
    }
  }

  /**
   * Streaming validation for large payloads.
   * Processes records as an async generator for memory-efficient handling.
   *
   * @param records - AsyncIterable or Iterable of records to validate
   * @param options - Optional streaming configuration (chunkSize, signal)
   * @yields StreamValidationResult for each record (or chunk of records)
   *
   * @example
   * ```typescript
   * // Process a large stream of records
   * const validator = createValidator(contract)
   * for await (const result of validator.validateStream(asyncRecordStream)) {
   *   if (!result.valid) {
   *     await deadLetterQueue.send(result.data, result.errors)
   *   }
   * }
   * ```
   */
  async *validateStream(
    records: AsyncIterable<unknown> | Iterable<unknown>,
    options?: Partial<StreamValidationOptions>
  ): AsyncGenerator<StreamValidationResult<T>, StreamValidationSummary, undefined> {
    const startTime = performance.now()
    let index = 0
    let validCount = 0
    let invalidCount = 0
    let skippedCount = 0
    let errorCount = 0

    const chunkSize = options?.chunkSize ?? 1
    const signal = options?.signal
    const chunk: StreamValidationResult<T>[] = []

    for await (const record of records) {
      // Check for abort signal
      if (signal?.aborted) {
        break
      }

      // Check max errors for early termination
      if (this.options.maxErrors && errorCount >= this.options.maxErrors) {
        break
      }

      // Handle sample mode
      if (this.options.strictness === 'sample') {
        const shouldValidate = Math.random() < (this.options.sampleRate ?? 0.1)
        if (!shouldValidate) {
          skippedCount++
          const skippedResult: StreamValidationResult<T> = {
            index,
            valid: true,
            data: record as T,
            errors: [],
            warnings: [],
            timing: { parseMs: 0, validateMs: 0, totalMs: 0 },
          }
          index++

          if (chunkSize === 1) {
            yield skippedResult
          } else {
            chunk.push(skippedResult)
            if (chunk.length >= chunkSize) {
              for (const r of chunk) {
                yield r
              }
              chunk.length = 0
            }
          }
          continue
        }
      }

      // Validate the record
      const baseResult = this.validate(record)
      const result: StreamValidationResult<T> = {
        ...baseResult,
        index,
      }

      if (result.valid) {
        validCount++
      } else {
        invalidCount++
        errorCount++
      }

      index++

      // Yield results based on chunk size
      if (chunkSize === 1) {
        yield result
      } else {
        chunk.push(result)
        if (chunk.length >= chunkSize) {
          for (const r of chunk) {
            yield r
          }
          chunk.length = 0
        }
      }
    }

    // Yield any remaining records in the chunk
    for (const r of chunk) {
      yield r
    }

    const endTime = performance.now()
    const totalMs = endTime - startTime
    const processedCount = validCount + invalidCount

    // Return summary as the generator's return value
    return {
      totalRecords: index,
      validRecords: validCount,
      invalidRecords: invalidCount,
      skippedRecords: skippedCount,
      timing: {
        parseMs: 0,
        validateMs: totalMs,
        totalMs,
        avgPerRecordMs: processedCount > 0 ? totalMs / processedCount : 0,
      },
    }
  }

  /**
   * Streaming validation that collects results and returns a batch result.
   * Useful when you want streaming memory characteristics but need all results at once.
   *
   * @param records - AsyncIterable or Iterable of records to validate
   * @param options - Optional streaming configuration
   * @returns Promise<BatchValidationResult<T>>
   */
  async validateStreamToBatch(
    records: AsyncIterable<unknown> | Iterable<unknown>,
    options?: Partial<StreamValidationOptions>
  ): Promise<BatchValidationResult<T>> {
    const results: RuntimeValidationResult<T>[] = []
    const errors: Array<{ index: number; errors: ValidationError[] }> = []
    let validCount = 0
    let invalidCount = 0
    let skippedCount = 0
    const startTime = performance.now()

    const stream = this.validateStream(records, options)
    let iterResult = await stream.next()

    while (!iterResult.done) {
      const result = iterResult.value
      results.push(result)

      if (result.valid) {
        validCount++
      } else {
        invalidCount++
        errors.push({ index: result.index, errors: result.errors })
      }

      iterResult = await stream.next()
    }

    // Get summary from generator return value
    const summary = iterResult.value
    skippedCount = summary?.skippedRecords ?? 0

    const endTime = performance.now()
    const totalMs = endTime - startTime
    const processedCount = results.length - skippedCount

    return {
      totalRecords: results.length,
      validRecords: validCount,
      invalidRecords: invalidCount,
      skippedRecords: skippedCount,
      results,
      errors,
      timing: {
        parseMs: 0,
        validateMs: totalMs,
        totalMs,
        avgPerRecordMs: processedCount > 0 ? totalMs / processedCount : 0,
      },
      earlyTerminated: false,
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private validateValue(schema: JSONSchema, data: unknown, path: string, errors: ValidationError[], warnings: ValidationError[]): void {
    // Handle type validation
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type]
      const actualType = this.getType(data)

      if (!this.isTypeMatch(data, types)) {
        errors.push({
          path: path || 'root',
          message: `Expected ${types.join(' | ')}, got ${actualType}`,
          keyword: 'type',
          params: { expected: types, actual: actualType },
        })
        return
      }
    }

    // Handle null
    if (data === null) {
      return
    }

    // Object validation
    if (this.isObject(data)) {
      this.validateObject(schema, data as Record<string, unknown>, path, errors, warnings)
    }

    // Array validation
    if (Array.isArray(data)) {
      this.validateArray(schema, data, path, errors, warnings)
    }

    // String validation
    if (typeof data === 'string') {
      this.validateString(schema, data, path, errors, warnings)
    }

    // Number validation
    if (typeof data === 'number') {
      this.validateNumber(schema, data, path, errors, warnings)
    }

    // Enum validation
    if (schema.enum !== undefined && !schema.enum.includes(data as string | number | boolean | null)) {
      errors.push({
        path: path || 'root',
        message: `Value must be one of: ${schema.enum.join(', ')}`,
        keyword: 'enum',
        params: { allowedValues: schema.enum },
      })
    }
  }

  private validateWithCoercion(schema: JSONSchema, data: unknown, path: string, errors: ValidationError[], warnings: ValidationError[]): unknown {
    // Handle type validation with coercion
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type]

      if (!this.isTypeMatch(data, types)) {
        const coercionResult = this.coerceType(data, types)
        if (coercionResult.success) {
          data = coercionResult.value
          if (coercionResult.coerced) {
            warnings.push({
              path: path || 'root',
              message: `Coerced value from ${typeof data} to ${types[0]}`,
              keyword: 'coercion',
              params: { from: typeof data, to: types[0] },
            })
          }
        } else {
          errors.push({
            path: path || 'root',
            message: `Cannot coerce ${this.getType(data)} to ${types.join(' | ')}`,
            keyword: 'type',
            params: { expected: types, actual: this.getType(data) },
          })
          return data
        }
      }
    }

    // Handle null
    if (data === null) {
      return data
    }

    // Object validation with coercion
    if (this.isObject(data)) {
      return this.validateObjectWithCoercion(schema, data as Record<string, unknown>, path, errors, warnings)
    }

    // Array validation with coercion
    if (Array.isArray(data)) {
      return this.validateArrayWithCoercion(schema, data, path, errors, warnings)
    }

    // String validation
    if (typeof data === 'string') {
      this.validateString(schema, data, path, errors, warnings)
    }

    // Number validation
    if (typeof data === 'number') {
      this.validateNumber(schema, data, path, errors, warnings)
    }

    // Enum validation
    if (schema.enum !== undefined && !schema.enum.includes(data as string | number | boolean | null)) {
      errors.push({
        path: path || 'root',
        message: `Value must be one of: ${schema.enum.join(', ')}`,
        keyword: 'enum',
        params: { allowedValues: schema.enum },
      })
    }

    return data
  }

  private validateObject(schema: JSONSchema, data: Record<string, unknown>, path: string, errors: ValidationError[], warnings: ValidationError[]): void {
    // Required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (data[field] === undefined) {
          errors.push({
            path: this.joinPath(path, field),
            message: `Missing required field: ${field}`,
            keyword: 'required',
            params: { missingProperty: field },
          })
        }
      }
    }

    // Property validation
    if (schema.properties) {
      for (const [key, value] of Object.entries(data)) {
        const propSchema = schema.properties[key]
        if (propSchema) {
          this.validateValue(propSchema, value, this.joinPath(path, key), errors, warnings)
        } else if (schema.additionalProperties === false) {
          errors.push({
            path: this.joinPath(path, key),
            message: `Additional property not allowed: ${key}`,
            keyword: 'additionalProperties',
            params: { additionalProperty: key },
          })
        }
      }
    }
  }

  private validateObjectWithCoercion(
    schema: JSONSchema,
    data: Record<string, unknown>,
    path: string,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): Record<string, unknown> {
    const result = { ...data }

    // Required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (result[field] === undefined) {
          errors.push({
            path: this.joinPath(path, field),
            message: `Missing required field: ${field}`,
            keyword: 'required',
            params: { missingProperty: field },
          })
        }
      }
    }

    // Property validation with coercion
    if (schema.properties) {
      for (const [key, value] of Object.entries(result)) {
        const propSchema = schema.properties[key]
        if (propSchema) {
          result[key] = this.validateWithCoercion(propSchema, value, this.joinPath(path, key), errors, warnings)
        } else if (schema.additionalProperties === false) {
          if (this.options.stripUnknown) {
            delete result[key]
            warnings.push({
              path: this.joinPath(path, key),
              message: `Stripped unknown property: ${key}`,
              keyword: 'stripUnknown',
              params: { strippedProperty: key },
            })
          } else {
            errors.push({
              path: this.joinPath(path, key),
              message: `Additional property not allowed: ${key}`,
              keyword: 'additionalProperties',
              params: { additionalProperty: key },
            })
          }
        }
      }
    }

    return result
  }

  private validateArray(schema: JSONSchema, data: unknown[], path: string, errors: ValidationError[], warnings: ValidationError[]): void {
    // minItems
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({
        path: path || 'root',
        message: `Array must have at least ${schema.minItems} items`,
        keyword: 'minItems',
        params: { limit: schema.minItems, actual: data.length },
      })
    }

    // maxItems
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({
        path: path || 'root',
        message: `Array must have at most ${schema.maxItems} items`,
        keyword: 'maxItems',
        params: { limit: schema.maxItems, actual: data.length },
      })
    }

    // Items validation
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        this.validateValue(schema.items, data[i], `${path}[${i}]`, errors, warnings)
      }
    }
  }

  private validateArrayWithCoercion(schema: JSONSchema, data: unknown[], path: string, errors: ValidationError[], warnings: ValidationError[]): unknown[] {
    const result = [...data]

    // minItems
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({
        path: path || 'root',
        message: `Array must have at least ${schema.minItems} items`,
        keyword: 'minItems',
        params: { limit: schema.minItems, actual: data.length },
      })
    }

    // maxItems
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({
        path: path || 'root',
        message: `Array must have at most ${schema.maxItems} items`,
        keyword: 'maxItems',
        params: { limit: schema.maxItems, actual: data.length },
      })
    }

    // Items validation with coercion
    if (schema.items) {
      for (let i = 0; i < result.length; i++) {
        result[i] = this.validateWithCoercion(schema.items, result[i], `${path}[${i}]`, errors, warnings)
      }
    }

    return result
  }

  private validateString(schema: JSONSchema, data: string, path: string, errors: ValidationError[], warnings: ValidationError[]): void {
    // minLength
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({
        path: path || 'root',
        message: `String must be at least ${schema.minLength} characters`,
        keyword: 'minLength',
        params: { limit: schema.minLength, actual: data.length },
      })
    }

    // maxLength
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({
        path: path || 'root',
        message: `String must be at most ${schema.maxLength} characters`,
        keyword: 'maxLength',
        params: { limit: schema.maxLength, actual: data.length },
      })
    }

    // pattern
    if (schema.pattern !== undefined) {
      const regex = new RegExp(schema.pattern)
      if (!regex.test(data)) {
        errors.push({
          path: path || 'root',
          message: `String must match pattern: ${schema.pattern}`,
          keyword: 'pattern',
          params: { pattern: schema.pattern },
        })
      }
    }

    // format
    if (schema.format !== undefined) {
      const formatError = this.validateFormat(schema.format, data, path)
      if (formatError) {
        errors.push(formatError)
      }
    }
  }

  private validateNumber(schema: JSONSchema, data: number, path: string, errors: ValidationError[], warnings: ValidationError[]): void {
    // minimum
    if (schema.minimum !== undefined) {
      if (schema.exclusiveMinimum === true) {
        if (data <= schema.minimum) {
          errors.push({
            path: path || 'root',
            message: `Number must be greater than ${schema.minimum}`,
            keyword: 'exclusiveMinimum',
            params: { limit: schema.minimum, actual: data },
          })
        }
      } else if (data < schema.minimum) {
        errors.push({
          path: path || 'root',
          message: `Number must be at least ${schema.minimum}`,
          keyword: 'minimum',
          params: { limit: schema.minimum, actual: data },
        })
      }
    }

    // maximum
    if (schema.maximum !== undefined) {
      if (schema.exclusiveMaximum === true) {
        if (data >= schema.maximum) {
          errors.push({
            path: path || 'root',
            message: `Number must be less than ${schema.maximum}`,
            keyword: 'exclusiveMaximum',
            params: { limit: schema.maximum, actual: data },
          })
        }
      } else if (data > schema.maximum) {
        errors.push({
          path: path || 'root',
          message: `Number must be at most ${schema.maximum}`,
          keyword: 'maximum',
          params: { limit: schema.maximum, actual: data },
        })
      }
    }

    // Integer check
    if (schema.type === 'integer' && !Number.isInteger(data)) {
      errors.push({
        path: path || 'root',
        message: 'Number must be an integer',
        keyword: 'type',
        params: { expected: 'integer', actual: 'number' },
      })
    }
  }

  private validateFormat(format: string, data: string, path: string): ValidationError | null {
    const formatValidators: Record<string, (value: string) => boolean> = {
      email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      uri: (v) => {
        try {
          new URL(v)
          return true
        } catch {
          return false
        }
      },
      'date-time': (v) => !isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v),
      date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
      time: (v) => /^\d{2}:\d{2}:\d{2}/.test(v),
      uuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v),
      ipv4: (v) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every((n) => parseInt(n) <= 255),
      ipv6: (v) => /^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i.test(v),
      hostname: (v) => /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(v),
    }

    const validator = formatValidators[format]
    if (validator && !validator(data)) {
      return {
        path: path || 'root',
        message: `Invalid ${format} format`,
        keyword: 'format',
        params: { format, value: data },
      }
    }

    return null
  }

  // ============================================================================
  // TYPE COERCION
  // ============================================================================

  private coerceType(value: unknown, targetTypes: JSONSchemaType[]): CoercionResult {
    for (const targetType of targetTypes) {
      const result = this.coerceToType(value, targetType)
      if (result.success) {
        return result
      }
    }
    return { success: false, value, coerced: false }
  }

  private coerceToType(value: unknown, targetType: JSONSchemaType): CoercionResult {
    const actualType = typeof value

    // Already correct type
    if (this.isTypeMatch(value, [targetType])) {
      return { success: true, value, coerced: false }
    }

    switch (targetType) {
      case 'string':
        // Coerce primitives to string
        if (actualType === 'number' || actualType === 'boolean') {
          return { success: true, value: String(value), coerced: true }
        }
        if (value instanceof Date) {
          return { success: true, value: value.toISOString(), coerced: true }
        }
        break

      case 'number':
        // Coerce string to number
        if (actualType === 'string') {
          const num = Number(value)
          if (!isNaN(num)) {
            return { success: true, value: num, coerced: true }
          }
        }
        if (actualType === 'boolean') {
          return { success: true, value: value ? 1 : 0, coerced: true }
        }
        break

      case 'integer':
        // Coerce string to integer
        if (actualType === 'string') {
          const num = parseInt(value as string, 10)
          if (!isNaN(num)) {
            return { success: true, value: num, coerced: true }
          }
        }
        // Coerce number to integer
        if (actualType === 'number') {
          return { success: true, value: Math.round(value as number), coerced: true }
        }
        if (actualType === 'boolean') {
          return { success: true, value: value ? 1 : 0, coerced: true }
        }
        break

      case 'boolean':
        // Coerce string to boolean
        if (actualType === 'string') {
          const str = (value as string).toLowerCase()
          if (str === 'true' || str === '1' || str === 'yes') {
            return { success: true, value: true, coerced: true }
          }
          if (str === 'false' || str === '0' || str === 'no' || str === '') {
            return { success: true, value: false, coerced: true }
          }
        }
        // Coerce number to boolean
        if (actualType === 'number') {
          return { success: true, value: value !== 0, coerced: true }
        }
        break

      case 'array':
        // Wrap single value in array
        if (!Array.isArray(value) && value !== null && value !== undefined) {
          return { success: true, value: [value], coerced: true }
        }
        break

      case 'null':
        // Coerce empty string to null
        if (value === '' || value === 'null') {
          return { success: true, value: null, coerced: true }
        }
        break
    }

    return { success: false, value, coerced: false }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private getType(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'number' && Number.isInteger(value)) return 'integer'
    return typeof value
  }

  private isTypeMatch(value: unknown, types: JSONSchemaType[]): boolean {
    const actualType = this.getType(value)

    for (const type of types) {
      if (type === actualType) return true
      // integer matches number
      if (type === 'integer' && typeof value === 'number' && Number.isInteger(value)) return true
      // number matches integer
      if (type === 'number' && actualType === 'integer') return true
    }

    return false
  }

  private isObject(value: unknown): boolean {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  private joinPath(base: string, key: string): string {
    return base ? `${base}.${key}` : key
  }

  private deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepClone(item)) as T
    }
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.deepClone(value)
    }
    return result as T
  }

  private createTiming(startTime: number, parseEndTime: number): ValidationTiming {
    const endTime = performance.now()
    return {
      parseMs: parseEndTime ? parseEndTime - startTime : 0,
      validateMs: endTime - (parseEndTime || startTime),
      totalMs: endTime - startTime,
    }
  }
}

// ============================================================================
// STREAMING VALIDATION
// ============================================================================

/**
 * Streaming validation result yielded for each record
 */
export interface StreamValidationResult<T = unknown> extends RuntimeValidationResult<T> {
  index: number
}

/**
 * Summary statistics from streaming validation
 */
export interface StreamValidationSummary {
  totalRecords: number
  validRecords: number
  invalidRecords: number
  skippedRecords: number
  timing: ValidationTiming & { avgPerRecordMs: number }
}

/**
 * Options for streaming validation
 */
export interface StreamValidationOptions extends ValidationOptions {
  /** Yield results in chunks for better performance (default: 1) */
  chunkSize?: number
  /** Abort signal to cancel streaming */
  signal?: AbortSignal
}

// ============================================================================
// VALIDATION EXCEPTION
// ============================================================================

/**
 * Exception thrown when validation fails in 'throw' error mode
 */
export class ValidationException extends Error {
  public readonly errors: ValidationError[]

  constructor(errors: ValidationError[]) {
    const message = errors.map((e) => `${e.path}: ${e.message}`).join('; ')
    super(`Validation failed: ${message}`)
    this.name = 'ValidationException'
    this.errors = errors
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a validator for a data contract
 */
export function createValidator<T = unknown>(contract: DataContract, options?: Partial<ValidationOptions>): ContractValidator<T> {
  return new ContractValidator<T>(contract, options)
}

/**
 * Quick validation helper
 */
export function validateData<T = unknown>(
  contract: DataContract,
  data: unknown,
  options?: Partial<ValidationOptions>
): RuntimeValidationResult<T> {
  const validator = createValidator<T>(contract, options)
  return validator.validate(data)
}

/**
 * Quick batch validation helper
 */
export function validateBatch<T = unknown>(
  contract: DataContract,
  records: unknown[],
  options?: Partial<ValidationOptions>
): BatchValidationResult<T> {
  const validator = createValidator<T>(contract, options)
  return validator.validateBatch(records)
}
