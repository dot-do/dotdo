/**
 * Cube.js-Compatible Schema Definitions
 *
 * Provides a Cube.js-compatible semantic layer API for defining cubes,
 * measures, dimensions, pre-aggregations, joins, and segments.
 *
 * @example
 * ```typescript
 * import { createCube, countMeasure, sumMeasure, timeDimension, categoricalDimension, rollup } from './cube'
 *
 * const ordersCube = createCube({
 *   name: 'Orders',
 *   sql: 'SELECT * FROM orders',
 *   measures: {
 *     count: countMeasure(),
 *     revenue: sumMeasure({ sql: 'amount' }),
 *   },
 *   dimensions: {
 *     status: categoricalDimension({ sql: 'status' }),
 *     createdAt: timeDimension({ sql: 'created_at' }),
 *   },
 *   preAggregations: {
 *     daily_status: rollup({
 *       measures: ['count', 'revenue'],
 *       dimensions: ['status'],
 *       timeDimension: 'createdAt',
 *       granularity: 'day',
 *     }),
 *   },
 * })
 * ```
 *
 * @see dotdo-oi5zh
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Supported SQL dialects
 */
export type SQLDialect = 'postgres' | 'clickhouse' | 'duckdb' | 'sqlite' | 'mysql'

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
 * Measure types
 */
export type MeasureType =
  | 'count'
  | 'countDistinct'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'number'
  | 'percentile'
  | 'runningTotal'

/**
 * Dimension types
 */
export type DimensionType = 'string' | 'number' | 'time' | 'boolean' | 'geo'

/**
 * Join relationship types (Cube.js compatible)
 */
export type JoinRelationship = 'belongsTo' | 'hasMany' | 'hasOne' | 'manyToMany'

/**
 * Filter operator
 */
export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'notContains'
  | 'set'
  | 'notSet'

/**
 * Pre-aggregation type
 */
export type PreAggregationType = 'rollup' | 'originalSql' | 'autoRollup'

/**
 * Measure filter definition
 */
export interface MeasureFilter {
  sql: string
}

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
  filters?: MeasureFilter[]
  shown?: boolean
  percentile?: number
  meta?: Record<string, unknown>
}

/**
 * Dimension definition
 */
export interface DimensionDefinition {
  type: DimensionType
  sql?: string
  title?: string
  description?: string
  primaryKey?: boolean
  granularity?: Granularity
  timezone?: string
  caseInsensitive?: boolean
  shown?: boolean
  // For geo dimensions
  latitude?: { sql: string }
  longitude?: { sql: string }
  meta?: Record<string, unknown>
}

/**
 * Join definition
 */
export interface JoinDefinition {
  relationship: JoinRelationship
  sql: string
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
 * Pre-aggregation index definition
 */
export interface PreAggregationIndex {
  columns: string[]
}

/**
 * Pre-aggregation refresh key definition
 */
export interface RefreshKey {
  every?: string
  sql?: string
  incremental?: boolean
  updateWindow?: string
}

/**
 * Pre-aggregation definition
 */
export interface PreAggregationDefinition {
  type: PreAggregationType
  measures?: string[]
  dimensions?: string[]
  timeDimension?: string
  granularity?: Granularity
  partitionGranularity?: Granularity
  refreshKey?: RefreshKey
  indexes?: Record<string, PreAggregationIndex>
  external?: boolean
  maxPreAggregations?: number
}

/**
 * Cube query for finding pre-aggregations
 */
export interface CubeQuery {
  measures?: string[]
  dimensions?: string[]
  timeDimension?: { dimension: string; granularity: Granularity }
}

/**
 * Full cube query for SQL generation
 */
export interface FullCubeQuery {
  measures?: string[]
  dimensions?: string[]
  timeDimensions?: Array<{ dimension: string; granularity: Granularity }>
  filters?: Array<{ dimension: string; operator: FilterOperator; values: string[] }>
  order?: Array<{ id: string; desc: boolean }>
  limit?: number
  offset?: number
}

/**
 * Cube definition input
 */
export interface CubeInput {
  name: string
  sql?: string | (() => string)
  sqlTable?: string
  extends?: CubeSchema
  dataSource?: string
  title?: string
  description?: string
  refreshKey?: RefreshKey
  measures: Record<string, MeasureDefinition>
  dimensions: Record<string, DimensionDefinition>
  joins?: Record<string, JoinDefinition>
  segments?: Record<string, SegmentDefinition>
  preAggregations?: Record<string, PreAggregationDefinition>
}

/**
 * Cube definition (output of createCube)
 */
export interface CubeDefinition {
  name: string
  sql: string
  dataSource?: string
  title?: string
  description?: string
  refreshKey?: RefreshKey
  measures: Record<string, MeasureDefinition>
  dimensions: Record<string, DimensionDefinition>
  joins?: Record<string, JoinDefinition>
  segments?: Record<string, SegmentDefinition>
  preAggregations?: Record<string, PreAggregationDefinition>
}

// =============================================================================
// ERROR CLASSES
// =============================================================================

/**
 * Error thrown for invalid cube schema definitions
 */
export class CubeSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CubeSchemaError'
  }
}

