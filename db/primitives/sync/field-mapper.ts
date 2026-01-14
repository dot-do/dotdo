/**
 * FieldMapper - Field mapping and transformation for data sync
 *
 * This module provides field mapping and transformation capabilities for
 * data synchronization scenarios. It enables renaming fields, applying
 * transforms (built-in or custom), handling defaults, and validating
 * required fields.
 *
 * ## Overview
 *
 * Field mapping is essential when syncing data between systems with different
 * schemas. This module handles:
 * - Field renaming (source -> destination)
 * - Built-in transforms (uppercase, lowercase, trim, toDate, toNumber)
 * - Custom transform functions
 * - Transform pipelines (multiple transforms in sequence)
 * - Default values for missing fields
 * - Required field validation
 * - Nested field paths (e.g., "user.profile.name")
 *
 * ## Usage Example
 *
 * ```typescript
 * import { FieldMapper } from './field-mapper'
 *
 * const mapper = new FieldMapper()
 *
 * const mappings = [
 *   { source: 'first_name', destination: 'firstName' },
 *   { source: 'email', destination: 'email', transform: 'lowercase' },
 *   { source: 'role', destination: 'role', default: 'user' },
 *   { source: 'id', destination: 'id', required: true },
 * ]
 *
 * const result = mapper.map(sourceRecord, mappings)
 * ```
 *
 * @module db/primitives/sync/field-mapper
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Built-in transform function names
 */
export type BuiltInTransform = 'uppercase' | 'lowercase' | 'trim' | 'toDate' | 'toNumber'

/**
 * Custom transform function that receives the value and full record
 */
export type CustomTransformFunction = (value: unknown, record: Record<string, unknown>) => unknown

/**
 * Transform can be a built-in name, custom function, or array (pipeline)
 */
export type TransformFunction = BuiltInTransform | CustomTransformFunction

/**
 * Pipeline of transforms to apply in sequence
 */
export type TransformPipeline = TransformFunction[]

/**
 * A single field mapping configuration
 */
export interface FieldMapping {
  /** Source field path (supports dot notation for nested paths) */
  source: string
  /** Destination field path (supports dot notation for nested paths) */
  destination: string
  /** Transform to apply (built-in name, custom function, or pipeline) */
  transform?: TransformFunction | TransformPipeline
  /** Default value or function returning default when source is null/undefined */
  default?: unknown | (() => unknown)
  /** Whether this field is required (throws if missing after defaults) */
  required?: boolean
}

/**
 * Options for FieldMapper
 */
export interface FieldMapperOptions {
  /** When true, validation methods return errors instead of throwing */
  validationMode?: boolean
}

/**
 * Validation error for a field mapping
 */
export interface MappingValidationError {
  /** The field that failed validation */
  field: string
  /** Type of validation error */
  type: 'required' | 'transform'
  /** Human-readable error message */
  message: string
}

/**
 * Result of validation operation
 */
export interface ValidationResult {
  /** Whether all validations passed */
  valid: boolean
  /** List of validation errors */
  errors: MappingValidationError[]
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * FieldMapper handles field mapping and transformation between schemas
 *
 * @example
 * ```typescript
 * const mapper = new FieldMapper()
 * const result = mapper.map(record, mappings)
 * ```
 */
export class FieldMapper {
  private readonly validationMode: boolean

  constructor(options: FieldMapperOptions = {}) {
    this.validationMode = options.validationMode ?? false
  }

  /**
   * Map a single record according to field mappings
   *
   * @param record - Source record to map
   * @param mappings - Field mapping configurations
   * @returns Mapped record with transformed fields
   * @throws Error if required field is missing (unless using validation mode)
   */
  map(record: Record<string, unknown>, mappings: FieldMapping[]): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const mapping of mappings) {
      // Get source value using nested path
      let value = this.getNestedValue(record, mapping.source)

      // Apply default if value is null or undefined
      if (value === null || value === undefined) {
        if (mapping.default !== undefined) {
          value = typeof mapping.default === 'function'
            ? (mapping.default as () => unknown)()
            : mapping.default
        }
      }

      // Check required field
      if (mapping.required && (value === null || value === undefined)) {
        throw new Error(`Required field '${mapping.source}' is missing`)
      }

      // Skip if value is still undefined and not required
      if (value === undefined && !mapping.required) {
        continue
      }

      // Apply transform(s)
      if (mapping.transform !== undefined && value !== null && value !== undefined) {
        value = this.applyTransform(value, record, mapping.transform)
      }

      // Set destination value using nested path
      this.setNestedValue(result, mapping.destination, value)
    }

