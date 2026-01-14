/**
 * ConflictResolver Tests (RED TDD)
 *
 * Tests for conflict resolution strategies in multi-master replication.
 * When concurrent writes occur to the same entity across different nodes,
 * ConflictResolver decides how to resolve the conflict.
 *
 * Strategies:
 * 1. LastWriteWins (LWW) - Highest timestamp wins
 * 2. VersionVector - Use vector clocks for causality tracking
 * 3. FieldMerge - Merge non-conflicting fields
 * 4. CRDTMerge - Use CRDT semantics (counters, sets, registers)
 * 5. Custom - User-provided resolver function
 *
 * These tests should FAIL initially as ConflictResolver does not exist yet.
 *
 * Expected interface:
 * ```typescript
 * class ConflictResolver<T = unknown> {
 *   constructor(strategy: ConflictStrategy)
 *   resolve(local: ConflictEntry<T>, remote: ConflictEntry<T>): ResolvedEntry<T>
 *   resolveMultiple(entries: ConflictEntry<T>[]): ResolvedEntry<T>
 * }
 *
 * interface ConflictEntry<T> {
 *   value: T
 *   timestamp: number
 *   nodeId: string
 *   vectorClock?: VectorClock
 *   version?: number
 * }
 *
 * interface ResolvedEntry<T> {
 *   value: T
 *   timestamp: number
 *   nodeId: string
 *   vectorClock?: VectorClock
 *   resolution: 'local' | 'remote' | 'merged' | 'custom'
 *   conflicts?: ConflictEntry<T>[]
 * }
 * ```
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// IMPORTS (These will fail until implementation exists)
// ============================================================================

import {
  ConflictResolver,
  type ConflictEntry,
  type ResolvedEntry,
  type VectorClock,
  type ConflictStrategy,
  // LWW strategy
  LastWriteWinsStrategy,
  // Vector clock strategy
  VersionVectorStrategy,
  // Field merge strategy
  FieldMergeStrategy,
  // CRDT types
  GCounter,
  PNCounter,
  GSet,
  LWWRegister,
  CRDTMergeStrategy,
  // Custom resolver
  CustomResolverStrategy,
} from '../../db/primitives/conflict-resolver'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

interface User {
  id: string
  name: string
  email: string
  age?: number
  settings?: {
    theme: string
    notifications: boolean
  }
}

interface Document {
  id: string
  title: string
  content: string
  version: number
  lastModifiedBy: string
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createEntry<T>(
  value: T,
  options: {
    timestamp?: number
    nodeId?: string
    vectorClock?: VectorClock
    version?: number
  } = {}
): ConflictEntry<T> {
  return {
    value,
    // Use 'in' check to distinguish between missing key and explicit undefined
    timestamp: 'timestamp' in options ? options.timestamp as number : Date.now(),
    nodeId: options.nodeId ?? 'node-1',
    vectorClock: options.vectorClock,
    version: options.version,
  }
}

function createVectorClock(entries: Record<string, number>): VectorClock {
  return { entries }
}

// ============================================================================
// TESTS: LAST WRITE WINS (LWW) STRATEGY
// ============================================================================

describe('ConflictResolver', () => {
  describe('LastWriteWins Strategy', () => {
    let resolver: ConflictResolver<User>

    beforeEach(() => {
      resolver = new ConflictResolver(new LastWriteWinsStrategy())
    })

    describe('basic timestamp comparison', () => {
      it('selects entry with higher timestamp', () => {
        const local = createEntry<User>(
          { id: '1', name: 'Alice', email: 'alice@example.com' },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Alice Updated', email: 'alice@example.com' },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.name).toBe('Alice Updated')
        expect(result.resolution).toBe('remote')
        expect(result.timestamp).toBe(2000)
      })

      it('selects local when local timestamp is higher', () => {
        const local = createEntry<User>(
          { id: '1', name: 'Local Alice', email: 'alice@example.com' },
          { timestamp: 3000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Remote Alice', email: 'alice@example.com' },
          { timestamp: 1000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.name).toBe('Local Alice')
        expect(result.resolution).toBe('local')
      })

      it('handles timestamps with millisecond precision', () => {
        const local = createEntry<User>(
          { id: '1', name: 'Alice', email: 'alice@example.com' },
          { timestamp: 1705123456789, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Alice Updated', email: 'alice@example.com' },
          { timestamp: 1705123456790, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.name).toBe('Alice Updated')
        expect(result.timestamp).toBe(1705123456790)
      })
    })

    describe('tiebreaker with same timestamp', () => {
      it('uses node ID as tiebreaker when timestamps are equal', () => {
        const local = createEntry<User>(
          { id: '1', name: 'Alice from A', email: 'alice@example.com' },
          { timestamp: 1000, nodeId: 'node-a' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Alice from B', email: 'alice@example.com' },
          { timestamp: 1000, nodeId: 'node-b' }
        )

        const result = resolver.resolve(local, remote)

        // Higher node ID wins (alphabetically greater = "node-b" > "node-a")
        expect(result.value.name).toBe('Alice from B')
        expect(result.nodeId).toBe('node-b')
      })

      it('handles numeric node IDs in tiebreaker', () => {
        const local = createEntry<User>(
          { id: '1', name: 'From Node 1', email: 'a@b.com' },
          { timestamp: 1000, nodeId: '1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'From Node 2', email: 'a@b.com' },
          { timestamp: 1000, nodeId: '2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.name).toBe('From Node 2')
      })

      it('handles UUID node IDs in tiebreaker', () => {
        const local = createEntry<User>(
          { id: '1', name: 'From UUID A', email: 'a@b.com' },
          { timestamp: 1000, nodeId: '550e8400-e29b-41d4-a716-446655440000' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'From UUID B', email: 'a@b.com' },
          { timestamp: 1000, nodeId: 'a50e8400-e29b-41d4-a716-446655440000' }
        )

        const result = resolver.resolve(local, remote)

        // Lexicographically greater UUID wins
        expect(result.nodeId).toBe('a50e8400-e29b-41d4-a716-446655440000')
      })
    })

    describe('edge cases', () => {
      it('handles missing timestamps (defaults to 0)', () => {
        const local = createEntry<User>(
          { id: '1', name: 'Alice', email: 'a@b.com' },
          { timestamp: undefined as unknown as number, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Bob', email: 'a@b.com' },
          { timestamp: 1000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.name).toBe('Bob')
        expect(result.resolution).toBe('remote')
      })

      it('handles null values in entries', () => {
        const local = createEntry<User | null>(null, { timestamp: 1000, nodeId: 'node-1' })
        const remote = createEntry<User | null>(
          { id: '1', name: 'Alice', email: 'a@b.com' },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const nullResolver = new ConflictResolver<User | null>(new LastWriteWinsStrategy())
        const result = nullResolver.resolve(local, remote)

        expect(result.value).not.toBeNull()
        expect(result.value?.name).toBe('Alice')
      })

      it('handles zero timestamps', () => {
        const local = createEntry<User>(
          { id: '1', name: 'Zero', email: 'a@b.com' },
          { timestamp: 0, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'One', email: 'a@b.com' },
          { timestamp: 1, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.name).toBe('One')
      })

      it('handles negative timestamps (invalid but graceful)', () => {
        const local = createEntry<User>(
          { id: '1', name: 'Negative', email: 'a@b.com' },
          { timestamp: -1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Positive', email: 'a@b.com' },
          { timestamp: 1000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.name).toBe('Positive')
      })

      it('handles very large timestamps (far future)', () => {
        const local = createEntry<User>(
          { id: '1', name: 'Present', email: 'a@b.com' },
          { timestamp: Date.now(), nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Future', email: 'a@b.com' },
          { timestamp: Number.MAX_SAFE_INTEGER, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.name).toBe('Future')
      })
    })

    describe('resolveMultiple', () => {
      it('resolves multiple conflicting entries', () => {
        const entries: ConflictEntry<User>[] = [
          createEntry({ id: '1', name: 'First', email: 'a@b.com' }, { timestamp: 1000, nodeId: 'node-1' }),
          createEntry({ id: '1', name: 'Second', email: 'a@b.com' }, { timestamp: 3000, nodeId: 'node-2' }),
          createEntry({ id: '1', name: 'Third', email: 'a@b.com' }, { timestamp: 2000, nodeId: 'node-3' }),
        ]

        const result = resolver.resolveMultiple(entries)

        expect(result.value.name).toBe('Second')
        expect(result.timestamp).toBe(3000)
      })

      it('returns single entry when only one provided', () => {
        const entries: ConflictEntry<User>[] = [
          createEntry({ id: '1', name: 'Only', email: 'a@b.com' }, { timestamp: 1000, nodeId: 'node-1' }),
        ]

        const result = resolver.resolveMultiple(entries)

        expect(result.value.name).toBe('Only')
      })

      it('throws on empty entries array', () => {
        expect(() => resolver.resolveMultiple([])).toThrow()
      })
    })
  })

  // ==========================================================================
  // TESTS: VERSION VECTOR STRATEGY
  // ==========================================================================

  describe('VersionVector Strategy', () => {
    let resolver: ConflictResolver<Document>

    beforeEach(() => {
      resolver = new ConflictResolver(new VersionVectorStrategy())
    })

    describe('sequential modifications (one dominates)', () => {
      it('selects entry with dominating vector clock', () => {
        const local = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'Local', version: 1, lastModifiedBy: 'alice' },
          {
            timestamp: 1000,
            nodeId: 'node-1',
            vectorClock: createVectorClock({ 'node-1': 1, 'node-2': 0 }),
          }
        )
        const remote = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'Remote', version: 2, lastModifiedBy: 'bob' },
          {
            timestamp: 2000,
            nodeId: 'node-2',
            vectorClock: createVectorClock({ 'node-1': 1, 'node-2': 1 }),
          }
        )

        const result = resolver.resolve(local, remote)

        // Remote's VC dominates (has all of local's + more)
        expect(result.value.content).toBe('Remote')
        expect(result.resolution).toBe('remote')
      })

      it('selects local when local vector clock dominates', () => {
        const local = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'Local Updated', version: 3, lastModifiedBy: 'alice' },
          {
            timestamp: 3000,
            nodeId: 'node-1',
            vectorClock: createVectorClock({ 'node-1': 3, 'node-2': 2 }),
          }
        )
        const remote = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'Remote', version: 2, lastModifiedBy: 'bob' },
          {
            timestamp: 2000,
            nodeId: 'node-2',
            vectorClock: createVectorClock({ 'node-1': 2, 'node-2': 2 }),
          }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.content).toBe('Local Updated')
        expect(result.resolution).toBe('local')
      })
    })

    describe('concurrent modifications (neither dominates)', () => {
      it('detects concurrent modifications', () => {
        const local = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'Concurrent A', version: 1, lastModifiedBy: 'alice' },
          {
            timestamp: 1000,
            nodeId: 'node-1',
            vectorClock: createVectorClock({ 'node-1': 1, 'node-2': 0 }),
          }
        )
        const remote = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'Concurrent B', version: 1, lastModifiedBy: 'bob' },
          {
            timestamp: 1000,
            nodeId: 'node-2',
            vectorClock: createVectorClock({ 'node-1': 0, 'node-2': 1 }),
          }
        )

        const result = resolver.resolve(local, remote)

        // Concurrent writes detected - conflicts array should be populated
        expect(result.conflicts).toBeDefined()
        expect(result.conflicts).toHaveLength(2)
        expect(result.resolution).toBe('merged')
      })

      it('falls back to LWW for concurrent modifications', () => {
        const local = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'Concurrent A', version: 1, lastModifiedBy: 'alice' },
          {
            timestamp: 1000,
            nodeId: 'node-1',
            vectorClock: createVectorClock({ 'node-1': 1, 'node-2': 0 }),
          }
        )
        const remote = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'Concurrent B', version: 1, lastModifiedBy: 'bob' },
          {
            timestamp: 2000,
            nodeId: 'node-2',
            vectorClock: createVectorClock({ 'node-1': 0, 'node-2': 1 }),
          }
        )

        const result = resolver.resolve(local, remote)

        // Falls back to LWW - higher timestamp wins
        expect(result.value.content).toBe('Concurrent B')
      })

      it('merges vector clocks after resolution', () => {
        const local = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'A', version: 1, lastModifiedBy: 'alice' },
          {
            timestamp: 1000,
            nodeId: 'node-1',
            vectorClock: createVectorClock({ 'node-1': 2, 'node-2': 1 }),
          }
        )
        const remote = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'B', version: 1, lastModifiedBy: 'bob' },
          {
            timestamp: 2000,
            nodeId: 'node-2',
            vectorClock: createVectorClock({ 'node-1': 1, 'node-2': 3 }),
          }
        )

        const result = resolver.resolve(local, remote)

        // Merged VC should have max of each component
        expect(result.vectorClock?.entries['node-1']).toBe(2)
        expect(result.vectorClock?.entries['node-2']).toBe(3)
      })
    })

    describe('partial ordering', () => {
      it('handles vector clocks with different node sets', () => {
        const local = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'A', version: 1, lastModifiedBy: 'alice' },
          {
            timestamp: 1000,
            nodeId: 'node-1',
            vectorClock: createVectorClock({ 'node-1': 1 }),
          }
        )
        const remote = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'B', version: 1, lastModifiedBy: 'bob' },
          {
            timestamp: 2000,
            nodeId: 'node-3',
            vectorClock: createVectorClock({ 'node-3': 1 }),
          }
        )

        const result = resolver.resolve(local, remote)

        // Different node sets = concurrent
        expect(result.conflicts).toBeDefined()
      })

      it('handles empty vector clocks', () => {
        const local = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'A', version: 1, lastModifiedBy: 'alice' },
          {
            timestamp: 1000,
            nodeId: 'node-1',
            vectorClock: createVectorClock({}),
          }
        )
        const remote = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'B', version: 1, lastModifiedBy: 'bob' },
          {
            timestamp: 2000,
            nodeId: 'node-2',
            vectorClock: createVectorClock({ 'node-2': 1 }),
          }
        )

        const result = resolver.resolve(local, remote)

        // Empty VC is dominated by any non-empty VC
        expect(result.value.content).toBe('B')
      })

      it('handles missing vector clocks gracefully', () => {
        const local = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'A', version: 1, lastModifiedBy: 'alice' },
          {
            timestamp: 1000,
            nodeId: 'node-1',
            // No vectorClock
          }
        )
        const remote = createEntry<Document>(
          { id: '1', title: 'Doc', content: 'B', version: 1, lastModifiedBy: 'bob' },
          {
            timestamp: 2000,
            nodeId: 'node-2',
            vectorClock: createVectorClock({ 'node-2': 1 }),
          }
        )

        const result = resolver.resolve(local, remote)

        // Should not throw, falls back to LWW
        expect(result.value.content).toBe('B')
      })
    })

    describe('complex causality chains', () => {
      it('handles three-node causality', () => {
        // node-1 writes, node-2 reads from node-1 and writes, node-3 reads from node-2 and writes
        const entries: ConflictEntry<Document>[] = [
          createEntry(
            { id: '1', title: 'Doc', content: 'v1', version: 1, lastModifiedBy: 'alice' },
            { timestamp: 1000, nodeId: 'node-1', vectorClock: createVectorClock({ 'node-1': 1 }) }
          ),
          createEntry(
            { id: '1', title: 'Doc', content: 'v2', version: 2, lastModifiedBy: 'bob' },
            { timestamp: 2000, nodeId: 'node-2', vectorClock: createVectorClock({ 'node-1': 1, 'node-2': 1 }) }
          ),
          createEntry(
            { id: '1', title: 'Doc', content: 'v3', version: 3, lastModifiedBy: 'charlie' },
            { timestamp: 3000, nodeId: 'node-3', vectorClock: createVectorClock({ 'node-1': 1, 'node-2': 1, 'node-3': 1 }) }
          ),
        ]

        const result = resolver.resolveMultiple(entries)

        expect(result.value.content).toBe('v3')
      })
    })
  })

  // ==========================================================================
  // TESTS: FIELD MERGE STRATEGY
  // ==========================================================================

  describe('FieldMerge Strategy', () => {
    let resolver: ConflictResolver<User>

    beforeEach(() => {
      resolver = new ConflictResolver(new FieldMergeStrategy())
    })

    describe('non-conflicting fields', () => {
      it('merges entries when different fields are modified', () => {
        const local = createEntry<User>(
          { id: '1', name: 'Alice', email: 'old@example.com' },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Alice', email: 'old@example.com', age: 30 },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.name).toBe('Alice')
        expect(result.value.age).toBe(30)
        expect(result.resolution).toBe('merged')
      })

      it('merges multiple non-conflicting field changes', () => {
        const base = { id: '1', name: 'Alice', email: 'alice@example.com' }
        const local = createEntry<User>(
          { ...base, age: 25 },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { ...base, settings: { theme: 'dark', notifications: true } },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.age).toBe(25)
        expect(result.value.settings?.theme).toBe('dark')
      })
    })

    describe('conflicting fields', () => {
      it('falls back to LWW for same field conflicts', () => {
        const local = createEntry<User>(
          { id: '1', name: 'Alice Local', email: 'alice@example.com' },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Alice Remote', email: 'alice@example.com' },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        // LWW fallback for conflicting 'name' field
        expect(result.value.name).toBe('Alice Remote')
      })

      it('merges non-conflicting and uses LWW for conflicting', () => {
        const local = createEntry<User>(
          { id: '1', name: 'Alice Local', email: 'local@example.com', age: 25 },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Alice Remote', email: 'remote@example.com', settings: { theme: 'dark', notifications: false } },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        // name and email: LWW (remote wins)
        expect(result.value.name).toBe('Alice Remote')
        expect(result.value.email).toBe('remote@example.com')
        // age: only in local, kept
        expect(result.value.age).toBe(25)
        // settings: only in remote, kept
        expect(result.value.settings?.theme).toBe('dark')
      })
    })

    describe('nested object handling', () => {
      it('merges nested objects recursively', () => {
        const local = createEntry<User>(
          {
            id: '1',
            name: 'Alice',
            email: 'a@b.com',
            settings: { theme: 'light', notifications: true },
          },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          {
            id: '1',
            name: 'Alice',
            email: 'a@b.com',
            settings: { theme: 'dark', notifications: true },
          },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        // 'theme' changed: LWW (remote wins)
        expect(result.value.settings?.theme).toBe('dark')
        // 'notifications' unchanged
        expect(result.value.settings?.notifications).toBe(true)
      })

      it('handles deeply nested structures', () => {
        interface DeepUser {
          id: string
          profile: {
            personal: {
              name: string
              age?: number
            }
            work: {
              company?: string
              title?: string
            }
          }
        }

        const deepResolver = new ConflictResolver<DeepUser>(new FieldMergeStrategy())

        const local = createEntry<DeepUser>(
          {
            id: '1',
            profile: {
              personal: { name: 'Alice', age: 30 },
              work: { company: 'Acme' },
            },
          },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<DeepUser>(
          {
            id: '1',
            profile: {
              personal: { name: 'Alice' },
              work: { company: 'Acme', title: 'Engineer' },
            },
          },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = deepResolver.resolve(local, remote)

        expect(result.value.profile.personal.age).toBe(30)
        expect(result.value.profile.work.title).toBe('Engineer')
      })
    })

    describe('edge cases', () => {
      it('handles null field values', () => {
        interface NullableUser {
          id: string
          name: string | null
          email: string
        }

        const nullResolver = new ConflictResolver<NullableUser>(new FieldMergeStrategy())

        const local = createEntry<NullableUser>(
          { id: '1', name: 'Alice', email: 'a@b.com' },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<NullableUser>(
          { id: '1', name: null, email: 'a@b.com' },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = nullResolver.resolve(local, remote)

        // Remote explicitly set to null (LWW)
        expect(result.value.name).toBeNull()
      })

      it('handles undefined vs missing fields', () => {
        const local = createEntry<User>(
          { id: '1', name: 'Alice', email: 'a@b.com', age: undefined },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Alice', email: 'a@b.com' },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        // undefined in local, missing in remote - should handle gracefully
        expect(result.value).toBeDefined()
      })

      it('handles array fields', () => {
        interface UserWithTags {
          id: string
          name: string
          tags: string[]
        }

        const tagResolver = new ConflictResolver<UserWithTags>(new FieldMergeStrategy())

        const local = createEntry<UserWithTags>(
          { id: '1', name: 'Alice', tags: ['a', 'b'] },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<UserWithTags>(
          { id: '1', name: 'Alice', tags: ['b', 'c'] },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = tagResolver.resolve(local, remote)

        // Arrays are treated as atomic values by default (LWW)
        expect(result.value.tags).toEqual(['b', 'c'])
      })
    })
  })

  // ==========================================================================
  // TESTS: CRDT TYPES
  // ==========================================================================

  describe('CRDT Types', () => {
    describe('GCounter (Grow-only Counter)', () => {
      it('increments locally', () => {
        const counter = new GCounter('node-1')

        counter.increment()
        counter.increment()
        counter.increment()

        expect(counter.value()).toBe(3)
      })

      it('increments by specific amount', () => {
        const counter = new GCounter('node-1')

        counter.increment(5)
        counter.increment(3)

        expect(counter.value()).toBe(8)
      })

      it('merges via max per node', () => {
        const counter1 = new GCounter('node-1')
        const counter2 = new GCounter('node-2')

        counter1.increment(5)
        counter2.increment(3)

        counter1.merge(counter2)

        expect(counter1.value()).toBe(8) // 5 + 3
      })

      it('handles concurrent increments', () => {
        const counter1 = new GCounter('node-1')
        const counter2 = new GCounter('node-1') // Same node ID

        counter1.increment(5)
        counter2.increment(3) // Concurrent on same logical node

        counter1.merge(counter2)

        // Max of same node = 5 (not sum)
        expect(counter1.value()).toBe(5)
      })

      it('rejects negative increments', () => {
        const counter = new GCounter('node-1')

        expect(() => counter.increment(-1)).toThrow()
      })

      it('serializes and deserializes', () => {
        const counter = new GCounter('node-1')
        counter.increment(5)

        const serialized = counter.toJSON()
        const restored = GCounter.fromJSON(serialized)

        expect(restored.value()).toBe(5)
      })
    })

    describe('PNCounter (Positive-Negative Counter)', () => {
      it('increments and decrements', () => {
        const counter = new PNCounter('node-1')

        counter.increment(10)
        counter.decrement(3)

        expect(counter.value()).toBe(7)
      })

      it('handles negative values', () => {
        const counter = new PNCounter('node-1')

        counter.decrement(5)

        expect(counter.value()).toBe(-5)
      })

      it('merges correctly', () => {
        const counter1 = new PNCounter('node-1')
        const counter2 = new PNCounter('node-2')

        counter1.increment(10)
        counter2.decrement(3)

        counter1.merge(counter2)

        expect(counter1.value()).toBe(7)
      })

      it('handles concurrent operations', () => {
        const counter1 = new PNCounter('node-1')
        const counter2 = new PNCounter('node-2')

        // Node 1: +10
        counter1.increment(10)
        // Node 2: -3, +5
        counter2.decrement(3)
        counter2.increment(5)

        // Merge both
        counter1.merge(counter2)
        counter2.merge(counter1)

        // Both should converge to same value
        expect(counter1.value()).toBe(counter2.value())
        expect(counter1.value()).toBe(12) // 10 - 3 + 5
      })
    })

    describe('GSet (Grow-only Set)', () => {
      it('adds elements', () => {
        const set = new GSet<string>()

        set.add('a')
        set.add('b')
        set.add('c')

        expect(set.has('a')).toBe(true)
        expect(set.has('b')).toBe(true)
        expect(set.has('c')).toBe(true)
        expect(set.size()).toBe(3)
      })

      it('ignores duplicate adds', () => {
        const set = new GSet<string>()

        set.add('a')
        set.add('a')
        set.add('a')

        expect(set.size()).toBe(1)
      })

      it('merges via union', () => {
        const set1 = new GSet<string>()
        const set2 = new GSet<string>()

        set1.add('a')
        set1.add('b')
        set2.add('b')
        set2.add('c')

        set1.merge(set2)

        expect(set1.has('a')).toBe(true)
        expect(set1.has('b')).toBe(true)
        expect(set1.has('c')).toBe(true)
        expect(set1.size()).toBe(3)
      })

      it('handles complex objects', () => {
        interface Tag {
          id: string
          name: string
        }

        const set = new GSet<Tag>()

        set.add({ id: '1', name: 'alpha' })
        set.add({ id: '2', name: 'beta' })

        expect(set.size()).toBe(2)
      })

      it('returns elements as array', () => {
        const set = new GSet<string>()

        set.add('a')
        set.add('b')

        const elements = set.elements()

        expect(elements).toContain('a')
        expect(elements).toContain('b')
      })

      it('serializes and deserializes', () => {
        const set = new GSet<string>()
        set.add('a')
        set.add('b')

        const serialized = set.toJSON()
        const restored = GSet.fromJSON<string>(serialized)

        expect(restored.has('a')).toBe(true)
        expect(restored.has('b')).toBe(true)
      })
    })

    describe('LWWRegister (Last-Writer-Wins Register)', () => {
      it('sets and gets value', () => {
        const register = new LWWRegister<string>('node-1')

        register.set('hello', 1000)

        expect(register.get()).toBe('hello')
      })

      it('overwrites with higher timestamp', () => {
        const register = new LWWRegister<string>('node-1')

        register.set('first', 1000)
        register.set('second', 2000)

        expect(register.get()).toBe('second')
      })

      it('ignores writes with lower timestamp', () => {
        const register = new LWWRegister<string>('node-1')

        register.set('second', 2000)
        register.set('first', 1000)

        expect(register.get()).toBe('second')
      })

      it('uses node ID as tiebreaker', () => {
        const register1 = new LWWRegister<string>('node-a')
        const register2 = new LWWRegister<string>('node-b')

        register1.set('from-a', 1000)
        register2.set('from-b', 1000)

        register1.merge(register2)

        // node-b > node-a alphabetically
        expect(register1.get()).toBe('from-b')
      })

      it('merges registers', () => {
        const register1 = new LWWRegister<string>('node-1')
        const register2 = new LWWRegister<string>('node-2')

        register1.set('value-1', 1000)
        register2.set('value-2', 2000)

        register1.merge(register2)

        expect(register1.get()).toBe('value-2')
        expect(register1.timestamp()).toBe(2000)
      })

      it('handles complex value types', () => {
        interface Config {
          enabled: boolean
          options: string[]
        }

        const register = new LWWRegister<Config>('node-1')

        register.set({ enabled: true, options: ['a', 'b'] }, 1000)

        expect(register.get()?.enabled).toBe(true)
        expect(register.get()?.options).toEqual(['a', 'b'])
      })

      it('handles null values', () => {
        const register = new LWWRegister<string | null>('node-1')

        register.set('value', 1000)
        register.set(null, 2000)

        expect(register.get()).toBeNull()
      })
    })

    describe('CRDTMergeStrategy integration', () => {
      it('resolves GCounter conflicts', () => {
        interface CounterDoc {
          id: string
          views: GCounter
        }

        const resolver = new ConflictResolver<CounterDoc>(new CRDTMergeStrategy())

        const local = createEntry<CounterDoc>(
          { id: '1', views: GCounter.fromJSON({ 'node-1': 5 }) },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<CounterDoc>(
          { id: '1', views: GCounter.fromJSON({ 'node-2': 3 }) },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.views.value()).toBe(8)
      })

      it('resolves GSet conflicts', () => {
        interface TaggedDoc {
          id: string
          tags: GSet<string>
        }

        const resolver = new ConflictResolver<TaggedDoc>(new CRDTMergeStrategy())

        const set1 = new GSet<string>()
        set1.add('a')
        set1.add('b')

        const set2 = new GSet<string>()
        set2.add('b')
        set2.add('c')

        const local = createEntry<TaggedDoc>(
          { id: '1', tags: set1 },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<TaggedDoc>(
          { id: '1', tags: set2 },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.tags.has('a')).toBe(true)
        expect(result.value.tags.has('b')).toBe(true)
        expect(result.value.tags.has('c')).toBe(true)
      })

      it('resolves LWWRegister conflicts', () => {
        interface StatusDoc {
          id: string
          status: LWWRegister<string>
        }

        const resolver = new ConflictResolver<StatusDoc>(new CRDTMergeStrategy())

        const reg1 = new LWWRegister<string>('node-1')
        reg1.set('pending', 1000)

        const reg2 = new LWWRegister<string>('node-2')
        reg2.set('approved', 2000)

        const local = createEntry<StatusDoc>(
          { id: '1', status: reg1 },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<StatusDoc>(
          { id: '1', status: reg2 },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.status.get()).toBe('approved')
      })
    })
  })

  // ==========================================================================
  // TESTS: CUSTOM RESOLVER
  // ==========================================================================

  describe('Custom Resolver', () => {
    describe('user function invocation', () => {
      it('receives both versions in resolver function', () => {
        let receivedLocal: ConflictEntry<User> | null = null
        let receivedRemote: ConflictEntry<User> | null = null

        const customStrategy = new CustomResolverStrategy<User>((local, remote) => {
          receivedLocal = local
          receivedRemote = remote
          return { ...remote, resolution: 'custom' as const }
        })

        const resolver = new ConflictResolver<User>(customStrategy)

        const local = createEntry<User>(
          { id: '1', name: 'Local', email: 'a@b.com' },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Remote', email: 'a@b.com' },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        resolver.resolve(local, remote)

        expect(receivedLocal).not.toBeNull()
        expect(receivedRemote).not.toBeNull()
        expect(receivedLocal?.value.name).toBe('Local')
        expect(receivedRemote?.value.name).toBe('Remote')
      })

      it('returns resolved version from user function', () => {
        const customStrategy = new CustomResolverStrategy<User>((local, remote) => {
          // Custom logic: always pick local regardless of timestamp
          return {
            value: local.value,
            timestamp: Math.max(local.timestamp, remote.timestamp),
            nodeId: local.nodeId,
            resolution: 'custom' as const,
          }
        })

        const resolver = new ConflictResolver<User>(customStrategy)

        const local = createEntry<User>(
          { id: '1', name: 'Local', email: 'a@b.com' },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Remote', email: 'a@b.com' },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.name).toBe('Local')
        expect(result.resolution).toBe('custom')
      })

      it('allows creating merged values', () => {
        const customStrategy = new CustomResolverStrategy<User>((local, remote) => {
          return {
            value: {
              ...local.value,
              ...remote.value,
              name: `${local.value.name} & ${remote.value.name}`,
            },
            timestamp: Math.max(local.timestamp, remote.timestamp),
            nodeId: 'merged',
            resolution: 'custom' as const,
          }
        })

        const resolver = new ConflictResolver<User>(customStrategy)

        const local = createEntry<User>(
          { id: '1', name: 'Alice', email: 'alice@example.com', age: 25 },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Bob', email: 'bob@example.com' },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        expect(result.value.name).toBe('Alice & Bob')
        expect(result.value.age).toBe(25)
        expect(result.value.email).toBe('bob@example.com')
      })
    })

    describe('error handling', () => {
      it('handles errors thrown by resolver function', () => {
        const customStrategy = new CustomResolverStrategy<User>(() => {
          throw new Error('Resolver error')
        })

        const resolver = new ConflictResolver<User>(customStrategy)

        const local = createEntry<User>(
          { id: '1', name: 'Alice', email: 'a@b.com' },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Bob', email: 'a@b.com' },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        expect(() => resolver.resolve(local, remote)).toThrow('Resolver error')
      })

      it('handles async resolver functions', async () => {
        const asyncStrategy = new CustomResolverStrategy<User>(async (local, remote) => {
          // Simulate async operation
          await new Promise((r) => setTimeout(r, 10))
          return {
            value: remote.value,
            timestamp: remote.timestamp,
            nodeId: remote.nodeId,
            resolution: 'custom' as const,
          }
        })

        const resolver = new ConflictResolver<User>(asyncStrategy)

        const local = createEntry<User>(
          { id: '1', name: 'Alice', email: 'a@b.com' },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Bob', email: 'a@b.com' },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = await resolver.resolveAsync(local, remote)

        expect(result.value.name).toBe('Bob')
      })

      it('validates resolver function output', () => {
        const invalidStrategy = new CustomResolverStrategy<User>(() => {
          // Return invalid result (missing required fields)
          return {
            value: { id: '1', name: 'Test', email: 'a@b.com' },
            // Missing timestamp, nodeId, resolution
          } as unknown as ResolvedEntry<User>
        })

        const resolver = new ConflictResolver<User>(invalidStrategy)

        const local = createEntry<User>(
          { id: '1', name: 'Alice', email: 'a@b.com' },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<User>(
          { id: '1', name: 'Bob', email: 'a@b.com' },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        expect(() => resolver.resolve(local, remote)).toThrow()
      })
    })

    describe('business logic examples', () => {
      it('implements priority-based resolution', () => {
        interface PriorityUser extends User {
          role: 'admin' | 'user' | 'guest'
        }

        const priorityStrategy = new CustomResolverStrategy<PriorityUser>((local, remote) => {
          const priorities = { admin: 3, user: 2, guest: 1 }
          const localPriority = priorities[local.value.role]
          const remotePriority = priorities[remote.value.role]

          // Higher role priority wins
          const winner = localPriority >= remotePriority ? local : remote
          return {
            value: winner.value,
            timestamp: Math.max(local.timestamp, remote.timestamp),
            nodeId: winner.nodeId,
            resolution: 'custom' as const,
          }
        })

        const resolver = new ConflictResolver<PriorityUser>(priorityStrategy)

        const local = createEntry<PriorityUser>(
          { id: '1', name: 'Admin', email: 'admin@b.com', role: 'admin' },
          { timestamp: 1000, nodeId: 'node-1' }
        )
        const remote = createEntry<PriorityUser>(
          { id: '1', name: 'User', email: 'user@b.com', role: 'user' },
          { timestamp: 2000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        // Admin wins despite lower timestamp
        expect(result.value.name).toBe('Admin')
        expect(result.value.role).toBe('admin')
      })

      it('implements content-based merge', () => {
        interface Article {
          id: string
          title: string
          content: string
          wordCount: number
        }

        const contentStrategy = new CustomResolverStrategy<Article>((local, remote) => {
          // Keep the version with more content
          const winner = local.value.wordCount > remote.value.wordCount ? local : remote
          return {
            value: winner.value,
            timestamp: Math.max(local.timestamp, remote.timestamp),
            nodeId: winner.nodeId,
            resolution: 'custom' as const,
          }
        })

        const resolver = new ConflictResolver<Article>(contentStrategy)

        const local = createEntry<Article>(
          { id: '1', title: 'Article', content: 'Short', wordCount: 100 },
          { timestamp: 2000, nodeId: 'node-1' }
        )
        const remote = createEntry<Article>(
          { id: '1', title: 'Article', content: 'Much longer content here', wordCount: 500 },
          { timestamp: 1000, nodeId: 'node-2' }
        )

        const result = resolver.resolve(local, remote)

        // Longer content wins despite lower timestamp
        expect(result.value.wordCount).toBe(500)
      })
    })
  })

  // ==========================================================================
  // TESTS: STRATEGY SWITCHING
  // ==========================================================================

  describe('Strategy Switching', () => {
    it('allows changing strategy at runtime', () => {
      const resolver = new ConflictResolver<User>(new LastWriteWinsStrategy())

      const local = createEntry<User>(
        { id: '1', name: 'Local', email: 'a@b.com' },
        { timestamp: 2000, nodeId: 'node-1' }
      )
      const remote = createEntry<User>(
        { id: '1', name: 'Remote', email: 'a@b.com' },
        { timestamp: 1000, nodeId: 'node-2' }
      )

      // LWW: local wins (higher timestamp)
      let result = resolver.resolve(local, remote)
      expect(result.value.name).toBe('Local')

      // Switch to custom strategy that always picks remote
      resolver.setStrategy(
        new CustomResolverStrategy<User>((l, r) => ({
          value: r.value,
          timestamp: r.timestamp,
          nodeId: r.nodeId,
          resolution: 'custom' as const,
        }))
      )

      // Now remote always wins
      result = resolver.resolve(local, remote)
      expect(result.value.name).toBe('Remote')
    })

    it('validates strategy on set', () => {
      const resolver = new ConflictResolver<User>(new LastWriteWinsStrategy())

      expect(() => resolver.setStrategy(null as unknown as ConflictStrategy<User>)).toThrow()
      expect(() => resolver.setStrategy(undefined as unknown as ConflictStrategy<User>)).toThrow()
    })
  })

  // ==========================================================================
  // TESTS: EDGE CASES AND ERROR HANDLING
  // ==========================================================================

  describe('Edge Cases and Error Handling', () => {
    it('handles identical entries', () => {
      const resolver = new ConflictResolver<User>(new LastWriteWinsStrategy())

      const entry = createEntry<User>(
        { id: '1', name: 'Alice', email: 'a@b.com' },
        { timestamp: 1000, nodeId: 'node-1' }
      )

      const result = resolver.resolve(entry, entry)

      expect(result.value.name).toBe('Alice')
    })

    it('handles very large objects', () => {
      const resolver = new ConflictResolver<{ data: string[] }>(new LastWriteWinsStrategy())

      const largeArray = Array.from({ length: 10000 }, (_, i) => `item-${i}`)

      const local = createEntry(
        { data: largeArray },
        { timestamp: 1000, nodeId: 'node-1' }
      )
      const remote = createEntry(
        { data: largeArray.slice(0, 5000) },
        { timestamp: 2000, nodeId: 'node-2' }
      )

      const result = resolver.resolve(local, remote)

      expect(result.value.data).toHaveLength(5000)
    })

    it('handles circular reference detection', () => {
      interface CircularRef {
        id: string
        ref?: CircularRef
      }

      const resolver = new ConflictResolver<CircularRef>(new FieldMergeStrategy())

      const obj: CircularRef = { id: '1' }
      obj.ref = obj // Circular reference

      const local = createEntry(obj, { timestamp: 1000, nodeId: 'node-1' })
      const remote = createEntry(
        { id: '1' },
        { timestamp: 2000, nodeId: 'node-2' }
      )

      // Should handle gracefully (either resolve or throw meaningful error)
      expect(() => resolver.resolve(local, remote)).not.toThrow()
    })

    it('handles symbol keys in objects', () => {
      const resolver = new ConflictResolver<Record<string | symbol, unknown>>(
        new FieldMergeStrategy()
      )

      const sym = Symbol('test')
      const local = createEntry(
        { id: '1', [sym]: 'local-symbol' },
        { timestamp: 1000, nodeId: 'node-1' }
      )
      const remote = createEntry(
        { id: '1', [sym]: 'remote-symbol' },
        { timestamp: 2000, nodeId: 'node-2' }
      )

      // Should handle gracefully
      const result = resolver.resolve(local, remote)
      expect(result.value.id).toBe('1')
    })

    it('handles Date objects', () => {
      interface WithDate {
        id: string
        createdAt: Date
      }

      const resolver = new ConflictResolver<WithDate>(new LastWriteWinsStrategy())

      const local = createEntry(
        { id: '1', createdAt: new Date('2024-01-01') },
        { timestamp: 1000, nodeId: 'node-1' }
      )
      const remote = createEntry(
        { id: '1', createdAt: new Date('2024-06-01') },
        { timestamp: 2000, nodeId: 'node-2' }
      )

      const result = resolver.resolve(local, remote)

      expect(result.value.createdAt).toEqual(new Date('2024-06-01'))
    })

    it('handles Map and Set in values', () => {
      interface WithCollections {
        id: string
        tags: Set<string>
        metadata: Map<string, unknown>
      }

      const resolver = new ConflictResolver<WithCollections>(new LastWriteWinsStrategy())

      const local = createEntry(
        {
          id: '1',
          tags: new Set(['a', 'b']),
          metadata: new Map([['key', 'value']]),
        },
        { timestamp: 1000, nodeId: 'node-1' }
      )
      const remote = createEntry(
        {
          id: '1',
          tags: new Set(['c', 'd']),
          metadata: new Map([['other', 'data']]),
        },
        { timestamp: 2000, nodeId: 'node-2' }
      )

      const result = resolver.resolve(local, remote)

      expect(result.value.tags.has('c')).toBe(true)
      expect(result.value.metadata.get('other')).toBe('data')
    })
  })
})
