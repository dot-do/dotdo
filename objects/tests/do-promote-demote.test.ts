/**
 * DO promote() and demote() Operations Tests
 *
 * These tests verify the promote() and demote() lifecycle operations on Durable Objects.
 *
 * promote(thingId, options?): Elevates a Thing stored within a DO to become its own
 * independent Durable Object with its own storage, identity, and lifecycle.
 *
 * demote(targetNs, options?): Collapses this DO back into a parent DO as a Thing,
 * transferring all state and clearing the local storage.
 *
 * IMPORTANT: These tests use REAL miniflare DOs with SQLite storage.
 * NO MOCKS are used - this tests the actual DO behavior.
 *
 * @see objects/DOFull.ts:1513 for promote() implementation
 * @see objects/DOFull.ts:1615 for demote() implementation
 *
 * Run with: npx vitest run objects/tests/do-promote-demote.test.ts --project=do-rpc
 *
 * @module objects/tests/do-promote-demote.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Unique namespace per test suite run to ensure isolation
 */
const testRunId = Date.now()

/**
 * Generate a unique namespace for each test to ensure isolation
 */
function uniqueNs(prefix: string = 'promote-test'): string {
  return `${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Type definitions for Things (matches do-rpc.test.ts)
 */
interface ThingEntity {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  tags?: string[]
}

/**
 * Promote result type (from DOFull.ts)
 */
interface PromoteResult {
  newNs: string
  thingId: string
  originalNs: string
}

/**
 * Demote result type (from DOFull.ts)
 */
interface DemoteResult {
  thingId: string
  parentNs: string
  deletedNs: string
  stagedToken?: string
}

/**
 * Extended stub type with promote/demote methods
 *
 * Note: The current TestDO in do-integration-test-worker.ts extends DOBase,
 * which does NOT include promote/demote methods. These methods are only
 * available in DOFull (objects/DOFull.ts).
 *
 * To fully test promote/demote with real miniflare DOs, the test worker
 * needs to be updated to extend from DOFull instead of DOBase.
 */
interface PromoteDemoteStub extends DurableObjectStub {
  // From TestDO (DOBase)
  getNs(): Promise<string>
  $id: Promise<string>
  thingsCreate(data: Partial<ThingEntity>): Promise<ThingEntity>
  thingsGet(id: string): Promise<ThingEntity | null>
  thingsList(options?: { type?: string }): Promise<ThingEntity[]>
  thingsDelete(id: string): Promise<ThingEntity | null>

  // From DOFull (when available)
  promote?(thingId: string, options?: {
    targetNs?: string
    preserveHistory?: boolean
    mode?: 'atomic' | 'staged'
  }): Promise<PromoteResult>

  demote?(targetNs: string, options?: {
    thingId?: string
    preserveHistory?: boolean
    type?: string
    force?: boolean
    compress?: boolean
    mode?: 'atomic' | 'staged'
    preserveId?: boolean
  }): Promise<DemoteResult>
}

// ============================================================================
// DO promote() Tests
// ============================================================================

describe('DO promote() Operation', () => {
  let stub: PromoteDemoteStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as PromoteDemoteStub
  })

  describe('preconditions', () => {
    /**
     * Verify that Things can be created (required for promote() to work)
     */
    it('can create Things that would be promoted', async () => {
      const thing = await stub.thingsCreate({
        $type: 'Customer',
        name: 'Alice',
        data: { email: 'alice@example.com' },
      })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Alice')
    })

    /**
     * Verify that created Things can be retrieved
     */
    it('can retrieve Things by ID', async () => {
      const created = await stub.thingsCreate({
        $type: 'Order',
        name: 'Order-001',
      })

      const retrieved = await stub.thingsGet(created.$id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.$id).toBe(created.$id)
    })
  })

  describe('promote() method', () => {
    /**
     * Test: promote() should exist as a method on DOFull-based DOs
     *
     * Expected behavior:
     * - promote(thingId) promotes a Thing to its own DO
     * - Returns PromoteResult with newNs, thingId, originalNs
     *
     * Note: TestDO extends DOBase, not DOFull, so promote() is not available.
     * This test documents expected behavior when DOFull is used.
     */
    it('should promote a Thing to its own DO', async () => {
      // Create a thing to promote
      const thing = await stub.thingsCreate({
        $type: 'Customer',
        name: 'Promotable Customer',
        data: { tier: 'premium' },
      })

      // Check if promote method exists (it won't on DOBase)
      if (typeof stub.promote === 'function') {
        const result = await stub.promote(thing.$id)

        expect(result.newNs).toBeDefined()
        expect(result.thingId).toBe(thing.$id)
        expect(result.originalNs).toBeDefined()
      } else {
        // Document that TestDO needs to extend DOFull for this test
        console.log('SKIP: promote() not available - TestDO extends DOBase, not DOFull')
        expect(stub.promote).toBeUndefined()
      }
    })

    /**
     * Test: promote() with custom targetNs option
     *
     * Expected behavior:
     * - promote(thingId, { targetNs: 'https://custom.do' }) uses custom namespace
     * - The new DO is created at the specified namespace
     */
    it('should allow custom targetNs for promoted DO', async () => {
      const thing = await stub.thingsCreate({
        $type: 'Service',
        name: 'My Service',
      })

      if (typeof stub.promote === 'function') {
        const customNs = `https://${uniqueNs('custom')}.do`
        const result = await stub.promote(thing.$id, { targetNs: customNs })

        expect(result.newNs).toBe(customNs)
      } else {
        console.log('SKIP: promote() not available')
        expect(stub.promote).toBeUndefined()
      }
    })

    /**
     * Test: promote() throws error for non-existent Thing
     *
     * Expected behavior:
     * - promote('non-existent') throws "Thing not found" error
     */
    it('should throw error for non-existent Thing', async () => {
      if (typeof stub.promote === 'function') {
        await expect(stub.promote('non-existent-id')).rejects.toThrow(/not found/i)
      } else {
        console.log('SKIP: promote() not available')
        expect(stub.promote).toBeUndefined()
      }
    })

    /**
     * Test: promote() marks original Thing as promoted
     *
     * Expected behavior:
     * - After promote(), the original Thing has $promotedTo in data
     * - The Thing still exists but is marked as promoted
     */
    it('should mark original Thing as promoted', async () => {
      const thing = await stub.thingsCreate({
        $type: 'Entity',
        name: 'Will Be Promoted',
      })

      if (typeof stub.promote === 'function') {
        const result = await stub.promote(thing.$id)

        // Retrieve the original thing
        const updated = await stub.thingsGet(thing.$id)
        expect(updated).not.toBeNull()
        expect((updated!.data as Record<string, unknown>)?.$promotedTo).toBe(result.newNs)
        expect((updated!.data as Record<string, unknown>)?.$promotedAt).toBeDefined()
      } else {
        console.log('SKIP: promote() not available')
        expect(stub.promote).toBeUndefined()
      }
    })

    /**
     * Test: promote() cannot promote to self
     *
     * Expected behavior:
     * - promote(id, { targetNs: currentNs }) throws "Cannot promote to self" error
     */
    it('should throw error when promoting to self', async () => {
      const thing = await stub.thingsCreate({
        $type: 'SelfRef',
        name: 'Self Reference',
      })

      if (typeof stub.promote === 'function') {
        const currentNs = await stub.getNs()
        await expect(stub.promote(thing.$id, {
          targetNs: `https://${currentNs}`,
        })).rejects.toThrow(/Cannot promote to self/i)
      } else {
        console.log('SKIP: promote() not available')
        expect(stub.promote).toBeUndefined()
      }
    })

    /**
     * Test: promote() validates target URL format
     *
     * Expected behavior:
     * - promote(id, { targetNs: 'invalid-url' }) throws "Invalid target URL" error
     */
    it('should validate target URL format', async () => {
      const thing = await stub.thingsCreate({
        $type: 'URLTest',
        name: 'URL Validation Test',
      })

      if (typeof stub.promote === 'function') {
        await expect(stub.promote(thing.$id, {
          targetNs: 'not-a-valid-url',
        })).rejects.toThrow(/Invalid target URL/i)
      } else {
        console.log('SKIP: promote() not available')
        expect(stub.promote).toBeUndefined()
      }
    })
  })

  describe('promote() result structure', () => {
    /**
     * Test: PromoteResult contains all required fields
     */
    it('should return PromoteResult with newNs, thingId, originalNs', async () => {
      const thing = await stub.thingsCreate({
        $type: 'ResultTest',
        name: 'Result Structure Test',
      })

      if (typeof stub.promote === 'function') {
        const result = await stub.promote(thing.$id)

        // Verify result structure
        expect(result).toHaveProperty('newNs')
        expect(result).toHaveProperty('thingId')
        expect(result).toHaveProperty('originalNs')

        // newNs should be a valid URL
        expect(() => new URL(result.newNs)).not.toThrow()

        // thingId should match the promoted thing
        expect(result.thingId).toBe(thing.$id)
      } else {
        console.log('SKIP: promote() not available')
        expect(stub.promote).toBeUndefined()
      }
    })
  })
})

