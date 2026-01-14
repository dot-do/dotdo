/**
 * Object Existence Check for Content-Addressable Storage
 *
 * Checks if a git object exists in the CAS by verifying file existence
 * at the path derived from the hash. This is a fast operation that
 * only checks file existence without reading or decompressing content.
 *
 * Features:
 * - Single and batch existence checks
 * - Optional caching with TTL
 * - Bloom filter for fast negative lookups
 * - Parallel batch processing for efficiency
 */

import { hashToPath } from './path-mapping'
import {
  ExistenceCache,
  createExistenceCache,
  type ExistenceCacheOptions,
  type ExistenceCacheStats,
} from './existence-cache.js'

/**
 * Storage interface for checking object existence
 */
export interface HasObjectStorage {
  /**
   * Check if a file exists at the given path
   */
  exists(path: string): Promise<boolean>
}

/**
 * Options for batch existence checking
 */
export interface HasObjectBatchOptions {
  /**
   * Maximum concurrent existence checks.
   * Higher values improve throughput but use more resources.
   * @default 10
   */
  concurrency?: number

  /**
   * Optional progress callback for batch operations
   */
  onProgress?: (progress: HasObjectBatchProgress) => void
}

/**
 * Progress information for batch operations
 */
export interface HasObjectBatchProgress {
  /** Number of hashes processed so far */
  processed: number
  /** Total number of hashes to process */
  total: number
  /** Current hash being processed */
  currentHash: string
  /** Whether the current hash exists */
  exists: boolean
}

/**
 * Result of batch existence check
 */
export interface HasObjectBatchResult {
  /** The hash that was checked */
  hash: string
  /** Whether the object exists */
  exists: boolean
}

// Module-level storage that can be set for testing
let storage: HasObjectStorage | null = null

// Module-level existence cache (optional)
let existenceCache: ExistenceCache | null = null

/**
 * Set the storage backend for hasObject
 * Used primarily for testing
 */
export function setStorage(s: HasObjectStorage | null): void {
  storage = s
}

/**
 * Get the current storage backend
 */
export function getStorage(): HasObjectStorage | null {
  return storage
}

/**
 * Configure the existence cache
 *
 * @param options - Cache configuration options, or null to disable caching
 *
 * @example
 * ```typescript
 * // Enable caching with defaults
 * configureExistenceCache({})
 *
 * // Enable caching with custom TTL
 * configureExistenceCache({ ttl: 120000 }) // 2 minutes
 *
 * // Disable caching
 * configureExistenceCache(null)
 * ```
 */
export function configureExistenceCache(options: ExistenceCacheOptions | null): void {
  if (options === null) {
    existenceCache = null
  } else {
    existenceCache = createExistenceCache(options)
  }
}

/**
 * Get the current existence cache (for testing/inspection)
 */
export function getExistenceCache(): ExistenceCache | null {
  return existenceCache
}

/**
 * Get cache statistics
 */
export function getExistenceCacheStats(): ExistenceCacheStats | null {
  return existenceCache?.getStats() ?? null
}

/**
 * Clear the existence cache
 *
 * @param clearBloomFilter - Also clear the bloom filter (expensive)
 */
export function clearExistenceCache(clearBloomFilter: boolean = false): void {
  existenceCache?.clear(clearBloomFilter)
}

/**
 * Invalidate a specific hash in the cache
 * Called internally when an object is deleted
 */
export function invalidateCacheEntry(hash: string): void {
  existenceCache?.invalidate(hash)
}

/**
 * Record that an object was added (updates cache)
 * Called internally when an object is stored
 */
export function recordPutToCache(hash: string): void {
  existenceCache?.recordPut(hash)
}

/**
 * Record that an object was deleted (updates cache)
 * Called internally when an object is removed
 */
export function recordDeleteFromCache(hash: string): void {
  existenceCache?.recordDelete(hash)
}

/**
 * Validate that a string is a valid hash format
 * Must be exactly 40 (SHA-1) or 64 (SHA-256) hex characters
 */
function validateHash(hash: string): void {
  // Check for empty string
  if (!hash) {
    throw new Error('Invalid hash: hash cannot be empty')
  }

  // Check length (must be exactly 40 or 64)
  if (hash.length !== 40 && hash.length !== 64) {
    throw new Error(`Invalid hash length: expected 40 (SHA-1) or 64 (SHA-256), got ${hash.length}`)
  }

  // Check for valid hex characters only (0-9, a-f, A-F)
  if (!/^[0-9a-fA-F]+$/.test(hash)) {
    throw new Error('Invalid hash: contains non-hex characters')
  }
}

