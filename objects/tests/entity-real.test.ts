/**
 * Entity Integration Tests - NO MOCKS
 *
 * Tests Entity functionality using real miniflare DO instances with actual
 * SQLite storage. This follows the CLAUDE.md guidance to NEVER use mocks
 * for Durable Object tests.
 *
 * Tests schema validation, CRUD operations, and indexed queries via RPC.
 *
 * @module objects/tests/entity-real.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { EntitySchema, EntityRecord } from '../Entity'

// ============================================================================
// TYPES
// ============================================================================

interface TestEntityStub extends DurableObjectStub {
  // RPC methods
  setupSchema(schema: EntitySchema): Promise<void>
  getEntitySchema(): Promise<EntitySchema | null>
  createRecord(data: Record<string, unknown>): Promise<EntityRecord>
  getRecord(id: string): Promise<EntityRecord | null>
  updateRecord(id: string, data: Partial<Record<string, unknown>>): Promise<EntityRecord | null>
  deleteRecord(id: string): Promise<boolean>
  listRecords(options?: { limit?: number; offset?: number }): Promise<EntityRecord[]>
  findRecords(field: string, value: unknown): Promise<EntityRecord[]>
  findRecordsWithIndex(field: string, value: unknown): Promise<EntityRecord[]>
  rebuildEntityIndexes(): Promise<{ indexed: number; fields: string[] }>
}

interface TestEnv {
  ENTITY: DurableObjectNamespace
}

// ============================================================================
// TEST HELPERS
// ============================================================================

let testCounter = 0
function uniqueNs(): string {
  return `entity-test-${Date.now()}-${++testCounter}`
}

// ============================================================================
// TESTS: Entity CRUD Operations
// ============================================================================

describe('Entity Integration Tests (Real Miniflare)', () => {
  let stub: TestEntityStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as TestEnv).ENTITY.idFromName(ns)
    stub = (env as TestEnv).ENTITY.get(id) as TestEntityStub
  })

  // ==========================================================================
  // SCHEMA MANAGEMENT
  // ==========================================================================

  describe('Schema Management', () => {
    it('sets and retrieves schema', async () => {
      const schema: EntitySchema = {
        name: 'Customer',
        fields: {
          email: { type: 'string', required: true },
          name: { type: 'string', required: true },
          age: { type: 'number' },
        },
        indexes: ['email'],
        unique: ['email'],
      }

      await stub.setupSchema(schema)
      const retrieved = await stub.getEntitySchema()

      expect(retrieved).not.toBeNull()
      expect(retrieved!.name).toBe('Customer')
      expect(retrieved!.indexes).toContain('email')
    })

    it('returns null when no schema is set', async () => {
      const schema = await stub.getEntitySchema()

      expect(schema).toBeNull()
    })
  })

  // ==========================================================================
  // CREATE OPERATIONS
  // ==========================================================================

  describe('Create Operations', () => {
    it('creates a record', async () => {
      const record = await stub.createRecord({
        name: 'Test Record',
        value: 42,
      })

      expect(record.id).toBeDefined()
      expect(record.data.name).toBe('Test Record')
      expect(record.data.value).toBe(42)
      expect(record.version).toBe(1)
    })

    it('applies default values from schema', async () => {
      await stub.setupSchema({
        name: 'Item',
        fields: {
          name: { type: 'string', required: true },
          status: { type: 'string', default: 'active' },
        },
      })

      const record = await stub.createRecord({ name: 'New Item' })

      expect(record.data.status).toBe('active')
    })

    it('validates required fields', async () => {
      await stub.setupSchema({
        name: 'User',
        fields: {
          email: { type: 'string', required: true },
          name: { type: 'string', required: true },
        },
      })

      await expect(
        stub.createRecord({ name: 'Only Name' }) // Missing email
      ).rejects.toThrow(/required/)
    })

    it('validates field types', async () => {
      await stub.setupSchema({
        name: 'Product',
        fields: {
          price: { type: 'number', required: true },
        },
      })

      await expect(
        stub.createRecord({ price: 'not a number' })
      ).rejects.toThrow(/number/)
    })

    it('generates timestamps', async () => {
      const record = await stub.createRecord({ name: 'Timestamped' })

      expect(record.createdAt).toBeDefined()
      expect(record.updatedAt).toBeDefined()
    })
  })

  // ==========================================================================
  // READ OPERATIONS
  // ==========================================================================

  describe('Read Operations', () => {
    it('gets a record by ID', async () => {
      const created = await stub.createRecord({
        name: 'Retrievable',
        code: 'ABC123',
      })

      const retrieved = await stub.getRecord(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(created.id)
      expect(retrieved!.data.name).toBe('Retrievable')
    })

    it('returns null for non-existent record', async () => {
      const record = await stub.getRecord('nonexistent-id')

      expect(record).toBeNull()
    })
  })

  // ==========================================================================
  // LIST OPERATIONS
  // ==========================================================================

  describe('List Operations', () => {
    beforeEach(async () => {
      // Create test records
      await stub.createRecord({ name: 'Item 1', index: 1 })
      await stub.createRecord({ name: 'Item 2', index: 2 })
      await stub.createRecord({ name: 'Item 3', index: 3 })
      await stub.createRecord({ name: 'Item 4', index: 4 })
      await stub.createRecord({ name: 'Item 5', index: 5 })
    })

    it('lists all records', async () => {
      const records = await stub.listRecords()

      expect(records.length).toBeGreaterThanOrEqual(5)
    })

    it('supports limit', async () => {
      const records = await stub.listRecords({ limit: 3 })

      expect(records.length).toBe(3)
    })

    it('supports offset', async () => {
      const allRecords = await stub.listRecords()
      const offsetRecords = await stub.listRecords({ offset: 2, limit: 2 })

      // Should skip first 2 records
      expect(offsetRecords.length).toBe(2)
      expect(offsetRecords[0]!.id).not.toBe(allRecords[0]!.id)
    })
  })

  // ==========================================================================
  // UPDATE OPERATIONS
  // ==========================================================================

  describe('Update Operations', () => {
    it('updates a record', async () => {
      const created = await stub.createRecord({
        name: 'Original',
        count: 1,
      })

      const updated = await stub.updateRecord(created.id, {
        name: 'Updated',
        count: 2,
      })

      expect(updated).not.toBeNull()
      expect(updated!.data.name).toBe('Updated')
      expect(updated!.data.count).toBe(2)
    })

    it('increments version on update', async () => {
      const created = await stub.createRecord({ name: 'Versioned' })
      expect(created.version).toBe(1)

      const updated = await stub.updateRecord(created.id, { name: 'Updated' })

      expect(updated!.version).toBe(2)
    })

    it('updates timestamp on update', async () => {
      // Use fake timers to control time deterministically
      vi.useFakeTimers()
      try {
        const baseTime = new Date('2026-01-13T12:00:00Z').getTime()
        vi.setSystemTime(baseTime)

        const created = await stub.createRecord({ name: 'Timed' })
        const originalUpdatedAt = created.updatedAt

        // Advance time deterministically instead of waiting
        vi.setSystemTime(baseTime + 1000)

        const updated = await stub.updateRecord(created.id, { name: 'Re-timed' })

        expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThan(
          new Date(originalUpdatedAt).getTime()
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('returns null for non-existent record', async () => {
      const result = await stub.updateRecord('nonexistent', { name: 'X' })

      expect(result).toBeNull()
    })

    it('validates updated data against schema', async () => {
      await stub.setupSchema({
        name: 'Strict',
        fields: {
          value: { type: 'number', required: true },
        },
      })

      const created = await stub.createRecord({ value: 10 })

      await expect(
        stub.updateRecord(created.id, { value: 'not a number' })
      ).rejects.toThrow(/number/)
    })
  })

  // ==========================================================================
  // DELETE OPERATIONS
  // ==========================================================================

  describe('Delete Operations', () => {
    it('deletes a record', async () => {
      const created = await stub.createRecord({ name: 'ToDelete' })

      const deleted = await stub.deleteRecord(created.id)

      expect(deleted).toBe(true)

      const retrieved = await stub.getRecord(created.id)
      expect(retrieved).toBeNull()
    })

    it('returns false for non-existent record', async () => {
      const result = await stub.deleteRecord('nonexistent')

      expect(result).toBe(false)
    })
  })

  // ==========================================================================
  // INDEXED QUERIES
  // ==========================================================================

  describe('Indexed Queries', () => {
    beforeEach(async () => {
      // Set up schema with indexes
      await stub.setupSchema({
        name: 'Task',
        fields: {
          status: { type: 'string' },
          priority: { type: 'number' },
          assignee: { type: 'string' },
        },
        indexes: ['status', 'priority'],
      })

      // Create test data
      await stub.createRecord({ status: 'pending', priority: 1, assignee: 'alice' })
      await stub.createRecord({ status: 'pending', priority: 2, assignee: 'bob' })
      await stub.createRecord({ status: 'done', priority: 1, assignee: 'alice' })
      await stub.createRecord({ status: 'pending', priority: 3, assignee: 'charlie' })
      await stub.createRecord({ status: 'done', priority: 2, assignee: 'bob' })
    })

    it('finds records by indexed field (status)', async () => {
      const pendingTasks = await stub.findRecords('status', 'pending')

      expect(pendingTasks.length).toBe(3)
      expect(pendingTasks.every((t) => t.data.status === 'pending')).toBe(true)
    })

    it('finds records by indexed field (priority)', async () => {
      const highPriority = await stub.findRecords('priority', 1)

      expect(highPriority.length).toBe(2)
      expect(highPriority.every((t) => t.data.priority === 1)).toBe(true)
    })

    it('falls back to filtered list for non-indexed field', async () => {
      const aliceTasks = await stub.findRecords('assignee', 'alice')

      expect(aliceTasks.length).toBe(2)
      expect(aliceTasks.every((t) => t.data.assignee === 'alice')).toBe(true)
    })

    it('uses explicit index lookup with findWithIndex', async () => {
      const doneTasks = await stub.findRecordsWithIndex('status', 'done')

      expect(doneTasks.length).toBe(2)
      expect(doneTasks.every((t) => t.data.status === 'done')).toBe(true)
    })

    it('throws when using findWithIndex on non-indexed field', async () => {
      await expect(
        stub.findRecordsWithIndex('assignee', 'alice')
      ).rejects.toThrow(/not indexed/)
    })
  })

  // ==========================================================================
  // INDEX MAINTENANCE
  // ==========================================================================

  describe('Index Maintenance', () => {
    it('maintains index on create', async () => {
      await stub.setupSchema({
        name: 'Document',
        fields: {
          type: { type: 'string' },
        },
        indexes: ['type'],
      })

      await stub.createRecord({ type: 'report' })
      await stub.createRecord({ type: 'report' })
      await stub.createRecord({ type: 'memo' })

      const reports = await stub.findRecordsWithIndex('type', 'report')

      expect(reports.length).toBe(2)
    })

    it('maintains index on update', async () => {
      await stub.setupSchema({
        name: 'Order',
        fields: {
          status: { type: 'string' },
        },
        indexes: ['status'],
      })

      const order = await stub.createRecord({ status: 'pending' })

      // Verify initial index
      let pendingOrders = await stub.findRecordsWithIndex('status', 'pending')
      expect(pendingOrders.length).toBe(1)

      // Update status
      await stub.updateRecord(order.id, { status: 'shipped' })

      // Old index should be empty
      pendingOrders = await stub.findRecordsWithIndex('status', 'pending')
      expect(pendingOrders.length).toBe(0)

      // New index should have the record
      const shippedOrders = await stub.findRecordsWithIndex('status', 'shipped')
      expect(shippedOrders.length).toBe(1)
    })

    it('maintains index on delete', async () => {
      await stub.setupSchema({
        name: 'Note',
        fields: {
          category: { type: 'string' },
        },
        indexes: ['category'],
      })

      const note = await stub.createRecord({ category: 'work' })

      // Verify index exists
      let workNotes = await stub.findRecordsWithIndex('category', 'work')
      expect(workNotes.length).toBe(1)

      // Delete the note
      await stub.deleteRecord(note.id)

      // Index should be empty
      workNotes = await stub.findRecordsWithIndex('category', 'work')
      expect(workNotes.length).toBe(0)
    })

    it('rebuilds indexes from existing records', async () => {
      // Create records WITHOUT schema first
      await stub.createRecord({ category: 'A', name: 'Item 1' })
      await stub.createRecord({ category: 'B', name: 'Item 2' })
      await stub.createRecord({ category: 'A', name: 'Item 3' })

      // Now set schema with index
      await stub.setupSchema({
        name: 'Item',
        fields: {
          category: { type: 'string' },
          name: { type: 'string' },
        },
        indexes: ['category'],
      })

      // Rebuild indexes
      const result = await stub.rebuildEntityIndexes()

      expect(result.indexed).toBe(3)
      expect(result.fields).toContain('category')

      // Verify index works
      const categoryA = await stub.findRecordsWithIndex('category', 'A')
      expect(categoryA.length).toBe(2)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles null indexed values', async () => {
      await stub.setupSchema({
        name: 'Optional',
        fields: {
          label: { type: 'string' },
        },
        indexes: ['label'],
      })

      // Create record without the indexed field
      await stub.createRecord({ name: 'No Label' })

      // Should find records with undefined label
      const unlabeled = await stub.findRecords('label', undefined)
      expect(unlabeled.length).toBeGreaterThanOrEqual(1)
    })

    it('handles complex data types', async () => {
      const record = await stub.createRecord({
        nested: {
          deep: {
            value: 'found',
          },
        },
        array: [1, 2, 3],
        mixed: ['a', 1, true],
      })

      const retrieved = await stub.getRecord(record.id)

      expect(retrieved!.data.nested).toEqual({ deep: { value: 'found' } })
      expect(retrieved!.data.array).toEqual([1, 2, 3])
      expect(retrieved!.data.mixed).toEqual(['a', 1, true])
    })

    it('handles empty record data', async () => {
      const record = await stub.createRecord({})

      expect(record.id).toBeDefined()
      expect(record.data).toEqual({})
    })
  })

  // ==========================================================================
  // HTTP API
  // ==========================================================================

  describe('HTTP API', () => {
    it('handles GET /schema', async () => {
      await stub.setupSchema({
        name: 'HTTPTest',
        fields: { value: { type: 'number' } },
      })

      const response = await stub.fetch(
        new Request('https://test.api/schema', { method: 'GET' })
      )

      expect(response.status).toBe(200)

      const schema = await response.json() as EntitySchema
      expect(schema.name).toBe('HTTPTest')
    })

    it('handles PUT /schema', async () => {
      const schema: EntitySchema = {
        name: 'NewSchema',
        fields: {
          title: { type: 'string', required: true },
        },
      }

      const response = await stub.fetch(
        new Request('https://test.api/schema', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(schema),
        })
      )

      expect(response.status).toBe(200)

      const retrieved = await stub.getEntitySchema()
      expect(retrieved!.name).toBe('NewSchema')
    })

    it('handles POST /records', async () => {
      const response = await stub.fetch(
        new Request('https://test.api/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'HTTP Created', value: 100 }),
        })
      )

      expect(response.status).toBe(201)

      const record = await response.json() as EntityRecord
      expect(record.data.name).toBe('HTTP Created')
    })

    it('handles GET /records', async () => {
      await stub.createRecord({ title: 'Record A' })
      await stub.createRecord({ title: 'Record B' })

      const response = await stub.fetch(
        new Request('https://test.api/records', { method: 'GET' })
      )

      expect(response.status).toBe(200)

      const records = await response.json() as EntityRecord[]
      expect(records.length).toBeGreaterThanOrEqual(2)
    })

    it('handles GET /record/:id', async () => {
      const created = await stub.createRecord({ name: 'Specific' })

      const response = await stub.fetch(
        new Request(`https://test.api/record/${created.id}`, { method: 'GET' })
      )

      expect(response.status).toBe(200)

      const record = await response.json() as EntityRecord
      expect(record.id).toBe(created.id)
    })

    it('handles PUT /record/:id', async () => {
      const created = await stub.createRecord({ name: 'Original' })

      const response = await stub.fetch(
        new Request(`https://test.api/record/${created.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated via HTTP' }),
        })
      )

      expect(response.status).toBe(200)

      const record = await response.json() as EntityRecord
      expect(record.data.name).toBe('Updated via HTTP')
    })

    it('handles DELETE /record/:id', async () => {
      const created = await stub.createRecord({ name: 'ToDelete' })

      const response = await stub.fetch(
        new Request(`https://test.api/record/${created.id}`, { method: 'DELETE' })
      )

      expect(response.status).toBe(200)

      const result = await response.json() as { deleted: boolean }
      expect(result.deleted).toBe(true)
    })

    it('returns 404 for non-existent record', async () => {
      const response = await stub.fetch(
        new Request('https://test.api/record/nonexistent', { method: 'GET' })
      )

      expect(response.status).toBe(404)
    })
  })
})
