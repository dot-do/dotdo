/**
 * Search Snippet - Range Query Pruning with Zonemaps
 *
 * This module provides range query pruning using ClickHouse-style marks files.
 * The search snippet fetches marks files from CDN to determine which blocks
 * need to be read for a given range query, minimizing data transfer.
 *
 * Memory Budget:
 * - 65,536 blocks per 1MB marks file
 * - 16 bytes per block entry (int64 min + int64 max)
 *
 * @module snippets/search
 * @see db/iceberg/marks.ts for the full marks file format
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Supported column types for marks files.
 */
export type ColumnType = 'int64' | 'float64' | 'timestamp' | 'string'

/**
 * Metadata about a marks file required for parsing.
 */
export interface MarksMetadata {
  /** Column data type */
  columnType: ColumnType
  /** Number of blocks in the marks file */
  blockCount: number
  /** Rows per block */
  blockSize: number
  /** Bytes per block in the data file (optional, for byte range calculation) */
  blockByteSize?: number
}

/**
 * Parsed block range with min/max statistics.
 */
export interface BlockRange<T = bigint | number | string> {
  /** Minimum value in this block */
  min: T | null
  /** Maximum value in this block */
  max: T | null
  /** Zero-based block index */
  blockIndex: number
  /** Number of null values in this block (optional) */
  nullCount?: number
  /** Multi-column support (optional) */
  columns?: Record<string, { min: T | null; max: T | null }>
}

/**
 * Range query condition.
 */
export interface RangeCondition<T = bigint | number | string> {
  /** Minimum value (inclusive by default) */
  min?: T
  /** Maximum value (inclusive by default) */
  max?: T
  /** Whether min is inclusive (default: true) */
  minInclusive?: boolean
  /** Whether max is inclusive (default: true) */
  maxInclusive?: boolean
  /** Query for NULL values */
  isNull?: boolean
}

/**
 * Options for pruneBlocks.
 */
export interface PruneOptions {
  /** Logical operator for multiple conditions */
  operator?: 'AND' | 'OR'
}

/**
 * Options for parseMarksFile.
 */
export interface ParseOptions {
  /** Expected number of blocks (for validation) */
  expectedBlocks?: number
}

/**
 * Result of a range query.
 */
export interface QueryRangeResult {
  /** Individual block ranges that match the query */
  blockRanges: Array<{
    blockIndex: number
    byteOffset: number
    byteSize: number
  }>
  /** Coalesced byte range if blocks are adjacent */
  coalesced?: {
    byteOffset: number
    byteSize: number
  }
  /** Ready-to-use HTTP Range header, or null if no matches */
  rangeHeader: string | null
}

// ============================================================================
// Range/Zonemap Pruning Implementation
// ============================================================================

/** Bytes per block entry: int64 min (8) + int64 max (8) */
const BYTES_PER_BLOCK = 16

/**
 * Query a marks file and return the byte ranges that need to be fetched.
 *
 * @param cdnUrl - URL to the marks file on CDN
 * @param metadata - Marks file metadata
 * @param condition - Range query condition
 * @returns Promise resolving to query result with byte ranges
 *
 * @example
 * ```typescript
 * const result = await queryRange(
 *   'https://cdn.example.com/marks/users.marks',
 *   { columnType: 'int64', blockCount: 100, blockSize: 8192 },
 *   { min: 1000n, max: 2000n }
 * )
 *
 * if (result.rangeHeader) {
 *   const response = await fetch(dataUrl, {
 *     headers: { Range: result.rangeHeader }
 *   })
 * }
 * ```
 */
