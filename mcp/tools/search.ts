/**
 * MCP Search Tool
 *
 * Implements search functionality across DOs, documents, and data.
 * Supports three search modes:
 * - semantic: Vector embedding-based similarity search
 * - keyword: Full-text search using SQLite FTS5
 * - hybrid: Combines semantic and keyword using Reciprocal Rank Fusion (RRF)
 *
 * @module mcp/tools/search
 */

import { z } from 'zod'

// =============================================================================
// SCHEMA DEFINITIONS
// =============================================================================

/**
 * Date range filter for search queries
 */
export const dateRangeSchema = z.object({
  from: z.string().optional().describe('ISO date string for range start'),
  to: z.string().optional().describe('ISO date string for range end'),
})

/**
 * Filter options for search
 */
export const searchFiltersSchema = z.object({
  $type: z.string().optional().describe('Filter by entity type (noun)'),
  namespace: z.string().optional().describe('Filter by namespace/tenant'),
  dateRange: dateRangeSchema.optional().describe('Filter by date range'),
})

/**
 * Main search tool input schema
 */
export const searchToolSchema = z.object({
  query: z.string().min(1).describe('Search query text'),
  type: z
    .enum(['semantic', 'keyword', 'hybrid'])
    .optional()
    .default('hybrid')
    .describe('Search mode: semantic (vector), keyword (FTS), or hybrid (RRF)'),
  filters: searchFiltersSchema.optional().describe('Optional filters'),
  limit: z.number().min(1).max(100).optional().default(10).describe('Maximum results to return'),
  offset: z.number().min(0).optional().default(0).describe('Offset for pagination'),
})

export type SearchParams = z.infer<typeof searchToolSchema>
/** Input type for SearchParams (before defaults are applied) */
export type SearchInput = z.input<typeof searchToolSchema>
export type SearchFilters = z.infer<typeof searchFiltersSchema>
export type DateRange = z.infer<typeof dateRangeSchema>

// =============================================================================
// RESULT TYPES
// =============================================================================

/**
 * Individual search result
 */
export interface SearchResult {
  /** Unique identifier of the entity */
  id: string
  /** Entity type (noun) */
  $type: string
  /** Relevance score (0-1) */
  score: number
  /** Entity data */
  data: Record<string, unknown>
  /** Highlighted matches (for keyword search) */
  highlights?: string[]
  /** Source of the match (for hybrid) */
  source?: 'semantic' | 'keyword' | 'both'
}

/**
 * Search response with metadata
 */
export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
  type: 'semantic' | 'keyword' | 'hybrid'
  took: number // milliseconds
}

// =============================================================================
// ENVIRONMENT TYPES
// =============================================================================

/**
 * Environment bindings for search
 */
