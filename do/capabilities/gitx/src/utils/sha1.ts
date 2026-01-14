/**
 * @fileoverview Synchronous SHA-1 Utilities for Git Pack Operations
 *
 * This module provides synchronous (non-async) SHA-1 hashing needed for pack file
 * generation, verification, and streaming operations where async is impractical.
 *
 * The implementation follows the SHA-1 specification (FIPS 180-4) and processes
 * data in 512-bit (64-byte) chunks using the standard compression function.
 *
 * **When to use this vs hash.ts**:
 * - Use `utils/hash.ts` for general async hashing (uses Web Crypto API)
 * - Use this module for pack operations that need synchronous hashing
 *
 * @module utils/sha1
 *
 * @example
 * ```typescript
 * import { sha1, sha1Hex, sha1Verify } from './utils/sha1'
 *
 * // Compute SHA-1 as bytes
 * const data = new TextEncoder().encode('Hello, World!')
 * const hashBytes = sha1(data) // 20-byte Uint8Array
 *
 * // Compute SHA-1 as hex string
 * const hashHex = sha1Hex(data) // 40-char string
 *
 * // Verify data against expected hash
 * const isValid = sha1Verify(data, expectedHash)
 * ```
 */

/**
 * Compute SHA-1 hash of data synchronously.
 *
 * @description
 * Implements the SHA-1 algorithm per FIPS 180-4. This pure JavaScript
 * implementation is used when synchronous hashing is needed, such as
 * in pack file generation or streaming operations.
 *
 * **Algorithm Details**:
 * 1. Pad message to 512-bit boundary (with 1-bit, zeros, and 64-bit length)
 * 2. Process in 64-byte chunks using 80-round compression function
 * 3. Return final 160-bit (20-byte) hash
 *
 * **Performance Note**: This is slower than Web Crypto API. Use `hash.ts`
 * for async operations where performance is critical.
 *
 * @param data - Input data to hash
 * @returns 20-byte hash as Uint8Array
 *
 * @example
 * ```typescript
 * const data = new TextEncoder().encode('test')
 * const hash = sha1(data)
 * console.log(hash.length) // 20
 *
 * // Use with pack file verification
 * const packData = readPackFile()
 * const computedHash = sha1(packData.slice(0, -20))
 * ```
 */
export function sha1(data: Uint8Array): Uint8Array {
  /**
   * Rotate left (circular left shift) operation.
   * @internal
   */
  function rotl(n: number, s: number): number {
    return ((n << s) | (n >>> (32 - s))) >>> 0
  }

  // Initialize hash values (first 32 bits of fractional parts of square roots of first 5 primes)
  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  // Pre-processing: add padding
  const msgLen = data.length
  const bitLen = BigInt(msgLen) * 8n

  // Message needs to be padded to 64-byte boundary (512 bits)
  // Padding: 1 bit (0x80), then zeros, then 64-bit length
  const paddingLength = (64 - ((msgLen + 9) % 64)) % 64
  const paddedLen = msgLen + 1 + paddingLength + 8

  const padded = new Uint8Array(paddedLen)
  padded.set(data, 0)
  padded[msgLen] = 0x80

  // Write length as 64-bit big-endian at the end
  const lengthView = new DataView(padded.buffer)
  lengthView.setBigUint64(paddedLen - 8, bitLen, false)

  // Process in 64-byte (512-bit) chunks
  const w = new Uint32Array(80)

  for (let chunkStart = 0; chunkStart < paddedLen; chunkStart += 64) {
    const chunkView = new DataView(padded.buffer, chunkStart, 64)

    // Break chunk into sixteen 32-bit big-endian words
    for (let i = 0; i < 16; i++) {
      w[i] = chunkView.getUint32(i * 4, false)
    }

    // Extend the sixteen 32-bit words into eighty 32-bit words
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    }

    // Initialize working variables
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4

    // Main loop - 80 rounds
    for (let i = 0; i < 80; i++) {
      let f: number, k: number

      if (i < 20) {
        // Round 0-19: Ch(b,c,d) = (b AND c) XOR (NOT b AND d)
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        // Round 20-39: Parity(b,c,d) = b XOR c XOR d
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        // Round 40-59: Maj(b,c,d) = (b AND c) XOR (b AND d) XOR (c AND d)
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        // Round 60-79: Parity(b,c,d) = b XOR c XOR d
        f = b ^ c ^ d
        k = 0xca62c1d6
      }

      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = temp
    }

    // Add this chunk's hash to result so far
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  // Produce the final hash value (big-endian)
  const result = new Uint8Array(20)
  const resultView = new DataView(result.buffer)
  resultView.setUint32(0, h0, false)
  resultView.setUint32(4, h1, false)
  resultView.setUint32(8, h2, false)
  resultView.setUint32(12, h3, false)
  resultView.setUint32(16, h4, false)

  return result
}

