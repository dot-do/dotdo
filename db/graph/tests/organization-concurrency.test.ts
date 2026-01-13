/**
 * Organization Concurrency Tests - TOCTOU Race Condition
 *
 * TDD RED Phase: Tests to expose Time-of-Check to Time-of-Use (TOCTOU) race
 * condition vulnerability in OrganizationStore.create() duplicate slug check.
 *
 * ## Vulnerability
 * The current implementation has a race window between checking for slug
 * uniqueness and creating the organization node:
 *
 * ```typescript
 * // VULNERABLE CODE in organization.ts:242-270
 * async create(data: OrganizationInput): Promise<Organization> {
 *   // TIME OF CHECK - queries existing orgs
 *   const existing = await this.findBySlug(data.slug)
 *   if (existing) throw new Error('...')
 *
 *   // RACE WINDOW HERE - another request can pass the check above
 *
 *   // TIME OF USE - creates the node
 *   const node = await this.graph.createNode(...)  // Both requests succeed!
 * }
 * ```
 *
 * ## Attack Vector
 * 1. Two concurrent requests arrive with same slug
 * 2. Both pass the findBySlug check (both return null)
 * 3. Both proceed to createNode
 * 4. Result: Two organizations with the same slug exist
 *
 * ## Expected Behavior (After Fix)
 * - Only ONE concurrent create should succeed
 * - All others should fail with a constraint violation error
 * - Database should use atomic operations (e.g., unique index, transaction)
 *
 * Uses real GraphEngine, NO MOCKS - per project testing philosophy.
 *
 * @see dotdo-fn2bm - [RED] Race Condition Tests - Organization duplicate slug check
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine } from '../index'
import { createOrganizationStore, type OrganizationStore, type OrganizationInput } from '../organization'

describe('Organization Race Condition Tests', () => {
  let graph: GraphEngine
  let store: OrganizationStore

  beforeEach(() => {
    graph = new GraphEngine()
    store = createOrganizationStore(graph)
  })

  /**
   * Helper to create an organization input with a specific slug
   */
  const makeOrgInput = (slug: string, nameSuffix = ''): OrganizationInput => ({
    name: `Test Org ${nameSuffix || slug}`,
    slug,
    type: 'company',
    status: 'active',
  })

  // ============================================================================
  // TEST 1: Concurrent create() with same slug - only one should succeed
  // ============================================================================

  describe('Concurrent create() with same slug', () => {
    it('should only allow one organization to be created when racing with the same slug', async () => {
      const slug = 'race-test-slug'

      // Launch multiple concurrent create operations with the same slug
      const concurrentCount = 10
      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        store.create(makeOrgInput(slug, `racer-${i}`))
          .then((org) => ({ success: true as const, org, index: i }))
          .catch((error) => ({ success: false as const, error, index: i }))
      )

      const results = await Promise.all(promises)

      // Count successes and failures
      const successes = results.filter((r) => r.success)
      const failures = results.filter((r) => !r.success)

      // EXPECTED: Only ONE should succeed, all others should fail
      // CURRENT BUG: Multiple may succeed due to race condition
      expect(successes.length).toBe(1)
      expect(failures.length).toBe(concurrentCount - 1)

      // Verify only one organization exists with this slug
      const orgsWithSlug = await graph.queryNodes({
        label: 'Organization',
        where: { slug },
      })

      expect(orgsWithSlug.length).toBe(1)
    })

    it('should not create duplicate organizations when two creates race simultaneously', async () => {
      const slug = 'duplicate-check-slug'

      // Create two promises that will race
      const promise1 = store.create(makeOrgInput(slug, 'first'))
      const promise2 = store.create(makeOrgInput(slug, 'second'))

      // Wait for both to settle
      const [result1, result2] = await Promise.allSettled([promise1, promise2])

      // Exactly one should succeed and one should fail
      const fulfilled = [result1, result2].filter((r) => r.status === 'fulfilled')
      const rejected = [result1, result2].filter((r) => r.status === 'rejected')

      expect(fulfilled.length).toBe(1)
      expect(rejected.length).toBe(1)

      // The rejection should indicate duplicate slug
      if (rejected[0]?.status === 'rejected') {
        expect(rejected[0].reason.message).toMatch(/slug.*already exists/i)
      }
    })

    it('should maintain data integrity under high concurrency with same slug', async () => {
      const slug = 'high-concurrency-slug'
      const concurrentCount = 50

      // Fire 50 concurrent requests
      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        store.create(makeOrgInput(slug, `worker-${i}`))
          .then((org) => ({ success: true as const, org }))
          .catch((error) => ({ success: false as const, error }))
      )

      await Promise.all(promises)

      // Query all organizations with this slug
      const orgsWithSlug = await graph.queryNodes({
        label: 'Organization',
        where: { slug },
      })

      // There should be exactly ONE organization - no duplicates
      expect(orgsWithSlug.length).toBe(1)
    })
  })

  // ============================================================================
  // TEST 2: Parallel batch creation - verify no duplicates
  // ============================================================================

  describe('Parallel batch creation', () => {
    it('should handle batch creation with unique slugs correctly', async () => {
      const slugs = Array.from({ length: 20 }, (_, i) => `batch-org-${i}`)

      // Create all in parallel
      const promises = slugs.map((slug) =>
        store.create(makeOrgInput(slug))
      )

      const results = await Promise.all(promises)

      // All should succeed with unique slugs
      expect(results.length).toBe(20)
      expect(results.every((r) => r.id)).toBe(true)

      // Verify all exist
      const allOrgs = await graph.queryNodes({ label: 'Organization' })
      expect(allOrgs.length).toBe(20)
    })

    it('should reject duplicates when batch includes same slug multiple times', async () => {
      const duplicateSlug = 'batch-duplicate'
      const inputs = [
        makeOrgInput(duplicateSlug, 'first'),
        makeOrgInput('unique-1'),
        makeOrgInput(duplicateSlug, 'second'),  // Duplicate
        makeOrgInput('unique-2'),
        makeOrgInput(duplicateSlug, 'third'),   // Another duplicate
      ]

      const promises = inputs.map((input) =>
        store.create(input)
          .then((org) => ({ success: true as const, org }))
          .catch((error) => ({ success: false as const, error }))
      )

      const results = await Promise.all(promises)

      // Count organizations with duplicate slug
      const orgsWithDuplicateSlug = await graph.queryNodes({
        label: 'Organization',
        where: { slug: duplicateSlug },
      })

      // Should only have ONE organization with the duplicate slug
      expect(orgsWithDuplicateSlug.length).toBe(1)

      // Total should be 3 (1 duplicate slug org + 2 unique)
      const allOrgs = await graph.queryNodes({ label: 'Organization' })
      expect(allOrgs.length).toBe(3)
    })
  })

  // ============================================================================
  // TEST 3: Timing manipulation with Promise.all
  // ============================================================================

  describe('Timing manipulation tests', () => {
    it('should prevent race condition even with artificial delays', async () => {
      const slug = 'timing-test-slug'

      // Create a wrapper that adds a small delay to simulate network latency
      const createWithDelay = async (delayMs: number, nameSuffix: string) => {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        return store.create(makeOrgInput(slug, nameSuffix))
      }

      // Launch requests with varying delays to maximize race window overlap
      const promises = [
        createWithDelay(0, 'immediate'),
        createWithDelay(1, 'delay-1ms'),
        createWithDelay(1, 'delay-1ms-2'),
        createWithDelay(2, 'delay-2ms'),
        createWithDelay(0, 'immediate-2'),
      ]

      const results = await Promise.allSettled(promises)

      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      // Only one should succeed
      expect(successes.length).toBe(1)
      expect(failures.length).toBe(4)

      // Verify database state
      const orgsWithSlug = await graph.queryNodes({
        label: 'Organization',
        where: { slug },
      })
      expect(orgsWithSlug.length).toBe(1)
    })

    it('should handle rapid sequential-concurrent hybrid pattern', async () => {
      const slug = 'hybrid-pattern-slug'

      // First create succeeds
      const first = await store.create(makeOrgInput(slug, 'first'))
      expect(first.id).toBeDefined()

      // Now try concurrent creates - all should fail
      const concurrentPromises = Array.from({ length: 5 }, (_, i) =>
        store.create(makeOrgInput(slug, `concurrent-${i}`))
          .then(() => ({ success: true as const }))
          .catch((error) => ({ success: false as const, error }))
      )

      const results = await Promise.all(concurrentPromises)

      // All concurrent attempts should fail
      expect(results.every((r) => !r.success)).toBe(true)

      // Still only one org with this slug
      const orgsWithSlug = await graph.queryNodes({
        label: 'Organization',
        where: { slug },
      })
      expect(orgsWithSlug.length).toBe(1)
    })
  })

  // ============================================================================
  // TEST 4: Verify proper error type for constraint violation
  // ============================================================================

  describe('Error type verification', () => {
    it('should throw a specific error type for duplicate slug constraint violation', async () => {
      const slug = 'error-type-test-slug'

      // Create first organization
      await store.create(makeOrgInput(slug, 'first'))

      // Second create should throw
      try {
        await store.create(makeOrgInput(slug, 'second'))
        // If we get here, the test should fail
        expect.fail('Should have thrown an error for duplicate slug')
      } catch (error) {
        // Verify the error message indicates duplicate slug
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toMatch(/slug.*already exists/i)
      }
    })

    it('should include the conflicting slug in the error message', async () => {
      const slug = 'specific-error-message-slug'

      await store.create(makeOrgInput(slug))

      try {
        await store.create(makeOrgInput(slug, 'duplicate'))
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toContain(slug)
      }
    })

    it('concurrent failures should all have consistent error messages', async () => {
      const slug = 'consistent-error-slug'

      // First create a successful org
      await store.create(makeOrgInput(slug, 'original'))

      // Now try concurrent creates that should all fail
      const promises = Array.from({ length: 5 }, (_, i) =>
        store.create(makeOrgInput(slug, `attempt-${i}`))
          .then(() => ({ error: null }))
          .catch((error) => ({ error }))
      )

      const results = await Promise.all(promises)

      // All should have errors
      const errors = results.filter((r) => r.error !== null)
      expect(errors.length).toBe(5)

      // All errors should have consistent message format
      for (const { error } of errors) {
        expect(error.message).toMatch(/slug.*already exists/i)
        expect(error.message).toContain(slug)
      }
    })
  })

  // ============================================================================
  // TEST 5: Update race condition (slug uniqueness on update)
  // ============================================================================

  describe('Update race condition', () => {
    it('should prevent race condition when updating slug to an existing value', async () => {
      // Create two organizations with different slugs
      const org1 = await store.create(makeOrgInput('org-slug-1', 'Org 1'))
      const org2 = await store.create(makeOrgInput('org-slug-2', 'Org 2'))

      // Try to update both to the same slug concurrently
      const targetSlug = 'target-slug'

      const promises = [
        store.update(org1.id, { slug: targetSlug })
          .then((org) => ({ success: true as const, org }))
          .catch((error) => ({ success: false as const, error })),
        store.update(org2.id, { slug: targetSlug })
          .then((org) => ({ success: true as const, org }))
          .catch((error) => ({ success: false as const, error })),
      ]

      const results = await Promise.all(promises)

      const successes = results.filter((r) => r.success)
      const failures = results.filter((r) => !r.success)

      // Only one should succeed
      expect(successes.length).toBe(1)
      expect(failures.length).toBe(1)

      // Verify only one org has the target slug
      const orgsWithSlug = await graph.queryNodes({
        label: 'Organization',
        where: { slug: targetSlug },
      })
      expect(orgsWithSlug.length).toBe(1)
    })
  })

  // ============================================================================
  // TEST 6: Stress test with many concurrent operations
  // ============================================================================

  describe('Stress tests', () => {
    it('should maintain integrity under 100 concurrent create attempts with same slug', async () => {
      const slug = 'stress-test-slug'
      const concurrentCount = 100

      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        store.create(makeOrgInput(slug, `stress-${i}`))
          .then((org) => ({ success: true as const, org }))
          .catch((error) => ({ success: false as const, error }))
      )

      const results = await Promise.all(promises)

      const successes = results.filter((r) => r.success)

      // CRITICAL: Must be exactly 1 success
      expect(successes.length).toBe(1)

      // Verify database state
      const orgsWithSlug = await graph.queryNodes({
        label: 'Organization',
        where: { slug },
      })

      // CRITICAL: Must be exactly 1 organization
      expect(orgsWithSlug.length).toBe(1)
    })

    it('should handle mixed unique and duplicate slugs under load', async () => {
      const commonSlug = 'common-slug'
      const uniquePrefix = 'unique-'

      // Create 50 requests: 25 with common slug, 25 with unique slugs
      const promises = Array.from({ length: 50 }, (_, i) => {
        const slug = i < 25 ? commonSlug : `${uniquePrefix}${i}`
        return store.create(makeOrgInput(slug, `worker-${i}`))
          .then((org) => ({ success: true as const, org, slug }))
          .catch((error) => ({ success: false as const, error, slug }))
      })

      await Promise.all(promises)

      // Check common slug - should have exactly 1
      const orgsWithCommonSlug = await graph.queryNodes({
        label: 'Organization',
        where: { slug: commonSlug },
      })
      expect(orgsWithCommonSlug.length).toBe(1)

      // Total orgs should be 26 (1 common + 25 unique)
      const allOrgs = await graph.queryNodes({ label: 'Organization' })
      expect(allOrgs.length).toBe(26)
    })
  })
})
