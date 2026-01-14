/**
 * @dotdo/cubejs - Semantic Layer Primitives
 *
 * Composable, type-safe primitives for building Cube.js-style semantic layers.
 * Provides helper functions for creating measures, dimensions, and cube schemas
 * with full TypeScript type inference.
 *
 * @example
 * ```typescript
 * import {
 *   cube,
 *   count, sum, avg, min, max, countDistinct, percentile, composite,
 *   time, categorical, derived, geo, boolean as bool,
 * } from '@dotdo/cubejs/primitives'
 *
 * const Orders = cube('Orders', {
 *   sql: () => `SELECT * FROM orders`,
 *
 *   measures: {
 *     count: count(),
 *     revenue: sum('amount', { format: 'currency' }),
 *     avgOrderValue: avg('amount'),
 *     medianValue: percentile('amount', 50),
 *     revenuePerOrder: composite(
 *       ({ revenue, count }) => `${revenue} / NULLIF(${count}, 0)`,
 *       ['revenue', 'count']
 *     ),
 *   },
 *
 *   dimensions: {
 *     createdAt: time('created_at'),
 *     status: categorical('status'),
 *     isVip: derived(`CASE WHEN amount > 1000 THEN true ELSE false END`),
 *     location: geo({ lat: 'latitude', lng: 'longitude' }),
 *   },
 * })
 * ```
 */

import type { Measure, Dimension, CubeSchema, Granularity, MeasureType, DimensionType, Join, PreAggregation, Segment, JoinRelationship } from './schema'

// =============================================================================
// Measure Primitives
// =============================================================================

/**
 * Options for measure definitions
 */
export interface MeasureOptions {
  /** Display title */
  title?: string
  /** Short title for compact display */
  shortTitle?: string
  /** Description */
  description?: string
  /** Format: 'currency', 'percent', 'number', or custom */
  format?: 'currency' | 'percent' | 'number' | string
  /** Drill-down members */
  drillMembers?: string[]
  /** Whether measure is visible */
  shown?: boolean
  /** Additional metadata */
  meta?: Record<string, unknown>
  /** Rolling window configuration */
  rollingWindow?: {
    trailing: string
    leading?: string
    offset?: 'start' | 'end'
  }
  /** Null handling strategy */
  nullHandling?: 'coalesce' | 'exclude' | 'include'
  /** Filters to apply */
  filters?: { sql: string }[]
}

/**
 * Create a COUNT measure
 */
export function count(options?: MeasureOptions): Measure {
  return {
    type: 'count',
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    format: options?.format,
    drillMembers: options?.drillMembers,
    shown: options?.shown,
    meta: options?.meta,
    rollingWindow: options?.rollingWindow,
    filters: options?.filters,
  }
}

/**
 * Create a COUNT DISTINCT measure
 */
export function countDistinct(sql: string, options?: MeasureOptions): Measure {
  return {
    type: 'countDistinct',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    format: options?.format,
    drillMembers: options?.drillMembers,
    shown: options?.shown,
    meta: options?.meta,
    rollingWindow: options?.rollingWindow,
    filters: options?.filters,
  }
}

/**
 * Create an approximate COUNT DISTINCT measure (for performance with large datasets)
 */
export function countDistinctApprox(sql: string, options?: MeasureOptions): Measure {
  return {
    type: 'countDistinctApprox',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    format: options?.format,
    drillMembers: options?.drillMembers,
    shown: options?.shown,
    meta: options?.meta,
    rollingWindow: options?.rollingWindow,
    filters: options?.filters,
  }
}

/**
 * Create a SUM measure
 */
export function sum(sql: string, options?: MeasureOptions): Measure {
  return {
    type: 'sum',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    format: options?.format ?? 'number',
    drillMembers: options?.drillMembers,
    shown: options?.shown,
    meta: options?.meta,
    rollingWindow: options?.rollingWindow,
    filters: options?.filters,
  }
}

/**
 * Create an AVG measure
 */
export function avg(sql: string, options?: MeasureOptions): Measure {
  return {
    type: 'avg',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    format: options?.format ?? 'number',
    drillMembers: options?.drillMembers,
    shown: options?.shown,
    meta: options?.meta,
    rollingWindow: options?.rollingWindow,
    filters: options?.filters,
  }
}

/**
 * Create a MIN measure
 */
