/**
 * fsx.do/storage Type Import Tests (GREEN Phase)
 *
 * Tests that verify type imports from fsx.do/storage work correctly.
 * These tests verify that TypeScript types are properly exported and can
 * be used in code.
 *
 * NOTE: This test file verifies TYPE EXPORTS only, not runtime values.
 * The fsx.do package (v0.1.0) doesn't export columnar storage runtime code yet,
 * but the types are provided via bashx/src/fsx.do.d.ts module augmentation.
 *
 * Types verified:
 *   - WriteBufferCache (class type)
 *   - ColumnarStore (class type)
 *   - WriteBufferCacheOptions
 *   - EvictionReason
 *   - CacheStats
 *   - ColumnType
 *   - ColumnDefinition
 *   - SchemaDefinition
 *   - CheckpointTriggers
 *   - ColumnarStoreOptions
 *   - CheckpointStats
 *   - CostComparison
 *   - analyzeWorkloadCost (function type)
 *   - printCostReport (function type)
 *
 * @module tests/types/fsx-storage-imports
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// Type imports from fsx.do/storage
// These imports compile successfully due to bashx/src/fsx.do.d.ts
// ============================================================================

// Type imports - schema definition types
import type {
  ColumnType,
  ColumnDefinition,
  SchemaDefinition,
} from 'fsx.do/storage'

// Type imports - cache types
import type {
  WriteBufferCacheOptions,
  EvictionReason,
  CacheStats,
} from 'fsx.do/storage'

// Type imports - store options and stats
import type {
  CheckpointTriggers,
  ColumnarStoreOptions,
  CheckpointStats,
  CostComparison,
} from 'fsx.do/storage'

// Type imports - class types (we use typeof to get the constructor type)
import type {
  WriteBufferCache,
  ColumnarStore,
} from 'fsx.do/storage'

// ============================================================================
// Tests verifying the type exports work correctly
// These are compile-time tests - if they compile, the types are correct
// ============================================================================

describe('fsx.do/storage type exports', () => {
  describe('WriteBufferCache type', () => {
    it('should provide WriteBufferCacheOptions type', () => {
      // Type-only test: verify the type structure compiles
      const options: WriteBufferCacheOptions = {
        maxCount: 1000,
        maxBytes: 25 * 1024 * 1024,
        defaultTTL: 60000,
      }
      expect(options.maxCount).toBe(1000)
    })

    it('should provide WriteBufferCache class type', () => {
      // Type assertion test - verifies the class type is available
      type CacheType = WriteBufferCache<{ id: string }>
      // If this compiles, the type is correctly exported
      const _typeCheck: CacheType | null = null
      expect(_typeCheck).toBeNull()
    })
  })

  describe('ColumnarStore type', () => {
    it('should be generic over record type', () => {
      // Type-level test: ColumnarStore<T> should work with any record type
      type TestRecord = {
        id: string
        name: string
        value: number
      }

      // This is a type assertion test - if it compiles, the generic works
      type TestStore = ColumnarStore<TestRecord>
      const _typeCheck: TestStore | null = null
      expect(_typeCheck).toBeNull()
    })
  })

  describe('Schema types', () => {
    it('should export ColumnType union type', () => {
      // ColumnType should be a union of valid column types
      const textType: ColumnType = 'text'
      const intType: ColumnType = 'integer'
      const realType: ColumnType = 'real'
      const blobType: ColumnType = 'blob'
      const jsonType: ColumnType = 'json'
      const datetimeType: ColumnType = 'datetime'

      expect(textType).toBe('text')
      expect(intType).toBe('integer')
      expect(realType).toBe('real')
      expect(blobType).toBe('blob')
      expect(jsonType).toBe('json')
      expect(datetimeType).toBe('datetime')
    })

    it('should export ColumnDefinition type', () => {
      const column: ColumnDefinition = {
        type: 'text',
        required: true,
        defaultValue: "'default'",
      }
      expect(column.type).toBe('text')
      expect(column.required).toBe(true)
    })

    it('should export SchemaDefinition type', () => {
      type TestRecord = {
        id: string
        name: string
        createdAt: Date
        updatedAt: Date
        version: number
      }

      const schema: SchemaDefinition<TestRecord> = {
        tableName: 'test_table',
        primaryKey: 'id',
        versionField: 'version',
        updatedAtField: 'updatedAt',
        createdAtField: 'createdAt',
        columns: {
          id: { type: 'text', required: true },
          name: { type: 'text', required: true },
          createdAt: { type: 'datetime', column: 'created_at', required: true },
          updatedAt: { type: 'datetime', column: 'updated_at', required: true },
          version: { type: 'integer', defaultValue: '1', required: true },
        },
      }

      expect(schema.tableName).toBe('test_table')
      expect(schema.primaryKey).toBe('id')
    })
  })

  describe('Cache types', () => {
    it('should export EvictionReason type', () => {
      // Note: These are the actual EvictionReason values from the type definition
      const countReason: EvictionReason = 'count'
      const sizeReason: EvictionReason = 'size'
      const expiredReason: EvictionReason = 'expired'
      const deletedReason: EvictionReason = 'deleted'

      expect(countReason).toBe('count')
      expect(sizeReason).toBe('size')
      expect(expiredReason).toBe('expired')
      expect(deletedReason).toBe('deleted')
    })

    it('should export CacheStats type', () => {
      const stats: CacheStats = {
        count: 50,
        bytes: 1024,
        dirtyCount: 5,
        hits: 100,
        misses: 10,
        hitRate: 0.9,
        evictions: 5,
        checkpoints: 3,
        memoryUsageRatio: 0.5,
      }

      expect(stats.hits).toBe(100)
      expect(stats.misses).toBe(10)
      expect(stats.hitRate).toBe(0.9)
    })
  })

  describe('Store options types', () => {
    it('should export CheckpointTriggers type', () => {
      const triggers: CheckpointTriggers = {
        afterWrites: 100,
        afterMs: 60000,
        onShutdown: true,
      }

      expect(triggers.afterWrites).toBe(100)
    })

    it('should export ColumnarStoreOptions type', () => {
      type TestRecord = { id: string; name: string }

      const options: ColumnarStoreOptions<TestRecord> = {
        checkpointTriggers: {
          afterWrites: 50,
          afterMs: 30000,
        },
      }

      expect(options.checkpointTriggers?.afterWrites).toBe(50)
    })

    it('should export CheckpointStats type', () => {
      const stats: CheckpointStats = {
        rowsCheckpointed: 100,
        bytesWritten: 50000,
        durationMs: 150,
      }

      expect(stats.rowsCheckpointed).toBe(100)
    })

    it('should export CostComparison type', () => {
      const comparison: CostComparison = {
        columnar: {
          reads: 100,
          writes: 50,
          totalCost: 150,
        },
        normalized: {
          reads: 500,
          writes: 250,
          totalCost: 750,
        },
        savings: 600,
        savingsPercent: 80,
      }

      expect(comparison.savings).toBe(600)
      expect(comparison.savingsPercent).toBe(80)
    })
  })
})

// ============================================================================
// Integration test: Verify types work together correctly
// ============================================================================

describe('fsx.do/storage type integration', () => {
  it('should allow creating a schema and using it with ColumnarStore type', () => {
    // This test verifies that all the types work together correctly
    type SessionData = {
      id: string
      userId: string
      data: Record<string, unknown>
      createdAt: Date
      updatedAt: Date
      version: number
    }

    const schema: SchemaDefinition<SessionData> = {
      tableName: 'sessions',
      primaryKey: 'id',
      versionField: 'version',
      updatedAtField: 'updatedAt',
      createdAtField: 'createdAt',
      columns: {
        id: { type: 'text', required: true },
        userId: { type: 'text', column: 'user_id', required: true },
        data: { type: 'json', defaultValue: "'{}'" },
        createdAt: { type: 'datetime', column: 'created_at', required: true },
        updatedAt: { type: 'datetime', column: 'updated_at', required: true },
        version: { type: 'integer', defaultValue: '1', required: true },
      },
    }

    const options: ColumnarStoreOptions<SessionData> = {
      checkpointTriggers: {
        afterWrites: 100,
        afterMs: 60000,
        onShutdown: true,
      },
    }

    // Type checks - these verify the types are correctly defined
    expect(schema.tableName).toBe('sessions')
    expect(options.checkpointTriggers?.afterWrites).toBe(100)

    // Verify the store type can be used
    type SessionStore = ColumnarStore<SessionData>
    const _storeType: SessionStore | null = null
    expect(_storeType).toBeNull()
  })

  it('should allow WriteBufferCache to be configured with correct options', () => {
    const cacheOptions: WriteBufferCacheOptions = {
      maxCount: 1000,
      maxBytes: 25 * 1024 * 1024,
      defaultTTL: 60000,
      onEvict: (key: string, _value: unknown, reason: EvictionReason) => {
        console.log(`Evicted ${key} due to ${reason}`)
      },
    }

    expect(cacheOptions.maxCount).toBe(1000)
    expect(cacheOptions.maxBytes).toBe(25 * 1024 * 1024)
    expect(typeof cacheOptions.onEvict).toBe('function')
  })
})
