/**
 * Content-Addressed Deduplication
 *
 * Provides SHA-256 hashing for content deduplication in BlobStore.
 *
 * @module db/blob/dedup
 */

/**
 * Compute SHA-256 hash of data
 */
export async function computeHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  const hashHex = Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256:${hashHex}`
}

/**
 * Get hash hex without prefix
 */
export function getHashHex(hash: string): string {
  return hash.replace('sha256:', '')
}

/**
 * Generate R2 key for content-addressed storage
 * Uses hash prefix for better distribution
 */
export function getContentAddressedKey(hash: string): string {
  const hex = getHashHex(hash)
  const prefix = hex.substring(0, 2)
  return `blobs/${prefix}/${hex}`
}

/**
 * Generate R2 key for key-addressed storage
 */
export function getKeyAddressedPath(namespace: string, key: string): string {
  return `blobs/${namespace}/${key}`
}
