import { describe, it, expect, beforeEach } from 'vitest'
import {
  sha1,
  sha256,
  sha384,
  sha512,
  computeHash,
  HashAlgorithm,
  HASH_LENGTHS,
  createStreamingHasher,
  hashStream,
  hashBuffer,
  configureHashCache,
  clearHashCache,
  getHashCacheStats,
  isValidHash,
  detectAlgorithm,
  bytesToHex,
  hexToBytes,
} from './hash'

describe('SHA-1 Hash Computation', () => {
  it('should hash empty Uint8Array to known SHA-1 value', async () => {
    const data = new Uint8Array([])
    const hash = await sha1(data)
    expect(hash).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
  })

  it('should hash "hello" to known SHA-1 value', async () => {
    const data = new TextEncoder().encode('hello')
    const hash = await sha1(data)
    expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
  })

  it('should hash binary data correctly', async () => {
    const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const hash = await sha1(data)
    // Expected SHA-1 hash for bytes [0-9]
    expect(hash).toBe('494179714a6cd627239dfededf2de9ef994caf03')
  })

  it('should produce different hashes for different inputs', async () => {
    const data1 = new TextEncoder().encode('hello')
    const data2 = new TextEncoder().encode('world')
    const hash1 = await sha1(data1)
    const hash2 = await sha1(data2)
    expect(hash1).not.toBe(hash2)
  })

  it('should produce same hash for same inputs (deterministic)', async () => {
    const data = new TextEncoder().encode('test data')
    const hash1 = await sha1(data)
    const hash2 = await sha1(data)
    expect(hash1).toBe(hash2)
  })

  it('should produce 40-character hex string', async () => {
    const data = new TextEncoder().encode('hello')
    const hash = await sha1(data)
    expect(hash).toHaveLength(40)
    expect(hash).toMatch(/^[a-f0-9]{40}$/)
  })
})

