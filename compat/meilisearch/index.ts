/**
 * @dotdo/meilisearch - Meilisearch SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for meilisearch backed by DO SQLite with FTS5.
 * This implementation matches the Meilisearch JavaScript API.
 *
 * @example
 * ```typescript
 * import { MeiliSearch } from '@dotdo/meilisearch'
 *
 * const client = new MeiliSearch({ host: 'http://localhost:7700' })
 *
 * // Create an index
 * const index = client.index('movies')
 *
 * // Add documents
 * await index.addDocuments([
 *   { id: 1, title: 'Inception', genre: 'Sci-Fi', year: 2010 },
 *   { id: 2, title: 'The Dark Knight', genre: 'Action', year: 2008 },
 *   { id: 3, title: 'Interstellar', genre: 'Sci-Fi', year: 2014 },
 * ])
 *
 * // Wait for indexing
 * await index.waitForTask(taskUid)
 *
 * // Search
 * const results = await index.search('knight')
 * console.log(results.hits)
 *
 * // Search with filters
 * const filtered = await index.search('', {
 *   filter: ['genre = "Sci-Fi"', 'year > 2010'],
 *   facets: ['genre'],
 *   sort: ['year:desc'],
 * })
 *
 * // Update settings
 * await index.updateSettings({
 *   searchableAttributes: ['title', 'genre'],
 *   filterableAttributes: ['genre', 'year'],
 *   sortableAttributes: ['year'],
 * })
 *
 * // Get document
 * const movie = await index.getDocument(1)
 *
 * // Delete documents
 * await index.deleteDocuments([1, 2])
 *
 * // Multi-index search
 * const multiResults = await client.multiSearch({
 *   queries: [
 *     { indexUid: 'movies', q: 'sci-fi' },
 *     { indexUid: 'books', q: 'sci-fi' },
 *   ]
 * })
 * ```
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
} from '../../search/compat/fulltext/meilisearch/types'

// Errors
export {
  MeiliSearchError,
  DocumentNotFoundError,
  IndexNotFoundError,
  TaskTimeoutError,
  InvalidFilterError,
} from '../../search/compat/fulltext/meilisearch/types'

// Core class and functions
export {
  MeiliSearch,
  clearAllIndices,
} from '../../search/compat/fulltext/meilisearch/meilisearch'

// Default export for compatibility
export { default } from '../../search/compat/fulltext/meilisearch/meilisearch'
