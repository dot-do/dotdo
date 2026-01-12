/**
 * Elasticsearch Search Engine
 *
 * Search execution using inverted index with BM25 scoring.
 * Supports match, term, bool, range queries, and hybrid search with vectors.
 *
 * @module db/compat/elasticsearch/search
 */

import { BM25Scorer, type IndexStats } from '../../primitives/inverted-index'
import { createHNSWIndex, type HNSWIndex, type HNSWConfig } from '../../edgevec/hnsw'
import type { ElasticsearchIndexer, IndexedDocument } from './indexer'
import type {
  Document,
  Query,
  SearchRequest,
  SearchResponse,
  SearchHits,
  Hit,
  Sort,
  SortItem,
  SourceFilter,
  Highlight,
  KnnQuery,
} from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Scored document for ranking
 */
interface ScoredDoc {
  docId: string
  numericId: number
  score: number
  explanation?: string
}

/**
 * Search executor options
 */
export interface SearchExecutorOptions {
  /** Vector index configuration */
  vector?: {
    dimensions: number
    metric?: 'cosine' | 'l2' | 'dot'
    M?: number
    efConstruction?: number
  }
}

// ============================================================================
// SEARCH EXECUTOR
// ============================================================================

/**
 * Elasticsearch-compatible search executor
 *
 * Executes search queries against the indexer using BM25 scoring
 * and supports vector similarity search for hybrid search.
 */
export class SearchExecutor {
  private indexer: ElasticsearchIndexer
  private vectorIndex: HNSWIndex | null = null
  private vectorConfig: SearchExecutorOptions['vector']

  constructor(indexer: ElasticsearchIndexer, options: SearchExecutorOptions = {}) {
    this.indexer = indexer
    this.vectorConfig = options.vector

    // Initialize vector index if configured
    if (options.vector) {
      this.vectorIndex = createHNSWIndex({
        dimensions: options.vector.dimensions,
        metric: options.vector.metric || 'cosine',
        M: options.vector.M || 16,
        efConstruction: options.vector.efConstruction || 200,
      })
    }
  }

  /**
   * Index a vector for a document
   */
  indexVector(docId: string, vector: number[]): void {
    if (!this.vectorIndex) {
      throw new Error('Vector index not configured')
    }
    this.vectorIndex.insert(docId, new Float32Array(vector))
  }

  /**
   * Delete vector for a document
   */
  deleteVector(docId: string): void {
    if (this.vectorIndex) {
      this.vectorIndex.delete(docId)
    }
  }

  /**
   * Execute a search request
   */
  search<T extends Document = Document>(request: SearchRequest<T>): SearchResponse<T> {
    const startTime = Date.now()

    // Get scored documents
    let scoredDocs: ScoredDoc[] = []

    // Handle KNN query
    if (request.knn) {
      const knnResults = this.executeKnn(request.knn, request.query)
      scoredDocs = knnResults
    }

    // Handle regular query
    if (request.query) {
      const queryResults = this.executeQuery(request.query)

      if (scoredDocs.length > 0 && request.rank?.rrf) {
        // Hybrid search with RRF
        scoredDocs = this.reciprocalRankFusion(queryResults, scoredDocs, request.rank.rrf)
      } else if (scoredDocs.length > 0) {
        // Combine without RRF (simple merge)
        scoredDocs = this.mergeResults(queryResults, scoredDocs)
      } else {
        scoredDocs = queryResults
      }
    }

    // Handle match_all if no query
    if (!request.query && !request.knn) {
      scoredDocs = this.executeMatchAll()
    }

    // Apply post_filter
    if (request.post_filter) {
      const filterDocs = this.executeQuery(request.post_filter)
      const filterDocIds = new Set(filterDocs.map((d) => d.docId))
      scoredDocs = scoredDocs.filter((d) => filterDocIds.has(d.docId))
    }

    // Apply min_score filter
    if (request.min_score !== undefined) {
      scoredDocs = scoredDocs.filter((d) => d.score >= request.min_score!)
    }

    // Sort results
    if (request.sort && request.sort.length > 0) {
      scoredDocs = this.sortResults(scoredDocs, request.sort)
    } else {
      // Default sort by score descending
      scoredDocs.sort((a, b) => b.score - a.score)
    }

    // Calculate totals
    const totalHits = scoredDocs.length

    // Apply pagination
    const from = request.from || 0
    const size = request.size ?? 10
    const paginatedDocs = scoredDocs.slice(from, from + size)

    // Build hits
    const hits = this.buildHits<T>(paginatedDocs, request)

    // Calculate max score
    const maxScore = scoredDocs.length > 0 ? Math.max(...scoredDocs.map((d) => d.score)) : null

    return {
      took: Date.now() - startTime,
      timed_out: false,
      _shards: {
        total: 1,
        successful: 1,
        skipped: 0,
        failed: 0,
      },
      hits: {
        total: {
          value: totalHits,
          relation: 'eq',
        },
        max_score: maxScore,
        hits,
      },
    }
  }

