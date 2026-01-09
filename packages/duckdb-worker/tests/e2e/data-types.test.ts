/**
 * E2E Tests for DuckDB Worker Data Type Handling
 *
 * Tests run against the deployed DuckDB Worker at:
 * https://duckdb-worker-test.dotdo.workers.dev
 *
 * Tests verify data type serialization behavior for:
 * - Numeric types (INTEGER, DOUBLE, DECIMAL, BIGINT)
 * - String types (VARCHAR, Unicode)
 * - Boolean type
 * - NULL handling
 * - Date/Time types (DATE, TIME, TIMESTAMP, TIMESTAMP_TZ, INTERVAL)
 * - Complex types (LIST, STRUCT, UUID, BLOB)
 * - Edge cases (Infinity, NaN, scientific notation, boundary values)
 *
 * Run with: npx vitest run packages/duckdb-worker/tests/e2e/data-types.test.ts
 */

import { describe, it, expect } from 'vitest'

const WORKER_URL = 'https://duckdb-worker-test.dotdo.workers.dev'

interface QueryResponse {
  success: boolean
  result?: {
    rows?: Record<string, unknown>[]
    columns?: { name: string; type: string; typeCode: number }[]
    rowCount?: number
  }
  error?: string
  stack?: string
  timing?: {
    queryMs?: number
    totalMs?: number
  }
}

/**
 * Helper to execute SQL via the /query endpoint
 */
async function query(sql: string): Promise<QueryResponse> {
  const url = `${WORKER_URL}/query?sql=${encodeURIComponent(sql)}`
  const response = await fetch(url)
  return response.json() as Promise<QueryResponse>
}

// =============================================================================
// NUMERIC TYPES
// =============================================================================

