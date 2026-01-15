/**
 * SQL Query Validation Tests
 *
 * TDD RED phase: Tests for SQL query validation in handleQueryEndpoint.
 * These tests verify that:
 * 1. SELECT queries are allowed
 * 2. UPDATE/DELETE/DROP/INSERT/ALTER are rejected
 * 3. SQL injection attempts are blocked
 * 4. Query depth/complexity limits are enforced
 * 5. Only allowed tables can be queried
 *
 * @see do-1zam - RED: SQL query validation tests
 * @see do-nj09 - GREEN: Implement SQL query validation
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Install WebSocket mock for test environment
import { installWebSocketMock } from './utils/websocket-mock'
installWebSocketMock()

import { EventStreamDO } from '../event-stream-do'

// ============================================================================
// MOCK DURABLE OBJECT STATE
// ============================================================================

const createMockState = () => {
  const storage = new Map<string, unknown>()
  const alarms: number[] = []

  return {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      deleteAll: vi.fn(async () => storage.clear()),
      list: vi.fn(async () => storage),
    },
    waitUntil: vi.fn(),
    setAlarm: vi.fn((timestamp: number) => alarms.push(timestamp)),
    getAlarm: vi.fn(async () => alarms[0]),
    deleteAlarm: vi.fn(async () => {
      alarms.length = 0
    }),
    getWebSockets: vi.fn(() => []),
    acceptWebSocket: vi.fn(),
    _storage: storage,
    _alarms: alarms,
  }
}

type MockState = ReturnType<typeof createMockState>

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Make a POST request to /query endpoint with SQL
 */
