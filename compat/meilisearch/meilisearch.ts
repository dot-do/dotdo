/**
 * @dotdo/meilisearch - Meilisearch SDK compat
 *
 * Drop-in replacement for meilisearch backed by DO SQLite with FTS5.
 * This in-memory implementation matches the Meilisearch JavaScript API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://www.meilisearch.com/docs/reference/api/overview
 */

import type {
  Config,
  Health,
  Version,
  Stats,
  IndexOptions,
  IndexObject,
  IndexStats,
  IndexesResults,
  IndexesQuery,
  Document,
  DocumentsQuery,
  DocumentQuery,
  DocumentsResults,
  DeleteDocumentsQuery,
  DocumentsOptions,
  SearchParams,
  SearchResponse,
  MultiSearchRequest,
  MultiSearchResponse,
  Settings,
  TypoTolerance,
  Pagination,
  Faceting,
  TaskStatus,
  TaskType,
  EnqueuedTask,
  Task,
  TasksQuery,
  TasksResults,
  WaitOptions,
  CancelTasksQuery,
  Key,
  KeyCreation,
  KeyUpdate,
  KeysQuery,
  KeysResults,
  SwapIndexesParams,
  Index as IndexInterface,
  MeiliSearchClient,
  FacetDistribution,
  FacetStats,
  Hit,
} from './types'

import {
  MeiliSearchError,
  DocumentNotFoundError,
  IndexNotFoundError,
  TaskTimeoutError,
} from './types'

