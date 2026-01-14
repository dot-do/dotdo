/**
 * Unified Events Pipeline SQL Transform Tests
 *
 * Tests for the Cloudflare Pipeline SQL transform that converts incoming
 * unified events to R2 Iceberg format with proper partitioning.
 *
 * Test categories:
 * 1. Column mapping (all 162 columns)
 * 2. Namespace qualification for resource_id
 * 3. Partition column derivation (day, hour, event_source)
 * 4. Null column handling
 * 5. JSON column preservation
 * 6. Timestamp conversion
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { UNIFIED_COLUMNS, type ColumnDefinition } from '../../../types/unified-event'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Parse SQL SELECT columns from an INSERT...SELECT statement
 */
function parseSelectColumns(sql: string): string[] {
  // Remove comments
  const noComments = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

  // Find SELECT ... FROM table_name (look for FROM followed by identifier at end)
  // Use greedy match to get everything between SELECT and final FROM
  const selectMatch = noComments.match(/SELECT\s+([\s\S]+)\s+FROM\s+\w+\s*$/i)
  if (!selectMatch) return []

  const selectClause = selectMatch[1]

  // Parse columns - handle CASE expressions, functions, and aliases
  const columns: string[] = []
  let depth = 0
  let current = ''
  let inString = false
  let stringChar = ''

  for (let i = 0; i < selectClause.length; i++) {
    const char = selectClause[i]
    const prevChar = i > 0 ? selectClause[i - 1] : ''

    // Track string literals
    if ((char === "'" || char === '"') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      } else if (char === stringChar) {
        inString = false
      }
    }

    if (!inString) {
      if (char === '(') depth++
      if (char === ')') depth--

      // Split on comma only at top level
      if (char === ',' && depth === 0) {
        const col = current.trim()
        if (col) columns.push(col)
        current = ''
        continue
      }
    }

    current += char
  }

  // Add last column
  const lastCol = current.trim()
  if (lastCol) columns.push(lastCol)

  return columns
}

/**
 * Extract output column name from a SELECT column expression
 * Handles: column, expr AS alias, CASE...END AS alias, etc.
 */
