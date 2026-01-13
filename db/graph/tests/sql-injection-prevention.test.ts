/**
 * SQL Injection Prevention Tests - SQLiteGraphStore.createRelationship
 *
 * TDD RED Phase: These tests expose SQL injection vulnerabilities in the current
 * SQLiteGraphStore implementation, specifically in createRelationship().
 *
 * @see dotdo-lajn3 - [RED] SQL Injection Prevention Tests - sqlite.ts createRelationship
 *
 * The current vulnerable code at db/graph/stores/sqlite.ts:343-353 uses string
 * concatenation instead of parameterized queries:
 *
 * ```typescript
 * this.sqlite!.exec(`
 *   INSERT INTO relationships (id, verb, "from", "to", data, created_at)
 *   VALUES (
 *     '${input.id.replace(/'/g, "''")}'...  // String concatenation!
 *   )
 * `)
 * ```
 *
 * This pattern is vulnerable to SQL injection even with quote escaping because:
 * 1. The escape pattern only handles single quotes, not all injection vectors
 * 2. Other characters like backslashes, null bytes, and Unicode can break escaping
 * 3. Multi-statement execution with exec() allows DROP TABLE attacks
 *
 * Test Strategy:
 * - Tests verify that malicious input does NOT corrupt or destroy data
 * - Tests should FAIL on current implementation (proving vulnerability)
 * - Tests will PASS when fixed with parameterized queries
 *
 * NO MOCKS - Uses real SQLite in-memory database per project testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores/sqlite'
import type { GraphStore, CreateRelationshipInput, GraphRelationship } from '../types'

// ============================================================================
// SQL INJECTION TEST SUITE
// ============================================================================

describe('SQL Injection Prevention - createRelationship', () => {
  let store: GraphStore & { close?: () => void }

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await (store as SQLiteGraphStore).initialize()

    // Pre-populate with a known relationship to verify it survives attacks
    await store.createRelationship({
      id: 'existing-rel-1',
      verb: 'references',
      from: 'do://tenant/things/source',
      to: 'do://tenant/things/target',
    })
  })

  afterEach(async () => {
    if (store.close) {
      store.close()
    }
  })

  // ==========================================================================
  // 1. SPECIAL CHARACTERS IN ID FIELD
  // ==========================================================================

  describe('Special characters in relationship ID', () => {
    it('handles single quotes in ID safely', async () => {
      const rel = await store.createRelationship({
        id: "rel-with-'quotes'",
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })

      expect(rel.id).toBe("rel-with-'quotes'")

      // Verify the relationship can be queried back
      const results = await store.queryRelationshipsFrom('do://a/1')
      expect(results.some((r) => r.id === "rel-with-'quotes'")).toBe(true)
    })

    it('handles double quotes in ID safely', async () => {
      const rel = await store.createRelationship({
        id: 'rel-with-"double-quotes"',
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })

      expect(rel.id).toBe('rel-with-"double-quotes"')
    })

    it('handles backslashes in ID safely', async () => {
      const rel = await store.createRelationship({
        id: 'rel-with-\\backslash',
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })

      expect(rel.id).toBe('rel-with-\\backslash')
    })

    it('handles null bytes in ID safely', async () => {
      const rel = await store.createRelationship({
        id: 'rel-with-\x00-null',
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })

      expect(rel.id).toBe('rel-with-\x00-null')
    })
  })

  // ==========================================================================
  // 2. SQL INJECTION PAYLOAD TESTS
  // ==========================================================================

  describe('SQL injection payload attacks', () => {
    it('prevents DROP TABLE attack via ID field', async () => {
      // This is the classic SQL injection attack
      const maliciousId = "'; DROP TABLE relationships; --"

      // The vulnerable code would execute:
      // INSERT INTO relationships (...) VALUES (''; DROP TABLE relationships; --', ...)
      // Which would drop the table

      // With proper parameterization, this should just store the string as-is
      const rel = await store.createRelationship({
        id: maliciousId,
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })

      expect(rel.id).toBe(maliciousId)

      // CRITICAL: Verify the existing relationship still exists (table wasn't dropped)
      const existing = await store.queryRelationshipsFrom('do://tenant/things/source')
      expect(existing.some((r) => r.id === 'existing-rel-1')).toBe(true)
    })

    it('prevents DROP TABLE attack via verb field', async () => {
      const maliciousVerb = "'; DROP TABLE relationships; --"

      const rel = await store.createRelationship({
        id: 'test-rel-verb',
        verb: maliciousVerb,
        from: 'do://a/1',
        to: 'do://b/2',
      })

      expect(rel.verb).toBe(maliciousVerb)

      // Verify table still exists
      const existing = await store.queryRelationshipsFrom('do://tenant/things/source')
      expect(existing.some((r) => r.id === 'existing-rel-1')).toBe(true)
    })

    it('prevents DROP TABLE attack via from field', async () => {
      const maliciousFrom = "'; DROP TABLE relationships; --"

      const rel = await store.createRelationship({
        id: 'test-rel-from',
        verb: 'links',
        from: maliciousFrom,
        to: 'do://b/2',
      })

      expect(rel.from).toBe(maliciousFrom)

      // Verify table still exists
      const existing = await store.queryRelationshipsFrom('do://tenant/things/source')
      expect(existing.some((r) => r.id === 'existing-rel-1')).toBe(true)
    })

    it('prevents DROP TABLE attack via to field', async () => {
      const maliciousTo = "'; DROP TABLE relationships; --"

      const rel = await store.createRelationship({
        id: 'test-rel-to',
        verb: 'links',
        from: 'do://a/1',
        to: maliciousTo,
      })

      expect(rel.to).toBe(maliciousTo)

      // Verify table still exists
      const existing = await store.queryRelationshipsFrom('do://tenant/things/source')
      expect(existing.some((r) => r.id === 'existing-rel-1')).toBe(true)
    })

    it('prevents DROP TABLE attack via data field JSON', async () => {
      const maliciousData = { key: "'; DROP TABLE relationships; --" }

      const rel = await store.createRelationship({
        id: 'test-rel-data',
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
        data: maliciousData,
      })

      expect(rel.data).toEqual(maliciousData)

      // Verify table still exists
      const existing = await store.queryRelationshipsFrom('do://tenant/things/source')
      expect(existing.some((r) => r.id === 'existing-rel-1')).toBe(true)
    })

    it('prevents UPDATE attack to modify existing data', async () => {
      // Try to break out and update existing records
      const maliciousId = "x'; UPDATE relationships SET verb='hacked' WHERE id='existing-rel-1'; --"

      await store.createRelationship({
        id: maliciousId,
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })

      // Verify original relationship was NOT modified
      const existing = await store.queryRelationshipsFrom('do://tenant/things/source')
      const originalRel = existing.find((r) => r.id === 'existing-rel-1')
      expect(originalRel).toBeDefined()
      expect(originalRel!.verb).toBe('references') // Not 'hacked'
    })

    it('prevents SELECT attack to leak data via error messages', async () => {
      // Attempt to extract data via subquery injection
      const maliciousId = "x' || (SELECT id FROM relationships LIMIT 1) || '"

      // This should either work and store the literal string, or fail safely
      // It should NOT return data from other rows in error messages
      try {
        const rel = await store.createRelationship({
          id: maliciousId,
          verb: 'links',
          from: 'do://a/1',
          to: 'do://b/2',
        })
        // If it succeeds, the string should be stored literally
        expect(rel.id).toBe(maliciousId)
      } catch (error) {
        // If it fails, the error message should NOT contain 'existing-rel-1'
        const errorMessage = error instanceof Error ? error.message : String(error)
        expect(errorMessage).not.toContain('existing-rel-1')
      }
    })
  })

  // ==========================================================================
  // 3. UNICODE AND BINARY DATA TESTS
  // ==========================================================================

  describe('Unicode and binary data handling', () => {
    it('handles Unicode characters in all fields safely', async () => {
      const rel = await store.createRelationship({
        id: 'rel-\u4e2d\u6587-unicode', // Chinese characters
        verb: '\u2764\ufe0f-loves', // Heart emoji
        from: 'do://\u00e4\u00f6\u00fc/path', // German umlauts
        to: 'do://\u0440\u0443\u0441\u0441\u043a\u0438\u0439/target', // Russian
        data: { message: '\u{1F600}' }, // Emoji in data
      })

      expect(rel.id).toBe('rel-\u4e2d\u6587-unicode')
      expect(rel.verb).toBe('\u2764\ufe0f-loves')
      expect(rel.from).toBe('do://\u00e4\u00f6\u00fc/path')
      expect(rel.to).toBe('do://\u0440\u0443\u0441\u0441\u043a\u0438\u0439/target')
    })

    it('handles mixed quote and Unicode attacks', async () => {
      // Combining Unicode with SQL injection
      const maliciousId = "rel-\u4e2d\u6587'; DROP TABLE relationships; --"

      const rel = await store.createRelationship({
        id: maliciousId,
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })

      expect(rel.id).toBe(maliciousId)

      // Table must still exist
      const existing = await store.queryRelationshipsFrom('do://tenant/things/source')
      expect(existing.some((r) => r.id === 'existing-rel-1')).toBe(true)
    })

    it('handles percent-encoded injection attempts', async () => {
      // %27 is URL-encoded single quote
      const maliciousId = "rel-%27; DROP TABLE relationships; --"

      const rel = await store.createRelationship({
        id: maliciousId,
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })

      expect(rel.id).toBe(maliciousId)

      // Table must still exist
      const existing = await store.queryRelationshipsFrom('do://tenant/things/source')
      expect(existing.some((r) => r.id === 'existing-rel-1')).toBe(true)
    })
  })

  // ==========================================================================
  // 4. ERROR MESSAGE SAFETY
  // ==========================================================================

  describe('Error message safety', () => {
    it('error messages do not leak SQL structure on duplicate key', async () => {
      // First, create a relationship
      await store.createRelationship({
        id: 'unique-test-rel',
        verb: 'connects',
        from: 'do://source/1',
        to: 'do://target/1',
      })

      // Try to create duplicate - this should fail due to unique constraint
      try {
        await store.createRelationship({
          id: 'different-id', // Different ID but same verb+from+to
          verb: 'connects',
          from: 'do://source/1',
          to: 'do://target/1',
        })
        // Should not reach here
        expect.fail('Should have thrown an error for duplicate key')
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        // Error message should be user-friendly, not expose SQL internals
        expect(errorMessage).not.toContain('INSERT INTO relationships')
        expect(errorMessage).not.toContain('VALUES')
        // It should mention what's actually wrong
        expect(errorMessage.toLowerCase()).toContain('already exists')
      }
    })

    it('error messages do not leak table schema on malformed input', async () => {
      // Try an extremely long string that might cause buffer overflow or truncation error
      const veryLongId = 'x'.repeat(100000)

      try {
        await store.createRelationship({
          id: veryLongId,
          verb: 'links',
          from: 'do://a/1',
          to: 'do://b/2',
        })
        // If it succeeds, that's fine too
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        // Should not expose internal schema details
        expect(errorMessage).not.toContain('CREATE TABLE')
        expect(errorMessage).not.toContain('id TEXT PRIMARY KEY')
      }
    })
  })

  // ==========================================================================
  // 5. COMBINED ATTACK VECTORS
  // ==========================================================================

  describe('Combined and advanced attack vectors', () => {
    it('handles comment injection in middle of string', async () => {
      // This attempts to comment out part of the SQL
      const maliciousId = "start/* comment */'; DROP TABLE relationships; --"

      const rel = await store.createRelationship({
        id: maliciousId,
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })

      expect(rel.id).toBe(maliciousId)

      // Table must still exist
      const existing = await store.queryRelationshipsFrom('do://tenant/things/source')
      expect(existing.some((r) => r.id === 'existing-rel-1')).toBe(true)
    })

    it('handles semicolon without DROP for statement stacking', async () => {
      // Simpler statement stacking - just try to insert extra record
      const maliciousId = "x', 'injected', 'from', 'to', NULL, 1234); INSERT INTO relationships VALUES ('hacked"

      const rel = await store.createRelationship({
        id: maliciousId,
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })

      expect(rel.id).toBe(maliciousId)

      // Verify no extra 'hacked' record was created
      const results = await store.queryRelationshipsByVerb('injected')
      expect(results.length).toBe(0)
    })

    it('handles UNION-based injection attempts', async () => {
      // UNION-based injection attempt
      const maliciousId = "x' UNION SELECT * FROM relationships WHERE '"

      const rel = await store.createRelationship({
        id: maliciousId,
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })

      expect(rel.id).toBe(maliciousId)
    })

    it('handles boolean-based blind injection attempts', async () => {
      // Boolean-based blind SQL injection test
      const maliciousId = "x' AND 1=1--"

      const rel = await store.createRelationship({
        id: maliciousId,
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })

      // Should store literally, not evaluate the condition
      expect(rel.id).toBe(maliciousId)
    })

    it('handles time-based blind injection attempts', async () => {
      // Note: SQLite doesn't have SLEEP() but this tests the pattern
      // In real attacks, this would be WAITFOR DELAY or SLEEP()
      const maliciousId = "x'; SELECT CASE WHEN (1=1) THEN sqlite3_sleep(5000) END; --"

      const start = Date.now()
      const rel = await store.createRelationship({
        id: maliciousId,
        verb: 'links',
        from: 'do://a/1',
        to: 'do://b/2',
      })
      const elapsed = Date.now() - start

      expect(rel.id).toBe(maliciousId)
      // Operation should not be delayed by injected sleep
      expect(elapsed).toBeLessThan(1000)
    })

    it('handles all fields with injection payloads simultaneously', async () => {
      const rel = await store.createRelationship({
        id: "id'; DROP TABLE relationships; --",
        verb: "verb'; DELETE FROM relationships; --",
        from: "from'; TRUNCATE relationships; --",
        to: "to'; ALTER TABLE relationships; --",
        data: { inject: "'; DROP TABLE things; --" },
      })

      expect(rel.id).toBe("id'; DROP TABLE relationships; --")
      expect(rel.verb).toBe("verb'; DELETE FROM relationships; --")
      expect(rel.from).toBe("from'; TRUNCATE relationships; --")
      expect(rel.to).toBe("to'; ALTER TABLE relationships; --")

      // All tables should still exist
      const existing = await store.queryRelationshipsFrom('do://tenant/things/source')
      expect(existing.some((r) => r.id === 'existing-rel-1')).toBe(true)
    })
  })
})
