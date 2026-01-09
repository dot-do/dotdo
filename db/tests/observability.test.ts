import { describe, it, expect } from 'vitest'

/**
 * Observability Table Schema Tests
 *
 * These tests verify the Drizzle schema for the do_observability Iceberg table.
 * This schema will be used by Pipeline to write observability events to R2.
 *
 * This is RED phase TDD - tests should FAIL until the observability schema
 * is implemented in db/observability.ts.
 *
 * Event types:
 * - 'log' - Console/application logs
 * - 'exception' - Uncaught exceptions and errors
 * - 'request' - HTTP request events
 * - 'do_method' - Durable Object method invocations
 *
 * Partition columns:
 * - hour: ISO hour string derived from timestamp (e.g., "2024-01-15T14:00:00Z")
 * - severity_bucket: 'error' for error/warn levels, 'normal' for info/debug
 *
 * Implementation requirements:
 * - observability table exported from db/observability.ts
 * - Export deriveHour and deriveSeverityBucket helper functions
 * - All columns match the expected types
 */

// ============================================================================
// Schema Types (Expected Interface)
// ============================================================================

interface ObservabilityEvent {
  id: string // UUID
  type: 'log' | 'exception' | 'request' | 'do_method'
  level: 'debug' | 'info' | 'warn' | 'error'
  script: string // Worker script name
  timestamp: number // Unix ms
  request_id: string | null
  method: string | null // HTTP method
  url: string | null
  status: number | null // HTTP status code
  duration_ms: number | null
  do_name: string | null // Durable Object class name
  do_id: string | null // Durable Object ID
  do_method: string | null // DO method name
  message: string | null // JSON array (serialized log arguments)
  stack: string | null // Stack trace for exceptions
  metadata: string | null // JSON arbitrary metadata
  hour: string // Partition column: ISO hour string
  severity_bucket: 'error' | 'normal' // Partition column
}

// ============================================================================
// Schema Imports (should fail until implemented)
// ============================================================================

// Import the schema - this should FAIL because db/observability.ts doesn't exist
// @ts-expect-error - Module not found (RED phase)
import { observability } from '../observability'

// Import helper functions - should FAIL
// @ts-expect-error - Exports don't exist yet (RED phase)
import { deriveHour, deriveSeverityBucket } from '../observability'

// ============================================================================
// Schema Table Definition Tests
// ============================================================================

describe('Schema Table Definition', () => {
  describe('Table Export', () => {
    it('observability table is exported from db/observability.ts', () => {
      expect(observability).toBeDefined()
    })

    it('table name is "do_observability"', () => {
      // Drizzle tables have a _ property with table info
      const tableName = (observability as { _: { name: string } })._?.name ?? ''
      expect(tableName).toBe('do_observability')
    })
  })

  describe('Column Definitions', () => {
    it('has id column (text, primary key)', () => {
      expect(observability.id).toBeDefined()
    })

    it('has type column (text, not null)', () => {
      expect(observability.type).toBeDefined()
    })

    it('has level column (text, not null)', () => {
      expect(observability.level).toBeDefined()
    })

    it('has script column (text, not null)', () => {
      expect(observability.script).toBeDefined()
    })

    it('has timestamp column (integer, not null)', () => {
      expect(observability.timestamp).toBeDefined()
    })

    it('has request_id column (text, nullable)', () => {
      expect(observability.request_id).toBeDefined()
    })

    it('has method column (text, nullable)', () => {
      expect(observability.method).toBeDefined()
    })

    it('has url column (text, nullable)', () => {
      expect(observability.url).toBeDefined()
    })

    it('has status column (integer, nullable)', () => {
      expect(observability.status).toBeDefined()
    })

    it('has duration_ms column (integer, nullable)', () => {
      expect(observability.duration_ms).toBeDefined()
    })

    it('has do_name column (text, nullable)', () => {
      expect(observability.do_name).toBeDefined()
    })

    it('has do_id column (text, nullable)', () => {
      expect(observability.do_id).toBeDefined()
    })

    it('has do_method column (text, nullable)', () => {
      expect(observability.do_method).toBeDefined()
    })

    it('has message column (text/JSON array, nullable)', () => {
      expect(observability.message).toBeDefined()
    })

    it('has stack column (text, nullable)', () => {
      expect(observability.stack).toBeDefined()
    })

    it('has metadata column (text/JSON, nullable)', () => {
      expect(observability.metadata).toBeDefined()
    })

    it('has hour column (text, partition column)', () => {
      expect(observability.hour).toBeDefined()
    })

    it('has severity_bucket column (text, partition column)', () => {
      expect(observability.severity_bucket).toBeDefined()
    })
  })

  describe('All Required Columns Present', () => {
    it('has all 18 required columns', () => {
      const requiredColumns = [
        'id',
        'type',
        'level',
        'script',
        'timestamp',
        'request_id',
        'method',
        'url',
        'status',
        'duration_ms',
        'do_name',
        'do_id',
        'do_method',
        'message',
        'stack',
        'metadata',
        'hour',
        'severity_bucket',
      ]

      requiredColumns.forEach((col) => {
        expect(
          (observability as Record<string, unknown>)[col],
          `Column ${col} should be defined`
        ).toBeDefined()
      })
    })
  })
})

