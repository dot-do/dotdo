/**
 * Crypto/Hashing Commands Implementation
 *
 * Native implementations of crypto and hashing commands using Web Crypto API:
 * - sha256sum, sha1sum, sha512sum, md5sum
 * - uuidgen / uuid
 * - cksum / sum
 * - openssl (subset)
 *
 * All implementations are designed for Cloudflare Workers environment
 * using Web Crypto API and native crypto primitives.
 *
 * ## Architecture
 *
 * This module uses a unified `Hasher` interface that abstracts over different
 * hash algorithm implementations:
 * - Web Crypto API algorithms (SHA-1, SHA-256, SHA-384, SHA-512)
 * - Custom pure JavaScript implementation (MD5)
 *
 * The `Hasher` interface supports both one-shot hashing via `hash()` and
 * streaming via `createStream()` for processing large files efficiently.
 *
 * ## Encoding Utilities
 *
 * Consolidated encoding utilities in the `Encoding` namespace:
 * - `Encoding.toHex()` / `Encoding.fromHex()` - Hexadecimal encoding
 * - `Encoding.toBase64()` / `Encoding.fromBase64()` - Base64 encoding
 * - `Encoding.stringToBytes()` / `Encoding.bytesToString()` - UTF-8 encoding
 *
 * @module bashx/do/commands/crypto
 */

import type { FsCapability } from '../../types.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Hash algorithm types supported by Web Crypto API.
 * These algorithms can be used directly with `crypto.subtle.digest()`.
 */
export type WebCryptoHashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'

/**
 * Hash algorithm identifiers used in this module.
 * MD5 requires a custom implementation as it's not supported by Web Crypto API.
 */
export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512'

/**
 * Checksum output format for hash commands.
 * - `default`: Standard format with two spaces between hash and filename
 * - `bsd`: BSD-style format: `ALGORITHM (filename) = hash`
 * - `binary`: Uses `*` before filename to indicate binary mode
 * - `text`: Explicitly uses text mode (default on most systems)
 */
export type ChecksumFormat = 'default' | 'bsd' | 'binary' | 'text'

/**
 * UUID version numbers.
 * - v1: Time-based UUID
 * - v3: MD5 namespace-based UUID
 * - v4: Random UUID
 * - v5: SHA-1 namespace-based UUID
 */
export type UuidVersion = 1 | 3 | 4 | 5

/**
 * Well-known UUID namespaces as defined in RFC 4122.
 * Use with UUID v3 and v5 for deterministic UUID generation.
 */
export const UUID_NAMESPACES = {
  /** DNS namespace UUID */
  DNS: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  /** URL namespace UUID */
  URL: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  /** OID namespace UUID */
  OID: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
  /** X.500 DN namespace UUID */
  X500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
} as const

// ============================================================================
// ENCODING UTILITIES
// ============================================================================

/**
 * Consolidated encoding utilities for hex, base64, and UTF-8 conversions.
 * All functions are pure and stateless.
 */
export namespace Encoding {
  /**
   * Convert a Uint8Array to a hexadecimal string.
   *
   * @param bytes - The bytes to convert
   * @returns Lowercase hexadecimal string representation
   *
   * @example
   * ```ts
   * Encoding.toHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
   * // Returns: 'deadbeef'
   * ```
   */
  export function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Convert a hexadecimal string to a Uint8Array.
   *
   * @param hex - The hexadecimal string (case-insensitive)
   * @returns Uint8Array of decoded bytes
   * @throws If the string length is not even
   *
   * @example
   * ```ts
   * Encoding.fromHex('deadbeef')
   * // Returns: Uint8Array([0xde, 0xad, 0xbe, 0xef])
   * ```
   */
  export function fromHex(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
    }
    return bytes
  }

  /**
   * Convert a string to Uint8Array using UTF-8 encoding.
   *
   * @param str - The string to encode
   * @returns UTF-8 encoded bytes
   *
   * @example
   * ```ts
   * Encoding.stringToBytes('hello')
   * // Returns: Uint8Array([104, 101, 108, 108, 111])
   * ```
   */
  export function stringToBytes(str: string): Uint8Array {
    return new TextEncoder().encode(str)
  }

  /**
   * Convert a Uint8Array to a string using UTF-8 decoding.
   *
   * @param bytes - The bytes to decode
   * @returns Decoded string
   *
   * @example
   * ```ts
   * Encoding.bytesToString(new Uint8Array([104, 101, 108, 108, 111]))
   * // Returns: 'hello'
   * ```
   */
  export function bytesToString(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes)
  }

  /**
   * Encode bytes to Base64 string.
   *
   * @param bytes - The bytes to encode
   * @returns Base64 encoded string
   *
   * @example
   * ```ts
   * Encoding.toBase64(new Uint8Array([104, 101, 108, 108, 111]))
   * // Returns: 'aGVsbG8='
   * ```
   */
  export function toBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
  }

  /**
   * Decode Base64 string to bytes.
   *
   * @param base64 - The Base64 string to decode
   * @returns Decoded bytes
   * @throws If the string is not valid Base64
   *
   * @example
   * ```ts
   * Encoding.fromBase64('aGVsbG8=')
   * // Returns: Uint8Array([104, 101, 108, 108, 111])
   * ```
   */
  export function fromBase64(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
}

// Legacy exports for backward compatibility
/** @deprecated Use `Encoding.toHex()` instead */
export const toHex = Encoding.toHex
/** @deprecated Use `Encoding.fromHex()` instead */
export const fromHex = Encoding.fromHex
/** @deprecated Use `Encoding.stringToBytes()` instead */
export const stringToBytes = Encoding.stringToBytes

// ============================================================================
// UNIFIED HASHER INTERFACE
// ============================================================================

/**
 * Configuration for a hash algorithm.
 */
export interface HashConfig {
  /** Algorithm identifier */
  algorithm: HashAlgorithm
  /** Length of hash output in hex characters */
  hexLength: number
  /** Display name for BSD-style output */
  tagName: string
  /** Web Crypto algorithm name, if supported */
  webCryptoAlgorithm?: WebCryptoHashAlgorithm
}

/**
 * Streaming hash context for incremental hashing of large data.
 * Allows data to be added in chunks before finalizing the hash.
 */
export interface StreamingHashContext {
  /**
   * Update the hash with additional data.
   * @param data - Data chunk to add to the hash
   */
  update(data: Uint8Array): void

  /**
   * Finalize the hash and return the result.
   * @returns Promise resolving to the hash as a hex string
   */
  finalize(): Promise<string>
}

/**
 * Unified interface for hash algorithm implementations.
 * Supports both one-shot and streaming hash computation.
 */
export interface Hasher {
  /** Algorithm configuration */
  readonly config: HashConfig

  /**
   * Compute hash of input data in one shot.
   * @param input - Data to hash (string or bytes)
   * @returns Promise resolving to hash as hex string
   */
  hash(input: Uint8Array | string): Promise<string>

  /**
   * Create a streaming hash context for incremental hashing.
   * Useful for large files that don't fit in memory.
   * @returns A streaming context for incremental updates
   */
  createStream(): StreamingHashContext
}

/**
 * Hash algorithm configurations with metadata for each supported algorithm.
 */
export const HASH_CONFIGS: Record<HashAlgorithm, HashConfig> = {
  md5: { algorithm: 'md5', hexLength: 32, tagName: 'MD5' },
  sha1: { algorithm: 'sha1', hexLength: 40, tagName: 'SHA1', webCryptoAlgorithm: 'SHA-1' },
  sha256: { algorithm: 'sha256', hexLength: 64, tagName: 'SHA256', webCryptoAlgorithm: 'SHA-256' },
  sha384: { algorithm: 'sha384', hexLength: 96, tagName: 'SHA384', webCryptoAlgorithm: 'SHA-384' },
  sha512: { algorithm: 'sha512', hexLength: 128, tagName: 'SHA512', webCryptoAlgorithm: 'SHA-512' },
}

