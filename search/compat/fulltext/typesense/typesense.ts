/**
 * @dotdo/typesense - Typesense SDK compat
 *
 * Drop-in replacement for Typesense backed by DO SQLite with FTS5.
 * This in-memory implementation matches the Typesense JavaScript API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://typesense.org/docs/
 */
import type {
  TypesenseClient,
  ClientConfig,
  Collection,
  CollectionSchema,
  CollectionUpdateSchema,
  CollectionsApi,
  CollectionApi,
  DocumentsApi,
  DocumentApi,
  Document,
  IndexedDocument,
  SearchParams,
  SearchResult,
  SearchHit,
  SearchHighlight,
  FacetResult,
  FacetCount,
  FacetStats,
  ImportResponse,
  ExportOptions,
  MultiSearchRequest,
  MultiSearchResult,
  Field,
  FieldType,
  GeoPoint,
} from './types'
import {
  TypesenseError,
  ObjectNotFound,
  ObjectAlreadyExists,
  ObjectUnprocessable,
  RequestMalformed,
} from './types'

// Re-export error types
export {
  TypesenseError,
  ObjectNotFound,
  ObjectAlreadyExists,
  ObjectUnprocessable,
  RequestMalformed,
} from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

interface CollectionStorage {
  schema: CollectionSchema
  documents: Map<string, IndexedDocument>
  createdAt: number
}

const globalStorage = new Map<string, CollectionStorage>()

let idCounter = 0

function generateId(): string {
  return `${Date.now()}-${++idCounter}-${Math.random().toString(36).slice(2, 9)}`
}

function getCollectionStorage(name: string): CollectionStorage {
  const storage = globalStorage.get(name)
  if (!storage) {
    throw new ObjectNotFound(`Collection \`${name}\` not found.`)
  }
  return storage
}

// ============================================================================
// TOKENIZATION & FTS
// ============================================================================

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s*"]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

function extractSearchableText(doc: IndexedDocument, fields: string[]): string {
  const texts: string[] = []

  for (const field of fields) {
    const value = doc[field]
    if (value === null || value === undefined) continue

    if (typeof value === 'string') {
      texts.push(value)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          texts.push(item)
        } else if (typeof item === 'number' || typeof item === 'boolean') {
          texts.push(String(item))
        }
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      texts.push(String(value))
    }
  }

  return texts.join(' ')
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============================================================================
// GEO UTILITIES
// ============================================================================

/**
 * Calculate distance between two points in meters using Haversine formula
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Parse geo filter: location:(lat, lng, distance unit)
 */
function parseGeoFilter(filterStr: string): {
  field: string
  lat: number
  lng: number
  distanceMeters: number
} | null {
  const match = filterStr.match(/^(\w+):\(([\d.-]+),\s*([\d.-]+),\s*([\d.]+)\s*(km|mi|m)\)$/)
  if (!match) return null

  const [, field, latStr, lngStr, distStr, unit] = match
  const lat = parseFloat(latStr)
  const lng = parseFloat(lngStr)
  const dist = parseFloat(distStr)

  let distanceMeters = dist
  if (unit === 'km') distanceMeters = dist * 1000
  else if (unit === 'mi') distanceMeters = dist * 1609.34

  return { field, lat, lng, distanceMeters }
}

/**
 * Parse geo sort: field(lat, lng):asc/desc
 */
function parseGeoSort(sortStr: string): {
  field: string
  lat: number
  lng: number
  direction: 'asc' | 'desc'
} | null {
  const match = sortStr.match(/^(\w+)\(([\d.-]+),\s*([\d.-]+)\):(asc|desc)$/)
  if (!match) return null

  const [, field, latStr, lngStr, direction] = match
  return {
    field,
    lat: parseFloat(latStr),
    lng: parseFloat(lngStr),
    direction: direction as 'asc' | 'desc',
  }
}

// ============================================================================
// FILTER PARSING
// ============================================================================

