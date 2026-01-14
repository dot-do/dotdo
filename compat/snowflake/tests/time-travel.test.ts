/**
 * Snowflake Time Travel Tests
 *
 * Tests for Snowflake-specific time travel query parsing and generation.
 *
 * @module compat/snowflake/tests/time-travel
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseSnowflakeTimeTravelQuery,
  hasSnowflakeTimeTravelClause,
  buildSnowflakeTimeTravelQuery,
  parseTimestamp,
  formatSnowflakeTimestamp,
  formatOffsetDuration,
  buildUndropCommand,
  parseUndropCommand,
  getDefaultRetentionConfig,
  validateRetentionPeriod,
  buildSetRetentionCommand,
  resolveTimeTravelTimestamp,
  TimeTravelParseError,
  TimeTravelConfigError,
  type ParsedSnowflakeTimeTravelQuery,
  type SnowflakeTimeTravelOptions,
} from '../time-travel'

// =============================================================================
// TIMESTAMP PARSING TESTS
// =============================================================================

describe('parseTimestamp', () => {
  it('should parse ISO 8601 timestamp with Z', () => {
    const result = parseTimestamp('2024-01-15T10:30:00Z')
    expect(result).toBe(Date.UTC(2024, 0, 15, 10, 30, 0))
  })

  it('should parse ISO 8601 timestamp with milliseconds', () => {
    const result = parseTimestamp('2024-01-15T10:30:00.123Z')
    expect(result).toBe(Date.UTC(2024, 0, 15, 10, 30, 0, 123))
  })

  it('should parse Snowflake timestamp format', () => {
    const result = parseTimestamp('2024-01-15 10:30:00')
    expect(result).toBe(Date.UTC(2024, 0, 15, 10, 30, 0))
  })

  it('should parse Snowflake timestamp with milliseconds', () => {
    const result = parseTimestamp('2024-01-15 10:30:00.123')
    expect(result).toBe(Date.UTC(2024, 0, 15, 10, 30, 0, 123))
  })

  it('should parse Snowflake timestamp with nanoseconds (truncates to ms)', () => {
    const result = parseTimestamp('2024-01-15 10:30:00.123456789')
    expect(result).toBe(Date.UTC(2024, 0, 15, 10, 30, 0, 123))
  })

  it('should parse date-only format', () => {
    const result = parseTimestamp('2024-01-15')
    expect(result).toBe(Date.UTC(2024, 0, 15))
  })

  it('should parse Unix timestamp in seconds', () => {
    const unixSeconds = 1705312800 // 2024-01-15T10:00:00Z
    const result = parseTimestamp(unixSeconds)
    expect(result).toBe(unixSeconds * 1000)
  })

  it('should parse Unix timestamp in milliseconds', () => {
    const unixMs = 1705312800000 // 2024-01-15T10:00:00Z
    const result = parseTimestamp(unixMs)
    expect(result).toBe(unixMs)
  })

  it('should handle Date objects', () => {
    const date = new Date('2024-01-15T10:00:00Z')
    const result = parseTimestamp(date)
    expect(result).toBe(date.getTime())
  })

  it('should handle numeric string (Unix seconds)', () => {
    const result = parseTimestamp('1705312800')
    expect(result).toBe(1705312800000)
  })

  it('should throw for invalid timestamp', () => {
    expect(() => parseTimestamp('invalid-timestamp')).toThrow(TimeTravelParseError)
  })

  it('should handle whitespace around timestamp', () => {
    const result = parseTimestamp('  2024-01-15  ')
    expect(result).toBe(Date.UTC(2024, 0, 15))
  })
})

describe('formatSnowflakeTimestamp', () => {
  it('should format timestamp to Snowflake format', () => {
    const timestamp = Date.UTC(2024, 0, 15, 10, 30, 45, 123)
    const result = formatSnowflakeTimestamp(timestamp)
    expect(result).toBe('2024-01-15 10:30:45.123')
  })

  it('should pad single-digit values', () => {
    const timestamp = Date.UTC(2024, 0, 5, 8, 3, 2, 9)
    const result = formatSnowflakeTimestamp(timestamp)
    expect(result).toBe('2024-01-05 08:03:02.009')
  })

  it('should handle zero milliseconds', () => {
    const timestamp = Date.UTC(2024, 0, 15, 10, 30, 45, 0)
    const result = formatSnowflakeTimestamp(timestamp)
    expect(result).toBe('2024-01-15 10:30:45.000')
  })
})

// =============================================================================
// QUERY PARSING TESTS
// =============================================================================

describe('parseSnowflakeTimeTravelQuery', () => {
  describe('AT TIMESTAMP', () => {
    it('should parse AT TIMESTAMP clause', () => {
      const sql = "SELECT * FROM events AT (TIMESTAMP => '2024-01-15 10:00:00')"
      const result = parseSnowflakeTimeTravelQuery(sql)

      expect(result.tableName).toBe('events')
      expect(result.clauseType).toBe('AT_TIMESTAMP')
      expect(result.timestamp).toBe(Date.UTC(2024, 0, 15, 10, 0, 0))
      expect(result.baseQuery).toBe('SELECT * FROM events')
    })

    it('should handle ISO timestamp in AT clause', () => {
      const sql = "SELECT * FROM events AT (TIMESTAMP => '2024-01-15T10:00:00Z')"
      const result = parseSnowflakeTimeTravelQuery(sql)

      expect(result.clauseType).toBe('AT_TIMESTAMP')
      expect(result.timestamp).toBe(Date.UTC(2024, 0, 15, 10, 0, 0))
    })

    it('should handle AT clause without spaces around =>', () => {
      const sql = "SELECT * FROM events AT(TIMESTAMP=>'2024-01-15 10:00:00')"
      const result = parseSnowflakeTimeTravelQuery(sql)

      expect(result.clauseType).toBe('AT_TIMESTAMP')
    })
  })

  describe('AT OFFSET', () => {
    it('should parse AT OFFSET clause with negative value', () => {
      const sql = 'SELECT * FROM orders AT (OFFSET => -3600)'
      const result = parseSnowflakeTimeTravelQuery(sql)

      expect(result.tableName).toBe('orders')
      expect(result.clauseType).toBe('AT_OFFSET')
      expect(result.offset).toBe(-3600)
      expect(result.baseQuery).toBe('SELECT * FROM orders')
    })

    it('should handle positive offset value (treated as seconds)', () => {
      const sql = 'SELECT * FROM orders AT (OFFSET => 3600)'
      const result = parseSnowflakeTimeTravelQuery(sql)

      expect(result.clauseType).toBe('AT_OFFSET')
      expect(result.offset).toBe(3600)
    })

    it('should handle large offset values', () => {
      const sql = 'SELECT * FROM orders AT (OFFSET => -259200)' // 3 days
      const result = parseSnowflakeTimeTravelQuery(sql)

      expect(result.offset).toBe(-259200)
    })
  })

  describe('BEFORE TIMESTAMP', () => {
    it('should parse BEFORE TIMESTAMP clause', () => {
      const sql = "SELECT * FROM users BEFORE (TIMESTAMP => '2024-01-15 10:00:00')"
      const result = parseSnowflakeTimeTravelQuery(sql)

      expect(result.tableName).toBe('users')
      expect(result.clauseType).toBe('BEFORE_TIMESTAMP')
      expect(result.timestamp).toBe(Date.UTC(2024, 0, 15, 10, 0, 0))
      expect(result.baseQuery).toBe('SELECT * FROM users')
    })
  })

  describe('BEFORE STATEMENT', () => {
    it('should parse BEFORE STATEMENT clause', () => {
      const statementId = '8e5d0ca9-005e-44e6-b858-a8f5b37c5726'
      const sql = `SELECT * FROM accounts BEFORE (STATEMENT => '${statementId}')`
      const result = parseSnowflakeTimeTravelQuery(sql)

      expect(result.tableName).toBe('accounts')
      expect(result.clauseType).toBe('BEFORE_STATEMENT')
      expect(result.statementId).toBe(statementId)
      expect(result.baseQuery).toBe('SELECT * FROM accounts')
    })
  })

  describe('Qualified table names', () => {
    it('should parse fully qualified table name (database.schema.table)', () => {
      const sql =
        "SELECT * FROM mydb.myschema.events AT (TIMESTAMP => '2024-01-15 10:00:00')"
      const result = parseSnowflakeTimeTravelQuery(sql)

      expect(result.databaseName).toBe('mydb')
      expect(result.schemaName).toBe('myschema')
      expect(result.tableName).toBe('events')
    })

    it('should parse schema-qualified table name (schema.table)', () => {
      const sql = "SELECT * FROM public.events AT (TIMESTAMP => '2024-01-15 10:00:00')"
      const result = parseSnowflakeTimeTravelQuery(sql)

      expect(result.databaseName).toBeUndefined()
      expect(result.schemaName).toBe('public')
      expect(result.tableName).toBe('events')
    })

    it('should parse unqualified table name', () => {
      const sql = "SELECT * FROM events AT (TIMESTAMP => '2024-01-15 10:00:00')"
      const result = parseSnowflakeTimeTravelQuery(sql)

      expect(result.databaseName).toBeUndefined()
      expect(result.schemaName).toBeUndefined()
      expect(result.tableName).toBe('events')
    })
  })

  describe('No time travel clause', () => {
    it('should parse query without time travel clause', () => {
      const sql = 'SELECT * FROM events WHERE status = 1'
      const result = parseSnowflakeTimeTravelQuery(sql)

      expect(result.tableName).toBe('events')
      expect(result.clauseType).toBeUndefined()
      expect(result.timestamp).toBeUndefined()
      expect(result.offset).toBeUndefined()
      expect(result.statementId).toBeUndefined()
      expect(result.baseQuery).toBe('SELECT * FROM events WHERE status = 1')
    })
  })

  describe('Error handling', () => {
    it('should throw for query without FROM clause', () => {
      const sql = 'SELECT 1'
      expect(() => parseSnowflakeTimeTravelQuery(sql)).toThrow(TimeTravelParseError)
    })
  })
})

describe('hasSnowflakeTimeTravelClause', () => {
  it('should return true for AT TIMESTAMP', () => {
    const sql = "SELECT * FROM events AT (TIMESTAMP => '2024-01-15 10:00:00')"
    expect(hasSnowflakeTimeTravelClause(sql)).toBe(true)
  })

  it('should return true for AT OFFSET', () => {
    const sql = 'SELECT * FROM events AT (OFFSET => -3600)'
    expect(hasSnowflakeTimeTravelClause(sql)).toBe(true)
  })

  it('should return true for BEFORE TIMESTAMP', () => {
    const sql = "SELECT * FROM events BEFORE (TIMESTAMP => '2024-01-15 10:00:00')"
    expect(hasSnowflakeTimeTravelClause(sql)).toBe(true)
  })

  it('should return true for BEFORE STATEMENT', () => {
    const sql = "SELECT * FROM events BEFORE (STATEMENT => 'abc-123')"
    expect(hasSnowflakeTimeTravelClause(sql)).toBe(true)
  })

  it('should return false for regular query', () => {
    const sql = 'SELECT * FROM events WHERE id = 1'
    expect(hasSnowflakeTimeTravelClause(sql)).toBe(false)
  })
})

// =============================================================================
// QUERY BUILDING TESTS
// =============================================================================

describe('buildSnowflakeTimeTravelQuery', () => {
  describe('AT TIMESTAMP', () => {
    it('should build query with timestamp Date object', () => {
      const baseQuery = 'SELECT * FROM events'
      const timestamp = new Date('2024-01-15T10:30:45.123Z')
      const result = buildSnowflakeTimeTravelQuery(baseQuery, { timestamp })

      expect(result).toBe(
        "SELECT * FROM events AT (TIMESTAMP => '2024-01-15 10:30:45.123')"
      )
    })

    it('should build query with timestamp string', () => {
      const baseQuery = 'SELECT * FROM events'
      const result = buildSnowflakeTimeTravelQuery(baseQuery, {
        timestamp: '2024-01-15 10:00:00',
      })

      expect(result).toContain("AT (TIMESTAMP => '")
    })

    it('should build query with timestamp number', () => {
      const baseQuery = 'SELECT * FROM events'
      const result = buildSnowflakeTimeTravelQuery(baseQuery, {
        timestamp: 1705312800000, // 2024-01-15T10:00:00Z
      })

      expect(result).toContain("AT (TIMESTAMP => '2024-01-15 10:00:00")
    })
  })

  describe('AT OFFSET', () => {
    it('should build query with negative offset', () => {
      const baseQuery = 'SELECT * FROM orders'
      const result = buildSnowflakeTimeTravelQuery(baseQuery, { offset: -3600 })

      expect(result).toBe('SELECT * FROM orders AT (OFFSET => -3600)')
    })

    it('should convert positive offset to negative', () => {
      const baseQuery = 'SELECT * FROM orders'
      const result = buildSnowflakeTimeTravelQuery(baseQuery, { offset: 3600 })

      expect(result).toBe('SELECT * FROM orders AT (OFFSET => -3600)')
    })
  })

  describe('BEFORE TIMESTAMP', () => {
    it('should build BEFORE query with beforeSemantics option', () => {
      const baseQuery = 'SELECT * FROM events'
      const result = buildSnowflakeTimeTravelQuery(baseQuery, {
        timestamp: new Date('2024-01-15T10:30:45Z'),
        beforeSemantics: true,
      })

      expect(result).toContain("BEFORE (TIMESTAMP => '")
    })
  })

  describe('BEFORE STATEMENT', () => {
    it('should build query with statement ID', () => {
      const baseQuery = 'SELECT * FROM accounts'
      const statementId = '8e5d0ca9-005e-44e6-b858-a8f5b37c5726'
      const result = buildSnowflakeTimeTravelQuery(baseQuery, { statementId })

      expect(result).toBe(
        `SELECT * FROM accounts BEFORE (STATEMENT => '${statementId}')`
      )
    })

    it('should prefer statement ID over other options', () => {
      const baseQuery = 'SELECT * FROM accounts'
      const statementId = 'abc-123'
      const result = buildSnowflakeTimeTravelQuery(baseQuery, {
        statementId,
        timestamp: new Date(),
        offset: -3600,
      })

      expect(result).toContain('BEFORE (STATEMENT')
      expect(result).not.toContain('AT (')
    })
  })

  describe('No options', () => {
    it('should return base query unchanged when no options provided', () => {
      const baseQuery = 'SELECT * FROM events'
      const result = buildSnowflakeTimeTravelQuery(baseQuery, {})

      expect(result).toBe(baseQuery)
    })
  })

  describe('Complex queries', () => {
    it('should handle qualified table names', () => {
      const baseQuery = 'SELECT * FROM mydb.myschema.events WHERE status = 1'
      const result = buildSnowflakeTimeTravelQuery(baseQuery, { offset: -3600 })

      expect(result).toBe(
        'SELECT * FROM mydb.myschema.events AT (OFFSET => -3600) WHERE status = 1'
      )
    })

    it('should handle queries with multiple columns', () => {
      const baseQuery = 'SELECT id, name, created_at FROM users ORDER BY created_at'
      const result = buildSnowflakeTimeTravelQuery(baseQuery, { offset: -7200 })

      expect(result).toContain('AT (OFFSET => -7200)')
    })
  })
})

// =============================================================================
// FORMAT OFFSET DURATION TESTS
// =============================================================================

describe('formatOffsetDuration', () => {
  it('should format seconds', () => {
    expect(formatOffsetDuration(-30)).toBe('30 seconds')
    expect(formatOffsetDuration(-1)).toBe('1 second')
  })

  it('should format minutes', () => {
    expect(formatOffsetDuration(-120)).toBe('2 minutes')
    expect(formatOffsetDuration(-60)).toBe('1 minute')
  })

  it('should format hours', () => {
    expect(formatOffsetDuration(-3600)).toBe('1 hour')
    expect(formatOffsetDuration(-7200)).toBe('2 hours')
  })

  it('should format days', () => {
    expect(formatOffsetDuration(-86400)).toBe('1 day')
    expect(formatOffsetDuration(-259200)).toBe('3 days')
  })
})

// =============================================================================
// UNDROP TESTS
// =============================================================================

describe('buildUndropCommand', () => {
  it('should build UNDROP TABLE command', () => {
    const result = buildUndropCommand({
      targetType: 'TABLE',
      targetName: 'my_table',
    })
    expect(result).toBe('UNDROP TABLE my_table')
  })

  it('should build UNDROP SCHEMA command', () => {
    const result = buildUndropCommand({
      targetType: 'SCHEMA',
      targetName: 'my_schema',
    })
    expect(result).toBe('UNDROP SCHEMA my_schema')
  })

  it('should build UNDROP DATABASE command', () => {
    const result = buildUndropCommand({
      targetType: 'DATABASE',
      targetName: 'my_database',
    })
    expect(result).toBe('UNDROP DATABASE my_database')
  })

  it('should handle qualified names', () => {
    const result = buildUndropCommand({
      targetType: 'TABLE',
      targetName: 'mydb.myschema.my_table',
    })
    expect(result).toBe('UNDROP TABLE mydb.myschema.my_table')
  })
})

describe('parseUndropCommand', () => {
  it('should parse UNDROP TABLE command', () => {
    const result = parseUndropCommand('UNDROP TABLE my_table')
    expect(result).toEqual({
      targetType: 'TABLE',
      targetName: 'my_table',
    })
  })

  it('should parse UNDROP SCHEMA command', () => {
    const result = parseUndropCommand('UNDROP SCHEMA my_schema')
    expect(result).toEqual({
      targetType: 'SCHEMA',
      targetName: 'my_schema',
    })
  })

  it('should parse UNDROP DATABASE command', () => {
    const result = parseUndropCommand('undrop database my_database')
    expect(result).toEqual({
      targetType: 'DATABASE',
      targetName: 'my_database',
    })
  })

  it('should return null for non-UNDROP commands', () => {
    expect(parseUndropCommand('SELECT * FROM table')).toBeNull()
    expect(parseUndropCommand('DROP TABLE my_table')).toBeNull()
  })

  it('should handle whitespace', () => {
    const result = parseUndropCommand('  UNDROP   TABLE   my_table  ')
    expect(result).toEqual({
      targetType: 'TABLE',
      targetName: 'my_table',
    })
  })
})

// =============================================================================
// RETENTION CONFIGURATION TESTS
// =============================================================================

describe('getDefaultRetentionConfig', () => {
  it('should return standard edition defaults', () => {
    const config = getDefaultRetentionConfig('standard')
    expect(config).toEqual({
      dataRetentionDays: 1,
      maxRetentionDays: 1,
      extendedRetentionAvailable: false,
    })
  })

  it('should return enterprise edition defaults', () => {
    const config = getDefaultRetentionConfig('enterprise')
    expect(config).toEqual({
      dataRetentionDays: 1,
      maxRetentionDays: 90,
      extendedRetentionAvailable: true,
    })
  })

  it('should return business_critical edition defaults', () => {
    const config = getDefaultRetentionConfig('business_critical')
    expect(config).toEqual({
      dataRetentionDays: 1,
      maxRetentionDays: 90,
      extendedRetentionAvailable: true,
    })
  })

  it('should default to standard edition', () => {
    const config = getDefaultRetentionConfig()
    expect(config.maxRetentionDays).toBe(1)
  })
})

describe('validateRetentionPeriod', () => {
  it('should accept valid retention for standard edition', () => {
    const config = getDefaultRetentionConfig('standard')
    expect(validateRetentionPeriod(1, config)).toBe(true)
    expect(validateRetentionPeriod(0, config)).toBe(true)
  })

  it('should accept valid retention for enterprise edition', () => {
    const config = getDefaultRetentionConfig('enterprise')
    expect(validateRetentionPeriod(90, config)).toBe(true)
    expect(validateRetentionPeriod(30, config)).toBe(true)
    expect(validateRetentionPeriod(1, config)).toBe(true)
  })

  it('should throw for negative retention', () => {
    const config = getDefaultRetentionConfig('enterprise')
    expect(() => validateRetentionPeriod(-1, config)).toThrow(TimeTravelConfigError)
  })

  it('should throw for retention exceeding max (standard)', () => {
    const config = getDefaultRetentionConfig('standard')
    expect(() => validateRetentionPeriod(2, config)).toThrow(TimeTravelConfigError)
    expect(() => validateRetentionPeriod(2, config)).toThrow(/Upgrade to Enterprise/)
  })

  it('should throw for retention exceeding max (enterprise)', () => {
    const config = getDefaultRetentionConfig('enterprise')
    expect(() => validateRetentionPeriod(91, config)).toThrow(TimeTravelConfigError)
    expect(() => validateRetentionPeriod(91, config)).toThrow(
      /Contact Snowflake support/
    )
  })
})

describe('buildSetRetentionCommand', () => {
  it('should build ALTER TABLE command', () => {
    const result = buildSetRetentionCommand('my_table', 7)
    expect(result).toBe('ALTER TABLE my_table SET DATA_RETENTION_TIME_IN_DAYS = 7')
  })

  it('should handle qualified table names', () => {
    const result = buildSetRetentionCommand('mydb.myschema.my_table', 30)
    expect(result).toBe(
      'ALTER TABLE mydb.myschema.my_table SET DATA_RETENTION_TIME_IN_DAYS = 30'
    )
  })

  it('should handle zero retention', () => {
    const result = buildSetRetentionCommand('my_table', 0)
    expect(result).toBe('ALTER TABLE my_table SET DATA_RETENTION_TIME_IN_DAYS = 0')
  })
})

// =============================================================================
// TIME TRAVEL RESOLUTION TESTS
// =============================================================================

describe('resolveTimeTravelTimestamp', () => {
  const fixedTime = Date.UTC(2024, 0, 15, 12, 0, 0) // 2024-01-15 12:00:00 UTC

  it('should resolve AT_TIMESTAMP directly', () => {
    const parsed: ParsedSnowflakeTimeTravelQuery = {
      originalSql: '',
      baseQuery: 'SELECT * FROM events',
      tableName: 'events',
      clauseType: 'AT_TIMESTAMP',
      timestamp: Date.UTC(2024, 0, 15, 10, 0, 0),
    }

    const result = resolveTimeTravelTimestamp(parsed, fixedTime)

    expect(result).toEqual({
      resolvedTimestamp: Date.UTC(2024, 0, 15, 10, 0, 0),
      clauseType: 'AT_TIMESTAMP',
      beforeSemantics: false,
    })
  })

  it('should resolve AT_OFFSET relative to current time', () => {
    const parsed: ParsedSnowflakeTimeTravelQuery = {
      originalSql: '',
      baseQuery: 'SELECT * FROM events',
      tableName: 'events',
      clauseType: 'AT_OFFSET',
      offset: -3600, // 1 hour ago
    }

    const result = resolveTimeTravelTimestamp(parsed, fixedTime)

    expect(result).toEqual({
      resolvedTimestamp: fixedTime - 3600 * 1000, // 11:00:00 UTC
      clauseType: 'AT_OFFSET',
      beforeSemantics: false,
    })
  })

  it('should resolve BEFORE_TIMESTAMP with beforeSemantics=true', () => {
    const parsed: ParsedSnowflakeTimeTravelQuery = {
      originalSql: '',
      baseQuery: 'SELECT * FROM events',
      tableName: 'events',
      clauseType: 'BEFORE_TIMESTAMP',
      timestamp: Date.UTC(2024, 0, 15, 10, 0, 0),
    }

    const result = resolveTimeTravelTimestamp(parsed, fixedTime)

    expect(result).toEqual({
      resolvedTimestamp: Date.UTC(2024, 0, 15, 10, 0, 0),
      clauseType: 'BEFORE_TIMESTAMP',
      beforeSemantics: true,
    })
  })

  it('should return null for BEFORE_STATEMENT (requires external lookup)', () => {
    const parsed: ParsedSnowflakeTimeTravelQuery = {
      originalSql: '',
      baseQuery: 'SELECT * FROM events',
      tableName: 'events',
      clauseType: 'BEFORE_STATEMENT',
      statementId: 'abc-123',
    }

    const result = resolveTimeTravelTimestamp(parsed, fixedTime)

    expect(result).toBeNull()
  })

  it('should return null when no time travel clause', () => {
    const parsed: ParsedSnowflakeTimeTravelQuery = {
      originalSql: '',
      baseQuery: 'SELECT * FROM events',
      tableName: 'events',
    }

    const result = resolveTimeTravelTimestamp(parsed, fixedTime)

    expect(result).toBeNull()
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('Integration: Parse and Rebuild', () => {
  it('should parse and rebuild AT TIMESTAMP query', () => {
    const original = "SELECT * FROM events AT (TIMESTAMP => '2024-01-15 10:00:00.000')"
    const parsed = parseSnowflakeTimeTravelQuery(original)
    const rebuilt = buildSnowflakeTimeTravelQuery(parsed.baseQuery, {
      timestamp: parsed.timestamp,
    })

    // The rebuilt query should be functionally equivalent
    expect(rebuilt).toContain('AT (TIMESTAMP')
    expect(rebuilt).toContain('2024-01-15')
  })

  it('should parse and rebuild AT OFFSET query', () => {
    const original = 'SELECT * FROM orders AT (OFFSET => -3600)'
    const parsed = parseSnowflakeTimeTravelQuery(original)
    const rebuilt = buildSnowflakeTimeTravelQuery(parsed.baseQuery, {
      offset: parsed.offset,
    })

    expect(rebuilt).toBe(original)
  })

  it('should parse and rebuild BEFORE STATEMENT query', () => {
    const statementId = '8e5d0ca9-005e-44e6-b858-a8f5b37c5726'
    const original = `SELECT * FROM accounts BEFORE (STATEMENT => '${statementId}')`
    const parsed = parseSnowflakeTimeTravelQuery(original)
    const rebuilt = buildSnowflakeTimeTravelQuery(parsed.baseQuery, {
      statementId: parsed.statementId,
    })

    expect(rebuilt).toBe(original)
  })
})

describe('Integration: Complex Queries', () => {
  it('should handle JOIN queries', () => {
    const sql = `
      SELECT o.*, c.name
      FROM orders o
      AT (OFFSET => -3600)
      JOIN customers c ON o.customer_id = c.id
    `.trim()

    const parsed = parseSnowflakeTimeTravelQuery(sql)
    // Table name is 'orders', alias 'o' is not captured separately
    expect(parsed.tableName).toBe('orders')
    expect(parsed.clauseType).toBe('AT_OFFSET')
  })

  it('should handle subqueries', () => {
    const sql = `
      SELECT * FROM events
      AT (TIMESTAMP => '2024-01-15 10:00:00')
      WHERE user_id IN (SELECT id FROM users WHERE active = true)
    `.trim()

    const parsed = parseSnowflakeTimeTravelQuery(sql)
    expect(parsed.clauseType).toBe('AT_TIMESTAMP')
    expect(parsed.baseQuery).toContain('WHERE user_id IN')
  })

  it('should handle UNION queries', () => {
    const sql = `
      SELECT * FROM events_2024 AT (OFFSET => -86400)
      UNION ALL
      SELECT * FROM events_2023
    `.trim()

    const parsed = parseSnowflakeTimeTravelQuery(sql)
    expect(parsed.clauseType).toBe('AT_OFFSET')
  })
})
