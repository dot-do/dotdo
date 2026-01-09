/**
 * @dotdo/elasticsearch - Elasticsearch SDK compat
 *
 * Drop-in replacement for @elastic/elasticsearch backed by DO SQLite with FTS5.
 * This in-memory implementation matches the Elasticsearch JavaScript API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html
 */
import type {
  Client as ClientType,
  ClientOptions,
  IndexRequest,
  IndexResponse,
  GetRequest,
  GetResponse,
  MgetRequest,
  MgetResponse,
  DeleteRequest,
  DeleteResponse,
  UpdateRequest,
  UpdateResponse,
  DeleteByQueryRequest,
  DeleteByQueryResponse,
  UpdateByQueryRequest,
  UpdateByQueryResponse,
  BulkRequest,
  BulkResponse,
  BulkResponseItem,
  BulkAction,
  SearchRequest,
  SearchResponse,
  SearchHit,
  CountRequest,
  CountResponse,
  ScrollRequest,
  ClearScrollRequest,
  ClearScrollResponse,
  QueryDsl,
  AggregationDsl,
  AggregationResult,
  AggregationBucket,
  SortOption,
  SourceFilter,
  IndicesClient,
  ClusterClient,
  IndicesCreateRequest,
  IndicesCreateResponse,
  IndicesDeleteRequest,
  IndicesDeleteResponse,
  IndicesExistsRequest,
  IndicesGetRequest,
  IndicesGetResponse,
  IndicesGetMappingRequest,
  IndicesGetMappingResponse,
  IndicesPutMappingRequest,
  IndicesPutMappingResponse,
  IndicesGetSettingsRequest,
  IndicesGetSettingsResponse,
  IndicesPutSettingsRequest,
  IndicesPutSettingsResponse,
  IndicesRefreshRequest,
  IndicesRefreshResponse,
  IndicesStatsRequest,
  IndicesStatsResponse,
  ClusterHealthRequest,
  ClusterHealthResponse,
  InfoResponse,
  IndexMappings,
  IndexSettings,
} from './types'

import {
  ElasticsearchError,
  DocumentNotFoundError,
  IndexNotFoundError,
  IndexAlreadyExistsError,
} from './types'

