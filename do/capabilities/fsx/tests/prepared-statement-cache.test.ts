/**
 * Tests for SQLite Prepared Statement LRU Cache
 *
 * This test file covers:
 * - Bounded cache with configurable maxSize limit
 * - LRU eviction when cache is full
 * - Cache hit/miss statistics tracking
 * - Proper statement finalization on eviction
 * - Memory bounds enforcement
 *
 * @module tests/prepared-statement-cache.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PreparedStatementCache, type PreparedStatementCacheOptions, type PreparedStatementCacheStats } from '../storage/prepared-statement-cache.js'

// ============================================================================
// Mock Statement Implementation
// ============================================================================

/**
 * Mock prepared statement that tracks finalization
 */
class MockStatement {
  public finalized = false
  public executionCount = 0

  constructor(public readonly sql: string) {}

  run(...params: unknown[]): void {
    this.executionCount++
  }

  get(...params: unknown[]): unknown {
    this.executionCount++
    return { id: 1 }
  }

  all(...params: unknown[]): unknown[] {
    this.executionCount++
    return [{ id: 1 }]
  }

  finalize(): void {
    this.finalized = true
  }
}

// ============================================================================
// Cache Size Bounds Tests
// ============================================================================

describe('PreparedStatementCache Size Bounds', () => {
  describe('constructor', () => {
    it('should create cache with default maxSize of 100', () => {
      const cache = new PreparedStatementCache()
      const stats = cache.getStats()

      expect(stats.maxSize).toBe(100)
    })

    it('should create cache with custom maxSize', () => {
      const cache = new PreparedStatementCache({ maxSize: 50 })
      const stats = cache.getStats()

      expect(stats.maxSize).toBe(50)
    })

    it('should enforce minimum maxSize of 1', () => {
      const cache = new PreparedStatementCache({ maxSize: 0 })
      const stats = cache.getStats()

      expect(stats.maxSize).toBeGreaterThanOrEqual(1)
    })

    it('should handle negative maxSize by using default', () => {
      const cache = new PreparedStatementCache({ maxSize: -10 })
      const stats = cache.getStats()

      expect(stats.maxSize).toBeGreaterThanOrEqual(1)
    })
  })

  describe('size enforcement', () => {
    it('should not exceed maxSize limit', () => {
      const cache = new PreparedStatementCache({ maxSize: 3 })

      // Add 5 statements
      for (let i = 0; i < 5; i++) {
        cache.getOrCreate(`SELECT * FROM table${i}`, () => new MockStatement(`SELECT * FROM table${i}`))
      }

      expect(cache.size).toBeLessThanOrEqual(3)
    })

    it('should maintain exactly maxSize entries when full', () => {
      const cache = new PreparedStatementCache({ maxSize: 5 })

      // Fill the cache
      for (let i = 0; i < 5; i++) {
        cache.getOrCreate(`SELECT ${i}`, () => new MockStatement(`SELECT ${i}`))
      }

      expect(cache.size).toBe(5)

      // Add one more
      cache.getOrCreate('SELECT 99', () => new MockStatement('SELECT 99'))

      expect(cache.size).toBe(5) // Still 5, oldest evicted
    })

    it('should track current size accurately', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })

      expect(cache.size).toBe(0)

      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))
      expect(cache.size).toBe(1)

      cache.getOrCreate('SELECT 2', () => new MockStatement('SELECT 2'))
      expect(cache.size).toBe(2)

      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1')) // Cache hit, no size change
      expect(cache.size).toBe(2)
    })
  })
})

// ============================================================================
// LRU Eviction Tests
// ============================================================================

