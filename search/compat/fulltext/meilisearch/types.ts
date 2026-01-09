/**
 * @dotdo/meilisearch types
 *
 * Meilisearch SDK-compatible type definitions for full-text search
 *
 * @see https://www.meilisearch.com/docs/reference/api/overview
 */

// ============================================================================
// CLIENT TYPES
// ============================================================================

/**
 * Client configuration options
 */
export interface Config {
  host: string
  apiKey?: string
  timeout?: number
  headers?: Record<string, string>
  /** DO namespace binding (for production) */
  doNamespace?: DurableObjectNamespace
}

/**
 * Health response
 */
export interface Health {
  status: 'available'
}

/**
 * Version info response
 */
export interface Version {
  commitSha: string
  commitDate: string
  pkgVersion: string
  indexCount?: number
}

/**
 * Stats response
 */
export interface Stats {
  databaseSize: number
  lastUpdate: string | null
  indexes: Record<string, IndexStats>
}

// ============================================================================
// INDEX TYPES
// ============================================================================

/**
 * Index creation options
 */
export interface IndexOptions {
  primaryKey?: string
}

/**
 * Raw index information
 */
export interface IndexObject {
  uid: string
  primaryKey: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Index stats
 */
export interface IndexStats {
  numberOfDocuments: number
  isIndexing: boolean
  fieldDistribution: Record<string, number>
}

/**
 * Paginated indexes response
 */
export interface IndexesResults {
  results: IndexObject[]
  offset: number
  limit: number
  total: number
}

/**
 * Index pagination options
 */
export interface IndexesQuery {
  offset?: number
  limit?: number
}

// ============================================================================
// DOCUMENT TYPES
// ============================================================================

/**
 * Document with any fields
 */
export type Document<T = Record<string, unknown>> = T

/**
 * Document query options
 */
export interface DocumentsQuery {
  offset?: number
  limit?: number
  fields?: string[]
  filter?: string | string[]
}

/**
 * Document options for getting a single document
 */
export interface DocumentQuery {
  fields?: string[]
}

/**
 * Documents response
 */
export interface DocumentsResults<T = Record<string, unknown>> {
  results: Document<T>[]
  offset: number
  limit: number
  total: number
}

/**
 * Delete documents options
 */
export interface DeleteDocumentsQuery {
  filter: string | string[]
}

/**
 * Batch size for document operations
 */
export interface DocumentsOptions {
  batchSize?: number
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/**
 * Search parameters
 */
export interface SearchParams {
  offset?: number
  limit?: number
  page?: number
  hitsPerPage?: number
  attributesToRetrieve?: string[]
  attributesToCrop?: string[]
  cropLength?: number
  cropMarker?: string
  attributesToHighlight?: string[]
  highlightPreTag?: string
  highlightPostTag?: string
  showMatchesPosition?: boolean
  showRankingScore?: boolean
  showRankingScoreDetails?: boolean
  filter?: string | string[] | string[][]
  sort?: string[]
  facets?: string[]
  matchingStrategy?: 'all' | 'last' | 'frequency'
  attributesToSearchOn?: string[]
  hybrid?: HybridSearch
  vector?: number[]
  distinct?: string
}

/**
 * Hybrid search options
 */
export interface HybridSearch {
  semanticRatio?: number
  embedder?: string
}

/**
 * Search hit with formatting
 */
export interface Hit<T = Record<string, unknown>> extends Document<T> {
  _formatted?: Record<string, unknown>
  _matchesPosition?: Record<string, MatchPosition[]>
  _rankingScore?: number
  _rankingScoreDetails?: Record<string, unknown>
}

/**
 * Match position in text
 */
export interface MatchPosition {
  start: number
  length: number
}

/**
 * Facet distribution
 */
export interface FacetDistribution {
  [facetName: string]: {
    [facetValue: string]: number
  }
}

/**
 * Facet stats
 */
export interface FacetStats {
  [facetName: string]: {
    min: number
    max: number
  }
}

/**
 * Search response
 */
export interface SearchResponse<T = Record<string, unknown>> {
  hits: Hit<T>[]
  offset?: number
  limit?: number
  estimatedTotalHits?: number
  totalHits?: number
  totalPages?: number
  hitsPerPage?: number
  page?: number
  processingTimeMs: number
  query: string
  facetDistribution?: FacetDistribution
  facetStats?: FacetStats
}

/**
 * Multi-search query
 */
export interface MultiSearchQuery extends SearchParams {
  indexUid: string
  q?: string
}

/**
 * Multi-search request
 */
export interface MultiSearchRequest {
  queries: MultiSearchQuery[]
}

/**
 * Multi-search response
 */
export interface MultiSearchResponse<T = Record<string, unknown>> {
  results: SearchResponse<T>[]
}

// ============================================================================
// SETTINGS TYPES
// ============================================================================

/**
 * Typo tolerance settings
 */
export interface TypoTolerance {
  enabled?: boolean
  minWordSizeForTypos?: {
    oneTypo?: number
    twoTypos?: number
  }
  disableOnWords?: string[]
  disableOnAttributes?: string[]
}

/**
 * Pagination settings
 */
export interface Pagination {
  maxTotalHits?: number
}

/**
 * Faceting settings
 */
export interface Faceting {
  maxValuesPerFacet?: number
  sortFacetValuesBy?: Record<string, 'alpha' | 'count'>
}

/**
 * Index settings
 */
export interface Settings {
  searchableAttributes?: string[]
  displayedAttributes?: string[]
  filterableAttributes?: string[]
  sortableAttributes?: string[]
  rankingRules?: string[]
  stopWords?: string[]
  synonyms?: Record<string, string[]>
  distinctAttribute?: string | null
  typoTolerance?: TypoTolerance
  pagination?: Pagination
  faceting?: Faceting
  separatorTokens?: string[]
  nonSeparatorTokens?: string[]
  dictionary?: string[]
  proximityPrecision?: 'byWord' | 'byAttribute'
}

// ============================================================================
// TASK TYPES
// ============================================================================

/**
 * Task status
 */
export type TaskStatus = 'enqueued' | 'processing' | 'succeeded' | 'failed' | 'canceled'

/**
 * Task type
 */
export type TaskType =
  | 'indexCreation'
  | 'indexUpdate'
  | 'indexDeletion'
  | 'indexSwap'
  | 'documentAdditionOrUpdate'
  | 'documentDeletion'
  | 'settingsUpdate'
  | 'dumpCreation'
  | 'snapshotCreation'
  | 'taskCancelation'
  | 'taskDeletion'

/**
 * Enqueued task response (returned immediately after operation)
 */
export interface EnqueuedTask {
  taskUid: number
  indexUid: string | null
  status: 'enqueued'
  type: TaskType
  enqueuedAt: string
}

/**
 * Task details
 */
export interface TaskDetails {
  receivedDocuments?: number
  indexedDocuments?: number
  deletedDocuments?: number
  providedIds?: number
  canceledTasks?: number
  deletedTasks?: number
  originalFilter?: string
  swaps?: Array<{ indexes: [string, string] }>
}

/**
 * Task error
 */
export interface TaskError {
  message: string
  code: string
  type: string
  link: string
}

/**
 * Full task information
 */
export interface Task {
  uid: number
  indexUid: string | null
  status: TaskStatus
  type: TaskType
  details?: TaskDetails
  error?: TaskError
  canceledBy?: number
  duration?: string
  enqueuedAt: string
  startedAt?: string
  finishedAt?: string
}

/**
 * Tasks query options
 */
export interface TasksQuery {
  limit?: number
  from?: number
  uids?: number[]
  statuses?: TaskStatus[]
  types?: TaskType[]
  indexUids?: string[]
  canceledBy?: number[]
  beforeEnqueuedAt?: string
  afterEnqueuedAt?: string
  beforeStartedAt?: string
  afterStartedAt?: string
  beforeFinishedAt?: string
  afterFinishedAt?: string
}

/**
 * Tasks response
 */
export interface TasksResults {
  results: Task[]
  limit: number
  from: number | null
  next: number | null
  total: number
}

/**
 * Wait for task options
 */
export interface WaitOptions {
  timeOutMs?: number
  intervalMs?: number
}

/**
 * Cancel/delete tasks query
 */
export interface CancelTasksQuery {
  uids?: number[]
  statuses?: TaskStatus[]
  types?: TaskType[]
  indexUids?: string[]
  canceledBy?: number[]
  beforeEnqueuedAt?: string
  afterEnqueuedAt?: string
  beforeStartedAt?: string
  afterStartedAt?: string
  beforeFinishedAt?: string
  afterFinishedAt?: string
}

// ============================================================================
// KEYS TYPES
// ============================================================================

/**
 * API key
 */
export interface Key {
  uid: string
  key: string
  name: string | null
  description: string | null
  actions: string[]
  indexes: string[]
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Key creation options
 */
export interface KeyCreation {
  name?: string
  description?: string
  actions: string[]
  indexes: string[]
  expiresAt: string | null
}

/**
 * Key update options
 */
export interface KeyUpdate {
  name?: string
  description?: string
}

/**
 * Keys query options
 */
export interface KeysQuery {
  offset?: number
  limit?: number
}

/**
 * Keys response
 */
export interface KeysResults {
  results: Key[]
  offset: number
  limit: number
  total: number
}

// ============================================================================
// SWAP INDEXES TYPES
// ============================================================================

/**
 * Index swap pair
 */
export interface SwapIndexesParams {
  indexes: [string, string]
}

// ============================================================================
// INDEX INTERFACE
// ============================================================================

/**
 * Meilisearch Index interface
 */
export interface Index<T = Record<string, unknown>> {
  readonly uid: string
  primaryKey: string | null

