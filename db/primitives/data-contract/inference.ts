/**
 * Schema Inference for DataContract
 *
 * Provides automatic schema inference from sample data with:
 * - Type detection (string, number, integer, boolean, array, object, null)
 * - Pattern detection (email, URL, UUID, date, datetime, IP addresses)
 * - Enum inference for low-cardinality string fields
 * - Nested object and array handling
 * - Nullability detection based on configurable thresholds
 * - Stream inference for large datasets
 * - Schema merging for combining multiple inferred schemas
 */

import type { JSONSchema, JSONSchemaType, DataContract, SchemaMetadata } from './index'
import { createSchema } from './index'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for schema inference
 */
export interface InferenceOptions {
  /** Minimum number of samples to analyze before finalizing inference (default: 100) */
  samples: number
  /** Percentage of nulls (0-1) above which a field is marked optional (default: 0.05) */
  nullableThreshold: number
  /** Type inference strategy: 'strict' requires consistent types, 'loose' allows coercion (default: 'strict') */
  typeStrategy: 'strict' | 'loose'
  /** Enable pattern detection for strings (email, url, uuid, etc.) (default: true) */
  detectPatterns: boolean
  /** Maximum unique values before treating as non-enum (default: 20) */
  enumThreshold: number
  /** Maximum percentage of unique values (0-1) to consider as enum (default: 0.1) */
  enumCardinalityThreshold: number
  /** Infer numeric ranges from sample data (default: true) */
  inferRanges: boolean
  /** Infer string length constraints from sample data (default: false) */
  inferLengthConstraints: boolean
  /** Name for the generated contract (default: 'InferredSchema') */
  contractName: string
  /** Version for the generated contract (default: '1.0.0') */
  contractVersion: string
  /** Additional metadata for the generated contract */
  metadata?: SchemaMetadata
}

/**
 * String pattern types that can be detected
 */
export type StringPatternType =
  | 'email'
  | 'url'
  | 'uuid'
  | 'iso-date'
  | 'iso-datetime'
  | 'time'
  | 'ipv4'
  | 'ipv6'
  | 'phone'
  | 'credit-card'
  | 'hex-color'
  | 'slug'
  | 'semver'

/**
 * Detected string pattern
 */
export type StringPattern =
  | { type: 'email' }
  | { type: 'url' }
  | { type: 'uuid' }
  | { type: 'iso-date' }
  | { type: 'iso-datetime' }
  | { type: 'time' }
  | { type: 'ipv4' }
  | { type: 'ipv6' }
  | { type: 'phone' }
  | { type: 'credit-card' }
  | { type: 'hex-color' }
  | { type: 'slug' }
  | { type: 'semver' }
  | { type: 'regex'; pattern: string }

/**
 * Numeric constraints inferred from sample data
 */
export interface NumericConstraints {
  minimum?: number
  maximum?: number
  isInteger: boolean
  isPositive: boolean
  isNonNegative: boolean
}

/**
 * String constraints inferred from sample data
 */
export interface StringConstraints {
  minLength?: number
  maxLength?: number
  pattern?: StringPattern
  enumValues?: string[]
}

/**
 * Internal field statistics for inference
 */
interface FieldStats {
  types: Map<string, number>
  nullCount: number
  totalCount: number
  stringValues: Set<string>
  numericValues: number[]
  stringLengths: number[]
  nestedStats?: Map<string, FieldStats>
  arrayItemStats?: FieldStats
}

/**
 * Inference result with schema and statistics
 */
export interface InferenceResult {
  contract: DataContract
  statistics: {
    totalSamples: number
    fieldsInferred: number
    patternsDetected: number
    enumsInferred: number
  }
}

// ============================================================================
// DEFAULT OPTIONS
// ============================================================================

const DEFAULT_OPTIONS: InferenceOptions = {
  samples: 100,
  nullableThreshold: 0.05,
  typeStrategy: 'strict',
  detectPatterns: true,
  enumThreshold: 20,
  enumCardinalityThreshold: 0.1,
  inferRanges: true,
  inferLengthConstraints: false,
  contractName: 'InferredSchema',
  contractVersion: '1.0.0',
}

// ============================================================================
// PATTERN DETECTORS
// ============================================================================

