/**
 * @dotdo/orama - Orama-compatible full-text search
 *
 * In-memory implementation for testing. Production version
 * will use DO SQLite with FTS5.
 */
import type {
  Schema,
  Document,
  OramaConfig,
  Orama,
  SearchParams,
  SearchResult,
  SearchHit,
  WhereFilter,
  WhereOperator,
} from './types'

// ============================================================================
// ID GENERATION
// ============================================================================

let idCounter = 0

function generateId(): string {
  return `orama-${Date.now()}-${++idCounter}`
}

// ============================================================================
// TOKENIZATION
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
 * Extract searchable text from document
 */
function extractText(doc: Document, schema: Schema, properties?: string[]): string {
  const texts: string[] = []

  function extract(obj: unknown, schemaNode: Schema | string, path: string = ''): void {
    if (typeof schemaNode === 'string') {
      if (schemaNode === 'string' || schemaNode === 'string[]') {
        if (properties && !properties.includes(path)) {
          return
        }
        if (Array.isArray(obj)) {
          texts.push(...obj.map(String))
        } else if (typeof obj === 'string') {
          texts.push(obj)
        }
      }
    } else if (typeof schemaNode === 'object') {
      for (const key of Object.keys(schemaNode)) {
        const value = (obj as Record<string, unknown>)?.[key]
        const newPath = path ? `${path}.${key}` : key
        extract(value, schemaNode[key], newPath)
      }
    }
  }

  extract(doc, schema)
  return texts.join(' ')
}

// ============================================================================
// CREATE
// ============================================================================

/**
 * Create a new Orama database
 */
export async function create<S extends Schema>(
  config: OramaConfig<S>
): Promise<Orama<S>> {
  return {
    schema: config.schema,
    id: config.id ?? 'id',
    language: config.language ?? 'english',
    _docs: new Map(),
    _fts: new Map(),
  }
}

// ============================================================================
// INSERT
// ============================================================================

/**
 * Insert a document
 */
export async function insert<S extends Schema>(
  db: Orama<S>,
  doc: Document<S>
): Promise<string> {
  const id = (doc.id as string) ?? generateId()
  const docWithId = { ...doc, id }

  // Store document
  db._docs.set(id, docWithId)

  // Index for FTS
  const text = extractText(docWithId, db.schema)
  const tokens = tokenize(text)

  for (const token of tokens) {
    if (!db._fts.has(token)) {
      db._fts.set(token, new Set())
    }
    db._fts.get(token)!.add(id)
  }

  return id
}

/**
 * Insert multiple documents
 */
export async function insertMultiple<S extends Schema>(
  db: Orama<S>,
  docs: Document<S>[],
  batchSize?: number
): Promise<string[]> {
  const ids: string[] = []

  for (const doc of docs) {
    const id = await insert(db, doc)
    ids.push(id)
  }

  return ids
}

// ============================================================================
// REMOVE
// ============================================================================

/**
 * Remove a document by ID
 */
export async function remove<S extends Schema>(
  db: Orama<S>,
  id: string
): Promise<boolean> {
  const doc = db._docs.get(id)
  if (!doc) {
    return false
  }

  // Remove from FTS index
  const text = extractText(doc, db.schema)
  const tokens = tokenize(text)

  for (const token of tokens) {
    const ids = db._fts.get(token)
    if (ids) {
      ids.delete(id)
      if (ids.size === 0) {
        db._fts.delete(token)
      }
    }
  }

  // Remove document
  db._docs.delete(id)
  return true
}

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Update a document
 */
export async function update<S extends Schema>(
  db: Orama<S>,
  id: string,
  doc: Document<S>
): Promise<boolean> {
  const exists = db._docs.has(id)
  if (!exists) {
    return false
  }

  // Remove old document from index
  await remove(db, id)

  // Insert updated document
  await insert(db, { ...doc, id })

  return true
}

// ============================================================================
// SEARCH
// ============================================================================

/**
 * Check if value matches filter
 */
function matchesFilter(value: unknown, filter: WhereOperator): boolean {
  if (filter.eq !== undefined && value !== filter.eq) return false
  if (filter.ne !== undefined && value === filter.ne) return false
  if (filter.gt !== undefined && (typeof value !== 'number' || value <= filter.gt)) return false
  if (filter.gte !== undefined && (typeof value !== 'number' || value < filter.gte)) return false
  if (filter.lt !== undefined && (typeof value !== 'number' || value >= filter.lt)) return false
  if (filter.lte !== undefined && (typeof value !== 'number' || value > filter.lte)) return false
  if (filter.in !== undefined && !filter.in.includes(value)) return false
  if (filter.nin !== undefined && filter.nin.includes(value)) return false
  if (filter.contains !== undefined && (typeof value !== 'string' || !value.includes(filter.contains))) return false
  return true
}

/**
 * Check if document matches all filters
 */
function matchesWhere(doc: Document, where: WhereFilter): boolean {
  for (const [field, filter] of Object.entries(where)) {
    const value = getNestedValue(doc, field)
    if (!matchesFilter(value, filter)) {
      return false
    }
  }
  return true
}

/**
 * Get nested value from object
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Calculate relevance score
 */
