/**
 * Search Manifest Format for Unified Search Snippet
 *
 * Defines the schema for describing searchable indexes stored alongside
 * Iceberg tables in R2/CDN. The manifest enables clients to discover
 * available indexes (bloom, range, vector, inverted) and construct
 * URLs for fetching them.
 *
 * @example
 * ```typescript
 * import { parseSearchManifest, buildIndexUrl } from './search-manifest'
 *
 * const manifest = parseSearchManifest(json)
 * const bloomUrl = buildIndexUrl(manifest, 'bloom', 'word')
 * // => "https://cdn.apis.do/wiktionary/v1/indexes/bloom/word.bloom"
 * ```
 *
 * @module db/iceberg/search-manifest
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Vector similarity metrics supported by vector indexes.
 */
export type VectorMetric = 'cosine' | 'euclidean' | 'dot'

/**
 * Bloom filter index configuration.
 *
 * Bloom filters provide probabilistic membership testing with configurable
 * false positive rates. Used for fast "definitely not present" checks.
 */
export interface BloomIndexConfig {
  /** Relative file path from base URL */
  file: string
  /** False positive rate (0 < fpr < 1) */
  fpr: number
  /** Number of items in the filter */
  items: number
}

/**
 * Range index configuration.
 *
 * Range indexes enable efficient range queries by storing sorted values
 * with block-level offsets. Supports prefix searches and range scans.
 */
export interface RangeIndexConfig {
  /** Relative file path from base URL */
  file: string
  /** Byte offset to start of index data */
  offset: number
  /** Number of blocks in the index */
  blocks: number
}

/**
 * Vector index configuration.
 *
 * Vector indexes enable approximate nearest neighbor (ANN) search
 * for semantic similarity queries.
 */
export interface VectorIndexConfig {
  /** Relative file path from base URL */
  file: string
  /** Vector dimensionality */
  dims: number
  /** Number of vectors in the index */
  count: number
  /** Distance metric for similarity */
  metric: VectorMetric
}

/**
 * Inverted index configuration.
 *
 * Inverted indexes map terms to document IDs for full-text search.
 * Supports term frequency and position data.
 */
export interface InvertedIndexConfig {
  /** Relative file path from base URL */
  file: string
  /** Number of unique terms in the index */
  terms: number
}

/**
 * Index configurations organized by type.
 *
 * Each index type maps field names to their configurations.
 * A field can have multiple index types for different query patterns.
 */
export interface IndexConfigs {
  /** Bloom filter indexes keyed by field name */
  bloom?: Record<string, BloomIndexConfig>
  /** Range indexes keyed by field name */
  range?: Record<string, RangeIndexConfig>
  /** Vector indexes keyed by field name */
  vector?: Record<string, VectorIndexConfig>
  /** Inverted indexes keyed by field name */
  inverted?: Record<string, InvertedIndexConfig>
}

/**
 * Data file configuration.
 *
 * Lists the data files (Parquet, Puffin) that contain the actual records.
 */
export interface DataConfig {
  /** List of data file paths (e.g., Parquet files) */
  files: string[]
  /** Optional Puffin statistics files */
  puffin?: string[]
}

/**
 * Query cache configuration.
 *
 * Optional pre-computed caches for common queries or embeddings.
 */
export interface CacheConfig {
  /** Pre-computed query embeddings for common searches */
  queries?: {
    /** File containing cached query embeddings */
    file: string
    /** Number of cached queries */
    count?: number
  }
}

/**
 * Search Manifest describing indexes for a searchable dataset.
 *
 * The manifest is a JSON file that describes:
 * - Available indexes (bloom, range, vector, inverted)
 * - Data files containing records
 * - Optional query caches
 *
 * @example
 * ```json
 * {
 *   "version": 1,
 *   "base": "cdn.apis.do/wiktionary/v1",
 *   "indexes": {
 *     "bloom": { "word": { "file": "indexes/bloom/word.bloom", "fpr": 0.01, "items": 500000 } },
 *     "vector": { "definition": { "file": "indexes/vector/definition.hnsw", "dims": 384, "count": 500000, "metric": "cosine" } }
 *   },
 *   "data": {
 *     "files": ["data/words-0001.parquet", "data/words-0002.parquet"]
 *   }
 * }
 * ```
 */