  // ==========================================================================
  // QUERY EXECUTION
  // ==========================================================================

  private executeQuery(query: Query): ScoredDoc[] {
    // Match query
    if ('match' in query) {
      return this.executeMatch(query.match)
    }

    // Multi-match query
    if ('multi_match' in query) {
      return this.executeMultiMatch(query.multi_match)
    }

    // Match phrase query
    if ('match_phrase' in query) {
      return this.executeMatchPhrase(query.match_phrase)
    }

    // Term query
    if ('term' in query) {
      return this.executeTerm(query.term)
    }

    // Terms query
    if ('terms' in query) {
      return this.executeTerms(query.terms)
    }

    // Range query
    if ('range' in query) {
      return this.executeRange(query.range)
    }

    // Exists query
    if ('exists' in query) {
      return this.executeExists(query.exists)
    }

    // Prefix query
    if ('prefix' in query) {
      return this.executePrefix(query.prefix)
    }

    // Wildcard query
    if ('wildcard' in query) {
      return this.executeWildcard(query.wildcard)
    }

    // IDs query
    if ('ids' in query) {
      return this.executeIds(query.ids)
    }

    // Bool query
    if ('bool' in query) {
      return this.executeBool(query.bool)
    }

    // Match all query
    if ('match_all' in query) {
      return this.executeMatchAll(query.match_all.boost)
    }

    // Match none query
    if ('match_none' in query) {
      return []
    }

    // Function score query
    if ('function_score' in query) {
      return this.executeFunctionScore(query.function_score)
    }

    // Unknown query type
    console.warn('Unknown query type:', Object.keys(query))
    return []
  }

