/**
 * DiffEngine Tests - TDD for sync diff calculations
 *
 * Tests for:
 * - Detecting new records not in destination
 * - Detecting modified records by comparing fields
 * - Detecting deleted records missing from source
 * - Handling composite primary keys
 * - Incremental mode using timestamp filtering
 * - Handling empty source/destination gracefully
 *
 * @module db/primitives/connector-framework/diff-engine
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DiffEngine,
  createDiffEngine,
  type DiffResult,
  type DiffOptions,
  type DiffRecord,
} from './diff-engine'

// =============================================================================
// Basic Diff Detection Tests (dotdo-6xxid)
// =============================================================================

describe('DiffEngine', () => {
  describe('detecting new records', () => {
    it('should detect records in source not in destination', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice' },
      ]

      const result = engine.diff(source, destination)

      expect(result.added).toHaveLength(2)
      expect(result.added.map(r => r.id)).toEqual([2, 3])
    })

    it('should detect all records as added when destination is empty', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]

      const destination: DiffRecord[] = []

      const result = engine.diff(source, destination)

      expect(result.added).toHaveLength(2)
      expect(result.modified).toHaveLength(0)
      expect(result.deleted).toHaveLength(0)
    })

    it('should detect no additions when source is subset of destination', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice' },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]

      const result = engine.diff(source, destination)

      expect(result.added).toHaveLength(0)
    })
  })

  describe('detecting modified records', () => {
    it('should detect records with changed field values', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice Smith' }, // name changed
        { id: 2, name: 'Bob' },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]

      const result = engine.diff(source, destination)

      expect(result.modified).toHaveLength(1)
      expect(result.modified[0].id).toBe(1)
      expect(result.modified[0].name).toBe('Alice Smith')
    })

    it('should detect multiple field changes in same record', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice Updated', email: 'alice@new.com', age: 30 },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice', email: 'alice@old.com', age: 25 },
      ]

      const result = engine.diff(source, destination)

      expect(result.modified).toHaveLength(1)
      expect(result.modified[0]).toEqual({
        id: 1,
        name: 'Alice Updated',
        email: 'alice@new.com',
        age: 30,
      })
    })

    it('should not mark records as modified when unchanged', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]

      const result = engine.diff(source, destination)

      expect(result.modified).toHaveLength(0)
      expect(result.unchanged).toBe(2)
    })

    it('should handle new fields in source records', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice', newField: 'value' },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice' },
      ]

      const result = engine.diff(source, destination)

      expect(result.modified).toHaveLength(1)
      expect(result.modified[0].newField).toBe('value')
    })

    it('should handle removed fields in source records', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice' },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice', oldField: 'value' },
      ]

      const result = engine.diff(source, destination)

      // Removed field is a modification
      expect(result.modified).toHaveLength(1)
    })
  })

  describe('detecting deleted records', () => {
    it('should detect records in destination not in source', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice' },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ]

      const result = engine.diff(source, destination)

      expect(result.deleted).toHaveLength(2)
      expect(result.deleted.map(r => r.id)).toEqual([2, 3])
    })

    it('should detect all records as deleted when source is empty', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = []

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]

      const result = engine.diff(source, destination)

      expect(result.deleted).toHaveLength(2)
      expect(result.added).toHaveLength(0)
      expect(result.modified).toHaveLength(0)
    })

    it('should detect no deletions when destination is subset of source', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice' },
      ]

      const result = engine.diff(source, destination)

      expect(result.deleted).toHaveLength(0)
    })
  })

  describe('composite primary keys', () => {
    it('should handle composite primary keys (two fields)', () => {
      const engine = createDiffEngine({ primaryKey: ['org_id', 'user_id'] })

      const source: DiffRecord[] = [
        { org_id: 1, user_id: 1, name: 'Alice' },
        { org_id: 1, user_id: 2, name: 'Bob' },
        { org_id: 2, user_id: 1, name: 'Charlie' },
      ]

      const destination: DiffRecord[] = [
        { org_id: 1, user_id: 1, name: 'Alice' },
      ]

      const result = engine.diff(source, destination)

      expect(result.added).toHaveLength(2)
      expect(result.modified).toHaveLength(0)
      expect(result.deleted).toHaveLength(0)
    })

    it('should detect modifications with composite keys', () => {
      const engine = createDiffEngine({ primaryKey: ['org_id', 'user_id'] })

      const source: DiffRecord[] = [
        { org_id: 1, user_id: 1, name: 'Alice Updated' },
      ]

      const destination: DiffRecord[] = [
        { org_id: 1, user_id: 1, name: 'Alice' },
      ]

      const result = engine.diff(source, destination)

      expect(result.modified).toHaveLength(1)
      expect(result.modified[0].name).toBe('Alice Updated')
    })

    it('should handle three-part composite keys', () => {
      const engine = createDiffEngine({ primaryKey: ['region', 'org_id', 'user_id'] })

      const source: DiffRecord[] = [
        { region: 'us', org_id: 1, user_id: 1, name: 'Alice' },
        { region: 'eu', org_id: 1, user_id: 1, name: 'Alice EU' },
      ]

      const destination: DiffRecord[] = [
        { region: 'us', org_id: 1, user_id: 1, name: 'Alice' },
      ]

      const result = engine.diff(source, destination)

      expect(result.added).toHaveLength(1)
      expect(result.added[0]).toMatchObject({ region: 'eu', org_id: 1, user_id: 1 })
    })

    it('should correctly match records with same values but different composite key combinations', () => {
      const engine = createDiffEngine({ primaryKey: ['a', 'b'] })

      const source: DiffRecord[] = [
        { a: 1, b: 2, value: 'one' },
        { a: 2, b: 1, value: 'two' },
      ]

      const destination: DiffRecord[] = [
        { a: 1, b: 2, value: 'one' },
        { a: 2, b: 1, value: 'two' },
      ]

      const result = engine.diff(source, destination)

      expect(result.added).toHaveLength(0)
      expect(result.modified).toHaveLength(0)
      expect(result.deleted).toHaveLength(0)
      expect(result.unchanged).toBe(2)
    })
  })

  describe('incremental mode', () => {
    it('should filter source by timestamp field', () => {
      const engine = createDiffEngine({
        primaryKey: 'id',
        timestampField: 'updated_at',
      })

      const lastSync = new Date('2024-01-02T00:00:00Z')

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice', updated_at: '2024-01-01T00:00:00Z' }, // Before lastSync
        { id: 2, name: 'Bob', updated_at: '2024-01-03T00:00:00Z' },   // After lastSync
        { id: 3, name: 'Charlie', updated_at: '2024-01-04T00:00:00Z' }, // After lastSync
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob Old' },
      ]

      const result = engine.diffIncremental(source, destination, lastSync)

      // Only considers records after lastSync (id: 2, 3)
      expect(result.added).toHaveLength(1) // id: 3
      expect(result.added[0].id).toBe(3)
      expect(result.modified).toHaveLength(1) // id: 2 was modified
      expect(result.modified[0].id).toBe(2)
    })

    it('should handle ISO date strings in timestamp field', () => {
      const engine = createDiffEngine({
        primaryKey: 'id',
        timestampField: 'modified_at',
      })

      const lastSync = new Date('2024-01-15T12:00:00Z')

      const source: DiffRecord[] = [
        { id: 1, name: 'Recent', modified_at: '2024-01-16T00:00:00Z' },
        { id: 2, name: 'Old', modified_at: '2024-01-14T00:00:00Z' },
      ]

      const destination: DiffRecord[] = []

      const result = engine.diffIncremental(source, destination, lastSync)

      expect(result.added).toHaveLength(1)
      expect(result.added[0].id).toBe(1)
    })

    it('should handle numeric timestamps', () => {
      const engine = createDiffEngine({
        primaryKey: 'id',
        timestampField: 'ts',
      })

      const lastSync = new Date(1705000000000) // Some timestamp

      const source: DiffRecord[] = [
        { id: 1, name: 'Recent', ts: 1705100000000 },
        { id: 2, name: 'Old', ts: 1704900000000 },
      ]

      const destination: DiffRecord[] = []

      const result = engine.diffIncremental(source, destination, lastSync)

      expect(result.added).toHaveLength(1)
      expect(result.added[0].id).toBe(1)
    })

    it('should handle Date objects in timestamp field', () => {
      const engine = createDiffEngine({
        primaryKey: 'id',
        timestampField: 'updated',
      })

      const lastSync = new Date('2024-01-15')

      const source: DiffRecord[] = [
        { id: 1, name: 'Recent', updated: new Date('2024-01-16') },
        { id: 2, name: 'Old', updated: new Date('2024-01-14') },
      ]

      const destination: DiffRecord[] = []

      const result = engine.diffIncremental(source, destination, lastSync)

      expect(result.added).toHaveLength(1)
      expect(result.added[0].id).toBe(1)
    })

    it('should not detect deletions in incremental mode', () => {
      const engine = createDiffEngine({
        primaryKey: 'id',
        timestampField: 'updated_at',
      })

      const lastSync = new Date('2024-01-01T00:00:00Z')

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice', updated_at: '2024-01-02T00:00:00Z' },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }, // Not in source, but incremental mode ignores
      ]

      const result = engine.diffIncremental(source, destination, lastSync)

      // Incremental mode doesn't track deletions by default
      expect(result.deleted).toHaveLength(0)
    })

    it('should handle missing timestamp field gracefully', () => {
      const engine = createDiffEngine({
        primaryKey: 'id',
        timestampField: 'updated_at',
      })

      const lastSync = new Date('2024-01-01T00:00:00Z')

      const source: DiffRecord[] = [
        { id: 1, name: 'No timestamp' }, // Missing updated_at
        { id: 2, name: 'Has timestamp', updated_at: '2024-01-02T00:00:00Z' },
      ]

      const destination: DiffRecord[] = []

      const result = engine.diffIncremental(source, destination, lastSync)

      // Records without timestamp are skipped in incremental mode
      expect(result.added).toHaveLength(1)
      expect(result.added[0].id).toBe(2)
    })
  })

  describe('empty source/destination handling', () => {
    it('should handle both empty source and destination', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const result = engine.diff([], [])

      expect(result.added).toHaveLength(0)
      expect(result.modified).toHaveLength(0)
      expect(result.deleted).toHaveLength(0)
      expect(result.unchanged).toBe(0)
    })

    it('should return correct stats for empty source', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]

      const result = engine.diff([], destination)

      expect(result.stats.sourceCount).toBe(0)
      expect(result.stats.destinationCount).toBe(2)
      expect(result.stats.addedCount).toBe(0)
      expect(result.stats.modifiedCount).toBe(0)
      expect(result.stats.deletedCount).toBe(2)
    })

    it('should return correct stats for empty destination', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]

      const result = engine.diff(source, [])

      expect(result.stats.sourceCount).toBe(2)
      expect(result.stats.destinationCount).toBe(0)
      expect(result.stats.addedCount).toBe(2)
      expect(result.stats.modifiedCount).toBe(0)
      expect(result.stats.deletedCount).toBe(0)
    })
  })

  describe('diff result structure', () => {
    it('should return complete diff result with stats', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice Updated' },
        { id: 2, name: 'Bob' },
        { id: 4, name: 'New' },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Deleted' },
      ]

      const result = engine.diff(source, destination)

      expect(result).toMatchObject({
        added: expect.any(Array),
        modified: expect.any(Array),
        deleted: expect.any(Array),
        unchanged: 1,
        stats: {
          sourceCount: 3,
          destinationCount: 3,
          addedCount: 1,
          modifiedCount: 1,
          deletedCount: 1,
          unchangedCount: 1,
        },
      })
    })

    it('should preserve full record data in results', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice', email: 'alice@new.com', nested: { value: 1 } },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice Old', email: 'alice@old.com', nested: { value: 0 } },
      ]

      const result = engine.diff(source, destination)

      expect(result.modified[0]).toEqual({
        id: 1,
        name: 'Alice',
        email: 'alice@new.com',
        nested: { value: 1 },
      })
    })
  })

  describe('field comparison options', () => {
    it('should ignore specified fields when comparing', () => {
      const engine = createDiffEngine({
        primaryKey: 'id',
        ignoreFields: ['updated_at', 'created_at'],
      })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice', updated_at: '2024-01-02', created_at: '2024-01-01' },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice', updated_at: '2024-01-01', created_at: '2024-01-01' },
      ]

      const result = engine.diff(source, destination)

      expect(result.modified).toHaveLength(0)
      expect(result.unchanged).toBe(1)
    })

    it('should only compare specified fields when compareFields is set', () => {
      const engine = createDiffEngine({
        primaryKey: 'id',
        compareFields: ['name', 'email'],
      })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice', email: 'alice@example.com', age: 30 },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice', email: 'alice@example.com', age: 25 }, // age differs but not compared
      ]

      const result = engine.diff(source, destination)

      expect(result.modified).toHaveLength(0)
      expect(result.unchanged).toBe(1)
    })

    it('should detect modification when compareFields field changes', () => {
      const engine = createDiffEngine({
        primaryKey: 'id',
        compareFields: ['name'],
      })

      const source: DiffRecord[] = [
        { id: 1, name: 'Alice Updated', email: 'alice@example.com' },
      ]

      const destination: DiffRecord[] = [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
      ]

      const result = engine.diff(source, destination)

      expect(result.modified).toHaveLength(1)
    })
  })

  describe('nested object comparison', () => {
    it('should detect changes in nested objects', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, profile: { name: 'Alice', settings: { theme: 'dark' } } },
      ]

      const destination: DiffRecord[] = [
        { id: 1, profile: { name: 'Alice', settings: { theme: 'light' } } },
      ]

      const result = engine.diff(source, destination)

      expect(result.modified).toHaveLength(1)
    })

    it('should not mark unchanged nested objects as modified', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, profile: { name: 'Alice', settings: { theme: 'dark' } } },
      ]

      const destination: DiffRecord[] = [
        { id: 1, profile: { name: 'Alice', settings: { theme: 'dark' } } },
      ]

      const result = engine.diff(source, destination)

      expect(result.modified).toHaveLength(0)
      expect(result.unchanged).toBe(1)
    })

    it('should handle arrays in records', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = [
        { id: 1, tags: ['a', 'b', 'c'] },
      ]

      const destination: DiffRecord[] = [
        { id: 1, tags: ['a', 'b'] },
      ]

      const result = engine.diff(source, destination)

      expect(result.modified).toHaveLength(1)
    })
  })

  describe('string primary key values', () => {
    it('should handle string primary keys', () => {
      const engine = createDiffEngine({ primaryKey: 'uuid' })

      const source: DiffRecord[] = [
        { uuid: 'abc-123', name: 'Alice' },
        { uuid: 'def-456', name: 'Bob' },
      ]

      const destination: DiffRecord[] = [
        { uuid: 'abc-123', name: 'Alice' },
      ]

      const result = engine.diff(source, destination)

      expect(result.added).toHaveLength(1)
      expect(result.added[0].uuid).toBe('def-456')
    })

    it('should handle mixed type primary key values in composite keys', () => {
      const engine = createDiffEngine({ primaryKey: ['type', 'id'] })

      const source: DiffRecord[] = [
        { type: 'user', id: 1, name: 'Alice' },
        { type: 'org', id: '1', name: 'Acme' }, // id is string here
      ]

      const destination: DiffRecord[] = [
        { type: 'user', id: 1, name: 'Alice' },
      ]

      const result = engine.diff(source, destination)

      expect(result.added).toHaveLength(1)
      expect(result.added[0]).toMatchObject({ type: 'org', id: '1' })
    })
  })

  describe('performance considerations', () => {
    it('should handle large datasets efficiently', () => {
      const engine = createDiffEngine({ primaryKey: 'id' })

      const source: DiffRecord[] = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        value: i % 2 === 0 ? 'even' : 'odd',
      }))

      const destination: DiffRecord[] = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        value: 'original',
      }))

      const startTime = Date.now()
      const result = engine.diff(source, destination)
      const duration = Date.now() - startTime

      // Should complete in reasonable time
      expect(duration).toBeLessThan(1000)
      expect(result.stats.sourceCount).toBe(10000)
    })
  })
})

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createDiffEngine', () => {
  it('should create engine with single primary key', () => {
    const engine = createDiffEngine({ primaryKey: 'id' })
    expect(engine).toBeDefined()
    expect(engine.diff).toBeInstanceOf(Function)
    expect(engine.diffIncremental).toBeInstanceOf(Function)
  })

  it('should create engine with composite primary key', () => {
    const engine = createDiffEngine({ primaryKey: ['a', 'b'] })
    expect(engine).toBeDefined()
  })

  it('should create engine with all options', () => {
    const engine = createDiffEngine({
      primaryKey: 'id',
      timestampField: 'updated_at',
      ignoreFields: ['meta'],
      compareFields: ['name', 'email'],
    })
    expect(engine).toBeDefined()
  })
})