function parseFilterBy(filterStr: string | undefined): (doc: IndexedDocument) => { pass: boolean; geoDistances?: Record<string, number> } {
  if (!filterStr || filterStr.trim() === '') {
    return () => ({ pass: true })
  }

  // Check for geo filter first
  const geoFilter = parseGeoFilter(filterStr)
  if (geoFilter) {
    return (doc) => {
      const location = doc[geoFilter.field] as GeoPoint | undefined
      if (!location || !Array.isArray(location) || location.length !== 2) {
        return { pass: false }
      }
      const [lat, lng] = location
      const distance = haversineDistance(geoFilter.lat, geoFilter.lng, lat, lng)
      if (distance <= geoFilter.distanceMeters) {
        return { pass: true, geoDistances: { [geoFilter.field]: distance } }
      }
      return { pass: false }
    }
  }

  // Parse compound expressions
  const tokens = tokenizeFilterExpression(filterStr)
  let pos = 0

  function current(): string | undefined {
    return tokens[pos]
  }

  function consume(): string {
    return tokens[pos++]
  }

  function parseExpression(): (doc: IndexedDocument) => { pass: boolean; geoDistances?: Record<string, number> } {
    return parseOr()
  }

  function parseOr(): (doc: IndexedDocument) => { pass: boolean; geoDistances?: Record<string, number> } {
    let left = parseAnd()
    while (current() === '||') {
      consume()
      const right = parseAnd()
      const prevLeft = left
      left = (doc) => {
        const leftResult = prevLeft(doc)
        const rightResult = right(doc)
        return {
          pass: leftResult.pass || rightResult.pass,
          geoDistances: { ...leftResult.geoDistances, ...rightResult.geoDistances },
        }
      }
    }
    return left
  }

  function parseAnd(): (doc: IndexedDocument) => { pass: boolean; geoDistances?: Record<string, number> } {
    let left = parsePrimary()
    while (current() === '&&') {
      consume()
      const right = parsePrimary()
      const prevLeft = left
      left = (doc) => {
        const leftResult = prevLeft(doc)
        const rightResult = right(doc)
        return {
          pass: leftResult.pass && rightResult.pass,
          geoDistances: { ...leftResult.geoDistances, ...rightResult.geoDistances },
        }
      }
    }
    return left
  }

  function parsePrimary(): (doc: IndexedDocument) => { pass: boolean; geoDistances?: Record<string, number> } {
    if (current() === '(') {
      consume()
      const inner = parseExpression()
      if (current() === ')') consume()
      return inner
    }
    return parseCondition()
  }

  function parseCondition(): (doc: IndexedDocument) => { pass: boolean; geoDistances?: Record<string, number> } {
    const token = consume()
    if (!token) return () => ({ pass: true })

    // Check for geo filter in nested position
    const geoFilter = parseGeoFilter(token)
    if (geoFilter) {
      return (doc) => {
        const location = doc[geoFilter.field] as GeoPoint | undefined
        if (!location || !Array.isArray(location) || location.length !== 2) {
          return { pass: false }
        }
        const [lat, lng] = location
        const distance = haversineDistance(geoFilter.lat, geoFilter.lng, lat, lng)
        if (distance <= geoFilter.distanceMeters) {
          return { pass: true, geoDistances: { [geoFilter.field]: distance } }
        }
        return { pass: false }
      }
    }

    // Parse field:operator:value or field:=value or field:[range]
    const colonIdx = token.indexOf(':')
    if (colonIdx === -1) return () => ({ pass: true })

    const field = token.slice(0, colonIdx)
    let rest = token.slice(colonIdx + 1)

    // Check for range: field:[min..max]
    const rangeMatch = rest.match(/^\[([\d.-]+)\.\.([\d.-]+)\]$/)
    if (rangeMatch) {
      const min = parseFloat(rangeMatch[1])
      const max = parseFloat(rangeMatch[2])
      return (doc) => {
        const value = doc[field]
        if (typeof value !== 'number') return { pass: false }
        return { pass: value >= min && value <= max }
      }
    }

    // Check for IN values: field:[val1,val2]
    const inMatch = rest.match(/^\[([^\]]+)\]$/)
    if (inMatch) {
      const values = inMatch[1].split(',').map((v) => v.trim())
      return (doc) => {
        const value = doc[field]
        if (Array.isArray(value)) {
          return { pass: value.some((v) => values.includes(String(v))) }
        }
        return { pass: values.includes(String(value)) }
      }
    }

    // Parse operator
    let operator = '='
    if (rest.startsWith(':=')) {
      operator = '='
      rest = rest.slice(2)
    } else if (rest.startsWith('=')) {
      operator = '='
      rest = rest.slice(1)
    } else if (rest.startsWith('!=')) {
      operator = '!='
      rest = rest.slice(2)
    } else if (rest.startsWith('>=')) {
      operator = '>='
      rest = rest.slice(2)
    } else if (rest.startsWith('<=')) {
      operator = '<='
      rest = rest.slice(2)
    } else if (rest.startsWith('>')) {
      operator = '>'
      rest = rest.slice(1)
    } else if (rest.startsWith('<')) {
      operator = '<'
      rest = rest.slice(1)
    }

    // Parse value
    const value = parseValue(rest)

    return (doc) => {
      const fieldValue = doc[field]

      // Handle array fields
      if (Array.isArray(fieldValue)) {
        switch (operator) {
          case '=':
            return { pass: fieldValue.includes(value) }
          case '!=':
            return { pass: !fieldValue.includes(value) }
          default:
            return { pass: fieldValue.some((fv) => compareValues(fv, value, operator)) }
        }
      }

      return { pass: compareValues(fieldValue, value, operator) }
    }
  }

  function parseValue(str: string): string | number | boolean {
    // Remove quotes
    str = str.replace(/^["']|["']$/g, '')

    // Boolean
    if (str === 'true') return true
    if (str === 'false') return false

    // Try to parse as number
    const num = Number(str)
    if (!isNaN(num) && str !== '') return num

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

function tokenizeFilterExpression(filter: string): string[] {
  const tokens: string[] = []
  let current = ''
  let geoDepth = 0  // Track depth inside geo expressions like field:(lat, lng, dist)
  let i = 0

  while (i < filter.length) {
    const char = filter[i]

    if (geoDepth > 0) {
      // Inside a geo expression
      current += char
      if (char === '(') geoDepth++
      else if (char === ')') {
        geoDepth--
        if (geoDepth === 0) {
          tokens.push(current.trim())
          current = ''
        }
      }
    } else if (char === '(' && current.includes(':')) {
      // Start of geo expression like "location:(lat, lng, dist)"
      current += char
      geoDepth = 1
    } else if (char === '(') {
      // Start of grouping parenthesis
      if (current.trim()) {
        tokens.push(current.trim())
        current = ''
      }
      tokens.push('(')
    } else if (char === ')') {
      // End of grouping parenthesis
      if (current.trim()) {
        tokens.push(current.trim())
        current = ''
      }
      tokens.push(')')
    } else if (filter.slice(i, i + 2) === '&&') {
      if (current.trim()) {
        tokens.push(current.trim())
        current = ''
      }
      tokens.push('&&')
      i++
    } else if (filter.slice(i, i + 2) === '||') {
      if (current.trim()) {
        tokens.push(current.trim())
        current = ''
      }
      tokens.push('||')
      i++
    } else if (char === ' ' || char === '\t' || char === '\n') {
      // Skip whitespace outside geo expressions
    } else {
      current += char
    }
    i++
  }

  if (current.trim()) {
    tokens.push(current.trim())
  }

  return tokens.filter((t) => t.length > 0)
}

// ============================================================================
// SORTING
// ============================================================================

/**
 * Split sort string by comma, respecting parentheses
 */
function splitSortCriteria(sortStr: string): string[] {
  const criteria: string[] = []
  let current = ''
  let depth = 0

  for (const char of sortStr) {
    if (char === '(') {
      depth++
      current += char
    } else if (char === ')') {
      depth--
      current += char
    } else if (char === ',' && depth === 0) {
      if (current.trim()) {
        criteria.push(current.trim())
      }
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) {
    criteria.push(current.trim())
  }

  return criteria
}

/**
 * Precompute geo distances for sorting
 */
function precomputeGeoDistances(
  docs: { doc: IndexedDocument; geoDistances?: Record<string, number> }[],
  sortStr: string | undefined
): void {
  if (!sortStr) return

  const sortCriteria = splitSortCriteria(sortStr)

  for (const criterion of sortCriteria) {
    const geoSort = parseGeoSort(criterion)
    if (geoSort) {
      for (const item of docs) {
        const loc = item.doc[geoSort.field] as GeoPoint | undefined
        if (loc && Array.isArray(loc) && loc.length === 2) {
          const dist = haversineDistance(geoSort.lat, geoSort.lng, loc[0], loc[1])
          item.geoDistances = { ...item.geoDistances, [geoSort.field]: dist }
        }
      }
    }
  }
}

function parseSortBy(sortStr: string | undefined, searchLat?: number, searchLng?: number): (a: { doc: IndexedDocument; geoDistances?: Record<string, number> }, b: { doc: IndexedDocument; geoDistances?: Record<string, number> }) => number {
  if (!sortStr || sortStr.trim() === '') {
    return () => 0
  }

  const sortCriteria = splitSortCriteria(sortStr)

  return (a, b) => {
    for (const criterion of sortCriteria) {
      // Check for geo sort
      const geoSort = parseGeoSort(criterion)
      if (geoSort) {
        const aDist = a.geoDistances?.[geoSort.field]
        const bDist = b.geoDistances?.[geoSort.field]

        if (aDist === undefined && bDist === undefined) continue
        if (aDist === undefined) return geoSort.direction === 'asc' ? 1 : -1
        if (bDist === undefined) return geoSort.direction === 'asc' ? -1 : 1

        const diff = geoSort.direction === 'asc' ? aDist - bDist : bDist - aDist
        if (diff !== 0) return diff
        continue
      }

      // Regular field sort
      const [field, direction] = criterion.split(':')
      const aVal = a.doc[field]
      const bVal = b.doc[field]

      if (aVal === bVal) continue
      if (aVal === undefined || aVal === null) return direction === 'asc' ? 1 : -1
      if (bVal === undefined || bVal === null) return direction === 'asc' ? -1 : 1

      let diff: number
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        diff = aVal - bVal
      } else {
        diff = String(aVal).localeCompare(String(bVal))
      }

      if (direction === 'desc') diff = -diff
      if (diff !== 0) return diff
    }

    return 0
  }
}

// ============================================================================
// SEARCH SCORING
// ============================================================================

function calculateScore(doc: IndexedDocument, query: string, queryFields: string[]): number {
  if (!query || query === '*') return 1

  const searchText = extractSearchableText(doc, queryFields).toLowerCase()
  const queryTokens = tokenize(query)

  let score = 0
  let matchedTokens = 0

  for (const token of queryTokens) {
    const regex = new RegExp(`\\b${escapeRegex(token)}\\b`, 'i')
    if (regex.test(searchText)) {
      score += 2
      matchedTokens++
    } else if (searchText.includes(token.toLowerCase())) {
      score += 1
      matchedTokens++
    }
  }

  if (queryTokens.length > 0) {
    score *= matchedTokens / queryTokens.length
  }

  return score
}

function generateHighlights(
  doc: IndexedDocument,
  query: string,
  queryFields: string[],
  highlightFields?: string,
  startTag: string = '<mark>',
  endTag: string = '</mark>'
): SearchHighlight[] {
  if (!query || query === '*') return []

  const highlights: SearchHighlight[] = []
  const fields = highlightFields ? highlightFields.split(',').map((f) => f.trim()) : queryFields
  const queryTokens = tokenize(query)

  for (const field of fields) {
    const value = doc[field]
    if (value === null || value === undefined) continue
    if (typeof value !== 'string') continue

    const matchedTokens: string[] = []
    let highlighted = value

    for (const token of queryTokens) {
      const regex = new RegExp(`(${escapeRegex(token)})`, 'gi')
      if (regex.test(value)) {
        matchedTokens.push(token)
        highlighted = highlighted.replace(regex, `${startTag}$1${endTag}`)
      }
    }

    if (matchedTokens.length > 0) {
      highlights.push({
        field,
        snippet: highlighted,
        value: highlighted,
        matched_tokens: matchedTokens,
      })
    }
  }

  return highlights
}

// ============================================================================
// TYPE VALIDATION
// ============================================================================

function validateDocument(doc: Document, schema: CollectionSchema): IndexedDocument {
  const validated: IndexedDocument = { id: doc.id ?? generateId() }

  for (const field of schema.fields) {
    if (field.name === '.*' && field.type === 'auto') {
      // Auto schema - copy all fields
      for (const [key, value] of Object.entries(doc)) {
        if (key !== 'id') {
          validated[key] = value
        }
      }
      continue
    }

    const value = doc[field.name]

    if (value === undefined || value === null) {
      if (!field.optional) {
        // Field is required but missing - for now allow it (Typesense is lenient)
      }
      continue
    }

    validated[field.name] = coerceValue(value, field.type, field.name)
  }

  // Copy any extra fields not in schema (Typesense allows this)
  for (const [key, value] of Object.entries(doc)) {
    if (key !== 'id' && !(key in validated)) {
      validated[key] = value
    }
  }

  return validated
}

function coerceValue(value: unknown, type: FieldType, fieldName: string): unknown {
  switch (type) {
    case 'string':
      if (typeof value === 'string') return value
      if (typeof value === 'number' || typeof value === 'boolean') return String(value)
      throw new ObjectUnprocessable(`Field \`${fieldName}\` must be a string`)

    case 'string[]':
      if (Array.isArray(value)) return value.map((v) => String(v))
      throw new ObjectUnprocessable(`Field \`${fieldName}\` must be an array of strings`)

    case 'int32':
    case 'int64':
      if (typeof value === 'number' && Number.isInteger(value)) return value
      if (typeof value === 'string') {
        const num = parseInt(value, 10)
        if (!isNaN(num)) return num
      }
      throw new ObjectUnprocessable(`Field \`${fieldName}\` must be an integer`)

    case 'int32[]':
    case 'int64[]':
      if (Array.isArray(value)) return value.map((v) => parseInt(String(v), 10))
      throw new ObjectUnprocessable(`Field \`${fieldName}\` must be an array of integers`)

    case 'float':
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const num = parseFloat(value)
        if (!isNaN(num)) return num
      }
      throw new ObjectUnprocessable(`Field \`${fieldName}\` must be a float`)

    case 'float[]':
      if (Array.isArray(value)) return value.map((v) => parseFloat(String(v)))
      throw new ObjectUnprocessable(`Field \`${fieldName}\` must be an array of floats`)

    case 'bool':
      if (typeof value === 'boolean') return value
      if (value === 'true') return true
      if (value === 'false') return false
      throw new ObjectUnprocessable(`Field \`${fieldName}\` must be a boolean`)

    case 'bool[]':
      if (Array.isArray(value)) return value.map((v) => v === true || v === 'true')
      throw new ObjectUnprocessable(`Field \`${fieldName}\` must be an array of booleans`)

    case 'geopoint':
      if (Array.isArray(value) && value.length === 2) {
        const [lat, lng] = value
        if (typeof lat === 'number' && typeof lng === 'number') return value
      }
      throw new ObjectUnprocessable(`Field \`${fieldName}\` must be a geopoint [lat, lng]`)

    case 'geopoint[]':
      if (Array.isArray(value)) {
        return value.map((v) => {
          if (Array.isArray(v) && v.length === 2) return v
          throw new ObjectUnprocessable(`Field \`${fieldName}\` must be an array of geopoints`)
        })
      }
      throw new ObjectUnprocessable(`Field \`${fieldName}\` must be an array of geopoints`)

    case 'object':
    case 'object[]':
    case 'auto':
    case 'string*':
      return value

    default:
      return value
  }
}

// ============================================================================
// FACETING
// ============================================================================

function calculateFacets(
  docs: IndexedDocument[],
  facetBy: string | undefined,
  schema: CollectionSchema,
  maxFacetValues?: number
): FacetResult[] {
  if (!facetBy) return []

  const facetFields = facetBy.split(',').map((f) => f.trim())
  const results: FacetResult[] = []

  for (const fieldName of facetFields) {
    const field = schema.fields.find((f) => f.name === fieldName)
    if (!field || !field.facet) {
      // Still compute facets even if not marked as facet (Typesense is lenient)
    }

    const counts: Record<string, number> = {}
    const numericValues: number[] = []

    for (const doc of docs) {
      const value = doc[fieldName]

      if (value === undefined || value === null) continue

      if (Array.isArray(value)) {
        for (const v of value) {
          const key = String(v)
          counts[key] = (counts[key] ?? 0) + 1
          if (typeof v === 'number') numericValues.push(v)
        }
      } else {
        const key = String(value)
        counts[key] = (counts[key] ?? 0) + 1
        if (typeof value === 'number') numericValues.push(value)
      }
    }

    // Convert to FacetCount array and sort by count
    let facetCounts: FacetCount[] = Object.entries(counts)
      .map(([value, count]) => ({
        value,
        count,
        highlighted: value,
      }))
      .sort((a, b) => b.count - a.count)

    // Apply max_facet_values limit
    if (maxFacetValues && maxFacetValues > 0) {
      facetCounts = facetCounts.slice(0, maxFacetValues)
    }

    // Calculate stats for numeric fields
    let stats: FacetStats | undefined
    if (numericValues.length > 0) {
      const sum = numericValues.reduce((a, b) => a + b, 0)
      stats = {
        min: Math.min(...numericValues),
        max: Math.max(...numericValues),
        avg: sum / numericValues.length,
        sum,
        total_values: numericValues.length,
      }
    }

    results.push({
      field_name: fieldName,
      counts: facetCounts,
      stats,
    })
  }

  return results
}

// ============================================================================
// DOCUMENTS API IMPLEMENTATION
// ============================================================================

class DocumentsApiImpl<T extends Document = Document> implements DocumentsApi<T> {
  private collectionName: string

  constructor(collectionName: string) {
    this.collectionName = collectionName
  }

  async create(
    document: T,
    options?: { action?: 'create' | 'upsert' | 'update' | 'emplace' }
  ): Promise<T & { id: string }> {
    const storage = getCollectionStorage(this.collectionName)
    const action = options?.action ?? 'create'

    const validated = validateDocument(document as Document, storage.schema)

    if (action === 'create' && storage.documents.has(validated.id)) {
      throw new ObjectAlreadyExists(`A document with id \`${validated.id}\` already exists.`)
    }

    if (action === 'update' && !storage.documents.has(validated.id)) {
      throw new ObjectNotFound(`Document with id \`${validated.id}\` not found.`)
    }

    if (action === 'upsert' || action === 'emplace') {
      // Upsert - create or replace
      storage.documents.set(validated.id, validated)
    } else if (action === 'update') {
      // Update - merge with existing
      const existing = storage.documents.get(validated.id)!
      storage.documents.set(validated.id, { ...existing, ...validated })
    } else {
      // Create
      storage.documents.set(validated.id, validated)
    }

    return validated as T & { id: string }
  }

  async upsert(document: T): Promise<T & { id: string }> {
    return this.create(document, { action: 'upsert' })
  }

  async update(
    document: Partial<T> & { id: string },
    options?: { filter_by?: string }
  ): Promise<T & { id: string }> {
    const storage = getCollectionStorage(this.collectionName)

    if (options?.filter_by) {
      // Bulk update by filter
      const filterFn = parseFilterBy(options.filter_by)
      for (const [id, doc] of storage.documents) {
        if (filterFn(doc).pass) {
          storage.documents.set(id, { ...doc, ...document, id })
        }
      }
      return document as T & { id: string }
    }

    if (!storage.documents.has(document.id)) {
      throw new ObjectNotFound(`Document with id \`${document.id}\` not found.`)
    }

    const existing = storage.documents.get(document.id)!
    const updated = { ...existing, ...document }
    storage.documents.set(document.id, updated)

    return updated as T & { id: string }
  }

  async delete(options?: { filter_by?: string }): Promise<{ num_deleted: number }> {
    const storage = getCollectionStorage(this.collectionName)

    if (options?.filter_by) {
      const filterFn = parseFilterBy(options.filter_by)
      let numDeleted = 0

      for (const [id, doc] of storage.documents) {
        if (filterFn(doc).pass) {
          storage.documents.delete(id)
          numDeleted++
        }
      }

      return { num_deleted: numDeleted }
    }

    // Delete all
    const count = storage.documents.size
    storage.documents.clear()
    return { num_deleted: count }
  }

  async search(params: SearchParams): Promise<SearchResult<T>> {
    const startTime = performance.now()
    const storage = getCollectionStorage(this.collectionName)

    // Parse query_by fields
    const queryFields = typeof params.query_by === 'string'
      ? params.query_by.split(',').map((f) => f.trim())
      : params.query_by

    // Get all documents
    let docs = Array.from(storage.documents.values())

    // Apply filter_by
    const filterFn = parseFilterBy(params.filter_by)
    const filteredDocs: { doc: IndexedDocument; geoDistances?: Record<string, number> }[] = []

    for (const doc of docs) {
      const result = filterFn(doc)
      if (result.pass) {
        filteredDocs.push({ doc, geoDistances: result.geoDistances })
      }
    }

    // Calculate scores and filter by query
    let scoredDocs: { doc: IndexedDocument; score: number; geoDistances?: Record<string, number> }[]

    if (params.q && params.q !== '*') {
      scoredDocs = filteredDocs
        .map(({ doc, geoDistances }) => ({
          doc,
          score: calculateScore(doc, params.q, queryFields),
          geoDistances,
        }))
        .filter((item) => item.score > 0)
    } else {
      scoredDocs = filteredDocs.map(({ doc, geoDistances }) => ({ doc, score: 1, geoDistances }))
    }

    // Precompute geo distances for sorting
    precomputeGeoDistances(scoredDocs, params.sort_by)

    // Sort
    const sortFn = parseSortBy(params.sort_by)
    scoredDocs.sort((a, b) => {
      // First by relevance if query exists
      if (params.q && params.q !== '*') {
        const scoreDiff = b.score - a.score
        if (scoreDiff !== 0) return scoreDiff
      }
      return sortFn(a, b)
    })

    // Calculate facets before pagination
    const facetResults = calculateFacets(
      scoredDocs.map((s) => s.doc),
      params.facet_by,
      storage.schema,
      params.max_facet_values
    )

    // Pagination
    const page = params.page ?? 1
    const perPage = params.per_page ?? params.limit ?? 10
    const offset = params.offset ?? (page - 1) * perPage
    const limit = params.limit ?? perPage

    const totalHits = scoredDocs.length
    const paginatedDocs = scoredDocs.slice(offset, offset + limit)

    // Build hits
    const startTag = params.highlight_start_tag ?? '<mark>'
    const endTag = params.highlight_end_tag ?? '</mark>'

    const hits: SearchHit<T>[] = paginatedDocs.map(({ doc, score, geoDistances }) => {
      const highlights = generateHighlights(
        doc,
        params.q,
        queryFields,
        params.highlight_fields,
        startTag,
        endTag
      )

      const hit: SearchHit<T> = {
        document: doc as T,
        highlights: highlights.length > 0 ? highlights : undefined,
        text_match: Math.round(score * 1000000),
      }

      if (geoDistances && Object.keys(geoDistances).length > 0) {
        hit.geo_distance_meters = geoDistances
      }

      return hit
    })

    const searchTimeMs = Math.round(performance.now() - startTime)

    return {
      facet_counts: facetResults.length > 0 ? facetResults : undefined,
      found: totalHits,
      out_of: storage.documents.size,
      page,
      request_params: params,
      search_time_ms: searchTimeMs,
      hits,
    }
  }

  async export(options?: ExportOptions): Promise<string> {
    const storage = getCollectionStorage(this.collectionName)
    let docs = Array.from(storage.documents.values())

    if (options?.filter_by) {
      const filterFn = parseFilterBy(options.filter_by)
      docs = docs.filter((doc) => filterFn(doc).pass)
    }

    return docs.map((doc) => JSON.stringify(doc)).join('\n')
  }

  async import(
    documents: T[] | string,
    options?: { action?: 'create' | 'upsert' | 'update' | 'emplace'; batch_size?: number }
  ): Promise<ImportResponse[]> {
    const action = options?.action ?? 'create'
    const results: ImportResponse[] = []

    let docs: T[]
    if (typeof documents === 'string') {
      // Parse JSONL
      docs = documents
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as T)
    } else {
      docs = documents
    }

    for (const doc of docs) {
      try {
        await this.create(doc, { action })
        results.push({ success: true })
      } catch (error) {
        results.push({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          document: JSON.stringify(doc),
        })
      }
    }

    return results
  }
}

// ============================================================================
// DOCUMENT API IMPLEMENTATION
// ============================================================================

class DocumentApiImpl<T extends Document = Document> implements DocumentApi<T> {
  private collectionName: string
  private documentId: string

  constructor(collectionName: string, documentId: string) {
    this.collectionName = collectionName
    this.documentId = documentId
  }

  async retrieve(): Promise<T & { id: string }> {
    const storage = getCollectionStorage(this.collectionName)
    const doc = storage.documents.get(this.documentId)

    if (!doc) {
      throw new ObjectNotFound(`Document with id \`${this.documentId}\` not found.`)
    }

    return doc as T & { id: string }
  }

  async update(document: Partial<T>): Promise<T & { id: string }> {
    const storage = getCollectionStorage(this.collectionName)
    const existing = storage.documents.get(this.documentId)

    if (!existing) {
      throw new ObjectNotFound(`Document with id \`${this.documentId}\` not found.`)
    }

    const updated = { ...existing, ...document, id: this.documentId }
    storage.documents.set(this.documentId, updated)

    return updated as T & { id: string }
  }

  async delete(): Promise<T & { id: string }> {
    const storage = getCollectionStorage(this.collectionName)
    const doc = storage.documents.get(this.documentId)

    if (!doc) {
      throw new ObjectNotFound(`Document with id \`${this.documentId}\` not found.`)
    }

    storage.documents.delete(this.documentId)

    return doc as T & { id: string }
  }
}

// ============================================================================
// COLLECTION API IMPLEMENTATION
// ============================================================================

class CollectionApiImpl<T extends Document = Document> implements CollectionApi<T> {
  private collectionName: string

  constructor(collectionName: string) {
    this.collectionName = collectionName
  }

  async retrieve(): Promise<Collection> {
    const storage = getCollectionStorage(this.collectionName)

    return {
      ...storage.schema,
      created_at: storage.createdAt,
      num_documents: storage.documents.size,
      num_memory_shards: 1,
    }
  }

  async update(schema: CollectionUpdateSchema): Promise<Collection> {
    const storage = getCollectionStorage(this.collectionName)

    if (schema.fields) {
      // Add new fields
      for (const field of schema.fields) {
        const existing = storage.schema.fields.findIndex((f) => f.name === field.name)
        if (existing >= 0) {
          storage.schema.fields[existing] = field
        } else {
          storage.schema.fields.push(field)
        }
      }
    }

    return this.retrieve()
  }

  async delete(): Promise<Collection> {
    const storage = getCollectionStorage(this.collectionName)
    const collection = await this.retrieve()

    globalStorage.delete(this.collectionName)

    return collection
  }

  documents(): DocumentsApi<T>
  documents(id: string): DocumentApi<T>
  documents(id?: string): DocumentsApi<T> | DocumentApi<T> {
    if (id !== undefined) {
      return new DocumentApiImpl<T>(this.collectionName, id)
    }
    return new DocumentsApiImpl<T>(this.collectionName)
  }
}

// ============================================================================
// COLLECTIONS API IMPLEMENTATION
// ============================================================================

class CollectionsApiImpl implements CollectionsApi {
  async create(schema: CollectionSchema): Promise<Collection> {
    if (globalStorage.has(schema.name)) {
      throw new ObjectAlreadyExists(`A collection with name \`${schema.name}\` already exists.`)
    }

    const storage: CollectionStorage = {
      schema,
      documents: new Map(),
      createdAt: Math.floor(Date.now() / 1000),
    }

    globalStorage.set(schema.name, storage)

    return {
      ...schema,
      created_at: storage.createdAt,
      num_documents: 0,
      num_memory_shards: 1,
    }
  }

  async retrieve(): Promise<Collection[]> {
    const collections: Collection[] = []

    for (const [name, storage] of globalStorage) {
      collections.push({
        ...storage.schema,
        created_at: storage.createdAt,
        num_documents: storage.documents.size,
        num_memory_shards: 1,
      })
    }

    return collections
  }
}

// ============================================================================
// CLIENT IMPLEMENTATION
// ============================================================================

class Client implements TypesenseClient {
  private config: ClientConfig

  constructor(config: ClientConfig) {
    this.config = config
  }

  collections(): CollectionsApi
  collections<T extends Document = Document>(name: string): CollectionApi<T>
  collections<T extends Document = Document>(name?: string): CollectionsApi | CollectionApi<T> {
    if (name !== undefined) {
      return new CollectionApiImpl<T>(name)
    }
    return new CollectionsApiImpl()
  }

  multiSearch = {
    perform: async <T extends Document = Document>(
      request: MultiSearchRequest,
      _options?: { useCache?: boolean; cacheTtl?: number }
    ): Promise<MultiSearchResult<T>> => {
      const results: SearchResult<T>[] = []

      for (const search of request.searches) {
        const collection = this.collections<T>(search.collection)
        const { collection: _, ...params } = search
        const result = await collection.documents().search(params)
        results.push(result)
      }

      return { results }
    },
  }

  health = {
    retrieve: async (): Promise<{ ok: boolean }> => {
      return { ok: true }
    },
  }

  metrics = {
    retrieve: async (): Promise<Record<string, unknown>> => {
      return {
        system_memory_used_bytes: 0,
        system_memory_total_bytes: 0,
        system_disk_used_bytes: 0,
        system_disk_total_bytes: 0,
      }
    },
  }

  debug = {
    retrieve: async (): Promise<{ state: number; version: string }> => {
      return {
        state: 1,
        version: '0.26.0-compat',
      }
    },
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Typesense namespace (mimics the official SDK structure)
 */
const Typesense = {
  Client,
}

export default Typesense

/**
 * Clear all in-memory storage (useful for tests)
 */
export function clearAllCollections(): void {
  globalStorage.clear()
  idCounter = 0
}
