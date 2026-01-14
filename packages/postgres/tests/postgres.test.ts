/**
 * @dotdo/postgres - PostgreSQL Package Tests
 *
 * TDD tests for the PostgreSQL compatibility package.
 * Tests cover client connection, query execution, parameterized queries,
 * transactions, connection pooling, error handling, and type mapping.
 *
 * Following RED-GREEN-REFACTOR pattern:
 * - RED: These tests are written first and should fail initially
 * - GREEN: Implementation makes tests pass
 * - REFACTOR: Clean up while keeping tests green
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  Client,
  Pool,
  DatabaseError,
  ConnectionError,
  types,
  type QueryResult,
  type PoolClient,
} from '../src/index'

// ============================================================================
// CLIENT CONNECTION TESTS
// ============================================================================

describe('@dotdo/postgres - Client Connection', () => {
  describe('connection string parsing', () => {
    it('should create client with postgres:// URL', async () => {
      const client = new Client('postgres://user:pass@localhost:5432/mydb')
      expect(client).toBeDefined()
      expect(client.connectionParameters.connectionString).toBe(
        'postgres://user:pass@localhost:5432/mydb'
      )
    })

    it('should create client with postgresql:// URL', async () => {
      const client = new Client('postgresql://user:pass@localhost:5432/mydb')
      expect(client).toBeDefined()
    })

    it('should connect and disconnect cleanly', async () => {
      const client = new Client()
      await client.connect()
      expect(client.processID).not.toBeNull()
      await client.end()
    })
  })

  describe('config object parsing', () => {
    it('should accept host, port, database, user, password', async () => {
      const client = new Client({
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        user: 'postgres',
        password: 'secret',
      })
      expect(client).toBeDefined()
      await client.connect()
      expect(client.processID).not.toBeNull()
      await client.end()
    })

    it('should accept ssl configuration', async () => {
      const client = new Client({
        host: 'localhost',
        database: 'mydb',
        ssl: { rejectUnauthorized: false },
      })
      expect(client).toBeDefined()
    })

    it('should accept statement_timeout', async () => {
      const client = new Client({
        host: 'localhost',
        database: 'mydb',
        statement_timeout: 5000,
      })
      expect(client).toBeDefined()
    })
  })

  describe('event handling', () => {
    it('should emit connect event', async () => {
      const client = new Client()
      const connectHandler = vi.fn()
      client.on('connect', connectHandler)
      await client.connect()
      expect(connectHandler).toHaveBeenCalled()
      await client.end()
    })

    it('should emit end event', async () => {
      const client = new Client()
      const endHandler = vi.fn()
      client.on('end', endHandler)
      await client.connect()
      await client.end()
      expect(endHandler).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// QUERY EXECUTION TESTS
// ============================================================================

describe('@dotdo/postgres - Query Execution', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  describe('query() method', () => {
    it('should execute simple SELECT', async () => {
      const result = await client.query('SELECT 1 + 1 as sum')
      expect(result.rows).toBeDefined()
      expect(result.command).toBe('SELECT')
    })

    it('should return fields metadata', async () => {
      const result = await client.query('SELECT 1 as num')
      expect(result.fields).toBeDefined()
      expect(result.fields.length).toBeGreaterThan(0)
    })

    it('should execute CREATE TABLE', async () => {
      const result = await client.query('CREATE TABLE test_table (id INTEGER, name TEXT)')
      expect(result.command).toBe('CREATE TABLE')
    })

    it('should execute INSERT', async () => {
      await client.query('CREATE TABLE insert_test (id INTEGER, name TEXT)')
      const result = await client.query("INSERT INTO insert_test VALUES (1, 'test')")
      expect(result.command).toBe('INSERT')
      expect(result.rowCount).toBe(1)
    })

    it('should execute UPDATE', async () => {
      await client.query('CREATE TABLE update_test (id INTEGER, name TEXT)')
      await client.query("INSERT INTO update_test VALUES (1, 'old')")
      const result = await client.query("UPDATE update_test SET name = 'new' WHERE id = 1")
      expect(result.command).toBe('UPDATE')
      expect(result.rowCount).toBe(1)
    })

    it('should execute DELETE', async () => {
      await client.query('CREATE TABLE delete_test (id INTEGER, name TEXT)')
      await client.query("INSERT INTO delete_test VALUES (1, 'test')")
      const result = await client.query('DELETE FROM delete_test WHERE id = 1')
      expect(result.command).toBe('DELETE')
      expect(result.rowCount).toBe(1)
    })
  })

  describe('queryOne() convenience method', () => {
    it('should return single row or null', async () => {
      await client.query('CREATE TABLE single_test (id INTEGER, name TEXT)')
      await client.query("INSERT INTO single_test VALUES (1, 'Alice')")

      const result = await client.query('SELECT * FROM single_test WHERE id = $1', [1])
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should return empty rows when no match', async () => {
      await client.query('CREATE TABLE empty_test (id INTEGER, name TEXT)')
      const result = await client.query('SELECT * FROM empty_test WHERE id = $1', [999])
      expect(result.rows.length).toBe(0)
    })
  })
})

// ============================================================================
// PARAMETERIZED QUERY TESTS
// ============================================================================

describe('@dotdo/postgres - Parameterized Queries', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
    await client.query('CREATE TABLE params_test (id INTEGER, name TEXT, age INTEGER)')
  })

  afterEach(async () => {
    await client.end()
  })

  describe('$1, $2, $3 placeholders', () => {
    it('should handle single $1 placeholder', async () => {
      await client.query('INSERT INTO params_test VALUES ($1, $2, $3)', [1, 'Alice', 30])
      const result = await client.query('SELECT * FROM params_test WHERE id = $1', [1])
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should handle multiple placeholders', async () => {
      const result = await client.query(
        'INSERT INTO params_test VALUES ($1, $2, $3) RETURNING *',
        [2, 'Bob', 25]
      )
      expect(result.rows[0].id).toBe(2)
      expect(result.rows[0].name).toBe('Bob')
      expect(result.rows[0].age).toBe(25)
    })

    it('should handle null parameter values', async () => {
      await client.query('INSERT INTO params_test VALUES ($1, $2, $3)', [3, null, null])
      const result = await client.query('SELECT * FROM params_test WHERE id = $1', [3])
      expect(result.rows[0].name).toBeNull()
      expect(result.rows[0].age).toBeNull()
    })

    it('should handle boolean parameter values', async () => {
      await client.query('CREATE TABLE bool_test (id INTEGER, active BOOLEAN)')
      await client.query('INSERT INTO bool_test VALUES ($1, $2)', [1, true])
      const result = await client.query('SELECT * FROM bool_test WHERE id = $1', [1])
      expect(result.rows[0].active).toBe(true)
    })
  })

  describe('QueryConfig object', () => {
    it('should accept text and values in config object', async () => {
      const result = await client.query({
        text: 'INSERT INTO params_test VALUES ($1, $2, $3) RETURNING *',
        values: [4, 'Carol', 28],
      })
      expect(result.rows[0].name).toBe('Carol')
    })
  })
})

// ============================================================================
// TRANSACTION TESTS
// ============================================================================

describe('@dotdo/postgres - Transactions', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
    await client.query('CREATE TABLE tx_test (id INTEGER PRIMARY KEY, balance INTEGER)')
    await client.query('INSERT INTO tx_test VALUES (1, 100)')
    await client.query('INSERT INTO tx_test VALUES (2, 100)')
  })

  afterEach(async () => {
    await client.end()
  })

  describe('BEGIN/COMMIT', () => {
    it('should BEGIN transaction', async () => {
      const result = await client.query('BEGIN')
      expect(result.command).toBe('BEGIN')
    })

    it('should COMMIT transaction and persist changes', async () => {
      await client.query('BEGIN')
      await client.query('UPDATE tx_test SET balance = 50 WHERE id = 1')
      const commitResult = await client.query('COMMIT')
      expect(commitResult.command).toBe('COMMIT')

      const check = await client.query('SELECT balance FROM tx_test WHERE id = 1')
      expect(check.rows[0].balance).toBe(50)
    })
  })

  describe('ROLLBACK', () => {
    it('should ROLLBACK transaction and discard changes', async () => {
      await client.query('BEGIN')
      await client.query('UPDATE tx_test SET balance = 0 WHERE id = 1')
      const rollbackResult = await client.query('ROLLBACK')
      expect(rollbackResult.command).toBe('ROLLBACK')

      const check = await client.query('SELECT balance FROM tx_test WHERE id = 1')
      expect(check.rows[0].balance).toBe(100)
    })
  })

  describe('SAVEPOINT', () => {
    it('should handle SAVEPOINT', async () => {
      await client.query('BEGIN')
      const result = await client.query('SAVEPOINT my_savepoint')
      expect(result.command).toBe('SAVEPOINT')
      await client.query('ROLLBACK')
    })

    it('should handle RELEASE SAVEPOINT', async () => {
      await client.query('BEGIN')
      await client.query('SAVEPOINT sp1')
      const result = await client.query('RELEASE SAVEPOINT sp1')
      expect(result.command).toBe('RELEASE')
      await client.query('COMMIT')
    })

    it('should handle ROLLBACK TO SAVEPOINT', async () => {
      await client.query('BEGIN')
      await client.query('UPDATE tx_test SET balance = 50 WHERE id = 1')
      await client.query('SAVEPOINT sp1')
      await client.query('UPDATE tx_test SET balance = 0 WHERE id = 1')
      await client.query('ROLLBACK TO SAVEPOINT sp1')

      const check = await client.query('SELECT balance FROM tx_test WHERE id = 1')
      expect(check.rows[0].balance).toBe(50)
      await client.query('COMMIT')
    })
  })
})

// ============================================================================
// CONNECTION POOL TESTS
// ============================================================================

describe('@dotdo/postgres - Connection Pool', () => {
  describe('pool creation', () => {
    it('should create pool with max connections', async () => {
      const pool = new Pool({ max: 10 })
      expect(pool.totalCount).toBe(0)
      const client = await pool.connect()
      expect(pool.totalCount).toBe(1)
      client.release()
      expect(pool.idleCount).toBe(1)
      await pool.end()
    })

    it('should create pool with connection string', async () => {
      const pool = new Pool('postgres://localhost/mydb')
      expect(pool).toBeDefined()
      await pool.end()
    })
  })

  describe('pool.query()', () => {
    it('should execute queries directly on pool', async () => {
      const pool = new Pool()
      await pool.query('CREATE TABLE pool_query_test (id INTEGER, name TEXT)')
      const result = await pool.query('SELECT 1 as num')
      expect(result.rows[0].num).toBe(1)
      await pool.end()
    })
  })

  describe('pool.connect()', () => {
    it('should checkout and release client', async () => {
      const pool = new Pool({ max: 5 })
      const client = await pool.connect()
      expect(client).toBeDefined()
      expect(pool.idleCount).toBe(0)

      client.release()
      expect(pool.idleCount).toBe(1)
      await pool.end()
    })

    it('should track waitingCount', async () => {
      const pool = new Pool({ max: 1, connectionTimeoutMillis: 5000 })
      const client1 = await pool.connect()
      expect(pool.waitingCount).toBe(0)

      const waitingPromise = pool.connect()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(pool.waitingCount).toBe(1)

      client1.release()
      const client2 = await waitingPromise
      expect(pool.waitingCount).toBe(0)
      client2.release()
      await pool.end()
    })

    it('should timeout when pool is exhausted', async () => {
      const pool = new Pool({ max: 1, connectionTimeoutMillis: 100 })
      const client1 = await pool.connect()

      const connectPromise = pool.connect()
      await expect(connectPromise).rejects.toThrow(ConnectionError)

      client1.release()
      await pool.end()
    })
  })

  describe('transaction with pool client', () => {
    it('should support transactions via checkout client', async () => {
      const pool = new Pool()
      await pool.query('CREATE TABLE pool_tx_test (id INTEGER, value INTEGER)')
      await pool.query('INSERT INTO pool_tx_test VALUES (1, 100)')

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('UPDATE pool_tx_test SET value = 50 WHERE id = 1')
        await client.query('COMMIT')
      } finally {
        client.release()
      }

      const result = await pool.query('SELECT value FROM pool_tx_test WHERE id = 1')
      expect(result.rows[0].value).toBe(50)
      await pool.end()
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('@dotdo/postgres - Error Handling', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  describe('DatabaseError', () => {
    it('should throw DatabaseError on syntax error', async () => {
      // Use INVALID SQL that the parser cannot handle
      await expect(client.query('INVALID COMMAND')).rejects.toThrow(DatabaseError)
    })

    it('should include SQLSTATE code 42P01 for table not found', async () => {
      try {
        await client.query('SELECT * FROM nonexistent_table')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(DatabaseError)
        expect((e as DatabaseError).code).toBe('42P01')
      }
    })

    it('should include SQLSTATE code 42P07 for duplicate table', async () => {
      await client.query('CREATE TABLE dup_test (id INTEGER)')
      try {
        await client.query('CREATE TABLE dup_test (id INTEGER)')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(DatabaseError)
        expect((e as DatabaseError).code).toBe('42P07')
      }
    })

    it('should include SQLSTATE code 23505 for unique violation', async () => {
      await client.query('CREATE TABLE unique_test (id INTEGER PRIMARY KEY)')
      await client.query('INSERT INTO unique_test VALUES (1)')
      try {
        await client.query('INSERT INTO unique_test VALUES (1)')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(DatabaseError)
        expect((e as DatabaseError).code).toBe('23505')
      }
    })

    it('should include severity in DatabaseError', async () => {
      try {
        await client.query('INVALID SQL')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(DatabaseError)
        expect((e as DatabaseError).severity).toBe('ERROR')
      }
    })
  })

  describe('ConnectionError', () => {
    it('should throw ConnectionError on pool end', async () => {
      const pool = new Pool()
      await pool.end()
      await expect(pool.connect()).rejects.toThrow(ConnectionError)
    })
  })
})

// ============================================================================
// TYPE CONSTANTS TESTS
// ============================================================================

describe('@dotdo/postgres - Type Constants', () => {
  it('should export standard PostgreSQL type OIDs', () => {
    expect(types.BOOL).toBe(16)
    expect(types.INT2).toBe(21)
    expect(types.INT4).toBe(23)
    expect(types.INT8).toBe(20)
    expect(types.TEXT).toBe(25)
    expect(types.VARCHAR).toBe(1043)
    expect(types.FLOAT4).toBe(700)
    expect(types.FLOAT8).toBe(701)
    expect(types.JSON).toBe(114)
    expect(types.JSONB).toBe(3802)
    expect(types.UUID).toBe(2950)
    expect(types.DATE).toBe(1082)
    expect(types.TIME).toBe(1083)
    expect(types.TIMESTAMP).toBe(1114)
    expect(types.TIMESTAMPTZ).toBe(1184)
    expect(types.NUMERIC).toBe(1700)
  })
})

// ============================================================================
// UTILITY METHOD TESTS
// ============================================================================

describe('@dotdo/postgres - Utilities', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  describe('escapeLiteral()', () => {
    it('should escape single quotes', () => {
      expect(client.escapeLiteral("O'Reilly")).toBe("'O''Reilly'")
    })

    it('should wrap value in single quotes', () => {
      expect(client.escapeLiteral('test')).toBe("'test'")
    })

    it('should handle empty string', () => {
      expect(client.escapeLiteral('')).toBe("''")
    })
  })

  describe('escapeIdentifier()', () => {
    it('should escape double quotes', () => {
      expect(client.escapeIdentifier('column"name')).toBe('"column""name"')
    })

    it('should wrap value in double quotes', () => {
      expect(client.escapeIdentifier('my_table')).toBe('"my_table"')
    })
  })
})

// ============================================================================
// IN-MEMORY BACKEND TESTS
// ============================================================================

describe('@dotdo/postgres - In-Memory Backend', () => {
  let client: Client

  beforeEach(async () => {
    client = new Client()
    await client.connect()
  })

  afterEach(async () => {
    await client.end()
  })

  describe('SERIAL auto-increment', () => {
    it('should auto-increment SERIAL column', async () => {
      await client.query('CREATE TABLE serial_test (id SERIAL PRIMARY KEY, name TEXT)')
      const r1 = await client.query(
        "INSERT INTO serial_test (name) VALUES ('first') RETURNING id"
      )
      const r2 = await client.query(
        "INSERT INTO serial_test (name) VALUES ('second') RETURNING id"
      )

      expect(typeof r1.rows[0].id).toBe('number')
      expect(r2.rows[0].id).toBeGreaterThan(r1.rows[0].id)
    })
  })

  describe('RETURNING clause', () => {
    it('should return inserted row with RETURNING *', async () => {
      await client.query('CREATE TABLE return_test (id INTEGER, name TEXT, active BOOLEAN)')
      const result = await client.query(
        "INSERT INTO return_test VALUES (1, 'test', true) RETURNING *"
      )
      expect(result.rows[0].id).toBe(1)
      expect(result.rows[0].name).toBe('test')
      expect(result.rows[0].active).toBe(true)
    })

    it('should return specific columns with RETURNING id, name', async () => {
      await client.query('CREATE TABLE return_cols (id INTEGER, name TEXT, secret TEXT)')
      const result = await client.query(
        "INSERT INTO return_cols VALUES (1, 'visible', 'hidden') RETURNING id, name"
      )
      expect(result.rows[0].id).toBe(1)
      expect(result.rows[0].name).toBe('visible')
      expect(result.rows[0].secret).toBeUndefined()
    })
  })

  describe('WHERE clause operators', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE ops_test (id INTEGER, name TEXT, value INTEGER)')
      await client.query("INSERT INTO ops_test VALUES (1, 'Alice', 100)")
      await client.query("INSERT INTO ops_test VALUES (2, 'Bob', 200)")
      await client.query("INSERT INTO ops_test VALUES (3, 'Carol', 300)")
    })

    it('should handle = operator', async () => {
      const result = await client.query('SELECT * FROM ops_test WHERE id = $1', [1])
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should handle > operator', async () => {
      const result = await client.query('SELECT * FROM ops_test WHERE value > $1', [150])
      expect(result.rows.length).toBe(2)
    })

    it('should handle < operator', async () => {
      const result = await client.query('SELECT * FROM ops_test WHERE value < $1', [250])
      expect(result.rows.length).toBe(2)
    })

    it('should handle LIKE operator', async () => {
      const result = await client.query("SELECT * FROM ops_test WHERE name LIKE 'A%'")
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should handle IN operator', async () => {
      const result = await client.query('SELECT * FROM ops_test WHERE id IN (1, 3)')
      expect(result.rows.length).toBe(2)
    })
  })

  describe('ORDER BY and LIMIT', () => {
    beforeEach(async () => {
      await client.query('CREATE TABLE order_test (id INTEGER, name TEXT)')
      await client.query("INSERT INTO order_test VALUES (3, 'C')")
      await client.query("INSERT INTO order_test VALUES (1, 'A')")
      await client.query("INSERT INTO order_test VALUES (2, 'B')")
    })

    it('should handle ORDER BY ASC', async () => {
      const result = await client.query('SELECT * FROM order_test ORDER BY id')
      expect(result.rows[0].id).toBe(1)
      expect(result.rows[1].id).toBe(2)
      expect(result.rows[2].id).toBe(3)
    })

    it('should handle ORDER BY DESC', async () => {
      const result = await client.query('SELECT * FROM order_test ORDER BY id DESC')
      expect(result.rows[0].id).toBe(3)
      expect(result.rows[1].id).toBe(2)
      expect(result.rows[2].id).toBe(1)
    })

    it('should handle LIMIT', async () => {
      const result = await client.query('SELECT * FROM order_test ORDER BY id LIMIT 2')
      expect(result.rows.length).toBe(2)
    })

    it('should handle OFFSET', async () => {
      const result = await client.query('SELECT * FROM order_test ORDER BY id OFFSET 1')
      expect(result.rows.length).toBe(2)
      expect(result.rows[0].id).toBe(2)
    })
  })
})
