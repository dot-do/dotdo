/**
 * Cube Schema DSL - TypeScript-first semantic layer definitions
 *
 * Provides a fluent, ergonomic API for defining cube schemas with:
 * - TypeScript-first schema definition
 * - Data source binding (table, SQL query, view)
 * - Measures and dimensions registration
 * - Joins to other cubes (one-to-one, one-to-many, many-to-many)
 * - Segments (predefined filters)
 * - Schema validation and type inference
 *
 * @example
 * ```typescript
 * import { cube, count, sum, avg, time, categorical } from './cube-dsl'
 *
 * const OrdersCube = cube({
 *   sql: () => `SELECT * FROM orders`,
 *   measures: {
 *     count: count(),
 *     revenue: sum('amount'),
 *     avgOrderValue: avg('amount'),
 *   },
 *   dimensions: {
 *     createdAt: time('created_at'),
 *     status: categorical('status'),
 *   },
 * })
 * ```
 *
 * @see dotdo-gjpif
 */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Supported measure types
 */
export type MeasureType =
  | 'count'
  | 'countDistinct'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'number'

/**
 * Supported dimension types
 */
export type DimensionType = 'string' | 'number' | 'time' | 'boolean' | 'geo'

/**
 * Time granularity options
 */
export type Granularity =
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'

/**
 * Join relationship types
 */
export type JoinRelationship = 'oneToOne' | 'oneToMany' | 'manyToMany'

/**
 * Measure definition
 */
export interface MeasureDefinition {
  type: MeasureType
  sql?: string
  title?: string
  description?: string
  format?: 'currency' | 'percent' | 'number' | string
  drillMembers?: string[]
  filters?: { sql: string }[]
  shown?: boolean
  meta?: Record<string, unknown>
}

/**
 * Dimension definition
 */
export interface DimensionDefinition {
  type: DimensionType
  sql: string
  title?: string
  description?: string
  primaryKey?: boolean
  granularity?: Granularity
  caseInsensitiveMatch?: boolean
  shown?: boolean
  meta?: Record<string, unknown>
}

/**
 * Join definition
 */
export interface JoinDefinition {
  relationship: JoinRelationship
  cube: string
  sql: string
  through?: string
  sourceKey?: string
  targetKey?: string
}

/**
 * Segment definition
 */
export interface SegmentDefinition {
  sql: string
  title?: string
  description?: string
}

/**
 * Cube definition (the output of the cube() factory)
 */
export interface CubeDefinition<
  TMeasures extends Record<string, MeasureDefinition> = Record<string, MeasureDefinition>,
  TDimensions extends Record<string, DimensionDefinition> = Record<string, DimensionDefinition>,
  TJoins extends Record<string, JoinDefinition> = Record<string, JoinDefinition>,
  TSegments extends Record<string, SegmentDefinition> = Record<string, SegmentDefinition>,
> {
  name?: string
  description?: string
  sql: string
  measures: TMeasures
  dimensions: TDimensions
  joins?: TJoins
  segments?: TSegments
  refreshKey?: {
    every?: string
    sql?: string
  }
  dataSource?: string
  meta?: Record<string, unknown>
}

/**
 * Cube input configuration
 */
export interface CubeInput<
  TMeasures extends Record<string, MeasureDefinition>,
  TDimensions extends Record<string, DimensionDefinition>,
  TJoins extends Record<string, JoinDefinition>,
  TSegments extends Record<string, SegmentDefinition>,
> {
  name?: string
  description?: string
  sql?: string | (() => string)
  table?: string
  view?: string
  measures: TMeasures
  dimensions: TDimensions
  joins?: TJoins
  segments?: TSegments
  refreshKey?: {
    every?: string
    sql?: string
  }
  dataSource?: string
  meta?: Record<string, unknown>
}

// =============================================================================
// Validation
// =============================================================================

const VALID_MEASURE_TYPES = new Set<MeasureType>([
  'count',
  'countDistinct',
  'sum',
  'avg',
  'min',
  'max',
  'number',
])

const VALID_DIMENSION_TYPES = new Set<DimensionType>([
  'string',
  'number',
  'time',
  'boolean',
  'geo',
])

/**
 * Error thrown for invalid cube definitions
 */
export class CubeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CubeValidationError'
  }
}

/**
 * Validate a cube definition
 */