/**
 * Check if an object exists in the content-addressable storage
 *
 * Uses the cache if configured:
 * 1. Check bloom filter - if negative, return false immediately
 * 2. Check positive cache - if hit and valid, return cached result
 * 3. Check storage and update cache
 *
 * @param hash - 40 or 64 character hex string (SHA-1 or SHA-256)
 * @returns true if the object exists, false otherwise
 * @throws Error if the hash format is invalid
 */
export async function hasObject(hash: string): Promise<boolean> {
  // Validate hash format (will throw on invalid)
  validateHash(hash)

  // Normalize to lowercase
  const normalizedHash = hash.toLowerCase()

  // Check cache first (if configured)
  if (existenceCache) {
    const cachedResult = existenceCache.check(normalizedHash)
    if (cachedResult !== undefined) {
      return cachedResult
    }
  }

  // If no storage is configured, return false (no objects exist)
  if (!storage) {
    return false
  }

  // Convert hash to storage path
  const path = hashToPath(normalizedHash)

  // Check if the object exists at the path
  const exists = await storage.exists(path)
  const result = exists === true

  // Update cache with result
  if (existenceCache) {
    existenceCache.record(normalizedHash, result)
  }

  // Return a strict boolean (not truthy/falsy)
  return result
}

/**
 * Check if multiple objects exist in the content-addressable storage
 *
 * This is more efficient than calling hasObject() multiple times because:
 * 1. Validates all hashes upfront
 * 2. Checks cache for all hashes first
 * 3. Parallelizes storage checks with controlled concurrency
 * 4. Updates cache in batch
 *
 * @param hashes - Array of 40 or 64 character hex strings (SHA-1 or SHA-256)
 * @param options - Configuration for batch processing
 * @returns Array of results with hash and existence status
 * @throws Error if any hash format is invalid
 *
 * @example
 * ```typescript
 * const results = await hasObjectBatch([
 *   'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
 *   'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0',
 *   '95d09f2b10159347eece71399a7e2e907ea3df4f',
 * ])
 *
 * results.forEach(r => console.log(`${r.hash}: ${r.exists}`))
 * ```
 */
export async function hasObjectBatch(
  hashes: string[],
  options: HasObjectBatchOptions = {}
): Promise<HasObjectBatchResult[]> {
  const { concurrency = 10, onProgress } = options

  // Handle empty input
  if (hashes.length === 0) {
    return []
  }

  // Validate all hashes upfront
  const normalizedHashes: string[] = []
  for (const hash of hashes) {
    validateHash(hash)
    normalizedHashes.push(hash.toLowerCase())
  }

  // If no storage is configured, all objects don't exist
  if (!storage) {
    return normalizedHashes.map(hash => ({ hash, exists: false }))
  }

  // Initialize results array
  const results: HasObjectBatchResult[] = new Array(normalizedHashes.length)

  // Track which hashes need storage check
  const needsStorageCheck: Array<{ index: number; hash: string }> = []

  // Check cache first for all hashes
  for (let i = 0; i < normalizedHashes.length; i++) {
    const hash = normalizedHashes[i]!

    if (existenceCache) {
      const cachedResult = existenceCache.check(hash)
      if (cachedResult !== undefined) {
        results[i] = { hash, exists: cachedResult }
        continue
      }
    }

    // Need to check storage
    needsStorageCheck.push({ index: i, hash })
  }

  // Process storage checks in parallel with concurrency control
  let processed = 0
  const total = normalizedHashes.length

  // Process in chunks for concurrency control
  for (let i = 0; i < needsStorageCheck.length; i += concurrency) {
    const chunk = needsStorageCheck.slice(i, i + concurrency)

    const chunkPromises = chunk.map(async ({ index, hash }) => {
      const path = hashToPath(hash)
      const exists = await storage!.exists(path)
      const result = exists === true

      // Update cache
      if (existenceCache) {
        existenceCache.record(hash, result)
      }

      // Store result
      results[index] = { hash, exists: result }

      // Report progress
      processed++
      if (onProgress) {
        onProgress({
          processed,
          total,
          currentHash: hash,
          exists: result,
        })
      }

      return result
    })

    // Wait for chunk to complete before starting next
    await Promise.all(chunkPromises)
  }

  // Report progress for cached results
  if (onProgress && needsStorageCheck.length < normalizedHashes.length) {
    // Already reported storage check progress
    // Cached results were instant, consider them processed
  }

  return results
}

/**
 * Create a Map from batch results for efficient lookups
 *
 * @param results - Results from hasObjectBatch()
 * @returns Map of hash to existence status
 */
export function batchResultsToMap(results: HasObjectBatchResult[]): Map<string, boolean> {
  return new Map(results.map(r => [r.hash, r.exists]))
}
