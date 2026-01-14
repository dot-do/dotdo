/**
 * Snowflake Time Travel Query Support
 *
 * Parses and generates Snowflake-specific time travel SQL queries:
 * - AT (TIMESTAMP => 'time') clause
 * - AT (OFFSET => -N) clause
 * - BEFORE (TIMESTAMP => 'time') clause
 * - BEFORE (STATEMENT => 'id') clause
 *
 * Also provides UNDROP command support and retention configuration.
 *
 * @see https://docs.snowflake.com/en/user-guide/data-time-travel
 *
 * @module compat/snowflake/time-travel
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Snowflake time travel clause types
 */
export type TimeTravelClauseType =
  | 'AT_TIMESTAMP'
  | 'AT_OFFSET'
  | 'BEFORE_TIMESTAMP'
  | 'BEFORE_STATEMENT'

/**
 * Parsed Snowflake time travel query
 */
export interface ParsedSnowflakeTimeTravelQuery {
  /** Original SQL query */
  originalSql: string
  /** Base query without time travel clause */
  baseQuery: string
  /** Table name from the query */
  tableName: string
  /** Schema name if qualified */
  schemaName?: string
  /** Database name if fully qualified */
  databaseName?: string
  /** Time travel clause type */
  clauseType?: TimeTravelClauseType
  /** Timestamp for AT/BEFORE TIMESTAMP clauses (epoch ms) */
  timestamp?: number
  /** Offset in seconds for AT OFFSET clause (negative values) */
  offset?: number
  /** Statement ID for BEFORE STATEMENT clause */
  statementId?: string
}

/**
 * Options for building time travel queries
 */
export interface SnowflakeTimeTravelOptions {
  /** Point-in-time timestamp (Date or ISO string or epoch ms) */
  timestamp?: Date | string | number
  /** Offset in seconds (negative, e.g., -3600 for 1 hour ago) */
  offset?: number
  /** Statement ID for BEFORE STATEMENT queries */
  statementId?: string
  /** Use BEFORE instead of AT semantics */
  beforeSemantics?: boolean
}

/**
 * Snowflake retention configuration
 */
export interface SnowflakeRetentionConfig {
  /** Data retention period in days (0-90, default 1) */
  dataRetentionDays: number
  /** Maximum retention for Enterprise edition */
  maxRetentionDays: number
  /** Whether extended retention is available */
  extendedRetentionAvailable: boolean
}

/**
 * UNDROP command target types
 */
export type UndropTargetType = 'TABLE' | 'SCHEMA' | 'DATABASE'

/**
 * UNDROP command options
 */
export interface UndropOptions {
  /** Target type to restore */
  targetType: UndropTargetType
  /** Fully qualified name of the target */
  targetName: string
}

// ============================================================================
// Query Patterns
// ============================================================================

/**
 * Pattern for AT (TIMESTAMP => 'value') clause
 * Matches: AT (TIMESTAMP => 'value') or AT(TIMESTAMP => 'value')
 */
const AT_TIMESTAMP_PATTERN = /AT\s*\(\s*TIMESTAMP\s*=>\s*'([^']+)'\s*\)/i

/**
 * Pattern for AT (OFFSET => -N) clause
 * Matches: AT (OFFSET => -3600) or AT(OFFSET => -3600)
 */
const AT_OFFSET_PATTERN = /AT\s*\(\s*OFFSET\s*=>\s*(-?\d+)\s*\)/i

/**
 * Pattern for BEFORE (TIMESTAMP => 'value') clause
 * Matches: BEFORE (TIMESTAMP => 'value') or BEFORE(TIMESTAMP => 'value')
 */
const BEFORE_TIMESTAMP_PATTERN = /BEFORE\s*\(\s*TIMESTAMP\s*=>\s*'([^']+)'\s*\)/i

/**
 * Pattern for BEFORE (STATEMENT => 'id') clause
 * Matches: BEFORE (STATEMENT => '01234567-0123-0123-0123-012345678901')
 */
const BEFORE_STATEMENT_PATTERN = /BEFORE\s*\(\s*STATEMENT\s*=>\s*'([^']+)'\s*\)/i

/**
 * Pattern to extract table name from FROM clause
 * Handles: database.schema.table, schema.table, or just table
 */
