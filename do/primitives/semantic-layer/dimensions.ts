/**
 * Dimension Types for SemanticLayer
 *
 * Comprehensive dimension type system including:
 * - Time dimensions with granularity (second, minute, hour, day, week, month, quarter, year)
 * - Categorical dimensions (string, enum)
 * - Derived dimensions (computed from other dimensions/columns)
 * - Geo dimensions (country, region, city, lat/lng)
 * - Boolean dimensions
 * - Dimension hierarchies (e.g., year > quarter > month > day)
 *
 * @see dotdo-bvn3l
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * SQL dialect options
 */
export type SQLDialect = 'postgres' | 'clickhouse' | 'duckdb' | 'sqlite' | 'mysql'

/**
 * Time granularity options
 */
export type TimeGranularity =
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'

/**
 * All supported time granularities in order from finest to coarsest
 */
export const TIME_GRANULARITIES: TimeGranularity[] = [
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
 * Geo dimension levels
 */
export type GeoLevel = 'country' | 'region' | 'city' | 'postalCode' | 'coordinates'

/**
 * All supported geo levels
 */
export const GEO_LEVELS: GeoLevel[] = [
  'country',
  'region',
  'city',
  'postalCode',
  'coordinates',
]

/**
 * Cardinality hint for categorical dimensions
 */
export type CardinalityHint = 'low' | 'medium' | 'high'

/**
 * ISO format for country codes
 */
export type ISOFormat = 'alpha2' | 'alpha3' | 'numeric'

/**
 * Derived dimension expression types
 */
export type DerivedDimensionExpression =
  | string
  | ExtractExpression
  | CaseExpression
  | ArithmeticExpression
  | ConcatExpression

export interface ExtractExpression {
  type: 'extract'
  field: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'dow' | 'doy' | 'week' | 'quarter'
  from: string
}

export interface CaseExpression {
  type: 'case'
  cases: Array<{ when: string; then: string }>
  else?: string
}

export interface ArithmeticExpression {
  type: 'arithmetic'
  operator: '+' | '-' | '*' | '/'
  left: string
  right: string
}

export interface ConcatExpression {
  type: 'concat'
  parts: string[]
}

// =============================================================================
// CONFIGURATION INTERFACES
// =============================================================================

/**
 * Base dimension configuration
 */
export interface BaseDimensionConfig {
  name: string
  description?: string
  meta?: Record<string, unknown>
}

/**
 * Time dimension configuration
 */
export interface TimeDimensionConfig extends BaseDimensionConfig {
  type?: 'time'
  sql: string
  defaultGranularity?: TimeGranularity
  timezone?: string
  fiscalYearStartMonth?: number
}

/**
 * Categorical dimension configuration
 */
export interface CategoricalDimensionConfig extends BaseDimensionConfig {
  type?: 'categorical'
  sql: string
  cardinalityHint?: CardinalityHint
  caseSensitive?: boolean
}

/**
 * Enum dimension configuration
 */
export interface EnumDimensionConfig extends BaseDimensionConfig {
  type?: 'enum'
  sql: string
  values: string[]
  labels?: Record<string, string>
  defaultValue?: string
}

/**
 * Derived dimension configuration
 */
export interface DerivedDimensionConfig extends BaseDimensionConfig {
  type?: 'derived'
  expression: DerivedDimensionExpression
  resultType: 'string' | 'number' | 'boolean' | 'time'
  dependencies?: string[]
}

/**
 * Geo dimension configuration
 */
export interface GeoDimensionConfig extends BaseDimensionConfig {
  type?: 'geo'
  sql?: string
  level: GeoLevel
  latitudeColumn?: string
  longitudeColumn?: string
  isoFormat?: ISOFormat
  geohashPrecision?: number
}

/**
 * Boolean dimension configuration
 */
export interface BooleanDimensionConfig extends BaseDimensionConfig {
  type?: 'boolean'
  sql: string
  trueLabel?: string
  falseLabel?: string
  nullLabel?: string
  treatNullAs?: boolean
}

/**
 * Hierarchy level configuration
 */
export interface HierarchyLevel {
  name: string
  dimension: string
  granularity?: TimeGranularity
}

/**
 * Hierarchy configuration
 */
export interface HierarchyConfig {
  name: string
  levels: HierarchyLevel[]
  description?: string
}

/**
 * Union type for all dimension configs
 */
export type DimensionConfig =
  | (TimeDimensionConfig & { type: 'time' })
  | (CategoricalDimensionConfig & { type: 'categorical' })
  | (EnumDimensionConfig & { type: 'enum' })
  | (DerivedDimensionConfig & { type: 'derived' })
  | (GeoDimensionConfig & { type: 'geo' })
  | (BooleanDimensionConfig & { type: 'boolean' })

// =============================================================================
// GRANULARITY HELPERS
// =============================================================================

/**
 * Convert granularity to approximate seconds
 */
export function granularityToSeconds(granularity: TimeGranularity): number {
  const mapping: Record<TimeGranularity, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000, // 30 days
    quarter: 7776000, // 90 days
    year: 31536000, // 365 days
  }
  return mapping[granularity]
}

