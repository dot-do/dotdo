/**
 * Collection Integration Tests - NO MOCKS
 *
 * Tests Collection functionality using real miniflare DO instances with actual
 * SQLite storage. This follows the CLAUDE.md guidance to NEVER use mocks
 * for Durable Object tests.
 *
 * Tests bulk operations, query filtering, and aggregations via RPC.
 *
 * @module objects/tests/collection-real.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import type { CollectionConfig } from '../Collection'
import type { EntityRecord } from '../Entity'

// ============================================================================
// TYPES
// ============================================================================

interface TestCollectionStub extends DurableObjectStub {
  // RPC methods
  setupCollectionConfig(config: CollectionConfig): Promise<void>
  getConfig(): Promise<CollectionConfig | null>
  countRecords(): Promise<number>
  queryRecords(filters: Record<string, unknown>): Promise<EntityRecord[]>
  aggregateRecords(
    groupBy: string,
    aggregations: { field: string; op: 'count' | 'sum' | 'avg' | 'min' | 'max' }[]
  ): Promise<Record<string, Record<string, number>>>
  bulkCreateRecords(records: Record<string, unknown>[]): Promise<EntityRecord[]>
  bulkDeleteRecords(ids: string[]): Promise<number>
  createRecord(data: Record<string, unknown>): Promise<EntityRecord>
  getRecord(id: string): Promise<EntityRecord | null>
  listRecords(): Promise<EntityRecord[]>
  deleteRecord(id: string): Promise<boolean>
}

interface TestEnv {
  COLLECTION: DurableObjectNamespace
}

// ============================================================================
// TEST HELPERS
// ============================================================================

let testCounter = 0
function uniqueNs(): string {
  return `collection-test-${Date.now()}-${++testCounter}`
}

// ============================================================================
// TESTS: Collection Operations
// ============================================================================

describe('Collection Integration Tests (Real Miniflare)', () => {
  let stub: TestCollectionStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as TestEnv).COLLECTION.idFromName(ns)
    stub = (env as TestEnv).COLLECTION.get(id) as TestCollectionStub
  })

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================

  describe('Configuration', () => {
    it('sets and retrieves collection config', async () => {
      const config: CollectionConfig = {
        name: 'orders',
        schema: {
          name: 'Order',
          fields: {
            customerId: { type: 'string', required: true },
            total: { type: 'number', required: true },
            status: { type: 'string', default: 'pending' },
          },
          indexes: ['customerId', 'status'],
        },
      }

      await stub.setupCollectionConfig(config)
      const retrieved = await stub.getConfig()

      expect(retrieved).not.toBeNull()
      expect(retrieved!.name).toBe('orders')
      expect(retrieved!.schema.name).toBe('Order')
      expect(retrieved!.schema.indexes).toContain('customerId')
    })

    it('returns null/undefined when no config is set', async () => {
      const config = await stub.getConfig()

      // Config may be null or undefined depending on implementation
      expect(config == null).toBe(true)
    })

    it('applies schema with indexes', async () => {
      await stub.setupCollectionConfig({
        name: 'products',
        schema: {
          name: 'Product',
          fields: {
            category: { type: 'string' },
            price: { type: 'number' },
          },
          indexes: ['category'],
        },
      })

      // Create a product and verify we can query by indexed field
      await stub.createRecord({ category: 'electronics', price: 99.99 })

      const products = await stub.queryRecords({ category: 'electronics' })
      expect(products.length).toBe(1)
    })
  })

  // ==========================================================================
  // BULK OPERATIONS
  // ==========================================================================

  describe('Bulk Operations', () => {
    it('bulk creates multiple records', async () => {
      const records = await stub.bulkCreateRecords([
        { name: 'Item 1', value: 10 },
        { name: 'Item 2', value: 20 },
        { name: 'Item 3', value: 30 },
      ])

      expect(records.length).toBe(3)
      expect(records[0]!.data.name).toBe('Item 1')
      expect(records[1]!.data.name).toBe('Item 2')
      expect(records[2]!.data.name).toBe('Item 3')
    })

    it('bulk creates records with IDs', async () => {
      const records = await stub.bulkCreateRecords([
        { name: 'Alpha' },
        { name: 'Beta' },
        { name: 'Gamma' },
      ])

      // All records should have unique IDs
      const ids = records.map((r) => r.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(3)
    })

    it('bulk deletes records by IDs', async () => {
      const records = await stub.bulkCreateRecords([
        { name: 'ToDelete 1' },
        { name: 'ToDelete 2' },
        { name: 'ToKeep' },
      ])

      const toDeleteIds = [records[0]!.id, records[1]!.id]
      const deletedCount = await stub.bulkDeleteRecords(toDeleteIds)

      expect(deletedCount).toBe(2)

      // Verify remaining records
      const remaining = await stub.listRecords()
      expect(remaining.some((r) => r.data.name === 'ToKeep')).toBe(true)
      expect(remaining.some((r) => r.data.name === 'ToDelete 1')).toBe(false)
    })

    it('handles empty bulk create', async () => {
      const records = await stub.bulkCreateRecords([])

      expect(records).toEqual([])
    })

    it('handles bulk delete with non-existent IDs', async () => {
      const deletedCount = await stub.bulkDeleteRecords(['nonexistent-1', 'nonexistent-2'])

      expect(deletedCount).toBe(0)
    })
  })

  // ==========================================================================
  // COUNT
  // ==========================================================================

  describe('Count', () => {
    it('counts records in collection', async () => {
      await stub.bulkCreateRecords([
        { name: 'A' },
        { name: 'B' },
        { name: 'C' },
        { name: 'D' },
      ])

      const count = await stub.countRecords()

      expect(count).toBe(4)
    })

    it('returns 0 for empty collection', async () => {
      const count = await stub.countRecords()

      expect(count).toBe(0)
    })

    it('updates count after bulk operations', async () => {
      const records = await stub.bulkCreateRecords([
        { name: '1' },
        { name: '2' },
        { name: '3' },
      ])

      expect(await stub.countRecords()).toBe(3)

      await stub.bulkDeleteRecords([records[0]!.id])

      expect(await stub.countRecords()).toBe(2)
    })
  })

  // ==========================================================================
  // QUERY WITH FILTERS
  // ==========================================================================

  describe('Query', () => {
    beforeEach(async () => {
      // Create test data
      await stub.bulkCreateRecords([
        { status: 'pending', priority: 1, assignee: 'alice' },
        { status: 'pending', priority: 2, assignee: 'bob' },
        { status: 'completed', priority: 1, assignee: 'alice' },
        { status: 'pending', priority: 3, assignee: 'charlie' },
        { status: 'completed', priority: 2, assignee: 'bob' },
      ])
    })

    it('queries by single filter', async () => {
      const pending = await stub.queryRecords({ status: 'pending' })

      expect(pending.length).toBe(3)
      expect(pending.every((r) => r.data.status === 'pending')).toBe(true)
    })

    it('queries by multiple filters (AND logic)', async () => {
      const alicePending = await stub.queryRecords({
        status: 'pending',
        assignee: 'alice',
      })

      expect(alicePending.length).toBe(1)
      expect(alicePending[0]!.data.status).toBe('pending')
      expect(alicePending[0]!.data.assignee).toBe('alice')
    })

    it('queries by numeric filter', async () => {
      const highPriority = await stub.queryRecords({ priority: 1 })

      expect(highPriority.length).toBe(2)
      expect(highPriority.every((r) => r.data.priority === 1)).toBe(true)
    })

    it('returns empty array when no matches', async () => {
      const noMatches = await stub.queryRecords({ status: 'cancelled' })

      expect(noMatches).toEqual([])
    })

    it('returns all records when empty filter', async () => {
      const all = await stub.queryRecords({})

      expect(all.length).toBe(5)
    })
  })

  // ==========================================================================
  // AGGREGATION
  // ==========================================================================

  describe('Aggregation', () => {
    beforeEach(async () => {
      // Create test data with numeric values
      await stub.bulkCreateRecords([
        { status: 'pending', amount: 100 },
        { status: 'pending', amount: 200 },
        { status: 'pending', amount: 150 },
        { status: 'completed', amount: 500 },
        { status: 'completed', amount: 300 },
      ])
    })

    it('aggregates with count', async () => {
      const result = await stub.aggregateRecords('status', [
        { field: 'amount', op: 'count' },
      ])

      expect(result.pending?.amount_count).toBe(3)
      expect(result.completed?.amount_count).toBe(2)
    })

    it('aggregates with sum', async () => {
      const result = await stub.aggregateRecords('status', [
        { field: 'amount', op: 'sum' },
      ])

      expect(result.pending?.amount_sum).toBe(450) // 100 + 200 + 150
      expect(result.completed?.amount_sum).toBe(800) // 500 + 300
    })

    it('aggregates with avg', async () => {
      const result = await stub.aggregateRecords('status', [
        { field: 'amount', op: 'avg' },
      ])

      expect(result.pending?.amount_avg).toBe(150) // (100 + 200 + 150) / 3
      expect(result.completed?.amount_avg).toBe(400) // (500 + 300) / 2
    })

    it('aggregates with min and max', async () => {
      const result = await stub.aggregateRecords('status', [
        { field: 'amount', op: 'min' },
        { field: 'amount', op: 'max' },
      ])

      expect(result.pending?.amount_min).toBe(100)
      expect(result.pending?.amount_max).toBe(200)
      expect(result.completed?.amount_min).toBe(300)
      expect(result.completed?.amount_max).toBe(500)
    })

    it('handles multiple aggregations', async () => {
      const result = await stub.aggregateRecords('status', [
        { field: 'amount', op: 'count' },
        { field: 'amount', op: 'sum' },
        { field: 'amount', op: 'avg' },
      ])

      expect(result.pending?.amount_count).toBe(3)
      expect(result.pending?.amount_sum).toBe(450)
      expect(result.pending?.amount_avg).toBe(150)
    })

    it('handles empty groups', async () => {
      const result = await stub.aggregateRecords('nonexistent_field', [
        { field: 'amount', op: 'count' },
      ])

      // All records should be grouped under 'null'
      expect(result.null?.amount_count).toBe(5)
    })
  })

  // ==========================================================================
  // HTTP API
  // ==========================================================================

  describe('HTTP API', () => {
    it('handles GET /config', async () => {
      await stub.setupCollectionConfig({
        name: 'http-test',
        schema: {
          name: 'HTTPTest',
          fields: { value: { type: 'number' } },
        },
      })

      const response = await stub.fetch(
        new Request('https://test.api/config', { method: 'GET' })
      )

      expect(response.status).toBe(200)

      const config = await response.json() as CollectionConfig
      expect(config.name).toBe('http-test')
    })

    it('handles PUT /config', async () => {
      const config: CollectionConfig = {
        name: 'new-collection',
        schema: {
          name: 'NewType',
          fields: { title: { type: 'string' } },
        },
      }

      const response = await stub.fetch(
        new Request('https://test.api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        })
      )

      expect(response.status).toBe(200)

      const retrieved = await stub.getConfig()
      expect(retrieved!.name).toBe('new-collection')
    })

    it('handles GET /count', async () => {
      await stub.bulkCreateRecords([{ a: 1 }, { b: 2 }, { c: 3 }])

      const response = await stub.fetch(
        new Request('https://test.api/count', { method: 'GET' })
      )

      expect(response.status).toBe(200)

      const data = await response.json() as { count: number }
      expect(data.count).toBe(3)
    })

    it('handles POST /query', async () => {
      await stub.bulkCreateRecords([
        { type: 'a', value: 1 },
        { type: 'b', value: 2 },
        { type: 'a', value: 3 },
      ])

      const response = await stub.fetch(
        new Request('https://test.api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'a' }),
        })
      )

      expect(response.status).toBe(200)

      const records = await response.json() as EntityRecord[]
      expect(records.length).toBe(2)
      expect(records.every((r) => r.data.type === 'a')).toBe(true)
    })

    it('handles POST /bulk', async () => {
      const response = await stub.fetch(
        new Request('https://test.api/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            { name: 'Bulk 1' },
            { name: 'Bulk 2' },
          ]),
        })
      )

      expect(response.status).toBe(201)

      const records = await response.json() as EntityRecord[]
      expect(records.length).toBe(2)
    })
  })
})