// =============================================================================
// VALIDATION
// =============================================================================

const VALID_MEASURE_TYPES = new Set<MeasureType>([
  'count',
  'countDistinct',
  'sum',
  'avg',
  'min',
  'max',
  'number',
  'percentile',
  'runningTotal',
])

const VALID_DIMENSION_TYPES = new Set<DimensionType>([
  'string',
  'number',
  'time',
  'boolean',
  'geo',
])

const GRANULARITY_ORDER: Granularity[] = [
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
]

/**
 * Validate a cube schema definition
 */
export function validateCubeSchema(cube: CubeDefinition): void {
  // Validate name
  if (!cube.name || cube.name.trim() === '') {
    throw new CubeSchemaError('Cube name is required')
  }

  // Validate SQL source
  if (!cube.sql || cube.sql.trim() === '') {
    throw new CubeSchemaError('Cube must have a sql or sqlTable property')
  }

  // Validate measures exist and have at least one
  if (!cube.measures || Object.keys(cube.measures).length === 0) {
    throw new CubeSchemaError('Cube must have at least one measure')
  }

  // Validate measure types and required properties
  for (const [name, measure] of Object.entries(cube.measures)) {
    if (!VALID_MEASURE_TYPES.has(measure.type)) {
      throw new CubeSchemaError(
        `Invalid measure type '${measure.type}' for measure '${name}'. ` +
          `Valid types are: ${Array.from(VALID_MEASURE_TYPES).join(', ')}`
      )
    }

    // Sum, avg, min, max, countDistinct, percentile, runningTotal require sql
    if (
      measure.type !== 'count' &&
      measure.type !== 'number' &&
      !measure.sql
    ) {
      throw new CubeSchemaError(
        `Measure '${name}' of type '${measure.type}' requires sql property`
      )
    }
  }

  // Validate dimensions if present
  if (cube.dimensions) {
    for (const [name, dimension] of Object.entries(cube.dimensions)) {
      if (!VALID_DIMENSION_TYPES.has(dimension.type)) {
        throw new CubeSchemaError(
          `Invalid dimension type '${dimension.type}' for dimension '${name}'. ` +
            `Valid types are: ${Array.from(VALID_DIMENSION_TYPES).join(', ')}`
        )
      }

      // Non-geo dimensions require sql (unless it's a geo with lat/lng)
      if (dimension.type !== 'geo' && !dimension.sql) {
        throw new CubeSchemaError(`Dimension '${name}' requires sql property`)
      }
    }
  }

  // Validate pre-aggregation references
  if (cube.preAggregations) {
    for (const [paName, pa] of Object.entries(cube.preAggregations)) {
      // Validate measure references
      if (pa.measures) {
        for (const measureName of pa.measures) {
          if (!cube.measures[measureName]) {
            throw new CubeSchemaError(
              `Pre-aggregation '${paName}' references non-existent measure '${measureName}'`
            )
          }
        }
      }

      // Validate dimension references
      if (pa.dimensions) {
        for (const dimName of pa.dimensions) {
          if (!cube.dimensions?.[dimName]) {
            throw new CubeSchemaError(
              `Pre-aggregation '${paName}' references non-existent dimension '${dimName}'`
            )
          }
        }
      }

      // Validate time dimension reference
      if (pa.timeDimension && !cube.dimensions?.[pa.timeDimension]) {
        throw new CubeSchemaError(
          `Pre-aggregation '${paName}' references non-existent time dimension '${pa.timeDimension}'`
        )
      }
    }
  }
}

// =============================================================================
// CUBE SCHEMA CLASS
// =============================================================================

/**
 * Cube schema with pre-aggregation matching
 */
export class CubeSchema implements CubeDefinition {
  public readonly name: string
  public readonly sql: string
  public readonly dataSource?: string
  public readonly title?: string
  public readonly description?: string
  public readonly refreshKey?: RefreshKey
  public readonly measures: Record<string, MeasureDefinition>
  public readonly dimensions: Record<string, DimensionDefinition>
  public readonly joins?: Record<string, JoinDefinition>
  public readonly segments?: Record<string, SegmentDefinition>
  public readonly preAggregations?: Record<string, PreAggregationDefinition>

  constructor(definition: CubeDefinition) {
    this.name = definition.name
    this.sql = definition.sql
    this.dataSource = definition.dataSource
    this.title = definition.title
    this.description = definition.description
    this.refreshKey = definition.refreshKey
    this.measures = definition.measures
    this.dimensions = definition.dimensions
    this.joins = definition.joins
    this.segments = definition.segments
    this.preAggregations = definition.preAggregations
  }

