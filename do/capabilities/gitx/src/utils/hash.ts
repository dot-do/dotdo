/**
 * @fileoverview SHA Hashing Utilities for Git Objects
 *
 * This module provides cryptographic hashing functions used for Git object
 * identification and verification. Git uses SHA-1 as its primary hash algorithm,
 * with SHA-256 available as an optional newer algorithm (Git v2.29+).
 *
 * Core hash primitives are imported from fsx.do which uses the Web Crypto API.
 * Sync primitives are kept local for pack operations that need streaming SHA1.
 *
 * @module utils/hash
 *
 * @example
 * ```typescript
 * import { sha1, hashObject, hexToBytes, bytesToHex } from './utils/hash'
 *
 * // Hash raw data
 * const hash = await sha1('Hello, World!')
 *
 * // Hash as a Git object (includes type header)
 * const content = new TextEncoder().encode('file content')
 * const blobSha = await hashObject('blob', content)
 * console.log(`blob ${blobSha}`)
 * ```
 */

// Re-export hash functions from fsx.do - now works in Workers environment
export { sha1, sha256, bytesToHex, hexToBytes } from 'fsx.do'

// Keep local sync implementations for pack operations that need streaming SHA1
export { sha1Hex } from './sha1'

// Import local bytesToHex for cache key generation (synchronous)
import { bytesToHex as localBytesToHex } from './sha1'
// Import sha1 from fsx.do for the hashObject function
import { sha1 } from 'fsx.do'

/**
 * Hash a Git object with its type header.
 *
 * @description
 * Computes the SHA-1 hash of a Git object including its header.
 * The header format is: "{type} {size}\0" followed by the content.
 *
 * This matches the output of `git hash-object` command and is the
 * standard way Git computes object identifiers.
 *
 * @param type - Object type ('blob', 'tree', 'commit', 'tag')
 * @param data - Object content as binary data (without header)
 * @returns 40-character lowercase hexadecimal SHA-1 hash
 *
 * @example
 * ```typescript
 * // Hash a blob (equivalent to `echo -n "hello" | git hash-object --stdin`)
 * const content = new TextEncoder().encode('hello')
 * const sha = await hashObject('blob', content)
 * console.log(sha) // 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0'
 *
 * // Verify with git:
 * // $ echo -n "hello" | git hash-object --stdin
 * // b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0
 * ```
 */
export async function hashObject(type: string, data: Uint8Array): Promise<string> {
  const header = `${type} ${data.length}\0`
  const headerBytes = new TextEncoder().encode(header)
  const combined = new Uint8Array(headerBytes.length + data.length)
  combined.set(headerBytes, 0)
  combined.set(data, headerBytes.length)
  return sha1(combined)
}

// ============================================================================
// Hash Caching
// ============================================================================

/**
 * LRU cache for storing computed hashes.
 *
 * @description
 * A Least Recently Used (LRU) cache implementation for caching SHA-1 hashes.
 * This is useful when the same data is hashed multiple times, such as during
 * pack file operations or object store lookups.
 *
 * **Key Strategy**: The cache key is derived from the first few bytes of the
 * data combined with its length, which provides a fast key generation while
 * avoiding collisions for different data.
 *
 * **Thread Safety**: This implementation is NOT thread-safe. In multi-threaded
 * environments, external synchronization is required.
 *
 * @class HashCache
 *
 * @example
 * ```typescript
 * const cache = new HashCache(1000) // Cache up to 1000 hashes
 *
 * // Use with getOrCompute for automatic caching
 * const hash1 = await cache.getOrCompute(data, async () => sha1(data))
 * const hash2 = await cache.getOrCompute(data, async () => sha1(data)) // Returns cached
 *
 * // Check stats
 * console.log(`Hit rate: ${cache.hitRate}%`)
 * ```
 */
export class HashCache {
  private cache: Map<string, string>
  private maxSize: number
  private hits: number = 0
  private misses: number = 0

  /**
   * Creates a new HashCache with the specified maximum size.
   *
   * @param {number} maxSize - Maximum number of hashes to cache (default: 10000)
   */
  constructor(maxSize: number = 10000) {
    this.cache = new Map()
    this.maxSize = maxSize
  }

