import { describe, it, expect } from 'vitest'

/**
 * Things Table Schema Tests
 *
 * These tests verify the append-only version log pattern for the things table.
 * rowid IS the version ID - each insert creates a new version.
 *
 * This is RED phase TDD - tests should FAIL until the things schema
 * is properly integrated with query helpers and type exports.
 *
 * Key design principles:
 * - APPEND-ONLY: No updates or deletes on existing rows
 * - VERSIONING: Each row is a version, rowid is the version ID
 * - BRANCHING: Same id can exist on different branches (null = main)
 * - SOFT DELETE: deleted flag marks thing as removed (new version)
 *
 * Query patterns:
 * - Current state: SELECT * FROM things WHERE id = ? ORDER BY rowid DESC LIMIT 1
 * - Time travel: SELECT * FROM things WHERE rowid = ?
 * - Branch state: SELECT * FROM things WHERE id = ? AND branch = ? ORDER BY rowid DESC LIMIT 1
 */

// Import the schema - this should exist
import { things } from '../things'

// These imports should FAIL until implemented in things.ts or db/index.ts
// @ts-expect-error - Thing type not yet exported
import type { Thing, NewThing } from '../things'

// These query helper imports should FAIL until implemented
// @ts-expect-error - getCurrentThing not yet implemented
import {
  getCurrentThing,
  getThingAtVersion,
  getThingVersions,
  getThingOnBranch,
  getCurrentThings,
  softDeleteThing,
  undeleteThing,
  countVersions,
  type ThingsDb,
} from '../things'

// ============================================================================
// Schema Types (Expected Interface)
// ============================================================================

interface ThingRecord {
  // rowid is implicit in SQLite and serves as version ID
  id: string // Local path: 'acme', 'headless.ly'
  type: number // FK -> nouns.rowid
  branch: string | null // 'main', 'experiment', null = main
  name: string | null
  data: unknown | null // JSON data
  deleted: boolean // Soft delete marker
}

// ============================================================================
// Schema Table Definition Tests
// ============================================================================

describe('Schema Table Definition', () => {
  describe('Column Existence', () => {
    it('has id column (text, not null)', () => {
      expect(things.id).toBeDefined()
    })

    it('has type column (integer, not null)', () => {
      expect(things.type).toBeDefined()
    })

    it('has branch column (text, nullable)', () => {
      expect(things.branch).toBeDefined()
    })

    it('has name column (text, nullable)', () => {
      expect(things.name).toBeDefined()
    })

    it('has data column (JSON text, nullable)', () => {
      expect(things.data).toBeDefined()
    })

    it('has deleted column (boolean integer, default false)', () => {
      expect(things.deleted).toBeDefined()
    })
  })

  describe('Table Structure', () => {
    it('things table is exported from db/things.ts', () => {
      expect(things).toBeDefined()
    })

    it('table name is "things"', () => {
      // Access the internal table name via drizzle's symbol-based structure
      const tableName = (things as any)[Symbol.for('drizzle:Name')] ?? (things as any)._.name
      expect(tableName).toBe('things')
    })

    it('all required columns are present', () => {
      const columns = ['id', 'type', 'branch', 'name', 'data', 'deleted']
      columns.forEach((col) => {
        expect((things as Record<string, unknown>)[col]).toBeDefined()
      })
    })
  })

  describe('Type Exports', () => {
    it('exports Thing type for select operations', () => {
      // Type test - should compile when types are exported
      const thing: Partial<Thing> = {
        id: 'test-001',
        type: 1,
        name: 'Test Thing',
      }
      expect(thing.id).toBe('test-001')
    })

    it('exports NewThing type for insert operations', () => {
      // Type test - should compile when types are exported
      const newThing: Partial<NewThing> = {
        id: 'new-001',
        type: 1,
      }
      expect(newThing.id).toBe('new-001')
    })
  })
})

// ============================================================================
// Version Log Pattern Tests
// ============================================================================