export function validateCube(cube: CubeDefinition): void {
  // Validate SQL source
  if (!cube.sql) {
    throw new CubeValidationError('Cube must have a sql, table, or view property')
  }

  // Validate measures exist
  if (!cube.measures || typeof cube.measures !== 'object') {
    throw new CubeValidationError('Cube must have a measures object')
  }

  // Validate measure types
  for (const [name, measure] of Object.entries(cube.measures)) {
    if (!VALID_MEASURE_TYPES.has(measure.type)) {
      throw new CubeValidationError(
        `Invalid measure type '${measure.type}' for measure '${name}'. ` +
          `Valid types are: ${Array.from(VALID_MEASURE_TYPES).join(', ')}`
      )
    }

    // Sum, avg, min, max, countDistinct require sql
    if (measure.type !== 'count' && measure.type !== 'number' && !measure.sql) {
      throw new CubeValidationError(
        `Measure '${name}' of type '${measure.type}' requires sql property`
      )
    }
  }

  // Validate dimensions if present
  if (cube.dimensions) {
    for (const [name, dimension] of Object.entries(cube.dimensions)) {
      if (!VALID_DIMENSION_TYPES.has(dimension.type)) {
        throw new CubeValidationError(
          `Invalid dimension type '${dimension.type}' for dimension '${name}'. ` +
            `Valid types are: ${Array.from(VALID_DIMENSION_TYPES).join(', ')}`
        )
      }

      if (!dimension.sql) {
        throw new CubeValidationError(`Dimension '${name}' requires sql property`)
      }
    }
  }
}

// =============================================================================
// Cube Factory
// =============================================================================

/**
 * Create a cube schema definition
 *
 * @example
 * ```typescript
 * const OrdersCube = cube({
 *   sql: () => `SELECT * FROM orders`,
 *   measures: {
 *     count: count(),
 *     revenue: sum('amount'),
 *     avgOrderValue: avg('amount'),
 *   },
 *   dimensions: {
 *     createdAt: time('created_at'),
 *     status: categorical('status'),
 *   },
 * })
 * ```
 */
export function cube<
  TMeasures extends Record<string, MeasureDefinition>,
  TDimensions extends Record<string, DimensionDefinition>,
  TJoins extends Record<string, JoinDefinition> = Record<string, never>,
  TSegments extends Record<string, SegmentDefinition> = Record<string, never>,
>(
  input: CubeInput<TMeasures, TDimensions, TJoins, TSegments>
): CubeDefinition<TMeasures, TDimensions, TJoins, TSegments> {
  // Resolve SQL source
  let sql: string

  if (input.sql) {
    sql = typeof input.sql === 'function' ? input.sql() : input.sql
  } else if (input.table) {
    sql = `SELECT * FROM ${input.table}`
  } else if (input.view) {
    sql = `SELECT * FROM ${input.view}`
  } else {
    throw new CubeValidationError('Cube must have sql, table, or view property')
  }

  // Validate measures
  if (!input.measures || typeof input.measures !== 'object') {
    throw new CubeValidationError('Cube must have a measures object')
  }

  // Build the cube definition
  const cubeDef: CubeDefinition<TMeasures, TDimensions, TJoins, TSegments> = {
    name: input.name,
    description: input.description,
    sql,
    measures: input.measures,
    dimensions: input.dimensions,
    joins: input.joins,
    segments: input.segments,
    refreshKey: input.refreshKey,
    dataSource: input.dataSource,
    meta: input.meta,
  }

  // Validate the cube
  validateCube(cubeDef)

  return cubeDef
}

// =============================================================================
// Measure Helpers
// =============================================================================

/**
 * Options for measure definitions
 */
export interface MeasureOptions {
  title?: string
  description?: string
  format?: 'currency' | 'percent' | 'number' | string
  drillMembers?: string[]
  filters?: { sql: string }[]
  shown?: boolean
  meta?: Record<string, unknown>
}

/**
 * Create a COUNT measure
 *
 * @example
 * ```typescript
 * const measures = {
 *   count: count(),
 *   orderCount: count({ title: 'Order Count' }),
 * }
 * ```
 */
export function count(options?: MeasureOptions): MeasureDefinition {
  return {
    type: 'count',
    title: options?.title,
    description: options?.description,
    format: options?.format,
    drillMembers: options?.drillMembers,
    filters: options?.filters,
    shown: options?.shown,
    meta: options?.meta,
  }
}

/**
 * Create a SUM measure
 *
 * @example
 * ```typescript
 * const measures = {
 *   revenue: sum('amount'),
 *   totalRevenue: sum('amount', { title: 'Revenue', format: 'currency' }),
 * }
 * ```
 */