  private executeMatch(match: Record<string, unknown>): ScoredDoc[] {
    const field = Object.keys(match)[0]
    const config = match[field]

    let queryText: string
    let operator: 'or' | 'and' = 'or'
    let boost = 1.0

    if (typeof config === 'string') {
      queryText = config
    } else {
      const matchConfig = config as { query: string; operator?: 'or' | 'and'; boost?: number }
      queryText = matchConfig.query
      operator = matchConfig.operator || 'or'
      boost = matchConfig.boost || 1.0
    }

    const tokens = this.indexer.tokenizeField(field, queryText)
    if (tokens.length === 0) return []

    const stats = this.indexer.getIndexStats()
    const scorer = new BM25Scorer(stats)

    // Get postings for each term
    const termPostings = tokens.map((token) => ({
      token,
      postings: this.indexer.getPostings(field, token),
      df: this.indexer.getDocumentFrequency(field, token),
    }))

    // Find matching documents based on operator
    const docScores = new Map<string, { score: number; numericId: number }>()

    if (operator === 'and') {
      // All terms must match
      const allPostings = termPostings.filter((tp) => tp.postings)
      if (allPostings.length !== tokens.length) return []

      // Find intersection of all posting lists
      let candidates: number[] | null = null
      for (const tp of allPostings) {
        const docIds = tp.postings!.toArray()
        if (candidates === null) {
          candidates = docIds
        } else {
          const docSet = new Set(docIds)
          candidates = candidates.filter((id) => docSet.has(id))
        }
      }

      if (!candidates) return []

      // Score matching documents
      for (const numericId of candidates) {
        const doc = this.indexer.getDocumentByNumericId(numericId)
        if (!doc) continue

        let totalScore = 0
        for (const tp of allPostings) {
          const tf = tp.postings!.getTf(numericId)
          if (tf > 0) {
            totalScore += scorer.scoreTerm({
              tf,
              df: tp.df,
              docLength: doc._doc_length,
            })
          }
        }

        docScores.set(doc._id, { score: totalScore * boost, numericId })
      }
    } else {
      // Any term can match (OR)
      for (const tp of termPostings) {
        if (!tp.postings) continue

        for (const numericId of tp.postings.toArray()) {
          const doc = this.indexer.getDocumentByNumericId(numericId)
          if (!doc) continue

          const tf = tp.postings.getTf(numericId)
          const termScore = scorer.scoreTerm({
            tf,
            df: tp.df,
            docLength: doc._doc_length,
          })

          const existing = docScores.get(doc._id)
          if (existing) {
            existing.score += termScore * boost
          } else {
            docScores.set(doc._id, { score: termScore * boost, numericId })
          }
        }
      }
    }

    return Array.from(docScores.entries()).map(([docId, data]) => ({
      docId,
      numericId: data.numericId,
      score: data.score,
    }))
  }

  private executeMultiMatch(config: {
    query: string
    fields: string[]
    type?: string
    operator?: 'or' | 'and'
  }): ScoredDoc[] {
    const { query, fields, operator = 'or' } = config

    // Execute match on each field and combine
    const allResults: ScoredDoc[] = []

    for (const field of fields) {
      const fieldResults = this.executeMatch({ [field]: { query, operator } })
      allResults.push(...fieldResults)
    }

    // Combine scores for same document
    const docScores = new Map<string, ScoredDoc>()
    for (const result of allResults) {
      const existing = docScores.get(result.docId)
      if (existing) {
        // Take maximum score (best_fields behavior)
        if (result.score > existing.score) {
          docScores.set(result.docId, result)
        }
      } else {
        docScores.set(result.docId, result)
      }
    }

    return Array.from(docScores.values())
  }

  private executeMatchPhrase(matchPhrase: Record<string, unknown>): ScoredDoc[] {
    const field = Object.keys(matchPhrase)[0]
    const config = matchPhrase[field]

    let queryText: string
    if (typeof config === 'string') {
      queryText = config
    } else {
      queryText = (config as { query: string }).query
    }

    const tokens = this.indexer.tokenizeField(field, queryText)
    if (tokens.length === 0) return []

    // For phrase queries, all tokens must appear and ideally in sequence
    // Simplified: just require all tokens match (like AND operator)
    return this.executeMatch({ [field]: { query: queryText, operator: 'and' } })
  }

  private executeTerm(term: Record<string, unknown>): ScoredDoc[] {
    const field = Object.keys(term)[0]
    const config = term[field]

    let value: string | number | boolean
    let boost = 1.0

    if (typeof config === 'object' && config !== null) {
      const termConfig = config as { value: string | number | boolean; boost?: number }
      value = termConfig.value
      boost = termConfig.boost || 1.0
    } else {
      value = config as string | number | boolean
    }

    // For term queries, we need exact match on keyword fields
    const mapping = this.indexer.getFieldMapping(field)
    if (!mapping) return []

    if (mapping.type === 'keyword' || mapping.type === 'text') {
      const postings = this.indexer.getPostings(field, String(value))
      if (!postings) return []

      return postings.toArray().map((numericId) => {
        const doc = this.indexer.getDocumentByNumericId(numericId)
        return {
          docId: doc?._id || '',
          numericId,
          score: 1.0 * boost, // Term queries score 1.0 for exact match
        }
      }).filter((d) => d.docId)
    }

    // For non-text fields, filter by exact value
    return this.indexer.getAllDocuments()
      .filter((doc) => {
        const fieldValue = this.indexer.getFieldValue(doc._source, field)
        return fieldValue === value
      })
      .map((doc) => ({
        docId: doc._id,
        numericId: this.indexer.getNumericId(doc._id) || 0,
        score: 1.0 * boost,
      }))
  }