/**
 * Compare two granularities
 * Returns negative if a < b, positive if a > b, 0 if equal
 */
export function compareGranularity(a: TimeGranularity, b: TimeGranularity): number {
  return granularityToSeconds(a) - granularityToSeconds(b)
}

/**
 * Get coarser granularities than the given one
 */
export function getCoarserGranularities(granularity: TimeGranularity): TimeGranularity[] {
  const index = TIME_GRANULARITIES.indexOf(granularity)
  return TIME_GRANULARITIES.slice(index + 1)
}

/**
 * Get finer granularities than the given one
 */
export function getFinerGranularities(granularity: TimeGranularity): TimeGranularity[] {
  const index = TIME_GRANULARITIES.indexOf(granularity)
  return TIME_GRANULARITIES.slice(0, index).reverse()
}

// =============================================================================
// SQL GENERATION OPTIONS
// =============================================================================

interface SQLOptions {
  dialect?: SQLDialect
  granularity?: TimeGranularity
  asGeohash?: boolean
}

interface DistanceSQLOptions {
  targetLat: number
  targetLng: number
  dialect?: SQLDialect
}

// =============================================================================
// BASE DIMENSION CLASS
// =============================================================================

/**
 * Abstract base class for all dimension types
 */
abstract class BaseDimension {
  public readonly name: string
  public readonly description?: string
  public readonly meta?: Record<string, unknown>
  abstract readonly type: string

  constructor(config: BaseDimensionConfig) {
    this.name = config.name
    this.description = config.description
    this.meta = config.meta
  }

  abstract toSQL(tableName: string, options?: SQLOptions): string
}

// =============================================================================
// TIME DIMENSION
// =============================================================================

/**
 * Time dimension with granularity support
 */
export class TimeDimension extends BaseDimension {
  readonly type = 'time'
  readonly sql: string
  readonly defaultGranularity: TimeGranularity
  readonly timezone?: string
  readonly fiscalYearStartMonth?: number

  constructor(config: TimeDimensionConfig) {
    super(config)
    this.sql = config.sql
    this.defaultGranularity = config.defaultGranularity || 'day'
    this.timezone = config.timezone
    this.fiscalYearStartMonth = config.fiscalYearStartMonth
  }

  toSQL(tableName: string, options?: SQLOptions): string {
    const dialect = options?.dialect || 'postgres'
    const granularity = options?.granularity || this.defaultGranularity
    const col = `${tableName}.${this.sql}`

    // Handle timezone if specified
    const tzCol = this.timezone
      ? this.applyTimezone(col, dialect)
      : col

    return this.truncateTime(tzCol, granularity, dialect)
  }

  private applyTimezone(col: string, dialect: SQLDialect): string {
    switch (dialect) {
      case 'postgres':
        return `(${col} AT TIME ZONE '${this.timezone}')`
      case 'clickhouse':
        return `toTimeZone(${col}, '${this.timezone}')`
      case 'mysql':
        return `CONVERT_TZ(${col}, 'UTC', '${this.timezone}')`
      case 'duckdb':
        return `timezone('${this.timezone}', ${col})`
      case 'sqlite':
        // SQLite doesn't have native timezone support
        return col
      default:
        return col
    }
  }

  private truncateTime(col: string, granularity: TimeGranularity, dialect: SQLDialect): string {
    switch (dialect) {
      case 'postgres':
      case 'duckdb':
        return `date_trunc('${granularity}', ${col})`

      case 'clickhouse':
        return this.clickhouseTimeTrunc(col, granularity)

      case 'sqlite':
        return this.sqliteTimeTrunc(col, granularity)

      case 'mysql':
        return this.mysqlTimeTrunc(col, granularity)

      default:
        return `date_trunc('${granularity}', ${col})`
    }
  }

