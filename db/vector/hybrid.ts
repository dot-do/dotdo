/**
 * HybridSearch
 *
 * Advanced hybrid search combining FTS5 and vector similarity with RRF fusion.
 *
 * @module db/vector/hybrid
 */

import { VectorStore } from './store'
import type { HybridQueryOptions, SearchResult } from './types'

// ============================================================================
// HYBRID SEARCH CLASS
// ============================================================================

export class HybridSearch {
  private db: any
  private vectorStore: VectorStore

  constructor(db: any) {
    this.db = db
    this.vectorStore = new VectorStore(db, { lazyInit: true })
  }

  /**
   * Perform hybrid search with FTS5 and vector similarity.
   */
  async query(options: HybridQueryOptions): Promise<SearchResult[]> {
    const {
      query,
      embedding,
      limit,
      ftsWeight = 0.5,
      vectorWeight = 0.5,
      vectorDim,
      where,
    } = options

    // If vectorDim is specified, we would truncate the embedding for speed
    // For now, pass through to vectorStore's hybridSearch
    return this.vectorStore.hybridSearch({
      query,
      embedding,
      limit,
      ftsWeight,
      vectorWeight,
      fusion: 'rrf',
    })
  }
}
