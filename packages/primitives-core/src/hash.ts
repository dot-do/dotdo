/**
 * Hash utilities for primitives
 *
 * Provides cryptographic hash functions (SHA-1, SHA-256) and fast non-cryptographic
 * hashes (MurmurHash3) using the Web Crypto API.
 *
 * @module @dotdo/primitives-core/hash
 */

/**
 * Pre-computed lookup table for byte-to-hex conversion.
 * Contains hex strings '00' through 'ff' for O(1) lookup.
 * @internal
 */
const HEX_LOOKUP: string[] = (() => {
  const table: string[] = new Array(256)
  for (let i = 0; i < 256; i++) {
    table[i] = i.toString(16).padStart(2, '0')
  }
  return table
})()

/**
 * Convert a Uint8Array to a hexadecimal string.
 *
 * Uses a pre-computed lookup table for O(1) byte-to-hex conversion,
 * making this significantly faster than string formatting approaches.
 *
 * @param bytes - Binary data to convert
 * @returns Lowercase hexadecimal string
 *
 * @example
 * ```typescript
 * const hello = new TextEncoder().encode('Hello')
 * const hex = bytesToHex(hello)
 * console.log(hex) // '48656c6c6f'
 * ```
 */
export function bytesToHex(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  let result = ''
  for (let i = 0; i < bytes.length; i++) {
    result += HEX_LOOKUP[bytes[i]!]
  }
  return result
}

/**
 * Convert a hexadecimal string to a Uint8Array.
 *
 * @param hex - Hexadecimal string (case-insensitive)
 * @returns Binary data as Uint8Array
 *
 * @example
 * ```typescript
 * const bytes = hexToBytes('48656c6c6f')
 * console.log(new TextDecoder().decode(bytes)) // 'Hello'
 * ```
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length === 0) return new Uint8Array(0)
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Compute SHA-1 hash of data
 *
 * @param data - Input data as Uint8Array or string (UTF-8 encoded)
 * @returns 40-character lowercase hex string
 *
 * @example
 * ```typescript
 * const hash = await sha1('hello')
 * console.log(hash) // 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
 * ```
 */
export async function sha1(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const hashBuffer = await crypto.subtle.digest('SHA-1', bytes)
  return bytesToHex(new Uint8Array(hashBuffer))
}

/**
 * Compute SHA-256 hash of data
 *
 * @param data - Input data as Uint8Array or string (UTF-8 encoded)
 * @returns 64-character lowercase hex string
 *
 * @example
 * ```typescript
 * const hash = await sha256('hello')
 * console.log(hash) // '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
 * ```
 */
export async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  return bytesToHex(new Uint8Array(hashBuffer))
}

/**
 * MurmurHash3 32-bit hash for strings.
 *
 * A fast non-cryptographic hash function useful for hash tables,
 * bloom filters, and data partitioning.
 *
 * @param key - String to hash
 * @param seed - 32-bit unsigned integer seed
 * @returns 32-bit unsigned integer hash
 *
 * @example
 * ```typescript
 * const hash = murmurHash3('hello', 0)
 * console.log(hash) // A 32-bit unsigned integer
 * ```
 */
export function murmurHash3(key: string, seed: number): number {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(key)
  return murmurHash3_32(bytes, seed)
}

/**
 * MurmurHash3 32-bit hash for binary data.
 *
 * Implementation of MurmurHash3_x86_32 algorithm.
 *
 * @param data - Binary data to hash
 * @param seed - 32-bit unsigned integer seed
 * @returns 32-bit unsigned integer hash
 *
 * @example
 * ```typescript
 * const data = new TextEncoder().encode('hello')
 * const hash = murmurHash3_32(data, 42)
 * ```
 */
export function murmurHash3_32(data: Uint8Array, seed: number): number {
  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593
  const len = data.length
  let h1 = seed >>> 0

  // Process body (4-byte blocks)
  const nblocks = Math.floor(len / 4)
  for (let i = 0; i < nblocks; i++) {
    const idx = i * 4
    let k1 =
      (data[idx]! | (data[idx + 1]! << 8) | (data[idx + 2]! << 16) | (data[idx + 3]! << 24)) >>> 0

    k1 = Math.imul(k1, c1) >>> 0
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0
    k1 = Math.imul(k1, c2) >>> 0

    h1 ^= k1
    h1 = ((h1 << 13) | (h1 >>> 19)) >>> 0
    h1 = (Math.imul(h1, 5) + 0xe6546b64) >>> 0
  }

  // Process tail (remaining 1-3 bytes after 4-byte blocks)
  const tail = nblocks * 4
  let k1 = 0
  const remaining = len & 3

  // Build k1 from remaining bytes (cumulative, replicates fallthrough behavior)
  if (remaining >= 3) {
    k1 ^= data[tail + 2]! << 16
  }
  if (remaining >= 2) {
    k1 ^= data[tail + 1]! << 8
  }
  if (remaining >= 1) {
    k1 ^= data[tail]!
    // Only finalize k1 if there were any remaining bytes
    k1 = Math.imul(k1, c1) >>> 0
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0
    k1 = Math.imul(k1, c2) >>> 0
    h1 ^= k1
  }

  // Finalization
  h1 ^= len

  // fmix32
  h1 ^= h1 >>> 16
  h1 = Math.imul(h1, 0x85ebca6b) >>> 0
  h1 ^= h1 >>> 13
  h1 = Math.imul(h1, 0xc2b2ae35) >>> 0
  h1 ^= h1 >>> 16

  return h1 >>> 0
}
