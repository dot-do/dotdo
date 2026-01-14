/**
 * @dotdo/cubejs - Cube Schema Definitions
 *
 * Defines the schema types and cube() factory function for creating
 * Cube.js-compatible semantic layer schemas.
 *
 * @example
 * ```typescript
 * import { cube, CubeSchema } from '@dotdo/cubejs'
 *
 * const Orders = cube('Orders', {
 *   sql: 'SELECT * FROM orders',
 *
 *   measures: {
 *     count: { type: 'count' },
 *     totalAmount: { sql: 'amount', type: 'sum' },
 *   },
 *
 *   dimensions: {
 *     id: { sql: 'id', type: 'number', primaryKey: true },
 *     status: { sql: 'status', type: 'string' },
 *     createdAt: { sql: 'created_at', type: 'time' },
 *   },
 *
 *   joins: {
 *     Customers: {
 *       relationship: 'belongsTo',
 *       sql: '${CUBE}.customer_id = ${Customers}.id',
 *     },
 *   },
 *
 *   preAggregations: {
 *     ordersDaily: {
 *       type: 'rollup',
 *       measureReferences: ['count', 'totalAmount'],
 *       dimensionReferences: ['status'],
 *       timeDimensionReference: 'createdAt',
 *       granularity: 'day',
 *     },
 *   },
 * })
 * ```
 */

import { ValidationError } from './errors'

// =============================================================================
// Measure Types
// =============================================================================

/**
 * Supported measure types
 */
export type MeasureType =
  | 'count'
  | 'countDistinct'
  | 'countDistinctApprox'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'runningTotal'
  | 'number'

/**
 * Measure definition
 */
export interface Measure {
  /**
   * Measure type
   */
  type: MeasureType

  /**
   * SQL expression for the measure (not needed for 'count')
   */
  sql?: string

  /**
   * Custom title for display
   */
  title?: string

  /**
   * Short title for compact display
   */
  shortTitle?: string

  /**
   * Description of the measure
   */
  description?: string

  /**
   * Format string (e.g., 'currency', 'percent')
   */
  format?: 'currency' | 'percent' | 'number' | string

  /**
   * Rolling window configuration
   */
  rollingWindow?: {
    trailing: string
    leading?: string
    offset?: 'start' | 'end'
  }

  /**
   * Drill down members for this measure
   */
  drillMembers?: string[]

  /**
   * Filters to apply when calculating this measure
   */
  filters?: {
    sql: string
  }[]

  /**
   * Whether this measure is visible in the UI
   */
  shown?: boolean

  /**
   * Meta information
   */
  meta?: Record<string, unknown>
}

// =============================================================================
// Dimension Types
// =============================================================================

/**
 * Supported dimension types
 */
export type DimensionType = 'string' | 'number' | 'time' | 'boolean' | 'geo'

/**
 * Dimension definition
 */
export interface Dimension {
  /**
   * SQL expression for the dimension
   */
  sql: string

  /**
   * Dimension type
   */
  type: DimensionType

  /**
   * Whether this is the primary key
   */
  primaryKey?: boolean

  /**
   * Custom title for display
   */
  title?: string

  /**
   * Short title for compact display
   */
  shortTitle?: string

  /**
   * Description of the dimension
   */
  description?: string

  /**
   * Case-insensitive matching for filters
   */
  caseInsensitiveMatch?: boolean

  /**
   * For geo type: latitude and longitude SQL expressions
   */
  latitude?: { sql: string }
  longitude?: { sql: string }

  /**
   * Sub-query mode
   */
  subQuery?: boolean

  /**
   * Propagate filters to pre-aggregations
   */
  propagateFiltersToSubQuery?: boolean

  /**
   * Whether this dimension is visible in the UI
   */
  shown?: boolean

  /**
   * Meta information
   */
  meta?: Record<string, unknown>
}

// =============================================================================
// Join Types
// =============================================================================

/**
 * Relationship types for joins
 */
export type JoinRelationship = 'belongsTo' | 'hasMany' | 'hasOne'

/**
 * Join definition
 */
export interface Join {
  /**
   * Relationship type
   */
  relationship: JoinRelationship

  /**
   * SQL expression for the join condition
   * Supports ${CUBE} and ${CubeName} substitutions
   */
  sql: string
}

// =============================================================================
// Pre-aggregation Types
// =============================================================================