export interface SearchManifest {
  /** Manifest format version */
  version: number
  /** Base URL for all file paths (without protocol) */
  base: string
  /** Index configurations */
  indexes: IndexConfigs
  /** Data file configuration */
  data: DataConfig
  /** Optional cache configuration */
  cache?: CacheConfig
}

// ============================================================================
// Validation Errors
// ============================================================================

/**
 * Error thrown when manifest validation fails.
 */
export class SearchManifestValidationError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly value?: unknown
  ) {
    super(`SearchManifest validation failed at '${path}': ${message}`)
    this.name = 'SearchManifestValidationError'
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates that a value is a non-empty string.
 */
function validateString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SearchManifestValidationError('Expected non-empty string', path, value)
  }
  return value
}

/**
 * Validates that a value is a positive number.
 */
function validatePositiveNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || value <= 0 || !Number.isFinite(value)) {
    throw new SearchManifestValidationError('Expected positive number', path, value)
  }
  return value
}

/**
 * Validates that a value is a non-negative integer.
 */
function validateNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || value < 0 || !Number.isInteger(value)) {
    throw new SearchManifestValidationError('Expected non-negative integer', path, value)
  }
  return value
}

/**
 * Validates that a value is a positive integer.
 */
function validatePositiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || value <= 0 || !Number.isInteger(value)) {
    throw new SearchManifestValidationError('Expected positive integer', path, value)
  }
  return value
}

/**
 * Validates a false positive rate (0 < fpr < 1).
 */
function validateFpr(value: unknown, path: string): number {
  if (typeof value !== 'number' || value <= 0 || value >= 1) {
    throw new SearchManifestValidationError('Expected FPR between 0 and 1 (exclusive)', path, value)
  }
  return value
}

/**
 * Validates a vector metric.
 */
function validateVectorMetric(value: unknown, path: string): VectorMetric {
  if (value !== 'cosine' && value !== 'euclidean' && value !== 'dot') {
    throw new SearchManifestValidationError("Expected 'cosine', 'euclidean', or 'dot'", path, value)
  }
  return value
}

/**
 * Validates a bloom index configuration.
 */
function validateBloomIndex(value: unknown, path: string): BloomIndexConfig {
  if (typeof value !== 'object' || value === null) {
    throw new SearchManifestValidationError('Expected object', path, value)
  }
  const obj = value as Record<string, unknown>
  return {
    file: validateString(obj.file, `${path}.file`),
    fpr: validateFpr(obj.fpr, `${path}.fpr`),
    items: validatePositiveInteger(obj.items, `${path}.items`),
  }
}

/**
 * Validates a range index configuration.
 */
function validateRangeIndex(value: unknown, path: string): RangeIndexConfig {
  if (typeof value !== 'object' || value === null) {
    throw new SearchManifestValidationError('Expected object', path, value)
  }
  const obj = value as Record<string, unknown>
  return {
    file: validateString(obj.file, `${path}.file`),
    offset: validateNonNegativeInteger(obj.offset, `${path}.offset`),
    blocks: validatePositiveInteger(obj.blocks, `${path}.blocks`),
  }
}

/**
 * Validates a vector index configuration.
 */
function validateVectorIndex(value: unknown, path: string): VectorIndexConfig {
  if (typeof value !== 'object' || value === null) {
    throw new SearchManifestValidationError('Expected object', path, value)
  }
  const obj = value as Record<string, unknown>
  return {
    file: validateString(obj.file, `${path}.file`),
    dims: validatePositiveInteger(obj.dims, `${path}.dims`),
    count: validatePositiveInteger(obj.count, `${path}.count`),
    metric: validateVectorMetric(obj.metric, `${path}.metric`),
  }
}