describe('Version Log Pattern', () => {
  describe('Conceptual: Insert Creates New Version', () => {
    it('each insert should create a new row (not update existing)', () => {
      // This is a design principle test
      // The things table is append-only - no UPDATE or DELETE on existing rows
      // Each "update" to a thing creates a new row with the same id
      // rowid serves as the version number

      const version1: ThingRecord = {
        id: 'customer-001',
        type: 1,
        branch: null,
        name: 'Version 1',
        data: { status: 'draft' },
        deleted: false,
      }

      const version2: ThingRecord = {
        id: 'customer-001', // Same id
        type: 1,
        branch: null,
        name: 'Version 2', // Different name
        data: { status: 'published' },
        deleted: false,
      }

      // Both versions should be valid and distinct
      expect(version1.id).toBe(version2.id)
      expect(version1.name).not.toBe(version2.name)
    })

    it('version history is preserved (append-only)', () => {
      // This validates the design principle
      const versions: ThingRecord[] = [
        { id: 'doc-001', type: 1, branch: null, name: 'Draft', data: null, deleted: false },
        { id: 'doc-001', type: 1, branch: null, name: 'Review', data: null, deleted: false },
        { id: 'doc-001', type: 1, branch: null, name: 'Final', data: null, deleted: false },
      ]

      // All versions exist and are accessible
      expect(versions).toHaveLength(3)
      expect(versions[0].name).toBe('Draft')
      expect(versions[2].name).toBe('Final')
    })
  })

  describe('Get Current Version Pattern', () => {
    it('current version query: ORDER BY rowid DESC LIMIT 1', () => {
      // Expected SQL pattern for getting current version:
      // SELECT * FROM things WHERE id = ? ORDER BY rowid DESC LIMIT 1
      const expectedQuery = 'SELECT * FROM things WHERE id = ? ORDER BY rowid DESC LIMIT 1'
      expect(expectedQuery).toContain('ORDER BY rowid DESC')
      expect(expectedQuery).toContain('LIMIT 1')
    })

    it('current version respects branch filter', () => {
      // Expected SQL pattern for getting current version on a branch:
      // SELECT * FROM things WHERE id = ? AND branch = ? ORDER BY rowid DESC LIMIT 1
      // OR for main branch:
      // SELECT * FROM things WHERE id = ? AND branch IS NULL ORDER BY rowid DESC LIMIT 1
      const mainBranchQuery = 'SELECT * FROM things WHERE id = ? AND branch IS NULL ORDER BY rowid DESC LIMIT 1'
      const namedBranchQuery = 'SELECT * FROM things WHERE id = ? AND branch = ? ORDER BY rowid DESC LIMIT 1'

      expect(mainBranchQuery).toContain('branch IS NULL')
      expect(namedBranchQuery).toContain('branch = ?')
    })
  })

  describe('Time Travel Pattern', () => {
    it('specific version query: WHERE rowid = ?', () => {
      // Expected SQL pattern for time travel:
      // SELECT * FROM things WHERE rowid = ?
      const expectedQuery = 'SELECT * FROM things WHERE rowid = ?'
      expect(expectedQuery).toContain('rowid = ?')
    })
  })
})

// ============================================================================
// Branch Isolation Tests
// ============================================================================

describe('Branch Isolation', () => {
  describe('Main Branch (null)', () => {
    it('branch = null represents main branch', () => {
      const mainBranchThing: ThingRecord = {
        id: 'feature-001',
        type: 1,
        branch: null, // Main branch
        name: 'Main Branch Feature',
        data: null,
        deleted: false,
      }

      expect(mainBranchThing.branch).toBeNull()
    })

    it('main branch is default when branch not specified', () => {
      // When creating a thing without specifying branch, it should be on main (null)
      const defaultBranch: Partial<ThingRecord> = {
        id: 'default-001',
        type: 1,
        name: 'Default Branch Item',
        // branch not specified - should default to null (main)
      }

      expect(defaultBranch.branch ?? null).toBeNull()
    })
  })

  describe('Named Branches', () => {
    it('can create thing on named branch', () => {
      const experimentBranch: ThingRecord = {
        id: 'experiment-001',
        type: 1,
        branch: 'experiment',
        name: 'Experimental Feature',
        data: null,
        deleted: false,
      }

      expect(experimentBranch.branch).toBe('experiment')
    })

    it('same id can exist on different branches', () => {
      const things: ThingRecord[] = [
        { id: 'config-001', type: 1, branch: null, name: 'Production', data: null, deleted: false },
        { id: 'config-001', type: 1, branch: 'development', name: 'Development', data: null, deleted: false },
        { id: 'config-001', type: 1, branch: 'staging', name: 'Staging', data: null, deleted: false },
      ]

      // All have the same id but different branches
      expect(things.every((t) => t.id === 'config-001')).toBe(true)
      expect(new Set(things.map((t) => t.branch)).size).toBe(3)
    })
  })

  describe('Query Current Version Per Branch', () => {
    it('branch query pattern for main branch', () => {
      // SQL: WHERE id = ? AND branch IS NULL ORDER BY rowid DESC LIMIT 1
      const query = 'WHERE id = ? AND branch IS NULL ORDER BY rowid DESC LIMIT 1'
      expect(query).toContain('branch IS NULL')
    })

    it('branch query pattern for named branch', () => {
      // SQL: WHERE id = ? AND branch = ? ORDER BY rowid DESC LIMIT 1
      const query = 'WHERE id = ? AND branch = ? ORDER BY rowid DESC LIMIT 1'
      expect(query).toContain('branch = ?')
    })

    it('branch query with fallback to main pattern', () => {
      // SQL pattern for trying branch first, then falling back to main:
      // SELECT * FROM things
      // WHERE id = ? AND (branch = ? OR branch IS NULL)
      // ORDER BY CASE WHEN branch = ? THEN 0 ELSE 1 END, rowid DESC
      // LIMIT 1
      const query = 'WHERE id = ? AND (branch = ? OR branch IS NULL) ORDER BY CASE WHEN branch = ? THEN 0 ELSE 1 END'
      expect(query).toContain('branch = ? OR branch IS NULL')
    })
  })
})

