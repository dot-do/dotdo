/**
 * VectorStore - Main Exports
 *
 * Embedding storage with Matryoshka compression and hybrid FTS+vector search.
 *
 * @module db/vector
 */

export { VectorStore } from './store'
export { HybridSearch, HybridVectorStore } from './hybrid'
export {
  MatryoshkaHandler,
  truncateEmbedding,
  batchTruncate,
  isValidMatryoshkaDimension,
  computeStorageSavings,
  truncateAndQuantize,
} from './matryoshka'

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
} from './types'

export type {
  StorageSavings,
  TruncateOptions,
  BatchTruncateOptions,
  MatryoshkaHandlerOptions,
} from './matryoshka'
