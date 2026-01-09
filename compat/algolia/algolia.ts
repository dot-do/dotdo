/**
 * @dotdo/algolia - Algolia SDK compat
 *
 * Drop-in replacement for algoliasearch backed by DO SQLite with FTS5.
 * This in-memory implementation matches the Algolia JavaScript API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://www.algolia.com/doc/api-client/getting-started/install/javascript/
 */
import type {
  SearchClient,
  SearchIndex,
  ClientOptions,
  SearchOptions,
  SearchResponse,
  BrowseOptions,
  BrowseResponse,
  SearchForFacetValuesOptions,
  SearchForFacetValuesResponse,
  SaveObjectResponse,
  SaveObjectsResponse,
  DeleteObjectResponse,
  DeleteObjectsResponse,
  GetObjectOptions,
  GetObjectsOptions,
  GetObjectsResponse,
  PartialUpdateObjectOptions,
  ClearObjectsResponse,
  Settings,
  SetSettingsOptions,
  GetSettingsResponse,
  TaskResponse,
  ListIndicesResponse,
  IndexInfo,
  CopyIndexOptions,
  CopyMoveIndexResponse,
  MultipleQueriesQuery,
  MultipleQueriesResponse,
  AlgoliaObject,
  SearchHit,
  FacetHit,
  Facets,
  HighlightResult,
} from './types'
import {
  AlgoliaError,
  ObjectNotFoundError,
} from './types'

