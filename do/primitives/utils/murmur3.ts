/**
 * MurmurHash3 - Fast non-cryptographic hash function
 *
 * Implementation of MurmurHash3 (32-bit) for use in bloom filters,
 * hash tables, and other data structures that need fast hashing.
 *
 * @module do/primitives/utils/murmur3
 */

/**
 * MurmurHash3 32-bit hash function
 *
 * @param key - The string or bytes to hash
 * @param seed - Optional seed value (defaults to 0)
 * @returns 32-bit hash value
 */
export function murmurHash3_32(key: string | Uint8Array, seed = 0): number {
  const bytes = typeof key === 'string' ? new TextEncoder().encode(key) : key
  const len = bytes.length

  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593

  let h1 = seed
  let i = 0

  // Process 4-byte chunks
  const nblocks = Math.floor(len / 4)
  for (let block = 0; block < nblocks; block++) {
    let k1 =
      bytes[i++] |
      (bytes[i++] << 8) |
      (bytes[i++] << 16) |
      (bytes[i++] << 24)

    k1 = Math.imul(k1, c1)
    k1 = (k1 << 15) | (k1 >>> 17)
    k1 = Math.imul(k1, c2)

    h1 ^= k1
    h1 = (h1 << 13) | (h1 >>> 19)
    h1 = Math.imul(h1, 5) + 0xe6546b64
  }

  // Process remaining bytes
  let k1 = 0
  const remainder = len & 3
  const tailStart = nblocks * 4

  if (remainder >= 3) k1 ^= bytes[tailStart + 2] << 16
  if (remainder >= 2) k1 ^= bytes[tailStart + 1] << 8
  if (remainder >= 1) {
    k1 ^= bytes[tailStart]
    k1 = Math.imul(k1, c1)
    k1 = (k1 << 15) | (k1 >>> 17)
    k1 = Math.imul(k1, c2)
    h1 ^= k1
  }

  // Finalization
  h1 ^= len
  h1 ^= h1 >>> 16
  h1 = Math.imul(h1, 0x85ebca6b)
  h1 ^= h1 >>> 13
  h1 = Math.imul(h1, 0xc2b2ae35)
  h1 ^= h1 >>> 16

  return h1 >>> 0 // Convert to unsigned 32-bit
}

/**
 * Generate multiple hash values from one murmur hash
 * Uses the technique from "Less Hashing, Same Performance" paper
 *
 * @param key - The key to hash
 * @param count - Number of hash values to generate
 * @param seed - Optional seed value
 * @returns Array of hash values
 */
export function murmurHash3_multi(
  key: string | Uint8Array,
  count: number,
  seed = 0
): number[] {
  const h1 = murmurHash3_32(key, seed)
  const h2 = murmurHash3_32(key, h1)

  const hashes: number[] = []
  for (let i = 0; i < count; i++) {
    hashes.push((h1 + i * h2) >>> 0)
  }
  return hashes
}
