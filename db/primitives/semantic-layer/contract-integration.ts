/**
 * SemanticLayer DataContract Integration
 *
 * Provides type-safe metric and dimension definitions using DataContract schemas.
 * This enables compile-time validation of cube definitions against data contracts,
 * ensuring that field references are valid and type-checked.
 *
 * Features:
 * - Type-safe cube definitions with field auto-complete
 * - Compile-time errors for invalid field references
 * - Type inference from DataContract schemas
 * - Query builder with contract type constraints
 *
 * @example
 * ```typescript
 * import { DataContract, createSchema } from '../data-contract'
 * import { defineCube, dimension, metric, query } from './contract-integration'
 *
 * // Define schema for orders
 * const OrderContract = createSchema({
 *   name: 'Order',
 *   version: '1.0.0',
 *   schema: {
 *     type: 'object',
 *     properties: {
 *       id: { type: 'string' },
 *       amount: { type: 'number' },
 *       status: { type: 'string' },
 *       createdAt: { type: 'string', format: 'date-time' },
 *       customerId: { type: 'string' },
 *     },
 *     required: ['id', 'amount', 'status', 'createdAt'],
 *   },
 * })
 *
 * // Define type-safe cube
 * type Order = {
 *   id: string
 *   amount: number
 *   status: string
 *   createdAt: string
 *   customerId: string
 * }
 *
 * const OrdersCube = defineCube<Order>(OrderContract, {
 *   name: 'Orders',
 *   sql: 'SELECT * FROM orders',
 *   dimensions: [
 *     dimension('status', 'categorical'),
 *     dimension('createdAt', 'time'),
 *   ],
 *   metrics: [
 *     metric('amount', 'sum'),
 *     metric('id', 'count'),
 *   ],
 * })
 *
 * // Type-safe query building
 * const qb = query(OrdersCube)
 *   .select('amount')      // Autocomplete for metrics
 *   .groupBy('status')     // Autocomplete for dimensions
 *   .where('status', 'completed')
 *   .build()
 * ```
 *
 * @see dotdo-eh0a8
 */

import {
  type DataContract,
  type JSONSchema,
} from '../data-contract'

import {
  type MetricType,
  type DimensionType,
  type Granularity,
  type FilterOperator,
  type SemanticQuery,
  type QueryFilter,
  type TimeDimensionQuery,
  type OrderSpec,
} from './index'

// =============================================================================
// Type Utilities
// =============================================================================

/**
 * Extract property keys from a type
 */
type PropertyKeys<T> = keyof T & string

/**
 * Extract numeric property keys from a type
 */
type NumericKeys<T> = {
  [K in keyof T]: T[K] extends number | undefined ? K : never
}[keyof T] & string

/**
 * Extract string property keys from a type
 */
type StringKeys<T> = {
  [K in keyof T]: T[K] extends string | undefined ? K : never
}[keyof T] & string

/**
 * Extract date/time property keys from a type
 */
type DateKeys<T> = {
  [K in keyof T]: T[K] extends Date | string | undefined ? K : never
}[keyof T] & string

/**
 * Extract boolean property keys from a type
 */
type BooleanKeys<T> = {
  [K in keyof T]: T[K] extends boolean | undefined ? K : never
}[keyof T] & string

/**
 * Infer aggregatable fields (numeric only)
 */
type AggregatableFields<T> = NumericKeys<T>

/**
 * Infer countable fields (any field)
 */
type CountableFields<T> = PropertyKeys<T>

// =============================================================================
// Type-Safe Dimension
// =============================================================================

/**
 * Dimension types mapped to TypeScript types
 */
type DimensionTypeMap = {
  string: string
  number: number
  time: Date | string
  boolean: boolean
  geo: string
}

/**
 * Type-safe dimension definition
 */
export interface TypedDimension<T, K extends PropertyKeys<T> = PropertyKeys<T>> {
  /** Field name from contract type */
  field: K
  /** SQL expression for the dimension */
  sql: string
  /** Dimension type */
  type: DimensionType
  /** Optional title */
  title?: string
  /** Optional description */
  description?: string
  /** Is this a primary key? */
  primaryKey?: boolean
  /** Default granularity for time dimensions */
  granularity?: Granularity
  /** Case insensitive matching for string dimensions */
  caseInsensitiveMatch?: boolean
  /** Whether to show in UI */
  shown?: boolean
  /** Additional metadata */
  meta?: Record<string, unknown>
}