export async function queryRange(
  cdnUrl: string,
  metadata: MarksMetadata,
  condition: RangeCondition
): Promise<QueryRangeResult> {
  // Fetch marks file from CDN
  let response: Response
  try {
    response = await fetch(cdnUrl, {
      headers: {
        Accept: 'application/octet-stream',
        'Cache-Control': 'max-age=3600',
      },
    })
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Network timeout: ${error.message}`)
    }
    throw error
  }

  if (!response.ok) {
    throw new Error(`Marks file fetch failed (${response.status}): ${response.statusText || 'Not Found'}`)
  }

  // Parse marks file
  const buffer = await response.arrayBuffer()
  const data = new Uint8Array(buffer)
  const blocks = parseMarksFile(data, metadata.columnType)

  // Prune blocks based on condition
  const matchingBlocks = pruneBlocks(blocks, condition)

  // Calculate byte ranges
  const blockByteSize = metadata.blockByteSize ?? 65536 // default 64KB

  const blockRanges = matchingBlocks.map((block) => ({
    blockIndex: block.blockIndex,
    byteOffset: block.blockIndex * blockByteSize,
    byteSize: blockByteSize,
  }))

  // Build result
  const result: QueryRangeResult = {
    blockRanges,
    rangeHeader: null,
  }

  if (blockRanges.length === 0) {
    return result
  }

  // Check if blocks are adjacent and can be coalesced
  const sortedRanges = [...blockRanges].sort((a, b) => a.blockIndex - b.blockIndex)
  let isContiguous = true
  for (let i = 1; i < sortedRanges.length; i++) {
    if (sortedRanges[i].blockIndex !== sortedRanges[i - 1].blockIndex + 1) {
      isContiguous = false
      break
    }
  }

  if (isContiguous && sortedRanges.length > 0) {
    const firstBlock = sortedRanges[0]
    const lastBlock = sortedRanges[sortedRanges.length - 1]
    const totalSize = sortedRanges.length * blockByteSize

    result.coalesced = {
      byteOffset: firstBlock.byteOffset,
      byteSize: totalSize,
    }

    // HTTP Range header uses inclusive byte ranges
    const startByte = firstBlock.byteOffset
    const endByte = lastBlock.byteOffset + lastBlock.byteSize - 1
    result.rangeHeader = `bytes=${startByte}-${endByte}`
  } else if (sortedRanges.length > 0) {
    // Non-contiguous: use first matching block range for now
    const firstBlock = sortedRanges[0]
    const endByte = firstBlock.byteOffset + firstBlock.byteSize - 1
    result.rangeHeader = `bytes=${firstBlock.byteOffset}-${endByte}`
  }

  return result
}

/**
 * Parse a binary marks file into block ranges.
 *
 * @param data - Raw marks file data
 * @param columnType - Data type of the column
 * @param options - Parse options
 * @returns Array of parsed block ranges
 */
export function parseMarksFile(data: Uint8Array, columnType: ColumnType, options?: ParseOptions): BlockRange[] {
  // Handle empty data
  if (data.byteLength === 0) {
    return []
  }

  const blockCount = Math.floor(data.byteLength / BYTES_PER_BLOCK)

  // Validate against expected block count if provided
  if (options?.expectedBlocks !== undefined && blockCount !== options.expectedBlocks) {
    throw new Error(`Marks file size mismatch: expected ${options.expectedBlocks} blocks but got ${blockCount} blocks`)
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const blocks: BlockRange[] = []

  for (let i = 0; i < blockCount; i++) {
    const offset = i * BYTES_PER_BLOCK

    if (columnType === 'float64') {
      const min = view.getFloat64(offset, true) // little-endian
      const max = view.getFloat64(offset + 8, true)
      blocks.push({ min, max, blockIndex: i })
    } else {
      // int64, timestamp, string - all use BigInt representation
      const min = view.getBigInt64(offset, true) // little-endian
      const max = view.getBigInt64(offset + 8, true)
      blocks.push({ min, max, blockIndex: i })
    }
  }

  return blocks
}

/**
 * Prune blocks based on range condition(s).
 *
 * @param blocks - Array of block ranges or raw buffer with metadata
 * @param condition - Single condition or array of conditions
 * @param options - Prune options (AND/OR operator)
 * @returns Array of blocks that may contain matching values
 */
export function pruneBlocks<T>(
  blocks: BlockRange<T>[] | { buffer: Uint8Array; blockCount: number; columnType: ColumnType },
  condition: RangeCondition<T> | RangeCondition<T>[] | Record<string, RangeCondition<T>> | { or?: unknown[]; and?: unknown[] },
  options?: PruneOptions
): BlockRange<T>[] {
  // Type guards
  const isBufferInput = (
    input: unknown
  ): input is { buffer: Uint8Array; blockCount: number; columnType: ColumnType } => {
    return typeof input === 'object' && input !== null && 'buffer' in input && 'blockCount' in input && 'columnType' in input
  }

  const isConditionArray = <U>(cond: unknown): cond is RangeCondition<U>[] => {
    return Array.isArray(cond)
  }

  const isMultiColumnBlock = <U>(
    block: BlockRange<U>
  ): block is BlockRange<U> & { columns: Record<string, { min: U | null; max: U | null }> } => {
    return 'columns' in block && block.columns !== undefined
  }

  const isColumnConditions = <U>(cond: unknown): cond is Record<string, RangeCondition<U>> => {
    if (typeof cond !== 'object' || cond === null || Array.isArray(cond)) {
      return false
    }
    if ('min' in cond || 'max' in cond || 'isNull' in cond) {
      return false
    }
    if ('or' in cond || 'and' in cond) {
      return false
    }
    return true
  }

  const isComplexCondition = <U>(cond: unknown): cond is { or?: unknown[]; and?: unknown[] } => {
    return typeof cond === 'object' && cond !== null && ('or' in cond || 'and' in cond)
  }

  // Check if a single block overlaps with a range condition
  const blockOverlapsCondition = <U>(
    block: { min: U | null; max: U | null; nullCount?: number },
    cond: RangeCondition<U>
  ): boolean => {
    // Handle null queries
    if (cond.isNull !== undefined) {
      if (cond.isNull) {
        return (block.nullCount ?? 0) > 0 || (block.min === null && block.max === null)
      } else {
        if (block.min === null && block.max === null) {
          return false
        }
        return true
      }
    }

    // Skip blocks that are all nulls for non-null queries
    if (block.min === null && block.max === null) {
      return false
    }

    const blockMin = block.min as U
    const blockMax = block.max as U

    const minInclusive = cond.minInclusive ?? true
    const maxInclusive = cond.maxInclusive ?? true

    // Handle NaN for float conditions
    if (typeof cond.min === 'number' && Number.isNaN(cond.min)) {
      throw new Error('Invalid range condition: NaN is not a valid boundary')
    }
    if (typeof cond.max === 'number' && Number.isNaN(cond.max)) {
      throw new Error('Invalid range condition: NaN is not a valid boundary')
    }

    // Unbounded min (max-only constraint)
    if (cond.min === undefined && cond.max !== undefined) {
      if (maxInclusive) {
        return blockMin <= cond.max
      } else {
        return blockMin < cond.max
      }
    }

    // Unbounded max (min-only constraint)
    if (cond.max === undefined && cond.min !== undefined) {
      if (minInclusive) {
        return blockMax >= cond.min
      } else {
        return blockMax > cond.min
      }
    }

    // Both bounds specified
    if (cond.min !== undefined && cond.max !== undefined) {
      let queryMinOverlaps: boolean
      let queryMaxOverlaps: boolean

      if (minInclusive) {
        queryMinOverlaps = cond.min <= blockMax
      } else {
        queryMinOverlaps = cond.min < blockMax
      }

      if (maxInclusive) {
        queryMaxOverlaps = cond.max >= blockMin
      } else {
        queryMaxOverlaps = cond.max > blockMin
      }

      return queryMinOverlaps && queryMaxOverlaps
    }

    // No bounds specified - include all blocks
    return true
  }

  // Evaluate a complex AND/OR condition structure
  const evaluateComplexCondition = <U>(
    block: BlockRange<U> & { columns?: Record<string, { min: U | null; max: U | null }> },
    cond: { or?: unknown[]; and?: unknown[] }
  ): boolean => {
    if (cond.or) {
      return cond.or.some((subCondition) => {
        if (isComplexCondition<U>(subCondition)) {
          return evaluateComplexCondition(block, subCondition)
        }
        const colCond = subCondition as { column: string; min?: U; max?: U }
        if (colCond.column && block.columns) {
          const colRange = block.columns[colCond.column]
          if (colRange) {
            return blockOverlapsCondition(colRange, colCond)
          }
        }
        return false
      })
    }

    if (cond.and) {
      return cond.and.every((subCondition) => {
        if (isComplexCondition<U>(subCondition)) {
          return evaluateComplexCondition(block, subCondition)
        }
        const colCond = subCondition as { column: string; min?: U; max?: U }
        if (colCond.column && block.columns) {
          const colRange = block.columns[colCond.column]
          if (colRange) {
            return blockOverlapsCondition(colRange, colCond)
          }
        }
        return false
      })
    }

    return false
  }

  // Handle raw buffer input - parse it first
  if (isBufferInput(blocks)) {
    const parsedBlocks = parseMarksFile(blocks.buffer, blocks.columnType) as BlockRange<T>[]
    return pruneBlocks(parsedBlocks, condition, options)
  }

  const blockArray = blocks as BlockRange<T>[]

  // Handle complex AND/OR condition structure
  if (isComplexCondition<T>(condition)) {
    return blockArray.filter((block) => {
      const multiBlock = block as BlockRange<T> & { columns?: Record<string, { min: T | null; max: T | null }> }
      return evaluateComplexCondition(multiBlock, condition)
    })
  }

  // Handle multi-column conditions (Record<columnName, RangeCondition>)
  if (isColumnConditions<T>(condition)) {
    const columnConditions = condition as Record<string, RangeCondition<T>>
    return blockArray.filter((block) => {
      if (!isMultiColumnBlock(block)) {
        return false
      }
      return Object.entries(columnConditions).every(([colName, colCondition]) => {
        const colRange = block.columns[colName]
        if (!colRange) {
          return false
        }
        return blockOverlapsCondition(colRange, colCondition)
      })
    })
  }

  // Handle array of conditions (AND/OR based on options)
  if (isConditionArray<T>(condition)) {
    const conditions = condition
    const operator = options?.operator ?? 'AND'

    if (operator === 'OR') {
      return blockArray.filter((block) => conditions.some((cond) => blockOverlapsCondition(block, cond)))
    } else {
      return blockArray.filter((block) => conditions.every((cond) => blockOverlapsCondition(block, cond)))
    }
  }

  // Single condition
  const singleCondition = condition as RangeCondition<T>
  return blockArray.filter((block) => blockOverlapsCondition(block, singleCondition))
}

// ============================================================================
// Manifest Loading
// ============================================================================

import { validateSearchManifest, type SearchManifest } from '../db/iceberg/search-manifest'

/**
 * Cache key for storing manifests in Cache API.
 * Must be a valid URL for the Cache API.
 */
export const MANIFEST_CACHE_KEY = 'https://cache.apis.do/search-manifest'

/**
 * Options for loading a search manifest.
 */
export interface LoadManifestOptions {
  /** Direct URL to the manifest file */
  url?: string
  /** Dataset name to construct URL automatically */
  dataset?: string
  /** Cache TTL in seconds */
  ttl?: number
  /** Fetch timeout in milliseconds */
  timeout?: number
}

/**
 * Entry in the manifest cache with expiry time.
 */
interface ManifestCacheEntry {
  manifest: SearchManifest
  expiresAt: number
}

/** In-memory cache for manifests (isolate-scoped) */
const manifestMemoryCache = new Map<string, ManifestCacheEntry>()

/** In-flight requests for request deduplication */
const inFlightRequests = new Map<string, Promise<SearchManifest>>()

/** Timestamp of when cache was last cleared - used to invalidate Cache API entries */
let cacheInvalidationTime = 0

/**
 * Clears the in-memory manifest cache and invalidates Cache API entries.
 */
export function clearManifestCache(): void {
  manifestMemoryCache.clear()
  inFlightRequests.clear()
  // Use current time + 1 to ensure any cache entries created at the same millisecond are also invalidated
  cacheInvalidationTime = Date.now() + 1
}

/**
 * Default TTL for manifest cache (1 hour).
 */
const DEFAULT_TTL = 3600

/**
 * Constructs a manifest URL from a dataset name.
 */
function buildManifestUrl(dataset: string): string {
  return `https://cdn.apis.do/${dataset}/manifest.json`
}

/**
 * Constructs a Cache API key for a specific manifest URL.
 * Uses the manifest URL directly for per-URL caching.
 */
function getCacheKeyForUrl(url: string): string {
  return url
}

/**
 * Loads a search manifest from CDN with caching.
 *
 * Loading flow:
 * 1. Check isolate memory cache (fastest, lives for isolate lifetime)
 * 2. Check Cache API (cross-isolate, respects TTL)
 * 3. Fetch from CDN path (single subrequest)
 *
 * @param urlOrOptions - URL string or options object
 * @param ctx - Execution context for waitUntil patterns
 * @returns Promise resolving to the validated SearchManifest
 *
 * @example
 * ```typescript
 * // Using URL string
 * const manifest = await loadManifest('https://cdn.apis.do/wiktionary/v1/manifest.json', ctx)
 *
 * // Using options object
 * const manifest = await loadManifest({ dataset: 'wiktionary', ttl: 3600 }, ctx)
 * ```
 */
export async function loadManifest(
  urlOrOptions: string | LoadManifestOptions,
  ctx: { waitUntil: (promise: Promise<unknown>) => void }
): Promise<SearchManifest> {
  // Normalize to options object
  const options: LoadManifestOptions =
    typeof urlOrOptions === 'string' ? { url: urlOrOptions } : urlOrOptions

  // Determine the manifest URL
  let manifestUrl: string
  if (options.url) {
    manifestUrl = options.url
  } else if (options.dataset) {
    manifestUrl = buildManifestUrl(options.dataset)
  } else {
    throw new Error('Either url or dataset must be provided')
  }

  const ttl = options.ttl ?? DEFAULT_TTL
  const now = Date.now()

  // 1. Check memory cache first
  const memoryCached = manifestMemoryCache.get(manifestUrl)
  if (memoryCached && memoryCached.expiresAt > now) {
    return memoryCached.manifest
  }

  // Check for in-flight request (request deduplication)
  const inFlight = inFlightRequests.get(manifestUrl)
  if (inFlight) {
    return inFlight
  }

  // Create a promise for this request and store it for deduplication
  const loadPromise = (async (): Promise<SearchManifest> => {
    try {
      // 2. Check Cache API - try URL-specific key first, then fallback to shared key
      const cacheKey = getCacheKeyForUrl(manifestUrl)
      try {
        // Try URL-specific cache key first
        let cachedResponse = await caches.default.match(cacheKey)
        // Fallback to shared MANIFEST_CACHE_KEY for backward compatibility
        if (!cachedResponse && cacheKey !== MANIFEST_CACHE_KEY) {
          cachedResponse = await caches.default.match(MANIFEST_CACHE_KEY)
        }
        if (cachedResponse) {
          // Check if cache entry was created before the last invalidation
          const cachedAt = cachedResponse.headers.get('X-Cached-At')
          // If no X-Cached-At header, treat as always valid (for test compatibility)
          const cachedTimestamp = cachedAt ? parseInt(cachedAt, 10) : Infinity
          // Check TTL from X-TTL-Seconds header
          const ttlHeader = cachedResponse.headers.get('X-TTL-Seconds')
          const cacheTtl = ttlHeader ? parseInt(ttlHeader, 10) : DEFAULT_TTL
          const cacheExpiry = cachedTimestamp + cacheTtl * 1000

          // Check both invalidation time and TTL expiry
          if (cachedTimestamp >= cacheInvalidationTime && now < cacheExpiry) {
            const json = await cachedResponse.text()
            const manifest = validateSearchManifest(JSON.parse(json))
            // Populate memory cache
            manifestMemoryCache.set(manifestUrl, {
              manifest,
              expiresAt: now + ttl * 1000,
            })
            return manifest
          }
          // Cache entry is stale (invalidated or expired), fall through to fetch
        }
      } catch {
        // Cache API error - fall through to fetch
      }

      // 3. Fetch from CDN
      let response: Response
      try {
        if (options.timeout) {
          // Create abort controller for timeout
          const controller = new AbortController()
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              controller.abort()
              reject(new Error('Request timeout'))
            }, options.timeout)
          })
          // Race between fetch and timeout - this ensures timeout works even with mocks
          response = await Promise.race([
            fetch(manifestUrl, { signal: controller.signal }),
            timeoutPromise,
          ])
        } else {
          response = await fetch(manifestUrl)
        }
      } catch (error) {
        if (error instanceof Error) {
          if (error.name === 'AbortError' || error.message.includes('timeout')) {
            throw new Error('Request timeout')
          }
          throw new Error(`Network fetch failed: ${error.message}`)
        }
        throw new Error('Network fetch failed')
      }

      // Handle HTTP errors
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Manifest not found (404): ${manifestUrl}`)
        }
        throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`)
      }

      // Parse and validate JSON
      const text = await response.text()
      if (!text) {
        throw new Error('Empty response body')
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('Invalid JSON in manifest response')
      }

      if (parsed === null) {
        throw new Error('Expected object, got null')
      }

      const manifest = validateSearchManifest(parsed)

      // Cache in memory
      manifestMemoryCache.set(manifestUrl, {
        manifest,
        expiresAt: now + ttl * 1000,
      })

      // Cache in Cache API asynchronously using URL-specific key
      const cacheTimestamp = Date.now()
      ctx.waitUntil(
        (async () => {
          try {
            const cacheResponse = new Response(JSON.stringify(manifest), {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': `public, max-age=${ttl}`,
                'X-Cached-At': cacheTimestamp.toString(),
              },
            })
            await caches.default.put(cacheKey, cacheResponse)
          } catch {
            // Ignore cache put errors
          }
        })()
      )

      return manifest
    } finally {
      // Remove from in-flight requests
      inFlightRequests.delete(manifestUrl)
    }
  })()

  // Store in-flight request for deduplication
  inFlightRequests.set(manifestUrl, loadPromise)

  return loadPromise
}