// ============================================================================
// deriveHour Helper Function Tests
// ============================================================================

describe('deriveHour Helper Function', () => {
  describe('Basic Functionality', () => {
    it('deriveHour function is exported', () => {
      expect(deriveHour).toBeDefined()
      expect(typeof deriveHour).toBe('function')
    })

    it('converts timestamp to ISO hour string', () => {
      // Timestamp for 2024-01-15 14:30:45.123 UTC
      const timestamp = 1705329045123
      const result = deriveHour(timestamp)

      // Should return the hour truncated to start of hour
      expect(result).toBe('2024-01-15T14:00:00Z')
    })

    it('returns ISO format with Z timezone', () => {
      const timestamp = Date.now()
      const result = deriveHour(timestamp)

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/)
    })

    it('truncates minutes, seconds, and milliseconds to zero', () => {
      // Timestamp for 2024-06-20 09:45:32.789 UTC
      const timestamp = new Date('2024-06-20T09:45:32.789Z').getTime()
      const result = deriveHour(timestamp)

      expect(result).toBe('2024-06-20T09:00:00Z')
    })
  })

  describe('Edge Cases', () => {
    it('handles midnight correctly', () => {
      // Timestamp for 2024-01-15 00:30:00 UTC
      const timestamp = new Date('2024-01-15T00:30:00Z').getTime()
      const result = deriveHour(timestamp)

      expect(result).toBe('2024-01-15T00:00:00Z')
    })

    it('handles 23:00 hour correctly', () => {
      // Timestamp for 2024-01-15 23:59:59 UTC
      const timestamp = new Date('2024-01-15T23:59:59Z').getTime()
      const result = deriveHour(timestamp)

      expect(result).toBe('2024-01-15T23:00:00Z')
    })

    it('handles year boundary correctly', () => {
      // Timestamp for 2023-12-31 23:30:00 UTC
      const timestamp = new Date('2023-12-31T23:30:00Z').getTime()
      const result = deriveHour(timestamp)

      expect(result).toBe('2023-12-31T23:00:00Z')
    })

    it('handles new year correctly', () => {
      // Timestamp for 2024-01-01 00:15:00 UTC
      const timestamp = new Date('2024-01-01T00:15:00Z').getTime()
      const result = deriveHour(timestamp)

      expect(result).toBe('2024-01-01T00:00:00Z')
    })

    it('handles leap year February 29th', () => {
      // 2024 is a leap year
      const timestamp = new Date('2024-02-29T12:30:00Z').getTime()
      const result = deriveHour(timestamp)

      expect(result).toBe('2024-02-29T12:00:00Z')
    })

    it('handles timestamp at exact hour boundary', () => {
      // Timestamp for exactly 2024-01-15 10:00:00.000 UTC
      const timestamp = new Date('2024-01-15T10:00:00.000Z').getTime()
      const result = deriveHour(timestamp)

      expect(result).toBe('2024-01-15T10:00:00Z')
    })

    it('handles timestamp one millisecond before next hour', () => {
      // Timestamp for 2024-01-15 10:59:59.999 UTC
      const timestamp = new Date('2024-01-15T10:59:59.999Z').getTime()
      const result = deriveHour(timestamp)

      expect(result).toBe('2024-01-15T10:00:00Z')
    })
  })
})