export function min(sql: string, options?: MeasureOptions): Measure {
  return {
    type: 'min',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    format: options?.format,
    drillMembers: options?.drillMembers,
    shown: options?.shown,
    meta: options?.meta,
    rollingWindow: options?.rollingWindow,
    filters: options?.filters,
  }
}

/**
 * Create a MAX measure
 */
export function max(sql: string, options?: MeasureOptions): Measure {
  return {
    type: 'max',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    format: options?.format,
    drillMembers: options?.drillMembers,
    shown: options?.shown,
    meta: options?.meta,
    rollingWindow: options?.rollingWindow,
    filters: options?.filters,
  }
}

/**
 * Create a RUNNING TOTAL measure
 */
export function runningTotal(sql: string, options?: MeasureOptions): Measure {
  return {
    type: 'runningTotal',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    format: options?.format ?? 'number',
    drillMembers: options?.drillMembers,
    shown: options?.shown,
    meta: options?.meta,
    rollingWindow: options?.rollingWindow,
    filters: options?.filters,
  }
}

/**
 * Create a NUMBER measure (for custom calculations)
 */
export function number(sql: string, options?: MeasureOptions): Measure {
  return {
    type: 'number',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    format: options?.format ?? 'number',
    drillMembers: options?.drillMembers,
    shown: options?.shown,
    meta: options?.meta,
    rollingWindow: options?.rollingWindow,
    filters: options?.filters,
  }
}

/**
 * Percentile options
 */
export interface PercentileOptions extends MeasureOptions {
  /** The percentile value (0-100) */
  percentile: number
}

/**
 * Create a PERCENTILE measure (p50, p90, p95, p99, etc.)
 *
 * @example
 * ```typescript
 * const measures = {
 *   medianResponseTime: percentile('response_time', 50),
 *   p95ResponseTime: percentile('response_time', 95),
 *   p99ResponseTime: percentile('response_time', 99),
 * }
 * ```
 */
export function percentile(sql: string, value: number, options?: MeasureOptions): Measure {
  if (value < 0 || value > 100) {
    throw new Error(`Percentile value must be between 0 and 100, got ${value}`)
  }
  return {
    type: 'number',
    sql: `PERCENTILE_CONT(${value / 100}) WITHIN GROUP (ORDER BY ${sql})`,
    title: options?.title ?? `P${value}`,
    shortTitle: options?.shortTitle ?? `P${value}`,
    description: options?.description ?? `${value}th percentile of ${sql}`,
    format: options?.format ?? 'number',
    drillMembers: options?.drillMembers,
    shown: options?.shown,
    meta: {
      ...options?.meta,
      percentileValue: value,
      isPercentile: true,
    },
    rollingWindow: options?.rollingWindow,
    filters: options?.filters,
  }
}

/**
 * Shorthand for p50 (median)
 */
export function median(sql: string, options?: MeasureOptions): Measure {
  return percentile(sql, 50, { ...options, title: options?.title ?? 'Median' })
}

/**
 * Shorthand for p90
 */
export function p90(sql: string, options?: MeasureOptions): Measure {
  return percentile(sql, 90, options)
}

/**
 * Shorthand for p95
 */
export function p95(sql: string, options?: MeasureOptions): Measure {
  return percentile(sql, 95, options)
}

/**
 * Shorthand for p99
 */
export function p99(sql: string, options?: MeasureOptions): Measure {
  return percentile(sql, 99, options)
}

/**
 * Composite measure builder function type
 */
export type CompositeMeasureBuilder = (refs: Record<string, string>) => string

/**
 * Create a COMPOSITE measure derived from other measures
 *
 * @example
 * ```typescript
 * const measures = {
 *   count: count(),
 *   revenue: sum('amount'),
 *   // Composite measure that references other measures
 *   revenuePerOrder: composite(
 *     ({ revenue, count }) => `${revenue} / NULLIF(${count}, 0)`,
 *     ['revenue', 'count']
 *   ),
 * }
 * ```
 */
export function composite(
  builder: CompositeMeasureBuilder,
  dependencies: string[],
  options?: MeasureOptions
): Measure {
  // Create reference placeholders
  const refs: Record<string, string> = {}
  dependencies.forEach(dep => {
    refs[dep] = `\${${dep}}`
  })

  return {
    type: 'number',
    sql: builder(refs),
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    format: options?.format ?? 'number',
    drillMembers: options?.drillMembers,
    shown: options?.shown,
    meta: {
      ...options?.meta,
      isComposite: true,
      dependencies,
    },
    rollingWindow: options?.rollingWindow,
    filters: options?.filters,
  }
}