/**
 * Pre-aggregation types
 */
export type PreAggregationType = 'rollup' | 'rollupJoin' | 'rollupLambda' | 'originalSql'

/**
 * Time granularity for pre-aggregations
 */
export type Granularity = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year'

/**
 * Refresh key configuration
 */
export interface RefreshKey {
  /**
   * Refresh every interval (e.g., '1 hour', '30 minutes')
   */
  every?: string

  /**
   * SQL to check for changes
   */
  sql?: string

  /**
   * Incremental refresh
   */
  incremental?: boolean

  /**
   * Update window for incremental refresh
   */
  updateWindow?: string
}

/**
 * Pre-aggregation definition
 */
export interface PreAggregation {
  /**
   * Pre-aggregation type
   */
  type: PreAggregationType

  /**
   * Measures to include
   */
  measureReferences?: string[]

  /**
   * Dimensions to include
   */
  dimensionReferences?: string[]

  /**
   * Time dimension reference
   */
  timeDimensionReference?: string

  /**
   * Granularity for time dimension
   */
  granularity?: Granularity

  /**
   * Partition granularity for large datasets
   */
  partitionGranularity?: Granularity

  /**
   * Segments to include
   */
  segmentReferences?: string[]

  /**
   * Refresh key configuration
   */
  refreshKey?: RefreshKey

  /**
   * Build range start
   */
  buildRangeStart?: {
    sql: string
  }

  /**
   * Build range end
   */
  buildRangeEnd?: {
    sql: string
  }

  /**
   * Schedule for refreshes (cron expression)
   */
  scheduledRefresh?: boolean

  /**
   * External storage type
   */
  external?: boolean

  /**
   * Indexes to create
   */
  indexes?: {
    [name: string]: {
      columns: string[]
    }
  }

  /**
   * Unique key columns
   */
  uniqueKeyColumns?: string[]

  /**
   * Allow non-strict date range match
   */
  allowNonStrictDateRangeMatch?: boolean
}

// =============================================================================
// Segment Types
// =============================================================================

/**
 * Segment definition for reusable filters
 */
export interface Segment {
  /**
   * SQL condition for the segment
   */
  sql: string

  /**
   * Title for display
   */
  title?: string

  /**
   * Description
   */
  description?: string
}

// =============================================================================
// Cube Schema Types
// =============================================================================

/**
 * Complete cube schema definition
 */
export interface CubeSchema {
  /**
   * Cube name
   */
  name: string

  /**
   * Base SQL for the cube (table or subquery)
   */
  sql: string

  /**
   * SQL table name (alternative to sql)
   */
  sqlTable?: string

  /**
   * Title for display
   */
  title?: string

  /**
   * Description of the cube
   */
  description?: string

  /**
   * Measure definitions
   */
  measures: {
    [name: string]: Measure
  }

  /**
   * Dimension definitions
   */
  dimensions: {
    [name: string]: Dimension
  }

  /**
   * Join definitions
   */
  joins?: {
    [cubeName: string]: Join
  }

  /**
   * Pre-aggregation definitions
   */
  preAggregations?: {
    [name: string]: PreAggregation
  }

  /**
   * Segment definitions
   */
  segments?: {
    [name: string]: Segment
  }

  /**
   * Refresh key for the entire cube
   */
  refreshKey?: RefreshKey

  /**
   * Data source name for multi-database setups
   */
  dataSource?: string

  /**
   * SQL alias for the cube
   */
  sqlAlias?: string

  /**
   * Whether this cube is visible in the UI
   */
  shown?: boolean

  /**
   * Whether to rewrite queries to use pre-aggregations
   */
  rewriteQueries?: boolean

  /**
   * Extends another cube
   */
  extends?: string

  /**
   * Context members for row-level security
   */
  contextMembers?: string[]

  /**
   * Meta information
   */
  meta?: Record<string, unknown>
}

// =============================================================================
// Validation
// =============================================================================

const VALID_MEASURE_TYPES = new Set<MeasureType>([
  'count',
  'countDistinct',
  'countDistinctApprox',
  'sum',
  'avg',
  'min',
  'max',
  'runningTotal',
  'number',
])

const VALID_DIMENSION_TYPES = new Set<DimensionType>([
  'string',
  'number',
  'time',
  'boolean',
  'geo',
])