const PATTERN_DETECTORS: Record<StringPatternType, RegExp> = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  url: /^https?:\/\/[^\s]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  'iso-date': /^\d{4}-\d{2}-\d{2}$/,
  'iso-datetime': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
  time: /^\d{2}:\d{2}:\d{2}(\.\d+)?$/,
  ipv4: /^(\d{1,3}\.){3}\d{1,3}$/,
  ipv6: /^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i,
  phone: /^\+?[1-9]\d{1,14}$/,
  'credit-card': /^\d{13,19}$/,
  'hex-color': /^#[0-9a-f]{6}$/i,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  semver: /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/,
}

// Additional validation for IP addresses
function isValidIPv4(value: string): boolean {
  if (!PATTERN_DETECTORS.ipv4.test(value)) return false
  return value.split('.').every((n) => {
    const num = parseInt(n, 10)
    return num >= 0 && num <= 255
  })
}

// ============================================================================
// SCHEMA INFERRER CLASS
// ============================================================================

/**
 * Schema inferrer that analyzes sample data and generates DataContract schemas
 */
export class SchemaInferrer {
  private options: InferenceOptions
  private rootStats: FieldStats
  private sampleCount: number

  constructor(options?: Partial<InferenceOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.rootStats = this.createEmptyStats()
    this.sampleCount = 0
  }

  /**
   * Infer schema from an array of samples
   */
  infer(samples: unknown[]): DataContract {
    // Reset stats for fresh inference
    this.rootStats = this.createEmptyStats()
    this.sampleCount = 0

    // Collect statistics from all samples
    for (const sample of samples) {
      this.collectStats(sample, this.rootStats)
      this.sampleCount++
    }

    // Generate schema from collected statistics
    const schema = this.generateSchema(this.rootStats)

    return createSchema({
      name: this.options.contractName,
      version: this.options.contractVersion,
      schema,
      metadata: this.options.metadata,
    })
  }

  /**
   * Infer schema from an async iterable stream of samples
   * Useful for large datasets that don't fit in memory
   */
  async inferStream(stream: AsyncIterable<unknown>): Promise<DataContract> {
    // Reset stats for fresh inference
    this.rootStats = this.createEmptyStats()
    this.sampleCount = 0

    // Collect statistics from stream
    for await (const sample of stream) {
      this.collectStats(sample, this.rootStats)
      this.sampleCount++
    }

    // Generate schema from collected statistics
    const schema = this.generateSchema(this.rootStats)

    return createSchema({
      name: this.options.contractName,
      version: this.options.contractVersion,
      schema,
      metadata: this.options.metadata,
    })
  }

  /**
   * Infer schema with detailed statistics
   */
  inferWithStats(samples: unknown[]): InferenceResult {
    const contract = this.infer(samples)

    return {
      contract,
      statistics: {
        totalSamples: this.sampleCount,
        fieldsInferred: this.countFields(this.rootStats),
        patternsDetected: this.countPatterns(this.rootStats),
        enumsInferred: this.countEnums(this.rootStats),
      },
    }
  }

  /**
   * Detect string pattern from a set of values
   */
  detectStringPattern(values: string[]): StringPattern | null {
    if (values.length === 0) return null

    // Check each pattern type
    for (const [patternType, regex] of Object.entries(PATTERN_DETECTORS) as [StringPatternType, RegExp][]) {
      let matchCount = 0

      for (const value of values) {
        // Special handling for IPv4 validation
        if (patternType === 'ipv4') {
          if (isValidIPv4(value)) matchCount++
        } else if (regex.test(value)) {
          matchCount++
        }
      }

      // Require high match rate (>90%) to detect pattern
      const matchRate = matchCount / values.length
      if (matchRate >= 0.9) {
        return { type: patternType }
      }
    }

    return null
  }

  /**
   * Detect numeric range from a set of values
   */
  detectNumericRange(values: number[]): NumericConstraints {
    if (values.length === 0) {
      return { isInteger: true, isPositive: false, isNonNegative: false }
    }

    const min = Math.min(...values)
    const max = Math.max(...values)
    const isInteger = values.every((v) => Number.isInteger(v))
    const isPositive = values.every((v) => v > 0)
    const isNonNegative = values.every((v) => v >= 0)

    const result: NumericConstraints = {
      isInteger,
      isPositive,
      isNonNegative,
    }

    if (this.options.inferRanges) {
      result.minimum = min
      result.maximum = max
    }

    return result
  }

