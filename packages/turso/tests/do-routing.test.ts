/**
 * @dotdo/turso DO Routing Tests (RED Phase)
 *
 * Tests for Durable Object-based query routing that provides:
 * - Multi-tenant database isolation via DO namespace
 * - Automatic query routing by database name
 * - Connection pooling per DO instance
 * - Read/write query routing (primary vs replica)
 * - Failover handling for transient errors
 * - DO stub caching for performance
 *
 * These tests are written to FAIL first (TDD RED phase).
 * Implementation will follow in GREEN phase.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock types for the DO routing system (implementation doesn't exist yet)
import type {
  TursoDORouter,
  TursoDORouterConfig,
  DatabaseStub,
  QueryResult,
  RoutingStrategy,
  TenantConfig,
  TransientError,
  FailoverConfig,
} from '../src/do-router'

// ============================================================================
// MOCK SETUP - These types/functions will be implemented
// ============================================================================

// Mock Durable Object namespace
const createMockDONamespace = () => ({
  idFromName: vi.fn((name: string) => ({ name, toString: () => `id:${name}` })),
  get: vi.fn((id: any) => createMockDOStub(id)),
})

// Mock DO stub
const createMockDOStub = (id: any) => ({
  id,
  fetch: vi.fn(),
  connect: vi.fn(),
  name: id.name,
})

// Mock query results
const createMockQueryResult = (rows: unknown[] = []): QueryResult => ({
  rows,
  columns: [],
  rowsAffected: rows.length,
  lastInsertRowid: null,
})

// ============================================================================
// DATABASE ROUTING TESTS
// ============================================================================

describe('@dotdo/turso DO routing', () => {
  let mockNamespace: ReturnType<typeof createMockDONamespace>
  let router: TursoDORouter

  beforeEach(() => {
    mockNamespace = createMockDONamespace()
    // Router will be instantiated when implementation exists
    // router = new TursoDORouter({ namespace: mockNamespace })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // DATABASE ROUTING
  // ==========================================================================

  describe('Database routing', () => {
    test('routes to DO by database name', async () => {
      // Arrange
      const dbName = 'tenant-123-production'

      // Act
      const stub = await router.getDatabase(dbName)

      // Assert
      expect(mockNamespace.idFromName).toHaveBeenCalledWith(dbName)
      expect(mockNamespace.get).toHaveBeenCalled()
      expect(stub).toBeDefined()
      expect(stub.name).toBe(dbName)
    })

    test('creates DO stub on first query', async () => {
      // Arrange
      const dbName = 'new-database'

      // Act - first access should create stub
      const stub1 = await router.getDatabase(dbName)

      // Assert - namespace methods called for stub creation
      expect(mockNamespace.idFromName).toHaveBeenCalledTimes(1)
      expect(mockNamespace.get).toHaveBeenCalledTimes(1)
    })

    test('caches DO stubs', async () => {
      // Arrange
      const dbName = 'cached-database'

      // Act - multiple accesses to same database
      const stub1 = await router.getDatabase(dbName)
      const stub2 = await router.getDatabase(dbName)
      const stub3 = await router.getDatabase(dbName)

      // Assert - stub creation called only once
      expect(mockNamespace.idFromName).toHaveBeenCalledTimes(1)
      expect(mockNamespace.get).toHaveBeenCalledTimes(1)
      expect(stub1).toBe(stub2)
      expect(stub2).toBe(stub3)
    })

    test('routes different databases to different DOs', async () => {
      // Arrange
      const db1Name = 'tenant-a-db'
      const db2Name = 'tenant-b-db'

      // Act
      const stub1 = await router.getDatabase(db1Name)
      const stub2 = await router.getDatabase(db2Name)

      // Assert
      expect(mockNamespace.idFromName).toHaveBeenCalledWith(db1Name)
      expect(mockNamespace.idFromName).toHaveBeenCalledWith(db2Name)
      expect(stub1).not.toBe(stub2)
      expect(stub1.name).toBe(db1Name)
      expect(stub2.name).toBe(db2Name)
    })

    test('validates database name format', async () => {
      // Arrange - invalid database names
      const invalidNames = ['', '   ', '../traversal', 'name with spaces', 'invalid/path']

      // Act & Assert
      for (const name of invalidNames) {
        await expect(router.getDatabase(name)).rejects.toThrow(/invalid database name/i)
      }
    })

    test('normalizes database names', async () => {
      // Arrange
      const unnormalizedName = '  My-Database_Name  '
      const normalizedName = 'my-database_name'

      // Act
      const stub = await router.getDatabase(unnormalizedName)

      // Assert - name should be normalized before lookup
      expect(mockNamespace.idFromName).toHaveBeenCalledWith(normalizedName)
    })
  })

  // ==========================================================================
  // MULTI-TENANT ISOLATION
  // ==========================================================================

  describe('Multi-tenant isolation', () => {
    test('isolates databases by tenant', async () => {
      // Arrange
      const tenant1 = { id: 'tenant-1', orgId: 'org-a' }
      const tenant2 = { id: 'tenant-2', orgId: 'org-b' }

      // Act
      const db1 = await router.getDatabaseForTenant(tenant1.id)
      const db2 = await router.getDatabaseForTenant(tenant2.id)

      // Assert - each tenant gets unique DO
      expect(db1.id.toString()).not.toBe(db2.id.toString())
    })

    test('prevents cross-tenant access', async () => {
      // Arrange
      const tenantA = 'tenant-a'
      const tenantB = 'tenant-b'

      // Configure router with tenant isolation
      const isolatedRouter = router.withTenantIsolation(tenantA)

      // Act & Assert - should reject access to other tenant's database
      await expect(
        isolatedRouter.getDatabase(`${tenantB}-database`)
      ).rejects.toThrow(/cross-tenant access denied/i)
    })

    test('enforces tenant prefix in database names', async () => {
      // Arrange
      const tenantId = 'acme-corp'
      const dbName = 'users-production'

      // Act
      const stub = await router.getDatabaseForTenant(tenantId, dbName)

      // Assert - database name should include tenant prefix
      expect(mockNamespace.idFromName).toHaveBeenCalledWith(`${tenantId}:${dbName}`)
    })

    test('isolates tenant data even with same table names', async () => {
      // Arrange
      const tenantA = 'company-a'
      const tenantB = 'company-b'
      const tableName = 'users' // Same table name for both tenants

      // Act
      const dbA = await router.getDatabaseForTenant(tenantA)
      const dbB = await router.getDatabaseForTenant(tenantB)

      // Execute same query on both tenant databases
      const queryA = await router.query(dbA, `SELECT * FROM ${tableName}`)
      const queryB = await router.query(dbB, `SELECT * FROM ${tableName}`)

      // Assert - queries were routed to separate DOs
      expect(dbA.id.toString()).not.toBe(dbB.id.toString())
    })

    test('supports tenant-scoped connection strings', async () => {
      // Arrange
      const tenantConfig: TenantConfig = {
        tenantId: 'premium-tenant',
        connectionString: 'libsql://premium-tenant-db.turso.io',
        authToken: 'secret-token',
        maxConnections: 10,
      }

      // Act
      const db = await router.connectTenant(tenantConfig)

      // Assert
      expect(db).toBeDefined()
      expect(router.getTenantConfig('premium-tenant')).toEqual(tenantConfig)
    })

    test('tracks per-tenant connection metrics', async () => {
      // Arrange
      const tenantId = 'metrics-tenant'
      const db = await router.getDatabaseForTenant(tenantId)

      // Act - execute several queries
      await router.query(db, 'SELECT 1')
      await router.query(db, 'SELECT 2')
      await router.query(db, 'INSERT INTO test VALUES (1)')

      // Assert - metrics tracked per tenant
      const metrics = router.getMetrics(tenantId)
      expect(metrics.queryCount).toBe(3)
      expect(metrics.readCount).toBe(2)
      expect(metrics.writeCount).toBe(1)
    })
  })

  // ==========================================================================
  // READ/WRITE ROUTING
  // ==========================================================================

  describe('Read/write routing', () => {
    test('routes reads to replica', async () => {
      // Arrange
      const dbName = 'replicated-db'
      const readQuery = 'SELECT * FROM users WHERE id = 1'

      // Act
      const result = await router.query(dbName, readQuery)

      // Assert - should use replica routing
      const routingInfo = router.getLastRoutingInfo()
      expect(routingInfo.target).toBe('replica')
      expect(routingInfo.queryType).toBe('read')
    })

    test('routes writes to primary', async () => {
      // Arrange
      const dbName = 'replicated-db'
      const writeQuery = 'INSERT INTO users (name) VALUES (?)'

      // Act
      const result = await router.execute(dbName, writeQuery, ['John'])

      // Assert - should use primary routing
      const routingInfo = router.getLastRoutingInfo()
      expect(routingInfo.target).toBe('primary')
      expect(routingInfo.queryType).toBe('write')
    })

    test('detects write operations by SQL parsing', async () => {
      // Arrange
      const dbName = 'sql-parse-test'
      const writeOperations = [
        'INSERT INTO users (name) VALUES (?)',
        'UPDATE users SET name = ? WHERE id = ?',
        'DELETE FROM users WHERE id = ?',
        'CREATE TABLE new_table (id INTEGER)',
        'DROP TABLE old_table',
        'ALTER TABLE users ADD COLUMN email TEXT',
        'REPLACE INTO users (id, name) VALUES (?, ?)',
      ]

      // Act & Assert
      for (const sql of writeOperations) {
        await router.query(dbName, sql)
        const routingInfo = router.getLastRoutingInfo()
        expect(routingInfo.queryType).toBe('write')
        expect(routingInfo.target).toBe('primary')
      }
    })

    test('treats SELECT queries as reads', async () => {
      // Arrange
      const dbName = 'select-test'
      const readQueries = [
        'SELECT * FROM users',
        'SELECT COUNT(*) FROM users',
        'SELECT u.*, p.* FROM users u JOIN profiles p ON u.id = p.user_id',
        'WITH cte AS (SELECT * FROM users) SELECT * FROM cte',
        'SELECT 1', // Simple expression
      ]

      // Act & Assert
      for (const sql of readQueries) {
        await router.query(dbName, sql)
        const routingInfo = router.getLastRoutingInfo()
        expect(routingInfo.queryType).toBe('read')
        expect(routingInfo.target).toBe('replica')
      }
    })

    test('routes transactions to primary', async () => {
      // Arrange
      const dbName = 'transaction-db'

      // Act
      await router.transaction(dbName, async (tx) => {
        await tx.query('SELECT * FROM users') // Even reads in transaction
        await tx.query('UPDATE users SET name = ? WHERE id = ?', ['Jane', 1])
      })

      // Assert - entire transaction should route to primary
      const routingInfo = router.getLastRoutingInfo()
      expect(routingInfo.target).toBe('primary')
      expect(routingInfo.isTransaction).toBe(true)
    })

    test('supports explicit routing hints', async () => {
      // Arrange
      const dbName = 'hint-test'
      const readQuery = 'SELECT * FROM users'

      // Act - force read to primary (for consistency requirements)
      const result = await router.query(dbName, readQuery, { forcePrimary: true })

      // Assert
      const routingInfo = router.getLastRoutingInfo()
      expect(routingInfo.target).toBe('primary')
      expect(routingInfo.hint).toBe('forcePrimary')
    })

    test('respects read-your-writes consistency', async () => {
      // Arrange
      const dbName = 'ryw-test'
      const sessionId = 'session-123'

      // Configure read-your-writes for session
      router.enableReadYourWrites(sessionId)

      // Act - write then read in same session
      await router.execute(dbName, 'INSERT INTO users (name) VALUES (?)', ['Alice'], { sessionId })
      const result = await router.query(dbName, 'SELECT * FROM users ORDER BY id DESC LIMIT 1', { sessionId })

      // Assert - read should go to primary after write in same session
      const routingInfo = router.getLastRoutingInfo()
      expect(routingInfo.target).toBe('primary')
      expect(routingInfo.reason).toBe('read-your-writes')
    })

    test('configures custom routing strategy', async () => {
      // Arrange
      const customStrategy: RoutingStrategy = {
        name: 'custom-strategy',
        route: (query: string, context: any) => {
          // Always route to primary for this table
          if (query.includes('sensitive_data')) {
            return 'primary'
          }
          return 'replica'
        },
      }

      // Act
      router.setRoutingStrategy(customStrategy)
      await router.query('test-db', 'SELECT * FROM sensitive_data')

      // Assert
      const routingInfo = router.getLastRoutingInfo()
      expect(routingInfo.target).toBe('primary')
      expect(routingInfo.strategy).toBe('custom-strategy')
    })
  })

  // ==========================================================================
  // FAILOVER HANDLING
  // ==========================================================================

  describe('Failover', () => {
    test('retries on transient errors', async () => {
      // Arrange
      const dbName = 'retry-test-db'
      let attemptCount = 0

      // Mock stub that fails twice then succeeds
      const mockStub = createMockDOStub({ name: dbName })
      mockStub.fetch = vi.fn().mockImplementation(async () => {
        attemptCount++
        if (attemptCount < 3) {
          const error = new Error('Connection timeout') as TransientError
          error.code = 'ETIMEDOUT'
          error.retryable = true
          throw error
        }
        return new Response(JSON.stringify(createMockQueryResult([{ id: 1 }])))
      })

      mockNamespace.get = vi.fn().mockReturnValue(mockStub)

      // Act
      const result = await router.query(dbName, 'SELECT * FROM users')

      // Assert
      expect(attemptCount).toBe(3)
      expect(result.rows).toHaveLength(1)
    })

    test('fails over to backup DO', async () => {
      // Arrange
      const primaryDbName = 'primary-db'
      const backupDbName = 'backup-db'

      // Configure failover
      router.configureFailover(primaryDbName, {
        backupDatabase: backupDbName,
        failoverThreshold: 3, // Fail over after 3 consecutive errors
      })

      // Mock primary to always fail
      const primaryStub = createMockDOStub({ name: primaryDbName })
      primaryStub.fetch = vi.fn().mockRejectedValue(new Error('Primary unavailable'))

      // Mock backup to succeed
      const backupStub = createMockDOStub({ name: backupDbName })
      backupStub.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createMockQueryResult([{ id: 1, source: 'backup' }])))
      )

      mockNamespace.get = vi.fn().mockImplementation((id) => {
        if (id.name === primaryDbName) return primaryStub
        if (id.name === backupDbName) return backupStub
        return createMockDOStub(id)
      })

      // Act - attempt query multiple times to trigger failover
      await expect(router.query(primaryDbName, 'SELECT 1')).rejects.toThrow()
      await expect(router.query(primaryDbName, 'SELECT 1')).rejects.toThrow()
      await expect(router.query(primaryDbName, 'SELECT 1')).rejects.toThrow()

      // This query should fail over to backup
      const result = await router.query(primaryDbName, 'SELECT 1')

      // Assert
      expect(result.rows[0]).toHaveProperty('source', 'backup')
      expect(router.isFailedOver(primaryDbName)).toBe(true)
    })

    test('uses exponential backoff for retries', async () => {
      // Arrange
      const dbName = 'backoff-test'
      const retryDelays: number[] = []
      let lastRetryTime = Date.now()

      const mockStub = createMockDOStub({ name: dbName })
      mockStub.fetch = vi.fn().mockImplementation(async () => {
        const now = Date.now()
        retryDelays.push(now - lastRetryTime)
        lastRetryTime = now

        if (retryDelays.length < 4) {
          const error = new Error('Temporary failure') as TransientError
          error.retryable = true
          throw error
        }
        return new Response(JSON.stringify(createMockQueryResult([{ id: 1 }])))
      })

      mockNamespace.get = vi.fn().mockReturnValue(mockStub)

      // Act
      await router.query(dbName, 'SELECT 1', {
        retry: {
          maxAttempts: 5,
          baseDelay: 100,
          maxDelay: 5000,
        },
      })

      // Assert - delays should increase exponentially
      // Skip first delay (immediate first attempt)
      expect(retryDelays[1]).toBeGreaterThanOrEqual(0) // ~0ms (immediate)
      expect(retryDelays[2]).toBeGreaterThanOrEqual(90) // ~100ms (with jitter)
      expect(retryDelays[3]).toBeGreaterThanOrEqual(180) // ~200ms (with jitter)
    })

    test('does not retry non-retryable errors', async () => {
      // Arrange
      const dbName = 'no-retry-db'
      let attemptCount = 0

      const mockStub = createMockDOStub({ name: dbName })
      mockStub.fetch = vi.fn().mockImplementation(async () => {
        attemptCount++
        const error = new Error('SQL syntax error') as TransientError
        error.code = 'SQLITE_ERROR'
        error.retryable = false
        throw error
      })

      mockNamespace.get = vi.fn().mockReturnValue(mockStub)

      // Act & Assert
      await expect(router.query(dbName, 'INVALID SQL')).rejects.toThrow('SQL syntax error')
      expect(attemptCount).toBe(1) // No retries for non-retryable errors
    })

    test('circuit breaker prevents cascading failures', async () => {
      // Arrange
      const dbName = 'circuit-breaker-db'
      let callCount = 0

      const mockStub = createMockDOStub({ name: dbName })
      mockStub.fetch = vi.fn().mockImplementation(async () => {
        callCount++
        throw new Error('Service unavailable')
      })

      mockNamespace.get = vi.fn().mockReturnValue(mockStub)

      // Configure circuit breaker
      router.configureCircuitBreaker(dbName, {
        failureThreshold: 3,
        resetTimeout: 30000, // 30 seconds
      })

      // Act - trigger circuit breaker
      for (let i = 0; i < 5; i++) {
        await router.query(dbName, 'SELECT 1').catch(() => {})
      }

      // Assert - circuit should be open, no more calls to DO
      expect(callCount).toBe(3) // Only 3 calls made before circuit opened
      await expect(router.query(dbName, 'SELECT 1')).rejects.toThrow(/circuit.*open/i)
    })

    test('recovers from failover when primary is healthy', async () => {
      // Arrange
      const primaryDbName = 'recoverable-primary'
      const backupDbName = 'recoverable-backup'

      router.configureFailover(primaryDbName, {
        backupDatabase: backupDbName,
        failoverThreshold: 1,
        healthCheckInterval: 100, // Check every 100ms in test
      })

      // Initially fail primary
      let primaryHealthy = false
      const primaryStub = createMockDOStub({ name: primaryDbName })
      primaryStub.fetch = vi.fn().mockImplementation(async () => {
        if (!primaryHealthy) {
          throw new Error('Primary down')
        }
        return new Response(JSON.stringify(createMockQueryResult([{ source: 'primary' }])))
      })

      const backupStub = createMockDOStub({ name: backupDbName })
      backupStub.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createMockQueryResult([{ source: 'backup' }])))
      )

      mockNamespace.get = vi.fn().mockImplementation((id) => {
        if (id.name === primaryDbName) return primaryStub
        return backupStub
      })

      // Act - trigger failover
      await router.query(primaryDbName, 'SELECT 1').catch(() => {})
      expect(router.isFailedOver(primaryDbName)).toBe(true)

      // Restore primary health
      primaryHealthy = true

      // Wait for health check and recovery
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Assert - should recover to primary
      const result = await router.query(primaryDbName, 'SELECT 1')
      expect(result.rows[0]).toHaveProperty('source', 'primary')
      expect(router.isFailedOver(primaryDbName)).toBe(false)
    })
  })

  // ==========================================================================
  // CONNECTION POOLING
  // ==========================================================================

  describe('Connection pooling per DO', () => {
    test('maintains connection pool per database', async () => {
      // Arrange
      const dbName = 'pooled-db'

      // Act
      const pool = router.getConnectionPool(dbName)

      // Assert
      expect(pool).toBeDefined()
      expect(pool.maxConnections).toBeGreaterThan(0)
      expect(pool.activeConnections).toBe(0)
    })

    test('limits concurrent connections', async () => {
      // Arrange
      const dbName = 'limited-pool-db'
      router.configurePool(dbName, { maxConnections: 2 })

      // Create a slow query mock
      let resolvers: Array<() => void> = []
      const mockStub = createMockDOStub({ name: dbName })
      mockStub.fetch = vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            resolvers.push(() =>
              resolve(new Response(JSON.stringify(createMockQueryResult([]))))
            )
          })
      )

      mockNamespace.get = vi.fn().mockReturnValue(mockStub)

      // Act - start 3 concurrent queries
      const query1 = router.query(dbName, 'SELECT 1')
      const query2 = router.query(dbName, 'SELECT 2')
      const query3 = router.query(dbName, 'SELECT 3')

      // Wait a bit for queries to be queued
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Assert - only 2 should be active (max pool size)
      const pool = router.getConnectionPool(dbName)
      expect(pool.activeConnections).toBe(2)
      expect(pool.queuedRequests).toBe(1)

      // Clean up - resolve all queries
      resolvers.forEach((r) => r())
      await Promise.all([query1, query2, query3])
    })

    test('reuses connections from pool', async () => {
      // Arrange
      const dbName = 'reuse-pool-db'
      let connectionCreatedCount = 0

      const mockStub = createMockDOStub({ name: dbName })
      mockStub.connect = vi.fn().mockImplementation(() => {
        connectionCreatedCount++
        return { execute: vi.fn(), close: vi.fn() }
      })
      mockStub.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createMockQueryResult([])))
      )

      mockNamespace.get = vi.fn().mockReturnValue(mockStub)

      // Act - execute multiple sequential queries
      await router.query(dbName, 'SELECT 1')
      await router.query(dbName, 'SELECT 2')
      await router.query(dbName, 'SELECT 3')

      // Assert - connections should be reused, not created fresh each time
      // This depends on implementation, but we expect connection reuse
      const pool = router.getConnectionPool(dbName)
      expect(pool.totalCreated).toBeLessThanOrEqual(pool.maxConnections)
    })

    test('releases connections on query completion', async () => {
      // Arrange
      const dbName = 'release-pool-db'
      router.configurePool(dbName, { maxConnections: 1 })

      const mockStub = createMockDOStub({ name: dbName })
      mockStub.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createMockQueryResult([])))
      )

      mockNamespace.get = vi.fn().mockReturnValue(mockStub)

      // Act
      await router.query(dbName, 'SELECT 1')

      // Assert - connection should be released back to pool
      const pool = router.getConnectionPool(dbName)
      expect(pool.activeConnections).toBe(0)
      expect(pool.availableConnections).toBeGreaterThan(0)
    })

    test('handles connection timeout', async () => {
      // Arrange
      const dbName = 'timeout-pool-db'
      router.configurePool(dbName, {
        maxConnections: 1,
        connectionTimeout: 100, // 100ms timeout
      })

      // Create a query that never completes
      const mockStub = createMockDOStub({ name: dbName })
      mockStub.fetch = vi.fn().mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      mockNamespace.get = vi.fn().mockReturnValue(mockStub)

      // Act & Assert
      await expect(router.query(dbName, 'SELECT 1')).rejects.toThrow(/timeout/i)
    })

    test('cleans up idle connections', async () => {
      // Arrange
      const dbName = 'idle-cleanup-db'
      router.configurePool(dbName, {
        maxConnections: 5,
        idleTimeout: 100, // 100ms idle timeout
      })

      const mockStub = createMockDOStub({ name: dbName })
      mockStub.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createMockQueryResult([])))
      )

      mockNamespace.get = vi.fn().mockReturnValue(mockStub)

      // Act - create some connections
      await Promise.all([
        router.query(dbName, 'SELECT 1'),
        router.query(dbName, 'SELECT 2'),
        router.query(dbName, 'SELECT 3'),
      ])

      // Wait for idle timeout
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Assert - idle connections should be cleaned up
      const pool = router.getConnectionPool(dbName)
      expect(pool.availableConnections).toBeLessThan(3)
    })
  })

  // ==========================================================================
  // DO STUB CACHING
  // ==========================================================================

  describe('DO stub caching', () => {
    test('caches stubs by database name', async () => {
      // Arrange
      const dbName = 'stub-cache-test'

      // Act
      await router.getDatabase(dbName)
      await router.getDatabase(dbName)
      await router.getDatabase(dbName)

      // Assert
      expect(mockNamespace.get).toHaveBeenCalledTimes(1)
    })

    test('invalidates cache on explicit flush', async () => {
      // Arrange
      const dbName = 'flush-cache-test'
      await router.getDatabase(dbName)

      // Act
      router.flushCache(dbName)
      await router.getDatabase(dbName)

      // Assert - stub should be recreated
      expect(mockNamespace.get).toHaveBeenCalledTimes(2)
    })

    test('expires cache entries after TTL', async () => {
      // Arrange
      const dbName = 'ttl-cache-test'
      router.configureCaching({ stubTTL: 100 }) // 100ms TTL

      // Act
      await router.getDatabase(dbName)
      await new Promise((resolve) => setTimeout(resolve, 150)) // Wait for TTL
      await router.getDatabase(dbName)

      // Assert - stub should be recreated after TTL
      expect(mockNamespace.get).toHaveBeenCalledTimes(2)
    })

    test('limits cache size with LRU eviction', async () => {
      // Arrange
      router.configureCaching({ maxCacheSize: 3 })

      // Act - access 4 different databases
      await router.getDatabase('db-1')
      await router.getDatabase('db-2')
      await router.getDatabase('db-3')
      await router.getDatabase('db-4') // Should evict db-1 (LRU)

      // Access db-1 again - should miss cache
      mockNamespace.get = vi.fn().mockReturnValue(createMockDOStub({ name: 'db-1' }))
      await router.getDatabase('db-1')

      // Assert - db-1 was evicted and recreated
      expect(mockNamespace.get).toHaveBeenCalledTimes(1) // New call for db-1
    })

    test('maintains separate cache per tenant', async () => {
      // Arrange
      const tenant1 = 'tenant-1'
      const tenant2 = 'tenant-2'
      const dbName = 'shared-name-db'

      // Act
      await router.getDatabaseForTenant(tenant1, dbName)
      await router.getDatabaseForTenant(tenant2, dbName)

      // Assert - should create two separate stubs
      expect(mockNamespace.idFromName).toHaveBeenCalledWith(`${tenant1}:${dbName}`)
      expect(mockNamespace.idFromName).toHaveBeenCalledWith(`${tenant2}:${dbName}`)
      expect(mockNamespace.get).toHaveBeenCalledTimes(2)
    })

    test('provides cache statistics', async () => {
      // Arrange
      await router.getDatabase('stats-db-1')
      await router.getDatabase('stats-db-1') // Cache hit
      await router.getDatabase('stats-db-2')
      await router.getDatabase('stats-db-1') // Cache hit

      // Act
      const stats = router.getCacheStats()

      // Assert
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(2)
      expect(stats.hitRate).toBeCloseTo(0.5)
      expect(stats.size).toBe(2)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error handling', () => {
    test('wraps DO errors with context', async () => {
      // Arrange
      const dbName = 'error-context-db'
      const mockStub = createMockDOStub({ name: dbName })
      mockStub.fetch = vi.fn().mockRejectedValue(new Error('Internal DO error'))

      mockNamespace.get = vi.fn().mockReturnValue(mockStub)

      // Act & Assert
      try {
        await router.query(dbName, 'SELECT * FROM users')
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.message).toContain('Internal DO error')
        expect(error.context).toMatchObject({
          database: dbName,
          query: 'SELECT * FROM users',
        })
      }
    })

    test('handles DO unavailable gracefully', async () => {
      // Arrange
      const dbName = 'unavailable-db'
      mockNamespace.get = vi.fn().mockImplementation(() => {
        throw new Error('DO namespace unavailable')
      })

      // Act & Assert
      await expect(router.getDatabase(dbName)).rejects.toThrow(/DO namespace unavailable/i)
    })

    test('handles malformed query results', async () => {
      // Arrange
      const dbName = 'malformed-result-db'
      const mockStub = createMockDOStub({ name: dbName })
      mockStub.fetch = vi.fn().mockResolvedValue(
        new Response('not valid json', { status: 200 })
      )

      mockNamespace.get = vi.fn().mockReturnValue(mockStub)

      // Act & Assert
      await expect(router.query(dbName, 'SELECT 1')).rejects.toThrow(/malformed.*response/i)
    })

    test('logs routing decisions for debugging', async () => {
      // Arrange
      const dbName = 'debug-log-db'
      const logEntries: any[] = []
      router.setLogger({
        debug: (entry: any) => logEntries.push(entry),
        info: vi.fn(),
        error: vi.fn(),
      })

      // Act
      await router.query(dbName, 'SELECT * FROM users')

      // Assert - routing decision should be logged
      expect(logEntries.some((e) => e.type === 'routing_decision')).toBe(true)
      expect(logEntries.some((e) => e.database === dbName)).toBe(true)
    })
  })

  // ==========================================================================
  // BATCH OPERATIONS
  // ==========================================================================

  describe('Batch operations', () => {
    test('executes batch queries in single DO call', async () => {
      // Arrange
      const dbName = 'batch-db'
      const queries = [
        { sql: 'INSERT INTO users (name) VALUES (?)', params: ['Alice'] },
        { sql: 'INSERT INTO users (name) VALUES (?)', params: ['Bob'] },
        { sql: 'INSERT INTO users (name) VALUES (?)', params: ['Charlie'] },
      ]

      const mockStub = createMockDOStub({ name: dbName })
      mockStub.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: queries.map((_, i) => createMockQueryResult([{ id: i + 1 }])),
          })
        )
      )

      mockNamespace.get = vi.fn().mockReturnValue(mockStub)

      // Act
      const results = await router.batch(dbName, queries)

      // Assert - single call for all queries
      expect(mockStub.fetch).toHaveBeenCalledTimes(1)
      expect(results).toHaveLength(3)
    })

    test('routes batch to primary (contains writes)', async () => {
      // Arrange
      const dbName = 'batch-routing-db'
      const queries = [
        { sql: 'SELECT * FROM users', params: [] }, // Read
        { sql: 'INSERT INTO logs (msg) VALUES (?)', params: ['test'] }, // Write
      ]

      // Act
      await router.batch(dbName, queries)

      // Assert - should route to primary because batch contains write
      const routingInfo = router.getLastRoutingInfo()
      expect(routingInfo.target).toBe('primary')
    })
  })
})