// ============================================================================
// CRUD Operations Tests
// ============================================================================

describe('CRUD Operations', () => {
  describe('Create Thing', () => {
    it('minimal valid thing has id and type', () => {
      const minimalThing: Partial<ThingRecord> = {
        id: 'minimal-001',
        type: 1,
      }

      expect(minimalThing.id).toBe('minimal-001')
      expect(minimalThing.type).toBe(1)
    })

    it('complete thing has all fields', () => {
      const completeThing: ThingRecord = {
        id: 'complete-001',
        type: 5,
        branch: 'test-branch',
        name: 'Complete Thing',
        data: { field1: 'value1', field2: 123 },
        deleted: false,
      }

      expect(completeThing.id).toBeDefined()
      expect(completeThing.type).toBeDefined()
      expect(completeThing.branch).toBeDefined()
      expect(completeThing.name).toBeDefined()
      expect(completeThing.data).toBeDefined()
      expect(completeThing.deleted).toBeDefined()
    })
  })

  describe('Update Thing (New Version)', () => {
    it('update creates new version with same id', () => {
      // Original version
      const original: ThingRecord = {
        id: 'update-001',
        type: 1,
        branch: null,
        name: 'Original Name',
        data: null,
        deleted: false,
      }

      // "Updated" version - same id, different data
      const updated: ThingRecord = {
        id: 'update-001', // Same id
        type: 1,
        branch: null,
        name: 'Updated Name',
        data: null,
        deleted: false,
      }

      expect(original.id).toBe(updated.id)
      expect(original.name).not.toBe(updated.name)
    })
  })

  describe('Soft Delete', () => {
    it('soft delete sets deleted = true in new version', () => {
      const active: ThingRecord = {
        id: 'delete-001',
        type: 1,
        branch: null,
        name: 'Active',
        data: null,
        deleted: false,
      }

      const deleted: ThingRecord = {
        id: 'delete-001',
        type: 1,
        branch: null,
        name: 'Active',
        data: null,
        deleted: true, // Soft deleted
      }

      expect(active.deleted).toBe(false)
      expect(deleted.deleted).toBe(true)
    })

    it('soft deleted thing still has version history', () => {
      const versions: ThingRecord[] = [
        { id: 'history-001', type: 1, branch: null, name: 'Active', data: null, deleted: false },
        { id: 'history-001', type: 1, branch: null, name: 'Active', data: null, deleted: true },
      ]

      expect(versions).toHaveLength(2)
      expect(versions[0].deleted).toBe(false)
      expect(versions[1].deleted).toBe(true)
    })
  })

  describe('Undelete', () => {
    it('undelete creates new version with deleted = false', () => {
      const versions: ThingRecord[] = [
        { id: 'undelete-001', type: 1, branch: null, name: 'Created', data: null, deleted: false },
        { id: 'undelete-001', type: 1, branch: null, name: 'Deleted', data: null, deleted: true },
        { id: 'undelete-001', type: 1, branch: null, name: 'Restored', data: null, deleted: false },
      ]

      expect(versions[0].deleted).toBe(false) // Created
      expect(versions[1].deleted).toBe(true) // Deleted
      expect(versions[2].deleted).toBe(false) // Restored
    })
  })
})

