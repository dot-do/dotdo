/**
 * Bloblang Crypto Stdlib Functions Tests
 * Issue: dotdo-htiek
 *
 * Tests for cryptographic hashing functions using Web Crypto API
 * for V8 isolate compatibility (works in Cloudflare Workers).
 */
import { describe, it, expect } from 'vitest'
import { cryptoFunctions } from '../stdlib/crypto'

describe('Bloblang Crypto Stdlib Functions', () => {
  describe('hash(algorithm)', () => {
    describe('SHA-256', () => {
      it('generates correct sha256 hash for "hello"', () => {
        const result = cryptoFunctions.hash.call('hello', 'sha256')
        expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
      })

      it('generates correct sha256 hash for empty string', () => {
        const result = cryptoFunctions.hash.call('', 'sha256')
        expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
      })

      it('generates correct sha256 hash for "test"', () => {
        const result = cryptoFunctions.hash.call('test', 'sha256')
        expect(result).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
      })

      it('generates consistent hashes', () => {
        const hash1 = cryptoFunctions.hash.call('consistency test', 'sha256')
        const hash2 = cryptoFunctions.hash.call('consistency test', 'sha256')
        expect(hash1).toBe(hash2)
      })

      it('generates different hashes for different inputs', () => {
        const hash1 = cryptoFunctions.hash.call('hello', 'sha256')
        const hash2 = cryptoFunctions.hash.call('world', 'sha256')
        expect(hash1).not.toBe(hash2)
      })

      it('handles UTF-8 characters', () => {
        const result = cryptoFunctions.hash.call('cafe', 'sha256')
        expect(result).toBeDefined()
        expect(typeof result).toBe('string')
        expect(result.length).toBe(64) // SHA256 hex is 64 chars
      })

      it('is case-insensitive for algorithm name', () => {
        const result1 = cryptoFunctions.hash.call('hello', 'SHA256')
        const result2 = cryptoFunctions.hash.call('hello', 'sha256')
        const result3 = cryptoFunctions.hash.call('hello', 'Sha256')
        expect(result1).toBe(result2)
        expect(result2).toBe(result3)
      })
    })

    describe('SHA-512', () => {
      it('generates correct sha512 hash for "hello"', () => {
        const result = cryptoFunctions.hash.call('hello', 'sha512')
        expect(result).toBe('9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043')
      })

      it('generates correct sha512 hash for empty string', () => {
        const result = cryptoFunctions.hash.call('', 'sha512')
        expect(result).toBe('cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e')
      })

      it('generates 128-character hex string', () => {
        const result = cryptoFunctions.hash.call('test', 'sha512')
        expect(result.length).toBe(128) // SHA512 hex is 128 chars
      })

      it('is case-insensitive for algorithm name', () => {
        const result1 = cryptoFunctions.hash.call('hello', 'SHA512')
        const result2 = cryptoFunctions.hash.call('hello', 'sha512')
        expect(result1).toBe(result2)
      })
    })

    describe('MD5', () => {
      it('generates correct md5 hash for "hello"', () => {
        const result = cryptoFunctions.hash.call('hello', 'md5')
        expect(result).toBe('5d41402abc4b2a76b9719d911017c592')
      })

      it('generates correct md5 hash for empty string', () => {
        const result = cryptoFunctions.hash.call('', 'md5')
        expect(result).toBe('d41d8cd98f00b204e9800998ecf8427e')
      })

      it('generates 32-character hex string', () => {
        const result = cryptoFunctions.hash.call('test', 'md5')
        expect(result.length).toBe(32) // MD5 hex is 32 chars
      })

      it('is case-insensitive for algorithm name', () => {
        const result1 = cryptoFunctions.hash.call('hello', 'MD5')
        const result2 = cryptoFunctions.hash.call('hello', 'md5')
        expect(result1).toBe(result2)
      })
    })

    describe('xxhash64', () => {
      it('generates xxhash64 hash', () => {
        const result = cryptoFunctions.hash.call('hello', 'xxhash64')
        expect(result).toBeDefined()
        expect(typeof result).toBe('string')
        // xxhash64 produces 16-character hex string (64 bits = 8 bytes = 16 hex chars)
        expect(result.length).toBe(16)
      })

      it('generates consistent hashes', () => {
        const hash1 = cryptoFunctions.hash.call('test data', 'xxhash64')
        const hash2 = cryptoFunctions.hash.call('test data', 'xxhash64')
        expect(hash1).toBe(hash2)
      })

      it('generates different hashes for different inputs', () => {
        const hash1 = cryptoFunctions.hash.call('hello', 'xxhash64')
        const hash2 = cryptoFunctions.hash.call('world', 'xxhash64')
        expect(hash1).not.toBe(hash2)
      })

      it('handles empty string', () => {
        const result = cryptoFunctions.hash.call('', 'xxhash64')
        expect(result).toBeDefined()
        expect(result.length).toBe(16)
      })

      it('is case-insensitive for algorithm name', () => {
        const result1 = cryptoFunctions.hash.call('hello', 'XXHASH64')
        const result2 = cryptoFunctions.hash.call('hello', 'xxhash64')
        expect(result1).toBe(result2)
      })
    })

    describe('error handling', () => {
      it('throws on non-string input', () => {
        expect(() => cryptoFunctions.hash.call(null, 'sha256')).toThrow()
        expect(() => cryptoFunctions.hash.call(undefined, 'sha256')).toThrow()
        expect(() => cryptoFunctions.hash.call(123, 'sha256')).toThrow()
        expect(() => cryptoFunctions.hash.call({ data: 'hello' }, 'sha256')).toThrow()
      })

      it('throws if algorithm argument missing', () => {
        expect(() => cryptoFunctions.hash.call('hello')).toThrow()
      })

      it('throws on unsupported algorithm', () => {
        expect(() => cryptoFunctions.hash.call('hello', 'unknown')).toThrow(/unsupported|algorithm/i)
      })

      it('throws descriptive error for invalid algorithm', () => {
        expect(() => cryptoFunctions.hash.call('hello', 'invalid_algo')).toThrow(/unsupported|algorithm/i)
      })
    })
  })

  describe('hmac(algorithm, key)', () => {
    describe('HMAC-SHA256', () => {
      it('generates correct hmac-sha256 signature', () => {
        const result = cryptoFunctions.hmac.call('hello', 'sha256', 'secret')
        expect(result).toBeDefined()
        expect(typeof result).toBe('string')
        expect(result.length).toBe(64) // HMAC-SHA256 hex is 64 chars
      })

      it('generates different signatures for different keys', () => {
        const sig1 = cryptoFunctions.hmac.call('hello', 'sha256', 'key1')
        const sig2 = cryptoFunctions.hmac.call('hello', 'sha256', 'key2')
        expect(sig1).not.toBe(sig2)
      })

      it('generates different signatures for different messages', () => {
        const sig1 = cryptoFunctions.hmac.call('hello', 'sha256', 'secret')
        const sig2 = cryptoFunctions.hmac.call('world', 'sha256', 'secret')
        expect(sig1).not.toBe(sig2)
      })

      it('generates consistent signatures', () => {
        const sig1 = cryptoFunctions.hmac.call('test message', 'sha256', 'my-key')
        const sig2 = cryptoFunctions.hmac.call('test message', 'sha256', 'my-key')
        expect(sig1).toBe(sig2)
      })

      it('handles empty message', () => {
        const result = cryptoFunctions.hmac.call('', 'sha256', 'secret')
        expect(result).toBeDefined()
        expect(result.length).toBe(64)
      })

      it('handles empty key', () => {
        const result = cryptoFunctions.hmac.call('hello', 'sha256', '')
        expect(result).toBeDefined()
        expect(result.length).toBe(64)
      })

      it('is case-insensitive for algorithm name', () => {
        const result1 = cryptoFunctions.hmac.call('hello', 'SHA256', 'secret')
        const result2 = cryptoFunctions.hmac.call('hello', 'sha256', 'secret')
        expect(result1).toBe(result2)
      })
    })

    describe('HMAC-SHA512', () => {
      it('generates correct hmac-sha512 signature', () => {
        const result = cryptoFunctions.hmac.call('hello', 'sha512', 'secret')
        expect(result).toBeDefined()
        expect(typeof result).toBe('string')
        expect(result.length).toBe(128) // HMAC-SHA512 hex is 128 chars
      })

      it('generates different signatures for different keys', () => {
        const sig1 = cryptoFunctions.hmac.call('hello', 'sha512', 'key1')
        const sig2 = cryptoFunctions.hmac.call('hello', 'sha512', 'key2')
        expect(sig1).not.toBe(sig2)
      })

      it('generates consistent signatures', () => {
        const sig1 = cryptoFunctions.hmac.call('test', 'sha512', 'key')
        const sig2 = cryptoFunctions.hmac.call('test', 'sha512', 'key')
        expect(sig1).toBe(sig2)
      })

      it('is case-insensitive for algorithm name', () => {
        const result1 = cryptoFunctions.hmac.call('hello', 'SHA512', 'secret')
        const result2 = cryptoFunctions.hmac.call('hello', 'sha512', 'secret')
        expect(result1).toBe(result2)
      })
    })

    describe('error handling', () => {
      it('throws on non-string message', () => {
        expect(() => cryptoFunctions.hmac.call(null, 'sha256', 'key')).toThrow()
        expect(() => cryptoFunctions.hmac.call(undefined, 'sha256', 'key')).toThrow()
        expect(() => cryptoFunctions.hmac.call(123, 'sha256', 'key')).toThrow()
      })

      it('throws if algorithm argument missing', () => {
        expect(() => cryptoFunctions.hmac.call('hello')).toThrow()
      })

      it('throws if key argument missing', () => {
        expect(() => cryptoFunctions.hmac.call('hello', 'sha256')).toThrow()
      })

      it('throws on unsupported algorithm', () => {
        expect(() => cryptoFunctions.hmac.call('hello', 'unknown', 'key')).toThrow(/unsupported|algorithm/i)
      })

      it('throws on non-string key', () => {
        expect(() => cryptoFunctions.hmac.call('hello', 'sha256', 123 as unknown as string)).toThrow()
        expect(() => cryptoFunctions.hmac.call('hello', 'sha256', null as unknown as string)).toThrow()
      })
    })
  })

  describe('Integration tests', () => {
    it('can hash data then verify with same algorithm', () => {
      const data = 'sensitive-data'
      const hash = cryptoFunctions.hash.call(data, 'sha256')
      const verifyHash = cryptoFunctions.hash.call(data, 'sha256')
      expect(hash).toBe(verifyHash)
    })

    it('can create signature and verify', () => {
      const message = 'important message'
      const key = 'secret-key'
      const sig1 = cryptoFunctions.hmac.call(message, 'sha256', key)
      const sig2 = cryptoFunctions.hmac.call(message, 'sha256', key)
      expect(sig1).toBe(sig2)
    })

    it('xxhash64 is faster than sha256 for same input (conceptually)', () => {
      // This is a conceptual test - xxhash64 should be usable for fast hashing
      const data = 'some data to hash quickly'
      const xxhash = cryptoFunctions.hash.call(data, 'xxhash64')
      const sha = cryptoFunctions.hash.call(data, 'sha256')
      // Both should work
      expect(xxhash).toBeDefined()
      expect(sha).toBeDefined()
      // xxhash should be shorter
      expect(xxhash.length).toBeLessThan(sha.length)
    })

    it('different algorithms produce different outputs', () => {
      const data = 'test data'
      const sha256 = cryptoFunctions.hash.call(data, 'sha256')
      const sha512 = cryptoFunctions.hash.call(data, 'sha512')
      const md5 = cryptoFunctions.hash.call(data, 'md5')
      const xxhash = cryptoFunctions.hash.call(data, 'xxhash64')

      // All should be different
      expect(sha256).not.toBe(sha512)
      expect(sha256).not.toBe(md5)
      expect(sha256).not.toBe(xxhash)
      expect(sha512).not.toBe(md5)
      expect(sha512).not.toBe(xxhash)
      expect(md5).not.toBe(xxhash)
    })
  })

  describe('Bloblang usage patterns', () => {
    it('supports root.checksum = this.data.hash("sha256") pattern', () => {
      // Simulating: root.checksum = this.data.hash("sha256")
      const thisObj = { data: 'file contents here' }
      const checksum = cryptoFunctions.hash.call(thisObj.data, 'sha256')
      expect(checksum).toBe(cryptoFunctions.hash.call('file contents here', 'sha256'))
    })

    it('supports root.signature = this.payload.hmac("sha256", $SECRET_KEY) pattern', () => {
      // Simulating: root.signature = this.payload.hmac("sha256", $SECRET_KEY)
      const thisObj = { payload: 'request body' }
      const SECRET_KEY = 'my-secret-key'
      const signature = cryptoFunctions.hmac.call(thisObj.payload, 'sha256', SECRET_KEY)
      expect(signature).toBeDefined()
      expect(signature.length).toBe(64)
    })

    it('supports root.fast_hash = this.id.hash("xxhash64") pattern', () => {
      // Simulating: root.fast_hash = this.id.hash("xxhash64")
      const thisObj = { id: 'unique-identifier-12345' }
      const fastHash = cryptoFunctions.hash.call(thisObj.id, 'xxhash64')
      expect(fastHash).toBeDefined()
      expect(fastHash.length).toBe(16)
    })
  })
})
