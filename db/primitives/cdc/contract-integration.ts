/**
 * CDC Contract Integration
 *
 * Integrates DataContract validation with CDC streams for schema-validated change events.
 *
 * Features:
 * - Validate CDC events against contracts
 * - Schema-aware transformations
 * - Handle schema evolution in stream
 * - Dead letter queue for invalid events
 * - Metrics for validation failures
 *
 * @module db/primitives/cdc/contract-integration
 */

import type { ChangeEvent, ChangeOperation } from './change-event'
import {
  type DataContract,
  type JSONSchema,
  type ValidationResult,
  type ValidationError,
  type SchemaRegistry,
  createRegistry,
} from '../data-contract'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Validation strictness levels
 */
export type ValidationMode = 'strict' | 'lenient' | 'warn-only'

/**
 * Action to take when schema violation occurs
 */
export type ViolationAction = 'skip' | 'dead-letter' | 'transform' | 'pass-through'

/**
 * Options for CDC contract validation
 */
export interface CDCContractConfig {
  /** Data contract to validate against, or name for registry lookup */
  contract: DataContract | string
  /** Registry for looking up contracts by name */
  registry?: SchemaRegistry
  /** Validation mode */
  mode?: ValidationMode
  /** Action to take on schema violation */
  onSchemaViolation?: ViolationAction
  /** Whether to validate before state */
  validateBefore?: boolean
  /** Whether to validate after state */
  validateAfter?: boolean
  /** Custom error handler */
  onError?: (event: ChangeEvent, errors: ValidationError[]) => void
  /** Custom transformation on validation failure */
  transformOnFailure?: <T>(event: ChangeEvent<T>, errors: ValidationError[]) => ChangeEvent<T>
  /** Schema version to use (latest if not specified) */
  schemaVersion?: string
}

/**
 * Validated change event with validation metadata
 */
export interface ValidatedChangeEvent<T = unknown> extends ChangeEvent<T> {
  /** Validation result for before state */
  beforeValidation?: ValidationResult
  /** Validation result for after state */
  afterValidation?: ValidationResult
  /** Whether the event passed validation */
  isValid: boolean
  /** Applied transformations */
  transformations?: string[]
  /** Contract used for validation */
  contractName?: string
  /** Contract version used */
  contractVersion?: string
}

/**
 * Dead letter event with failure context
 */
export interface DeadLetterEvent<T = unknown> {
  /** Original event that failed validation */
  originalEvent: ChangeEvent<T>
  /** Validation errors encountered */
  errors: ValidationError[]
  /** Timestamp when event was dead-lettered */
  deadLetteredAt: number
  /** Number of retry attempts */
  retryCount: number
  /** Reason for dead-lettering */
  reason: 'validation_failed' | 'schema_mismatch' | 'transformation_failed'
  /** Contract that caused the failure */
  contractName?: string
  /** Contract version */
  contractVersion?: string
}

/**
 * Schema drift detection result
 */
export interface SchemaDriftReport {
  /** Whether drift was detected */
  hasDrift: boolean
  /** Fields in events but not in schema */
  unexpectedFields: string[]
  /** Fields missing from events but required in schema */
  missingRequiredFields: string[]
  /** Fields with type mismatches */
  typeMismatches: Array<{
    field: string
    expectedType: string
    actualType: string
    sampleValue: unknown
  }>
  /** Sample events analyzed */
  sampleCount: number
  /** Timestamp of analysis */
  analyzedAt: number
}

/**
 * Metrics for contract validation
 */
export interface ContractValidationMetrics {
  /** Total events processed */
  totalEvents: number
  /** Events that passed validation */
  validEvents: number
  /** Events that failed validation */
  invalidEvents: number
  /** Events sent to dead letter queue */
  deadLetteredEvents: number
  /** Events transformed on failure */
  transformedEvents: number
  /** Events skipped */
  skippedEvents: number
  /** Validation errors by type */
  errorsByType: Record<string, number>
  /** Validation errors by field */
  errorsByField: Record<string, number>
  /** Average validation time in ms */
  avgValidationTimeMs: number
  /** Last validation timestamp */
  lastValidationAt: number | null
}

/**
 * Options for the CDC contract stream wrapper
 */