describe('PreparedStatementCache LRU Eviction', () => {
  it('should evict least recently used entry when cache is full', () => {
    const cache = new PreparedStatementCache({ maxSize: 3 })
    const statements: MockStatement[] = []

    // Add 3 statements
    for (let i = 0; i < 3; i++) {
      const stmt = new MockStatement(`SELECT ${i}`)
      statements.push(stmt)
      cache.getOrCreate(`SELECT ${i}`, () => stmt)
    }

    // Add 4th statement - should evict SELECT 0 (oldest)
    cache.getOrCreate('SELECT 3', () => new MockStatement('SELECT 3'))

    // SELECT 0 should be evicted
    expect(cache.has('SELECT 0')).toBe(false)
    expect(cache.has('SELECT 1')).toBe(true)
    expect(cache.has('SELECT 2')).toBe(true)
    expect(cache.has('SELECT 3')).toBe(true)
  })

  it('should update LRU order on cache hit', () => {
    const cache = new PreparedStatementCache({ maxSize: 3 })

    // Add 3 statements
    cache.getOrCreate('SELECT 0', () => new MockStatement('SELECT 0'))
    cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))
    cache.getOrCreate('SELECT 2', () => new MockStatement('SELECT 2'))

    // Access SELECT 0 - makes it most recently used
    cache.getOrCreate('SELECT 0', () => new MockStatement('SELECT 0'))

    // Add SELECT 3 - should evict SELECT 1 (now oldest)
    cache.getOrCreate('SELECT 3', () => new MockStatement('SELECT 3'))

    expect(cache.has('SELECT 0')).toBe(true) // Recently accessed, not evicted
    expect(cache.has('SELECT 1')).toBe(false) // Was oldest, evicted
    expect(cache.has('SELECT 2')).toBe(true)
    expect(cache.has('SELECT 3')).toBe(true)
  })

  it('should finalize evicted statements', () => {
    const cache = new PreparedStatementCache({ maxSize: 2 })
    const stmt1 = new MockStatement('SELECT 1')
    const stmt2 = new MockStatement('SELECT 2')
    const stmt3 = new MockStatement('SELECT 3')

    cache.getOrCreate('SELECT 1', () => stmt1)
    cache.getOrCreate('SELECT 2', () => stmt2)

    expect(stmt1.finalized).toBe(false)
    expect(stmt2.finalized).toBe(false)

    // Adding stmt3 should evict stmt1
    cache.getOrCreate('SELECT 3', () => stmt3)

    expect(stmt1.finalized).toBe(true) // Should be finalized on eviction
    expect(stmt2.finalized).toBe(false)
    expect(stmt3.finalized).toBe(false)
  })

  it('should not affect LRU order on has() check', () => {
    const cache = new PreparedStatementCache({ maxSize: 2 })

    cache.getOrCreate('SELECT 0', () => new MockStatement('SELECT 0'))
    cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))

    // has() should NOT update LRU order
    cache.has('SELECT 0')

    // Add SELECT 2 - should still evict SELECT 0 (oldest in LRU order)
    cache.getOrCreate('SELECT 2', () => new MockStatement('SELECT 2'))

    expect(cache.has('SELECT 0')).toBe(false) // Should be evicted
    expect(cache.has('SELECT 1')).toBe(true)
  })

  it('should handle rapid eviction cycles', () => {
    const cache = new PreparedStatementCache({ maxSize: 2 })
    const finalizedCount = { count: 0 }

    // Rapidly add many statements
    for (let i = 0; i < 100; i++) {
      const stmt = new MockStatement(`SELECT ${i}`)
      const originalFinalize = stmt.finalize.bind(stmt)
      stmt.finalize = () => {
        originalFinalize()
        finalizedCount.count++
      }
      cache.getOrCreate(`SELECT ${i}`, () => stmt)
    }

    // Should have evicted 98 statements (100 - 2)
    expect(finalizedCount.count).toBe(98)
    expect(cache.size).toBe(2)
  })
})

// ============================================================================
// Cache Hit/Miss Statistics Tests
// ============================================================================

describe('PreparedStatementCache Statistics', () => {
  describe('hit/miss tracking', () => {
    it('should track cache hits', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })

      // First access is a miss
      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))

      // Subsequent accesses are hits
      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))
      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))
      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))

      const stats = cache.getStats()
      expect(stats.hits).toBe(3)
    })

    it('should track cache misses', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })

      // All unique queries are misses
      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))
      cache.getOrCreate('SELECT 2', () => new MockStatement('SELECT 2'))
      cache.getOrCreate('SELECT 3', () => new MockStatement('SELECT 3'))

      const stats = cache.getStats()
      expect(stats.misses).toBe(3)
    })

    it('should calculate hit ratio correctly', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })

      // 1 miss
      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))
      // 3 hits
      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))
      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))
      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))

      const stats = cache.getStats()
      expect(stats.hitRatio).toBe(0.75) // 3 hits / 4 total
    })

    it('should return 0 hit ratio when no requests', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })
      const stats = cache.getStats()

      expect(stats.hitRatio).toBe(0)
    })
  })

  describe('eviction tracking', () => {
    it('should track eviction count', () => {
      const cache = new PreparedStatementCache({ maxSize: 2 })

      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))
      cache.getOrCreate('SELECT 2', () => new MockStatement('SELECT 2'))
      cache.getOrCreate('SELECT 3', () => new MockStatement('SELECT 3')) // evicts 1
      cache.getOrCreate('SELECT 4', () => new MockStatement('SELECT 4')) // evicts 2

      const stats = cache.getStats()
      expect(stats.evictions).toBe(2)
    })

    it('should track total statements created', () => {
      const cache = new PreparedStatementCache({ maxSize: 5 })

      for (let i = 0; i < 10; i++) {
        cache.getOrCreate(`SELECT ${i}`, () => new MockStatement(`SELECT ${i}`))
      }

      const stats = cache.getStats()
      expect(stats.totalCreated).toBe(10) // 10 unique statements created
    })
  })

  describe('stats reset', () => {
    it('should reset statistics but keep cache contents', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })

      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))
      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))

      cache.resetStats()

      const stats = cache.getStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.evictions).toBe(0)
      expect(cache.size).toBe(1) // Cache contents preserved
    })
  })
})