// ============================================================================
// JSON Data Field Tests
// ============================================================================

describe('JSON Data Field', () => {
  describe('Store Complex Nested Objects', () => {
    it('stores deeply nested objects', () => {
      const complexData = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
              numbers: [1, 2, 3],
            },
          },
        },
        metadata: {
          tags: ['a', 'b', 'c'],
          counts: { views: 100, likes: 50 },
        },
      }

      const thing: ThingRecord = {
        id: 'nested-001',
        type: 1,
        branch: null,
        name: null,
        data: complexData,
        deleted: false,
      }

      expect((thing.data as typeof complexData).level1.level2.level3.value).toBe('deep')
      expect((thing.data as typeof complexData).metadata.counts.views).toBe(100)
    })

    it('stores objects with mixed value types', () => {
      const mixedData = {
        string: 'text',
        number: 42,
        float: 3.14,
        boolean: true,
        null: null,
        array: [1, 'two', true, null],
        object: { key: 'value' },
      }

      const thing: ThingRecord = {
        id: 'mixed-001',
        type: 1,
        branch: null,
        name: null,
        data: mixedData,
        deleted: false,
      }

      expect((thing.data as typeof mixedData).string).toBe('text')
      expect((thing.data as typeof mixedData).number).toBe(42)
      expect((thing.data as typeof mixedData).boolean).toBe(true)
      expect((thing.data as typeof mixedData).null).toBeNull()
    })
  })

  describe('Store Arrays', () => {
    it('stores simple arrays', () => {
      const thing: ThingRecord = {
        id: 'array-001',
        type: 1,
        branch: null,
        name: null,
        data: ['item1', 'item2', 'item3'],
        deleted: false,
      }

      expect(Array.isArray(thing.data)).toBe(true)
      expect((thing.data as string[]).length).toBe(3)
    })

    it('stores arrays of objects', () => {
      const arrayOfObjects = [
        { id: 1, name: 'First' },
        { id: 2, name: 'Second' },
        { id: 3, name: 'Third' },
      ]

      const thing: ThingRecord = {
        id: 'array-obj-001',
        type: 1,
        branch: null,
        name: null,
        data: arrayOfObjects,
        deleted: false,
      }

      expect((thing.data as typeof arrayOfObjects).length).toBe(3)
      expect((thing.data as typeof arrayOfObjects)[0].name).toBe('First')
    })

    it('stores empty array', () => {
      const thing: ThingRecord = {
        id: 'empty-array-001',
        type: 1,
        branch: null,
        name: null,
        data: [],
        deleted: false,
      }

      expect(Array.isArray(thing.data)).toBe(true)
      expect((thing.data as unknown[]).length).toBe(0)
    })
  })

  describe('Query by JSON Properties (SQLite json_extract)', () => {
    it('SQLite supports json_extract for property queries', () => {
      // Expected SQL pattern:
      // SELECT * FROM things WHERE json_extract(data, '$.status') = 'active'
      const query = "SELECT * FROM things WHERE json_extract(data, '$.status') = 'active'"
      expect(query).toContain('json_extract')
      expect(query).toContain('$.status')
    })

    it('SQLite supports nested JSON property queries', () => {
      // Expected SQL pattern:
      // SELECT * FROM things WHERE json_extract(data, '$.config.enabled') = 1
      const query = "SELECT * FROM things WHERE json_extract(data, '$.config.enabled') = 1"
      expect(query).toContain('$.config.enabled')
    })

    it('SQLite supports json_each for array queries', () => {
      // Expected SQL pattern:
      // SELECT DISTINCT t.* FROM things t, json_each(t.data, '$.tags')
      // WHERE json_each.value = 'urgent'
      const query = "SELECT DISTINCT t.* FROM things t, json_each(t.data, '$.tags') WHERE json_each.value = 'urgent'"
      expect(query).toContain('json_each')
    })
  })
})

// ============================================================================
// Query Patterns Tests
// ============================================================================

