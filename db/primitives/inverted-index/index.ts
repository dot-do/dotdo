/**
 * Inverted Index Primitives
 *
 * Full-text search index components with BM25 scoring, boolean queries,
 * phrase queries, and tag/label indexing.
 *
 * @module db/primitives/inverted-index
 */

// Posting List
export {
  PostingList,
  PostingListWithTF,
  encodeVarint,
  decodeVarint,
  varintSize,
  type Posting,
} from './posting-list'

// Term Dictionary
export {
  TermDictionary,
  DICTIONARY_MAGIC,
  FORMAT_VERSION,
  type DictionaryEntry,
  type DictionaryEntryInput,
  type SearchEntry,
} from './term-dictionary'

// BM25 Scoring
export {
  calculateIDF,
  calculateBM25Score,
  BM25Scorer,
  BM25_K1,
  BM25_B,
  type IndexStats,
  type TermScoreParams,
  type TermScore,
  type DocumentScoreParams,
  type BM25ScorerOptions,
} from './bm25'

// Boolean Queries
export {
  BooleanQuery,
  BooleanOperator,
  type BooleanClause,
} from './boolean-query'

// Phrase Queries
export {
  PositionalPostingList,
  PhraseQuery,
  type PositionalPosting,
  type PhraseQueryResult,
  type PhraseMatchResult,
} from './phrase-query'

// Tag/Label Index
export {
  TagIndex,
  TagQuery,
  TagMatcher,
  type Tags,
  type TagKeyStats,
} from './tag-index'
