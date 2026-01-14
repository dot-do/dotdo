/**
 * RankFusion Primitives
 *
 * Algorithms for combining multiple search result rankings into a unified ranking.
 * Essential for hybrid search that combines keyword (BM25) and vector similarity results.
 *
 * Supported fusion methods:
 * - Reciprocal Rank Fusion (RRF): Combines rankings based on position, not scores
 * - Linear Combination: Weighted sum of normalized scores
 * - CombSUM: Sum of normalized scores across lists
 * - CombMNZ: Sum multiplied by number of lists containing the document
 * - Interleaving: Balanced merging for A/B testing
 *
 * @module db/primitives/rank-fusion
 */

// ============================================================================
// Constants
// ============================================================================

/** Default k parameter for Reciprocal Rank Fusion (RRF) */
export const RRF_DEFAULT_K = 60

// ============================================================================
// Types
// ============================================================================

/**
 * A single ranked result from a search operation
 */
export interface RankedResult {
  /** Unique document identifier */
  id: string
  /** Relevance score (higher is better) */
  score: number
  /** Optional metadata about the result */
  metadata?: Record<string, unknown>
}

/**
 * A named and weighted set of search results
 */
export interface SearchResultSet {
  /** The ranked results */
  results: RankedResult[]
  /** Optional name for the result set (e.g., 'bm25', 'vector') */
  name?: string
  /** Optional weight for this result set in weighted fusion */
  weight?: number
}

/**
 * Options for RRF fusion
 */
export interface RRFOptions {
  /** The k parameter (default: 60) - higher k reduces impact of high ranks */
  k?: number
}

/**
 * Options for linear combination fusion
 */
export interface LinearOptions {
  /** Weights for each result set (must match number of result sets) */
  weights?: number[]
  /** Whether to normalize scores before combining (default: true) */
  normalize?: boolean
}

/**
 * Options for score normalization
 */
export interface NormalizeOptions {
  /** Normalization method */
  method?: 'min-max' | 'z-score'
}

/**
 * Options for interleaving
 */
export interface InterleaveOptions {
  /** Interleaving method */
  method?: 'round-robin' | 'team-draft'
  /** Whether to track which source each result came from */
  trackSource?: boolean
}

/**
 * Options for the RankFusion fuse method
 */
export interface FusionOptions {
  /** Fusion method to use */
  method?: 'rrf' | 'linear' | 'combsum' | 'combmnz' | 'interleave'
  /** Limit number of results */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** RRF k parameter */
  k?: number
  /** Weights for linear combination */
  weights?: number[]
  /** Whether to normalize scores */
  normalize?: boolean
}

/**
 * Options for adding a result set to the fusion builder
 */
export interface ResultSetOptions {
  /** Weight for this result set */
  weight?: number
  /** Name for this result set */
  name?: string
}

/**
 * RankFusion instance options
 */
export interface RankFusionOptions {
  /** Default fusion method */
  defaultMethod?: 'rrf' | 'linear' | 'combsum' | 'combmnz' | 'interleave'
  /** Default k for RRF */
  rrfK?: number
  /** Whether to normalize by default */
  normalizeByDefault?: boolean
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Deduplicate results by ID, keeping the one with highest score
 */
function deduplicateResults(results: RankedResult[]): RankedResult[] {
  const byId = new Map<string, RankedResult>()

  for (const result of results) {
    const existing = byId.get(result.id)
    if (!existing || result.score > existing.score) {
      byId.set(result.id, result)
    }
  }

  return Array.from(byId.values())
}

/**
 * Merge metadata from multiple sources for the same document
 */
function mergeMetadata(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!existing && !incoming) return undefined
  if (!existing) return incoming
  if (!incoming) return existing
  return { ...incoming, ...existing } // Existing takes precedence
}

// ============================================================================
// Score Normalization
// ============================================================================

/**
 * Normalize scores to a standard range
 *
 * @param results - Results to normalize
 * @param options - Normalization options
 * @returns Results with normalized scores
 */