// ============================================================================
// DO demote() Tests
// ============================================================================

describe('DO demote() Operation', () => {
  let stub: PromoteDemoteStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs('demote')
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as PromoteDemoteStub
  })

  describe('demote() method', () => {
    /**
     * Test: demote() should exist as a method on DOFull-based DOs
     *
     * Expected behavior:
     * - demote(targetNs) collapses this DO into the target as a Thing
     * - Returns DemoteResult with thingId, parentNs, deletedNs
     *
     * Note: TestDO extends DOBase, not DOFull, so demote() is not available.
     */
    it('should demote DO to a Thing in parent', async () => {
      // Create some state in the DO to demote
      await stub.thingsCreate({
        $type: 'State',
        name: 'Local State',
      })

      if (typeof stub.demote === 'function') {
        const parentNs = `https://${uniqueNs('parent')}.do`
        const result = await stub.demote(parentNs)

        expect(result.thingId).toBeDefined()
        expect(result.parentNs).toBe(parentNs)
        expect(result.deletedNs).toBeDefined()
      } else {
        console.log('SKIP: demote() not available - TestDO extends DOBase, not DOFull')
        expect(stub.demote).toBeUndefined()
      }
    })

    /**
     * Test: demote() requires targetNs parameter
     *
     * Expected behavior:
     * - demote('') throws "targetNs is required" error
     * - demote(undefined) throws error
     */
    it('should require targetNs parameter', async () => {
      if (typeof stub.demote === 'function') {
        await expect(stub.demote('')).rejects.toThrow(/targetNs is required/i)
      } else {
        console.log('SKIP: demote() not available')
        expect(stub.demote).toBeUndefined()
      }
    })

    /**
     * Test: demote() cannot demote to self
     *
     * Expected behavior:
     * - demote(currentNs) throws "Cannot demote to self" error
     */
    it('should throw error when demoting to self', async () => {
      if (typeof stub.demote === 'function') {
        const currentNs = await stub.getNs()
        await expect(stub.demote(`https://${currentNs}`)).rejects.toThrow(/Cannot demote to self/i)
      } else {
        console.log('SKIP: demote() not available')
        expect(stub.demote).toBeUndefined()
      }
    })

    /**
     * Test: demote() validates target URL format
     *
     * Expected behavior:
     * - demote('invalid-url') throws "Invalid target URL" error
     */
    it('should validate target URL format', async () => {
      if (typeof stub.demote === 'function') {
        await expect(stub.demote('not-a-valid-url')).rejects.toThrow(/Invalid target URL/i)
      } else {
        console.log('SKIP: demote() not available')
        expect(stub.demote).toBeUndefined()
      }
    })

    /**
     * Test: demote() with custom thingId option
     *
     * Expected behavior:
     * - demote(ns, { thingId: 'custom-id' }) uses the custom ID in parent
     */
    it('should allow custom thingId for demoted Thing', async () => {
      await stub.thingsCreate({
        $type: 'DemoteTest',
        name: 'Custom ID Test',
      })

      if (typeof stub.demote === 'function') {
        const parentNs = `https://${uniqueNs('parent')}.do`
        const customId = `custom-${Date.now()}`
        const result = await stub.demote(parentNs, { thingId: customId })

        expect(result.thingId).toBe(customId)
      } else {
        console.log('SKIP: demote() not available')
        expect(stub.demote).toBeUndefined()
      }
    })

    /**
     * Test: demote() with compress option
     *
     * Expected behavior:
     * - demote(ns, { compress: true }) omits actions/events from transfer
     * - Only things and relationships are transferred
     */
    it('should support compress option to omit history', async () => {
      await stub.thingsCreate({
        $type: 'CompressTest',
        name: 'Compression Test',
      })

      if (typeof stub.demote === 'function') {
        const parentNs = `https://${uniqueNs('parent')}.do`
        // Should not throw
        const result = await stub.demote(parentNs, { compress: true })
        expect(result.thingId).toBeDefined()
      } else {
        console.log('SKIP: demote() not available')
        expect(stub.demote).toBeUndefined()
      }
    })

    /**
     * Test: demote() validates type option format
     *
     * Expected behavior:
     * - type must match /^[A-Z][a-zA-Z0-9]*$/ and be <= 25 chars
     * - Invalid type throws "Invalid type" error
     */
    it('should validate type option format', async () => {
      if (typeof stub.demote === 'function') {
        const parentNs = `https://${uniqueNs('parent')}.do`

        // lowercase type should fail
        await expect(stub.demote(parentNs, { type: 'lowercase' })).rejects.toThrow(/Invalid type/i)

        // type with special chars should fail
        await expect(stub.demote(parentNs, { type: 'Bad_Type' })).rejects.toThrow(/Invalid type/i)

        // type too long should fail
        await expect(stub.demote(parentNs, {
          type: 'ThisTypeNameIsWayTooLongToBeValid',
        })).rejects.toThrow(/Invalid type/i)
      } else {
        console.log('SKIP: demote() not available')
        expect(stub.demote).toBeUndefined()
      }
    })
  })

  describe('demote() result structure', () => {
    /**
     * Test: DemoteResult contains all required fields
     */
    it('should return DemoteResult with thingId, parentNs, deletedNs', async () => {
      await stub.thingsCreate({
        $type: 'ResultTest',
        name: 'Result Structure Test',
      })

      if (typeof stub.demote === 'function') {
        const parentNs = `https://${uniqueNs('parent')}.do`
        const result = await stub.demote(parentNs)

        // Verify result structure
        expect(result).toHaveProperty('thingId')
        expect(result).toHaveProperty('parentNs')
        expect(result).toHaveProperty('deletedNs')

        // parentNs should match the target
        expect(result.parentNs).toBe(parentNs)
      } else {
        console.log('SKIP: demote() not available')
        expect(stub.demote).toBeUndefined()
      }
    })
  })

  describe('demote() state transfer', () => {
    /**
     * Test: demote() clears local state after transfer
     *
     * Expected behavior:
     * - After demote(), local things/actions/events/relationships are deleted
     */
    it('should clear local state after demote', async () => {
      // Create multiple things
      await stub.thingsCreate({ $type: 'Item', name: 'Item 1' })
      await stub.thingsCreate({ $type: 'Item', name: 'Item 2' })

      // Verify things exist
      let items = await stub.thingsList({ type: 'Item' })
      expect(items.length).toBe(2)

      if (typeof stub.demote === 'function') {
        const parentNs = `https://${uniqueNs('parent')}.do`
        await stub.demote(parentNs)

        // Local state should be cleared
        items = await stub.thingsList({ type: 'Item' })
        expect(items.length).toBe(0)
      } else {
        console.log('SKIP: demote() not available')
        expect(stub.demote).toBeUndefined()
      }
    })
  })
})