/**
 * Create a custom SQL measure
 */
export function customMeasure(sql: string, options?: MeasureOptions): Measure {
  return {
    type: 'number',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    format: options?.format ?? 'number',
    drillMembers: options?.drillMembers,
    shown: options?.shown,
    meta: {
      ...options?.meta,
      isCustom: true,
    },
    rollingWindow: options?.rollingWindow,
    filters: options?.filters,
  }
}

// =============================================================================
// Dimension Primitives
// =============================================================================

/**
 * Options for dimension definitions
 */
export interface DimensionOptions {
  /** Display title */
  title?: string
  /** Short title for compact display */
  shortTitle?: string
  /** Description */
  description?: string
  /** Whether this is the primary key */
  primaryKey?: boolean
  /** Case-insensitive matching for filters */
  caseInsensitiveMatch?: boolean
  /** Sub-query mode */
  subQuery?: boolean
  /** Whether dimension is visible */
  shown?: boolean
  /** Additional metadata */
  meta?: Record<string, unknown>
}

/**
 * Create a TIME dimension with granularity support
 *
 * @example
 * ```typescript
 * const dimensions = {
 *   createdAt: time('created_at'),
 *   // With custom title
 *   orderDate: time('order_date', { title: 'Order Date' }),
 * }
 * ```
 */
export function time(sql: string, options?: DimensionOptions): Dimension {
  return {
    type: 'time',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    primaryKey: options?.primaryKey,
    caseInsensitiveMatch: options?.caseInsensitiveMatch,
    subQuery: options?.subQuery,
    shown: options?.shown,
    meta: options?.meta,
  }
}

/**
 * Create a STRING dimension (categorical)
 *
 * @example
 * ```typescript
 * const dimensions = {
 *   status: categorical('status'),
 *   category: categorical('category', { title: 'Product Category' }),
 * }
 * ```
 */
export function categorical(sql: string, options?: DimensionOptions): Dimension {
  return {
    type: 'string',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    primaryKey: options?.primaryKey,
    caseInsensitiveMatch: options?.caseInsensitiveMatch ?? true,
    subQuery: options?.subQuery,
    shown: options?.shown,
    meta: options?.meta,
  }
}

/**
 * Alias for categorical (string dimension)
 */
export const string = categorical

/**
 * Create a NUMBER dimension
 *
 * @example
 * ```typescript
 * const dimensions = {
 *   amount: numeric('amount'),
 *   quantity: numeric('quantity'),
 * }
 * ```
 */
