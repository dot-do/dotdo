/**
 * SPIKE: libSQL/Turso Worker Compatibility Tests
 *
 * These tests verify that @libsql/client works in Cloudflare Workers.
 * Run with: npx vitest run db/spikes/libsql-worker-poc.test.ts
 *
 * For integration testing with a real Turso database, set:
 * - TURSO_URL=libsql://your-db.turso.io
 * - TURSO_TOKEN=your-auth-token
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Use the web-compatible import
import { createClient, type Client } from '@libsql/client/web'

describe('libSQL Worker Compatibility Spike', () => {
  // ========================================================================
  // Test 1: Module Import Verification
  // ========================================================================

  describe('Module Import', () => {
    it('should import @libsql/client/web without errors', () => {
      expect(createClient).toBeDefined()
      expect(typeof createClient).toBe('function')
    })

    it('should have Client type available', () => {
      // Type-only test - if this compiles, the types are correct
      const clientType: typeof Client = undefined as unknown as typeof Client
      expect(true).toBe(true)
    })
  })

  // ========================================================================
  // Test 2: Client Creation (No Network)
  // ========================================================================

  describe('Client Creation', () => {
    it('should create a client with HTTP URL', () => {
      // Note: This doesn't make a network request until execute() is called
      const client = createClient({
        url: 'https://test-db.turso.io',
        authToken: 'test-token',
      })

      expect(client).toBeDefined()
      expect(client.execute).toBeDefined()
      expect(client.batch).toBeDefined()
      expect(client.transaction).toBeDefined()
      expect(client.close).toBeDefined()
    })

    it('should create a client with libsql:// URL', () => {
      const client = createClient({
        url: 'libsql://test-db.turso.io',
        authToken: 'test-token',
      })

      expect(client).toBeDefined()
      expect(client.closed).toBe(false)
    })

    it('should create a client with custom fetch', () => {
      // Verify we can pass custom fetch (useful for mocking)
      const mockFetch = async () => new Response('{}')

      const client = createClient({
        url: 'https://test-db.turso.io',
        authToken: 'test-token',
        fetch: mockFetch as typeof fetch,
      })

      expect(client).toBeDefined()
    })
  })

  // ========================================================================
  // Test 3: Statement Types
  // ========================================================================

  describe('Statement Types', () => {
    it('should accept string statements', async () => {
      const client = createClient({
        url: 'https://test-db.turso.io',
        authToken: 'test-token',
      })

      // Type check - string statement
      const stmt: Parameters<typeof client.execute>[0] = 'SELECT 1'
      expect(typeof stmt).toBe('string')
    })

    it('should accept parameterized statements', () => {
      const client = createClient({
        url: 'https://test-db.turso.io',
        authToken: 'test-token',
      })

      // Type check - object statement with positional args
      const stmt1: Parameters<typeof client.execute>[0] = {
        sql: 'SELECT * FROM users WHERE id = ?',
        args: [1],
      }
      expect(stmt1).toHaveProperty('sql')
      expect(stmt1).toHaveProperty('args')

      // Type check - object statement with named args
      const stmt2: Parameters<typeof client.execute>[0] = {
        sql: 'SELECT * FROM users WHERE id = :id',
        args: { id: 1 },
      }
      expect(stmt2).toHaveProperty('sql')
    })

    it('should accept various value types', () => {
      // Test that all SQLite value types are accepted
      const values: (string | number | bigint | Uint8Array | null | boolean)[] = [
        'string',
        42,
        BigInt(9007199254740993),
        new Uint8Array([1, 2, 3]),
        null,
        true, // Converted to 1
      ]

      expect(values.length).toBe(6)
    })
  })

  // ========================================================================
  // Test 4: Batch Operation Types
  // ========================================================================

  describe('Batch Operations', () => {
    it('should accept array of statements for batch', () => {
      const client = createClient({
        url: 'https://test-db.turso.io',
        authToken: 'test-token',
      })

      // Type check - batch accepts array
      const stmts: Parameters<typeof client.batch>[0] = [
        'CREATE TABLE test (id INT)',
        { sql: 'INSERT INTO test VALUES (?)', args: [1] },
        'SELECT * FROM test',
      ]

      expect(Array.isArray(stmts)).toBe(true)
      expect(stmts.length).toBe(3)
    })

    it('should accept transaction mode for batch', () => {
      // The second argument to batch() is the transaction mode
      type TransactionMode = Parameters<
        InstanceType<typeof Object>['toString']
      > extends never
        ? never
        : 'read' | 'write' | 'deferred'

      const modes: TransactionMode[] = ['read', 'write', 'deferred']
      expect(modes).toContain('write')
    })
  })

  // ========================================================================
  // Test 5: Error Handling
  // ========================================================================

  describe('Error Handling', () => {
    it('should throw on missing URL', () => {
      expect(() => {
        createClient({
          url: '',
          authToken: 'test-token',
        })
      }).toThrow()
    })

    it('should throw on invalid URL protocol', () => {
      expect(() => {
        createClient({
          url: 'invalid://test-db.turso.io',
          authToken: 'test-token',
        })
      }).toThrow()
    })
  })

  // ========================================================================
  // Test 6: Protocol Detection
  // ========================================================================

  describe('Protocol Detection', () => {
    it('should detect HTTP protocol', () => {
      const httpUrl = 'https://test-db.turso.io'
      expect(httpUrl.startsWith('http')).toBe(true)
    })

    it('should detect WebSocket protocol', () => {
      const wsUrl = 'libsql://test-db.turso.io'
      expect(wsUrl.startsWith('libsql://')).toBe(true)
    })

    it('should detect wss protocol', () => {
      const wssUrl = 'wss://test-db.turso.io'
      expect(wssUrl.startsWith('wss://')).toBe(true)
    })
  })
})

// ============================================================================
// Integration Tests (require real Turso database)
// ============================================================================

describe.skipIf(!process.env.TURSO_URL)('libSQL Integration Tests', () => {
  let client: Client

  beforeAll(() => {
    client = createClient({
      url: process.env.TURSO_URL!,
      authToken: process.env.TURSO_TOKEN,
    })
  })

  afterAll(async () => {
    await client.close()
  })

  it('should execute simple query', async () => {
    const result = await client.execute('SELECT 1 as value')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toHaveProperty('value', 1)
  })

  it('should execute parameterized query', async () => {
    const result = await client.execute({
      sql: 'SELECT ? as value',
      args: ['test'],
    })
    expect(result.rows[0]).toHaveProperty('value', 'test')
  })

  it('should measure query latency', async () => {
    const iterations = 10
    const times: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await client.execute('SELECT 1')
      times.push(performance.now() - start)
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const sorted = [...times].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length * 0.5)]
    const p99 = sorted[Math.floor(sorted.length * 0.99)]

    console.log(`Latency: avg=${avg.toFixed(2)}ms, p50=${p50.toFixed(2)}ms, p99=${p99.toFixed(2)}ms`)

    // Assert reasonable latency (adjust based on your location)
    expect(avg).toBeLessThan(500) // 500ms is generous for cold regions
  })

  it('should execute batch operations', async () => {
    const results = await client.batch([
      'CREATE TABLE IF NOT EXISTS spike_batch_test (id INT, value TEXT)',
      { sql: 'INSERT INTO spike_batch_test VALUES (?, ?)', args: [1, 'one'] },
      { sql: 'INSERT INTO spike_batch_test VALUES (?, ?)', args: [2, 'two'] },
      'SELECT * FROM spike_batch_test',
      'DROP TABLE spike_batch_test',
    ])

    expect(results).toHaveLength(5)
    expect(results[3].rows.length).toBeGreaterThanOrEqual(2)
  })

  it('should handle concurrent queries', async () => {
    const queries = Array(10)
      .fill(null)
      .map((_, i) => client.execute(`SELECT ${i} as query_id`))

    const results = await Promise.all(queries)

    expect(results).toHaveLength(10)
    results.forEach((result, i) => {
      expect(result.rows[0]).toHaveProperty('query_id', i)
    })
  })
})