// ============================================================================
// MD5 PURE IMPLEMENTATION
// ============================================================================

/**
 * MD5 algorithm constants and helper functions.
 * Extracted into a namespace for clarity and testability.
 *
 * Implementation based on RFC 1321.
 * Note: MD5 is cryptographically broken and should not be used for security.
 * It is provided only for compatibility with legacy systems.
 */
export namespace MD5 {
  /** Per-round shift amounts as specified in RFC 1321 */
  export const SHIFT_AMOUNTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ] as const

  /** Pre-computed sine table: K[i] = floor(2^32 * |sin(i + 1)|) */
  export const SINE_TABLE = (() => {
    const K = new Uint32Array(64)
    for (let i = 0; i < 64; i++) {
      K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000)
    }
    return K
  })()

  /** Initial hash state values (A, B, C, D) */
  export const INITIAL_STATE = {
    A: 0x67452301,
    B: 0xefcdab89,
    C: 0x98badcfe,
    D: 0x10325476,
  } as const

  /** Round function F: (X AND Y) OR (NOT X AND Z) */
  export function F(x: number, y: number, z: number): number {
    return (x & y) | (~x & z)
  }

  /** Round function G: (X AND Z) OR (Y AND NOT Z) */
  export function G(x: number, y: number, z: number): number {
    return (x & z) | (y & ~z)
  }

  /** Round function H: X XOR Y XOR Z */
  export function H(x: number, y: number, z: number): number {
    return x ^ y ^ z
  }

  /** Round function I: Y XOR (X OR NOT Z) */
  export function I(x: number, y: number, z: number): number {
    return y ^ (x | ~z)
  }

  /** Rotate a 32-bit value left by n bits */
  export function rotateLeft(x: number, n: number): number {
    return (x << n) | (x >>> (32 - n))
  }

  /** Add two 32-bit numbers with unsigned overflow */
  export function addUnsigned(x: number, y: number): number {
    return (x + y) >>> 0
  }

  /**
   * Pad message according to MD5 specification.
   * Appends a 1 bit, then zeros, then the original length in bits.
   *
   * @param data - Original message bytes
   * @returns Padded message as Uint8Array
   */
  export function pad(data: Uint8Array): Uint8Array {
    const bitLen = data.length * 8
    const padLen = ((data.length + 8) % 64 === 0) ? 64 : 64 - ((data.length + 8) % 64)
    const totalLen = data.length + padLen + 8

    const padded = new Uint8Array(totalLen)
    padded.set(data)
    padded[data.length] = 0x80

    // Append original length in bits as 64-bit little-endian
    const lenView = new DataView(padded.buffer, totalLen - 8)
    lenView.setUint32(0, bitLen >>> 0, true)
    lenView.setUint32(4, Math.floor(bitLen / 0x100000000), true)

    return padded
  }

  /**
   * Process a single 64-byte block and update state.
   *
   * @param state - Current hash state [A, B, C, D]
   * @param block - 64-byte block to process
   */
  export function processBlock(state: number[], block: DataView, offset: number): void {
    const M = new Uint32Array(16)
    for (let j = 0; j < 16; j++) {
      M[j] = block.getUint32(offset + j * 4, true)
    }

    let [A, B, C, D] = state

    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number

      if (i < 16) {
        f = F(B, C, D)
        g = i
      } else if (i < 32) {
        f = G(B, C, D)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = H(B, C, D)
        g = (3 * i + 5) % 16
      } else {
        f = I(B, C, D)
        g = (7 * i) % 16
      }

      const temp = D
      D = C
      C = B
      B = addUnsigned(B, rotateLeft(addUnsigned(addUnsigned(A, f), addUnsigned(SINE_TABLE[i], M[g])), SHIFT_AMOUNTS[i]))
      A = temp
    }

    state[0] = addUnsigned(state[0], A)
    state[1] = addUnsigned(state[1], B)
    state[2] = addUnsigned(state[2], C)
    state[3] = addUnsigned(state[3], D)
  }

  /**
   * Convert final state to hex string in little-endian format.
   *
   * @param state - Final hash state [A, B, C, D]
   * @returns 32-character hex string
   */
  export function stateToHex(state: number[]): string {
    const result = new Uint8Array(16)
    const resultView = new DataView(result.buffer)
    resultView.setUint32(0, state[0], true)
    resultView.setUint32(4, state[1], true)
    resultView.setUint32(8, state[2], true)
    resultView.setUint32(12, state[3], true)
    return Encoding.toHex(result)
  }

  /**
   * Compute MD5 hash of input data.
   *
   * @param data - Input bytes to hash
   * @returns 32-character lowercase hex string
   *
   * @example
   * ```ts
   * MD5.hash(Encoding.stringToBytes('hello'))
   * // Returns: '5d41402abc4b2a76b9719d911017c592'
   * ```
   */
  export function hash(data: Uint8Array): string {
    const padded = pad(data)
    const state = [INITIAL_STATE.A, INITIAL_STATE.B, INITIAL_STATE.C, INITIAL_STATE.D]
    const view = new DataView(padded.buffer)

    for (let offset = 0; offset < padded.length; offset += 64) {
      processBlock(state, view, offset)
    }

    return stateToHex(state)
  }

  /**
   * Create a streaming MD5 context for incremental hashing.
   * Note: This is a simplified implementation that buffers all data.
   * For true streaming with constant memory, a more complex implementation
   * would be needed to handle partial blocks.
   *
   * @returns StreamingHashContext for incremental updates
   */
  export function createStream(): StreamingHashContext {
    const chunks: Uint8Array[] = []

    return {
      update(data: Uint8Array): void {
        chunks.push(data.slice())
      },

      async finalize(): Promise<string> {
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const combined = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }
        return hash(combined)
      },
    }
  }
}

// ============================================================================
// WEB CRYPTO HASHER IMPLEMENTATION
// ============================================================================

/**
 * Create a Hasher implementation using Web Crypto API.
 *
 * @param config - Hash algorithm configuration
 * @returns Hasher implementation
 */
function createWebCryptoHasher(config: HashConfig): Hasher {
  const algorithm = config.webCryptoAlgorithm!

  return {
    config,

    async hash(input: Uint8Array | string): Promise<string> {
      const data = typeof input === 'string' ? Encoding.stringToBytes(input) : input
      const hash = await crypto.subtle.digest(algorithm, data)
      return Encoding.toHex(new Uint8Array(hash))
    },

    createStream(): StreamingHashContext {
      const chunks: Uint8Array[] = []

      return {
        update(data: Uint8Array): void {
          chunks.push(data.slice())
        },

        async finalize(): Promise<string> {
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
          const combined = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            combined.set(chunk, offset)
            offset += chunk.length
          }
          const hash = await crypto.subtle.digest(algorithm, combined)
          return Encoding.toHex(new Uint8Array(hash))
        },
      }
    },
  }
}

/**
 * Create a Hasher implementation for MD5.
 *
 * @returns Hasher implementation using pure JavaScript MD5
 */
function createMD5Hasher(): Hasher {
  const config = HASH_CONFIGS.md5

  return {
    config,

    async hash(input: Uint8Array | string): Promise<string> {
      const data = typeof input === 'string' ? Encoding.stringToBytes(input) : input
      return MD5.hash(data)
    },

    createStream(): StreamingHashContext {
      return MD5.createStream()
    },
  }
}

/**
 * Get a Hasher for the specified algorithm.
 *
 * @param algorithm - Hash algorithm identifier
 * @returns Hasher implementation
 *
 * @example
 * ```ts
 * const hasher = getHasher('sha256')
 * const hash = await hasher.hash('hello world')
 * ```
 */
export function getHasher(algorithm: HashAlgorithm): Hasher {
  const config = HASH_CONFIGS[algorithm]

  if (algorithm === 'md5') {
    return createMD5Hasher()
  }

  return createWebCryptoHasher(config)
}

// ============================================================================
// CORE HASH FUNCTIONS
// ============================================================================