const FROM_TABLE_PATTERN =
  /FROM\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*){0,2})/i

/**
 * All time travel patterns for detection
 */
const ALL_TIME_TRAVEL_PATTERNS = [
  AT_TIMESTAMP_PATTERN,
  AT_OFFSET_PATTERN,
  BEFORE_TIMESTAMP_PATTERN,
  BEFORE_STATEMENT_PATTERN,
]

// ============================================================================
// Timestamp Parsing
// ============================================================================

/**
 * Parse various timestamp formats to milliseconds since epoch
 *
 * Supports:
 * - ISO 8601 strings (YYYY-MM-DDTHH:mm:ss.sssZ)
 * - Date-only strings (YYYY-MM-DD)
 * - Snowflake timestamp formats (YYYY-MM-DD HH:MM:SS)
 * - Unix timestamps (seconds or milliseconds)
 * - Date objects
 *
 * @param timestamp - Timestamp in various formats
 * @returns Epoch milliseconds
 * @throws Error if timestamp cannot be parsed
 */
export function parseTimestamp(timestamp: string | number | Date): number {
  // Handle Date objects
  if (timestamp instanceof Date) {
    return timestamp.getTime()
  }

  // Handle numeric values
  if (typeof timestamp === 'number') {
    // If it's a reasonable Unix timestamp in seconds (before year 3000), convert to ms
    if (timestamp > 0 && timestamp < 32503680000) {
      return timestamp * 1000
    }
    return timestamp
  }

  const trimmed = timestamp.trim()

  // Check Snowflake timestamp format FIRST (before Date.parse)
  // This ensures 'YYYY-MM-DD HH:MM:SS' is parsed as UTC, not local time
  // Handle Snowflake timestamp format: YYYY-MM-DD HH:MM:SS[.fff]
  const snowflakeMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/
  )
  if (snowflakeMatch) {
    const [, year, month, day, hours, minutes, seconds, fraction] = snowflakeMatch
    const ms = fraction
      ? parseInt(fraction.padEnd(3, '0').substring(0, 3))
      : 0
    return Date.UTC(
      parseInt(year!),
      parseInt(month!) - 1,
      parseInt(day!),
      parseInt(hours!),
      parseInt(minutes!),
      parseInt(seconds!),
      ms
    )
  }

  // Try standard Date.parse (handles ISO 8601 with timezone indicators)
  const parsed = Date.parse(trimmed)
  if (!isNaN(parsed)) {
    return parsed
  }

  // Handle date-only format (YYYY-MM-DD)
  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch
    return Date.UTC(parseInt(year!), parseInt(month!) - 1, parseInt(day!))
  }

  // Handle numeric string (Unix timestamp)
  const numericValue = parseInt(trimmed)
  if (!isNaN(numericValue)) {
    if (numericValue > 0 && numericValue < 32503680000) {
      return numericValue * 1000
    }
    return numericValue
  }

  throw new TimeTravelParseError(`Unable to parse timestamp: ${timestamp}`)
}

/**
 * Format timestamp to Snowflake format
 *
 * @param timestamp - Epoch milliseconds
 * @returns Snowflake-formatted timestamp string
 */