export interface SearchEnv {
  AI?: {
    run(
      model: string,
      input: { text: string | string[] }
    ): Promise<{ data: number[][] } | { shape: number[]; data: number[] }>
  }
  VECTORIZE?: {
    query(
      vector: number[],
      options: { topK: number; filter?: Record<string, unknown> }
    ): Promise<{ matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>
    insert(vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>): Promise<void>
  }
  sql?: {
    exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
  }
}

/**
 * Search tool properties (permissions, context)
 */
export interface SearchToolProps {
  permissions: string[]
  namespace?: string
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default embedding model */
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5'

/** RRF constant (k) - higher values give more weight to lower-ranked results */
const RRF_K = 60

/** Default weights for hybrid search */
const HYBRID_WEIGHTS = {
  semantic: 0.6,
  keyword: 0.4,
}

// =============================================================================
// SEARCH IMPLEMENTATIONS
// =============================================================================

/**
 * Generate embeddings for a query using Cloudflare AI
 */
async function generateEmbedding(query: string, env: SearchEnv): Promise<number[]> {
  if (!env.AI) {
    throw new Error('AI binding not available for semantic search')
  }

  const result = await env.AI.run(EMBEDDING_MODEL, { text: query })

  // Handle both response formats
  if ('data' in result && Array.isArray(result.data)) {
    // Check if it's a 2D array (array of embeddings) or flat array
    const firstElement = result.data[0]
    if (Array.isArray(firstElement)) {
      // 2D array: return first embedding
      return firstElement as number[]
    }
    // Flat array: return as-is
    return result.data as number[]
  }

  if ('shape' in result && 'data' in result) {
    // Reshape flat array to 2D if needed
    const dimensions = result.shape[1] || 768
    return (result.data as number[]).slice(0, dimensions)
  }

  throw new Error('Unexpected embedding response format')
}

/**
 * Semantic search using vector embeddings
 */
async function semanticSearch(
  query: string,
  env: SearchEnv,
  filters?: SearchFilters,
  limit: number = 10,
  offset: number = 0
): Promise<SearchResult[]> {
  if (!env.VECTORIZE) {
    throw new Error('VECTORIZE binding not available for semantic search')
  }

  // Generate query embedding
  const embedding = await generateEmbedding(query, env)

  // Build filter for vector search
  const vectorFilter: Record<string, unknown> = {}
  if (filters?.$type) {
    vectorFilter.$type = filters.$type
  }
  if (filters?.namespace) {
    vectorFilter.namespace = filters.namespace
  }

  // Query vector store (fetch extra for offset)
  const vectorResults = await env.VECTORIZE.query(embedding, {
    topK: limit + offset,
    filter: Object.keys(vectorFilter).length > 0 ? vectorFilter : undefined,
  })

  // Apply offset and convert to SearchResult
  const results: SearchResult[] = vectorResults.matches
    .slice(offset, offset + limit)
    .map((match) => ({
      id: match.id,
      $type: (match.metadata?.$type as string) || 'Unknown',
      score: match.score,
      data: (match.metadata || {}) as Record<string, unknown>,
      source: 'semantic' as const,
    }))

  // Apply date range filter if specified (post-filter)
  if (filters?.dateRange) {
    return applyDateFilter(results, filters.dateRange)
  }

  return results
}

/**
 * Keyword search using SQLite FTS5
 */
async function keywordSearch(
  query: string,
  env: SearchEnv,
  filters?: SearchFilters,
  limit: number = 10,
  offset: number = 0
): Promise<SearchResult[]> {
  if (!env.sql) {
    throw new Error('SQL binding not available for keyword search')
  }

  // Build FTS query with filters
  const conditions: string[] = ['fts.things_fts MATCH ?']
  const params: unknown[] = [escapeSearchQuery(query)]

  if (filters?.$type) {
    const sanitizedType = sanitizeFilterValue(filters.$type, 'type')
    if (sanitizedType) {
      conditions.push('t.type = ?')
      params.push(sanitizedType)
    }
  }

  if (filters?.namespace) {
    const sanitizedNamespace = sanitizeFilterValue(filters.namespace, 'namespace')
    if (sanitizedNamespace) {
      conditions.push('t.namespace = ?')
      params.push(sanitizedNamespace)
    }
  }

  if (filters?.dateRange?.from) {
    const sanitizedFrom = sanitizeFilterValue(filters.dateRange.from, 'date')
    if (sanitizedFrom) {
      conditions.push('t.created_at >= ?')
      params.push(sanitizedFrom)
    }
  }

  if (filters?.dateRange?.to) {
    const sanitizedTo = sanitizeFilterValue(filters.dateRange.to, 'date')
    if (sanitizedTo) {
      conditions.push('t.created_at <= ?')
      params.push(sanitizedTo)
    }
  }

  // Add limit and offset
  params.push(limit)
  params.push(offset)

  // Query with FTS5
  const sql = `
    SELECT
      t.id,
      t.type as "$type",
      t.data,
      t.namespace,
      bm25(fts) as score,
      highlight(fts, 0, '<mark>', '</mark>') as highlight
    FROM things_fts fts
    JOIN things t ON fts.rowid = t.rowid
    WHERE ${conditions.join(' AND ')}
    ORDER BY score
    LIMIT ? OFFSET ?
  `

  try {
    const rows = env.sql.exec(sql, ...params).toArray() as Array<{
      id: string
      $type: string
      data: string
      score: number
      highlight: string
    }>

    return rows.map((row) => ({
      id: row.id,
      $type: row.$type,
      score: normalizeScore(row.score),
      data: JSON.parse(row.data),
      highlights: row.highlight ? [row.highlight] : undefined,
      source: 'keyword' as const,
    }))
  } catch {
    // FTS table may not exist - fall back to LIKE search
    return fallbackKeywordSearch(query, env, filters, limit, offset)
  }
}

/**
 * Fallback keyword search using LIKE (when FTS is not available)
 */
async function fallbackKeywordSearch(
  query: string,
  env: SearchEnv,
  filters?: SearchFilters,
  limit: number = 10,
  offset: number = 0
): Promise<SearchResult[]> {
  if (!env.sql) {
    return []
  }

  // Sanitize the query for LIKE clause - remove dangerous characters
  const sanitizedQuery = sanitizeString(query)

  const conditions: string[] = ['data LIKE ?']
  const params: unknown[] = [`%${sanitizedQuery}%`]

  if (filters?.$type) {
    const sanitizedType = sanitizeFilterValue(filters.$type, 'type')
    if (sanitizedType) {
      conditions.push('type = ?')
      params.push(sanitizedType)
    }
  }

  if (filters?.namespace) {
    const sanitizedNamespace = sanitizeFilterValue(filters.namespace, 'namespace')
    if (sanitizedNamespace) {
      conditions.push('namespace = ?')
      params.push(sanitizedNamespace)
    }
  }

  params.push(limit)
  params.push(offset)

  const sql = `
    SELECT id, type as "$type", data, namespace
    FROM things
    WHERE ${conditions.join(' AND ')}
    LIMIT ? OFFSET ?
  `

  const rows = env.sql.exec(sql, ...params).toArray() as Array<{
    id: string
    $type: string
    data: string
  }>

  return rows.map((row, index) => ({
    id: row.id,
    $type: row.$type,
    score: 1 - index * 0.05, // Simple ranking by result order
    data: JSON.parse(row.data),
    source: 'keyword' as const,
  }))
}

/**
 * Hybrid search combining semantic and keyword using RRF
 */
async function hybridSearch(
  query: string,
  env: SearchEnv,
  filters?: SearchFilters,
  limit: number = 10,
  offset: number = 0
): Promise<SearchResult[]> {
  // Run both searches in parallel
  const [semanticResults, keywordResults] = await Promise.all([
    semanticSearch(query, env, filters, limit * 2, 0).catch(() => [] as SearchResult[]),
    keywordSearch(query, env, filters, limit * 2, 0).catch(() => [] as SearchResult[]),
  ])

  // Calculate RRF scores
  const rrfScores = new Map<string, { score: number; result: SearchResult; sources: Set<string> }>()

  // Process semantic results
  semanticResults.forEach((result, rank) => {
    const rrfScore = HYBRID_WEIGHTS.semantic / (RRF_K + rank + 1)
    const existing = rrfScores.get(result.id)

    if (existing) {
      existing.score += rrfScore
      existing.sources.add('semantic')
    } else {
      rrfScores.set(result.id, {
        score: rrfScore,
        result,
        sources: new Set(['semantic']),
      })
    }
  })

  // Process keyword results
  keywordResults.forEach((result, rank) => {
    const rrfScore = HYBRID_WEIGHTS.keyword / (RRF_K + rank + 1)
    const existing = rrfScores.get(result.id)

    if (existing) {
      existing.score += rrfScore
      existing.sources.add('keyword')
      // Merge highlights if available
      if (result.highlights && !existing.result.highlights) {
        existing.result.highlights = result.highlights
      }
    } else {
      rrfScores.set(result.id, {
        score: rrfScore,
        result,
        sources: new Set(['keyword']),
      })
    }
  })

  // Sort by RRF score and apply pagination
  const sortedResults = Array.from(rrfScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(offset, offset + limit)
    .map(({ score, result, sources }) => ({
      ...result,
      score: normalizeScore(score),
      source: sources.size === 2 ? ('both' as const) : (sources.values().next().value as 'semantic' | 'keyword'),
    }))

  return sortedResults
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * SQL keywords that should be filtered from search queries
 * These could be used for injection attacks if included in FTS5 queries
 */
const SQL_KEYWORDS = new Set([
  'select',
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'create',
  'truncate',
  'union',
  'from',
  'where',
  'table',
  'or',
  'and',
  'not',
  'null',
  'is',
  'in',
  'like',
  'between',
  'join',
  'on',
  'as',
  'case',
  'when',
  'then',
  'else',
  'end',
  'exec',
  'execute',
  'near',
])

/**
 * Sanitize a string by removing all dangerous characters and SQL keywords
 * Uses allowlist approach - only allows alphanumeric, basic punctuation, and whitespace
 */
function sanitizeString(input: string): string {
  // Remove null bytes and control characters first
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

  // Remove SQL comment markers
  sanitized = sanitized.replace(/--/g, ' ')

  // Remove semicolons (statement terminators)
  sanitized = sanitized.replace(/;/g, ' ')

  // Remove backslashes (escape characters)
  sanitized = sanitized.replace(/\\/g, ' ')

  // Remove backticks
  sanitized = sanitized.replace(/`/g, ' ')

  // Remove quotes (single and double)
  sanitized = sanitized.replace(/['"]/g, ' ')

  // Remove parentheses (FTS5 grouping)
  sanitized = sanitized.replace(/[()]/g, ' ')

  // Remove other potentially dangerous characters: ^~*:=<>
  sanitized = sanitized.replace(/[\^~*:=<>]/g, ' ')

  // Remove % (SQL wildcard) - except when used as percent sign in text
  sanitized = sanitized.replace(/%/g, ' ')

  // Remove SQL keywords to prevent injection attacks like UNION SELECT
  // Split into words, filter out keywords, rejoin
  sanitized = sanitized
    .split(/\s+/)
    .filter((word) => !SQL_KEYWORDS.has(word.toLowerCase()))
    .join(' ')

  return sanitized
}

/**
 * Check if a term is a valid search term (not a SQL keyword)
 */
function isValidSearchTerm(term: string): boolean {
  // Must be alphanumeric with basic punctuation only
  if (!/^[\p{L}\p{N}\-_.@#]+$/u.test(term)) {
    return false
  }

  // Must not be a SQL keyword
  if (SQL_KEYWORDS.has(term.toLowerCase())) {
    return false
  }

  // Must have at least some content
  if (term.length === 0) {
    return false
  }

  return true
}

/**
 * Escape special FTS5 characters in search query
 * Uses comprehensive sanitization to prevent SQL injection
 */
function escapeSearchQuery(query: string): string {
  // First sanitize the entire query string
  const sanitized = sanitizeString(query)

  // Split into terms and filter
  const terms = sanitized
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .filter(isValidSearchTerm)

  // If no valid terms remain, return a safe empty query
  // Use a term that won't match anything but is syntactically valid
  if (terms.length === 0) {
    return '__EMPTY_QUERY__'
  }

  // Join terms with spaces (FTS5 default is AND)
  // Each term is validated to be safe alphanumeric
  return terms.join(' ')
}

/**
 * Sanitize filter parameter values
 * Validates and cleans filter inputs to prevent injection via filter parameters
 */
function sanitizeFilterValue(value: string, type: 'type' | 'namespace' | 'date'): string {
  const sanitized = sanitizeString(value)

  switch (type) {
    case 'type':
      // Type names should be alphanumeric with underscores only
      if (!/^[\p{L}\p{N}_]+$/u.test(sanitized)) {
        return '' // Invalid type
      }
      return sanitized

    case 'namespace':
      // Namespaces can include hyphens and dots
      if (!/^[\p{L}\p{N}\-_.]+$/u.test(sanitized)) {
        return '' // Invalid namespace
      }
      return sanitized

    case 'date':
      // ISO date format validation (YYYY-MM-DD or full ISO string)
      if (!/^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/.test(sanitized)) {
        return '' // Invalid date format
      }
      return sanitized

    default:
      return ''
  }
}

/**
 * Normalize score to 0-1 range
 */
function normalizeScore(score: number): number {
  if (score <= 0) return 0
  if (score >= 1) return 1
  return Math.min(1, Math.max(0, score))
}

/**
 * Apply date range filter to results
 */
function applyDateFilter(results: SearchResult[], dateRange: DateRange): SearchResult[] {
  return results.filter((result) => {
    const createdAt = result.data.createdAt || result.data.created_at
    if (!createdAt) return true

    const date = new Date(createdAt as string)

    if (dateRange.from && date < new Date(dateRange.from)) {
      return false
    }

    if (dateRange.to && date > new Date(dateRange.to)) {
      return false
    }

    return true
  })
}

// =============================================================================
// MAIN SEARCH TOOL
// =============================================================================

/**
 * Main search tool function
 *
 * @param params - Search parameters (validated by schema)
 * @param env - Environment bindings (AI, VECTORIZE, sql)
 * @param props - Tool properties (permissions, namespace)
 * @returns Search results
 *
 * @example
 * ```typescript
 * const results = await searchTool(
 *   { query: 'customer support', type: 'hybrid', limit: 10 },
 *   env,
 *   { permissions: ['search'] }
 * )
 * ```
 */
export async function searchTool(
  rawParams: SearchInput,
  env: SearchEnv,
  props: SearchToolProps
): Promise<SearchResponse> {
  // Check permission
  if (!props.permissions.includes('search')) {
    throw new Error('Permission denied: search')
  }

  // Parse and apply defaults
  const params = searchToolSchema.parse(rawParams)

  const startTime = Date.now()
  const { query, type, filters, limit, offset } = params

  // Merge namespace from props if not specified in filters
  const mergedFilters: SearchFilters = {
    ...filters,
    namespace: filters?.namespace || props.namespace,
  }

  let results: SearchResult[]

  switch (type) {
    case 'semantic':
      results = await semanticSearch(query, env, mergedFilters, limit, offset)
      break

    case 'keyword':
      results = await keywordSearch(query, env, mergedFilters, limit, offset)
      break

    case 'hybrid':
    default:
      results = await hybridSearch(query, env, mergedFilters, limit, offset)
      break
  }

  return {
    results,
    total: results.length,
    query,
    type: type || 'hybrid',
    took: Date.now() - startTime,
  }
}

// =============================================================================
// INDEXING FUNCTIONS
// =============================================================================

/**
 * Index a document for search
 * Adds to both vector store and FTS index
 */
export async function indexDocument(
  id: string,
  $type: string,
  data: Record<string, unknown>,
  env: SearchEnv,
  namespace?: string
): Promise<void> {
  // Create searchable text from data
  const searchableText = extractSearchableText(data)

  // Index in vector store
  if (env.AI && env.VECTORIZE) {
    const embedding = await generateEmbedding(searchableText, env)
    await env.VECTORIZE.insert([
      {
        id,
        values: embedding,
        metadata: {
          $type,
          namespace,
          ...flattenForMetadata(data),
        },
      },
    ])
  }

  // Index in FTS (if available)
  if (env.sql) {
    try {
      env.sql.exec(
        `
        INSERT OR REPLACE INTO things (id, type, namespace, data, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `,
        id,
        $type,
        namespace,
        JSON.stringify(data)
      )

      // Update FTS index
      env.sql.exec(
        `
        INSERT OR REPLACE INTO things_fts (rowid, content)
        SELECT rowid, data FROM things WHERE id = ?
      `,
        id
      )
    } catch {
      // FTS tables may not exist - that's okay
    }
  }
}

/**
 * Remove a document from search indexes
 */
export async function removeFromIndex(id: string, env: SearchEnv): Promise<void> {
  // Remove from FTS
  if (env.sql) {
    try {
      env.sql.exec('DELETE FROM things WHERE id = ?', id)
    } catch {
      // Ignore if table doesn't exist
    }
  }

  // Note: Vectorize doesn't support deletion in CF Workers
  // Deletion would require re-indexing or using metadata flags
}

/**
 * Extract searchable text from data object
 */
function extractSearchableText(data: Record<string, unknown>): string {
  const texts: string[] = []

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      texts.push(value)
    } else if (Array.isArray(value)) {
      texts.push(...value.filter((v) => typeof v === 'string'))
    } else if (typeof value === 'object' && value !== null) {
      texts.push(extractSearchableText(value as Record<string, unknown>))
    }
  }

  return texts.join(' ')
}

/**
 * Flatten data for vector metadata (Vectorize has limits on metadata)
 */
function flattenForMetadata(data: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    const fullKey = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[fullKey] = value
    }
    // Skip nested objects for metadata to stay within limits
  }

  return result
}

// =============================================================================
// MCP TOOL REGISTRATION HELPER
// =============================================================================

/**
 * Tool definition for MCP server registration
 */
export const searchToolDefinition = {
  name: 'search',
  description: 'Search across DOs, documents, and data using semantic, keyword, or hybrid search',
  inputSchema: searchToolSchema,
  handler: searchTool,
}
