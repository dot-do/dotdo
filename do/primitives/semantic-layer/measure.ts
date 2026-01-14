/**
 * Measure - Core measure type for semantic layer aggregations
 *
 * Implements support for:
 * - Built-in aggregations: sum, count, count_distinct, avg, min, max
 * - Percentile aggregations: p50, p90, p95, p99
 * - Custom SQL expressions for complex measures
 * - Composite measures (derived from other measures)
 * - Measure formatting (currency, percentage, number)
 * - Null handling strategies
 *
 * @see dotdo-3y0jx
 */

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Error thrown for measure-related issues
 */
export class MeasureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MeasureError'
  }
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Supported aggregation types
 */
export type AggregationType =
  | 'sum'
  | 'count'
  | 'count_distinct'
  | 'avg'
  | 'min'
  | 'max'
  | 'percentile'
  | 'p50'
  | 'p90'
  | 'p95'
  | 'p99'
  | 'custom'
  | 'composite'

/**
 * SQL dialects for measure generation
 */
export type SQLDialect = 'postgres' | 'clickhouse' | 'duckdb' | 'sqlite' | 'mysql'

/**
 * Format types for measure values
 */
export type FormatType = 'currency' | 'percentage' | 'number' | 'custom' | 'none'

/**
 * Null handling strategies
 */
export type NullHandling =
  | 'ignore'
  | 'zero'
  | 'exclude'
  | { strategy: 'replace'; value: number | string }

/**
 * Format configuration for measure values
 */
export interface MeasureFormat {
  type: FormatType
  currency?: string
  locale?: string
  decimals?: number
  thousandsSeparator?: boolean
  notation?: 'standard' | 'compact' | 'scientific'
  multiplier?: number
  nullDisplay?: string
  nullFormatter?: () => string
  formatter?: (value: number) => string
  template?: string
}

/**
 * Measure definition input
 */
export interface MeasureDefinition {
  name: string
  type: AggregationType
  sql?: string
  percentile?: number
  description?: string
  format?: MeasureFormat
  nullHandling?: NullHandling
  meta?: Record<string, unknown>
  isWindowFunction?: boolean
  // For composite measures
  expression?: string
  measures?: Record<string, Measure>
}

/**
 * Options for SQL generation
 */
export interface ToSQLOptions {
  dialect?: SQLDialect
  alias?: string
}

/**
 * MetricDefinition compatible with SemanticLayer
 */
