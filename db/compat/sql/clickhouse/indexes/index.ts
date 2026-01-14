/**
 * ClickHouse-compatible indexes for edge deployment
 *
 * This module provides index implementations designed for Cloudflare Workers
 * with R2 storage, following ClickHouse's index architecture.
 *
 * @module db/compat/sql/clickhouse/indexes
 */

// Full-text search with GIN (Generalized Inverted Index)
export {
  // Main class
  FullTextIndex,

  // FST Dictionary
  FSTBuilder,
  FSTDictionary,

  // Streaming Roaring Postings
  StreamingRoaringPostings,

  // Encoding utilities
  encodeVarint,
  decodeVarint,
  varintSize,

  // Text processing
  tokenize,
  tokenizeWithFrequencies,

  // BM25 scoring
  calculateIDF,
  calculateBM25Score,
  BM25_K1,
  BM25_B,

  // Factory functions
  createMockR2Storage,
  createFullTextIndex,

  // Constants
  FST_MAGIC,
  POSTINGS_MAGIC,
  METADATA_MAGIC,
  FORMAT_VERSION,
  FST_HEADER_SIZE,
  MAX_TERM_LENGTH,
  DEFAULT_MEMORY_BUDGET_MB,

  // Types
  type FSTEntry,
  type FSTTermEntry,
  type FSTHeaderInfo,
  type GINIndexStats,
  type MemoryBudget,
  type SearchResult,
  type PostingEntry,
  type GINIndexFiles,
  type R2GINStorage,
  type RangeFetcher,
  type FullTextIndexOptions,
} from './full-text-index'
