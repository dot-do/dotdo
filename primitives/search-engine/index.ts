/**
 * SearchEngine - Full-text search primitives
 *
 * Provides a comprehensive search engine:
 * - InvertedIndex: Core inverted index structure
 * - Analyzer: Text analysis pipelines
 * - QueryParser: Parse query strings
 * - Scorer: TF-IDF/BM25 relevance scoring
 * - Highlighter: Extract matching snippets
 * - FacetAggregator: Compute facet counts
 * - SearchEngine: Main search engine class
 */

export * from './types'

import type {
  SearchQuery,
  SearchResult,
  SearchHit,
  IndexDocument,
  IndexMapping,
  IndexStats,
  BulkResult,
  BulkItemResult,
  ISearchEngine,
  QueryToken,
  IndexEntry,
  Posting,
  Facet,
  FacetValue,
  FacetRequest,
  AnalyzerConfig,
  HighlightConfig,
  SearchFilter,
  SortOption,
  HighlightResult,
  QueryOptions,
} from './types'

// =============================================================================
// Analyzer - Text Analysis Pipeline
// =============================================================================

/**
 * Text analyzer for tokenization and normalization
 */
export class Analyzer {
  private config: AnalyzerConfig

  constructor(config: AnalyzerConfig = { type: 'standard' }) {
    this.config = config
  }

  /**
   * Analyze text into tokens
   */
  analyze(text: string): string[] {
    if (!text) return []

    switch (this.config.type) {
      case 'keyword':
        return [text]

      case 'whitespace':
        return text.split(/\s+/).filter(Boolean)

      case 'ngram':
        return this.generateNgrams(text.toLowerCase())

      case 'edge-ngram':
        return this.generateEdgeNgrams(text.toLowerCase())

      case 'lowercase':
        return text.toLowerCase().split(/\s+/).filter(Boolean)

      case 'standard':
      default:
        return this.standardAnalyze(text)
    }
  }

  private standardAnalyze(text: string): string[] {
    // Lowercase, remove punctuation, split on whitespace
    let tokens = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)

    // Filter stop words if configured
    if (this.config.stopWords?.length) {
      const stopSet = new Set(this.config.stopWords.map((w) => w.toLowerCase()))
      tokens = tokens.filter((t) => !stopSet.has(t))
    }

    return tokens
  }

  private generateNgrams(text: string): string[] {
    const min = this.config.minGram ?? 2
    const max = this.config.maxGram ?? 3
    const tokens: string[] = []

    // First tokenize
    const words = text.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean)

    for (const word of words) {
      for (let n = min; n <= max; n++) {
        for (let i = 0; i <= word.length - n; i++) {
          tokens.push(word.slice(i, i + n))
        }
      }
    }

    return tokens
  }

  private generateEdgeNgrams(text: string): string[] {
    const min = this.config.minGram ?? 2
    const max = this.config.maxGram ?? 4
    const tokens: string[] = []

    // First tokenize
    const words = text.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean)

    for (const word of words) {
      for (let n = min; n <= Math.min(max, word.length); n++) {
        tokens.push(word.slice(0, n))
      }
    }

    return tokens
  }
}

// =============================================================================
// InvertedIndex - Core Index Structure
// =============================================================================

/**
 * Core inverted index data structure
 */
export class InvertedIndex {
  private index = new Map<string, IndexEntry>()
  private documents = new Set<string>()
  private docTerms = new Map<string, Set<string>>()
  private docFieldLengths = new Map<string, Map<string, number>>()
  private analyzer: Analyzer

  constructor(analyzer?: Analyzer) {
    this.analyzer = analyzer ?? new Analyzer()
  }

  /**
   * Add a document to the index
   */
  addDocument(docId: string, field: string, text: string): void {
    const tokens = this.analyzer.analyze(text)
    this.documents.add(docId)

    // Track field length
    if (!this.docFieldLengths.has(docId)) {
      this.docFieldLengths.set(docId, new Map())
    }
    this.docFieldLengths.get(docId)!.set(field, tokens.length)

    // Track terms for this document (for removal)
    if (!this.docTerms.has(docId)) {
      this.docTerms.set(docId, new Set())
    }

    // Count term frequencies and positions
    const termFreqs = new Map<string, { count: number; positions: number[] }>()
    tokens.forEach((token, position) => {
      if (!termFreqs.has(token)) {
        termFreqs.set(token, { count: 0, positions: [] })
      }
      const entry = termFreqs.get(token)!
      entry.count++
      entry.positions.push(position)
    })

    // Add to inverted index
    for (const [term, { count, positions }] of termFreqs) {
      this.docTerms.get(docId)!.add(term)

      if (!this.index.has(term)) {
        this.index.set(term, { docFreq: 0, postings: [] })
      }

      const entry = this.index.get(term)!

      // Check if document already indexed for this term
      const existingPostingIndex = entry.postings.findIndex(
        (p) => p.docId === docId && p.field === field
      )

      if (existingPostingIndex >= 0) {
        // Update existing posting
        entry.postings[existingPostingIndex].termFreq = count
        entry.postings[existingPostingIndex].positions = positions
      } else {
        // Add new posting
        entry.docFreq++
        entry.postings.push({
          docId,
          termFreq: count,
          field,
          positions,
        })
      }
    }
  }