describe('Numeric Types', () => {
  describe('INTEGER', () => {
    it('should handle positive integers', async () => {
      const data = await query('SELECT 42 as int_val')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ int_val: 42 })
      expect(data.result?.columns?.[0].type).toBe('INTEGER')
      expect(data.result?.columns?.[0].typeCode).toBe(4)
    })

    it('should handle negative integers', async () => {
      const data = await query('SELECT -42 as negative_int')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ negative_int: -42 })
    })

    it('should handle zero', async () => {
      const data = await query('SELECT 0 as zero')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ zero: 0 })
    })

    it('should handle max INT32 (2147483647)', async () => {
      const data = await query('SELECT 2147483647 as max_int32')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ max_int32: 2147483647 })
      expect(data.result?.columns?.[0].type).toBe('INTEGER')
    })

    it('should handle min INT32 with explicit cast', async () => {
      // Note: Literal -2147483648 is typed as BIGINT by DuckDB
      // We must cast to INTEGER to avoid BigInt serialization error
      const data = await query('SELECT (-2147483648)::INTEGER as min_int32_cast')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ min_int32_cast: -2147483648 })
      expect(data.result?.columns?.[0].type).toBe('INTEGER')
    })

    it('should handle -2147483647 (one above min) without cast', async () => {
      // -2147483647 stays as INTEGER
      const data = await query('SELECT -2147483647 as almost_min_int32')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ almost_min_int32: -2147483647 })
    })

    it('should handle arithmetic resulting in INTEGER', async () => {
      const data = await query('SELECT 10 + 32 as sum, 50 - 8 as diff, 6 * 7 as product, 84 / 2 as quotient')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({
        sum: 42,
        diff: 42,
        product: 42,
        quotient: 42,
      })
    })
  })

  describe('DOUBLE', () => {
    it('should handle floating point numbers', async () => {
      const data = await query('SELECT 3.14159 as double_val')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0].double_val).toBeCloseTo(3.14159, 5)
      // Note: DuckDB returns DECIMAL for literal, not DOUBLE
      expect(data.result?.columns?.[0].type).toBe('DECIMAL')
    })

    it('should handle explicit DOUBLE type', async () => {
      const data = await query('SELECT 3.14159::DOUBLE as double_val')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0].double_val).toBeCloseTo(3.14159, 5)
      expect(data.result?.columns?.[0].type).toBe('DOUBLE')
    })

    it('should handle scientific notation as DOUBLE', async () => {
      const data = await query('SELECT 1e10 as scientific')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ scientific: 10000000000 })
      expect(data.result?.columns?.[0].type).toBe('DOUBLE')
    })

    it('should handle small decimals', async () => {
      const data = await query('SELECT 0.001::DOUBLE as small')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0].small).toBeCloseTo(0.001, 6)
    })

    it('should handle zero as DOUBLE', async () => {
      const data = await query('SELECT 0.0 as zero_double')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ zero_double: 0 })
    })

    it('should serialize Infinity as null', async () => {
      // JSON.stringify cannot represent Infinity, DuckDB Worker serializes as null
      const data = await query("SELECT 'Infinity'::DOUBLE as infinity_val")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ infinity_val: null })
    })

    it('should serialize NaN as null', async () => {
      // JSON.stringify cannot represent NaN, DuckDB Worker serializes as null
      const data = await query("SELECT 'NaN'::DOUBLE as nan_val")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ nan_val: null })
    })
  })

  describe('BIGINT (Known Limitation)', () => {
    it('should fail with BigInt serialization error', async () => {
      // BIGINT values cause JSON serialization failure
      // This is a known limitation of the Worker
      const data = await query('SELECT 9223372036854775807::BIGINT as bigint_val')

      expect(data.success).toBe(false)
      expect(data.error).toContain('BigInt')
    })

    it('should fail for uncast min INT32 literal (typed as BIGINT)', async () => {
      // DuckDB interprets -2147483648 as BIGINT, not INTEGER
      const typeCheck = await query('SELECT typeof(-2147483648) as type_check')
      expect(typeCheck.result?.rows?.[0]).toEqual({ type_check: 'BIGINT' })

      const data = await query('SELECT -2147483648 as min_int32')

      expect(data.success).toBe(false)
      expect(data.error).toContain('BigInt')
    })

    it('should work when BIGINT is cast to INTEGER', async () => {
      // Workaround: cast BIGINT to INTEGER if value fits
      const data = await query('SELECT CAST(1000000000::BIGINT AS INTEGER) as casted')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ casted: 1000000000 })
    })
  })

  describe('DECIMAL', () => {
    it('should handle DECIMAL values', async () => {
      const data = await query('SELECT 19.99::DECIMAL(10,2) as price')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ price: 19.99 })
      expect(data.result?.columns?.[0].type).toBe('DECIMAL')
    })
  })
})

// =============================================================================
// STRING TYPES
// =============================================================================

describe('String Types', () => {
  describe('VARCHAR', () => {
    it('should handle simple strings', async () => {
      const data = await query("SELECT 'hello world' as str_val")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ str_val: 'hello world' })
      expect(data.result?.columns?.[0].type).toBe('VARCHAR')
      expect(data.result?.columns?.[0].typeCode).toBe(17)
    })

    it('should handle empty strings', async () => {
      const data = await query("SELECT '' as empty_string")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ empty_string: '' })
    })

    it('should handle strings with special characters', async () => {
      const data = await query("SELECT 'hello \"quoted\" string' as special")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ special: 'hello "quoted" string' })
    })

    it('should handle multiline strings with escaped newlines', async () => {
      const data = await query("SELECT E'line1\\nline2' as multiline")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ multiline: 'line1\nline2' })
    })
  })

  describe('Unicode', () => {
    it('should handle Japanese characters', async () => {
      const data = await query("SELECT '\u3053\u3093\u306b\u3061\u306f' as unicode_val")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ unicode_val: '\u3053\u3093\u306b\u3061\u306f' })
    })

    it('should handle Chinese characters', async () => {
      const data = await query("SELECT '\u4f60\u597d' as chinese")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ chinese: '\u4f60\u597d' })
    })

    it('should handle emoji', async () => {
      const data = await query("SELECT '\ud83d\ude00\ud83d\udc4d\ud83c\udf89' as emoji")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ emoji: '\ud83d\ude00\ud83d\udc4d\ud83c\udf89' })
    })

    it('should handle mixed ASCII and Unicode', async () => {
      const data = await query("SELECT 'Hello \u4e16\u754c!' as mixed")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ mixed: 'Hello \u4e16\u754c!' })
    })
  })
})

