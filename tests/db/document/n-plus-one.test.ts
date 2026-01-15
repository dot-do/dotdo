/**
 * N+1 Query Detection Tests - RED Phase
 *
 * This file tests that batch operations (updateMany, deleteMany) use efficient
 * single SQL statements rather than N+1 query patterns.
 *
 * N+1 Problem Pattern (current implementation):
 * ```typescript
 * const docs = await this.query(filter)  // 1 query
 * for (const doc of docs) {
 *   await this.updateInTransaction(doc.$id, updates)  // N queries (each does get + update)
 * }
 * ```
 *
 * Expected Pattern:
 * ```typescript
 * // Single UPDATE with WHERE clause
 * UPDATE documents SET data = json_set(data, '$.status', 'updated')
 * WHERE "$type" = 'Customer' AND json_extract(data, '$.tier') = 'free'
 * ```
 *
 * TDD RED Phase: These tests should FAIL until the implementation is optimized.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { DocumentStore } from '../../../db/document'

// ============================================================================
// TEST TYPES
// ============================================================================

interface Customer {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  $version: number
  name: string
  email: string
  tier?: string
  status?: string
}

// ============================================================================
// SQL QUERY COUNTER
// ============================================================================

/**
 * Wraps a SQLite database to count SQL query executions.
 * This allows us to detect N+1 query patterns.
 */
function createQueryCounter(sqlite: Database.Database) {
  let queryCount = 0
  let queries: string[] = []

  // Wrap the prepare method to count queries
  const originalPrepare = sqlite.prepare.bind(sqlite)
  sqlite.prepare = function (sql: string) {
    queryCount++
    queries.push(sql)
    return originalPrepare(sql)
  }

  // Wrap exec for direct SQL execution
  const originalExec = sqlite.exec.bind(sqlite)
  sqlite.exec = function (sql: string) {
    // Don't count transaction control statements
    if (!sql.match(/^(BEGIN|COMMIT|ROLLBACK)/i)) {
      queryCount++
      queries.push(sql)
    }
    return originalExec(sql)
  }

  return {
    get count() {
      return queryCount
    },
    get queries() {
      return [...queries]
    },
    reset() {
      queryCount = 0
      queries = []
    },
    /**
     * Filter queries by pattern (e.g., 'UPDATE', 'DELETE', 'SELECT')
     */
    countByPattern(pattern: RegExp): number {
      return queries.filter((q) => pattern.test(q)).length
    },
  }
}

// ============================================================================
// TEST SETUP
// ============================================================================

