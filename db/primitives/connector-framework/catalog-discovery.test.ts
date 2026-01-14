/**
 * Catalog Discovery Tests
 *
 * TDD RED phase: Tests for catalog discovery functionality including:
 * - discover(config) returning AirbyteCatalog
 * - Schema inference for nested objects and array types
 * - Stream metadata (name, namespace, JSON Schema)
 * - Supported sync modes per stream
 * - Primary key and cursor field hints
 *
 * @module db/primitives/connector-framework/catalog-discovery
 */

import { describe, it, expect } from 'vitest'
import {
  // Core types
  type Stream,
  type StreamSchema,
  type PropertySpec,
  type SyncMode,
  // Catalog discovery utilities
  inferPropertyType,
  inferStreamSchema,
  detectPrimaryKey,
  detectCursorField,
  createCatalogBuilder,
  toAirbyteCatalog,
  type AirbyteCatalog,
  // Convenience discovery functions
  discoverStreamFromRecords,
  discoverCatalogFromData,
  // Source connector for integration tests
  createSourceConnector,
  type SourceConfig,
} from './index'

// =============================================================================
// Schema Inference - Nested Objects
// =============================================================================

describe('Schema Inference - Nested Objects', () => {
  describe('inferPropertyType for deeply nested objects', () => {
    it('should infer schema for objects nested 3 levels deep', () => {
      const value = {
        level1: {
          level2: {
            level3: {
              deepValue: 'test',
              deepNumber: 42,
            },
          },
        },
      }

      const result = inferPropertyType(value)
      expect(result.type).toBe('object')
      expect(result.properties?.level1.type).toBe('object')
      expect(result.properties?.level1.properties?.level2.type).toBe('object')
      expect(result.properties?.level1.properties?.level2.properties?.level3.type).toBe('object')
      expect(result.properties?.level1.properties?.level2.properties?.level3.properties?.deepValue.type).toBe('string')
      expect(result.properties?.level1.properties?.level2.properties?.level3.properties?.deepNumber.type).toBe('integer')
    })

    it('should handle mixed nested object types', () => {
      const value = {
        user: {
          name: 'Alice',
          age: 30,
          email: 'alice@example.com',
          settings: {
            darkMode: true,
            notifications: {
              email: true,
              push: false,
            },
          },
        },
      }

      const result = inferPropertyType(value)
      expect(result.type).toBe('object')
      expect(result.properties?.user.type).toBe('object')
      expect(result.properties?.user.properties?.name.type).toBe('string')
      expect(result.properties?.user.properties?.age.type).toBe('integer')
      expect(result.properties?.user.properties?.email.format).toBe('email')
      expect(result.properties?.user.properties?.settings.type).toBe('object')
      expect(result.properties?.user.properties?.settings.properties?.darkMode.type).toBe('boolean')
      expect(result.properties?.user.properties?.settings.properties?.notifications.type).toBe('object')
    })

    it('should handle empty nested objects', () => {
      const value = {
        metadata: {},
      }

      const result = inferPropertyType(value)
      expect(result.type).toBe('object')
      expect(result.properties?.metadata.type).toBe('object')
      expect(result.properties?.metadata.properties).toEqual({})
    })
  })

  describe('inferStreamSchema for nested objects', () => {
    it('should merge nested object schemas from multiple records', () => {
      const records = [
        { id: 1, profile: { name: 'Alice' } },
        { id: 2, profile: { name: 'Bob', age: 25 } },
        { id: 3, profile: { name: 'Charlie', age: 30, city: 'NYC' } },
      ]

      const schema = inferStreamSchema(records)
      expect(schema.properties.profile.type).toBe('object')
      expect(schema.properties.profile.properties?.name.type).toBe('string')
      expect(schema.properties.profile.properties?.age.type).toBe('integer')
      expect(schema.properties.profile.properties?.city.type).toBe('string')
    })

    it('should handle records with varying nested structure depths', () => {
      const records = [
        { id: 1, data: { level1: 'shallow' } },
        { id: 2, data: { level1: { level2: 'deep' } } },
      ]

      // The schema should capture all observed properties
      const schema = inferStreamSchema(records)
      expect(schema.properties.data.type).toBe('object')
      // Note: merging different depths is complex - this tests current behavior
    })
  })
})

// =============================================================================
// Schema Inference - Array Types
// =============================================================================