export interface CDCContractStreamOptions<T = unknown> {
  /** Contract configuration */
  config: CDCContractConfig
  /** Handler for valid events */
  onValid?: (event: ValidatedChangeEvent<T>) => Promise<void>
  /** Handler for dead-lettered events */
  onDeadLetter?: (event: DeadLetterEvent<T>) => Promise<void>
  /** Handler for schema drift detection */
  onSchemaDrift?: (report: SchemaDriftReport) => Promise<void>
  /** Enable schema drift detection */
  detectSchemaDrift?: boolean
  /** Sample size for schema drift detection */
  driftSampleSize?: number
  /** Max dead letter queue size */
  maxDeadLetterQueueSize?: number
  /** Enable metrics collection */
  collectMetrics?: boolean
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Validates a change event against a data contract
 */
export function validateChangeEvent<T>(
  event: ChangeEvent<T>,
  contract: DataContract,
  options?: {
    validateBefore?: boolean
    validateAfter?: boolean
    mode?: ValidationMode
  }
): ValidatedChangeEvent<T> {
  const validateBefore = options?.validateBefore ?? true
  const validateAfter = options?.validateAfter ?? true
  const mode = options?.mode ?? 'strict'

  const result: ValidatedChangeEvent<T> = {
    ...event,
    isValid: true,
    contractName: contract.name,
    contractVersion: contract.version,
    transformations: [],
  }

  // Validate before state (for UPDATE/DELETE)
  if (validateBefore && event.before !== null) {
    result.beforeValidation = validateData(event.before, contract.schema, mode)
    if (!result.beforeValidation.valid && mode !== 'warn-only') {
      result.isValid = false
    }
  }

  // Validate after state (for INSERT/UPDATE)
  if (validateAfter && event.after !== null) {
    result.afterValidation = validateData(event.after, contract.schema, mode)
    if (!result.afterValidation.valid && mode !== 'warn-only') {
      result.isValid = false
    }
  }

  return result
}

/**
 * Validates data against a JSON Schema
 */
function validateData(data: unknown, schema: JSONSchema, mode: ValidationMode): ValidationResult {
  const errors: ValidationError[] = []

  if (data === null || data === undefined) {
    return { valid: true, errors: [], data }
  }

  validateValue(data, schema, '', errors, mode)

  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? data : undefined,
  }
}

/**
 * Recursively validates a value against a schema
 */