async function queryEndpoint(
  eventStreamDO: EventStreamDO,
  sql: string,
  params: unknown[] = []
): Promise<Response> {
  const request = new Request('https://test.api/query', {
    method: 'POST',
    body: JSON.stringify({ sql, params }),
    headers: { 'Content-Type': 'application/json' },
  })
  return eventStreamDO.fetch(request)
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('SQL Query Validation', () => {
  let mockState: MockState
  let eventStreamDO: EventStreamDO

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    eventStreamDO = new EventStreamDO(mockState)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Allowed queries (SELECT statements)', () => {
    it('allows basic SELECT query', async () => {
      const response = await queryEndpoint(eventStreamDO, 'SELECT * FROM events')
      expect(response.status).toBe(200)
    })

    it('allows SELECT with WHERE clause', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT * FROM events WHERE topic = $1',
        ['orders']
      )
      expect(response.status).toBe(200)
    })

    it('allows SELECT with ORDER BY', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT * FROM events ORDER BY timestamp DESC'
      )
      expect(response.status).toBe(200)
    })

    it('allows SELECT with LIMIT', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT * FROM events LIMIT 10'
      )
      expect(response.status).toBe(200)
    })

    it('allows SELECT with aggregate functions', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT COUNT(*), AVG(id) FROM events'
      )
      expect(response.status).toBe(200)
    })

    it('allows SELECT with JOIN on allowed tables', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT e.* FROM events e INNER JOIN sessions s ON e.session_id = s.id'
      )
      expect(response.status).toBe(200)
    })
  })

  describe('Blocked statements (UPDATE/DELETE/DROP/INSERT/ALTER)', () => {
    it('rejects UPDATE statement', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'UPDATE events SET topic = $1 WHERE id = $2',
        ['hacked', '123']
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toContain('UPDATE')
    })

    it('rejects DELETE statement', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'DELETE FROM events WHERE id = $1',
        ['123']
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toContain('DELETE')
    })

    it('rejects DROP TABLE statement', async () => {
      const response = await queryEndpoint(eventStreamDO, 'DROP TABLE events')
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toContain('DROP')
    })

    it('rejects INSERT statement', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        "INSERT INTO events (topic, data) VALUES ($1, $2)",
        ['evil', '{}']
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toContain('INSERT')
    })

    it('rejects ALTER TABLE statement', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'ALTER TABLE events ADD COLUMN evil TEXT'
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toContain('ALTER')
    })

    it('rejects TRUNCATE statement', async () => {
      const response = await queryEndpoint(eventStreamDO, 'TRUNCATE TABLE events')
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toContain('TRUNCATE')
    })

    it('rejects CREATE TABLE statement', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'CREATE TABLE evil (id INT)'
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/CREATE|not allowed/i)
    })

    it('rejects EXEC/EXECUTE statements', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        "EXEC sp_executesql N'DROP TABLE events'"
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/EXEC|not allowed/i)
    })
  })

  describe('SQL injection prevention', () => {
    it('blocks semicolon-based injection (DROP TABLE)', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        "SELECT * FROM events WHERE id = '1'; DROP TABLE events;"
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/multiple.*statement|DROP/i)
    })

    it('blocks UNION SELECT injection', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        "SELECT * FROM events WHERE id = '1' UNION SELECT * FROM users"
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/UNION|not allowed/i)
    })

    it('blocks UNION ALL SELECT injection', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        "SELECT * FROM events WHERE id = $1 UNION ALL SELECT password FROM users",
        ['1']
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/UNION|not allowed/i)
    })

    it('blocks comment-based injection (--)', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        "SELECT * FROM events WHERE id = '1'-- AND admin = false"
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/comment|not allowed/i)
    })

    it('blocks comment-based injection (/* */)', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        "SELECT * FROM events WHERE id = '1' /* bypass */ OR '1'='1'"
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/comment|not allowed/i)
    })

    it('blocks stacked queries (multiple statements)', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT * FROM events; DELETE FROM events;'
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/multiple|statement|DELETE/i)
    })

    it('blocks OR 1=1 injection pattern', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        "SELECT * FROM events WHERE id = '1' OR '1'='1'"
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/tautology|not allowed/i)
    })

    it('blocks hex-encoded injection attempts', async () => {
      // 0x44524F50 = DROP in hex
      const response = await queryEndpoint(
        eventStreamDO,
        "SELECT * FROM events WHERE id = 0x44524F50"
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/hex|not allowed/i)
    })

    it('blocks CHAR() function injection', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        "SELECT * FROM events WHERE id = CHAR(68,82,79,80)"
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/CHAR|not allowed/i)
    })

    it('blocks case-insensitive dangerous keywords', async () => {
      const response = await queryEndpoint(eventStreamDO, 'dRoP tAbLe events')
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/DROP|not allowed/i)
    })

    it('blocks encoded whitespace bypass attempts', async () => {
      // Using tab character instead of space
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT\t*\tFROM\tevents;\tDROP\tTABLE\tevents'
      )
      expect(response.status).toBe(400)
    })
  })

  describe('Query complexity/depth limits', () => {
    it('rejects queries with too many nested subqueries', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        `SELECT * FROM events WHERE id IN (
          SELECT id FROM events WHERE id IN (
            SELECT id FROM events WHERE id IN (
              SELECT id FROM events WHERE id IN (
                SELECT id FROM events WHERE id IN (
                  SELECT id FROM events
                )
              )
            )
          )
        )`
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/depth|nested|limit/i)
    })

    it('rejects excessively long queries', async () => {
      // Create a very long query string (over 10KB)
      const longCondition = Array(1000).fill("id = '1234567890'").join(' OR ')
      const response = await queryEndpoint(
        eventStreamDO,
        `SELECT * FROM events WHERE ${longCondition}`
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/length|limit/i)
    })

    it('rejects queries with too many JOINs', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        `SELECT * FROM events e1
         JOIN events e2 ON e1.id = e2.id
         JOIN events e3 ON e2.id = e3.id
         JOIN events e4 ON e3.id = e4.id
         JOIN events e5 ON e4.id = e5.id
         JOIN events e6 ON e5.id = e6.id
         JOIN events e7 ON e6.id = e7.id`
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/join|limit/i)
    })
  })

  describe('Table allowlist validation', () => {
    it('rejects queries on non-allowed tables', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT * FROM users'
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/table|users|not allowed/i)
    })

    it('rejects queries accessing system tables', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT * FROM sqlite_master'
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/table|sqlite_master|not allowed/i)
    })

    it('rejects queries accessing pg_catalog', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT * FROM pg_catalog.pg_tables'
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/table|pg_catalog|not allowed/i)
    })

    it('rejects information_schema queries', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT * FROM information_schema.tables'
      )
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/table|information_schema|not allowed/i)
    })

    it('allows queries on events table', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT * FROM events'
      )
      expect(response.status).toBe(200)
    })

    it('allows queries on sessions table', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        'SELECT * FROM sessions'
      )
      expect(response.status).toBe(200)
    })
  })

  describe('Edge cases', () => {
    it('rejects empty SQL string', async () => {
      const response = await queryEndpoint(eventStreamDO, '')
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/empty|required/i)
    })

    it('rejects whitespace-only SQL string', async () => {
      const response = await queryEndpoint(eventStreamDO, '   \t\n  ')
      expect(response.status).toBe(400)
      const body = await response.json() as { error: string }
      expect(body.error).toMatch(/empty|required/i)
    })

    it('rejects SQL with only comments', async () => {
      const response = await queryEndpoint(
        eventStreamDO,
        '-- this is just a comment'
      )
      expect(response.status).toBe(400)
    })

    it('handles null SQL parameter', async () => {
      const request = new Request('https://test.api/query', {
        method: 'POST',
        body: JSON.stringify({ sql: null }),
        headers: { 'Content-Type': 'application/json' },
      })
      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })

    it('handles missing SQL parameter', async () => {
      const request = new Request('https://test.api/query', {
        method: 'POST',
        body: JSON.stringify({ params: [] }),
        headers: { 'Content-Type': 'application/json' },
      })
      const response = await eventStreamDO.fetch(request)
      expect(response.status).toBe(400)
    })
  })
})