  /**
   * Detect string constraints from a set of values
   */
  detectStringConstraints(values: string[]): StringConstraints {
    const result: StringConstraints = {}

    if (values.length === 0) return result

    // Pattern detection
    if (this.options.detectPatterns) {
      const pattern = this.detectStringPattern(values)
      if (pattern) {
        result.pattern = pattern
      }
    }

    // Enum detection - check cardinality
    const uniqueValues = new Set(values)
    const cardinalityRatio = uniqueValues.size / values.length

    if (
      uniqueValues.size <= this.options.enumThreshold &&
      cardinalityRatio <= this.options.enumCardinalityThreshold &&
      uniqueValues.size > 1 // Don't treat single value as enum
    ) {
      result.enumValues = Array.from(uniqueValues).sort()
    }

    // Length constraints
    if (this.options.inferLengthConstraints && values.length > 0) {
      const lengths = values.map((v) => v.length)
      result.minLength = Math.min(...lengths)
      result.maxLength = Math.max(...lengths)
    }

    return result
  }

  /**
   * Merge multiple inferred schemas into one
   * Useful for combining schemas from different data sources
   */
  merge(schemas: DataContract[]): DataContract {
    if (schemas.length === 0) {
      return createSchema({
        name: this.options.contractName,
        version: this.options.contractVersion,
        schema: { type: 'object' },
      })
    }

    if (schemas.length === 1) {
      return schemas[0]
    }

    // Merge all schemas into a combined schema
    const mergedSchema = this.mergeSchemas(schemas.map((s) => s.schema))

    return createSchema({
      name: this.options.contractName,
      version: this.options.contractVersion,
      schema: mergedSchema,
      metadata: this.options.metadata,
    })
  }

  // ============================================================================
  // PRIVATE METHODS - Statistics Collection
  // ============================================================================

  private createEmptyStats(): FieldStats {
    return {
      types: new Map(),
      nullCount: 0,
      totalCount: 0,
      stringValues: new Set(),
      numericValues: [],
      stringLengths: [],
    }
  }

  private collectStats(value: unknown, stats: FieldStats): void {
    stats.totalCount++

    if (value === null || value === undefined) {
      stats.nullCount++
      stats.types.set('null', (stats.types.get('null') || 0) + 1)
      return
    }

    const type = this.getValueType(value)
    stats.types.set(type, (stats.types.get(type) || 0) + 1)

    switch (type) {
      case 'string':
        const strValue = value as string
        // Limit string value collection for memory efficiency
        if (stats.stringValues.size < 1000) {
          stats.stringValues.add(strValue)
        }
        stats.stringLengths.push(strValue.length)
        break

      case 'number':
      case 'integer':
        // Limit numeric value collection
        if (stats.numericValues.length < 10000) {
          stats.numericValues.push(value as number)
        }
        break

      case 'object':
        this.collectObjectStats(value as Record<string, unknown>, stats)
        break

      case 'array':
        this.collectArrayStats(value as unknown[], stats)
        break
    }
  }

  private collectObjectStats(obj: Record<string, unknown>, stats: FieldStats): void {
    if (!stats.nestedStats) {
      stats.nestedStats = new Map()
    }

    for (const [key, value] of Object.entries(obj)) {
      if (!stats.nestedStats.has(key)) {
        stats.nestedStats.set(key, this.createEmptyStats())
      }
      this.collectStats(value, stats.nestedStats.get(key)!)
    }
  }

  private collectArrayStats(arr: unknown[], stats: FieldStats): void {
    if (!stats.arrayItemStats) {
      stats.arrayItemStats = this.createEmptyStats()
    }

    for (const item of arr) {
      this.collectStats(item, stats.arrayItemStats)
    }
  }