export function normalizeScores(
  results: RankedResult[],
  options: NormalizeOptions = {},
): RankedResult[] {
  if (results.length === 0) return []
  if (results.length === 1) {
    return [{ ...results[0]!, score: 1 }]
  }

  const method = options.method ?? 'min-max'

  if (method === 'min-max') {
    const scores = results.map((r) => r.score)
    const min = Math.min(...scores)
    const max = Math.max(...scores)
    const range = max - min

    if (range === 0) {
      // All scores are identical
      return results.map((r) => ({ ...r, score: 1 }))
    }

    return results.map((r) => ({
      ...r,
      score: (r.score - min) / range,
    }))
  }

  // z-score normalization
  const scores = results.map((r) => r.score)
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance =
    scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length
  const stdDev = Math.sqrt(variance)

  if (stdDev === 0) {
    return results.map((r) => ({ ...r, score: 0 }))
  }

  return results.map((r) => ({
    ...r,
    score: (r.score - mean) / stdDev,
  }))
}

// ============================================================================
// Reciprocal Rank Fusion (RRF)
// ============================================================================

/**
 * Reciprocal Rank Fusion (RRF)
 *
 * Combines multiple rankings based on position rather than score.
 * For each document: RRF_score = sum(1 / (k + rank_i))
 *
 * This is particularly effective when:
 * - Score distributions differ across result sets
 * - Relative ranking is more reliable than absolute scores
 *
 * @param rankings - Array of ranked result sets to fuse
 * @param options - RRF options (k parameter)
 * @returns Fused results sorted by combined RRF score
 */
export function reciprocalRankFusion(
  rankings: RankedResult[][],
  options: RRFOptions = {},
): RankedResult[] {
  if (rankings.length === 0) return []

  const k = options.k ?? RRF_DEFAULT_K

  // Build a map of document ID to aggregated RRF score and metadata
  const scoreMap = new Map<
    string,
    { score: number; metadata?: Record<string, unknown> }
  >()

  for (const ranking of rankings) {
    // First deduplicate within the ranking
    const deduped = deduplicateResults(ranking)

    // Sort by score descending to establish rank
    const sorted = [...deduped].sort((a, b) => b.score - a.score)

    for (let rank = 0; rank < sorted.length; rank++) {
      const result = sorted[rank]!
      const rrfScore = 1 / (k + rank + 1) // rank is 0-indexed, formula uses 1-indexed

      const existing = scoreMap.get(result.id)
      if (existing) {
        existing.score += rrfScore
        existing.metadata = mergeMetadata(existing.metadata, result.metadata)
      } else {
        scoreMap.set(result.id, {
          score: rrfScore,
          metadata: result.metadata,
        })
      }
    }
  }

  // Convert to array and sort by RRF score descending
  const results: RankedResult[] = Array.from(scoreMap.entries()).map(
    ([id, { score, metadata }]) => ({
      id,
      score,
      metadata,
    }),
  )

  results.sort((a, b) => b.score - a.score)

  return results
}

// ============================================================================
// Linear Combination
// ============================================================================

/**
 * Linear Combination Fusion
 *
 * Combines scores using weighted sum after optional normalization.
 * For each document: score = sum(weight_i * normalized_score_i)
 *
 * @param rankings - Array of ranked result sets to fuse
 * @param options - Linear combination options
 * @returns Fused results sorted by combined score
 */
export function linearCombination(
  rankings: RankedResult[][],
  options: LinearOptions = {},
): RankedResult[] {
  if (rankings.length === 0) return []

  const weights = options.weights ?? rankings.map(() => 1 / rankings.length)
  const shouldNormalize = options.normalize ?? true

  if (weights.length !== rankings.length) {
    throw new Error(
      `Number of weights (${weights.length}) must match number of result sets (${rankings.length})`,
    )
  }

  // Normalize each ranking if requested
  const normalizedRankings = shouldNormalize
    ? rankings.map((r) => normalizeScores(deduplicateResults(r), { method: 'min-max' }))
    : rankings.map((r) => deduplicateResults(r))

  // Build score map with weighted combination
  const scoreMap = new Map<
    string,
    { score: number; metadata?: Record<string, unknown> }
  >()

  for (let i = 0; i < normalizedRankings.length; i++) {
    const ranking = normalizedRankings[i]!
    const weight = weights[i]!

    for (const result of ranking) {
      const weightedScore = result.score * weight

      const existing = scoreMap.get(result.id)
      if (existing) {
        existing.score += weightedScore
        existing.metadata = mergeMetadata(existing.metadata, result.metadata)
      } else {
        scoreMap.set(result.id, {
          score: weightedScore,
          metadata: result.metadata,
        })
      }
    }
  }

  // Convert to array and sort
  const results: RankedResult[] = Array.from(scoreMap.entries()).map(
    ([id, { score, metadata }]) => ({
      id,
      score,
      metadata,
    }),
  )

  results.sort((a, b) => b.score - a.score)

  return results
}