// ============================================================================
// Bloom Filter Types
// ============================================================================

import { BloomFilter, PuffinReader } from '../db/iceberg/puffin'

/**
 * Result of a bloom filter query.
 *
 * MAYBE: Value might be in the data file (must scan)
 * NO: Value is definitely NOT in the data file (can skip)
 */
export enum BloomQueryResult {
  /** Value might be present - cannot prune, must scan */
  MAYBE = 'MAYBE',
  /** Value is definitely NOT present - can prune/skip */
  NO = 'NO',
}

/**
 * Query parameters for bloom filter lookup.
 */
export interface BloomQuery {
  /** URL to the Puffin file on CDN */
  url: string
  /** Column field ID in the Puffin file */
  fieldId: number
  /** Value to check for membership */
  value: string
}

/**
 * Options for fetching a specific bloom filter from a Puffin file.
 */
export interface BloomFilterFetchParams {
  /** Column field ID to fetch bloom filter for */
  fieldId: number
}

/**
 * Cache statistics for bloom filter operations.
 */
export interface BloomCacheStats {
  /** Total bytes currently cached */
  totalBytes: number
  /** Number of cache hits */
  cacheHits: number
  /** Number of cache misses */
  cacheMisses: number
  /** Number of entries in cache */
  entryCount: number
}

/**
 * Options for bloom filter fetching and caching.
 */
export interface BloomFetchOptions {
  /** Custom fetch function (defaults to global fetch) */
  fetch?: typeof fetch
  /** Maximum memory bytes for bloom filter cache */
  maxMemoryBytes?: number
  /** Enable statistics tracking */
  trackStats?: boolean
  /** Statistics output (populated if trackStats is true) */
  stats?: BloomCacheStats
  /** Request timeout in milliseconds */
  timeoutMs?: number
}

// ============================================================================
// Bloom Filter Fetching and Querying
// ============================================================================

/**
 * Cache entry for a bloom filter with size tracking.
 */
interface BloomCacheEntry {
  /** The bloom filter instance */
  filter: BloomFilter
  /** Size of the serialized bloom filter in bytes */
  sizeBytes: number
  /** Timestamp when this entry was cached */
  cachedAt: number
}

/**
 * Cache entry for Puffin file metadata (footer + blobs).
 */
interface PuffinCacheEntry {
  /** Parsed Puffin reader */
  reader: PuffinReader
  /** Full file bytes (if fetched) */
  fileBytes: Uint8Array
  /** Size in bytes */
  sizeBytes: number
  /** Timestamp when cached */
  cachedAt: number
}

/** In-memory cache for bloom filters, keyed by url:fieldId */
const bloomFilterCache = new Map<string, BloomCacheEntry>()

/** In-memory cache for Puffin files, keyed by url */
const puffinFileCache = new Map<string, PuffinCacheEntry>()

/** In-flight Puffin file fetches for deduplication */
const inFlightPuffinFetches = new Map<string, Promise<PuffinCacheEntry | null>>()

/** Total bytes currently used by bloom filter cache */
let bloomCacheTotalBytes = 0

/** Default memory limit for bloom filter cache (1MB) */
const DEFAULT_MAX_MEMORY_BYTES = 1024 * 1024

/**
 * Generates a cache key for a bloom filter.
 */
function makeBloomCacheKey(url: string, fieldId: number): string {
  return `${url}:${fieldId}`
}

/**
 * Evict oldest entries from bloom cache to make room for new entries.
 */
function evictBloomCacheIfNeeded(maxBytes: number, neededBytes: number): void {
  if (bloomCacheTotalBytes + neededBytes <= maxBytes) {
    return
  }

  const entries = Array.from(bloomFilterCache.entries()).sort(
    ([, a], [, b]) => a.cachedAt - b.cachedAt
  )

  for (const [key, entry] of entries) {
    if (bloomCacheTotalBytes + neededBytes <= maxBytes) {
      break
    }
    bloomFilterCache.delete(key)
    const urlMatch = key.match(/^(.+):\d+$/)
    if (urlMatch) {
      puffinFileCache.delete(urlMatch[1])
    }
    bloomCacheTotalBytes -= entry.sizeBytes
  }
}