export function sum(sql: string, options?: MeasureOptions): MeasureDefinition {
  return {
    type: 'sum',
    sql,
    title: options?.title,
    description: options?.description,
    format: options?.format,
    drillMembers: options?.drillMembers,
    filters: options?.filters,
    shown: options?.shown,
    meta: options?.meta,
  }
}

/**
 * Create an AVG measure
 *
 * @example
 * ```typescript
 * const measures = {
 *   avgOrderValue: avg('amount'),
 * }
 * ```
 */
export function avg(sql: string, options?: MeasureOptions): MeasureDefinition {
  return {
    type: 'avg',
    sql,
    title: options?.title,
    description: options?.description,
    format: options?.format,
    drillMembers: options?.drillMembers,
    filters: options?.filters,
    shown: options?.shown,
    meta: options?.meta,
  }
}

/**
 * Create a MIN measure
 *
 * @example
 * ```typescript
 * const measures = {
 *   minOrder: min('amount'),
 * }
 * ```
 */
export function min(sql: string, options?: MeasureOptions): MeasureDefinition {
  return {
    type: 'min',
    sql,
    title: options?.title,
    description: options?.description,
    format: options?.format,
    drillMembers: options?.drillMembers,
    filters: options?.filters,
    shown: options?.shown,
    meta: options?.meta,
  }
}

/**
 * Create a MAX measure
 *
 * @example
 * ```typescript
 * const measures = {
 *   maxOrder: max('amount'),
 * }
 * ```
 */
export function max(sql: string, options?: MeasureOptions): MeasureDefinition {
  return {
    type: 'max',
    sql,
    title: options?.title,
    description: options?.description,
    format: options?.format,
    drillMembers: options?.drillMembers,
    filters: options?.filters,
    shown: options?.shown,
    meta: options?.meta,
  }
}

/**
 * Create a COUNT DISTINCT measure
 *
 * @example
 * ```typescript
 * const measures = {
 *   uniqueCustomers: countDistinct('customer_id'),
 * }
 * ```
 */
export function countDistinct(sql: string, options?: MeasureOptions): MeasureDefinition {
  return {
    type: 'countDistinct',
    sql,
    title: options?.title,
    description: options?.description,
    format: options?.format,
    drillMembers: options?.drillMembers,
    filters: options?.filters,
    shown: options?.shown,
    meta: options?.meta,
  }
}

// =============================================================================
// Dimension Helpers
// =============================================================================

/**
 * Options for dimension definitions
 */
export interface DimensionOptions {
  title?: string
  description?: string
  primaryKey?: boolean
  granularity?: Granularity
  caseInsensitiveMatch?: boolean
  shown?: boolean
  meta?: Record<string, unknown>
}

/**
 * Create a TIME dimension
 *
 * @example
 * ```typescript
 * const dimensions = {
 *   createdAt: time('created_at'),
 *   orderDate: time('order_date', { title: 'Order Date', granularity: 'day' }),
 * }
 * ```
 */
export function time(sql: string, options?: DimensionOptions): DimensionDefinition {
  return {
    type: 'time',
    sql,
    title: options?.title,
    description: options?.description,
    primaryKey: options?.primaryKey,
    granularity: options?.granularity,
    caseInsensitiveMatch: options?.caseInsensitiveMatch,
    shown: options?.shown,
    meta: options?.meta,
  }
}

/**
 * Create a CATEGORICAL (string) dimension
 *
 * @example
 * ```typescript
 * const dimensions = {
 *   status: categorical('status'),
 *   category: categorical('category', { title: 'Product Category' }),
 * }
 * ```
 */
export function categorical(sql: string, options?: DimensionOptions): DimensionDefinition {
  return {
    type: 'string',
    sql,
    title: options?.title,
    description: options?.description,
    primaryKey: options?.primaryKey,
    granularity: options?.granularity,
    caseInsensitiveMatch: options?.caseInsensitiveMatch ?? true,
    shown: options?.shown,
    meta: options?.meta,
  }
}

/**
 * Create a NUMERIC dimension
 *
 * @example
 * ```typescript
 * const dimensions = {
 *   id: numeric('id', { primaryKey: true }),
 *   quantity: numeric('quantity'),
 * }
 * ```
 */