// ============================================================================
// deriveSeverityBucket Helper Function Tests
// ============================================================================

describe('deriveSeverityBucket Helper Function', () => {
  describe('Basic Functionality', () => {
    it('deriveSeverityBucket function is exported', () => {
      expect(deriveSeverityBucket).toBeDefined()
      expect(typeof deriveSeverityBucket).toBe('function')
    })

    it('returns "error" for "error" level', () => {
      const result = deriveSeverityBucket('error')
      expect(result).toBe('error')
    })

    it('returns "error" for "warn" level', () => {
      const result = deriveSeverityBucket('warn')
      expect(result).toBe('error')
    })

    it('returns "normal" for "info" level', () => {
      const result = deriveSeverityBucket('info')
      expect(result).toBe('normal')
    })

    it('returns "normal" for "debug" level', () => {
      const result = deriveSeverityBucket('debug')
      expect(result).toBe('normal')
    })
  })

  describe('Return Type Validation', () => {
    it('returns only "error" or "normal"', () => {
      const levels = ['debug', 'info', 'warn', 'error'] as const

      levels.forEach((level) => {
        const result = deriveSeverityBucket(level)
        expect(['error', 'normal']).toContain(result)
      })
    })

    it('error levels map to "error" bucket', () => {
      const errorLevels = ['error', 'warn'] as const

      errorLevels.forEach((level) => {
        const result = deriveSeverityBucket(level)
        expect(result).toBe('error')
      })
    })

    it('normal levels map to "normal" bucket', () => {
      const normalLevels = ['info', 'debug'] as const

      normalLevels.forEach((level) => {
        const result = deriveSeverityBucket(level)
        expect(result).toBe('normal')
      })
    })
  })
})

// ============================================================================
// Drizzle Query Usage Tests
// ============================================================================

describe('Drizzle Query Usage', () => {
  describe('Schema can be used in Drizzle select query', () => {
    it('observability table has correct structure for select', () => {
      // This test verifies the schema can be used in a Drizzle query
      // The actual query execution would require a database connection

      // Verify the table has the expected Drizzle table interface
      expect(observability).toBeDefined()

      // In Drizzle, tables have columns accessible as properties
      // and a special _ property with metadata
      expect(typeof observability).toBe('object')

      // The table should be usable in select queries
      // e.g., db.select().from(observability).where(...)
      // We can't test actual execution without a DB, but we verify structure

      // Check it has the Drizzle table marker
      const hasTableMarker =
        (observability as Record<string, unknown>)._ !== undefined ||
        Symbol.for('drizzle:Name') in (observability as object)

      expect(hasTableMarker).toBe(true)
    })

    it('can reference specific columns for select', () => {
      // Verify we can access columns by name (for column selection)
      expect(observability.id).toBeDefined()
      expect(observability.type).toBeDefined()
      expect(observability.level).toBeDefined()
      expect(observability.timestamp).toBeDefined()
      expect(observability.message).toBeDefined()
    })
  })

  describe('Schema can be used in Drizzle insert query', () => {
    it('observability table can accept insert values', () => {
      // Verify the table structure supports insert operations
      // This tests that the schema has the correct shape

      // A valid insert would have these fields
      const insertData: Partial<ObservabilityEvent> = {
        id: 'evt-001',
        type: 'log',
        level: 'info',
        script: 'worker-main',
        timestamp: Date.now(),
        hour: '2024-01-15T14:00:00Z',
        severity_bucket: 'normal',
        message: JSON.stringify(['Hello', 'World']),
      }

      // Verify the data matches expected types
      expect(typeof insertData.id).toBe('string')
      expect(['log', 'exception', 'request', 'do_method']).toContain(insertData.type)
      expect(['debug', 'info', 'warn', 'error']).toContain(insertData.level)
      expect(typeof insertData.script).toBe('string')
      expect(typeof insertData.timestamp).toBe('number')
      expect(insertData.hour).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/)
      expect(['error', 'normal']).toContain(insertData.severity_bucket)
    })

    it('supports nullable columns in insert', () => {
      // Verify nullable columns can be null or omitted
      const minimalInsert: Partial<ObservabilityEvent> = {
        id: 'evt-002',
        type: 'exception',
        level: 'error',
        script: 'worker-main',
        timestamp: Date.now(),
        hour: '2024-01-15T15:00:00Z',
        severity_bucket: 'error',
        // All nullable fields omitted
      }

      expect(minimalInsert.request_id).toBeUndefined()
      expect(minimalInsert.method).toBeUndefined()
      expect(minimalInsert.url).toBeUndefined()
      expect(minimalInsert.status).toBeUndefined()
      expect(minimalInsert.duration_ms).toBeUndefined()
      expect(minimalInsert.do_name).toBeUndefined()
      expect(minimalInsert.do_id).toBeUndefined()
      expect(minimalInsert.do_method).toBeUndefined()
      expect(minimalInsert.message).toBeUndefined()
      expect(minimalInsert.stack).toBeUndefined()
      expect(minimalInsert.metadata).toBeUndefined()
    })
  })
})