  /**
   * Find a matching pre-aggregation for a query
   */
  findPreAggregation(query: CubeQuery): string | null {
    if (!this.preAggregations) {
      return null
    }

    const queryMeasures = query.measures || []
    const queryDimensions = query.dimensions || []
    const queryTimeDim = query.timeDimension?.dimension
    const queryGranularity = query.timeDimension?.granularity

    for (const [name, pa] of Object.entries(this.preAggregations)) {
      if (pa.type !== 'rollup') continue

      const paMeasures = pa.measures || []
      const paDimensions = pa.dimensions || []

      // All query measures must be in pre-agg measures
      const measuresMatch = queryMeasures.every((m) => paMeasures.includes(m))
      if (!measuresMatch) continue

      // All query dimensions must be in pre-agg dimensions
      const dimensionsMatch = queryDimensions.every((d) => paDimensions.includes(d))
      if (!dimensionsMatch) continue

      // Time dimension check
      if (queryTimeDim) {
        if (pa.timeDimension !== queryTimeDim) continue

        // Check granularity compatibility (finer pre-agg can serve coarser query)
        if (queryGranularity && pa.granularity) {
          const paGranIndex = GRANULARITY_ORDER.indexOf(pa.granularity)
          const queryGranIndex = GRANULARITY_ORDER.indexOf(queryGranularity)
          // Pre-agg granularity must be equal or finer than query granularity
          if (paGranIndex > queryGranIndex) continue
        }
      }

      return name
    }

    return null
  }
}

// =============================================================================
// CUBE FACTORY
// =============================================================================

/**
 * Create a cube schema definition
 */
export function createCube(input: CubeInput): CubeSchema {
  // Validate required fields
  if (!input.name || input.name.trim() === '') {
    throw new CubeSchemaError('Cube name is required')
  }

  // Resolve SQL source
  let sql: string

  if (input.extends) {
    // Inherit from parent cube
    sql = input.extends.sql
  } else if (input.sql) {
    sql = typeof input.sql === 'function' ? input.sql() : input.sql
  } else if (input.sqlTable) {
    sql = `SELECT * FROM ${input.sqlTable}`
  } else {
    throw new CubeSchemaError('Cube must have sql, sqlTable, or extends property')
  }

  if (!sql || sql.trim() === '') {
    throw new CubeSchemaError('Cube must have a sql or sqlTable property')
  }

  // Merge with parent if extending
  let measures = { ...input.measures }
  let dimensions = { ...input.dimensions }
  let joins = input.joins ? { ...input.joins } : undefined
  let segments = input.segments ? { ...input.segments } : undefined
  let preAggregations = input.preAggregations ? { ...input.preAggregations } : undefined

  if (input.extends) {
    measures = { ...input.extends.measures, ...measures }
    dimensions = { ...input.extends.dimensions, ...dimensions }
    if (input.extends.joins) {
      joins = { ...input.extends.joins, ...joins }
    }
    if (input.extends.segments) {
      segments = { ...input.extends.segments, ...segments }
    }
    if (input.extends.preAggregations) {
      preAggregations = { ...input.extends.preAggregations, ...preAggregations }
    }
  }

  // Validate measures exist
  if (!measures || Object.keys(measures).length === 0) {
    throw new CubeSchemaError('Cube must have at least one measure')
  }

  const definition: CubeDefinition = {
    name: input.name,
    sql,
    dataSource: input.dataSource,
    title: input.title,
    description: input.description,
    refreshKey: input.refreshKey,
    measures,
    dimensions,
    joins,
    segments,
    preAggregations,
  }

  // Validate the cube
  validateCubeSchema(definition)

  return new CubeSchema(definition)
}

// =============================================================================
// CUBE BUILDER (FLUENT API)
// =============================================================================

/**
 * Fluent builder for cube schemas
 */
export class CubeBuilder {
  private _name: string
  private _sql?: string
  private _dataSource?: string
  private _title?: string
  private _description?: string
  private _refreshKey?: RefreshKey
  private _measures: Record<string, MeasureDefinition> = {}
  private _dimensions: Record<string, DimensionDefinition> = {}
  private _joins: Record<string, JoinDefinition> = {}
  private _segments: Record<string, SegmentDefinition> = {}
  private _preAggregations: Record<string, PreAggregationDefinition> = {}

  constructor(name: string) {
    this._name = name
  }

  sql(sql: string | (() => string)): this {
    this._sql = typeof sql === 'function' ? sql() : sql
    return this
  }

  dataSource(dataSource: string): this {
    this._dataSource = dataSource
    return this
  }

  title(title: string): this {
    this._title = title
    return this
  }

  description(description: string): this {
    this._description = description
    return this
  }

  refreshKey(refreshKey: RefreshKey): this {
    this._refreshKey = refreshKey
    return this
  }

  measure(name: string, definition: MeasureDefinition): this {
    this._measures[name] = definition
    return this
  }

  dimension(name: string, definition: DimensionDefinition): this {
    this._dimensions[name] = definition
    return this
  }

  join(name: string, definition: JoinDefinition): this {
    this._joins[name] = definition
    return this
  }

  segment(name: string, definition: SegmentDefinition): this {
    this._segments[name] = definition
    return this
  }

  preAggregation(name: string, definition: PreAggregationDefinition): this {
    this._preAggregations[name] = definition
    return this
  }