// Re-export error types
export {
  MeiliSearchError,
  DocumentNotFoundError,
  IndexNotFoundError,
  TaskTimeoutError,
  InvalidFilterError,
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * Index storage structure
 */
interface IndexStorage {
  uid: string
  primaryKey: string | null
  documents: Map<string | number, Record<string, unknown>>
  settings: Settings
  createdAt: Date
  updatedAt: Date
}

/**
 * Task storage structure
 */
interface StoredTask {
  uid: number
  indexUid: string | null
  status: TaskStatus
  type: TaskType
  enqueuedAt: string
  startedAt?: string
  finishedAt?: string
  error?: { message: string; code: string; type: string; link: string }
  details?: Record<string, unknown>
}

/**
 * Key storage structure
 */
interface StoredKey {
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

/** Global storage */
const globalStorage = new Map<string, IndexStorage>()
const taskStorage: StoredTask[] = []
const keyStorage: StoredKey[] = []
let taskCounter = 0
let keyCounter = 0

/**
 * Generate a new task ID
 */
function generateTaskUid(): number {
  return ++taskCounter
}

/**
 * Generate a unique key
 */
function generateKeyUid(): string {
  return `key-${++keyCounter}-${Date.now()}`
}

/**
 * Generate an API key string
 */
function generateApiKey(): string {
  return `ms-${Date.now()}-${Math.random().toString(36).slice(2, 18)}`
}

/**
 * Clear all indices (for tests)
 */
export function clearAllIndices(): void {
  globalStorage.clear()
  taskStorage.length = 0
  keyStorage.length = 0
  taskCounter = 0
  keyCounter = 0
}

/**
 * Get or create index storage
 */
function getIndexStorage(uid: string): IndexStorage | undefined {
  return globalStorage.get(uid)
}

/**
 * Create index storage
 */
function createIndexStorage(uid: string, primaryKey: string | null = null): IndexStorage {
  const storage: IndexStorage = {
    uid,
    primaryKey,
    documents: new Map(),
    settings: getDefaultSettings(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  globalStorage.set(uid, storage)
  return storage
}

/**
 * Get default settings
 */
function getDefaultSettings(): Settings {
  return {
    searchableAttributes: ['*'],
    displayedAttributes: ['*'],
    filterableAttributes: [],
    sortableAttributes: [],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
    stopWords: [],
    synonyms: {},
    distinctAttribute: null,
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
      disableOnWords: [],
      disableOnAttributes: [],
    },
    pagination: { maxTotalHits: 1000 },
    faceting: { maxValuesPerFacet: 100 },
  }
}

/**
 * Create an enqueued task
 */
function createEnqueuedTask(indexUid: string | null, type: TaskType): EnqueuedTask {
  const taskUid = generateTaskUid()
  const enqueuedAt = new Date().toISOString()

  const storedTask: StoredTask = {
    uid: taskUid,
    indexUid,
    status: 'enqueued',
    type,
    enqueuedAt,
  }
  taskStorage.push(storedTask)

  // Schedule task processing (synchronous for in-memory implementation)
  setTimeout(() => processTask(taskUid), 0)

  return {
    taskUid,
    indexUid,
    status: 'enqueued',
    type,
    enqueuedAt,
  }
}

/**
 * Process a task (mark as succeeded)
 */
function processTask(taskUid: number): void {
  const task = taskStorage.find((t) => t.uid === taskUid)
  if (task && task.status === 'enqueued') {
    task.status = 'processing'
    task.startedAt = new Date().toISOString()

    // Simulate processing
    task.status = 'succeeded'
    task.finishedAt = new Date().toISOString()
  }
}

// ============================================================================
// TOKENIZATION & FTS
// ============================================================================

/**
 * Simple tokenizer
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

/**
 * Extract searchable text from document
 */
function extractSearchableText(doc: Record<string, unknown>, searchableAttributes: string[]): string {
  const texts: string[] = []

  function extract(value: unknown, path: string = ''): void {
    if (value === null || value === undefined) return

    if (typeof value === 'string') {
      if (searchableAttributes.includes('*') || searchableAttributes.includes(path)) {
        texts.push(value)
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => extract(item, path))
    } else if (typeof value === 'object') {
      for (const [key, val] of Object.entries(value)) {
        extract(val, path ? `${path}.${key}` : key)
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      if (searchableAttributes.includes('*') || searchableAttributes.includes(path)) {
        texts.push(String(value))
      }
    }
  }

  extract(doc)
  return texts.join(' ')
}

/**
 * Get nested value from object
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Calculate Levenshtein distance for typo tolerance
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Check if query matches text with typo tolerance
 */
function matchesWithTypo(query: string, text: string, typoTolerance: TypoTolerance): boolean {
  if (!typoTolerance.enabled) {
    return text.toLowerCase().includes(query.toLowerCase())
  }

  const queryTokens = tokenize(query)
  const textTokens = tokenize(text)

  return queryTokens.every((queryToken) => {
    // Check disabled words
    if (typoTolerance.disableOnWords?.includes(queryToken)) {
      return textTokens.some((t) => t === queryToken)
    }

    // Determine allowed typos
    const minOneTypo = typoTolerance.minWordSizeForTypos?.oneTypo ?? 5
    const minTwoTypos = typoTolerance.minWordSizeForTypos?.twoTypos ?? 9
    let allowedTypos = 0
    if (queryToken.length >= minTwoTypos) allowedTypos = 2
    else if (queryToken.length >= minOneTypo) allowedTypos = 1

    return textTokens.some((textToken) => {
      if (textToken.includes(queryToken) || queryToken.includes(textToken)) return true
      const distance = levenshteinDistance(queryToken, textToken)
      return distance <= allowedTypos
    })
  })
}

/**
 * Calculate search score
 */
function calculateScore(doc: Record<string, unknown>, query: string, searchableAttributes: string[]): number {
  if (!query) return 1

  const searchText = extractSearchableText(doc, searchableAttributes).toLowerCase()
  const queryTokens = tokenize(query)

  let score = 0
  let matchedTokens = 0

  for (const token of queryTokens) {
    const regex = new RegExp(`\\b${escapeRegex(token)}`, 'i')
    if (regex.test(searchText)) {
      score += 2
      matchedTokens++
    } else if (searchText.includes(token)) {
      score += 1
      matchedTokens++
    }
  }

  if (queryTokens.length > 0) {
    score *= matchedTokens / queryTokens.length
  }

  return score
}

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============================================================================
// FILTER PARSING
// ============================================================================

/**
 * Parse Meilisearch filter expression
 */
function parseFilter(filter: string | string[] | string[][] | (string | string[])[] | undefined): (doc: Record<string, unknown>) => boolean {
  if (!filter) return () => true

  // Array format: AND of elements, nested arrays are OR
  if (Array.isArray(filter)) {
    if (filter.length === 0) return () => true

    // Each element can be a string (AND) or array of strings (OR)
    const andFilters = filter.map((element) => {
      if (Array.isArray(element)) {
        // OR group
        const orFilters = element.map((f) => parseFilterExpression(f))
        return (doc: Record<string, unknown>) => orFilters.some((fn) => fn(doc))
      } else {
        // Simple string condition
        return parseFilterExpression(element)
      }
    })
    return (doc) => andFilters.every((fn) => fn(doc))
  }

  return parseFilterExpression(filter)
}

/**
 * Parse a single filter expression
 */
function parseFilterExpression(filter: string): (doc: Record<string, unknown>) => boolean {
  filter = filter.trim()
  if (!filter) return () => true

  // Tokenize the filter
  const tokens = tokenizeFilterExpr(filter)
  let pos = 0

  function current(): string | undefined {
    return tokens[pos]
  }

  function consume(): string {
    return tokens[pos++]
  }

  function parseOr(): (doc: Record<string, unknown>) => boolean {
    let left = parseAnd()
    while (current()?.toUpperCase() === 'OR') {
      consume()
      const right = parseAnd()
      const prevLeft = left
      left = (doc) => prevLeft(doc) || right(doc)
    }
    return left
  }

  function parseAnd(): (doc: Record<string, unknown>) => boolean {
    let left = parseNot()
    while (current()?.toUpperCase() === 'AND') {
      consume()
      const right = parseNot()
      const prevLeft = left
      left = (doc) => prevLeft(doc) && right(doc)
    }
    return left
  }

  function parseNot(): (doc: Record<string, unknown>) => boolean {
    if (current()?.toUpperCase() === 'NOT') {
      consume()
      const inner = parsePrimary()
      return (doc) => !inner(doc)
    }
    return parsePrimary()
  }

  function parsePrimary(): (doc: Record<string, unknown>) => boolean {
    if (current() === '(') {
      consume() // (
      const inner = parseOr()
      if (current() === ')') consume() // )
      return inner
    }
    return parseCondition()
  }

  function parseCondition(): (doc: Record<string, unknown>) => boolean {
    const field = consume()
    if (!field) return () => true

    const op = current()

    // Handle special operators
    if (op?.toUpperCase() === 'EXISTS') {
      consume()
      return (doc) => getNestedValue(doc, field) !== undefined
    }

    if (op?.toUpperCase() === 'IS') {
      consume()
      const nullOrEmpty = consume()?.toUpperCase()
      if (nullOrEmpty === 'NULL' || nullOrEmpty === 'EMPTY') {
        return (doc) => {
          const val = getNestedValue(doc, field)
          return val === null || val === undefined
        }
      }
      return () => true
    }

    if (op?.toUpperCase() === 'IN') {
      consume()
      // Parse [val1, val2, ...]
      const values: (string | number)[] = []
      if (current() === '[') {
        consume()
        while (current() && current() !== ']') {
          const val = consume()
          if (val && val !== ',') {
            values.push(parseValue(val))
          }
        }
        if (current() === ']') consume()
      }
      return (doc) => {
        const docVal = getNestedValue(doc, field)
        return values.some((v) => String(v) === String(docVal))
      }
    }

    // Handle range: field min TO max
    if (current() && !['=', '!=', '>', '<', '>=', '<='].includes(current()!)) {
      const min = current()
      const toKeyword = tokens[pos + 1]?.toUpperCase()
      if (toKeyword === 'TO') {
        consume() // min
        consume() // TO
        const max = consume()
        const minVal = parseValue(min!)
        const maxVal = parseValue(max!)
        return (doc) => {
          const docVal = getNestedValue(doc, field)
          if (docVal === undefined || docVal === null) return false
          return Number(docVal) >= Number(minVal) && Number(docVal) <= Number(maxVal)
        }
      }
    }

    // Standard comparison
    const operator = consume()
    if (!operator) return () => true

    const valueToken = consume()
    if (!valueToken) return () => true

    const value = parseValue(valueToken)

    return (doc) => {
      const docVal = getNestedValue(doc, field)
      return compareValues(docVal, value, operator)
    }
  }

  function parseValue(str: string): string | number | boolean {
    // Remove quotes
    str = str.replace(/^["']|["']$/g, '')
    const num = Number(str)
    if (!isNaN(num) && str !== '') return num
    if (str === 'true') return true
    if (str === 'false') return false
    return str
  }

  function compareValues(docVal: unknown, filterVal: string | number | boolean, operator: string): boolean {
    if (docVal === undefined || docVal === null) {
      return operator === '!='
    }

    switch (operator) {
      case '=':
        return String(docVal) === String(filterVal)
      case '!=':
        return String(docVal) !== String(filterVal)
      case '>':
        return Number(docVal) > Number(filterVal)
      case '>=':
        return Number(docVal) >= Number(filterVal)
      case '<':
        return Number(docVal) < Number(filterVal)
      case '<=':
        return Number(docVal) <= Number(filterVal)
      default:
        return false
    }
  }

  return parseOr()
}

/**
 * Tokenize filter expression
 */
function tokenizeFilterExpr(filter: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false
  let quoteChar = ''

  for (let i = 0; i < filter.length; i++) {
    const char = filter[i]

    if (inQuotes) {
      current += char
      if (char === quoteChar) {
        inQuotes = false
        tokens.push(current)
        current = ''
      }
    } else if (char === '"' || char === "'") {
      if (current.trim()) tokens.push(current.trim())
      current = char
      inQuotes = true
      quoteChar = char
    } else if (char === '(' || char === ')' || char === '[' || char === ']' || char === ',') {
      if (current.trim()) tokens.push(current.trim())
      current = ''
      tokens.push(char)
    } else if (char === ' ' || char === '\t' || char === '\n') {
      if (current.trim()) tokens.push(current.trim())
      current = ''
    } else if (char === '=' || char === '!' || char === '>' || char === '<') {
      if (current.trim()) tokens.push(current.trim())
      current = ''
      // Handle multi-char operators
      if ((char === '!' || char === '>' || char === '<') && filter[i + 1] === '=') {
        tokens.push(char + '=')
        i++
      } else {
        tokens.push(char)
      }
    } else {
      current += char
    }
  }

  if (current.trim()) tokens.push(current.trim())

  return tokens
}

// ============================================================================
// INDEX IMPLEMENTATION
// ============================================================================

/**
 * Index implementation
 */
class IndexImpl<T = Record<string, unknown>> implements IndexInterface<T> {
  private _uid: string
  private _client: MeiliSearch
  private _primaryKey: string | null = null

  constructor(uid: string, client: MeiliSearch) {
    this._uid = uid
    this._client = client
  }

  get uid(): string {
    return this._uid
  }

  get primaryKey(): string | null {
    const storage = getIndexStorage(this._uid)
    return storage?.primaryKey ?? this._primaryKey
  }

  set primaryKey(value: string | null) {
    this._primaryKey = value
  }

  private getStorage(): IndexStorage {
    const storage = getIndexStorage(this._uid)
    if (!storage) {
      throw new IndexNotFoundError(this._uid)
    }
    return storage
  }

  async getRawInfo(): Promise<IndexObject> {
    const storage = this.getStorage()
    return {
      uid: storage.uid,
      primaryKey: storage.primaryKey,
      createdAt: storage.createdAt.toISOString(),
      updatedAt: storage.updatedAt.toISOString(),
    }
  }

  async fetchInfo(): Promise<IndexInterface<T>> {
    const storage = this.getStorage()
    this._primaryKey = storage.primaryKey
    return this
  }

  async fetchPrimaryKey(): Promise<string | null> {
    const storage = this.getStorage()
    return storage.primaryKey
  }

  async addDocuments(documents: Document<T>[], options?: DocumentsOptions): Promise<EnqueuedTask> {
    const storage = getIndexStorage(this._uid)
    if (!storage) {
      throw new IndexNotFoundError(this._uid)
    }

    // Auto-detect primary key from first document
    if (!storage.primaryKey && documents.length > 0) {
      const firstDoc = documents[0] as Record<string, unknown>
      if ('id' in firstDoc) storage.primaryKey = 'id'
      else if ('_id' in firstDoc) storage.primaryKey = '_id'
      else {
        // Use first field that looks like an ID
        for (const key of Object.keys(firstDoc)) {
          if (key.toLowerCase().includes('id')) {
            storage.primaryKey = key
            break
          }
        }
      }
    }

    const task = createEnqueuedTask(this._uid, 'documentAdditionOrUpdate')

    // Add documents immediately (in-memory)
    for (const doc of documents) {
      const docRecord = doc as Record<string, unknown>
      const id = storage.primaryKey ? docRecord[storage.primaryKey] : null
      if (id !== null && id !== undefined) {
        storage.documents.set(id as string | number, { ...docRecord })
      }
    }
    storage.updatedAt = new Date()

    return task
  }

  async addDocumentsInBatches(documents: Document<T>[], batchSize: number = 1000, options?: DocumentsOptions): Promise<EnqueuedTask[]> {
    const tasks: EnqueuedTask[] = []
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize)
      const task = await this.addDocuments(batch, options)
      tasks.push(task)
    }
    return tasks
  }

  async updateDocuments(documents: Partial<Document<T>>[], options?: DocumentsOptions): Promise<EnqueuedTask> {
    const storage = this.getStorage()
    const task = createEnqueuedTask(this._uid, 'documentAdditionOrUpdate')

    for (const doc of documents) {
      const docRecord = doc as Record<string, unknown>
      const id = storage.primaryKey ? docRecord[storage.primaryKey] : null
      if (id !== null && id !== undefined) {
        const existing = storage.documents.get(id as string | number) ?? {}
        storage.documents.set(id as string | number, { ...existing, ...docRecord })
      }
    }
    storage.updatedAt = new Date()

    return task
  }

  async updateDocumentsInBatches(documents: Partial<Document<T>>[], batchSize: number = 1000, options?: DocumentsOptions): Promise<EnqueuedTask[]> {
    const tasks: EnqueuedTask[] = []
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize)
      const task = await this.updateDocuments(batch, options)
      tasks.push(task)
    }
    return tasks
  }

  async getDocument(documentId: string | number, options?: DocumentQuery): Promise<Document<T>> {
    const storage = this.getStorage()
    const doc = storage.documents.get(documentId)

    if (!doc) {
      throw new DocumentNotFoundError(documentId)
    }

    if (options?.fields && options.fields.length > 0) {
      const filtered: Record<string, unknown> = {}
      for (const field of options.fields) {
        if (field in doc) {
          filtered[field] = doc[field]
        }
      }
      return filtered as Document<T>
    }

    return doc as Document<T>
  }

  async getDocuments(options?: DocumentsQuery): Promise<DocumentsResults<T>> {
    const storage = this.getStorage()
    let docs = Array.from(storage.documents.values())

    // Apply filter
    if (options?.filter) {
      const filterFn = parseFilter(options.filter)
      docs = docs.filter(filterFn)
    }

    const total = docs.length
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 20

    // Apply pagination
    docs = docs.slice(offset, offset + limit)

    // Apply field selection
    if (options?.fields && options.fields.length > 0) {
      docs = docs.map((doc) => {
        const filtered: Record<string, unknown> = {}
        for (const field of options.fields!) {
          if (field in doc) {
            filtered[field] = doc[field]
          }
        }
        return filtered
      })
    }

    return {
      results: docs as Document<T>[],
      offset,
      limit,
      total,
    }
  }

  async deleteDocument(documentId: string | number): Promise<EnqueuedTask> {
    const storage = this.getStorage()
    storage.documents.delete(documentId)
    storage.updatedAt = new Date()
    return createEnqueuedTask(this._uid, 'documentDeletion')
  }

  async deleteDocuments(documentsIds: (string | number)[] | DeleteDocumentsQuery): Promise<EnqueuedTask> {
    const storage = this.getStorage()

    if (Array.isArray(documentsIds)) {
      for (const id of documentsIds) {
        storage.documents.delete(id)
      }
    } else {
      // Delete by filter
      const filterFn = parseFilter(documentsIds.filter)
      const toDelete: (string | number)[] = []
      for (const [id, doc] of storage.documents) {
        if (filterFn(doc)) {
          toDelete.push(id)
        }
      }
      for (const id of toDelete) {
        storage.documents.delete(id)
      }
    }

    storage.updatedAt = new Date()
    return createEnqueuedTask(this._uid, 'documentDeletion')
  }

  async deleteAllDocuments(): Promise<EnqueuedTask> {
    const storage = this.getStorage()
    storage.documents.clear()
    storage.updatedAt = new Date()
    return createEnqueuedTask(this._uid, 'documentDeletion')
  }

  async search(query?: string | null, options?: SearchParams): Promise<SearchResponse<T>> {
    const startTime = performance.now()
    const storage = this.getStorage()
    const settings = storage.settings
    const searchQuery = query ?? ''

    let docs = Array.from(storage.documents.values())

    // Apply filter
    if (options?.filter) {
      const filterFn = parseFilter(options.filter)
      docs = docs.filter(filterFn)
    }

    // Calculate scores and filter by query
    const searchableAttrs = settings.searchableAttributes ?? ['*']
    const typoTolerance = settings.typoTolerance ?? { enabled: true }
    let scoredDocs: { doc: Record<string, unknown>; score: number }[]

    if (searchQuery.trim()) {
      // Check matching strategy
      const matchingStrategy = options?.matchingStrategy ?? 'last'

      scoredDocs = docs
        .filter((doc) => {
          const searchText = extractSearchableText(doc, searchableAttrs)
          if (matchingStrategy === 'all') {
            // All query words must match
            const queryTokens = tokenize(searchQuery)
            return queryTokens.every((token) =>
              matchesWithTypo(token, searchText, typoTolerance as TypoTolerance)
            )
          }
          return matchesWithTypo(searchQuery, searchText, typoTolerance as TypoTolerance)
        })
        .map((doc) => ({
          doc,
          score: calculateScore(doc, searchQuery, searchableAttrs),
        }))
        .sort((a, b) => b.score - a.score)
    } else {
      scoredDocs = docs.map((doc) => ({ doc, score: 1 }))
    }

    // Apply sorting
    if (options?.sort && options.sort.length > 0) {
      scoredDocs.sort((a, b) => {
        for (const sortRule of options.sort!) {
          const [attr, direction] = sortRule.split(':')
          const aVal = getNestedValue(a.doc, attr)
          const bVal = getNestedValue(b.doc, attr)

          let cmp = 0
          if (aVal === bVal) cmp = 0
          else if (aVal === undefined || aVal === null) cmp = 1
          else if (bVal === undefined || bVal === null) cmp = -1
          else if (typeof aVal === 'string' && typeof bVal === 'string') {
            cmp = aVal.localeCompare(bVal)
          } else {
            cmp = Number(aVal) - Number(bVal)
          }

          if (direction === 'desc') cmp = -cmp
          if (cmp !== 0) return cmp
        }
        return b.score - a.score
      })
    }

    const totalHits = scoredDocs.length

    // Handle pagination
    let offset = options?.offset ?? 0
    let limit = options?.limit ?? 20
    let page: number | undefined
    let hitsPerPage: number | undefined
    let totalPages: number | undefined

    if (options?.page !== undefined && options?.hitsPerPage !== undefined) {
      page = options.page
      hitsPerPage = options.hitsPerPage
      offset = (page - 1) * hitsPerPage
      limit = hitsPerPage
      totalPages = Math.ceil(totalHits / hitsPerPage)
    }

    const pagedDocs = scoredDocs.slice(offset, offset + limit)

    // Build hits with optional formatting
    const attributesToRetrieve = options?.attributesToRetrieve ?? ['*']
    const attributesToHighlight = options?.attributesToHighlight
    const highlightPreTag = options?.highlightPreTag ?? '<em>'
    const highlightPostTag = options?.highlightPostTag ?? '</em>'
    const attributesToCrop = options?.attributesToCrop
    const cropLength = options?.cropLength ?? 200
    const cropMarker = options?.cropMarker ?? '...'
    const showMatchesPosition = options?.showMatchesPosition
    const showRankingScore = options?.showRankingScore

    const hits: Hit<T>[] = pagedDocs.map(({ doc, score }) => {
      let result: Record<string, unknown> = { ...doc }

      // Filter attributes
      if (!attributesToRetrieve.includes('*')) {
        const filtered: Record<string, unknown> = {}
        for (const attr of attributesToRetrieve) {
          if (attr in doc) {
            filtered[attr] = doc[attr]
          }
        }
        result = filtered
      }

      // Add highlighting and/or cropping
      if ((attributesToHighlight || attributesToCrop) && searchQuery.trim()) {
        const formatted: Record<string, unknown> = {}

        // First, handle highlighting
        if (attributesToHighlight) {
          const attrsToHighlight = attributesToHighlight.includes('*')
            ? Object.keys(doc)
            : attributesToHighlight

          for (const attr of attrsToHighlight) {
            const value = doc[attr]
            if (typeof value === 'string') {
              let highlighted = value
              const queryTokens = tokenize(searchQuery)
              for (const token of queryTokens) {
                const regex = new RegExp(`(${escapeRegex(token)})`, 'gi')
                highlighted = highlighted.replace(regex, `${highlightPreTag}$1${highlightPostTag}`)
              }
              formatted[attr] = highlighted
            } else {
              formatted[attr] = value
            }
          }
        }

        // Then, handle cropping (can be independent of highlighting)
        if (attributesToCrop) {
          const attrsToCrop = attributesToCrop.includes('*')
            ? Object.keys(doc)
            : attributesToCrop

          for (const attr of attrsToCrop) {
            const value = formatted[attr] ?? doc[attr]
            if (typeof value === 'string' && value.length > cropLength) {
              // Find the best window around the match
              const queryTokens = tokenize(searchQuery)
              let bestStart = 0
              for (const token of queryTokens) {
                const idx = value.toLowerCase().indexOf(token.toLowerCase())
                if (idx !== -1) {
                  bestStart = Math.max(0, idx - Math.floor(cropLength / 2))
                  break
                }
              }
              const cropped = value.slice(bestStart, bestStart + cropLength)
              formatted[attr] = (bestStart > 0 ? cropMarker : '') + cropped + (bestStart + cropLength < value.length ? cropMarker : '')
            }
          }
        }

        result._formatted = formatted
      }

      // Add matches position
      if (showMatchesPosition && searchQuery.trim()) {
        const matchesPosition: Record<string, { start: number; length: number }[]> = {}
        const queryTokens = tokenize(searchQuery)

        for (const [attr, value] of Object.entries(doc)) {
          if (typeof value === 'string') {
            const positions: { start: number; length: number }[] = []
            const valueLower = value.toLowerCase()

            for (const token of queryTokens) {
              let idx = 0
              while ((idx = valueLower.indexOf(token, idx)) !== -1) {
                positions.push({ start: idx, length: token.length })
                idx++
              }
            }

            if (positions.length > 0) {
              matchesPosition[attr] = positions
            }
          }
        }

        if (Object.keys(matchesPosition).length > 0) {
          result._matchesPosition = matchesPosition
        }
      }

      // Add ranking score
      if (showRankingScore) {
        result._rankingScore = score
      }

      return result as Hit<T>
    })

    // Calculate facets
    let facetDistribution: FacetDistribution | undefined
    let facetStats: FacetStats | undefined

    if (options?.facets && options.facets.length > 0) {
      facetDistribution = {}
      facetStats = {}

      for (const facetName of options.facets) {
        const counts: Record<string, number> = {}
        let min = Infinity
        let max = -Infinity

        for (const { doc } of scoredDocs) {
          const value = getNestedValue(doc, facetName)
          if (value !== undefined && value !== null) {
            const key = String(value)
            counts[key] = (counts[key] ?? 0) + 1

            if (typeof value === 'number') {
              min = Math.min(min, value)
              max = Math.max(max, value)
            }
          }
        }

        facetDistribution[facetName] = counts

        if (min !== Infinity) {
          facetStats[facetName] = { min, max }
        }
      }
    }

    const processingTimeMs = Math.round(performance.now() - startTime)

    const response: SearchResponse<T> = {
      hits,
      processingTimeMs,
      query: searchQuery,
      estimatedTotalHits: totalHits,
    }

    if (page !== undefined) {
      response.page = page
      response.hitsPerPage = hitsPerPage
      response.totalPages = totalPages
      response.totalHits = totalHits
    } else {
      response.offset = offset
      response.limit = limit
    }

    if (facetDistribution) {
      response.facetDistribution = facetDistribution
    }
    if (facetStats && Object.keys(facetStats).length > 0) {
      response.facetStats = facetStats
    }

    return response
  }

  async getSettings(): Promise<Settings> {
    const storage = this.getStorage()
    return { ...storage.settings }
  }

  async updateSettings(settings: Settings): Promise<EnqueuedTask> {
    const storage = this.getStorage()
    storage.settings = { ...storage.settings, ...settings }
    storage.updatedAt = new Date()
    return createEnqueuedTask(this._uid, 'settingsUpdate')
  }

  async resetSettings(): Promise<EnqueuedTask> {
    const storage = this.getStorage()
    storage.settings = getDefaultSettings()
    storage.updatedAt = new Date()
    return createEnqueuedTask(this._uid, 'settingsUpdate')
  }

  // Individual settings methods
  async getSearchableAttributes(): Promise<string[]> {
    return (await this.getSettings()).searchableAttributes ?? ['*']
  }

  async updateSearchableAttributes(attributes: string[]): Promise<EnqueuedTask> {
    return this.updateSettings({ searchableAttributes: attributes })
  }

  async resetSearchableAttributes(): Promise<EnqueuedTask> {
    return this.updateSettings({ searchableAttributes: ['*'] })
  }

  async getDisplayedAttributes(): Promise<string[]> {
    return (await this.getSettings()).displayedAttributes ?? ['*']
  }

  async updateDisplayedAttributes(attributes: string[]): Promise<EnqueuedTask> {
    return this.updateSettings({ displayedAttributes: attributes })
  }

  async resetDisplayedAttributes(): Promise<EnqueuedTask> {
    return this.updateSettings({ displayedAttributes: ['*'] })
  }

  async getFilterableAttributes(): Promise<string[]> {
    return (await this.getSettings()).filterableAttributes ?? []
  }

  async updateFilterableAttributes(attributes: string[]): Promise<EnqueuedTask> {
    return this.updateSettings({ filterableAttributes: attributes })
  }

  async resetFilterableAttributes(): Promise<EnqueuedTask> {
    return this.updateSettings({ filterableAttributes: [] })
  }

  async getSortableAttributes(): Promise<string[]> {
    return (await this.getSettings()).sortableAttributes ?? []
  }

  async updateSortableAttributes(attributes: string[]): Promise<EnqueuedTask> {
    return this.updateSettings({ sortableAttributes: attributes })
  }

  async resetSortableAttributes(): Promise<EnqueuedTask> {
    return this.updateSettings({ sortableAttributes: [] })
  }

  async getRankingRules(): Promise<string[]> {
    return (await this.getSettings()).rankingRules ?? []
  }

  async updateRankingRules(rules: string[]): Promise<EnqueuedTask> {
    return this.updateSettings({ rankingRules: rules })
  }

  async resetRankingRules(): Promise<EnqueuedTask> {
    return this.updateSettings({ rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'] })
  }

  async getStopWords(): Promise<string[]> {
    return (await this.getSettings()).stopWords ?? []
  }

  async updateStopWords(words: string[]): Promise<EnqueuedTask> {
    return this.updateSettings({ stopWords: words })
  }

  async resetStopWords(): Promise<EnqueuedTask> {
    return this.updateSettings({ stopWords: [] })
  }

  async getSynonyms(): Promise<Record<string, string[]>> {
    return (await this.getSettings()).synonyms ?? {}
  }

  async updateSynonyms(synonyms: Record<string, string[]>): Promise<EnqueuedTask> {
    return this.updateSettings({ synonyms })
  }

  async resetSynonyms(): Promise<EnqueuedTask> {
    return this.updateSettings({ synonyms: {} })
  }

  async getDistinctAttribute(): Promise<string | null> {
    return (await this.getSettings()).distinctAttribute ?? null
  }

  async updateDistinctAttribute(attribute: string): Promise<EnqueuedTask> {
    return this.updateSettings({ distinctAttribute: attribute })
  }

  async resetDistinctAttribute(): Promise<EnqueuedTask> {
    return this.updateSettings({ distinctAttribute: null })
  }

  async getTypoTolerance(): Promise<TypoTolerance> {
    return (await this.getSettings()).typoTolerance ?? { enabled: true }
  }

  async updateTypoTolerance(typoTolerance: TypoTolerance): Promise<EnqueuedTask> {
    return this.updateSettings({ typoTolerance })
  }

  async resetTypoTolerance(): Promise<EnqueuedTask> {
    return this.updateSettings({
      typoTolerance: {
        enabled: true,
        minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
        disableOnWords: [],
        disableOnAttributes: [],
      },
    })
  }

  async getPagination(): Promise<Pagination> {
    return (await this.getSettings()).pagination ?? { maxTotalHits: 1000 }
  }

  async updatePagination(pagination: Pagination): Promise<EnqueuedTask> {
    return this.updateSettings({ pagination })
  }

  async resetPagination(): Promise<EnqueuedTask> {
    return this.updateSettings({ pagination: { maxTotalHits: 1000 } })
  }

  async getFaceting(): Promise<Faceting> {
    return (await this.getSettings()).faceting ?? { maxValuesPerFacet: 100 }
  }

  async updateFaceting(faceting: Faceting): Promise<EnqueuedTask> {
    return this.updateSettings({ faceting })
  }

  async resetFaceting(): Promise<EnqueuedTask> {
    return this.updateSettings({ faceting: { maxValuesPerFacet: 100 } })
  }

  async getStats(): Promise<IndexStats> {
    const storage = this.getStorage()
    const fieldDistribution: Record<string, number> = {}

    for (const doc of storage.documents.values()) {
      for (const key of Object.keys(doc)) {
        fieldDistribution[key] = (fieldDistribution[key] ?? 0) + 1
      }
    }

    return {
      numberOfDocuments: storage.documents.size,
      isIndexing: false,
      fieldDistribution,
    }
  }

  async delete(): Promise<EnqueuedTask> {
    globalStorage.delete(this._uid)
    return createEnqueuedTask(this._uid, 'indexDeletion')
  }

  async update(options: IndexOptions): Promise<EnqueuedTask> {
    const storage = this.getStorage()
    if (options.primaryKey) {
      storage.primaryKey = options.primaryKey
    }
    storage.updatedAt = new Date()
    return createEnqueuedTask(this._uid, 'indexUpdate')
  }
}

// ============================================================================
// CLIENT IMPLEMENTATION
// ============================================================================

/**
 * MeiliSearch client implementation
 */
export class MeiliSearch implements MeiliSearchClient {
  private _config: Config

  constructor(config: Config) {
    this._config = config
  }

  get config(): Config {
    return this._config
  }

  async health(): Promise<Health> {
    return { status: 'available' }
  }

  async isHealthy(): Promise<boolean> {
    return true
  }

  async getVersion(): Promise<Version> {
    return {
      commitSha: 'dotdo-compat',
      commitDate: new Date().toISOString(),
      pkgVersion: '1.0.0',
      indexCount: globalStorage.size,
    }
  }

  async getStats(): Promise<Stats> {
    const indexes: Record<string, IndexStats> = {}

    for (const [uid, storage] of globalStorage) {
      const fieldDistribution: Record<string, number> = {}
      for (const doc of storage.documents.values()) {
        for (const key of Object.keys(doc)) {
          fieldDistribution[key] = (fieldDistribution[key] ?? 0) + 1
        }
      }
      indexes[uid] = {
        numberOfDocuments: storage.documents.size,
        isIndexing: false,
        fieldDistribution,
      }
    }

    return {
      databaseSize: JSON.stringify(Array.from(globalStorage.values())).length,
      lastUpdate: new Date().toISOString(),
      indexes,
    }
  }

  index<T = Record<string, unknown>>(indexUid: string): IndexInterface<T> {
    return new IndexImpl<T>(indexUid, this)
  }

  async getIndex<T = Record<string, unknown>>(indexUid: string): Promise<IndexInterface<T>> {
    const storage = getIndexStorage(indexUid)
    if (!storage) {
      throw new IndexNotFoundError(indexUid)
    }

    const idx = new IndexImpl<T>(indexUid, this)
    idx.primaryKey = storage.primaryKey
    return idx
  }

  async getIndexes(query?: IndexesQuery): Promise<IndexesResults> {
    const offset = query?.offset ?? 0
    const limit = query?.limit ?? 20

    const allIndexes = Array.from(globalStorage.values())
    const pagedIndexes = allIndexes.slice(offset, offset + limit)

    return {
      results: pagedIndexes.map((storage) => ({
        uid: storage.uid,
        primaryKey: storage.primaryKey,
        createdAt: storage.createdAt.toISOString(),
        updatedAt: storage.updatedAt.toISOString(),
      })),
      offset,
      limit,
      total: allIndexes.length,
    }
  }

  async createIndex(indexUid: string, options?: IndexOptions): Promise<EnqueuedTask> {
    const existing = getIndexStorage(indexUid)
    const task = createEnqueuedTask(indexUid, 'indexCreation')

    if (!existing) {
      createIndexStorage(indexUid, options?.primaryKey ?? null)
    } else {
      // Mark task as failed
      const storedTask = taskStorage.find((t) => t.uid === task.taskUid)
      if (storedTask) {
        storedTask.status = 'failed'
        storedTask.error = {
          message: `Index ${indexUid} already exists`,
          code: 'index_already_exists',
          type: 'invalid_request',
          link: 'https://docs.meilisearch.com/errors#index_already_exists',
        }
      }
    }

    return task
  }

  async updateIndex(indexUid: string, options: IndexOptions): Promise<EnqueuedTask> {
    const storage = getIndexStorage(indexUid)
    if (!storage) {
      throw new IndexNotFoundError(indexUid)
    }

    if (options.primaryKey) {
      storage.primaryKey = options.primaryKey
    }
    storage.updatedAt = new Date()

    return createEnqueuedTask(indexUid, 'indexUpdate')
  }

  async deleteIndex(indexUid: string): Promise<EnqueuedTask> {
    globalStorage.delete(indexUid)
    return createEnqueuedTask(indexUid, 'indexDeletion')
  }

  async swapIndexes(params: SwapIndexesParams[]): Promise<EnqueuedTask> {
    for (const swap of params) {
      const [uid1, uid2] = swap.indexes
      const storage1 = globalStorage.get(uid1)
      const storage2 = globalStorage.get(uid2)

      if (storage1 && storage2) {
        // Swap the storages
        globalStorage.set(uid1, { ...storage2, uid: uid1 })
        globalStorage.set(uid2, { ...storage1, uid: uid2 })
      }
    }

    return createEnqueuedTask(null, 'indexSwap')
  }

  async getTask(taskUid: number): Promise<Task> {
    const task = taskStorage.find((t) => t.uid === taskUid)
    if (!task) {
      throw new MeiliSearchError(`Task ${taskUid} not found`, 'task_not_found')
    }

    return {
      uid: task.uid,
      indexUid: task.indexUid,
      status: task.status,
      type: task.type,
      enqueuedAt: task.enqueuedAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      error: task.error,
    }
  }

  async getTasks(query?: TasksQuery): Promise<TasksResults> {
    let tasks = [...taskStorage]

    // Apply filters
    if (query?.statuses && query.statuses.length > 0) {
      tasks = tasks.filter((t) => query.statuses!.includes(t.status))
    }
    if (query?.types && query.types.length > 0) {
      tasks = tasks.filter((t) => query.types!.includes(t.type))
    }
    if (query?.indexUids && query.indexUids.length > 0) {
      tasks = tasks.filter((t) => t.indexUid && query.indexUids!.includes(t.indexUid))
    }
    if (query?.uids && query.uids.length > 0) {
      tasks = tasks.filter((t) => query.uids!.includes(t.uid))
    }

    const from = query?.from ?? 0
    const limit = query?.limit ?? 20
    const pagedTasks = tasks.slice(from, from + limit)

    return {
      results: pagedTasks.map((t) => ({
        uid: t.uid,
        indexUid: t.indexUid,
        status: t.status,
        type: t.type,
        enqueuedAt: t.enqueuedAt,
        startedAt: t.startedAt,
        finishedAt: t.finishedAt,
        error: t.error,
      })),
      limit,
      from,
      next: from + limit < tasks.length ? from + limit : null,
      total: tasks.length,
    }
  }

  async waitForTask(taskUid: number, options?: WaitOptions): Promise<Task> {
    const timeOutMs = options?.timeOutMs ?? 5000
    const intervalMs = options?.intervalMs ?? 50
    const startTime = Date.now()

    while (Date.now() - startTime < timeOutMs) {
      const task = await this.getTask(taskUid)
      if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'canceled') {
        return task
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    throw new TaskTimeoutError(taskUid)
  }

  async waitForTasks(taskUids: number[], options?: WaitOptions): Promise<Task[]> {
    return Promise.all(taskUids.map((uid) => this.waitForTask(uid, options)))
  }

  async cancelTasks(query: CancelTasksQuery): Promise<EnqueuedTask> {
    // Mark matching tasks as canceled
    for (const task of taskStorage) {
      if (task.status === 'enqueued' || task.status === 'processing') {
        let matches = true
        if (query.statuses && !query.statuses.includes(task.status)) matches = false
        if (query.types && !query.types.includes(task.type)) matches = false
        if (query.indexUids && (!task.indexUid || !query.indexUids.includes(task.indexUid))) matches = false
        if (query.uids && !query.uids.includes(task.uid)) matches = false

        if (matches) {
          task.status = 'canceled'
          task.finishedAt = new Date().toISOString()
        }
      }
    }

    return createEnqueuedTask(null, 'taskCancelation')
  }

  async deleteTasks(query: CancelTasksQuery): Promise<EnqueuedTask> {
    // Remove matching tasks
    const toDelete: number[] = []
    for (const task of taskStorage) {
      let matches = true
      if (query.statuses && !query.statuses.includes(task.status)) matches = false
      if (query.types && !query.types.includes(task.type)) matches = false
      if (query.indexUids && (!task.indexUid || !query.indexUids.includes(task.indexUid))) matches = false
      if (query.uids && !query.uids.includes(task.uid)) matches = false

      if (matches) {
        toDelete.push(task.uid)
      }
    }

    for (const uid of toDelete) {
      const idx = taskStorage.findIndex((t) => t.uid === uid)
      if (idx !== -1) {
        taskStorage.splice(idx, 1)
      }
    }

    return createEnqueuedTask(null, 'taskDeletion')
  }

  async getKeys(query?: KeysQuery): Promise<KeysResults> {
    const offset = query?.offset ?? 0
    const limit = query?.limit ?? 20
    const pagedKeys = keyStorage.slice(offset, offset + limit)

    return {
      results: pagedKeys.map((k) => ({ ...k })),
      offset,
      limit,
      total: keyStorage.length,
    }
  }

  async getKey(keyOrUid: string): Promise<Key> {
    const key = keyStorage.find((k) => k.uid === keyOrUid || k.key === keyOrUid)
    if (!key) {
      throw new MeiliSearchError(`Key ${keyOrUid} not found`, 'api_key_not_found')
    }
    return { ...key }
  }

  async createKey(options: KeyCreation): Promise<Key> {
    const uid = generateKeyUid()
    const apiKey = generateApiKey()
    const now = new Date().toISOString()

    const key: StoredKey = {
      uid,
      key: apiKey,
      name: options.name ?? null,
      description: options.description ?? null,
      actions: options.actions,
      indexes: options.indexes,
      expiresAt: options.expiresAt,
      createdAt: now,
      updatedAt: now,
    }

    keyStorage.push(key)
    return { ...key }
  }

  async updateKey(keyOrUid: string, options: KeyUpdate): Promise<Key> {
    const key = keyStorage.find((k) => k.uid === keyOrUid || k.key === keyOrUid)
    if (!key) {
      throw new MeiliSearchError(`Key ${keyOrUid} not found`, 'api_key_not_found')
    }

    if (options.name !== undefined) key.name = options.name
    if (options.description !== undefined) key.description = options.description
    key.updatedAt = new Date().toISOString()

    return { ...key }
  }

  async deleteKey(keyOrUid: string): Promise<void> {
    const idx = keyStorage.findIndex((k) => k.uid === keyOrUid || k.key === keyOrUid)
    if (idx === -1) {
      throw new MeiliSearchError(`Key ${keyOrUid} not found`, 'api_key_not_found')
    }
    keyStorage.splice(idx, 1)
  }

  async multiSearch<T = Record<string, unknown>>(request: MultiSearchRequest): Promise<MultiSearchResponse<T>> {
    const results: SearchResponse<T>[] = []

    for (const query of request.queries) {
      const index = this.index<T>(query.indexUid)
      const result = await index.search(query.q ?? '', query)
      results.push(result)
    }

    return { results }
  }

  async createDump(): Promise<EnqueuedTask> {
    return createEnqueuedTask(null, 'dumpCreation')
  }

  async createSnapshot(): Promise<EnqueuedTask> {
    return createEnqueuedTask(null, 'snapshotCreation')
  }
}

/**
 * Default export for compatibility
 */
export default MeiliSearch
