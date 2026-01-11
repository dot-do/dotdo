/**
 * MurmurHash3 - 32-bit implementation
 *
 * A fast, non-cryptographic hash function with excellent distribution properties.
 * Used for hash-based partitioning, bloom filters, and HyperLogLog.
 *
 * @module db/primitives/utils/murmur3
 */

/**
 * MurmurHash3 32-bit implementation for Uint8Array input
 *
 * @param key - The byte array to hash
 * @param seed - Optional seed value (defaults to 0)
 * @returns A 32-bit unsigned integer hash value
 */
export function murmurHash3_32(key: Uint8Array, seed: number = 0): number {
  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593
  const r1 = 15
  const r2 = 13
  const m = 5
  const n = 0xe6546b64

  let hash = seed >>> 0
  const len = key.length
  const nblocks = Math.floor(len / 4)

  // Process 4-byte blocks
  for (let i = 0; i < nblocks; i++) {
    const offset = i * 4
    let k =
      (key[offset] & 0xff) |
      ((key[offset + 1] & 0xff) << 8) |
      ((key[offset + 2] & 0xff) << 16) |
      ((key[offset + 3] & 0xff) << 24)

    k = Math.imul(k, c1)
    k = (k << r1) | (k >>> (32 - r1))
    k = Math.imul(k, c2)

    hash ^= k
    hash = (hash << r2) | (hash >>> (32 - r2))
    hash = Math.imul(hash, m) + n
  }

  // Process remaining bytes
  const tailOffset = nblocks * 4
  let k1 = 0
  const tail = len & 3

  if (tail >= 3) k1 ^= (key[tailOffset + 2] & 0xff) << 16
  if (tail >= 2) k1 ^= (key[tailOffset + 1] & 0xff) << 8
  if (tail >= 1) {
    k1 ^= key[tailOffset] & 0xff
    k1 = Math.imul(k1, c1)
    k1 = (k1 << r1) | (k1 >>> (32 - r1))
    k1 = Math.imul(k1, c2)
    hash ^= k1
  }

  // Finalization
  hash ^= len
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16

  return hash >>> 0
}

/**
 * MurmurHash3 32-bit implementation for string input
 *
 * Processes the string directly using character codes, treating each
 * character as a single byte (using lower 8 bits).
 *
 * @param str - The string to hash
 * @param seed - Seed value for the hash
 * @returns A 32-bit unsigned integer hash value
 */
export function murmurHash3(str: string, seed: number): number {
  let h1 = seed >>> 0
  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593

  const len = str.length
  let i = 0

  while (i + 4 <= len) {
    let k1 =
      (str.charCodeAt(i) & 0xff) |
      ((str.charCodeAt(i + 1) & 0xff) << 8) |
      ((str.charCodeAt(i + 2) & 0xff) << 16) |
      ((str.charCodeAt(i + 3) & 0xff) << 24)

    k1 = Math.imul(k1, c1)
    k1 = (k1 << 15) | (k1 >>> 17)
    k1 = Math.imul(k1, c2)

    h1 ^= k1
    h1 = (h1 << 13) | (h1 >>> 19)
    h1 = Math.imul(h1, 5) + 0xe6546b64
    i += 4
  }

  // Handle remaining bytes
  let k1 = 0
  switch (len & 3) {
    case 3:
      k1 ^= (str.charCodeAt(i + 2) & 0xff) << 16
    // fallthrough
    case 2:
      k1 ^= (str.charCodeAt(i + 1) & 0xff) << 8
    // fallthrough
    case 1:
      k1 ^= str.charCodeAt(i) & 0xff
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

  return h1 >>> 0
}
