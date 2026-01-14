/**
 * BM25 Scoring Algorithm
 *
 * Implementation of BM25 (Best Matching 25) relevance scoring for full-text search.
 * BM25 is a ranking function that considers term frequency, document length,
 * and inverse document frequency.
 *
 * @module db/primitives/inverted-index/bm25
 */

// ============================================================================
// Constants
// ============================================================================

/** BM25 k1 parameter - controls term frequency saturation (default: 1.2) */
export const BM25_K1 = 1.2

/** BM25 b parameter - controls document length normalization (default: 0.75) */
export const BM25_B = 0.75

// ============================================================================
// Types
// ============================================================================

/**
 * Index statistics for BM25 scoring
 */
export interface IndexStats {
  /** Total number of documents in the index */
  totalDocs: number
  /** Average document length in terms */
  avgDocLength: number
  /** Sum of all document lengths */
  totalLength: number
}

/**
 * Parameters for scoring a single term
 */
export interface TermScoreParams {
  /** Term frequency in the document */
  tf: number
  /** Document frequency (number of docs containing the term) */
  df: number
  /** Length of the document being scored */
  docLength: number
}

/**
 * Term score info for multi-term document scoring
 */
export interface TermScore {
  /** Term frequency in the document */
  tf: number
  /** Document frequency */
  df: number
}

/**
 * Parameters for scoring a document with multiple terms
 */
export interface DocumentScoreParams {
  /** Length of the document */
  docLength: number
  /** Score info for each matching term */
  termScores: TermScore[]
}

/**
 * BM25 scorer options
 */
export interface BM25ScorerOptions {
  /** k1 parameter (default: 1.2) */
  k1?: number
  /** b parameter (default: 0.75) */
  b?: number
}

// ============================================================================
// IDF Calculation
// ============================================================================

/**
 * Calculate BM25 IDF (Inverse Document Frequency) component
 *
 * Uses the BM25+ variant that ensures IDF is always positive:
 * IDF = log((N + 1) / (df + 0.5))
 *
 * Where:
 * - N = total number of documents
 * - df = number of documents containing the term
 *
 * @param totalDocs - Total number of documents in the corpus
 * @param df - Document frequency of the term
 * @returns The IDF value (always positive with BM25+)
 */
export function calculateIDF(totalDocs: number, df: number): number {
  // Handle edge case of empty corpus
  if (totalDocs === 0) {
    return 0
  }

  // BM25+ variant: always positive IDF
  // Uses (N + 1) / (df + 0.5) to ensure positive values even for common terms
  return Math.log((totalDocs + 1) / (df + 0.5))
}

// ============================================================================
// BM25 Score Calculation
// ============================================================================

/**
 * Calculate BM25 score for a term in a document
 *
 * BM25 formula:
 * score = IDF * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLength/avgDocLength))
 *
 * Where:
 * - IDF = inverse document frequency
 * - tf = term frequency in the document
 * - k1 = term frequency saturation parameter
 * - b = document length normalization parameter
 * - docLength = length of the document
 * - avgDocLength = average document length in the corpus
 *
 * @param tf - Term frequency in the document
 * @param docLength - Length of the document
 * @param avgDocLength - Average document length
 * @param idf - Pre-calculated IDF value
 * @param k1 - k1 parameter (default: BM25_K1)
 * @param b - b parameter (default: BM25_B)
 * @returns The BM25 score for this term
 */
export function calculateBM25Score(
  tf: number,
  docLength: number,
  avgDocLength: number,
  idf: number,
  k1: number = BM25_K1,
  b: number = BM25_B
): number {
  // No term occurrences = no score
  if (tf === 0) {
    return 0
  }

  // Handle edge case of avgDocLength = 0 (empty corpus)
  // Treat as if document length is normalized to 1
  const normalizedLength = avgDocLength > 0 ? docLength / avgDocLength : 1

  // BM25 score formula
  const numerator = tf * (k1 + 1)
  const denominator = tf + k1 * (1 - b + b * normalizedLength)

  return idf * (numerator / denominator)
}

// ============================================================================
// BM25Scorer Class
// ============================================================================

/**
 * BM25 scorer instance with index statistics
 *
 * Caches IDF calculations and provides methods for scoring
 * individual terms and complete documents.
 */
export class BM25Scorer {
  /** Index statistics */
  private stats: IndexStats

  /** k1 parameter */
  private k1: number

  /** b parameter */
  private b: number

  /** IDF cache by document frequency */
  private idfCache: Map<number, number> = new Map()

  /**
   * Create a new BM25 scorer
   *
   * @param stats - Index statistics (totalDocs, avgDocLength)
   * @param options - Optional k1 and b parameters
   */
  constructor(stats: IndexStats, options: BM25ScorerOptions = {}) {
    this.stats = { ...stats }
    this.k1 = options.k1 ?? BM25_K1
    this.b = options.b ?? BM25_B
  }

  /**
   * Get (cached) IDF for a document frequency
   */
  private getIDF(df: number): number {
    let idf = this.idfCache.get(df)
    if (idf === undefined) {
      idf = calculateIDF(this.stats.totalDocs, df)
      this.idfCache.set(df, idf)
    }
    return idf
  }

  /**
   * Score a single term occurrence in a document
   *
   * @param params - Term scoring parameters
   * @returns The BM25 score for this term
   */
  scoreTerm(params: TermScoreParams): number {
    const idf = this.getIDF(params.df)
    return calculateBM25Score(
      params.tf,
      params.docLength,
      this.stats.avgDocLength,
      idf,
      this.k1,
      this.b
    )
  }

  /**
   * Score a document for multiple query terms
   *
   * Sums BM25 scores across all matching terms.
   *
   * @param params - Document scoring parameters
   * @returns Total BM25 score for the document
   */
  scoreDocument(params: DocumentScoreParams): number {
    let totalScore = 0

    for (const termScore of params.termScores) {
      totalScore += this.scoreTerm({
        tf: termScore.tf,
        df: termScore.df,
        docLength: params.docLength,
      })
    }

    return totalScore
  }
}
