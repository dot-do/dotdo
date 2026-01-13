/**
 * RED Phase: Multi-Source Catalog Registry Tests
 *
 * Tests for the catalog registry that manages multiple data sources
 * for query federation. Supports registration, lookup, and routing.
 *
 * @see dotdo-1v9my
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  CatalogRegistry,
  type DataSourceCatalog,
  type SourceCapabilities,
  type RoutingRule,
  type SourcePriority,
  type TableDefinition,
  type ColumnDefinition,
  type TableStatistics,
  type ColumnStatistics,
  type QualifiedName,
} from '../federation/catalog-registry'

describe('CatalogRegistry', () => {
  let registry: CatalogRegistry

  beforeEach(() => {
    registry = new CatalogRegistry()
  })

  describe('source registration', () => {
    it('should register a data source', () => {
      const source: DataSourceCatalog = {
        name: 'primary-postgres',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: {
          tables: ['users', 'orders', 'products'],
          views: [],
        },
        connectionConfig: {
          host: 'localhost',
          port: 5432,
          database: 'mydb',
        },
      }

      registry.registerSource(source)
      const retrieved = registry.getSource('primary-postgres')

      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe('primary-postgres')
      expect(retrieved?.type).toBe('postgres')
    })

    it('should throw when registering duplicate source name', () => {
      const source: DataSourceCatalog = {
        name: 'my-source',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: false,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['users'], views: [] },
      }

      registry.registerSource(source)

      expect(() => registry.registerSource(source)).toThrow(/already registered/)
    })

    it('should allow force-replacing a source with replace option', () => {
      const source1: DataSourceCatalog = {
        name: 'my-source',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: false,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['users'], views: [] },
      }

      const source2: DataSourceCatalog = {
        name: 'my-source',
        type: 'mysql',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['users', 'orders'], views: [] },
      }

      registry.registerSource(source1)
      registry.registerSource(source2, { replace: true })

      const retrieved = registry.getSource('my-source')
      expect(retrieved?.type).toBe('mysql')
      expect(retrieved?.schema.tables).toContain('orders')
    })

    it('should unregister a source', () => {
      const source: DataSourceCatalog = {
        name: 'temp-source',
        type: 'sqlite',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['temp'], views: [] },
      }

      registry.registerSource(source)
      expect(registry.getSource('temp-source')).toBeDefined()

      const removed = registry.unregisterSource('temp-source')
      expect(removed).toBe(true)
      expect(registry.getSource('temp-source')).toBeUndefined()
    })

    it('should return false when unregistering non-existent source', () => {
      const removed = registry.unregisterSource('non-existent')
      expect(removed).toBe(false)
    })

    it('should list all registered sources', () => {
      registry.registerSource({
        name: 'source-a',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['users'], views: [] },
      })

      registry.registerSource({
        name: 'source-b',
        type: 'mongodb',
        capabilities: {
          supportsJoins: false,
          supportsAggregations: true,
          supportsTransactions: false,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['documents'], views: [] },
      })

      const sources = registry.listSources()

      expect(sources).toHaveLength(2)
      expect(sources.map(s => s.name)).toContain('source-a')
      expect(sources.map(s => s.name)).toContain('source-b')
    })

    it('should filter sources by type when listing', () => {
      registry.registerSource({
        name: 'pg1',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['a'], views: [] },
      })

      registry.registerSource({
        name: 'mongo1',
        type: 'mongodb',
        capabilities: {
          supportsJoins: false,
          supportsAggregations: true,
          supportsTransactions: false,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['b'], views: [] },
      })

      registry.registerSource({
        name: 'pg2',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['c'], views: [] },
      })

      const postgresSources = registry.listSources({ type: 'postgres' })

      expect(postgresSources).toHaveLength(2)
      expect(postgresSources.every(s => s.type === 'postgres')).toBe(true)
    })
  })

  describe('table lookup', () => {
    beforeEach(() => {
      registry.registerSource({
        name: 'primary-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['users', 'orders'], views: ['user_summary'] },
      })

      registry.registerSource({
        name: 'analytics-db',
        type: 'clickhouse',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: false,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['events', 'metrics', 'orders'], views: [] },
      })

      registry.registerSource({
        name: 'search-engine',
        type: 'elasticsearch',
        capabilities: {
          supportsJoins: false,
          supportsAggregations: true,
          supportsTransactions: false,
          supportsFullTextSearch: true,
          supportsVectorSearch: true,
        },
        schema: { tables: ['products', 'documents'], views: [] },
      })
    })

    it('should find sources by table name', () => {
      const sources = registry.findSourcesForTable('users')

      expect(sources).toHaveLength(1)
      expect(sources[0]?.name).toBe('primary-db')
    })

    it('should find multiple sources for table available in multiple databases', () => {
      const sources = registry.findSourcesForTable('orders')

      expect(sources).toHaveLength(2)
      expect(sources.map(s => s.name)).toContain('primary-db')
      expect(sources.map(s => s.name)).toContain('analytics-db')
    })

    it('should return empty array for unknown table', () => {
      const sources = registry.findSourcesForTable('unknown_table')

      expect(sources).toHaveLength(0)
    })

    it('should find sources by view name', () => {
      const sources = registry.findSourcesForTable('user_summary')

      expect(sources).toHaveLength(1)
      expect(sources[0]?.name).toBe('primary-db')
    })

    it('should check if table exists in any source', () => {
      expect(registry.hasTable('users')).toBe(true)
      expect(registry.hasTable('events')).toBe(true)
      expect(registry.hasTable('unknown')).toBe(false)
    })

    it('should get all tables across all sources', () => {
      const tables = registry.getAllTables()

      expect(tables).toContain('users')
      expect(tables).toContain('orders')
      expect(tables).toContain('events')
      expect(tables).toContain('products')
      // Should deduplicate (orders appears in two sources)
      expect(tables.filter(t => t === 'orders')).toHaveLength(1)
    })
  })

  describe('priority-based source selection', () => {
    beforeEach(() => {
      registry.registerSource({
        name: 'primary-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['orders'], views: [] },
        priority: 10, // Higher priority
      })

      registry.registerSource({
        name: 'replica-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: false, // Read-only replica
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['orders'], views: [] },
        priority: 5, // Lower priority
      })

      registry.registerSource({
        name: 'analytics-db',
        type: 'clickhouse',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: false,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['orders'], views: [] },
        priority: 3, // Lowest priority
      })
    })

    it('should return sources sorted by priority (highest first)', () => {
      const sources = registry.findSourcesForTable('orders')

      expect(sources[0]?.name).toBe('primary-db')
      expect(sources[1]?.name).toBe('replica-db')
      expect(sources[2]?.name).toBe('analytics-db')
    })

    it('should select preferred source based on highest priority', () => {
      const preferred = registry.getPreferredSourceForTable('orders')

      expect(preferred?.name).toBe('primary-db')
    })

    it('should allow setting custom priority for a source', () => {
      registry.setSourcePriority('analytics-db', 100)

      const preferred = registry.getPreferredSourceForTable('orders')
      expect(preferred?.name).toBe('analytics-db')
    })

    it('should use default priority of 0 when not specified', () => {
      registry.registerSource({
        name: 'no-priority-db',
        type: 'sqlite',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['orders'], views: [] },
        // No priority specified - defaults to 0
      })

      const source = registry.getSource('no-priority-db')
      expect(source?.priority).toBe(0)
    })
  })

  describe('capability queries', () => {
    beforeEach(() => {
      registry.registerSource({
        name: 'transactional-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['orders'], views: [] },
      })

      registry.registerSource({
        name: 'search-db',
        type: 'elasticsearch',
        capabilities: {
          supportsJoins: false,
          supportsAggregations: true,
          supportsTransactions: false,
          supportsFullTextSearch: true,
          supportsVectorSearch: true,
        },
        schema: { tables: ['products'], views: [] },
      })

      registry.registerSource({
        name: 'analytics-db',
        type: 'clickhouse',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: false,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['events'], views: [] },
      })
    })

    it('should find sources with specific capability', () => {
      const joinCapableSources = registry.findSourcesWithCapability('supportsJoins')

      expect(joinCapableSources).toHaveLength(2)
      expect(joinCapableSources.map(s => s.name)).toContain('transactional-db')
      expect(joinCapableSources.map(s => s.name)).toContain('analytics-db')
    })

    it('should find sources with transaction support', () => {
      const txSources = registry.findSourcesWithCapability('supportsTransactions')

      expect(txSources).toHaveLength(1)
      expect(txSources[0]?.name).toBe('transactional-db')
    })

    it('should find sources with full-text search', () => {
      const ftsSources = registry.findSourcesWithCapability('supportsFullTextSearch')

      expect(ftsSources).toHaveLength(1)
      expect(ftsSources[0]?.name).toBe('search-db')
    })

    it('should find sources with vector search', () => {
      const vectorSources = registry.findSourcesWithCapability('supportsVectorSearch')

      expect(vectorSources).toHaveLength(1)
      expect(vectorSources[0]?.name).toBe('search-db')
    })

    it('should check if source has capability', () => {
      expect(registry.sourceHasCapability('transactional-db', 'supportsTransactions')).toBe(true)
      expect(registry.sourceHasCapability('transactional-db', 'supportsVectorSearch')).toBe(false)
      expect(registry.sourceHasCapability('search-db', 'supportsVectorSearch')).toBe(true)
    })

    it('should return false for unknown source capability check', () => {
      expect(registry.sourceHasCapability('unknown-source', 'supportsJoins')).toBe(false)
    })

    it('should find sources matching multiple capabilities', () => {
      const sources = registry.findSourcesWithCapabilities(['supportsJoins', 'supportsAggregations'])

      expect(sources).toHaveLength(2) // transactional-db and analytics-db
      expect(sources.map(s => s.name)).not.toContain('search-db') // No joins
    })
  })

  describe('routing rules', () => {
    beforeEach(() => {
      registry.registerSource({
        name: 'write-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['users', 'orders'], views: [] },
        priority: 10,
      })

      registry.registerSource({
        name: 'read-replica',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: false,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['users', 'orders'], views: [] },
        priority: 5,
      })
    })

    it('should add routing rule for table', () => {
      const rule: RoutingRule = {
        table: 'users',
        preferredSource: 'read-replica',
        condition: 'read-only',
      }

      registry.addRoutingRule(rule)
      const rules = registry.getRoutingRules('users')

      expect(rules).toHaveLength(1)
      expect(rules[0]?.preferredSource).toBe('read-replica')
    })

    it('should route to specific source based on rule', () => {
      registry.addRoutingRule({
        table: 'orders',
        preferredSource: 'read-replica',
        condition: 'read-only',
      })

      const source = registry.resolveSource('orders', { readOnly: true })

      expect(source?.name).toBe('read-replica')
    })

    it('should fall back to priority when no rule matches', () => {
      const source = registry.resolveSource('users', { readOnly: false })

      expect(source?.name).toBe('write-db') // Higher priority
    })

    it('should support wildcard routing rules', () => {
      registry.addRoutingRule({
        table: '*',
        preferredSource: 'read-replica',
        condition: 'read-only',
      })

      const source = registry.resolveSource('orders', { readOnly: true })
      expect(source?.name).toBe('read-replica')
    })

    it('should prioritize specific rules over wildcard', () => {
      registry.addRoutingRule({
        table: '*',
        preferredSource: 'read-replica',
        condition: 'read-only',
      })

      registry.addRoutingRule({
        table: 'users',
        preferredSource: 'write-db',
        condition: 'read-only',
      })

      const usersSource = registry.resolveSource('users', { readOnly: true })
      expect(usersSource?.name).toBe('write-db')

      const ordersSource = registry.resolveSource('orders', { readOnly: true })
      expect(ordersSource?.name).toBe('read-replica')
    })

    it('should remove routing rules', () => {
      registry.addRoutingRule({
        table: 'orders',
        preferredSource: 'read-replica',
        condition: 'read-only',
      })

      registry.removeRoutingRule('orders', 'read-only')

      const rules = registry.getRoutingRules('orders')
      expect(rules).toHaveLength(0)
    })

    it('should clear all routing rules', () => {
      registry.addRoutingRule({
        table: 'users',
        preferredSource: 'read-replica',
        condition: 'read-only',
      })

      registry.addRoutingRule({
        table: 'orders',
        preferredSource: 'read-replica',
        condition: 'read-only',
      })

      registry.clearRoutingRules()

      expect(registry.getRoutingRules('users')).toHaveLength(0)
      expect(registry.getRoutingRules('orders')).toHaveLength(0)
    })
  })

  describe('schema management', () => {
    it('should update source schema', () => {
      registry.registerSource({
        name: 'dynamic-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['users'], views: [] },
      })

      registry.updateSourceSchema('dynamic-db', {
        tables: ['users', 'orders', 'products'],
        views: ['user_stats'],
      })

      const source = registry.getSource('dynamic-db')
      expect(source?.schema.tables).toContain('orders')
      expect(source?.schema.tables).toContain('products')
      expect(source?.schema.views).toContain('user_stats')
    })

    it('should throw when updating schema of non-existent source', () => {
      expect(() => {
        registry.updateSourceSchema('non-existent', { tables: ['foo'], views: [] })
      }).toThrow(/not found/)
    })

    it('should refresh table index after schema update', () => {
      registry.registerSource({
        name: 'evolving-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['users'], views: [] },
      })

      // Initially, orders table not found
      expect(registry.hasTable('orders')).toBe(false)

      // Update schema
      registry.updateSourceSchema('evolving-db', {
        tables: ['users', 'orders'],
        views: [],
      })

      // Now orders should be found
      expect(registry.hasTable('orders')).toBe(true)
      const sources = registry.findSourcesForTable('orders')
      expect(sources[0]?.name).toBe('evolving-db')
    })
  })

  describe('source health and status', () => {
    it('should track source availability', () => {
      registry.registerSource({
        name: 'healthcheck-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['data'], views: [] },
      })

      expect(registry.isSourceAvailable('healthcheck-db')).toBe(true)

      registry.markSourceUnavailable('healthcheck-db')
      expect(registry.isSourceAvailable('healthcheck-db')).toBe(false)

      registry.markSourceAvailable('healthcheck-db')
      expect(registry.isSourceAvailable('healthcheck-db')).toBe(true)
    })

    it('should exclude unavailable sources from table lookup', () => {
      registry.registerSource({
        name: 'available-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['shared_table'], views: [] },
        priority: 5,
      })

      registry.registerSource({
        name: 'unavailable-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['shared_table'], views: [] },
        priority: 10,
      })

      registry.markSourceUnavailable('unavailable-db')

      const sources = registry.findSourcesForTable('shared_table')
      expect(sources).toHaveLength(1)
      expect(sources[0]?.name).toBe('available-db')
    })

    it('should include unavailable sources when explicitly requested', () => {
      registry.registerSource({
        name: 'db1',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['data'], views: [] },
      })

      registry.registerSource({
        name: 'db2',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['data'], views: [] },
      })

      registry.markSourceUnavailable('db2')

      const allSources = registry.findSourcesForTable('data', { includeUnavailable: true })
      expect(allSources).toHaveLength(2)
    })
  })

  describe('serialization', () => {
    it('should export catalog to JSON', () => {
      registry.registerSource({
        name: 'export-test',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['users'], views: [] },
        priority: 5,
      })

      const json = registry.toJSON()
      const parsed = JSON.parse(json)

      expect(parsed.sources).toHaveLength(1)
      expect(parsed.sources[0].name).toBe('export-test')
    })

    it('should import catalog from JSON', () => {
      const json = JSON.stringify({
        sources: [
          {
            name: 'imported-db',
            type: 'mysql',
            capabilities: {
              supportsJoins: true,
              supportsAggregations: true,
              supportsTransactions: true,
              supportsFullTextSearch: false,
              supportsVectorSearch: false,
            },
            schema: { tables: ['imported_table'], views: [] },
            priority: 3,
          },
        ],
        routingRules: [],
      })

      registry.fromJSON(json)

      const source = registry.getSource('imported-db')
      expect(source).toBeDefined()
      expect(source?.type).toBe('mysql')
      expect(source?.schema.tables).toContain('imported_table')
    })

    it('should preserve routing rules in serialization', () => {
      registry.registerSource({
        name: 'routing-test',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['data'], views: [] },
      })

      registry.addRoutingRule({
        table: 'data',
        preferredSource: 'routing-test',
        condition: 'default',
      })

      const json = registry.toJSON()
      const newRegistry = new CatalogRegistry()
      newRegistry.fromJSON(json)

      const rules = newRegistry.getRoutingRules('data')
      expect(rules).toHaveLength(1)
    })
  })

  describe('event notification', () => {
    it('should notify on source registration', () => {
      const events: Array<{ type: string; source: string }> = []

      registry.on('sourceRegistered', (source) => {
        events.push({ type: 'registered', source: source.name })
      })

      registry.registerSource({
        name: 'event-test',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['data'], views: [] },
      })

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('registered')
      expect(events[0]?.source).toBe('event-test')
    })

    it('should notify on source unregistration', () => {
      const events: string[] = []

      registry.on('sourceUnregistered', (name) => {
        events.push(name)
      })

      registry.registerSource({
        name: 'to-remove',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['data'], views: [] },
      })

      registry.unregisterSource('to-remove')

      expect(events).toContain('to-remove')
    })

    it('should notify on availability change', () => {
      const events: Array<{ source: string; available: boolean }> = []

      registry.on('availabilityChanged', (name, available) => {
        events.push({ source: name, available })
      })

      registry.registerSource({
        name: 'health-watch',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: { tables: ['data'], views: [] },
      })

      registry.markSourceUnavailable('health-watch')
      registry.markSourceAvailable('health-watch')

      expect(events).toHaveLength(2)
      expect(events[0]?.available).toBe(false)
      expect(events[1]?.available).toBe(true)
    })
  })

  describe('hierarchical namespace support', () => {
    beforeEach(() => {
      registry.registerSource({
        name: 'sales-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: {
          tables: ['orders', 'customers'],
          views: [],
          defaultCatalog: 'main',
          defaultSchema: 'sales',
        },
        priority: 10,
      })

      registry.registerSource({
        name: 'analytics-db',
        type: 'clickhouse',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: false,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: {
          tables: ['orders', 'metrics'],
          views: [],
          defaultCatalog: 'warehouse',
          defaultSchema: 'analytics',
        },
        priority: 5,
      })
    })

    it('should parse qualified names correctly', () => {
      expect(registry.parseQualifiedName('orders')).toEqual({ table: 'orders' })
      expect(registry.parseQualifiedName('sales.orders')).toEqual({ schema: 'sales', table: 'orders' })
      expect(registry.parseQualifiedName('main.sales.orders')).toEqual({
        catalog: 'main',
        schema: 'sales',
        table: 'orders',
      })
    })

    it('should format qualified names correctly', () => {
      expect(registry.formatQualifiedName({ table: 'orders' })).toBe('orders')
      expect(registry.formatQualifiedName({ schema: 'sales', table: 'orders' })).toBe('sales.orders')
      expect(registry.formatQualifiedName({ catalog: 'main', schema: 'sales', table: 'orders' })).toBe(
        'main.sales.orders'
      )
    })

    it('should resolve simple table names', () => {
      const result = registry.resolveQualifiedName('orders')

      expect(result).toBeDefined()
      expect(result?.source.name).toBe('sales-db') // Higher priority
      expect(result?.table).toBe('orders')
    })

    it('should resolve schema.table names', () => {
      const result = registry.resolveQualifiedName('analytics.metrics')

      expect(result).toBeDefined()
      expect(result?.source.name).toBe('analytics-db')
      expect(result?.table).toBe('metrics')
    })

    it('should resolve catalog.schema.table names', () => {
      const result = registry.resolveQualifiedName('warehouse.analytics.orders')

      expect(result).toBeDefined()
      expect(result?.source.name).toBe('analytics-db')
      expect(result?.table).toBe('orders')
    })

    it('should return undefined for non-existent qualified names', () => {
      expect(registry.resolveQualifiedName('nonexistent.schema.table')).toBeUndefined()
    })

    it('should list all qualified names', () => {
      const names = registry.listQualifiedNames()

      expect(names).toContain('orders')
      expect(names).toContain('sales.orders')
      expect(names).toContain('main.sales.orders')
      expect(names).toContain('analytics.metrics')
      expect(names).toContain('warehouse.analytics.metrics')
    })
  })

  describe('column and schema introspection', () => {
    beforeEach(() => {
      registry.registerSource({
        name: 'typed-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: {
          tables: ['users'],
          views: [],
        },
      })
    })

    it('should register and retrieve table definitions with columns', () => {
      registry.registerTableDefinition('typed-db', {
        name: 'users',
        columns: [
          { name: 'id', type: 'integer', primaryKey: true, nullable: false },
          { name: 'email', type: 'string', nullable: false },
          { name: 'name', type: 'string', nullable: true },
          { name: 'created_at', type: 'timestamp', nullable: false },
        ],
        primaryKey: ['id'],
        comment: 'User accounts table',
      })

      const definition = registry.getTableDefinition('typed-db', 'users')

      expect(definition).toBeDefined()
      expect(definition?.columns).toHaveLength(4)
      expect(definition?.columns[0]?.type).toBe('integer')
      expect(definition?.primaryKey).toEqual(['id'])
    })

    it('should get columns for a table', () => {
      registry.registerTableDefinition('typed-db', {
        name: 'users',
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'email', type: 'string' },
        ],
      })

      const columns = registry.getTableColumns('typed-db', 'users')

      expect(columns).toHaveLength(2)
      expect(columns.map(c => c.name)).toEqual(['id', 'email'])
    })

    it('should return empty array for unknown table columns', () => {
      const columns = registry.getTableColumns('typed-db', 'unknown')

      expect(columns).toHaveLength(0)
    })

    it('should add table to schema when registering table definition', () => {
      registry.registerTableDefinition('typed-db', {
        name: 'products',
        columns: [{ name: 'id', type: 'integer' }],
      })

      const source = registry.getSource('typed-db')
      expect(source?.schema.tables).toContain('products')
      expect(registry.hasTable('products')).toBe(true)
    })

    it('should get all table definitions for a source', () => {
      registry.registerTableDefinition('typed-db', {
        name: 'users',
        columns: [{ name: 'id', type: 'integer' }],
      })
      registry.registerTableDefinition('typed-db', {
        name: 'orders',
        columns: [{ name: 'id', type: 'integer' }],
      })

      const definitions = registry.getAllTableDefinitions('typed-db')

      expect(definitions).toHaveLength(2)
    })

    it('should throw when registering definition for unknown source', () => {
      expect(() => {
        registry.registerTableDefinition('unknown-source', {
          name: 'test',
          columns: [],
        })
      }).toThrow(/not found/)
    })
  })

  describe('table statistics for cost estimation', () => {
    beforeEach(() => {
      registry.registerSource({
        name: 'stats-db',
        type: 'postgres',
        capabilities: {
          supportsJoins: true,
          supportsAggregations: true,
          supportsTransactions: true,
          supportsFullTextSearch: false,
          supportsVectorSearch: false,
        },
        schema: {
          tables: ['large_table', 'small_table'],
          views: [],
        },
      })
    })

    it('should set and get table statistics', () => {
      registry.setTableStatistics('stats-db', 'large_table', {
        rowCount: 1000000,
        sizeBytes: 500000000,
      })

      const stats = registry.getTableStatistics('stats-db', 'large_table')

      expect(stats).toBeDefined()
      expect(stats?.rowCount).toBe(1000000)
      expect(stats?.sizeBytes).toBe(500000000)
      expect(stats?.lastUpdated).toBeInstanceOf(Date)
    })

    it('should estimate row count', () => {
      registry.setTableStatistics('stats-db', 'small_table', {
        rowCount: 100,
      })

      const estimate = registry.estimateRowCount('stats-db', 'small_table')

      expect(estimate).toBe(100)
    })

    it('should return undefined for tables without statistics', () => {
      expect(registry.getTableStatistics('stats-db', 'unknown')).toBeUndefined()
      expect(registry.estimateRowCount('stats-db', 'unknown')).toBeUndefined()
    })

    it('should set and get column statistics', () => {
      registry.setColumnStatistics('stats-db', 'large_table', 'user_id', {
        distinctCount: 50000,
        nullCount: 0,
        minValue: 1,
        maxValue: 50000,
      })

      const columnStats = registry.getColumnStatistics('stats-db', 'large_table', 'user_id')

      expect(columnStats).toBeDefined()
      expect(columnStats?.distinctCount).toBe(50000)
      expect(columnStats?.nullCount).toBe(0)
    })

    it('should estimate selectivity based on column statistics', () => {
      registry.setTableStatistics('stats-db', 'large_table', {
        rowCount: 1000000,
      })
      registry.setColumnStatistics('stats-db', 'large_table', 'status', {
        distinctCount: 5,
      })

      const selectivity = registry.estimateSelectivity('stats-db', 'large_table', 'status', 'active')

      expect(selectivity).toBe(0.2) // 1/5 = 0.2
    })

    it('should return default selectivity when no statistics available', () => {
      const selectivity = registry.estimateSelectivity('stats-db', 'unknown_table', 'column', 'value')

      expect(selectivity).toBe(0.1) // Default
    })

    it('should clear statistics for a source', () => {
      registry.setTableStatistics('stats-db', 'large_table', { rowCount: 1000 })
      registry.setTableStatistics('stats-db', 'small_table', { rowCount: 10 })

      registry.clearStatistics('stats-db')

      expect(registry.getTableStatistics('stats-db', 'large_table')).toBeUndefined()
      expect(registry.getTableStatistics('stats-db', 'small_table')).toBeUndefined()
    })

    it('should throw when setting statistics for unknown source', () => {
      expect(() => {
        registry.setTableStatistics('unknown', 'table', { rowCount: 100 })
      }).toThrow(/not found/)
    })

    it('should throw when setting column statistics for unknown source', () => {
      expect(() => {
        registry.setColumnStatistics('unknown', 'table', 'column', { distinctCount: 10 })
      }).toThrow(/not found/)
    })
  })
})
