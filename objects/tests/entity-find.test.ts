/**
 * Entity.find() Performance Tests
 *
 * TDD Tests for Entity.find() indexed queries (dotdo-iwgsk)
 *
 * Problem: Entity.find() loads ALL records then filters in memory.
 * Current implementation:
 *   async find(field: string, value: unknown): Promise<EntityRecord[]> {
 *     const all = await this.list()  // Loads ALL records
 *     return all.filter((r) => r.data[field] === value)
 *   }
 *
 * This is O(n) for every query, regardless of result size.
 * With 1000+ records, this becomes a significant performance issue.
 *
 * Solution: Use secondary indexes in KV storage to enable O(1) lookups
 * for indexed fields, falling back to filtered list for non-indexed fields.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Entity, type EntityRecord, type EntitySchema } from '../Entity'

// ============================================================================
// MOCK DO STATE
// ============================================================================

interface MockStorageState {
  storage: Map<string, unknown>
  listCallCount: number
  getCallCount: number
}

function createMockStorage() {
  const state: MockStorageState = {
    storage: new Map<string, unknown>(),
    listCallCount: 0,
    getCallCount: 0,
  }

  return {
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
        state.getCallCount++
        return state.storage.get(key) as T | undefined
      }),
      put: vi.fn(async <T>(key: string, value: T): Promise<void> => {
        state.storage.set(key, value)
      }),
      delete: vi.fn(async (key: string): Promise<boolean> => {
        return state.storage.delete(key)
      }),
      deleteAll: vi.fn(async (): Promise<void> => {
        state.storage.clear()
      }),
      list: vi.fn(async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
        state.listCallCount++
        const result = new Map<string, T>()
        for (const [key, value] of state.storage) {
          if (options?.prefix && !key.startsWith(options.prefix)) continue
          result.set(key, value as T)
        }
        return result
      }),
    },
    _state: state,
    _resetCounters: () => {
      state.listCallCount = 0
      state.getCallCount = 0
    },
  }
}

function createMockState() {
  const { storage, _state, _resetCounters } = createMockStorage()
  return {
    id: {
      toString: () => 'test-entity-find-id',
      name: 'test-entity-find-id',
      equals: (other: { toString: () => string }) => other.toString() === 'test-entity-find-id',
    },
    storage,
    _state,
    _resetCounters,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & {
    _state: MockStorageState
    _resetCounters: () => void
  }
}

function createMockEnv() {
  return {
    DO: {
      idFromName: vi.fn((name: string) => ({ toString: () => `id-for-${name}` })),
      get: vi.fn(),
    },
  }
}

// ============================================================================
// TEST HELPER: Create Entity with test data
// ============================================================================

async function seedEntityWithRecords(
  entity: Entity,
  count: number,
  fieldValueDistribution?: { field: string; values: unknown[] }
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const data: Record<string, unknown> = {
      name: `Record ${i}`,
      index: i,
    }

    // Add distributed field values for testing queries
    if (fieldValueDistribution) {
      const valueIndex = i % fieldValueDistribution.values.length
      data[fieldValueDistribution.field] = fieldValueDistribution.values[valueIndex]
    }

    await entity.create(data)
  }
}

// ============================================================================
// TEST SUITE: Current Behavior (Demonstrates the Problem)
// ============================================================================

describe('Entity.find() Non-Indexed Fields (Fallback Behavior)', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let entity: Entity

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    entity = new Entity(mockState as unknown as DurableObjectState, mockEnv as any)
  })

  describe('Full Table Scan for Non-Indexed Fields', () => {
    it('calls list() for find() on non-indexed fields', async () => {
      // No schema = no indexes, so all queries fall back to list()
      await seedEntityWithRecords(entity, 100, {
        field: 'status',
        values: ['active', 'inactive', 'pending'],
      })

      mockState._resetCounters()

      // Query for records with status = 'active' (not indexed)
      await entity.find('status', 'active')

      // Expected: list() was called because field is not indexed
      expect(mockState._state.listCallCount).toBeGreaterThan(0)
    })

    it('loads all records for non-indexed field queries', async () => {
      // No index defined, so full scan is expected
      await seedEntityWithRecords(entity, 100, {
        field: 'uniqueId',
        values: Array.from({ length: 100 }, (_, i) => `uid-${i}`),
      })

      mockState._resetCounters()

      // Query for the single matching record (non-indexed)
      const results = await entity.find('uniqueId', 'uid-50')

      // Expected: list() called because no index
      expect(results.length).toBe(1)
      expect(mockState._state.listCallCount).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// TEST SUITE: Indexed Queries (Expected Behavior After Fix)
// ============================================================================

describe('Entity.find() Indexed Queries', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let entity: Entity

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    entity = new Entity(mockState as unknown as DurableObjectState, mockEnv as any)
  })

  describe('Schema with Indexed Fields', () => {
    it('should define indexed fields in schema', async () => {
      const schema: EntitySchema = {
        name: 'Customer',
        fields: {
          email: { type: 'string', required: true },
          status: { type: 'string' },
          region: { type: 'string' },
        },
        indexes: ['email', 'status'], // Fields to index
        unique: ['email'], // Unique constraint
      }

      await entity.setSchema(schema)
      const retrievedSchema = await entity.getSchema()

      expect(retrievedSchema?.indexes).toContain('email')
      expect(retrievedSchema?.indexes).toContain('status')
    })
  })

  describe('Indexed Field Lookups', () => {
    it('should use index for queries on indexed fields', async () => {
      // Set up schema with indexed status field
      const schema: EntitySchema = {
        name: 'Order',
        fields: {
          status: { type: 'string' },
          customerId: { type: 'string' },
        },
        indexes: ['status'],
      }
      await entity.setSchema(schema)

      // Seed 1000 records
      await seedEntityWithRecords(entity, 1000, {
        field: 'status',
        values: ['pending', 'processing', 'shipped', 'delivered'],
      })

      mockState._resetCounters()

      // Query using indexed field
      const results = await entity.find('status', 'shipped')

      // Should NOT call list() - should use index instead
      expect(mockState._state.listCallCount).toBe(0)
      expect(results.length).toBe(250) // 1000/4 values
    })

    it('should maintain index on create', async () => {
      const schema: EntitySchema = {
        name: 'Product',
        fields: {
          category: { type: 'string' },
          price: { type: 'number' },
        },
        indexes: ['category'],
      }
      await entity.setSchema(schema)

      // Create a record
      await entity.create({ category: 'electronics', price: 99.99 })

      // Verify index entry was created
      const indexKey = 'index:category:electronics'
      const indexEntry = await mockState.storage.get(indexKey)

      // Index should contain the record ID
      expect(indexEntry).toBeDefined()
    })

    it('should maintain index on update', async () => {
      const schema: EntitySchema = {
        name: 'Item',
        fields: {
          status: { type: 'string' },
        },
        indexes: ['status'],
      }
      await entity.setSchema(schema)

      // Create and then update
      const record = await entity.create({ status: 'draft' })
      await entity.update(record.id, { status: 'published' })

      // Verify old index entry was removed
      const oldIndexKey = 'index:status:draft'
      const oldIndexEntry = await mockState.storage.get(oldIndexKey)

      // Verify new index entry was created
      const newIndexKey = 'index:status:published'
      const newIndexEntry = await mockState.storage.get(newIndexKey)

      // Old index removed, new index created
      expect(oldIndexEntry).toBeUndefined()
      expect(newIndexEntry).toBeDefined()
    })

    it('should maintain index on delete', async () => {
      const schema: EntitySchema = {
        name: 'Document',
        fields: {
          type: { type: 'string' },
        },
        indexes: ['type'],
      }
      await entity.setSchema(schema)

      const record = await entity.create({ type: 'report' })
      await entity.delete(record.id)

      // Verify index entry was removed
      const indexKey = 'index:type:report'
      const indexEntry = await mockState.storage.get(indexKey)

      // Index entry should be removed
      expect(indexEntry).toBeUndefined()
    })
  })

  describe('Non-Indexed Field Fallback', () => {
    it('should fall back to filtered list for non-indexed fields', async () => {
      const schema: EntitySchema = {
        name: 'User',
        fields: {
          email: { type: 'string' },
          name: { type: 'string' },
        },
        indexes: ['email'], // Only email is indexed
      }
      await entity.setSchema(schema)

      await seedEntityWithRecords(entity, 100, {
        field: 'name',
        values: ['Alice', 'Bob', 'Charlie'],
      })

      mockState._resetCounters()

      // Query on non-indexed field (name)
      const results = await entity.find('name', 'Alice')

      // EXPECTED: Should still work but will use list() + filter
      expect(results.length).toBeGreaterThan(0)
      expect(mockState._state.listCallCount).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// TEST SUITE: Performance Comparison
// ============================================================================

describe('Entity.find() Performance', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let entity: Entity

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    entity = new Entity(mockState as unknown as DurableObjectState, mockEnv as any)
  })

  describe('Query Operation Count', () => {
    it('non-indexed: O(n) storage operations for find()', async () => {
      // No schema = no indexes
      await seedEntityWithRecords(entity, 500)
      mockState._resetCounters()

      await entity.find('index', 0)

      // Non-indexed behavior: 1 list() call that returns all records
      expect(mockState._state.listCallCount).toBe(1)
    })

    it('indexed: O(k) storage operations for find() on indexed field', async () => {
      const schema: EntitySchema = {
        name: 'IndexedEntity',
        fields: {
          category: { type: 'string' },
        },
        indexes: ['category'],
      }
      await entity.setSchema(schema)

      await seedEntityWithRecords(entity, 500, {
        field: 'category',
        values: ['A', 'B', 'C', 'D', 'E'],
      })

      mockState._resetCounters()

      await entity.find('category', 'A')

      // Indexed: O(k) get operations where k = matching records
      // - 1 get for index lookup
      // - N gets for matching records (where N << 500)
      expect(mockState._state.listCallCount).toBe(0)
      expect(mockState._state.getCallCount).toBeLessThan(200) // ~100 matches + index lookup
    })
  })
})

// ============================================================================
// TEST SUITE: findWithIndex Method (New API)
// ============================================================================

describe('Entity.findWithIndex() API', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let entity: Entity

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    entity = new Entity(mockState as unknown as DurableObjectState, mockEnv as any)
  })

  it('should provide explicit indexed query method', async () => {
    const schema: EntitySchema = {
      name: 'Task',
      fields: {
        status: { type: 'string' },
        priority: { type: 'number' },
      },
      indexes: ['status'],
    }
    await entity.setSchema(schema)

    await seedEntityWithRecords(entity, 1000, {
      field: 'status',
      values: ['todo', 'in-progress', 'done'],
    })

    mockState._resetCounters()

    // New API: explicit indexed query
    const results = await entity.findWithIndex('status', 'done')

    // Should use index, not list
    expect(mockState._state.listCallCount).toBe(0)
    expect(results.length).toBeGreaterThan(0)
  })

  it('should throw if field is not indexed when using findWithIndex', async () => {
    const schema: EntitySchema = {
      name: 'Item',
      fields: {
        name: { type: 'string' },
        description: { type: 'string' },
      },
      indexes: ['name'], // Only name is indexed
    }
    await entity.setSchema(schema)

    // Should throw because description is not indexed
    await expect(entity.findWithIndex('description', 'test')).rejects.toThrow(/not indexed/)
  })
})

// ============================================================================
// TEST SUITE: Index Maintenance
// ============================================================================

describe('Entity Index Maintenance', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let entity: Entity

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    entity = new Entity(mockState as unknown as DurableObjectState, mockEnv as any)
  })

  it('should rebuild index on schema change', async () => {
    // Create records without index (no schema yet)
    await seedEntityWithRecords(entity, 100, {
      field: 'category',
      values: ['A', 'B', 'C'],
    })

    // Now add schema with index
    const schema: EntitySchema = {
      name: 'Product',
      fields: {
        category: { type: 'string' },
      },
      indexes: ['category'],
    }
    await entity.setSchema(schema)

    // Rebuild indexes to index existing records
    await entity.rebuildIndexes()

    mockState._resetCounters()

    // Query should now use index
    await entity.find('category', 'A')

    expect(mockState._state.listCallCount).toBe(0)
  })

  it('should handle null/undefined indexed values', async () => {
    const schema: EntitySchema = {
      name: 'Optional',
      fields: {
        optionalField: { type: 'string' },
      },
      indexes: ['optionalField'],
    }
    await entity.setSchema(schema)

    // Create record without the indexed field
    await entity.create({ name: 'Test' })

    // Query for undefined should work
    const results = await entity.find('optionalField', undefined)

    expect(results.length).toBe(1)
  })
})