const VALID_RELATIONSHIPS = new Set<JoinRelationship>([
  'belongsTo',
  'hasMany',
  'hasOne',
])

const VALID_PRE_AGG_TYPES = new Set<PreAggregationType>([
  'rollup',
  'rollupJoin',
  'rollupLambda',
  'originalSql',
])

const VALID_GRANULARITIES = new Set<Granularity>([
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
])

/**
 * Validate a cube schema
 */
function validateSchema(schema: CubeSchema): void {
  if (!schema.name) {
    throw new ValidationError('Cube name is required')
  }

  if (!schema.sql && !schema.sqlTable) {
    throw new ValidationError(`Cube ${schema.name}: sql or sqlTable is required`)
  }

  // Validate measures
  for (const [name, measure] of Object.entries(schema.measures)) {
    if (!VALID_MEASURE_TYPES.has(measure.type)) {
      throw new ValidationError(
        `Cube ${schema.name}: Invalid measure type '${measure.type}' for measure '${name}'. ` +
        `Valid types are: ${Array.from(VALID_MEASURE_TYPES).join(', ')}`
      )
    }

    if (measure.type !== 'count' && measure.type !== 'number' && !measure.sql) {
      throw new ValidationError(
        `Cube ${schema.name}: Measure '${name}' of type '${measure.type}' requires sql property`
      )
    }
  }

  // Validate dimensions
  for (const [name, dimension] of Object.entries(schema.dimensions)) {
    if (!VALID_DIMENSION_TYPES.has(dimension.type)) {
      throw new ValidationError(
        `Cube ${schema.name}: Invalid dimension type '${dimension.type}' for dimension '${name}'. ` +
        `Valid types are: ${Array.from(VALID_DIMENSION_TYPES).join(', ')}`
      )
    }

    if (!dimension.sql) {
      throw new ValidationError(
        `Cube ${schema.name}: Dimension '${name}' requires sql property`
      )
    }

    if (dimension.type === 'geo' && (!dimension.latitude || !dimension.longitude)) {
      throw new ValidationError(
        `Cube ${schema.name}: Geo dimension '${name}' requires latitude and longitude properties`
      )
    }
  }

  // Validate joins
  if (schema.joins) {
    for (const [cubeName, join] of Object.entries(schema.joins)) {
      if (!VALID_RELATIONSHIPS.has(join.relationship)) {
        throw new ValidationError(
          `Cube ${schema.name}: Invalid relationship '${join.relationship}' for join to '${cubeName}'. ` +
          `Valid relationships are: ${Array.from(VALID_RELATIONSHIPS).join(', ')}`
        )
      }

      if (!join.sql) {
        throw new ValidationError(
          `Cube ${schema.name}: Join to '${cubeName}' requires sql property`
        )
      }
    }
  }

  // Validate pre-aggregations
  if (schema.preAggregations) {
    for (const [name, preAgg] of Object.entries(schema.preAggregations)) {
      if (!VALID_PRE_AGG_TYPES.has(preAgg.type)) {
        throw new ValidationError(
          `Cube ${schema.name}: Invalid pre-aggregation type '${preAgg.type}' for '${name}'. ` +
          `Valid types are: ${Array.from(VALID_PRE_AGG_TYPES).join(', ')}`
        )
      }

      if (preAgg.granularity && !VALID_GRANULARITIES.has(preAgg.granularity)) {
        throw new ValidationError(
          `Cube ${schema.name}: Invalid granularity '${preAgg.granularity}' for pre-aggregation '${name}'. ` +
          `Valid granularities are: ${Array.from(VALID_GRANULARITIES).join(', ')}`
        )
      }

      if (preAgg.partitionGranularity && !VALID_GRANULARITIES.has(preAgg.partitionGranularity)) {
        throw new ValidationError(
          `Cube ${schema.name}: Invalid partition granularity '${preAgg.partitionGranularity}' for pre-aggregation '${name}'`
        )
      }

      // Validate measure references
      if (preAgg.measureReferences) {
        for (const ref of preAgg.measureReferences) {
          if (!schema.measures[ref]) {
            throw new ValidationError(
              `Cube ${schema.name}: Pre-aggregation '${name}' references unknown measure '${ref}'`
            )
          }
        }
      }

      // Validate dimension references
      if (preAgg.dimensionReferences) {
        for (const ref of preAgg.dimensionReferences) {
          if (!schema.dimensions[ref]) {
            throw new ValidationError(
              `Cube ${schema.name}: Pre-aggregation '${name}' references unknown dimension '${ref}'`
            )
          }
        }
      }

      // Validate time dimension reference
      if (preAgg.timeDimensionReference) {
        if (!schema.dimensions[preAgg.timeDimensionReference]) {
          throw new ValidationError(
            `Cube ${schema.name}: Pre-aggregation '${name}' references unknown time dimension '${preAgg.timeDimensionReference}'`
          )
        }

        const timeDim = schema.dimensions[preAgg.timeDimensionReference]
        if (timeDim.type !== 'time') {
          throw new ValidationError(
            `Cube ${schema.name}: Pre-aggregation '${name}' time dimension '${preAgg.timeDimensionReference}' must be of type 'time'`
          )
        }
      }
    }
  }
}