describe('SHA-256 Hash Computation', () => {
  it('should hash empty Uint8Array to known SHA-256 value', async () => {
    const data = new Uint8Array([])
    const hash = await sha256(data)
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('should hash "hello" to known SHA-256 value', async () => {
    const data = new TextEncoder().encode('hello')
    const hash = await sha256(data)
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('should hash binary data correctly', async () => {
    const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const hash = await sha256(data)
    // Expected SHA-256 hash for bytes [0-9]
    expect(hash).toBe('1f825aa2f0020ef7cf91dfa30da4668d791c5d4824fc8e41354b89ec05795ab3')
  })

  it('should produce different hashes for different inputs', async () => {
    const data1 = new TextEncoder().encode('hello')
    const data2 = new TextEncoder().encode('world')
    const hash1 = await sha256(data1)
    const hash2 = await sha256(data2)
    expect(hash1).not.toBe(hash2)
  })

  it('should produce same hash for same inputs (deterministic)', async () => {
    const data = new TextEncoder().encode('test data')
    const hash1 = await sha256(data)
    const hash2 = await sha256(data)
    expect(hash1).toBe(hash2)
  })

  it('should produce 64-character hex string', async () => {
    const data = new TextEncoder().encode('hello')
    const hash = await sha256(data)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('Large Data Hashing', () => {
  it('should hash large data (>1MB) with SHA-1', async () => {
    // Create 1.5MB of data
    const size = 1.5 * 1024 * 1024
    const data = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
      data[i] = i % 256
    }

    const hash = await sha1(data)
    expect(hash).toHaveLength(40)
    expect(hash).toMatch(/^[a-f0-9]{40}$/)
  })

  it('should hash large data (>1MB) with SHA-256', async () => {
    // Create 1.5MB of data
    const size = 1.5 * 1024 * 1024
    const data = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
      data[i] = i % 256
    }

    const hash = await sha256(data)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('Edge Cases', () => {
  it('should handle single byte with SHA-1', async () => {
    const data = new Uint8Array([42])
    const hash = await sha1(data)
    expect(hash).toHaveLength(40)
  })

  it('should handle single byte with SHA-256', async () => {
    const data = new Uint8Array([42])
    const hash = await sha256(data)
    expect(hash).toHaveLength(64)
  })

  it('should handle all-zeros data with SHA-1', async () => {
    const data = new Uint8Array(100)
    const hash = await sha1(data)
    expect(hash).toHaveLength(40)
    expect(hash).toMatch(/^[a-f0-9]{40}$/)
  })

  it('should handle all-zeros data with SHA-256', async () => {
    const data = new Uint8Array(100)
    const hash = await sha256(data)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('should handle all-ones data with SHA-1', async () => {
    const data = new Uint8Array(100).fill(255)
    const hash = await sha1(data)
    expect(hash).toHaveLength(40)
    expect(hash).toMatch(/^[a-f0-9]{40}$/)
  })

  it('should handle all-ones data with SHA-256', async () => {
    const data = new Uint8Array(100).fill(255)
    const hash = await sha256(data)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})

// ============================================================================
// New Tests for Refactored Features
// ============================================================================

describe('HashAlgorithm Enum', () => {
  it('should have correct Web Crypto API values', () => {
    expect(HashAlgorithm.SHA1).toBe('SHA-1')
    expect(HashAlgorithm.SHA256).toBe('SHA-256')
    expect(HashAlgorithm.SHA384).toBe('SHA-384')
    expect(HashAlgorithm.SHA512).toBe('SHA-512')
  })

  it('should have correct hash lengths defined', () => {
    expect(HASH_LENGTHS[HashAlgorithm.SHA1]).toBe(40)
    expect(HASH_LENGTHS[HashAlgorithm.SHA256]).toBe(64)
    expect(HASH_LENGTHS[HashAlgorithm.SHA384]).toBe(96)
    expect(HASH_LENGTHS[HashAlgorithm.SHA512]).toBe(128)
  })
})

describe('SHA-384 Hash Computation', () => {
  it('should hash empty data to known SHA-384 value', async () => {
    const hash = await sha384(new Uint8Array([]))
    expect(hash).toBe('38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b')
    expect(hash).toHaveLength(96)
  })

  it('should hash "hello" correctly', async () => {
    const hash = await sha384('hello')
    expect(hash).toHaveLength(96)
    expect(hash).toMatch(/^[a-f0-9]{96}$/)
  })
})

describe('SHA-512 Hash Computation', () => {
  it('should hash empty data to known SHA-512 value', async () => {
    const hash = await sha512(new Uint8Array([]))
    expect(hash).toBe('cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e')
    expect(hash).toHaveLength(128)
  })

  it('should hash "hello" correctly', async () => {
    const hash = await sha512('hello')
    expect(hash).toHaveLength(128)
    expect(hash).toMatch(/^[a-f0-9]{128}$/)
  })
})

describe('Unified computeHash Function', () => {
  beforeEach(() => {
    clearHashCache()
  })

  it('should default to SHA-256', async () => {
    const data = new TextEncoder().encode('hello')
    const hash = await computeHash(data)
    const expected = await sha256(data)
    expect(hash).toBe(expected)
  })

  it('should support all algorithms via enum', async () => {
    const data = 'test data'

    const sha1Hash = await computeHash(data, HashAlgorithm.SHA1)
    const sha256Hash = await computeHash(data, HashAlgorithm.SHA256)
    const sha384Hash = await computeHash(data, HashAlgorithm.SHA384)
    const sha512Hash = await computeHash(data, HashAlgorithm.SHA512)

    expect(sha1Hash).toHaveLength(40)
    expect(sha256Hash).toHaveLength(64)
    expect(sha384Hash).toHaveLength(96)
    expect(sha512Hash).toHaveLength(128)
  })

  it('should accept string input', async () => {
    const hash = await computeHash('hello', HashAlgorithm.SHA256)
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })
})

describe('Hash Cache', () => {
  beforeEach(() => {
    clearHashCache()
    configureHashCache({ enabled: true, maxSize: 100 })
  })

  it('should return stats', () => {
    const stats = getHashCacheStats()
    expect(stats).toHaveProperty('size')
    expect(stats).toHaveProperty('maxSize')
    expect(stats).toHaveProperty('enabled')
    expect(stats.enabled).toBe(true)
  })

  it('should cache results when enabled', async () => {
    const data = new TextEncoder().encode('cache test')

    // First call - computes hash
    const hash1 = await computeHash(data, HashAlgorithm.SHA256)

    // Second call - should use cache
    const hash2 = await computeHash(data, HashAlgorithm.SHA256)

    expect(hash1).toBe(hash2)
  })

  it('should be clearable', async () => {
    const data = new TextEncoder().encode('cache test')
    await computeHash(data, HashAlgorithm.SHA256)

    clearHashCache()
    const stats = getHashCacheStats()
    expect(stats.size).toBe(0)
  })

  it('should be configurable to disable', async () => {
    configureHashCache({ enabled: false })
    const stats = getHashCacheStats()
    expect(stats.enabled).toBe(false)
  })

  it('should respect useCache option', async () => {
    const data = new TextEncoder().encode('no cache test')

    // Compute without caching
    const hash1 = await computeHash(data, HashAlgorithm.SHA256, { useCache: false })

    // Stats should show no cached entry
    const stats = getHashCacheStats()
    expect(stats.size).toBe(0)

    // Should still produce correct hash
    expect(hash1).toHaveLength(64)
  })
})

describe('Streaming Hash Support', () => {
  describe('createStreamingHasher', () => {
    it('should create a hasher with default SHA-256', async () => {
      const hasher = createStreamingHasher()
      hasher.update('hello')
      const hash = await hasher.finalize()
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    it('should support multiple update calls', async () => {
      const hasher = createStreamingHasher(HashAlgorithm.SHA256)
      hasher.update('hel')
      hasher.update('lo')
      const hash = await hasher.finalize()

      // Should match direct hash of 'hello'
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    it('should track bytes processed', () => {
      const hasher = createStreamingHasher()
      expect(hasher.bytesProcessed()).toBe(0)

      hasher.update(new Uint8Array(100))
      expect(hasher.bytesProcessed()).toBe(100)

      hasher.update(new Uint8Array(50))
      expect(hasher.bytesProcessed()).toBe(150)
    })

    it('should be resettable', async () => {
      const hasher = createStreamingHasher(HashAlgorithm.SHA256)
      hasher.update('hello')
      hasher.reset()

      expect(hasher.bytesProcessed()).toBe(0)

      hasher.update('world')
      const hash = await hasher.finalize()

      // Should match hash of 'world' only
      const expected = await sha256('world')
      expect(hash).toBe(expected)
    })

    it('should support string and Uint8Array inputs', async () => {
      const hasher = createStreamingHasher(HashAlgorithm.SHA1)
      hasher.update('hel')
      hasher.update(new TextEncoder().encode('lo'))
      const hash = await hasher.finalize()

      expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })
  })

  describe('hashStream', () => {
    it('should hash a ReadableStream', async () => {
      const chunks = [
        new TextEncoder().encode('hel'),
        new TextEncoder().encode('lo'),
      ]

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk)
          }
          controller.close()
        },
      })

      const hash = await hashStream(stream, HashAlgorithm.SHA256)
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    it('should call progress callback', async () => {
      const chunks = [
        new Uint8Array(100),
        new Uint8Array(200),
        new Uint8Array(50),
      ]

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk)
          }
          controller.close()
        },
      })

      const progressCalls: number[] = []
      await hashStream(stream, HashAlgorithm.SHA256, {
        onProgress: (bytes) => progressCalls.push(bytes),
      })

      expect(progressCalls).toEqual([100, 300, 350])
    })
  })

  describe('hashBuffer', () => {
    it('should hash small buffers directly', async () => {
      const buffer = new TextEncoder().encode('hello').buffer
      const hash = await hashBuffer(buffer, HashAlgorithm.SHA256)
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    it('should hash large buffers in chunks', async () => {
      const size = 256 * 1024 // 256KB (larger than default 64KB chunk)
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        data[i] = i % 256
      }

      const hash = await hashBuffer(data.buffer, HashAlgorithm.SHA256, { chunkSize: 32 * 1024 })
      const expected = await sha256(data)
      expect(hash).toBe(expected)
    })

    it('should call progress callback for large buffers', async () => {
      const size = 256 * 1024
      const data = new Uint8Array(size)

      const progressCalls: Array<{ bytes: number; total: number | undefined }> = []
      await hashBuffer(data.buffer, HashAlgorithm.SHA256, {
        chunkSize: 64 * 1024,
        onProgress: (bytes, total) => progressCalls.push({ bytes, total }),
      })

      // Should have 4 progress calls for 256KB / 64KB chunks
      expect(progressCalls.length).toBe(4)
      expect(progressCalls[progressCalls.length - 1]!.bytes).toBe(size)
    })
  })
})

describe('Hash Validation Utilities', () => {
  describe('isValidHash', () => {
    it('should validate correct SHA-1 hashes', () => {
      expect(isValidHash('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d', HashAlgorithm.SHA1)).toBe(true)
    })

    it('should validate correct SHA-256 hashes', () => {
      expect(isValidHash('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', HashAlgorithm.SHA256)).toBe(true)
    })

    it('should reject wrong length hashes', () => {
      expect(isValidHash('2cf24dba5fb0a30e26e83b2ac5b9e29e', HashAlgorithm.SHA256)).toBe(false)
    })

    it('should reject invalid characters', () => {
      expect(isValidHash('zzf4c61ddcc5e8a2dabede0f3b482cd9aea9434d', HashAlgorithm.SHA1)).toBe(false)
    })

    it('should validate any known length when algorithm not specified', () => {
      // SHA-1 length
      expect(isValidHash('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')).toBe(true)
      // SHA-256 length
      expect(isValidHash('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')).toBe(true)
      // Invalid length
      expect(isValidHash('abcdef')).toBe(false)
    })

    it('should be case insensitive', () => {
      expect(isValidHash('AAF4C61DDCC5E8A2DABEDE0F3B482CD9AEA9434D', HashAlgorithm.SHA1)).toBe(true)
    })
  })

  describe('detectAlgorithm', () => {
    it('should detect SHA-1 from 40-char hash', () => {
      expect(detectAlgorithm('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')).toBe(HashAlgorithm.SHA1)
    })

    it('should detect SHA-256 from 64-char hash', () => {
      expect(detectAlgorithm('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')).toBe(HashAlgorithm.SHA256)
    })

    it('should detect SHA-384 from 96-char hash', () => {
      const sha384Hash = '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b'
      expect(detectAlgorithm(sha384Hash)).toBe(HashAlgorithm.SHA384)
    })

    it('should detect SHA-512 from 128-char hash', () => {
      const sha512Hash = 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e'
      expect(detectAlgorithm(sha512Hash)).toBe(HashAlgorithm.SHA512)
    })

    it('should return undefined for unknown lengths', () => {
      expect(detectAlgorithm('abcdef')).toBeUndefined()
    })
  })
})

describe('Hex Conversion Optimizations', () => {
  it('should handle round-trip conversion', () => {
    const original = new Uint8Array([0, 127, 255, 16, 32, 48])
    const hex = bytesToHex(original)
    const converted = hexToBytes(hex)
    expect(Array.from(converted)).toEqual(Array.from(original))
  })

  it('should handle empty arrays', () => {
    expect(bytesToHex(new Uint8Array([]))).toBe('')
    expect(Array.from(hexToBytes(''))).toEqual([])
  })

  it('should handle uppercase hex input', () => {
    const bytes = hexToBytes('AABBCCDD')
    expect(Array.from(bytes)).toEqual([0xaa, 0xbb, 0xcc, 0xdd])
  })

  it('should handle mixed case hex input', () => {
    const bytes = hexToBytes('aAbBcCdD')
    expect(Array.from(bytes)).toEqual([0xaa, 0xbb, 0xcc, 0xdd])
  })
})