// Re-export error types
export {
  AlgoliaError,
  ObjectNotFoundError,
  IndexNotFoundError,
  InvalidFilterError,
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * Global in-memory storage for all indices
 * Structure: Map<indexName, { objects: Map<objectID, object>, settings: Settings }>
 */
interface IndexStorage {
  objects: Map<string, AlgoliaObject>
  settings: Settings
  createdAt: Date
  updatedAt: Date
}

const globalStorage = new Map<string, IndexStorage>()

/** Task counter for simulating async operations */
let taskCounter = 0

/**
 * Generate a new task ID
 */
function generateTaskID(): number {
  return ++taskCounter
}

/**
 * Generate a unique object ID
 */
function generateObjectID(): string {
  return `obj-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Get or create index storage
 */
function getIndexStorage(indexName: string): IndexStorage {
  let storage = globalStorage.get(indexName)
  if (!storage) {
    storage = {
      objects: new Map(),
      settings: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    globalStorage.set(indexName, storage)
  }
  return storage
}

// ============================================================================
// TOKENIZATION & FTS
// ============================================================================

/**
 * Simple tokenizer for FTS
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s*"]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

/**
 * Extract searchable text from an object based on searchableAttributes
 */
function extractSearchableText(obj: AlgoliaObject, searchableAttributes?: string[]): string {
  const texts: string[] = []

  function extract(value: unknown, path: string = ''): void {
    if (value === null || value === undefined) return

    if (typeof value === 'string') {
      // Check if this path should be included
      if (!searchableAttributes || searchableAttributes.length === 0) {
        texts.push(value)
      } else {
        // Check if path matches any searchable attribute
        const matches = searchableAttributes.some((attr) => {
          // Handle ordered() and unordered() modifiers
          const cleanAttr = attr.replace(/^(ordered|unordered)\(([^)]+)\)$/, '$2')
          return path === cleanAttr || path.startsWith(cleanAttr + '.')
        })
        if (matches) {
          texts.push(value)
        }
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => extract(item, path ? `${path}.${i}` : String(i)))
    } else if (typeof value === 'object') {
      for (const [key, val] of Object.entries(value)) {
        extract(val, path ? `${path}.${key}` : key)
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      // Include numeric and boolean values if searchable
      if (!searchableAttributes || searchableAttributes.length === 0) {
        texts.push(String(value))
      }
    }
  }

  // Don't include objectID in searchable text by default
  const { objectID, ...rest } = obj
  extract(rest)
  return texts.join(' ')
}

/**
 * Get nested value from object using dot notation
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
 * Set nested value in object using dot notation
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (current[part] === undefined || current[part] === null) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

// ============================================================================
// FILTER PARSING
// ============================================================================

/**
 * Parse Algolia filter string
 * Supports: field:value, field:>value, field:<value, field:>=value, field:<=value
 * AND, OR, NOT operators, parentheses
 */
function parseFilter(filter: string | undefined): (obj: AlgoliaObject) => boolean {
  if (!filter || filter.trim() === '') {
    return () => true
  }

  // Simple recursive descent parser
  const tokens = tokenizeFilter(filter)
  let pos = 0

  function current(): string | undefined {
    return tokens[pos]
  }

  function consume(): string {
    return tokens[pos++]
  }

  function match(expected: string): boolean {
    if (current() === expected) {
      consume()
      return true
    }
    return false
  }

  function parseExpression(): (obj: AlgoliaObject) => boolean {
    return parseOr()
  }

  function parseOr(): (obj: AlgoliaObject) => boolean {
    let left = parseAnd()
    while (current()?.toUpperCase() === 'OR') {
      consume()
      const right = parseAnd()
      const prevLeft = left
      left = (obj) => prevLeft(obj) || right(obj)
    }
    return left
  }

  function parseAnd(): (obj: AlgoliaObject) => boolean {
    let left = parseNot()
    while (current()?.toUpperCase() === 'AND') {
      consume()
      const right = parseNot()
      const prevLeft = left
      left = (obj) => prevLeft(obj) && right(obj)
    }
    return left
  }

  function parseNot(): (obj: AlgoliaObject) => boolean {
    if (current()?.toUpperCase() === 'NOT') {
      consume()
      const inner = parsePrimary()
      return (obj) => !inner(obj)
    }
    return parsePrimary()
  }

  function parsePrimary(): (obj: AlgoliaObject) => boolean {
    if (match('(')) {
      const inner = parseExpression()
      match(')')
      return inner
    }
    return parseCondition()
  }

  function parseCondition(): (obj: AlgoliaObject) => boolean {
    const token = consume()
    if (!token) return () => true

    // Check for numeric comparison without colon (e.g., "price<1000", "price>=500")
    const numericMatch = token.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)([<>]=?|!=|=)(.+)$/)
    if (numericMatch) {
      const [, field, operator, valueStr] = numericMatch
      const value = parseValue(valueStr)

      return (obj) => {
        const fieldValue = getNestedValue(obj, field)

        // Handle array fields
        if (Array.isArray(fieldValue)) {
          switch (operator) {
            case '=':
              return fieldValue.includes(value)
            case '!=':
              return !fieldValue.includes(value)
            default:
              return fieldValue.some((fv) => compareValues(fv, value, operator))
          }
        }

        return compareValues(fieldValue, value, operator)
      }
    }

    // Parse field:value or field:operator value
    const colonIdx = token.indexOf(':')
    if (colonIdx === -1) {
      // Tag filter (just a value)
      const tagValue = token.replace(/^["']|["']$/g, '')
      return (obj) => {
        const tags = obj._tags as string[] | undefined
        return tags?.includes(tagValue) ?? false
      }
    }

    const field = token.slice(0, colonIdx)
    let valueStr = token.slice(colonIdx + 1)

    // Handle operators
    let operator = '='
    if (valueStr.startsWith('>=')) {
      operator = '>='
      valueStr = valueStr.slice(2)
    } else if (valueStr.startsWith('<=')) {
      operator = '<='
      valueStr = valueStr.slice(2)
    } else if (valueStr.startsWith('>')) {
      operator = '>'
      valueStr = valueStr.slice(1)
    } else if (valueStr.startsWith('<')) {
      operator = '<'
      valueStr = valueStr.slice(1)
    } else if (valueStr.startsWith('!=') || valueStr.startsWith('-')) {
      operator = '!='
      valueStr = valueStr.startsWith('!=') ? valueStr.slice(2) : valueStr.slice(1)
    }

    // Parse value
    const value = parseValue(valueStr)

    return (obj) => {
      const fieldValue = getNestedValue(obj, field)

      // Handle array fields
      if (Array.isArray(fieldValue)) {
        switch (operator) {
          case '=':
            return fieldValue.includes(value)
          case '!=':
            return !fieldValue.includes(value)
          default:
            return fieldValue.some((fv) => compareValues(fv, value, operator))
        }
      }

      return compareValues(fieldValue, value, operator)
    }
  }

  function parseValue(str: string): string | number | boolean {
    // Remove quotes
    str = str.replace(/^["']|["']$/g, '')

    // Try to parse as number
    const num = Number(str)
    if (!isNaN(num) && str !== '') return num

    // Boolean
    if (str === 'true') return true
    if (str === 'false') return false

    return str
  }

  function compareValues(fieldValue: unknown, filterValue: string | number | boolean, operator: string): boolean {
    if (fieldValue === undefined || fieldValue === null) {
      return operator === '!='
    }

    switch (operator) {
      case '=':
        return fieldValue === filterValue || String(fieldValue) === String(filterValue)
      case '!=':
        return fieldValue !== filterValue && String(fieldValue) !== String(filterValue)
      case '>':
        return Number(fieldValue) > Number(filterValue)
      case '>=':
        return Number(fieldValue) >= Number(filterValue)
      case '<':
        return Number(fieldValue) < Number(filterValue)
      case '<=':
        return Number(fieldValue) <= Number(filterValue)
      default:
        return false
    }
  }

  return parseExpression()
}

/**
 * Tokenize filter string for parsing
 */
function tokenizeFilter(filter: string): string[] {
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
      }
    } else if (char === '"' || char === "'") {
      inQuotes = true
      quoteChar = char
      current += char
    } else if (char === '(' || char === ')') {
      if (current.trim()) {
        tokens.push(current.trim())
        current = ''
      }
      tokens.push(char)
    } else if (char === ' ' || char === '\t' || char === '\n') {
      if (current.trim()) {
        tokens.push(current.trim())
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current.trim()) {
    tokens.push(current.trim())
  }

  return tokens
}

/**
 * Parse facet filters array format
 */
function parseFacetFilters(
  facetFilters: string | string[] | string[][] | undefined
): (obj: AlgoliaObject) => boolean {
  if (!facetFilters) return () => true

  // Normalize to array of arrays (AND of ORs)
  let normalized: string[][]
  if (typeof facetFilters === 'string') {
    normalized = [[facetFilters]]
  } else if (Array.isArray(facetFilters) && facetFilters.length > 0) {
    if (typeof facetFilters[0] === 'string') {
      // Array of strings - AND together
      normalized = (facetFilters as string[]).map((f) => [f])
    } else {
      // Array of arrays - AND of ORs
      normalized = facetFilters as string[][]
    }
  } else {
    return () => true
  }

  return (obj) => {
    // All top-level arrays must match (AND)
    return normalized.every((orGroup) => {
      // At least one in the group must match (OR)
      return orGroup.some((filter) => {
        const [field, ...valueParts] = filter.split(':')
        const value = valueParts.join(':')
        const isNegation = field.startsWith('-')
        const actualField = isNegation ? field.slice(1) : field
        const fieldValue = getNestedValue(obj, actualField)

        if (Array.isArray(fieldValue)) {
          const matches = fieldValue.includes(value)
          return isNegation ? !matches : matches
        }

        const matches = fieldValue === value || String(fieldValue) === value
        return isNegation ? !matches : matches
      })
    })
  }
}

/**
 * Parse numeric filters
 */
function parseNumericFilters(
  numericFilters: string | string[] | string[][] | undefined
): (obj: AlgoliaObject) => boolean {
  if (!numericFilters) return () => true

  // Normalize to string filter
  const filterStr = Array.isArray(numericFilters)
    ? numericFilters.flat().join(' AND ')
    : numericFilters

  return parseFilter(filterStr)
}

// ============================================================================
// SEARCH SCORING
// ============================================================================

/**
 * Calculate relevance score for a document
 */
function calculateScore(
  obj: AlgoliaObject,
  query: string,
  searchableAttributes?: string[]
): number {
  if (!query) return 1

  const searchText = extractSearchableText(obj, searchableAttributes).toLowerCase()
  const queryTokens = tokenize(query)

  let score = 0
  let matchedTokens = 0

  for (const token of queryTokens) {
    // Handle prefix matching
    if (token.endsWith('*')) {
      const prefix = token.slice(0, -1)
      if (searchText.includes(prefix)) {
        score += 1
        matchedTokens++
      }
    } else {
      // Exact word match
      const regex = new RegExp(`\\b${token}\\b`, 'i')
      if (regex.test(searchText)) {
        score += 2
        matchedTokens++
      } else if (searchText.includes(token)) {
        // Partial match
        score += 1
        matchedTokens++
      }
    }
  }

  // Boost for matching more query terms
  if (queryTokens.length > 0) {
    score *= matchedTokens / queryTokens.length
  }

  return score
}

/**
 * Generate highlight result for a field
 */
function generateHighlight(
  value: unknown,
  query: string,
  preTag: string = '<em>',
  postTag: string = '</em>'
): HighlightResult {
  if (typeof value !== 'string') {
    return {
      value: String(value ?? ''),
      matchLevel: 'none',
      matchedWords: [],
    }
  }

  const queryTokens = tokenize(query)
  const matchedWords: string[] = []
  let highlightedValue = value
  let matchLevel: 'none' | 'partial' | 'full' = 'none'

  for (const token of queryTokens) {
    const regex = new RegExp(`(${escapeRegex(token)})`, 'gi')
    if (regex.test(value)) {
      highlightedValue = highlightedValue.replace(regex, `${preTag}$1${postTag}`)
      matchedWords.push(token)
    }
  }

  if (matchedWords.length === queryTokens.length) {
    matchLevel = 'full'
  } else if (matchedWords.length > 0) {
    matchLevel = 'partial'
  }

  return {
    value: highlightedValue,
    matchLevel,
    matchedWords,
    fullyHighlighted: matchLevel === 'full',
  }
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============================================================================
// SEARCH INDEX IMPLEMENTATION
// ============================================================================

class SearchIndexImpl implements SearchIndex {
  private _indexName: string
  private _appId: string

  constructor(indexName: string, appId: string) {
    this._indexName = indexName
    this._appId = appId
  }

  get indexName(): string {
    return this._indexName
  }

  private getStorage(): IndexStorage {
    return getIndexStorage(this._indexName)
  }

  async search<T = Record<string, unknown>>(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResponse<T>> {
    const startTime = performance.now()
    const storage = this.getStorage()
    const settings = storage.settings

    // Get all objects
    let objects = Array.from(storage.objects.values())

    // Apply filters
    const filterFn = parseFilter(options.filters)
    const facetFilterFn = parseFacetFilters(options.facetFilters)
    const numericFilterFn = parseNumericFilters(options.numericFilters)

    objects = objects.filter((obj) =>
      filterFn(obj) && facetFilterFn(obj) && numericFilterFn(obj)
    )

    // Calculate scores and filter by query
    const searchableAttrs = settings.searchableAttributes
    let scoredObjects: { obj: AlgoliaObject; score: number }[]

    if (query && query.trim()) {
      scoredObjects = objects
        .map((obj) => ({
          obj,
          score: calculateScore(obj, query, searchableAttrs),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
    } else {
      scoredObjects = objects.map((obj) => ({ obj, score: 1 }))
    }

    // Calculate facets
    let facets: Facets | undefined
    if (options.facets && options.facets.length > 0) {
      facets = {}
      const facetableAttrs = settings.attributesForFaceting || []

      for (const facetName of options.facets) {
        if (facetName === '*') {
          // All facetable attributes
          for (const attr of facetableAttrs) {
            const cleanAttr = attr.replace(/^(filterOnly|searchable)\(([^)]+)\)$/, '$2')
            facets[cleanAttr] = calculateFacetCounts(scoredObjects.map((s) => s.obj), cleanAttr)
          }
        } else {
          facets[facetName] = calculateFacetCounts(scoredObjects.map((s) => s.obj), facetName)
        }
      }
    }

    // Pagination
    const page = options.page ?? 0
    const hitsPerPage = options.hitsPerPage ?? settings.hitsPerPage ?? 20
    const totalHits = scoredObjects.length
    const nbPages = Math.ceil(totalHits / hitsPerPage)

    const startIdx = page * hitsPerPage
    const endIdx = startIdx + hitsPerPage
    const pageObjects = scoredObjects.slice(startIdx, endIdx)

    // Build hits
    const attributesToRetrieve = options.attributesToRetrieve ?? settings.attributesToRetrieve
    const attributesToHighlight = options.attributesToHighlight ?? settings.attributesToHighlight
    const preTag = options.highlightPreTag ?? settings.highlightPreTag ?? '<em>'
    const postTag = options.highlightPostTag ?? settings.highlightPostTag ?? '</em>'

    const hits: SearchHit<T>[] = pageObjects.map(({ obj }) => {
      let result: Record<string, unknown> = { ...obj }

      // Filter attributes to retrieve
      if (attributesToRetrieve && attributesToRetrieve.length > 0 && !attributesToRetrieve.includes('*')) {
        const filtered: Record<string, unknown> = { objectID: obj.objectID }
        for (const attr of attributesToRetrieve) {
          const value = getNestedValue(obj, attr)
          if (value !== undefined) {
            setNestedValue(filtered, attr, value)
          }
        }
        result = filtered
      }

      // Add highlight results
      if (attributesToHighlight && attributesToHighlight.length > 0 && query) {
        const highlightResult: Record<string, HighlightResult> = {}
        for (const attr of attributesToHighlight) {
          const value = getNestedValue(obj, attr)
          highlightResult[attr] = generateHighlight(value, query, preTag, postTag)
        }
        (result as SearchHit<T>)._highlightResult = highlightResult
      }

      return result as SearchHit<T>
    })

    const processingTimeMS = Math.round(performance.now() - startTime)

    return {
      hits,
      nbHits: totalHits,
      page,
      nbPages,
      hitsPerPage,
      exhaustiveNbHits: true,
      facets,
      query,
      params: buildParamsString(options),
      processingTimeMS,
    }
  }

  async searchForFacetValues(
    facetName: string,
    facetQuery: string,
    options: SearchForFacetValuesOptions = {}
  ): Promise<SearchForFacetValuesResponse> {
    const startTime = performance.now()
    const storage = this.getStorage()

    // Get all objects, potentially filtered
    let objects = Array.from(storage.objects.values())

    // Apply filters
    const filterFn = parseFilter(options.filters)
    const facetFilterFn = parseFacetFilters(options.facetFilters)
    objects = objects.filter((obj) => filterFn(obj) && facetFilterFn(obj))

    // Calculate facet values
    const facetCounts = calculateFacetCounts(objects, facetName)

    // Filter and highlight facet values
    const queryLower = facetQuery.toLowerCase()
    const maxFacetHits = options.maxFacetHits ?? 10

    const facetHits: FacetHit[] = Object.entries(facetCounts)
      .filter(([value]) => value.toLowerCase().includes(queryLower))
      .map(([value, count]) => ({
        value,
        highlighted: value.replace(
          new RegExp(`(${escapeRegex(facetQuery)})`, 'gi'),
          '<em>$1</em>'
        ),
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, maxFacetHits)

    const processingTimeMS = Math.round(performance.now() - startTime)

    return {
      facetHits,
      exhaustiveFacetsCount: true,
      processingTimeMS,
    }
  }

  async browse<T = Record<string, unknown>>(
    options: BrowseOptions = {}
  ): Promise<BrowseResponse<T>> {
    const response = await this.search<T>(options.query ?? '', {
      ...options,
      hitsPerPage: options.hitsPerPage ?? 1000,
    })

    // Generate cursor for pagination
    const cursor = response.page < response.nbPages - 1
      ? btoa(JSON.stringify({ page: response.page + 1 }))
      : undefined

    return {
      ...response,
      cursor,
    }
  }

  async browseObjects<T = Record<string, unknown>>(
    options: BrowseOptions & { batch: (hits: SearchHit<T>[]) => void }
  ): Promise<void> {
    let cursor: string | undefined
    const batchSize = options.hitsPerPage ?? 1000

    do {
      const currentPage = cursor ? JSON.parse(atob(cursor)).page : 0
      const response = await this.search<T>(options.query ?? '', {
        ...options,
        hitsPerPage: batchSize,
        page: currentPage,
      })

      if (response.hits.length > 0) {
        options.batch(response.hits)
      }

      cursor = response.page < response.nbPages - 1
        ? btoa(JSON.stringify({ page: response.page + 1 }))
        : undefined
    } while (cursor)
  }

  async saveObject<T = Record<string, unknown>>(
    object: T & { objectID?: string }
  ): Promise<SaveObjectResponse> {
    const storage = this.getStorage()
    const objectID = object.objectID ?? generateObjectID()
    const objToSave: AlgoliaObject = { ...object, objectID }

    storage.objects.set(objectID, objToSave)
    storage.updatedAt = new Date()

    return {
      objectID,
      taskID: generateTaskID(),
      createdAt: new Date().toISOString(),
    }
  }

  async saveObjects<T = Record<string, unknown>>(
    objects: (T & { objectID?: string })[],
    options?: { autoGenerateObjectIDIfNotExist?: boolean }
  ): Promise<SaveObjectsResponse> {
    const storage = this.getStorage()
    const objectIDs: string[] = []

    for (const object of objects) {
      const objectID = object.objectID ??
        (options?.autoGenerateObjectIDIfNotExist ? generateObjectID() : undefined)

      if (!objectID) {
        throw new AlgoliaError('objectID is required when autoGenerateObjectIDIfNotExist is not set', 400)
      }

      const objToSave: AlgoliaObject = { ...object, objectID }
      storage.objects.set(objectID, objToSave)
      objectIDs.push(objectID)
    }

    storage.updatedAt = new Date()

    return {
      objectIDs,
      taskID: generateTaskID(),
    }
  }

  async getObject<T = Record<string, unknown>>(
    objectID: string,
    options?: GetObjectOptions
  ): Promise<T & { objectID: string }> {
    const storage = this.getStorage()
    const obj = storage.objects.get(objectID)

    if (!obj) {
      throw new ObjectNotFoundError(objectID)
    }

    let result: Record<string, unknown> = { ...obj }

    // Filter attributes
    if (options?.attributesToRetrieve && options.attributesToRetrieve.length > 0) {
      const filtered: Record<string, unknown> = { objectID }
      for (const attr of options.attributesToRetrieve) {
        const value = getNestedValue(obj, attr)
        if (value !== undefined) {
          setNestedValue(filtered, attr, value)
        }
      }
      result = filtered
    }

    return result as T & { objectID: string }
  }

  async getObjects<T = Record<string, unknown>>(
    objectIDs: string[],
    options?: GetObjectsOptions
  ): Promise<GetObjectsResponse<T>> {
    const results: (T & { objectID: string })[] = []

    for (const objectID of objectIDs) {
      try {
        const obj = await this.getObject<T>(objectID, options)
        results.push(obj)
      } catch (e) {
        // Object not found - push null equivalent (Algolia returns null for missing)
        results.push(null as unknown as T & { objectID: string })
      }
    }

    return { results }
  }

  async partialUpdateObject<T = Record<string, unknown>>(
    object: Partial<T> & { objectID: string },
    options?: PartialUpdateObjectOptions
  ): Promise<SaveObjectResponse> {
    const storage = this.getStorage()
    const existing = storage.objects.get(object.objectID)

    if (!existing && !options?.createIfNotExists) {
      throw new ObjectNotFoundError(object.objectID)
    }

    const updated: AlgoliaObject = {
      ...(existing || {}),
      ...object,
      objectID: object.objectID,
    }

    storage.objects.set(object.objectID, updated)
    storage.updatedAt = new Date()

    return {
      objectID: object.objectID,
      taskID: generateTaskID(),
    }
  }

  async partialUpdateObjects<T = Record<string, unknown>>(
    objects: (Partial<T> & { objectID: string })[],
    options?: PartialUpdateObjectOptions
  ): Promise<SaveObjectsResponse> {
    const objectIDs: string[] = []

    for (const object of objects) {
      await this.partialUpdateObject(object, options)
      objectIDs.push(object.objectID)
    }

    return {
      objectIDs,
      taskID: generateTaskID(),
    }
  }

  async deleteObject(objectID: string): Promise<DeleteObjectResponse> {
    const storage = this.getStorage()
    storage.objects.delete(objectID)
    storage.updatedAt = new Date()

    return {
      objectID,
      taskID: generateTaskID(),
    }
  }

  async deleteObjects(objectIDs: string[]): Promise<DeleteObjectsResponse> {
    for (const objectID of objectIDs) {
      await this.deleteObject(objectID)
    }

    return {
      objectIDs,
      taskID: generateTaskID(),
    }
  }

  async deleteBy(options: { filters?: string; facetFilters?: string | string[] | string[][] }): Promise<{ taskID: number }> {
    const storage = this.getStorage()
    const filterFn = parseFilter(options.filters)
    const facetFilterFn = parseFacetFilters(options.facetFilters)

    const toDelete: string[] = []
    for (const [objectID, obj] of storage.objects) {
      if (filterFn(obj) && facetFilterFn(obj)) {
        toDelete.push(objectID)
      }
    }

    for (const objectID of toDelete) {
      storage.objects.delete(objectID)
    }

    storage.updatedAt = new Date()

    return { taskID: generateTaskID() }
  }

  async clearObjects(): Promise<ClearObjectsResponse> {
    const storage = this.getStorage()
    storage.objects.clear()
    storage.updatedAt = new Date()

    return { taskID: generateTaskID() }
  }

  async setSettings(settings: Settings, _options?: SetSettingsOptions): Promise<TaskResponse> {
    const storage = this.getStorage()
    storage.settings = { ...storage.settings, ...settings }
    storage.updatedAt = new Date()

    return {
      taskID: generateTaskID(),
      status: 'published',
    }
  }

  async getSettings(): Promise<GetSettingsResponse> {
    const storage = this.getStorage()
    return { ...storage.settings }
  }

  async waitTask(_taskID: number): Promise<TaskResponse> {
    // In-memory implementation completes tasks immediately
    return {
      taskID: _taskID,
      status: 'published',
    }
  }

  async exists(): Promise<boolean> {
    return globalStorage.has(this._indexName)
  }

  async delete(): Promise<{ taskID: number }> {
    globalStorage.delete(this._indexName)
    return { taskID: generateTaskID() }
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate facet counts for a given attribute
 */
function calculateFacetCounts(
  objects: AlgoliaObject[],
  facetName: string
): { [value: string]: number } {
  const counts: { [value: string]: number } = {}

  for (const obj of objects) {
    const value = getNestedValue(obj, facetName)

    if (Array.isArray(value)) {
      for (const v of value) {
        const key = String(v)
        counts[key] = (counts[key] ?? 0) + 1
      }
    } else if (value !== undefined && value !== null) {
      const key = String(value)
      counts[key] = (counts[key] ?? 0) + 1
    }
  }

  return counts
}

/**
 * Build URL params string from search options
 */
function buildParamsString(options: SearchOptions): string {
  const params: string[] = []

  if (options.query !== undefined) params.push(`query=${encodeURIComponent(options.query)}`)
  if (options.filters) params.push(`filters=${encodeURIComponent(options.filters)}`)
  if (options.page !== undefined) params.push(`page=${options.page}`)
  if (options.hitsPerPage !== undefined) params.push(`hitsPerPage=${options.hitsPerPage}`)
  if (options.facets) params.push(`facets=${encodeURIComponent(JSON.stringify(options.facets))}`)

  return params.join('&')
}

// ============================================================================
// SEARCH CLIENT IMPLEMENTATION
// ============================================================================

class SearchClientImpl implements SearchClient {
  private _appId: string
  private _apiKey: string
  private _options: ClientOptions

  constructor(appId: string, apiKey: string, options: ClientOptions = {}) {
    this._appId = appId
    this._apiKey = apiKey
    this._options = options
  }

  get appId(): string {
    return this._appId
  }

  initIndex(indexName: string): SearchIndex {
    return new SearchIndexImpl(indexName, this._appId)
  }

  async listIndices(): Promise<ListIndicesResponse> {
    const items: IndexInfo[] = []

    for (const [name, storage] of globalStorage) {
      const size = JSON.stringify(Array.from(storage.objects.values())).length

      items.push({
        name,
        createdAt: storage.createdAt.toISOString(),
        updatedAt: storage.updatedAt.toISOString(),
        entries: storage.objects.size,
        dataSize: size,
        fileSize: size,
        lastBuildTimeS: 0,
        numberOfPendingTasks: 0,
        pendingTask: false,
      })
    }

    return {
      items,
      nbPages: 1,
    }
  }

  async copyIndex(
    source: string,
    destination: string,
    options?: CopyIndexOptions
  ): Promise<CopyMoveIndexResponse> {
    const sourceStorage = globalStorage.get(source)
    if (!sourceStorage) {
      throw new AlgoliaError(`Index ${source} does not exist`, 404)
    }

    const scope = options?.scope ?? ['settings', 'synonyms', 'rules']
    const destStorage = getIndexStorage(destination)

    // Copy objects
    for (const [id, obj] of sourceStorage.objects) {
      destStorage.objects.set(id, { ...obj })
    }

    // Copy settings if in scope
    if (scope.includes('settings')) {
      destStorage.settings = { ...sourceStorage.settings }
    }

    destStorage.updatedAt = new Date()

    return {
      taskID: generateTaskID(),
      updatedAt: new Date().toISOString(),
    }
  }

  async moveIndex(source: string, destination: string): Promise<CopyMoveIndexResponse> {
    await this.copyIndex(source, destination)
    globalStorage.delete(source)

    return {
      taskID: generateTaskID(),
      updatedAt: new Date().toISOString(),
    }
  }

  async multipleQueries<T = Record<string, unknown>>(
    queries: MultipleQueriesQuery[],
    _options?: { strategy?: 'none' | 'stopIfEnoughMatches' }
  ): Promise<MultipleQueriesResponse<T>> {
    const results: SearchResponse<T>[] = []

    for (const query of queries) {
      const index = this.initIndex(query.indexName)

      if (query.type === 'facet' && query.facet) {
        // Facet search - return as search response format
        const facetResponse = await index.searchForFacetValues(
          query.facet,
          query.params?.query ?? '',
          query.params
        )
        results.push({
          hits: facetResponse.facetHits as unknown as SearchHit<T>[],
          nbHits: facetResponse.facetHits.length,
          page: 0,
          nbPages: 1,
          hitsPerPage: facetResponse.facetHits.length,
          exhaustiveNbHits: facetResponse.exhaustiveFacetsCount,
          query: query.params?.query ?? '',
          params: '',
          processingTimeMS: facetResponse.processingTimeMS,
        })
      } else {
        const response = await index.search<T>(query.query ?? '', query.params)
        results.push(response)
      }
    }

    return { results }
  }

  async multipleGetObjects<T = Record<string, unknown>>(
    requests: { indexName: string; objectID: string; attributesToRetrieve?: string[] }[]
  ): Promise<{ results: (T & { objectID: string } | null)[] }> {
    const results: (T & { objectID: string } | null)[] = []

    for (const request of requests) {
      const index = this.initIndex(request.indexName)
      try {
        const obj = await index.getObject<T>(request.objectID, {
          attributesToRetrieve: request.attributesToRetrieve,
        })
        results.push(obj)
      } catch {
        results.push(null)
      }
    }

    return { results }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new Algolia search client
 *
 * @example
 * ```ts
 * import algoliasearch from '@dotdo/algolia'
 *
 * const client = algoliasearch('APP_ID', 'API_KEY')
 * const index = client.initIndex('products')
 *
 * await index.saveObject({ objectID: '1', name: 'iPhone', price: 999 })
 * const results = await index.search('iPhone')
 * ```
 */
export function algoliasearch(
  appId: string,
  apiKey: string,
  options?: ClientOptions
): SearchClient {
  return new SearchClientImpl(appId, apiKey, options)
}

/**
 * Default export for compatibility with algoliasearch package
 */
export default algoliasearch

/**
 * Clear all in-memory storage (useful for tests)
 */
export function clearAllIndices(): void {
  globalStorage.clear()
  taskCounter = 0
}