  private clickhouseTimeTrunc(col: string, granularity: TimeGranularity): string {
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

  private sqliteTimeTrunc(col: string, granularity: TimeGranularity): string {
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

  private mysqlTimeTrunc(col: string, granularity: TimeGranularity): string {
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
}

// =============================================================================
// CATEGORICAL DIMENSION
// =============================================================================

/**
 * Categorical dimension for string values
 */
export class CategoricalDimension extends BaseDimension {
  readonly type = 'categorical'
  readonly sql: string
  readonly cardinalityHint?: CardinalityHint
  readonly caseSensitive: boolean

  constructor(config: CategoricalDimensionConfig) {
    super(config)
    this.sql = config.sql
    this.cardinalityHint = config.cardinalityHint
    this.caseSensitive = config.caseSensitive ?? true
  }

  toSQL(tableName: string, options?: SQLOptions): string {
    const col = `${tableName}.${this.sql}`

    if (!this.caseSensitive) {
      const dialect = options?.dialect || 'postgres'
      return this.caseInsensitiveSQL(col, dialect)
    }

    return col
  }

  private caseInsensitiveSQL(col: string, dialect: SQLDialect): string {
    switch (dialect) {
      case 'postgres':
      case 'duckdb':
        return `LOWER(${col})`
      case 'clickhouse':
        return `lowerUTF8(${col})`
      case 'mysql':
        return `LOWER(${col})`
      case 'sqlite':
        return `LOWER(${col})`
      default:
        return `LOWER(${col})`
    }
  }
}

// =============================================================================
// ENUM DIMENSION
// =============================================================================

/**
 * Enum dimension with fixed set of allowed values
 */
export class EnumDimension extends BaseDimension {
  readonly type = 'enum'
  readonly sql: string
  readonly values: string[]
  readonly labels?: Record<string, string>
  readonly defaultValue?: string

  constructor(config: EnumDimensionConfig) {
    super(config)
    this.sql = config.sql
    this.values = config.values
    this.labels = config.labels
    this.defaultValue = config.defaultValue

    // Validate default value is in values
    if (this.defaultValue && !this.values.includes(this.defaultValue)) {
      throw new Error(
        `Default value '${this.defaultValue}' is not in allowed values: ${this.values.join(', ')}`
      )
    }
  }

  toSQL(tableName: string, _options?: SQLOptions): string {
    return `${tableName}.${this.sql}`
  }

  /**
   * Check if a value is valid for this enum
   */
  isValidValue(value: string): boolean {
    return this.values.includes(value)
  }

  /**
   * Get display label for a value
   */
  getLabel(value: string): string {
    return this.labels?.[value] ?? value
  }
}

// =============================================================================
// DERIVED DIMENSION
// =============================================================================

/**
 * Derived dimension computed from other columns
 */
export class DerivedDimension extends BaseDimension {
  readonly type = 'derived'
  readonly expression: DerivedDimensionExpression
  readonly resultType: 'string' | 'number' | 'boolean' | 'time'
  readonly dependencies: string[]

  constructor(config: DerivedDimensionConfig) {
    super(config)
    this.expression = config.expression
    this.resultType = config.resultType
    this.dependencies = config.dependencies || []
  }

  toSQL(tableName: string, options?: SQLOptions): string {
    const dialect = options?.dialect || 'postgres'

    if (typeof this.expression === 'string') {
      return this.qualifyColumnReferences(this.expression, tableName)
    }

    return this.expressionToSQL(this.expression, tableName, dialect)
  }

  private qualifyColumnReferences(expr: string, tableName: string): string {
    // Simple column qualification - in real impl would use proper SQL parser
    for (const dep of this.dependencies) {
      expr = expr.replace(new RegExp(`\\b${dep}\\b`, 'g'), `${tableName}.${dep}`)
    }
    return expr
  }

  private expressionToSQL(
    expr: DerivedDimensionExpression,
    tableName: string,
    dialect: SQLDialect
  ): string {
    if (typeof expr === 'string') {
      return this.qualifyColumnReferences(expr, tableName)
    }

    switch (expr.type) {
      case 'extract':
        return this.extractToSQL(expr, tableName, dialect)
      case 'case':
        return this.caseToSQL(expr, tableName)
      case 'arithmetic':
        return this.arithmeticToSQL(expr, tableName)
      case 'concat':
        return this.concatToSQL(expr, tableName, dialect)
      default:
        throw new Error(`Unknown expression type: ${(expr as any).type}`)
    }
  }

  private extractToSQL(expr: ExtractExpression, tableName: string, dialect: SQLDialect): string {
    const col = `${tableName}.${expr.from}`

    switch (dialect) {
      case 'postgres':
      case 'duckdb':
        return `EXTRACT(${expr.field.toUpperCase()} FROM ${col})`
      case 'clickhouse':
        return this.clickhouseExtract(col, expr.field)
      case 'mysql':
        return `EXTRACT(${expr.field.toUpperCase()} FROM ${col})`
      case 'sqlite':
        return this.sqliteExtract(col, expr.field)
      default:
        return `EXTRACT(${expr.field.toUpperCase()} FROM ${col})`
    }
  }

  private clickhouseExtract(col: string, field: string): string {
    const fieldMap: Record<string, string> = {
      year: `toYear(${col})`,
      month: `toMonth(${col})`,
      day: `toDayOfMonth(${col})`,
      hour: `toHour(${col})`,
      minute: `toMinute(${col})`,
      second: `toSecond(${col})`,
      dow: `toDayOfWeek(${col})`,
      doy: `toDayOfYear(${col})`,
      week: `toWeek(${col})`,
      quarter: `toQuarter(${col})`,
    }
    return fieldMap[field] || `toYear(${col})`
  }

  private sqliteExtract(col: string, field: string): string {
    const fieldMap: Record<string, string> = {
      year: `CAST(strftime('%Y', ${col}) AS INTEGER)`,
      month: `CAST(strftime('%m', ${col}) AS INTEGER)`,
      day: `CAST(strftime('%d', ${col}) AS INTEGER)`,
      hour: `CAST(strftime('%H', ${col}) AS INTEGER)`,
      minute: `CAST(strftime('%M', ${col}) AS INTEGER)`,
      second: `CAST(strftime('%S', ${col}) AS INTEGER)`,
      dow: `CAST(strftime('%w', ${col}) AS INTEGER)`,
      doy: `CAST(strftime('%j', ${col}) AS INTEGER)`,
      week: `CAST(strftime('%W', ${col}) AS INTEGER)`,
    }
    return fieldMap[field] || `CAST(strftime('%Y', ${col}) AS INTEGER)`
  }

  private caseToSQL(expr: CaseExpression, tableName: string): string {
    const cases = expr.cases
      .map((c) => `WHEN ${this.qualifyColumnReferences(c.when, tableName)} THEN ${c.then}`)
      .join(' ')

    const elseClause = expr.else ? ` ELSE ${expr.else}` : ''

    return `CASE ${cases}${elseClause} END`
  }

  private arithmeticToSQL(expr: ArithmeticExpression, tableName: string): string {
    const left = `${tableName}.${expr.left}`
    const right = `${tableName}.${expr.right}`
    return `(${left} ${expr.operator} ${right})`
  }

  private concatToSQL(expr: ConcatExpression, tableName: string, dialect: SQLDialect): string {
    const parts = expr.parts.map((p) => {
      // Check if it's a literal string (starts and ends with quote)
      if ((p.startsWith("'") && p.endsWith("'")) || (p.startsWith('"') && p.endsWith('"'))) {
        return p
      }
      return `${tableName}.${p}`
    })

    switch (dialect) {
      case 'postgres':
      case 'duckdb':
      case 'sqlite':
        return parts.join(' || ')
      case 'mysql':
        return `CONCAT(${parts.join(', ')})`
      case 'clickhouse':
        return `concat(${parts.join(', ')})`
      default:
        return parts.join(' || ')
    }
  }
}

// =============================================================================
// GEO DIMENSION
// =============================================================================

/**
 * Geo dimension for geographic data
 */
export class GeoDimension extends BaseDimension {
  readonly type = 'geo'
  readonly sql?: string
  readonly level: GeoLevel
  readonly latitudeColumn?: string
  readonly longitudeColumn?: string
  readonly isoFormat?: ISOFormat
  readonly geohashPrecision?: number

  constructor(config: GeoDimensionConfig) {
    super(config)
    this.sql = config.sql
    this.level = config.level
    this.latitudeColumn = config.latitudeColumn
    this.longitudeColumn = config.longitudeColumn
    this.isoFormat = config.isoFormat
    this.geohashPrecision = config.geohashPrecision
  }

  toSQL(tableName: string, options?: SQLOptions): string {
    const dialect = options?.dialect || 'postgres'

    if (this.level === 'coordinates') {
      if (options?.asGeohash) {
        return this.geohashSQL(tableName, dialect)
      }
      return this.coordinatesSQL(tableName, dialect)
    }

    return this.sql ? `${tableName}.${this.sql}` : tableName
  }

  private coordinatesSQL(tableName: string, dialect: SQLDialect): string {
    const lat = `${tableName}.${this.latitudeColumn}`
    const lng = `${tableName}.${this.longitudeColumn}`

    switch (dialect) {
      case 'postgres':
        return `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`
      case 'clickhouse':
        return `(${lat}, ${lng})`
      case 'duckdb':
        return `ST_Point(${lng}, ${lat})`
      default:
        return `${lat}, ${lng}`
    }
  }

  private geohashSQL(tableName: string, dialect: SQLDialect): string {
    const lat = `${tableName}.${this.latitudeColumn}`
    const lng = `${tableName}.${this.longitudeColumn}`
    const precision = this.geohashPrecision || 6

    switch (dialect) {
      case 'postgres':
        return `ST_GeoHash(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), ${precision})`
      case 'clickhouse':
        return `geohashEncode(${lng}, ${lat}, ${precision})`
      case 'duckdb':
        return `ST_GeoHash(ST_Point(${lng}, ${lat}), ${precision})`
      default:
        return `geohash(${lat}, ${lng}, ${precision})`
    }
  }

  /**
   * Generate SQL for distance calculation
   */
  distanceSQL(tableName: string, options: DistanceSQLOptions): string {
    const dialect = options.dialect || 'postgres'
    const lat = `${tableName}.${this.latitudeColumn}`
    const lng = `${tableName}.${this.longitudeColumn}`
    const { targetLat, targetLng } = options

    switch (dialect) {
      case 'postgres':
        return `ST_Distance(
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${targetLng}, ${targetLat}), 4326)::geography
        )`
      case 'clickhouse':
        return `greatCircleDistance(${lng}, ${lat}, ${targetLng}, ${targetLat})`
      case 'duckdb':
        return `ST_Distance(ST_Point(${lng}, ${lat}), ST_Point(${targetLng}, ${targetLat}))`
      case 'mysql':
        return `ST_Distance_Sphere(
          POINT(${lng}, ${lat}),
          POINT(${targetLng}, ${targetLat})
        )`
      default:
        // Haversine fallback
        return this.haversineSQL(lat, lng, targetLat, targetLng)
    }
  }

  private haversineSQL(lat: string, lng: string, targetLat: number, targetLng: number): string {
    // Haversine formula for distance calculation
    return `
      6371000 * 2 * ASIN(SQRT(
        POWER(SIN(RADIANS(${lat} - ${targetLat}) / 2), 2) +
        COS(RADIANS(${targetLat})) * COS(RADIANS(${lat})) *
        POWER(SIN(RADIANS(${lng} - ${targetLng}) / 2), 2)
      ))
    `
  }
}

// =============================================================================
// BOOLEAN DIMENSION
// =============================================================================

/**
 * Boolean dimension with label support
 */
export class BooleanDimension extends BaseDimension {
  readonly type = 'boolean'
  readonly sql: string
  readonly trueLabel: string
  readonly falseLabel: string
  readonly nullLabel: string
  readonly treatNullAs?: boolean

  constructor(config: BooleanDimensionConfig) {
    super(config)
    this.sql = config.sql
    this.trueLabel = config.trueLabel ?? 'Yes'
    this.falseLabel = config.falseLabel ?? 'No'
    this.nullLabel = config.nullLabel ?? 'Unknown'
    this.treatNullAs = config.treatNullAs
  }

  toSQL(tableName: string, options?: SQLOptions): string {
    const col = `${tableName}.${this.sql}`
    const dialect = options?.dialect || 'postgres'

    if (this.treatNullAs !== undefined) {
      return this.coalesceSQL(col, dialect)
    }

    return col
  }

  private coalesceSQL(col: string, dialect: SQLDialect): string {
    const defaultVal = this.treatNullAs ? 'TRUE' : 'FALSE'

    switch (dialect) {
      case 'postgres':
      case 'duckdb':
      case 'mysql':
        return `COALESCE(${col}, ${defaultVal})`
      case 'clickhouse':
        return `ifNull(${col}, ${this.treatNullAs ? '1' : '0'})`
      case 'sqlite':
        return `COALESCE(${col}, ${this.treatNullAs ? '1' : '0'})`
      default:
        return `COALESCE(${col}, ${defaultVal})`
    }
  }

  /**
   * Get display label for a boolean value
   */
  getLabel(value: boolean | null): string {
    if (value === null || value === undefined) {
      return this.nullLabel
    }
    return value ? this.trueLabel : this.falseLabel
  }
}

// =============================================================================
// DIMENSION HIERARCHY
// =============================================================================

/**
 * Dimension hierarchy for drill-down/roll-up operations
 */
export class DimensionHierarchy {
  readonly name: string
  readonly levels: HierarchyLevel[]
  readonly description?: string

  constructor(config: HierarchyConfig) {
    this.name = config.name
    this.levels = config.levels
    this.description = config.description
  }

  /**
   * Get a level by name
   */
  getLevel(name: string): HierarchyLevel | undefined {
    return this.levels.find((l) => l.name === name)
  }

  /**
   * Get the parent level of a given level
   */
  getParentLevel(levelName: string): HierarchyLevel | undefined {
    const index = this.levels.findIndex((l) => l.name === levelName)
    if (index <= 0) return undefined
    return this.levels[index - 1]
  }

  /**
   * Get the child level of a given level
   */
  getChildLevel(levelName: string): HierarchyLevel | undefined {
    const index = this.levels.findIndex((l) => l.name === levelName)
    if (index < 0 || index >= this.levels.length - 1) return undefined
    return this.levels[index + 1]
  }

  /**
   * Get all ancestor levels of a given level
   */
  getAncestors(levelName: string): HierarchyLevel[] {
    const index = this.levels.findIndex((l) => l.name === levelName)
    if (index <= 0) return []
    return this.levels.slice(0, index).reverse()
  }

  /**
   * Get all descendant levels of a given level
   */
  getDescendants(levelName: string): HierarchyLevel[] {
    const index = this.levels.findIndex((l) => l.name === levelName)
    if (index < 0 || index >= this.levels.length - 1) return []
    return this.levels.slice(index + 1)
  }

  /**
   * Get the depth of a level (0-indexed from root)
   */
  getLevelDepth(levelName: string): number {
    return this.levels.findIndex((l) => l.name === levelName)
  }

  /**
   * Check if drill down is possible from a level
   */
  canDrillDown(levelName: string): boolean {
    const index = this.levels.findIndex((l) => l.name === levelName)
    return index >= 0 && index < this.levels.length - 1
  }

  /**
   * Check if drill up is possible from a level
   */
  canDrillUp(levelName: string): boolean {
    const index = this.levels.findIndex((l) => l.name === levelName)
    return index > 0
  }

  /**
   * Get the next level for drill down
   */
  drillDown(levelName: string): HierarchyLevel | undefined {
    return this.getChildLevel(levelName)
  }

  /**
   * Get the next level for drill up
   */
  drillUp(levelName: string): HierarchyLevel | undefined {
    return this.getParentLevel(levelName)
  }
}

// =============================================================================
// DIMENSION FACTORY
// =============================================================================

type DimensionCreator = (config: any) => BaseDimension

/**
 * Factory for creating dimension instances
 */
export class DimensionFactory {
  private creators: Map<string, DimensionCreator> = new Map()

  constructor() {
    // Register default dimension types
    this.register('time', (config) => new TimeDimension(config))
    this.register('categorical', (config) => new CategoricalDimension(config))
    this.register('enum', (config) => new EnumDimension(config))
    this.register('derived', (config) => new DerivedDimension(config))
    this.register('geo', (config) => new GeoDimension(config))
    this.register('boolean', (config) => new BooleanDimension(config))
  }

  /**
   * Register a custom dimension type
   */
  register(type: string, creator: DimensionCreator): void {
    this.creators.set(type, creator)
  }

  /**
   * Create a dimension from configuration
   */
  create(config: DimensionConfig | (BaseDimensionConfig & { type: string })): BaseDimension {
    const creator = this.creators.get(config.type)
    if (!creator) {
      throw new Error(`Unknown dimension type: ${config.type}`)
    }
    return creator(config)
  }
}

/**
 * Create a dimension from configuration (convenience function)
 */
export function createDimension(config: DimensionConfig): BaseDimension {
  const factory = new DimensionFactory()
  return factory.create(config)
}

// =============================================================================
// EXPORTS
// =============================================================================

export type {
  SQLOptions,
  DistanceSQLOptions,
}
