/**
 * ConflictDetector Tests
 *
 * TDD test suite for conflict detection in bidirectional sync scenarios.
 *
 * The ConflictDetector identifies when records have been modified in both
 * source and destination systems since the last sync, enabling intelligent
 * conflict resolution strategies.
 *
 * Test Coverage:
 * - [x] ConflictDetector identifies records modified in both systems
 * - [x] ConflictDetector identifies field-level conflicts
 * - [x] ConflictDetector ignores non-conflicting concurrent changes
 * - [x] ConflictDetector handles deletion conflicts (modified vs deleted)
 * - [x] ConflictDetector tracks modification timestamps accurately
 *
 * @module db/primitives/sync/tests/conflict-detector.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ConflictDetector,
  type Conflict,
  type DiffResult,
  type DiffRecord,
  type ConflictResolutionStrategy,
} from '../conflict-detector'

// =============================================================================
// TEST HELPERS
// =============================================================================

function createRecord(
  id: string,
  data: Record<string, unknown>,
  modifiedAt: Date
): DiffRecord {
  return {
    key: id,
    data,
    modifiedAt,
  }
}

function createDiffResult(
  added: DiffRecord[] = [],
  modified: DiffRecord[] = [],
  deleted: string[] = []
): DiffResult {
  return { added, modified, deleted }
}

// =============================================================================
// CONFLICT DETECTOR TESTS
// =============================================================================

describe('ConflictDetector', () => {
  let detector: ConflictDetector

  beforeEach(() => {
    detector = new ConflictDetector()
  })

  describe('detect', () => {
    it('identifies records modified in both systems', () => {
      const now = new Date()
      const hourAgo = new Date(now.getTime() - 3600000)

      // Same record modified in both source and destination
      const sourceChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Alice Updated', email: 'alice@example.com' }, now)],
        []
      )

      const destChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Alice Changed', email: 'alice@new.com' }, hourAgo)],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].key).toBe('user-1')
      expect(conflicts[0].sourceRecord?.data.name).toBe('Alice Updated')
      expect(conflicts[0].destinationRecord?.data.name).toBe('Alice Changed')
    })

    it('identifies field-level conflicts', () => {
      const now = new Date()
      const hourAgo = new Date(now.getTime() - 3600000)

      // Same record but different fields modified
      const sourceChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Alice', email: 'new-email@example.com', phone: '123' }, now)],
        []
      )

      const destChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Alice Updated', email: 'alice@example.com', phone: '456' }, hourAgo)],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].conflictingFields).toContain('name')
      expect(conflicts[0].conflictingFields).toContain('email')
      expect(conflicts[0].conflictingFields).toContain('phone')
    })

    it('ignores non-conflicting concurrent changes', () => {
      const now = new Date()
      const hourAgo = new Date(now.getTime() - 3600000)

      // Different records modified in each system - no conflict
      const sourceChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Alice' }, now)],
        []
      )

      const destChanges = createDiffResult(
        [],
        [createRecord('user-2', { name: 'Bob' }, hourAgo)],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(0)
    })

    it('handles added records without conflicts when different keys', () => {
      const now = new Date()

      // Different records added to each system - no conflict
      const sourceChanges = createDiffResult(
        [createRecord('user-1', { name: 'Alice' }, now)],
        [],
        []
      )

      const destChanges = createDiffResult(
        [createRecord('user-2', { name: 'Bob' }, now)],
        [],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(0)
    })

    it('detects add-add conflict when same key added to both systems', () => {
      const now = new Date()
      const hourAgo = new Date(now.getTime() - 3600000)

      // Same key added to both systems
      const sourceChanges = createDiffResult(
        [createRecord('user-1', { name: 'Alice Source' }, now)],
        [],
        []
      )

      const destChanges = createDiffResult(
        [createRecord('user-1', { name: 'Alice Dest' }, hourAgo)],
        [],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].key).toBe('user-1')
      expect(conflicts[0].sourceRecord?.data.name).toBe('Alice Source')
      expect(conflicts[0].destinationRecord?.data.name).toBe('Alice Dest')
    })

    it('handles deletion conflicts - modified vs deleted', () => {
      const now = new Date()

      // Record modified in source but deleted in destination
      const sourceChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Alice Updated' }, now)],
        []
      )

      const destChanges = createDiffResult(
        [],
        [],
        ['user-1']
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].key).toBe('user-1')
      expect(conflicts[0].sourceRecord).toBeDefined()
      expect(conflicts[0].destinationRecord).toBeNull()
      expect(conflicts[0].conflictingFields).toContain('__deleted__')
    })

    it('handles deletion conflicts - deleted vs modified', () => {
      const now = new Date()

      // Record deleted in source but modified in destination
      const sourceChanges = createDiffResult(
        [],
        [],
        ['user-1']
      )

      const destChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Alice Updated' }, now)],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].key).toBe('user-1')
      expect(conflicts[0].sourceRecord).toBeNull()
      expect(conflicts[0].destinationRecord).toBeDefined()
      expect(conflicts[0].conflictingFields).toContain('__deleted__')
    })

    it('handles delete-delete as non-conflict (both agree)', () => {
      // Record deleted in both systems - no conflict, they agree
      const sourceChanges = createDiffResult(
        [],
        [],
        ['user-1']
      )

      const destChanges = createDiffResult(
        [],
        [],
        ['user-1']
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(0)
    })

    it('tracks modification timestamps accurately', () => {
      const sourceTime = new Date('2026-01-13T10:00:00Z')
      const destTime = new Date('2026-01-13T09:00:00Z')

      const sourceChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Alice' }, sourceTime)],
        []
      )

      const destChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Bob' }, destTime)],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].sourceModifiedAt).toEqual(sourceTime)
      expect(conflicts[0].destinationModifiedAt).toEqual(destTime)
    })

    it('handles complex scenario with mixed operations', () => {
      const now = new Date()
      const hourAgo = new Date(now.getTime() - 3600000)

      // Complex scenario:
      // - user-1: modified in both (conflict)
      // - user-2: modified only in source (no conflict)
      // - user-3: modified only in dest (no conflict)
      // - user-4: deleted in source, modified in dest (conflict)
      // - user-5: added in both (conflict)

      const sourceChanges = createDiffResult(
        [createRecord('user-5', { name: 'New User Source' }, now)],
        [
          createRecord('user-1', { name: 'Alice Source' }, now),
          createRecord('user-2', { name: 'Bob Source' }, now),
        ],
        ['user-4']
      )

      const destChanges = createDiffResult(
        [createRecord('user-5', { name: 'New User Dest' }, hourAgo)],
        [
          createRecord('user-1', { name: 'Alice Dest' }, hourAgo),
          createRecord('user-3', { name: 'Charlie Dest' }, hourAgo),
          createRecord('user-4', { name: 'Dave Dest' }, hourAgo),
        ],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      // Should have 3 conflicts: user-1, user-4, user-5
      expect(conflicts).toHaveLength(3)

      const conflictKeys = conflicts.map(c => c.key).sort()
      expect(conflictKeys).toEqual(['user-1', 'user-4', 'user-5'])
    })

    it('handles empty diff results', () => {
      const sourceChanges = createDiffResult()
      const destChanges = createDiffResult()

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(0)
    })

    it('detects identical changes as non-conflicting', () => {
      const now = new Date()

      // Same exact change in both systems - not a conflict
      const sourceChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Alice', email: 'alice@example.com' }, now)],
        []
      )

      const destChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Alice', email: 'alice@example.com' }, now)],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      // If the data is identical, there's no actual conflict
      expect(conflicts).toHaveLength(0)
    })
  })

  describe('detectFieldConflicts', () => {
    it('returns empty array when records are identical', () => {
      const record1 = { name: 'Alice', email: 'alice@example.com' }
      const record2 = { name: 'Alice', email: 'alice@example.com' }

      const fields = detector.detectFieldConflicts(record1, record2)

      expect(fields).toHaveLength(0)
    })

    it('identifies differing string fields', () => {
      const record1 = { name: 'Alice', email: 'alice@example.com' }
      const record2 = { name: 'Bob', email: 'alice@example.com' }

      const fields = detector.detectFieldConflicts(record1, record2)

      expect(fields).toEqual(['name'])
    })

    it('identifies differing number fields', () => {
      const record1 = { count: 10, name: 'Same' }
      const record2 = { count: 20, name: 'Same' }

      const fields = detector.detectFieldConflicts(record1, record2)

      expect(fields).toEqual(['count'])
    })

    it('identifies differing boolean fields', () => {
      const record1 = { active: true, name: 'Same' }
      const record2 = { active: false, name: 'Same' }

      const fields = detector.detectFieldConflicts(record1, record2)

      expect(fields).toEqual(['active'])
    })

    it('identifies differing nested object fields', () => {
      const record1 = { address: { city: 'NYC', zip: '10001' } }
      const record2 = { address: { city: 'LA', zip: '10001' } }

      const fields = detector.detectFieldConflicts(record1, record2)

      expect(fields).toContain('address')
    })

    it('identifies differing array fields', () => {
      const record1 = { tags: ['a', 'b', 'c'] }
      const record2 = { tags: ['a', 'b', 'd'] }

      const fields = detector.detectFieldConflicts(record1, record2)

      expect(fields).toContain('tags')
    })

    it('identifies fields present in only one record', () => {
      const record1 = { name: 'Alice', age: 30 }
      const record2 = { name: 'Alice' }

      const fields = detector.detectFieldConflicts(record1, record2)

      expect(fields).toContain('age')
    })

    it('handles null values correctly', () => {
      const record1 = { name: null }
      const record2 = { name: 'Alice' }

      const fields = detector.detectFieldConflicts(record1, record2)

      expect(fields).toContain('name')
    })

    it('handles undefined values correctly', () => {
      const record1 = { name: undefined }
      const record2 = { name: 'Alice' }

      const fields = detector.detectFieldConflicts(record1, record2)

      expect(fields).toContain('name')
    })
  })

  describe('with resolution strategy', () => {
    it('applies source-wins strategy', () => {
      const now = new Date()
      const hourAgo = new Date(now.getTime() - 3600000)

      detector = new ConflictDetector({ defaultStrategy: 'source-wins' })

      const sourceChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Source Value' }, now)],
        []
      )

      const destChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Dest Value' }, hourAgo)],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].suggestedResolution).toBe('source-wins')
    })

    it('applies destination-wins strategy', () => {
      const now = new Date()
      const hourAgo = new Date(now.getTime() - 3600000)

      detector = new ConflictDetector({ defaultStrategy: 'destination-wins' })

      const sourceChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Source Value' }, now)],
        []
      )

      const destChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Dest Value' }, hourAgo)],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].suggestedResolution).toBe('destination-wins')
    })

    it('applies last-write-wins strategy based on timestamps', () => {
      const older = new Date('2026-01-13T08:00:00Z')
      const newer = new Date('2026-01-13T10:00:00Z')

      detector = new ConflictDetector({ defaultStrategy: 'last-write-wins' })

      const sourceChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Source Value' }, older)],
        []
      )

      const destChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Dest Value' }, newer)],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(1)
      // Destination was modified more recently, so it should win
      expect(conflicts[0].suggestedResolution).toBe('destination-wins')
    })

    it('applies first-write-wins strategy based on timestamps', () => {
      const older = new Date('2026-01-13T08:00:00Z')
      const newer = new Date('2026-01-13T10:00:00Z')

      detector = new ConflictDetector({ defaultStrategy: 'first-write-wins' })

      const sourceChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Source Value' }, older)],
        []
      )

      const destChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Dest Value' }, newer)],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(1)
      // Source was modified first, so it should win
      expect(conflicts[0].suggestedResolution).toBe('source-wins')
    })

    it('applies manual strategy requiring human intervention', () => {
      const now = new Date()

      detector = new ConflictDetector({ defaultStrategy: 'manual' })

      const sourceChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Source Value' }, now)],
        []
      )

      const destChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Dest Value' }, now)],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].suggestedResolution).toBe('manual')
    })
  })

  describe('with custom field comparator', () => {
    it('allows custom comparison logic', () => {
      const now = new Date()

      // Custom comparator that considers updatedAt field changes as non-conflicting
      const customComparator = (field: string, value1: unknown, value2: unknown): boolean => {
        if (field === 'updatedAt') {
          return true // Always consider updatedAt as "same"
        }
        return JSON.stringify(value1) === JSON.stringify(value2)
      }

      detector = new ConflictDetector({ fieldComparator: customComparator })

      const sourceChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Alice', updatedAt: '2026-01-13T10:00:00Z' }, now)],
        []
      )

      const destChanges = createDiffResult(
        [],
        [createRecord('user-1', { name: 'Alice', updatedAt: '2026-01-13T08:00:00Z' }, now)],
        []
      )

      const conflicts = detector.detect(sourceChanges, destChanges)

      // Should have no conflicts because name is the same and updatedAt is ignored
      expect(conflicts).toHaveLength(0)
    })
  })
})
