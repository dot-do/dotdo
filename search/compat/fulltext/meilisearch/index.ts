/**
 * @dotdo/meilisearch - Meilisearch SDK compat
 *
 * Drop-in replacement for meilisearch backed by DO SQLite with FTS5.
 * This in-memory implementation matches the Meilisearch JavaScript API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://www.meilisearch.com/docs/reference/api/overview
 */

// Types
export type {
  // Config
  Config,
  Health,
  Version,
  Stats,
  // Index
  IndexOptions,
  IndexObject,
  IndexStats,
  IndexesResults,
  IndexesQuery,
  // Documents
  Document,
  DocumentsQuery,
  DocumentQuery,
  DocumentsResults,
  DeleteDocumentsQuery,
  DocumentsOptions,
  // Search
  SearchParams,
  SearchResponse,
  Hit,
  MatchPosition,
  FacetDistribution,
  FacetStats,
  MultiSearchQuery,
  MultiSearchRequest,
  MultiSearchResponse,
  HybridSearch,
  // Settings
  Settings,
  TypoTolerance,
  Pagination,
  Faceting,
  // Tasks
  TaskStatus,
  TaskType,
  EnqueuedTask,
  Task,
  TaskDetails,
  TaskError,
  TasksQuery,
  TasksResults,
  WaitOptions,
  CancelTasksQuery,
  // Keys
  Key,
  KeyCreation,
  KeyUpdate,
  KeysQuery,
  KeysResults,
  // Swap
  SwapIndexesParams,
  // Interfaces
  Index,
  MeiliSearchClient,
} from './types'

// Errors
export {
  MeiliSearchError,
  DocumentNotFoundError,
  IndexNotFoundError,
  TaskTimeoutError,
  InvalidFilterError,
} from './types'

// Core class and functions
export {
  MeiliSearch,
  clearAllIndices,
} from './meilisearch'

// Default export for compatibility
export { default } from './meilisearch'