export interface MetricDefinition {
  type: string
  sql?: string
  description?: string
  format?: string
  meta?: Record<string, unknown>
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Validate measure name is a valid identifier
 */
function validateName(name: string): void {
  if (!name || name.trim() === '') {
    throw new MeasureError('Measure name is required')
  }
  // Must start with letter or underscore, can contain letters, numbers, underscores
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new MeasureError(
      `Invalid measure name: '${name}'. Must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }
}

/**
 * Validate aggregation type
 */
function validateType(type: AggregationType): void {
  const validTypes: AggregationType[] = [
    'sum',
    'count',
    'count_distinct',
    'avg',
    'min',
    'max',
    'percentile',
    'p50',
    'p90',
    'p95',
    'p99',
    'custom',
    'composite',
  ]
  if (!validTypes.includes(type)) {
    throw new MeasureError(`Invalid aggregation type: '${type}'`)
  }
}

/**
 * Check for SQL injection patterns
 */
function validateSQL(sql: string): void {
  // Basic SQL injection detection
  const dangerousPatterns = [
    /;\s*(DROP|DELETE|UPDATE|INSERT|TRUNCATE|ALTER)\s/i,
    /--/,
    /\/\*/,
    /xp_cmdshell/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(sql)) {
      throw new MeasureError('SQL expression contains potentially dangerous patterns')
    }
  }
}

/**
 * Get percentile value from type shorthand
 */
function getPercentileFromType(type: AggregationType): number | undefined {
  switch (type) {
    case 'p50':
      return 50
    case 'p90':
      return 90
    case 'p95':
      return 95
    case 'p99':
      return 99
    default:
      return undefined
  }
}

/**
 * Format a number value according to format configuration
 */
function formatNumber(
  value: number | null,
  format?: MeasureFormat
): string {
  if (value === null || value === undefined) {
    if (format?.nullFormatter) {
      return format.nullFormatter()
    }
    if (format?.nullDisplay !== undefined) {
      return format.nullDisplay
    }
    return ''
  }

  if (!format || format.type === 'none') {
    return String(value)
  }

  const locale = format.locale || 'en-US'

  switch (format.type) {
    case 'currency': {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: format.currency || 'USD',
        minimumFractionDigits: format.decimals,
        maximumFractionDigits: format.decimals,
      }).format(value)
    }

    case 'percentage': {
      // Intl.NumberFormat 'percent' style multiplies by 100, so:
      // - multiplier: 100 (default) = value is 0-1 range (e.g., 0.156 = 15.6%)
      // - multiplier: 1 = value is already percentage (e.g., 15.6 = 15.6%)
      const multiplier = format.multiplier ?? 100
      // Intl expects 0-1 range and multiplies by 100 internally
      // If multiplier=1, value is already percentage (15.6 means 15.6%), divide by 100
      // If multiplier=100 (default), value is decimal (0.156 means 15.6%), pass as-is
      const normalizedValue = multiplier === 1 ? value / 100 : value
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: format.decimals,
        maximumFractionDigits: format.decimals,
      }).format(normalizedValue)
    }

    case 'number': {
      const options: Intl.NumberFormatOptions = {
        minimumFractionDigits: format.decimals,
        maximumFractionDigits: format.decimals,
        useGrouping: format.thousandsSeparator ?? false,
      }
      if (format.notation === 'compact') {
        options.notation = 'compact'
      } else if (format.notation === 'scientific') {
        options.notation = 'scientific'
      }
      return new Intl.NumberFormat(locale, options).format(value)
    }

    case 'custom': {
      if (format.formatter) {
        return format.formatter(value)
      }
      if (format.template) {
        return format.template.replace('{value}', String(value))
      }
      return String(value)
    }

    default:
      return String(value)
  }
}

// =============================================================================
// MEASURE CLASS
// =============================================================================

/**
 * Core Measure class for semantic layer aggregations
 */
export class Measure {
  public readonly name: string
  public readonly type: AggregationType
  public readonly sql?: string
  public readonly percentile?: number
  public readonly description?: string
  public readonly format?: MeasureFormat
  public readonly nullHandling?: NullHandling
  public readonly meta?: Record<string, unknown>
  public readonly isWindowFunction?: boolean
  public readonly expression?: string
  public readonly measures?: Record<string, Measure>

  // Computed properties
  public readonly composedOf?: string[]

  constructor(definition: MeasureDefinition) {
    // Validate
    validateName(definition.name)
    validateType(definition.type)

    if (definition.sql) {
      validateSQL(definition.sql)
    }

    // Validate SQL requirements based on type
    this.validateSQLRequirements(definition)

    // Validate percentile range
    if (
      (definition.type === 'percentile' ||
        definition.type === 'p50' ||
        definition.type === 'p90' ||
        definition.type === 'p95' ||
        definition.type === 'p99') &&
      definition.percentile !== undefined
    ) {
      if (definition.percentile < 0 || definition.percentile > 100) {
        throw new MeasureError(
          `Percentile must be between 0 and 100, got ${definition.percentile}`
        )
      }
    }

    // Validate composite measure expression
    if (definition.type === 'composite') {
      this.validateCompositeExpression(definition)
    }

    // Assign properties
    this.name = definition.name
    this.type = definition.type
    this.sql = definition.sql
    this.percentile =
      definition.percentile ?? getPercentileFromType(definition.type)
    this.description = definition.description
    this.format = definition.format
    this.nullHandling = definition.nullHandling
    this.meta = definition.meta
    this.isWindowFunction = definition.isWindowFunction
    this.expression = definition.expression
    this.measures = definition.measures

    // Compute composed measures list
    if (definition.type === 'composite' && definition.measures) {
      this.composedOf = Object.keys(definition.measures)
    }
  }

  private validateSQLRequirements(definition: MeasureDefinition): void {
    const requiresSQL: AggregationType[] = [
      'sum',
      'count_distinct',
      'avg',
      'min',
      'max',
      'percentile',
      'p50',
      'p90',
      'p95',
      'p99',
      'custom',
    ]

    if (requiresSQL.includes(definition.type) && !definition.sql) {
      throw new MeasureError(
        `SQL is required for ${definition.type} measure '${definition.name}'`
      )
    }
  }

  private validateCompositeExpression(definition: MeasureDefinition): void {
    if (!definition.expression) {
      return // Allow expression-less composites (will use simple '1')
    }

    // Extract measure references from expression like {measureName}
    const refs = definition.expression.match(/\{(\w+)\}/g) || []
    const refNames = refs.map((ref) => ref.slice(1, -1))
    const providedMeasures = definition.measures || {}

    for (const refName of refNames) {
      if (!providedMeasures[refName]) {
        throw new MeasureError(
          `Composite measure '${definition.name}' references undefined measure '${refName}'`
        )
      }
    }
  }

  /**
   * Validate the measure (for deferred validation)
   */
  validate(): void {
    // Check for circular references in composite measures
    if (this.type === 'composite' && this.measures) {
      this.detectCircularReferences(new Set([this.name]))
    }
  }

  private detectCircularReferences(visited: Set<string>): void {
    if (!this.measures) return

    for (const [name, measure] of Object.entries(this.measures)) {
      if (visited.has(name)) {
        throw new MeasureError(
          `Circular reference detected in composite measure: ${Array.from(visited).join(' -> ')} -> ${name}`
        )
      }
      if (measure.type === 'composite' && measure.measures) {
        const newVisited = new Set(visited)
        newVisited.add(name)
        measure.detectCircularReferences(newVisited)
      }
    }
  }

  /**
   * Generate SQL for this measure
   */
  toSQL(tableName: string, options?: ToSQLOptions): string {
    const dialect = options?.dialect || 'postgres'
    const alias = options?.alias || this.name

    // Handle null handling wrapper
    const wrapWithNullHandling = (sql: string, col: string): string => {
      if (!this.nullHandling) return sql

      if (this.nullHandling === 'zero') {
        return sql.replace(col, `COALESCE(${col}, 0)`)
      }
      if (typeof this.nullHandling === 'object' && this.nullHandling.strategy === 'replace') {
        return sql.replace(col, `COALESCE(${col}, ${this.nullHandling.value})`)
      }
      return sql
    }

    const col = this.sql ? `${tableName}.${this.sql}` : '*'
    let sql: string

    switch (this.type) {
      case 'count':
        if (this.sql) {
          sql = `COUNT(${this.sql}) AS ${alias}`
        } else {
          sql = `COUNT(*) AS ${alias}`
        }
        if (this.nullHandling === 'exclude' && this.sql) {
          sql = `COUNT(${tableName}.${this.sql}) AS ${alias}`
        }
        break

      case 'sum':
        sql = `SUM(${col}) AS ${alias}`
        sql = wrapWithNullHandling(sql, col)
        break

      case 'count_distinct':
        sql = `COUNT(DISTINCT ${col}) AS ${alias}`
        break

      case 'avg':
        sql = `AVG(${col}) AS ${alias}`
        sql = wrapWithNullHandling(sql, col)
        break

      case 'min':
        sql = `MIN(${col}) AS ${alias}`
        sql = wrapWithNullHandling(sql, col)
        break

      case 'max':
        sql = `MAX(${col}) AS ${alias}`
        sql = wrapWithNullHandling(sql, col)
        break

      case 'percentile':
      case 'p50':
      case 'p90':
      case 'p95':
      case 'p99':
        sql = this.generatePercentileSQL(tableName, dialect, alias)
        break

      case 'custom':
        // Replace ${TABLE} placeholders
        let customSql = this.sql!
        customSql = customSql.replace(/\$\{TABLE\}/g, tableName)
        sql = `(${customSql}) AS ${alias}`
        break

      case 'composite':
        sql = this.generateCompositeSQL(tableName, dialect, alias)
        break

      default:
        throw new MeasureError(`Unknown aggregation type: ${this.type}`)
    }

    return sql
  }

  private generatePercentileSQL(
    tableName: string,
    dialect: SQLDialect,
    alias: string
  ): string {
    const p = this.percentile! / 100
    const col = `${tableName}.${this.sql}`

    switch (dialect) {
      case 'postgres':
      case 'duckdb':
        return `PERCENTILE_CONT(${p}) WITHIN GROUP (ORDER BY ${col}) AS ${alias}`

      case 'clickhouse':
        return `quantile(${p})(${col}) AS ${alias}`

      case 'sqlite':
        // SQLite doesn't have native percentile - use subquery approximation
        // This returns the value at the percentile position
        return `(
          SELECT ${col} FROM ${tableName}
          ORDER BY ${col}
          LIMIT 1
          OFFSET CAST((SELECT COUNT(*) FROM ${tableName}) * ${p} AS INTEGER)
        ) AS ${alias}`

      case 'mysql':
        // MySQL 8+ has PERCENTILE_CONT as window function
        return `PERCENTILE_CONT(${p}) WITHIN GROUP (ORDER BY ${col}) AS ${alias}`

      default:
        return `PERCENTILE_CONT(${p}) WITHIN GROUP (ORDER BY ${col}) AS ${alias}`
    }
  }

  private generateCompositeSQL(
    tableName: string,
    dialect: SQLDialect,
    alias: string
  ): string {
    if (!this.expression || !this.measures) {
      return `(1) AS ${alias}`
    }

    let sql = this.expression

    // Replace measure references with their SQL
    for (const [name, measure] of Object.entries(this.measures)) {
      // Generate the inner SQL without alias
      const measureSQL = this.getMeasureSQLWithoutAlias(
        measure,
        tableName,
        dialect
      )
      sql = sql.replace(new RegExp(`\\{${name}\\}`, 'g'), `(${measureSQL})`)
    }

    return `(${sql}) AS ${alias}`
  }

  private getMeasureSQLWithoutAlias(
    measure: Measure,
    tableName: string,
    dialect: SQLDialect
  ): string {
    const col = measure.sql ? `${tableName}.${measure.sql}` : '*'

    // Handle null handling wrapper for composed measures
    const wrapWithNullHandling = (sql: string, column: string): string => {
      if (!measure.nullHandling) return sql

      if (measure.nullHandling === 'zero') {
        return sql.replace(column, `COALESCE(${column}, 0)`)
      }
      if (
        typeof measure.nullHandling === 'object' &&
        measure.nullHandling.strategy === 'replace'
      ) {
        return sql.replace(
          column,
          `COALESCE(${column}, ${measure.nullHandling.value})`
        )
      }
      return sql
    }

    switch (measure.type) {
      case 'count':
        return measure.sql ? `COUNT(${measure.sql})` : 'COUNT(*)'
      case 'sum': {
        let sql = `SUM(${col})`
        sql = wrapWithNullHandling(sql, col)
        return sql
      }
      case 'count_distinct':
        return `COUNT(DISTINCT ${col})`
      case 'avg': {
        let sql = `AVG(${col})`
        sql = wrapWithNullHandling(sql, col)
        return sql
      }
      case 'min':
        return `MIN(${col})`
      case 'max':
        return `MAX(${col})`
      case 'custom':
        return measure.sql!.replace(/\$\{TABLE\}/g, tableName)
      case 'composite':
        // Recursively generate composite SQL
        if (!measure.expression || !measure.measures) return '1'
        let compositeSql = measure.expression
        for (const [name, innerMeasure] of Object.entries(measure.measures)) {
          const innerSQL = this.getMeasureSQLWithoutAlias(
            innerMeasure,
            tableName,
            dialect
          )
          compositeSql = compositeSql.replace(
            new RegExp(`\\{${name}\\}`, 'g'),
            `(${innerSQL})`
          )
        }
        return compositeSql
      default:
        return col
    }
  }

  /**
   * Format a numeric value according to measure's format configuration
   */
  formatValue(value: number | null): string {
    return formatNumber(value, this.format)
  }

  /**
   * Get the measure definition
   */
  getDefinition(): MeasureDefinition {
    return {
      name: this.name,
      type: this.type,
      sql: this.sql,
      percentile: this.percentile,
      description: this.description,
      format: this.format,
      nullHandling: this.nullHandling,
      meta: this.meta,
      isWindowFunction: this.isWindowFunction,
      expression: this.expression,
    }
  }

  /**
   * Get list of measure dependencies (for composite measures)
   */
  getDependencies(): string[] {
    if (this.type !== 'composite' || !this.measures) {
      return []
    }

    const deps: string[] = []
    for (const [name, measure] of Object.entries(this.measures)) {
      deps.push(name)
      // Recursively get nested dependencies
      const nestedDeps = measure.getDependencies()
      deps.push(...nestedDeps)
    }
    return [...new Set(deps)]
  }

  /**
   * Convert to MetricDefinition format compatible with SemanticLayer
   */
  toMetricDefinition(): MetricDefinition {
    // Map type to SemanticLayer MetricType
    let metricType: string
    switch (this.type) {
      case 'count_distinct':
        metricType = 'countDistinct'
        break
      case 'p50':
      case 'p90':
      case 'p95':
      case 'p99':
      case 'percentile':
        metricType = 'custom' // Percentiles are custom in SemanticLayer
        break
      case 'composite':
        metricType = 'custom'
        break
      default:
        metricType = this.type
    }

    return {
      type: metricType,
      sql: this.sql,
      description: this.description,
      format: this.format?.type,
      meta: this.meta,
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new Measure instance
 */
export function createMeasure(definition: MeasureDefinition): Measure {
  return new Measure(definition)
}

// =============================================================================
// COMPOSITE MEASURE HELPER
// =============================================================================

/**
 * Composite measure type alias for clarity
 */
export type CompositeMeasure = Measure