// ============================================================================
// CombSUM
// ============================================================================

/**
 * CombSUM Fusion
 *
 * Sums normalized scores across all result sets.
 * Documents appearing in multiple lists naturally score higher.
 *
 * @param rankings - Array of ranked result sets to fuse
 * @returns Fused results sorted by combined score
 */
export function combSUM(rankings: RankedResult[][]): RankedResult[] {
  // CombSUM is just linearCombination with equal weights and normalization
  return linearCombination(rankings, {
    weights: rankings.map(() => 1),
    normalize: true,
  })
}

// ============================================================================
// CombMNZ (Multiply by Number of Non-Zero)
// ============================================================================

/**
 * CombMNZ Fusion
 *
 * Like CombSUM but multiplies the sum by the number of lists containing
 * the document. This heavily favors documents appearing in multiple lists.
 *
 * @param rankings - Array of ranked result sets to fuse
 * @returns Fused results sorted by combined score
 */
export function combMNZ(rankings: RankedResult[][]): RankedResult[] {
  if (rankings.length === 0) return []

  // Normalize each ranking
  const normalizedRankings = rankings.map((r) =>
    normalizeScores(deduplicateResults(r), { method: 'min-max' }),
  )

  // Build score map tracking sum and count
  const scoreMap = new Map<
    string,
    { sum: number; count: number; metadata?: Record<string, unknown> }
  >()

  for (const ranking of normalizedRankings) {
    for (const result of ranking) {
      const existing = scoreMap.get(result.id)
      if (existing) {
        existing.sum += result.score
        existing.count += 1
        existing.metadata = mergeMetadata(existing.metadata, result.metadata)
      } else {
        scoreMap.set(result.id, {
          sum: result.score,
          count: 1,
          metadata: result.metadata,
        })
      }
    }
  }

  // Convert to array with MNZ scoring
  const results: RankedResult[] = Array.from(scoreMap.entries()).map(
    ([id, { sum, count, metadata }]) => ({
      id,
      score: sum * count, // Multiply by number of lists containing this doc
      metadata,
    }),
  )

  results.sort((a, b) => b.score - a.score)

  return results
}

// ============================================================================
// Interleaving
// ============================================================================

/**
 * Interleave Fusion
 *
 * Merges rankings by alternating between them, useful for A/B testing
 * different ranking algorithms without introducing bias.
 *
 * @param rankings - Array of ranked result sets to interleave
 * @param options - Interleaving options
 * @returns Interleaved results
 */
export function interleave(
  rankings: RankedResult[][],
  options: InterleaveOptions = {},
): RankedResult[] {
  if (rankings.length === 0) return []

  const method = options.method ?? 'round-robin'
  const trackSource = options.trackSource ?? false

  // Deduplicate each ranking first
  const dedupedRankings = rankings.map((r) => {
    const deduped = deduplicateResults(r)
    return [...deduped].sort((a, b) => b.score - a.score)
  })

  const seen = new Set<string>()
  const results: RankedResult[] = []

  if (method === 'team-draft') {
    // Team-draft interleaving: each "team" picks their best available
    const pointers = dedupedRankings.map(() => 0)
    let currentTeam = 0

    while (results.length < getTotalUniqueCount(dedupedRankings, seen)) {
      const ranking = dedupedRankings[currentTeam]!
      let pointer = pointers[currentTeam]!

      // Find next unseen document for this team
      while (pointer < ranking.length && seen.has(ranking[pointer]!.id)) {
        pointer++
      }

      if (pointer < ranking.length) {
        const result = ranking[pointer]!
        seen.add(result.id)

        const finalResult: RankedResult = {
          ...result,
          score: results.length, // Position-based score for interleaving
        }

        if (trackSource) {
          finalResult.metadata = {
            ...finalResult.metadata,
            _sources: [currentTeam],
          }
        }

        results.push(finalResult)
        pointers[currentTeam] = pointer + 1
      }

      // Move to next team
      currentTeam = (currentTeam + 1) % rankings.length
    }
  } else {
    // Round-robin interleaving
    const pointers = dedupedRankings.map(() => 0)
    let rankingIdx = 0

    const totalUnique = new Set(dedupedRankings.flatMap((r) => r.map((x) => x.id)))
      .size

    while (results.length < totalUnique) {
      const ranking = dedupedRankings[rankingIdx]!
      let pointer = pointers[rankingIdx]!

      // Find next unseen document
      while (pointer < ranking.length && seen.has(ranking[pointer]!.id)) {
        pointer++
      }

      if (pointer < ranking.length) {
        const result = ranking[pointer]!
        seen.add(result.id)

        const finalResult: RankedResult = {
          ...result,
          score: results.length,
        }

        if (trackSource) {
          finalResult.metadata = {
            ...finalResult.metadata,
            _sources: [rankingIdx],
          }
        }

        results.push(finalResult)
        pointers[rankingIdx] = pointer + 1
      }

      rankingIdx = (rankingIdx + 1) % rankings.length
    }
  }

  return results
}