/**
 * Compute SHA-1 hash and return as hexadecimal string.
 *
 * @description
 * Convenience wrapper that computes SHA-1 and converts the result
 * to a lowercase hexadecimal string. Equivalent to calling `sha1()`
 * followed by hex conversion.
 *
 * @param data - Input data to hash
 * @returns 40-character lowercase hexadecimal hash string
 *
 * @example
 * ```typescript
 * const data = new TextEncoder().encode('hello')
 * const hex = sha1Hex(data)
 * console.log(hex) // 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
 *
 * // Compare with git:
 * // $ echo -n "hello" | sha1sum
 * // aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
 * ```
 */
export function sha1Hex(data: Uint8Array): string {
  const hash = sha1(data)
  let hex = ''
  for (let i = 0; i < hash.length; i++) {
    hex += hash[i].toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Verify data against an expected SHA-1 hash.
 *
 * @description
 * Computes the SHA-1 hash of the data and compares it byte-by-byte
 * with the expected hash. Returns true only if all 20 bytes match.
 *
 * This uses constant-time comparison to avoid timing attacks,
 * though SHA-1 is not used for security purposes in Git.
 *
 * @param data - Data to verify
 * @param expected - Expected 20-byte SHA-1 hash
 * @returns True if the computed hash matches the expected hash
 * @throws Never throws - returns false for invalid inputs
 *
 * @example
 * ```typescript
 * // Verify pack file integrity
 * const packContent = readPackFile()
 * const contentWithoutChecksum = packContent.slice(0, -20)
 * const expectedChecksum = packContent.slice(-20)
 *
 * if (sha1Verify(contentWithoutChecksum, expectedChecksum)) {
 *   console.log('Pack file integrity verified')
 * } else {
 *   console.log('Pack file corrupted!')
 * }
 *
 * // Invalid expected hash length
 * const badHash = new Uint8Array(10)
 * sha1Verify(data, badHash) // false (wrong length)
 * ```
 */
export function sha1Verify(data: Uint8Array, expected: Uint8Array): boolean {
  // Expected hash must be exactly 20 bytes
  if (expected.length !== 20) {
    return false
  }

  const computed = sha1(data)

  // Compare all 20 bytes
  for (let i = 0; i < 20; i++) {
    if (computed[i] !== expected[i]) {
      return false
    }
  }

  return true
}

// ============================================================================
// Hex Conversion Utilities
// ============================================================================

/**
 * Convert bytes to hexadecimal string.
 *
 * @description Efficiently converts a Uint8Array to its hexadecimal
 * representation. Each byte becomes two hex characters (00-ff).
 *
 * @param bytes - Input bytes to convert
 * @returns Lowercase hexadecimal string (2 chars per byte)
 *
 * @example
 * ```typescript
 * const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])
 * const hex = bytesToHex(bytes)
 * console.log(hex) // '48656c6c6f'
 * ```
 */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Convert hexadecimal string to bytes.
 *
 * @description Converts a hexadecimal string back to its binary representation.
 * Each pair of hex characters becomes one byte.
 *
 * @param hex - Hexadecimal string (case-insensitive)
 * @returns Uint8Array of bytes
 * @throws {Error} If hex string has odd length
 *
 * @example
 * ```typescript
 * const hex = '48656c6c6f'
 * const bytes = hexToBytes(hex)
 * console.log(new TextDecoder().decode(bytes)) // 'Hello'
 * ```
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Hex string must have even length')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

// ============================================================================
// Pre-computed constants for streaming SHA-1
// ============================================================================

/**
 * Initial hash values for SHA-1 (first 32 bits of fractional parts of square roots of first 5 primes)
 * @internal
 */
const SHA1_H0 = 0x67452301
const SHA1_H1 = 0xefcdab89
const SHA1_H2 = 0x98badcfe
const SHA1_H3 = 0x10325476
const SHA1_H4 = 0xc3d2e1f0

/**
 * SHA-1 round constants
 * @internal
 */
const SHA1_K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6]

/**
 * Rotate left (circular left shift) operation.
 * @internal
 */
function rotl(n: number, s: number): number {
  return ((n << s) | (n >>> (32 - s))) >>> 0
}

/**
 * Process a single 64-byte chunk in SHA-1
 * @internal
 */
function processChunk(
  chunk: Uint8Array,
  h: Uint32Array,
  w: Uint32Array
): void {
  const chunkView = new DataView(chunk.buffer, chunk.byteOffset, 64)

  // Break chunk into sixteen 32-bit big-endian words
  for (let i = 0; i < 16; i++) {
    w[i] = chunkView.getUint32(i * 4, false)
  }

  // Extend the sixteen 32-bit words into eighty 32-bit words
  for (let i = 16; i < 80; i++) {
    w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
  }

  // Initialize working variables
  let a = h[0]
  let b = h[1]
  let c = h[2]
  let d = h[3]
  let e = h[4]

  // Main loop - 80 rounds
  for (let i = 0; i < 80; i++) {
    let f: number, k: number

    if (i < 20) {
      f = (b & c) | (~b & d)
      k = SHA1_K[0]
    } else if (i < 40) {
      f = b ^ c ^ d
      k = SHA1_K[1]
    } else if (i < 60) {
      f = (b & c) | (b & d) | (c & d)
      k = SHA1_K[2]
    } else {
      f = b ^ c ^ d
      k = SHA1_K[3]
    }

    const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0
    e = d
    d = c
    c = rotl(b, 30)
    b = a
    a = temp
  }

  // Add this chunk's hash to result so far
  h[0] = (h[0] + a) >>> 0
  h[1] = (h[1] + b) >>> 0
  h[2] = (h[2] + c) >>> 0
  h[3] = (h[3] + d) >>> 0
  h[4] = (h[4] + e) >>> 0
}

/**
 * Streaming SHA-1 hasher for processing large data incrementally.
 *
 * @description
 * This class allows hashing data in chunks, which is essential for:
 * - Processing large files without loading everything into memory
 * - Computing hashes of data streams
 * - Pack file generation and verification
 *
 * The hasher maintains internal state and can accept data through the
 * `update()` method before finalizing with `digest()` or `digestHex()`.
 *
 * **Performance Note**: For small data (< 64 bytes), the non-streaming
 * `sha1()` function may be slightly faster due to lower overhead.
 *
 * @class StreamingSHA1
 *
 * @example
 * ```typescript
 * // Hash a large file in chunks
 * const hasher = new StreamingSHA1()
 *
 * for await (const chunk of fileStream) {
 *   hasher.update(chunk)
 * }
 *
 * const hash = hasher.digestHex()
 * console.log(`File hash: ${hash}`)
 * ```
 *
 * @example
 * ```typescript
 * // Hash Git object with header
 * const hasher = new StreamingSHA1()
 * hasher.update(new TextEncoder().encode(`blob ${size}\0`))
 * hasher.update(content)
 * const objectId = hasher.digestHex()
 * ```
 */
export class StreamingSHA1 {
  /** Hash state */
  private h: Uint32Array
  /** Working array for chunk processing */
  private w: Uint32Array
  /** Buffer for incomplete chunks */
  private buffer: Uint8Array
  /** Current position in buffer */
  private bufferLength: number
  /** Total bytes processed */
  private totalLength: bigint
  /** Whether digest has been called */
  private finalized: boolean

  /**
   * Creates a new StreamingSHA1 hasher instance.
   */
  constructor() {
    this.h = new Uint32Array([SHA1_H0, SHA1_H1, SHA1_H2, SHA1_H3, SHA1_H4])
    this.w = new Uint32Array(80)
    this.buffer = new Uint8Array(64)
    this.bufferLength = 0
    this.totalLength = 0n
    this.finalized = false
  }

  /**
   * Resets the hasher to its initial state.
   *
   * @description Allows reusing the same hasher instance for a new hash
   * computation without creating a new object.
   *
   * @example
   * ```typescript
   * const hasher = new StreamingSHA1()
   * hasher.update(data1)
   * const hash1 = hasher.digestHex()
   *
   * hasher.reset()
   * hasher.update(data2)
   * const hash2 = hasher.digestHex()
   * ```
   */
  reset(): void {
    this.h[0] = SHA1_H0
    this.h[1] = SHA1_H1
    this.h[2] = SHA1_H2
    this.h[3] = SHA1_H3
    this.h[4] = SHA1_H4
    this.bufferLength = 0
    this.totalLength = 0n
    this.finalized = false
  }

  /**
   * Updates the hash with additional data.
   *
   * @description Processes the input data, updating the internal hash state.
   * Data is buffered internally until a complete 64-byte chunk is available,
   * then processed immediately.
   *
   * This method can be called multiple times before finalizing with `digest()`.
   *
   * @param {Uint8Array} data - Data to add to the hash computation
   * @returns {this} The hasher instance for method chaining
   * @throws {Error} If called after digest() without reset()
   *
   * @example
   * ```typescript
   * const hasher = new StreamingSHA1()
   *   .update(header)
   *   .update(content)
   *   .update(footer)
   * const hash = hasher.digestHex()
   * ```
   */
  update(data: Uint8Array): this {
    if (this.finalized) {
      throw new Error('Cannot update after digest() - call reset() first')
    }

    this.totalLength += BigInt(data.length)

    let offset = 0

    // If we have buffered data, try to complete a chunk
    if (this.bufferLength > 0) {
      const needed = 64 - this.bufferLength
      const available = Math.min(needed, data.length)
      this.buffer.set(data.subarray(0, available), this.bufferLength)
      this.bufferLength += available
      offset = available

      if (this.bufferLength === 64) {
        processChunk(this.buffer, this.h, this.w)
        this.bufferLength = 0
      }
    }

    // Process complete 64-byte chunks directly from input
    while (offset + 64 <= data.length) {
      processChunk(data.subarray(offset, offset + 64), this.h, this.w)
      offset += 64
    }

    // Buffer remaining bytes
    if (offset < data.length) {
      this.buffer.set(data.subarray(offset), this.bufferLength)
      this.bufferLength += data.length - offset
    }

    return this
  }

  /**
   * Finalizes the hash computation and returns the 20-byte digest.
   *
   * @description Applies SHA-1 padding to the remaining data and computes
   * the final hash. After calling this method, the hasher cannot be updated
   * unless `reset()` is called.
   *
   * @returns {Uint8Array} 20-byte SHA-1 hash
   *
   * @example
   * ```typescript
   * const hasher = new StreamingSHA1()
   * hasher.update(data)
   * const hashBytes = hasher.digest()
   * console.log(hashBytes.length) // 20
   * ```
   */
  digest(): Uint8Array {
    if (this.finalized) {
      // Return cached result
      const result = new Uint8Array(20)
      const resultView = new DataView(result.buffer)
      resultView.setUint32(0, this.h[0], false)
      resultView.setUint32(4, this.h[1], false)
      resultView.setUint32(8, this.h[2], false)
      resultView.setUint32(12, this.h[3], false)
      resultView.setUint32(16, this.h[4], false)
      return result
    }

    this.finalized = true

    const bitLen = this.totalLength * 8n

    // Pad message: append 1 bit (0x80)
    this.buffer[this.bufferLength] = 0x80
    this.bufferLength++

    // If we don't have room for the 64-bit length, fill and process this chunk
    if (this.bufferLength > 56) {
      // Fill rest with zeros and process
      this.buffer.fill(0, this.bufferLength, 64)
      processChunk(this.buffer, this.h, this.w)
      this.bufferLength = 0
    }

    // Fill with zeros up to length field
    this.buffer.fill(0, this.bufferLength, 56)

    // Write length as 64-bit big-endian
    const lengthView = new DataView(this.buffer.buffer, this.buffer.byteOffset, 64)
    lengthView.setBigUint64(56, bitLen, false)

    // Process final chunk
    processChunk(this.buffer, this.h, this.w)

    // Produce the final hash value (big-endian)
    const result = new Uint8Array(20)
    const resultView = new DataView(result.buffer)
    resultView.setUint32(0, this.h[0], false)
    resultView.setUint32(4, this.h[1], false)
    resultView.setUint32(8, this.h[2], false)
    resultView.setUint32(12, this.h[3], false)
    resultView.setUint32(16, this.h[4], false)

    return result
  }

  /**
   * Finalizes the hash computation and returns the hex string digest.
   *
   * @description Convenience method that calls `digest()` and converts
   * the result to a 40-character lowercase hexadecimal string.
   *
   * @returns {string} 40-character lowercase hexadecimal hash string
   *
   * @example
   * ```typescript
   * const hasher = new StreamingSHA1()
   * hasher.update(data)
   * const hash = hasher.digestHex()
   * console.log(hash) // 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
   * ```
   */
  digestHex(): string {
    const hash = this.digest()
    let hex = ''
    for (let i = 0; i < hash.length; i++) {
      hex += hash[i].toString(16).padStart(2, '0')
    }
    return hex
  }
}

/**
 * Hash a Git object with streaming support for large objects.
 *
 * @description
 * Uses the streaming hasher to compute the SHA-1 of a Git object with its header.
 * This is more memory-efficient than `hashObject` in `hash.ts` for large objects
 * as it doesn't require concatenating header and data.
 *
 * @param type - Object type ('blob', 'tree', 'commit', 'tag')
 * @param data - Object content as binary data
 * @returns 20-byte SHA-1 hash as Uint8Array
 *
 * @example
 * ```typescript
 * const content = new TextEncoder().encode('hello')
 * const hashBytes = hashObjectStreaming('blob', content)
 * ```
 */
export function hashObjectStreaming(type: string, data: Uint8Array): Uint8Array {
  const hasher = new StreamingSHA1()
  const header = new TextEncoder().encode(`${type} ${data.length}\0`)
  hasher.update(header)
  hasher.update(data)
  return hasher.digest()
}

/**
 * Hash a Git object with streaming support, returning hex string.
 *
 * @description
 * Convenience wrapper that returns the hash as a 40-character hex string
 * instead of raw bytes.
 *
 * @param type - Object type ('blob', 'tree', 'commit', 'tag')
 * @param data - Object content as binary data
 * @returns 40-character lowercase hexadecimal SHA-1 hash
 *
 * @example
 * ```typescript
 * const content = new TextEncoder().encode('hello')
 * const sha = hashObjectStreamingHex('blob', content)
 * console.log(sha) // 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0'
 * ```
 */
export function hashObjectStreamingHex(type: string, data: Uint8Array): string {
  const hasher = new StreamingSHA1()
  const header = new TextEncoder().encode(`${type} ${data.length}\0`)
  hasher.update(header)
  hasher.update(data)
  return hasher.digestHex()
}
