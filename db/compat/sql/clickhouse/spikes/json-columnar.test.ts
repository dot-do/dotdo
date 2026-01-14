/**
 * Tests for ClickHouse JSON Columnar Storage Spike
 *
 * Validates typed subcolumn extraction, path statistics,
 * projection pushdown, and cost optimization
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  extractPaths,
  getPath,
  setPath,
  PathStatisticsTracker,
  JSONColumnarStorage,
  TypedColumnStore,
  SchemaEvolutionHandler,
  type JSONObject,
} from './json-columnar'

describe('JSON Columnar Storage', () => {
  // ============================================================================
  // Path Utilities
  // ============================================================================
  describe('Path Utilities', () => {
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

    it('should get value at path', () => {
      const obj = {
        user: { name: 'Alice', email: 'alice@test.com' },
        amount: 100,
      }

      expect(getPath(obj, 'user.name')).toBe('Alice')
      expect(getPath(obj, 'user.email')).toBe('alice@test.com')
      expect(getPath(obj, 'amount')).toBe(100)
      expect(getPath(obj, 'user.missing')).toBeUndefined()
    })

    it('should set value at path', () => {
      const obj: JSONObject = {}
      setPath(obj, 'user.name', 'Alice')
      setPath(obj, 'user.email', 'alice@test.com')
      setPath(obj, 'amount', 100)

      expect((obj.user as JSONObject).name).toBe('Alice')
      expect((obj.user as JSONObject).email).toBe('alice@test.com')
      expect(obj.amount).toBe(100)
    })
  })

  // ============================================================================
  // Path Statistics Tracker
  // ============================================================================
  describe('PathStatisticsTracker', () => {
    let tracker: PathStatisticsTracker

    beforeEach(() => {
      tracker = new PathStatisticsTracker(0.1) // 10% threshold
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
          // Only 5% have this field - below threshold
          data.rareField = `rare ${i}`
        }
        tracker.track(data)
      }

      const extracted = tracker.getExtractedPaths()
      const extractedPaths = extracted.map((e) => e.path)

      expect(extractedPaths).toContain('id')
      expect(extractedPaths).toContain('name')
      expect(extractedPaths).not.toContain('rareField') // Below 10% threshold
    })
  })

  // ============================================================================
  // JSON Columnar Storage
  // ============================================================================
  describe('JSONColumnarStorage', () => {
    let storage: JSONColumnarStorage

    beforeEach(() => {
      storage = new JSONColumnarStorage(0.1) // 10% extraction threshold
    })

    it('should store records and extract common paths as columns', () => {
      // Insert records with consistent schema
      for (let i = 0; i < 100; i++) {
        storage.insert(`id-${i}`, {
          user: { name: `User ${i}`, email: `user${i}@test.com` },
          amount: i * 10,
        })
      }
      storage.flush()

      const extracted = storage.getExtractedColumns()
      expect(extracted).toContain('user.name')
      expect(extracted).toContain('user.email')
      expect(extracted).toContain('amount')
    })

    it('should support projection pushdown queries', () => {
      for (let i = 0; i < 1000; i++) {
        storage.insert(`id-${i}`, {
          user: { name: `User ${i}`, email: `user${i}@test.com` },
          amount: i * 10,
          metadata: { created: Date.now(), tags: ['a', 'b'] },
        })
      }
      storage.flush()

      // Clear in-memory to force reload
      storage['columns'].clear()
      storage['ids'] = []
      storage['readCount'] = 0

      // Query only user.email - should only load that column
      const results = storage.query(['user.email'])

      expect(results.length).toBe(1000)
      expect(results[0].data.user).toBeDefined()

      const stats = storage.getStats()
      // Should read: _ids + col:user.email + _dynamic (for unextracted paths check)
      expect(stats.readCount).toBeLessThanOrEqual(3)
    })

    it('should only load 2 columns for single-path query', () => {
      for (let i = 0; i < 500; i++) {
        storage.insert(`id-${i}`, {
          user: { name: `User ${i}`, email: `user${i}@test.com` },
          amount: i * 10,
        })
      }
      storage.flush()

      // Clear and reset
      storage['columns'].clear()
      storage['ids'] = []
      storage['dynamicData'] = []
      storage['readCount'] = 0

      // Get single record, single path
      const result = storage.get('id-250', ['amount'])

      expect(result).not.toBeNull()
      expect(result!.amount).toBe(2500)

      const stats = storage.getStats()
      expect(stats.readCount).toBe(2) // _ids + col:amount
    })

    it('should support aggregate queries with single column read', () => {
      for (let i = 0; i < 100; i++) {
        storage.insert(`id-${i}`, {
          amount: i + 1, // 1 to 100
        })
      }
      storage.flush()

      // Clear and reset
      storage['columns'].clear()
      storage['dynamicData'] = []
      storage['readCount'] = 0

      const sum = storage.aggregate('amount', 'sum')
      expect(sum).toBe(5050) // 1+2+...+100

      const stats = storage.getStats()
      expect(stats.readCount).toBe(1) // Only col:amount
    })

    it('should handle filtering with projection', () => {
      for (let i = 0; i < 100; i++) {
        storage.insert(`id-${i}`, {
          user: { name: `User ${i}` },
          amount: i * 10,
          active: i % 2 === 0,
        })
      }
      storage.flush()

      // Clear and reset
      storage['columns'].clear()
      storage['ids'] = []
      storage['dynamicData'] = []
      storage['readCount'] = 0

      // Query with filter
      const results = storage.query(['user.name', 'amount'], (record) => {
        return (record.amount as number) > 500
      })

      expect(results.length).toBe(49) // i > 50, so 51-99 = 49 records

      const stats = storage.getStats()
      // Reads: _ids + col:user.name + col:amount + _dynamic
      expect(stats.readCount).toBeLessThanOrEqual(4)
    })

    it('should provide massive cost savings vs row-per-record', () => {
      const recordCount = 10000

      for (let i = 0; i < recordCount; i++) {
        storage.insert(`id-${i}`, {
          user: { name: `User ${i}`, email: `user${i}@test.com` },
          amount: i * 10,
        })
      }
      storage.flush()

      const stats = storage.getStats()

      // Row-per-record would be 10,000 writes
      // Columnar is: _ids + _paths + col:user.name + col:user.email + col:amount + _dynamic
      expect(stats.writeCount).toBeLessThan(10)
      expect(stats.writeCount).toBeLessThan(recordCount / 1000) // 99.9%+ savings
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
        storage.insert(`id-${i}`, data)
      }
      storage.flush()

      // Should NOT be extracted as column
      const extracted = storage.getExtractedColumns()
      expect(extracted).not.toContain('specialField')

      // But should still be queryable via dynamic data
      const result = storage.get('id-0', ['specialField'])
      expect(result).not.toBeNull()
      // Note: specialField is in dynamic data, so it should be retrievable
    })

    it('should provide query cost analysis', () => {
      const analysis = JSONColumnarStorage.queryCostAnalysis(10000, 20, 10)

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
  })

  // ============================================================================
  // Typed Column Store
  // ============================================================================
  describe('TypedColumnStore', () => {
    let store: TypedColumnStore

    beforeEach(() => {
      store = new TypedColumnStore()
    })

    it('should store string columns', () => {
      store.addStringColumn('name', ['Alice', 'Bob', null, 'Charlie'])

      expect(store.getString('name', 0)).toBe('Alice')
      expect(store.getString('name', 1)).toBe('Bob')
      expect(store.getString('name', 2)).toBeNull()
      expect(store.getString('name', 3)).toBe('Charlie')
    })

    it('should store number columns using Float64Array', () => {
      store.addNumberColumn('amount', [100.5, 200.25, null, 300.75])

      expect(store.getNumber('amount', 0)).toBeCloseTo(100.5)
      expect(store.getNumber('amount', 1)).toBeCloseTo(200.25)
      expect(store.getNumber('amount', 2)).toBeNull()
      expect(store.getNumber('amount', 3)).toBeCloseTo(300.75)
    })

    it('should store boolean columns as packed bits', () => {
      store.addBoolColumn('active', [true, false, null, true, false, true])

      expect(store.getBool('active', 0)).toBe(true)
      expect(store.getBool('active', 1)).toBe(false)
      expect(store.getBool('active', 2)).toBeNull()
      expect(store.getBool('active', 3)).toBe(true)
      expect(store.getBool('active', 4)).toBe(false)
      expect(store.getBool('active', 5)).toBe(true)
    })

    it('should compute sum efficiently', () => {
      const values = Array.from({ length: 1000 }, (_, i) => (i % 10 === 0 ? null : i))
      store.addNumberColumn('values', values)

      const sum = store.sum('values')
      // Sum of 1-999 excluding multiples of 10
      const expected = Array.from({ length: 1000 }, (_, i) => i)
        .filter((i) => i % 10 !== 0)
        .reduce((a, b) => a + b, 0)

      expect(sum).toBe(expected)
    })

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
  })

  // ============================================================================
  // Schema Evolution Handler
  // ============================================================================
  describe('SchemaEvolutionHandler', () => {
    it('should detect new columns', () => {
      const handler = new SchemaEvolutionHandler()
      const stats = [
        {
          path: 'user.name',
          frequency: 1.0,
          type: 'string' as const,
          typeDistribution: { string: 100, number: 0, boolean: 0, null: 0, array: 0, object: 0 },
          cardinality: 100,
          isExtracted: false,
        },
        {
          path: 'amount',
          frequency: 0.95,
          type: 'number' as const,
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
      const handler = new SchemaEvolutionHandler()

      // Initial schema
      const initialStats = [
        {
          path: 'value',
          frequency: 1.0,
          type: 'string' as const,
          typeDistribution: { string: 100, number: 0, boolean: 0, null: 0, array: 0, object: 0 },
          cardinality: 100,
          isExtracted: false,
        },
      ]
      handler.detectChanges(initialStats, 0.1)
      handler.applyChanges(['value'], initialStats, 0.1)

      // Type changed to number
      const newStats = [
        {
          path: 'value',
          frequency: 1.0,
          type: 'number' as const,
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

    it('should track schema version', () => {
      const handler = new SchemaEvolutionHandler()

      expect(handler.getVersion()).toBe(0)

      const stats = [
        {
          path: 'field1',
          frequency: 1.0,
          type: 'string' as const,
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
  })

  // ============================================================================
  // Cost Analysis
  // ============================================================================
  describe('Cost Analysis', () => {
    it('should demonstrate 99%+ savings for typical queries', () => {
      const storage = new JSONColumnarStorage(0.1)
      const recordCount = 1000

      for (let i = 0; i < recordCount; i++) {
        storage.insert(`id-${i}`, {
          user: { name: `User ${i}`, email: `user${i}@test.com` },
          amount: i * 10,
          status: i % 2 === 0 ? 'active' : 'inactive',
        })
      }
      storage.flush()

      const stats = storage.getStats()

      // Write savings
      const writeSavings = (1 - stats.writeCount / recordCount) * 100
      expect(writeSavings).toBeGreaterThan(99)

      // Reset for read test
      storage['columns'].clear()
      storage['ids'] = []
      storage['dynamicData'] = []
      storage['readCount'] = 0

      // Query single column
      storage.query(['user.email'])
      const readSavings = (1 - storage.getStats().readCount / recordCount) * 100
      expect(readSavings).toBeGreaterThan(99)
    })

    it('should scale cost savings with record count', () => {
      const testCounts = [100, 1000, 10000]

      for (const count of testCounts) {
        const storage = new JSONColumnarStorage(0.1)

        for (let i = 0; i < count; i++) {
          storage.insert(`id-${i}`, {
            user: { name: `User ${i}` },
            amount: i,
          })
        }
        storage.flush()

        const stats = storage.getStats()
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
  // Edge Cases
  // ============================================================================
  describe('Edge Cases', () => {
    it('should handle empty storage', () => {
      const storage = new JSONColumnarStorage()
      expect(storage.count()).toBe(0)
      expect(storage.query(['any.path'])).toEqual([])
    })

    it('should handle deeply nested paths', () => {
      const storage = new JSONColumnarStorage(0.1)

      for (let i = 0; i < 100; i++) {
        storage.insert(`id-${i}`, {
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
      storage.flush()

      const extracted = storage.getExtractedColumns()
      expect(extracted).toContain('level1.level2.level3.level4.value')
    })

    it('should handle null values in extracted columns', () => {
      const storage = new JSONColumnarStorage(0.1)

      for (let i = 0; i < 100; i++) {
        storage.insert(`id-${i}`, {
          name: i % 3 === 0 ? null : `Name ${i}`,
          value: i,
        })
      }
      storage.flush()

      // Clear and query
      storage['columns'].clear()
      storage['ids'] = []
      storage['readCount'] = 0

      const results = storage.query(['name', 'value'])
      const nullNames = results.filter((r) => r.data.name === null || r.data.name === undefined)

      expect(nullNames.length).toBeGreaterThan(0)
    })

    it('should handle special characters in paths', () => {
      const storage = new JSONColumnarStorage(0.1)

      for (let i = 0; i < 100; i++) {
        storage.insert(`id-${i}`, {
          'user-name': `User ${i}`,
          'amount_usd': i * 10,
        })
      }
      storage.flush()

      const result = storage.get('id-50', ['user-name', 'amount_usd'])
      expect(result).not.toBeNull()
    })
  })
})