/**
 * Configuration for dimension creation
 */
export interface DimensionConfig {
  /** SQL expression override (defaults to field name) */
  sql?: string
  /** Optional title */
  title?: string
  /** Optional description */
  description?: string
  /** Is this a primary key? */
  primaryKey?: boolean
  /** Default granularity for time dimensions */
  granularity?: Granularity
  /** Case insensitive matching for string dimensions */
  caseInsensitiveMatch?: boolean
  /** Whether to show in UI */
  shown?: boolean
  /** Additional metadata */
  meta?: Record<string, unknown>
}

// =============================================================================
// Type-Safe Metric
// =============================================================================

/**
 * Aggregation types for metrics
 */
export type Aggregation = 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max' | 'custom'

/**
 * Type-safe metric definition
 */
export interface TypedMetric<T, K extends PropertyKeys<T> = PropertyKeys<T>> {
  /** Field name from contract type */
  field: K
  /** SQL expression for the metric */
  sql: string
  /** Aggregation type */
  aggregation: Aggregation
  /** Optional title */
  title?: string
  /** Optional description */
  description?: string
  /** Format for display */
  format?: 'currency' | 'percent' | 'number' | string
  /** Drill-down members */
  drillMembers?: PropertyKeys<T>[]
  /** Pre-filters for this metric */
  filters?: { sql: string }[]
  /** Whether to show in UI */
  shown?: boolean
  /** Additional metadata */
  meta?: Record<string, unknown>
}

/**
 * Configuration for metric creation
 */
export interface MetricConfig<T = unknown> {
  /** SQL expression override (defaults to field name) */
  sql?: string
  /** Optional title */
  title?: string
  /** Optional description */
  description?: string
  /** Format for display */
  format?: 'currency' | 'percent' | 'number' | string
  /** Drill-down members */
  drillMembers?: PropertyKeys<T>[]
  /** Pre-filters for this metric */
  filters?: { sql: string }[]
  /** Whether to show in UI */
  shown?: boolean
  /** Additional metadata */
  meta?: Record<string, unknown>
}

// =============================================================================
// Type-Safe Cube
// =============================================================================

/**
 * Type-safe cube definition bound to a DataContract
 */
export interface TypedCube<T> {
  /** The DataContract this cube is bound to */
  contract: DataContract
  /** Cube name */
  name: string
  /** SQL query or table reference */
  sql: string
  /** Type-safe dimensions */
  dimensions: TypedDimension<T>[]
  /** Type-safe metrics */
  metrics: TypedMetric<T>[]
  /** Optional description */
  description?: string
  /** Refresh key configuration */
  refreshKey?: {
    every?: string
    sql?: string
  }
  /** Data source name */
  dataSource?: string
  /** Additional metadata */
  meta?: Record<string, unknown>
}

/**
 * Input configuration for cube definition
 */
export interface TypedCubeInput<T> {
  /** Cube name */
  name: string
  /** SQL query, table reference, or generator function */
  sql: string | (() => string)
  /** Type-safe dimensions */
  dimensions: TypedDimension<T>[]
  /** Type-safe metrics */
  metrics: TypedMetric<T>[]
  /** Optional description */
  description?: string
  /** Refresh key configuration */
  refreshKey?: {
    every?: string
    sql?: string
  }
  /** Data source name */
  dataSource?: string
  /** Additional metadata */
  meta?: Record<string, unknown>
}

// =============================================================================
// Type-Safe Query Builder
// =============================================================================

/**
 * Query builder state
 */
interface QueryBuilderState<T> {
  measures: string[]
  dimensions: string[]
  timeDimensions: TimeDimensionQuery[]
  filters: QueryFilter[]
  order: OrderSpec[]
  limit?: number
  offset?: number
}

/**
 * Type-safe query builder
 */
export interface TypedQueryBuilder<T> {
  /**
   * Select metrics to aggregate
   */
  select<K extends PropertyKeys<T>>(...metrics: K[]): TypedQueryBuilder<T>

  /**
   * Add measure by metric name
   */
  measure(metric: string): TypedQueryBuilder<T>

  /**
   * Group by dimensions
   */
  groupBy<K extends PropertyKeys<T>>(...dimensions: K[]): TypedQueryBuilder<T>

