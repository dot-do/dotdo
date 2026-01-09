import { describe, it, expect } from 'vitest'
import { hashContext, hashPipeline, hashArgs, hashToInt } from './hash'

describe('Hashing System', () => {
  /**
   * Tests for dotdo-5mn: hashContext produces deterministic hash
   *
   * The hashContext function should:
   * - Produce a deterministic SHA-256 hash of context objects
   * - Same context input always produces same hash output
   * - Different contexts produce different hashes
   * - Handle nested objects consistently
   * - Be key-order independent (same keys in different order = same hash)
   */
  describe('hashContext', () => {
    it('produces deterministic hash for same context', () => {
      const context = { sku: 'ABC-123', quantity: 10 }
      const hash1 = hashContext(context)
      const hash2 = hashContext(context)
      expect(hash1).toBe(hash2)
    })

    it('produces different hash for different context values', () => {
      const hash1 = hashContext({ sku: 'ABC-123' })
      const hash2 = hashContext({ sku: 'XYZ-789' })
      expect(hash1).not.toBe(hash2)
    })

    it('produces different hash for different context keys', () => {
      const hash1 = hashContext({ sku: 'ABC-123' })
      const hash2 = hashContext({ productId: 'ABC-123' })
      expect(hash1).not.toBe(hash2)
    })

    it('returns a valid SHA-256 hex string (64 characters)', () => {
      const hash = hashContext({ test: 'value' })
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('handles nested objects deterministically', () => {
      const context = {
        order: {
          id: '12345',
          items: [{ sku: 'A' }, { sku: 'B' }],
        },
      }
      const hash1 = hashContext(context)
      const hash2 = hashContext(context)
      expect(hash1).toBe(hash2)
    })

    it('is key-order independent for object hashing', () => {
      const context1 = { a: 1, b: 2, c: 3 }
      const context2 = { c: 3, a: 1, b: 2 }
      const hash1 = hashContext(context1)
      const hash2 = hashContext(context2)
      expect(hash1).toBe(hash2)
    })

    it('handles empty objects', () => {
      const hash = hashContext({})
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  /**
   * Tests for dotdo-2q5: hashPipeline combines path and context hash
   *
   * The hashPipeline function should:
   * - Combine pipeline path array with context hash to produce step ID
   * - stepId = sha256(JSON.stringify({ path, contextHash, args? }))
   * - Same path + contextHash always produces same stepId
   * - Different paths produce different stepIds
   * - Optionally include args in the hash
   */
  describe('hashPipeline', () => {
    it('combines path and context hash into step ID', () => {
      const path = ['Inventory', 'check']
      const contextHash = 'a3f2c91b'
      const stepId = hashPipeline(path, contextHash)
      expect(stepId).toMatch(/^[a-f0-9]{64}$/)
    })

    it('produces deterministic step ID for same inputs', () => {
      const path = ['Inventory', 'check']
      const contextHash = 'a3f2c91b'
      const stepId1 = hashPipeline(path, contextHash)
      const stepId2 = hashPipeline(path, contextHash)
      expect(stepId1).toBe(stepId2)
    })

    it('produces different step ID for different paths', () => {
      const contextHash = 'a3f2c91b'
      const stepId1 = hashPipeline(['Inventory', 'check'], contextHash)
      const stepId2 = hashPipeline(['Inventory', 'reserve'], contextHash)
      expect(stepId1).not.toBe(stepId2)
    })

    it('produces different step ID for different context hashes', () => {
      const path = ['Inventory', 'check']
      const stepId1 = hashPipeline(path, 'context-hash-1')
      const stepId2 = hashPipeline(path, 'context-hash-2')
      expect(stepId1).not.toBe(stepId2)
    })

    it('includes args in hash when provided', () => {
      const path = ['Inventory', 'check']
      const contextHash = 'a3f2c91b'
      const args = { quantity: 10 }
      const stepIdWithArgs = hashPipeline(path, contextHash, args)
      const stepIdWithoutArgs = hashPipeline(path, contextHash)
      expect(stepIdWithArgs).not.toBe(stepIdWithoutArgs)
    })

    it('produces different step ID for different args', () => {
      const path = ['Inventory', 'check']
      const contextHash = 'a3f2c91b'
      const stepId1 = hashPipeline(path, contextHash, { quantity: 10 })
      const stepId2 = hashPipeline(path, contextHash, { quantity: 20 })
      expect(stepId1).not.toBe(stepId2)
    })

    it('handles single-element path', () => {
      const stepId = hashPipeline(['Initialize'], 'abc123')
      expect(stepId).toMatch(/^[a-f0-9]{64}$/)
    })

    it('handles deeply nested path', () => {
      const path = ['Order', 'Process', 'Payment', 'Validate', 'Card']
      const stepId = hashPipeline(path, 'xyz789')
      expect(stepId).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  /**
   * Tests for dotdo-fsp: hashArgs handles various argument types
   *
   * The hashArgs function should:
   * - Handle primitive types (string, number, boolean, null)
   * - Handle objects and nested objects
   * - Handle arrays and nested arrays
   * - Handle undefined values consistently
   * - Produce deterministic output for same input
   */
  describe('hashArgs', () => {
    it('handles string arguments', () => {
      const hash = hashArgs('test-string')
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('handles number arguments', () => {
      const hash1 = hashArgs(42)
      const hash2 = hashArgs(42)
      expect(hash1).toBe(hash2)
    })

    it('handles boolean arguments', () => {
      const hashTrue = hashArgs(true)
      const hashFalse = hashArgs(false)
      expect(hashTrue).not.toBe(hashFalse)
    })

    it('handles null arguments', () => {
      const hash = hashArgs(null)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('handles undefined arguments consistently', () => {
      const hash1 = hashArgs(undefined)
      const hash2 = hashArgs(undefined)
      expect(hash1).toBe(hash2)
    })

    it('handles object arguments', () => {
      const hash = hashArgs({ key: 'value', count: 5 })
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('handles nested object arguments', () => {
      const args = {
        user: {
          name: 'Alice',
          preferences: { theme: 'dark' },
        },
      }
      const hash1 = hashArgs(args)
      const hash2 = hashArgs(args)
      expect(hash1).toBe(hash2)
    })

    it('handles array arguments', () => {
      const hash = hashArgs([1, 2, 3, 'four'])
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('handles nested array arguments', () => {
      const args = [
        [1, 2],
        [3, 4],
        [5, [6, 7]],
      ]
      const hash1 = hashArgs(args)
      const hash2 = hashArgs(args)
      expect(hash1).toBe(hash2)
    })

    it('produces different hash for different argument values', () => {
      const hash1 = hashArgs({ x: 1 })
      const hash2 = hashArgs({ x: 2 })
      expect(hash1).not.toBe(hash2)
    })

    it('distinguishes between different types with same string representation', () => {
      const hashString = hashArgs('123')
      const hashNumber = hashArgs(123)
      expect(hashString).not.toBe(hashNumber)
    })

    it('handles empty object', () => {
      const hash = hashArgs({})
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('handles empty array', () => {
      const hash = hashArgs([])
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('handles mixed type arrays', () => {
      const args = [1, 'two', { three: 3 }, [4], null, true]
      const hash1 = hashArgs(args)
      const hash2 = hashArgs(args)
      expect(hash1).toBe(hash2)
    })

    it('handles floating point numbers', () => {
      const hash1 = hashArgs(3.14159)
      const hash2 = hashArgs(3.14159)
      expect(hash1).toBe(hash2)
    })

    it('handles negative numbers', () => {
      const hash = hashArgs(-42)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  /**
   * Tests for hashToInt - numeric hash for bucketing/traffic allocation
   *
   * The hashToInt function should:
   * - Produce a deterministic non-negative integer
   * - Same input always produces same output
   * - Different inputs produce different outputs (with high probability)
   * - Be in the range [0, 4294967295] (32-bit unsigned)
   */
  describe('hashToInt', () => {
    it('produces deterministic integer for same input', () => {
      const hash1 = hashToInt('user:123:experiment:test')
      const hash2 = hashToInt('user:123:experiment:test')
      expect(hash1).toBe(hash2)
    })

    it('produces different integers for different inputs', () => {
      const hash1 = hashToInt('user:123:experiment:test')
      const hash2 = hashToInt('user:456:experiment:test')
      expect(hash1).not.toBe(hash2)
    })

    it('returns a non-negative integer', () => {
      const hash = hashToInt('any-string')
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(hash)).toBe(true)
    })

    it('returns value within 32-bit unsigned range', () => {
      const inputs = ['a', 'b', 'test', 'user:1', 'experiment:99']
      for (const input of inputs) {
        const hash = hashToInt(input)
        expect(hash).toBeGreaterThanOrEqual(0)
        expect(hash).toBeLessThanOrEqual(0xffffffff)
      }
    })

    it('handles empty string', () => {
      const hash = hashToInt('')
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(hash)).toBe(true)
    })

    it('handles unicode strings', () => {
      const hash1 = hashToInt('user:johndoe:experiment:pricing')
      const hash2 = hashToInt('user:johndoe:experiment:pricing')
      expect(hash1).toBe(hash2)
    })

    it('handles long strings', () => {
      const longString = 'x'.repeat(10000)
      const hash = hashToInt(longString)
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(hash).toBeLessThanOrEqual(0xffffffff)
    })

    it('produces good distribution for bucket assignment', () => {
      // Generate many hashes and check they spread across buckets
      const buckets = new Map<number, number>()
      const numBuckets = 100
      const numSamples = 1000

      for (let i = 0; i < numSamples; i++) {
        const hash = hashToInt(`sample:${i}`)
        const bucket = hash % numBuckets
        buckets.set(bucket, (buckets.get(bucket) || 0) + 1)
      }

      // All buckets should have at least some entries
      // With 1000 samples and 100 buckets, expect ~10 per bucket on average
      // Allow for some variance but ensure no bucket is severely underrepresented
      const minExpected = 2 // Very lenient minimum
      let underrepresentedBuckets = 0
      for (let i = 0; i < numBuckets; i++) {
        if ((buckets.get(i) || 0) < minExpected) {
          underrepresentedBuckets++
        }
      }
      // Allow up to 10% of buckets to be underrepresented due to randomness
      expect(underrepresentedBuckets).toBeLessThan(numBuckets * 0.1)
    })
  })
})