  private executeTerms(terms: Record<string, unknown>): ScoredDoc[] {
    const field = Object.keys(terms)[0]
    const values = terms[field] as (string | number | boolean)[]

    const results: ScoredDoc[] = []
    const seenDocs = new Set<string>()

    for (const value of values) {
      const termResults = this.executeTerm({ [field]: value })
      for (const result of termResults) {
        if (!seenDocs.has(result.docId)) {
          seenDocs.add(result.docId)
          results.push(result)
        }
      }
    }

    return results
  }

  private executeRange(range: Record<string, unknown>): ScoredDoc[] {
    const field = Object.keys(range)[0]
    const config = range[field] as {
      gt?: number | string
      gte?: number | string
      lt?: number | string
      lte?: number | string
      boost?: number
    }

    const boost = config.boost || 1.0

    return this.indexer.getAllDocuments()
      .filter((doc) => {
        const value = this.indexer.getFieldValue(doc._source, field)
        if (value === undefined || value === null) return false

        // Convert to comparable value
        let compareValue: number
        if (typeof value === 'string') {
          // Try parsing as date first
          const dateValue = Date.parse(value)
          compareValue = isNaN(dateValue) ? parseFloat(value) : dateValue
        } else {
          compareValue = Number(value)
        }

        // Check range conditions
        if (config.gt !== undefined) {
          const gtValue = typeof config.gt === 'string' ? Date.parse(config.gt) || parseFloat(config.gt) : config.gt
          if (compareValue <= gtValue) return false
        }
        if (config.gte !== undefined) {
          const gteValue = typeof config.gte === 'string' ? Date.parse(config.gte) || parseFloat(config.gte) : config.gte
          if (compareValue < gteValue) return false
        }
        if (config.lt !== undefined) {
          const ltValue = typeof config.lt === 'string' ? Date.parse(config.lt) || parseFloat(config.lt) : config.lt
          if (compareValue >= ltValue) return false
        }
        if (config.lte !== undefined) {
          const lteValue = typeof config.lte === 'string' ? Date.parse(config.lte) || parseFloat(config.lte) : config.lte
          if (compareValue > lteValue) return false
        }

        return true
      })
      .map((doc) => ({
        docId: doc._id,
        numericId: this.indexer.getNumericId(doc._id) || 0,
        score: 1.0 * boost,
      }))
  }

  private executeExists(config: { field: string }): ScoredDoc[] {
    return this.indexer.getAllDocuments()
      .filter((doc) => {
        const value = this.indexer.getFieldValue(doc._source, config.field)
        return value !== undefined && value !== null
      })
      .map((doc) => ({
        docId: doc._id,
        numericId: this.indexer.getNumericId(doc._id) || 0,
        score: 1.0,
      }))
  }

  private executePrefix(prefix: Record<string, unknown>): ScoredDoc[] {
    const field = Object.keys(prefix)[0]
    const config = prefix[field]

    let prefixValue: string
    let boost = 1.0

    if (typeof config === 'string') {
      prefixValue = config
    } else {
      const prefixConfig = config as { value: string; boost?: number }
      prefixValue = prefixConfig.value
      boost = prefixConfig.boost || 1.0
    }

    const mapping = this.indexer.getFieldMapping(field)
    if (!mapping) return []

    // Get matching terms from dictionary
    const matchingTerms = this.indexer.prefixSearch(field, prefixValue)

    // Get all documents that match any of the terms
    const docScores = new Map<string, ScoredDoc>()

    for (const term of matchingTerms) {
      const postings = this.indexer.getPostings(field, term)
      if (!postings) continue

      for (const numericId of postings.toArray()) {
        const doc = this.indexer.getDocumentByNumericId(numericId)
        if (!doc) continue

        if (!docScores.has(doc._id)) {
          docScores.set(doc._id, {
            docId: doc._id,
            numericId,
            score: 1.0 * boost,
          })
        }
      }
    }

    return Array.from(docScores.values())
  }