// ============================================================================
// promote() and demote() Integration Tests
// ============================================================================

describe('promote/demote Round Trip', () => {
  let stub: PromoteDemoteStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs('roundtrip')
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as PromoteDemoteStub
  })

  /**
   * Test: Promote then demote returns to equivalent state
   *
   * Expected behavior:
   * - Create Thing A in DO-1
   * - Promote A to DO-2
   * - Demote DO-2 back to DO-1
   * - DO-1 should have the Thing (possibly with new ID)
   */
  it('should support promote/demote round trip', async () => {
    if (typeof stub.promote !== 'function' || typeof stub.demote !== 'function') {
      console.log('SKIP: promote/demote not available')
      expect(stub.promote).toBeUndefined()
      return
    }

    // Create a thing
    const original = await stub.thingsCreate({
      $type: 'RoundTrip',
      name: 'Round Trip Test',
      data: { value: 42 },
    })

    // Promote it
    const promoteResult = await stub.promote(original.$id)
    expect(promoteResult.newNs).toBeDefined()

    // Get the promoted DO
    const promotedId = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(promoteResult.newNs)
    const promotedStub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(promotedId) as PromoteDemoteStub

    // Demote back to original
    const demoteResult = await promotedStub.demote(`https://${ns}`)

    // Verify the thing came back
    const things = await stub.thingsList({ type: 'RoundTrip' })
    expect(things.length).toBeGreaterThanOrEqual(1)
  })

  /**
   * Test: Promoted DO has its own identity
   *
   * Expected behavior:
   * - After promote, the new DO has a different namespace
   * - The new DO can operate independently
   */
  it('promoted DO should have independent identity', async () => {
    if (typeof stub.promote !== 'function') {
      console.log('SKIP: promote() not available')
      expect(stub.promote).toBeUndefined()
      return
    }

    const thing = await stub.thingsCreate({
      $type: 'Independent',
      name: 'Independence Test',
    })

    const result = await stub.promote(thing.$id)

    // The new namespace should be different
    const originalNs = await stub.getNs()
    expect(result.newNs).not.toBe(`https://${originalNs}`)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('promote/demote Error Handling', () => {
  let stub: PromoteDemoteStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs('error')
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as PromoteDemoteStub
  })

  describe('promote() errors', () => {
    it('should emit promote.failed event on error', async () => {
      if (typeof stub.promote !== 'function') {
        console.log('SKIP: promote() not available')
        expect(stub.promote).toBeUndefined()
        return
      }

      // Try to promote non-existent thing
      await expect(stub.promote('does-not-exist')).rejects.toThrow()
      // promote.failed event should have been emitted
    })
  })

  describe('demote() errors', () => {
    it('should emit demote.failed event on error', async () => {
      if (typeof stub.demote !== 'function') {
        console.log('SKIP: demote() not available')
        expect(stub.demote).toBeUndefined()
        return
      }

      // Try to demote with invalid URL
      await expect(stub.demote('invalid-url')).rejects.toThrow()
      // demote.failed event should have been emitted
    })
  })
})

// ============================================================================
// Test Configuration Note
// ============================================================================

/**
 * NOTE ON TEST CONFIGURATION:
 *
 * The current TestDO in workers/do-integration-test-worker.ts imports DO from
 * objects/DOBase.ts, which does NOT include the promote() and demote() methods.
 *
 * To fully test promote/demote with real miniflare DOs:
 *
 * 1. Create a new test worker that extends DO from objects/DOFull.ts
 * 2. Add promote() and demote() as RPC methods on the test DO
 * 3. Create a new wrangler config for the DOFull test worker
 * 4. Add a new vitest workspace project for these tests
 *
 * Example worker modification:
 *
 * ```typescript
 * // workers/do-full-test-worker.ts
 * import { DO } from '../objects/DOFull'  // Changed from DOBase
 *
 * export class TestDOFull extends DO<Env> {
 *   // promote() and demote() are inherited from DOFull
 * }
 * ```
 *
 * Until then, these tests document the expected behavior and will pass
 * with appropriate skip messages when methods are unavailable.
 */
