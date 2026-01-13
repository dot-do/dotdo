/**
 * Bloblang Crypto Stdlib Functions
 * Issue: dotdo-htiek
 *
 * Implementation of cryptographic hashing functions for Bloblang compatibility.
 * Uses Node.js crypto module for synchronous hashing (compatible with Workers via polyfill).
 *
 * Functions:
 * - hash("sha256") - SHA-256 hash
 * - hash("sha512") - SHA-512 hash
 * - hash("md5") - MD5 hash (for compatibility, note security warnings)
 * - hash("xxhash64") - Fast non-crypto hash
 * - hmac("sha256", key) - HMAC-SHA256
 * - hmac("sha512", key) - HMAC-SHA512
 */

/**
 * Helper function to validate string input
 */
function validateString(value: unknown, functionName: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${functionName} expects a string input, got ${typeof value}`)
  }
  return value
}

/**
 * Helper function to validate argument exists
 */
function validateArgument(value: unknown, argName: string, functionName: string): unknown {
  if (value === undefined) {
    throw new Error(`${functionName} requires ${argName} argument`)
  }
  return value
}

/**
 * xxHash64 implementation
 * A fast, non-cryptographic hash function.
 * Based on the xxHash algorithm by Yann Collet.
 *
 * This is a pure JavaScript implementation suitable for V8 isolates.
 */
const PRIME64_1 = 0x9E3779B185EBCA87n
const PRIME64_2 = 0xC2B2AE3D27D4EB4Fn
const PRIME64_3 = 0x165667B19E3779F9n
const PRIME64_4 = 0x85EBCA77C2B2AE63n
const PRIME64_5 = 0x27D4EB2F165667C5n

function rotl64(x: bigint, r: number): bigint {
  return ((x << BigInt(r)) | (x >> BigInt(64 - r))) & 0xFFFFFFFFFFFFFFFFn
}

function xxhash64Round(acc: bigint, input: bigint): bigint {
  acc = (acc + (input * PRIME64_2)) & 0xFFFFFFFFFFFFFFFFn
  acc = rotl64(acc, 31)
  acc = (acc * PRIME64_1) & 0xFFFFFFFFFFFFFFFFn
  return acc
}

function xxhash64MergeRound(acc: bigint, val: bigint): bigint {
  val = xxhash64Round(0n, val)
  acc = (acc ^ val) & 0xFFFFFFFFFFFFFFFFn
  acc = ((acc * PRIME64_1) + PRIME64_4) & 0xFFFFFFFFFFFFFFFFn
  return acc
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  let result = 0n
  for (let i = 0; i < 8; i++) {
    result |= BigInt(bytes[offset + i]) << BigInt(i * 8)
  }
  return result
}

function readU32LE(bytes: Uint8Array, offset: number): bigint {
  let result = 0n
  for (let i = 0; i < 4; i++) {
    result |= BigInt(bytes[offset + i]) << BigInt(i * 8)
  }
  return result
}

function xxhash64(input: Uint8Array, seed: bigint = 0n): string {
  const len = input.length
  let h64: bigint

  if (len >= 32) {
    let v1 = (seed + PRIME64_1 + PRIME64_2) & 0xFFFFFFFFFFFFFFFFn
    let v2 = (seed + PRIME64_2) & 0xFFFFFFFFFFFFFFFFn
    let v3 = seed
    let v4 = (seed - PRIME64_1) & 0xFFFFFFFFFFFFFFFFn

    let p = 0
    const limit = len - 32

    while (p <= limit) {
      v1 = xxhash64Round(v1, readU64LE(input, p))
      p += 8
      v2 = xxhash64Round(v2, readU64LE(input, p))
      p += 8
      v3 = xxhash64Round(v3, readU64LE(input, p))
      p += 8
      v4 = xxhash64Round(v4, readU64LE(input, p))
      p += 8
    }

    h64 = rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18)
    h64 = (h64 & 0xFFFFFFFFFFFFFFFFn)

    h64 = xxhash64MergeRound(h64, v1)
    h64 = xxhash64MergeRound(h64, v2)
    h64 = xxhash64MergeRound(h64, v3)
    h64 = xxhash64MergeRound(h64, v4)
  } else {
    h64 = (seed + PRIME64_5) & 0xFFFFFFFFFFFFFFFFn
  }

  h64 = (h64 + BigInt(len)) & 0xFFFFFFFFFFFFFFFFn

  // Process remaining bytes
  let p = len - (len % 32)
  if (len < 32) p = 0

  while (p + 8 <= len) {
    const k1 = xxhash64Round(0n, readU64LE(input, p))
    h64 = (h64 ^ k1) & 0xFFFFFFFFFFFFFFFFn
    h64 = (rotl64(h64, 27) * PRIME64_1 + PRIME64_4) & 0xFFFFFFFFFFFFFFFFn
    p += 8
  }

  while (p + 4 <= len) {
    h64 = (h64 ^ (readU32LE(input, p) * PRIME64_1)) & 0xFFFFFFFFFFFFFFFFn
    h64 = (rotl64(h64, 23) * PRIME64_2 + PRIME64_3) & 0xFFFFFFFFFFFFFFFFn
    p += 4
  }

  while (p < len) {
    h64 = (h64 ^ (BigInt(input[p]) * PRIME64_5)) & 0xFFFFFFFFFFFFFFFFn
    h64 = (rotl64(h64, 11) * PRIME64_1) & 0xFFFFFFFFFFFFFFFFn
    p++
  }

  // Final avalanche
  h64 = (h64 ^ (h64 >> 33n)) & 0xFFFFFFFFFFFFFFFFn
  h64 = (h64 * PRIME64_2) & 0xFFFFFFFFFFFFFFFFn
  h64 = (h64 ^ (h64 >> 29n)) & 0xFFFFFFFFFFFFFFFFn
  h64 = (h64 * PRIME64_3) & 0xFFFFFFFFFFFFFFFFn
  h64 = (h64 ^ (h64 >> 32n)) & 0xFFFFFFFFFFFFFFFFn

  // Convert to hex string (16 chars for 64 bits)
  return h64.toString(16).padStart(16, '0')
}

/**
 * Crypto stdlib functions object
 */
export const cryptoFunctions = {
  /**
   * Generates hash of string using specified algorithm
   *
   * Supported algorithms:
   * - sha256: SHA-256 (secure, standard)
   * - sha512: SHA-512 (secure, longer hash)
   * - md5: MD5 (NOT secure, for compatibility only)
   * - xxhash64: Fast non-cryptographic hash
   *
   * @example
   * root.checksum = this.data.hash("sha256")
   * root.fast_hash = this.id.hash("xxhash64")
   */
  hash: {
    call(value: unknown, algorithm?: unknown): string {
      const str = validateString(value, 'hash')
      validateArgument(algorithm, 'algorithm', 'hash')
      const algoStr = String(algorithm).toLowerCase()

      // Convert string to bytes
      const encoder = new TextEncoder()
      const data = encoder.encode(str)

      // Handle xxhash64 separately (non-crypto)
      if (algoStr === 'xxhash64') {
        return xxhash64(data)
      }

      // Use Node.js crypto for synchronous hashing
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const crypto = require('crypto')

      if (algoStr === 'sha256') {
        return crypto.createHash('sha256').update(str).digest('hex')
      }

      if (algoStr === 'sha512') {
        return crypto.createHash('sha512').update(str).digest('hex')
      }

      if (algoStr === 'md5') {
        return crypto.createHash('md5').update(str).digest('hex')
      }

      throw new Error(`Unsupported hash algorithm: ${algoStr}`)
    }
  },

  /**
   * Generates HMAC signature using specified algorithm and key
   *
   * Supported algorithms:
   * - sha256: HMAC-SHA256
   * - sha512: HMAC-SHA512
   *
   * @example
   * root.signature = this.payload.hmac("sha256", $SECRET_KEY)
   */
  hmac: {
    call(value: unknown, algorithm?: unknown, key?: unknown): string {
      const str = validateString(value, 'hmac')
      validateArgument(algorithm, 'algorithm', 'hmac')
      validateArgument(key, 'key', 'hmac')

      if (typeof key !== 'string') {
        throw new TypeError(`hmac key must be a string, got ${typeof key}`)
      }

      const algoStr = String(algorithm).toLowerCase()

      // Use Node.js crypto for HMAC
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const crypto = require('crypto')

      if (algoStr === 'sha256') {
        return crypto.createHmac('sha256', key).update(str).digest('hex')
      }

      if (algoStr === 'sha512') {
        return crypto.createHmac('sha512', key).update(str).digest('hex')
      }

      throw new Error(`Unsupported hmac algorithm: ${algoStr}`)
    }
  }
}