  private executeWildcard(wildcard: Record<string, unknown>): ScoredDoc[] {
    const field = Object.keys(wildcard)[0]
    const config = wildcard[field]

    let pattern: string
    let boost = 1.0

    if (typeof config === 'string') {
      pattern = config
    } else {
      const wildcardConfig = config as { value: string; boost?: number }
      pattern = wildcardConfig.value
      boost = wildcardConfig.boost || 1.0
    }

    // Convert wildcard pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    const regex = new RegExp(`^${regexPattern}$`, 'i')

    return this.indexer.getAllDocuments()
      .filter((doc) => {
        const value = this.indexer.getFieldValue(doc._source, field)
        if (typeof value !== 'string') return false
        return regex.test(value)
      })
      .map((doc) => ({
        docId: doc._id,
        numericId: this.indexer.getNumericId(doc._id) || 0,
        score: 1.0 * boost,
      }))
  }

  private executeIds(config: { values: string[] }): ScoredDoc[] {
    return config.values
      .map((id) => {
        const doc = this.indexer.get(id)
        if (!doc) return null
        return {
          docId: id,
          numericId: this.indexer.getNumericId(id) || 0,
          score: 1.0,
        }
      })
      .filter((d): d is ScoredDoc => d !== null)
  }

  private executeBool(config: {
    must?: Query[]
    filter?: Query[]
    should?: Query[]
    must_not?: Query[]
    minimum_should_match?: string | number
    boost?: number
  }): ScoredDoc[] {
    const boost = config.boost || 1.0

    // Execute all clause types
    const mustResults = (config.must || []).map((q) => this.executeQuery(q))
    const filterResults = (config.filter || []).map((q) => this.executeQuery(q))
    const shouldResults = (config.should || []).map((q) => this.executeQuery(q))
    const mustNotResults = (config.must_not || []).map((q) => this.executeQuery(q))

    // Start with all documents or must clause intersection
    let candidates: Set<string>

    if (mustResults.length > 0 || filterResults.length > 0) {
      // Find intersection of all must clauses
      const allMustResults = [...mustResults, ...filterResults]
      candidates = new Set(allMustResults[0]?.map((d) => d.docId) || [])

      for (let i = 1; i < allMustResults.length; i++) {
        const clauseDocIds = new Set(allMustResults[i].map((d) => d.docId))
        candidates = new Set([...candidates].filter((id) => clauseDocIds.has(id)))
      }
    } else if (shouldResults.length > 0) {
      // Union of all should clauses
      candidates = new Set<string>()
      for (const result of shouldResults) {
        for (const doc of result) {
          candidates.add(doc.docId)
        }
      }
    } else {
      // All documents match
      candidates = new Set(this.indexer.getAllDocIds())
    }

    // Apply must_not exclusions
    for (const result of mustNotResults) {
      for (const doc of result) {
        candidates.delete(doc.docId)
      }
    }

    // Apply minimum_should_match if there are should clauses
    if (shouldResults.length > 0 && config.minimum_should_match) {
      const minMatch = typeof config.minimum_should_match === 'string'
        ? parseInt(config.minimum_should_match)
        : config.minimum_should_match

      // Count how many should clauses each candidate matches
      const shouldDocIds = shouldResults.map((r) => new Set(r.map((d) => d.docId)))

      candidates = new Set([...candidates].filter((docId) => {
        const matchCount = shouldDocIds.filter((s) => s.has(docId)).length
        return matchCount >= minMatch
      }))
    }

    // Calculate scores for remaining candidates
    const docScores = new Map<string, number>()

    // Add scores from must clauses
    for (const result of mustResults) {
      for (const doc of result) {
        if (candidates.has(doc.docId)) {
          docScores.set(doc.docId, (docScores.get(doc.docId) || 0) + doc.score)
        }
      }
    }

    // Add scores from should clauses
    for (const result of shouldResults) {
      for (const doc of result) {
        if (candidates.has(doc.docId)) {
          docScores.set(doc.docId, (docScores.get(doc.docId) || 0) + doc.score)
        }
      }
    }

    // Ensure all candidates have a score
    for (const docId of candidates) {
      if (!docScores.has(docId)) {
        docScores.set(docId, 1.0)
      }
    }

    return [...candidates].map((docId) => ({
      docId,
      numericId: this.indexer.getNumericId(docId) || 0,
      score: (docScores.get(docId) || 1.0) * boost,
    }))
  }

