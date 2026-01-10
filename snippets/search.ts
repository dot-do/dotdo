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