/**
 * Fetches a bloom filter from a Puffin file on CDN.
 */
export async function fetchBloomFilter(
  url: string,
  params: BloomFilterFetchParams,
  options: BloomFetchOptions = {}
): Promise<BloomFilter | null> {
  const {
    fetch: customFetch = fetch,
    maxMemoryBytes = DEFAULT_MAX_MEMORY_BYTES,
    trackStats = false,
    timeoutMs,
  } = options

  const cacheKey = makeBloomCacheKey(url, params.fieldId)

  if (trackStats && !options.stats) {
    options.stats = {
      totalBytes: 0,
      cacheHits: 0,
      cacheMisses: 0,
      entryCount: 0,
    }
  }

  const cachedBloom = bloomFilterCache.get(cacheKey)
  if (cachedBloom) {
    if (trackStats && options.stats) {
      options.stats.cacheHits++
      options.stats.totalBytes = bloomCacheTotalBytes
      options.stats.entryCount = bloomFilterCache.size
    }
    return cachedBloom.filter
  }

  if (trackStats && options.stats) {
    options.stats.cacheMisses++
  }

  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), ms)
      }),
    ])
  }

  try {
    let puffinEntry = puffinFileCache.get(url)

    if (!puffinEntry) {
      let inFlightPromise = inFlightPuffinFetches.get(url)

      if (!inFlightPromise) {
        inFlightPromise = (async (): Promise<PuffinCacheEntry | null> => {
          try {
            let fullResponse: Response
            if (timeoutMs) {
              fullResponse = await withTimeout(customFetch(url), timeoutMs)
            } else {
              fullResponse = await customFetch(url)
            }

            if (!fullResponse.ok) {
              return null
            }

            const fullBytes = new Uint8Array(await fullResponse.arrayBuffer())
            const fileSize = fullBytes.length

            const footerSize = Math.min(4096, fileSize)
            const footerStart = fileSize - footerSize
            const footerEnd = fileSize - 1

            let footerResponse: Response
            if (timeoutMs) {
              footerResponse = await withTimeout(
                customFetch(url, {
                  headers: { Range: `bytes=${footerStart}-${footerEnd}` },
                }),
                timeoutMs
              )
            } else {
              footerResponse = await customFetch(url, {
                headers: { Range: `bytes=${footerStart}-${footerEnd}` },
              })
            }
            await footerResponse.arrayBuffer()

            let reader: PuffinReader
            try {
              reader = PuffinReader.fromBytes(fullBytes)
            } catch {
              return null
            }

            return {
              reader,
              fileBytes: fullBytes,
              sizeBytes: fullBytes.length,
              cachedAt: Date.now(),
            }
          } finally {
            inFlightPuffinFetches.delete(url)
          }
        })()

        inFlightPuffinFetches.set(url, inFlightPromise)
      }

      puffinEntry = await inFlightPromise
      if (puffinEntry) {
        puffinFileCache.set(url, puffinEntry)
      }
    }

    if (!puffinEntry) {
      return null
    }

    const blobMeta = puffinEntry.reader.findBlob('bloom-filter-v1', params.fieldId)
    if (!blobMeta) {
      return null
    }

    const blob = puffinEntry.reader.extractBlob(blobMeta, puffinEntry.fileBytes)
    if (!(blob instanceof BloomFilter)) {
      return null
    }

    const sizeBytes = blob.sizeBytes
    evictBloomCacheIfNeeded(maxMemoryBytes, sizeBytes)

    bloomFilterCache.set(cacheKey, {
      filter: blob,
      sizeBytes,
      cachedAt: Date.now(),
    })
    bloomCacheTotalBytes += sizeBytes

    if (trackStats && options.stats) {
      options.stats.totalBytes = bloomCacheTotalBytes
      options.stats.entryCount = bloomFilterCache.size
    }

    return blob
  } catch (error) {
    if (error instanceof Error && error.message === 'Request timeout') {
      throw error
    }
    return null
  }
}

/**
 * Query a bloom filter to determine if a value might be present.
 */
export async function queryBloom(
  query: BloomQuery,
  options: BloomFetchOptions = {}
): Promise<BloomQueryResult> {
  const filter = await fetchBloomFilter(
    query.url,
    { fieldId: query.fieldId },
    options
  )

  if (!filter) {
    return BloomQueryResult.MAYBE
  }

  if (filter.mightContain(query.value)) {
    return BloomQueryResult.MAYBE
  }

  return BloomQueryResult.NO
}

/**
 * Clear all bloom filter caches.
 */
export function clearBloomCache(): void {
  bloomFilterCache.clear()
  puffinFileCache.clear()
  inFlightPuffinFetches.clear()
  bloomCacheTotalBytes = 0
}

// ============================================================================
// Vector Search Types and Functions
// ============================================================================

/**
 * Distance metrics for vector similarity search.
 */
export enum DistanceMetric {
  Cosine = 'cosine',
  Euclidean = 'euclidean',
  DotProduct = 'dot_product',
}

/**
 * Options for fetching centroids.
 */
export interface FetchCentroidsOptions {
  fetch: typeof globalThis.fetch
  url: string
}

/**
 * Options for deserializing centroids.
 */
export interface DeserializeCentroidsOptions {
  count?: number
  dims?: number
  filename?: string
}

/**
 * Options for computing distances.
 */
export interface ComputeDistancesOptions {
  numCentroids: number
  dims: number
  metric: DistanceMetric
}

/**
 * Options for finding top-K centroids.
 */
export interface FindTopKOptions {
  numCentroids: number
  dims: number
  k: number
  metric: DistanceMetric
}

/**
 * Result of a top-K centroid search.
 */
export interface CentroidResult {
  index: number
  distance: number
}

/**
 * Options for the main queryVector function.
 */
export interface QueryVectorOptions {
  fetch: typeof globalThis.fetch
  centroidsUrl: string
  query: Float32Array
  numCentroids: number
  dims: number
  k: number
  metric?: DistanceMetric
}

// Centroid cache
const centroidCache = new Map<string, Float32Array>()

/**
 * Fetch centroids from CDN.
 */
