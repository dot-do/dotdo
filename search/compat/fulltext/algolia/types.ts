/**
 * @dotdo/algolia types
 *
 * Algolia SDK-compatible type definitions for full-text search
 *
 * @see https://www.algolia.com/doc/api-client/getting-started/install/javascript/
 */

// ============================================================================
// SEARCH HIT TYPES
// ============================================================================

/**
 * Highlight result for a field
 */
export interface HighlightResult {
  value: string
  matchLevel: 'none' | 'partial' | 'full'
  matchedWords: string[]
  fullyHighlighted?: boolean
}

/**
 * Snippet result for a field
 */
export interface SnippetResult {
  value: string
  matchLevel: 'none' | 'partial' | 'full'
}

/**
 * Ranking info for a hit
 */
export interface RankingInfo {
  nbTypos: number
  firstMatchedWord: number
  proximityDistance: number
  userScore: number
  geoDistance: number
  geoPrecision: number
  nbExactWords: number
  words: number
  filters: number
}

/**
 * Search hit with highlighting
 */
export interface Hit<T = Record<string, unknown>> {
  objectID: string
  _highlightResult?: Record<string, HighlightResult>
  _snippetResult?: Record<string, SnippetResult>
  _rankingInfo?: RankingInfo
  _distinctSeqID?: number
}

/**
 * Combined hit type (base object + hit metadata)
 */
export type SearchHit<T = Record<string, unknown>> = T & Hit<T>

// ============================================================================
// FACET TYPES
// ============================================================================

/**
 * Facet hit for searchForFacetValues
 */
export interface FacetHit {
  value: string
  highlighted: string
  count: number
}

/**
 * Facet stats
 */
export interface FacetStats {
  min: number
  max: number
  avg: number
  sum: number
}

/**
 * Facets response
 */
export interface Facets {
  [facetName: string]: {
    [facetValue: string]: number
  }
}

/**
 * Facet stats response
 */
export interface FacetsStats {
  [facetName: string]: FacetStats
}

// ============================================================================
// SEARCH REQUEST TYPES
// ============================================================================

/**
 * Search options/parameters
 */
export interface SearchOptions {
  // Query
  query?: string
  similarQuery?: string

  // Filtering
  filters?: string
  facetFilters?: string | string[] | string[][]
  optionalFilters?: string | string[] | string[][]
  numericFilters?: string | string[] | string[][]
  tagFilters?: string | string[] | string[][]
  sumOrFiltersScores?: boolean

  // Faceting
  facets?: string[]
  maxValuesPerFacet?: number
  facetingAfterDistinct?: boolean
  sortFacetValuesBy?: 'count' | 'alpha'

  // Highlighting
  attributesToHighlight?: string[]
  attributesToSnippet?: string[]
  highlightPreTag?: string
  highlightPostTag?: string
  snippetEllipsisText?: string
  restrictHighlightAndSnippetArrays?: boolean

  // Pagination
  page?: number
  hitsPerPage?: number
  offset?: number
  length?: number

  // Attributes
  attributesToRetrieve?: string[]
  restrictSearchableAttributes?: string[]

  // Ranking
  getRankingInfo?: boolean

  // Geo
  aroundLatLng?: string
  aroundLatLngViaIP?: boolean
  aroundRadius?: number | 'all'
  aroundPrecision?: number
  minimumAroundRadius?: number
  insideBoundingBox?: number[][] | string
  insidePolygon?: number[][] | string

  // Typo
  typoTolerance?: boolean | 'min' | 'strict'
  minWordSizefor1Typo?: number
  minWordSizefor2Typos?: number

  // Misc
  distinct?: boolean | number
  analytics?: boolean
  analyticsTags?: string[]
  synonyms?: boolean
  replaceSynonymsInHighlight?: boolean
  minProximity?: number
  responseFields?: string[]
  maxFacetHits?: number
  percentileComputation?: boolean
  clickAnalytics?: boolean
  enablePersonalization?: boolean
  personalizationImpact?: number
  userToken?: string
  enableRules?: boolean
  ruleContexts?: string[]
  enableABTest?: boolean
  advancedSyntax?: boolean
  advancedSyntaxFeatures?: string[]
  optionalWords?: string | string[]
  removeWordsIfNoResults?: 'none' | 'lastWords' | 'firstWords' | 'allOptional'
  disableExactOnAttributes?: string[]
  exactOnSingleWordQuery?: 'attribute' | 'none' | 'word'
  alternativesAsExact?: string[]
  queryLanguages?: string[]
  decompoundQuery?: boolean
  enableReRanking?: boolean
  reRankingApplyFilter?: string | string[]
}