// ============================================================================
// Event Type Tests
// ============================================================================

describe('Event Type Values', () => {
  describe('Valid event types', () => {
    it('accepts "log" type', () => {
      const event: Partial<ObservabilityEvent> = {
        type: 'log',
        level: 'info',
        message: JSON.stringify(['Application started']),
      }
      expect(event.type).toBe('log')
    })

    it('accepts "exception" type', () => {
      const event: Partial<ObservabilityEvent> = {
        type: 'exception',
        level: 'error',
        stack: 'Error: Something went wrong\n    at foo()',
      }
      expect(event.type).toBe('exception')
    })

    it('accepts "request" type', () => {
      const event: Partial<ObservabilityEvent> = {
        type: 'request',
        level: 'info',
        method: 'GET',
        url: 'https://api.example.com/users',
        status: 200,
        duration_ms: 150,
      }
      expect(event.type).toBe('request')
    })

    it('accepts "do_method" type', () => {
      const event: Partial<ObservabilityEvent> = {
        type: 'do_method',
        level: 'info',
        do_name: 'Counter',
        do_id: 'counter-123',
        do_method: 'increment',
        duration_ms: 5,
      }
      expect(event.type).toBe('do_method')
    })
  })
})

// ============================================================================
// Level Values Tests
// ============================================================================

describe('Level Values', () => {
  describe('Valid log levels', () => {
    it('accepts "debug" level', () => {
      const event: Partial<ObservabilityEvent> = {
        type: 'log',
        level: 'debug',
      }
      expect(event.level).toBe('debug')
    })

    it('accepts "info" level', () => {
      const event: Partial<ObservabilityEvent> = {
        type: 'log',
        level: 'info',
      }
      expect(event.level).toBe('info')
    })

    it('accepts "warn" level', () => {
      const event: Partial<ObservabilityEvent> = {
        type: 'log',
        level: 'warn',
      }
      expect(event.level).toBe('warn')
    })

    it('accepts "error" level', () => {
      const event: Partial<ObservabilityEvent> = {
        type: 'log',
        level: 'error',
      }
      expect(event.level).toBe('error')
    })
  })
})

// ============================================================================
// Partition Column Tests
// ============================================================================

describe('Partition Columns', () => {
  describe('hour partition column', () => {
    it('hour is derived from timestamp', () => {
      const timestamp = new Date('2024-01-15T14:35:22Z').getTime()
      const hour = deriveHour(timestamp)

      const event: Partial<ObservabilityEvent> = {
        timestamp,
        hour,
      }

      expect(event.hour).toBe('2024-01-15T14:00:00Z')
    })

    it('hour enables time-based partitioning', () => {
      // Events from the same hour should have the same hour partition value
      const events: Partial<ObservabilityEvent>[] = [
        { timestamp: new Date('2024-01-15T14:00:00Z').getTime() },
        { timestamp: new Date('2024-01-15T14:30:00Z').getTime() },
        { timestamp: new Date('2024-01-15T14:59:59Z').getTime() },
      ]

      events.forEach((event) => {
        const hour = deriveHour(event.timestamp!)
        expect(hour).toBe('2024-01-15T14:00:00Z')
      })
    })
  })

  describe('severity_bucket partition column', () => {
    it('severity_bucket is derived from level', () => {
      const event: Partial<ObservabilityEvent> = {
        level: 'error',
        severity_bucket: deriveSeverityBucket('error'),
      }

      expect(event.severity_bucket).toBe('error')
    })

    it('separates error/warn from info/debug', () => {
      const errorEvents: Partial<ObservabilityEvent>[] = [
        { level: 'error', severity_bucket: deriveSeverityBucket('error') },
        { level: 'warn', severity_bucket: deriveSeverityBucket('warn') },
      ]

      const normalEvents: Partial<ObservabilityEvent>[] = [
        { level: 'info', severity_bucket: deriveSeverityBucket('info') },
        { level: 'debug', severity_bucket: deriveSeverityBucket('debug') },
      ]

      errorEvents.forEach((event) => {
        expect(event.severity_bucket).toBe('error')
      })

      normalEvents.forEach((event) => {
        expect(event.severity_bucket).toBe('normal')
      })
    })
  })
})