export function numeric(sql: string, options?: DimensionOptions): DimensionDefinition {
  return {
    type: 'number',
    sql,
    title: options?.title,
    description: options?.description,
    primaryKey: options?.primaryKey,
    granularity: options?.granularity,
    caseInsensitiveMatch: options?.caseInsensitiveMatch,
    shown: options?.shown,
    meta: options?.meta,
  }
}

/**
 * Create a BOOLEAN dimension
 *
 * @example
 * ```typescript
 * const dimensions = {
 *   isActive: boolean('is_active'),
 * }
 * ```
 */
export function boolean(sql: string, options?: DimensionOptions): DimensionDefinition {
  return {
    type: 'boolean',
    sql,
    title: options?.title,
    description: options?.description,
    primaryKey: options?.primaryKey,
    granularity: options?.granularity,
    caseInsensitiveMatch: options?.caseInsensitiveMatch,
    shown: options?.shown,
    meta: options?.meta,
  }
}

// =============================================================================
// Join Helpers
// =============================================================================

/**
 * Options for join with custom SQL
 */
export interface JoinSqlOptions {
  sql: string
}

/**
 * Options for many-to-many joins
 */
export interface ManyToManyOptions {
  through: string
  sourceKey: string
  targetKey: string
}

/**
 * Create a one-to-one join
 *
 * @example
 * ```typescript
 * // Simple syntax with columns
 * oneToOne('UserProfile', 'user_id', 'user_id')
 *
 * // Custom SQL syntax
 * oneToOne('UserProfile', { sql: '${CUBE}.user_id = ${UserProfile}.id' })
 * ```
 */
export function oneToOne(
  cube: string,
  sourceColumnOrOptions: string | JoinSqlOptions,
  targetColumn?: string
): JoinDefinition {
  let sql: string

  if (typeof sourceColumnOrOptions === 'object') {
    sql = sourceColumnOrOptions.sql
  } else if (targetColumn) {
    sql = `\${CUBE}.${sourceColumnOrOptions} = \${${cube}}.${targetColumn}`
  } else {
    throw new CubeValidationError('oneToOne requires either (cube, sourceCol, targetCol) or (cube, { sql })')
  }

  return {
    relationship: 'oneToOne',
    cube,
    sql,
  }
}

/**
 * Create a one-to-many join
 *
 * @example
 * ```typescript
 * // Simple syntax with columns
 * oneToMany('OrderItems', 'id', 'order_id')
 *
 * // Custom SQL syntax
 * oneToMany('OrderItems', { sql: '${CUBE}.id = ${OrderItems}.order_id' })
 * ```
 */
export function oneToMany(
  cube: string,
  sourceColumnOrOptions: string | JoinSqlOptions,
  targetColumn?: string
): JoinDefinition {
  let sql: string

  if (typeof sourceColumnOrOptions === 'object') {
    sql = sourceColumnOrOptions.sql
  } else if (targetColumn) {
    sql = `\${CUBE}.${sourceColumnOrOptions} = \${${cube}}.${targetColumn}`
  } else {
    throw new CubeValidationError('oneToMany requires either (cube, sourceCol, targetCol) or (cube, { sql })')
  }

  return {
    relationship: 'oneToMany',
    cube,
    sql,
  }
}

/**
 * Create a many-to-many join with a junction table
 *
 * @example
 * ```typescript
 * manyToMany('Tags', {
 *   through: 'order_tags',
 *   sourceKey: 'order_id',
 *   targetKey: 'tag_id',
 * })
 * ```
 */
export function manyToMany(cube: string, options: ManyToManyOptions): JoinDefinition {
  const sql = `\${CUBE}.id = \${${options.through}}.${options.sourceKey} AND \${${options.through}}.${options.targetKey} = \${${cube}}.id`

  return {
    relationship: 'manyToMany',
    cube,
    sql,
    through: options.through,
    sourceKey: options.sourceKey,
    targetKey: options.targetKey,
  }
}

// =============================================================================
// Segment Helper
// =============================================================================

/**
 * Options for segment definitions
 */
export interface SegmentOptions {
  title?: string
  description?: string
}

/**
 * Create a segment (predefined filter)
 *
 * @example
 * ```typescript
 * const segments = {
 *   completed: segment(`status = 'completed'`),
 *   highValue: segment(`amount > 100`, { title: 'High Value Orders' }),
 * }
 * ```
 */
export function segment(sql: string, options?: SegmentOptions): SegmentDefinition {
  return {
    sql,
    title: options?.title,
    description: options?.description,
  }
}