  private executeMatchAll(boost: number = 1.0): ScoredDoc[] {
    return this.indexer.getAllDocuments().map((doc) => ({
      docId: doc._id,
      numericId: this.indexer.getNumericId(doc._id) || 0,
      score: boost,
    }))
  }

  private executeFunctionScore(config: {
    query?: Query
    functions?: Array<{ filter?: Query; weight?: number }>
    boost_mode?: string
    score_mode?: string
  }): ScoredDoc[] {
    // Execute base query
    let results = config.query ? this.executeQuery(config.query) : this.executeMatchAll()

    // Apply function scores (simplified - just apply weights)
    if (config.functions) {
      for (const func of config.functions) {
        if (func.filter && func.weight) {
          const filterDocs = new Set(this.executeQuery(func.filter).map((d) => d.docId))
          results = results.map((doc) => ({
            ...doc,
            score: filterDocs.has(doc.docId) ? doc.score * func.weight! : doc.score,
          }))
        }
      }
    }

    return results
  }

  // ==========================================================================
  // VECTOR SEARCH
  // ==========================================================================

  private executeKnn(
    knn: KnnQuery['knn'] | Array<KnnQuery['knn']>,
    baseQuery?: Query
  ): ScoredDoc[] {
    if (!this.vectorIndex) {
      return []
    }

    const knnConfigs = Array.isArray(knn) ? knn : [knn]
    const allResults: ScoredDoc[] = []

    for (const config of knnConfigs) {
      const { query_vector, k, num_candidates, filter, boost = 1.0 } = config

      // Execute KNN search
      const knnResults = this.vectorIndex.search(new Float32Array(query_vector), {
        k: num_candidates || k * 2,
        ef: num_candidates || k * 2,
      })

      // Apply filter if present
      let filteredResults = knnResults
      if (filter) {
        const filterDocs = new Set(this.executeQuery(filter).map((d) => d.docId))
        filteredResults = knnResults.filter((r) => filterDocs.has(r.id))
      }

      // Take top k
      const topK = filteredResults.slice(0, k)

      // Convert to scored docs
      for (const result of topK) {
        allResults.push({
          docId: result.id,
          numericId: this.indexer.getNumericId(result.id) || 0,
          score: result.score * boost,
        })
      }
    }

    return allResults
  }

  // ==========================================================================
  // RESULT COMBINATION
  // ==========================================================================

  private reciprocalRankFusion(
    bm25Results: ScoredDoc[],
    vectorResults: ScoredDoc[],
    config: { window_size?: number; rank_constant?: number }
  ): ScoredDoc[] {
    const k = config.rank_constant || 60
    const windowSize = config.window_size || 100

    // Rank documents within window
    const bm25Ranked = bm25Results
      .sort((a, b) => b.score - a.score)
      .slice(0, windowSize)

    const vectorRanked = vectorResults
      .sort((a, b) => b.score - a.score)
      .slice(0, windowSize)

    // Calculate RRF scores
    const rrfScores = new Map<string, { score: number; numericId: number }>()

    for (let i = 0; i < bm25Ranked.length; i++) {
      const doc = bm25Ranked[i]
      const rrfScore = 1 / (k + i + 1)
      const existing = rrfScores.get(doc.docId)
      if (existing) {
        existing.score += rrfScore
      } else {
        rrfScores.set(doc.docId, { score: rrfScore, numericId: doc.numericId })
      }
    }

    for (let i = 0; i < vectorRanked.length; i++) {
      const doc = vectorRanked[i]
      const rrfScore = 1 / (k + i + 1)
      const existing = rrfScores.get(doc.docId)
      if (existing) {
        existing.score += rrfScore
      } else {
        rrfScores.set(doc.docId, { score: rrfScore, numericId: doc.numericId })
      }
    }

    return Array.from(rrfScores.entries())
      .map(([docId, data]) => ({
        docId,
        numericId: data.numericId,
        score: data.score,
      }))
      .sort((a, b) => b.score - a.score)
  }

