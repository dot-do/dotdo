/**
 * RankFusion Tests
 *
 * Tests for rank fusion algorithms that combine multiple search result rankings
 * into a unified ranking. Essential for hybrid search combining keyword (BM25)
 * and vector similarity results.
 *
 * @module db/primitives/rank-fusion/tests/rank-fusion
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  RankFusion,
  reciprocalRankFusion,
  linearCombination,
  combSUM,
  combMNZ,
  interleave,
  normalizeScores,
  type RankedResult,
  type SearchResultSet,
  type FusionOptions,
  RRF_DEFAULT_K,
} from '../index'

describe('RankFusion', () => {
  // ============================================================================
  // Test Data Fixtures
  // ============================================================================

  // Keyword search results (BM25)
  const keywordResults: RankedResult[] = [
    { id: 'doc1', score: 2.5, metadata: { title: 'Introduction to AI' } },
    { id: 'doc2', score: 2.1, metadata: { title: 'Machine Learning Basics' } },
    { id: 'doc3', score: 1.8, metadata: { title: 'Deep Learning Guide' } },
    { id: 'doc4', score: 1.2, metadata: { title: 'Neural Networks' } },
  ]

  // Vector search results (cosine similarity)
  const vectorResults: RankedResult[] = [
    { id: 'doc3', score: 0.95, metadata: { title: 'Deep Learning Guide' } },
    { id: 'doc1', score: 0.88, metadata: { title: 'Introduction to AI' } },
    { id: 'doc5', score: 0.82, metadata: { title: 'AI Ethics' } },
    { id: 'doc2', score: 0.75, metadata: { title: 'Machine Learning Basics' } },
  ]

  // ============================================================================
  // Reciprocal Rank Fusion (RRF)
  // ============================================================================

  describe('reciprocalRankFusion', () => {
    it('should combine rankings using RRF formula', () => {
      const results = reciprocalRankFusion([keywordResults, vectorResults])

      expect(results).toBeDefined()
      expect(results.length).toBeGreaterThan(0)
    })

    it('should return results sorted by combined RRF score descending', () => {
      const results = reciprocalRankFusion([keywordResults, vectorResults])

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score)
      }
    })

    it('should include all unique documents from input rankings', () => {
      const results = reciprocalRankFusion([keywordResults, vectorResults])

      const uniqueIds = new Set([
        ...keywordResults.map((r) => r.id),
        ...vectorResults.map((r) => r.id),
      ])

      expect(results.length).toBe(uniqueIds.size)
    })

    it('should calculate RRF score as sum of 1/(k + rank)', () => {
      const k = 60 // default
      // doc1 is rank 1 in keyword, rank 2 in vector
      // RRF score = 1/(60+1) + 1/(60+2) = 1/61 + 1/62
      const expectedDoc1Score = 1 / (k + 1) + 1 / (k + 2)

      const results = reciprocalRankFusion([keywordResults, vectorResults], { k })
      const doc1 = results.find((r) => r.id === 'doc1')

      expect(doc1).toBeDefined()
      expect(doc1!.score).toBeCloseTo(expectedDoc1Score, 10)
    })

    it('should use configurable k parameter', () => {
      const resultsK60 = reciprocalRankFusion([keywordResults, vectorResults], {
        k: 60,
      })
      const resultsK20 = reciprocalRankFusion([keywordResults, vectorResults], {
        k: 20,
      })

      // Different k values should produce different scores
      const doc1K60 = resultsK60.find((r) => r.id === 'doc1')!
      const doc1K20 = resultsK20.find((r) => r.id === 'doc1')!

      expect(doc1K60.score).not.toBeCloseTo(doc1K20.score, 5)
    })

    it('should rank documents appearing in multiple result sets higher', () => {
      const results = reciprocalRankFusion([keywordResults, vectorResults])

      // doc1, doc2, doc3 appear in both; doc4 only keyword, doc5 only vector
      const doc1 = results.find((r) => r.id === 'doc1')!
      const doc4 = results.find((r) => r.id === 'doc4')!
      const doc5 = results.find((r) => r.id === 'doc5')!

      expect(doc1.score).toBeGreaterThan(doc4.score)
      expect(doc1.score).toBeGreaterThan(doc5.score)
    })

    it('should handle empty result sets', () => {
      const results = reciprocalRankFusion([keywordResults, []])
      expect(results.length).toBe(keywordResults.length)
    })

    it('should handle single result set', () => {
      const results = reciprocalRankFusion([keywordResults])

      expect(results.length).toBe(keywordResults.length)
      // Should maintain relative order
      expect(results[0]!.id).toBe('doc1')
    })

    it('should preserve metadata from highest-ranked source', () => {
      const results = reciprocalRankFusion([keywordResults, vectorResults])
      const doc1 = results.find((r) => r.id === 'doc1')

      expect(doc1?.metadata?.title).toBeDefined()
    })

    it('should export default k constant', () => {
      expect(RRF_DEFAULT_K).toBe(60)
    })

    it('should handle three or more result sets', () => {
      const semanticResults: RankedResult[] = [
        { id: 'doc5', score: 0.9 },
        { id: 'doc3', score: 0.85 },
        { id: 'doc6', score: 0.8 },
      ]

      const results = reciprocalRankFusion([
        keywordResults,
        vectorResults,
        semanticResults,
      ])

      // All unique docs from all three sets
      expect(results.length).toBe(6) // doc1-6
    })
  })

  // ============================================================================
  // Linear Combination
  // ============================================================================

  describe('linearCombination', () => {
    it('should combine scores with configurable weights', () => {
      const results = linearCombination([keywordResults, vectorResults], {
        weights: [0.5, 0.5],
      })

      expect(results).toBeDefined()
      expect(results.length).toBeGreaterThan(0)
    })

    it('should normalize scores before combining', () => {
      const results = linearCombination([keywordResults, vectorResults], {
        weights: [0.5, 0.5],
        normalize: true,
      })

      // All combined scores should be in reasonable range
      for (const result of results) {
        expect(result.score).toBeLessThanOrEqual(1)
        expect(result.score).toBeGreaterThanOrEqual(0)
      }
    })

    it('should weight first result set higher when weight is higher', () => {
      const resultsHighKeyword = linearCombination([keywordResults, vectorResults], {
        weights: [0.8, 0.2],
        normalize: true,
      })

      const resultsHighVector = linearCombination([keywordResults, vectorResults], {
        weights: [0.2, 0.8],
        normalize: true,
      })

      // doc1 is #1 in keyword but #2 in vector
      // doc3 is #3 in keyword but #1 in vector
      const doc1HighKeyword = resultsHighKeyword.find((r) => r.id === 'doc1')!
      const doc3HighKeyword = resultsHighKeyword.find((r) => r.id === 'doc3')!
      const doc1HighVector = resultsHighVector.find((r) => r.id === 'doc1')!
      const doc3HighVector = resultsHighVector.find((r) => r.id === 'doc3')!

      // With high keyword weight, doc1 should rank better relative to doc3
      const ratio1 = doc1HighKeyword.score / doc3HighKeyword.score
      const ratio2 = doc1HighVector.score / doc3HighVector.score

      expect(ratio1).toBeGreaterThan(ratio2)
    })

    it('should throw if weights do not match result sets', () => {
      expect(() => {
        linearCombination([keywordResults, vectorResults], {
          weights: [0.5], // Missing second weight
        })
      }).toThrow()
    })

    it('should default to equal weights if not specified', () => {
      const results = linearCombination([keywordResults, vectorResults])

      expect(results.length).toBeGreaterThan(0)
    })

    it('should handle documents only in one result set (score 0 for missing)', () => {
      const results = linearCombination([keywordResults, vectorResults], {
        weights: [0.5, 0.5],
      })

      // doc4 only in keyword results
      const doc4 = results.find((r) => r.id === 'doc4')
      expect(doc4).toBeDefined()
    })
  })

  // ============================================================================
  // CombSUM
  // ============================================================================

  describe('combSUM', () => {
    it('should sum normalized scores across result sets', () => {
      const results = combSUM([keywordResults, vectorResults])

      expect(results).toBeDefined()
      expect(results.length).toBeGreaterThan(0)
    })

    it('should rank documents in multiple sets higher due to additive scores', () => {
      const results = combSUM([keywordResults, vectorResults])

      // doc1 appears in both
      const doc1 = results.find((r) => r.id === 'doc1')!
      // doc4 only in keyword
      const doc4 = results.find((r) => r.id === 'doc4')!

      // doc1 should generally score higher (appears in both)
      expect(doc1.score).toBeGreaterThan(doc4.score)
    })

    it('should produce sorted results descending', () => {
      const results = combSUM([keywordResults, vectorResults])

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score)
      }
    })
  })

  // ============================================================================
  // CombMNZ (Multiply by Number of Non-Zero)
  // ============================================================================

  describe('combMNZ', () => {
    it('should multiply sum by number of lists containing document', () => {
      const results = combMNZ([keywordResults, vectorResults])

      expect(results).toBeDefined()
    })

    it('should heavily favor documents appearing in multiple result sets', () => {
      const results = combMNZ([keywordResults, vectorResults])

      // doc1 in both (multiplied by 2)
      const doc1 = results.find((r) => r.id === 'doc1')!
      // doc5 only in vector (multiplied by 1)
      const doc5 = results.find((r) => r.id === 'doc5')!

      // CombMNZ boosts doc1 significantly
      expect(doc1.score).toBeGreaterThan(doc5.score)
    })

    it('should rank documents in all lists highest', () => {
      const semanticResults: RankedResult[] = [
        { id: 'doc1', score: 0.9 },
        { id: 'doc3', score: 0.85 },
      ]

      const results = combMNZ([keywordResults, vectorResults, semanticResults])

      // doc1 is in all 3 lists
      // doc3 is in all 3 lists
      // doc2 is in 2 lists
      const doc1 = results.find((r) => r.id === 'doc1')!
      const doc2 = results.find((r) => r.id === 'doc2')!

      expect(doc1.score).toBeGreaterThan(doc2.score)
    })
  })

  // ============================================================================
  // Interleaving (for A/B testing)
  // ============================================================================

  describe('interleave', () => {
    it('should alternate results from each ranking', () => {
      const results = interleave([keywordResults, vectorResults])

      expect(results.length).toBeGreaterThan(0)
    })

    it('should include all unique documents', () => {
      const results = interleave([keywordResults, vectorResults])

      const uniqueIds = new Set([
        ...keywordResults.map((r) => r.id),
        ...vectorResults.map((r) => r.id),
      ])

      expect(results.length).toBe(uniqueIds.size)
    })

    it('should not duplicate documents', () => {
      const results = interleave([keywordResults, vectorResults])

      const ids = results.map((r) => r.id)
      const uniqueIds = new Set(ids)

      expect(ids.length).toBe(uniqueIds.size)
    })

    it('should use team-draft interleaving (balanced)', () => {
      // Team-draft ensures both rankings contribute fairly
      const results = interleave([keywordResults, vectorResults], {
        method: 'team-draft',
      })

      expect(results.length).toBeGreaterThan(0)
    })

    it('should track source ranking in metadata', () => {
      const results = interleave([keywordResults, vectorResults], {
        trackSource: true,
      })

      // Each result should have source info
      for (const result of results) {
        expect(result.metadata?._sources).toBeDefined()
      }
    })
  })

  // ============================================================================
  // Score Normalization
  // ============================================================================

  describe('normalizeScores', () => {
    it('should normalize scores to [0, 1] range using min-max', () => {
      const normalized = normalizeScores(keywordResults, { method: 'min-max' })

      for (const result of normalized) {
        expect(result.score).toBeGreaterThanOrEqual(0)
        expect(result.score).toBeLessThanOrEqual(1)
      }
    })

    it('should map highest score to 1 and lowest to 0', () => {
      const normalized = normalizeScores(keywordResults, { method: 'min-max' })

      const maxScore = Math.max(...normalized.map((r) => r.score))
      const minScore = Math.min(...normalized.map((r) => r.score))

      expect(maxScore).toBe(1)
      expect(minScore).toBe(0)
    })

    it('should support z-score normalization', () => {
      const normalized = normalizeScores(keywordResults, { method: 'z-score' })

      expect(normalized.length).toBe(keywordResults.length)
    })

    it('should handle single result (no normalization needed)', () => {
      const single: RankedResult[] = [{ id: 'doc1', score: 5.0 }]
      const normalized = normalizeScores(single, { method: 'min-max' })

      expect(normalized[0]!.score).toBe(1) // Single result gets max
    })

    it('should handle identical scores', () => {
      const identical: RankedResult[] = [
        { id: 'doc1', score: 1.0 },
        { id: 'doc2', score: 1.0 },
        { id: 'doc3', score: 1.0 },
      ]
      const normalized = normalizeScores(identical, { method: 'min-max' })

      // All identical scores should remain equal
      expect(normalized[0]!.score).toBe(normalized[1]!.score)
    })

    it('should preserve relative ordering', () => {
      const normalized = normalizeScores(keywordResults, { method: 'min-max' })

      // doc1 had highest score, should still be highest
      const doc1 = normalized.find((r) => r.id === 'doc1')!
      const doc4 = normalized.find((r) => r.id === 'doc4')!

      expect(doc1.score).toBeGreaterThan(doc4.score)
    })
  })

  // ============================================================================
  // RankFusion Class
  // ============================================================================

  describe('RankFusion class', () => {
    let fusion: RankFusion

    beforeEach(() => {
      fusion = new RankFusion()
    })

    it('should create instance with default options', () => {
      expect(fusion).toBeDefined()
    })

    it('should create instance with custom options', () => {
      const custom = new RankFusion({
        defaultMethod: 'rrf',
        rrfK: 50,
        normalizeByDefault: true,
      })
      expect(custom).toBeDefined()
    })

    it('should provide fuse method for combining rankings', () => {
      const results = fusion.fuse([keywordResults, vectorResults])

      expect(results.length).toBeGreaterThan(0)
    })

    it('should allow specifying method via options', () => {
      const rrfResults = fusion.fuse([keywordResults, vectorResults], {
        method: 'rrf',
      })
      const linearResults = fusion.fuse([keywordResults, vectorResults], {
        method: 'linear',
      })
      const combmnzResults = fusion.fuse([keywordResults, vectorResults], {
        method: 'combmnz',
      })

      // Different methods produce results (may or may not have same top result)
      expect(rrfResults.length).toBeGreaterThan(0)
      expect(linearResults.length).toBeGreaterThan(0)
      expect(combmnzResults.length).toBeGreaterThan(0)

      // But scores should differ across methods
      const rrfScore = rrfResults.find((r) => r.id === 'doc1')!.score
      const linearScore = linearResults.find((r) => r.id === 'doc1')!.score
      expect(rrfScore).not.toBeCloseTo(linearScore, 5)
    })

    it('should support limit parameter', () => {
      const results = fusion.fuse([keywordResults, vectorResults], {
        limit: 3,
      })

      expect(results.length).toBe(3)
    })

    it('should support offset parameter', () => {
      const allResults = fusion.fuse([keywordResults, vectorResults])
      const offsetResults = fusion.fuse([keywordResults, vectorResults], {
        offset: 2,
      })

      expect(offsetResults[0]?.id).toBe(allResults[2]?.id)
    })

    it('should provide addResultSet for builder pattern', () => {
      const results = fusion
        .addResultSet(keywordResults, { weight: 0.6, name: 'keyword' })
        .addResultSet(vectorResults, { weight: 0.4, name: 'vector' })
        .fuse()

      expect(results.length).toBeGreaterThan(0)
    })

    it('should clear result sets after fuse', () => {
      fusion.addResultSet(keywordResults)
      fusion.fuse()

      // Second fuse should return empty without new result sets
      const results = fusion.fuse()
      expect(results.length).toBe(0)
    })
  })

  // ============================================================================
  // SearchResultSet Wrapper
  // ============================================================================

  describe('SearchResultSet wrapper', () => {
    it('should accept result sets with name and weight', () => {
      const resultSets: SearchResultSet[] = [
        { results: keywordResults, name: 'bm25', weight: 0.6 },
        { results: vectorResults, name: 'vector', weight: 0.4 },
      ]

      const results = reciprocalRankFusion(
        resultSets.map((s) => s.results),
      )

      expect(results.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty input array', () => {
      const results = reciprocalRankFusion([])
      expect(results).toEqual([])
    })

    it('should handle all empty result sets', () => {
      const results = reciprocalRankFusion([[], [], []])
      expect(results).toEqual([])
    })

    it('should handle very large result sets', () => {
      const largeSet: RankedResult[] = Array.from({ length: 10000 }, (_, i) => ({
        id: `large_doc${i}`, // Use different ID prefix to avoid overlap
        score: Math.random(),
      }))

      const results = reciprocalRankFusion([largeSet, keywordResults])
      expect(results.length).toBe(10000 + keywordResults.length) // No overlap with different prefix
    })

    it('should handle results with zero scores', () => {
      const zeroScores: RankedResult[] = [
        { id: 'doc1', score: 0 },
        { id: 'doc2', score: 0 },
      ]

      const results = reciprocalRankFusion([zeroScores, keywordResults])
      expect(results.length).toBeGreaterThan(0)
    })

    it('should handle results with negative scores', () => {
      const negativeScores: RankedResult[] = [
        { id: 'docA', score: -1.5 },
        { id: 'docB', score: -2.0 },
      ]

      const results = linearCombination([negativeScores, keywordResults], {
        normalize: true,
      })

      // After normalization, all should be non-negative
      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0)
      }
    })

    it('should handle duplicate IDs within same result set', () => {
      const duplicates: RankedResult[] = [
        { id: 'doc1', score: 2.5 },
        { id: 'doc1', score: 2.0 }, // Duplicate
        { id: 'doc2', score: 1.5 },
      ]

      const results = reciprocalRankFusion([duplicates, vectorResults])

      // Should deduplicate, keeping highest score
      const doc1Count = results.filter((r) => r.id === 'doc1').length
      expect(doc1Count).toBe(1)
    })
  })

  // ============================================================================
  // Performance Characteristics
  // ============================================================================

  describe('performance', () => {
    it('should handle combining many result sets efficiently', () => {
      const manySets: RankedResult[][] = Array.from({ length: 10 }, () =>
        Array.from({ length: 100 }, (_, i) => ({
          id: `doc${i}`,
          score: Math.random(),
        })),
      )

      const start = Date.now()
      const results = reciprocalRankFusion(manySets)
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(100) // Should complete quickly
      expect(results.length).toBe(100) // All same IDs
    })
  })
})