  // Index info
  getRawInfo(): Promise<IndexObject>
  fetchInfo(): Promise<Index<T>>
  fetchPrimaryKey(): Promise<string | null>

  // Documents
  addDocuments(documents: Document<T>[], options?: DocumentsOptions): Promise<EnqueuedTask>
  addDocumentsInBatches(documents: Document<T>[], batchSize?: number, options?: DocumentsOptions): Promise<EnqueuedTask[]>
  updateDocuments(documents: Partial<Document<T>>[], options?: DocumentsOptions): Promise<EnqueuedTask>
  updateDocumentsInBatches(documents: Partial<Document<T>>[], batchSize?: number, options?: DocumentsOptions): Promise<EnqueuedTask[]>
  getDocument(documentId: string | number, options?: DocumentQuery): Promise<Document<T>>
  getDocuments(options?: DocumentsQuery): Promise<DocumentsResults<T>>
  deleteDocument(documentId: string | number): Promise<EnqueuedTask>
  deleteDocuments(documentsIds: (string | number)[] | DeleteDocumentsQuery): Promise<EnqueuedTask>
  deleteAllDocuments(): Promise<EnqueuedTask>

  // Search
  search(query?: string | null, options?: SearchParams): Promise<SearchResponse<T>>

  // Settings
  getSettings(): Promise<Settings>
  updateSettings(settings: Settings): Promise<EnqueuedTask>
  resetSettings(): Promise<EnqueuedTask>