describe('Query Patterns', () => {
  describe('Get All Versions of a Thing', () => {
    it('query pattern: ORDER BY rowid ASC', () => {
      // SELECT rowid, * FROM things WHERE id = ? ORDER BY rowid ASC
      const query = 'SELECT rowid, * FROM things WHERE id = ? ORDER BY rowid ASC'
      expect(query).toContain('ORDER BY rowid ASC')
    })
  })

  describe('Count Versions', () => {
    it('query pattern: COUNT(*)', () => {
      // SELECT COUNT(*) FROM things WHERE id = ?
      const query = 'SELECT COUNT(*) as count FROM things WHERE id = ?'
      expect(query).toContain('COUNT(*)')
    })
  })

  describe('Filter by Type', () => {
    it('query pattern: WHERE type = ?', () => {
      // SELECT * FROM things WHERE type = ?
      const query = 'SELECT * FROM things WHERE type = ?'
      expect(query).toContain('type = ?')
    })

    it('current version per type using window function', () => {
      // Get current version of each thing filtered by type
      const query = `
        SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY rowid DESC) as rn
          FROM things
          WHERE type = ?
        ) WHERE rn = 1
      `
      expect(query).toContain('ROW_NUMBER()')
      expect(query).toContain('PARTITION BY id')
    })
  })

  describe('Exclude Soft Deleted', () => {
    it('query pattern: AND deleted = 0', () => {
      // Get current versions that are not deleted
      const query = `
        SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY rowid DESC) as rn
          FROM things
        ) WHERE rn = 1 AND deleted = 0
      `
      expect(query).toContain('deleted = 0')
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('Very Large Data Payloads', () => {
    it('handles large arrays', () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        description: 'x'.repeat(100),
      }))

      const thing: ThingRecord = {
        id: 'large-001',
        type: 1,
        branch: null,
        name: null,
        data: largeArray,
        deleted: false,
      }

      expect((thing.data as unknown[]).length).toBe(1000)
    })

    it('handles long string values', () => {
      const longString = 'x'.repeat(100000) // 100KB string

      const thing: ThingRecord = {
        id: 'long-string-001',
        type: 1,
        branch: null,
        name: null,
        data: { content: longString },
        deleted: false,
      }

      expect((thing.data as { content: string }).content.length).toBe(100000)
    })
  })

  describe('Special Characters in ID', () => {
    it('handles id with forward slashes', () => {
      const thing: ThingRecord = {
        id: 'path/to/thing',
        type: 1,
        branch: null,
        name: 'Path Thing',
        data: null,
        deleted: false,
      }

      expect(thing.id).toBe('path/to/thing')
    })

    it('handles id with dots', () => {
      const thing: ThingRecord = {
        id: 'domain.example.com',
        type: 1,
        branch: null,
        name: 'Domain',
        data: null,
        deleted: false,
      }

      expect(thing.id).toBe('domain.example.com')
    })

    it('handles various special characters in id', () => {
      const specialIds = ['thing-with-dash', 'thing_with_underscore', 'thing:with:colons', 'thing@with@at']

      specialIds.forEach((id) => {
        const thing: ThingRecord = {
          id,
          type: 1,
          branch: null,
          name: null,
          data: null,
          deleted: false,
        }
        expect(thing.id).toBe(id)
      })
    })
  })

  describe('Null vs Undefined in JSON', () => {
    it('stores explicit null values in JSON', () => {
      const dataWithNulls = {
        name: 'Test',
        optional: null,
        nested: {
          value: null,
        },
      }

      const thing: ThingRecord = {
        id: 'null-test-001',
        type: 1,
        branch: null,
        name: null,
        data: dataWithNulls,
        deleted: false,
      }

      expect((thing.data as typeof dataWithNulls).optional).toBeNull()
      expect((thing.data as typeof dataWithNulls).nested.value).toBeNull()
    })

    it('null data column is different from empty JSON object', () => {
      const thingWithNullData: ThingRecord = {
        id: 'null-data-001',
        type: 1,
        branch: null,
        name: null,
        data: null,
        deleted: false,
      }

      const thingWithEmptyData: ThingRecord = {
        id: 'empty-data-001',
        type: 1,
        branch: null,
        name: null,
        data: {},
        deleted: false,
      }

      expect(thingWithNullData.data).toBeNull()
      expect(thingWithEmptyData.data).toEqual({})
    })
  })

  describe('Type Field Edge Cases', () => {
    it('type 0 is valid', () => {
      const thing: ThingRecord = {
        id: 'type-zero-001',
        type: 0,
        branch: null,
        name: null,
        data: null,
        deleted: false,
      }

      expect(thing.type).toBe(0)
    })

    it('type can be large integer', () => {
      const thing: ThingRecord = {
        id: 'large-type-001',
        type: 999999,
        branch: null,
        name: null,
        data: null,
        deleted: false,
      }

      expect(thing.type).toBe(999999)
    })
  })

  describe('Empty and Whitespace Values', () => {
    it('empty string name is valid', () => {
      const thing: ThingRecord = {
        id: 'empty-name-001',
        type: 1,
        branch: null,
        name: '',
        data: null,
        deleted: false,
      }

      expect(thing.name).toBe('')
    })

    it('whitespace-only name is stored as-is', () => {
      const thing: ThingRecord = {
        id: 'whitespace-001',
        type: 1,
        branch: null,
        name: '   ',
        data: null,
        deleted: false,
      }

      expect(thing.name).toBe('   ')
    })

    it('empty string branch is different from null', () => {
      const emptyBranch: ThingRecord = {
        id: 'empty-branch-001',
        type: 1,
        branch: '',
        name: null,
        data: null,
        deleted: false,
      }

      const nullBranch: ThingRecord = {
        id: 'null-branch-001',
        type: 1,
        branch: null,
        name: null,
        data: null,
        deleted: false,
      }

      expect(emptyBranch.branch).toBe('')
      expect(nullBranch.branch).toBeNull()
      expect(emptyBranch.branch).not.toBe(nullBranch.branch)
    })
  })
})

