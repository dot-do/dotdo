/**
 * BM25 Scoring Tests (RED Phase)
 *
 * Tests for BM25 (Best Matching 25) relevance scoring algorithm.
 * BM25 is a ranking function used for full-text search that considers
 * term frequency, document length, and inverse document frequency.
 *
 * @module db/primitives/inverted-index/tests/bm25-scoring
 */

import { describe, it, expect } from 'vitest'
import {
  calculateIDF,
  calculateBM25Score,
  BM25Scorer,
  BM25_K1,
  BM25_B,
  IndexStats,
} from '../bm25'

describe('BM25 Scoring', () => {
  // ============================================================================
  // IDF (Inverse Document Frequency) Calculation
  // ============================================================================

  describe('calculateIDF', () => {
    it('should return positive IDF for rare terms (BM25+ variant)', () => {
      // Rare term: appears in 1 out of 1000 docs
      const idf = calculateIDF(1000, 1)
      expect(idf).toBeGreaterThan(0)
    })

    it('should return positive IDF even for common terms', () => {
      // Common term: appears in 900 out of 1000 docs
      const idf = calculateIDF(1000, 900)
      expect(idf).toBeGreaterThan(0) // BM25+ ensures always positive
    })

    it('should return higher IDF for rarer terms', () => {
      const idfRare = calculateIDF(1000, 10)
      const idfCommon = calculateIDF(1000, 500)
      expect(idfRare).toBeGreaterThan(idfCommon)
    })

    it('should handle df = 0 (term not in corpus)', () => {
      // Should not throw, return high IDF
      const idf = calculateIDF(1000, 0)
      expect(idf).toBeGreaterThan(0)
      expect(Number.isFinite(idf)).toBe(true)
    })

    it('should handle totalDocs = 0 (empty corpus)', () => {
      const idf = calculateIDF(0, 0)
      expect(Number.isFinite(idf)).toBe(true)
    })

    it('should handle df = totalDocs (term in every doc)', () => {
      const idf = calculateIDF(100, 100)
      expect(idf).toBeGreaterThan(0) // BM25+ ensures positive
    })

    it('should follow BM25+ formula: log((N + 1) / (df + 0.5))', () => {
      const totalDocs = 1000
      const df = 100
      const expected = Math.log((totalDocs + 1) / (df + 0.5))
      const actual = calculateIDF(totalDocs, df)
      expect(actual).toBeCloseTo(expected, 10)
    })

    it('should handle single document corpus', () => {
      const idf = calculateIDF(1, 1)
      expect(idf).toBeGreaterThan(0)
      expect(Number.isFinite(idf)).toBe(true)
    })
  })

  // ============================================================================
  // BM25 Score Calculation
  // ============================================================================

  describe('calculateBM25Score', () => {
    const defaultIdf = Math.log(2) // Simple IDF for testing

    it('should return 0 for tf = 0', () => {
      const score = calculateBM25Score(0, 100, 100, defaultIdf)
      expect(score).toBe(0)
    })

    it('should return positive score for tf > 0', () => {
      const score = calculateBM25Score(1, 100, 100, defaultIdf)
      expect(score).toBeGreaterThan(0)
    })

    it('should increase score with higher tf (diminishing returns)', () => {
      const score1 = calculateBM25Score(1, 100, 100, defaultIdf)
      const score2 = calculateBM25Score(2, 100, 100, defaultIdf)
      const score5 = calculateBM25Score(5, 100, 100, defaultIdf)
      const score10 = calculateBM25Score(10, 100, 100, defaultIdf)

      expect(score2).toBeGreaterThan(score1)
      expect(score5).toBeGreaterThan(score2)
      expect(score10).toBeGreaterThan(score5)

      // Diminishing returns: delta decreases
      const delta1to2 = score2 - score1
      const delta5to10 = score10 - score5
      expect(delta1to2).toBeGreaterThan(delta5to10 / 5)
    })

    it('should penalize long documents', () => {
      // Same tf=3 in short vs long document
      const scoreShort = calculateBM25Score(3, 50, 100, defaultIdf)
      const scoreLong = calculateBM25Score(3, 200, 100, defaultIdf)

      expect(scoreShort).toBeGreaterThan(scoreLong)
    })

    it('should boost short documents', () => {
      // Document shorter than average should score higher
      const scoreShort = calculateBM25Score(3, 50, 100, defaultIdf)
      const scoreAvg = calculateBM25Score(3, 100, 100, defaultIdf)

      expect(scoreShort).toBeGreaterThan(scoreAvg)
    })

    it('should scale with IDF', () => {
      const lowIdf = Math.log(1.5)
      const highIdf = Math.log(10)

      const scoreLowIdf = calculateBM25Score(3, 100, 100, lowIdf)
      const scoreHighIdf = calculateBM25Score(3, 100, 100, highIdf)

      expect(scoreHighIdf).toBeGreaterThan(scoreLowIdf)
    })

    it('should follow BM25 formula with default k1=1.2 and b=0.75', () => {
      const tf = 3
      const docLength = 100
      const avgDocLength = 100
      const idf = Math.log(2)
      const k1 = BM25_K1 // 1.2
      const b = BM25_B // 0.75

      const numerator = tf * (k1 + 1)
      const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength))
      const expected = idf * (numerator / denominator)

      const actual = calculateBM25Score(tf, docLength, avgDocLength, idf)
      expect(actual).toBeCloseTo(expected, 10)
    })

    it('should handle custom k1 and b parameters', () => {
      const score1 = calculateBM25Score(3, 100, 100, defaultIdf, 1.2, 0.75)
      const score2 = calculateBM25Score(3, 100, 100, defaultIdf, 2.0, 0.5)

      // Different parameters should give different scores
      expect(score1).not.toBeCloseTo(score2, 5)
    })

    it('should handle b=0 (no length normalization)', () => {
      // With b=0, document length should not affect score
      const scoreShort = calculateBM25Score(3, 50, 100, defaultIdf, 1.2, 0)
      const scoreLong = calculateBM25Score(3, 200, 100, defaultIdf, 1.2, 0)

      expect(scoreShort).toBeCloseTo(scoreLong, 10)
    })

    it('should handle b=1 (full length normalization)', () => {
      // With b=1, length normalization is fully applied
      const scoreShort = calculateBM25Score(3, 50, 100, defaultIdf, 1.2, 1)
      const scoreLong = calculateBM25Score(3, 200, 100, defaultIdf, 1.2, 1)

      expect(scoreShort).toBeGreaterThan(scoreLong)
    })

    it('should handle avgDocLength = 0', () => {
      // Edge case: should not divide by zero
      const score = calculateBM25Score(3, 100, 0, defaultIdf)
      expect(Number.isFinite(score)).toBe(true)
    })
  })

  // ============================================================================
  // BM25Scorer Class
  // ============================================================================

  describe('BM25Scorer', () => {
    describe('initialization', () => {
      it('should create scorer with index stats', () => {
        const stats: IndexStats = {
          totalDocs: 1000,
          avgDocLength: 150,
          totalLength: 150000,
        }
        const scorer = new BM25Scorer(stats)
        expect(scorer).toBeDefined()
      })

      it('should allow custom k1 and b parameters', () => {
        const stats: IndexStats = {
          totalDocs: 1000,
          avgDocLength: 150,
          totalLength: 150000,
        }
        const scorer = new BM25Scorer(stats, { k1: 2.0, b: 0.5 })
        expect(scorer).toBeDefined()
      })
    })

    describe('scoreTerm', () => {
      let scorer: BM25Scorer
      const stats: IndexStats = {
        totalDocs: 1000,
        avgDocLength: 100,
        totalLength: 100000,
      }

      beforeEach(() => {
        scorer = new BM25Scorer(stats)
      })

      it('should score a single term occurrence', () => {
        const score = scorer.scoreTerm({
          tf: 1,
          df: 100,
          docLength: 100,
        })
        expect(score).toBeGreaterThan(0)
      })

      it('should cache IDF calculations', () => {
        // Scoring same df multiple times should reuse cached IDF
        const score1 = scorer.scoreTerm({ tf: 1, df: 50, docLength: 100 })
        const score2 = scorer.scoreTerm({ tf: 1, df: 50, docLength: 100 })
        expect(score1).toBe(score2)
      })

      it('should handle rare term (high df)', () => {
        const scoreRare = scorer.scoreTerm({ tf: 1, df: 1, docLength: 100 })
        const scoreCommon = scorer.scoreTerm({ tf: 1, df: 500, docLength: 100 })
        expect(scoreRare).toBeGreaterThan(scoreCommon)
      })
    })

    describe('scoreDocument', () => {
      let scorer: BM25Scorer
      const stats: IndexStats = {
        totalDocs: 1000,
        avgDocLength: 100,
        totalLength: 100000,
      }

      beforeEach(() => {
        scorer = new BM25Scorer(stats)
      })

      it('should accumulate scores for multiple terms', () => {
        const singleTermScore = scorer.scoreDocument({
          docLength: 100,
          termScores: [{ tf: 1, df: 100 }],
        })

        const multiTermScore = scorer.scoreDocument({
          docLength: 100,
          termScores: [
            { tf: 1, df: 100 },
            { tf: 1, df: 100 },
          ],
        })

        expect(multiTermScore).toBeGreaterThan(singleTermScore)
      })

      it('should return 0 for no term matches', () => {
        const score = scorer.scoreDocument({
          docLength: 100,
          termScores: [],
        })
        expect(score).toBe(0)
      })

      it('should weight rare terms higher', () => {
        // Document with one rare term
        const scoreRare = scorer.scoreDocument({
          docLength: 100,
          termScores: [{ tf: 1, df: 1 }],
        })

        // Document with one common term
        const scoreCommon = scorer.scoreDocument({
          docLength: 100,
          termScores: [{ tf: 1, df: 500 }],
        })

        expect(scoreRare).toBeGreaterThan(scoreCommon)
      })

      it('should handle multiple terms with different TFs', () => {
        const score = scorer.scoreDocument({
          docLength: 100,
          termScores: [
            { tf: 3, df: 100 },
            { tf: 1, df: 50 },
            { tf: 5, df: 200 },
          ],
        })
        expect(score).toBeGreaterThan(0)
      })
    })
  })

  // ============================================================================
  // Ranking Correctness
  // ============================================================================

  describe('ranking correctness', () => {
    const stats: IndexStats = {
      totalDocs: 1000,
      avgDocLength: 100,
      totalLength: 100000,
    }

    it('should rank document with more query term occurrences higher', () => {
      const scorer = new BM25Scorer(stats)

      // Doc A: query term appears once
      const scoreA = scorer.scoreDocument({
        docLength: 100,
        termScores: [{ tf: 1, df: 100 }],
      })

      // Doc B: query term appears 5 times
      const scoreB = scorer.scoreDocument({
        docLength: 100,
        termScores: [{ tf: 5, df: 100 }],
      })

      expect(scoreB).toBeGreaterThan(scoreA)
    })

    it('should rank document with more matching terms higher', () => {
      const scorer = new BM25Scorer(stats)

      // Doc A: matches 1 query term
      const scoreA = scorer.scoreDocument({
        docLength: 100,
        termScores: [{ tf: 1, df: 100 }],
      })

      // Doc B: matches 3 query terms
      const scoreB = scorer.scoreDocument({
        docLength: 100,
        termScores: [
          { tf: 1, df: 100 },
          { tf: 1, df: 100 },
          { tf: 1, df: 100 },
        ],
      })

      expect(scoreB).toBeGreaterThan(scoreA)
    })

    it('should rank shorter document higher (same tf)', () => {
      const scorer = new BM25Scorer(stats)

      // Short doc with tf=2
      const scoreShort = scorer.scoreDocument({
        docLength: 50,
        termScores: [{ tf: 2, df: 100 }],
      })

      // Long doc with tf=2
      const scoreLong = scorer.scoreDocument({
        docLength: 200,
        termScores: [{ tf: 2, df: 100 }],
      })

      expect(scoreShort).toBeGreaterThan(scoreLong)
    })

    it('should rank document with rarer terms higher', () => {
      const scorer = new BM25Scorer(stats)

      // Doc with rare term (df=10)
      const scoreRare = scorer.scoreDocument({
        docLength: 100,
        termScores: [{ tf: 1, df: 10 }],
      })

      // Doc with common term (df=500)
      const scoreCommon = scorer.scoreDocument({
        docLength: 100,
        termScores: [{ tf: 1, df: 500 }],
      })

      expect(scoreRare).toBeGreaterThan(scoreCommon)
    })

    it('should produce deterministic rankings', () => {
      const scorer = new BM25Scorer(stats)

      const docs = [
        { id: 'A', docLength: 100, termScores: [{ tf: 1, df: 100 }] },
        { id: 'B', docLength: 50, termScores: [{ tf: 3, df: 50 }] },
        { id: 'C', docLength: 150, termScores: [{ tf: 2, df: 200 }] },
      ]

      const scores1 = docs.map((d) => scorer.scoreDocument(d))
      const scores2 = docs.map((d) => scorer.scoreDocument(d))

      expect(scores1).toEqual(scores2)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle single document corpus', () => {
      const stats: IndexStats = {
        totalDocs: 1,
        avgDocLength: 100,
        totalLength: 100,
      }
      const scorer = new BM25Scorer(stats)

      const score = scorer.scoreDocument({
        docLength: 100,
        termScores: [{ tf: 1, df: 1 }],
      })
      expect(Number.isFinite(score)).toBe(true)
      expect(score).toBeGreaterThan(0)
    })

    it('should handle very long documents', () => {
      const stats: IndexStats = {
        totalDocs: 1000,
        avgDocLength: 100,
        totalLength: 100000,
      }
      const scorer = new BM25Scorer(stats)

      const score = scorer.scoreDocument({
        docLength: 100000,
        termScores: [{ tf: 1, df: 100 }],
      })
      expect(Number.isFinite(score)).toBe(true)
      expect(score).toBeGreaterThan(0)
    })

    it('should handle very high term frequency', () => {
      const stats: IndexStats = {
        totalDocs: 1000,
        avgDocLength: 100,
        totalLength: 100000,
      }
      const scorer = new BM25Scorer(stats)

      const score = scorer.scoreDocument({
        docLength: 10000,
        termScores: [{ tf: 1000, df: 100 }],
      })
      expect(Number.isFinite(score)).toBe(true)
      expect(score).toBeGreaterThan(0)
    })

    it('should handle document length of 1', () => {
      const stats: IndexStats = {
        totalDocs: 1000,
        avgDocLength: 100,
        totalLength: 100000,
      }
      const scorer = new BM25Scorer(stats)

      const score = scorer.scoreDocument({
        docLength: 1,
        termScores: [{ tf: 1, df: 100 }],
      })
      expect(Number.isFinite(score)).toBe(true)
    })

    it('should handle df = totalDocs (term in every document)', () => {
      const stats: IndexStats = {
        totalDocs: 1000,
        avgDocLength: 100,
        totalLength: 100000,
      }
      const scorer = new BM25Scorer(stats)

      const score = scorer.scoreTerm({
        tf: 1,
        df: 1000,
        docLength: 100,
      })
      // Should still be positive with BM25+
      expect(score).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // Default Parameters
  // ============================================================================

  describe('default parameters', () => {
    it('should export BM25_K1 constant with value 1.2', () => {
      expect(BM25_K1).toBe(1.2)
    })

    it('should export BM25_B constant with value 0.75', () => {
      expect(BM25_B).toBe(0.75)
    })
  })
})