export function formatSnowflakeTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0')

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`
}

// ============================================================================
// Query Parsing
// ============================================================================

/**
 * Parse a Snowflake time travel SQL query
 *
 * Extracts time-travel clauses and returns the base query without them.
 *
 * @param sql - SQL query with optional time-travel clause
 * @returns Parsed query with time-travel options
 *
 * @example AT TIMESTAMP
 * ```typescript
 * const parsed = parseSnowflakeTimeTravelQuery(
 *   "SELECT * FROM events AT (TIMESTAMP => '2024-01-15 10:00:00')"
 * )
 * // parsed.tableName = 'events'
 * // parsed.clauseType = 'AT_TIMESTAMP'
 * // parsed.timestamp = 1705312800000
 * ```
 *
 * @example AT OFFSET
 * ```typescript
 * const parsed = parseSnowflakeTimeTravelQuery(
 *   "SELECT * FROM orders AT (OFFSET => -3600)"
 * )
 * // parsed.tableName = 'orders'
 * // parsed.clauseType = 'AT_OFFSET'
 * // parsed.offset = -3600
 * ```
 *
 * @example BEFORE STATEMENT
 * ```typescript
 * const parsed = parseSnowflakeTimeTravelQuery(
 *   "SELECT * FROM users BEFORE (STATEMENT => '8e5d0ca9-005e-44e6-b858-a8f5b37c5726')"
 * )
 * // parsed.tableName = 'users'
 * // parsed.clauseType = 'BEFORE_STATEMENT'
 * // parsed.statementId = '8e5d0ca9-005e-44e6-b858-a8f5b37c5726'
 * ```
 */
export function parseSnowflakeTimeTravelQuery(
  sql: string
): ParsedSnowflakeTimeTravelQuery {
  let baseQuery = sql

  // Extract table name and parse qualified names
  const tableMatch = sql.match(FROM_TABLE_PATTERN)
  if (!tableMatch || !tableMatch[1]) {
    throw new TimeTravelParseError('Unable to extract table name from query')
  }

  const fullTableName = tableMatch[1]
  const parts = fullTableName.split('.')

  let tableName: string
  let schemaName: string | undefined
  let databaseName: string | undefined

  if (parts.length === 3) {
    databaseName = parts[0]
    schemaName = parts[1]
    tableName = parts[2]!
  } else if (parts.length === 2) {
    schemaName = parts[0]
    tableName = parts[1]!
  } else {
    tableName = parts[0]!
  }

  let clauseType: TimeTravelClauseType | undefined
  let timestamp: number | undefined
  let offset: number | undefined
  let statementId: string | undefined

  // Check for AT (TIMESTAMP => 'value')
  const atTimestampMatch = sql.match(AT_TIMESTAMP_PATTERN)
  if (atTimestampMatch && atTimestampMatch[1]) {
    clauseType = 'AT_TIMESTAMP'
    timestamp = parseTimestamp(atTimestampMatch[1])
    baseQuery = baseQuery.replace(AT_TIMESTAMP_PATTERN, '')
  }

  // Check for AT (OFFSET => -N)
  const atOffsetMatch = sql.match(AT_OFFSET_PATTERN)
  if (atOffsetMatch && atOffsetMatch[1]) {
    clauseType = 'AT_OFFSET'
    offset = parseInt(atOffsetMatch[1])
    baseQuery = baseQuery.replace(AT_OFFSET_PATTERN, '')
  }

  // Check for BEFORE (TIMESTAMP => 'value')
  const beforeTimestampMatch = sql.match(BEFORE_TIMESTAMP_PATTERN)
  if (beforeTimestampMatch && beforeTimestampMatch[1]) {
    clauseType = 'BEFORE_TIMESTAMP'
    timestamp = parseTimestamp(beforeTimestampMatch[1])
    baseQuery = baseQuery.replace(BEFORE_TIMESTAMP_PATTERN, '')
  }

  // Check for BEFORE (STATEMENT => 'id')
  const beforeStatementMatch = sql.match(BEFORE_STATEMENT_PATTERN)
  if (beforeStatementMatch && beforeStatementMatch[1]) {
    clauseType = 'BEFORE_STATEMENT'
    statementId = beforeStatementMatch[1]
    baseQuery = baseQuery.replace(BEFORE_STATEMENT_PATTERN, '')
  }

  // Clean up extra whitespace
  baseQuery = baseQuery.replace(/\s+/g, ' ').trim()

  return {
    originalSql: sql,
    baseQuery,
    tableName,
    schemaName,
    databaseName,
    clauseType,
    timestamp,
    offset,
    statementId,
  }
}

/**
 * Check if a query contains Snowflake time-travel clauses
 *
 * @param sql - SQL query to check
 * @returns True if the query contains time-travel clauses
 */
export function hasSnowflakeTimeTravelClause(sql: string): boolean {
  return ALL_TIME_TRAVEL_PATTERNS.some((pattern) => pattern.test(sql))
}

// ============================================================================
// Query Building
// ============================================================================

/**
 * Build a Snowflake time travel query from base query and options
 *
 * @param baseQuery - Base SQL query without time travel clause
 * @param options - Time travel options
 * @returns SQL query with time travel clause
 *
 * @example AT TIMESTAMP with Date
 * ```typescript
 * const query = buildSnowflakeTimeTravelQuery(
 *   "SELECT * FROM events",
 *   { timestamp: new Date('2024-01-15T10:00:00Z') }
 * )
 * // "SELECT * FROM events AT (TIMESTAMP => '2024-01-15 10:00:00.000')"
 * ```
 *
 * @example AT OFFSET
 * ```typescript
 * const query = buildSnowflakeTimeTravelQuery(
 *   "SELECT * FROM orders",
 *   { offset: -3600 } // 1 hour ago
 * )
 * // "SELECT * FROM orders AT (OFFSET => -3600)"
 * ```
 *
 * @example BEFORE STATEMENT
 * ```typescript
 * const query = buildSnowflakeTimeTravelQuery(
 *   "SELECT * FROM users",
 *   { statementId: '8e5d0ca9-005e-44e6-b858-a8f5b37c5726', beforeSemantics: true }
 * )
 * // "SELECT * FROM users BEFORE (STATEMENT => '8e5d0ca9-...')"
 * ```
 */
export function buildSnowflakeTimeTravelQuery(
  baseQuery: string,
  options: SnowflakeTimeTravelOptions
): string {
  // Statement ID takes precedence (only makes sense with BEFORE)
  if (options.statementId !== undefined) {
    return baseQuery.replace(
      FROM_TABLE_PATTERN,
      `$& BEFORE (STATEMENT => '${options.statementId}')`
    )
  }

  // Offset-based time travel
  if (options.offset !== undefined) {
    const offsetValue = options.offset > 0 ? -options.offset : options.offset
    return baseQuery.replace(
      FROM_TABLE_PATTERN,
      `$& AT (OFFSET => ${offsetValue})`
    )
  }

  // Timestamp-based time travel
  if (options.timestamp !== undefined) {
    const timestampMs = parseTimestamp(options.timestamp)
    const formattedTimestamp = formatSnowflakeTimestamp(timestampMs)

    if (options.beforeSemantics) {
      return baseQuery.replace(
        FROM_TABLE_PATTERN,
        `$& BEFORE (TIMESTAMP => '${formattedTimestamp}')`
      )
    }

    return baseQuery.replace(
      FROM_TABLE_PATTERN,
      `$& AT (TIMESTAMP => '${formattedTimestamp}')`
    )
  }

  // No time travel options specified
  return baseQuery
}

/**
 * Convert offset in seconds to a human-readable duration
 *
 * @param offsetSeconds - Offset in seconds (negative)
 * @returns Human-readable duration string
 */
export function formatOffsetDuration(offsetSeconds: number): string {
  const absSeconds = Math.abs(offsetSeconds)

  if (absSeconds < 60) {
    return `${absSeconds} second${absSeconds !== 1 ? 's' : ''}`
  }

  if (absSeconds < 3600) {
    const minutes = Math.floor(absSeconds / 60)
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`
  }

  if (absSeconds < 86400) {
    const hours = Math.floor(absSeconds / 3600)
    return `${hours} hour${hours !== 1 ? 's' : ''}`
  }

  const days = Math.floor(absSeconds / 86400)
  return `${days} day${days !== 1 ? 's' : ''}`
}

