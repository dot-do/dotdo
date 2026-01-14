/**
 * Conflict Resolution Strategies Tests
 *
 * Tests for conflict resolution strategies used in bidirectional sync:
 * - LWW (Last-Writer-Wins): Uses timestamps to determine winner
 * - source-wins: Always use source record
 * - dest-wins: Always use destination record
 * - merge: Field-level merge of non-conflicting fields
 * - custom: User-provided resolver function
 *
 * @module db/primitives/connector-framework/conflict-resolver.test
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createConflictResolver,
  type Conflict,
  type ResolvedRecord,
  type ResolutionStrategy,
  type CustomResolver,
  type ConflictResolver,
} from './conflict-resolver'

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    key: 'user-123',
    source: {
      data: { name: 'Alice', email: 'alice@example.com', age: 30 },
      updatedAt: new Date('2026-01-10T12:00:00Z').getTime(),
      version: 1,
    },
    dest: {
      data: { name: 'Bob', email: 'bob@example.com', age: 25 },
      updatedAt: new Date('2026-01-10T10:00:00Z').getTime(),
      version: 2,
    },
    ...overrides,
  }
}

// =============================================================================
// LWW Strategy Tests
// =============================================================================

describe('Conflict Resolution: LWW (Last-Writer-Wins)', () => {
  it('should pick record with latest timestamp when source is newer', () => {
    const resolver = createConflictResolver({ strategy: 'lww' })
    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice' },
        updatedAt: new Date('2026-01-10T14:00:00Z').getTime(),
        version: 3,
      },
      dest: {
        data: { name: 'Bob' },
        updatedAt: new Date('2026-01-10T10:00:00Z').getTime(),
        version: 1,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('resolved')
    expect(result.data).toEqual({ name: 'Alice' })
    expect(result.winner).toBe('source')
  })

  it('should pick record with latest timestamp when dest is newer', () => {
    const resolver = createConflictResolver({ strategy: 'lww' })
    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice' },
        updatedAt: new Date('2026-01-10T08:00:00Z').getTime(),
        version: 1,
      },
      dest: {
        data: { name: 'Bob' },
        updatedAt: new Date('2026-01-10T15:00:00Z').getTime(),
        version: 2,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('resolved')
    expect(result.data).toEqual({ name: 'Bob' })
    expect(result.winner).toBe('dest')
  })

  it('should use version as tiebreaker when timestamps are equal', () => {
    const resolver = createConflictResolver({ strategy: 'lww' })
    const timestamp = new Date('2026-01-10T12:00:00Z').getTime()
    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice' },
        updatedAt: timestamp,
        version: 5,
      },
      dest: {
        data: { name: 'Bob' },
        updatedAt: timestamp,
        version: 3,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('resolved')
    expect(result.data).toEqual({ name: 'Alice' })
    expect(result.winner).toBe('source')
  })

  it('should prefer source when both timestamp and version are equal', () => {
    const resolver = createConflictResolver({ strategy: 'lww' })
    const timestamp = new Date('2026-01-10T12:00:00Z').getTime()
    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice' },
        updatedAt: timestamp,
        version: 1,
      },
      dest: {
        data: { name: 'Bob' },
        updatedAt: timestamp,
        version: 1,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('resolved')
    expect(result.data).toEqual({ name: 'Alice' })
    expect(result.winner).toBe('source')
  })
})

// =============================================================================
// Source-Wins Strategy Tests
// =============================================================================

describe('Conflict Resolution: source-wins', () => {
  it('should always use source record regardless of timestamps', () => {
    const resolver = createConflictResolver({ strategy: 'source-wins' })
    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice', status: 'active' },
        updatedAt: new Date('2026-01-01T00:00:00Z').getTime(),
        version: 1,
      },
      dest: {
        data: { name: 'Bob', status: 'inactive' },
        updatedAt: new Date('2026-01-10T23:59:59Z').getTime(),
        version: 100,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('resolved')
    expect(result.data).toEqual({ name: 'Alice', status: 'active' })
    expect(result.winner).toBe('source')
  })

  it('should handle source with empty data', () => {
    const resolver = createConflictResolver({ strategy: 'source-wins' })
    const conflict = createTestConflict({
      source: {
        data: {},
        updatedAt: Date.now(),
        version: 1,
      },
      dest: {
        data: { name: 'Bob' },
        updatedAt: Date.now(),
        version: 1,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('resolved')
    expect(result.data).toEqual({})
    expect(result.winner).toBe('source')
  })
})

// =============================================================================
// Dest-Wins Strategy Tests
// =============================================================================

describe('Conflict Resolution: dest-wins', () => {
  it('should always use destination record regardless of timestamps', () => {
    const resolver = createConflictResolver({ strategy: 'dest-wins' })
    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice', status: 'active' },
        updatedAt: new Date('2026-01-10T23:59:59Z').getTime(),
        version: 100,
      },
      dest: {
        data: { name: 'Bob', status: 'inactive' },
        updatedAt: new Date('2026-01-01T00:00:00Z').getTime(),
        version: 1,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('resolved')
    expect(result.data).toEqual({ name: 'Bob', status: 'inactive' })
    expect(result.winner).toBe('dest')
  })

  it('should handle dest with empty data', () => {
    const resolver = createConflictResolver({ strategy: 'dest-wins' })
    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice' },
        updatedAt: Date.now(),
        version: 1,
      },
      dest: {
        data: {},
        updatedAt: Date.now(),
        version: 1,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('resolved')
    expect(result.data).toEqual({})
    expect(result.winner).toBe('dest')
  })
})

// =============================================================================
// Merge Strategy Tests
// =============================================================================

describe('Conflict Resolution: merge', () => {
  it('should combine non-conflicting fields from both records', () => {
    const resolver = createConflictResolver({ strategy: 'merge' })
    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice', email: 'alice@example.com' },
        updatedAt: Date.now(),
        version: 1,
      },
      dest: {
        data: { name: 'Alice', phone: '555-1234' },
        updatedAt: Date.now(),
        version: 1,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('resolved')
    expect(result.data).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
      phone: '555-1234',
    })
    expect(result.winner).toBe('merged')
  })

  it('should use source value for conflicting fields by default', () => {
    const resolver = createConflictResolver({ strategy: 'merge' })
    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice', shared: 'from-source' },
        updatedAt: Date.now(),
        version: 1,
      },
      dest: {
        data: { name: 'Bob', shared: 'from-dest' },
        updatedAt: Date.now(),
        version: 1,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('resolved')
    // Default merge prefers source for conflicting fields
    expect(result.data.shared).toBe('from-source')
  })

  it('should use LWW for conflicting fields when preferLwwForConflicts is true', () => {
    const resolver = createConflictResolver({
      strategy: 'merge',
      mergeOptions: { preferLwwForConflicts: true },
    })
    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice', shared: 'from-source' },
        updatedAt: new Date('2026-01-10T08:00:00Z').getTime(),
        version: 1,
      },
      dest: {
        data: { name: 'Bob', shared: 'from-dest' },
        updatedAt: new Date('2026-01-10T15:00:00Z').getTime(),
        version: 2,
      },
    })

    const result = resolver.resolve(conflict)

    // Dest is newer, so use dest values for conflicts
    expect(result.data.name).toBe('Bob')
    expect(result.data.shared).toBe('from-dest')
  })

  it('should handle nested objects with deep merge', () => {
    const resolver = createConflictResolver({
      strategy: 'merge',
      mergeOptions: { deep: true },
    })
    const conflict = createTestConflict({
      source: {
        data: {
          profile: { name: 'Alice', settings: { theme: 'dark' } },
        },
        updatedAt: Date.now(),
        version: 1,
      },
      dest: {
        data: {
          profile: { name: 'Alice', settings: { language: 'en' } },
        },
        updatedAt: Date.now(),
        version: 1,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('resolved')
    expect(result.data).toEqual({
      profile: {
        name: 'Alice',
        settings: { theme: 'dark', language: 'en' },
      },
    })
  })

  it('should track conflicting fields in metadata', () => {
    const resolver = createConflictResolver({ strategy: 'merge' })
    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice', age: 30 },
        updatedAt: Date.now(),
        version: 1,
      },
      dest: {
        data: { name: 'Bob', age: 25 },
        updatedAt: Date.now(),
        version: 1,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.metadata?.conflictingFields).toContain('name')
    expect(result.metadata?.conflictingFields).toContain('age')
  })
})

// =============================================================================
// Custom Resolver Tests
// =============================================================================

describe('Conflict Resolution: custom', () => {
  it('should call custom resolver function with conflict', () => {
    const customFn = vi.fn<CustomResolver>((conflict) => ({
      type: 'resolved',
      data: { ...conflict.source.data, resolved: true },
      winner: 'custom',
    }))

    const resolver = createConflictResolver({
      strategy: 'custom',
      customResolver: customFn,
    })

    const conflict = createTestConflict()
    const result = resolver.resolve(conflict)

    expect(customFn).toHaveBeenCalledWith(conflict)
    expect(result.type).toBe('resolved')
    expect(result.data).toHaveProperty('resolved', true)
  })

  it('should allow custom resolver to skip record', () => {
    const customFn: CustomResolver = () => 'skip'

    const resolver = createConflictResolver({
      strategy: 'custom',
      customResolver: customFn,
    })

    const conflict = createTestConflict()
    const result = resolver.resolve(conflict)

    expect(result.type).toBe('skipped')
  })

  it('should allow custom resolver to request manual review', () => {
    const customFn: CustomResolver = () => 'manual'

    const resolver = createConflictResolver({
      strategy: 'custom',
      customResolver: customFn,
    })

    const conflict = createTestConflict()
    const result = resolver.resolve(conflict)

    expect(result.type).toBe('manual')
  })

  it('should throw if custom strategy is used without resolver function', () => {
    expect(() => {
      createConflictResolver({ strategy: 'custom' })
    }).toThrow('Custom resolver function required')
  })
})

// =============================================================================
// Manual Review Escalation Tests
// =============================================================================

describe('Conflict Resolution: Manual Review Escalation', () => {
  it('should escalate to manual review when threshold exceeded', () => {
    const resolver = createConflictResolver({
      strategy: 'merge',
      manualReviewThreshold: 2, // Max 2 conflicting fields
    })

    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice', email: 'a@example.com', phone: '111' },
        updatedAt: Date.now(),
        version: 1,
      },
      dest: {
        data: { name: 'Bob', email: 'b@example.com', phone: '222' },
        updatedAt: Date.now(),
        version: 1,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('manual')
    expect(result.metadata?.reason).toBe('exceeded_threshold')
    expect(result.metadata?.conflictingFields?.length).toBe(3)
  })

  it('should include original conflict in manual review result', () => {
    const resolver = createConflictResolver({
      strategy: 'merge',
      manualReviewThreshold: 1,
    })

    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice', email: 'alice@example.com' },
        updatedAt: Date.now(),
        version: 1,
      },
      dest: {
        data: { name: 'Bob', email: 'bob@example.com' },
        updatedAt: Date.now(),
        version: 1,
      },
    })

    const result = resolver.resolve(conflict)

    expect(result.type).toBe('manual')
    expect(result.conflict).toBe(conflict)
  })

  it('should call onManualReview callback when escalating', () => {
    const onManualReview = vi.fn()
    const resolver = createConflictResolver({
      strategy: 'merge',
      manualReviewThreshold: 1,
      onManualReview,
    })

    const conflict = createTestConflict({
      source: {
        data: { name: 'Alice', email: 'alice@example.com' },
        updatedAt: Date.now(),
        version: 1,
      },
      dest: {
        data: { name: 'Bob', email: 'bob@example.com' },
        updatedAt: Date.now(),
        version: 1,
      },
    })

    resolver.resolve(conflict)

    expect(onManualReview).toHaveBeenCalledWith(conflict, expect.any(Array))
  })
})

// =============================================================================
// Resolver Configuration Tests
// =============================================================================

describe('Conflict Resolution: Configuration', () => {
  it('should track resolution statistics', () => {
    const resolver = createConflictResolver({ strategy: 'lww' })

    // Resolve multiple conflicts
    resolver.resolve(createTestConflict({
      source: { data: { a: 1 }, updatedAt: Date.now(), version: 1 },
      dest: { data: { a: 2 }, updatedAt: Date.now() - 1000, version: 1 },
    }))
    resolver.resolve(createTestConflict({
      source: { data: { b: 1 }, updatedAt: Date.now() - 1000, version: 1 },
      dest: { data: { b: 2 }, updatedAt: Date.now(), version: 1 },
    }))

    const stats = resolver.getStats()

    expect(stats.total).toBe(2)
    expect(stats.sourceWins).toBe(1)
    expect(stats.destWins).toBe(1)
  })

  it('should support strategy change at runtime', () => {
    const resolver = createConflictResolver({ strategy: 'source-wins' })

    const conflict = createTestConflict()

    // First resolution with source-wins
    let result = resolver.resolve(conflict)
    expect(result.winner).toBe('source')

    // Change strategy
    resolver.setStrategy('dest-wins')

    // Second resolution with dest-wins
    result = resolver.resolve(conflict)
    expect(result.winner).toBe('dest')
  })
})