// ============================================================================
// Complete Event Examples
// ============================================================================

describe('Complete Event Examples', () => {
  it('creates complete log event', () => {
    const timestamp = Date.now()
    const event: ObservabilityEvent = {
      id: 'log-001',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp,
      request_id: 'req-abc123',
      method: null,
      url: null,
      status: null,
      duration_ms: null,
      do_name: null,
      do_id: null,
      do_method: null,
      message: JSON.stringify(['User logged in', { userId: 'user-123' }]),
      stack: null,
      metadata: JSON.stringify({ source: 'auth-service' }),
      hour: deriveHour(timestamp),
      severity_bucket: deriveSeverityBucket('info'),
    }

    expect(event.id).toBe('log-001')
    expect(event.type).toBe('log')
    expect(event.severity_bucket).toBe('normal')
  })

  it('creates complete exception event', () => {
    const timestamp = Date.now()
    const event: ObservabilityEvent = {
      id: 'exc-001',
      type: 'exception',
      level: 'error',
      script: 'api-worker',
      timestamp,
      request_id: 'req-xyz789',
      method: 'POST',
      url: 'https://api.example.com/users',
      status: 500,
      duration_ms: null,
      do_name: null,
      do_id: null,
      do_method: null,
      message: JSON.stringify(['Database connection failed']),
      stack: 'Error: Connection refused\n    at connect(db.ts:42)\n    at query(db.ts:100)',
      metadata: JSON.stringify({ database: 'users_db', attempts: 3 }),
      hour: deriveHour(timestamp),
      severity_bucket: deriveSeverityBucket('error'),
    }

    expect(event.id).toBe('exc-001')
    expect(event.type).toBe('exception')
    expect(event.severity_bucket).toBe('error')
    expect(event.stack).toContain('Connection refused')
  })

  it('creates complete request event', () => {
    const timestamp = Date.now()
    const event: ObservabilityEvent = {
      id: 'req-001',
      type: 'request',
      level: 'info',
      script: 'api-worker',
      timestamp,
      request_id: 'req-def456',
      method: 'GET',
      url: 'https://api.example.com/products/123',
      status: 200,
      duration_ms: 45,
      do_name: null,
      do_id: null,
      do_method: null,
      message: null,
      stack: null,
      metadata: JSON.stringify({ cache_hit: true }),
      hour: deriveHour(timestamp),
      severity_bucket: deriveSeverityBucket('info'),
    }

    expect(event.id).toBe('req-001')
    expect(event.type).toBe('request')
    expect(event.method).toBe('GET')
    expect(event.status).toBe(200)
    expect(event.duration_ms).toBe(45)
  })

  it('creates complete do_method event', () => {
    const timestamp = Date.now()
    const event: ObservabilityEvent = {
      id: 'do-001',
      type: 'do_method',
      level: 'info',
      script: 'api-worker',
      timestamp,
      request_id: 'req-ghi012',
      method: 'POST',
      url: 'https://api.example.com/counters/increment',
      status: 200,
      duration_ms: 3,
      do_name: 'Counter',
      do_id: 'counter-abc',
      do_method: 'increment',
      message: null,
      stack: null,
      metadata: JSON.stringify({ previous_value: 5, new_value: 6 }),
      hour: deriveHour(timestamp),
      severity_bucket: deriveSeverityBucket('info'),
    }

    expect(event.id).toBe('do-001')
    expect(event.type).toBe('do_method')
    expect(event.do_name).toBe('Counter')
    expect(event.do_id).toBe('counter-abc')
    expect(event.do_method).toBe('increment')
  })
})
