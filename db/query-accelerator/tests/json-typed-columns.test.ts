/**
 * RED PHASE: JSON Typed Columns Tests
 *
 * TDD tests for the production DO Query Accelerator JSON Typed Columns.
 * These tests define the expected interface and behavior for ClickHouse-style
 * automatic typed subcolumn extraction from JSON data.
 *
 * @see db/ARCHITECTURE.md for design details
 * @issue dotdo-pvoa2
 *
 * Expected implementation location: db/query-accelerator/json-typed-columns.ts
 *
 * Key features to implement:
 * 1. Path extraction from JSON objects
 * 2. Path statistics tracking (frequency, type distribution)
 * 3. Automatic typed subcolumn extraction based on frequency threshold
 * 4. TypedColumnStore for efficient numeric/string/boolean storage
 * 5. Schema evolution handling
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import production module (will fail until implemented)
import type {
  JSONTypedColumns,
  JSONTypedColumnsOptions,
  PathStatistics,
  TypedColumn,
  ColumnConfig,
  JSONType,
} from '../json-typed-columns'

// Placeholder imports that will fail - these are the interfaces we expect
// @ts-expect-error - Module not yet implemented
import {
  createJSONTypedColumns,
  extractPaths,
  getPath,
  setPath,
  PathStatisticsTracker,
  TypedColumnStore,
  SchemaEvolutionHandler,
} from '../json-typed-columns'

// ============================================================================
// Type Definitions (Expected Interface)
// ============================================================================

interface JSONObject {
  [key: string]: JSONValue
}
type JSONValue = string | number | boolean | null | JSONObject | JSONValue[]

// ============================================================================
// Path Utilities Tests
// ============================================================================

describe('JSON Typed Columns - Path Utilities', () => {
  describe('extractPaths', () => {
    it('should extract paths from flat object', () => {
      const obj = { name: 'Alice', age: 30, active: true }
      const paths = extractPaths(obj)

      expect(paths.get('name')).toBe('string')
      expect(paths.get('age')).toBe('number')
      expect(paths.get('active')).toBe('boolean')
    })

    it('should extract paths from nested object', () => {
      const obj = {
        user: {
          name: 'Alice',
          address: {
            city: 'NYC',
            zip: 10001,
          },
        },
      }
      const paths = extractPaths(obj)

      expect(paths.get('user')).toBe('object')
      expect(paths.get('user.name')).toBe('string')
      expect(paths.get('user.address')).toBe('object')
      expect(paths.get('user.address.city')).toBe('string')
      expect(paths.get('user.address.zip')).toBe('number')
    })

    it('should extract paths from arrays', () => {
      const obj = {
        tags: ['a', 'b', 'c'],
        items: [{ id: 1 }, { id: 2 }],
      }
      const paths = extractPaths(obj)

      expect(paths.get('tags')).toBe('array')
      expect(paths.get('tags[*]')).toBe('string')
      expect(paths.get('items')).toBe('array')
      expect(paths.get('items[*]')).toBe('object')
      expect(paths.get('items[*].id')).toBe('number')
    })

    it('should handle null values', () => {
      const obj = { value: null }
      const paths = extractPaths(obj)

      expect(paths.get('value')).toBe('null')
    })

    it('should handle empty objects', () => {
      const obj = { empty: {} }
      const paths = extractPaths(obj)

      expect(paths.get('empty')).toBe('object')
    })

    it('should handle deeply nested paths (5+ levels)', () => {
      const obj = {
        l1: {
          l2: {
            l3: {
              l4: {
                l5: {
                  value: 'deep',
                },
              },
            },
          },
        },
      }
      const paths = extractPaths(obj)

      expect(paths.get('l1.l2.l3.l4.l5.value')).toBe('string')
    })
  })

  describe('getPath', () => {
    it('should get value at simple path', () => {
      const obj = { name: 'Alice', age: 30 }

      expect(getPath(obj, 'name')).toBe('Alice')
      expect(getPath(obj, 'age')).toBe(30)
    })

    it('should get value at nested path', () => {
      const obj = {
        user: { name: 'Alice', email: 'alice@test.com' },
        amount: 100,
      }

      expect(getPath(obj, 'user.name')).toBe('Alice')
      expect(getPath(obj, 'user.email')).toBe('alice@test.com')
      expect(getPath(obj, 'amount')).toBe(100)
    })

    it('should return undefined for non-existent path', () => {
      const obj = { name: 'Alice' }

      expect(getPath(obj, 'user.missing')).toBeUndefined()
      expect(getPath(obj, 'nonexistent')).toBeUndefined()
    })

    it('should handle array indexing', () => {
      const obj = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] }

      expect(getPath(obj, 'items[0].id')).toBe(1)
      expect(getPath(obj, 'items[2].id')).toBe(3)
    })

    it('should return null for null value at path', () => {
      const obj = { value: null }

      expect(getPath(obj, 'value')).toBeNull()
    })
  })

  describe('setPath', () => {
    it('should set value at simple path', () => {
      const obj: JSONObject = {}
      setPath(obj, 'name', 'Alice')

      expect(obj.name).toBe('Alice')
    })

    it('should set value at nested path creating intermediates', () => {
      const obj: JSONObject = {}
      setPath(obj, 'user.name', 'Alice')
      setPath(obj, 'user.email', 'alice@test.com')

      expect((obj.user as JSONObject).name).toBe('Alice')
      expect((obj.user as JSONObject).email).toBe('alice@test.com')
    })

    it('should overwrite existing values', () => {
      const obj: JSONObject = { name: 'Bob' }
      setPath(obj, 'name', 'Alice')

      expect(obj.name).toBe('Alice')
    })

    it('should set deeply nested values', () => {
      const obj: JSONObject = {}
      setPath(obj, 'a.b.c.d.e', 'deep')

      expect(getPath(obj, 'a.b.c.d.e')).toBe('deep')
    })
  })
})

// ============================================================================
// Path Statistics Tracker Tests
// ============================================================================

describe('JSON Typed Columns - PathStatisticsTracker', () => {
  let tracker: PathStatisticsTracker

  beforeEach(() => {
    tracker = new PathStatisticsTracker(0.1) // 10% extraction threshold
  })

  it('should track path frequencies', () => {
    // All records have user.name, only half have user.email
    for (let i = 0; i < 100; i++) {
      const data: JSONObject = { user: { name: `User ${i}` } }
      if (i % 2 === 0) {
        ;(data.user as JSONObject).email = `user${i}@test.com`
      }
      tracker.track(data)
    }

    const stats = tracker.getAllStats()
    const nameStats = stats.find((s) => s.path === 'user.name')
    const emailStats = stats.find((s) => s.path === 'user.email')

    expect(nameStats).toBeDefined()
    expect(nameStats!.frequency).toBeCloseTo(1.0, 1)

    expect(emailStats).toBeDefined()
    expect(emailStats!.frequency).toBeCloseTo(0.5, 1)
  })

  it('should track type distribution', () => {
    // Mix of types for same path
    tracker.track({ value: 'string' })
    tracker.track({ value: 123 })
    tracker.track({ value: 'string' })
    tracker.track({ value: 'string' })

    const stats = tracker.getAllStats()
    const valueStats = stats.find((s) => s.path === 'value')

    expect(valueStats).toBeDefined()
    expect(valueStats!.type).toBe('string') // Dominant type
    expect(valueStats!.typeDistribution.string).toBe(3)
    expect(valueStats!.typeDistribution.number).toBe(1)
  })

  it('should identify paths for extraction based on threshold', () => {
    // Create data where some paths are common, others rare
    for (let i = 0; i < 100; i++) {
      const data: JSONObject = {
        id: i,
        name: `Item ${i}`,
      }
      if (i < 5) {
        // Only 5% have this field - below 10% threshold
        data.rareField = `rare ${i}`
      }
      tracker.track(data)
    }

    const extracted = tracker.getExtractedPaths()
    const extractedPaths = extracted.map((e) => e.path)

    expect(extractedPaths).toContain('id')
    expect(extractedPaths).toContain('name')
    expect(extractedPaths).not.toContain('rareField')
  })

  it('should not extract object or array paths', () => {
    for (let i = 0; i < 100; i++) {
      tracker.track({
        user: { name: `User ${i}` }, // object
        tags: ['a', 'b'], // array
        value: i, // number - should be extracted
      })
    }

    const extracted = tracker.getExtractedPaths()
    const extractedPaths = extracted.map((e) => e.path)

    expect(extractedPaths).toContain('value')
    expect(extractedPaths).toContain('user.name')
    expect(extractedPaths).not.toContain('user') // object
    expect(extractedPaths).not.toContain('tags') // array
  })

  it('should update frequency correctly as records are added', () => {
    // First 50 records have fieldA
    for (let i = 0; i < 50; i++) {
      tracker.track({ fieldA: i })
    }

    let stats = tracker.getAllStats()
    expect(stats.find((s) => s.path === 'fieldA')!.frequency).toBe(1.0)

    // Next 50 records don't have fieldA
    for (let i = 0; i < 50; i++) {
      tracker.track({ fieldB: i })
    }

    stats = tracker.getAllStats()
    expect(stats.find((s) => s.path === 'fieldA')!.frequency).toBeCloseTo(0.5, 1)
    expect(stats.find((s) => s.path === 'fieldB')!.frequency).toBeCloseTo(0.5, 1)
  })

  it('should report record count', () => {
    for (let i = 0; i < 42; i++) {
      tracker.track({ value: i })
    }

    expect(tracker.getRecordCount()).toBe(42)
  })
})

// ============================================================================
// TypedColumnStore Tests
// ============================================================================

describe('JSON Typed Columns - TypedColumnStore', () => {
  let store: TypedColumnStore

  beforeEach(() => {
    store = new TypedColumnStore()
  })

  describe('String Columns', () => {
    it('should store string columns', () => {
      store.addStringColumn('name', ['Alice', 'Bob', null, 'Charlie'])

      expect(store.getString('name', 0)).toBe('Alice')
      expect(store.getString('name', 1)).toBe('Bob')
      expect(store.getString('name', 2)).toBeNull()
      expect(store.getString('name', 3)).toBe('Charlie')
    })

    it('should handle empty strings', () => {
      store.addStringColumn('text', ['', 'value', ''])

      expect(store.getString('text', 0)).toBe('')
      expect(store.getString('text', 1)).toBe('value')
      expect(store.getString('text', 2)).toBe('')
    })

    it('should handle unicode strings', () => {
      store.addStringColumn('unicode', ['hello', 'world', 'test'])

      expect(store.getString('unicode', 0)).toBe('hello')
    })
  })

  describe('Number Columns', () => {
    it('should store number columns using Float64Array', () => {
      store.addNumberColumn('amount', [100.5, 200.25, null, 300.75])

      expect(store.getNumber('amount', 0)).toBeCloseTo(100.5)
      expect(store.getNumber('amount', 1)).toBeCloseTo(200.25)
      expect(store.getNumber('amount', 2)).toBeNull()
      expect(store.getNumber('amount', 3)).toBeCloseTo(300.75)
    })

    it('should handle integer values', () => {
      store.addNumberColumn('count', [1, 2, 3, 4, 5])

      expect(store.getNumber('count', 0)).toBe(1)
      expect(store.getNumber('count', 4)).toBe(5)
    })

    it('should handle very large numbers', () => {
      store.addNumberColumn('big', [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])

      expect(store.getNumber('big', 0)).toBe(Number.MAX_SAFE_INTEGER)
      expect(store.getNumber('big', 1)).toBe(Number.MIN_SAFE_INTEGER)
    })

    it('should handle negative numbers', () => {
      store.addNumberColumn('signed', [-100, 0, 100])

      expect(store.getNumber('signed', 0)).toBe(-100)
      expect(store.getNumber('signed', 1)).toBe(0)
      expect(store.getNumber('signed', 2)).toBe(100)
    })
  })

  describe('Boolean Columns', () => {
    it('should store boolean columns as packed bits', () => {
      store.addBoolColumn('active', [true, false, null, true, false, true])

      expect(store.getBool('active', 0)).toBe(true)
      expect(store.getBool('active', 1)).toBe(false)
      expect(store.getBool('active', 2)).toBeNull()
      expect(store.getBool('active', 3)).toBe(true)
      expect(store.getBool('active', 4)).toBe(false)
      expect(store.getBool('active', 5)).toBe(true)
    })

    it('should handle large boolean arrays efficiently', () => {
      const values = Array.from({ length: 1000 }, (_, i) => i % 2 === 0)
      store.addBoolColumn('flags', values)

      // Verify a few values
      expect(store.getBool('flags', 0)).toBe(true)
      expect(store.getBool('flags', 1)).toBe(false)
      expect(store.getBool('flags', 998)).toBe(true)
      expect(store.getBool('flags', 999)).toBe(false)

      // Should use packed bits (1000/8 = 125 bytes)
      const memory = store.getMemoryUsage()
      expect(memory.boolBytes).toBeLessThanOrEqual(Math.ceil(1000 / 8) + 10)
    })
  })

  describe('Aggregations', () => {
    it('should compute sum efficiently', () => {
      const values = Array.from({ length: 1000 }, (_, i) => (i % 10 === 0 ? null : i))
      store.addNumberColumn('values', values)

      const sum = store.sum('values')
      const expected = Array.from({ length: 1000 }, (_, i) => i)
        .filter((i) => i % 10 !== 0)
        .reduce((a, b) => a + b, 0)

      expect(sum).toBe(expected)
    })

    it('should return 0 for sum of non-existent column', () => {
      expect(store.sum('nonexistent')).toBe(0)
    })

    it('should compute min value', () => {
      store.addNumberColumn('values', [50, 10, 30, null, 20])
      expect(store.min('values')).toBe(10)
    })

    it('should compute max value', () => {
      store.addNumberColumn('values', [50, 10, 30, null, 20])
      expect(store.max('values')).toBe(50)
    })

    it('should compute avg value', () => {
      store.addNumberColumn('values', [10, 20, 30, null, 40])
      // Avg of [10, 20, 30, 40] = 100/4 = 25
      expect(store.avg('values')).toBe(25)
    })
  })

  describe('Memory Usage', () => {
    it('should report memory usage', () => {
      store.addStringColumn('name', Array(100).fill('test'))
      store.addNumberColumn('amount', Array(100).fill(123.45))
      store.addBoolColumn('active', Array(100).fill(true))

      const memory = store.getMemoryUsage()

      expect(memory.stringBytes).toBeGreaterThan(0)
      expect(memory.numberBytes).toBe(100 * 8) // Float64 = 8 bytes each
      expect(memory.boolBytes).toBe(Math.ceil(100 / 8)) // Packed bits
      expect(memory.total).toBe(
        memory.stringBytes + memory.numberBytes + memory.boolBytes + memory.nullMaskBytes
      )
    })

    it('should have efficient memory for nulls', () => {
      // All nulls should use minimal memory
      store.addNumberColumn('nulls', Array(1000).fill(null))

      const memory = store.getMemoryUsage()
      // Numbers use Float64Array regardless, but null mask is compact
      expect(memory.nullMaskBytes).toBeLessThanOrEqual(Math.ceil(1000 / 8) + 10)
    })
  })

  describe('Serialization', () => {
    it('should serialize to binary format', () => {
      store.addStringColumn('name', ['Alice', 'Bob'])
      store.addNumberColumn('amount', [100, 200])

      const binary = store.serialize()

      expect(binary).toBeDefined()
      expect(binary instanceof ArrayBuffer || binary instanceof Uint8Array).toBe(true)
    })

    it('should deserialize from binary format', () => {
      store.addStringColumn('name', ['Alice', 'Bob'])
      store.addNumberColumn('amount', [100, 200])

      const binary = store.serialize()
      const restored = TypedColumnStore.deserialize(binary)

      expect(restored.getString('name', 0)).toBe('Alice')
      expect(restored.getNumber('amount', 1)).toBe(200)
    })
  })
})

// ============================================================================
// Schema Evolution Handler Tests
// ============================================================================

describe('JSON Typed Columns - SchemaEvolutionHandler', () => {
  let handler: SchemaEvolutionHandler

  beforeEach(() => {
    handler = new SchemaEvolutionHandler()
  })

  it('should detect new columns', () => {
    const stats: PathStatistics[] = [
      {
        path: 'user.name',
        frequency: 1.0,
        type: 'string' as JSONType,
        typeDistribution: { string: 100, number: 0, boolean: 0, null: 0, array: 0, object: 0 },
        cardinality: 100,
        isExtracted: false,
      },
      {
        path: 'amount',
        frequency: 0.95,
        type: 'number' as JSONType,
        typeDistribution: { string: 0, number: 95, boolean: 0, null: 5, array: 0, object: 0 },
        cardinality: 50,
        isExtracted: false,
      },
    ]

    const changes = handler.detectChanges(stats, 0.1)

    expect(changes.newColumns).toContain('user.name')
    expect(changes.newColumns).toContain('amount')
    expect(changes.typeChanges).toHaveLength(0)
    expect(changes.removedColumns).toHaveLength(0)
  })

  it('should detect type changes', () => {
    // Initial schema
    const initialStats: PathStatistics[] = [
      {
        path: 'value',
        frequency: 1.0,
        type: 'string' as JSONType,
        typeDistribution: { string: 100, number: 0, boolean: 0, null: 0, array: 0, object: 0 },
        cardinality: 100,
        isExtracted: false,
      },
    ]
    handler.detectChanges(initialStats, 0.1)
    handler.applyChanges(['value'], initialStats, 0.1)

    // Type changed to number
    const newStats: PathStatistics[] = [
      {
        path: 'value',
        frequency: 1.0,
        type: 'number' as JSONType,
        typeDistribution: { string: 10, number: 90, boolean: 0, null: 0, array: 0, object: 0 },
        cardinality: 50,
        isExtracted: false,
      },
    ]

    const changes = handler.detectChanges(newStats, 0.1)

    expect(changes.typeChanges).toHaveLength(1)
    expect(changes.typeChanges[0].path).toBe('value')
    expect(changes.typeChanges[0].from).toBe('string')
    expect(changes.typeChanges[0].to).toBe('number')
  })

  it('should detect removed columns', () => {
    // Initial with two columns
    const initialStats: PathStatistics[] = [
      {
        path: 'fieldA',
        frequency: 1.0,
        type: 'string' as JSONType,
        typeDistribution: { string: 100, number: 0, boolean: 0, null: 0, array: 0, object: 0 },
        cardinality: 100,
        isExtracted: true,
      },
      {
        path: 'fieldB',
        frequency: 1.0,
        type: 'string' as JSONType,
        typeDistribution: { string: 100, number: 0, boolean: 0, null: 0, array: 0, object: 0 },
        cardinality: 100,
        isExtracted: true,
      },
    ]
    handler.applyChanges(['fieldA', 'fieldB'], initialStats, 0.1)

    // New stats with only fieldA
    const newStats: PathStatistics[] = [
      {
        path: 'fieldA',
        frequency: 1.0,
        type: 'string' as JSONType,
        typeDistribution: { string: 100, number: 0, boolean: 0, null: 0, array: 0, object: 0 },
        cardinality: 100,
        isExtracted: true,
      },
    ]

    const changes = handler.detectChanges(newStats, 0.1)

    expect(changes.removedColumns).toContain('fieldB')
  })

  it('should track schema version', () => {
    expect(handler.getVersion()).toBe(0)

    const stats: PathStatistics[] = [
      {
        path: 'field1',
        frequency: 1.0,
        type: 'string' as JSONType,
        typeDistribution: { string: 100, number: 0, boolean: 0, null: 0, array: 0, object: 0 },
        cardinality: 100,
        isExtracted: false,
      },
    ]

    handler.applyChanges(['field1'], stats, 0.1)
    expect(handler.getVersion()).toBe(1)

    handler.applyChanges(['field2'], stats, 0.1)
    expect(handler.getVersion()).toBe(2)
  })

  it('should get current schema', () => {
    const stats: PathStatistics[] = [
      {
        path: 'name',
        frequency: 1.0,
        type: 'string' as JSONType,
        typeDistribution: { string: 100, number: 0, boolean: 0, null: 0, array: 0, object: 0 },
        cardinality: 100,
        isExtracted: false,
      },
    ]

    handler.applyChanges(['name'], stats, 0.1)
    const schema = handler.getSchema()

    expect(schema.has('name')).toBe(true)
    expect(schema.get('name')!.type).toBe('string')
  })
})

// ============================================================================
// JSONTypedColumns Integration Tests
// ============================================================================

describe('JSON Typed Columns - Integration', () => {
  let columns: JSONTypedColumns

  beforeEach(() => {
    columns = createJSONTypedColumns({ extractionThreshold: 0.1 })
  })

  it('should create with default options', () => {
    const defaultColumns = createJSONTypedColumns()
    expect(defaultColumns).toBeDefined()
  })

  it('should store records and extract common paths', () => {
    for (let i = 0; i < 100; i++) {
      columns.insert(`id-${i}`, {
        user: { name: `User ${i}`, email: `user${i}@test.com` },
        amount: i * 10,
      })
    }
    columns.flush()

    const extracted = columns.getExtractedColumns()
    expect(extracted).toContain('user.name')
    expect(extracted).toContain('user.email')
    expect(extracted).toContain('amount')
  })

  it('should support projection pushdown queries', () => {
    for (let i = 0; i < 1000; i++) {
      columns.insert(`id-${i}`, {
        user: { name: `User ${i}`, email: `user${i}@test.com` },
        amount: i * 10,
        metadata: { created: Date.now(), tags: ['a', 'b'] },
      })
    }
    columns.flush()

    // Clear in-memory to force reload
    columns.clearCache()

    // Query only user.email - should only load that column
    const results = columns.query(['user.email'])

    expect(results.length).toBe(1000)

    const stats = columns.getStats()
    // Should read minimal columns, not all
    expect(stats.readCount).toBeLessThanOrEqual(3)
  })

  it('should support aggregate queries with single column read', () => {
    for (let i = 0; i < 100; i++) {
      columns.insert(`id-${i}`, {
        amount: i + 1, // 1 to 100
      })
    }
    columns.flush()
    columns.clearCache()

    const sum = columns.aggregate('amount', 'sum')
    expect(sum).toBe(5050) // 1+2+...+100

    const stats = columns.getStats()
    expect(stats.readCount).toBeLessThanOrEqual(2)
  })

  it('should handle dynamic/rare fields', () => {
    for (let i = 0; i < 100; i++) {
      const data: JSONObject = {
        id: i,
        name: `Item ${i}`,
      }
      // Only 2% have this field - below extraction threshold
      if (i < 2) {
        data.specialField = `special ${i}`
      }
      columns.insert(`id-${i}`, data)
    }
    columns.flush()

    // Should NOT be extracted as column
    const extracted = columns.getExtractedColumns()
    expect(extracted).not.toContain('specialField')

    // But should still be queryable via dynamic data
    const result = columns.get('id-0', ['specialField'])
    expect(result).not.toBeNull()
  })

  it('should achieve 99%+ savings for typical workloads', () => {
    const recordCount = 10000

    for (let i = 0; i < recordCount; i++) {
      columns.insert(`id-${i}`, {
        user: { name: `User ${i}`, email: `user${i}@test.com` },
        amount: i * 10,
        status: i % 2 === 0 ? 'active' : 'inactive',
      })
    }
    columns.flush()

    const stats = columns.getStats()

    // Write savings
    const writeSavings = (1 - stats.writeCount / recordCount) * 100
    expect(writeSavings).toBeGreaterThan(99)
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('JSON Typed Columns - Edge Cases', () => {
  it('should handle empty storage', () => {
    const columns = createJSONTypedColumns()
    expect(columns.count()).toBe(0)
    expect(columns.query(['any.path'])).toEqual([])
  })

  it('should handle deeply nested paths', () => {
    const columns = createJSONTypedColumns({ extractionThreshold: 0.1 })

    for (let i = 0; i < 100; i++) {
      columns.insert(`id-${i}`, {
        level1: {
          level2: {
            level3: {
              level4: {
                value: i,
              },
            },
          },
        },
      })
    }
    columns.flush()

    const extracted = columns.getExtractedColumns()
    expect(extracted).toContain('level1.level2.level3.level4.value')
  })

  it('should handle null values in extracted columns', () => {
    const columns = createJSONTypedColumns({ extractionThreshold: 0.1 })

    for (let i = 0; i < 100; i++) {
      columns.insert(`id-${i}`, {
        name: i % 3 === 0 ? null : `Name ${i}`,
        value: i,
      })
    }
    columns.flush()
    columns.clearCache()

    const results = columns.query(['name', 'value'])
    const nullNames = results.filter((r) => r.name === null || r.name === undefined)

    expect(nullNames.length).toBeGreaterThan(0)
  })

  it('should handle special characters in paths', () => {
    const columns = createJSONTypedColumns({ extractionThreshold: 0.1 })

    for (let i = 0; i < 100; i++) {
      columns.insert(`id-${i}`, {
        'user-name': `User ${i}`,
        amount_usd: i * 10,
      })
    }
    columns.flush()

    const result = columns.get('id-50', ['user-name', 'amount_usd'])
    expect(result).not.toBeNull()
  })

  it('should handle mixed types at same path', () => {
    const columns = createJSONTypedColumns({ extractionThreshold: 0.1 })

    // Mixed types - should use dominant type
    for (let i = 0; i < 100; i++) {
      columns.insert(`id-${i}`, {
        value: i < 80 ? `string-${i}` : i, // 80% strings, 20% numbers
      })
    }
    columns.flush()

    const stats = columns.getPathStatistics()
    const valueStats = stats.find((s) => s.path === 'value')

    expect(valueStats).toBeDefined()
    expect(valueStats!.type).toBe('string') // Dominant type
  })
})

// ============================================================================
// Cost Analysis Tests
// ============================================================================

describe('JSON Typed Columns - Cost Analysis', () => {
  it('should provide query cost analysis', () => {
    const analysis = createJSONTypedColumns.queryCostAnalysis(10000, 20, 10)

    // COUNT should read 1 row
    const countQuery = analysis.find((a) => a.query === 'SELECT COUNT(*)')
    expect(countQuery!.rowPerRecord).toBe(10000)
    expect(countQuery!.jsonColumnar).toBe(1)

    // Single column query should read 2 rows
    const singleCol = analysis.find((a) => a.query === 'SELECT data.user.email')
    expect(singleCol!.jsonColumnar).toBe(2)

    // SUM should read 1 row
    const sumQuery = analysis.find((a) => a.query === 'SELECT SUM(data.amount)')
    expect(sumQuery!.jsonColumnar).toBe(1)
  })

  it('should scale cost savings with record count', () => {
    const testCounts = [100, 1000, 10000]

    for (const count of testCounts) {
      const columns = createJSONTypedColumns({ extractionThreshold: 0.1 })

      for (let i = 0; i < count; i++) {
        columns.insert(`id-${i}`, {
          user: { name: `User ${i}` },
          amount: i,
        })
      }
      columns.flush()

      const stats = columns.getStats()
      const savings = (1 - stats.writeCount / count) * 100

      // Savings should increase with record count
      expect(savings).toBeGreaterThan(90)
      if (count >= 1000) {
        expect(savings).toBeGreaterThan(99)
      }
    }
  })
})

// ============================================================================
// Export Tests
// ============================================================================

describe('JSON Typed Columns - Exports', () => {
  it('should export createJSONTypedColumns factory', async () => {
    const module = await import('../json-typed-columns')
    expect(module.createJSONTypedColumns).toBeDefined()
    expect(typeof module.createJSONTypedColumns).toBe('function')
  })

  it('should export path utilities', async () => {
    const module = await import('../json-typed-columns')
    expect(module.extractPaths).toBeDefined()
    expect(module.getPath).toBeDefined()
    expect(module.setPath).toBeDefined()
  })

  it('should export PathStatisticsTracker class', async () => {
    const module = await import('../json-typed-columns')
    expect(module.PathStatisticsTracker).toBeDefined()
  })

  it('should export TypedColumnStore class', async () => {
    const module = await import('../json-typed-columns')
    expect(module.TypedColumnStore).toBeDefined()
  })

  it('should export SchemaEvolutionHandler class', async () => {
    const module = await import('../json-typed-columns')
    expect(module.SchemaEvolutionHandler).toBeDefined()
  })

  it('should export type definitions', async () => {
    // Type exports are verified at compile time
    // This test ensures the module loads without error
    const module = await import('../json-typed-columns')
    expect(module).toBeDefined()
  })
})