function validateValue(
  value: unknown,
  schema: JSONSchema,
  path: string,
  errors: ValidationError[],
  mode: ValidationMode
): void {
  // Type validation
  if (schema.type !== undefined) {
    const actualType = getValueType(value)
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type]

    if (!expectedTypes.includes(actualType as typeof expectedTypes[number])) {
      // Special case: integer is also valid as number, and number type accepts integers
      const isIntegerMatchingNumber =
        actualType === 'integer' && expectedTypes.includes('number')
      const isNumberMatchingInteger =
        actualType === 'number' && expectedTypes.includes('integer') && Number.isInteger(value)

      if (!isIntegerMatchingNumber && !isNumberMatchingInteger) {
        if (!(value === null && expectedTypes.includes('null'))) {
          errors.push({
            path: path || 'root',
            message: `Expected ${expectedTypes.join(' | ')}, got ${actualType}`,
            keyword: 'type',
            params: { expected: expectedTypes, actual: actualType },
          })
          if (mode === 'strict') return
        }
      }
    }
  }

  // Object validation
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>

    // Required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (obj[field] === undefined) {
          errors.push({
            path: path ? `${path}.${field}` : field,
            message: `Missing required field: ${field}`,
            keyword: 'required',
            params: { missingProperty: field },
          })
        }
      }
    }

    // Property validation
    if (schema.properties) {
      for (const [key, propValue] of Object.entries(obj)) {
        const propSchema = schema.properties[key]
        if (propSchema) {
          const propPath = path ? `${path}.${key}` : key
          validateValue(propValue, propSchema, propPath, errors, mode)
        } else if (schema.additionalProperties === false) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Additional property not allowed: ${key}`,
            keyword: 'additionalProperties',
            params: { additionalProperty: key },
          })
        }
      }
    }
  }

  // Array validation
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({
        path: path || 'root',
        message: `Array must have at least ${schema.minItems} items`,
        keyword: 'minItems',
        params: { limit: schema.minItems },
      })
    }

    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({
        path: path || 'root',
        message: `Array must have at most ${schema.maxItems} items`,
        keyword: 'maxItems',
        params: { limit: schema.maxItems },
      })
    }

    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const itemPath = path ? `${path}[${i}]` : `[${i}]`
        validateValue(value[i], schema.items, itemPath, errors, mode)
      }
    }
  }

  // String validation
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({
        path: path || 'root',
        message: `String must be at least ${schema.minLength} characters`,
        keyword: 'minLength',
        params: { limit: schema.minLength },
      })
    }

    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({
        path: path || 'root',
        message: `String must be at most ${schema.maxLength} characters`,
        keyword: 'maxLength',
        params: { limit: schema.maxLength },
      })
    }

    if (schema.pattern !== undefined) {
      const regex = new RegExp(schema.pattern)
      if (!regex.test(value)) {
        errors.push({
          path: path || 'root',
          message: `String must match pattern: ${schema.pattern}`,
          keyword: 'pattern',
          params: { pattern: schema.pattern },
        })
      }
    }

    if (schema.enum !== undefined && !schema.enum.includes(value)) {
      errors.push({
        path: path || 'root',
        message: `Value must be one of: ${schema.enum.join(', ')}`,
        keyword: 'enum',
        params: { allowedValues: schema.enum },
      })
    }
  }

  // Number validation
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({
        path: path || 'root',
        message: `Number must be at least ${schema.minimum}`,
        keyword: 'minimum',
        params: { limit: schema.minimum },
      })
    }

    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({
        path: path || 'root',
        message: `Number must be at most ${schema.maximum}`,
        keyword: 'maximum',
        params: { limit: schema.maximum },
      })
    }

    if (schema.type === 'integer' && !Number.isInteger(value)) {
      errors.push({
        path: path || 'root',
        message: 'Number must be an integer',
        keyword: 'type',
        params: { expected: 'integer' },
      })
    }
  }
}

/**
 * Gets the JSON Schema type for a value
 */
function getValueType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer'
  return typeof value
}

/**
 * Detects schema drift between events and a contract
 */
export function detectSchemaDrift<T>(
  events: ChangeEvent<T>[],
  contract: DataContract
): SchemaDriftReport {
  const unexpectedFields = new Set<string>()
  const missingRequiredFields = new Set<string>()
  const typeMismatches: SchemaDriftReport['typeMismatches'] = []
  const seenTypeMismatches = new Set<string>()

  const schemaFields = new Set<string>(Object.keys(contract.schema.properties || {}))
  const requiredFields = new Set<string>(contract.schema.required || [])

  for (const event of events) {
    const records: unknown[] = []
    if (event.before !== null) records.push(event.before)
    if (event.after !== null) records.push(event.after)

    for (const record of records) {
      if (typeof record !== 'object' || record === null) continue

      const recordObj = record as Record<string, unknown>

      // Check for unexpected fields
      for (const field of Object.keys(recordObj)) {
        if (!schemaFields.has(field)) {
          unexpectedFields.add(field)
        }
      }

      // Check for missing required fields
      for (const field of requiredFields) {
        if (!(field in recordObj)) {
          missingRequiredFields.add(field)
        }
      }

      // Check for type mismatches
      if (contract.schema.properties) {
        for (const [field, propSchema] of Object.entries(contract.schema.properties)) {
          if (field in recordObj) {
            const value = recordObj[field]
            const expectedType = propSchema.type
            const actualType = getValueType(value)

            if (expectedType && expectedType !== actualType) {
              // Special case: integer is also number
              if (expectedType === 'number' && actualType === 'integer') continue
              if (expectedType === 'integer' && actualType === 'number' && Number.isInteger(value)) continue

              const key = `${field}:${expectedType}:${actualType}`
              if (!seenTypeMismatches.has(key)) {
                seenTypeMismatches.add(key)
                typeMismatches.push({
                  field,
                  expectedType: String(expectedType),
                  actualType,
                  sampleValue: value,
                })
              }
            }
          }
        }
      }
    }
  }

  return {
    hasDrift:
      unexpectedFields.size > 0 ||
      missingRequiredFields.size > 0 ||
      typeMismatches.length > 0,
    unexpectedFields: Array.from(unexpectedFields),
    missingRequiredFields: Array.from(missingRequiredFields),
    typeMismatches,
    sampleCount: events.length,
    analyzedAt: Date.now(),
  }
}

/**
 * CDC Contract Stream - wraps a CDC stream with contract validation
 */
export class CDCContractStream<T = unknown> {
  private contract: DataContract | null = null
  private registry: SchemaRegistry
  private config: CDCContractConfig
  private options: CDCContractStreamOptions<T>
  private deadLetterQueue: DeadLetterEvent<T>[] = []
  private eventBuffer: ChangeEvent<T>[] = []
  private metrics: ContractValidationMetrics = {
    totalEvents: 0,
    validEvents: 0,
    invalidEvents: 0,
    deadLetteredEvents: 0,
    transformedEvents: 0,
    skippedEvents: 0,
    errorsByType: {},
    errorsByField: {},
    avgValidationTimeMs: 0,
    lastValidationAt: null,
  }
  private totalValidationTimeMs: number = 0

  constructor(options: CDCContractStreamOptions<T>) {
    this.options = options
    this.config = options.config
    this.registry = options.config.registry ?? createRegistry()
  }

  /**
   * Initialize the stream (loads contract if needed)
   */
  async initialize(): Promise<void> {
    if (typeof this.config.contract === 'string') {
      // Load contract from registry
      this.contract = await this.registry.get(
        this.config.contract,
        this.config.schemaVersion
      )
    } else {
      this.contract = this.config.contract
    }
  }

  /**
   * Process a single change event
   */
  async processEvent(event: ChangeEvent<T>): Promise<ValidatedChangeEvent<T> | null> {
    if (!this.contract) {
      throw new Error('Stream not initialized. Call initialize() first.')
    }

    const startTime = performance.now()
    this.metrics.totalEvents++

    try {
      // Validate the event
      const validated = validateChangeEvent(event, this.contract, {
        validateBefore: this.config.validateBefore ?? true,
        validateAfter: this.config.validateAfter ?? true,
        mode: this.config.mode ?? 'strict',
      })

      const validationTime = performance.now() - startTime
      this.totalValidationTimeMs += validationTime
      this.metrics.avgValidationTimeMs = this.totalValidationTimeMs / this.metrics.totalEvents
      this.metrics.lastValidationAt = Date.now()

      if (validated.isValid) {
        this.metrics.validEvents++

        if (this.options.onValid) {
          await this.options.onValid(validated)
        }

        return validated
      }

      // Handle invalid event
      this.metrics.invalidEvents++
      this.updateErrorMetrics(validated)

      // Call custom error handler
      if (this.config.onError) {
        const errors = [
          ...(validated.beforeValidation?.errors || []),
          ...(validated.afterValidation?.errors || []),
        ]
        this.config.onError(event, errors)
      }

      // Determine action based on configuration
      const action = this.config.onSchemaViolation ?? 'dead-letter'

      switch (action) {
        case 'skip':
          this.metrics.skippedEvents++
          return null

        case 'dead-letter':
          await this.sendToDeadLetter(event, validated)
          return null

        case 'transform':
          const transformed = await this.transformEvent(event, validated)
          if (transformed) {
            this.metrics.transformedEvents++
            return transformed
          }
          await this.sendToDeadLetter(event, validated)
          return null

        case 'pass-through':
          validated.isValid = false
          if (this.options.onValid) {
            await this.options.onValid(validated)
          }
          return validated

        default:
          await this.sendToDeadLetter(event, validated)
          return null
      }
    } catch (error) {
      // Send to dead letter on processing errors
      await this.sendToDeadLetter(event, undefined, 'transformation_failed')
      return null
    }
  }

  /**
   * Process multiple events
   */
  async processEvents(events: ChangeEvent<T>[]): Promise<ValidatedChangeEvent<T>[]> {
    const results: ValidatedChangeEvent<T>[] = []

    for (const event of events) {
      const result = await this.processEvent(event)
      if (result) {
        results.push(result)
      }
    }

    // Check for schema drift if enabled
    if (this.options.detectSchemaDrift && this.contract) {
      this.eventBuffer.push(...events)
      const sampleSize = this.options.driftSampleSize ?? 100

      if (this.eventBuffer.length >= sampleSize) {
        const sample = this.eventBuffer.slice(0, sampleSize)
        this.eventBuffer = this.eventBuffer.slice(sampleSize)

        const report = detectSchemaDrift(sample, this.contract)
        if (report.hasDrift && this.options.onSchemaDrift) {
          await this.options.onSchemaDrift(report)
        }
      }
    }

    return results
  }

  /**
   * Get the dead letter queue
   */
  getDeadLetterQueue(): DeadLetterEvent<T>[] {
    return [...this.deadLetterQueue]
  }

  /**
   * Clear the dead letter queue
   */
  clearDeadLetterQueue(): DeadLetterEvent<T>[] {
    const queue = this.deadLetterQueue
    this.deadLetterQueue = []
    return queue
  }

  /**
   * Retry events from the dead letter queue
   */
  async retryDeadLetteredEvents(
    filter?: (event: DeadLetterEvent<T>) => boolean
  ): Promise<ValidatedChangeEvent<T>[]> {
    const toRetry = filter
      ? this.deadLetterQueue.filter(filter)
      : this.deadLetterQueue

    const results: ValidatedChangeEvent<T>[] = []

    for (const deadLetter of toRetry) {
      deadLetter.retryCount++
      const result = await this.processEvent(deadLetter.originalEvent)
      if (result?.isValid) {
        // Remove from dead letter queue
        const index = this.deadLetterQueue.indexOf(deadLetter)
        if (index > -1) {
          this.deadLetterQueue.splice(index, 1)
        }
        results.push(result)
      }
    }

    return results
  }

  /**
   * Get validation metrics
   */
  getMetrics(): ContractValidationMetrics {
    return { ...this.metrics }
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalEvents: 0,
      validEvents: 0,
      invalidEvents: 0,
      deadLetteredEvents: 0,
      transformedEvents: 0,
      skippedEvents: 0,
      errorsByType: {},
      errorsByField: {},
      avgValidationTimeMs: 0,
      lastValidationAt: null,
    }
    this.totalValidationTimeMs = 0
  }

  /**
   * Update the contract (for schema evolution)
   */
  async updateContract(contract: DataContract | string): Promise<void> {
    if (typeof contract === 'string') {
      this.contract = await this.registry.get(contract)
    } else {
      this.contract = contract
    }
  }

  private async sendToDeadLetter(
    event: ChangeEvent<T>,
    validated?: ValidatedChangeEvent<T>,
    reason: DeadLetterEvent<T>['reason'] = 'validation_failed'
  ): Promise<void> {
    const errors = validated
      ? [
          ...(validated.beforeValidation?.errors || []),
          ...(validated.afterValidation?.errors || []),
        ]
      : []

    const deadLetter: DeadLetterEvent<T> = {
      originalEvent: event,
      errors,
      deadLetteredAt: Date.now(),
      retryCount: 0,
      reason,
      contractName: this.contract?.name,
      contractVersion: this.contract?.version,
    }

    // Enforce max queue size
    const maxSize = this.options.maxDeadLetterQueueSize ?? 10000
    if (this.deadLetterQueue.length >= maxSize) {
      this.deadLetterQueue.shift() // Remove oldest
    }

    this.deadLetterQueue.push(deadLetter)
    this.metrics.deadLetteredEvents++

    if (this.options.onDeadLetter) {
      await this.options.onDeadLetter(deadLetter)
    }
  }

  private async transformEvent(
    event: ChangeEvent<T>,
    validated: ValidatedChangeEvent<T>
  ): Promise<ValidatedChangeEvent<T> | null> {
    if (!this.config.transformOnFailure) {
      return null
    }

    const errors = [
      ...(validated.beforeValidation?.errors || []),
      ...(validated.afterValidation?.errors || []),
    ]

    try {
      const transformed = this.config.transformOnFailure(event, errors)

      // Re-validate transformed event
      const revalidated = validateChangeEvent(transformed, this.contract!, {
        validateBefore: this.config.validateBefore ?? true,
        validateAfter: this.config.validateAfter ?? true,
        mode: this.config.mode ?? 'strict',
      })

      if (revalidated.isValid) {
        revalidated.transformations = ['Applied custom transformation']
        return revalidated
      }
    } catch {
      // Transformation failed
    }

    return null
  }

  private updateErrorMetrics(validated: ValidatedChangeEvent<T>): void {
    const allErrors = [
      ...(validated.beforeValidation?.errors || []),
      ...(validated.afterValidation?.errors || []),
    ]

    for (const error of allErrors) {
      // Track by keyword/type
      const keyword = error.keyword || 'unknown'
      this.metrics.errorsByType[keyword] = (this.metrics.errorsByType[keyword] || 0) + 1

      // Track by field
      const field = error.path || 'root'
      this.metrics.errorsByField[field] = (this.metrics.errorsByField[field] || 0) + 1
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a CDC contract stream
 */
export function createCDCContractStream<T = unknown>(
  options: CDCContractStreamOptions<T>
): CDCContractStream<T> {
  return new CDCContractStream(options)
}

/**
 * Wrap an existing CDC stream with contract validation
 */
export function withContract<T>(
  config: CDCContractConfig,
  options?: Partial<CDCContractStreamOptions<T>>
): CDCContractStream<T> {
  return createCDCContractStream({
    config,
    ...options,
  })
}

/**
 * Create a simple validation function for a contract
 */
export function createValidator<T>(
  contract: DataContract,
  options?: {
    validateBefore?: boolean
    validateAfter?: boolean
    mode?: ValidationMode
  }
): (event: ChangeEvent<T>) => ValidatedChangeEvent<T> {
  return (event: ChangeEvent<T>) => validateChangeEvent(event, contract, options)
}