  private mergeResults(bm25Results: ScoredDoc[], vectorResults: ScoredDoc[]): ScoredDoc[] {
    const merged = new Map<string, ScoredDoc>()

    for (const doc of bm25Results) {
      merged.set(doc.docId, doc)
    }

    for (const doc of vectorResults) {
      const existing = merged.get(doc.docId)
      if (existing) {
        existing.score = (existing.score + doc.score) / 2
      } else {
        merged.set(doc.docId, doc)
      }
    }

    return Array.from(merged.values())
  }

  // ==========================================================================
  // SORTING
  // ==========================================================================

  private sortResults(docs: ScoredDoc[], sort: Sort): ScoredDoc[] {
    return docs.sort((a, b) => {
      for (const sortItem of sort) {
        let field: string
        let order: 'asc' | 'desc' = 'asc'

        if (typeof sortItem === 'string') {
          field = sortItem
        } else if ('_score' in sortItem) {
          field = '_score'
          const scoreConfig = sortItem._score
          order = typeof scoreConfig === 'string' ? scoreConfig : scoreConfig.order || 'desc'
        } else {
          field = Object.keys(sortItem)[0]
          const fieldConfig = sortItem[field]
          order = typeof fieldConfig === 'string' ? fieldConfig : fieldConfig.order || 'asc'
        }

        let aValue: unknown
        let bValue: unknown

        if (field === '_score') {
          aValue = a.score
          bValue = b.score
        } else {
          const aDoc = this.indexer.get(a.docId)
          const bDoc = this.indexer.get(b.docId)
          aValue = aDoc ? this.indexer.getFieldValue(aDoc._source, field) : undefined
          bValue = bDoc ? this.indexer.getFieldValue(bDoc._source, field) : undefined
        }

        const comparison = this.compareValues(aValue, bValue)
        if (comparison !== 0) {
          return order === 'asc' ? comparison : -comparison
        }
      }
      return 0
    })
  }