/**
 * Compute SHA-256 hash of input data.
 *
 * @param input - Data to hash (string or bytes)
 * @returns Promise resolving to 64-character lowercase hex string
 *
 * @example
 * ```ts
 * await sha256sum('hello world')
 * // Returns: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
 * ```
 */
export async function sha256sum(input: Uint8Array | string): Promise<string> {
  return getHasher('sha256').hash(input)
}

/**
 * Compute SHA-1 hash of input data.
 *
 * @param input - Data to hash (string or bytes)
 * @returns Promise resolving to 40-character lowercase hex string
 *
 * @deprecated SHA-1 is cryptographically broken. Use SHA-256 or SHA-512 for security.
 *
 * @example
 * ```ts
 * await sha1sum('hello world')
 * // Returns: '2aae6c35c94fcfb415dbe95f408b9ce91ee846ed'
 * ```
 */
export async function sha1sum(input: Uint8Array | string): Promise<string> {
  return getHasher('sha1').hash(input)
}

/**
 * Compute SHA-512 hash of input data.
 *
 * @param input - Data to hash (string or bytes)
 * @returns Promise resolving to 128-character lowercase hex string
 *
 * @example
 * ```ts
 * await sha512sum('hello world')
 * // Returns: '309ecc489c12d6eb4cc40f50c902f2b4d0ed77ee511a7c7a9bcd3ca86d4cd86f989dd35bc5ff499670da34255b45b0cfd830e81f605dcf7dc5542e93ae9cd76f'
 * ```
 */
export async function sha512sum(input: Uint8Array | string): Promise<string> {
  return getHasher('sha512').hash(input)
}

/**
 * Compute SHA-384 hash of input data.
 *
 * @param input - Data to hash (string or bytes)
 * @returns Promise resolving to 96-character lowercase hex string
 *
 * @example
 * ```ts
 * await sha384sum('hello world')
 * // Returns: 'fdbd8e75a67f29f701a4e040385e2e23986303ea10239211af907fcbb83578b3e417cb71ce646efd0819dd8c088de1bd'
 * ```
 */
export async function sha384sum(input: Uint8Array | string): Promise<string> {
  return getHasher('sha384').hash(input)
}

/**
 * Compute MD5 hash of input data.
 *
 * @param input - Data to hash (string or bytes)
 * @returns Promise resolving to 32-character lowercase hex string
 *
 * @deprecated MD5 is cryptographically broken. Use SHA-256 or SHA-512 for security.
 * Provided only for compatibility with legacy systems.
 *
 * @example
 * ```ts
 * await md5sum('hello world')
 * // Returns: '5eb63bbbe01eeed093cb22bb8f5acdc3'
 * ```
 */
export async function md5sum(input: Uint8Array | string): Promise<string> {
  return getHasher('md5').hash(input)
}

// ============================================================================
// UUID FUNCTIONS
// ============================================================================

/**
 * Generate a random UUID (version 4).
 *
 * Uses `crypto.randomUUID()` which is available in all modern environments
 * including Cloudflare Workers. This produces cryptographically random UUIDs.
 *
 * @returns A random UUID in standard format (8-4-4-4-12)
 *
 * @example
 * ```ts
 * uuidv4()
 * // Returns: '550e8400-e29b-41d4-a716-446655440000' (example)
 * ```
 */
export function uuidv4(): string {
  return crypto.randomUUID()
}

/**
 * Generate a time-based UUID (version 1).
 *
 * Creates a UUID based on the current timestamp and a random node identifier.
 * Since we don't have access to MAC addresses in Workers, the node ID is random
 * but has the multicast bit set to indicate it's a random node (per RFC 4122).
 *
 * Note: This implementation uses the current system time, so UUIDs generated
 * close together may not be monotonically increasing due to clock precision.
 *
 * @returns A time-based UUID in standard format (8-4-4-4-12)
 *
 * @example
 * ```ts
 * uuidv1()
 * // Returns: 'f47ac10b-58cc-1198-a0fd-00002b2f3041' (example)
 * ```
 */
export function uuidv1(): string {
  // Get current timestamp in 100-nanosecond intervals since UUID epoch (Oct 15, 1582)
  const UUID_EPOCH_MS = Date.UTC(1582, 9, 15)
  const now = Date.now()
  const timestamp = BigInt((now - UUID_EPOCH_MS) * 10000)

  // Extract time components (60 bits total)
  const timeLow = Number(timestamp & 0xffffffffn)
  const timeMid = Number((timestamp >> 32n) & 0xffffn)
  const timeHiAndVersion = Number((timestamp >> 48n) & 0x0fffn) | 0x1000 // Version 1

  // Clock sequence (14 bits random)
  const clockSeqBytes = new Uint8Array(2)
  crypto.getRandomValues(clockSeqBytes)
  const clockSeq = ((clockSeqBytes[0] & 0x3f) << 8) | clockSeqBytes[1]
  const clockSeqHiAndReserved = ((clockSeq >> 8) & 0x3f) | 0x80 // Variant 10xx
  const clockSeqLow = clockSeq & 0xff

  // Node (48 bits random since we don't have MAC address)
  const nodeBytes = new Uint8Array(6)
  crypto.getRandomValues(nodeBytes)
  // Set multicast bit to indicate random node
  nodeBytes[0] |= 0x01

  // Format UUID
  const hex = (n: number, len: number) => n.toString(16).padStart(len, '0')
  const nodeHex = Array.from(nodeBytes).map(b => hex(b, 2)).join('')

  return `${hex(timeLow, 8)}-${hex(timeMid, 4)}-${hex(timeHiAndVersion, 4)}-${hex(clockSeqHiAndReserved, 2)}${hex(clockSeqLow, 2)}-${nodeHex}`
}

/**
 * Generate a namespace-based UUID using MD5 (version 3).
 *
 * Creates a deterministic UUID from a namespace UUID and a name string.
 * The same namespace/name combination will always produce the same UUID.
 *
 * @param namespace - Namespace UUID (use UUID_NAMESPACES or a custom UUID)
 * @param name - Name to hash within the namespace
 * @returns A deterministic UUID based on the namespace and name
 *
 * @deprecated UUID v3 uses MD5. Prefer uuidv5 which uses SHA-1.
 *
 * @example
 * ```ts
 * await uuidv3(UUID_NAMESPACES.URL, 'https://example.com.ai')
 * // Returns: 'e8b764da-5fe5-3576-8a15-4b8b24b8c3b0'
 * ```
 */
export async function uuidv3(namespace: string, name: string): Promise<string> {
  const namespaceBytes = parseUuid(namespace)
  const nameBytes = stringToBytes(name)

  const data = new Uint8Array(namespaceBytes.length + nameBytes.length)
  data.set(namespaceBytes)
  data.set(nameBytes, namespaceBytes.length)

  const hash = await md5sum(data)
  return formatUuidFromHash(hash, 3)
}

/**
 * Generate a namespace-based UUID using SHA-1 (version 5).
 *
 * Creates a deterministic UUID from a namespace UUID and a name string.
 * The same namespace/name combination will always produce the same UUID.
 * This is the preferred namespace-based UUID version.
 *
 * @param namespace - Namespace UUID (use UUID_NAMESPACES or a custom UUID)
 * @param name - Name to hash within the namespace
 * @returns A deterministic UUID based on the namespace and name
 *
 * @example
 * ```ts
 * await uuidv5(UUID_NAMESPACES.URL, 'https://example.com.ai')
 * // Returns: '2ed6657d-e927-568b-95e1-2665a8aea6a2'
 *
 * // Using DNS namespace
 * await uuidv5(UUID_NAMESPACES.DNS, 'example.com.ai')
 * ```
 */
export async function uuidv5(namespace: string, name: string): Promise<string> {
  const namespaceBytes = parseUuid(namespace)
  const nameBytes = stringToBytes(name)

  const data = new Uint8Array(namespaceBytes.length + nameBytes.length)
  data.set(namespaceBytes)
  data.set(nameBytes, namespaceBytes.length)

  const hash = await sha1sum(data)
  return formatUuidFromHash(hash, 5)
}