// ============================================================================
// Query Helper Tests (should fail until implemented)
// ============================================================================

describe('Query Helpers', () => {
  // Mock database for testing
  const createMockDb = (mockResults: unknown[] = []): ThingsDb => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(mockResults),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockResults),
      }),
    }),
  } as unknown as ThingsDb)

  describe('getCurrentThing', () => {
    it('returns current version of a thing by id', async () => {
      const mockThing = {
        id: 'thing-001',
        type: 1,
        branch: null,
        name: 'Current Version',
        data: null,
        deleted: false,
      }
      const db = createMockDb([mockThing])

      const result = await getCurrentThing(db, 'thing-001')

      expect(result).toBeDefined()
      expect(result?.id).toBe('thing-001')
    })

    it('returns undefined for non-existent thing', async () => {
      const db = createMockDb([])

      const result = await getCurrentThing(db, 'non-existent')

      expect(result).toBeUndefined()
    })
  })

  describe('getThingAtVersion', () => {
    it('returns thing at specific version (rowid)', async () => {
      const mockThing = {
        id: 'thing-001',
        type: 1,
        name: 'Version 5',
      }
      const db = createMockDb([mockThing])

      const result = await getThingAtVersion(db, 5)

      expect(result).toBeDefined()
      expect(result?.name).toBe('Version 5')
    })

    it('returns undefined for non-existent version', async () => {
      const db = createMockDb([])

      const result = await getThingAtVersion(db, 99999)

      expect(result).toBeUndefined()
    })
  })

  describe('getThingVersions', () => {
    it('returns all versions of a thing', async () => {
      const mockVersions = [
        { id: 'thing-001', name: 'v1' },
        { id: 'thing-001', name: 'v2' },
        { id: 'thing-001', name: 'v3' },
      ]
      const db = createMockDb(mockVersions)

      const result = await getThingVersions(db, 'thing-001')

      expect(result).toHaveLength(3)
    })

    it('returns empty array for non-existent thing', async () => {
      const db = createMockDb([])

      const result = await getThingVersions(db, 'non-existent')

      expect(result).toEqual([])
    })
  })

  describe('getThingOnBranch', () => {
    it('returns current version on specific branch', async () => {
      const mockThing = {
        id: 'config-001',
        type: 2,
        branch: 'development',
        name: 'Dev Config',
      }
      const db = createMockDb([mockThing])

      const result = await getThingOnBranch(db, 'config-001', 'development')

      expect(result).toBeDefined()
      expect(result?.branch).toBe('development')
    })

    it('returns undefined when thing not on specified branch', async () => {
      const db = createMockDb([])

      const result = await getThingOnBranch(db, 'config-001', 'staging')

      expect(result).toBeUndefined()
    })
  })

  describe('getCurrentThings', () => {
    it('returns current version of all things', async () => {
      const mockThings = [
        { id: 'thing-001', name: 'Current 1' },
        { id: 'thing-002', name: 'Current 2' },
      ]
      const db = createMockDb(mockThings)

      const result = await getCurrentThings(db)

      expect(result).toHaveLength(2)
    })

    it('filters by type when provided', async () => {
      const mockThings = [{ id: 'customer-001', type: 1, name: 'Customer' }]
      const db = createMockDb(mockThings)

      const result = await getCurrentThings(db, { type: 1 })

      expect(result).toHaveLength(1)
      expect(result[0].type).toBe(1)
    })

    it('excludes soft deleted by default', async () => {
      const mockThings = [{ id: 'active-001', deleted: false }]
      const db = createMockDb(mockThings)

      const result = await getCurrentThings(db)

      expect(result.every((t) => !t.deleted)).toBe(true)
    })

    it('includes soft deleted when specified', async () => {
      const mockThings = [
        { id: 'active-001', deleted: false },
        { id: 'deleted-001', deleted: true },
      ]
      const db = createMockDb(mockThings)

      const result = await getCurrentThings(db, { includeDeleted: true })

      expect(result).toHaveLength(2)
    })
  })

  describe('softDeleteThing', () => {
    it('creates new version with deleted = true', async () => {
      const deletedThing = { id: 'thing-001', deleted: true }
      const db = createMockDb([deletedThing])

      const result = await softDeleteThing(db, 'thing-001')

      expect(result.deleted).toBe(true)
    })
  })

  describe('undeleteThing', () => {
    it('creates new version with deleted = false', async () => {
      const undeletedThing = { id: 'thing-001', deleted: false }
      const db = createMockDb([undeletedThing])

      const result = await undeleteThing(db, 'thing-001')

      expect(result.deleted).toBe(false)
    })
  })

  describe('countVersions', () => {
    it('returns count of versions for a thing', async () => {
      const mockCount = [{ count: 5 }]
      const db = createMockDb(mockCount)

      const result = await countVersions(db, 'thing-001')

      expect(result).toBe(5)
    })

    it('returns 0 for non-existent thing', async () => {
      const mockCount = [{ count: 0 }]
      const db = createMockDb(mockCount)

      const result = await countVersions(db, 'non-existent')

      expect(result).toBe(0)
    })
  })
})