// ============================================================================
// UNDROP Support
// ============================================================================

/**
 * Build an UNDROP command for restoring dropped objects
 *
 * @param options - UNDROP options specifying target type and name
 * @returns UNDROP SQL command
 *
 * @example UNDROP TABLE
 * ```typescript
 * const sql = buildUndropCommand({
 *   targetType: 'TABLE',
 *   targetName: 'my_schema.deleted_table'
 * })
 * // "UNDROP TABLE my_schema.deleted_table"
 * ```
 */
export function buildUndropCommand(options: UndropOptions): string {
  return `UNDROP ${options.targetType} ${options.targetName}`
}

/**
 * Parse an UNDROP command
 *
 * @param sql - UNDROP SQL command
 * @returns Parsed UNDROP options or null if not an UNDROP command
 */
export function parseUndropCommand(sql: string): UndropOptions | null {
  const match = sql
    .trim()
    .match(/^UNDROP\s+(TABLE|SCHEMA|DATABASE)\s+(.+)$/i)

  if (!match) {
    return null
  }

  return {
    targetType: match[1].toUpperCase() as UndropTargetType,
    targetName: match[2].trim(),
  }
}

// ============================================================================
// Retention Configuration
// ============================================================================

/**
 * Get default retention configuration based on Snowflake edition
 *
 * @param edition - Snowflake edition ('standard' | 'enterprise' | 'business_critical')
 * @returns Retention configuration
 */