export function numeric(sql: string, options?: DimensionOptions): Dimension {
  return {
    type: 'number',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    primaryKey: options?.primaryKey,
    caseInsensitiveMatch: options?.caseInsensitiveMatch,
    subQuery: options?.subQuery,
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
 *   hasDiscount: boolean('has_discount'),
 * }
 * ```
 */
export function boolean(sql: string, options?: DimensionOptions): Dimension {
  return {
    type: 'boolean',
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    primaryKey: options?.primaryKey,
    caseInsensitiveMatch: options?.caseInsensitiveMatch,
    subQuery: options?.subQuery,
    shown: options?.shown,
    meta: options?.meta,
  }
}

/**
 * Geo dimension options
 */
export interface GeoDimensionOptions extends DimensionOptions {
  /** Latitude SQL expression */
  lat: string
  /** Longitude SQL expression */
  lng: string
}

/**
 * Create a GEO dimension with latitude and longitude
 *
 * @example
 * ```typescript
 * const dimensions = {
 *   location: geo({ lat: 'latitude', lng: 'longitude' }),
 *   storeLocation: geo({
 *     lat: 'store_lat',
 *     lng: 'store_lng',
 *     title: 'Store Location',
 *   }),
 * }
 * ```
 */
export function geo(options: GeoDimensionOptions): Dimension {
  return {
    type: 'geo',
    sql: `CONCAT(${options.lat}, ',', ${options.lng})`,
    latitude: { sql: options.lat },
    longitude: { sql: options.lng },
    title: options.title,
    shortTitle: options.shortTitle,
    description: options.description,
    primaryKey: options.primaryKey,
    caseInsensitiveMatch: options.caseInsensitiveMatch,
    subQuery: options.subQuery,
    shown: options.shown,
    meta: options.meta,
  }
}

/**
 * Create a DERIVED dimension (computed from SQL expression)
 *
 * @example
 * ```typescript
 * const dimensions = {
 *   fullName: derived(`CONCAT(first_name, ' ', last_name)`),
 *   orderYear: derived(`EXTRACT(YEAR FROM created_at)`),
 *   statusLabel: derived(`
 *     CASE status
 *       WHEN 'pending' THEN 'Pending Review'
 *       WHEN 'approved' THEN 'Approved'
 *       ELSE 'Unknown'
 *     END
 *   `),
 * }
 * ```
 */
export function derived(sql: string, type: DimensionType = 'string', options?: DimensionOptions): Dimension {
  return {
    type,
    sql,
    title: options?.title,
    shortTitle: options?.shortTitle,
    description: options?.description,
    primaryKey: options?.primaryKey,
    caseInsensitiveMatch: options?.caseInsensitiveMatch,
    subQuery: options?.subQuery,
    shown: options?.shown,
    meta: {
      ...options?.meta,
      isDerived: true,
    },
  }
}

// =============================================================================
// Dimension Hierarchy Primitives
// =============================================================================

/**
 * Hierarchy level definition
 */
export interface HierarchyLevel {
  name: string
  dimension: Dimension
}

/**
 * Dimension hierarchy definition
 */
export interface DimensionHierarchy {
  name: string
  levels: HierarchyLevel[]
  meta?: Record<string, unknown>
}

/**
 * Create a dimension hierarchy (e.g., Year > Quarter > Month > Day)
 *
 * @example
 * ```typescript
 * const dateHierarchy = hierarchy('date', [
 *   { name: 'year', dimension: derived(`EXTRACT(YEAR FROM created_at)`, 'number') },
 *   { name: 'quarter', dimension: derived(`EXTRACT(QUARTER FROM created_at)`, 'number') },
 *   { name: 'month', dimension: derived(`EXTRACT(MONTH FROM created_at)`, 'number') },
 *   { name: 'day', dimension: derived(`EXTRACT(DAY FROM created_at)`, 'number') },
 * ])
 *
 * const geoHierarchy = hierarchy('location', [
 *   { name: 'country', dimension: categorical('country') },
 *   { name: 'region', dimension: categorical('region') },
 *   { name: 'city', dimension: categorical('city') },
 * ])
 * ```
 */
export function hierarchy(name: string, levels: HierarchyLevel[], meta?: Record<string, unknown>): DimensionHierarchy {
  return { name, levels, meta }
}

/**
 * Expand a hierarchy into flat dimensions with hierarchy metadata
 */
export function expandHierarchy(h: DimensionHierarchy): Record<string, Dimension> {
  const dimensions: Record<string, Dimension> = {}

  h.levels.forEach((level, index) => {
    const key = `${h.name}_${level.name}`
    dimensions[key] = {
      ...level.dimension,
      meta: {
        ...level.dimension.meta,
        hierarchy: h.name,
        hierarchyLevel: index,
        hierarchyLevelName: level.name,
      },
    }
  })

  return dimensions
}

// =============================================================================
// Time Granularity Helpers
// =============================================================================

/**
 * All supported time granularities
 */
export const TIME_GRANULARITIES: Granularity[] = [
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
 * Get SQL for time truncation based on granularity and dialect
 */
export function getTimeTruncSQL(
  column: string,
  granularity: Granularity,
  dialect: 'postgres' | 'clickhouse' | 'duckdb' | 'sqlite' | 'mysql' = 'postgres'
): string {
  switch (dialect) {
    case 'postgres':
    case 'duckdb':
      return `date_trunc('${granularity}', ${column})`

    case 'clickhouse':
      const chFunctions: Record<Granularity, string> = {
        second: `toStartOfSecond(${column})`,
        minute: `toStartOfMinute(${column})`,
        hour: `toStartOfHour(${column})`,
        day: `toDate(${column})`,
        week: `toStartOfWeek(${column})`,
        month: `toStartOfMonth(${column})`,
        quarter: `toStartOfQuarter(${column})`,
        year: `toStartOfYear(${column})`,
      }
      return chFunctions[granularity]

    case 'sqlite':
      const sqliteFunctions: Record<Granularity, string> = {
        second: `strftime('%Y-%m-%d %H:%M:%S', ${column})`,
        minute: `strftime('%Y-%m-%d %H:%M:00', ${column})`,
        hour: `strftime('%Y-%m-%d %H:00:00', ${column})`,
        day: `date(${column})`,
        week: `date(${column}, 'weekday 0', '-6 days')`,
        month: `strftime('%Y-%m-01', ${column})`,
        quarter: `strftime('%Y-', ${column}) || printf('%02d', ((cast(strftime('%m', ${column}) as integer) - 1) / 3) * 3 + 1) || '-01'`,
        year: `strftime('%Y-01-01', ${column})`,
      }
      return sqliteFunctions[granularity]

    case 'mysql':
      const mysqlFunctions: Record<Granularity, string> = {
        second: `DATE_FORMAT(${column}, '%Y-%m-%d %H:%i:%s')`,
        minute: `DATE_FORMAT(${column}, '%Y-%m-%d %H:%i:00')`,
        hour: `DATE_FORMAT(${column}, '%Y-%m-%d %H:00:00')`,
        day: `DATE(${column})`,
        week: `DATE(DATE_SUB(${column}, INTERVAL WEEKDAY(${column}) DAY))`,
        month: `DATE_FORMAT(${column}, '%Y-%m-01')`,
        quarter: `MAKEDATE(YEAR(${column}), 1) + INTERVAL QUARTER(${column}) QUARTER - INTERVAL 1 QUARTER`,
        year: `DATE_FORMAT(${column}, '%Y-01-01')`,
      }
      return mysqlFunctions[granularity]

    default:
      return `date_trunc('${granularity}', ${column})`
  }
}

// =============================================================================
// Segment Primitives
// =============================================================================

/**
 * Create a segment (predefined filter)
 *
 * @example
 * ```typescript
 * const segments = {
 *   completedOrders: segment(`status = 'completed'`),
 *   highValueOrders: segment(`amount > 1000`),
 *   recentOrders: segment(`created_at >= CURRENT_DATE - INTERVAL '30 days'`),
 * }
 * ```
 */
export function segment(sql: string, options?: { title?: string; description?: string }): Segment {
  return {
    sql,
    title: options?.title,
    description: options?.description,
  }
}

// =============================================================================
// Join Primitives
// =============================================================================

/**
 * Create a belongsTo join (many-to-one)
 *
 * @example
 * ```typescript
 * const joins = {
 *   Customers: belongsTo('${CUBE}.customer_id = ${Customers}.id'),
 * }
 * ```
 */
export function belongsTo(sql: string): Join {
  return { relationship: 'belongsTo', sql }
}

/**
 * Create a hasMany join (one-to-many)
 *
 * @example
 * ```typescript
 * const joins = {
 *   Orders: hasMany('${CUBE}.id = ${Orders}.customer_id'),
 * }
 * ```
 */
export function hasMany(sql: string): Join {
  return { relationship: 'hasMany', sql }
}

/**
 * Create a hasOne join (one-to-one)
 *
 * @example
 * ```typescript
 * const joins = {
 *   Profile: hasOne('${CUBE}.id = ${Profile}.user_id'),
 * }
 * ```
 */
export function hasOne(sql: string): Join {
  return { relationship: 'hasOne', sql }
}

// =============================================================================
// Pre-aggregation Primitives
// =============================================================================

/**
 * Pre-aggregation options
 */
export interface RollupOptions {
  /** Measures to include */
  measures?: string[]
  /** Dimensions to include */
  dimensions?: string[]
  /** Time dimension reference */
  timeDimension?: string
  /** Time granularity */
  granularity?: Granularity
  /** Partition granularity for large datasets */
  partitionGranularity?: Granularity
  /** Segments to include */
  segments?: string[]
  /** Refresh configuration */
  refreshKey?: {
    every?: string
    sql?: string
    incremental?: boolean
    updateWindow?: string
  }
  /** Whether to use external storage */
  external?: boolean
  /** Scheduled refresh */
  scheduledRefresh?: boolean
  /** Indexes to create */
  indexes?: Record<string, { columns: string[] }>
}

/**
 * Create a rollup pre-aggregation
 *
 * @example
 * ```typescript
 * const preAggregations = {
 *   ordersDaily: rollup({
 *     measures: ['count', 'totalAmount'],
 *     dimensions: ['status'],
 *     timeDimension: 'createdAt',
 *     granularity: 'day',
 *   }),
 * }
 * ```
 */
export function rollup(options: RollupOptions): PreAggregation {
  return {
    type: 'rollup',
    measureReferences: options.measures,
    dimensionReferences: options.dimensions,
    timeDimensionReference: options.timeDimension,
    granularity: options.granularity,
    partitionGranularity: options.partitionGranularity,
    segmentReferences: options.segments,
    refreshKey: options.refreshKey,
    external: options.external,
    scheduledRefresh: options.scheduledRefresh,
    indexes: options.indexes,
  }
}

/**
 * Create an originalSql pre-aggregation (raw query caching)
 *
 * @example
 * ```typescript
 * const preAggregations = {
 *   ordersCache: originalSql({
 *     refreshKey: { every: '1 hour' },
 *   }),
 * }
 * ```
 */
export function originalSql(options?: Pick<RollupOptions, 'refreshKey' | 'external' | 'scheduledRefresh'>): PreAggregation {
  return {
    type: 'originalSql',
    refreshKey: options?.refreshKey,
    external: options?.external,
    scheduledRefresh: options?.scheduledRefresh,
  }
}

// =============================================================================
// Cube Builder
// =============================================================================

/**
 * Cube builder input type
 */
export interface CubeBuilderInput {
  /** SQL query or table reference */
  sql: string | (() => string)
  /** SQL table name (alternative to sql) */
  sqlTable?: string
  /** Title for display */
  title?: string
  /** Description */
  description?: string
  /** Measure definitions */
  measures: Record<string, Measure>
  /** Dimension definitions */
  dimensions: Record<string, Dimension>
  /** Join definitions */
  joins?: Record<string, Join>
  /** Pre-aggregation definitions */
  preAggregations?: Record<string, PreAggregation>
  /** Segment definitions */
  segments?: Record<string, Segment>
  /** Refresh key for the cube */
  refreshKey?: {
    every?: string
    sql?: string
    incremental?: boolean
    updateWindow?: string
  }
  /** Data source name */
  dataSource?: string
  /** SQL alias */
  sqlAlias?: string
  /** Whether cube is visible */
  shown?: boolean
  /** Whether to rewrite queries to use pre-aggregations */
  rewriteQueries?: boolean
  /** Extends another cube */
  extends?: string
  /** Context members for row-level security */
  contextMembers?: string[]
  /** Additional metadata */
  meta?: Record<string, unknown>
}

/**
 * Create a cube schema with fluent primitives
 *
 * This is an enhanced cube builder that accepts the primitive helpers directly.
 *
 * @example
 * ```typescript
 * import { defineCube, count, sum, avg, time, categorical } from '@dotdo/cubejs/primitives'
 *
 * const Orders = defineCube('Orders', {
 *   sql: `SELECT * FROM orders`,
 *
 *   measures: {
 *     count: count(),
 *     revenue: sum('amount', { format: 'currency' }),
 *     avgOrderValue: avg('amount'),
 *   },
 *
 *   dimensions: {
 *     createdAt: time('created_at'),
 *     status: categorical('status'),
 *   },
 * })
 * ```
 */
export function defineCube(name: string, input: CubeBuilderInput): CubeSchema {
  const sql = typeof input.sql === 'function' ? input.sql() : input.sql

  return {
    name,
    sql,
    sqlTable: input.sqlTable,
    title: input.title,
    description: input.description,
    measures: input.measures,
    dimensions: input.dimensions,
    joins: input.joins,
    preAggregations: input.preAggregations,
    segments: input.segments,
    refreshKey: input.refreshKey,
    dataSource: input.dataSource,
    sqlAlias: input.sqlAlias,
    shown: input.shown,
    rewriteQueries: input.rewriteQueries,
    extends: input.extends,
    contextMembers: input.contextMembers,
    meta: input.meta,
  }
}

// =============================================================================
// Formatting Helpers
// =============================================================================

/**
 * Format measure value based on format type
 */
export function formatMeasureValue(
  value: number | null | undefined,
  format?: string,
  options?: {
    locale?: string
    currency?: string
    decimals?: number
  }
): string {
  if (value === null || value === undefined) {
    return '-'
  }

  const locale = options?.locale ?? 'en-US'
  const decimals = options?.decimals ?? 2

  switch (format) {
    case 'currency':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: options?.currency ?? 'USD',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value)

    case 'percent':
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value / 100)

    case 'number':
    default:
      return new Intl.NumberFormat(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
      }).format(value)
  }
}

// =============================================================================
// Export Everything
// =============================================================================

export {
  // Re-export schema types for convenience
  type Measure,
  type Dimension,
  type CubeSchema,
  type Granularity,
  type MeasureType,
  type DimensionType,
  type Join,
  type JoinRelationship,
  type PreAggregation,
  type Segment,
}