// =============================================================================
// BOOLEAN TYPE
// =============================================================================

describe('Boolean Type', () => {
  it('should handle true', async () => {
    const data = await query('SELECT true as bool_true')

    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0]).toEqual({ bool_true: true })
    expect(data.result?.columns?.[0].type).toBe('BOOLEAN')
    expect(data.result?.columns?.[0].typeCode).toBe(1)
  })

  it('should handle false', async () => {
    const data = await query('SELECT false as bool_false')

    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0]).toEqual({ bool_false: false })
  })

  it('should handle both in same row', async () => {
    const data = await query('SELECT true as bool_true, false as bool_false')

    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0]).toEqual({ bool_true: true, bool_false: false })
  })

  it('should handle boolean expressions', async () => {
    const data = await query('SELECT 1 = 1 as eq, 1 > 2 as gt, 1 < 2 as lt')

    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0]).toEqual({ eq: true, gt: false, lt: true })
  })
})

// =============================================================================
// NULL HANDLING
// =============================================================================

describe('NULL Handling', () => {
  it('should handle NULL literal', async () => {
    const data = await query('SELECT NULL as null_val')

    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0]).toEqual({ null_val: null })
    // NULL without context is typed as INTEGER by DuckDB
    expect(data.result?.columns?.[0].type).toBe('INTEGER')
  })

  it('should handle typed NULL', async () => {
    const data = await query('SELECT NULL::VARCHAR as null_str')

    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0]).toEqual({ null_str: null })
    expect(data.result?.columns?.[0].type).toBe('VARCHAR')
  })

  it('should handle NULL in boolean context', async () => {
    const data = await query('SELECT NULL::BOOLEAN as null_bool')

    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0]).toEqual({ null_bool: null })
  })

  it('should handle NULL comparisons', async () => {
    const data = await query('SELECT NULL IS NULL as is_null, NULL IS NOT NULL as is_not_null')

    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0]).toEqual({ is_null: true, is_not_null: false })
  })

  it('should handle COALESCE with NULL', async () => {
    const data = await query("SELECT COALESCE(NULL, 'default') as coalesced")

    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0]).toEqual({ coalesced: 'default' })
  })
})

// =============================================================================
// DATE/TIME TYPES
// =============================================================================