    return result
  }

  /**
   * Map multiple records according to field mappings
   *
   * @param records - Source records to map
   * @param mappings - Field mapping configurations
   * @returns Array of mapped records
   */
  mapMany(records: Record<string, unknown>[], mappings: FieldMapping[]): Record<string, unknown>[] {
    return records.map(record => this.map(record, mappings))
  }

  /**
   * Validate a record against mappings without throwing
   *
   * @param record - Source record to validate
   * @param mappings - Field mapping configurations
   * @returns Validation result with any errors
   */
  validate(record: Record<string, unknown>, mappings: FieldMapping[]): ValidationResult {
    const errors: MappingValidationError[] = []

    for (const mapping of mappings) {
      // Get source value using nested path
      let value = this.getNestedValue(record, mapping.source)

      // Apply default if value is null or undefined
      if (value === null || value === undefined) {
        if (mapping.default !== undefined) {
          value = typeof mapping.default === 'function'
            ? (mapping.default as () => unknown)()
            : mapping.default
        }
      }

      // Check required field
      if (mapping.required && (value === null || value === undefined)) {
        errors.push({
          field: mapping.source,
          type: 'required',
          message: `Required field '${mapping.source}' is missing`,
        })
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Get a nested value from an object using dot notation path
   *
   * @param obj - Object to get value from
   * @param path - Dot notation path (e.g., "user.profile.name" or "items.0.id")
   * @returns Value at path or undefined if not found
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }

      if (typeof current !== 'object') {
        return undefined
      }

      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  /**
   * Set a nested value in an object using dot notation path
   *
   * @param obj - Object to set value in
   * @param path - Dot notation path (e.g., "user.profile.name")
   * @param value - Value to set
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')

    // Simple case - no nesting
    if (parts.length === 1) {
      obj[path] = value
      return
    }

    // Navigate/create nested structure
    let current: Record<string, unknown> = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]

      if (current[part] === undefined) {
        current[part] = {}
      }

      current = current[part] as Record<string, unknown>
    }

    current[parts[parts.length - 1]] = value
  }

  /**
   * Apply transform(s) to a value
   *
   * @param value - Value to transform
   * @param record - Full source record (for custom transforms)
   * @param transform - Transform to apply (name, function, or pipeline)
   * @returns Transformed value
   */
  private applyTransform(
    value: unknown,
    record: Record<string, unknown>,
    transform: TransformFunction | TransformPipeline
  ): unknown {
    // Handle pipeline (array of transforms)
    if (Array.isArray(transform)) {
      let result = value
      for (const t of transform) {
        result = this.applySingleTransform(result, record, t)
      }
      return result
    }

    return this.applySingleTransform(value, record, transform)
  }

  /**
   * Apply a single transform to a value
   *
   * @param value - Value to transform
   * @param record - Full source record (for custom transforms)
   * @param transform - Single transform to apply
   * @returns Transformed value
   */
  private applySingleTransform(
    value: unknown,
    record: Record<string, unknown>,
    transform: TransformFunction
  ): unknown {
    // Custom function
    if (typeof transform === 'function') {
      return transform(value, record)
    }

    // Built-in transforms
    switch (transform) {
      case 'uppercase':
        return typeof value === 'string' ? value.toUpperCase() : value

      case 'lowercase':
        return typeof value === 'string' ? value.toLowerCase() : value

      case 'trim':
        return typeof value === 'string' ? value.trim() : value

      case 'toDate':
        if (typeof value === 'number') {
          return new Date(value)
        }
        if (typeof value === 'string') {
          return new Date(value)
        }
        return value

      case 'toNumber':
        if (typeof value === 'string') {
          return parseFloat(value)
        }
        return value

      default:
        return value
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new FieldMapper instance
 *
 * @param options - Configuration options
 * @returns A new FieldMapper instance
 */
export function createFieldMapper(options: FieldMapperOptions = {}): FieldMapper {
  return new FieldMapper(options)
}