/**
 * Browse options
 */
export interface BrowseOptions extends SearchOptions {
  cursor?: string
  batch?: (hits: SearchHit[]) => void
}

/**
 * Search for facet values options
 */
export interface SearchForFacetValuesOptions extends SearchOptions {
  facetQuery?: string
  maxFacetHits?: number
}

// ============================================================================
// SEARCH RESPONSE TYPES
// ============================================================================

/**
 * Search response
 */
export interface SearchResponse<T = Record<string, unknown>> {
  hits: SearchHit<T>[]
  nbHits: number
  page: number
  nbPages: number
  hitsPerPage: number
  exhaustiveNbHits: boolean
  exhaustiveFacetsCount?: boolean
  exhaustiveTypo?: boolean
  facets?: Facets
  facets_stats?: FacetsStats
  query: string
  params: string
  processingTimeMS: number
  queryID?: string
  index?: string
  serverUsed?: string
  indexUsed?: string
  parsedQuery?: string
  userData?: unknown[]
  appliedRules?: unknown[]
  message?: string
  queryAfterRemoval?: string
  aroundLatLng?: string
  automaticRadius?: string
  serverTimeMS?: number
  abTestID?: number
  abTestVariantID?: number
}

/**
 * Browse response
 */
export interface BrowseResponse<T = Record<string, unknown>> extends SearchResponse<T> {
  cursor?: string
}

/**
 * Search for facet values response
 */
export interface SearchForFacetValuesResponse {
  facetHits: FacetHit[]
  exhaustiveFacetsCount: boolean
  processingTimeMS: number
}

// ============================================================================
// OBJECT TYPES
// ============================================================================

/**
 * Base object type for Algolia records
 */
export interface AlgoliaObject {
  objectID: string
  [key: string]: unknown
}

/**
 * Save object response
 */
export interface SaveObjectResponse {
  objectID: string
  taskID: number
  createdAt?: string
}

/**
 * Save objects response
 */
export interface SaveObjectsResponse {
  objectIDs: string[]
  taskID: number
}

/**
 * Delete object response
 */
export interface DeleteObjectResponse {
  objectID: string
  taskID: number
}

/**
 * Delete objects response
 */
export interface DeleteObjectsResponse {
  objectIDs: string[]
  taskID: number
}

/**
 * Get object options
 */
export interface GetObjectOptions {
  attributesToRetrieve?: string[]
}

/**
 * Get objects options
 */
export interface GetObjectsOptions {
  attributesToRetrieve?: string[]
}

/**
 * Get objects response
 */
export interface GetObjectsResponse<T = Record<string, unknown>> {
  results: (T & { objectID: string })[]
}

/**
 * Partial update object options
 */
export interface PartialUpdateObjectOptions {
  createIfNotExists?: boolean
}

/**
 * Clear objects response
 */
export interface ClearObjectsResponse {
  taskID: number
}

// ============================================================================
// INDEX SETTINGS TYPES
// ============================================================================

/**
 * Index settings
 */
export interface Settings {
  // Attributes
  searchableAttributes?: string[]
  attributesForFaceting?: string[]
  unretrievableAttributes?: string[]
  attributesToRetrieve?: string[]

  // Ranking
  ranking?: string[]
  customRanking?: string[]
  relevancyStrictness?: number

  // Faceting
  maxValuesPerFacet?: number
  sortFacetValuesBy?: 'count' | 'alpha'

  // Highlighting/Snippeting
  attributesToHighlight?: string[]
  attributesToSnippet?: string[]
  highlightPreTag?: string
  highlightPostTag?: string
  snippetEllipsisText?: string
  restrictHighlightAndSnippetArrays?: boolean

  // Pagination
  hitsPerPage?: number
  paginationLimitedTo?: number

  // Typos
  minWordSizefor1Typo?: number
  minWordSizefor2Typos?: number
  typoTolerance?: boolean | 'min' | 'strict'
  allowTyposOnNumericTokens?: boolean
  disableTypoToleranceOnAttributes?: string[]
  disableTypoToleranceOnWords?: string[]
  separatorsToIndex?: string

  // Languages
  ignorePlurals?: boolean | string[]
  removeStopWords?: boolean | string[]
  camelCaseAttributes?: string[]
  decompoundedAttributes?: Record<string, string[]>
  keepDiacriticsOnCharacters?: string
  queryLanguages?: string[]
  indexLanguages?: string[]