  private getValueType(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'object') return 'object'
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'number'
    }
    return typeof value
  }

  // ============================================================================
  // PRIVATE METHODS - Schema Generation
  // ============================================================================

  private generateSchema(stats: FieldStats): JSONSchema {
    // Determine primary type
    const primaryType = this.getPrimaryType(stats)
    const isNullable = stats.nullCount / stats.totalCount > this.options.nullableThreshold

    switch (primaryType) {
      case 'object':
        return this.generateObjectSchema(stats, isNullable)

      case 'array':
        return this.generateArraySchema(stats, isNullable)

      case 'string':
        return this.generateStringSchema(stats, isNullable)

      case 'number':
      case 'integer':
        return this.generateNumericSchema(stats, primaryType, isNullable)

      case 'boolean':
        return this.generateBooleanSchema(isNullable)

      case 'null':
        return { type: 'null' }

      default:
        // Mixed types or unknown - use loose type
        if (this.options.typeStrategy === 'loose') {
          return this.generateMixedTypeSchema(stats)
        }
        return {}
    }
  }

  private getPrimaryType(stats: FieldStats): string {
    if (stats.types.size === 0) return 'null'

    // Find the most common non-null type
    let maxCount = 0
    let primaryType = 'null'

    for (const [type, count] of stats.types) {
      if (type !== 'null' && count > maxCount) {
        maxCount = count
        primaryType = type
      }
    }

    // Handle integer/number merge
    const intCount = stats.types.get('integer') || 0
    const numCount = stats.types.get('number') || 0
    if (intCount > 0 && numCount > 0) {
      // If any non-integer numbers exist, use 'number'
      primaryType = numCount > 0 ? 'number' : 'integer'
    }

    return primaryType
  }

  private generateObjectSchema(stats: FieldStats, isNullable: boolean): JSONSchema {
    const schema: JSONSchema = { type: isNullable ? ['object', 'null'] as unknown as JSONSchemaType : 'object' }

    if (stats.nestedStats && stats.nestedStats.size > 0) {
      schema.properties = {}
      const required: string[] = []

      for (const [key, fieldStats] of stats.nestedStats) {
        schema.properties[key] = this.generateSchema(fieldStats)

        // Determine if field is required (present in most samples)
        const presenceRate = fieldStats.totalCount / stats.totalCount
        if (presenceRate >= 1 - this.options.nullableThreshold) {
          // Also check if the field itself has many nulls
          const fieldNullRate = fieldStats.nullCount / fieldStats.totalCount
          if (fieldNullRate < this.options.nullableThreshold) {
            required.push(key)
          }
        }
      }

      if (required.length > 0) {
        schema.required = required.sort()
      }
    }

    return schema
  }

  private generateArraySchema(stats: FieldStats, isNullable: boolean): JSONSchema {
    const schema: JSONSchema = { type: isNullable ? ['array', 'null'] as unknown as JSONSchemaType : 'array' }

    if (stats.arrayItemStats && stats.arrayItemStats.totalCount > 0) {
      schema.items = this.generateSchema(stats.arrayItemStats)
    }

    return schema
  }

  private generateStringSchema(stats: FieldStats, isNullable: boolean): JSONSchema {
    const schema: JSONSchema = { type: isNullable ? ['string', 'null'] as unknown as JSONSchemaType : 'string' }

    const values = Array.from(stats.stringValues)
    const constraints = this.detectStringConstraints(values)

    // Apply pattern
    if (constraints.pattern) {
      switch (constraints.pattern.type) {
        case 'email':
          schema.format = 'email'
          break
        case 'url':
          schema.format = 'uri'
          break
        case 'uuid':
          schema.format = 'uuid'
          break
        case 'iso-date':
          schema.format = 'date'
          break
        case 'iso-datetime':
          schema.format = 'date-time'
          break
        case 'time':
          schema.format = 'time'
          break
        case 'ipv4':
          schema.format = 'ipv4'
          break
        case 'ipv6':
          schema.format = 'ipv6'
          break
        case 'regex':
          schema.pattern = constraints.pattern.pattern
          break
      }
    }

    // Apply enum
    if (constraints.enumValues && !constraints.pattern) {
      schema.enum = constraints.enumValues
    }

    // Apply length constraints
    if (constraints.minLength !== undefined) {
      schema.minLength = constraints.minLength
    }
    if (constraints.maxLength !== undefined) {
      schema.maxLength = constraints.maxLength
    }

    return schema
  }

  private generateNumericSchema(
    stats: FieldStats,
    type: 'number' | 'integer',
    isNullable: boolean
  ): JSONSchema {
    const schema: JSONSchema = {
      type: isNullable ? [type, 'null'] as unknown as JSONSchemaType : type,
    }

    if (stats.numericValues.length > 0) {
      const constraints = this.detectNumericRange(stats.numericValues)

      if (this.options.inferRanges) {
        if (constraints.minimum !== undefined) {
          schema.minimum = constraints.minimum
        }
        if (constraints.maximum !== undefined) {
          schema.maximum = constraints.maximum
        }
      }
    }

    return schema
  }

  private generateBooleanSchema(isNullable: boolean): JSONSchema {
    return {
      type: isNullable ? ['boolean', 'null'] as unknown as JSONSchemaType : 'boolean',
    }
  }

  private generateMixedTypeSchema(stats: FieldStats): JSONSchema {
    // Collect all types present
    const types: JSONSchemaType[] = []

    for (const type of stats.types.keys()) {
      if (type === 'integer') {
        if (!types.includes('number')) {
          types.push('number')
        }
      } else {
        types.push(type as JSONSchemaType)
      }
    }

    if (types.length === 1) {
      return { type: types[0] }
    }

    return { type: types as unknown as JSONSchemaType }
  }

  // ============================================================================
  // PRIVATE METHODS - Schema Merging
  // ============================================================================

  private mergeSchemas(schemas: JSONSchema[]): JSONSchema {
    if (schemas.length === 0) return {}
    if (schemas.length === 1) return schemas[0]

    // Merge types
    const allTypes = new Set<JSONSchemaType>()
    const allProperties = new Map<string, JSONSchema[]>()
    const allRequired = new Map<string, number>()
    let hasItems = false
    const itemSchemas: JSONSchema[] = []

    for (const schema of schemas) {
      // Collect types
      if (schema.type) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type]
        for (const t of types) {
          allTypes.add(t)
        }
      }

      // Collect properties
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (!allProperties.has(key)) {
            allProperties.set(key, [])
          }
          allProperties.get(key)!.push(propSchema)
        }
      }

      // Track required fields
      if (schema.required) {
        for (const key of schema.required) {
          allRequired.set(key, (allRequired.get(key) || 0) + 1)
        }
      }

      // Collect array items
      if (schema.items) {
        hasItems = true
        itemSchemas.push(schema.items)
      }
    }

    // Build merged schema
    const merged: JSONSchema = {}

    // Set type
    if (allTypes.size > 0) {
      const typesArray = Array.from(allTypes)
      merged.type = typesArray.length === 1 ? typesArray[0] : typesArray as unknown as JSONSchemaType
    }

    // Merge properties
    if (allProperties.size > 0) {
      merged.properties = {}
      for (const [key, propSchemas] of allProperties) {
        merged.properties[key] = this.mergeSchemas(propSchemas)
      }

      // Field is required only if required in all schemas
      const requiredFields: string[] = []
      for (const [key, count] of allRequired) {
        if (count === schemas.length) {
          requiredFields.push(key)
        }
      }
      if (requiredFields.length > 0) {
        merged.required = requiredFields.sort()
      }
    }

    // Merge array items
    if (hasItems && itemSchemas.length > 0) {
      merged.items = this.mergeSchemas(itemSchemas)
    }

    return merged
  }

  // ============================================================================
  // PRIVATE METHODS - Statistics Counting
  // ============================================================================

  private countFields(stats: FieldStats): number {
    let count = 0
    if (stats.nestedStats) {
      count += stats.nestedStats.size
      for (const nested of stats.nestedStats.values()) {
        count += this.countFields(nested)
      }
    }
    if (stats.arrayItemStats) {
      count += this.countFields(stats.arrayItemStats)
    }
    return count
  }

  private countPatterns(stats: FieldStats): number {
    let count = 0

    // Check if this field has a pattern
    if (stats.stringValues.size > 0) {
      const pattern = this.detectStringPattern(Array.from(stats.stringValues))
      if (pattern) count++
    }

    // Recurse into nested fields
    if (stats.nestedStats) {
      for (const nested of stats.nestedStats.values()) {
        count += this.countPatterns(nested)
      }
    }
    if (stats.arrayItemStats) {
      count += this.countPatterns(stats.arrayItemStats)
    }

    return count
  }

  private countEnums(stats: FieldStats): number {
    let count = 0

    // Check if this field could be an enum
    if (stats.stringValues.size > 0) {
      const constraints = this.detectStringConstraints(Array.from(stats.stringValues))
      if (constraints.enumValues) count++
    }

    // Recurse into nested fields
    if (stats.nestedStats) {
      for (const nested of stats.nestedStats.values()) {
        count += this.countEnums(nested)
      }
    }
    if (stats.arrayItemStats) {
      count += this.countEnums(stats.arrayItemStats)
    }

    return count
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new SchemaInferrer instance
 */
export function createInferrer(options?: Partial<InferenceOptions>): SchemaInferrer {
  return new SchemaInferrer(options)
}

/**
 * Quick inference helper - infer schema from samples
 */
export function inferSchema(samples: unknown[], options?: Partial<InferenceOptions>): DataContract {
  const inferrer = createInferrer(options)
  return inferrer.infer(samples)
}

/**
 * Quick inference helper - infer schema from async stream
 */
export async function inferSchemaFromStream(
  stream: AsyncIterable<unknown>,
  options?: Partial<InferenceOptions>
): Promise<DataContract> {
  const inferrer = createInferrer(options)
  return inferrer.inferStream(stream)
}

/**
 * Infer schema with detailed statistics
 */
export function inferSchemaWithStats(
  samples: unknown[],
  options?: Partial<InferenceOptions>
): InferenceResult {
  const inferrer = createInferrer(options)
  return inferrer.inferWithStats(samples)
}

/**
 * Merge multiple schemas into one
 */
export function mergeSchemas(schemas: DataContract[], options?: Partial<InferenceOptions>): DataContract {
  const inferrer = createInferrer(options)
  return inferrer.merge(schemas)
}

// ============================================================================
// CSV INFERENCE
// ============================================================================

/**
 * Options for CSV inference
 */
export interface CSVInferenceOptions extends Partial<InferenceOptions> {
  /** Column delimiter (default: ',') */
  delimiter?: string
  /** Whether first row contains headers (default: true) */
  hasHeaders?: boolean
  /** Custom column names (used if hasHeaders is false) */
  columnNames?: string[]
  /** Number of rows to analyze (default: 1000) */
  maxRows?: number
  /** Treat empty strings as null (default: true) */
  treatEmptyAsNull?: boolean
}

/**
 * Parse a CSV string into rows for inference
 */
export function parseCSVForInference(
  csvContent: string,
  options?: CSVInferenceOptions
): unknown[] {
  const delimiter = options?.delimiter ?? ','
  const hasHeaders = options?.hasHeaders ?? true
  const maxRows = options?.maxRows ?? 1000
  const treatEmptyAsNull = options?.treatEmptyAsNull ?? true

  const lines = csvContent.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length === 0) return []

  // Get headers
  let headers: string[]
  let startRow: number

  if (hasHeaders) {
    headers = parseCSVLine(lines[0], delimiter)
    startRow = 1
  } else if (options?.columnNames) {
    headers = options.columnNames
    startRow = 0
  } else {
    // Generate column names
    const firstRow = parseCSVLine(lines[0], delimiter)
    headers = firstRow.map((_, i) => `column_${i + 1}`)
    startRow = 0
  }

  // Parse rows
  const rows: Record<string, unknown>[] = []
  const endRow = Math.min(lines.length, startRow + maxRows)

  for (let i = startRow; i < endRow; i++) {
    const values = parseCSVLine(lines[i], delimiter)
    const row: Record<string, unknown> = {}

    for (let j = 0; j < headers.length; j++) {
      let value: unknown = values[j] ?? null

      // Try to parse as number
      if (typeof value === 'string') {
        if (treatEmptyAsNull && value === '') {
          value = null
        } else {
          const num = Number(value)
          if (!isNaN(num) && value.trim() !== '') {
            value = num
          } else if (value.toLowerCase() === 'true') {
            value = true
          } else if (value.toLowerCase() === 'false') {
            value = false
          } else if (value.toLowerCase() === 'null') {
            value = null
          }
        }
      }

      row[headers[j]] = value
    }

    rows.push(row)
  }

  return rows
}