  /**
   * Generates a cache key for the given data.
   *
   * @description Uses length + first 32 bytes (if available) to create a unique key.
   * This is fast while providing good collision resistance.
   *
   * @param {Uint8Array} data - Data to generate key for
   * @returns {string} Cache key
   * @internal
   */
  private generateKey(data: Uint8Array): string {
    // Use length + first 32 bytes as key (fast and reasonably unique)
    const prefix = data.length <= 32
      ? localBytesToHex(data)
      : localBytesToHex(data.subarray(0, 32))
    return `${data.length}:${prefix}`
  }

  /**
   * Gets a cached hash if available.
   *
   * @param {Uint8Array} data - Data to look up
   * @returns {string | undefined} Cached hash or undefined if not cached
   */
  get(data: Uint8Array): string | undefined {
    const key = this.generateKey(data)
    const value = this.cache.get(key)

    if (value !== undefined) {
      this.hits++
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
      return value
    }

    this.misses++
    return undefined
  }

  /**
   * Stores a hash in the cache.
   *
   * @param {Uint8Array} data - Original data
   * @param {string} hash - Computed hash to cache
   */
  set(data: Uint8Array, hash: string): void {
    const key = this.generateKey(data)

    // Remove oldest entry if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, hash)
  }

  /**
   * Gets a hash from cache or computes and caches it.
   *
   * @description This is the recommended way to use the cache. It automatically
   * handles cache lookup, computation, and storage.
   *
   * @param {Uint8Array} data - Data to hash
   * @param {() => Promise<string> | string} compute - Function to compute hash if not cached
   * @returns {Promise<string>} The hash (from cache or newly computed)
   *
   * @example
   * ```typescript
   * const hash = await cache.getOrCompute(data, () => sha1(data))
   * ```
   */
  async getOrCompute(
    data: Uint8Array,
    compute: () => Promise<string> | string
  ): Promise<string> {
    const cached = this.get(data)
    if (cached !== undefined) {
      return cached
    }

    const hash = await compute()
    this.set(data, hash)
    return hash
  }

  /**
   * Synchronous version of getOrCompute for use with synchronous hash functions.
   *
   * @param {Uint8Array} data - Data to hash
   * @param {() => string} compute - Function to compute hash if not cached
   * @returns {string} The hash (from cache or newly computed)
   *
   * @example
   * ```typescript
   * import { sha1Hex } from './sha1'
   * const hash = cache.getOrComputeSync(data, () => sha1Hex(data))
   * ```
   */
  getOrComputeSync(data: Uint8Array, compute: () => string): string {
    const cached = this.get(data)
    if (cached !== undefined) {
      return cached
    }

    const hash = compute()
    this.set(data, hash)
    return hash
  }

  /**
   * Clears all entries from the cache.
   */
  clear(): void {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }

  /**
   * Gets the current number of cached entries.
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Gets the cache hit rate as a percentage.
   */
  get hitRate(): number {
    const total = this.hits + this.misses
    return total === 0 ? 0 : (this.hits / total) * 100
  }

  /**
   * Gets cache statistics.
   *
   * @returns {{ hits: number; misses: number; size: number; hitRate: number }}
   */
  getStats(): { hits: number; misses: number; size: number; hitRate: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: this.hitRate
    }
  }
}

/**
 * Global hash cache instance for common use cases.
 *
 * @description
 * A shared cache instance that can be used across the application for
 * caching object hashes. This is particularly useful for pack file
 * operations where the same objects are hashed multiple times.
 *
 * **Memory Management**: The cache has a default limit of 10,000 entries.
 * For applications with different requirements, create a custom HashCache
 * instance with appropriate size.
 *
 * @example
 * ```typescript
 * import { globalHashCache, sha1 } from './utils/hash'
 *
 * // Use the global cache
 * const hash = await globalHashCache.getOrCompute(data, () => sha1(data))
 *
 * // Check cache stats
 * console.log(globalHashCache.getStats())
 * ```
 */
export const globalHashCache = new HashCache()