  // Query rules
  enableRules?: boolean

  // Query strategy
  queryType?: 'prefixLast' | 'prefixAll' | 'prefixNone'
  removeWordsIfNoResults?: 'none' | 'lastWords' | 'firstWords' | 'allOptional'
  advancedSyntax?: boolean
  optionalWords?: string[]
  disablePrefixOnAttributes?: string[]
  disableExactOnAttributes?: string[]
  exactOnSingleWordQuery?: 'attribute' | 'none' | 'word'
  alternativesAsExact?: string[]
  advancedSyntaxFeatures?: string[]

  // Performance
  numericAttributesForFiltering?: string[]
  allowCompressionOfIntegerArray?: boolean

  // Distinct
  distinct?: boolean | number
  attributeForDistinct?: string

  // Replicas
  replicas?: string[]

  // Personalization
  enablePersonalization?: boolean

  // Advanced
  userData?: unknown
  responseFields?: string[]
  maxFacetHits?: number
  attributeCriteriaComputedByMinProximity?: boolean
  renderingContent?: unknown
}

/**
 * Set settings options
 */
export interface SetSettingsOptions {
  forwardToReplicas?: boolean
}

/**
 * Get settings response
 */
export interface GetSettingsResponse extends Settings {
  primary?: string
}

// ============================================================================
// INDEX MANAGEMENT TYPES
// ============================================================================

/**
 * List indices response item
 */
export interface IndexInfo {
  name: string
  createdAt: string
  updatedAt: string
  entries: number
  dataSize: number
  fileSize: number
  lastBuildTimeS: number
  numberOfPendingTasks: number
  pendingTask: boolean
  primary?: string
  replicas?: string[]
}

/**
 * List indices response
 */
export interface ListIndicesResponse {
  items: IndexInfo[]
  nbPages: number
}

/**
 * Copy/move index options
 */
export interface CopyIndexOptions {
  scope?: ('settings' | 'synonyms' | 'rules')[]
}

/**
 * Copy/move index response
 */
export interface CopyMoveIndexResponse {
  taskID: number
  updatedAt: string
}

/**
 * Task response
 */
export interface TaskResponse {
  taskID: number
  status: 'published' | 'notPublished'
}

// ============================================================================
// INDEX INTERFACE
// ============================================================================

/**
 * Algolia Index interface
 */
export interface SearchIndex {
  readonly indexName: string

  // Search
  search<T = Record<string, unknown>>(query: string, options?: SearchOptions): Promise<SearchResponse<T>>
  searchForFacetValues(facetName: string, facetQuery: string, options?: SearchForFacetValuesOptions): Promise<SearchForFacetValuesResponse>

  // Browse
  browse<T = Record<string, unknown>>(options?: BrowseOptions): Promise<BrowseResponse<T>>
  browseObjects<T = Record<string, unknown>>(options: BrowseOptions & { batch: (hits: SearchHit<T>[]) => void }): Promise<void>

  // Objects
  saveObject<T = Record<string, unknown>>(object: T & { objectID?: string }): Promise<SaveObjectResponse>
  saveObjects<T = Record<string, unknown>>(objects: (T & { objectID?: string })[], options?: { autoGenerateObjectIDIfNotExist?: boolean }): Promise<SaveObjectsResponse>
  getObject<T = Record<string, unknown>>(objectID: string, options?: GetObjectOptions): Promise<T & { objectID: string }>
  getObjects<T = Record<string, unknown>>(objectIDs: string[], options?: GetObjectsOptions): Promise<GetObjectsResponse<T>>
  partialUpdateObject<T = Record<string, unknown>>(object: Partial<T> & { objectID: string }, options?: PartialUpdateObjectOptions): Promise<SaveObjectResponse>
  partialUpdateObjects<T = Record<string, unknown>>(objects: (Partial<T> & { objectID: string })[], options?: PartialUpdateObjectOptions): Promise<SaveObjectsResponse>
  deleteObject(objectID: string): Promise<DeleteObjectResponse>
  deleteObjects(objectIDs: string[]): Promise<DeleteObjectsResponse>
  deleteBy(options: { filters?: string; facetFilters?: string | string[] | string[][] }): Promise<{ taskID: number }>
  clearObjects(): Promise<ClearObjectsResponse>

  // Settings
  setSettings(settings: Settings, options?: SetSettingsOptions): Promise<TaskResponse>
  getSettings(): Promise<GetSettingsResponse>