/**
 * Parse a single CSV line into values
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          current += '"'
          i++
        } else {
          // End of quoted field
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === delimiter) {
        values.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
  }

  // Add last value
  values.push(current.trim())

  return values
}

/**
 * Infer schema from CSV content
 */
export function inferSchemaFromCSV(
  csvContent: string,
  options?: CSVInferenceOptions
): DataContract {
  const samples = parseCSVForInference(csvContent, options)
  return inferSchema(samples, options)
}

// ============================================================================
// JSON LINES (JSONL) INFERENCE
// ============================================================================

/**
 * Parse JSONL content for inference
 */
export function parseJSONLForInference(jsonlContent: string, maxRows?: number): unknown[] {
  const lines = jsonlContent.split(/\r?\n/).filter((line) => line.trim())
  const limit = maxRows ?? lines.length

  const samples: unknown[] = []
  for (let i = 0; i < Math.min(lines.length, limit); i++) {
    try {
      samples.push(JSON.parse(lines[i]))
    } catch {
      // Skip invalid JSON lines
    }
  }

  return samples
}

/**
 * Infer schema from JSONL content
 */
export function inferSchemaFromJSONL(
  jsonlContent: string,
  options?: Partial<InferenceOptions> & { maxRows?: number }
): DataContract {
  const samples = parseJSONLForInference(jsonlContent, options?.maxRows)
  return inferSchema(samples, options)
}
