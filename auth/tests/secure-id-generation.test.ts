/**
 * Security test for ID generation
 *
 * This test verifies that API key IDs are generated using
 * cryptographically secure methods (crypto.randomUUID()) rather than
 * predictable Math.random()-based methods.
 *
 * Math.random() is NOT cryptographically secure:
 * - Uses predictable PRNG algorithms (xorshift128+ in V8)
 * - State can be recovered from a few outputs
 * - Attackers can predict future values once state is known
 *
 * This is a security vulnerability for ID generation because:
 * - API key IDs may be used in authorization decisions
 * - Predictable IDs could enable enumeration attacks
 * - Sequential/predictable patterns leak information
 *
 * Issue: do-wnyg
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiKeyManager } from '../apikey'

describe('Secure ID Generation', () => {
  describe('ApiKeyManager.generateId() security', () => {
    let mathRandomSpy: ReturnType<typeof vi.spyOn>
    let cryptoRandomUUIDSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      // Spy on Math.random and crypto.randomUUID to detect which is used
      mathRandomSpy = vi.spyOn(Math, 'random')
      cryptoRandomUUIDSpy = vi.spyOn(crypto, 'randomUUID')
    })

    afterEach(() => {
      mathRandomSpy.mockRestore()
      cryptoRandomUUIDSpy.mockRestore()
    })

    it('should NOT use Math.random() for ID generation', async () => {
      const manager = new ApiKeyManager()

      // Create an API key which internally calls generateId()
      await manager.create({ name: 'Test Key' })

      // This test FAILS if Math.random() was called during ID generation
      // Math.random() is not cryptographically secure and IDs should
      // use crypto.randomUUID() instead
      expect(mathRandomSpy).not.toHaveBeenCalled()
    })

    it('should use crypto.randomUUID() for ID generation', async () => {
      const manager = new ApiKeyManager()

      // Create an API key which internally calls generateId()
      await manager.create({ name: 'Test Key' })

      // This test PASSES only if crypto.randomUUID() was used
      expect(cryptoRandomUUIDSpy).toHaveBeenCalled()
    })

    it('should generate IDs that match UUID format', async () => {
      const manager = new ApiKeyManager()

      const { apiKey } = await manager.create({ name: 'Test Key' })

      // UUIDs have the format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      // Or with a prefix: key_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const uuidPattern = /^key_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

      expect(apiKey.id).toMatch(uuidPattern)
    })

    it('should generate unique IDs across multiple keys', async () => {
      const manager = new ApiKeyManager()
      const ids = new Set<string>()

      // Generate many keys and collect IDs
      for (let i = 0; i < 100; i++) {
        const { apiKey } = await manager.create({ name: `Key ${i}` })
        ids.add(apiKey.id)
      }

      // All IDs should be unique
      expect(ids.size).toBe(100)
    })
  })

  describe('Math.random() predictability demonstration', () => {
    it('demonstrates why Math.random() is insecure for ID generation', () => {
      // Math.random() uses a seeded PRNG. While we cannot easily
      // recover the seed in this test, we can demonstrate properties
      // that make it unsuitable for security-sensitive ID generation.

      // 1. Math.random() values are floating point between 0 and 1
      const values: number[] = []
      for (let i = 0; i < 10; i++) {
        values.push(Math.random())
      }

      // Values are predictable patterns (all between 0-1, similar precision)
      expect(values.every((v) => v >= 0 && v < 1)).toBe(true)

      // 2. When converted to base36 (like the current implementation),
      //    the entropy is limited to about 52 bits
      const id = Math.random().toString(36).substring(2, 15)
      // This produces at most 13 characters of base36
      expect(id.length).toBeLessThanOrEqual(13)

      // 3. crypto.randomUUID() provides 122 bits of entropy
      //    (UUID v4 has 6 fixed bits for version/variant)
      const uuid = crypto.randomUUID()
      // UUIDs are 36 chars including hyphens, 32 hex chars = 128 bits representation
      expect(uuid.length).toBe(36)
    })

    it('shows that Math.random()-based IDs have predictable patterns', async () => {
      const manager = new ApiKeyManager()

      // Create several keys
      const keys: string[] = []
      for (let i = 0; i < 5; i++) {
        const { apiKey } = await manager.create({ name: `Key ${i}` })
        keys.push(apiKey.id)
      }

      // Current implementation uses: `key_${Math.random().toString(36).substring(2, 15)}_${Date.now()}`
      // This means all IDs created in rapid succession will have:
      // - Similar timestamps at the end
      // - Predictable random portion in the middle

      // Check that IDs follow the insecure pattern (they shouldn't!)
      const insecurePattern = /^key_[a-z0-9]+_\d{13}$/
      const usesInsecurePattern = keys.every((id) => insecurePattern.test(id))

      // This assertion should FAIL because we want secure UUID-based IDs
      // If this passes, it means the code is still using the insecure pattern
      expect(usesInsecurePattern).toBe(false)
    })
  })

  describe('Timestamp-based ID vulnerabilities', () => {
    it('should not include timestamps in generated IDs', async () => {
      const manager = new ApiKeyManager()
      const beforeTime = Date.now()

      const { apiKey } = await manager.create({ name: 'Test Key' })

      const afterTime = Date.now()

      // Check if the ID contains any timestamp from the generation window
      const containsTimestamp = (() => {
        for (let ts = beforeTime; ts <= afterTime; ts++) {
          if (apiKey.id.includes(ts.toString())) {
            return true
          }
        }
        return false
      })()

      // IDs should NOT contain timestamps as they leak creation time
      // and reduce effective entropy
      expect(containsTimestamp).toBe(false)
    })

    it('demonstrates that timestamp-based IDs leak creation order', async () => {
      const manager = new ApiKeyManager()

      // Create keys with small delay
      const { apiKey: key1 } = await manager.create({ name: 'First Key' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const { apiKey: key2 } = await manager.create({ name: 'Second Key' })

      // With timestamp-based IDs, an attacker can determine creation order
      // by comparing timestamps embedded in the IDs

      // Extract any numeric portions that could be timestamps
      const extractTimestamp = (id: string): number | null => {
        const match = id.match(/_(\d{13})$/)
        return match ? parseInt(match[1], 10) : null
      }

      const ts1 = extractTimestamp(key1.id)
      const ts2 = extractTimestamp(key2.id)

      // If timestamps are present, this is a security issue
      // (leaks creation time and ordering information)
      if (ts1 !== null && ts2 !== null) {
        // This condition should NOT be true with secure IDs
        expect(ts2).toBeGreaterThan(ts1) // Would pass with insecure impl
        // Force failure to flag the security issue
        expect(ts1).toBeNull()
      }

      // Secure UUIDs should not have extractable timestamps
      expect(ts1).toBeNull()
      expect(ts2).toBeNull()
    })
  })
})