function calculateScore(
  docId: string,
  tokens: string[],
  fts: Map<string, Set<string>>,
  boost?: Record<string, number>
): number {
  let score = 0

  for (const token of tokens) {
    const ids = fts.get(token)
    if (ids?.has(docId)) {
      // Simple TF-IDF-like scoring
      const idf = Math.log(1 + 1 / ids.size)
      score += idf
    }
  }

  return score
}

/**
 * Handle special FTS syntax
 */
function parseSearchTerm(term: string): { tokens: string[]; mode: 'and' | 'or'; phrase?: string } {
  // Check for phrase query
  const phraseMatch = term.match(/"([^"]+)"/)
  if (phraseMatch) {
    return {
      tokens: tokenize(phraseMatch[1]),
      mode: 'and',
      phrase: phraseMatch[1].toLowerCase(),
    }
  }

  // Check for boolean operators
  if (term.includes(' OR ')) {
    const parts = term.split(' OR ').map((p) => p.trim())
    return {
      tokens: parts.flatMap(tokenize),
      mode: 'or',
    }
  }

  if (term.includes(' AND ')) {
    const parts = term.split(' AND ').map((p) => p.trim())
    return {
      tokens: parts.flatMap(tokenize),
      mode: 'and',
    }
  }

  if (term.includes(' NOT ')) {
    const [include] = term.split(' NOT ').map((p) => p.trim())
    // For NOT, we'll filter out matching docs later
    return {
      tokens: tokenize(include),
      mode: 'or',
    }
  }

  return {
    tokens: tokenize(term),
    mode: 'or',
  }
}

/**
 * Search the database
 */
export async function search<S extends Schema>(
  db: Orama<S>,
  params: SearchParams<S>
): Promise<SearchResult<S>> {
  const startTime = performance.now()

  const { tokens, mode, phrase } = parseSearchTerm(params.term)
  const limit = params.limit ?? 10
  const offset = params.offset ?? 0

  // Handle prefix matching (terms ending with *)
  const expandedTokens: string[] = []
  for (const token of tokens) {
    if (token.endsWith('*')) {
      const prefix = token.slice(0, -1)
      for (const [key] of db._fts) {
        if (key.startsWith(prefix)) {
          expandedTokens.push(key)
        }
      }
    } else {
      expandedTokens.push(token)
    }
  }

  // Handle tolerance (fuzzy matching)
  if (params.tolerance && params.tolerance > 0) {
    for (const token of [...expandedTokens]) {
      for (const [key] of db._fts) {
        if (levenshtein(token, key) <= params.tolerance) {
          expandedTokens.push(key)
        }
      }
    }
  }

  // Find matching documents
  const candidateIds = new Set<string>()

  if (mode === 'or') {
    // OR: union of all token matches
    for (const token of expandedTokens) {
      const ids = db._fts.get(token)
      if (ids) {
        for (const id of ids) {
          candidateIds.add(id)
        }
      }
    }
  } else {
    // AND: intersection of all token matches
    const tokenSets = expandedTokens
      .map((t) => db._fts.get(t))
      .filter((s): s is Set<string> => s !== undefined)

    if (tokenSets.length > 0) {
      const first = tokenSets[0]
      for (const id of first) {
        if (tokenSets.every((s) => s.has(id))) {
          candidateIds.add(id)
        }
      }
    }
  }

  // Handle NOT
  if (params.term.includes(' NOT ')) {
    const excludeTerm = params.term.split(' NOT ')[1].trim()
    const excludeTokens = tokenize(excludeTerm)

    for (const token of excludeTokens) {
      const ids = db._fts.get(token)
      if (ids) {
        for (const id of ids) {
          candidateIds.delete(id)
        }
      }
    }
  }

  // Filter by where clause and phrase
  const filteredDocs: Array<{ id: string; doc: Document<S>; score: number }> = []

  for (const id of candidateIds) {
    const doc = db._docs.get(id)
    if (!doc) continue

    // Apply where filters
    if (params.where && !matchesWhere(doc, params.where)) {
      continue
    }

    // Check phrase match
    if (phrase) {
      const text = extractText(doc, db.schema, params.properties).toLowerCase()
      if (!text.includes(phrase)) {
        continue
      }
    }

    const score = calculateScore(id, expandedTokens, db._fts, params.boost)
    filteredDocs.push({ id, doc, score })
  }

  // Sort by score
  filteredDocs.sort((a, b) => b.score - a.score)

  // Apply pagination
  const totalCount = filteredDocs.length
  const paginatedDocs = filteredDocs.slice(offset, offset + limit)

  const elapsed = performance.now() - startTime

  return {
    count: totalCount,
    hits: paginatedDocs.map(({ id, doc, score }) => ({
      id,
      score,
      document: doc,
    })),
    elapsed: {
      raw: elapsed,
      formatted: `${elapsed.toFixed(2)}ms`,
    },
  }
}

// ============================================================================
// COUNT
// ============================================================================

/**
 * Count documents in database
 */
export async function count<S extends Schema>(db: Orama<S>): Promise<number> {
  return db._docs.size
}

// ============================================================================
// GET BY ID
// ============================================================================

/**
 * Get document by ID
 */
export async function getByID<S extends Schema>(
  db: Orama<S>,
  id: string
): Promise<Document<S> | undefined> {
  return db._docs.get(id)
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Simple Levenshtein distance for fuzzy matching
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

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
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}