/**
 * Parse a UUID string into its raw bytes.
 *
 * @param uuid - UUID string in standard format (with or without dashes)
 * @returns 16-byte Uint8Array representation
 * @throws If the UUID is not valid (not 32 hex characters)
 *
 * @internal
 */
function parseUuid(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID: ${uuid}`)
  }
  return fromHex(hex)
}

/**
 * Format a hash output as a UUID with the specified version.
 *
 * Sets the version nibble (bits 12-15 of time_hi_and_version) and
 * variant bits (bits 6-7 of clock_seq_hi_and_reserved) per RFC 4122.
 *
 * @param hash - Hash output as hex string (at least 32 characters)
 * @param version - UUID version (3 for MD5, 5 for SHA-1)
 * @returns Formatted UUID string
 *
 * @internal
 */
function formatUuidFromHash(hash: string, version: 3 | 5): string {
  // Take first 16 bytes (32 hex chars)
  const bytes = fromHex(hash.slice(0, 32))

  // Set version (4 bits at position 12-15)
  bytes[6] = (bytes[6] & 0x0f) | (version << 4)

  // Set variant (2 bits at position 64-65)
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = toHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Get the nil UUID (all zeros).
 *
 * The nil UUID is a special UUID with all 128 bits set to zero.
 * It can be used as a placeholder or sentinel value.
 *
 * @returns The nil UUID string '00000000-0000-0000-0000-000000000000'
 *
 * @example
 * ```ts
 * uuidNil()
 * // Returns: '00000000-0000-0000-0000-000000000000'
 * ```
 */
export function uuidNil(): string {
  return '00000000-0000-0000-0000-000000000000'
}

/**
 * Generate cryptographically secure random bytes.
 *
 * Uses `crypto.getRandomValues()` which is available in all modern environments
 * including Cloudflare Workers.
 *
 * @param length - Number of random bytes to generate
 * @param format - Output format: 'hex', 'base64', or 'raw' (default: 'hex')
 * @returns Random bytes in the specified format
 *
 * @example
 * ```ts
 * // Generate 32 random bytes as hex
 * randomBytes(32, 'hex')
 * // Returns: 'a1b2c3d4...' (64 hex characters)
 *
 * // Generate 16 random bytes as base64
 * randomBytes(16, 'base64')
 * // Returns: 'oLbD1E5...' (base64 encoded)
 *
 * // Get raw bytes
 * randomBytes(8, 'raw')
 * // Returns: Uint8Array(8)
 * ```
 */
export function randomBytes(length: number, format: 'hex' | 'base64' | 'raw' = 'hex'): string | Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)

  if (format === 'hex') {
    return toHex(bytes)
  } else if (format === 'base64') {
    return btoa(String.fromCharCode(...bytes))
  }
  return bytes
}

// ============================================================================
// CRC / CHECKSUM FUNCTIONS
// ============================================================================

/**
 * CRC-32 lookup table for IEEE 802.3 polynomial (0xEDB88320).
 *
 * This is a pre-computed lookup table for fast CRC-32 calculation.
 * Uses the reflected polynomial (bits reversed) for efficient computation.
 *
 * @internal
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let crc = i
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
    }
    table[i] = crc >>> 0
  }
  return table
})()

/**
 * Compute CRC-32 checksum compatible with POSIX cksum.
 *
 * Uses the IEEE 802.3 polynomial and includes the data length in the CRC
 * calculation, matching the behavior of the POSIX `cksum` command.
 *
 * @param data - Input data to checksum
 * @returns 32-bit unsigned CRC value
 *
 * @example
 * ```ts
 * const data = Encoding.stringToBytes('hello world\n')
 * crc32(data)
 * // Returns: 3582776692 (matches: cksum < <(echo 'hello world'))
 * ```
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff

  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }

  // Include length in CRC (POSIX cksum does this)
  let len = data.length
  while (len > 0) {
    crc = CRC32_TABLE[(crc ^ (len & 0xff)) & 0xff] ^ (crc >>> 8)
    len >>>= 8
  }

  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Compute BSD-style checksum.
 *
 * Uses a 16-bit rotating checksum algorithm that matches the default
 * behavior of the BSD `sum` command (and `sum -r` on GNU systems).
 *
 * @param data - Input data to checksum
 * @returns Object with 16-bit checksum and block count (1024-byte blocks)
 *
 * @example
 * ```ts
 * const data = Encoding.stringToBytes('hello world\n')
 * bsdSum(data)
 * // Returns: { checksum: 12345, blocks: 1 }
 * ```
 */
export function bsdSum(data: Uint8Array): { checksum: number; blocks: number } {
  let checksum = 0

  for (let i = 0; i < data.length; i++) {
    // Rotate right by 1
    checksum = ((checksum >> 1) | ((checksum & 1) << 15)) & 0xffff
    // Add byte
    checksum = (checksum + data[i]) & 0xffff
  }

  // Calculate blocks (1024 byte blocks, rounded up)
  const blocks = Math.ceil(data.length / 1024)

  return { checksum, blocks }
}

/**
 * Compute System V-style checksum.
 *
 * Uses a simple sum algorithm with 16-bit folding that matches the
 * behavior of `sum -s` (SYSV mode) on GNU systems.
 *
 * @param data - Input data to checksum
 * @returns Object with 16-bit checksum and block count (512-byte blocks)
 *
 * @example
 * ```ts
 * const data = Encoding.stringToBytes('hello world\n')
 * sysvSum(data)
 * // Returns: { checksum: 1234, blocks: 1 }
 * ```
 */
export function sysvSum(data: Uint8Array): { checksum: number; blocks: number } {
  let sum = 0

  for (let i = 0; i < data.length; i++) {
    sum += data[i]
  }

  // Fold to 16 bits
  let checksum = (sum & 0xffff) + ((sum >> 16) & 0xffff)
  checksum = (checksum & 0xffff) + ((checksum >> 16) & 0xffff)

  // Calculate blocks (512 byte blocks, rounded up)
  const blocks = Math.ceil(data.length / 512)

  return { checksum, blocks }
}

// ============================================================================
// PASSWORD HASHING (SHA-CRYPT)
// ============================================================================

/**
 * Base64 alphabet used by SHA-crypt password hashing.
 *
 * This is different from standard Base64 - it uses a different character set
 * and ordering for compatibility with Unix password hashing.
 *
 * @internal
 */
const SHA_CRYPT_ALPHABET = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Encode bytes to SHA-crypt base64 format with a specific byte order.
 *
 * SHA-crypt uses a custom base64 encoding with a specific byte permutation
 * order that differs between SHA-256 and SHA-512.
 *
 * @param bytes - Raw hash output bytes
 * @param order - Byte permutation order for encoding
 * @returns Base64-encoded string using SHA-crypt alphabet
 *
 * @internal
 */
function shaCryptBase64(bytes: Uint8Array, order: number[]): string {
  let result = ''
  for (let i = 0; i < order.length; i += 3) {
    const b0 = bytes[order[i]] ?? 0
    const b1 = bytes[order[i + 1]] ?? 0
    const b2 = bytes[order[i + 2]] ?? 0

    let value = (b0 << 16) | (b1 << 8) | b2
    const chars = i + 3 > order.length ? (order.length - i) + 1 : 4

    for (let j = 0; j < chars; j++) {
      result += SHA_CRYPT_ALPHABET[value & 0x3f]
      value >>>= 6
    }
  }
  return result
}

/**
 * Generate a random salt for SHA-crypt password hashing.
 *
 * Creates a cryptographically random salt string using characters
 * from the SHA-crypt alphabet.
 *
 * @param length - Salt length in characters (default: 16, max: 16)
 * @returns Random salt string
 *
 * @internal
 */
function generateSalt(length: number = 16): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(b => SHA_CRYPT_ALPHABET[b % 64])
    .join('')
}

/**
 * Hash a password using SHA-512 crypt algorithm ($6$).
 *
 * Implements the SHA-512 variant of the crypt(3) specification used for
 * Unix password hashing. The output format is `$6$salt$hash`.
 *
 * This uses 5000 rounds by default for reasonable security. The hash
 * includes the salt, allowing verification without storing the salt separately.
 *
 * @param password - Plain text password to hash
 * @param salt - Optional salt (random 16-char salt generated if not provided)
 * @returns Password hash in format `$6$salt$hash`
 *
 * @example
 * ```ts
 * // Hash a password
 * await sha512Crypt('mypassword')
 * // Returns: '$6$<random-salt>$<hash>'
 *
 * // Verify a password (re-hash with same salt and compare)
 * const hash = '$6$mysalt$...'
 * const salt = hash.split('$')[2]
 * const rehash = await sha512Crypt('mypassword', salt)
 * const valid = (hash === rehash)
 * ```
 */
export async function sha512Crypt(password: string, salt?: string): Promise<string> {
  salt = salt || generateSalt(16)
  // Limit salt to 16 characters
  salt = salt.slice(0, 16)

  const passwordBytes = stringToBytes(password)
  const saltBytes = stringToBytes(salt)

  // Initial digest: password + salt + password
  const digestB = await crypto.subtle.digest('SHA-512',
    new Uint8Array([...passwordBytes, ...saltBytes, ...passwordBytes])
  )
  const B = new Uint8Array(digestB)

  // Digest A: password + salt + B (repeated)
  const aInput: number[] = [...passwordBytes, ...saltBytes]
  let len = passwordBytes.length
  while (len > 0) {
    const take = Math.min(len, 64)
    aInput.push(...B.slice(0, take))
    len -= take
  }

  // Add bits based on password length
  len = passwordBytes.length
  while (len > 0) {
    if (len & 1) {
      aInput.push(...B)
    } else {
      aInput.push(...passwordBytes)
    }
    len >>>= 1
  }

  let A = new Uint8Array(await crypto.subtle.digest('SHA-512', new Uint8Array(aInput)))

  // Digest DP (password repeated)
  const dpInput: number[] = []
  for (let i = 0; i < passwordBytes.length; i++) {
    dpInput.push(...passwordBytes)
  }
  const DP = new Uint8Array(await crypto.subtle.digest('SHA-512', new Uint8Array(dpInput)))

  // Create P sequence
  const P = new Uint8Array(passwordBytes.length)
  for (let i = 0; i < passwordBytes.length; i++) {
    P[i] = DP[i % 64]
  }

  // Digest DS (salt repeated)
  const dsInput: number[] = []
  for (let i = 0; i < 16 + A[0]; i++) {
    dsInput.push(...saltBytes)
  }
  const DS = new Uint8Array(await crypto.subtle.digest('SHA-512', new Uint8Array(dsInput)))

  // Create S sequence
  const S = new Uint8Array(saltBytes.length)
  for (let i = 0; i < saltBytes.length; i++) {
    S[i] = DS[i % 64]
  }

  // 5000 rounds
  for (let round = 0; round < 5000; round++) {
    const cInput: number[] = []

    if (round & 1) {
      cInput.push(...P)
    } else {
      cInput.push(...A)
    }

    if (round % 3 !== 0) {
      cInput.push(...S)
    }

    if (round % 7 !== 0) {
      cInput.push(...P)
    }

    if (round & 1) {
      cInput.push(...A)
    } else {
      cInput.push(...P)
    }

    A = new Uint8Array(await crypto.subtle.digest('SHA-512', new Uint8Array(cInput)))
  }

  // Encode result using SHA-512 specific byte order
  const order = [
    0, 21, 42, 22, 43, 1, 44, 2, 23, 3, 24, 45,
    25, 46, 4, 47, 5, 26, 6, 27, 48, 28, 49, 7,
    50, 8, 29, 9, 30, 51, 31, 52, 10, 53, 11, 32,
    12, 33, 54, 34, 55, 13, 56, 14, 35, 15, 36, 57,
    37, 58, 16, 59, 17, 38, 18, 39, 60, 40, 61, 19,
    62, 20, 41, 63
  ]

  const encoded = shaCryptBase64(A, order)
  return `$6$${salt}$${encoded}`
}

/**
 * Hash a password using SHA-256 crypt algorithm ($5$).
 *
 * Implements the SHA-256 variant of the crypt(3) specification used for
 * Unix password hashing. The output format is `$5$salt$hash`.
 *
 * @param password - Plain text password to hash
 * @param salt - Optional salt (random 16-char salt generated if not provided)
 * @returns Password hash in format `$5$salt$hash`
 *
 * @example
 * ```ts
 * await sha256Crypt('mypassword')
 * // Returns: '$5$<random-salt>$<hash>'
 * ```
 */
export async function sha256Crypt(password: string, salt?: string): Promise<string> {
  salt = salt || generateSalt(16)
  salt = salt.slice(0, 16)

  const passwordBytes = stringToBytes(password)
  const saltBytes = stringToBytes(salt)

  // Initial digest: password + salt + password
  const digestB = await crypto.subtle.digest('SHA-256',
    new Uint8Array([...passwordBytes, ...saltBytes, ...passwordBytes])
  )
  const B = new Uint8Array(digestB)

  // Digest A
  const aInput: number[] = [...passwordBytes, ...saltBytes]
  let len = passwordBytes.length
  while (len > 0) {
    const take = Math.min(len, 32)
    aInput.push(...B.slice(0, take))
    len -= take
  }

  len = passwordBytes.length
  while (len > 0) {
    if (len & 1) {
      aInput.push(...B)
    } else {
      aInput.push(...passwordBytes)
    }
    len >>>= 1
  }

  let A = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(aInput)))

  // Digest DP
  const dpInput: number[] = []
  for (let i = 0; i < passwordBytes.length; i++) {
    dpInput.push(...passwordBytes)
  }
  const DP = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(dpInput)))

  const P = new Uint8Array(passwordBytes.length)
  for (let i = 0; i < passwordBytes.length; i++) {
    P[i] = DP[i % 32]
  }

  // Digest DS
  const dsInput: number[] = []
  for (let i = 0; i < 16 + A[0]; i++) {
    dsInput.push(...saltBytes)
  }
  const DS = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(dsInput)))

  const S = new Uint8Array(saltBytes.length)
  for (let i = 0; i < saltBytes.length; i++) {
    S[i] = DS[i % 32]
  }

  // 5000 rounds
  for (let round = 0; round < 5000; round++) {
    const cInput: number[] = []

    if (round & 1) {
      cInput.push(...P)
    } else {
      cInput.push(...A)
    }

    if (round % 3 !== 0) {
      cInput.push(...S)
    }

    if (round % 7 !== 0) {
      cInput.push(...P)
    }

    if (round & 1) {
      cInput.push(...A)
    } else {
      cInput.push(...P)
    }

    A = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(cInput)))
  }

  // SHA-256 specific byte order
  const order = [
    0, 10, 20, 21, 1, 11, 12, 22, 2, 3, 13, 23,
    24, 4, 14, 15, 25, 5, 6, 16, 26, 27, 7, 17,
    18, 28, 8, 9, 19, 29, 31, 30
  ]

  const encoded = shaCryptBase64(A, order)
  return `$5$${salt}$${encoded}`
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

/**
 * Standard result type for command execution.
 */
export interface CommandResult {
  /** Standard output from the command */
  stdout: string
  /** Standard error output */
  stderr: string
  /** Exit code (0 = success, non-zero = failure) */
  exitCode: number
}

/**
 * Context provided to crypto command handlers.
 * Contains filesystem access and stdin data.
 */
export interface CryptoCommandContext {
  /** Filesystem capability for reading files */
  fs?: FsCapability
  /** Standard input data passed to the command */
  stdin?: string
}

/**
 * Parsed options for hash commands.
 */
interface HashCommandOptions {
  /** Verify checksums from file */
  checkMode: boolean
  /** Output in BSD format: ALGORITHM (filename) = hash */
  bsdStyle: boolean
  /** Treat files as binary (use * prefix) */
  binaryMode: boolean
  /** Treat files as text (default) */
  textMode: boolean
  /** Suppress OK output in check mode */
  quiet: boolean
  /** Produce no output, only exit code */
  status: boolean
  /** Warn about malformed lines */
  warn: boolean
  /** Files to process */
  files: string[]
}

/**
 * Parse command-line arguments for hash commands.
 *
 * @param args - Command-line arguments
 * @returns Parsed options
 */
function parseHashCommandArgs(args: string[]): HashCommandOptions {
  const options: HashCommandOptions = {
    checkMode: false,
    bsdStyle: false,
    binaryMode: false,
    textMode: false,
    quiet: false,
    status: false,
    warn: false,
    files: [],
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '-c':
      case '--check':
        options.checkMode = true
        break
      case '--tag':
        options.bsdStyle = true
        break
      case '-b':
        options.binaryMode = true
        break
      case '-t':
        options.textMode = true
        break
      case '--quiet':
        options.quiet = true
        break
      case '--status':
        options.status = true
        break
      case '--warn':
        options.warn = true
        break
      default:
        if (!arg.startsWith('-')) {
          options.files.push(arg)
        }
    }
  }

  return options
}

/**
 * Execute sha256sum command.
 *
 * Computes SHA-256 hashes for files or stdin, with support for
 * verification mode (-c) and various output formats.
 *
 * @param args - Command-line arguments
 * @param ctx - Execution context with filesystem and stdin
 * @returns Command result with stdout, stderr, and exit code
 *
 * @example
 * ```ts
 * // Hash a file
 * await executeSha256sum(['/path/to/file'], { fs })
 *
 * // Verify checksums
 * await executeSha256sum(['-c', '/path/to/checksums.txt'], { fs })
 * ```
 */
export async function executeSha256sum(
  args: string[],
  ctx: CryptoCommandContext
): Promise<CommandResult> {
  return executeHashCommandWithHasher(getHasher('sha256'), args, ctx)
}

/**
 * Execute sha1sum command.
 *
 * Computes SHA-1 hashes for files or stdin.
 *
 * @deprecated SHA-1 is cryptographically broken. Use sha256sum for security.
 *
 * @param args - Command-line arguments
 * @param ctx - Execution context
 * @returns Command result
 */
export async function executeSha1sum(
  args: string[],
  ctx: CryptoCommandContext
): Promise<CommandResult> {
  return executeHashCommandWithHasher(getHasher('sha1'), args, ctx)
}

/**
 * Execute sha512sum command.
 *
 * Computes SHA-512 hashes for files or stdin.
 *
 * @param args - Command-line arguments
 * @param ctx - Execution context
 * @returns Command result
 */
export async function executeSha512sum(
  args: string[],
  ctx: CryptoCommandContext
): Promise<CommandResult> {
  return executeHashCommandWithHasher(getHasher('sha512'), args, ctx)
}

/**
 * Execute md5sum command.
 *
 * Computes MD5 hashes for files or stdin.
 *
 * @deprecated MD5 is cryptographically broken. Use sha256sum for security.
 *
 * @param args - Command-line arguments
 * @param ctx - Execution context
 * @returns Command result
 */
export async function executeMd5sum(
  args: string[],
  ctx: CryptoCommandContext
): Promise<CommandResult> {
  return executeHashCommandWithHasher(getHasher('md5'), args, ctx)
}

/**
 * Execute a hash command using the unified Hasher interface.
 *
 * This is the core implementation for all hash commands (sha256sum, sha1sum, etc.).
 * It uses the Hasher interface to support different hash algorithms uniformly.
 *
 * @param hasher - Hasher instance for the algorithm
 * @param args - Command-line arguments
 * @param ctx - Execution context
 * @returns Command result
 */
async function executeHashCommandWithHasher(
  hasher: Hasher,
  args: string[],
  ctx: CryptoCommandContext
): Promise<CommandResult> {
  const { config } = hasher
  const options = parseHashCommandArgs(args)

  // Check mode: verify checksums from file
  if (options.checkMode) {
    return verifyChecksums(options.files, hasher.hash.bind(hasher), ctx, {
      quiet: options.quiet,
      status: options.status,
      warn: options.warn,
    })
  }

  // Hash mode: compute hashes
  let stdout = ''
  let stderr = ''
  let exitCode = 0

  // If no files and stdin provided, hash stdin
  if (options.files.length === 0 || (options.files.length === 1 && options.files[0] === '-')) {
    const input = ctx.stdin || ''
    const hash = await hasher.hash(input)
    if (options.bsdStyle) {
      stdout = `${config.tagName} (-) = ${hash}\n`
    } else {
      stdout = `${hash}  -\n`
    }
    return { stdout, stderr, exitCode }
  }

  // Hash each file
  for (const file of options.files) {
    try {
      if (!ctx.fs) {
        stderr += `${config.algorithm}sum: ${file}: No filesystem available\n`
        exitCode = 1
        continue
      }

      const content = await ctx.fs.read(file, { encoding: 'utf-8' }) as string
      const hash = await hasher.hash(content)

      if (options.bsdStyle) {
        stdout += `${config.tagName} (${file}) = ${hash}\n`
      } else if (options.binaryMode) {
        stdout += `${hash} *${file}\n`
      } else {
        stdout += `${hash}  ${file}\n`
      }
    } catch (_error) {
      stderr += `${config.algorithm}sum: ${file}: No such file or directory\n`
      exitCode = 1
    }
  }

  return { stdout, stderr, exitCode }
}

/**
 * Generic hash command executor (legacy).
 *
 * @deprecated Use executeHashCommandWithHasher with a Hasher instance instead.
 *
 * @param algorithm - Hash algorithm identifier
 * @param hashLength - Expected hash length in hex characters
 * @param tagName - Display name for BSD-style output
 * @param args - Command-line arguments
 * @param ctx - Execution context
 * @returns Command result
 */
async function executeHashCommand(
  algorithm: HashAlgorithm,
  _hashLength: number,
  tagName: string,
  args: string[],
  ctx: CryptoCommandContext
): Promise<CommandResult> {
  const hashFn = {
    md5: md5sum,
    sha1: sha1sum,
    sha256: sha256sum,
    sha384: sha384sum,
    sha512: sha512sum,
  }[algorithm]

  // Parse options
  let checkMode = false
  let bsdStyle = false
  let binaryMode = false
  let quiet = false
  let status = false
  let warn = false
  const files: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-c' || arg === '--check') {
      checkMode = true
    } else if (arg === '--tag') {
      bsdStyle = true
    } else if (arg === '-b') {
      binaryMode = true
    } else if (arg === '-t') {
      // Text mode - no-op since we treat all input as text
    } else if (arg === '--quiet') {
      quiet = true
    } else if (arg === '--status') {
      status = true
    } else if (arg === '--warn') {
      warn = true
    } else if (!arg.startsWith('-')) {
      files.push(arg)
    }
  }

  // Check mode: verify checksums from file
  if (checkMode) {
    return verifyChecksums(files, hashFn, ctx, { quiet, status, warn })
  }

  // Hash mode: compute hashes
  let stdout = ''
  let stderr = ''
  let exitCode = 0

  // If no files and stdin provided, hash stdin
  if (files.length === 0 || (files.length === 1 && files[0] === '-')) {
    const input = ctx.stdin || ''
    const hash = await hashFn(input)
    if (bsdStyle) {
      stdout = `${tagName} (-) = ${hash}\n`
    } else {
      stdout = `${hash}  -\n`
    }
    return { stdout, stderr, exitCode }
  }

  // Hash each file
  for (const file of files) {
    try {
      if (!ctx.fs) {
        stderr += `${algorithm}sum: ${file}: No filesystem available\n`
        exitCode = 1
        continue
      }

      const content = await ctx.fs.read(file, { encoding: 'utf-8' }) as string
      const hash = await hashFn(content)

      if (bsdStyle) {
        stdout += `${tagName} (${file}) = ${hash}\n`
      } else if (binaryMode) {
        stdout += `${hash} *${file}\n`
      } else {
        stdout += `${hash}  ${file}\n`
      }
    } catch {
      stderr += `${algorithm}sum: ${file}: No such file or directory\n`
      exitCode = 1
    }
  }

  return { stdout, stderr, exitCode }
}

/**
 * Verify checksums from a file
 */
async function verifyChecksums(
  files: string[],
  hashFn: (input: string | Uint8Array) => Promise<string>,
  ctx: CryptoCommandContext,
  options: { quiet: boolean; status: boolean; warn: boolean }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  let failures = 0
  let validLinesProcessed = 0

  if (!ctx.fs || files.length === 0) {
    return { stdout: '', stderr: 'No checksum file specified\n', exitCode: 1 }
  }

  for (const checksumFile of files) {
    try {
      const content = await ctx.fs.read(checksumFile, { encoding: 'utf-8' }) as string
      const lines = content.trim().split('\n')
      let malformedCount = 0

      for (const line of lines) {
        // Parse checksum line: "hash  filename" or "hash *filename"
        const match = line.match(/^([a-f0-9]+)\s+[\s*]?(.+)$/)
        if (!match) {
          malformedCount++
          if (options.warn) {
            stderr += `${checksumFile}: improperly formatted checksum line\n`
          }
          continue
        }

        validLinesProcessed++
        const [, expectedHash, filename] = match

        try {
          const fileContent = await ctx.fs!.read(filename, { encoding: 'utf-8' }) as string
          const actualHash = await hashFn(fileContent)

          if (actualHash === expectedHash) {
            if (!options.quiet && !options.status) {
              stdout += `${filename}: OK\n`
            }
          } else {
            failures++
            if (!options.status) {
              stdout += `${filename}: FAILED\n`
            }
          }
        } catch {
          failures++
          if (!options.status) {
            stdout += `${filename}: FAILED open or read\n`
          }
        }
      }

      // If all lines were malformed, report error
      if (validLinesProcessed === 0 && malformedCount > 0) {
        stderr += `${checksumFile}: no properly formatted checksum lines found\n`
        exitCode = 1
      }
    } catch (_error) {
      stderr += `Cannot read ${checksumFile}\n`
      exitCode = 1
    }
  }

  if (failures > 0) {
    exitCode = 1
  }

  return { stdout, stderr, exitCode }
}

/**
 * Execute uuidgen command
 */
export async function executeUuidgen(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let version: UuidVersion = 4
  let count = 1
  let uppercase = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-r' || arg === '--random') {
      version = 4
    } else if (arg === '-t' || arg === '--time') {
      version = 1
    } else if (arg === '-n' && args[i + 1]) {
      count = parseInt(args[++i], 10)
    } else if (arg === '-u') {
      uppercase = true
    }
  }

  let stdout = ''
  for (let i = 0; i < count; i++) {
    let uuid: string
    if (version === 1) {
      uuid = uuidv1()
    } else {
      uuid = uuidv4()
    }
    if (uppercase) {
      uuid = uuid.toUpperCase()
    }
    stdout += uuid + '\n'
  }

  return { stdout, stderr: '', exitCode: 0 }
}

/**
 * Execute uuid command
 */
export async function executeUuid(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let version: UuidVersion = 4
  let namespace: string | undefined
  let name: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if ((arg === '-v' || arg === '--version') && args[i + 1]) {
      const v = parseInt(args[++i], 10)
      if (![1, 3, 4, 5].includes(v)) {
        return { stdout: '', stderr: `uuid: invalid version: ${v}\n`, exitCode: 1 }
      }
      version = v as UuidVersion
    } else if (arg === '--nil') {
      return { stdout: uuidNil() + '\n', stderr: '', exitCode: 0 }
    } else if (!arg.startsWith('-')) {
      if (!namespace) {
        namespace = arg
      } else if (!name) {
        name = arg
      }
    }
  }

  // For v3 and v5, we need namespace and name
  if ((version === 3 || version === 5) && (!namespace || !name)) {
    return {
      stdout: '',
      stderr: `uuid: version ${version} requires namespace and name\n`,
      exitCode: 1,
    }
  }

  try {
    let uuid: string

    switch (version) {
      case 1:
        uuid = uuidv1()
        break
      case 3:
        uuid = await uuidv3(resolveNamespace(namespace!), name!)
        break
      case 4:
        uuid = uuidv4()
        break
      case 5:
        uuid = await uuidv5(resolveNamespace(namespace!), name!)
        break
      default:
        return { stdout: '', stderr: `uuid: unsupported version: ${version}\n`, exitCode: 1 }
    }

    return { stdout: uuid + '\n', stderr: '', exitCode: 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { stdout: '', stderr: `uuid: ${message}\n`, exitCode: 1 }
  }
}

/**
 * Resolve namespace alias or UUID
 */
function resolveNamespace(ns: string): string {
  if (ns.startsWith('ns:')) {
    const name = ns.slice(3).toUpperCase() as keyof typeof UUID_NAMESPACES
    if (UUID_NAMESPACES[name]) {
      return UUID_NAMESPACES[name]
    }
    throw new Error(`Unknown namespace: ${ns}`)
  }
  // Assume it's a UUID string
  return ns
}

/**
 * Execute cksum command
 */
export async function executeCksum(
  args: string[],
  ctx: CryptoCommandContext
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const files = args.filter(a => !a.startsWith('-'))

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  // If no files, use stdin
  if (files.length === 0) {
    const input = stringToBytes(ctx.stdin || '')
    const crc = crc32(input)
    stdout = `${crc} ${input.length}\n`
    return { stdout, stderr, exitCode }
  }

  for (const file of files) {
    try {
      if (!ctx.fs) {
        stderr += `cksum: ${file}: No filesystem available\n`
        exitCode = 1
        continue
      }

      const content = await ctx.fs.read(file, { encoding: 'utf-8' }) as string
      const data = stringToBytes(content)
      const crc = crc32(data)
      stdout += `${crc} ${data.length} ${file}\n`
    } catch (_error) {
      stderr += `cksum: ${file}: No such file or directory\n`
      exitCode = 1
    }
  }

  return { stdout, stderr, exitCode }
}

/**
 * Execute sum command
 */
export async function executeSum(
  args: string[],
  ctx: CryptoCommandContext
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let useSysv = false
  const files: string[] = []

  for (const arg of args) {
    if (arg === '-s' || arg === '--sysv') {
      useSysv = true
    } else if (arg === '-r') {
      useSysv = false // BSD is default
    } else if (!arg.startsWith('-')) {
      files.push(arg)
    }
  }

  const sumFn = useSysv ? sysvSum : bsdSum

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  // If no files, use stdin
  if (files.length === 0) {
    const input = stringToBytes(ctx.stdin || '')
    const { checksum, blocks } = sumFn(input)
    stdout = `${checksum} ${blocks}\n`
    return { stdout, stderr, exitCode }
  }

  for (const file of files) {
    try {
      if (!ctx.fs) {
        stderr += `sum: ${file}: No filesystem available\n`
        exitCode = 1
        continue
      }

      const content = await ctx.fs.read(file, { encoding: 'utf-8' }) as string
      const data = stringToBytes(content)
      const { checksum, blocks } = sumFn(data)
      stdout += `${checksum} ${blocks} ${file}\n`
    } catch (_error) {
      stderr += `sum: ${file}: No such file or directory\n`
      exitCode = 1
    }
  }

  return { stdout, stderr, exitCode }
}

/**
 * Execute openssl command
 */
export async function executeOpenssl(
  args: string[],
  ctx: CryptoCommandContext
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (args.length === 0) {
    return { stdout: '', stderr: 'openssl: missing command\n', exitCode: 1 }
  }

  const subcommand = args[0]
  const subArgs = args.slice(1)

  switch (subcommand) {
    case 'dgst':
      return executeOpensslDgst(subArgs, ctx)
    case 'enc':
      return executeOpensslEnc(subArgs, ctx)
    case 'rand':
      return executeOpensslRand(subArgs)
    case 'passwd':
      return executeOpensslPasswd(subArgs, ctx)
    default:
      return { stdout: '', stderr: `openssl: unknown command: ${subcommand}\n`, exitCode: 1 }
  }
}

/**
 * Execute openssl dgst command
 */
async function executeOpensslDgst(
  args: string[],
  ctx: CryptoCommandContext
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let algorithm = 'sha256'
  let reverseFormat = false
  const files: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-sha256') {
      algorithm = 'sha256'
    } else if (arg === '-sha1') {
      algorithm = 'sha1'
    } else if (arg === '-sha512') {
      algorithm = 'sha512'
    } else if (arg === '-md5') {
      algorithm = 'md5'
    } else if (arg === '-r') {
      reverseFormat = true
    } else if (arg === '-hex') {
      // Default format, ignore
    } else if (arg.startsWith('-')) {
      if (!['sha256', 'sha1', 'sha512', 'md5', 'sha384'].includes(arg.slice(1))) {
        return { stdout: '', stderr: `openssl dgst: unknown option or digest: ${arg}\n`, exitCode: 1 }
      }
      algorithm = arg.slice(1)
    } else {
      files.push(arg)
    }
  }

  const hashFn = {
    md5: md5sum,
    sha1: sha1sum,
    sha256: sha256sum,
    sha384: sha384sum,
    sha512: sha512sum,
  }[algorithm]

  if (!hashFn) {
    return { stdout: '', stderr: `openssl dgst: unknown digest: ${algorithm}\n`, exitCode: 1 }
  }

  const tagName = {
    md5: 'MD5',
    sha1: 'SHA1',
    sha256: 'SHA2-256',
    sha384: 'SHA2-384',
    sha512: 'SHA2-512',
  }[algorithm]

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  // If no files, use stdin
  if (files.length === 0) {
    const input = ctx.stdin || ''
    const hash = await hashFn(input)
    if (reverseFormat) {
      stdout = `${hash} *stdin\n`
    } else {
      stdout = `${tagName}(stdin)= ${hash}\n`
    }
    return { stdout, stderr, exitCode }
  }

  for (const file of files) {
    try {
      if (!ctx.fs) {
        stderr += `openssl dgst: ${file}: No filesystem available\n`
        exitCode = 1
        continue
      }

      const content = await ctx.fs.read(file, { encoding: 'utf-8' }) as string
      const hash = await hashFn(content)

      if (reverseFormat) {
        stdout += `${hash} *${file}\n`
      } else {
        stdout += `${tagName}(${file})= ${hash}\n`
      }
    } catch (_error) {
      stderr += `openssl dgst: ${file}: No such file or directory\n`
      exitCode = 1
    }
  }

  return { stdout, stderr, exitCode }
}

/**
 * Execute openssl enc command (base64 encoding/decoding)
 */
async function executeOpensslEnc(
  args: string[],
  ctx: CryptoCommandContext
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let decode = false
  let singleLine = false
  let inputFile: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-d' || arg === '-decode') {
      decode = true
    } else if (arg === '-A') {
      singleLine = true
    } else if (arg === '-in' && args[i + 1]) {
      inputFile = args[++i]
    } else if (arg === '-base64') {
      // Default, ignore
    }
  }

  let input: string

  if (inputFile) {
    if (!ctx.fs) {
      return { stdout: '', stderr: 'openssl enc: No filesystem available\n', exitCode: 1 }
    }
    try {
      input = await ctx.fs.read(inputFile, { encoding: 'utf-8' }) as string
    } catch {
      return { stdout: '', stderr: `openssl enc: ${inputFile}: No such file\n`, exitCode: 1 }
    }
  } else {
    input = ctx.stdin || ''
  }

  try {
    let output: string

    if (decode) {
      // Base64 decode
      const cleaned = input.replace(/\s/g, '')
      output = atob(cleaned)
    } else {
      // Base64 encode
      output = btoa(input)
      if (!singleLine && output.length > 64) {
        // Wrap at 64 characters
        output = output.match(/.{1,64}/g)?.join('\n') || output
      }
    }

    return { stdout: output + (decode ? '' : '\n'), stderr: '', exitCode: 0 }
  } catch (_error) {
    return { stdout: '', stderr: 'openssl enc: error encoding/decoding\n', exitCode: 1 }
  }
}

/**
 * Execute openssl rand command
 */
async function executeOpensslRand(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let format: 'hex' | 'base64' = 'hex'
  let numBytes = 0

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-hex') {
      format = 'hex'
    } else if (arg === '-base64') {
      format = 'base64'
    } else if (!arg.startsWith('-') || /^-\d+$/.test(arg)) {
      const n = parseInt(arg, 10)
      if (isNaN(n)) {
        return { stdout: '', stderr: `openssl rand: invalid number: ${arg}\n`, exitCode: 1 }
      }
      if (n < 0) {
        return { stdout: '', stderr: 'openssl rand: invalid count\n', exitCode: 1 }
      }
      numBytes = n
    }
  }

  if (numBytes === 0) {
    return { stdout: '\n', stderr: '', exitCode: 0 }
  }

  const result = randomBytes(numBytes, format) as string
  return { stdout: result + '\n', stderr: '', exitCode: 0 }
}

/**
 * Execute openssl passwd command
 */
async function executeOpensslPasswd(
  args: string[],
  ctx: CryptoCommandContext
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let algorithm: '5' | '6' = '6'
  let salt: string | undefined
  let useStdin = false
  let password: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-5') {
      algorithm = '5'
    } else if (arg === '-6') {
      algorithm = '6'
    } else if (arg === '-salt' && args[i + 1]) {
      salt = args[++i]
    } else if (arg === '-stdin') {
      useStdin = true
    } else if (!arg.startsWith('-')) {
      password = arg
    }
  }

  if (useStdin) {
    password = (ctx.stdin || '').trim()
  }

  if (!password) {
    return { stdout: '', stderr: 'openssl passwd: password required\n', exitCode: 1 }
  }

  try {
    let hash: string
    if (algorithm === '5') {
      hash = await sha256Crypt(password, salt)
    } else {
      hash = await sha512Crypt(password, salt)
    }
    return { stdout: hash + '\n', stderr: '', exitCode: 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { stdout: '', stderr: `openssl passwd: ${message}\n`, exitCode: 1 }
  }
}

// ============================================================================
// COMMAND LIST FOR TIER 1 REGISTRATION
// ============================================================================

/**
 * List of crypto commands for Tier 1 native execution
 */
export const CRYPTO_COMMANDS = new Set([
  'sha256sum',
  'sha1sum',
  'sha512sum',
  'sha384sum',
  'md5sum',
  'uuidgen',
  'uuid',
  'cksum',
  'sum',
  'openssl',
])

/**
 * Execute a crypto command
 */
export async function executeCryptoCommand(
  cmd: string,
  args: string[],
  ctx: CryptoCommandContext
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  switch (cmd) {
    case 'sha256sum':
      return executeSha256sum(args, ctx)
    case 'sha1sum':
      return executeSha1sum(args, ctx)
    case 'sha512sum':
      return executeSha512sum(args, ctx)
    case 'sha384sum':
      return executeHashCommand('sha384', 96, 'SHA384', args, ctx)
    case 'md5sum':
      return executeMd5sum(args, ctx)
    case 'uuidgen':
      return executeUuidgen(args)
    case 'uuid':
      return executeUuid(args)
    case 'cksum':
      return executeCksum(args, ctx)
    case 'sum':
      return executeSum(args, ctx)
    case 'openssl':
      return executeOpenssl(args, ctx)
    default:
      return { stdout: '', stderr: `Unknown crypto command: ${cmd}\n`, exitCode: 1 }
  }
}
