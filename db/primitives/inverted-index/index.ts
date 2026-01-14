/**
 * Inverted Index Primitives - Full-Text Search Engine
 *
 * A production-grade full-text search index designed for Cloudflare Workers
 * (128MB memory limit). Provides BM25 relevance scoring, boolean queries,
 * phrase matching, and tag/label indexing with R2-compatible serialization.
 *
 * ## Features
 * - **BM25 Scoring** - Industry-standard relevance ranking algorithm
 * - **Boolean Queries** - AND/OR/NOT operators for complex search logic
 * - **Phrase Queries** - Exact phrase matching with positional indexes
 * - **Tag Indexing** - High-performance label/tag filtering
 * - **R2 Serialization** - Streaming search with range requests
 * - **Memory Efficient** - Delta encoding, varint compression
 *
 * ## Components
 * | Component | Purpose |
 * |-----------|---------|
 * | InvertedIndex | Main search index with add/search/remove API |
 * | PostingList | Document ID lists with term frequencies |
 * | TermDictionary | Term-to-offset mapping for streaming |
 * | BM25Scorer | Relevance scoring calculations |
 * | BooleanQuery | Complex query evaluation |
 * | PhraseQuery | Positional phrase matching |
 * | TagIndex | Label-based filtering |
 *
 * @example Basic Usage
 * ```typescript
 * import { InvertedIndex } from 'dotdo/db/primitives/inverted-index'
 *
 * const index = new InvertedIndex()
 *
 * // Index documents
 * index.add('doc1', 'The quick brown fox jumps over the lazy dog')
 * index.add('doc2', 'A fast brown fox leaps across the sleeping hound')
 *
 * // Search with BM25 ranking
 * const results = index.search('brown fox')
 * // Returns: [{ id: 'doc1', score: 2.5 }, { id: 'doc2', score: 2.1 }]
 * ```
 *
 * @example R2 Streaming Search
 * ```typescript
 * import { loadInvertedIndex } from 'dotdo/db/primitives/inverted-index'
 *
 * // Load dictionary (small, ~1KB per 100 terms)
 * const dictData = await r2.get('index-dict.bin').arrayBuffer()
 *
 * // Streaming search - only loads postings for query terms
 * const index = loadInvertedIndex(new Uint8Array(dictData))
 * const results = await index.searchStreaming('query', async (offset, length) => {
 *   const response = await r2.get('index-postings.bin', { range: { offset, length } })
 *   return new Uint8Array(await response.arrayBuffer())
 * })
 * ```
 *
 * @example Boolean Queries
 * ```typescript
 * import { BooleanQuery, BooleanOperator } from 'dotdo/db/primitives/inverted-index'
 *
 * const query = new BooleanQuery()
 *   .must('javascript')     // Required term
 *   .must('typescript')     // Also required
 *   .should('react')        // Optional boost
 *   .mustNot('deprecated')  // Exclude
 *
 * const results = query.execute(index)
 * ```
 *
 * @module db/primitives/inverted-index
 */

// =============================================================================
// INVERTED INDEX - Core full-text search index
// =============================================================================

export {
  /** Primary search index class with add/search/remove API */
  InvertedIndex,
  /** Factory function to create and populate an index from documents */
  createInvertedIndex,
  /** Load a serialized index from dictionary and postings bytes */
  loadInvertedIndex,
  /** Default tokenizer - splits on non-alphanumeric, lowercases */
  tokenize,
  /** Tokenizer that also counts term frequencies */
  tokenizeWithFrequencies,
  /** Magic bytes for index validation */
  INDEX_MAGIC,
  /** Magic bytes for postings validation */
  POSTINGS_MAGIC,
  /** Current index format version */
  INDEX_VERSION,
  /** Size of serialized header in bytes */
  HEADER_SIZE,
  /** Maximum allowed term length */
  MAX_TERM_LENGTH,
  type DocumentMetadata,
  type SearchResult,
  type RangeFetcher,
  type InvertedIndexOptions,
} from './inverted-index'

// =============================================================================
// POSTING LISTS - Document ID storage with term frequencies
// =============================================================================

export {
  /** Basic posting list (document IDs only) */
  PostingList,
  /** Posting list with term frequency for BM25 scoring */
  PostingListWithTF,
  /** Encode integer as variable-length bytes */
  encodeVarint,
  /** Decode variable-length integer */
  decodeVarint,
  /** Calculate bytes needed for varint encoding */
  varintSize,
  type Posting,
} from './posting-list'

// =============================================================================
// TERM DICTIONARY - Term-to-offset mapping for streaming
// =============================================================================

export {
  /** Sorted term dictionary for O(log n) term lookup */
  TermDictionary,
  /** Magic bytes for dictionary validation */
  DICTIONARY_MAGIC,
  /** Current dictionary format version */
  FORMAT_VERSION,
  type DictionaryEntry,
  type DictionaryEntryInput,
  type SearchEntry,
} from './term-dictionary'

// =============================================================================
// BM25 SCORING - Relevance ranking algorithm
// =============================================================================

export {
  /** Calculate inverse document frequency */
  calculateIDF,
  /** Calculate BM25 score for a term-document pair */
  calculateBM25Score,
  /** Stateful BM25 scorer for batch operations */
  BM25Scorer,
  /** Default k1 parameter (term frequency saturation) */
  BM25_K1,
  /** Default b parameter (document length normalization) */
  BM25_B,
  type IndexStats,
  type TermScoreParams,
  type TermScore,
  type DocumentScoreParams,
  type BM25ScorerOptions,
} from './bm25'

// =============================================================================
// BOOLEAN QUERIES - Complex search with AND/OR/NOT operators
// =============================================================================

export {
  /** Boolean query builder for complex search logic */
  BooleanQuery,
  /** Boolean operators: MUST, SHOULD, MUST_NOT */
  BooleanOperator,
  type BooleanClause,
} from './boolean-query'

// =============================================================================
// PHRASE QUERIES - Exact phrase matching with positions
// =============================================================================

export {
  /** Posting list that tracks term positions within documents */
  PositionalPostingList,
  /** Query executor for exact phrase matching */
  PhraseQuery,
  type PositionalPosting,
  type PhraseQueryResult,
  type PhraseMatchResult,
} from './phrase-query'

// =============================================================================
// TAG INDEX - High-performance label/tag filtering
// =============================================================================

export {
  /** Optimized index for tag/label filtering */
  TagIndex,
  /** Query builder for tag-based search */
  TagQuery,
  /** Efficient tag matching utilities */
  TagMatcher,
  type Tags,
  type TagKeyStats,
} from './tag-index'
