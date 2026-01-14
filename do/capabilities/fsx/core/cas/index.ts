/**
 * Content-Addressable Storage (CAS) Module
 *
 * Provides git-compatible content-addressable storage for fsx.do.
 * Objects are stored using their content hash as the identifier,
 * enabling deduplication and content integrity verification.
 *
 * @example
 * ```typescript
 * import { ContentAddressableFS, sha1, compress, decompress } from 'fsx.do/cas'
 *
 * const cas = new ContentAddressableFS(storage)
 * const hash = await cas.putObject(data, 'blob')
 * const obj = await cas.getObject(hash)
 * ```
 *
 * @packageDocumentation
 */

// Main CAS class
export {
  ContentAddressableFS,
  type CASObject,
  type CASStorage,
  type CASOptions,
  type ObjectType,
  type HasObjectBatchOptions,
  type HasObjectBatchProgress,
  type HasObjectBatchResult,
  // Batch delete types
  type BatchDeleteOptions,
  type BatchDeleteProgress,
  type BatchDeleteResult,
  // Garbage collection types
  type GCOptions,
  type GCProgress,
  type GCResult,
} from './content-addressable-fs.js'

// Reference counting
export {
  type RefCountStorage,
  InMemoryRefCountStorage,
  type DeduplicationStats,
  calculateStats,
} from './refcount.js'

// Hash utilities
export {
  // Core functions (backward compatible)
  sha1,
  sha256,
  sha384,
  sha512,
  bytesToHex,
  hexToBytes,
  // Unified API
  computeHash,
  HashAlgorithm,
  HASH_LENGTHS,
  // Streaming support
  createStreamingHasher,
  hashStream,
  hashBuffer,
  type StreamingHasher,
  type StreamingHashOptions,
  // Cache management
  configureHashCache,
  clearHashCache,
  getHashCacheStats,
  type HashCacheConfig,
  // Utilities
  isValidHash,
  detectAlgorithm,
} from './hash.js'

// Git object format
export {
  createGitObject,
  parseGitObject,
  createHeader,
  parseHeader,
  isGitObjectType,
  assertGitObjectType,
  GitObjectFormatError,
  VALID_TYPES,
  type GitObjectType,
  type GitObjectHeader,
  type ParsedGitObject,
} from './git-object.js'

// Compression
export {
  compress,
  decompress,
  compressWithMetrics,
  isZlibCompressed,
  CompressionError,
  DEFAULT_COMPRESSION_OPTIONS,
  type CompressionLevel,
  type CompressionStrategy,
  type CompressionOptions,
  type CompressionResult,
  type CompressionErrorCode,
} from './compression.js'

// Path mapping
export { hashToPath, pathToHash } from './path-mapping.js'

// Low-level functions
export {
  putObject,
  putObjectBatch,
  type ObjectStorage,
  type BatchPutItem,
  type BatchPutResult,
  type BatchProgress,
  type BatchPutOptions,
} from './put-object.js'
export { getObject, type GitObject, type GetObjectStorage } from './get-object.js'
export {
  hasObject,
  hasObjectBatch,
  batchResultsToMap,
  setStorage,
  getStorage,
  configureExistenceCache,
  getExistenceCache,
  getExistenceCacheStats,
  clearExistenceCache,
  invalidateCacheEntry,
  recordPutToCache,
  recordDeleteFromCache,
  type HasObjectStorage,
  type HasObjectBatchOptions as StandaloneHasObjectBatchOptions,
  type HasObjectBatchProgress as StandaloneHasObjectBatchProgress,
  type HasObjectBatchResult as StandaloneHasObjectBatchResult,
} from './has-object.js'

// LRU Cache for getObject optimization
export {
  LRUCache,
  createLRUCache,
  type LRUCacheOptions,
  type CacheStats,
} from './cache.js'

// Existence Cache for hasObject optimization
export {
  ExistenceCache,
  BloomFilter,
  createExistenceCache,
  type ExistenceCacheOptions,
  type ExistenceCacheStats,
} from './existence-cache.js'