// Re-export error types
export {
  ElasticsearchError,
  DocumentNotFoundError,
  IndexNotFoundError,
  IndexAlreadyExistsError,
  ValidationError,
  VersionConflictError,
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * Document storage structure
 */
interface StoredDocument {
  _source: Record<string, unknown>
  _version: number
  _seq_no: number
  _primary_term: number
}

/**
 * Index storage structure
 */
interface IndexStorage {
  documents: Map<string, StoredDocument>
  settings: IndexSettings
  mappings: IndexMappings
  createdAt: Date
  updatedAt: Date
  aliases: Record<string, { filter?: QueryDsl; routing?: string; is_write_index?: boolean }>
}

/**
 * Scroll storage structure
 */
interface ScrollContext {
  index: string | string[]
  query?: QueryDsl
  sort?: SortOption[]
  size: number
  from: number
  _source?: SourceFilter
  expiresAt: number
}

const globalStorage = new Map<string, IndexStorage>()
const scrollStorage = new Map<string, ScrollContext>()

/** Sequence counter for document operations */
let seqNoCounter = 0

/**
 * Generate a new sequence number
 */
function generateSeqNo(): number {
  return ++seqNoCounter
}

/**
 * Generate a unique document ID
 */
function generateDocId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Generate a scroll ID
 */
function generateScrollId(): string {
  return `scroll-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Get or create index storage
 */
function getIndexStorage(indexName: string, autoCreate: boolean = true): IndexStorage {
  let storage = globalStorage.get(indexName)
  if (!storage) {
    if (!autoCreate) {
      throw new IndexNotFoundError(indexName)
    }
    storage = {
      documents: new Map(),
      settings: {
        number_of_shards: 1,
        number_of_replicas: 1,
      },
      mappings: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      aliases: {},
    }
    globalStorage.set(indexName, storage)
  }
  return storage
}

/**
 * Get index storage if exists
 */
function getIndexStorageIfExists(indexName: string): IndexStorage | undefined {
  return globalStorage.get(indexName)
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
 * Extract searchable text from document
 */
function extractSearchableText(doc: Record<string, unknown>, fields?: string[]): string {
  const texts: string[] = []

  function extract(value: unknown, path: string = ''): void {
    if (value === null || value === undefined) return

    if (typeof value === 'string') {
      if (!fields || fields.length === 0 || fields.includes(path) || fields.includes('*')) {
        texts.push(value)
      }
    } else if (Array.isArray(value)) {
      value.forEach((item) => extract(item, path))
    } else if (typeof value === 'object') {
      for (const [key, val] of Object.entries(value)) {
        extract(val, path ? `${path}.${key}` : key)
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      texts.push(String(value))
    }
  }

  extract(doc)
  return texts.join(' ')
}

// ============================================================================
// QUERY EXECUTION
// ============================================================================

/**
 * Execute a query against a document
 */
function matchesQuery(doc: Record<string, unknown>, query: QueryDsl | undefined, docId: string): boolean {
  if (!query || Object.keys(query).length === 0) {
    return true
  }

  // match_all
  if (query.match_all !== undefined) {
    return true
  }

  // match
  if (query.match) {
    for (const [field, value] of Object.entries(query.match)) {
      const fieldValue = getNestedValue(doc, field)
      if (fieldValue === undefined || fieldValue === null) return false

      const queryText = typeof value === 'string' ? value : (value as { query: string }).query
      const operator = typeof value === 'object' ? (value as { operator?: string }).operator : 'or'

      const fieldTokens = tokenize(String(fieldValue))
      const queryTokens = tokenize(queryText)

      if (operator === 'and') {
        return queryTokens.every((qt) => fieldTokens.some((ft) => ft.includes(qt) || qt.includes(ft)))
      } else {
        return queryTokens.some((qt) => fieldTokens.some((ft) => ft.includes(qt) || qt.includes(ft)))
      }
    }
  }

  // multi_match
  if (query.multi_match) {
    const { query: queryText, fields, operator = 'or' } = query.multi_match
    const queryTokens = tokenize(queryText)

    const matches = fields.map((field) => {
      const fieldName = field.replace(/\^[\d.]+$/, '') // Remove boost
      const fieldValue = getNestedValue(doc, fieldName)
      if (fieldValue === undefined || fieldValue === null) return false

      const fieldTokens = tokenize(String(fieldValue))
      if (operator === 'and') {
        return queryTokens.every((qt) => fieldTokens.some((ft) => ft.includes(qt) || qt.includes(ft)))
      } else {
        return queryTokens.some((qt) => fieldTokens.some((ft) => ft.includes(qt) || qt.includes(ft)))
      }
    })

    return matches.some(Boolean)
  }

  // match_phrase
  if (query.match_phrase) {
    for (const [field, value] of Object.entries(query.match_phrase)) {
      const fieldValue = getNestedValue(doc, field)
      if (fieldValue === undefined || fieldValue === null) return false

      const queryText = typeof value === 'string' ? value : (value as { query: string }).query
      return String(fieldValue).toLowerCase().includes(queryText.toLowerCase())
    }
  }

  // term
  if (query.term) {
    for (const [field, value] of Object.entries(query.term)) {
      const fieldValue = getNestedValue(doc, field)
      const termValue = typeof value === 'object' ? (value as { value: unknown }).value : value

      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v) => v === termValue || String(v) === String(termValue))
      }

      return fieldValue === termValue || String(fieldValue) === String(termValue)
    }
  }

  // terms
  if (query.terms) {
    for (const [field, values] of Object.entries(query.terms)) {
      const fieldValue = getNestedValue(doc, field)
      if (Array.isArray(values)) {
        if (Array.isArray(fieldValue)) {
          return fieldValue.some((v) => values.some((tv) => v === tv || String(v) === String(tv)))
        }
        return values.some((v) => fieldValue === v || String(fieldValue) === String(v))
      }
    }
  }

  // range
  if (query.range) {
    for (const [field, conditions] of Object.entries(query.range)) {
      const fieldValue = getNestedValue(doc, field)
      if (fieldValue === undefined || fieldValue === null) return false

      const numValue = typeof fieldValue === 'number' ? fieldValue : Number(fieldValue)

      if (conditions.gt !== undefined && !(numValue > Number(conditions.gt))) return false
      if (conditions.gte !== undefined && !(numValue >= Number(conditions.gte))) return false
      if (conditions.lt !== undefined && !(numValue < Number(conditions.lt))) return false
      if (conditions.lte !== undefined && !(numValue <= Number(conditions.lte))) return false
    }
    return true
  }

  // exists
  if (query.exists) {
    const fieldValue = getNestedValue(doc, query.exists.field)
    return fieldValue !== undefined && fieldValue !== null
  }

  // ids
  if (query.ids) {
    return query.ids.values.includes(docId)
  }

  // prefix
  if (query.prefix) {
    for (const [field, value] of Object.entries(query.prefix)) {
      const fieldValue = getNestedValue(doc, field)
      if (fieldValue === undefined || fieldValue === null) return false

      const prefixValue = typeof value === 'string' ? value : (value as { value: string }).value
      const caseInsensitive = typeof value === 'object' ? (value as { case_insensitive?: boolean }).case_insensitive : false

      if (caseInsensitive) {
        return String(fieldValue).toLowerCase().startsWith(prefixValue.toLowerCase())
      }
      return String(fieldValue).startsWith(prefixValue)
    }
  }

  // wildcard
  if (query.wildcard) {
    for (const [field, value] of Object.entries(query.wildcard)) {
      const fieldValue = getNestedValue(doc, field)
      if (fieldValue === undefined || fieldValue === null) return false

      const pattern = typeof value === 'string' ? value : (value as { value: string }).value
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
      return regex.test(String(fieldValue))
    }
  }

  // bool
  if (query.bool) {
    const { must, must_not, should, filter, minimum_should_match } = query.bool

    // must - all must match
    if (must) {
      const mustArray = Array.isArray(must) ? must : [must]
      if (!mustArray.every((q) => matchesQuery(doc, q, docId))) {
        return false
      }
    }

    // must_not - none must match
    if (must_not) {
      const mustNotArray = Array.isArray(must_not) ? must_not : [must_not]
      if (mustNotArray.some((q) => matchesQuery(doc, q, docId))) {
        return false
      }
    }

    // filter - all must match (no scoring)
    if (filter) {
      const filterArray = Array.isArray(filter) ? filter : [filter]
      if (!filterArray.every((q) => matchesQuery(doc, q, docId))) {
        return false
      }
    }

    // should - at least minimum_should_match must match
    if (should) {
      const shouldArray = Array.isArray(should) ? should : [should]
      const minMatch = minimum_should_match ?? (must || filter ? 0 : 1)
      const shouldMatches = shouldArray.filter((q) => matchesQuery(doc, q, docId)).length

      if (typeof minMatch === 'number' && shouldMatches < minMatch) {
        return false
      }
    }

    return true
  }

  return true
}

/**
 * Calculate relevance score for a document
 */
function calculateScore(doc: Record<string, unknown>, query: QueryDsl | undefined): number {
  if (!query || Object.keys(query).length === 0) {
    return 1
  }

  if (query.match_all !== undefined) {
    return 1
  }

  // Simple scoring based on term matches
  if (query.match) {
    let score = 0
    for (const [field, value] of Object.entries(query.match)) {
      const fieldValue = getNestedValue(doc, field)
      if (fieldValue === undefined) continue

      const queryText = typeof value === 'string' ? value : (value as { query: string }).query
      const fieldTokens = tokenize(String(fieldValue))
      const queryTokens = tokenize(queryText)

      for (const qt of queryTokens) {
        for (const ft of fieldTokens) {
          if (ft === qt) score += 2
          else if (ft.includes(qt)) score += 1
        }
      }
    }
    return score
  }

  if (query.multi_match) {
    const { query: queryText, fields } = query.multi_match
    let score = 0

    for (const field of fields) {
      const fieldName = field.replace(/\^[\d.]+$/, '')
      const boost = field.includes('^') ? parseFloat(field.split('^')[1]) : 1
      const fieldValue = getNestedValue(doc, fieldName)
      if (fieldValue === undefined) continue

      const fieldTokens = tokenize(String(fieldValue))
      const queryTokens = tokenize(queryText)

      for (const qt of queryTokens) {
        for (const ft of fieldTokens) {
          if (ft === qt) score += 2 * boost
          else if (ft.includes(qt)) score += 1 * boost
        }
      }
    }
    return score
  }

  if (query.bool) {
    let score = 0
    if (query.bool.must) {
      const mustArray = Array.isArray(query.bool.must) ? query.bool.must : [query.bool.must]
      for (const q of mustArray) {
        score += calculateScore(doc, q)
      }
    }
    if (query.bool.should) {
      const shouldArray = Array.isArray(query.bool.should) ? query.bool.should : [query.bool.should]
      for (const q of shouldArray) {
        if (matchesQuery(doc, q, '')) {
          score += calculateScore(doc, q)
        }
      }
    }
    return score || 1
  }

  return 1
}

// ============================================================================
// AGGREGATION EXECUTION
// ============================================================================

/**
 * Execute aggregations on a set of documents
 */
function executeAggregations(
  docs: Array<{ id: string; doc: Record<string, unknown>; score: number }>,
  aggs: Record<string, AggregationDsl> | undefined
): Record<string, AggregationResult> | undefined {
  if (!aggs || Object.keys(aggs).length === 0) {
    return undefined
  }

  const results: Record<string, AggregationResult> = {}

  for (const [aggName, aggDef] of Object.entries(aggs)) {
    results[aggName] = executeAggregation(docs, aggDef)
  }

  return results
}

/**
 * Execute a single aggregation
 */
function executeAggregation(
  docs: Array<{ id: string; doc: Record<string, unknown>; score: number }>,
  aggDef: AggregationDsl
): AggregationResult {
  // Terms aggregation
  if (aggDef.terms) {
    const { field, size = 10, order, min_doc_count = 1 } = aggDef.terms
    const counts = new Map<string, number>()

    for (const { doc } of docs) {
      const value = getNestedValue(doc, field)
      if (value === undefined || value === null) continue

      if (Array.isArray(value)) {
        for (const v of value) {
          const key = String(v)
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      } else {
        const key = String(value)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }

    let buckets: AggregationBucket[] = []
    for (const [key, doc_count] of counts) {
      if (doc_count >= min_doc_count) {
        const bucket: AggregationBucket = { key, doc_count }

        // Execute nested aggregations
        if (aggDef.aggs || aggDef.aggregations) {
          const nestedDocs = docs.filter(({ doc }) => {
            const value = getNestedValue(doc, field)
            if (Array.isArray(value)) {
              return value.includes(key) || value.map(String).includes(key)
            }
            return String(value) === key
          })
          const nestedAggs = executeAggregations(nestedDocs, aggDef.aggs || aggDef.aggregations)
          if (nestedAggs) {
            Object.assign(bucket, nestedAggs)
          }
        }

        buckets.push(bucket)
      }
    }

    // Sort buckets
    if (order) {
      const orderEntries = Array.isArray(order) ? order : [order]
      for (const orderEntry of orderEntries.reverse()) {
        const [orderField, orderDir] = Object.entries(orderEntry)[0]
        const dir = orderDir === 'asc' ? 1 : -1
        buckets.sort((a, b) => {
          if (orderField === '_count') {
            return (a.doc_count - b.doc_count) * dir
          } else if (orderField === '_key') {
            return String(a.key).localeCompare(String(b.key)) * dir
          }
          return 0
        })
      }
    } else {
      // Default sort by doc_count desc
      buckets.sort((a, b) => b.doc_count - a.doc_count)
    }

    buckets = buckets.slice(0, size)

    return {
      doc_count_error_upper_bound: 0,
      sum_other_doc_count: Math.max(0, counts.size - buckets.length),
      buckets,
    }
  }

  // Avg aggregation
  if (aggDef.avg) {
    const { field, missing } = aggDef.avg
    let sum = 0
    let count = 0

    for (const { doc } of docs) {
      let value = getNestedValue(doc, field)
      if (value === undefined || value === null) {
        if (missing !== undefined) {
          value = missing
        } else {
          continue
        }
      }
      sum += Number(value)
      count++
    }

    return { value: count > 0 ? sum / count : null }
  }

  // Sum aggregation
  if (aggDef.sum) {
    const { field, missing } = aggDef.sum
    let sum = 0

    for (const { doc } of docs) {
      let value = getNestedValue(doc, field)
      if (value === undefined || value === null) {
        if (missing !== undefined) {
          value = missing
        } else {
          continue
        }
      }
      sum += Number(value)
    }

    return { value: sum }
  }

  // Min aggregation
  if (aggDef.min) {
    const { field, missing } = aggDef.min
    let min: number | null = null

    for (const { doc } of docs) {
      let value = getNestedValue(doc, field)
      if (value === undefined || value === null) {
        if (missing !== undefined) {
          value = missing
        } else {
          continue
        }
      }
      const numValue = Number(value)
      if (min === null || numValue < min) {
        min = numValue
      }
    }

    return { value: min }
  }

  // Max aggregation
  if (aggDef.max) {
    const { field, missing } = aggDef.max
    let max: number | null = null

    for (const { doc } of docs) {
      let value = getNestedValue(doc, field)
      if (value === undefined || value === null) {
        if (missing !== undefined) {
          value = missing
        } else {
          continue
        }
      }
      const numValue = Number(value)
      if (max === null || numValue > max) {
        max = numValue
      }
    }

    return { value: max }
  }

  // Cardinality aggregation
  if (aggDef.cardinality) {
    const { field } = aggDef.cardinality
    const uniqueValues = new Set<string>()

    for (const { doc } of docs) {
      const value = getNestedValue(doc, field)
      if (value === undefined || value === null) continue

      if (Array.isArray(value)) {
        for (const v of value) {
          uniqueValues.add(String(v))
        }
      } else {
        uniqueValues.add(String(value))
      }
    }

    return { value: uniqueValues.size }
  }

  // Stats aggregation
  if (aggDef.stats) {
    const { field } = aggDef.stats
    let sum = 0
    let min: number | null = null
    let max: number | null = null
    let count = 0

    for (const { doc } of docs) {
      const value = getNestedValue(doc, field)
      if (value === undefined || value === null) continue

      const numValue = Number(value)
      sum += numValue
      count++
      if (min === null || numValue < min) min = numValue
      if (max === null || numValue > max) max = numValue
    }

    return {
      count,
      min: min ?? 0,
      max: max ?? 0,
      sum,
      avg: count > 0 ? sum / count : 0,
    }
  }

  // Value count aggregation
  if (aggDef.value_count) {
    const { field } = aggDef.value_count
    let count = 0

    for (const { doc } of docs) {
      const value = getNestedValue(doc, field)
      if (value !== undefined && value !== null) {
        count++
      }
    }

    return { value: count }
  }

  // Range aggregation
  if (aggDef.range) {
    const { field, ranges } = aggDef.range
    const buckets: AggregationBucket[] = []

    for (const range of ranges) {
      let doc_count = 0
      const key = range.key || `${range.from ?? '*'}-${range.to ?? '*'}`

      for (const { doc } of docs) {
        const value = getNestedValue(doc, field)
        if (value === undefined || value === null) continue

        const numValue = Number(value)
        const fromMatch = range.from === undefined || numValue >= range.from
        const toMatch = range.to === undefined || numValue < range.to

        if (fromMatch && toMatch) {
          doc_count++
        }
      }

      buckets.push({ key, doc_count, from: range.from, to: range.to })
    }

    return { buckets }
  }

  // Filter aggregation
  if (aggDef.filter) {
    const filteredDocs = docs.filter(({ doc, id }) => matchesQuery(doc, aggDef.filter, id))
    const result: AggregationResult = { doc_count: filteredDocs.length }

    if (aggDef.aggs || aggDef.aggregations) {
      const nestedAggs = executeAggregations(filteredDocs, aggDef.aggs || aggDef.aggregations)
      if (nestedAggs) {
        Object.assign(result, nestedAggs)
      }
    }

    return result
  }

  return {}
}

// ============================================================================
// SOURCE FILTERING
// ============================================================================

/**
 * Filter document source based on _source option
 */
function filterSource<T extends Record<string, unknown>>(
  source: T,
  sourceFilter: SourceFilter | undefined
): T | undefined {
  if (sourceFilter === false) {
    return undefined
  }

  if (sourceFilter === true || sourceFilter === undefined) {
    return source
  }

  if (Array.isArray(sourceFilter)) {
    const result: Record<string, unknown> = {}
    for (const field of sourceFilter) {
      const value = getNestedValue(source, field)
      if (value !== undefined) {
        setNestedValue(result, field, value)
      }
    }
    return result as T
  }

  if (typeof sourceFilter === 'object') {
    let result = { ...source }

    if (sourceFilter.includes) {
      const filtered: Record<string, unknown> = {}
      for (const field of sourceFilter.includes) {
        const value = getNestedValue(source, field)
        if (value !== undefined) {
          setNestedValue(filtered, field, value)
        }
      }
      result = filtered as T
    }

    if (sourceFilter.excludes) {
      for (const field of sourceFilter.excludes) {
        deleteNestedValue(result, field)
      }
    }

    return result as T
  }

  return source
}

/**
 * Set nested value in object
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined) {
      current[parts[i]] = {}
    }
    current = current[parts[i]] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

/**
 * Delete nested value from object
 */
function deleteNestedValue(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined) return
    current = current[parts[i]] as Record<string, unknown>
  }
  delete current[parts[parts.length - 1]]
}

// ============================================================================
// SORTING
// ============================================================================

/**
 * Sort documents based on sort options
 */
function sortDocs(
  docs: Array<{ id: string; doc: Record<string, unknown>; score: number }>,
  sort: SortOption[] | undefined
): Array<{ id: string; doc: Record<string, unknown>; score: number; sortValues: (string | number | null)[] }> {
  const result = docs.map((d) => ({
    ...d,
    sortValues: [] as (string | number | null)[],
  }))

  if (!sort || sort.length === 0) {
    // Default sort by _score desc
    result.sort((a, b) => b.score - a.score)
    return result
  }

  // Calculate sort values for each document
  for (const doc of result) {
    for (const sortOption of sort) {
      if (typeof sortOption === 'string') {
        if (sortOption === '_score') {
          doc.sortValues.push(doc.score)
        } else if (sortOption === '_id') {
          doc.sortValues.push(doc.id)
        } else {
          const value = getNestedValue(doc.doc, sortOption)
          doc.sortValues.push(value as string | number | null)
        }
      } else {
        const [field, order] = Object.entries(sortOption)[0]
        const direction = typeof order === 'string' ? order : order.order

        if (field === '_score') {
          doc.sortValues.push(doc.score)
        } else if (field === '_id') {
          doc.sortValues.push(doc.id)
        } else {
          const value = getNestedValue(doc.doc, field)
          doc.sortValues.push(value as string | number | null)
        }
      }
    }
  }

  // Sort documents
  result.sort((a, b) => {
    for (let i = 0; i < sort.length; i++) {
      const sortOption = sort[i]
      const aVal = a.sortValues[i]
      const bVal = b.sortValues[i]

      let direction = 'asc'
      if (typeof sortOption === 'object') {
        const order = Object.values(sortOption)[0]
        direction = typeof order === 'string' ? order : order.order
      }

      if (aVal === bVal) continue

      if (aVal === null || aVal === undefined) return direction === 'asc' ? 1 : -1
      if (bVal === null || bVal === undefined) return direction === 'asc' ? -1 : 1

      const cmp = typeof aVal === 'string' && typeof bVal === 'string'
        ? aVal.localeCompare(bVal)
        : (aVal as number) - (bVal as number)

      return direction === 'asc' ? cmp : -cmp
    }
    return 0
  })

  return result
}

// ============================================================================
// HIGHLIGHTING
// ============================================================================

/**
 * Generate highlights for a document
 */
function generateHighlights(
  doc: Record<string, unknown>,
  query: QueryDsl | undefined,
  highlightOptions: SearchRequest['highlight']
): Record<string, string[]> | undefined {
  if (!highlightOptions || !query) return undefined

  const highlights: Record<string, string[]> = {}
  const preTags = highlightOptions.pre_tags ?? ['<em>']
  const postTags = highlightOptions.post_tags ?? ['</em>']

  // Extract query terms
  const queryTerms: string[] = []
  if (query.match) {
    for (const value of Object.values(query.match)) {
      const text = typeof value === 'string' ? value : (value as { query: string }).query
      queryTerms.push(...tokenize(text))
    }
  }
  if (query.multi_match) {
    queryTerms.push(...tokenize(query.multi_match.query))
  }
  if (query.bool?.must) {
    const mustArray = Array.isArray(query.bool.must) ? query.bool.must : [query.bool.must]
    for (const q of mustArray) {
      if (q.match) {
        for (const value of Object.values(q.match)) {
          const text = typeof value === 'string' ? value : (value as { query: string }).query
          queryTerms.push(...tokenize(text))
        }
      }
    }
  }

  if (queryTerms.length === 0) return undefined

  for (const field of Object.keys(highlightOptions.fields)) {
    const fieldValue = getNestedValue(doc, field)
    if (typeof fieldValue !== 'string') continue

    let highlighted = fieldValue
    let hasMatch = false

    for (const term of queryTerms) {
      const regex = new RegExp(`(${escapeRegex(term)})`, 'gi')
      if (regex.test(highlighted)) {
        hasMatch = true
        highlighted = highlighted.replace(regex, `${preTags[0]}$1${postTags[0]}`)
      }
    }

    if (hasMatch) {
      highlights[field] = [highlighted]
    }
  }

  return Object.keys(highlights).length > 0 ? highlights : undefined
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============================================================================
// INDICES CLIENT
// ============================================================================

class IndicesClientImpl implements IndicesClient {
  async create(params: IndicesCreateRequest): Promise<IndicesCreateResponse> {
    if (globalStorage.has(params.index)) {
      throw new IndexAlreadyExistsError(params.index)
    }

    const settings = params.settings ?? params.body?.settings ?? {}
    const mappings = params.mappings ?? params.body?.mappings ?? {}
    const aliases = params.aliases ?? params.body?.aliases ?? {}

    const storage: IndexStorage = {
      documents: new Map(),
      settings: {
        number_of_shards: settings.number_of_shards ?? 1,
        number_of_replicas: settings.number_of_replicas ?? 1,
        ...settings,
      },
      mappings,
      createdAt: new Date(),
      updatedAt: new Date(),
      aliases,
    }

    globalStorage.set(params.index, storage)

    return {
      acknowledged: true,
      shards_acknowledged: true,
      index: params.index,
    }
  }

  async delete(params: IndicesDeleteRequest): Promise<IndicesDeleteResponse> {
    const indices = Array.isArray(params.index) ? params.index : [params.index]

    for (const index of indices) {
      if (!globalStorage.has(index)) {
        throw new IndexNotFoundError(index)
      }
    }

    for (const index of indices) {
      globalStorage.delete(index)
    }

    return { acknowledged: true }
  }

  async exists(params: IndicesExistsRequest): Promise<boolean> {
    const indices = Array.isArray(params.index) ? params.index : [params.index]
    return indices.every((index) => globalStorage.has(index))
  }

  async get(params: IndicesGetRequest): Promise<IndicesGetResponse> {
    const indices = Array.isArray(params.index) ? params.index : [params.index]
    const result: IndicesGetResponse = {}

    for (const index of indices) {
      const storage = getIndexStorageIfExists(index)
      if (!storage) {
        throw new IndexNotFoundError(index)
      }

      result[index] = {
        aliases: storage.aliases,
        mappings: storage.mappings,
        settings: {
          index: {
            ...storage.settings,
            creation_date: storage.createdAt.getTime().toString(),
            uuid: `uuid-${index}`,
            provided_name: index,
          },
        },
      }
    }

    return result
  }

  async getMapping(params?: IndicesGetMappingRequest): Promise<IndicesGetMappingResponse> {
    const indices = params?.index
      ? (Array.isArray(params.index) ? params.index : [params.index])
      : Array.from(globalStorage.keys())

    const result: IndicesGetMappingResponse = {}

    for (const index of indices) {
      const storage = getIndexStorageIfExists(index)
      if (!storage) {
        throw new IndexNotFoundError(index)
      }

      result[index] = { mappings: storage.mappings }
    }

    return result
  }

  async putMapping(params: IndicesPutMappingRequest): Promise<IndicesPutMappingResponse> {
    const indices = Array.isArray(params.index) ? params.index : [params.index]

    for (const index of indices) {
      const storage = getIndexStorage(index, false)

      const newMappings = params.body ?? {
        properties: params.properties,
        dynamic: params.dynamic,
      }

      storage.mappings = {
        ...storage.mappings,
        ...newMappings,
        properties: {
          ...storage.mappings.properties,
          ...newMappings.properties,
        },
      }
      storage.updatedAt = new Date()
    }

    return { acknowledged: true }
  }

  async getSettings(params?: IndicesGetSettingsRequest): Promise<IndicesGetSettingsResponse> {
    const indices = params?.index
      ? (Array.isArray(params.index) ? params.index : [params.index])
      : Array.from(globalStorage.keys())

    const result: IndicesGetSettingsResponse = {}

    for (const index of indices) {
      const storage = getIndexStorageIfExists(index)
      if (!storage) {
        throw new IndexNotFoundError(index)
      }

      result[index] = {
        settings: {
          index: {
            ...storage.settings,
            creation_date: storage.createdAt.getTime().toString(),
            uuid: `uuid-${index}`,
            provided_name: index,
          },
        },
      }
    }

    return result
  }

  async putSettings(params: IndicesPutSettingsRequest): Promise<IndicesPutSettingsResponse> {
    const indices = params.index
      ? (Array.isArray(params.index) ? params.index : [params.index])
      : Array.from(globalStorage.keys())

    const newSettings = params.settings ?? params.body ?? {}

    for (const index of indices) {
      const storage = getIndexStorage(index, false)
      storage.settings = { ...storage.settings, ...newSettings }
      storage.updatedAt = new Date()
    }

    return { acknowledged: true }
  }

  async refresh(params?: IndicesRefreshRequest): Promise<IndicesRefreshResponse> {
    // In-memory implementation doesn't need refresh
    return {
      _shards: {
        total: 1,
        successful: 1,
        failed: 0,
      },
    }
  }

  async flush(params?: any): Promise<any> {
    return {
      _shards: {
        total: 1,
        successful: 1,
        failed: 0,
      },
    }
  }

  async stats(params?: IndicesStatsRequest): Promise<IndicesStatsResponse> {
    const indices = params?.index
      ? (Array.isArray(params.index) ? params.index : [params.index])
      : Array.from(globalStorage.keys())

    let totalDocs = 0
    let totalSize = 0
    const indexStats: IndicesStatsResponse['indices'] = {}

    for (const index of indices) {
      const storage = getIndexStorageIfExists(index)
      if (!storage) continue

      const docCount = storage.documents.size
      const size = JSON.stringify(Array.from(storage.documents.values())).length

      totalDocs += docCount
      totalSize += size

      indexStats[index] = {
        uuid: `uuid-${index}`,
        primaries: {
          docs: { count: docCount, deleted: 0 },
          store: { size_in_bytes: size },
        },
        total: {
          docs: { count: docCount, deleted: 0 },
          store: { size_in_bytes: size },
        },
      }
    }

    return {
      _shards: {
        total: indices.length,
        successful: indices.length,
        failed: 0,
      },
      _all: {
        primaries: {
          docs: { count: totalDocs, deleted: 0 },
          store: { size_in_bytes: totalSize },
        },
        total: {
          docs: { count: totalDocs, deleted: 0 },
          store: { size_in_bytes: totalSize },
        },
      },
      indices: indexStats,
    }
  }

  async updateAliases(params: any): Promise<any> {
    return { acknowledged: true }
  }

  async getAlias(params?: any): Promise<any> {
    const result: any = {}
    for (const [index, storage] of globalStorage) {
      result[index] = { aliases: storage.aliases }
    }
    return result
  }
}

// ============================================================================
// CLUSTER CLIENT
// ============================================================================

class ClusterClientImpl implements ClusterClient {
  async health(params?: ClusterHealthRequest): Promise<ClusterHealthResponse> {
    return {
      cluster_name: 'dotdo-elasticsearch',
      status: 'green',
      timed_out: false,
      number_of_nodes: 1,
      number_of_data_nodes: 1,
      active_primary_shards: globalStorage.size,
      active_shards: globalStorage.size,
      relocating_shards: 0,
      initializing_shards: 0,
      unassigned_shards: 0,
      delayed_unassigned_shards: 0,
      number_of_pending_tasks: 0,
      number_of_in_flight_fetch: 0,
      task_max_waiting_in_queue_millis: 0,
      active_shards_percent_as_number: 100,
    }
  }
}

// ============================================================================
// CLIENT IMPLEMENTATION
// ============================================================================

export class Client implements ClientType {
  private _options: ClientOptions
  indices: IndicesClient
  cluster: ClusterClient

  constructor(options: ClientOptions = {}) {
    this._options = options
    this.indices = new IndicesClientImpl()
    this.cluster = new ClusterClientImpl()
  }

  async info(): Promise<InfoResponse> {
    return {
      name: 'dotdo-node',
      cluster_name: 'dotdo-elasticsearch',
      cluster_uuid: 'uuid-' + Date.now(),
      version: {
        number: '8.11.0',
        build_flavor: 'default',
        build_type: 'tar',
        build_hash: 'dotdo',
        build_date: new Date().toISOString(),
        build_snapshot: false,
        lucene_version: '9.8.0',
        minimum_wire_compatibility_version: '7.17.0',
        minimum_index_compatibility_version: '7.0.0',
      },
      tagline: 'You Know, for Search',
    }
  }

  async close(): Promise<void> {
    // Nothing to close in memory implementation
  }

  async index<T = Record<string, unknown>>(params: IndexRequest<T>): Promise<IndexResponse> {
    const storage = getIndexStorage(params.index)
    const id = params.id ?? generateDocId()
    const document = params.document ?? params.body

    const existing = storage.documents.get(id)
    const isUpdate = !!existing

    const storedDoc: StoredDocument = {
      _source: document as Record<string, unknown>,
      _version: isUpdate ? (existing._version + 1) : 1,
      _seq_no: generateSeqNo(),
      _primary_term: 1,
    }

    storage.documents.set(id, storedDoc)
    storage.updatedAt = new Date()

    return {
      _index: params.index,
      _id: id,
      _version: storedDoc._version,
      result: isUpdate ? 'updated' : 'created',
      _shards: {
        total: 1,
        successful: 1,
        failed: 0,
      },
      _seq_no: storedDoc._seq_no,
      _primary_term: storedDoc._primary_term,
    }
  }

  async get<T = Record<string, unknown>>(params: GetRequest): Promise<GetResponse<T>> {
    const storage = getIndexStorage(params.index, false)
    const doc = storage.documents.get(params.id)

    if (!doc) {
      throw new DocumentNotFoundError(params.index, params.id)
    }

    let sourceFilter: SourceFilter | undefined
    if (params._source !== undefined) {
      sourceFilter = params._source
    } else if (params._source_includes || params._source_excludes) {
      sourceFilter = {
        includes: params._source_includes,
        excludes: params._source_excludes,
      }
    }

    const filteredSource = filterSource(doc._source as T, sourceFilter)

    return {
      _index: params.index,
      _id: params.id,
      _version: doc._version,
      _seq_no: doc._seq_no,
      _primary_term: doc._primary_term,
      found: true,
      _source: filteredSource,
    }
  }

  async mget<T = Record<string, unknown>>(params: MgetRequest): Promise<MgetResponse<T>> {
    const docs: GetResponse<T>[] = []
    const requests = params.docs ?? params.body?.docs ?? (params.ids ?? params.body?.ids ?? []).map((id) => ({
      _index: params.index,
      _id: id,
    }))

    for (const req of requests) {
      const index = req._index ?? params.index
      if (!index) {
        docs.push({
          _index: '',
          _id: req._id,
          found: false,
        })
        continue
      }

      try {
        const result = await this.get<T>({
          index,
          id: req._id,
          _source: req._source ?? params._source,
        })
        docs.push(result)
      } catch {
        docs.push({
          _index: index,
          _id: req._id,
          found: false,
        })
      }
    }

    return { docs }
  }

  async delete(params: DeleteRequest): Promise<DeleteResponse> {
    const storage = getIndexStorage(params.index, false)
    const doc = storage.documents.get(params.id)

    if (!doc) {
      return {
        _index: params.index,
        _id: params.id,
        _version: 1,
        result: 'not_found',
        _shards: {
          total: 1,
          successful: 1,
          failed: 0,
        },
        _seq_no: generateSeqNo(),
        _primary_term: 1,
      }
    }

    storage.documents.delete(params.id)
    storage.updatedAt = new Date()

    return {
      _index: params.index,
      _id: params.id,
      _version: doc._version + 1,
      result: 'deleted',
      _shards: {
        total: 1,
        successful: 1,
        failed: 0,
      },
      _seq_no: generateSeqNo(),
      _primary_term: 1,
    }
  }

  async update<T = Record<string, unknown>>(params: UpdateRequest<T>): Promise<UpdateResponse<T>> {
    const storage = getIndexStorage(params.index, false)
    const existing = storage.documents.get(params.id)

    const doc = params.doc ?? params.body?.doc
    const docAsUpsert = params.doc_as_upsert ?? params.body?.doc_as_upsert
    const upsert = params.upsert ?? params.body?.upsert

    if (!existing) {
      if (docAsUpsert && doc) {
        const storedDoc: StoredDocument = {
          _source: doc as Record<string, unknown>,
          _version: 1,
          _seq_no: generateSeqNo(),
          _primary_term: 1,
        }
        storage.documents.set(params.id, storedDoc)
        storage.updatedAt = new Date()

        return {
          _index: params.index,
          _id: params.id,
          _version: 1,
          result: 'created',
          _shards: {
            total: 1,
            successful: 1,
            failed: 0,
          },
          _seq_no: storedDoc._seq_no,
          _primary_term: 1,
        }
      }

      if (upsert) {
        const storedDoc: StoredDocument = {
          _source: upsert as Record<string, unknown>,
          _version: 1,
          _seq_no: generateSeqNo(),
          _primary_term: 1,
        }
        storage.documents.set(params.id, storedDoc)
        storage.updatedAt = new Date()

        return {
          _index: params.index,
          _id: params.id,
          _version: 1,
          result: 'created',
          _shards: {
            total: 1,
            successful: 1,
            failed: 0,
          },
          _seq_no: storedDoc._seq_no,
          _primary_term: 1,
        }
      }

      throw new DocumentNotFoundError(params.index, params.id)
    }

    if (doc) {
      const updatedSource = { ...existing._source, ...doc }

      // Check if document actually changed
      if (JSON.stringify(updatedSource) === JSON.stringify(existing._source)) {
        return {
          _index: params.index,
          _id: params.id,
          _version: existing._version,
          result: 'noop',
          _shards: {
            total: 1,
            successful: 1,
            failed: 0,
          },
          _seq_no: existing._seq_no,
          _primary_term: existing._primary_term,
        }
      }

      const storedDoc: StoredDocument = {
        _source: updatedSource,
        _version: existing._version + 1,
        _seq_no: generateSeqNo(),
        _primary_term: 1,
      }
      storage.documents.set(params.id, storedDoc)
      storage.updatedAt = new Date()

      return {
        _index: params.index,
        _id: params.id,
        _version: storedDoc._version,
        result: 'updated',
        _shards: {
          total: 1,
          successful: 1,
          failed: 0,
        },
        _seq_no: storedDoc._seq_no,
        _primary_term: 1,
      }
    }

    return {
      _index: params.index,
      _id: params.id,
      _version: existing._version,
      result: 'noop',
      _shards: {
        total: 1,
        successful: 1,
        failed: 0,
      },
      _seq_no: existing._seq_no,
      _primary_term: existing._primary_term,
    }
  }

  async deleteByQuery(params: DeleteByQueryRequest): Promise<DeleteByQueryResponse> {
    const startTime = Date.now()
    const indices = Array.isArray(params.index) ? params.index : [params.index]
    const query = params.query ?? params.body?.query

    let deleted = 0
    let total = 0

    for (const indexName of indices) {
      const storage = getIndexStorageIfExists(indexName)
      if (!storage) continue

      const toDelete: string[] = []
      for (const [id, doc] of storage.documents) {
        if (matchesQuery(doc._source, query, id)) {
          toDelete.push(id)
          total++
        }
      }

      for (const id of toDelete) {
        storage.documents.delete(id)
        deleted++
      }

      storage.updatedAt = new Date()
    }

    return {
      took: Date.now() - startTime,
      timed_out: false,
      total,
      deleted,
      batches: 1,
      version_conflicts: 0,
      noops: 0,
      retries: {
        bulk: 0,
        search: 0,
      },
      failures: [],
    }
  }

  async updateByQuery(params: UpdateByQueryRequest): Promise<UpdateByQueryResponse> {
    const startTime = Date.now()
    const indices = Array.isArray(params.index) ? params.index : [params.index]
    const query = params.query ?? params.body?.query
    const script = params.script ?? params.body?.script

    let updated = 0
    let total = 0

    for (const indexName of indices) {
      const storage = getIndexStorageIfExists(indexName)
      if (!storage) continue

      for (const [id, doc] of storage.documents) {
        if (matchesQuery(doc._source, query, id)) {
          total++

          if (script) {
            // Simple script execution - just increment/decrement for now
            const source = script.source
            const params = script.params ?? {}

            if (source.includes('ctx._source')) {
              // Very basic script support
              const match = source.match(/ctx\._source\.(\w+)\s*[+=]+\s*params\.(\w+)/)
              if (match) {
                const field = match[1]
                const paramName = match[2]
                const value = params[paramName]
                if (typeof doc._source[field] === 'number' && typeof value === 'number') {
                  doc._source[field] = (doc._source[field] as number) + value
                  doc._version++
                  doc._seq_no = generateSeqNo()
                  updated++
                }
              }
            }
          }
        }
      }

      storage.updatedAt = new Date()
    }

    return {
      took: Date.now() - startTime,
      timed_out: false,
      total,
      updated,
      deleted: 0,
      batches: 1,
      version_conflicts: 0,
      noops: total - updated,
      retries: {
        bulk: 0,
        search: 0,
      },
      failures: [],
    }
  }

  async bulk<T = Record<string, unknown>>(params: BulkRequest<T>): Promise<BulkResponse> {
    const startTime = Date.now()
    const operations = params.operations ?? params.body ?? []
    const defaultIndex = params.index

    const items: BulkResponse['items'] = []
    let errors = false

    let i = 0
    while (i < operations.length) {
      const action = operations[i] as BulkAction
      let result: BulkResponse['items'][0] = {}

      if ('index' in action) {
        const { _index, _id } = action.index
        const index = _index ?? defaultIndex
        const doc = operations[i + 1] as T
        i += 2

        if (!index) {
          errors = true
          result.index = {
            _index: '',
            _id: _id ?? '',
            status: 400,
            error: {
              type: 'action_request_validation_exception',
              reason: 'index is missing',
            },
          }
        } else {
          try {
            const response = await this.index({ index, id: _id, document: doc })
            result.index = {
              _index: response._index,
              _id: response._id,
              _version: response._version,
              result: response.result,
              status: response.result === 'created' ? 201 : 200,
              _seq_no: response._seq_no,
              _primary_term: response._primary_term,
            }
          } catch (e) {
            errors = true
            result.index = {
              _index: index,
              _id: _id ?? '',
              status: 500,
              error: {
                type: 'exception',
                reason: (e as Error).message,
              },
            }
          }
        }
      } else if ('create' in action) {
        const { _index, _id } = action.create
        const index = _index ?? defaultIndex
        const doc = operations[i + 1] as T
        i += 2

        if (!index) {
          errors = true
          result.create = {
            _index: '',
            _id: _id ?? '',
            status: 400,
            error: {
              type: 'action_request_validation_exception',
              reason: 'index is missing',
            },
          }
        } else {
          const storage = getIndexStorage(index)
          const id = _id ?? generateDocId()

          if (storage.documents.has(id)) {
            errors = true
            result.create = {
              _index: index,
              _id: id,
              status: 409,
              error: {
                type: 'version_conflict_engine_exception',
                reason: `[${id}]: version conflict, document already exists`,
              },
            }
          } else {
            const response = await this.index({ index, id, document: doc })
            result.create = {
              _index: response._index,
              _id: response._id,
              _version: response._version,
              result: response.result,
              status: 201,
              _seq_no: response._seq_no,
              _primary_term: response._primary_term,
            }
          }
        }
      } else if ('update' in action) {
        const { _index, _id } = action.update
        const index = _index ?? defaultIndex
        const updateDoc = operations[i + 1] as { doc?: Partial<T>; doc_as_upsert?: boolean }
        i += 2

        if (!index) {
          errors = true
          result.update = {
            _index: '',
            _id: _id,
            status: 400,
            error: {
              type: 'action_request_validation_exception',
              reason: 'index is missing',
            },
          }
        } else {
          try {
            const response = await this.update({
              index,
              id: _id,
              doc: updateDoc.doc,
              doc_as_upsert: updateDoc.doc_as_upsert,
            })
            result.update = {
              _index: response._index,
              _id: response._id,
              _version: response._version,
              result: response.result,
              status: 200,
              _seq_no: response._seq_no,
              _primary_term: response._primary_term,
            }
          } catch (e) {
            errors = true
            result.update = {
              _index: index,
              _id: _id,
              status: e instanceof DocumentNotFoundError ? 404 : 500,
              error: {
                type: e instanceof DocumentNotFoundError ? 'document_missing_exception' : 'exception',
                reason: (e as Error).message,
              },
            }
          }
        }
      } else if ('delete' in action) {
        const { _index, _id } = action.delete
        const index = _index ?? defaultIndex
        i += 1

        if (!index) {
          errors = true
          result.delete = {
            _index: '',
            _id: _id,
            status: 400,
            error: {
              type: 'action_request_validation_exception',
              reason: 'index is missing',
            },
          }
        } else {
          const response = await this.delete({ index, id: _id })
          result.delete = {
            _index: response._index,
            _id: response._id,
            _version: response._version,
            result: response.result,
            status: response.result === 'deleted' ? 200 : 404,
            _seq_no: response._seq_no,
            _primary_term: response._primary_term,
          }
        }
      } else {
        i++
      }

      items.push(result)
    }

    return {
      took: Date.now() - startTime,
      errors,
      items,
    }
  }

  async search<T = Record<string, unknown>>(params?: SearchRequest): Promise<SearchResponse<T>> {
    const startTime = Date.now()

    const indices = params?.index
      ? (Array.isArray(params.index) ? params.index : [params.index])
      : Array.from(globalStorage.keys())

    const query = params?.query ?? params?.body?.query
    const sort = params?.sort ?? params?.body?.sort
    const from = params?.from ?? params?.body?.from ?? 0
    const size = params?.size ?? params?.body?.size ?? 10
    const sourceFilter = params?._source ?? params?.body?._source
    const aggs = params?.aggs ?? params?.aggregations ?? params?.body?.aggs ?? params?.body?.aggregations
    const highlight = params?.highlight ?? params?.body?.highlight
    const searchAfter = params?.body?.search_after

    // Collect all matching documents
    const allDocs: Array<{ id: string; doc: Record<string, unknown>; score: number; index: string }> = []

    for (const indexName of indices) {
      const storage = getIndexStorageIfExists(indexName)
      if (!storage) continue

      for (const [id, storedDoc] of storage.documents) {
        if (matchesQuery(storedDoc._source, query, id)) {
          allDocs.push({
            id,
            doc: storedDoc._source,
            score: calculateScore(storedDoc._source, query),
            index: indexName,
          })
        }
      }
    }

    // Sort documents
    const sortedDocs = sortDocs(allDocs, sort)

    // Handle search_after
    let startIdx = from
    if (searchAfter && searchAfter.length > 0) {
      const searchAfterIdx = sortedDocs.findIndex((d) => {
        for (let i = 0; i < searchAfter.length; i++) {
          if (d.sortValues[i] !== searchAfter[i]) {
            // Check if this document comes after the search_after values
            const dVal = d.sortValues[i]
            const saVal = searchAfter[i]
            if (dVal === null || saVal === null) continue
            if (typeof dVal === 'string' && typeof saVal === 'string') {
              if (dVal <= saVal) return false
            } else if (typeof dVal === 'number' && typeof saVal === 'number') {
              if (dVal <= saVal) return false
            }
            return true
          }
        }
        return false
      })
      startIdx = searchAfterIdx >= 0 ? searchAfterIdx : sortedDocs.length
    }

    // Paginate
    const paginatedDocs = sortedDocs.slice(startIdx, startIdx + size)

    // Calculate max score
    let maxScore: number | null = null
    if (sortedDocs.length > 0) {
      maxScore = Math.max(...sortedDocs.map((d) => d.score))
    }

    // Build hits
    const hits: SearchHit<T>[] = paginatedDocs.map((d) => {
      const hit: SearchHit<T> = {
        _index: d.index,
        _id: d.id,
        _score: sort ? null : d.score,
      }

      // Add source
      const filteredSource = filterSource(d.doc as T, sourceFilter)
      if (filteredSource !== undefined) {
        hit._source = filteredSource
      }

      // Add sort values
      if (sort && d.sortValues.length > 0) {
        hit.sort = d.sortValues
      }

      // Add highlighting
      if (highlight) {
        hit.highlight = generateHighlights(d.doc, query, highlight)
      }

      return hit
    })

    // Execute aggregations
    const aggregations = executeAggregations(allDocs, aggs)

    // Handle scroll
    let scrollId: string | undefined
    if (params?.scroll) {
      scrollId = generateScrollId()
      const ttl = parseScrollTimeout(params.scroll)
      scrollStorage.set(scrollId, {
        index: indices,
        query,
        sort,
        size,
        from: startIdx + size,
        _source: sourceFilter,
        expiresAt: Date.now() + ttl,
      })
    }

    return {
      took: Date.now() - startTime,
      timed_out: false,
      _shards: {
        total: indices.length,
        successful: indices.length,
        skipped: 0,
        failed: 0,
      },
      hits: {
        total: { value: allDocs.length, relation: 'eq' },
        max_score: sort ? null : maxScore,
        hits,
      },
      aggregations,
      _scroll_id: scrollId,
    }
  }

  async count(params?: CountRequest): Promise<CountResponse> {
    const indices = params?.index
      ? (Array.isArray(params.index) ? params.index : [params.index])
      : Array.from(globalStorage.keys())

    const query = params?.query ?? params?.body?.query
    let count = 0

    for (const indexName of indices) {
      const storage = getIndexStorageIfExists(indexName)
      if (!storage) continue

      for (const [id, doc] of storage.documents) {
        if (matchesQuery(doc._source, query, id)) {
          count++
        }
      }
    }

    return {
      count,
      _shards: {
        total: indices.length,
        successful: indices.length,
        skipped: 0,
        failed: 0,
      },
    }
  }

  async scroll<T = Record<string, unknown>>(params: ScrollRequest): Promise<SearchResponse<T>> {
    const scrollId = params.scroll_id ?? params.body?.scroll_id
    const context = scrollStorage.get(scrollId)

    if (!context || context.expiresAt < Date.now()) {
      scrollStorage.delete(scrollId)
      throw new ElasticsearchError('No search context found for scroll id', 404)
    }

    // Update expiration
    if (params.scroll ?? params.body?.scroll) {
      const ttl = parseScrollTimeout(params.scroll ?? params.body?.scroll ?? '1m')
      context.expiresAt = Date.now() + ttl
    }

    const result = await this.search<T>({
      index: context.index,
      query: context.query,
      sort: context.sort,
      from: context.from,
      size: context.size,
      _source: context._source,
    })

    // Update from for next scroll
    context.from += context.size

    // Generate new scroll ID
    const newScrollId = generateScrollId()
    scrollStorage.delete(scrollId)
    scrollStorage.set(newScrollId, context)

    return {
      ...result,
      _scroll_id: newScrollId,
    }
  }

  async clearScroll(params?: ClearScrollRequest): Promise<ClearScrollResponse> {
    const scrollIds = params?.scroll_id ?? params?.body?.scroll_id ?? []
    const ids = Array.isArray(scrollIds) ? scrollIds : [scrollIds]

    let numFreed = 0
    for (const id of ids) {
      if (scrollStorage.delete(id)) {
        numFreed++
      }
    }

    return {
      succeeded: true,
      num_freed: numFreed,
    }
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse scroll timeout string (e.g., "1m", "5s")
 */
function parseScrollTimeout(timeout: string): number {
  const match = timeout.match(/^(\d+)(s|m|h)?$/)
  if (!match) return 60000 // Default 1 minute

  const value = parseInt(match[1], 10)
  const unit = match[2] || 's'

  switch (unit) {
    case 's': return value * 1000
    case 'm': return value * 60000
    case 'h': return value * 3600000
    default: return value * 1000
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clear all in-memory storage (useful for tests)
 */
export function clearAllIndices(): void {
  globalStorage.clear()
  scrollStorage.clear()
  seqNoCounter = 0
}