  // Synonyms
  saveSynonym(synonym: Synonym, options?: { forwardToReplicas?: boolean }): Promise<SaveSynonymResponse>
  saveSynonyms(synonyms: Synonym[], options?: { forwardToReplicas?: boolean; clearExistingSynonyms?: boolean }): Promise<SaveSynonymsResponse>
  getSynonym(objectID: string): Promise<Synonym>
  searchSynonyms(options?: SearchSynonymsOptions): Promise<SearchSynonymsResponse>
  deleteSynonym(objectID: string, options?: { forwardToReplicas?: boolean }): Promise<DeleteSynonymResponse>
  clearSynonyms(options?: { forwardToReplicas?: boolean }): Promise<ClearSynonymsResponse>

  // Rules
  saveRule(rule: Rule, options?: { forwardToReplicas?: boolean }): Promise<SaveRuleResponse>
  saveRules(rules: Rule[], options?: { forwardToReplicas?: boolean; clearExistingRules?: boolean }): Promise<SaveRulesResponse>
  getRule(objectID: string): Promise<Rule>
  searchRules(options?: SearchRulesOptions): Promise<SearchRulesResponse>
  deleteRule(objectID: string, options?: { forwardToReplicas?: boolean }): Promise<DeleteRuleResponse>
  clearRules(options?: { forwardToReplicas?: boolean }): Promise<ClearRulesResponse>

  // Tasks
  waitTask(taskID: number): Promise<TaskResponse>

  // Index operations
  exists(): Promise<boolean>
  delete(): Promise<{ taskID: number }>
}

// ============================================================================
// CLIENT INTERFACE
// ============================================================================

/**
 * Algolia client options
 */
export interface ClientOptions {
  /** Request timeout in ms */
  timeout?: number
  /** API hosts */
  hosts?: string[]
  /** Headers to send with requests */
  headers?: Record<string, string>
  /** DO namespace binding (for production) */
  doNamespace?: DurableObjectNamespace
}

/**
 * Multi-index search query
 */
export interface MultipleQueriesQuery {
  indexName: string
  query?: string
  params?: SearchOptions
  type?: 'default' | 'facet'
  facet?: string
}

/**
 * Multi-index search response
 */
export interface MultipleQueriesResponse<T = Record<string, unknown>> {
  results: SearchResponse<T>[]
}

/**
 * Algolia Search Client interface
 */
export interface SearchClient {
  readonly appId: string

  // Index operations
  initIndex(indexName: string): SearchIndex
  listIndices(): Promise<ListIndicesResponse>
  copyIndex(source: string, destination: string, options?: CopyIndexOptions): Promise<CopyMoveIndexResponse>
  moveIndex(source: string, destination: string): Promise<CopyMoveIndexResponse>

  // Multi-index search
  multipleQueries<T = Record<string, unknown>>(queries: MultipleQueriesQuery[], options?: { strategy?: 'none' | 'stopIfEnoughMatches' }): Promise<MultipleQueriesResponse<T>>

  // Get objects across indices
  multipleGetObjects<T = Record<string, unknown>>(requests: { indexName: string; objectID: string; attributesToRetrieve?: string[] }[]): Promise<{ results: (T & { objectID: string } | null)[] }>
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Algolia API error
 */
export class AlgoliaError extends Error {
  status?: number
  transporterStackTrace?: unknown[]

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AlgoliaError'
    this.status = status
  }
}

/**
 * Object not found error
 */
export class ObjectNotFoundError extends AlgoliaError {
  constructor(objectID: string) {
    super(`ObjectID ${objectID} does not exist`, 404)
    this.name = 'ObjectNotFoundError'
  }
}

/**
 * Index not found error
 */
export class IndexNotFoundError extends AlgoliaError {
  constructor(indexName: string) {
    super(`Index ${indexName} does not exist`, 404)
    this.name = 'IndexNotFoundError'
  }
}

/**
 * Invalid filter error
 */
export class InvalidFilterError extends AlgoliaError {
  constructor(filter: string) {
    super(`Invalid filter: ${filter}`, 400)
    this.name = 'InvalidFilterError'
  }
}

// ============================================================================
// SYNONYM TYPES
// ============================================================================

/**
 * Synonym type
 */
export type SynonymType = 'synonym' | 'oneWaySynonym' | 'altCorrection1' | 'altCorrection2' | 'placeholder'

/**
 * Synonym object
 */