  // Individual settings
  getSearchableAttributes(): Promise<string[]>
  updateSearchableAttributes(attributes: string[]): Promise<EnqueuedTask>
  resetSearchableAttributes(): Promise<EnqueuedTask>

  getDisplayedAttributes(): Promise<string[]>
  updateDisplayedAttributes(attributes: string[]): Promise<EnqueuedTask>
  resetDisplayedAttributes(): Promise<EnqueuedTask>

  getFilterableAttributes(): Promise<string[]>
  updateFilterableAttributes(attributes: string[]): Promise<EnqueuedTask>
  resetFilterableAttributes(): Promise<EnqueuedTask>

  getSortableAttributes(): Promise<string[]>
  updateSortableAttributes(attributes: string[]): Promise<EnqueuedTask>
  resetSortableAttributes(): Promise<EnqueuedTask>

  getRankingRules(): Promise<string[]>
  updateRankingRules(rules: string[]): Promise<EnqueuedTask>
  resetRankingRules(): Promise<EnqueuedTask>

  getStopWords(): Promise<string[]>
  updateStopWords(words: string[]): Promise<EnqueuedTask>
  resetStopWords(): Promise<EnqueuedTask>

  getSynonyms(): Promise<Record<string, string[]>>
  updateSynonyms(synonyms: Record<string, string[]>): Promise<EnqueuedTask>
  resetSynonyms(): Promise<EnqueuedTask>

  getDistinctAttribute(): Promise<string | null>
  updateDistinctAttribute(attribute: string): Promise<EnqueuedTask>
  resetDistinctAttribute(): Promise<EnqueuedTask>