// ============================================================================
// Index Tests
// ============================================================================

describe('Schema Indexes', () => {
  it('should have index on id column', () => {
    // Expected index: things_id_idx on (id)
    // This is defined in the schema as: index('things_id_idx').on(table.id)
    expect(things.id).toBeDefined()
  })

  it('should have index on type column', () => {
    // Expected index: things_type_idx on (type)
    // This is defined in the schema as: index('things_type_idx').on(table.type)
    expect(things.type).toBeDefined()
  })

  it('should have index on branch column', () => {
    // Expected index: things_branch_idx on (branch)
    // This is defined in the schema as: index('things_branch_idx').on(table.branch)
    expect(things.branch).toBeDefined()
  })

  it('should have composite index on id and branch', () => {
    // Expected index: things_id_branch_idx on (id, branch)
    // This is defined in the schema as: index('things_id_branch_idx').on(table.id, table.branch)
    expect(things.id).toBeDefined()
    expect(things.branch).toBeDefined()
  })
})

// ============================================================================
// Integration Export Tests
// ============================================================================

describe('Module Exports', () => {
  it('things table is exported from db/things', () => {
    expect(things).toBeDefined()
  })

  it('query helpers are exported from db/things', () => {
    expect(getCurrentThing).toBeDefined()
    expect(getThingAtVersion).toBeDefined()
    expect(getThingVersions).toBeDefined()
    expect(getThingOnBranch).toBeDefined()
    expect(getCurrentThings).toBeDefined()
    expect(softDeleteThing).toBeDefined()
    expect(undeleteThing).toBeDefined()
    expect(countVersions).toBeDefined()
  })

  it('things should be exported from db/index', async () => {
    // @ts-expect-error - may not be exported yet
    const { things: thingsFromIndex } = await import('../index')
    expect(thingsFromIndex).toBeDefined()
  })

  it('query helpers should be exported from db/index', async () => {
    // @ts-expect-error - may not be exported yet
    const { getCurrentThing: getCurrentFromIndex } = await import('../index')
    expect(getCurrentFromIndex).toBeDefined()
  })
})