  build(): CubeSchema {
    return createCube({
      name: this._name,
      sql: this._sql,
      dataSource: this._dataSource,
      title: this._title,
      description: this._description,
      refreshKey: this._refreshKey,
      measures: this._measures,
      dimensions: this._dimensions,
      joins: Object.keys(this._joins).length > 0 ? this._joins : undefined,
      segments: Object.keys(this._segments).length > 0 ? this._segments : undefined,
      preAggregations: Object.keys(this._preAggregations).length > 0 ? this._preAggregations : undefined,
    })
  }
}

// =============================================================================
// MEASURE HELPERS
// =============================================================================

interface MeasureOptions {
  sql?: string
  title?: string
  description?: string
  format?: 'currency' | 'percent' | 'number' | string
  drillMembers?: string[]
  filters?: MeasureFilter[]
  shown?: boolean
  meta?: Record<string, unknown>
}

interface PercentileMeasureOptions extends MeasureOptions {
  sql: string
  percentile: number
}

interface CustomMeasureOptions extends Omit<MeasureOptions, 'sql'> {
  sql: string
  type: 'number'
}

/**
 * Create a generic measure
 */
export function measure(options: MeasureDefinition): MeasureDefinition {
  return options
}

/**
 * Create a COUNT measure
 */
export function countMeasure(options?: MeasureOptions): MeasureDefinition {
  return {
    type: 'count',
    sql: options?.sql,
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
 */
export function sumMeasure(options: MeasureOptions & { sql: string }): MeasureDefinition {
  return {
    type: 'sum',
    sql: options.sql,
    title: options.title,
    description: options.description,
    format: options.format,
    drillMembers: options.drillMembers,
    filters: options.filters,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create an AVG measure
 */
export function avgMeasure(options: MeasureOptions & { sql: string }): MeasureDefinition {
  return {
    type: 'avg',
    sql: options.sql,
    title: options.title,
    description: options.description,
    format: options.format,
    drillMembers: options.drillMembers,
    filters: options.filters,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create a MIN measure
 */
export function minMeasure(options: MeasureOptions & { sql: string }): MeasureDefinition {
  return {
    type: 'min',
    sql: options.sql,
    title: options.title,
    description: options.description,
    format: options.format,
    drillMembers: options.drillMembers,
    filters: options.filters,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create a MAX measure
 */
export function maxMeasure(options: MeasureOptions & { sql: string }): MeasureDefinition {
  return {
    type: 'max',
    sql: options.sql,
    title: options.title,
    description: options.description,
    format: options.format,
    drillMembers: options.drillMembers,
    filters: options.filters,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create a COUNT DISTINCT measure
 */
export function countDistinctMeasure(options: MeasureOptions & { sql: string }): MeasureDefinition {
  return {
    type: 'countDistinct',
    sql: options.sql,
    title: options.title,
    description: options.description,
    format: options.format,
    drillMembers: options.drillMembers,
    filters: options.filters,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create a PERCENTILE measure
 */
export function percentileMeasure(options: PercentileMeasureOptions): MeasureDefinition {
  if (options.percentile < 0 || options.percentile > 100) {
    throw new CubeSchemaError(`Percentile must be between 0 and 100, got ${options.percentile}`)
  }

  return {
    type: 'percentile',
    sql: options.sql,
    percentile: options.percentile,
    title: options.title,
    description: options.description,
    format: options.format,
    drillMembers: options.drillMembers,
    filters: options.filters,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create a RUNNING TOTAL measure
 */
export function runningTotalMeasure(options: MeasureOptions & { sql: string }): MeasureDefinition {
  return {
    type: 'runningTotal',
    sql: options.sql,
    title: options.title,
    description: options.description,
    format: options.format,
    drillMembers: options.drillMembers,
    filters: options.filters,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create a custom SQL measure
 */
export function customMeasure(options: CustomMeasureOptions): MeasureDefinition {
  return {
    type: options.type,
    sql: options.sql,
    title: options.title,
    description: options.description,
    format: options.format,
    drillMembers: options.drillMembers,
    filters: options.filters,
    shown: options.shown,
    meta: options.meta,
  }
}

// =============================================================================
// DIMENSION HELPERS
// =============================================================================

interface DimensionOptions {
  type: DimensionType
  sql?: string
  title?: string
  description?: string
  primaryKey?: boolean
  shown?: boolean
  meta?: Record<string, unknown>
}

interface TimeDimensionOptions {
  sql: string
  title?: string
  description?: string
  primaryKey?: boolean
  granularity?: Granularity
  timezone?: string
  shown?: boolean
  meta?: Record<string, unknown>
}

interface CategoricalDimensionOptions {
  sql: string
  title?: string
  description?: string
  primaryKey?: boolean
  caseInsensitive?: boolean
  shown?: boolean
  meta?: Record<string, unknown>
}

interface NumericDimensionOptions {
  sql: string
  title?: string
  description?: string
  primaryKey?: boolean
  shown?: boolean
  meta?: Record<string, unknown>
}

interface BooleanDimensionOptions {
  sql: string
  title?: string
  description?: string
  shown?: boolean
  meta?: Record<string, unknown>
}

interface DerivedDimensionOptions {
  sql: string
  type: DimensionType
  title?: string
  description?: string
  shown?: boolean
  meta?: Record<string, unknown>
}

interface GeoDimensionOptions {
  sql?: string
  latitude?: { sql: string }
  longitude?: { sql: string }
  title?: string
  description?: string
  shown?: boolean
  meta?: Record<string, unknown>
}

/**
 * Create a generic dimension
 */
export function dimension(options: DimensionOptions): DimensionDefinition {
  return options
}

/**
 * Create a TIME dimension
 */
export function timeDimension(options: TimeDimensionOptions): DimensionDefinition {
  return {
    type: 'time',
    sql: options.sql,
    title: options.title,
    description: options.description,
    primaryKey: options.primaryKey,
    granularity: options.granularity,
    timezone: options.timezone,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create a CATEGORICAL (string) dimension
 */
export function categoricalDimension(options: CategoricalDimensionOptions): DimensionDefinition {
  return {
    type: 'string',
    sql: options.sql,
    title: options.title,
    description: options.description,
    primaryKey: options.primaryKey,
    caseInsensitive: options.caseInsensitive,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create a NUMERIC dimension
 */
export function numericDimension(options: NumericDimensionOptions): DimensionDefinition {
  return {
    type: 'number',
    sql: options.sql,
    title: options.title,
    description: options.description,
    primaryKey: options.primaryKey,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create a BOOLEAN dimension
 */
export function booleanDimension(options: BooleanDimensionOptions): DimensionDefinition {
  return {
    type: 'boolean',
    sql: options.sql,
    title: options.title,
    description: options.description,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create a DERIVED dimension from SQL expression
 */
export function derivedDimension(options: DerivedDimensionOptions): DimensionDefinition {
  return {
    type: options.type,
    sql: options.sql,
    title: options.title,
    description: options.description,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create a GEO dimension
 */
export function geoDimension(options: GeoDimensionOptions): DimensionDefinition {
  return {
    type: 'geo',
    sql: options.sql,
    latitude: options.latitude,
    longitude: options.longitude,
    title: options.title,
    description: options.description,
    shown: options.shown,
    meta: options.meta,
  }
}

// =============================================================================
// PRE-AGGREGATION HELPERS
// =============================================================================

interface RollupOptions {
  measures: string[]
  dimensions: string[]
  timeDimension?: string
  granularity?: Granularity
  partitionGranularity?: Granularity
  refreshKey?: RefreshKey
  indexes?: Record<string, PreAggregationIndex>
}

interface OriginalSqlOptions {
  refreshKey?: RefreshKey
  external?: boolean
}

interface AutoRollupOptions {
  maxPreAggregations?: number
}

/**
 * Create a generic pre-aggregation
 */
export function preAggregation(options: PreAggregationDefinition): PreAggregationDefinition {
  return options
}

/**
 * Create a ROLLUP pre-aggregation
 */
export function rollup(options: RollupOptions): PreAggregationDefinition {
  return {
    type: 'rollup',
    measures: options.measures,
    dimensions: options.dimensions,
    timeDimension: options.timeDimension,
    granularity: options.granularity,
    partitionGranularity: options.partitionGranularity,
    refreshKey: options.refreshKey,
    indexes: options.indexes,
  }
}

/**
 * Create an ORIGINAL SQL pre-aggregation
 */
export function originalSql(options: OriginalSqlOptions): PreAggregationDefinition {
  return {
    type: 'originalSql',
    refreshKey: options.refreshKey,
    external: options.external,
  }
}

/**
 * Create an AUTO ROLLUP pre-aggregation
 */
export function autoRollup(options: AutoRollupOptions): PreAggregationDefinition {
  return {
    type: 'autoRollup',
    maxPreAggregations: options.maxPreAggregations,
  }
}

// =============================================================================
// JOIN HELPERS
// =============================================================================

interface JoinOptions {
  sql: string
}

/**
 * Create a generic join
 */
export function join(relationship: JoinRelationship, options: JoinOptions): JoinDefinition {
  return {
    relationship,
    sql: options.sql,
  }
}

/**
 * Create a BELONGS_TO join (many-to-one)
 */
export function belongsTo(options: JoinOptions): JoinDefinition {
  return {
    relationship: 'belongsTo',
    sql: options.sql,
  }
}

/**
 * Create a HAS_MANY join (one-to-many)
 */
export function hasMany(options: JoinOptions): JoinDefinition {
  return {
    relationship: 'hasMany',
    sql: options.sql,
  }
}

/**
 * Create a HAS_ONE join (one-to-one)
 */
export function hasOne(options: JoinOptions): JoinDefinition {
  return {
    relationship: 'hasOne',
    sql: options.sql,
  }
}

/**
 * Create a MANY_TO_MANY join
 */
export function manyToMany(options: JoinOptions): JoinDefinition {
  return {
    relationship: 'manyToMany',
    sql: options.sql,
  }
}

// =============================================================================
// SEGMENT HELPERS
// =============================================================================

interface SegmentOptions {
  sql: string
  title?: string
  description?: string
}

/**
 * Create a segment (predefined filter)
 */
export function segment(options: SegmentOptions): SegmentDefinition {
  return {
    sql: options.sql,
    title: options.title,
    description: options.description,
  }
}

// =============================================================================
// SQL GENERATION
// =============================================================================

/**
 * Generate SQL for a measure
 */
export function generateMeasureSQL(
  measure: MeasureDefinition,
  cubeName: string,
  dialect: SQLDialect
): string {
  const col = measure.sql ? `${cubeName}.${measure.sql}` : '*'

  switch (measure.type) {
    case 'count':
      if (measure.filters && measure.filters.length > 0) {
        const filterSql = measure.filters.map((f) => f.sql).join(' AND ')
        return `COUNT(*) FILTER (WHERE ${filterSql})`
      }
      return 'COUNT(*)'

    case 'countDistinct':
      return `COUNT(DISTINCT ${col})`

    case 'sum':
      return `SUM(${col})`

    case 'avg':
      return `AVG(${col})`

    case 'min':
      return `MIN(${col})`

    case 'max':
      return `MAX(${col})`

    case 'percentile':
      return generatePercentileSQL(measure, cubeName, dialect)

    case 'runningTotal':
      return `SUM(${col}) OVER (ORDER BY ${col})`

    case 'number':
      return measure.sql || '0'

    default:
      throw new CubeSchemaError(`Unknown measure type: ${measure.type}`)
  }
}

function generatePercentileSQL(
  measure: MeasureDefinition,
  cubeName: string,
  dialect: SQLDialect
): string {
  const col = `${cubeName}.${measure.sql}`
  const percentileValue = (measure.percentile || 50) / 100

  switch (dialect) {
    case 'postgres':
    case 'duckdb':
      return `PERCENTILE_CONT(${percentileValue}) WITHIN GROUP (ORDER BY ${col})`

    case 'clickhouse':
      return `quantile(${percentileValue})(${col})`

    case 'mysql':
      // MySQL doesn't have native percentile, use approximation
      return `(SELECT ${col} FROM ${cubeName} ORDER BY ${col} LIMIT 1 OFFSET FLOOR(${percentileValue} * COUNT(*)))`

    case 'sqlite':
      // SQLite doesn't have native percentile
      return `(SELECT ${col} FROM ${cubeName} ORDER BY ${col} LIMIT 1 OFFSET CAST(${percentileValue} * COUNT(*) AS INTEGER))`

    default:
      return `PERCENTILE_CONT(${percentileValue}) WITHIN GROUP (ORDER BY ${col})`
  }
}

/**
 * Generate SQL for a dimension
 */
export function generateDimensionSQL(
  dimension: DimensionDefinition,
  cubeName: string,
  dialect: SQLDialect,
  options?: { granularity?: Granularity }
): string {
  const col = `${cubeName}.${dimension.sql}`

  // Handle case insensitive dimensions
  if (dimension.caseInsensitive && dimension.type === 'string') {
    return `LOWER(${col})`
  }

  // Handle time dimensions with granularity
  if (dimension.type === 'time' && options?.granularity) {
    return generateTimeTruncSQL(col, options.granularity, dialect)
  }

  return col
}

function generateTimeTruncSQL(
  col: string,
  granularity: Granularity,
  dialect: SQLDialect
): string {
  switch (dialect) {
    case 'postgres':
    case 'duckdb':
      return `date_trunc('${granularity}', ${col})`

    case 'clickhouse':
      return generateClickHouseTimeTrunc(col, granularity)

    case 'mysql':
      return generateMySQLTimeTrunc(col, granularity)

    case 'sqlite':
      return generateSQLiteTimeTrunc(col, granularity)

    default:
      return `date_trunc('${granularity}', ${col})`
  }
}

function generateClickHouseTimeTrunc(col: string, granularity: Granularity): string {
  switch (granularity) {
    case 'second':
      return `toStartOfSecond(${col})`
    case 'minute':
      return `toStartOfMinute(${col})`
    case 'hour':
      return `toStartOfHour(${col})`
    case 'day':
      return `toDate(${col})`
    case 'week':
      return `toStartOfWeek(${col})`
    case 'month':
      return `toStartOfMonth(${col})`
    case 'quarter':
      return `toStartOfQuarter(${col})`
    case 'year':
      return `toStartOfYear(${col})`
    default:
      return `toDate(${col})`
  }
}

function generateMySQLTimeTrunc(col: string, granularity: Granularity): string {
  switch (granularity) {
    case 'second':
      return `DATE_FORMAT(${col}, '%Y-%m-%d %H:%i:%s')`
    case 'minute':
      return `DATE_FORMAT(${col}, '%Y-%m-%d %H:%i:00')`
    case 'hour':
      return `DATE_FORMAT(${col}, '%Y-%m-%d %H:00:00')`
    case 'day':
      return `DATE(${col})`
    case 'week':
      return `DATE(DATE_SUB(${col}, INTERVAL WEEKDAY(${col}) DAY))`
    case 'month':
      return `DATE_FORMAT(${col}, '%Y-%m-01')`
    case 'quarter':
      return `MAKEDATE(YEAR(${col}), 1) + INTERVAL QUARTER(${col}) QUARTER - INTERVAL 1 QUARTER`
    case 'year':
      return `DATE_FORMAT(${col}, '%Y-01-01')`
    default:
      return `DATE(${col})`
  }
}

function generateSQLiteTimeTrunc(col: string, granularity: Granularity): string {
  switch (granularity) {
    case 'second':
      return `strftime('%Y-%m-%d %H:%M:%S', ${col})`
    case 'minute':
      return `strftime('%Y-%m-%d %H:%M:00', ${col})`
    case 'hour':
      return `strftime('%Y-%m-%d %H:00:00', ${col})`
    case 'day':
      return `date(${col})`
    case 'week':
      return `date(${col}, 'weekday 0', '-6 days')`
    case 'month':
      return `strftime('%Y-%m-01', ${col})`
    case 'quarter':
      return `strftime('%Y-', ${col}) || printf('%02d', ((cast(strftime('%m', ${col}) as integer) - 1) / 3) * 3 + 1) || '-01'`
    case 'year':
      return `strftime('%Y-01-01', ${col})`
    default:
      return `date(${col})`
  }
}

/**
 * Generate SQL for a pre-aggregation CREATE TABLE
 */
export function generatePreAggregationSQL(
  cube: CubeSchema,
  preAggName: string,
  dialect: SQLDialect,
  options?: { incremental?: boolean }
): string {
  const preAgg = cube.preAggregations?.[preAggName]
  if (!preAgg) {
    throw new CubeSchemaError(`Pre-aggregation '${preAggName}' not found in cube '${cube.name}'`)
  }

  const tableName = `${cube.name}_${preAggName}`

  // Generate measure SQL
  const measuresSql = (preAgg.measures || [])
    .map((name) => {
      const m = cube.measures[name]
      if (!m) throw new CubeSchemaError(`Measure '${name}' not found`)
      return `${generateMeasureSQL(m, cube.name, dialect)} AS ${name}`
    })
    .join(',\n    ')

  // Generate dimension SQL
  const dimensionsSql = (preAgg.dimensions || [])
    .map((name) => {
      const d = cube.dimensions[name]
      if (!d) throw new CubeSchemaError(`Dimension '${name}' not found`)
      return `${generateDimensionSQL(d, cube.name, dialect)} AS ${name}`
    })
    .join(',\n    ')

  // Generate time dimension SQL
  let timeDimensionSql = ''
  if (preAgg.timeDimension && preAgg.granularity) {
    const td = cube.dimensions[preAgg.timeDimension]
    if (!td) throw new CubeSchemaError(`Time dimension '${preAgg.timeDimension}' not found`)
    const timeSql = generateDimensionSQL(td, cube.name, dialect, { granularity: preAgg.granularity })
    timeDimensionSql = `${timeSql} AS ${preAgg.timeDimension}_${preAgg.granularity}`
  }

  // Build SELECT columns
  const selectParts: string[] = []
  if (dimensionsSql) selectParts.push(dimensionsSql)
  if (timeDimensionSql) selectParts.push(timeDimensionSql)
  if (measuresSql) selectParts.push(measuresSql)

  // Build GROUP BY columns
  const groupByParts: string[] = []
  for (const name of preAgg.dimensions || []) {
    const d = cube.dimensions[name]
    groupByParts.push(generateDimensionSQL(d, cube.name, dialect))
  }
  if (preAgg.timeDimension && preAgg.granularity) {
    const td = cube.dimensions[preAgg.timeDimension]
    groupByParts.push(generateDimensionSQL(td, cube.name, dialect, { granularity: preAgg.granularity }))
  }

  const selectClause = selectParts.join(',\n    ')
  const groupByClause = groupByParts.length > 0 ? `\nGROUP BY ${groupByParts.join(', ')}` : ''

  if (options?.incremental && preAgg.refreshKey?.updateWindow) {
    // Generate incremental refresh SQL
    const updateWindow = preAgg.refreshKey.updateWindow
    const timeDimCol = preAgg.timeDimension
      ? `${cube.name}.${cube.dimensions[preAgg.timeDimension].sql}`
      : null

    if (!timeDimCol) {
      throw new CubeSchemaError('Incremental pre-aggregation requires a time dimension')
    }

    return `DELETE FROM ${tableName} WHERE ${preAgg.timeDimension}_${preAgg.granularity} >= NOW() - INTERVAL '${updateWindow}';\n\nINSERT INTO ${tableName}\nSELECT\n    ${selectClause}\nFROM (${cube.sql}) AS ${cube.name}\nWHERE ${timeDimCol} >= NOW() - INTERVAL '${updateWindow}'${groupByClause}`
  }

  return `CREATE TABLE ${tableName} AS\nSELECT\n    ${selectClause}\nFROM (${cube.sql}) AS ${cube.name}${groupByClause}`
}

/**
 * Generate full SQL for a cube query
 */
export function generateCubeSQL(
  cube: CubeSchema,
  query: FullCubeQuery,
  dialect: SQLDialect,
  context?: { cubes?: Record<string, CubeSchema> }
): string {
  const parts: string[] = []

  // SELECT clause
  const selectParts: string[] = []

  // Add measures
  for (const measureName of query.measures || []) {
    const m = cube.measures[measureName]
    if (!m) throw new CubeSchemaError(`Measure '${measureName}' not found`)
    selectParts.push(`${generateMeasureSQL(m, cube.name, dialect)} AS ${measureName}`)
  }

  // Add dimensions
  for (const dimName of query.dimensions || []) {
    // Handle cross-cube dimension references (Customers.country)
    const [cubeName, actualDimName] = dimName.includes('.') ? dimName.split('.') : [cube.name, dimName]
    const targetCube = cubeName === cube.name ? cube : context?.cubes?.[cubeName]

    if (!targetCube) throw new CubeSchemaError(`Cube '${cubeName}' not found`)
    const d = targetCube.dimensions[actualDimName]
    if (!d) throw new CubeSchemaError(`Dimension '${actualDimName}' not found in cube '${cubeName}'`)

    selectParts.push(`${generateDimensionSQL(d, cubeName, dialect)} AS ${actualDimName}`)
  }

  // Add time dimensions
  for (const td of query.timeDimensions || []) {
    const d = cube.dimensions[td.dimension]
    if (!d) throw new CubeSchemaError(`Time dimension '${td.dimension}' not found`)
    selectParts.push(`${generateDimensionSQL(d, cube.name, dialect, { granularity: td.granularity })} AS ${td.dimension}`)
  }

  parts.push(`SELECT\n  ${selectParts.join(',\n  ')}`)

  // FROM clause
  parts.push(`FROM (${cube.sql}) AS ${cube.name}`)

  // JOIN clause
  const joinedCubes = new Set<string>()
  for (const dimName of query.dimensions || []) {
    if (dimName.includes('.')) {
      const [cubeName] = dimName.split('.')
      if (cubeName !== cube.name) {
        joinedCubes.add(cubeName)
      }
    }
  }

  for (const joinedCubeName of joinedCubes) {
    const joinDef = cube.joins?.[joinedCubeName]
    const joinedCube = context?.cubes?.[joinedCubeName]

    if (!joinDef || !joinedCube) continue

    // Replace template variables
    const joinSql = joinDef.sql.replace(/\$\{(\w+)\}/g, (_, name) => name)
    parts.push(`JOIN (${joinedCube.sql}) AS ${joinedCubeName} ON ${joinSql}`)
  }

  // WHERE clause
  const whereParts: string[] = []

  for (const filter of query.filters || []) {
    const d = cube.dimensions[filter.dimension]
    if (!d) throw new CubeSchemaError(`Filter dimension '${filter.dimension}' not found`)

    const col = `${cube.name}.${d.sql}`
    whereParts.push(generateFilterSQL(col, filter.operator, filter.values))
  }

  if (whereParts.length > 0) {
    parts.push(`WHERE ${whereParts.join(' AND ')}`)
  }

  // GROUP BY clause
  const groupByParts: string[] = []

  for (const dimName of query.dimensions || []) {
    const [cubeName, actualDimName] = dimName.includes('.') ? dimName.split('.') : [cube.name, dimName]
    const targetCube = cubeName === cube.name ? cube : context?.cubes?.[cubeName]
    if (!targetCube) continue
    const d = targetCube.dimensions[actualDimName]
    if (d) groupByParts.push(generateDimensionSQL(d, cubeName, dialect))
  }

  for (const td of query.timeDimensions || []) {
    const d = cube.dimensions[td.dimension]
    if (d) groupByParts.push(generateDimensionSQL(d, cube.name, dialect, { granularity: td.granularity }))
  }

  if (groupByParts.length > 0) {
    parts.push(`GROUP BY ${groupByParts.join(', ')}`)
  }

  // ORDER BY clause
  if (query.order && query.order.length > 0) {
    const orderParts = query.order.map((o) => {
      return `${o.id} ${o.desc ? 'DESC' : 'ASC'}`
    })
    parts.push(`ORDER BY ${orderParts.join(', ')}`)
  }

  // LIMIT clause
  if (query.limit !== undefined) {
    parts.push(`LIMIT ${query.limit}`)
  }

  // OFFSET clause
  if (query.offset !== undefined) {
    parts.push(`OFFSET ${query.offset}`)
  }

  return parts.join('\n')
}

function generateFilterSQL(col: string, operator: FilterOperator, values: string[]): string {
  const val = values[0]

  switch (operator) {
    case 'equals':
      return `${col} = '${val}'`
    case 'notEquals':
      return `${col} <> '${val}'`
    case 'gt':
      return `${col} > ${val}`
    case 'gte':
      return `${col} >= ${val}`
    case 'lt':
      return `${col} < ${val}`
    case 'lte':
      return `${col} <= ${val}`
    case 'in':
      return `${col} IN (${values.map((v) => `'${v}'`).join(', ')})`
    case 'notIn':
      return `${col} NOT IN (${values.map((v) => `'${v}'`).join(', ')})`
    case 'contains':
      return `${col} LIKE '%${val}%'`
    case 'notContains':
      return `${col} NOT LIKE '%${val}%'`
    case 'set':
      return `${col} IS NOT NULL`
    case 'notSet':
      return `${col} IS NULL`
    default:
      throw new CubeSchemaError(`Unknown filter operator: ${operator}`)
  }
}