  /**
   * Remove a document from the index
   */
  removeDocument(docId: string): void {
    const terms = this.docTerms.get(docId)
    if (!terms) return

    for (const term of terms) {
      const entry = this.index.get(term)
      if (entry) {
        const beforeCount = entry.postings.length
        entry.postings = entry.postings.filter((p) => p.docId !== docId)
        if (entry.postings.length < beforeCount) {
          entry.docFreq = entry.postings.length
        }
        if (entry.postings.length === 0) {
          this.index.delete(term)
        }
      }
    }

    this.documents.delete(docId)
    this.docTerms.delete(docId)
    this.docFieldLengths.delete(docId)
  }

  /**
   * Get postings for a term
   */
  getPostings(term: string): Posting[] {
    const normalizedTerm = term.toLowerCase()
    const entry = this.index.get(normalizedTerm)
    return entry?.postings ?? []
  }

  /**
   * Get full entry for a term
   */
  getEntry(term: string): IndexEntry | undefined {
    const normalizedTerm = term.toLowerCase()
    return this.index.get(normalizedTerm)
  }

  /**
   * Get average field length
   */
  getAvgFieldLength(field: string): number {
    let total = 0
    let count = 0
    for (const [, fields] of this.docFieldLengths) {
      const length = fields.get(field)
      if (length !== undefined) {
        total += length
        count++
      }
    }
    return count > 0 ? total / count : 0
  }

  /**
   * Get field length for a document
   */
  getFieldLength(docId: string, field: string): number {
    return this.docFieldLengths.get(docId)?.get(field) ?? 0
  }

  /**
   * Total indexed documents
   */
  get documentCount(): number {
    return this.documents.size
  }

  /**
   * Total unique terms
   */
  get termCount(): number {
    return this.index.size
  }

  /**
   * Get all terms (for prefix matching)
   */
  getAllTerms(): string[] {
    return Array.from(this.index.keys())
  }
}

// =============================================================================
// QueryParser - Parse Query Strings
// =============================================================================

/**
 * Parse query strings into tokens (AND, OR, NOT, phrases, wildcards)
 */
export class QueryParser {
  /**
   * Parse a query string into tokens
   */
  parse(query: string): QueryToken[] {
    const tokens: QueryToken[] = []
    let remaining = query.trim()

    while (remaining.length > 0) {
      remaining = remaining.trimStart()
      if (!remaining) break

      // Check for field:"phrase" pattern first
      const fieldPhraseMatch = remaining.match(/^(\w+):"([^"]*)"/)
      if (fieldPhraseMatch) {
        const [fullMatch, field, phrase] = fieldPhraseMatch
        tokens.push({
          type: 'phrase',
          value: phrase,
          field,
        })
        remaining = remaining.slice(fullMatch.length)
        continue
      }

      // Check for phrase (quoted string without field qualifier)
      if (remaining.startsWith('"')) {
        const endQuote = remaining.indexOf('"', 1)
        if (endQuote > 0) {
          const phrase = remaining.slice(1, endQuote)
          tokens.push({
            type: 'phrase',
            value: phrase,
          })
          remaining = remaining.slice(endQuote + 1)
          continue
        }
      }

      // Check for operators
      const upperRemaining = remaining.toUpperCase()
      if (upperRemaining.startsWith('AND ') || upperRemaining === 'AND') {
        tokens.push({ type: 'operator', value: 'AND' })
        remaining = remaining.slice(3)
        continue
      }
      if (upperRemaining.startsWith('OR ') || upperRemaining === 'OR') {
        tokens.push({ type: 'operator', value: 'OR' })
        remaining = remaining.slice(2)
        continue
      }
      if (upperRemaining.startsWith('NOT ') || upperRemaining === 'NOT') {
        tokens.push({ type: 'operator', value: 'NOT' })
        remaining = remaining.slice(3)
        continue
      }

      // Check for negation (minus)
      if (remaining.startsWith('-')) {
        remaining = remaining.slice(1)
        const nextToken = this.parseNextTerm(remaining)
        if (nextToken) {
          nextToken.token.negated = true
          tokens.push(nextToken.token)
          remaining = nextToken.remaining
        }
        continue
      }

      // Check for parentheses (skip for now, just remove them)
      if (remaining.startsWith('(') || remaining.startsWith(')')) {
        remaining = remaining.slice(1)
        continue
      }

      // Parse regular term
      const termResult = this.parseNextTerm(remaining)
      if (termResult) {
        tokens.push(termResult.token)
        remaining = termResult.remaining
      } else {
        // Skip unknown character
        remaining = remaining.slice(1)
      }
    }