describe('N+1 Query Detection - RED Phase', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle>
  let docs: DocumentStore<Customer>
  let counter: ReturnType<typeof createQueryCounter>

  beforeEach(() => {
    sqlite = new Database(':memory:')

    // Create documents table
    sqlite.exec(`
      CREATE TABLE documents (
        "$id" TEXT PRIMARY KEY,
        "$type" TEXT NOT NULL,
        data JSON NOT NULL,
        "$createdAt" INTEGER NOT NULL,
        "$updatedAt" INTEGER NOT NULL,
        "$version" INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX idx_documents_type ON documents("$type");
      CREATE INDEX idx_documents_updated ON documents("$updatedAt");
    `)

    // Set up query counter AFTER table creation
    counter = createQueryCounter(sqlite)

    db = drizzle(sqlite)
    docs = new DocumentStore<Customer>(db, {
      type: 'Customer',
    })
  })

  afterEach(() => {
    sqlite.close()
  })

  // ============================================================================
  // updateMany N+1 DETECTION
  // ============================================================================

  describe('updateMany() query efficiency', () => {
    const DOCUMENT_COUNT = 100

    beforeEach(async () => {
      // Create test documents
      const inputs = Array.from({ length: DOCUMENT_COUNT }, (_, i) => ({
        $id: `cust_${String(i).padStart(3, '0')}`,
        name: `Customer ${i}`,
        email: `customer${i}@example.com`,
        tier: 'free',
        status: 'active',
      }))

      await docs.createMany(inputs)

      // Reset counter after setup
      counter.reset()
    })

    it('should use O(1) SQL statements, not O(n)', async () => {
      // Update all 100 documents with tier='free'
      const updatedCount = await docs.updateMany(
        { where: { tier: 'free' } },
        { tier: 'premium' }
      )

      expect(updatedCount).toBe(DOCUMENT_COUNT)

      // N+1 pattern would execute:
      // - 1 SELECT to find matching docs
      // - N SELECT queries (one per doc in updateInTransaction -> get)
      // - N UPDATE queries (one per doc)
      // Total: 1 + 2N queries = 201 queries for N=100

      // Optimal pattern should execute:
      // - 1 SELECT to find matching docs (or could be eliminated)
      // - 1 UPDATE with WHERE clause
      // Total: 2 queries (or even 1 if UPDATE returns count)

      // We allow some leeway for the query + begin/commit overhead
      // but should be WAY less than 2*N queries
      const maxAllowedQueries = 10 // Very generous upper bound for O(1)

      console.log(`Query count for updateMany(${DOCUMENT_COUNT}): ${counter.count}`)
      console.log(`UPDATE queries: ${counter.countByPattern(/UPDATE/i)}`)
      console.log(`SELECT queries: ${counter.countByPattern(/SELECT/i)}`)

      // This assertion should FAIL with current N+1 implementation
      expect(counter.count).toBeLessThanOrEqual(maxAllowedQueries)
    })

    it('should execute exactly 1 UPDATE statement regardless of document count', async () => {
      await docs.updateMany(
        { where: { tier: 'free' } },
        { status: 'migrated' }
      )

      const updateCount = counter.countByPattern(/UPDATE/i)

      console.log(`UPDATE statements for ${DOCUMENT_COUNT} docs: ${updateCount}`)

      // This should FAIL - current implementation does N updates
      expect(updateCount).toBe(1)
    })

    it('should scale O(1) not O(n) as document count increases', async () => {
      // First, update with 100 documents
      counter.reset()
      await docs.updateMany(
        { where: { tier: 'free' } },
        { tier: 'basic' }
      )
      const queriesFor100 = counter.count

      // Reset and add 100 more documents
      const moreInputs = Array.from({ length: 100 }, (_, i) => ({
        $id: `cust_extra_${String(i).padStart(3, '0')}`,
        name: `Extra Customer ${i}`,
        email: `extra${i}@example.com`,
        tier: 'basic', // These now have 'basic' tier
        status: 'active',
      }))
      await docs.createMany(moreInputs)

      // Update all 200 documents with tier='basic'
      counter.reset()
      await docs.updateMany(
        { where: { tier: 'basic' } },
        { tier: 'premium' }
      )
      const queriesFor200 = counter.count

      console.log(`Queries for 100 docs: ${queriesFor100}`)
      console.log(`Queries for 200 docs: ${queriesFor200}`)

      // O(1) scaling: query count should be roughly the same
      // O(n) scaling: query count would double (200 vs 100)
      // We allow 50% variance for O(1) operations
      const scalingFactor = queriesFor200 / queriesFor100

      // This should FAIL with N+1 implementation (scaling factor ~2.0)
      expect(scalingFactor).toBeLessThan(1.5)
    })

    it('should not call get() for each document during updateMany', async () => {
      // Spy on the internal query counter for SELECT statements
      counter.reset()

      await docs.updateMany(
        { where: { tier: 'free' } },
        { tier: 'updated' }
      )

      // Count SELECT queries (used by get() internally)
      // N+1 pattern: 1 initial query + N get() calls = N+1 SELECTs
      const selectCount = counter.countByPattern(/SELECT/i)

      console.log(`SELECT queries for updateMany(${DOCUMENT_COUNT}): ${selectCount}`)

      // Should be at most 1 SELECT (to find matching docs) or even 0 if optimized
      // This should FAIL - current implementation does N+1 SELECTs
      expect(selectCount).toBeLessThanOrEqual(1)
    })
  })

  // ============================================================================
  // deleteMany N+1 DETECTION
  // ============================================================================

  describe('deleteMany() query efficiency', () => {
    const DOCUMENT_COUNT = 100

    beforeEach(async () => {
      // Create test documents
      const inputs = Array.from({ length: DOCUMENT_COUNT }, (_, i) => ({
        $id: `del_${String(i).padStart(3, '0')}`,
        name: `ToDelete ${i}`,
        email: `delete${i}@example.com`,
        tier: 'temporary',
        status: 'pending',
      }))

      await docs.createMany(inputs)

      // Reset counter after setup
      counter.reset()
    })

    it('should use O(1) SQL statements, not O(n)', async () => {
      const deletedCount = await docs.deleteMany({
        where: { tier: 'temporary' },
      })

      expect(deletedCount).toBe(DOCUMENT_COUNT)

      // N+1 pattern would execute:
      // - 1 SELECT to find matching docs
      // - N SELECT queries (one per doc in deleteInTransaction -> get)
      // - N DELETE queries (one per doc)
      // Total: 1 + 2N queries = 201 queries for N=100

      // Optimal pattern should execute:
      // - 1 DELETE with WHERE clause (can return count)
      // Total: 1 query

      const maxAllowedQueries = 10

      console.log(`Query count for deleteMany(${DOCUMENT_COUNT}): ${counter.count}`)
      console.log(`DELETE queries: ${counter.countByPattern(/DELETE/i)}`)
      console.log(`SELECT queries: ${counter.countByPattern(/SELECT/i)}`)

      // This assertion should FAIL with current N+1 implementation
      expect(counter.count).toBeLessThanOrEqual(maxAllowedQueries)
    })

    it('should execute exactly 1 DELETE statement regardless of document count', async () => {
      await docs.deleteMany({
        where: { tier: 'temporary' },
      })

      const deleteCount = counter.countByPattern(/DELETE/i)

      console.log(`DELETE statements for ${DOCUMENT_COUNT} docs: ${deleteCount}`)

      // This should FAIL - current implementation does N deletes
      expect(deleteCount).toBe(1)
    })

    it('should scale O(1) not O(n) as document count increases', async () => {
      // Delete first batch
      counter.reset()
      await docs.deleteMany({
        where: { tier: 'temporary' },
      })
      const queriesForBatch1 = counter.count

      // Create 200 more documents
      const moreInputs = Array.from({ length: 200 }, (_, i) => ({
        $id: `del_batch2_${String(i).padStart(3, '0')}`,
        name: `ToDelete Batch2 ${i}`,
        email: `delete_batch2_${i}@example.com`,
        tier: 'temporary',
        status: 'pending',
      }))
      await docs.createMany(moreInputs)

      // Delete second batch (2x the size)
      counter.reset()
      await docs.deleteMany({
        where: { tier: 'temporary' },
      })
      const queriesForBatch2 = counter.count

      console.log(`Queries for 100 deletes: ${queriesForBatch1}`)
      console.log(`Queries for 200 deletes: ${queriesForBatch2}`)

      // O(1) scaling: query count should be roughly the same
      const scalingFactor = queriesForBatch2 / queriesForBatch1

      // This should FAIL with N+1 implementation (scaling factor ~2.0)
      expect(scalingFactor).toBeLessThan(1.5)
    })

    it('should not call get() for each document during deleteMany', async () => {
      counter.reset()

      await docs.deleteMany({
        where: { tier: 'temporary' },
      })

      const selectCount = counter.countByPattern(/SELECT/i)

      console.log(`SELECT queries for deleteMany(${DOCUMENT_COUNT}): ${selectCount}`)

      // Should be at most 1 SELECT or 0 if fully optimized
      // This should FAIL - current implementation does N+1 SELECTs
      expect(selectCount).toBeLessThanOrEqual(1)
    })
  })

  // ============================================================================
  // QUERY COUNT ASSERTIONS
  // ============================================================================

  describe('Query count invariants', () => {
    const SMALL_BATCH = 10
    const LARGE_BATCH = 100

    beforeEach(async () => {
      // Create documents for both batch sizes
      const smallInputs = Array.from({ length: SMALL_BATCH }, (_, i) => ({
        $id: `small_${i}`,
        name: `Small ${i}`,
        email: `small${i}@example.com`,
        tier: 'small',
      }))

      const largeInputs = Array.from({ length: LARGE_BATCH }, (_, i) => ({
        $id: `large_${i}`,
        name: `Large ${i}`,
        email: `large${i}@example.com`,
        tier: 'large',
      }))

      await docs.createMany([...smallInputs, ...largeInputs])
      counter.reset()
    })

    it('updateMany query count should be constant regardless of N', async () => {
      // Update small batch
      counter.reset()
      await docs.updateMany(
        { where: { tier: 'small' } },
        { status: 'updated' }
      )
      const smallBatchQueries = counter.count

      // Update large batch
      counter.reset()
      await docs.updateMany(
        { where: { tier: 'large' } },
        { status: 'updated' }
      )
      const largeBatchQueries = counter.count

      console.log(`Queries for ${SMALL_BATCH} updates: ${smallBatchQueries}`)
      console.log(`Queries for ${LARGE_BATCH} updates: ${largeBatchQueries}`)

      // Query counts should be equal (O(1) behavior)
      // This should FAIL with N+1 implementation
      expect(smallBatchQueries).toBe(largeBatchQueries)
    })

    it('deleteMany query count should be constant regardless of N', async () => {
      // Delete small batch
      counter.reset()
      await docs.deleteMany({ where: { tier: 'small' } })
      const smallBatchQueries = counter.count

      // Recreate small batch for next test
      const recreatedSmall = Array.from({ length: SMALL_BATCH }, (_, i) => ({
        $id: `small_recreated_${i}`,
        name: `Small Recreated ${i}`,
        email: `small_recreated${i}@example.com`,
        tier: 'small',
      }))
      await docs.createMany(recreatedSmall)

      // Delete large batch
      counter.reset()
      await docs.deleteMany({ where: { tier: 'large' } })
      const largeBatchQueries = counter.count

      console.log(`Queries for ${SMALL_BATCH} deletes: ${smallBatchQueries}`)
      console.log(`Queries for ${LARGE_BATCH} deletes: ${largeBatchQueries}`)

      // Query counts should be equal (O(1) behavior)
      // This should FAIL with N+1 implementation
      expect(smallBatchQueries).toBe(largeBatchQueries)
    })

    it('batch operations should never exceed 5 SQL statements', async () => {
      counter.reset()

      await docs.updateMany(
        { where: { tier: 'large' } },
        { status: 'batch_updated' }
      )

      // With proper batching, we should have at most:
      // 1. BEGIN (if transaction)
      // 2. SELECT to find documents (optional)
      // 3. Single bulk UPDATE
      // 4. COMMIT (if transaction)
      // Total: ~4-5 statements max

      console.log(`Total statements for batch update: ${counter.count}`)
      console.log('Statements:', counter.queries.map((q) => q.substring(0, 50) + '...'))

      // This should FAIL with N+1 implementation (would be 200+ statements)
      expect(counter.count).toBeLessThanOrEqual(5)
    })
  })

  // ============================================================================
  // CDC EVENT EFFICIENCY
  // ============================================================================

  describe('CDC event handling efficiency', () => {
    const DOCUMENT_COUNT = 50
    let cdcEvents: Array<{ type: string; key: string }>

    beforeEach(async () => {
      cdcEvents = []

      // Recreate store with CDC tracking
      docs = new DocumentStore<Customer>(db, {
        type: 'Customer',
        onEvent: (event) => {
          cdcEvents.push({ type: event.type, key: event.key })
        },
      })

      const inputs = Array.from({ length: DOCUMENT_COUNT }, (_, i) => ({
        $id: `cdc_${i}`,
        name: `CDC Customer ${i}`,
        email: `cdc${i}@example.com`,
        tier: 'free',
      }))

      await docs.createMany(inputs)
      cdcEvents = [] // Reset after creation
      counter.reset()
    })

    it('should batch CDC events for updateMany (no individual get per doc)', async () => {
      await docs.updateMany(
        { where: { tier: 'free' } },
        { tier: 'paid' }
      )

      // CDC events are fine to emit per-document (that's expected behavior)
      // But the underlying SQL should be batched
      expect(cdcEvents.length).toBe(DOCUMENT_COUNT)

      // The key assertion: SQL queries should be O(1)
      const selectCount = counter.countByPattern(/SELECT/i)
      console.log(`SELECT queries with CDC: ${selectCount}`)

      // This should FAIL - N+1 does a get() for each doc to build CDC event
      expect(selectCount).toBeLessThanOrEqual(1)
    })
  })
})