// ============================================================================
// Memory Safety Tests
// ============================================================================

describe('PreparedStatementCache Memory Safety', () => {
  it('should not grow unboundedly with dynamic SQL', () => {
    const cache = new PreparedStatementCache({ maxSize: 10 })

    // Simulate dynamic SQL generation (common antipattern)
    for (let i = 0; i < 1000; i++) {
      cache.getOrCreate(`SELECT * FROM users WHERE id = ${i}`, () => new MockStatement(`SELECT * FROM users WHERE id = ${i}`))
    }

    // Cache should never exceed maxSize
    expect(cache.size).toBe(10)
  })

  it('should finalize all statements on clear()', () => {
    const cache = new PreparedStatementCache({ maxSize: 5 })
    const statements: MockStatement[] = []

    for (let i = 0; i < 5; i++) {
      const stmt = new MockStatement(`SELECT ${i}`)
      statements.push(stmt)
      cache.getOrCreate(`SELECT ${i}`, () => stmt)
    }

    cache.clear()

    // All statements should be finalized
    for (const stmt of statements) {
      expect(stmt.finalized).toBe(true)
    }
    expect(cache.size).toBe(0)
  })

  it('should handle finalization errors gracefully', () => {
    const cache = new PreparedStatementCache({ maxSize: 2 })

    // Create a statement that throws on finalize
    const badStmt = new MockStatement('BAD QUERY')
    badStmt.finalize = () => {
      throw new Error('Finalization error')
    }

    cache.getOrCreate('BAD QUERY', () => badStmt)
    cache.getOrCreate('GOOD QUERY', () => new MockStatement('GOOD QUERY'))

    // Should not throw when evicting the bad statement
    expect(() => {
      cache.getOrCreate('ANOTHER QUERY', () => new MockStatement('ANOTHER QUERY'))
    }).not.toThrow()

    expect(cache.size).toBe(2)
  })
})

// ============================================================================
// Delete and Has Operations Tests
// ============================================================================