export interface Synonym {
  objectID: string
  type: SynonymType
  /** For 'synonym' type: array of equivalent words */
  synonyms?: string[]
  /** For 'oneWaySynonym' type: the input word that triggers the synonyms */
  input?: string
  /** For 'placeholder' type: the placeholder token */
  placeholder?: string
  /** For 'placeholder' type: replacement words */
  replacements?: string[]
  /** For 'altCorrection' types: the word to correct */
  word?: string
  /** For 'altCorrection' types: corrections to suggest */
  corrections?: string[]
}

/**
 * Save synonym response
 */
export interface SaveSynonymResponse {
  objectID: string
  taskID: number
  updatedAt: string
}

/**
 * Save synonyms response
 */
export interface SaveSynonymsResponse {
  taskID: number
  updatedAt: string
}

/**
 * Search synonyms options
 */
export interface SearchSynonymsOptions {
  query?: string
  type?: SynonymType
  page?: number
  hitsPerPage?: number
}

/**
 * Search synonyms response
 */
export interface SearchSynonymsResponse {
  hits: Synonym[]
  nbHits: number
  page: number
  nbPages: number
}

/**
 * Delete synonym response
 */
export interface DeleteSynonymResponse {
  taskID: number
  deletedAt: string
}

/**
 * Clear synonyms response
 */
export interface ClearSynonymsResponse {
  taskID: number
  updatedAt: string
}

// ============================================================================
// RULE TYPES
// ============================================================================

/**
 * Rule condition
 */
export interface RuleCondition {
  /** Pattern to match against query */
  pattern?: string
  /** Match anchoring */
  anchoring?: 'is' | 'startsWith' | 'endsWith' | 'contains'
  /** Context triggering the rule */
  context?: string
  /** Filters triggering the rule */
  filters?: string
  /** Alternative patterns for A/B testing */
  alternatives?: {
    typos?: boolean
  }
}

/**
 * Rule consequence - modifications to apply when rule triggers
 */
export interface RuleConsequence {
  /** Query modification parameters */
  params?: {
    /** Query to replace the original */
    query?: string | { edits?: { type: 'remove' | 'replace'; delete?: string; insert?: string }[] }
    /** Automatic facet filters */
    automaticFacetFilters?: Array<{ facet: string; disjunctive?: boolean; score?: number }>
    /** Automatic optional facet filters */
    automaticOptionalFacetFilters?: Array<{ facet: string; disjunctive?: boolean; score?: number }>
    /** Filters to add */
    filters?: string
    /** Optional filters to add */
    optionalFilters?: string | string[]
    /** Numeric filters to add */
    numericFilters?: string | string[]
    /** Tag filters to add */
    tagFilters?: string | string[]
    /** Facet filters to add */
    facetFilters?: string | string[] | string[][]
  }
  /** Promote specific objects */
  promote?: Array<{ objectID: string; position: number } | { objectIDs: string[]; position: number }>
  /** Filter out specific objects */
  filterPromotes?: boolean
  /** Hide specific objects */
  hide?: Array<{ objectID: string }>
  /** User data to return */
  userData?: unknown
}

/**
 * Rule object
 */
export interface Rule {
  objectID: string
  /** Conditions that trigger this rule (AND between multiple conditions) */
  conditions?: RuleCondition[]
  /** Single condition (legacy) */
  condition?: RuleCondition
  /** Modifications to apply when rule triggers */
  consequence: RuleConsequence
  /** Description for the rule */
  description?: string
  /** Is the rule enabled */
  enabled?: boolean
  /** Time ranges when rule is active */
  validity?: Array<{ from: number; until: number }>
}

/**
 * Save rule response
 */
export interface SaveRuleResponse {
  objectID: string
  taskID: number
  updatedAt: string
}

/**
 * Save rules response
 */
export interface SaveRulesResponse {
  taskID: number
  updatedAt: string
}

/**
 * Search rules options
 */
export interface SearchRulesOptions {
  query?: string
  /** Filter by anchor */
  anchoring?: RuleCondition['anchoring']
  /** Filter by context */
  context?: string
  /** Only return enabled rules */
  enabled?: boolean
  page?: number
  hitsPerPage?: number
}

/**
 * Search rules response
 */
export interface SearchRulesResponse {
  hits: Rule[]
  nbHits: number
  page: number
  nbPages: number
}

/**
 * Delete rule response
 */
export interface DeleteRuleResponse {
  taskID: number
  updatedAt: string
}

/**
 * Clear rules response
 */
export interface ClearRulesResponse {
  taskID: number
  updatedAt: string
}
