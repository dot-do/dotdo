/**
 * Time-Travel Query Support for Iceberg
 *
 * Parses and handles time-travel SQL queries:
 * - AS OF TIMESTAMP
 * - AS OF VERSION
 * - BEFORE TIMESTAMP
 *
 * @module db/compat/sql/duckdb-wasm/iceberg/deep/time-travel
 */

import type { ParsedTimeTravelQuery } from './types'

// ============================================================================
// Time-Travel Query Patterns
// ============================================================================

/**
 * Pattern for AS OF TIMESTAMP clause
 * Matches: FOR SYSTEM_TIME AS OF TIMESTAMP 'value'
 */
const AS_OF_TIMESTAMP_PATTERN = /FOR\s+SYSTEM_TIME\s+AS\s+OF\s+TIMESTAMP\s+'([^']+)'/i

/**
 * Pattern for AS OF VERSION clause
 * Matches: FOR SYSTEM_VERSION AS OF number
 */
const AS_OF_VERSION_PATTERN = /FOR\s+SYSTEM_VERSION\s+AS\s+OF\s+(\d+)/i

/**
 * Pattern for BEFORE TIMESTAMP clause
 * Matches: FOR SYSTEM_TIME BEFORE TIMESTAMP 'value'
 */
const BEFORE_TIMESTAMP_PATTERN = /FOR\s+SYSTEM_TIME\s+BEFORE\s+TIMESTAMP\s+'([^']+)'/i

/**
 * Pattern to extract table name from FROM clause
 */
const FROM_TABLE_PATTERN = /FROM\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/i

// ============================================================================
// Timestamp Parsing
// ============================================================================

/**
 * Parse various timestamp formats to milliseconds since epoch
 */
function parseTimestamp(timestamp: string): number {
  // Try ISO 8601 formats
  // YYYY-MM-DD
  // YYYY-MM-DDTHH:MM:SS
  // YYYY-MM-DDTHH:MM:SS.sss
  // YYYY-MM-DDTHH:MM:SSZ
  // YYYY-MM-DDTHH:MM:SS.sssZ
  // YYYY-MM-DDTHH:MM:SS+HH:MM

  const trimmed = timestamp.trim()

  // Try Date.parse first (handles ISO 8601)
  const parsed = Date.parse(trimmed)
  if (!isNaN(parsed)) {
    return parsed
  }

  // Handle date-only format (YYYY-MM-DD)
  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnlyMatch && dateOnlyMatch[1] && dateOnlyMatch[2] && dateOnlyMatch[3]) {
    return Date.UTC(parseInt(dateOnlyMatch[1]), parseInt(dateOnlyMatch[2]) - 1, parseInt(dateOnlyMatch[3]))
  }

  // Handle Unix timestamp (seconds or milliseconds)
  const numericValue = parseInt(trimmed)
  if (!isNaN(numericValue)) {
    // If it's a reasonable Unix timestamp (before year 3000), treat as seconds
    if (numericValue < 32503680000) {
      return numericValue * 1000
    }
    // Otherwise treat as milliseconds
    return numericValue
  }

  throw new Error(`Unable to parse timestamp: ${timestamp}`)
}

// ============================================================================
// Query Parser
// ============================================================================

/**
 * Parse a time-travel SQL query
 *
 * Extracts time-travel clauses and returns the base query without them.
 *
 * @param sql - SQL query with optional time-travel clause
 * @returns Parsed query with time-travel options
 *
 * @example
 * ```typescript
 * const parsed = parseTimeTravelQuery(
 *   "SELECT * FROM events FOR SYSTEM_TIME AS OF TIMESTAMP '2024-01-15T10:00:00Z'"
 * )
 * // parsed.tableName = 'events'
 * // parsed.asOfTimestamp = 1705312800000
 * // parsed.baseQuery = 'SELECT * FROM events'
 * ```
 */
export function parseTimeTravelQuery(sql: string): ParsedTimeTravelQuery {
  let baseQuery = sql
  let asOfTimestamp: number | undefined
  let beforeTimestamp: number | undefined
  let snapshotId: number | undefined

  // Extract table name
  const tableMatch = sql.match(FROM_TABLE_PATTERN)
  if (!tableMatch || !tableMatch[1]) {
    throw new Error('Unable to extract table name from query')
  }
  const tableName = tableMatch[1].split('.').pop()!

  // Check for AS OF TIMESTAMP
  const asOfTimestampMatch = sql.match(AS_OF_TIMESTAMP_PATTERN)
  if (asOfTimestampMatch && asOfTimestampMatch[1]) {
    asOfTimestamp = parseTimestamp(asOfTimestampMatch[1])
    baseQuery = baseQuery.replace(AS_OF_TIMESTAMP_PATTERN, '')
  }

  // Check for AS OF VERSION
  const asOfVersionMatch = sql.match(AS_OF_VERSION_PATTERN)
  if (asOfVersionMatch && asOfVersionMatch[1]) {
    snapshotId = parseInt(asOfVersionMatch[1])
    baseQuery = baseQuery.replace(AS_OF_VERSION_PATTERN, '')
  }

  // Check for BEFORE TIMESTAMP
  const beforeTimestampMatch = sql.match(BEFORE_TIMESTAMP_PATTERN)
  if (beforeTimestampMatch && beforeTimestampMatch[1]) {
    beforeTimestamp = parseTimestamp(beforeTimestampMatch[1])
    baseQuery = baseQuery.replace(BEFORE_TIMESTAMP_PATTERN, '')
  }

  // Clean up extra whitespace
  baseQuery = baseQuery.replace(/\s+/g, ' ').trim()

  return {
    tableName,
    baseQuery,
    asOfTimestamp,
    beforeTimestamp,
    snapshotId,
  }
}

/**
 * Check if a query contains time-travel clauses
 */
export function hasTimeTravelClause(sql: string): boolean {
  return (
    AS_OF_TIMESTAMP_PATTERN.test(sql) ||
    AS_OF_VERSION_PATTERN.test(sql) ||
    BEFORE_TIMESTAMP_PATTERN.test(sql)
  )
}

/**
 * Build time-travel query from base query and options
 */
export function buildTimeTravelQuery(
  baseQuery: string,
  options: {
    asOfTimestamp?: number
    snapshotId?: number
    beforeTimestamp?: number
  }
): string {
  if (options.snapshotId !== undefined) {
    // Insert FOR SYSTEM_VERSION AS OF after table name
    return baseQuery.replace(
      FROM_TABLE_PATTERN,
      `$& FOR SYSTEM_VERSION AS OF ${options.snapshotId}`
    )
  }

  if (options.asOfTimestamp !== undefined) {
    const isoTimestamp = new Date(options.asOfTimestamp).toISOString()
    return baseQuery.replace(
      FROM_TABLE_PATTERN,
      `$& FOR SYSTEM_TIME AS OF TIMESTAMP '${isoTimestamp}'`
    )
  }

  if (options.beforeTimestamp !== undefined) {
    const isoTimestamp = new Date(options.beforeTimestamp).toISOString()
    return baseQuery.replace(
      FROM_TABLE_PATTERN,
      `$& FOR SYSTEM_TIME BEFORE TIMESTAMP '${isoTimestamp}'`
    )
  }

  return baseQuery
}
