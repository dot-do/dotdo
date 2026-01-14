/**
 * Integrity checking for npm packages
 *
 * Implements Subresource Integrity (SRI) compatible hashing
 * Uses the format: algorithm-base64hash (e.g., sha512-...)
 */

import type { IntegrityHash, HashAlgorithm } from './types'

/**
 * Calculate an integrity hash for data
 *
 * @param data - Data to hash
 * @param algorithm - Hash algorithm (sha512, sha256, sha1)
 * @returns Integrity hash string in SRI format
 */
export async function calculateIntegrity(
  data: Uint8Array,
  algorithm: HashAlgorithm
): Promise<IntegrityHash> {
  const hashBuffer = await crypto.subtle.digest(algorithmToWebCrypto(algorithm), data)
  const base64 = arrayBufferToBase64(hashBuffer)
  return `${algorithm}-${base64}`
}

/**
 * Verify data against an integrity hash
 *
 * @param data - Data to verify
 * @param hash - Integrity hash (supports SSRI format with multiple hashes)
 * @returns true if the hash matches
 */
export async function verifyIntegrity(data: Uint8Array, hash: IntegrityHash): Promise<boolean> {
  // SSRI format can have multiple hashes separated by spaces
  const hashes = hash.trim().split(/\s+/)

  for (const singleHash of hashes) {
    const match = singleHash.match(/^(sha[0-9]+)-(.+)$/)
    if (!match) continue

    const algorithm = match[1]
    const expectedBase64 = match[2]

    // Validate algorithm
    if (algorithm === undefined || expectedBase64 === undefined || !isValidAlgorithm(algorithm)) continue

    try {
      const hashBuffer = await crypto.subtle.digest(
        algorithmToWebCrypto(algorithm as HashAlgorithm),
        data
      )
      const actualBase64 = arrayBufferToBase64(hashBuffer)

      if (actualBase64 === expectedBase64) {
        return true
      }
    } catch {
      // Skip invalid algorithms
      continue
    }
  }

  return false
}

/**
 * Parse an integrity string into its components
 *
 * @param hash - Integrity hash string
 * @returns Parsed components or null if invalid
 */
export function parseIntegrity(hash: IntegrityHash): {
  algorithm: HashAlgorithm
  digest: string
}[] {
  const results: { algorithm: HashAlgorithm; digest: string }[] = []
  const hashes = hash.trim().split(/\s+/)

  for (const singleHash of hashes) {
    const match = singleHash.match(/^(sha[0-9]+)-(.+)$/)
    if (!match) continue

    const algorithm = match[1]
    const digest = match[2]
    if (algorithm !== undefined && digest !== undefined && isValidAlgorithm(algorithm)) {
      results.push({ algorithm: algorithm, digest })
    }
  }

  return results
}

/**
 * Create an integrity string from multiple algorithms
 *
 * @param data - Data to hash
 * @param algorithms - List of algorithms to use
 * @returns Combined integrity string (SSRI format)
 */
export async function createMultipleIntegrity(
  data: Uint8Array,
  algorithms: HashAlgorithm[]
): Promise<IntegrityHash> {
  const hashes = await Promise.all(
    algorithms.map((algo) => calculateIntegrity(data, algo))
  )
  return hashes.join(' ')
}

/**
 * Get the strongest available hash from an SSRI string
 *
 * @param hash - SSRI integrity string
 * @returns The strongest hash, or the first one if no preference
 */
export function getStrongestHash(hash: IntegrityHash): IntegrityHash {
  const parsed = parseIntegrity(hash)

  // Prefer sha512 > sha256 > sha1
  const priority: HashAlgorithm[] = ['sha512', 'sha256', 'sha1']

  for (const algo of priority) {
    const found = parsed.find((p) => p.algorithm === algo)
    if (found) {
      return `${found.algorithm}-${found.digest}`
    }
  }

  // Return the first valid hash
  const first = parsed[0]
  if (first !== undefined) {
    return `${first.algorithm}-${first.digest}`
  }

  return hash
}

/**
 * Compare two integrity strings for equality
 *
 * @param hash1 - First integrity hash
 * @param hash2 - Second integrity hash
 * @returns true if any hash matches
 */
export function integrityEquals(hash1: IntegrityHash, hash2: IntegrityHash): boolean {
  const parsed1 = parseIntegrity(hash1)
  const parsed2 = parseIntegrity(hash2)

  for (const h1 of parsed1) {
    for (const h2 of parsed2) {
      if (h1.algorithm === h2.algorithm && h1.digest === h2.digest) {
        return true
      }
    }
  }

  return false
}

/**
 * Convert algorithm name to WebCrypto algorithm
 */
function algorithmToWebCrypto(algorithm: HashAlgorithm): string {
  switch (algorithm) {
    case 'sha512':
      return 'SHA-512'
    case 'sha256':
      return 'SHA-256'
    case 'sha1':
      return 'SHA-1'
    default:
      throw new Error(`Unsupported algorithm: ${algorithm}`)
  }
}

/**
 * Check if algorithm is valid
 */
function isValidAlgorithm(algorithm: string): algorithm is HashAlgorithm {
  return algorithm === 'sha512' || algorithm === 'sha256' || algorithm === 'sha1'
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]
    if (byte !== undefined) {
      binary += String.fromCharCode(byte)
    }
  }
  return btoa(binary)
}

/**
 * Convert base64 string to ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Stream-based integrity calculation
 *
 * This is useful for calculating integrity while streaming data
 */
export class IntegrityStream {
  private chunks: Uint8Array[] = []
  private totalLength = 0
  private algorithm: HashAlgorithm

  constructor(algorithm: HashAlgorithm = 'sha512') {
    this.algorithm = algorithm
  }

  /**
   * Add a chunk of data
   */
  update(chunk: Uint8Array): void {
    this.chunks.push(chunk)
    this.totalLength += chunk.length
  }

  /**
   * Calculate the final integrity hash
   */
  async digest(): Promise<IntegrityHash> {
    // Combine all chunks
    const combined = new Uint8Array(this.totalLength)
    let offset = 0
    for (const chunk of this.chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    return calculateIntegrity(combined, this.algorithm)
  }

  /**
   * Reset the stream for reuse
   */
  reset(): void {
    this.chunks = []
    this.totalLength = 0
  }
}