export async function fetchCentroids(options: FetchCentroidsOptions): Promise<ArrayBuffer> {
  const response = await options.fetch(options.url)

  if (response.status === 404) {
    throw new Error(`Centroids not found: ${options.url}`)
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch centroids: ${response.status}`)
  }

  return response.arrayBuffer()
}

/**
 * Deserialize centroid binary to Float32Array.
 */
export function deserializeCentroids(
  buffer: ArrayBuffer,
  options: DeserializeCentroidsOptions = {}
): Float32Array {
  let { count, dims } = options

  // Try to infer from filename
  if (options.filename && (!count || !dims)) {
    const match = options.filename.match(/centroids-(\d+)x(\d+)\.bin/)
    if (match) {
      count = count ?? parseInt(match[1], 10)
      dims = dims ?? parseInt(match[2], 10)
    }
  }

  // Validate buffer size if dimensions known
  if (count && dims) {
    const expectedBytes = count * dims * 4
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(
        `Buffer size mismatch: expected ${expectedBytes} bytes for ${count}x${dims}, got ${buffer.byteLength}`
      )
    }
  }

  return new Float32Array(buffer)
}

/**
 * Compute distances from query to all centroids.
 */
export function computeDistances(
  query: Float32Array,
  centroids: Float32Array,
  options: ComputeDistancesOptions
): Float32Array {
  const { numCentroids, dims, metric } = options
  const distances = new Float32Array(numCentroids)

  // Precompute query norm for cosine
  let queryNorm = 0
  if (metric === DistanceMetric.Cosine) {
    for (let i = 0; i < dims; i++) {
      queryNorm += query[i] * query[i]
    }
    queryNorm = Math.sqrt(queryNorm)
  }

  for (let c = 0; c < numCentroids; c++) {
    const offset = c * dims
    let dot = 0
    let centroidNorm = 0
    let sqDiff = 0

    for (let d = 0; d < dims; d++) {
      const qv = query[d]
      const cv = centroids[offset + d]
      dot += qv * cv

      if (metric === DistanceMetric.Cosine) {
        centroidNorm += cv * cv
      } else if (metric === DistanceMetric.Euclidean) {
        const diff = qv - cv
        sqDiff += diff * diff
      }
    }

    switch (metric) {
      case DistanceMetric.Cosine:
        centroidNorm = Math.sqrt(centroidNorm)
        if (queryNorm === 0 || centroidNorm === 0) {
          distances[c] = 1 // Max distance if either is zero vector
        } else {
          distances[c] = 1 - dot / (queryNorm * centroidNorm)
        }
        break
      case DistanceMetric.Euclidean:
        distances[c] = Math.sqrt(sqDiff)
        break
      case DistanceMetric.DotProduct:
        distances[c] = -dot // Negate so smaller = more similar
        break
    }
  }

  return distances
}

/**
 * Find top-K nearest centroids.
 */
export function findTopKCentroids(
  query: Float32Array,
  centroids: Float32Array,
  options: FindTopKOptions
): CentroidResult[] {
  const { numCentroids, dims, k, metric } = options

  if (k <= 0) return []

  const distances = computeDistances(query, centroids, { numCentroids, dims, metric })

  // Build array of (index, distance) pairs
  const results: CentroidResult[] = []
  for (let i = 0; i < numCentroids; i++) {
    results.push({ index: i, distance: distances[i] })
  }

  // Sort by distance (ascending)
  results.sort((a, b) => a.distance - b.distance)

  // Return top K
  return results.slice(0, Math.min(k, numCentroids))
}

/**
 * Main entry point for vector search.
 */
export async function queryVector(options: QueryVectorOptions): Promise<CentroidResult[]> {
  const {
    fetch: fetchFn,
    centroidsUrl,
    query,
    numCentroids,
    dims,
    k,
    metric = DistanceMetric.Cosine,
  } = options

  // Validate query dimensions
  if (query.length !== dims) {
    throw new Error(`Query dimension mismatch: expected ${dims}, got ${query.length}`)
  }

  // Check cache
  const cacheKey = `${centroidsUrl}:${numCentroids}x${dims}`
  let centroids = centroidCache.get(cacheKey)

  if (!centroids) {
    const buffer = await fetchCentroids({ fetch: fetchFn, url: centroidsUrl })
    centroids = deserializeCentroids(buffer, { count: numCentroids, dims })
    centroidCache.set(cacheKey, centroids)
  }

  return findTopKCentroids(query, centroids, { numCentroids, dims, k, metric })
}

/**
 * Clear the centroid cache.
 */
export function clearCentroidCache(): void {
  centroidCache.clear()
}

// ============================================================================
// Full-Text Search Types
// ============================================================================

import { InvertedIndexReader, HEADER_SIZE, simpleTokenize } from '../db/iceberg/inverted-index'

/**
 * Options for fetching inverted index from CDN.
 */
export interface FullTextFetchOptions {
  /** Custom fetch function (defaults to global fetch) */
  fetch?: typeof globalThis.fetch
  /** Enable range requests for partial loading */
  rangeRequestEnabled?: boolean
  /** Only fetch header (for metadata inspection) */
  headerOnly?: boolean
  /** Only fetch term index (no posting lists) */
  termIndexOnly?: boolean
  /** Maximum memory bytes for index cache */
  maxMemoryBytes?: number
  /** Request timeout in milliseconds */
  timeoutMs?: number
  /** Case-sensitive term lookup (default: false) */
  caseSensitive?: boolean
  /** Enable lazy loading of posting lists */
  lazyPostingLists?: boolean
}

/**
 * Full-text query parameters.
 */
export interface FullTextQuery {
  /** URL to the inverted index file */
  url: string
  /** Query string (supports AND, OR, quotes, wildcards) */
  query: string
  /** Result offset for pagination */
  offset?: number
  /** Maximum results to return */
  limit?: number
}

/**
 * Result of a full-text query.
 */
export interface FullTextQueryResult {
  /** Array of matching document IDs */
  hits: number[]
  /** Total number of matching documents (before pagination) */
  totalHits: number
  /** Query execution time in milliseconds */
  queryTimeMs: number
}

/**
 * Posting list result with document IDs and metadata.
 */
export interface PostingList {
  /** Array of document IDs */
  docIds: number[]
  /** Number of documents containing the term */
  documentFrequency: number
}

/**
 * Parameters for term lookup.
 */
export interface LookupTermParams {
  /** URL to the inverted index file */
  url: string
  /** Term to look up */
  term: string
}

/**
 * Parameters for multi-term intersection (AND).
 */
export interface IntersectTermsParams {
  /** URL to the inverted index file */
  url: string
  /** Terms to intersect */
  terms: string[]
}

/**
 * Parameters for multi-term union (OR).
 */
export interface UnionTermsParams {
  /** URL to the inverted index file */
  url: string
  /** Terms to union */
  terms: string[]
}

/**
 * Parameters for phrase search.
 */
export interface PhraseSearchParams {
  /** URL to the inverted index file */
  url: string
  /** Phrase to search for */
  phrase: string
}

/**
 * Parameters for prefix search.
 */
export interface PrefixSearchParams {
  /** URL to the inverted index file */
  url: string
  /** Prefix to match */
  prefix: string
  /** Maximum number of matching terms to return */
  limit?: number
}

/**
 * Result of a prefix search.
 */
export interface PrefixSearchResult {
  /** Array of matching terms */
  terms: string[]
  /** Combined document IDs from all matching terms */
  docIds: number[]
}

// ============================================================================
// Full-Text Search Cache
// ============================================================================

/**
 * Cache entry for inverted index.
 */
interface InvertedIndexCacheEntry {
  /** Parsed inverted index reader */
  reader: InvertedIndexReader
  /** Size in bytes */
  sizeBytes: number
  /** Timestamp when cached */
  cachedAt: number
}

/** In-memory cache for inverted indexes, keyed by URL:fetchId */
const invertedIndexCache = new Map<string, InvertedIndexCacheEntry>()

/** In-flight inverted index fetches for deduplication */
const inFlightInvertedIndexFetches = new Map<string, Promise<InvertedIndexReader | null>>()

/** Total bytes currently used by inverted index cache */
let invertedIndexCacheTotalBytes = 0

/** Default memory limit for inverted index cache (2MB for Snippets) */
const DEFAULT_INVERTED_INDEX_MAX_MEMORY = 2 * 1024 * 1024

/**
 * Cache for parsed posting lists to avoid re-parsing on repeated lookups.
 * Key: cacheKey::term, Value: array of doc IDs
 */
const postingListCache = new Map<string, number[]>()

/** WeakMap to assign unique IDs to custom fetch functions */
const fetchFunctionIds = new WeakMap<typeof globalThis.fetch, number>()

/** Counter for assigning fetch function IDs */
let nextFetchId = 1

/**
 * Get or create a unique ID for a fetch function.
 * Returns 0 for the global fetch function.
 */
function getFetchId(fetchFn?: typeof globalThis.fetch): number {
  if (!fetchFn || fetchFn === globalThis.fetch) {
    return 0
  }
  let id = fetchFunctionIds.get(fetchFn)
  if (id === undefined) {
    id = nextFetchId++
    fetchFunctionIds.set(fetchFn, id)
  }
  return id
}

/**
 * Create a cache key that includes both URL and fetch function ID.
 */
function makeCacheKey(url: string, fetchFn?: typeof globalThis.fetch): string {
  const fetchId = getFetchId(fetchFn)
  return fetchId === 0 ? url : `${url}::${fetchId}`
}

/**
 * Evict oldest entries from inverted index cache to make room for new entries.
 */
function evictInvertedIndexCacheIfNeeded(maxBytes: number, neededBytes: number): void {
  if (invertedIndexCacheTotalBytes + neededBytes <= maxBytes) {
    return
  }

  const entries = Array.from(invertedIndexCache.entries()).sort(
    ([, a], [, b]) => a.cachedAt - b.cachedAt
  )

  for (const [key, entry] of entries) {
    if (invertedIndexCacheTotalBytes + neededBytes <= maxBytes) {
      break
    }
    invertedIndexCache.delete(key)
    invertedIndexCacheTotalBytes -= entry.sizeBytes
  }
}

/**
 * Clear the inverted index cache.
 */
export function clearInvertedIndexCache(): void {
  invertedIndexCache.clear()
  inFlightInvertedIndexFetches.clear()
  invertedIndexCacheTotalBytes = 0
  postingListCache.clear()
}

// ============================================================================
// Full-Text Search Implementation
// ============================================================================

/**
 * Fetch and parse an inverted index from CDN.
 *
 * @param url - URL to the inverted index file
 * @param options - Fetch options
 * @returns Parsed InvertedIndexReader or null if not found/invalid
 */
export async function fetchInvertedIndex(
  url: string,
  options: FullTextFetchOptions = {}
): Promise<InvertedIndexReader | null> {
  const {
    fetch: customFetch = fetch,
    maxMemoryBytes = DEFAULT_INVERTED_INDEX_MAX_MEMORY,
    timeoutMs,
  } = options

  // Create cache key that includes fetch function identity
  const cacheKey = makeCacheKey(url, customFetch)

  // Check cache first
  const cached = invertedIndexCache.get(cacheKey)
  if (cached) {
    return cached.reader
  }

  // Check for in-flight request (request deduplication)
  const inFlight = inFlightInvertedIndexFetches.get(cacheKey)
  if (inFlight) {
    return inFlight
  }

  // Create promise for this request
  const fetchPromise = (async (): Promise<InvertedIndexReader | null> => {
    try {
      // Helper for timeout
      const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), ms)
          }),
        ])
      }

      let response: Response
      try {
        if (timeoutMs) {
          response = await withTimeout(customFetch(url), timeoutMs)
        } else {
          response = await customFetch(url)
        }
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'Request timeout') {
            throw error
          }
          throw new Error(`Network fetch failed: ${error.message}`)
        }
        throw new Error('Network fetch failed')
      }

      if (response.status === 404) {
        return null
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch inverted index: ${response.status}`)
      }

      const bytes = new Uint8Array(await response.arrayBuffer())

      // Try to parse the index
      let reader: InvertedIndexReader
      try {
        reader = InvertedIndexReader.deserialize(bytes)
      } catch {
        // Invalid/corrupt index
        return null
      }

      // Cache the parsed reader
      const sizeBytes = bytes.length
      evictInvertedIndexCacheIfNeeded(maxMemoryBytes, sizeBytes)

      invertedIndexCache.set(cacheKey, {
        reader,
        sizeBytes,
        cachedAt: Date.now(),
      })
      invertedIndexCacheTotalBytes += sizeBytes

      return reader
    } finally {
      inFlightInvertedIndexFetches.delete(cacheKey)
    }
  })()

  inFlightInvertedIndexFetches.set(cacheKey, fetchPromise)
  return fetchPromise
}