// =============================================================================
// Cube Factory
// =============================================================================

/**
 * Create a validated cube schema
 *
 * @param name - Cube name
 * @param schema - Cube schema definition
 * @returns Validated cube schema
 */
export function cube(name: string, schema: Omit<CubeSchema, 'name'> & { name?: string }): CubeSchema {
  const fullSchema: CubeSchema = {
    ...schema,
    name: schema.name || name,
  }

  validateSchema(fullSchema)

  return fullSchema
}

// =============================================================================
// Schema Helpers
// =============================================================================

/**
 * Get the primary key dimension for a cube
 */
export function getPrimaryKey(schema: CubeSchema): string | undefined {
  for (const [name, dim] of Object.entries(schema.dimensions)) {
    if (dim.primaryKey) {
      return name
    }
  }
  return undefined
}

/**
 * Get all time dimensions for a cube
 */
export function getTimeDimensions(schema: CubeSchema): string[] {
  return Object.entries(schema.dimensions)
    .filter(([_, dim]) => dim.type === 'time')
    .map(([name]) => name)
}

/**
 * Get measure by fully qualified name (CubeName.measureName)
 */
export function getMeasure(
  schemas: Map<string, CubeSchema>,
  qualifiedName: string
): { cube: CubeSchema; measure: Measure; name: string } | undefined {
  const [cubeName, measureName] = qualifiedName.split('.')
  const schema = schemas.get(cubeName)
  if (!schema || !schema.measures[measureName]) {
    return undefined
  }
  return { cube: schema, measure: schema.measures[measureName], name: measureName }
}

/**
 * Get dimension by fully qualified name (CubeName.dimensionName)
 */
export function getDimension(
  schemas: Map<string, CubeSchema>,
  qualifiedName: string
): { cube: CubeSchema; dimension: Dimension; name: string } | undefined {
  const parts = qualifiedName.split('.')
  const cubeName = parts[0]
  const dimensionName = parts.slice(1).join('.')
  const schema = schemas.get(cubeName)
  if (!schema || !schema.dimensions[dimensionName]) {
    return undefined
  }
  return { cube: schema, dimension: schema.dimensions[dimensionName], name: dimensionName }
}

/**
 * Check if a cube has a join path to another cube
 */
export function hasJoinPath(
  schemas: Map<string, CubeSchema>,
  fromCube: string,
  toCube: string,
  visited: Set<string> = new Set()
): boolean {
  if (fromCube === toCube) return true
  if (visited.has(fromCube)) return false

  visited.add(fromCube)
  const schema = schemas.get(fromCube)
  if (!schema?.joins) return false

  for (const joinCube of Object.keys(schema.joins)) {
    if (joinCube === toCube) return true
    if (hasJoinPath(schemas, joinCube, toCube, visited)) return true
  }

  return false
}

/**
 * Get the join path between two cubes
 */
export function getJoinPath(
  schemas: Map<string, CubeSchema>,
  fromCube: string,
  toCube: string,
  path: string[] = []
): string[] | undefined {
  if (fromCube === toCube) return [...path, fromCube]

  const schema = schemas.get(fromCube)
  if (!schema?.joins) return undefined

  const currentPath = [...path, fromCube]

  for (const joinCube of Object.keys(schema.joins)) {
    if (currentPath.includes(joinCube)) continue // Avoid cycles

    const result = getJoinPath(schemas, joinCube, toCube, currentPath)
    if (result) return result
  }

  return undefined
}