function getTotalUniqueCount(
  rankings: RankedResult[][],
  alreadySeen: Set<string>,
): number {
  const allIds = new Set<string>()
  for (const ranking of rankings) {
    for (const result of ranking) {
      if (!alreadySeen.has(result.id)) {
        allIds.add(result.id)
      }
    }
  }
  return alreadySeen.size + allIds.size
}

// ============================================================================
// RankFusion Class
// ============================================================================

/**
 * RankFusion class for combining multiple search result rankings
 *
 * Supports builder pattern for adding result sets and configurable
 * fusion methods.
 *
 * @example
 * ```typescript
 * const fusion = new RankFusion({ defaultMethod: 'rrf' })
 *
 * // Direct fusion
 * const results = fusion.fuse([keywordResults, vectorResults])
 *
 * // Builder pattern
 * const results = fusion
 *   .addResultSet(keywordResults, { weight: 0.6, name: 'bm25' })
 *   .addResultSet(vectorResults, { weight: 0.4, name: 'vector' })
 *   .fuse({ method: 'linear' })
 * ```
 */
export class RankFusion {
  private options: RankFusionOptions
  private resultSets: Array<{ results: RankedResult[]; options: ResultSetOptions }>

  constructor(options: RankFusionOptions = {}) {
    this.options = {
      defaultMethod: options.defaultMethod ?? 'rrf',
      rrfK: options.rrfK ?? RRF_DEFAULT_K,
      normalizeByDefault: options.normalizeByDefault ?? true,
    }
    this.resultSets = []
  }

  /**
   * Add a result set for fusion (builder pattern)
   */
  addResultSet(results: RankedResult[], options: ResultSetOptions = {}): this {
    this.resultSets.push({ results, options })
    return this
  }

  /**
   * Fuse rankings using the specified method
   *
   * @param rankings - Optional rankings to fuse (uses added result sets if not provided)
   * @param options - Fusion options
   * @returns Fused results
   */
  fuse(rankings?: RankedResult[][], options: FusionOptions = {}): RankedResult[] {
    // Use provided rankings or accumulated result sets
    let toFuse: RankedResult[][]
    let weights: number[] | undefined

    if (rankings && rankings.length > 0) {
      toFuse = rankings
    } else if (this.resultSets.length > 0) {
      toFuse = this.resultSets.map((s) => s.results)
      // Extract weights from result set options if available
      const hasWeights = this.resultSets.some((s) => s.options.weight !== undefined)
      if (hasWeights) {
        weights = this.resultSets.map((s) => s.options.weight ?? 1)
      }
      // Clear accumulated result sets
      this.resultSets = []
    } else {
      return []
    }

    const method = options.method ?? this.options.defaultMethod!
    let results: RankedResult[]

    switch (method) {
      case 'rrf':
        results = reciprocalRankFusion(toFuse, {
          k: options.k ?? this.options.rrfK,
        })
        break

      case 'linear':
        results = linearCombination(toFuse, {
          weights: options.weights ?? weights,
          normalize: options.normalize ?? this.options.normalizeByDefault,
        })
        break

      case 'combsum':
        results = combSUM(toFuse)
        break

      case 'combmnz':
        results = combMNZ(toFuse)
        break

      case 'interleave':
        results = interleave(toFuse)
        break

      default:
        results = reciprocalRankFusion(toFuse)
    }

    // Apply offset and limit
    const offset = options.offset ?? 0
    const limit = options.limit

    if (offset > 0) {
      results = results.slice(offset)
    }

    if (limit !== undefined && limit > 0) {
      results = results.slice(0, limit)
    }

    return results
  }
}