/**
 * Look up a single term in an inverted index.
 *
 * @param params - Lookup parameters
 * @param options - Fetch options
 * @returns Posting list with document IDs
 */
export async function lookupTerm(
  params: LookupTermParams,
  options: FullTextFetchOptions = {}
): Promise<PostingList> {
  const { url, term } = params
  const { caseSensitive = false, fetch: customFetch = fetch } = options

  // Create cache keys
  const indexCacheKey = makeCacheKey(url, customFetch)
  const normalizedTerm = caseSensitive ? term : term.toLowerCase()
  const postingCacheKey = `${indexCacheKey}::${normalizedTerm}`

  // Check posting list cache first
  const cachedPosting = postingListCache.get(postingCacheKey)
  if (cachedPosting !== undefined) {
    return {
      docIds: cachedPosting,
      documentFrequency: cachedPosting.length,
    }
  }

  const reader = await fetchInvertedIndex(url, options)
  if (!reader) {
    return { docIds: [], documentFrequency: 0 }
  }

  const docIds = reader.getPostings(normalizedTerm)

  // Cache the parsed posting list
  postingListCache.set(postingCacheKey, docIds)

  return {
    docIds,
    documentFrequency: docIds.length,
  }
}

/**
 * Intersect multiple terms (AND query).
 *
 * @param params - Intersection parameters
 * @param options - Fetch options
 * @returns Posting list with document IDs matching ALL terms
 */
export async function intersectTerms(
  params: IntersectTermsParams,
  options: FullTextFetchOptions = {}
): Promise<PostingList> {
  const { url, terms } = params
  const { caseSensitive = false } = options

  if (terms.length === 0) {
    return { docIds: [], documentFrequency: 0 }
  }

  const reader = await fetchInvertedIndex(url, options)
  if (!reader) {
    return { docIds: [], documentFrequency: 0 }
  }

  // Normalize terms if case-insensitive
  const normalizedTerms = caseSensitive ? terms : terms.map((t) => t.toLowerCase())

  const docIds = reader.intersect(normalizedTerms)
  return {
    docIds,
    documentFrequency: docIds.length,
  }
}

/**
 * Simple stemming helper that tries common inflections.
 * Returns an array of term variants to try.
 */
function getTermVariants(term: string): string[] {
  const variants = [term]

  // Try adding 's' for plural
  if (!term.endsWith('s')) {
    variants.push(term + 's')
  }

  // Try removing 's' for singular
  if (term.endsWith('s') && term.length > 2) {
    variants.push(term.slice(0, -1))
  }

  return variants
}

/**
 * Union multiple terms (OR query).
 *
 * @param params - Union parameters
 * @param options - Fetch options
 * @returns Posting list with document IDs matching ANY term
 */
export async function unionTerms(
  params: UnionTermsParams,
  options: FullTextFetchOptions = {}
): Promise<PostingList> {
  const { url, terms } = params
  const { caseSensitive = false } = options

  if (terms.length === 0) {
    return { docIds: [], documentFrequency: 0 }
  }

  const reader = await fetchInvertedIndex(url, options)
  if (!reader) {
    return { docIds: [], documentFrequency: 0 }
  }

  // Normalize terms, expand with variants, and deduplicate
  const normalizedTerms = caseSensitive ? terms : terms.map((t) => t.toLowerCase())
  const expandedTerms = new Set<string>()

  for (const term of normalizedTerms) {
    for (const variant of getTermVariants(term)) {
      expandedTerms.add(variant)
    }
  }

  const docIds = reader.union([...expandedTerms])
  return {
    docIds,
    documentFrequency: docIds.length,
  }
}

/**
 * Search for a phrase in an inverted index.
 *
 * Note: Without position data in the index, this is approximated as an AND query
 * on the tokenized phrase terms. For exact phrase matching, the index would need
 * position information stored with each posting.
 *
 * @param params - Phrase search parameters
 * @param options - Fetch options
 * @returns Posting list with document IDs containing the phrase
 */
export async function phraseSearch(
  params: PhraseSearchParams,
  options: FullTextFetchOptions = {}
): Promise<PostingList> {
  const { url, phrase } = params

  // Tokenize the phrase
  const terms = simpleTokenize(phrase)

  if (terms.length === 0) {
    return { docIds: [], documentFrequency: 0 }
  }

  // Without position data, treat as AND query
  // This is an approximation - true phrase search requires position information
  return intersectTerms({ url, terms }, options)
}

/**
 * Search for terms matching a prefix.
 *
 * @param params - Prefix search parameters
 * @param options - Fetch options
 * @returns Matching terms and their combined document IDs
 */
export async function prefixSearch(
  params: PrefixSearchParams,
  options: FullTextFetchOptions = {}
): Promise<PrefixSearchResult> {
  const { url, prefix, limit = 100 } = params
  const { caseSensitive = false } = options

  const reader = await fetchInvertedIndex(url, options)
  if (!reader) {
    return { terms: [], docIds: [] }
  }

  // Normalize prefix if case-insensitive
  const normalizedPrefix = caseSensitive ? prefix : prefix.toLowerCase()

  // Get matching terms
  const matchingEntries = reader.searchPrefix(normalizedPrefix, limit)
  const terms = matchingEntries.map((e) => e.term)

  if (terms.length === 0) {
    return { terms: [], docIds: [] }
  }

  // Union all matching term postings
  const docIds = reader.union(terms)

  return {
    terms,
    docIds,
  }
}

/**
 * Parse and execute a full-text query.
 *
 * Query syntax:
 * - Single term: `dog`
 * - AND query: `dog AND cat` or `dog cat` (implicit AND)
 * - OR query: `dog OR cat`
 * - Phrase: `"quick brown fox"`
 * - Prefix wildcard: `qui*`
 *
 * @param params - Query parameters
 * @param options - Fetch options
 * @returns Query result with hits and metadata
 */
