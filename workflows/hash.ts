/**
 * Deterministic hashing system for ai-workflows step identification
 *
 * Uses SHA-256 for content-addressable step IDs:
 * - stepId = sha256(JSON.stringify({ path, contextHash, args? }))
 *
 * All functions are synchronous using a pure JS SHA-256 implementation
 * compatible with Cloudflare Workers.
 */

/**
 * Pure JavaScript SHA-256 implementation
 * Based on the specification from FIPS 180-4
 */
function sha256(message: string): string {
  // SHA-256 constants - first 32 bits of fractional parts of cube roots of first 64 primes
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74,
    0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
    0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e,
    0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]

  // Initial hash values - first 32 bits of fractional parts of square roots of first 8 primes
  let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]

  // Helper functions
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  const ch = (x: number, y: number, z: number) => (x & y) ^ (~x & z)
  const maj = (x: number, y: number, z: number) => (x & y) ^ (x & z) ^ (y & z)
  const sigma0 = (x: number) => rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22)
  const sigma1 = (x: number) => rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25)
  const gamma0 = (x: number) => rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
  const gamma1 = (x: number) => rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)

  // Convert string to UTF-8 bytes
  const encoder = new TextEncoder()
  const msgBytes = encoder.encode(message)
  const msgLen = msgBytes.length
  const bitLen = msgLen * 8

  // Pre-processing: calculate padded message length
  // Message needs: original bytes + 1 byte (0x80) + padding + 8 bytes (length)
  // Total must be multiple of 64 bytes (512 bits)
  const paddedLen = Math.ceil((msgLen + 9) / 64) * 64
  const padded = new Uint8Array(paddedLen)

  // Copy message bytes
  padded.set(msgBytes)

  // Append bit '1' to message (as 0x80 byte)
  padded[msgLen] = 0x80

  // Append length as 64-bit big-endian integer at the end
  const view = new DataView(padded.buffer)
  // High 32 bits (for messages up to 2^53 - 1 bits, which is huge)
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false)
  // Low 32 bits
  view.setUint32(paddedLen - 4, bitLen >>> 0, false)

  // Process each 512-bit (64-byte) block
  for (let i = 0; i < paddedLen; i += 64) {
    const W = new Array<number>(64)

    // Copy block into first 16 words (big-endian)
    for (let t = 0; t < 16; t++) {
      W[t] = view.getUint32(i + t * 4, false)
    }

    // Extend to 64 words
    for (let t = 16; t < 64; t++) {
      W[t] = (gamma1(W[t - 2]!) + W[t - 7]! + gamma0(W[t - 15]!) + W[t - 16]!) >>> 0
    }

    // Initialize working variables
    let [a, b, c, d, e, f, g, h] = H

    // Main compression loop
    for (let t = 0; t < 64; t++) {
      const T1 = (h! + sigma1(e!) + ch(e!, f!, g!) + K[t]! + W[t]!) >>> 0
      const T2 = (sigma0(a!) + maj(a!, b!, c!)) >>> 0
      h = g
      g = f
      f = e
      e = (d! + T1) >>> 0
      d = c
      c = b
      b = a
      a = (T1 + T2) >>> 0
    }

    // Update hash values
    H = [(H[0]! + a!) >>> 0, (H[1]! + b!) >>> 0, (H[2]! + c!) >>> 0, (H[3]! + d!) >>> 0, (H[4]! + e!) >>> 0, (H[5]! + f!) >>> 0, (H[6]! + g!) >>> 0, (H[7]! + h!) >>> 0]
  }

  // Convert to hex string
  return H.map((n) => n.toString(16).padStart(8, '0')).join('')
}

/**
 * Recursively sort object keys for deterministic serialization
 * This ensures { a: 1, b: 2 } and { b: 2, a: 1 } produce the same hash
 */
function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }

  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    const keys = Object.keys(value as Record<string, unknown>).sort()
    for (const key of keys) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key])
    }
    return sorted
  }

  return value
}

/**
 * Serialize a value for hashing, preserving type information
 * This ensures "123" (string) and 123 (number) produce different hashes
 */
function serialize(value: unknown): string {
  if (value === undefined) {
    return '__undefined__'
  }

  // Use sorted keys for deterministic output
  const sorted = sortKeys(value)
  return JSON.stringify(sorted)
}

/**
 * Hash a context object to produce a deterministic SHA-256 hash
 *
 * @param context - The context object to hash
 * @returns A 64-character lowercase hex string (SHA-256)
 *
 * @example
 * hashContext({ sku: 'ABC-123', quantity: 10 })
 * // => "a3f2c91b..." (64 chars)
 */
export function hashContext(context: unknown): string {
  const serialized = serialize(context)
  return sha256(serialized)
}

/**
 * Hash pipeline path and context to produce a step ID
 *
 * The step ID is computed as:
 * sha256(JSON.stringify({ path, contextHash, argsHash? }))
 *
 * @param path - The pipeline path array (e.g., ["Inventory", "check"])
 * @param contextHash - The hash of the execution context
 * @param args - Optional arguments to include in the hash
 * @returns A 64-character lowercase hex string (SHA-256)
 *
 * @example
 * hashPipeline(['Inventory', 'check'], 'a3f2c91b')
 * // => "5d41402a..." (64 chars)
 */
export function hashPipeline(path: string[], contextHash: string, args?: unknown): string {
  const data: { path: string[]; contextHash: string; argsHash?: string } = {
    path,
    contextHash,
  }

  if (args !== undefined) {
    data.argsHash = hashArgs(args)
  }

  return sha256(JSON.stringify(data))
}

/**
 * Hash arbitrary arguments for deterministic step identification
 *
 * Handles all types:
 * - Primitives: string, number, boolean, null
 * - Special: undefined (serialized as "__undefined__")
 * - Complex: objects, arrays, nested structures
 *
 * Type information is preserved, so "123" and 123 produce different hashes.
 *
 * @param args - Any value to hash
 * @returns A 64-character lowercase hex string (SHA-256)
 *
 * @example
 * hashArgs({ quantity: 10 })
 * // => "b3a8e0e1..." (64 chars)
 *
 * hashArgs([1, 2, 3])
 * // => "cd2eb0c9..." (64 chars)
 */
export function hashArgs(args: unknown): string {
  const serialized = serialize(args)
  return sha256(serialized)
}

/**
 * Hash a string to produce a deterministic non-negative integer.
 * Useful for traffic allocation and bucket assignment in experiments.
 *
 * Uses SHA-256 internally and extracts the first 8 hex characters
 * to produce a 32-bit unsigned integer.
 *
 * @param input - The string to hash
 * @returns A non-negative integer (0 to 4294967295)
 *
 * @example
 * hashToInt('user:123:experiment:test')
 * // => 2847593815
 */
export function hashToInt(input: string): number {
  const hash = sha256(input)
  // Use first 8 hex chars (32 bits) for a consistent integer
  const hexSubset = hash.slice(0, 8)
  return parseInt(hexSubset, 16)
}

/**
 * Alias for hashToInt - used for feature flag traffic allocation
 * and experiment bucket assignment.
 *
 * @param input - The string to hash
 * @returns A non-negative integer (0 to 4294967295)
 */
export const deterministicHash = hashToInt
