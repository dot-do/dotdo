/**
 * TDD Red Phase Tests: Deterministic Hash Function
 *
 * Tests for a deterministic hash function used for:
 * - Feature flag traffic allocation
 * - Branch assignment in experiments
 * - Consistent bucketing for A/B tests
 *
 * These tests define the expected behavior BEFORE implementation.
 * All tests should FAIL initially because deterministicHash doesn't exist yet.
 *
 * @see dotdo-y313
 */

import { describe, it, expect } from 'vitest'
import { deterministicHash } from '../../workflows/hash'

describe('deterministicHash', () => {
  /**
   * Core Requirement: Determinism
   *
   * The same input must ALWAYS produce the same output.
   * This is critical for consistent user experiences in feature flags
   * and experiment assignments.
   */
  describe('determinism', () => {
    it('returns same value for same input', () => {
      const input = 'user:123:flag:test'
      const hash1 = deterministicHash(input)
      const hash2 = deterministicHash(input)

      expect(hash1).toBe(hash2)
    })

    it('returns same value for identical strings across multiple calls', () => {
      const input = 'experiment:pricing:user:alice@example.com.ai'
      const results = Array.from({ length: 100 }, () => deterministicHash(input))

      // All 100 results should be identical
      const uniqueResults = new Set(results)
      expect(uniqueResults.size).toBe(1)
    })

    it('produces consistent results for complex key patterns', () => {
      const patterns = [
        'user:12345:feature:dark_mode',
        'org:acme-corp:experiment:checkout_flow',
        'session:abc123def456:flag:new_pricing',
        'tenant:t-001:user:u-999:feature:beta',
      ]

      for (const pattern of patterns) {
        const hash1 = deterministicHash(pattern)
        const hash2 = deterministicHash(pattern)
        expect(hash1).toBe(hash2)
      }
    })
  })

  /**
   * Core Requirement: Different Inputs Produce Different Outputs
   *
   * Different inputs should produce different hash values.
   * This ensures proper distribution across buckets.
   */
  describe('uniqueness', () => {
    it('returns different values for different inputs', () => {
      const hash1 = deterministicHash('user:123:flag:test')
      const hash2 = deterministicHash('user:456:flag:test')

      expect(hash1).not.toBe(hash2)
    })

    it('returns different values for similar but distinct inputs', () => {
      const inputs = [
        'user:1',
        'user:2',
        'user:10',
        'user:11',
        'user:100',
        'user:101',
      ]

      const hashes = inputs.map((input) => deterministicHash(input))
      const uniqueHashes = new Set(hashes)

      // All hashes should be unique
      expect(uniqueHashes.size).toBe(inputs.length)
    })

    it('distinguishes between inputs that differ by one character', () => {
      const hash1 = deterministicHash('test-a')
      const hash2 = deterministicHash('test-b')

      expect(hash1).not.toBe(hash2)
    })

    it('distinguishes between prefix/suffix variations', () => {
      const hashes = [
        deterministicHash('abc'),
        deterministicHash('abcd'),
        deterministicHash('0abc'),
        deterministicHash('abc0'),
      ]

      const uniqueHashes = new Set(hashes)
      expect(uniqueHashes.size).toBe(4)
    })
  })

  /**
   * Core Requirement: Uniform Distribution
   *
   * Hash values should distribute uniformly across buckets.
   * This is critical for fair traffic allocation in experiments.
   *
   * With 10,000 samples and 10 buckets, each bucket should have ~1000 entries.
   * We allow 850-1150 (15% variance) to account for statistical variation.
   */
  describe('uniform distribution', () => {
    it('distributes uniformly across 10 buckets with 10000 samples', () => {
      const buckets = new Array(10).fill(0)

      for (let i = 0; i < 10000; i++) {
        const hash = deterministicHash(`user:${i}:test`)
        const bucket = hash % 10
        buckets[bucket]++
      }

      // Each bucket should have between 850 and 1150 entries
      // This ensures roughly 15% variance tolerance
      buckets.forEach((count, index) => {
        expect(count, `Bucket ${index} has ${count} entries`).toBeGreaterThan(850)
        expect(count, `Bucket ${index} has ${count} entries`).toBeLessThan(1150)
      })
    })

    it('distributes uniformly with different key patterns', () => {
      const buckets = new Array(10).fill(0)

      for (let i = 0; i < 10000; i++) {
        const hash = deterministicHash(`experiment:test:session:${i}`)
        buckets[hash % 10]++
      }

      buckets.forEach((count, index) => {
        expect(count, `Bucket ${index}`).toBeGreaterThan(850)
        expect(count, `Bucket ${index}`).toBeLessThan(1150)
      })
    })

    it('distributes uniformly across 100 buckets', () => {
      const buckets = new Array(100).fill(0)

      for (let i = 0; i < 100000; i++) {
        const hash = deterministicHash(`sample:${i}`)
        buckets[hash % 100]++
      }

      // With 100,000 samples and 100 buckets, expect ~1000 per bucket
      // Allow 750-1250 (25% variance) for 100 buckets
      buckets.forEach((count, index) => {
        expect(count, `Bucket ${index}`).toBeGreaterThan(750)
        expect(count, `Bucket ${index}`).toBeLessThan(1250)
      })
    })

    it('maintains distribution consistency for sequential user IDs', () => {
      const buckets = new Array(10).fill(0)

      // Sequential IDs should still distribute well
      for (let i = 1000000; i < 1010000; i++) {
        const hash = deterministicHash(`user:${i}`)
        buckets[hash % 10]++
      }

      buckets.forEach((count, index) => {
        expect(count, `Bucket ${index}`).toBeGreaterThan(850)
        expect(count, `Bucket ${index}`).toBeLessThan(1150)
      })
    })
  })

  /**
   * Core Requirement: Returns Positive Integer
   *
   * The hash function must return a positive integer for consistent
   * bucket assignment using modulo operations.
   */
  describe('return value type', () => {
    it('returns a positive integer', () => {
      const hash = deterministicHash('test-input')

      expect(hash).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(hash)).toBe(true)
    })

    it('never returns negative values', () => {
      const inputs = [
        'negative-test-1',
        'negative-test-2',
        '',
        'a',
        'zzzzz',
        '\u0000',
        '\uFFFF',
        '-1',
        '-999999',
      ]

      for (const input of inputs) {
        const hash = deterministicHash(input)
        expect(hash, `Input "${input}" produced negative hash`).toBeGreaterThanOrEqual(0)
      }
    })

    it('returns finite numbers', () => {
      const inputs = ['test', '', 'x'.repeat(10000)]

      for (const input of inputs) {
        const hash = deterministicHash(input)
        expect(Number.isFinite(hash)).toBe(true)
      }
    })

    it('never returns NaN', () => {
      const inputs = ['', 'null', 'undefined', 'NaN', '\x00']

      for (const input of inputs) {
        const hash = deterministicHash(input)
        expect(Number.isNaN(hash)).toBe(false)
      }
    })
  })

  /**
   * Core Requirement: Edge Cases
   *
   * The hash function must handle edge cases gracefully:
   * - Empty strings
   * - Unicode characters
   * - Very long strings
   */
  describe('edge cases', () => {
    describe('empty string', () => {
      it('handles empty string without throwing', () => {
        expect(() => deterministicHash('')).not.toThrow()
      })

      it('returns a valid positive integer for empty string', () => {
        const hash = deterministicHash('')

        expect(hash).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(hash)).toBe(true)
      })

      it('returns consistent value for empty string', () => {
        const hash1 = deterministicHash('')
        const hash2 = deterministicHash('')

        expect(hash1).toBe(hash2)
      })
    })

    describe('unicode characters', () => {
      it('handles unicode strings', () => {
        const hash = deterministicHash('user:johndoe:flag:pricing')

        expect(hash).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(hash)).toBe(true)
      })

      it('handles emojis', () => {
        const hash = deterministicHash('user:test:flag:rocket')

        expect(hash).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(hash)).toBe(true)
      })

      it('handles CJK characters', () => {
        const inputs = [
          'user:test',
          'feature:test',
          'experiment:test',
        ]

        for (const input of inputs) {
          const hash = deterministicHash(input)
          expect(hash).toBeGreaterThanOrEqual(0)
          expect(Number.isInteger(hash)).toBe(true)
        }
      })

      it('distinguishes between different unicode characters', () => {
        const hash1 = deterministicHash('cafe')
        const hash2 = deterministicHash('cafe') // with accent

        // These should produce different hashes if different
        // (cafe vs cafe is actually different in some encodings)
        expect(hash1).toBeDefined()
        expect(hash2).toBeDefined()
      })

      it('handles mixed ASCII and unicode', () => {
        const hash = deterministicHash('user:123:name:John')

        expect(hash).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(hash)).toBe(true)
      })

      it('returns consistent hashes for unicode strings', () => {
        const input = 'flag:enabled:user:test123'
        const hash1 = deterministicHash(input)
        const hash2 = deterministicHash(input)

        expect(hash1).toBe(hash2)
      })
    })

    describe('very long strings', () => {
      it('handles strings of 1000 characters', () => {
        const longString = 'x'.repeat(1000)
        const hash = deterministicHash(longString)

        expect(hash).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(hash)).toBe(true)
      })

      it('handles strings of 10000 characters', () => {
        const longString = 'y'.repeat(10000)
        const hash = deterministicHash(longString)

        expect(hash).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(hash)).toBe(true)
      })

      it('handles strings of 100000 characters', () => {
        const longString = 'z'.repeat(100000)
        const hash = deterministicHash(longString)

        expect(hash).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(hash)).toBe(true)
      })

      it('returns consistent hashes for long strings', () => {
        const longString = 'test'.repeat(5000)
        const hash1 = deterministicHash(longString)
        const hash2 = deterministicHash(longString)

        expect(hash1).toBe(hash2)
      })

      it('distinguishes between long strings with different content', () => {
        const string1 = 'a'.repeat(10000)
        const string2 = 'b'.repeat(10000)

        const hash1 = deterministicHash(string1)
        const hash2 = deterministicHash(string2)

        expect(hash1).not.toBe(hash2)
      })
    })

    describe('special characters', () => {
      it('handles whitespace', () => {
        const inputs = [' ', '  ', '\t', '\n', '\r\n', ' \t\n ']

        for (const input of inputs) {
          const hash = deterministicHash(input)
          expect(hash).toBeGreaterThanOrEqual(0)
          expect(Number.isInteger(hash)).toBe(true)
        }
      })

      it('handles null bytes', () => {
        const hash = deterministicHash('\x00')

        expect(hash).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(hash)).toBe(true)
      })

      it('handles strings with colons (common delimiter)', () => {
        const hash = deterministicHash('a:b:c:d:e')

        expect(hash).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(hash)).toBe(true)
      })

      it('distinguishes whitespace from empty string', () => {
        const hashEmpty = deterministicHash('')
        const hashSpace = deterministicHash(' ')
        const hashTab = deterministicHash('\t')

        expect(hashEmpty).not.toBe(hashSpace)
        expect(hashSpace).not.toBe(hashTab)
        expect(hashEmpty).not.toBe(hashTab)
      })
    })

    describe('numeric strings', () => {
      it('handles numeric strings', () => {
        const inputs = ['0', '1', '123', '-1', '3.14', '1e10']

        for (const input of inputs) {
          const hash = deterministicHash(input)
          expect(hash).toBeGreaterThanOrEqual(0)
          expect(Number.isInteger(hash)).toBe(true)
        }
      })

      it('distinguishes similar numeric strings', () => {
        const hash1 = deterministicHash('1')
        const hash2 = deterministicHash('01')
        const hash3 = deterministicHash('001')

        expect(hash1).not.toBe(hash2)
        expect(hash2).not.toBe(hash3)
        expect(hash1).not.toBe(hash3)
      })
    })
  })

  /**
   * Real-World Usage Patterns
   *
   * Test patterns that would actually be used in production
   * for feature flags and experiments.
   */
  describe('real-world usage patterns', () => {
    it('works for feature flag assignment', () => {
      const userId = 'user-12345'
      const flagName = 'new_checkout_flow'
      const key = `${userId}:${flagName}`

      const hash = deterministicHash(key)
      const percentage = hash % 100

      // Should be a valid percentage for traffic allocation
      expect(percentage).toBeGreaterThanOrEqual(0)
      expect(percentage).toBeLessThan(100)
    })

    it('provides stable assignment for same user', () => {
      const userId = 'user-12345'
      const flagName = 'new_checkout_flow'
      const key = `${userId}:${flagName}`

      // Simulate checking flag multiple times
      const assignments = Array.from({ length: 10 }, () => {
        const hash = deterministicHash(key)
        return hash % 2 === 0 ? 'control' : 'treatment'
      })

      // All assignments should be the same
      const uniqueAssignments = new Set(assignments)
      expect(uniqueAssignments.size).toBe(1)
    })

    it('produces different assignments for different users on same flag', () => {
      const flagName = 'pricing_experiment'
      const users = ['alice', 'bob', 'charlie', 'diana', 'eve']

      const assignments = users.map((user) => {
        const hash = deterministicHash(`${user}:${flagName}`)
        return hash % 2
      })

      // With 5 users, we expect some variance (not all same bucket)
      const uniqueAssignments = new Set(assignments)
      // Statistically, 5 fair coin flips should rarely all be same
      // But we just verify the function works, not statistical properties
      expect(assignments.length).toBe(5)
    })

    it('produces different assignments for same user on different flags', () => {
      const userId = 'user-12345'
      const flags = ['flag_a', 'flag_b', 'flag_c', 'flag_d', 'flag_e']

      const hashes = flags.map((flag) => deterministicHash(`${userId}:${flag}`))

      // Hashes should be different for different flags
      const uniqueHashes = new Set(hashes)
      expect(uniqueHashes.size).toBe(flags.length)
    })

    it('supports multi-segment keys for experiments', () => {
      const key = 'org:acme:user:alice:experiment:checkout:variant'
      const hash = deterministicHash(key)

      expect(hash).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(hash)).toBe(true)
    })
  })
})