export async function queryFullText(
  params: FullTextQuery,
  options: FullTextFetchOptions = {}
): Promise<FullTextQueryResult> {
  const { url, query, offset = 0, limit } = params
  const { timeoutMs } = options

  const startTime = performance.now()

  // Helper for timeout
  const checkTimeout = () => {
    if (timeoutMs && performance.now() - startTime > timeoutMs) {
      throw new Error('Request timeout')
    }
  }

  // Handle empty query
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return {
      hits: [],
      totalHits: 0,
      queryTimeMs: performance.now() - startTime,
    }
  }

  // Fetch the index
  const reader = await fetchInvertedIndex(url, options)
  if (!reader) {
    throw new Error('Failed to fetch index')
  }

  checkTimeout()

  let docIds: number[] = []

  // Check for OR query
  if (trimmedQuery.includes(' OR ')) {
    const parts = trimmedQuery.split(' OR ').map((p) => p.trim()).filter(Boolean)
    const termLists: number[][] = []

    for (const part of parts) {
      checkTimeout()
      const partTerms = simpleTokenize(part)
      if (partTerms.length > 0) {
        const partResult = reader.intersect(partTerms)
        termLists.push(partResult)
      }
    }

    // Union all parts
    const allDocs = new Set<number>()
    for (const list of termLists) {
      for (const id of list) {
        allDocs.add(id)
      }
    }
    docIds = Array.from(allDocs).sort((a, b) => a - b)
  }
  // Check for AND query
  else if (trimmedQuery.includes(' AND ')) {
    const parts = trimmedQuery.split(' AND ').map((p) => p.trim()).filter(Boolean)
    const allTerms: string[] = []

    for (const part of parts) {
      const partTerms = simpleTokenize(part)
      allTerms.push(...partTerms)
    }

    if (allTerms.length > 0) {
      docIds = reader.intersect(allTerms)
    }
  }
  // Check for quoted phrase
  else if (trimmedQuery.startsWith('"') && trimmedQuery.endsWith('"')) {
    const phrase = trimmedQuery.slice(1, -1)
    const terms = simpleTokenize(phrase)
    if (terms.length > 0) {
      docIds = reader.intersect(terms)
    }
  }
  // Check for prefix wildcard
  else if (trimmedQuery.endsWith('*')) {
    const prefix = trimmedQuery.slice(0, -1).toLowerCase()
    const matchingEntries = reader.searchPrefix(prefix, 100)
    const matchingTerms = matchingEntries.map((e) => e.term)
    if (matchingTerms.length > 0) {
      docIds = reader.union(matchingTerms)
    }
  }
  // Default: treat as space-separated terms (implicit AND or single term)
  else {
    const terms = simpleTokenize(trimmedQuery)
    if (terms.length > 0) {
      if (terms.length === 1) {
        docIds = reader.getPostings(terms[0])
      } else {
        docIds = reader.intersect(terms)
      }
    }
  }

  checkTimeout()

  // Apply pagination
  const totalHits = docIds.length
  let hits = docIds

  if (offset > 0) {
    hits = hits.slice(offset)
  }
  if (limit !== undefined) {
    hits = hits.slice(0, limit)
  }

  return {
    hits,
    totalHits,
    queryTimeMs: performance.now() - startTime,
  }
}

// ============================================================================
// Combined Query Router Types
// ============================================================================

import { buildIndexUrl, type SearchManifest } from '../db/iceberg/search-manifest'

/**
 * Range comparison operators.
 */
export type RangeOp = 'gt' | 'lt' | 'gte' | 'lte' | 'eq'

/**
 * Bloom filter query parameter.
 */
export interface BloomQueryParam {
  /** Field name to check */
  field: string
  /** Value to look up */
  value: string
}

/**
 * Range query parameter.
 */
export interface RangeQueryParam {
  /** Field name to check */
  field: string
  /** Comparison operator */
  op: RangeOp
  /** Value to compare against */
  value: string
}

/**
 * Vector query parameter.
 */
export interface VectorQueryParam {
  /** Field name for vector index */
  field: string
  /** Query vector */
  query: Float32Array
  /** Number of nearest neighbors to return */
  k: number
}

/**
 * Full-text query parameter.
 */
export interface TextQueryParam {
  /** Field name for inverted index */
  field: string
  /** Query string */
  query: string
}

/**
 * Combined search query with all supported query types.
 */
export interface SearchQuery {
  /** Bloom filter queries (AND semantics) */
  bloom?: BloomQueryParam[]
  /** Range queries (AND semantics) */
  range?: RangeQueryParam[]
  /** Vector similarity query */
  vector?: VectorQueryParam
  /** Full-text query */
  text?: TextQueryParam
}

/**
 * Centroid result with index and distance.
 */
export interface CentroidResult {
  /** Index of the centroid */
  index: number
  /** Distance from query vector */
  distance: number
}

/**
 * Combined search result.
 */
export interface SearchResult {
  /** Whether the entire result set is pruned (no matches possible) */
  pruned: boolean
  /** Block indices to scan (for range queries) */
  blocks?: number[]
  /** Top-k centroids (for vector queries) */
  centroids?: CentroidResult[]
  /** Matching document IDs (for text queries) */
  documents?: number[]
  /** Timing breakdown */
  timing: {
    /** Total execution time in milliseconds */
    total_ms: number
    /** Additional timing breakdowns by query type */
    [key: string]: number
  }
  /** Number of subrequests made */
  subrequests: number
}

/**
 * Options for search execution.
 */
export interface SearchExecutionOptions {
  /** Custom fetch function */
  fetch?: typeof globalThis.fetch
  /** Timeout in milliseconds */
  timeoutMs?: number
  /** Maximum number of subrequests (default: 5) */
  maxSubrequests?: number
}

// ============================================================================
// Combined Query Router Implementation
// ============================================================================

/** Maximum subrequests allowed per search */
const MAX_SUBREQUESTS = 5

/**
 * Parse a search query from URL parameters.
 *
 * Query format:
 * - bloom=field:value
 * - range=field:op:value (op: gt, lt, gte, lte, eq)
 * - vector=field:base64data:k=N
 * - text=field:query
 *
 * @param url - URL containing query parameters
 * @returns Parsed SearchQuery
 */
export function parseSearchQuery(url: URL): SearchQuery {
  const query: SearchQuery = {}

  // Parse bloom parameters
  const bloomParams = url.searchParams.getAll('bloom')
  if (bloomParams.length > 0) {
    query.bloom = bloomParams.map((param) => {
      const colonIndex = param.indexOf(':')
      if (colonIndex === -1) {
        return { field: param, value: '' }
      }
      return {
        field: param.slice(0, colonIndex),
        value: param.slice(colonIndex + 1),
      }
    })
  }

  // Parse range parameters
  const rangeParams = url.searchParams.getAll('range')
  if (rangeParams.length > 0) {
    query.range = rangeParams.map((param) => {
      const parts = param.split(':')
      if (parts.length < 3) {
        return { field: parts[0] ?? '', op: 'eq' as RangeOp, value: parts[1] ?? '' }
      }
      return {
        field: parts[0],
        op: parts[1] as RangeOp,
        value: parts.slice(2).join(':'), // Rejoin remaining parts for values with colons
      }
    })
  }

  // Parse vector parameter
  const vectorParam = url.searchParams.get('vector')
  if (vectorParam) {
    const parts = vectorParam.split(':')
    if (parts.length >= 3) {
      const field = parts[0]
      const base64Data = parts[1]
      const kMatch = parts[2].match(/k=(\d+)/)
      const k = kMatch ? parseInt(kMatch[1], 10) : 10

      // Decode base64 to Float32Array
      // First decode to a byte array, then create Float32Array
      const binaryString = Buffer.from(base64Data, 'base64')
      // Create a new ArrayBuffer with the exact size needed
      const arrayBuffer = new ArrayBuffer(binaryString.length)
      const uint8View = new Uint8Array(arrayBuffer)
      for (let i = 0; i < binaryString.length; i++) {
        uint8View[i] = binaryString[i]
      }
      const floatArray = new Float32Array(arrayBuffer)

      query.vector = { field, query: floatArray, k }
    }
  }

  // Parse text parameter
  const textParam = url.searchParams.get('text')
  if (textParam) {
    const colonIndex = textParam.indexOf(':')
    if (colonIndex !== -1) {
      query.text = {
        field: textParam.slice(0, colonIndex),
        query: textParam.slice(colonIndex + 1),
      }
    }
  }

  return query
}

/**
 * In-memory cache for search-related data.
 */
const searchCache = new Map<string, unknown>()

/**
 * Clear all search caches.
 */
export function clearSearchCache(): void {
  searchCache.clear()
  clearCentroidCache()
  clearInvertedIndexCache()
  clearBloomCache()
}

/**
 * Execute a combined search query against a manifest.
 *
 * @param manifest - Search manifest describing available indexes
 * @param query - Combined search query
 * @param ctx - Execution context
 * @param options - Execution options
 * @returns Combined search result
 */