  /**
   * Add time dimension with granularity
   */
  timeDimension<K extends DateKeys<T>>(
    dimension: K,
    granularity?: Granularity,
    dateRange?: [string, string]
  ): TypedQueryBuilder<T>

  /**
   * Add filter on a dimension
   */
  where<K extends PropertyKeys<T>>(
    dimension: K,
    value: string | string[],
    operator?: FilterOperator
  ): TypedQueryBuilder<T>

  /**
   * Add filter with operator
   */
  filter(filter: QueryFilter): TypedQueryBuilder<T>

  /**
   * Order results
   */
  orderBy<K extends PropertyKeys<T>>(field: K, desc?: boolean): TypedQueryBuilder<T>

  /**
   * Limit results
   */
  limit(n: number): TypedQueryBuilder<T>

  /**
   * Offset results
   */
  offset(n: number): TypedQueryBuilder<T>

  /**
   * Build the semantic query
   */
  build(): SemanticQuery

  /**
   * Get the cube this builder is for
   */
  getCube(): TypedCube<T>
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Error thrown for contract integration issues
 */
export class ContractIntegrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContractIntegrationError'
  }
}

/**
 * Error thrown for invalid field references
 */
export class InvalidFieldError extends ContractIntegrationError {
  constructor(field: string, contract: string, availableFields: string[]) {
    super(
      `Field '${field}' not found in contract '${contract}'. ` +
        `Available fields: ${availableFields.join(', ')}`
    )
    this.name = 'InvalidFieldError'
  }
}

/**
 * Error thrown for type mismatches
 */