/**
 * Validates an inverted index configuration.
 */
function validateInvertedIndex(value: unknown, path: string): InvertedIndexConfig {
  if (typeof value !== 'object' || value === null) {
    throw new SearchManifestValidationError('Expected object', path, value)
  }
  const obj = value as Record<string, unknown>
  return {
    file: validateString(obj.file, `${path}.file`),
    terms: validatePositiveInteger(obj.terms, `${path}.terms`),
  }
}

/**
 * Validates index configurations.
 */
function validateIndexes(value: unknown, path: string): IndexConfigs {
  if (typeof value !== 'object' || value === null) {
    throw new SearchManifestValidationError('Expected object', path, value)
  }
  const obj = value as Record<string, unknown>
  const result: IndexConfigs = {}

  // At least one index type must be present
  const hasBloom = obj.bloom !== undefined
  const hasRange = obj.range !== undefined
  const hasVector = obj.vector !== undefined
  const hasInverted = obj.inverted !== undefined

  if (!hasBloom && !hasRange && !hasVector && !hasInverted) {
    throw new SearchManifestValidationError('At least one index type must be defined', path, value)
  }

  if (hasBloom) {
    if (typeof obj.bloom !== 'object' || obj.bloom === null) {
      throw new SearchManifestValidationError('Expected object', `${path}.bloom`, obj.bloom)
    }
    result.bloom = {}
    for (const [key, val] of Object.entries(obj.bloom as Record<string, unknown>)) {
      result.bloom[key] = validateBloomIndex(val, `${path}.bloom.${key}`)
    }
  }

  if (hasRange) {
    if (typeof obj.range !== 'object' || obj.range === null) {
      throw new SearchManifestValidationError('Expected object', `${path}.range`, obj.range)
    }
    result.range = {}
    for (const [key, val] of Object.entries(obj.range as Record<string, unknown>)) {
      result.range[key] = validateRangeIndex(val, `${path}.range.${key}`)
    }
  }

  if (hasVector) {
    if (typeof obj.vector !== 'object' || obj.vector === null) {
      throw new SearchManifestValidationError('Expected object', `${path}.vector`, obj.vector)
    }
    result.vector = {}
    for (const [key, val] of Object.entries(obj.vector as Record<string, unknown>)) {
      result.vector[key] = validateVectorIndex(val, `${path}.vector.${key}`)
    }
  }

  if (hasInverted) {
    if (typeof obj.inverted !== 'object' || obj.inverted === null) {
      throw new SearchManifestValidationError('Expected object', `${path}.inverted`, obj.inverted)
    }
    result.inverted = {}
    for (const [key, val] of Object.entries(obj.inverted as Record<string, unknown>)) {
      result.inverted[key] = validateInvertedIndex(val, `${path}.inverted.${key}`)
    }
  }

  return result
}

/**
 * Validates data configuration.
 */
function validateData(value: unknown, path: string): DataConfig {
  if (typeof value !== 'object' || value === null) {
    throw new SearchManifestValidationError('Expected object', path, value)
  }
  const obj = value as Record<string, unknown>

  if (!Array.isArray(obj.files)) {
    throw new SearchManifestValidationError('Expected array', `${path}.files`, obj.files)
  }
  if (obj.files.length === 0) {
    throw new SearchManifestValidationError('Expected non-empty array', `${path}.files`, obj.files)
  }

  const files: string[] = []
  for (let i = 0; i < obj.files.length; i++) {
    files.push(validateString(obj.files[i], `${path}.files[${i}]`))
  }

  const result: DataConfig = { files }

  if (obj.puffin !== undefined) {
    if (!Array.isArray(obj.puffin)) {
      throw new SearchManifestValidationError('Expected array', `${path}.puffin`, obj.puffin)
    }
    result.puffin = []
    for (let i = 0; i < obj.puffin.length; i++) {
      result.puffin.push(validateString(obj.puffin[i], `${path}.puffin[${i}]`))
    }
  }

  return result
}