describe('Date/Time Types', () => {
  describe('DATE', () => {
    it('should handle CURRENT_DATE', async () => {
      const data = await query('SELECT CURRENT_DATE as today')

      expect(data.success).toBe(true)
      expect(data.result?.columns?.[0].type).toBe('DATE')
      expect(data.result?.columns?.[0].typeCode).toBe(13)
      // Date is returned as ISO string YYYY-MM-DD
      expect(data.result?.rows?.[0].today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('should handle DATE literal', async () => {
      const data = await query("SELECT DATE '2025-01-01' as date_val")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ date_val: '2025-01-01' })
      expect(data.result?.columns?.[0].type).toBe('DATE')
    })

    it('should handle date comparison', async () => {
      const data = await query("SELECT DATE '2025-01-15' > DATE '2025-01-01' as is_later")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ is_later: true })
    })
  })

  describe('TIME', () => {
    it('should handle TIME literal', async () => {
      const data = await query("SELECT TIME '13:45:30' as time_val")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ time_val: '13:45:30' })
      expect(data.result?.columns?.[0].type).toBe('TIME')
      expect(data.result?.columns?.[0].typeCode).toBe(14)
    })

    it('should handle TIME with microseconds', async () => {
      const data = await query("SELECT TIME '13:45:30.123456' as time_precise")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0].time_precise).toMatch(/^13:45:30/)
    })
  })

  describe('TIMESTAMP (without timezone)', () => {
    it('should handle TIMESTAMP literal', async () => {
      const data = await query("SELECT TIMESTAMP '2025-01-01 12:30:45' as ts_val")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ ts_val: '2025-01-01 12:30:45' })
      expect(data.result?.columns?.[0].type).toBe('TIMESTAMP')
      expect(data.result?.columns?.[0].typeCode).toBe(12)
    })

    it('should handle TIMESTAMP with microseconds', async () => {
      const data = await query("SELECT TIMESTAMP '2025-01-01 12:30:45.123456' as ts_precise")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0].ts_precise).toMatch(/^2025-01-01 12:30:45/)
    })
  })

  describe('TIMESTAMP_TZ', () => {
    it('should return CURRENT_TIMESTAMP as string', async () => {
      const data = await query('SELECT CURRENT_TIMESTAMP as now')

      expect(data.success).toBe(true)
      expect(data.result?.columns?.[0].type).toBe('TIMESTAMP_TZ')
      expect(data.result?.columns?.[0].typeCode).toBe(31)
      // Should return timestamp string
      expect(data.result?.rows?.[0].now).toMatch(/^\d{4}-\d{2}-\d{2}/)
    })

    it('should return NOW() as string', async () => {
      const data = await query('SELECT NOW() as now_fn')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0].now_fn).toMatch(/^\d{4}-\d{2}-\d{2}/)
    })

    it('should also work when cast to VARCHAR', async () => {
      // Cast to VARCHAR also works
      const data = await query('SELECT CAST(CURRENT_TIMESTAMP AS VARCHAR) as now_str')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0].now_str).toMatch(/^\d{4}-\d{2}-\d{2}/)
      expect(data.result?.columns?.[0].type).toBe('VARCHAR')
    })

    it('should also work when cast to TIMESTAMP (without TZ)', async () => {
      // Cast to TIMESTAMP (drops timezone) also works
      const data = await query('SELECT CAST(CURRENT_TIMESTAMP AS TIMESTAMP) as ts')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}/)
      expect(data.result?.columns?.[0].type).toBe('TIMESTAMP')
    })
  })

  describe('INTERVAL', () => {
    it('should handle INTERVAL in days', async () => {
      const data = await query("SELECT INTERVAL '1 day' as interval_val")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ interval_val: '1 day' })
      expect(data.result?.columns?.[0].type).toBe('INTERVAL')
      expect(data.result?.columns?.[0].typeCode).toBe(15)
    })

    it('should handle INTERVAL in hours', async () => {
      const data = await query("SELECT INTERVAL '2 hours' as interval_hours")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ interval_hours: '02:00:00' })
    })

    it('should handle date arithmetic with INTERVAL', async () => {
      const data = await query("SELECT DATE '2025-01-01' + INTERVAL '10 days' as future")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0].future).toMatch(/2025-01-11/)
    })
  })
})

// =============================================================================
// COMPLEX TYPES
// =============================================================================

describe('Complex Types', () => {
  describe('LIST (Array)', () => {
    it('should return LIST values as arrays', async () => {
      const data = await query('SELECT [1, 2, 3] as int_array')

      expect(data.success).toBe(true)
      expect(data.result?.columns?.[0].type).toBe('LIST')
      expect(data.result?.columns?.[0].typeCode).toBe(24)
      // Should return parsed array
      expect(data.result?.rows?.[0]).toEqual({ int_array: [1, 2, 3] })
    })

    it('should also work with array_to_string workaround', async () => {
      const data = await query("SELECT array_to_string([1, 2, 3], ',') as arr_str")

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0]).toEqual({ arr_str: '1,2,3' })
    })
  })

  describe('STRUCT', () => {
    it('should return STRUCT values as objects', async () => {
      const data = await query("SELECT {'x': 1, 'y': 2} as struct_val")

      expect(data.success).toBe(true)
      expect(data.result?.columns?.[0].type).toBe('STRUCT')
      expect(data.result?.columns?.[0].typeCode).toBe(25)
      // Should return parsed object
      expect(data.result?.rows?.[0]).toEqual({ struct_val: { x: 1, y: 2 } })
    })
  })

  describe('UUID', () => {
    it('should return UUID values as strings', async () => {
      const data = await query('SELECT UUID() as uuid_val')

      expect(data.success).toBe(true)
      expect(data.result?.columns?.[0].type).toBe('UUID')
      expect(data.result?.columns?.[0].typeCode).toBe(27)
      // Should return proper UUID string
      expect(data.result?.rows?.[0].uuid_val).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
    })

    it('should also work when cast to VARCHAR', async () => {
      // Cast to VARCHAR also works
      const data = await query('SELECT CAST(UUID() AS VARCHAR) as uuid_str')

      expect(data.success).toBe(true)
      expect(data.result?.rows?.[0].uuid_str).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
    })
  })

  describe('BLOB', () => {
    it('should handle BLOB with hex escape representation', async () => {
      const data = await query("SELECT BLOB '\\x00\\x01\\x02' as blob_val")

      expect(data.success).toBe(true)
      expect(data.result?.columns?.[0].type).toBe('BLOB')
      expect(data.result?.columns?.[0].typeCode).toBe(18)
      // BLOB returned as escaped hex string
      expect(data.result?.rows?.[0]).toEqual({ blob_val: '\\x00\\x01\\x02' })
    })
  })
})

