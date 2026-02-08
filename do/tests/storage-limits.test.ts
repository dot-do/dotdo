/**
 * Tests for Cloudflare DO Storage Limits and Guards
 *
 * @module @dotdo/do/tests/storage-limits
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Constants
  MAX_MEMORY_MB,
  MAX_STORAGE_GB,
  MAX_VALUE_SIZE,
  MAX_LIST_BATCH,
  MAX_KEY_SIZE,
  MAX_KEYS_PER_GET,
  MAX_KEYS_PER_PUT,
  DEFAULT_WARN_THRESHOLD,
  WARN_VALUE_SIZE,
  // Guard
  StorageGuard,
  StorageLimitError,
  // Helpers
  estimateValueSize,
  formatBytes,
  // Types
  type StorageGuardConfig,
  type StorageGuardResult,
} from '../storage-limits'

// =============================================================================
// Constants
// =============================================================================

describe('Storage Limit Constants', () => {
  it('should define correct CF DO memory limit', () => {
    expect(MAX_MEMORY_MB).toBe(128)
  })

  it('should define correct CF DO storage limit', () => {
    expect(MAX_STORAGE_GB).toBe(10)
  })

  it('should define correct CF DO value size limit (128 KB)', () => {
    expect(MAX_VALUE_SIZE).toBe(128 * 1024)
    expect(MAX_VALUE_SIZE).toBe(131072)
  })

  it('should define correct CF DO list batch limit', () => {
    expect(MAX_LIST_BATCH).toBe(1000)
  })

  it('should define correct CF DO key size limit (2 KB)', () => {
    expect(MAX_KEY_SIZE).toBe(2048)
  })

  it('should define correct CF DO batch get limit', () => {
    expect(MAX_KEYS_PER_GET).toBe(128)
  })

  it('should define correct CF DO batch put limit', () => {
    expect(MAX_KEYS_PER_PUT).toBe(128)
  })

  it('should define warn threshold at 80%', () => {
    expect(DEFAULT_WARN_THRESHOLD).toBe(0.8)
  })

  it('should calculate warn value size correctly', () => {
    expect(WARN_VALUE_SIZE).toBe(Math.floor(MAX_VALUE_SIZE * 0.8))
    expect(WARN_VALUE_SIZE).toBe(104857) // floor(131072 * 0.8)
  })
})

// =============================================================================
// StorageLimitError
// =============================================================================

describe('StorageLimitError', () => {
  it('should create error with limit details', () => {
    const error = new StorageLimitError('MAX_VALUE_SIZE', 200000, 131072)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(StorageLimitError)
    expect(error.name).toBe('StorageLimitError')
    expect(error.limit).toBe('MAX_VALUE_SIZE')
    expect(error.actual).toBe(200000)
    expect(error.maximum).toBe(131072)
    expect(error.message).toContain('Storage limit exceeded')
    expect(error.message).toContain('200000')
    expect(error.message).toContain('131072')
  })

  it('should accept custom message', () => {
    const error = new StorageLimitError('MAX_KEY_SIZE', 3000, 2048, 'Key too long')
    expect(error.message).toBe('Key too long')
    expect(error.limit).toBe('MAX_KEY_SIZE')
  })
})

// =============================================================================
// estimateValueSize
// =============================================================================

describe('estimateValueSize', () => {
  it('should return 0 for null and undefined', () => {
    expect(estimateValueSize(null)).toBe(0)
    expect(estimateValueSize(undefined)).toBe(0)
  })

  it('should return byte length for ArrayBuffer', () => {
    const buffer = new ArrayBuffer(1024)
    expect(estimateValueSize(buffer)).toBe(1024)
  })

  it('should return byte length for Uint8Array', () => {
    const arr = new Uint8Array(512)
    expect(estimateValueSize(arr)).toBe(512)
  })

  it('should return UTF-8 encoded length for strings', () => {
    // ASCII string: 1 byte per char
    expect(estimateValueSize('hello')).toBe(5)
    // Empty string
    expect(estimateValueSize('')).toBe(0)
  })

  it('should return 8 for numbers and booleans', () => {
    expect(estimateValueSize(42)).toBe(8)
    expect(estimateValueSize(3.14)).toBe(8)
    expect(estimateValueSize(true)).toBe(8)
    expect(estimateValueSize(false)).toBe(8)
  })

  it('should estimate object size via JSON serialization', () => {
    const obj = { name: 'Alice', age: 30 }
    const expected = new TextEncoder().encode(JSON.stringify(obj)).byteLength
    expect(estimateValueSize(obj)).toBe(expected)
  })

  it('should estimate array size via JSON serialization', () => {
    const arr = [1, 2, 3, 'four', { five: 5 }]
    const expected = new TextEncoder().encode(JSON.stringify(arr)).byteLength
    expect(estimateValueSize(arr)).toBe(expected)
  })

  it('should return over-limit for non-serializable values', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    // JSON.stringify fails for circular references, should return MAX_VALUE_SIZE + 1
    expect(estimateValueSize(circular)).toBeGreaterThan(MAX_VALUE_SIZE)
  })
})

// =============================================================================
// formatBytes
// =============================================================================

describe('formatBytes', () => {
  it('should format zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('should format bytes', () => {
    expect(formatBytes(500)).toBe('500 B')
  })

  it('should format kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('should format megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
  })

  it('should format gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
  })

  it('should format MAX_VALUE_SIZE as 128 KB', () => {
    expect(formatBytes(MAX_VALUE_SIZE)).toBe('128 KB')
  })
})

// =============================================================================
// StorageGuard - checkValueSize
// =============================================================================

describe('StorageGuard', () => {
  let guard: StorageGuard

  beforeEach(() => {
    guard = new StorageGuard()
  })

  describe('checkValueSize', () => {
    it('should allow small values', () => {
      const result = guard.checkValueSize({ name: 'Alice' })
      expect(result.allowed).toBe(true)
      expect(result.warning).toBeUndefined()
      expect(result.error).toBeUndefined()
    })

    it('should throw for values exceeding MAX_VALUE_SIZE', () => {
      // Create a string larger than 128KB
      const largeValue = 'x'.repeat(MAX_VALUE_SIZE + 1000)
      expect(() => guard.checkValueSize(largeValue)).toThrow(StorageLimitError)
    })

    it('should include key name in error message when provided', () => {
      const largeValue = 'x'.repeat(MAX_VALUE_SIZE + 1000)
      try {
        guard.checkValueSize(largeValue, 'my-key')
        expect.fail('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(StorageLimitError)
        expect((e as StorageLimitError).message).toContain('my-key')
      }
    })

    it('should warn for values approaching the limit', () => {
      // Create a string at ~90% of limit (above 80% warn threshold)
      const size = Math.floor(MAX_VALUE_SIZE * 0.9)
      const largeish = 'x'.repeat(size)
      const result = guard.checkValueSize(largeish)
      expect(result.allowed).toBe(true)
      expect(result.warning).toBeDefined()
      expect(result.warning).toContain('approaching limit')
    })

    it('should not warn for values below warn threshold', () => {
      // Create a value at 50% of limit
      const size = Math.floor(MAX_VALUE_SIZE * 0.5)
      const value = 'x'.repeat(size)
      const result = guard.checkValueSize(value)
      expect(result.allowed).toBe(true)
      expect(result.warning).toBeUndefined()
    })

    it('should respect warn mode for oversized values', () => {
      const warnGuard = new StorageGuard({ onValueSizeExceeded: 'warn' })
      const largeValue = 'x'.repeat(MAX_VALUE_SIZE + 1000)
      // Should NOT throw, just return error in result
      const result = warnGuard.checkValueSize(largeValue)
      expect(result.allowed).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should throw in warn zone when configured to throw on warnings', () => {
      const strictGuard = new StorageGuard({ onValueSizeWarning: 'throw' })
      const size = Math.floor(MAX_VALUE_SIZE * 0.9)
      const value = 'x'.repeat(size)
      expect(() => strictGuard.checkValueSize(value)).toThrow(StorageLimitError)
    })

    it('should respect custom warn threshold', () => {
      // Set warn threshold to 50%
      const lowThreshold = new StorageGuard({ warnThreshold: 0.5 })
      // 60% of limit should trigger warning with 50% threshold
      const size = Math.floor(MAX_VALUE_SIZE * 0.6)
      const value = 'x'.repeat(size)
      const result = lowThreshold.checkValueSize(value)
      expect(result.allowed).toBe(true)
      expect(result.warning).toBeDefined()
    })
  })

  // ===========================================================================
  // checkKeySize
  // ===========================================================================

  describe('checkKeySize', () => {
    it('should allow normal keys', () => {
      const result = guard.checkKeySize('user:12345')
      expect(result.allowed).toBe(true)
    })

    it('should throw for keys exceeding MAX_KEY_SIZE', () => {
      const longKey = 'k'.repeat(MAX_KEY_SIZE + 1)
      expect(() => guard.checkKeySize(longKey)).toThrow(StorageLimitError)
    })

    it('should allow keys at exactly MAX_KEY_SIZE', () => {
      // ASCII chars are 1 byte each
      const exactKey = 'k'.repeat(MAX_KEY_SIZE)
      const result = guard.checkKeySize(exactKey)
      expect(result.allowed).toBe(true)
    })

    it('should count UTF-8 bytes not characters', () => {
      // Emoji is 4 bytes in UTF-8
      // 513 emojis = 2052 bytes > 2048
      const emojiKey = '\u{1F600}'.repeat(513)
      expect(() => guard.checkKeySize(emojiKey)).toThrow(StorageLimitError)
    })

    it('should respect warn mode', () => {
      const warnGuard = new StorageGuard({ onKeySizeExceeded: 'warn' })
      const longKey = 'k'.repeat(MAX_KEY_SIZE + 1)
      const result = warnGuard.checkKeySize(longKey)
      expect(result.allowed).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should truncate long keys in error messages', () => {
      const longKey = 'k'.repeat(MAX_KEY_SIZE + 100)
      try {
        guard.checkKeySize(longKey)
        expect.fail('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(StorageLimitError)
        expect((e as StorageLimitError).message).toContain('...')
      }
    })
  })

  // ===========================================================================
  // checkPut
  // ===========================================================================

  describe('checkPut', () => {
    it('should allow valid key-value pairs', () => {
      const result = guard.checkPut('user:123', { name: 'Alice' })
      expect(result.allowed).toBe(true)
    })

    it('should reject oversized keys', () => {
      const longKey = 'k'.repeat(MAX_KEY_SIZE + 1)
      expect(() => guard.checkPut(longKey, 'value')).toThrow(StorageLimitError)
    })

    it('should reject oversized values', () => {
      const largeValue = 'x'.repeat(MAX_VALUE_SIZE + 1)
      expect(() => guard.checkPut('key', largeValue)).toThrow(StorageLimitError)
    })

    it('should check key before value', () => {
      const longKey = 'k'.repeat(MAX_KEY_SIZE + 1)
      const largeValue = 'x'.repeat(MAX_VALUE_SIZE + 1)
      try {
        guard.checkPut(longKey, largeValue)
        expect.fail('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(StorageLimitError)
        expect((e as StorageLimitError).limit).toBe('MAX_KEY_SIZE')
      }
    })
  })

  // ===========================================================================
  // paginatedList
  // ===========================================================================

  describe('paginatedList', () => {
    /**
     * Creates a mock DurableObjectStorage.list() that returns entries
     * in batches, simulating the CF 1000-key limit.
     */
    function createMockStorage(totalEntries: number): DurableObjectStorage {
      const allEntries = new Map<string, unknown>()
      for (let i = 0; i < totalEntries; i++) {
        const key = `key-${String(i).padStart(6, '0')}`
        allEntries.set(key, { index: i })
      }

      const sortedKeys = [...allEntries.keys()].sort()

      return {
        list: vi.fn(async (opts?: Record<string, unknown>) => {
          const limit = (opts?.limit as number) ?? MAX_LIST_BATCH
          const prefix = opts?.prefix as string | undefined
          const startAfter = opts?.startAfter as string | undefined
          const reverse = opts?.reverse as boolean | undefined

          let keys = sortedKeys.slice()

          // Apply prefix filter
          if (prefix) {
            keys = keys.filter(k => k.startsWith(prefix))
          }

          // Apply startAfter cursor
          if (startAfter) {
            const idx = keys.indexOf(startAfter)
            if (idx >= 0) {
              keys = keys.slice(idx + 1)
            } else {
              // Find first key after startAfter
              keys = keys.filter(k => k > startAfter)
            }
          }

          // Apply reverse
          if (reverse) {
            keys = keys.reverse()
          }

          // Apply limit
          keys = keys.slice(0, limit)

          const result = new Map<string, unknown>()
          for (const key of keys) {
            result.set(key, allEntries.get(key))
          }
          return result
        }),
      } as unknown as DurableObjectStorage
    }

    it('should return all entries when under MAX_LIST_BATCH', async () => {
      const storage = createMockStorage(100)
      const result = await StorageGuard.paginatedList(storage)
      expect(result.size).toBe(100)
    })

    it('should paginate when entries exceed MAX_LIST_BATCH', async () => {
      const storage = createMockStorage(2500)
      const result = await StorageGuard.paginatedList(storage)
      expect(result.size).toBe(2500)
    })

    it('should handle exactly MAX_LIST_BATCH entries', async () => {
      const storage = createMockStorage(1000)
      const result = await StorageGuard.paginatedList(storage)
      expect(result.size).toBe(1000)
    })

    it('should handle zero entries', async () => {
      const storage = createMockStorage(0)
      const result = await StorageGuard.paginatedList(storage)
      expect(result.size).toBe(0)
    })

    it('should make multiple list() calls for large datasets', async () => {
      const storage = createMockStorage(2500)
      await StorageGuard.paginatedList(storage)
      // 2500 / 1000 = 3 batches (1000 + 1000 + 500) + 1 final empty check
      // But since 500 < 1000 the third batch terminates (no extra call)
      expect(storage.list).toHaveBeenCalledTimes(3)
    })

    it('should support prefix filtering', async () => {
      const storage = createMockStorage(100)
      // Our mock keys are key-000000 to key-000099
      // "key-00009" prefix matches key-000090 to key-000099 (10 keys)
      const result = await StorageGuard.paginatedList(storage, { prefix: 'key-00009' })
      expect(result.size).toBe(10)
    })

    it('should respect the limit option', async () => {
      const storage = createMockStorage(5000)
      const result = await StorageGuard.paginatedList(storage, { limit: 1500 })
      expect(result.size).toBe(1500)
    })

    it('should respect limit when smaller than one batch', async () => {
      const storage = createMockStorage(5000)
      const result = await StorageGuard.paginatedList(storage, { limit: 50 })
      expect(result.size).toBe(50)
      // Should only make one call since limit is 50
      expect(storage.list).toHaveBeenCalledTimes(1)
    })

    it('should preserve entry order', async () => {
      const storage = createMockStorage(2500)
      const result = await StorageGuard.paginatedList(storage)
      const keys = [...result.keys()]
      // Keys should be sorted
      const sorted = [...keys].sort()
      expect(keys).toEqual(sorted)
    })

    it('should preserve values correctly', async () => {
      const storage = createMockStorage(100)
      const result = await StorageGuard.paginatedList(storage)
      const firstEntry = result.get('key-000000')
      expect(firstEntry).toEqual({ index: 0 })
      const lastEntry = result.get('key-000099')
      expect(lastEntry).toEqual({ index: 99 })
    })
  })
})
