/**
 * Business Class Integration Tests - Real Durable Objects with Miniflare
 *
 * Tests for the Business class (inherits from DO) with OKRs/Goals API.
 * ProductsAPI and ServicesAPI were removed as redundant CRUD wrappers
 * since $.Entity now provides typed access.
 *
 * NO MOCKS - per CLAUDE.md:
 * - Real miniflare runtime
 * - Real SQLite storage
 * - Real DO instances via env bindings
 *
 * @module business/tests/business.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface HealthResponse {
  status: string
  id: string
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a fresh Business DO stub for testing
 */
function getStub(name?: string) {
  const testName = name ?? generateTestId()
  const id = env.BUSINESS.idFromName(testName)
  return env.BUSINESS.get(id)
}

/**
 * Make an RPC call to the DO
 */
async function rpc<T>(stub: DurableObjectStub, method: string, args: unknown[] = []): Promise<T> {
  const response = await stub.fetch('https://business/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  })

  // Handle void responses (delete, remove operations return no content)
  const text = await response.text()
  if (!text) {
    return undefined as unknown as T
  }
  return JSON.parse(text) as T
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Business Class', () => {
  describe('Business class initialization', () => {
    it('should respond to GET / health check', async () => {
      const stub = getStub()
      const response = await stub.fetch('https://business/')

      expect(response.status).toBe(200)
      const json = (await response.json()) as HealthResponse
      expect(json.status).toBe('ok')
      expect(json.id).toBeDefined()
    })

    it('should inherit from DO and have working things store', async () => {
      const stub = getStub()

      // Verify things store works (inherited from DO)
      const thing = await rpc<{ $id: string; $type: string }>(stub, 'things.create', [
        { $type: 'TestEntity', name: 'Test' }
      ])

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('TestEntity')
    })
  })

  // Note: ProductsAPI and ServicesAPI tests were removed.
  // These APIs were redundant CRUD wrappers that have been removed
  // in favor of the unified schema approach via $.Entity.
  // See issue do-lekf.6 for details.
})