export function getDefaultRetentionConfig(
  edition: 'standard' | 'enterprise' | 'business_critical' = 'standard'
): SnowflakeRetentionConfig {
  switch (edition) {
    case 'enterprise':
    case 'business_critical':
      return {
        dataRetentionDays: 1,
        maxRetentionDays: 90,
        extendedRetentionAvailable: true,
      }
    default:
      return {
        dataRetentionDays: 1,
        maxRetentionDays: 1,
        extendedRetentionAvailable: false,
      }
  }
}

/**
 * Validate retention period against configuration
 *
 * @param days - Requested retention period in days
 * @param config - Retention configuration
 * @returns True if valid, throws otherwise
 */
export function validateRetentionPeriod(
  days: number,
  config: SnowflakeRetentionConfig
): boolean {
  if (days < 0) {
    throw new TimeTravelConfigError('Retention period cannot be negative')
  }

  if (days > config.maxRetentionDays) {
    throw new TimeTravelConfigError(
      `Retention period ${days} exceeds maximum ${config.maxRetentionDays} days. ` +
        (config.extendedRetentionAvailable
          ? 'Contact Snowflake support for extended retention.'
          : 'Upgrade to Enterprise edition for up to 90 days retention.')
    )
  }

  return true
}

/**
 * Build ALTER TABLE command for setting retention period
 *
 * @param tableName - Fully qualified table name
 * @param days - Retention period in days
 * @returns ALTER TABLE SQL command
 */
export function buildSetRetentionCommand(
  tableName: string,
  days: number
): string {
  return `ALTER TABLE ${tableName} SET DATA_RETENTION_TIME_IN_DAYS = ${days}`
}

// ============================================================================
// Query Resolution for TemporalStore Integration
// ============================================================================

/**
 * Options for resolving time travel to a specific point
 */
export interface TimeTravelResolution {
  /** Resolved timestamp in epoch milliseconds */
  resolvedTimestamp: number
  /** Original clause type */
  clauseType: TimeTravelClauseType
  /** Whether this is BEFORE semantics (exclusive) vs AT (inclusive) */
  beforeSemantics: boolean
}

/**
 * Resolve time travel options to a specific timestamp
 *
 * This converts offset-based queries to absolute timestamps based on current time.
 *
 * @param parsed - Parsed time travel query
 * @param currentTime - Current time for offset calculation (default: Date.now())
 * @returns Resolved time travel information
 */
export function resolveTimeTravelTimestamp(
  parsed: ParsedSnowflakeTimeTravelQuery,
  currentTime: number = Date.now()
): TimeTravelResolution | null {
  if (!parsed.clauseType) {
    return null
  }

  switch (parsed.clauseType) {
    case 'AT_TIMESTAMP':
      return {
        resolvedTimestamp: parsed.timestamp!,
        clauseType: parsed.clauseType,
        beforeSemantics: false,
      }

    case 'AT_OFFSET':
      // Offset is in seconds, convert to milliseconds
      return {
        resolvedTimestamp: currentTime + parsed.offset! * 1000,
        clauseType: parsed.clauseType,
        beforeSemantics: false,
      }

    case 'BEFORE_TIMESTAMP':
      return {
        resolvedTimestamp: parsed.timestamp!,
        clauseType: parsed.clauseType,
        beforeSemantics: true,
      }

    case 'BEFORE_STATEMENT':
      // Statement-based time travel requires statement metadata lookup
      // Return null to indicate external resolution is needed
      return null

    default:
      return null
  }
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Error thrown when time travel query parsing fails
 */
export class TimeTravelParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeTravelParseError'
  }
}

/**
 * Error thrown for time travel configuration issues
 */
export class TimeTravelConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeTravelConfigError'
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  AT_TIMESTAMP_PATTERN,
  AT_OFFSET_PATTERN,
  BEFORE_TIMESTAMP_PATTERN,
  BEFORE_STATEMENT_PATTERN,
  FROM_TABLE_PATTERN,
}
