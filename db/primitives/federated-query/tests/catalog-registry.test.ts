/**
 * CatalogRegistry Tests
 *
 * TDD tests for the multi-source catalog registry:
 * - Source registration and unregistration
 * - Schema introspection and management
 * - Statistics storage and retrieval
 * - Hierarchical namespace resolution
 * - Health and availability tracking
 * - Event handling
 *
 * @see dotdo-1v9my
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  CatalogRegistry,
  type CatalogEntry,
  type SourceType,
  type ConnectionConfig,
  type SourceCapabilities,
  type HealthCheckResult,
  type RegisterSourceOptions,
  type ListSourcesOptions,
  type FindSourcesOptions,
  type QualifiedTableName,
  type ResolvedTable,
  type CatalogEventType,
} from '../catalog-registry'

import { createMemoryAdapter, type SourceSchema, type SourceStatistics } from '../index'

// =============================================================================
// Source Registration Tests
// =============================================================================

describe('CatalogRegistry', () => {
  let registry: CatalogRegistry

  beforeEach(() => {
    registry = new CatalogRegistry()
  })

  describe('source registration', () => {
    it('should register a data source', () => {
      const entry = registry.registerSource('users_db', {
        type: 'sqlite',
        connection: { url: ':memory:' },
      })

      expect(entry.name).toBe('users_db')
      expect(entry.type).toBe('sqlite')
      expect(registry.hasSource('users_db')).toBe(true)
    })

    it('should register source with full configuration', () => {
      const entry = registry.registerSource('production_db', {
        type: 'postgres',
        connection: {
          host: 'db.example.com',
          port: 5432,
          database: 'production',
          username: 'app_user',
          ssl: true,
          poolSize: 10,
        },
        capabilities: {
          predicatePushdown: true,
          projectionPushdown: true,
          limitPushdown: true,
          aggregationPushdown: true,
          joinPushdown: true,
          supportsSQL: true,
          supportsTransactions: true,
        },
        priority: 100,
        displayName: 'Production Database',
        tags: ['production', 'primary'],
        metadata: { region: 'us-west-2' },
      })

      expect(entry.displayName).toBe('Production Database')
      expect(entry.priority).toBe(100)
      expect(entry.tags).toContain('production')
      expect(entry.capabilities.supportsSQL).toBe(true)
      expect(entry.metadata?.region).toBe('us-west-2')
    })

    it('should throw when registering duplicate source', () => {
      registry.registerSource('dup_db', {
        type: 'memory',
        connection: {},
      })

      expect(() => {
        registry.registerSource('dup_db', {
          type: 'sqlite',
          connection: {},
        })
      }).toThrow("Source 'dup_db' is already registered")
    })

    it('should allow replacing existing source with replace option', () => {
      registry.registerSource('replaceable_db', {
        type: 'memory',
        connection: {},
        priority: 1,
      })

      const newEntry = registry.registerSource(
        'replaceable_db',
        {
          type: 'sqlite',
          connection: { url: ':memory:' },
          priority: 10,
        },
        { replace: true }
      )

      expect(newEntry.type).toBe('sqlite')
      expect(newEntry.priority).toBe(10)
    })

    it('should set default capabilities when not provided', () => {
      const entry = registry.registerSource('basic_db', {
        type: 'memory',
        connection: {},
      })

      expect(entry.capabilities.predicatePushdown).toBe(true)
      expect(entry.capabilities.projectionPushdown).toBe(true)
      expect(entry.capabilities.limitPushdown).toBe(true)
      expect(entry.capabilities.aggregationPushdown).toBe(false)
      expect(entry.capabilities.joinPushdown).toBe(false)
    })

    it('should set timestamps on registration', () => {
      const before = new Date()
      const entry = registry.registerSource('timed_db', {
        type: 'memory',
        connection: {},
      })
      const after = new Date()

      expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(entry.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
      expect(entry.updatedAt.getTime()).toBe(entry.createdAt.getTime())
    })
  })

  describe('source unregistration', () => {
    it('should unregister an existing source', () => {
      registry.registerSource('temp_db', { type: 'memory', connection: {} })
      expect(registry.hasSource('temp_db')).toBe(true)

      const result = registry.unregisterSource('temp_db')

      expect(result).toBe(true)
      expect(registry.hasSource('temp_db')).toBe(false)
    })

    it('should return false when unregistering non-existent source', () => {
      const result = registry.unregisterSource('non_existent')
      expect(result).toBe(false)
    })

    it('should clear default source when unregistering it', () => {
      registry.registerSource('default_db', { type: 'memory', connection: {} })
      registry.setDefaultSource('default_db')
      expect(registry.getDefaultSource()).toBe('default_db')

      registry.unregisterSource('default_db')

      expect(registry.getDefaultSource()).toBeNull()
    })

    it('should remove source from all indexes', () => {
      registry.registerSource('indexed_db', {
        type: 'memory',
        connection: {},
        schema: {
          tables: {
            users: { columns: { id: { type: 'integer' } } },
          },
        },
      })

      expect(registry.hasTable('users')).toBe(true)

      registry.unregisterSource('indexed_db')

      expect(registry.hasTable('users')).toBe(false)
    })
  })

  describe('source lookup', () => {
    beforeEach(() => {
      registry.registerSource('source1', { type: 'sqlite', connection: {}, priority: 10 })
      registry.registerSource('source2', { type: 'postgres', connection: {}, priority: 5 })
      registry.registerSource('source3', { type: 'memory', connection: {}, priority: 15, tags: ['cache'] })
    })

    it('should get source by name', () => {
      const source = registry.getSource('source1')

      expect(source).toBeDefined()
      expect(source?.name).toBe('source1')
      expect(source?.type).toBe('sqlite')
    })

    it('should return undefined for non-existent source', () => {
      const source = registry.getSource('non_existent')
      expect(source).toBeUndefined()
    })

    it('should list all sources sorted by priority (default desc)', () => {
      const sources = registry.listSources()

      expect(sources).toHaveLength(3)
      expect(sources[0].name).toBe('source3') // priority 15
      expect(sources[1].name).toBe('source1') // priority 10
      expect(sources[2].name).toBe('source2') // priority 5
    })

    it('should filter sources by type', () => {
      const sqliteSources = registry.listSources({ type: 'sqlite' })
      expect(sqliteSources).toHaveLength(1)
      expect(sqliteSources[0].name).toBe('source1')
    })

    it('should filter sources by multiple types', () => {
      const sources = registry.listSources({ type: ['sqlite', 'postgres'] })
      expect(sources).toHaveLength(2)
    })

    it('should filter sources by tags', () => {
      const cacheSources = registry.listSources({ tags: ['cache'] })
      expect(cacheSources).toHaveLength(1)
      expect(cacheSources[0].name).toBe('source3')
    })

    it('should sort sources by name', () => {
      const sources = registry.listSources({ sortBy: 'name', sortOrder: 'asc' })

      expect(sources[0].name).toBe('source1')
      expect(sources[1].name).toBe('source2')
      expect(sources[2].name).toBe('source3')
    })

    it('should exclude unavailable sources by default', () => {
      registry.markSourceUnavailable('source2', 'Connection failed')

      const sources = registry.listSources()

      expect(sources).toHaveLength(2)
      expect(sources.find(s => s.name === 'source2')).toBeUndefined()
    })

    it('should include unavailable sources when requested', () => {
      registry.markSourceUnavailable('source2', 'Connection failed')

      const sources = registry.listSources({ includeUnavailable: true })

      expect(sources).toHaveLength(3)
    })
  })
})

// =============================================================================
// Schema Introspection Tests
// =============================================================================

describe('CatalogRegistry Schema Management', () => {
  let registry: CatalogRegistry

  beforeEach(() => {
    registry = new CatalogRegistry()
    registry.registerSource('test_db', { type: 'memory', connection: {} })
  })

  describe('schema registration', () => {
    it('should register schema for a source', () => {
      const schema: SourceSchema = {
        tables: {
          users: {
            columns: {
              id: { type: 'integer', nullable: false, primaryKey: true },
              name: { type: 'string', nullable: false },
              email: { type: 'string', nullable: true },
            },
          },
          orders: {
            columns: {
              id: { type: 'integer', primaryKey: true },
              user_id: { type: 'integer' },
              total: { type: 'number' },
            },
          },
        },
      }

      registry.registerSchema('test_db', schema)

      const retrieved = registry.getSchema('test_db')
      expect(retrieved).toBeDefined()
      expect(retrieved?.tables.users).toBeDefined()
      expect(retrieved?.tables.orders).toBeDefined()
    })

    it('should throw when registering schema for non-existent source', () => {
      expect(() => {
        registry.registerSchema('non_existent', { tables: {} })
      }).toThrow("Source 'non_existent' is not registered")
    })

    it('should update updatedAt timestamp on schema registration', async () => {
      const entry = registry.getSource('test_db')!
      const originalUpdatedAt = entry.updatedAt

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10))

      registry.registerSchema('test_db', { tables: { t: { columns: {} } } })

      const updatedEntry = registry.getSource('test_db')!
      expect(updatedEntry.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime())
    })

    it('should index tables when schema is registered', () => {
      registry.registerSchema('test_db', {
        tables: {
          customers: { columns: { id: { type: 'integer' } } },
          products: { columns: { id: { type: 'integer' } } },
        },
      })

      expect(registry.hasTable('customers')).toBe(true)
      expect(registry.hasTable('products')).toBe(true)
      expect(registry.hasTable('non_existent')).toBe(false)
    })
  })

  describe('schema retrieval', () => {
    beforeEach(() => {
      registry.registerSchema('test_db', {
        tables: {
          users: {
            columns: {
              id: { type: 'integer', primaryKey: true },
              name: { type: 'string' },
              age: { type: 'integer', nullable: true },
            },
          },
        },
      })
    })

    it('should get schema for a source', () => {
      const schema = registry.getSchema('test_db')

      expect(schema).toBeDefined()
      expect(Object.keys(schema!.tables)).toContain('users')
    })

    it('should return undefined for source without schema', () => {
      registry.registerSource('empty_db', { type: 'memory', connection: {} })

      const schema = registry.getSchema('empty_db')
      expect(schema).toBeUndefined()
    })

    it('should get table definition', () => {
      const tableDef = registry.getTableDef('test_db', 'users')

      expect(tableDef).toBeDefined()
      expect(tableDef?.columns.id.type).toBe('integer')
      expect(tableDef?.columns.name.type).toBe('string')
    })

    it('should return undefined for non-existent table', () => {
      const tableDef = registry.getTableDef('test_db', 'non_existent')
      expect(tableDef).toBeUndefined()
    })

    it('should get column definition', () => {
      const colDef = registry.getColumnDef('test_db', 'users', 'age')

      expect(colDef).toBeDefined()
      expect(colDef?.type).toBe('integer')
      expect(colDef?.nullable).toBe(true)
    })

    it('should return undefined for non-existent column', () => {
      const colDef = registry.getColumnDef('test_db', 'users', 'non_existent')
      expect(colDef).toBeUndefined()
    })
  })

  describe('schema discovery', () => {
    it('should discover schema from adapter', async () => {
      const adapter = createMemoryAdapter({
        users: [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ],
        orders: [
          { id: 101, user_id: 1, total: 99.99 },
        ],
      })

      registry.attachAdapter('test_db', adapter)

      const schema = await registry.discoverSchema('test_db')

      expect(schema.tables.users).toBeDefined()
      expect(schema.tables.orders).toBeDefined()
      expect(schema.tables.users.columns.id.type).toBe('integer')
      expect(schema.tables.users.columns.name.type).toBe('string')
      expect(schema.tables.orders.columns.total.type).toBe('number')
    })

    it('should throw when discovering schema without adapter', async () => {
      await expect(registry.discoverSchema('test_db')).rejects.toThrow(
        "No adapter attached to source 'test_db'"
      )
    })

    it('should infer column types correctly', async () => {
      const adapter = createMemoryAdapter({
        mixed: [
          {
            int_col: 42,
            float_col: 3.14,
            bool_col: true,
            str_col: 'hello',
            timestamp_col: '2024-01-15T10:30:00Z',
            json_col: { nested: 'data' },
          },
        ],
      })

      registry.attachAdapter('test_db', adapter)

      const schema = await registry.discoverSchema('test_db')
      const cols = schema.tables.mixed.columns

      expect(cols.int_col.type).toBe('integer')
      expect(cols.float_col.type).toBe('number')
      expect(cols.bool_col.type).toBe('boolean')
      expect(cols.str_col.type).toBe('string')
      expect(cols.timestamp_col.type).toBe('timestamp')
      expect(cols.json_col.type).toBe('json')
    })
  })
})

// =============================================================================
// Statistics Tests
// =============================================================================

describe('CatalogRegistry Statistics', () => {
  let registry: CatalogRegistry

  beforeEach(() => {
    registry = new CatalogRegistry()
    registry.registerSource('stats_db', { type: 'postgres', connection: {} })
  })

  describe('statistics registration', () => {
    it('should register statistics for a source', () => {
      const stats: SourceStatistics = {
        tables: {
          users: {
            rowCount: 1_000_000,
            sizeBytes: 500_000_000,
            distinctCounts: {
              id: 1_000_000,
              status: 5,
              department: 50,
            },
          },
          orders: {
            rowCount: 10_000_000,
            sizeBytes: 5_000_000_000,
            distinctCounts: {
              customer_id: 500_000,
            },
          },
        },
      }

      registry.registerStatistics('stats_db', stats)

      const retrieved = registry.getStatistics('stats_db')
      expect(retrieved).toBeDefined()
      expect(retrieved?.tables.users.rowCount).toBe(1_000_000)
      expect(retrieved?.tables.orders.sizeBytes).toBe(5_000_000_000)
    })

    it('should throw when registering statistics for non-existent source', () => {
      expect(() => {
        registry.registerStatistics('non_existent', { tables: {} })
      }).toThrow("Source 'non_existent' is not registered")
    })

    it('should update statistics for existing source', () => {
      registry.registerStatistics('stats_db', {
        tables: { t1: { rowCount: 100, sizeBytes: 1000 } },
      })

      registry.registerStatistics('stats_db', {
        tables: { t1: { rowCount: 200, sizeBytes: 2000 } },
      })

      const stats = registry.getStatistics('stats_db')
      expect(stats?.tables.t1.rowCount).toBe(200)
    })
  })

  describe('statistics retrieval', () => {
    beforeEach(() => {
      registry.registerStatistics('stats_db', {
        tables: {
          users: {
            rowCount: 50_000,
            sizeBytes: 25_000_000,
            distinctCounts: {
              id: 50_000,
              country: 100,
            },
          },
        },
      })
    })

    it('should get statistics for a source', () => {
      const stats = registry.getStatistics('stats_db')

      expect(stats).toBeDefined()
      expect(stats?.tables.users).toBeDefined()
    })

    it('should return undefined for source without statistics', () => {
      registry.registerSource('empty_stats', { type: 'memory', connection: {} })

      const stats = registry.getStatistics('empty_stats')
      expect(stats).toBeUndefined()
    })

    it('should get table-specific statistics', () => {
      const tableStats = registry.getTableStatistics('stats_db', 'users')

      expect(tableStats).toBeDefined()
      expect(tableStats?.rowCount).toBe(50_000)
      expect(tableStats?.sizeBytes).toBe(25_000_000)
      expect(tableStats?.distinctCounts?.country).toBe(100)
    })

    it('should return undefined for non-existent table statistics', () => {
      const tableStats = registry.getTableStatistics('stats_db', 'non_existent')
      expect(tableStats).toBeUndefined()
    })
  })
})

// =============================================================================
// Namespace Resolution Tests
// =============================================================================

describe('CatalogRegistry Namespace Resolution', () => {
  let registry: CatalogRegistry

  beforeEach(() => {
    registry = new CatalogRegistry()
  })

  describe('table lookup', () => {
    beforeEach(() => {
      registry.registerSource('db1', {
        type: 'memory',
        connection: {},
        schema: {
          tables: {
            users: { columns: { id: { type: 'integer' } } },
            orders: { columns: { id: { type: 'integer' } } },
          },
        },
      })

      registry.registerSource('db2', {
        type: 'postgres',
        connection: {},
        priority: 10,
        schema: {
          tables: {
            products: { columns: { id: { type: 'integer' } } },
            orders: { columns: { id: { type: 'integer' } } }, // Duplicate table name
          },
        },
      })
    })

    it('should find sources for a unique table', () => {
      const sources = registry.findSourcesForTable('users')

      expect(sources).toHaveLength(1)
      expect(sources[0].name).toBe('db1')
    })

    it('should find all sources for a duplicate table', () => {
      const sources = registry.findSourcesForTable('orders')

      expect(sources).toHaveLength(2)
    })

    it('should return sources sorted by priority', () => {
      const sources = registry.findSourcesForTable('orders')

      expect(sources[0].name).toBe('db2') // priority 10
      expect(sources[1].name).toBe('db1') // priority 0
    })

    it('should return empty array for non-existent table', () => {
      const sources = registry.findSourcesForTable('non_existent')
      expect(sources).toHaveLength(0)
    })

    it('should get preferred source (highest priority)', () => {
      const source = registry.getPreferredSourceForTable('orders')

      expect(source).toBeDefined()
      expect(source?.name).toBe('db2')
    })

    it('should filter by required capabilities', () => {
      // db2 with more capabilities
      const entry = registry.getSource('db2')!
      entry.capabilities.aggregationPushdown = true
      entry.capabilities.joinPushdown = true

      const sources = registry.findSourcesForTable('orders', {
        requiredCapabilities: ['aggregationPushdown', 'joinPushdown'],
      })

      expect(sources).toHaveLength(1)
      expect(sources[0].name).toBe('db2')
    })

    it('should exclude unavailable sources by default', () => {
      registry.markSourceUnavailable('db2', 'Down')

      const sources = registry.findSourcesForTable('orders')

      expect(sources).toHaveLength(1)
      expect(sources[0].name).toBe('db1')
    })

    it('should get all tables across sources', () => {
      const tables = registry.getAllTables()

      expect(tables).toContain('users')
      expect(tables).toContain('orders')
      expect(tables).toContain('products')
    })
  })

  describe('hierarchical namespace resolution', () => {
    beforeEach(() => {
      registry.registerSource('warehouse', {
        type: 'postgres',
        connection: {},
        metadata: { catalog: 'warehouse', schema: 'public' },
        schema: {
          tables: {
            customers: { columns: { id: { type: 'integer' } } },
            orders: { columns: { id: { type: 'integer' } } },
          },
        },
      })

      registry.registerSource('analytics', {
        type: 'memory',
        connection: {},
        schema: {
          tables: {
            events: { columns: { id: { type: 'integer' } } },
          },
        },
      })
    })

    it('should resolve source.table format', () => {
      const resolved = registry.resolveTable('warehouse.customers')

      expect(resolved.source).toBe('warehouse')
      expect(resolved.table).toBe('customers')
    })

    it('should resolve unqualified table with single source', () => {
      const resolved = registry.resolveTable('events')

      expect(resolved.source).toBe('analytics')
      expect(resolved.table).toBe('events')
    })

    it('should throw for ambiguous unqualified table', () => {
      // Both sources have a table that could match after adding to analytics
      registry.registerSchema('analytics', {
        tables: {
          customers: { columns: { id: { type: 'integer' } } },
        },
      })

      expect(() => registry.resolveTable('customers')).toThrow(
        /Ambiguous table reference/
      )
    })

    it('should use default source for unqualified tables', () => {
      registry.setDefaultSource('warehouse')

      // Even if table doesn't exist, it should return default source
      const resolved = registry.resolveTable('orders')

      expect(resolved.source).toBe('warehouse')
      expect(resolved.table).toBe('orders')
    })

    it('should resolve with default catalog', () => {
      registry.setDefaultCatalog('warehouse')

      // When using schema.table format with default catalog
      // First configure a source with hierarchical schema
      registry.registerSource('main', {
        type: 'memory',
        connection: {},
        metadata: { catalog: 'main', schema: 'public' },
        schema: {
          tables: {
            users: { columns: { id: { type: 'integer' } } },
          },
        },
      })

      registry.setDefaultSource('main')

      const resolved = registry.resolveTable('users')
      expect(resolved.source).toBe('main')
      expect(resolved.table).toBe('users')
    })

    it('should throw for table not found', () => {
      expect(() => registry.resolveTable('non_existent')).toThrow(
        /Table 'non_existent' not found/
      )
    })

    it('should throw when all sources are unavailable', () => {
      registry.markSourceUnavailable('warehouse', 'Down')
      registry.markSourceUnavailable('analytics', 'Down')

      // events only exists in analytics which is unavailable
      expect(() => registry.resolveTable('events')).toThrow(
        /all sources are unavailable/
      )
    })
  })

  describe('default source management', () => {
    it('should set and get default source', () => {
      registry.registerSource('main', { type: 'memory', connection: {} })

      registry.setDefaultSource('main')

      expect(registry.getDefaultSource()).toBe('main')
    })

    it('should throw when setting non-existent default source', () => {
      expect(() => registry.setDefaultSource('non_existent')).toThrow(
        "Source 'non_existent' is not registered"
      )
    })

    it('should allow clearing default source with null', () => {
      registry.registerSource('main', { type: 'memory', connection: {} })
      registry.setDefaultSource('main')

      registry.setDefaultSource(null)

      expect(registry.getDefaultSource()).toBeNull()
    })

    it('should set default catalog and schema', () => {
      registry.setDefaultCatalog('warehouse')
      registry.setDefaultSchema('public')

      // These are internal settings used in resolution
      // No direct getters, but affects resolution behavior
      expect(() => {
        registry.setDefaultCatalog(null)
        registry.setDefaultSchema(null)
      }).not.toThrow()
    })
  })
})

// =============================================================================
// Health and Availability Tests
// =============================================================================

describe('CatalogRegistry Health Management', () => {
  let registry: CatalogRegistry

  beforeEach(() => {
    registry = new CatalogRegistry()
    registry.registerSource('healthy_db', { type: 'postgres', connection: {} })
    registry.registerSource('flaky_db', { type: 'mysql', connection: {} })
  })

  describe('availability tracking', () => {
    it('should check if source is available', () => {
      expect(registry.isSourceAvailable('healthy_db')).toBe(true)
      expect(registry.isSourceAvailable('non_existent')).toBe(false)
    })

    it('should mark source as unavailable', () => {
      registry.markSourceUnavailable('flaky_db', 'Connection timeout')

      expect(registry.isSourceAvailable('flaky_db')).toBe(false)

      const health = registry.getHealth('flaky_db')
      expect(health?.status).toBe('unhealthy')
      expect(health?.error).toBe('Connection timeout')
    })

    it('should mark source as available', () => {
      registry.markSourceUnavailable('flaky_db', 'Down')
      expect(registry.isSourceAvailable('flaky_db')).toBe(false)

      registry.markSourceAvailable('flaky_db', 50)

      expect(registry.isSourceAvailable('flaky_db')).toBe(true)

      const health = registry.getHealth('flaky_db')
      expect(health?.status).toBe('healthy')
      expect(health?.latencyMs).toBe(50)
    })
  })

  describe('health status', () => {
    it('should update health status', () => {
      const healthResult: HealthCheckResult = {
        status: 'degraded',
        latencyMs: 500,
        lastChecked: new Date(),
        details: { connectionPoolUtilization: 0.9 },
      }

      registry.updateHealth('healthy_db', healthResult)

      const health = registry.getHealth('healthy_db')
      expect(health?.status).toBe('degraded')
      expect(health?.latencyMs).toBe(500)
    })

    it('should mark source unavailable when health is unhealthy', () => {
      registry.updateHealth('healthy_db', {
        status: 'unhealthy',
        lastChecked: new Date(),
        error: 'Connection refused',
      })

      expect(registry.isSourceAvailable('healthy_db')).toBe(false)
    })

    it('should mark source available when health improves', () => {
      registry.markSourceUnavailable('flaky_db', 'Down')

      registry.updateHealth('flaky_db', {
        status: 'healthy',
        lastChecked: new Date(),
        latencyMs: 10,
      })

      expect(registry.isSourceAvailable('flaky_db')).toBe(true)
    })

    it('should return undefined health for source without health data', () => {
      const health = registry.getHealth('healthy_db')
      expect(health).toBeUndefined()
    })

    it('should filter sources by health status', () => {
      registry.updateHealth('healthy_db', {
        status: 'healthy',
        lastChecked: new Date(),
      })
      registry.updateHealth('flaky_db', {
        status: 'degraded',
        lastChecked: new Date(),
      })

      const healthySources = registry.listSources({
        health: 'healthy',
        includeUnavailable: true,
      })
      expect(healthySources).toHaveLength(1)
      expect(healthySources[0].name).toBe('healthy_db')

      const degradedSources = registry.listSources({
        health: 'degraded',
        includeUnavailable: true,
      })
      expect(degradedSources).toHaveLength(1)
      expect(degradedSources[0].name).toBe('flaky_db')
    })
  })
})

// =============================================================================
// Capability Queries Tests
// =============================================================================

describe('CatalogRegistry Capability Queries', () => {
  let registry: CatalogRegistry

  beforeEach(() => {
    registry = new CatalogRegistry()

    registry.registerSource('full_sql', {
      type: 'postgres',
      connection: {},
      capabilities: {
        predicatePushdown: true,
        projectionPushdown: true,
        limitPushdown: true,
        aggregationPushdown: true,
        joinPushdown: true,
        supportsSQL: true,
        supportsTransactions: true,
        supportsFullTextSearch: true,
      },
    })

    registry.registerSource('basic_kv', {
      type: 'kv',
      connection: {},
      capabilities: {
        predicatePushdown: true,
        projectionPushdown: false,
        limitPushdown: true,
        aggregationPushdown: false,
        joinPushdown: false,
      },
    })

    registry.registerSource('vector_db', {
      type: 'custom',
      connection: {},
      capabilities: {
        predicatePushdown: true,
        projectionPushdown: true,
        limitPushdown: true,
        aggregationPushdown: false,
        joinPushdown: false,
        supportsVectorSearch: true,
      },
    })
  })

  it('should find sources with a specific capability', () => {
    const sources = registry.findSourcesWithCapability('supportsSQL')

    expect(sources).toHaveLength(1)
    expect(sources[0].name).toBe('full_sql')
  })

  it('should find sources with multiple capabilities', () => {
    const sources = registry.findSourcesWithCapabilities([
      'predicatePushdown',
      'projectionPushdown',
    ])

    expect(sources).toHaveLength(2) // full_sql and vector_db
    expect(sources.map(s => s.name)).toContain('full_sql')
    expect(sources.map(s => s.name)).toContain('vector_db')
  })

  it('should check if source has capability', () => {
    expect(registry.sourceHasCapability('full_sql', 'supportsTransactions')).toBe(true)
    expect(registry.sourceHasCapability('basic_kv', 'supportsTransactions')).toBe(false)
    expect(registry.sourceHasCapability('vector_db', 'supportsVectorSearch')).toBe(true)
  })

  it('should get capabilities for a source', () => {
    const caps = registry.getCapabilities('full_sql')

    expect(caps).toBeDefined()
    expect(caps?.aggregationPushdown).toBe(true)
    expect(caps?.supportsFullTextSearch).toBe(true)
  })

  it('should return undefined for non-existent source capabilities', () => {
    const caps = registry.getCapabilities('non_existent')
    expect(caps).toBeUndefined()
  })
})

// =============================================================================
// Adapter Management Tests
// =============================================================================

describe('CatalogRegistry Adapter Management', () => {
  let registry: CatalogRegistry

  beforeEach(() => {
    registry = new CatalogRegistry()
    registry.registerSource('test_db', { type: 'memory', connection: {} })
  })

  it('should attach adapter to source', () => {
    const adapter = createMemoryAdapter({
      users: [{ id: 1, name: 'Alice' }],
    })

    registry.attachAdapter('test_db', adapter)

    expect(registry.getAdapter('test_db')).toBe(adapter)
  })

  it('should throw when attaching adapter to non-existent source', () => {
    const adapter = createMemoryAdapter({})

    expect(() => {
      registry.attachAdapter('non_existent', adapter)
    }).toThrow("Source 'non_existent' is not registered")
  })

  it('should detach adapter from source', () => {
    const adapter = createMemoryAdapter({})
    registry.attachAdapter('test_db', adapter)

    const result = registry.detachAdapter('test_db')

    expect(result).toBe(true)
    expect(registry.getAdapter('test_db')).toBeUndefined()
  })

  it('should return false when detaching non-existent adapter', () => {
    const result = registry.detachAdapter('test_db')
    expect(result).toBe(false)
  })
})

// =============================================================================
// Event Handling Tests
// =============================================================================

describe('CatalogRegistry Events', () => {
  let registry: CatalogRegistry

  beforeEach(() => {
    registry = new CatalogRegistry()
  })

  it('should emit sourceRegistered event', () => {
    const listener = vi.fn()
    registry.on('sourceRegistered', listener)

    registry.registerSource('new_db', { type: 'memory', connection: {} })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: expect.objectContaining({ name: 'new_db' }),
      })
    )
  })

  it('should emit sourceUnregistered event', () => {
    registry.registerSource('temp_db', { type: 'memory', connection: {} })
    const listener = vi.fn()
    registry.on('sourceUnregistered', listener)

    registry.unregisterSource('temp_db')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'temp_db',
        entry: expect.objectContaining({ name: 'temp_db' }),
      })
    )
  })

  it('should emit schemaUpdated event', () => {
    registry.registerSource('db', { type: 'memory', connection: {} })
    const listener = vi.fn()
    registry.on('schemaUpdated', listener)

    registry.registerSchema('db', { tables: { t: { columns: {} } } })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'db',
        schema: expect.objectContaining({ tables: expect.any(Object) }),
      })
    )
  })

  it('should emit healthChanged event', () => {
    registry.registerSource('db', { type: 'memory', connection: {} })
    const listener = vi.fn()
    registry.on('healthChanged', listener)

    registry.markSourceUnavailable('db', 'Connection failed')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'db',
        health: expect.objectContaining({ status: 'unhealthy' }),
      })
    )
  })

  it('should emit statisticsUpdated event', () => {
    registry.registerSource('db', { type: 'memory', connection: {} })
    const listener = vi.fn()
    registry.on('statisticsUpdated', listener)

    registry.registerStatistics('db', {
      tables: { t: { rowCount: 100, sizeBytes: 1000 } },
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'db',
        statistics: expect.any(Object),
      })
    )
  })

  it('should unsubscribe from events', () => {
    const listener = vi.fn()
    const unsubscribe = registry.on('sourceRegistered', listener)

    registry.registerSource('db1', { type: 'memory', connection: {} })
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()

    registry.registerSource('db2', { type: 'memory', connection: {} })
    expect(listener).toHaveBeenCalledTimes(1) // Still 1, not called again
  })

  it('should remove listener with off()', () => {
    const listener = vi.fn()
    registry.on('sourceRegistered', listener)

    registry.registerSource('db1', { type: 'memory', connection: {} })
    expect(listener).toHaveBeenCalledTimes(1)

    registry.off('sourceRegistered', listener)

    registry.registerSource('db2', { type: 'memory', connection: {} })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should handle listener errors gracefully', () => {
    const errorListener = vi.fn().mockImplementation(() => {
      throw new Error('Listener error')
    })
    const goodListener = vi.fn()

    registry.on('sourceRegistered', errorListener)
    registry.on('sourceRegistered', goodListener)

    // Should not throw
    expect(() => {
      registry.registerSource('db', { type: 'memory', connection: {} })
    }).not.toThrow()

    // Both listeners should have been called
    expect(errorListener).toHaveBeenCalled()
    expect(goodListener).toHaveBeenCalled()
  })
})

// =============================================================================
// Serialization Tests
// =============================================================================

describe('CatalogRegistry Serialization', () => {
  let registry: CatalogRegistry

  beforeEach(() => {
    registry = new CatalogRegistry()
  })

  it('should export catalog to JSON', () => {
    registry.registerSource('db1', {
      type: 'postgres',
      connection: { host: 'localhost', port: 5432 },
      priority: 10,
      tags: ['primary'],
    })
    registry.registerSource('db2', {
      type: 'memory',
      connection: {},
    })
    registry.setDefaultSource('db1')

    const json = registry.toJSON()
    const data = JSON.parse(json)

    expect(data.sources).toHaveLength(2)
    expect(data.defaultSource).toBe('db1')
    expect(data.sources.find((s: any) => s.name === 'db1').priority).toBe(10)
  })

  it('should import catalog from JSON', () => {
    const json = JSON.stringify({
      sources: [
        {
          name: 'imported_db',
          type: 'sqlite',
          connection: { url: ':memory:' },
          capabilities: {
            predicatePushdown: true,
            projectionPushdown: true,
            limitPushdown: true,
            aggregationPushdown: false,
            joinPushdown: false,
          },
          priority: 5,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
      ],
      defaultSource: 'imported_db',
    })

    registry.fromJSON(json)

    expect(registry.hasSource('imported_db')).toBe(true)
    expect(registry.getDefaultSource()).toBe('imported_db')

    const source = registry.getSource('imported_db')!
    expect(source.type).toBe('sqlite')
    expect(source.priority).toBe(5)
    expect(source.createdAt.toISOString()).toBe('2024-01-01T00:00:00.000Z')
  })

  it('should handle health status in serialization', () => {
    registry.registerSource('health_db', { type: 'memory', connection: {} })
    registry.updateHealth('health_db', {
      status: 'degraded',
      latencyMs: 200,
      lastChecked: new Date('2024-01-15T10:00:00Z'),
    })

    const json = registry.toJSON()
    const newRegistry = new CatalogRegistry()
    newRegistry.fromJSON(json)

    const health = newRegistry.getHealth('health_db')
    expect(health?.status).toBe('degraded')
    expect(health?.latencyMs).toBe(200)
    expect(health?.lastChecked.toISOString()).toBe('2024-01-15T10:00:00.000Z')
  })

  it('should clear existing state on import', () => {
    registry.registerSource('existing', { type: 'memory', connection: {} })

    const json = JSON.stringify({
      sources: [
        {
          name: 'new_source',
          type: 'sqlite',
          connection: {},
          capabilities: {
            predicatePushdown: true,
            projectionPushdown: true,
            limitPushdown: true,
            aggregationPushdown: false,
            joinPushdown: false,
          },
          priority: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })

    registry.fromJSON(json)

    expect(registry.hasSource('existing')).toBe(false)
    expect(registry.hasSource('new_source')).toBe(true)
  })

  it('should restore unavailable sources from health status', () => {
    const json = JSON.stringify({
      sources: [
        {
          name: 'down_db',
          type: 'postgres',
          connection: {},
          capabilities: {
            predicatePushdown: true,
            projectionPushdown: true,
            limitPushdown: true,
            aggregationPushdown: false,
            joinPushdown: false,
          },
          priority: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          health: {
            status: 'unhealthy',
            error: 'Connection refused',
            lastChecked: new Date().toISOString(),
          },
        },
      ],
    })

    registry.fromJSON(json)

    expect(registry.isSourceAvailable('down_db')).toBe(false)
  })
})