    return tokens
  }

  private parseNextTerm(input: string): { token: QueryToken; remaining: string } | null {
    input = input.trimStart()
    if (!input) return null

    // Match term with optional field qualifier, wildcards, fuzzy
    const match = input.match(/^(?:(\w+):)?([^\s"()]+)/)
    if (!match) return null

    const [fullMatch, field, term] = match
    const remaining = input.slice(fullMatch.length)

    // Check for fuzzy
    if (term.includes('~')) {
      const fuzzyMatch = term.match(/^(.+?)~(\d*)$/)
      if (fuzzyMatch) {
        return {
          token: {
            type: 'fuzzy',
            value: fuzzyMatch[1],
            field,
            fuzziness: fuzzyMatch[2] ? parseInt(fuzzyMatch[2], 10) : 2,
          },
          remaining,
        }
      }
    }

    // Check for wildcard
    if (term.includes('*') || term.includes('?')) {
      return {
        token: {
          type: 'wildcard',
          value: term,
          field,
        },
        remaining,
      }
    }

    // Regular term
    return {
      token: {
        type: 'term',
        value: term,
        field,
      },
      remaining,
    }
  }
}

// =============================================================================
// Scorer - Relevance Scoring (TF-IDF / BM25)
// =============================================================================

/**
 * Relevance scoring using TF-IDF and BM25 algorithms
 */
export class Scorer {
  /**
   * Score a term using TF-IDF
   */
  scoreTerm(params: {
    termFreq: number
    docFreq: number
    totalDocs: number
    fieldLength: number
    avgFieldLength: number
  }): number {
    const { termFreq, docFreq, totalDocs, fieldLength, avgFieldLength } = params

    // TF: log(1 + tf)
    const tf = Math.log(1 + termFreq)

    // IDF: log(N / df)
    const idf = Math.log(totalDocs / Math.max(1, docFreq))

    // Length normalization
    const lengthNorm = avgFieldLength / Math.max(1, fieldLength)

    return tf * idf * Math.sqrt(lengthNorm)
  }

  /**
   * Score using BM25 algorithm
   */
  bm25(params: {
    termFreq: number
    docFreq: number
    totalDocs: number
    fieldLength: number
    avgFieldLength: number
    k1?: number
    b?: number
  }): number {
    const {
      termFreq,
      docFreq,
      totalDocs,
      fieldLength,
      avgFieldLength,
      k1 = 1.2,
      b = 0.75,
    } = params

    // IDF component: log((N - df + 0.5) / (df + 0.5) + 1)
    const idf = Math.log(
      (totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1
    )

    // TF component with length normalization
    const tfNorm =
      (termFreq * (k1 + 1)) /
      (termFreq + k1 * (1 - b + b * (fieldLength / avgFieldLength)))

    return idf * tfNorm
  }
}

// =============================================================================
// Highlighter - Extract Matching Snippets
// =============================================================================

/**
 * Highlight matching terms in text
 */
export class Highlighter {
  /**
   * Highlight matching terms in text
   */
  highlight(
    text: string,
    terms: string[],
    options?: { preTag?: string; postTag?: string }
  ): string {
    const preTag = options?.preTag ?? '<em>'
    const postTag = options?.postTag ?? '</em>'

    let result = text

    // Sort terms by length (longest first) to avoid partial replacements
    const sortedTerms = [...terms].sort((a, b) => b.length - a.length)

    for (const term of sortedTerms) {
      // Case-insensitive replacement preserving original case
      const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi')
      result = result.replace(regex, `${preTag}$1${postTag}`)
    }

    return result
  }

  /**
   * Get fragments containing matches
   */
  getFragments(
    text: string,
    terms: string[],
    options?: { fragmentSize?: number; numberOfFragments?: number }
  ): string[] {
    const fragmentSize = options?.fragmentSize ?? 100
    const numberOfFragments = options?.numberOfFragments ?? 3
    const preTag = '<em>'
    const postTag = '</em>'

    const fragments: string[] = []

    // Find all term positions
    const positions: Array<{ start: number; end: number; term: string }> = []

    for (const term of terms) {
      const regex = new RegExp(this.escapeRegex(term), 'gi')
      let match
      while ((match = regex.exec(text)) !== null) {
        positions.push({
          start: match.index,
          end: match.index + match[0].length,
          term: match[0],
        })
      }
    }

    // Sort by position
    positions.sort((a, b) => a.start - b.start)

    // Generate fragments around matches
    const usedRanges: Array<{ start: number; end: number }> = []

    for (const pos of positions) {
      if (fragments.length >= numberOfFragments) break

      // Check if this position is already covered
      const alreadyCovered = usedRanges.some(
        (r) => pos.start >= r.start && pos.end <= r.end
      )
      if (alreadyCovered) continue

      // Calculate fragment bounds
      const halfSize = Math.floor(fragmentSize / 2)
      let start = Math.max(0, pos.start - halfSize)
      let end = Math.min(text.length, pos.end + halfSize)

      // Adjust to word boundaries
      while (start > 0 && text[start - 1] !== ' ') start--
      while (end < text.length && text[end] !== ' ') end++

      usedRanges.push({ start, end })

      // Extract and highlight fragment
      let fragment = text.slice(start, end)
      fragment = this.highlight(fragment, terms, { preTag, postTag })

      // Add ellipsis if truncated
      if (start > 0) fragment = '...' + fragment
      if (end < text.length) fragment = fragment + '...'

      fragments.push(fragment)
    }

    return fragments
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}

// =============================================================================
// FacetAggregator - Compute Facet Counts
// =============================================================================

/**
 * Aggregate facet values and counts
 */
export class FacetAggregator {
  /**
   * Aggregate values for a field
   */
  aggregate(
    docs: Array<{ id: string; [key: string]: unknown }>,
    field: string,
    options?: { size?: number; minCount?: number; sortBy?: 'count' | 'value' }
  ): Facet {
    const counts = new Map<string | number | boolean, number>()

    for (const doc of docs) {
      const value = doc[field]
      if (value === undefined || value === null) continue

      // Handle arrays
      const values = Array.isArray(value) ? value : [value]
      for (const v of values) {
        const key = v as string | number | boolean
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }

    // Convert to array
    let values: FacetValue[] = Array.from(counts.entries()).map(([value, count]) => ({
      value,
      count,
    }))

    // Filter by min count
    if (options?.minCount) {
      values = values.filter((v) => v.count >= options.minCount!)
    }

    // Sort
    const sortBy = options?.sortBy ?? 'count'
    if (sortBy === 'count') {
      values.sort((a, b) => b.count - a.count)
    } else {
      values.sort((a, b) => String(a.value).localeCompare(String(b.value)))
    }

    // Limit
    const totalValues = values.length
    if (options?.size) {
      values = values.slice(0, options.size)
    }

    return {
      field,
      values,
      totalValues,
    }
  }
}

// =============================================================================
// SearchEngine - Main Search Engine Class
// =============================================================================

/**
 * Full-text search engine
 */
export class SearchEngine<T = Record<string, unknown>> implements ISearchEngine<T> {
  private mapping: IndexMapping
  private invertedIndex: InvertedIndex
  private documents = new Map<string, { id: string; source: T }>()
  private docIdCounter = 0
  private analyzer: Analyzer
  private scorer: Scorer
  private queryParser: QueryParser
  private highlighter: Highlighter
  private facetAggregator: FacetAggregator

  constructor(mapping?: Partial<IndexMapping>) {
    this.mapping = {
      fields: mapping?.fields ?? {},
      defaultAnalyzer: mapping?.defaultAnalyzer ?? 'standard',
      settings: mapping?.settings,
    }
    this.analyzer = new Analyzer({ type: this.mapping.defaultAnalyzer ?? 'standard' })
    this.invertedIndex = new InvertedIndex(this.analyzer)
    this.scorer = new Scorer()
    this.queryParser = new QueryParser()
    this.highlighter = new Highlighter()
    this.facetAggregator = new FacetAggregator()
  }

  /**
   * Execute a search query
   */
  async search(query: SearchQuery | string): Promise<SearchResult<T>> {
    const startTime = Date.now()

    // Normalize query
    const searchQuery: SearchQuery = typeof query === 'string' ? { query } : query

    // Get all matching document IDs with scores
    const scoredDocs = this.executeQuery(searchQuery)

    // Apply filters
    let filteredDocs = this.applyFilters(scoredDocs, searchQuery.filters)

    // Calculate total before pagination
    const total = filteredDocs.length

    // Apply sorting
    filteredDocs = this.applySorting(filteredDocs, searchQuery.sort)

    // Compute facets (before pagination)
    const facets = this.computeFacets(filteredDocs, searchQuery.facets)

    // Apply pagination
    const offset = searchQuery.pagination?.offset ?? 0
    const limit = searchQuery.pagination?.limit ?? 10
    const paginatedDocs = filteredDocs.slice(offset, offset + limit)

    // Build hits
    const hits = this.buildHits(paginatedDocs, searchQuery)

    // Calculate max score
    const maxScore = hits.length > 0 ? Math.max(...hits.map((h) => h.score)) : 0

    return {
      hits,
      total,
      facets,
      took: Date.now() - startTime,
      maxScore,
    }
  }

  private executeQuery(
    query: SearchQuery
  ): Array<{ id: string; source: T; score: number }> {
    const queryString = query.query

    // Handle wildcard-only query (match all)
    if (queryString === '*') {
      return Array.from(this.documents.values()).map((doc) => ({
        id: doc.id,
        source: doc.source,
        score: 1,
      }))
    }

    // Parse query
    let tokens = this.queryParser.parse(queryString)

    // Get fields to search
    const searchFields = query.options?.fields ?? this.getTextFields()

    // Apply fuzziness from options to term tokens
    if (query.options?.fuzziness !== undefined) {
      tokens = tokens.map((token) => {
        if (token.type === 'term') {
          const fuzziness =
            query.options!.fuzziness === 'auto'
              ? Math.min(2, Math.floor(token.value.length / 3))
              : (query.options!.fuzziness as number)
          return {
            ...token,
            type: 'fuzzy' as const,
            fuzziness,
          }
        }
        return token
      })
    }

    // Score documents
    const scores = new Map<string, number>()
    const matchedDocs = new Set<string>()
    const excludedDocs = new Set<string>()

    const defaultOperator = query.options?.defaultOperator ?? 'OR'
    let currentOperator: 'AND' | 'OR' | 'NOT' = defaultOperator
    let pendingAndDocs: Set<string> | null = null
    let hasExplicitOperator = false

    // Check if query has explicit operators
    const hasExplicitOperators = tokens.some((t) => t.type === 'operator')

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const prevToken = i > 0 ? tokens[i - 1] : null

      if (token.type === 'operator') {
        currentOperator = token.value as 'AND' | 'OR' | 'NOT'
        hasExplicitOperator = true
        continue
      }

      if (token.negated || currentOperator === 'NOT') {
        // Find docs to exclude
        const excludeDocs = this.findMatchingDocs(token, searchFields, query.options)
        for (const docId of excludeDocs) {
          excludedDocs.add(docId)
        }
        currentOperator = defaultOperator
        hasExplicitOperator = false
        continue
      }

      // Find matching docs for this token
      const tokenDocs = this.findMatchingDocs(token, searchFields, query.options)

      if (currentOperator === 'AND') {
        if (pendingAndDocs === null) {
          // First term in AND chain - need to get docs from previous OR results or start fresh
          if (matchedDocs.size > 0) {
            // Intersect with existing OR results
            const intersection = new Set<string>()
            for (const docId of tokenDocs) {
              if (matchedDocs.has(docId)) {
                intersection.add(docId)
              }
            }
            pendingAndDocs = intersection
            // Clear matchedDocs as they're now in the AND chain
            matchedDocs.clear()
          } else {
            pendingAndDocs = new Set(tokenDocs)
          }
        } else {
          // Continue AND chain - intersect with pending
          const intersection = new Set<string>()
          for (const docId of tokenDocs) {
            if (pendingAndDocs.has(docId)) {
              intersection.add(docId)
            }
          }
          pendingAndDocs = intersection
        }
      } else {
        // OR - add to matched docs
        for (const docId of tokenDocs) {
          matchedDocs.add(docId)
        }
      }

      // Score each matching doc
      for (const docId of tokenDocs) {
        const docScore = this.scoreDocument(docId, token, searchFields, query.options)
        scores.set(docId, (scores.get(docId) ?? 0) + docScore)
      }

      // Reset operator to default only if no explicit operators in query
      if (!hasExplicitOperators) {
        currentOperator = defaultOperator
      } else if (!hasExplicitOperator && prevToken?.type !== 'operator') {
        // No explicit operator before this term, use default
        currentOperator = defaultOperator
      }
      hasExplicitOperator = false
    }

    // Merge AND results
    if (pendingAndDocs !== null) {
      for (const docId of pendingAndDocs) {
        matchedDocs.add(docId)
      }
    }

    // Remove excluded docs
    for (const docId of excludedDocs) {
      matchedDocs.delete(docId)
      scores.delete(docId)
    }

    // Build result array
    const results: Array<{ id: string; source: T; score: number }> = []
    for (const docId of matchedDocs) {
      const doc = this.documents.get(docId)
      if (doc) {
        results.push({
          id: doc.id,
          source: doc.source,
          score: scores.get(docId) ?? 0,
        })
      }
    }

    return results
  }

  private findMatchingDocs(
    token: QueryToken,
    fields: string[],
    options?: QueryOptions
  ): Set<string> {
    const docs = new Set<string>()
    const searchFields = token.field ? [token.field] : fields

    if (token.type === 'phrase') {
      // Phrase search - need position matching
      const terms = this.analyzer.analyze(token.value)
      if (terms.length === 0) return docs

      // Find docs that contain all terms
      for (const [docId, doc] of this.documents) {
        for (const field of searchFields) {
          const fieldValue = this.getFieldValue(doc.source, field)
          if (!fieldValue) continue

          const fieldText = String(fieldValue).toLowerCase()
          const phraseText = token.value.toLowerCase()

          // For phrase slop, check if terms appear within slop distance
          if (options?.phraseSlop !== undefined && options.phraseSlop > 0) {
            const fieldTokens = this.analyzer.analyze(fieldText)
            const phraseTokens = terms

            // Check if all phrase tokens exist and are within slop
            let found = false
            for (let i = 0; i < fieldTokens.length; i++) {
              if (fieldTokens[i] === phraseTokens[0]) {
                // Check if remaining terms are within slop
                let allFound = true
                let lastPos = i
                for (let j = 1; j < phraseTokens.length; j++) {
                  // Search within slop distance from last position
                  const maxPos = lastPos + options.phraseSlop + 1
                  let termFound = false
                  for (let k = lastPos + 1; k <= Math.min(maxPos, fieldTokens.length - 1); k++) {
                    if (fieldTokens[k] === phraseTokens[j]) {
                      lastPos = k
                      termFound = true
                      break
                    }
                  }
                  if (!termFound) {
                    allFound = false
                    break
                  }
                }
                if (allFound) {
                  found = true
                  break
                }
              }
            }
            if (found) docs.add(docId)
          } else if (options?.phrase || terms.length > 1) {
            // Exact phrase match - check if phrase appears in text
            if (fieldText.includes(phraseText)) {
              docs.add(docId)
            }
          } else {
            // Single term phrase
            if (fieldText.includes(phraseText)) {
              docs.add(docId)
            }
          }
        }
      }
    } else if (token.type === 'wildcard') {
      // Wildcard search
      const pattern = token.value
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      const regex = new RegExp(`^${pattern}$`, 'i')

      for (const [docId, doc] of this.documents) {
        for (const field of searchFields) {
          const fieldValue = this.getFieldValue(doc.source, field)
          if (!fieldValue) continue

          const fieldText = String(fieldValue)
          const tokens = this.analyzer.analyze(fieldText)

          for (const t of tokens) {
            if (regex.test(t)) {
              docs.add(docId)
              break
            }
          }

          // Also check raw field value for prefix matches
          if (fieldText.toLowerCase().match(new RegExp(pattern, 'i'))) {
            docs.add(docId)
          }
        }
      }
    } else if (token.type === 'fuzzy') {
      // Fuzzy search
      const fuzziness = token.fuzziness ?? 2
      const prefixLength = options?.prefixLength ?? 0

      for (const [docId, doc] of this.documents) {
        for (const field of searchFields) {
          const fieldValue = this.getFieldValue(doc.source, field)
          if (!fieldValue) continue

          const fieldTokens = this.analyzer.analyze(String(fieldValue))
          for (const fieldToken of fieldTokens) {
            if (this.isFuzzyMatch(token.value.toLowerCase(), fieldToken, fuzziness, prefixLength)) {
              docs.add(docId)
              break
            }
          }
        }
      }
    } else {
      // Regular term search
      const term = token.value.toLowerCase()

      // Check inverted index
      const postings = this.invertedIndex.getPostings(term)
      for (const posting of postings) {
        if (searchFields.includes(posting.field) || searchFields.length === 0) {
          docs.add(posting.docId)
        }
      }

      // Also do direct field search for multi-value fields like tags
      for (const [docId, doc] of this.documents) {
        for (const field of searchFields) {
          const fieldValue = this.getFieldValue(doc.source, field)
          if (!fieldValue) continue

          if (Array.isArray(fieldValue)) {
            for (const v of fieldValue) {
              if (String(v).toLowerCase().includes(term)) {
                docs.add(docId)
              }
            }
          }
        }
      }
    }

    return docs
  }

  private isFuzzyMatch(
    term: string,
    candidate: string,
    maxDistance: number,
    prefixLength: number
  ): boolean {
    // Check prefix
    if (prefixLength > 0) {
      const termPrefix = term.slice(0, prefixLength)
      const candidatePrefix = candidate.slice(0, prefixLength)
      if (termPrefix !== candidatePrefix) {
        return false
      }
    }

    // Calculate Levenshtein distance
    const distance = this.levenshteinDistance(term, candidate)
    return distance <= maxDistance
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = []

    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i]
    }
    for (let j = 0; j <= b.length; j++) {
      matrix[0][j] = j
    }

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        )
      }
    }

    return matrix[a.length][b.length]
  }

  private scoreDocument(
    docId: string,
    token: QueryToken,
    fields: string[],
    options?: QueryOptions
  ): number {
    let totalScore = 0
    const term = token.value.toLowerCase()
    const searchFields = token.field ? [token.field] : fields

    for (const field of searchFields) {
      const postings = this.invertedIndex.getPostings(term)
      const posting = postings.find(
        (p) => p.docId === docId && p.field === field
      )

      if (posting) {
        const fieldBoost = this.mapping.fields[field]?.boost ?? 1
        const queryBoost = options?.boost ?? 1

        const score = this.scorer.bm25({
          termFreq: posting.termFreq,
          docFreq: this.invertedIndex.getEntry(term)?.docFreq ?? 1,
          totalDocs: this.documents.size,
          fieldLength: this.invertedIndex.getFieldLength(docId, field),
          avgFieldLength: this.invertedIndex.getAvgFieldLength(field),
        })

        totalScore += score * fieldBoost * queryBoost
      }
    }

    return totalScore
  }

  private applyFilters(
    docs: Array<{ id: string; source: T; score: number }>,
    filters?: SearchFilter[]
  ): Array<{ id: string; source: T; score: number }> {
    if (!filters?.length) return docs

    return docs.filter((doc) => {
      for (const filter of filters) {
        const value = this.getFieldValue(doc.source, filter.field)

        switch (filter.operator) {
          case 'eq':
            if (value !== filter.value) return false
            break
          case 'ne':
            if (value === filter.value) return false
            break
          case 'gt':
            if (typeof value !== 'number' || value <= (filter.value as number))
              return false
            break
          case 'gte':
            if (typeof value !== 'number' || value < (filter.value as number))
              return false
            break
          case 'lt':
            if (typeof value !== 'number' || value >= (filter.value as number))
              return false
            break
          case 'lte':
            if (typeof value !== 'number' || value > (filter.value as number))
              return false
            break
          case 'in':
            if (!Array.isArray(filter.value) || !filter.value.includes(value))
              return false
            break
          case 'nin':
            if (Array.isArray(filter.value) && filter.value.includes(value))
              return false
            break
          case 'exists':
            if (filter.value === true && value === undefined) return false
            if (filter.value === false && value !== undefined) return false
            break
          case 'prefix':
            if (
              typeof value !== 'string' ||
              !value.startsWith(filter.value as string)
            )
              return false
            break
          case 'range':
            if (typeof value !== 'number') return false
            if (value < (filter.value as number)) return false
            if (filter.to !== undefined && value > (filter.to as number))
              return false
            break
        }
      }
      return true
    })
  }

  private applySorting(
    docs: Array<{ id: string; source: T; score: number }>,
    sort?: SortOption[]
  ): Array<{ id: string; source: T; score: number }> {
    if (!sort?.length) {
      // Default: sort by score descending
      return [...docs].sort((a, b) => b.score - a.score)
    }

    return [...docs].sort((a, b) => {
      for (const sortOption of sort) {
        const { field, order } = sortOption
        const multiplier = order === 'asc' ? 1 : -1

        let aVal: unknown
        let bVal: unknown

        if (field === '_score') {
          aVal = a.score
          bVal = b.score
        } else {
          aVal = this.getFieldValue(a.source, field)
          bVal = this.getFieldValue(b.source, field)
        }

        if (aVal === bVal) continue

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return (aVal - bVal) * multiplier
        }

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return aVal.localeCompare(bVal) * multiplier
        }

        // Handle undefined/null
        if (aVal === undefined || aVal === null) return 1 * multiplier
        if (bVal === undefined || bVal === null) return -1 * multiplier
      }
      return 0
    })
  }

  private computeFacets(
    docs: Array<{ id: string; source: T; score: number }>,
    facetRequests?: FacetRequest[]
  ): Facet[] | undefined {
    if (!facetRequests?.length) return undefined

    const docSources = docs.map((d) => ({
      id: d.id,
      ...d.source as Record<string, unknown>,
    }))

    return facetRequests.map((request) =>
      this.facetAggregator.aggregate(docSources, request.field, {
        size: request.size,
        minCount: request.minCount,
        sortBy: request.sortBy,
      })
    )
  }

  private buildHits(
    docs: Array<{ id: string; source: T; score: number }>,
    query: SearchQuery
  ): SearchHit<T>[] {
    return docs.map((doc) => {
      const hit: SearchHit<T> = {
        id: doc.id,
        score: doc.score,
        source: doc.source,
      }

      // Add highlights
      if (query.highlight) {
        hit.highlights = this.computeHighlights(doc.source, query)
      }

      return hit
    })
  }

  private computeHighlights(source: T, query: SearchQuery): HighlightResult {
    const result: HighlightResult = {}
    const highlightConfig = query.highlight!

    // Extract search terms from query
    const tokens = this.queryParser.parse(query.query)
    const terms = tokens
      .filter((t) => t.type === 'term' || t.type === 'phrase')
      .map((t) => t.value)

    for (const field of highlightConfig.fields) {
      const fieldValue = this.getFieldValue(source, field)
      if (!fieldValue || typeof fieldValue !== 'string') continue

      const fragments = this.highlighter.getFragments(fieldValue, terms, {
        fragmentSize: highlightConfig.fragmentSize,
        numberOfFragments: highlightConfig.numberOfFragments,
      })

      if (fragments.length > 0) {
        // Apply custom tags if specified
        if (highlightConfig.preTag || highlightConfig.postTag) {
          result[field] = fragments.map((f) =>
            f
              .replace(/<em>/g, highlightConfig.preTag ?? '<em>')
              .replace(/<\/em>/g, highlightConfig.postTag ?? '</em>')
          )
        } else {
          result[field] = fragments
        }
      }
    }

    return result
  }

  private getFieldValue(source: T, field: string): unknown {
    const obj = source as Record<string, unknown>
    const parts = field.split('.')
    let value: unknown = obj

    for (const part of parts) {
      if (value === null || value === undefined) return undefined
      value = (value as Record<string, unknown>)[part]
    }

    return value
  }

  private getTextFields(): string[] {
    // If mapping specifies fields, use text fields from there
    const mappedFields = Object.entries(this.mapping.fields)
      .filter(([, config]) => config.type === 'text')
      .map(([name]) => name)

    if (mappedFields.length > 0) return mappedFields

    // Otherwise, infer from first document
    const firstDoc = this.documents.values().next().value
    if (!firstDoc) return []

    return Object.keys(firstDoc.source as Record<string, unknown>).filter((key) => {
      const value = (firstDoc.source as Record<string, unknown>)[key]
      // Include string fields and arrays of strings
      if (typeof value === 'string') return true
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') return true
      return false
    })
  }

  /**
   * Index a single document
   */
  async index(doc: IndexDocument<T>): Promise<string> {
    const id = doc.id ?? this.generateId()
    const source = doc.source

    // Store document
    this.documents.set(id, { id, source })

    // Index all text fields
    const obj = source as Record<string, unknown>
    for (const [field, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        this.invertedIndex.addDocument(id, field, value)
      } else if (Array.isArray(value)) {
        // Index array values (like tags)
        for (const v of value) {
          if (typeof v === 'string') {
            this.invertedIndex.addDocument(id, field, v)
          }
        }
      }
    }

    return id
  }

  /**
   * Bulk index multiple documents
   */
  async bulkIndex(docs: IndexDocument<T>[]): Promise<BulkResult> {
    const startTime = Date.now()
    const items: BulkItemResult[] = []
    let successful = 0
    let failed = 0

    for (const doc of docs) {
      try {
        const id = await this.index(doc)
        items.push({
          type: 'index',
          id,
          success: true,
        })
        successful++
      } catch (error) {
        const id = doc.id ?? 'unknown'
        items.push({
          type: 'index',
          id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        failed++
      }
    }

    return {
      successful,
      failed,
      items,
      took: Date.now() - startTime,
    }
  }

  /**
   * Delete a document by ID
   */
  async delete(id: string): Promise<boolean> {
    if (!this.documents.has(id)) return false

    this.invertedIndex.removeDocument(id)
    this.documents.delete(id)
    return true
  }

  /**
   * Update a document
   */
  async update(id: string, doc: Partial<T>): Promise<boolean> {
    const existing = this.documents.get(id)
    if (!existing) return false

    // Merge updates
    const updated = { ...existing.source, ...doc } as T

    // Remove old document from index
    this.invertedIndex.removeDocument(id)

    // Re-index with updated content
    this.documents.set(id, { id, source: updated })

    const obj = updated as Record<string, unknown>
    for (const [field, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        this.invertedIndex.addDocument(id, field, value)
      } else if (Array.isArray(value)) {
        for (const v of value) {
          if (typeof v === 'string') {
            this.invertedIndex.addDocument(id, field, v)
          }
        }
      }
    }

    return true
  }

  /**
   * Get a document by ID
   */
  async get(id: string): Promise<T | null> {
    const doc = this.documents.get(id)
    return doc?.source ?? null
  }

  /**
   * Get index statistics
   */
  async stats(): Promise<IndexStats> {
    // Rough size estimation
    let sizeInBytes = 0
    for (const [, doc] of this.documents) {
      sizeInBytes += JSON.stringify(doc.source).length
    }

    return {
      documentCount: this.documents.size,
      termCount: this.invertedIndex.termCount,
      sizeInBytes,
      lastRefresh: Date.now(),
    }
  }

  /**
   * Clear all documents from index
   */
  async clear(): Promise<void> {
    const ids = Array.from(this.documents.keys())
    for (const id of ids) {
      this.invertedIndex.removeDocument(id)
    }
    this.documents.clear()
    this.docIdCounter = 0
  }

  private generateId(): string {
    return `doc-${++this.docIdCounter}-${Date.now()}`
  }
}