  private compareValues(a: unknown, b: unknown): number {
    if (a === undefined || a === null) return 1
    if (b === undefined || b === null) return -1

    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b)
    }

    if (typeof a === 'number' && typeof b === 'number') {
      return a - b
    }

    return String(a).localeCompare(String(b))
  }

  // ==========================================================================
  // HIT BUILDING
  // ==========================================================================

  private buildHits<T extends Document>(
    scoredDocs: ScoredDoc[],
    request: SearchRequest<T>
  ): Hit<T>[] {
    return scoredDocs.map((scored) => {
      const doc = this.indexer.get(scored.docId)
      if (!doc) {
        return null
      }

      const hit: Hit<T> = {
        _index: this.indexer.name,
        _id: doc._id,
        _score: request.track_scores !== false ? scored.score : null,
        _source: this.filterSource(doc._source as T, request._source),
      }

      // Add highlighting
      if (request.highlight && request.query) {
        hit.highlight = this.generateHighlights(doc._source, request.query, request.highlight)
      }

      return hit
    }).filter((h): h is Hit<T> => h !== null)
  }

  private filterSource<T extends Document>(source: T, filter?: SourceFilter): T {
    if (filter === false) {
      return undefined as unknown as T
    }

    if (filter === true || filter === undefined) {
      return source
    }

    if (typeof filter === 'string') {
      return { [filter]: source[filter] } as T
    }

    if (Array.isArray(filter)) {
      const result: Document = {}
      for (const field of filter) {
        if (field in source) {
          result[field] = source[field]
        }
      }
      return result as T
    }

    // Object with includes/excludes
    const result: Document = {}
    const includes = filter.includes || Object.keys(source)
    const excludes = new Set(filter.excludes || [])

    for (const field of includes) {
      if (!excludes.has(field) && field in source) {
        result[field] = source[field]
      }
    }

    return result as T
  }

  private generateHighlights(
    source: Document,
    query: Query,
    config: Highlight
  ): Record<string, string[]> {
    const highlights: Record<string, string[]> = {}
    const preTags = config.pre_tags || ['<em>']
    const postTags = config.post_tags || ['</em>']

    // Extract query terms
    const queryTerms = this.extractQueryTerms(query)

    for (const [field, fieldConfig] of Object.entries(config.fields)) {
      const value = this.indexer.getFieldValue(source, field)
      if (typeof value !== 'string') continue

      const fieldPreTags = fieldConfig.pre_tags || preTags
      const fieldPostTags = fieldConfig.post_tags || postTags
      const fragmentSize = fieldConfig.fragment_size || 150
      const numFragments = fieldConfig.number_of_fragments || 5

      // Find and highlight matching terms
      const fragments = this.highlightField(
        value,
        queryTerms,
        fieldPreTags[0],
        fieldPostTags[0],
        fragmentSize,
        numFragments
      )

      if (fragments.length > 0) {
        highlights[field] = fragments
      }
    }

    return highlights
  }

  private extractQueryTerms(query: Query): string[] {
    const terms: string[] = []

    if ('match' in query) {
      const field = Object.keys(query.match)[0]
      const config = query.match[field]
      const text = typeof config === 'string' ? config : (config as { query: string }).query
      terms.push(...this.indexer.tokenizeField(field, text))
    } else if ('multi_match' in query) {
      terms.push(...this.indexer.tokenizeField('', query.multi_match.query))
    } else if ('bool' in query) {
      const { must, should } = query.bool
      for (const clause of [...(must || []), ...(should || [])]) {
        terms.push(...this.extractQueryTerms(clause))
      }
    }

    return [...new Set(terms)]
  }

  private highlightField(
    text: string,
    terms: string[],
    preTag: string,
    postTag: string,
    fragmentSize: number,
    numFragments: number
  ): string[] {
    const fragments: string[] = []
    const lowerText = text.toLowerCase()

    for (const term of terms) {
      const lowerTerm = term.toLowerCase()
      let startIndex = 0

      while (startIndex < text.length && fragments.length < numFragments) {
        const termIndex = lowerText.indexOf(lowerTerm, startIndex)
        if (termIndex === -1) break

        // Extract fragment around the term
        const fragStart = Math.max(0, termIndex - fragmentSize / 2)
        const fragEnd = Math.min(text.length, termIndex + lowerTerm.length + fragmentSize / 2)

        let fragment = text.slice(fragStart, fragEnd)

        // Highlight the term in the fragment
        const termInFragment = fragment.toLowerCase().indexOf(lowerTerm)
        if (termInFragment !== -1) {
          fragment =
            fragment.slice(0, termInFragment) +
            preTag +
            fragment.slice(termInFragment, termInFragment + lowerTerm.length) +
            postTag +
            fragment.slice(termInFragment + lowerTerm.length)
        }

        fragments.push(fragment)
        startIndex = termIndex + lowerTerm.length
      }
    }

    return fragments.slice(0, numFragments)
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Get the underlying vector index
   */
  getVectorIndex(): HNSWIndex | null {
    return this.vectorIndex
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new search executor
 */
export function createSearchExecutor(
  indexer: ElasticsearchIndexer,
  options: SearchExecutorOptions = {}
): SearchExecutor {
  return new SearchExecutor(indexer, options)
}