/**
 * Validates cache configuration.
 */
function validateCache(value: unknown, path: string): CacheConfig {
  if (typeof value !== 'object' || value === null) {
    throw new SearchManifestValidationError('Expected object', path, value)
  }
  const obj = value as Record<string, unknown>
  const result: CacheConfig = {}

  if (obj.queries !== undefined) {
    if (typeof obj.queries !== 'object' || obj.queries === null) {
      throw new SearchManifestValidationError('Expected object', `${path}.queries`, obj.queries)
    }
    const queries = obj.queries as Record<string, unknown>
    result.queries = {
      file: validateString(queries.file, `${path}.queries.file`),
    }
    if (queries.count !== undefined) {
      result.queries.count = validatePositiveInteger(queries.count, `${path}.queries.count`)
    }
  }

  return result
}

/**
 * Validates a search manifest object.
 *
 * @param value - The value to validate
 * @returns The validated SearchManifest
 * @throws SearchManifestValidationError if validation fails
 *
 * @example
 * ```typescript
 * const manifest = validateSearchManifest(JSON.parse(jsonString))
 * ```
 */
export function validateSearchManifest(value: unknown): SearchManifest {
  if (typeof value !== 'object' || value === null) {
    throw new SearchManifestValidationError('Expected object', '', value)
  }
  const obj = value as Record<string, unknown>

  // Validate version
  if (obj.version !== 1) {
    throw new SearchManifestValidationError('Expected version 1', 'version', obj.version)
  }

  // Validate base URL
  const base = validateString(obj.base, 'base')

  // Validate indexes
  const indexes = validateIndexes(obj.indexes, 'indexes')

  // Validate data
  const data = validateData(obj.data, 'data')

  const result: SearchManifest = {
    version: 1,
    base,
    indexes,
    data,
  }

  // Validate optional cache
  if (obj.cache !== undefined) {
    result.cache = validateCache(obj.cache, 'cache')
  }

  return result
}

/**
 * Parses a JSON string into a validated SearchManifest.
 *
 * @param json - JSON string to parse
 * @returns The validated SearchManifest
 * @throws SyntaxError if JSON is invalid
 * @throws SearchManifestValidationError if validation fails
 *
 * @example
 * ```typescript
 * const manifest = parseSearchManifest(jsonString)
 * ```
 */
export function parseSearchManifest(json: string): SearchManifest {
  const parsed = JSON.parse(json)
  return validateSearchManifest(parsed)
}

// ============================================================================
// URL Builder Helpers
// ============================================================================

/**
 * Index types supported by the manifest.
 */
export type IndexType = 'bloom' | 'range' | 'vector' | 'inverted'

/**
 * Builds a full URL for an index file.
 *
 * @param manifest - The search manifest
 * @param indexType - Type of index (bloom, range, vector, inverted)
 * @param field - Field name
 * @param protocol - URL protocol (default: 'https')
 * @returns Full URL to the index file, or null if not found
 *
 * @example
 * ```typescript
 * const url = buildIndexUrl(manifest, 'bloom', 'word')
 * // => "https://cdn.apis.do/wiktionary/v1/indexes/bloom/word.bloom"
 * ```
 */
export function buildIndexUrl(
  manifest: SearchManifest,
  indexType: IndexType,
  field: string,
  protocol: string = 'https'
): string | null {
  const indexGroup = manifest.indexes[indexType]
  if (!indexGroup) {
    return null
  }

  const config = indexGroup[field]
  if (!config) {
    return null
  }

  return `${protocol}://${manifest.base}/${config.file}`
}

