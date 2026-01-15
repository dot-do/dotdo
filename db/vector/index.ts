/**
 * VectorStore - Main Exports
 *
 * Embedding storage with Matryoshka compression and hybrid FTS+vector search.
 *
 * @module db/vector
 */

export { VectorStore } from './store'
export { HybridSearch, HybridVectorStore } from './hybrid'
export { isSearchResult, isVectorDocument } from './types'
export {
  BoundedLRUCache,
  binaryHashSizeCalculator,
  matryoshkaSizeCalculator,
  validateCacheConfig,
  DEFAULT_CACHE_CONFIG,
} from './cache'
export {
  MatryoshkaHandler,
  truncateEmbedding,
  batchTruncate,
  isValidMatryoshkaDimension,
  computeStorageSavings,
  truncateAndQuantize,
} from './matryoshka'

export type {
  CacheConfig,
  CacheStats,
  SingleCacheStats,
  CacheEntry,
  CacheMetrics,
} from './cache'

export type {
  VectorStoreOptions,
  InsertOptions,
  SearchOptions,
  HybridSearchOptions,
  ProgressiveSearchOptions,
  ProgressiveSearchStage,
  ProgressiveSearchResult,
  ProgressiveTiming,
  VectorDocument,
  StoredDocument,
  SearchResult,
  RRFRankInput,
  RRFOptions,
  CDCEvent,
  HybridQueryOptions,
  Subscription,
  // Tiering types
  StorageTier,
  TierConfig,
  TieredStorageOptions,
  TieredDocument,
  TierStats,
  // Progressive search optimizations
  AdaptiveProgressiveOptions,
  ProgressiveSearchStats,
  EnhancedProgressiveResult,
  // Index types
  IndexType,
  IndexConfig,
  // Filter types
  FilterValue,
  // MockDb types
  MockDb,
  MockDbStoredValue,
  PreparedStatement,
} from './types'

export type {
  StorageSavings,
  TruncateOptions,
  BatchTruncateOptions,
  MatryoshkaHandlerOptions,
} from './matryoshka'
