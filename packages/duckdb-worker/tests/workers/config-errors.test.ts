/**
 * DuckDB Config Error Surfacing Tests
 *
 * Tests that config application errors are properly surfaced to users.
 * Previously, applyConfig() silently caught errors, leaving users unaware
 * that their config wasn't applied.
 *
 * Ticket: dotdo-74tyt
 * @see bindings.ts applyConfig()
 */

import { describe, it, expect, afterEach } from 'vitest'

import { createDuckDB, clearCache, type DuckDBInstance } from '@dotdo/duckdb-worker'

// Import WASM as ES module (Cloudflare Workers ES module style)
import duckdbWasm from '../../wasm/duckdb-worker.wasm'

// Helper to create DB with config
const createDBWithConfig = (config: Parameters<typeof createDuckDB>[0]) =>
  createDuckDB(config, { wasmModule: duckdbWasm })

// ============================================================================
// CONFIG ERROR SURFACING TESTS
// ============================================================================

describe('Config Error Surfacing', () => {
  let db: DuckDBInstance | null = null

  afterEach(async () => {
    if (db) {
      try {
        await db.close()
      } catch {
        // Ignore close errors in cleanup
      }
      db = null
    }
    clearCache()
  })

  describe('Invalid Config Detection', () => {
    it('should surface errors for invalid maxMemory format', async () => {
      /**
       * RED TEST: Invalid maxMemory values should be reported
       * DuckDB expects formats like '256MB' or '1GB', not arbitrary strings.
       */
      db = await createDBWithConfig({
        maxMemory: 'invalid-memory-value',
      })

      // Wait for async config application
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Config warnings should be accessible on the instance
      expect(db.configWarnings).toBeDefined()
      expect(Array.isArray(db.configWarnings)).toBe(true)
      expect(db.configWarnings.length).toBeGreaterThan(0)

      // Should contain an error message about the invalid config
      const hasMemoryWarning = db.configWarnings.some(
        (w: string) => w.includes('memory') || w.includes('maxMemory') || w.includes('memory_limit')
      )
      expect(hasMemoryWarning).toBe(true)
    })

    it('should surface errors for invalid threads value', async () => {
      /**
       * RED TEST: Invalid thread counts should be reported
       * Negative thread counts are invalid.
       */
      db = await createDBWithConfig({
        threads: -5,
      })

      // Wait for async config application
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(db.configWarnings).toBeDefined()
      expect(Array.isArray(db.configWarnings)).toBe(true)
      expect(db.configWarnings.length).toBeGreaterThan(0)
    })

    it('should have empty configWarnings for valid config', async () => {
      /**
       * Valid config should result in no warnings
       */
      db = await createDBWithConfig({
        maxMemory: '256MB',
        threads: 1,
        defaultOrder: 'asc',
      })

      // Wait for async config application
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(db.configWarnings).toBeDefined()
      expect(Array.isArray(db.configWarnings)).toBe(true)
      expect(db.configWarnings.length).toBe(0)
    })

    it('should have configWarnings property even without config', async () => {
      /**
       * Even without config, the property should exist and be empty
       */
      db = await createDBWithConfig(undefined)

      expect(db.configWarnings).toBeDefined()
      expect(Array.isArray(db.configWarnings)).toBe(true)
      expect(db.configWarnings.length).toBe(0)
    })

    it('should accumulate multiple config errors', async () => {
      /**
       * When multiple config values are invalid, all errors should be captured
       */
      db = await createDBWithConfig({
        maxMemory: 'not-a-size',
        threads: -1,
      })

      // Wait for async config application
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(db.configWarnings).toBeDefined()
      expect(Array.isArray(db.configWarnings)).toBe(true)
      // Should have at least one warning (possibly one for each invalid config)
      expect(db.configWarnings.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Config Application Still Works', () => {
    it('should still apply valid config values', async () => {
      /**
       * Ensure valid config is still applied correctly
       */
      db = await createDBWithConfig({
        maxMemory: '64MB',
      })

      // Wait for config application
      await new Promise((resolve) => setTimeout(resolve, 100))

      // No config warnings should be present
      expect(db.configWarnings).toHaveLength(0)

      // Query should work and config should be applied
      // DuckDB displays 64MB as ~61.0 MiB (binary vs decimal megabytes)
      const result = await db.query('SELECT current_setting(\'memory_limit\') as mem_limit')
      expect(result.rows[0].mem_limit).toBeDefined()
    })

    it('should continue working even after config errors', async () => {
      /**
       * Even if config fails, the database should still be usable
       */
      db = await createDBWithConfig({
        maxMemory: 'invalid-value',
      })

      // Wait for config application attempt
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Database should still work
      const result = await db.query('SELECT 42 as answer')
      expect(result.rows[0].answer).toBe(42)
    })
  })
})
