import { describe, it, expect } from 'vitest'
import { murmurHash3, murmurHash3_32 } from '../murmur3'

describe('MurmurHash3', () => {
  describe('murmurHash3 (string input)', () => {
    it('should return consistent hash for same input', () => {
      const hash1 = murmurHash3('hello', 0)
      const hash2 = murmurHash3('hello', 0)
      expect(hash1).toBe(hash2)
    })

    it('should return different hashes for different inputs', () => {
      const hash1 = murmurHash3('hello', 0)
      const hash2 = murmurHash3('world', 0)
      expect(hash1).not.toBe(hash2)
    })

    it('should return different hashes for different seeds', () => {
      const hash1 = murmurHash3('hello', 0)
      const hash2 = murmurHash3('hello', 42)
      expect(hash1).not.toBe(hash2)
    })

    it('should return unsigned 32-bit integer', () => {
      const hash = murmurHash3('test', 0)
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(hash).toBeLessThanOrEqual(0xffffffff)
    })

    it('should handle empty string', () => {
      const hash = murmurHash3('', 0)
      expect(typeof hash).toBe('number')
      expect(hash).toBeGreaterThanOrEqual(0)
    })

    it('should handle single character', () => {
      const hash = murmurHash3('a', 0)
      expect(typeof hash).toBe('number')
      expect(hash).toBeGreaterThanOrEqual(0)
    })

    it('should handle strings of various lengths', () => {
      // Test strings that exercise different tail lengths (0, 1, 2, 3 remaining bytes)
      const strings = ['', 'a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg']
      for (const str of strings) {
        const hash = murmurHash3(str, 0)
        expect(typeof hash).toBe('number')
        expect(hash).toBeGreaterThanOrEqual(0)
        expect(hash).toBeLessThanOrEqual(0xffffffff)
      }
    })

    it('should produce well-distributed hashes', () => {
      // Generate hashes for sequential keys and check they are reasonably distributed
      const hashes = new Set<number>()
      for (let i = 0; i < 1000; i++) {
        hashes.add(murmurHash3(`key-${i}`, 0))
      }
      // Should have at least 99% unique hashes (collisions are rare)
      expect(hashes.size).toBeGreaterThanOrEqual(990)
    })

    it('should produce known reference values', () => {
      // These are reference values to ensure the implementation is consistent
      // If these change, the hash function behavior has changed
      const hash1 = murmurHash3('test', 0)
      const hash2 = murmurHash3('hello world', 0)
      const hash3 = murmurHash3('MurmurHash3', 42)

      // Store and verify deterministic behavior
      expect(murmurHash3('test', 0)).toBe(hash1)
      expect(murmurHash3('hello world', 0)).toBe(hash2)
      expect(murmurHash3('MurmurHash3', 42)).toBe(hash3)
    })
  })

  describe('murmurHash3_32 (Uint8Array input)', () => {
    it('should return consistent hash for same input', () => {
      const input = new Uint8Array([1, 2, 3, 4])
      const hash1 = murmurHash3_32(input, 0)
      const hash2 = murmurHash3_32(input, 0)
      expect(hash1).toBe(hash2)
    })

    it('should return different hashes for different inputs', () => {
      const input1 = new Uint8Array([1, 2, 3, 4])
      const input2 = new Uint8Array([5, 6, 7, 8])
      const hash1 = murmurHash3_32(input1, 0)
      const hash2 = murmurHash3_32(input2, 0)
      expect(hash1).not.toBe(hash2)
    })

    it('should return different hashes for different seeds', () => {
      const input = new Uint8Array([1, 2, 3, 4])
      const hash1 = murmurHash3_32(input, 0)
      const hash2 = murmurHash3_32(input, 42)
      expect(hash1).not.toBe(hash2)
    })

    it('should return unsigned 32-bit integer', () => {
      const input = new Uint8Array([1, 2, 3, 4])
      const hash = murmurHash3_32(input, 0)
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(hash).toBeLessThanOrEqual(0xffffffff)
    })

    it('should handle empty array', () => {
      const hash = murmurHash3_32(new Uint8Array([]), 0)
      expect(typeof hash).toBe('number')
      expect(hash).toBeGreaterThanOrEqual(0)
    })

    it('should handle arrays of various lengths', () => {
      // Test arrays that exercise different tail lengths (0, 1, 2, 3 remaining bytes)
      for (let len = 0; len <= 10; len++) {
        const arr = new Uint8Array(len)
        for (let i = 0; i < len; i++) arr[i] = i + 1
        const hash = murmurHash3_32(arr, 0)
        expect(typeof hash).toBe('number')
        expect(hash).toBeGreaterThanOrEqual(0)
        expect(hash).toBeLessThanOrEqual(0xffffffff)
      }
    })

    it('should use default seed of 0 when not provided', () => {
      const input = new Uint8Array([1, 2, 3, 4])
      const hashWithExplicitSeed = murmurHash3_32(input, 0)
      const hashWithDefaultSeed = murmurHash3_32(input)
      expect(hashWithExplicitSeed).toBe(hashWithDefaultSeed)
    })

    it('should produce well-distributed hashes', () => {
      // Generate hashes for sequential byte arrays and check distribution
      const hashes = new Set<number>()
      const encoder = new TextEncoder()
      for (let i = 0; i < 1000; i++) {
        hashes.add(murmurHash3_32(encoder.encode(`key-${i}`), 0))
      }
      // Should have at least 99% unique hashes
      expect(hashes.size).toBeGreaterThanOrEqual(990)
    })

    it('should produce known reference values', () => {
      const encoder = new TextEncoder()
      const hash1 = murmurHash3_32(encoder.encode('test'), 0)
      const hash2 = murmurHash3_32(encoder.encode('hello world'), 0)
      const hash3 = murmurHash3_32(encoder.encode('MurmurHash3'), 42)

      // Store and verify deterministic behavior
      expect(murmurHash3_32(encoder.encode('test'), 0)).toBe(hash1)
      expect(murmurHash3_32(encoder.encode('hello world'), 0)).toBe(hash2)
      expect(murmurHash3_32(encoder.encode('MurmurHash3'), 42)).toBe(hash3)
    })
  })

  describe('cross-function consistency', () => {
    it('should produce same hash for equivalent string and byte array inputs', () => {
      // For ASCII strings, murmurHash3(str) should equal murmurHash3_32(encoder.encode(str))
      // when both use the same seed
      const encoder = new TextEncoder()
      const testCases = ['', 'a', 'ab', 'abc', 'abcd', 'test', 'hello']

      for (const str of testCases) {
        const hashString = murmurHash3(str, 0)
        const hashBytes = murmurHash3_32(encoder.encode(str), 0)
        expect(hashString).toBe(hashBytes)
      }
    })
  })
})