describe('Schema Inference - Array Types', () => {
  describe('inferPropertyType for arrays', () => {
    it('should infer array of strings', () => {
      const value = ['a', 'b', 'c']
      const result = inferPropertyType(value)
      expect(result.type).toBe('array')
      expect(result.items?.type).toBe('string')
    })

    it('should infer array of integers', () => {
      const value = [1, 2, 3, 4, 5]
      const result = inferPropertyType(value)
      expect(result.type).toBe('array')
      expect(result.items?.type).toBe('integer')
    })

    it('should infer array of numbers (floats)', () => {
      const value = [1.5, 2.7, 3.14]
      const result = inferPropertyType(value)
      expect(result.type).toBe('array')
      expect(result.items?.type).toBe('number')
    })

    it('should infer array of booleans', () => {
      const value = [true, false, true]
      const result = inferPropertyType(value)
      expect(result.type).toBe('array')
      expect(result.items?.type).toBe('boolean')
    })

    it('should infer array of objects', () => {
      const value = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]
      const result = inferPropertyType(value)
      expect(result.type).toBe('array')
      expect(result.items?.type).toBe('object')
      expect(result.items?.properties?.name.type).toBe('string')
      expect(result.items?.properties?.age.type).toBe('integer')
    })

    it('should infer array of arrays (nested arrays)', () => {
      const value = [
        [1, 2, 3],
        [4, 5, 6],
      ]
      const result = inferPropertyType(value)
      expect(result.type).toBe('array')
      expect(result.items?.type).toBe('array')
      expect(result.items?.items?.type).toBe('integer')
    })

    it('should handle empty array', () => {
      const value: unknown[] = []
      const result = inferPropertyType(value)
      expect(result.type).toBe('array')
      // Empty arrays default to string items
      expect(result.items?.type).toBe('string')
    })

    it('should infer array with date-time strings', () => {
      const value = ['2024-01-01T10:00:00Z', '2024-01-02T11:00:00Z']
      const result = inferPropertyType(value)
      expect(result.type).toBe('array')
      expect(result.items?.type).toBe('string')
      expect(result.items?.format).toBe('date-time')
    })

    it('should infer array with email strings', () => {
      const value = ['alice@example.com', 'bob@test.com']
      const result = inferPropertyType(value)
      expect(result.type).toBe('array')
      expect(result.items?.type).toBe('string')
      expect(result.items?.format).toBe('email')
    })
  })

  describe('inferStreamSchema for records with arrays', () => {
    it('should handle records with array fields', () => {
      const records = [
        { id: 1, tags: ['tag1', 'tag2'], scores: [95, 87, 92] },
        { id: 2, tags: ['tag3'], scores: [88] },
      ]

      const schema = inferStreamSchema(records)
      expect(schema.properties.tags.type).toBe('array')
      expect(schema.properties.tags.items?.type).toBe('string')
      expect(schema.properties.scores.type).toBe('array')
      expect(schema.properties.scores.items?.type).toBe('integer')
    })

    it('should handle records with array of objects', () => {
      const records = [
        {
          id: 1,
          items: [
            { product: 'Widget', quantity: 2 },
            { product: 'Gadget', quantity: 1 },
          ],
        },
      ]

      const schema = inferStreamSchema(records)
      expect(schema.properties.items.type).toBe('array')
      expect(schema.properties.items.items?.type).toBe('object')
      expect(schema.properties.items.items?.properties?.product.type).toBe('string')
      expect(schema.properties.items.items?.properties?.quantity.type).toBe('integer')
    })
  })
})

// =============================================================================
// Catalog Discovery - discover(config) Integration
// =============================================================================