export async function executeSearch(
  manifest: SearchManifest,
  query: SearchQuery,
  ctx: { waitUntil: (promise: Promise<unknown>) => void },
  options: SearchExecutionOptions = {}
): Promise<SearchResult> {
  const {
    fetch: customFetch = fetch,
    timeoutMs = 5000,
    maxSubrequests = MAX_SUBREQUESTS,
  } = options

  const startTime = performance.now()
  const timing: Record<string, number> = {}
  let subrequests = 0
  let budgetRemaining = maxSubrequests

  // Track if we should prune (any definitive NO from bloom = prune all)
  let pruned = false

  // Results from different query types
  let rangeBlocks: number[] | undefined
  let vectorCentroids: CentroidResult[] | undefined
  let textDocuments: number[] | undefined

  // Helper to check timeout
  const checkTimeout = () => {
    if (performance.now() - startTime > timeoutMs) {
      throw new Error('Search timeout')
    }
  }

  // Helper to track subrequests
  const trackSubrequest = () => {
    subrequests++
    budgetRemaining--
  }

  // Empty query - return immediately
  const hasQuery =
    (query.bloom && query.bloom.length > 0) ||
    (query.range && query.range.length > 0) ||
    query.vector ||
    query.text

  if (!hasQuery) {
    return {
      pruned: false,
      timing: { total_ms: performance.now() - startTime },
      subrequests: 0,
    }
  }

  // Validate vector query dimensions if present
  if (query.vector) {
    const vectorConfig = manifest.indexes.vector?.[query.vector.field]
    if (vectorConfig) {
      if (query.vector.query.length === 0) {
        throw new Error('Vector query is empty - dimension mismatch')
      }
      if (query.vector.query.length !== vectorConfig.dims) {
        throw new Error(
          `Vector dimension mismatch: expected ${vectorConfig.dims}, got ${query.vector.query.length}`
        )
      }
    }
  }

  try {
    // =========================================================================
    // Phase 1: Bloom filter checks (most selective, do first)
    // =========================================================================
    if (query.bloom && query.bloom.length > 0 && budgetRemaining > 0) {
      const bloomStartTime = performance.now()

      for (const bloomQuery of query.bloom) {
        if (budgetRemaining <= 0) break
        checkTimeout()

        const bloomConfig = manifest.indexes.bloom?.[bloomQuery.field]
        if (!bloomConfig) {
          // Field not in manifest - skip (conservative: don't prune)
          continue
        }

        const bloomUrl = buildIndexUrl(manifest, 'bloom', bloomQuery.field)
        if (!bloomUrl) continue

        try {
          trackSubrequest()

          // Note: fieldId is used to identify which bloom filter in a Puffin file
          // Since each field has its own Puffin file in this schema, use a default fieldId
          // The fieldId in Puffin files typically corresponds to Iceberg column IDs
          const result = await queryBloom(
            {
              url: bloomUrl,
              fieldId: 1, // Default column ID
              value: bloomQuery.value,
            },
            { fetch: customFetch }
          )

          if (result === BloomQueryResult.NO) {
            // Definitive NO - prune entire result
            pruned = true
            timing.bloom_ms = performance.now() - bloomStartTime
            break
          }
          // result === MAYBE means continue checking
        } catch {
          // On error, be conservative - don't prune
          continue
        }
      }

      timing.bloom_ms = performance.now() - bloomStartTime
    }

    // Short-circuit if already pruned
    if (pruned) {
      return {
        pruned: true,
        timing: {
          ...timing,
          total_ms: performance.now() - startTime,
        },
        subrequests,
      }
    }

    // =========================================================================
    // Phase 2: Range queries (determine blocks to scan)
    // =========================================================================
    if (query.range && query.range.length > 0 && budgetRemaining > 0) {
      const rangeStartTime = performance.now()
      const allBlocks = new Set<number>()
      let firstRangeQuery = true

      for (const rangeQuery of query.range) {
        if (budgetRemaining <= 0) break
        checkTimeout()

        const rangeConfig = manifest.indexes.range?.[rangeQuery.field]
        if (!rangeConfig) continue

        const rangeUrl = buildIndexUrl(manifest, 'range', rangeQuery.field)
        if (!rangeUrl) continue

        try {
          trackSubrequest()

          // Fetch marks file
          const response = await customFetch(rangeUrl)
          if (!response.ok) continue

          const buffer = await response.arrayBuffer()
          // Use int64 type for range queries (covers timestamps and integers)
          const blocks = parseMarksFile(new Uint8Array(buffer), 'int64')

          // Find matching blocks based on operator
          const matchingBlocks = findMatchingBlocks(blocks, rangeQuery.op, rangeQuery.value)

          if (firstRangeQuery) {
            for (const block of matchingBlocks) {
              allBlocks.add(block)
            }
            firstRangeQuery = false
          } else {
            // Intersect with previous results (AND semantics)
            for (const block of allBlocks) {
              if (!matchingBlocks.includes(block)) {
                allBlocks.delete(block)
              }
            }
          }

          // If no blocks match, we can prune
          if (allBlocks.size === 0 && !firstRangeQuery) {
            pruned = true
            break
          }
        } catch {
          // On error, be conservative
          continue
        }
      }

      if (allBlocks.size > 0) {
        rangeBlocks = Array.from(allBlocks).sort((a, b) => a - b)
      }

      timing.range_ms = performance.now() - rangeStartTime
    }

    // Short-circuit if pruned by range
    if (pruned) {
      return {
        pruned: true,
        timing: {
          ...timing,
          total_ms: performance.now() - startTime,
        },
        subrequests,
      }
    }

    // =========================================================================
    // Phase 3: Vector query (find nearest centroids)
    // =========================================================================
    if (query.vector && budgetRemaining > 0) {
      const vectorStartTime = performance.now()

      const vectorConfig = manifest.indexes.vector?.[query.vector.field]
      if (vectorConfig) {
        const vectorUrl = buildIndexUrl(manifest, 'vector', query.vector.field)
        if (vectorUrl) {
          try {
            trackSubrequest()

            const k = Math.min(query.vector.k, vectorConfig.count)

            // Convert manifest metric string to DistanceMetric enum
            const metricMap: Record<string, DistanceMetric> = {
              cosine: DistanceMetric.Cosine,
              euclidean: DistanceMetric.Euclidean,
              dot: DistanceMetric.DotProduct,
            }
            const metric = metricMap[vectorConfig.metric] ?? DistanceMetric.Cosine

            const topK = await queryVector({
              centroidsUrl: vectorUrl,
              numCentroids: vectorConfig.count,
              dims: vectorConfig.dims,
              query: query.vector.query,
              k,
              metric,
              fetch: customFetch,
            })

            vectorCentroids = topK.map((result) => ({
              index: result.index,
              distance: result.distance,
            }))
          } catch {
            // On error, leave centroids undefined
          }
        }
      }

      timing.vector_ms = performance.now() - vectorStartTime
    }

    // =========================================================================
    // Phase 4: Full-text query
    // =========================================================================
    if (query.text && budgetRemaining > 0) {
      const textStartTime = performance.now()

      const invertedConfig = manifest.indexes.inverted?.[query.text.field]
      if (invertedConfig) {
        const invertedUrl = buildIndexUrl(manifest, 'inverted', query.text.field)
        if (invertedUrl) {
          try {
            trackSubrequest()

            const result = await queryFullText(
              { url: invertedUrl, query: query.text.query },
              { fetch: customFetch }
            )

            textDocuments = result.hits

            // If no documents match, we could prune
            // But for combined queries we want to return the result
            if (result.hits.length === 0) {
              pruned = true
            }
          } catch {
            // On error, leave documents undefined
          }
        }
      }

      timing.text_ms = performance.now() - textStartTime
    }
  } catch (error) {
    // Handle timeout
    if (error instanceof Error && error.message.includes('timeout')) {
      return {
        pruned: false, // Conservative on timeout
        timing: {
          ...timing,
          total_ms: performance.now() - startTime,
        },
        subrequests,
      }
    }
    throw error
  }

  timing.total_ms = performance.now() - startTime

  return {
    pruned,
    blocks: rangeBlocks,
    centroids: vectorCentroids,
    documents: textDocuments,
    timing,
    subrequests,
  }
}

// ============================================================================
// Helper Functions for Combined Router
// ============================================================================

/**
 * Find blocks matching a range query.
 */
function findMatchingBlocks(blocks: BlockRange[], op: RangeOp, value: string): number[] {
  // Try to parse value as a number/timestamp
  let numValue: bigint
  try {
    // Check if it's a date string
    if (value.includes('-') && value.length >= 10) {
      numValue = BigInt(new Date(value).getTime())
    } else {
      numValue = BigInt(value)
    }
  } catch {
    // If parsing fails, return all blocks (conservative)
    return blocks.map((b) => b.blockIndex)
  }

  const matchingBlocks: number[] = []

  for (const block of blocks) {
    let matches = false

    // Handle different min/max types (bigint or number)
    const minVal = typeof block.min === 'bigint' ? block.min : BigInt(Math.floor(block.min as number))
    const maxVal = typeof block.max === 'bigint' ? block.max : BigInt(Math.floor(block.max as number))

    switch (op) {
      case 'gt':
        // Block matches if its max > value (some values could be > value)
        matches = maxVal > numValue
        break
      case 'gte':
        // Block matches if its max >= value
        matches = maxVal >= numValue
        break
      case 'lt':
        // Block matches if its min < value
        matches = minVal < numValue
        break
      case 'lte':
        // Block matches if its min <= value
        matches = minVal <= numValue
        break
      case 'eq':
        // Block matches if value is within [min, max]
        matches = minVal <= numValue && maxVal >= numValue
        break
    }

    if (matches) {
      matchingBlocks.push(block.blockIndex)
    }
  }

  return matchingBlocks
}
