/**
 * @dotdo/neon - Neon SDK compat tests
 *
 * Tests for @neondatabase/serverless API compatibility backed by DO SQLite:
 * - neon() - SQL template tag function
 * - Pool - Connection pooling (pg-compatible)
 * - Client - Single connection (pg-compatible)
 * - neonConfig - Configuration options
 * - Transactions - Transaction batching
 * - Error handling - NeonDbError
 *
 * @see https://neon.tech/docs/serverless/serverless-driver
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import {
  neon,
  neonConfig,
  Pool,
  Client,
  NeonDbError,
  types,
  resetDatabase,
} from './index'

// Reset the database before all tests to ensure clean state
beforeAll(() => {
  resetDatabase()
})

// ============================================================================
// NEON FUNCTION TESTS - SQL TEMPLATE TAG
// ============================================================================

describe('neon()', () => {
  describe('creation', () => {
    it('should create sql function from connection string', () => {
      const sql = neon('postgres://user:pass@localhost:5432/mydb')
      expect(sql).toBeDefined()
      expect(typeof sql).toBe('function')
    })

    it('should create sql function from neon URL', () => {
      const sql = neon('postgres://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/mydb')
      expect(sql).toBeDefined()
    })

    it('should create sql function with options', () => {
      const sql = neon('postgres://localhost/mydb', {
        fetchOptions: { cache: 'no-store' },
      })
      expect(sql).toBeDefined()
    })

    it('should create sql function with fullResults option', () => {
      const sql = neon('postgres://localhost/mydb', {
        fullResults: true,
      })
      expect(sql).toBeDefined()
    })

    it('should create sql function with arrayMode option', () => {
      const sql = neon('postgres://localhost/mydb', {
        arrayMode: true,
      })
      expect(sql).toBeDefined()
    })
  })

  describe('template tag queries', () => {
    let sql: ReturnType<typeof neon>

    beforeEach(() => {
      sql = neon('postgres://localhost/mydb')
    })

    it('should execute simple SELECT with template tag', async () => {
      // First create table and insert data
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
      await sql`DELETE FROM users`
      await sql`INSERT INTO users (id, name) VALUES (1, 'Alice')`

      const result = await sql`SELECT * FROM users WHERE id = 1`
      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
    })

    it('should interpolate values safely', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
      await sql`DELETE FROM users`

      const id = 1
      const name = 'Alice'
      await sql`INSERT INTO users (id, name) VALUES (${id}, ${name})`

      const result = await sql`SELECT * FROM users WHERE id = ${id}`
      expect(result[0].name).toBe('Alice')
    })

    it('should handle string interpolation', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
      await sql`DELETE FROM users`
      await sql`INSERT INTO users (id, name) VALUES (1, 'Alice')`

      const searchName = 'Alice'
      const result = await sql`SELECT * FROM users WHERE name = ${searchName}`
      expect(result.length).toBe(1)
    })

    it('should handle number interpolation', async () => {
      await sql`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, price REAL)`
      await sql`DELETE FROM products`
      await sql`INSERT INTO products (id, price) VALUES (1, 19.99)`

      const minPrice = 10.0
      const result = await sql`SELECT * FROM products WHERE price > ${minPrice}`
      expect(result.length).toBe(1)
    })

    it('should handle boolean interpolation', async () => {
      await sql`CREATE TABLE IF NOT EXISTS flags (id INTEGER PRIMARY KEY, active BOOLEAN)`
      await sql`DELETE FROM flags`
      await sql`INSERT INTO flags (id, active) VALUES (1, TRUE)`

      const active = true
      const result = await sql`SELECT * FROM flags WHERE active = ${active}`
      expect(result.length).toBe(1)
    })

    it('should handle null interpolation', async () => {
      await sql`CREATE TABLE IF NOT EXISTS nullable (id INTEGER PRIMARY KEY, value TEXT)`
      await sql`DELETE FROM nullable`
      await sql`INSERT INTO nullable (id, value) VALUES (1, NULL)`

      const result = await sql`SELECT * FROM nullable WHERE value IS NULL`
      expect(result.length).toBe(1)
    })

    it('should handle multiple interpolations', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)`
      await sql`DELETE FROM users`

      const id = 1
      const name = 'Alice'
      const age = 30
      await sql`INSERT INTO users (id, name, age) VALUES (${id}, ${name}, ${age})`

      const result = await sql`SELECT * FROM users WHERE id = ${id}`
      expect(result[0].name).toBe('Alice')
      expect(result[0].age).toBe(30)
    })

    it('should return rows array by default', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
      await sql`DELETE FROM users`
      await sql`INSERT INTO users (id, name) VALUES (1, 'Alice')`

      const result = await sql`SELECT * FROM users`
      expect(Array.isArray(result)).toBe(true)
      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('name')
    })

    it('should return empty array for no results', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
      await sql`DELETE FROM users`

      const result = await sql`SELECT * FROM users WHERE id = 999`
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })
  })

  describe('fullResults mode', () => {
    let sql: ReturnType<typeof neon>

    beforeEach(() => {
      sql = neon('postgres://localhost/mydb', { fullResults: true })
    })

    it('should return full result object with rows', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
      await sql`DELETE FROM users`
      await sql`INSERT INTO users (id, name) VALUES (1, 'Alice')`

      const result = await sql`SELECT * FROM users`
      expect(result).toHaveProperty('rows')
      expect(Array.isArray(result.rows)).toBe(true)
    })

    it('should return fields in full result', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`

      const result = await sql`SELECT * FROM users LIMIT 1`
      expect(result).toHaveProperty('fields')
      expect(Array.isArray(result.fields)).toBe(true)
    })

    it('should return rowCount in full result', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
      await sql`DELETE FROM users`
      await sql`INSERT INTO users (id, name) VALUES (1, 'Alice')`
      await sql`INSERT INTO users (id, name) VALUES (2, 'Bob')`

      const result = await sql`SELECT * FROM users`
      expect(result).toHaveProperty('rowCount')
    })

    it('should return command in full result', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`

      const result = await sql`SELECT * FROM users`
      expect(result).toHaveProperty('command')
      expect(result.command).toBe('SELECT')
    })
  })

  describe('arrayMode', () => {
    let sql: ReturnType<typeof neon>

    beforeEach(() => {
      sql = neon('postgres://localhost/mydb', { arrayMode: true })
    })

    it('should return rows as arrays', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
      await sql`DELETE FROM users`
      await sql`INSERT INTO users (id, name) VALUES (1, 'Alice')`

      const result = await sql`SELECT * FROM users`
      expect(Array.isArray(result)).toBe(true)
      expect(Array.isArray(result[0])).toBe(true)
    })

    it('should maintain column order in array', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)`
      await sql`DELETE FROM users`
      await sql`INSERT INTO users (id, name, age) VALUES (1, 'Alice', 30)`

      const result = await sql`SELECT id, name, age FROM users`
      expect(result[0][0]).toBe(1)
      expect(result[0][1]).toBe('Alice')
      expect(result[0][2]).toBe(30)
    })
  })
})

// ============================================================================
// PARAMETERIZED QUERIES
// ============================================================================

describe('parameterized queries', () => {
  let sql: ReturnType<typeof neon>

  beforeEach(() => {
    sql = neon('postgres://localhost/mydb')
  })

  it('should support sql() function call style', async () => {
    await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
    await sql`DELETE FROM users`
    await sql`INSERT INTO users (id, name) VALUES (1, 'Alice')`

    const result = await sql('SELECT * FROM users WHERE id = $1', [1])
    expect(result[0].name).toBe('Alice')
  })

  it('should support multiple parameters', async () => {
    await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)`
    await sql`DELETE FROM users`
    await sql`INSERT INTO users (id, name, age) VALUES (1, 'Alice', 30)`
    await sql`INSERT INTO users (id, name, age) VALUES (2, 'Bob', 25)`

    const result = await sql('SELECT * FROM users WHERE age > $1 AND age < $2', [20, 35])
    expect(result.length).toBe(2)
  })

  it('should handle INSERT with parameters', async () => {
    await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
    await sql`DELETE FROM users`

    await sql('INSERT INTO users (id, name) VALUES ($1, $2)', [1, 'Alice'])
    const result = await sql`SELECT * FROM users WHERE id = 1`
    expect(result[0].name).toBe('Alice')
  })

  it('should handle UPDATE with parameters', async () => {
    await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
    await sql`DELETE FROM users`
    await sql`INSERT INTO users (id, name) VALUES (1, 'Alice')`

    await sql('UPDATE users SET name = $1 WHERE id = $2', ['Alicia', 1])
    const result = await sql`SELECT * FROM users WHERE id = 1`
    expect(result[0].name).toBe('Alicia')
  })

  it('should handle DELETE with parameters', async () => {
    await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
    await sql`DELETE FROM users`
    await sql`INSERT INTO users (id, name) VALUES (1, 'Alice')`

    await sql('DELETE FROM users WHERE id = $1', [1])
    const result = await sql`SELECT * FROM users`
    expect(result.length).toBe(0)
  })

  it('should escape SQL injection attempts', async () => {
    await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
    await sql`DELETE FROM users`
    await sql`INSERT INTO users (id, name) VALUES (1, 'Alice')`

    // This should be safely escaped, not executed as SQL
    const maliciousInput = "'; DROP TABLE users; --"
    const result = await sql`SELECT * FROM users WHERE name = ${maliciousInput}`
    expect(result.length).toBe(0) // No match, but table should still exist

    // Verify table still exists
    const verify = await sql`SELECT * FROM users`
    expect(verify.length).toBe(1)
  })
})

// ============================================================================
// POOL TESTS
// ============================================================================

describe('Pool', () => {
  describe('constructor', () => {
    it('should create pool with connection string', () => {
      const pool = new Pool({ connectionString: 'postgres://localhost/mydb' })
      expect(pool).toBeDefined()
    })

    it('should create pool with config object', () => {
      const pool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        user: 'postgres',
        password: 'secret',
      })
      expect(pool).toBeDefined()
    })

    it('should create pool with max connections', () => {
      const pool = new Pool({
        connectionString: 'postgres://localhost/mydb',
        max: 20,
      })
      expect(pool).toBeDefined()
    })
  })

  describe('pool.query', () => {
    let pool: Pool

    beforeEach(() => {
      pool = new Pool({ connectionString: 'postgres://localhost/mydb' })
    })

    afterEach(async () => {
      await pool.end()
    })

    it('should execute query', async () => {
      const result = await pool.query('SELECT 1 as num')
      expect(result.rows).toBeDefined()
    })

    it('should execute parameterized query', async () => {
      await pool.query('CREATE TABLE IF NOT EXISTS users (id INTEGER, name TEXT)')
      await pool.query('DELETE FROM users')
      await pool.query('INSERT INTO users VALUES ($1, $2)', [1, 'Alice'])

      const result = await pool.query('SELECT * FROM users WHERE id = $1', [1])
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should return QueryResult structure', async () => {
      const result = await pool.query('SELECT 1 as num')
      expect(result).toHaveProperty('rows')
      expect(result).toHaveProperty('fields')
      expect(result).toHaveProperty('rowCount')
      expect(result).toHaveProperty('command')
    })
  })

  describe('pool.connect', () => {
    let pool: Pool

    beforeEach(() => {
      pool = new Pool({ connectionString: 'postgres://localhost/mydb', max: 2 })
    })

    afterEach(async () => {
      await pool.end()
    })

    it('should checkout client', async () => {
      const client = await pool.connect()
      expect(client).toBeDefined()
      client.release()
    })

    it('should allow queries on checked-out client', async () => {
      const client = await pool.connect()
      const result = await client.query('SELECT 1 as num')
      expect(result.rows[0].num).toBe(1)
      client.release()
    })

    it('should support transactions with checkout', async () => {
      await pool.query('CREATE TABLE IF NOT EXISTS accounts (id INTEGER, balance INTEGER)')
      await pool.query('DELETE FROM accounts')
      await pool.query('INSERT INTO accounts VALUES (1, 100)')

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('UPDATE accounts SET balance = 50 WHERE id = 1')
        await client.query('COMMIT')
      } finally {
        client.release()
      }

      const result = await pool.query('SELECT balance FROM accounts WHERE id = 1')
      expect(result.rows[0].balance).toBe(50)
    })
  })

  describe('pool.end', () => {
    it('should end pool', async () => {
      const pool = new Pool({ connectionString: 'postgres://localhost/mydb' })
      await pool.end()
      expect(pool.ended).toBe(true)
    })
  })
})

// ============================================================================
// CLIENT TESTS
// ============================================================================

describe('Client', () => {
  describe('constructor', () => {
    it('should create client with connection string', () => {
      const client = new Client('postgres://localhost/mydb')
      expect(client).toBeDefined()
    })

    it('should create client with config object', () => {
      const client = new Client({
        host: 'localhost',
        database: 'mydb',
      })
      expect(client).toBeDefined()
    })
  })

  describe('client.connect and client.end', () => {
    it('should connect and end', async () => {
      const client = new Client('postgres://localhost/mydb')
      await client.connect()
      await client.end()
    })
  })

  describe('client.query', () => {
    let client: Client

    beforeEach(async () => {
      client = new Client('postgres://localhost/mydb')
      await client.connect()
    })

    afterEach(async () => {
      await client.end()
    })

    it('should execute query', async () => {
      const result = await client.query('SELECT 1 as num')
      expect(result.rows[0].num).toBe(1)
    })

    it('should execute parameterized query', async () => {
      await client.query('CREATE TABLE IF NOT EXISTS users (id INTEGER, name TEXT)')
      await client.query('DELETE FROM users')
      await client.query('INSERT INTO users VALUES ($1, $2)', [1, 'Alice'])

      const result = await client.query('SELECT * FROM users WHERE id = $1', [1])
      expect(result.rows[0].name).toBe('Alice')
    })
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('transactions', () => {
  describe('sql.transaction()', () => {
    let sql: ReturnType<typeof neon>

    beforeEach(() => {
      sql = neon('postgres://localhost/mydb')
    })

    it('should execute transaction with array of queries', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
      await sql`DELETE FROM users`

      const results = await sql.transaction([
        sql`INSERT INTO users (id, name) VALUES (1, 'Alice')`,
        sql`INSERT INTO users (id, name) VALUES (2, 'Bob')`,
      ])

      expect(Array.isArray(results)).toBe(true)

      const verify = await sql`SELECT * FROM users ORDER BY id`
      expect(verify.length).toBe(2)
    })

    it('should rollback on error in transaction', async () => {
      await sql`CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, balance INTEGER)`
      await sql`DELETE FROM accounts`
      await sql`INSERT INTO accounts (id, balance) VALUES (1, 100)`

      // Use callback style for proper transaction semantics
      // Array style doesn't work because template tags execute immediately
      try {
        await sql.transaction(async (tx) => {
          await tx`UPDATE accounts SET balance = 50 WHERE id = 1`
          await tx`UPDATE nonexistent_table SET value = 1` // This should fail
        })
      } catch (e) {
        // Expected error
      }

      // Balance should be unchanged due to rollback
      const result = await sql`SELECT balance FROM accounts WHERE id = 1`
      expect(result[0].balance).toBe(100)
    })

    it('should support transaction callback style', async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`
      await sql`DELETE FROM users`

      await sql.transaction(async (tx) => {
        await tx`INSERT INTO users (id, name) VALUES (1, 'Alice')`
        await tx`INSERT INTO users (id, name) VALUES (2, 'Bob')`
      })

      const result = await sql`SELECT * FROM users ORDER BY id`
      expect(result.length).toBe(2)
    })

    it('should rollback callback transaction on error', async () => {
      await sql`CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, balance INTEGER)`
      await sql`DELETE FROM accounts`
      await sql`INSERT INTO accounts (id, balance) VALUES (1, 100)`

      try {
        await sql.transaction(async (tx) => {
          await tx`UPDATE accounts SET balance = 50 WHERE id = 1`
          throw new Error('Simulated error')
        })
      } catch (e) {
        // Expected error
      }

      const result = await sql`SELECT balance FROM accounts WHERE id = 1`
      expect(result[0].balance).toBe(100)
    })
  })
})

// ============================================================================
// NEON CONFIG TESTS
// ============================================================================

describe('neonConfig', () => {
  it('should have fetchConnectionCache option', () => {
    expect(neonConfig).toHaveProperty('fetchConnectionCache')
  })

  it('should have poolQueryViaFetch option', () => {
    expect(neonConfig).toHaveProperty('poolQueryViaFetch')
  })

  it('should have fetchEndpoint option', () => {
    expect(neonConfig).toHaveProperty('fetchEndpoint')
  })

  it('should allow setting fetchConnectionCache', () => {
    const originalValue = neonConfig.fetchConnectionCache
    neonConfig.fetchConnectionCache = true
    expect(neonConfig.fetchConnectionCache).toBe(true)
    neonConfig.fetchConnectionCache = originalValue
  })

  it('should allow setting poolQueryViaFetch', () => {
    const originalValue = neonConfig.poolQueryViaFetch
    neonConfig.poolQueryViaFetch = true
    expect(neonConfig.poolQueryViaFetch).toBe(true)
    neonConfig.poolQueryViaFetch = originalValue
  })

  it('should allow setting custom fetchEndpoint', () => {
    const originalValue = neonConfig.fetchEndpoint
    neonConfig.fetchEndpoint = (host, port, options) => `https://custom.endpoint.com`
    expect(typeof neonConfig.fetchEndpoint).toBe('function')
    neonConfig.fetchEndpoint = originalValue
  })

  it('should have wsProxy option', () => {
    expect(neonConfig).toHaveProperty('wsProxy')
  })

  it('should have useSecureWebSocket option', () => {
    expect(neonConfig).toHaveProperty('useSecureWebSocket')
  })

  it('should have pipelineConnect option', () => {
    expect(neonConfig).toHaveProperty('pipelineConnect')
  })

  it('should have coalesceWrites option', () => {
    expect(neonConfig).toHaveProperty('coalesceWrites')
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('error handling', () => {
  let sql: ReturnType<typeof neon>

  beforeEach(() => {
    sql = neon('postgres://localhost/mydb')
  })

  it('should throw NeonDbError on syntax error', async () => {
    try {
      await sql`INVALID SQL QUERY`
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(NeonDbError)
    }
  })

  it('should throw NeonDbError on table not found', async () => {
    try {
      await sql`SELECT * FROM nonexistent_table_xyz`
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(NeonDbError)
      expect((e as NeonDbError).code).toBe('42P01')
    }
  })

  it('should throw NeonDbError on constraint violation', async () => {
    await sql`CREATE TABLE IF NOT EXISTS unique_test (id INTEGER PRIMARY KEY)`
    await sql`DELETE FROM unique_test`
    await sql`INSERT INTO unique_test (id) VALUES (1)`

    try {
      await sql`INSERT INTO unique_test (id) VALUES (1)`
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(NeonDbError)
      expect((e as NeonDbError).code).toBe('23505')
    }
  })

  it('should include error code in NeonDbError', async () => {
    try {
      await sql`SELECT * FROM nonexistent_table_abc`
    } catch (e) {
      expect(e).toBeInstanceOf(NeonDbError)
      expect((e as NeonDbError).code).toBeDefined()
    }
  })

  it('should include error message in NeonDbError', async () => {
    try {
      await sql`INVALID QUERY`
    } catch (e) {
      expect(e).toBeInstanceOf(NeonDbError)
      expect((e as NeonDbError).message).toBeDefined()
      expect((e as NeonDbError).message.length).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// TYPE COERCION TESTS
// ============================================================================

describe('type coercion', () => {
  let sql: ReturnType<typeof neon>

  beforeEach(() => {
    sql = neon('postgres://localhost/mydb')
  })

  it('should handle INTEGER type', async () => {
    await sql`CREATE TABLE IF NOT EXISTS int_test (val INTEGER)`
    await sql`DELETE FROM int_test`
    await sql`INSERT INTO int_test VALUES (${42})`

    const result = await sql`SELECT * FROM int_test`
    expect(typeof result[0].val).toBe('number')
    expect(result[0].val).toBe(42)
  })

  it('should handle REAL/FLOAT type', async () => {
    await sql`CREATE TABLE IF NOT EXISTS float_test (val REAL)`
    await sql`DELETE FROM float_test`
    await sql`INSERT INTO float_test VALUES (${3.14159})`

    const result = await sql`SELECT * FROM float_test`
    expect(typeof result[0].val).toBe('number')
    expect(result[0].val).toBeCloseTo(3.14159)
  })

  it('should handle TEXT type', async () => {
    await sql`CREATE TABLE IF NOT EXISTS text_test (val TEXT)`
    await sql`DELETE FROM text_test`
    await sql`INSERT INTO text_test VALUES (${'hello world'})`

    const result = await sql`SELECT * FROM text_test`
    expect(typeof result[0].val).toBe('string')
    expect(result[0].val).toBe('hello world')
  })

  it('should handle BOOLEAN type', async () => {
    await sql`CREATE TABLE IF NOT EXISTS bool_test (val BOOLEAN)`
    await sql`DELETE FROM bool_test`
    await sql`INSERT INTO bool_test VALUES (${true})`

    const result = await sql`SELECT * FROM bool_test`
    expect(result[0].val).toBe(true)
  })

  it('should handle NULL values', async () => {
    await sql`CREATE TABLE IF NOT EXISTS null_test (val TEXT)`
    await sql`DELETE FROM null_test`
    await sql`INSERT INTO null_test VALUES (${null})`

    const result = await sql`SELECT * FROM null_test`
    expect(result[0].val).toBeNull()
  })

  it('should handle Date objects', async () => {
    await sql`CREATE TABLE IF NOT EXISTS date_test (val TEXT)`
    await sql`DELETE FROM date_test`

    const date = new Date('2024-01-15T12:00:00Z')
    await sql`INSERT INTO date_test VALUES (${date.toISOString()})`

    const result = await sql`SELECT * FROM date_test`
    expect(result[0].val).toBe('2024-01-15T12:00:00.000Z')
  })

  it('should handle JSON objects', async () => {
    await sql`CREATE TABLE IF NOT EXISTS json_test (val TEXT)`
    await sql`DELETE FROM json_test`

    const obj = { name: 'Alice', age: 30 }
    await sql`INSERT INTO json_test VALUES (${JSON.stringify(obj)})`

    const result = await sql`SELECT * FROM json_test`
    expect(JSON.parse(result[0].val)).toEqual(obj)
  })

  it('should handle arrays as JSON', async () => {
    await sql`CREATE TABLE IF NOT EXISTS array_test (val TEXT)`
    await sql`DELETE FROM array_test`

    const arr = [1, 2, 3, 4, 5]
    await sql`INSERT INTO array_test VALUES (${JSON.stringify(arr)})`

    const result = await sql`SELECT * FROM array_test`
    expect(JSON.parse(result[0].val)).toEqual(arr)
  })
})

// ============================================================================
// TYPES EXPORT TESTS
// ============================================================================

describe('types', () => {
  it('should export type constants', () => {
    expect(types).toBeDefined()
    expect(types.BOOL).toBeDefined()
    expect(types.INT4).toBeDefined()
    expect(types.TEXT).toBeDefined()
    expect(types.JSON).toBeDefined()
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('integration', () => {
  let sql: ReturnType<typeof neon>

  beforeEach(() => {
    sql = neon('postgres://localhost/mydb')
  })

  it('should work with realistic CRUD workflow', async () => {
    // Create table
    await sql`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT,
      price REAL,
      in_stock BOOLEAN
    )`
    await sql`DELETE FROM products`

    // Insert
    const id = 1
    const name = 'Widget'
    const price = 29.99
    const inStock = true
    await sql`INSERT INTO products (id, name, price, in_stock) VALUES (${id}, ${name}, ${price}, ${inStock})`

    // Read
    const products = await sql`SELECT * FROM products WHERE id = ${id}`
    expect(products[0].name).toBe('Widget')
    expect(products[0].price).toBeCloseTo(29.99)
    expect(products[0].in_stock).toBe(true)

    // Update
    const newPrice = 24.99
    await sql`UPDATE products SET price = ${newPrice} WHERE id = ${id}`
    const updated = await sql`SELECT * FROM products WHERE id = ${id}`
    expect(updated[0].price).toBeCloseTo(24.99)

    // Delete
    await sql`DELETE FROM products WHERE id = ${id}`
    const deleted = await sql`SELECT * FROM products WHERE id = ${id}`
    expect(deleted.length).toBe(0)
  })

  it('should handle concurrent operations', async () => {
    await sql`CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, count INTEGER)`
    await sql`DELETE FROM counter`
    await sql`INSERT INTO counter (id, count) VALUES (1, 0)`

    // Simulate concurrent increments
    const increments = Array.from({ length: 5 }, async (_, i) => {
      const current = await sql`SELECT count FROM counter WHERE id = 1`
      const newCount = current[0].count + 1
      await sql`UPDATE counter SET count = ${newCount} WHERE id = 1`
    })

    await Promise.all(increments)

    const final = await sql`SELECT count FROM counter WHERE id = 1`
    // Note: Without proper locking, this might not be exactly 5
    expect(final[0].count).toBeGreaterThan(0)
  })

  it('should work with Pool for connection reuse', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost/mydb' })

    await pool.query('CREATE TABLE IF NOT EXISTS pool_test (id INTEGER, value TEXT)')
    await pool.query('DELETE FROM pool_test')

    // Multiple queries using pool
    await Promise.all([
      pool.query('INSERT INTO pool_test VALUES ($1, $2)', [1, 'one']),
      pool.query('INSERT INTO pool_test VALUES ($1, $2)', [2, 'two']),
      pool.query('INSERT INTO pool_test VALUES ($1, $2)', [3, 'three']),
    ])

    const result = await pool.query('SELECT * FROM pool_test ORDER BY id')
    expect(result.rows.length).toBe(3)

    await pool.end()
  })
})

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('edge cases', () => {
  let sql: ReturnType<typeof neon>

  beforeEach(() => {
    sql = neon('postgres://localhost/mydb')
  })

  it('should handle empty strings', async () => {
    await sql`CREATE TABLE IF NOT EXISTS empty_test (val TEXT)`
    await sql`DELETE FROM empty_test`
    await sql`INSERT INTO empty_test VALUES (${''})`

    const result = await sql`SELECT * FROM empty_test`
    expect(result[0].val).toBe('')
  })

  it('should handle special characters in strings', async () => {
    await sql`CREATE TABLE IF NOT EXISTS special_test (val TEXT)`
    await sql`DELETE FROM special_test`

    const special = "Hello 'World' with \"quotes\" and \\ backslash"
    await sql`INSERT INTO special_test VALUES (${special})`

    const result = await sql`SELECT * FROM special_test`
    expect(result[0].val).toBe(special)
  })

  it('should handle unicode characters', async () => {
    await sql`CREATE TABLE IF NOT EXISTS unicode_test (val TEXT)`
    await sql`DELETE FROM unicode_test`

    const unicode = 'Hello'
    await sql`INSERT INTO unicode_test VALUES (${unicode})`

    const result = await sql`SELECT * FROM unicode_test`
    expect(result[0].val).toBe(unicode)
  })

  it('should handle large numbers', async () => {
    await sql`CREATE TABLE IF NOT EXISTS bignum_test (val INTEGER)`
    await sql`DELETE FROM bignum_test`

    const bigNum = 9007199254740991 // MAX_SAFE_INTEGER
    await sql`INSERT INTO bignum_test VALUES (${bigNum})`

    const result = await sql`SELECT * FROM bignum_test`
    expect(result[0].val).toBe(bigNum)
  })

  it('should handle negative numbers', async () => {
    await sql`CREATE TABLE IF NOT EXISTS negative_test (val INTEGER)`
    await sql`DELETE FROM negative_test`
    await sql`INSERT INTO negative_test VALUES (${-42})`

    const result = await sql`SELECT * FROM negative_test`
    expect(result[0].val).toBe(-42)
  })

  it('should handle zero', async () => {
    await sql`CREATE TABLE IF NOT EXISTS zero_test (val INTEGER)`
    await sql`DELETE FROM zero_test`
    await sql`INSERT INTO zero_test VALUES (${0})`

    const result = await sql`SELECT * FROM zero_test`
    expect(result[0].val).toBe(0)
  })
})