// =============================================================================
// TYPE METADATA
// =============================================================================

describe('Type Metadata', () => {
  it('should return correct type codes for common types', async () => {
    const data = await query(`
      SELECT
        1 as int_col,
        1.5 as decimal_col,
        true as bool_col,
        'text' as varchar_col,
        DATE '2025-01-01' as date_col
    `)

    expect(data.success).toBe(true)
    expect(data.result?.columns).toHaveLength(5)

    const columns = data.result?.columns || []
    expect(columns.find((c) => c.name === 'int_col')?.type).toBe('INTEGER')
    expect(columns.find((c) => c.name === 'decimal_col')?.type).toBe('DECIMAL')
    expect(columns.find((c) => c.name === 'bool_col')?.type).toBe('BOOLEAN')
    expect(columns.find((c) => c.name === 'varchar_col')?.type).toBe('VARCHAR')
    expect(columns.find((c) => c.name === 'date_col')?.type).toBe('DATE')
  })

  it('should include typeCode in column metadata', async () => {
    const data = await query('SELECT 42 as num')

    expect(data.success).toBe(true)
    expect(data.result?.columns?.[0]).toEqual({
      name: 'num',
      type: 'INTEGER',
      typeCode: 4,
    })
  })
})

// =============================================================================
// WORKAROUNDS FOR REMAINING LIMITATIONS
// =============================================================================

describe('Remaining Workarounds (BIGINT)', () => {
  it('BIGINT: cast to INTEGER if value fits to avoid BigInt serialization', async () => {
    // BIGINT values still cause JSON serialization failure because BigInt
    // is not JSON-serializable. Cast to INTEGER if the value fits.
    const data = await query('SELECT CAST(1000000000::BIGINT AS INTEGER) as val')
    expect(data.success).toBe(true)
  })

  it('length(): cast result to INTEGER to avoid BIGINT', async () => {
    // length() returns BIGINT by default, which fails JSON serialization
    // Cast to INTEGER as workaround
    const data = await query("SELECT CAST(length('hello') AS INTEGER) as val")
    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0].val).toBe(5)
  })
})

// =============================================================================
// VERIFY COMPLEX TYPES NOW WORK NATIVELY
// =============================================================================

describe('Complex Types Native Support (No Workarounds Needed)', () => {
  it('TIMESTAMP_TZ: works natively without cast', async () => {
    const data = await query('SELECT CURRENT_TIMESTAMP as val')
    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0].val).toBeTruthy()
    expect(data.result?.rows?.[0].val).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  it('UUID: works natively without cast', async () => {
    const data = await query('SELECT UUID() as val')
    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0].val).toBeTruthy()
    expect(data.result?.rows?.[0].val).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('LIST: works natively without array_to_string', async () => {
    const data = await query('SELECT [1,2,3] as val')
    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0].val).toEqual([1, 2, 3])
  })

  it('STRUCT: works natively', async () => {
    const data = await query("SELECT {'a': 1, 'b': 2} as val")
    expect(data.success).toBe(true)
    expect(data.result?.rows?.[0].val).toEqual({ a: 1, b: 2 })
  })
})