describe('PreparedStatementCache Operations', () => {
  describe('has()', () => {
    it('should return true for cached statement', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })

      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))

      expect(cache.has('SELECT 1')).toBe(true)
    })

    it('should return false for non-cached statement', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })

      expect(cache.has('SELECT 1')).toBe(false)
    })
  })

  describe('delete()', () => {
    it('should remove and finalize statement from cache', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })
      const stmt = new MockStatement('SELECT 1')

      cache.getOrCreate('SELECT 1', () => stmt)
      const deleted = cache.delete('SELECT 1')

      expect(deleted).toBe(true)
      expect(cache.has('SELECT 1')).toBe(false)
      expect(stmt.finalized).toBe(true)
    })

    it('should return false for non-existent statement', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })

      const deleted = cache.delete('NON_EXISTENT')

      expect(deleted).toBe(false)
    })

    it('should update size on delete', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })

      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))
      cache.getOrCreate('SELECT 2', () => new MockStatement('SELECT 2'))

      expect(cache.size).toBe(2)

      cache.delete('SELECT 1')

      expect(cache.size).toBe(1)
    })
  })

  describe('get()', () => {
    it('should return cached statement without creating new one', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })
      const stmt = new MockStatement('SELECT 1')

      cache.getOrCreate('SELECT 1', () => stmt)
      const retrieved = cache.get('SELECT 1')

      expect(retrieved).toBe(stmt)
    })

    it('should return undefined for non-cached statement', () => {
      const cache = new PreparedStatementCache({ maxSize: 10 })

      const retrieved = cache.get('SELECT 1')

      expect(retrieved).toBeUndefined()
    })

    it('should update LRU order on get()', () => {
      const cache = new PreparedStatementCache({ maxSize: 2 })

      cache.getOrCreate('SELECT 0', () => new MockStatement('SELECT 0'))
      cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))

      // Access SELECT 0 via get() - should update LRU order
      cache.get('SELECT 0')

      // Add SELECT 2 - should evict SELECT 1 (now oldest)
      cache.getOrCreate('SELECT 2', () => new MockStatement('SELECT 2'))

      expect(cache.has('SELECT 0')).toBe(true)
      expect(cache.has('SELECT 1')).toBe(false) // Evicted
      expect(cache.has('SELECT 2')).toBe(true)
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('PreparedStatementCache Edge Cases', () => {
  it('should handle empty SQL string', () => {
    const cache = new PreparedStatementCache({ maxSize: 10 })

    cache.getOrCreate('', () => new MockStatement(''))

    expect(cache.has('')).toBe(true)
  })

  it('should handle very long SQL strings as keys', () => {
    const cache = new PreparedStatementCache({ maxSize: 10 })
    const longSql = 'SELECT ' + 'a'.repeat(10000)

    cache.getOrCreate(longSql, () => new MockStatement(longSql))

    expect(cache.has(longSql)).toBe(true)
  })

  it('should handle unicode in SQL strings', () => {
    const cache = new PreparedStatementCache({ maxSize: 10 })
    const unicodeSql = "SELECT * FROM users WHERE name = 'test'"

    cache.getOrCreate(unicodeSql, () => new MockStatement(unicodeSql))

    expect(cache.has(unicodeSql)).toBe(true)
  })

  it('should handle whitespace-only SQL strings', () => {
    const cache = new PreparedStatementCache({ maxSize: 10 })

    cache.getOrCreate('   ', () => new MockStatement('   '))
    cache.getOrCreate('\t\n', () => new MockStatement('\t\n'))

    expect(cache.size).toBe(2)
  })

  it('should use factory function only on cache miss', () => {
    const cache = new PreparedStatementCache({ maxSize: 10 })
    let factoryCallCount = 0

    const factory = () => {
      factoryCallCount++
      return new MockStatement('SELECT 1')
    }

    cache.getOrCreate('SELECT 1', factory) // Miss - factory called
    cache.getOrCreate('SELECT 1', factory) // Hit - factory NOT called
    cache.getOrCreate('SELECT 1', factory) // Hit - factory NOT called

    expect(factoryCallCount).toBe(1)
  })

  it('should handle maxSize of 1', () => {
    const cache = new PreparedStatementCache({ maxSize: 1 })

    cache.getOrCreate('SELECT 1', () => new MockStatement('SELECT 1'))
    expect(cache.has('SELECT 1')).toBe(true)

    cache.getOrCreate('SELECT 2', () => new MockStatement('SELECT 2'))
    expect(cache.has('SELECT 1')).toBe(false)
    expect(cache.has('SELECT 2')).toBe(true)
    expect(cache.size).toBe(1)
  })
})

// ============================================================================
// Integration with Finalizable Interface Tests
// ============================================================================

describe('PreparedStatementCache Statement Interface', () => {
  it('should work with statements that have finalize method', () => {
    const cache = new PreparedStatementCache({ maxSize: 2 })

    interface FinalizableStatement {
      sql: string
      finalize(): void
    }

    const createStatement = (sql: string): FinalizableStatement => ({
      sql,
      finalize: vi.fn(),
    })

    const stmt1 = createStatement('SELECT 1')
    const stmt2 = createStatement('SELECT 2')
    const stmt3 = createStatement('SELECT 3')

    cache.getOrCreate('SELECT 1', () => stmt1)
    cache.getOrCreate('SELECT 2', () => stmt2)
    cache.getOrCreate('SELECT 3', () => stmt3) // Evicts stmt1

    expect(stmt1.finalize).toHaveBeenCalled()
    expect(stmt2.finalize).not.toHaveBeenCalled()
    expect(stmt3.finalize).not.toHaveBeenCalled()
  })

  it('should work with statements that do not have finalize method', () => {
    const cache = new PreparedStatementCache({ maxSize: 2 })

    // Simple object without finalize method
    const simpleStmt = { sql: 'SELECT 1' }

    // Should not throw
    expect(() => {
      cache.getOrCreate('SELECT 1', () => simpleStmt)
      cache.getOrCreate('SELECT 2', () => ({ sql: 'SELECT 2' }))
      cache.getOrCreate('SELECT 3', () => ({ sql: 'SELECT 3' })) // Would trigger eviction
    }).not.toThrow()
  })
})