/**
 * Builds a full URL for a data file.
 *
 * @param manifest - The search manifest
 * @param index - Index of the data file (0-based)
 * @param protocol - URL protocol (default: 'https')
 * @returns Full URL to the data file, or null if index is out of bounds
 *
 * @example
 * ```typescript
 * const url = buildDataUrl(manifest, 0)
 * // => "https://cdn.apis.do/wiktionary/v1/data/words-0001.parquet"
 * ```
 */
export function buildDataUrl(manifest: SearchManifest, index: number, protocol: string = 'https'): string | null {
  if (index < 0 || index >= manifest.data.files.length) {
    return null
  }
  return `${protocol}://${manifest.base}/${manifest.data.files[index]}`
}

/**
 * Builds URLs for all data files.
 *
 * @param manifest - The search manifest
 * @param protocol - URL protocol (default: 'https')
 * @returns Array of full URLs to all data files
 *
 * @example
 * ```typescript
 * const urls = buildAllDataUrls(manifest)
 * // => ["https://cdn.apis.do/wiktionary/v1/data/words-0001.parquet", ...]
 * ```
 */
export function buildAllDataUrls(manifest: SearchManifest, protocol: string = 'https'): string[] {
  return manifest.data.files.map((file) => `${protocol}://${manifest.base}/${file}`)
}

/**
 * Gets all available indexes from the manifest.
 *
 * @param manifest - The search manifest
 * @returns Object mapping index types to arrays of field names
 *
 * @example
 * ```typescript
 * const indexes = getAvailableIndexes(manifest)
 * // => { bloom: ['word'], vector: ['definition'], inverted: ['text'] }
 * ```
 */
export function getAvailableIndexes(manifest: SearchManifest): Record<IndexType, string[]> {
  return {
    bloom: manifest.indexes.bloom ? Object.keys(manifest.indexes.bloom) : [],
    range: manifest.indexes.range ? Object.keys(manifest.indexes.range) : [],
    vector: manifest.indexes.vector ? Object.keys(manifest.indexes.vector) : [],
    inverted: manifest.indexes.inverted ? Object.keys(manifest.indexes.inverted) : [],
  }
}

/**
 * Gets index configuration for a specific field.
 *
 * @param manifest - The search manifest
 * @param indexType - Type of index
 * @param field - Field name
 * @returns The index configuration, or null if not found
 *
 * @example
 * ```typescript
 * const config = getIndexConfig(manifest, 'bloom', 'word')
 * // => { file: 'indexes/bloom/word.bloom', fpr: 0.01, items: 500000 }
 * ```
 */
export function getIndexConfig(
  manifest: SearchManifest,
  indexType: 'bloom',
  field: string
): BloomIndexConfig | null
export function getIndexConfig(
  manifest: SearchManifest,
  indexType: 'range',
  field: string
): RangeIndexConfig | null
export function getIndexConfig(
  manifest: SearchManifest,
  indexType: 'vector',
  field: string
): VectorIndexConfig | null
export function getIndexConfig(
  manifest: SearchManifest,
  indexType: 'inverted',
  field: string
): InvertedIndexConfig | null
export function getIndexConfig(
  manifest: SearchManifest,
  indexType: IndexType,
  field: string
): BloomIndexConfig | RangeIndexConfig | VectorIndexConfig | InvertedIndexConfig | null {
  const indexGroup = manifest.indexes[indexType]
  if (!indexGroup) {
    return null
  }
  const config = indexGroup[field]
  return config ?? null
}

/**
 * Checks if a manifest has a specific index.
 *
 * @param manifest - The search manifest
 * @param indexType - Type of index
 * @param field - Field name
 * @returns true if the index exists, false otherwise
 *
 * @example
 * ```typescript
 * if (hasIndex(manifest, 'bloom', 'word')) {
 *   const url = buildIndexUrl(manifest, 'bloom', 'word')
 * }
 * ```
 */
export function hasIndex(manifest: SearchManifest, indexType: IndexType, field: string): boolean {
  const indexGroup = manifest.indexes[indexType]
  return indexGroup !== undefined && field in indexGroup
}