export class TypeMismatchError extends ContractIntegrationError {
  constructor(field: string, expectedType: string, actualType: string) {
    super(
      `Type mismatch for field '${field}': expected ${expectedType}, got ${actualType}`
    )
    this.name = 'TypeMismatchError'
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get property names from a JSON Schema
 */
function getSchemaFields(schema: JSONSchema): string[] {
  return Object.keys(schema.properties || {})
}

/**
 * Get the type of a field from a JSON Schema
 */
function getFieldType(schema: JSONSchema, field: string): string | undefined {
  const prop = schema.properties?.[field]
  if (!prop) return undefined

  if (Array.isArray(prop.type)) {
    return prop.type.find((t) => t !== 'null') || prop.type[0]
  }
  return prop.type
}

/**
 * Infer dimension type from JSON Schema type
 */
function inferDimensionType(schemaType: string | undefined, format?: string): DimensionType {
  if (format === 'date-time' || format === 'date') {
    return 'time'
  }

  switch (schemaType) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'string'
  }
}

/**
 * Validate field exists in schema
 */
function validateField(schema: JSONSchema, field: string, contractName: string): void {
  const fields = getSchemaFields(schema)
  if (!fields.includes(field)) {
    throw new InvalidFieldError(field, contractName, fields)
  }
}

/**
 * Validate field is numeric for aggregation
 */
function validateNumericField(
  schema: JSONSchema,
  field: string,
  aggregation: Aggregation
): void {
  if (aggregation === 'count' || aggregation === 'countDistinct' || aggregation === 'custom') {
    return // Any field is valid for count
  }

  const fieldType = getFieldType(schema, field)
  if (fieldType !== 'number' && fieldType !== 'integer') {
    throw new TypeMismatchError(
      field,
      'number',
      fieldType || 'unknown'
    )
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a type-safe dimension definition
 *
 * @example
 * ```typescript
 * const statusDim = dimension<Order>('status', 'categorical')
 * const createdAtDim = dimension<Order>('createdAt', 'time', { granularity: 'day' })
 * ```
 */
export function dimension<T, K extends PropertyKeys<T> = PropertyKeys<T>>(
  field: K,
  type: DimensionType,
  config?: DimensionConfig
): TypedDimension<T, K> {
  return {
    field,
    sql: config?.sql || String(field),
    type,
    title: config?.title,
    description: config?.description,
    primaryKey: config?.primaryKey,
    granularity: config?.granularity,
    caseInsensitiveMatch: config?.caseInsensitiveMatch,
    shown: config?.shown,
    meta: config?.meta,
  }
}

/**
 * Create a type-safe metric definition
 *
 * @example
 * ```typescript
 * const revenue = metric<Order>('amount', 'sum', { format: 'currency' })
 * const orderCount = metric<Order>('id', 'count')
 * const avgValue = metric<Order>('amount', 'avg')
 * ```
 */
export function metric<T, K extends PropertyKeys<T> = PropertyKeys<T>>(
  field: K,
  aggregation: Aggregation,
  config?: MetricConfig<T>
): TypedMetric<T, K> {
  return {
    field,
    sql: config?.sql || String(field),
    aggregation,
    title: config?.title,
    description: config?.description,
    format: config?.format,
    drillMembers: config?.drillMembers,
    filters: config?.filters,
    shown: config?.shown,
    meta: config?.meta,
  }
}

/**
 * Define a type-safe cube bound to a DataContract
 *
 * @example
 * ```typescript
 * const OrdersCube = defineCube<Order>(OrderContract, {
 *   name: 'Orders',
 *   sql: 'SELECT * FROM orders',
 *   dimensions: [
 *     dimension('status', 'categorical'),
 *     dimension('createdAt', 'time'),
 *   ],
 *   metrics: [
 *     metric('amount', 'sum'),
 *     metric('id', 'count'),
 *   ],
 * })
 * ```
 */
export function defineCube<T>(
  contract: DataContract,
  input: TypedCubeInput<T>
): TypedCube<T> {
  const schema = contract.schema

  // Validate all dimension fields exist in the contract
  for (const dim of input.dimensions) {
    validateField(schema, String(dim.field), contract.name)
  }

  // Validate all metric fields exist and have correct types
  for (const met of input.metrics) {
    validateField(schema, String(met.field), contract.name)
    validateNumericField(schema, String(met.field), met.aggregation)
  }

  // Resolve SQL
  const sql = typeof input.sql === 'function' ? input.sql() : input.sql

  return {
    contract,
    name: input.name,
    sql,
    dimensions: input.dimensions,
    metrics: input.metrics,
    description: input.description,
    refreshKey: input.refreshKey,
    dataSource: input.dataSource,
    meta: input.meta,
  }
}

/**
 * Create a type-safe query builder for a cube
 *
 * @example
 * ```typescript
 * const result = query(OrdersCube)
 *   .select('amount')
 *   .groupBy('status')
 *   .where('status', 'completed')
 *   .orderBy('amount', true)
 *   .limit(10)
 *   .build()
 * ```
 */
export function query<T>(cube: TypedCube<T>): TypedQueryBuilder<T> {
  const state: QueryBuilderState<T> = {
    measures: [],
    dimensions: [],
    timeDimensions: [],
    filters: [],
    order: [],
  }

  // Build maps for quick lookup
  const metricNames = new Map<string, TypedMetric<T>>()
  for (const m of cube.metrics) {
    metricNames.set(String(m.field), m)
  }

  const dimensionNames = new Map<string, TypedDimension<T>>()
  for (const d of cube.dimensions) {
    dimensionNames.set(String(d.field), d)
  }

  const builder: TypedQueryBuilder<T> = {
    select(...metrics) {
      for (const m of metrics) {
        const metricDef = metricNames.get(String(m))
        if (!metricDef) {
          throw new ContractIntegrationError(
            `Metric '${String(m)}' not found in cube '${cube.name}'. ` +
              `Available metrics: ${Array.from(metricNames.keys()).join(', ')}`
          )
        }
        state.measures.push(`${cube.name}.${String(m)}`)
      }
      return builder
    },

    measure(metricName) {
      // Allow direct metric name for flexibility
      if (metricName.includes('.')) {
        state.measures.push(metricName)
      } else {
        state.measures.push(`${cube.name}.${metricName}`)
      }
      return builder
    },

    groupBy(...dimensions) {
      for (const d of dimensions) {
        const dimDef = dimensionNames.get(String(d))
        if (!dimDef) {
          throw new ContractIntegrationError(
            `Dimension '${String(d)}' not found in cube '${cube.name}'. ` +
              `Available dimensions: ${Array.from(dimensionNames.keys()).join(', ')}`
          )
        }
        state.dimensions.push(`${cube.name}.${String(d)}`)
      }
      return builder
    },

    timeDimension(dimension, granularity, dateRange) {
      const dimDef = dimensionNames.get(String(dimension))
      if (!dimDef) {
        throw new ContractIntegrationError(
          `Dimension '${String(dimension)}' not found in cube '${cube.name}'.`
        )
      }
      if (dimDef.type !== 'time') {
        throw new ContractIntegrationError(
          `Dimension '${String(dimension)}' is not a time dimension (type: ${dimDef.type}).`
        )
      }
      state.timeDimensions.push({
        dimension: `${cube.name}.${String(dimension)}`,
        granularity,
        dateRange,
      })
      return builder
    },

    where(dimension, value, operator = 'equals') {
      const dimDef = dimensionNames.get(String(dimension))
      if (!dimDef) {
        throw new ContractIntegrationError(
          `Dimension '${String(dimension)}' not found in cube '${cube.name}'.`
        )
      }
      state.filters.push({
        dimension: `${cube.name}.${String(dimension)}`,
        operator,
        values: Array.isArray(value) ? value : [value],
      })
      return builder
    },

    filter(filter) {
      state.filters.push(filter)
      return builder
    },

    orderBy(field, desc = false) {
      // Check if field is a metric or dimension
      const isMetric = metricNames.has(String(field))
      const isDimension = dimensionNames.has(String(field))

      if (!isMetric && !isDimension) {
        throw new ContractIntegrationError(
          `Field '${String(field)}' not found in cube '${cube.name}'.`
        )
      }

      state.order.push({
        id: `${cube.name}.${String(field)}`,
        desc,
      })
      return builder
    },

    limit(n) {
      state.limit = n
      return builder
    },

    offset(n) {
      state.offset = n
      return builder
    },

    build(): SemanticQuery {
      return {
        measures: state.measures.length > 0 ? state.measures : undefined,
        dimensions: state.dimensions.length > 0 ? state.dimensions : undefined,
        timeDimensions: state.timeDimensions.length > 0 ? state.timeDimensions : undefined,
        filters: state.filters.length > 0 ? state.filters : undefined,
        order: state.order.length > 0 ? state.order : undefined,
        limit: state.limit,
        offset: state.offset,
      }
    },

    getCube() {
      return cube
    },
  }

  return builder
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Create dimension from contract schema field with auto-inferred type
 *
 * @example
 * ```typescript
 * const statusDim = dimensionFromContract<Order>(OrderContract, 'status')
 * // Auto-infers type as 'string'
 *
 * const createdAtDim = dimensionFromContract<Order>(OrderContract, 'createdAt')
 * // Auto-infers type as 'time' from format: 'date-time'
 * ```
 */
export function dimensionFromContract<T, K extends PropertyKeys<T> = PropertyKeys<T>>(
  contract: DataContract,
  field: K,
  config?: Omit<DimensionConfig, 'sql'>
): TypedDimension<T, K> {
  const schema = contract.schema
  validateField(schema, String(field), contract.name)

  const prop = schema.properties?.[String(field)]
  const fieldType = getFieldType(schema, String(field))
  const format = prop?.format as string | undefined
  const type = inferDimensionType(fieldType, format)

  return {
    field,
    sql: String(field),
    type,
    title: config?.title || prop?.description,
    description: config?.description,
    primaryKey: config?.primaryKey,
    granularity: config?.granularity || (type === 'time' ? 'day' : undefined),
    caseInsensitiveMatch: config?.caseInsensitiveMatch ?? (type === 'string'),
    shown: config?.shown,
    meta: config?.meta,
  }
}

/**
 * Create metric from contract schema field with validation
 *
 * @example
 * ```typescript
 * const revenue = metricFromContract<Order>(OrderContract, 'amount', 'sum')
 * // Validates that 'amount' is numeric
 * ```
 */
export function metricFromContract<T, K extends PropertyKeys<T> = PropertyKeys<T>>(
  contract: DataContract,
  field: K,
  aggregation: Aggregation,
  config?: Omit<MetricConfig<T>, 'sql'>
): TypedMetric<T, K> {
  const schema = contract.schema
  validateField(schema, String(field), contract.name)
  validateNumericField(schema, String(field), aggregation)

  const prop = schema.properties?.[String(field)]

  return {
    field,
    sql: String(field),
    aggregation,
    title: config?.title || prop?.description,
    description: config?.description,
    format: config?.format,
    drillMembers: config?.drillMembers,
    filters: config?.filters,
    shown: config?.shown,
    meta: config?.meta,
  }
}

/**
 * Infer all dimensions from a contract schema
 *
 * @example
 * ```typescript
 * const dimensions = inferDimensions<Order>(OrderContract)
 * // Returns dimensions for all fields in the schema
 * ```
 */
export function inferDimensions<T>(
  contract: DataContract,
  options?: {
    exclude?: PropertyKeys<T>[]
    include?: PropertyKeys<T>[]
  }
): TypedDimension<T>[] {
  const schema = contract.schema
  const fields = getSchemaFields(schema)
  const exclude = new Set(options?.exclude?.map(String) || [])
  const include = options?.include ? new Set(options.include.map(String)) : null

  const dimensions: TypedDimension<T>[] = []

  for (const field of fields) {
    if (exclude.has(field)) continue
    if (include && !include.has(field)) continue

    const prop = schema.properties?.[field]
    const fieldType = getFieldType(schema, field)
    const format = prop?.format as string | undefined
    const type = inferDimensionType(fieldType, format)

    dimensions.push({
      field: field as PropertyKeys<T>,
      sql: field,
      type,
      title: prop?.description,
      caseInsensitiveMatch: type === 'string',
      granularity: type === 'time' ? 'day' : undefined,
    })
  }

  return dimensions
}

/**
 * Infer aggregatable metrics from a contract schema (numeric fields only)
 *
 * @example
 * ```typescript
 * const metrics = inferMetrics<Order>(OrderContract, 'sum')
 * // Returns sum metrics for all numeric fields
 * ```
 */
export function inferMetrics<T>(
  contract: DataContract,
  aggregation: Aggregation = 'sum',
  options?: {
    exclude?: PropertyKeys<T>[]
    include?: PropertyKeys<T>[]
  }
): TypedMetric<T>[] {
  const schema = contract.schema
  const fields = getSchemaFields(schema)
  const exclude = new Set(options?.exclude?.map(String) || [])
  const include = options?.include ? new Set(options.include.map(String)) : null

  const metrics: TypedMetric<T>[] = []

  for (const field of fields) {
    if (exclude.has(field)) continue
    if (include && !include.has(field)) continue

    const fieldType = getFieldType(schema, field)

    // For count/countDistinct, any field is valid
    // For sum/avg/min/max, only numeric fields
    if (aggregation !== 'count' && aggregation !== 'countDistinct') {
      if (fieldType !== 'number' && fieldType !== 'integer') {
        continue
      }
    }

    const prop = schema.properties?.[field]

    metrics.push({
      field: field as PropertyKeys<T>,
      sql: field,
      aggregation,
      title: prop?.description,
    })
  }

  return metrics
}

// =============================================================================
// Type Guards and Utilities
// =============================================================================

/**
 * Check if a cube is bound to a specific contract
 */
export function isBoundToContract<T>(
  cube: TypedCube<T>,
  contractName: string
): boolean {
  return cube.contract.name === contractName
}

/**
 * Get all field names from a typed cube
 */
export function getCubeFields<T>(cube: TypedCube<T>): {
  dimensions: string[]
  metrics: string[]
} {
  return {
    dimensions: cube.dimensions.map((d) => String(d.field)),
    metrics: cube.metrics.map((m) => String(m.field)),
  }
}

/**
 * Convert typed cube to standard CubeDefinition for SemanticLayer
 */
export function toStandardCube<T>(cube: TypedCube<T>): {
  name: string
  sql: string
  measures: Record<string, { type: MetricType; sql?: string; description?: string }>
  dimensions: Record<string, { type: DimensionType; sql: string; description?: string }>
} {
  const measures: Record<string, { type: MetricType; sql?: string; description?: string }> = {}
  const dimensions: Record<string, { type: DimensionType; sql: string; description?: string }> = {}

  for (const m of cube.metrics) {
    const metricType = aggregationToMetricType(m.aggregation)
    measures[String(m.field)] = {
      type: metricType,
      sql: m.sql,
      description: m.description,
    }
  }

  for (const d of cube.dimensions) {
    dimensions[String(d.field)] = {
      type: d.type,
      sql: d.sql,
      description: d.description,
    }
  }

  return {
    name: cube.name,
    sql: cube.sql,
    measures,
    dimensions,
  }
}

/**
 * Convert aggregation type to metric type
 */
function aggregationToMetricType(aggregation: Aggregation): MetricType {
  switch (aggregation) {
    case 'count':
      return 'count'
    case 'countDistinct':
      return 'countDistinct'
    case 'sum':
      return 'sum'
    case 'avg':
      return 'avg'
    case 'min':
      return 'min'
    case 'max':
      return 'max'
    case 'custom':
      return 'custom'
    default:
      return 'sum'
  }
}