function extractOutputColumnName(expr: string): string {
  const trimmed = expr.trim()

  // Check for AS alias (case insensitive)
  const asMatch = trimmed.match(/\s+AS\s+["'`]?(\w+)["'`]?\s*$/i)
  if (asMatch) return asMatch[1]

  // Simple column reference
  if (/^[\w_]+$/.test(trimmed)) return trimmed

  // Function call without alias returns function name (e.g., CURRENT_TIMESTAMP())
  const funcMatch = trimmed.match(/^(\w+)\s*\(/)
  if (funcMatch && !trimmed.includes(' AS ')) {
    // Check if it's wrapped - e.g., COALESCE(x, y) without AS
    return funcMatch[1].toLowerCase()
  }

  return trimmed
}

/**
 * Check if SQL contains a transformation for a given column
 */
function hasColumnTransform(sql: string, columnName: string): boolean {
  const columns = parseSelectColumns(sql)
  return columns.some(col => {
    const name = extractOutputColumnName(col)
    return name.toLowerCase() === columnName.toLowerCase()
  })
}

/**
 * Get the transform expression for a column
 */
function getColumnTransform(sql: string, columnName: string): string | null {
  const columns = parseSelectColumns(sql)
  for (const col of columns) {
    const name = extractOutputColumnName(col)
    if (name.toLowerCase() === columnName.toLowerCase()) {
      return col.trim()
    }
  }
  return null
}

// ============================================================================
// Load SQL file
// ============================================================================

let unifiedSql: string

beforeAll(() => {
  const sqlPath = resolve(__dirname, '../unified_events.sql')
  unifiedSql = readFileSync(sqlPath, 'utf-8')
})

// ============================================================================
// Test Suite
// ============================================================================

describe('Unified Events Pipeline SQL Transform', () => {
  // --------------------------------------------------------------------------
  // 1. Column Mapping Tests
  // --------------------------------------------------------------------------
  describe('Column Mapping', () => {
    it('should map all 172 columns from UNIFIED_COLUMNS', () => {
      expect(UNIFIED_COLUMNS).toHaveLength(172)

      const selectColumns = parseSelectColumns(unifiedSql)
      expect(selectColumns.length).toBeGreaterThanOrEqual(172)

      // Verify each column from schema is present in output
      const outputNames = selectColumns.map(col => extractOutputColumnName(col).toLowerCase())

      for (const colDef of UNIFIED_COLUMNS) {
        expect(outputNames).toContain(colDef.name.toLowerCase())
      }
    })

    it('should have correct output column count (172 columns)', () => {
      const selectColumns = parseSelectColumns(unifiedSql)
      // Allow for exactly 172 columns matching UNIFIED_COLUMNS
      expect(selectColumns.length).toBe(172)
    })

    it('should include all CoreIdentity columns (id, event_type, event_name, ns)', () => {
      expect(hasColumnTransform(unifiedSql, 'id')).toBe(true)
      expect(hasColumnTransform(unifiedSql, 'event_type')).toBe(true)
      expect(hasColumnTransform(unifiedSql, 'event_name')).toBe(true)
      expect(hasColumnTransform(unifiedSql, 'ns')).toBe(true)
    })

    it('should include all CausalityChain columns', () => {
      const causalityColumns = [
        'trace_id', 'span_id', 'parent_id', 'root_id',
        'session_id', 'workflow_id', 'transaction_id', 'correlation_id'
      ]
      for (const col of causalityColumns) {
        expect(hasColumnTransform(unifiedSql, col)).toBe(true)
      }
    })

    it('should include all FlexiblePayloads JSON columns', () => {
      const jsonColumns = ['data', 'attributes', 'labels', 'context', 'properties', 'traits']
      for (const col of jsonColumns) {
        expect(hasColumnTransform(unifiedSql, col)).toBe(true)
      }
    })
  })

  // --------------------------------------------------------------------------
  // 2. Namespace Qualification Tests
  // --------------------------------------------------------------------------
  describe('Namespace Qualification', () => {
    it('should qualify resource_id with namespace when not already qualified', () => {
      const transform = getColumnTransform(unifiedSql, 'resource_id')
      expect(transform).not.toBeNull()

      // Should use CASE expression to check for existing slash
      expect(transform).toMatch(/CASE/i)
      expect(transform).toMatch(/WHEN.*resource_id.*NOT\s+LIKE.*\//i)
      // Should concatenate ns + '/' + resource_id
      expect(transform).toMatch(/CONCAT.*ns.*\/.*resource_id/i)
    })

    it('should preserve already-qualified resource_id', () => {
      const transform = getColumnTransform(unifiedSql, 'resource_id')

      // ELSE clause should pass through original value
      expect(transform).toMatch(/ELSE\s+resource_id/i)
    })

    it('should qualify resource_ns with namespace fallback', () => {
      const transform = getColumnTransform(unifiedSql, 'resource_ns')
      expect(transform).not.toBeNull()

      // Should use COALESCE to fallback to ns
      expect(transform).toMatch(/COALESCE.*resource_ns.*ns/i)
    })
  })

  // --------------------------------------------------------------------------
  // 3. Partition Column Derivation Tests
  // --------------------------------------------------------------------------
  describe('Partition Column Derivation', () => {
    it('should derive day partition from timestamp (YYYY-MM-DD format)', () => {
      const transform = getColumnTransform(unifiedSql, 'day')
      expect(transform).not.toBeNull()

      // Should use DATE_FORMAT or equivalent
      expect(transform).toMatch(/DATE_FORMAT|STRFTIME|DATE|SUBSTRING/i)
      expect(transform).toMatch(/timestamp/i)
      // Format should produce YYYY-MM-DD
      expect(transform).toMatch(/%Y-%m-%d|yyyy-MM-dd/i)
    })

    it('should derive hour partition from timestamp (YYYY-MM-DDTHH format)', () => {
      const transform = getColumnTransform(unifiedSql, 'hour')
      expect(transform).not.toBeNull()

      // Should be derived from timestamp for hourly partition
      expect(transform).toMatch(/timestamp/i)
    })

    it('should pass through event_source', () => {
      const transform = getColumnTransform(unifiedSql, 'event_source')
      expect(transform).not.toBeNull()

      // Should be a simple pass-through
      expect(transform?.trim()).toBe('event_source')
    })

    it('should default visibility to "user" when null', () => {
      const transform = getColumnTransform(unifiedSql, 'visibility')
      expect(transform).not.toBeNull()

      // Should use COALESCE with 'user' default
      expect(transform).toMatch(/COALESCE.*visibility.*['"]user['"]/i)
    })

    it('should set ingested_at to current timestamp', () => {
      const transform = getColumnTransform(unifiedSql, 'ingested_at')
      expect(transform).not.toBeNull()

      // Should use CURRENT_TIMESTAMP or NOW()
      expect(transform).toMatch(/CURRENT_TIMESTAMP|NOW|DATETIME/i)
    })

    it('should set schema_version to 1', () => {
      const transform = getColumnTransform(unifiedSql, 'schema_version')
      expect(transform).not.toBeNull()

      // Should be literal 1
      expect(transform).toMatch(/\b1\b/)
    })
  })

  // --------------------------------------------------------------------------
  // 4. Null Column Handling Tests
  // --------------------------------------------------------------------------
  describe('Null Column Handling', () => {
    it('should pass through nullable string columns unchanged', () => {
      const nullableStrings = ['trace_id', 'actor_id', 'http_method', 'geo_country']
      for (const col of nullableStrings) {
        const transform = getColumnTransform(unifiedSql, col)
        expect(transform).not.toBeNull()
        // Simple columns should be pass-through (just the column name)
        expect(transform?.trim().toLowerCase()).toBe(col.toLowerCase())
      }
    })

    it('should pass through nullable number columns unchanged', () => {
      const nullableNumbers = ['duration_ms', 'status_code', 'http_status', 'geo_asn']
      for (const col of nullableNumbers) {
        const transform = getColumnTransform(unifiedSql, col)
        expect(transform).not.toBeNull()
        expect(transform?.trim().toLowerCase()).toBe(col.toLowerCase())
      }
    })

    it('should pass through nullable boolean columns unchanged', () => {
      const transform = getColumnTransform(unifiedSql, 'bot_verified')
      expect(transform).not.toBeNull()
      expect(transform?.trim().toLowerCase()).toBe('bot_verified')
    })
  })

  // --------------------------------------------------------------------------
  // 5. JSON Column Preservation Tests
  // --------------------------------------------------------------------------
  describe('JSON Column Preservation', () => {
    it('should preserve FlexiblePayloads JSON columns without transformation', () => {
      const jsonPayloadColumns = ['data', 'attributes', 'labels', 'context', 'properties', 'traits']
      for (const col of jsonPayloadColumns) {
        const transform = getColumnTransform(unifiedSql, col)
        expect(transform).not.toBeNull()
        // JSON columns should be pass-through
        expect(transform?.trim().toLowerCase()).toBe(col.toLowerCase())
      }
    })

    it('should preserve database CDC JSON columns (db_before, db_after)', () => {
      const cdcColumns = ['db_before', 'db_after']
      for (const col of cdcColumns) {
        const transform = getColumnTransform(unifiedSql, col)
        expect(transform).not.toBeNull()
        expect(transform?.trim().toLowerCase()).toBe(col.toLowerCase())
      }
    })

    it('should preserve metric JSON columns (metric_buckets, metric_quantiles)', () => {
      const metricColumns = ['metric_buckets', 'metric_quantiles']
      for (const col of metricColumns) {
        const transform = getColumnTransform(unifiedSql, col)
        expect(transform).not.toBeNull()
        expect(transform?.trim().toLowerCase()).toBe(col.toLowerCase())
      }
    })
  })

  // --------------------------------------------------------------------------
  // 6. Timestamp Conversion Tests
  // --------------------------------------------------------------------------
  describe('Timestamp Conversion', () => {
    it('should pass through timestamp column', () => {
      const transform = getColumnTransform(unifiedSql, 'timestamp')
      expect(transform).not.toBeNull()
      expect(transform?.trim().toLowerCase()).toBe('timestamp')
    })

    it('should pass through started_at and ended_at', () => {
      for (const col of ['started_at', 'ended_at']) {
        const transform = getColumnTransform(unifiedSql, col)
        expect(transform).not.toBeNull()
        expect(transform?.trim().toLowerCase()).toBe(col.toLowerCase())
      }
    })

    it('should pass through timestamp_ns (bigint)', () => {
      const transform = getColumnTransform(unifiedSql, 'timestamp_ns')
      expect(transform).not.toBeNull()
      expect(transform?.trim().toLowerCase()).toBe('timestamp_ns')
    })
  })

  // --------------------------------------------------------------------------
  // SQL Syntax Validation Tests
  // --------------------------------------------------------------------------
  describe('SQL Syntax', () => {
    it('should have valid INSERT INTO statement', () => {
      expect(unifiedSql).toMatch(/INSERT\s+INTO\s+unified_events/i)
    })

    it('should have valid SELECT ... FROM clause', () => {
      expect(unifiedSql).toMatch(/SELECT[\s\S]+FROM\s+unified_events_stream/i)
    })

    it('should use unified_events as target table', () => {
      expect(unifiedSql).toMatch(/INSERT\s+INTO\s+unified_events\b/i)
    })

    it('should use unified_events_stream as source', () => {
      expect(unifiedSql).toMatch(/FROM\s+unified_events_stream\b/i)
    })

    it('should not have syntax errors (balanced parentheses)', () => {
      const openParens = (unifiedSql.match(/\(/g) || []).length
      const closeParens = (unifiedSql.match(/\)/g) || []).length
      expect(openParens).toBe(closeParens)
    })
  })

  // --------------------------------------------------------------------------
  // Column Order Tests
  // --------------------------------------------------------------------------
  describe('Column Order', () => {
    it('should output columns in same order as UNIFIED_COLUMNS', () => {
      const selectColumns = parseSelectColumns(unifiedSql)
      const outputNames = selectColumns.map(col => extractOutputColumnName(col).toLowerCase())
      const schemaNames = UNIFIED_COLUMNS.map(c => c.name.toLowerCase())

      // Check that order matches
      for (let i = 0; i < schemaNames.length; i++) {
        expect(outputNames[i]).toBe(schemaNames[i])
      }
    })
  })

  // --------------------------------------------------------------------------
  // Semantic Group Tests
  // --------------------------------------------------------------------------
  describe('Semantic Groups', () => {
    it('should include all Actor columns', () => {
      const actorColumns = ['actor_id', 'actor_type', 'actor_name', 'anonymous_id']
      for (const col of actorColumns) {
        expect(hasColumnTransform(unifiedSql, col)).toBe(true)
      }
    })

    it('should include all Resource columns', () => {
      const resourceColumns = ['resource_type', 'resource_id', 'resource_name', 'resource_version', 'resource_ns']
      for (const col of resourceColumns) {
        expect(hasColumnTransform(unifiedSql, col)).toBe(true)
      }
    })

    it('should include all Timing columns', () => {
      const timingColumns = ['timestamp', 'timestamp_ns', 'started_at', 'ended_at', 'duration_ms', 'cpu_time_ms']
      for (const col of timingColumns) {
        expect(hasColumnTransform(unifiedSql, col)).toBe(true)
      }
    })

    it('should include all HttpContext columns', () => {
      const httpColumns = [
        'http_method', 'http_url', 'http_host', 'http_path', 'http_query',
        'http_status', 'http_protocol', 'http_request_size', 'http_response_size',
        'http_referrer', 'http_user_agent', 'http_content_type'
      ]
      for (const col of httpColumns) {
        expect(hasColumnTransform(unifiedSql, col)).toBe(true)
      }
    })

    it('should include all GeoLocation columns', () => {
      const geoColumns = [
        'geo_country', 'geo_region', 'geo_city', 'geo_colo', 'geo_timezone',
        'geo_latitude', 'geo_longitude', 'geo_asn', 'geo_as_org', 'geo_postal'
      ]
      for (const col of geoColumns) {
        expect(hasColumnTransform(unifiedSql, col)).toBe(true)
      }
    })

    it('should include all DoSpecific columns', () => {
      const doColumns = [
        'do_class', 'do_id', 'do_method',
        'action_verb', 'action_durability', 'action_target', 'action_input_version'
      ]
      for (const col of doColumns) {
        expect(hasColumnTransform(unifiedSql, col)).toBe(true)
      }
    })
  })
})