describe('Catalog Discovery - discover(config)', () => {
  describe('AirbyteCatalog format', () => {
    it('should return AirbyteCatalog with streams array', async () => {
      const source = createSourceConnector({
        name: 'test-source',
        spec: async () => ({
          name: 'Test Source',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async (config: SourceConfig) => [
          {
            name: 'users',
            namespace: 'public',
            schema: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
              },
            },
            supportedSyncModes: ['full_refresh', 'incremental'] as SyncMode[],
          },
        ],
        read: async function* () {},
      })

      const streams = await source.discover({ database: 'test' })
      const catalog = toAirbyteCatalog(streams)

      expect(catalog.streams).toHaveLength(1)
      expect(catalog.streams[0].stream.name).toBe('users')
      expect(catalog.streams[0].stream.namespace).toBe('public')
    })

    it('should include JSON Schema for each stream', async () => {
      const source = createSourceConnector({
        name: 'schema-test-source',
        spec: async () => ({
          name: 'Schema Test',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          {
            name: 'products',
            schema: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                price: { type: 'number' },
                in_stock: { type: 'boolean' },
                tags: { type: 'array', items: { type: 'string' } },
                metadata: {
                  type: 'object',
                  properties: {
                    created_at: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
            supportedSyncModes: ['full_refresh'] as SyncMode[],
          },
        ],
        read: async function* () {},
      })

      const streams = await source.discover({})
      expect(streams[0].schema.type).toBe('object')
      expect(streams[0].schema.properties.id.type).toBe('string')
      expect(streams[0].schema.properties.price.type).toBe('number')
      expect(streams[0].schema.properties.tags.type).toBe('array')
      expect(streams[0].schema.properties.metadata.type).toBe('object')
    })

    it('should include supported sync modes per stream', async () => {
      const source = createSourceConnector({
        name: 'sync-mode-source',
        spec: async () => ({
          name: 'Sync Mode Test',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          {
            name: 'append_only_stream',
            schema: { type: 'object', properties: {} },
            supportedSyncModes: ['full_refresh'] as SyncMode[],
          },
          {
            name: 'incremental_stream',
            schema: { type: 'object', properties: {} },
            supportedSyncModes: ['full_refresh', 'incremental'] as SyncMode[],
            sourceDefinedCursor: true,
            defaultCursorField: ['updated_at'],
          },
        ],
        read: async function* () {},
      })

      const streams = await source.discover({})
      expect(streams[0].supportedSyncModes).toEqual(['full_refresh'])
      expect(streams[1].supportedSyncModes).toContain('incremental')
      expect(streams[1].sourceDefinedCursor).toBe(true)
    })

    it('should include primary key hints', async () => {
      const source = createSourceConnector({
        name: 'pk-source',
        spec: async () => ({
          name: 'PK Test',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          {
            name: 'simple_pk_table',
            schema: { type: 'object', properties: {} },
            supportedSyncModes: ['full_refresh'] as SyncMode[],
            sourceDefinedPrimaryKey: [['id']],
          },
          {
            name: 'composite_pk_table',
            schema: { type: 'object', properties: {} },
            supportedSyncModes: ['full_refresh'] as SyncMode[],
            sourceDefinedPrimaryKey: [['tenant_id'], ['order_id']],
          },
        ],
        read: async function* () {},
      })

      const streams = await source.discover({})
      expect(streams[0].sourceDefinedPrimaryKey).toEqual([['id']])
      expect(streams[1].sourceDefinedPrimaryKey).toEqual([['tenant_id'], ['order_id']])
    })

    it('should include cursor field hints for incremental', async () => {
      const source = createSourceConnector({
        name: 'cursor-source',
        spec: async () => ({
          name: 'Cursor Test',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          {
            name: 'events',
            schema: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                event_timestamp: { type: 'string', format: 'date-time' },
              },
            },
            supportedSyncModes: ['full_refresh', 'incremental'] as SyncMode[],
            sourceDefinedCursor: true,
            defaultCursorField: ['event_timestamp'],
          },
        ],
        read: async function* () {},
      })

      const streams = await source.discover({})
      expect(streams[0].defaultCursorField).toEqual(['event_timestamp'])
      expect(streams[0].sourceDefinedCursor).toBe(true)
    })
  })

  describe('Multiple streams discovery', () => {
    it('should discover multiple tables/streams', async () => {
      const source = createSourceConnector({
        name: 'multi-table-source',
        spec: async () => ({
          name: 'Multi Table Source',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          {
            name: 'users',
            namespace: 'public',
            schema: { type: 'object', properties: { id: { type: 'integer' } } },
            supportedSyncModes: ['full_refresh', 'incremental'] as SyncMode[],
          },
          {
            name: 'orders',
            namespace: 'public',
            schema: { type: 'object', properties: { id: { type: 'integer' } } },
            supportedSyncModes: ['full_refresh', 'incremental'] as SyncMode[],
          },
          {
            name: 'products',
            namespace: 'inventory',
            schema: { type: 'object', properties: { sku: { type: 'string' } } },
            supportedSyncModes: ['full_refresh'] as SyncMode[],
          },
          {
            name: 'events',
            namespace: 'analytics',
            schema: { type: 'object', properties: { event_id: { type: 'string' } } },
            supportedSyncModes: ['incremental'] as SyncMode[],
          },
        ],
        read: async function* () {},
      })

      const streams = await source.discover({})
      expect(streams).toHaveLength(4)

      const namespaces = new Set(streams.map((s) => s.namespace))
      expect(namespaces.size).toBe(3)
      expect(namespaces).toContain('public')
      expect(namespaces).toContain('inventory')
      expect(namespaces).toContain('analytics')
    })

    it('should handle discovery with no streams', async () => {
      const source = createSourceConnector({
        name: 'empty-source',
        spec: async () => ({
          name: 'Empty Source',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [],
        read: async function* () {},
      })

      const streams = await source.discover({})
      expect(streams).toHaveLength(0)
    })
  })
})

// =============================================================================
// Primary Key Detection - Extended Tests
// =============================================================================

describe('Primary Key Detection - Extended', () => {
  it('should detect uuid as primary key', () => {
    const records = [
      { uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Alice' },
      { uuid: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', name: 'Bob' },
      { uuid: 'c3d4e5f6-a7b8-9012-cdef-345678901234', name: 'Charlie' },
    ]

    const pk = detectPrimaryKey(records)
    expect(pk).toEqual([['uuid']])
  })

  it('should detect pk field as primary key', () => {
    const records = [
      { pk: 'pk-001', data: 'a' },
      { pk: 'pk-002', data: 'b' },
      { pk: 'pk-003', data: 'c' },
    ]

    const pk = detectPrimaryKey(records)
    expect(pk).toEqual([['pk']])
  })

  it('should detect key field as primary key', () => {
    const records = [
      { key: 'key-a', value: 1 },
      { key: 'key-b', value: 2 },
      { key: 'key-c', value: 3 },
    ]

    const pk = detectPrimaryKey(records)
    expect(pk).toEqual([['key']])
  })

  it('should prefer id over other candidates when all present', () => {
    const records = [
      { id: 1, uuid: 'uuid-1', pk: 'pk-1' },
      { id: 2, uuid: 'uuid-2', pk: 'pk-2' },
      { id: 3, uuid: 'uuid-3', pk: 'pk-3' },
    ]

    const pk = detectPrimaryKey(records)
    expect(pk).toEqual([['id']])
  })
})

// =============================================================================
// Cursor Field Detection - Extended Tests
// =============================================================================

describe('Cursor Field Detection - Extended', () => {
  it('should detect modified_at as cursor', () => {
    const schema: StreamSchema = {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        modified_at: { type: 'string', format: 'date-time' },
      },
    }

    const cursor = detectCursorField(schema)
    expect(cursor).toEqual(['modified_at'])
  })

  it('should detect timestamp as cursor', () => {
    const schema: StreamSchema = {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    }

    const cursor = detectCursorField(schema)
    expect(cursor).toEqual(['timestamp'])
  })

  it('should detect date field as cursor', () => {
    const schema: StreamSchema = {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        date: { type: 'string', format: 'date' },
      },
    }

    const cursor = detectCursorField(schema)
    expect(cursor).toEqual(['date'])
  })

  it('should prioritize updated_at over modified_at', () => {
    const schema: StreamSchema = {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        modified_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
        created_at: { type: 'string', format: 'date-time' },
      },
    }

    const cursor = detectCursorField(schema)
    expect(cursor).toEqual(['updated_at'])
  })
})

// =============================================================================
// CatalogBuilder - Extended Tests
// =============================================================================

describe('CatalogBuilder - Extended', () => {
  it('should build catalog with all stream metadata', () => {
    const catalog = createCatalogBuilder()
      .addStream({
        name: 'users',
        namespace: 'public',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            email: { type: 'string', format: 'email' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        supportedSyncModes: ['full_refresh', 'incremental'],
        sourceDefinedPrimaryKey: [['id']],
        sourceDefinedCursor: true,
        defaultCursorField: ['created_at'],
      })
      .build()

    expect(catalog).toHaveLength(1)
    expect(catalog[0].name).toBe('users')
    expect(catalog[0].namespace).toBe('public')
    expect(catalog[0].sourceDefinedPrimaryKey).toEqual([['id']])
    expect(catalog[0].sourceDefinedCursor).toBe(true)
    expect(catalog[0].defaultCursorField).toEqual(['created_at'])
  })

  it('should chain multiple stream additions', () => {
    const builder = createCatalogBuilder()

    const streams = ['users', 'orders', 'products', 'categories', 'reviews']
    for (const name of streams) {
      builder.addStream({
        name,
        schema: { type: 'object', properties: {} },
      })
    }

    const catalog = builder.build()
    expect(catalog).toHaveLength(5)
    expect(catalog.map((s) => s.name)).toEqual(streams)
  })
})

// =============================================================================
// toAirbyteCatalog - Extended Tests
// =============================================================================

describe('toAirbyteCatalog - Extended', () => {
  it('should set default sync mode to incremental when supported', () => {
    const streams: Stream[] = [
      {
        name: 'events',
        schema: { type: 'object', properties: {} },
        supportedSyncModes: ['full_refresh', 'incremental'],
        defaultCursorField: ['timestamp'],
      },
    ]

    const catalog = toAirbyteCatalog(streams)
    expect(catalog.streams[0].config?.syncMode).toBe('incremental')
  })

  it('should set default sync mode to full_refresh when incremental not supported', () => {
    const streams: Stream[] = [
      {
        name: 'static_data',
        schema: { type: 'object', properties: {} },
        supportedSyncModes: ['full_refresh'],
      },
    ]

    const catalog = toAirbyteCatalog(streams)
    expect(catalog.streams[0].config?.syncMode).toBe('full_refresh')
  })

  it('should include cursor field in config when available', () => {
    const streams: Stream[] = [
      {
        name: 'logs',
        schema: { type: 'object', properties: {} },
        supportedSyncModes: ['incremental'],
        defaultCursorField: ['log_timestamp'],
      },
    ]

    const catalog = toAirbyteCatalog(streams)
    expect(catalog.streams[0].config?.cursorField).toEqual(['log_timestamp'])
  })

  it('should include primary key in config when available', () => {
    const streams: Stream[] = [
      {
        name: 'entities',
        schema: { type: 'object', properties: {} },
        supportedSyncModes: ['full_refresh'],
        sourceDefinedPrimaryKey: [['entity_id']],
      },
    ]

    const catalog = toAirbyteCatalog(streams)
    expect(catalog.streams[0].config?.primaryKey).toEqual([['entity_id']])
  })
})

// =============================================================================
// discoverStreamFromRecords - Convenience Function
// =============================================================================

describe('discoverStreamFromRecords', () => {
  it('should create a complete stream definition from sample records', () => {
    // Import the function once implemented
    
    const records = [
      { id: 1, name: 'Alice', email: 'alice@example.com', created_at: '2024-01-01T10:00:00Z' },
      { id: 2, name: 'Bob', email: 'bob@example.com', created_at: '2024-01-02T11:00:00Z' },
    ]

    const stream = discoverStreamFromRecords('users', records)

    expect(stream.name).toBe('users')
    expect(stream.schema.type).toBe('object')
    expect(stream.schema.properties.id.type).toBe('integer')
    expect(stream.schema.properties.email.format).toBe('email')
    expect(stream.supportedSyncModes).toContain('full_refresh')
    expect(stream.sourceDefinedPrimaryKey).toEqual([['id']])
    expect(stream.defaultCursorField).toEqual(['created_at'])
  })

  it('should accept optional namespace', () => {
    
    const records = [{ id: 1, value: 'test' }]
    const stream = discoverStreamFromRecords('items', records, { namespace: 'inventory' })

    expect(stream.namespace).toBe('inventory')
  })

  it('should allow sync modes to be overridden', () => {
    
    const records = [{ id: 1 }]
    const stream = discoverStreamFromRecords('data', records, {
      supportedSyncModes: ['full_refresh', 'incremental'],
    })

    expect(stream.supportedSyncModes).toContain('incremental')
  })

  it('should allow primary key to be explicitly specified', () => {
    
    const records = [
      { tenant_id: 't1', order_id: 'o1', data: 'a' },
      { tenant_id: 't1', order_id: 'o2', data: 'b' },
    ]
    const stream = discoverStreamFromRecords('orders', records, {
      primaryKey: [['tenant_id'], ['order_id']],
    })

    expect(stream.sourceDefinedPrimaryKey).toEqual([['tenant_id'], ['order_id']])
  })

  it('should allow cursor field to be explicitly specified', () => {
    
    const records = [{ id: 1, modified: '2024-01-01T00:00:00Z' }]
    const stream = discoverStreamFromRecords('events', records, {
      cursorField: ['modified'],
    })

    expect(stream.defaultCursorField).toEqual(['modified'])
    expect(stream.sourceDefinedCursor).toBe(true)
  })

  it('should handle empty records array gracefully', () => {
    
    const stream = discoverStreamFromRecords('empty_table', [])

    expect(stream.name).toBe('empty_table')
    expect(stream.schema.type).toBe('object')
    expect(Object.keys(stream.schema.properties)).toHaveLength(0)
    expect(stream.supportedSyncModes).toEqual(['full_refresh'])
  })

  it('should set sourceDefinedCursor when cursor is detected', () => {
    
    const records = [
      { id: 1, updated_at: '2024-01-01T00:00:00Z' },
    ]
    const stream = discoverStreamFromRecords('data', records)

    expect(stream.sourceDefinedCursor).toBe(true)
    expect(stream.defaultCursorField).toEqual(['updated_at'])
  })

  it('should enable incremental sync when cursor is detected', () => {
    
    const records = [
      { id: 1, created_at: '2024-01-01T00:00:00Z' },
      { id: 2, created_at: '2024-01-02T00:00:00Z' },
    ]
    const stream = discoverStreamFromRecords('items', records)

    expect(stream.supportedSyncModes).toContain('incremental')
  })
})

// =============================================================================
// discoverCatalogFromData - Multi-stream Convenience Function
// =============================================================================

describe('discoverCatalogFromData', () => {
  it('should discover multiple streams from data object', () => {
    
    const data = {
      users: [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ],
      orders: [
        { id: 101, user_id: 1, total: 99.99, created_at: '2024-01-01T00:00:00Z' },
        { id: 102, user_id: 2, total: 149.99, created_at: '2024-01-02T00:00:00Z' },
      ],
    }

    const streams = discoverCatalogFromData(data)

    expect(streams).toHaveLength(2)
    expect(streams.map((s: { name: string }) => s.name)).toContain('users')
    expect(streams.map((s: { name: string }) => s.name)).toContain('orders')
  })

  it('should infer schemas for each stream', () => {
    
    const data = {
      products: [
        { sku: 'P001', name: 'Widget', price: 19.99 },
      ],
    }

    const streams = discoverCatalogFromData(data)
    const productStream = streams[0]

    expect(productStream.schema.properties.sku.type).toBe('string')
    expect(productStream.schema.properties.price.type).toBe('number')
  })

  it('should apply namespace to all streams', () => {
    
    const data = {
      table1: [{ id: 1 }],
      table2: [{ id: 2 }],
    }

    const streams = discoverCatalogFromData(data, { namespace: 'public' })

    expect(streams.every((s: { namespace: string }) => s.namespace === 'public')).toBe(true)
  })
})

// =============================================================================
// Complex Schema Inference Scenarios
// =============================================================================

describe('Complex Schema Inference', () => {
  it('should infer schema from real-world API response', () => {
    const records = [
      {
        id: 'order-123',
        customer: {
          id: 'cust-456',
          email: 'customer@example.com',
          address: {
            street: '123 Main St',
            city: 'NYC',
            country: 'USA',
            zip: '10001',
          },
        },
        items: [
          { sku: 'PROD-1', name: 'Widget', quantity: 2, price: 19.99 },
          { sku: 'PROD-2', name: 'Gadget', quantity: 1, price: 49.99 },
        ],
        total: 89.97,
        status: 'completed',
        created_at: '2024-01-15T10:30:00Z',
        updated_at: '2024-01-15T11:00:00Z',
      },
    ]

    const schema = inferStreamSchema(records)

    // Top-level properties
    expect(schema.properties.id.type).toBe('string')
    expect(schema.properties.total.type).toBe('number')
    expect(schema.properties.status.type).toBe('string')
    expect(schema.properties.created_at.format).toBe('date-time')

    // Nested customer object
    expect(schema.properties.customer.type).toBe('object')
    expect(schema.properties.customer.properties?.email.format).toBe('email')
    expect(schema.properties.customer.properties?.address.type).toBe('object')

    // Array of items
    expect(schema.properties.items.type).toBe('array')
    expect(schema.properties.items.items?.type).toBe('object')
    expect(schema.properties.items.items?.properties?.quantity.type).toBe('integer')
    expect(schema.properties.items.items?.properties?.price.type).toBe('number')
  })

  it('should handle records with optional/sparse fields', () => {
    const records = [
      { id: 1, name: 'Alice', nickname: 'Ali' },
      { id: 2, name: 'Bob' }, // no nickname
      { id: 3, name: 'Charlie', nickname: 'Chuck', title: 'Dr.' },
    ]

    const schema = inferStreamSchema(records)

    // All observed fields should be in schema
    expect(schema.properties.id).toBeDefined()
    expect(schema.properties.name).toBeDefined()
    expect(schema.properties.nickname).toBeDefined()
    expect(schema.properties.title).toBeDefined()
  })
})