  getTypoTolerance(): Promise<TypoTolerance>
  updateTypoTolerance(typoTolerance: TypoTolerance): Promise<EnqueuedTask>
  resetTypoTolerance(): Promise<EnqueuedTask>

  getPagination(): Promise<Pagination>
  updatePagination(pagination: Pagination): Promise<EnqueuedTask>
  resetPagination(): Promise<EnqueuedTask>

  getFaceting(): Promise<Faceting>
  updateFaceting(faceting: Faceting): Promise<EnqueuedTask>
  resetFaceting(): Promise<EnqueuedTask>

  // Stats
  getStats(): Promise<IndexStats>

  // Index operations
  delete(): Promise<EnqueuedTask>
  update(options: IndexOptions): Promise<EnqueuedTask>
}

// ============================================================================
// CLIENT INTERFACE
// ============================================================================

/**
 * Meilisearch Client interface
 */
export interface MeiliSearchClient {
  readonly config: Config

  // Health
  health(): Promise<Health>
  isHealthy(): Promise<boolean>
  getVersion(): Promise<Version>
  getStats(): Promise<Stats>

  // Index operations
  index<T = Record<string, unknown>>(indexUid: string): Index<T>
  getIndex<T = Record<string, unknown>>(indexUid: string): Promise<Index<T>>
  getIndexes(query?: IndexesQuery): Promise<IndexesResults>
  createIndex(indexUid: string, options?: IndexOptions): Promise<EnqueuedTask>
  updateIndex(indexUid: string, options: IndexOptions): Promise<EnqueuedTask>
  deleteIndex(indexUid: string): Promise<EnqueuedTask>
  swapIndexes(params: SwapIndexesParams[]): Promise<EnqueuedTask>

  // Tasks
  getTask(taskUid: number): Promise<Task>
  getTasks(query?: TasksQuery): Promise<TasksResults>
  waitForTask(taskUid: number, options?: WaitOptions): Promise<Task>
  waitForTasks(taskUids: number[], options?: WaitOptions): Promise<Task[]>
  cancelTasks(query: CancelTasksQuery): Promise<EnqueuedTask>
  deleteTasks(query: CancelTasksQuery): Promise<EnqueuedTask>

  // Keys
  getKeys(query?: KeysQuery): Promise<KeysResults>
  getKey(keyOrUid: string): Promise<Key>
  createKey(options: KeyCreation): Promise<Key>
  updateKey(keyOrUid: string, options: KeyUpdate): Promise<Key>
  deleteKey(keyOrUid: string): Promise<void>

  // Multi-search
  multiSearch<T = Record<string, unknown>>(request: MultiSearchRequest): Promise<MultiSearchResponse<T>>

  // Dumps
  createDump(): Promise<EnqueuedTask>

  // Snapshots
  createSnapshot(): Promise<EnqueuedTask>
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Meilisearch API error
 */
export class MeiliSearchError extends Error {
  code: string
  type: string
  link?: string
  httpStatus?: number

  constructor(message: string, code: string = 'unknown_error', type: string = 'invalid_request') {
    super(message)
    this.name = 'MeiliSearchError'
    this.code = code
    this.type = type
  }
}

/**
 * Document not found error
 */
export class DocumentNotFoundError extends MeiliSearchError {
  constructor(documentId: string | number) {
    super(`Document ${documentId} not found`, 'document_not_found', 'invalid_request')
    this.name = 'DocumentNotFoundError'
    this.httpStatus = 404
  }
}

/**
 * Index not found error
 */
export class IndexNotFoundError extends MeiliSearchError {
  constructor(indexUid: string) {
    super(`Index ${indexUid} not found`, 'index_not_found', 'invalid_request')
    this.name = 'IndexNotFoundError'
    this.httpStatus = 404
  }
}

/**
 * Task timeout error
 */
export class TaskTimeoutError extends MeiliSearchError {
  constructor(taskUid: number) {
    super(`Task ${taskUid} timed out`, 'task_timeout', 'timeout')
    this.name = 'TaskTimeoutError'
  }
}

/**
 * Invalid filter error
 */
export class InvalidFilterError extends MeiliSearchError {
  constructor(filter: string) {
    super(`Invalid filter: ${filter}`, 'invalid_filter', 'invalid_request')
    this.name = 'InvalidFilterError'
    this.httpStatus = 400
  }
}
