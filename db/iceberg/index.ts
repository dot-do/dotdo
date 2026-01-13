/**
 * Apache Iceberg Integration for Lakehouse-Style Analytics
 *
 * This module provides a complete Apache Iceberg implementation enabling lakehouse-style
 * analytics on Cloudflare R2. It combines the reliability of data warehouses with the
 * flexibility of data lakes, all running at the edge with sub-200ms latency.
 *
 * ## Lakehouse Architecture
 *
 * The Iceberg integration enables several lakehouse capabilities:
 *
 * - **ACID Transactions**: Atomic commits with snapshot isolation
 * - **Time Travel**: Query historical data using snapshot IDs
 * - **Schema Evolution**: Add/rename/delete columns without rewriting data
 * - **Partition Pruning**: Skip irrelevant files using partition statistics
 * - **Column Pruning**: Read only required columns from Parquet files
 * - **Copy-on-Write Cloning**: O(1) DO cloning via metadata-only copies
 *
 * ## Module Structure
 *
 * | Module | Purpose |
 * |--------|---------|
 * | `reader.ts` | Fast point lookups via manifest navigation |
 * | `metadata.ts` | Parse Iceberg metadata.json files |
 * | `manifest.ts` | Navigate manifest-list and manifest-file structures |
 * | `parquet.ts` | Read Parquet files with column projection |
 * | `puffin.ts` | Bloom filters and statistics sidecars |
 * | `stats.ts` | Column statistics for predicate pushdown |
 * | `marks.ts` | ClickHouse-style granule-level byte offsets |
 * | `inverted-index.ts` | Full-text search via posting lists |
 * | `clone.ts` | Copy-on-write DO cloning |
 * | `iceberg-reader.ts` | Time travel and snapshot restoration |
 *
 * ## Performance Characteristics
 *
 * - **Point Lookups**: 50-150ms (vs 500ms-2s for R2 SQL)
 * - **Metadata Caching**: Reduces repeated lookups by 30-50ms
 * - **Partition Pruning**: Eliminates 90%+ of manifest reads
 * - **Column Projection**: Reads only requested columns
 *
 * ## Navigation Chain
 *
 * ```
 * metadata.json
 *   └─> current-snapshot-id
 *         └─> manifest-list.avro
 *               └─> [filter by partition bounds]
 *                     └─> manifest-file.avro
 *                           └─> [filter by column stats]
 *                                 └─> data-file.parquet
 *                                       └─> record
 * ```
 *
 * @example Basic Usage
 * ```typescript
 * import { IcebergReader } from './db/iceberg'
 *
 * const reader = new IcebergReader(env.R2)
 *
 * // Point lookup - returns file path or null
 * const file = await reader.findFile({
 *   table: 'do_resources',
 *   partition: { ns: 'payments.do', type: 'Function' },
 *   id: 'charge'
 * })
 *
 * // Get record (reads Parquet)
 * const record = await reader.getRecord({
 *   table: 'do_resources',
 *   partition: { ns: 'payments.do', type: 'Function' },
 *   id: 'charge'
 * })
 * ```
 *
 * @example Time Travel
 * ```typescript
 * // Query historical data
 * const record = await reader.getRecord({
 *   table: 'do_resources',
 *   partition: { ns: 'payments.do', type: 'Function' },
 *   id: 'charge',
 *   snapshotId: 1234567890 // Historical snapshot
 * })
 * ```
 *
 * @example Copy-on-Write Cloning
 * ```typescript
 * import { cloneDO } from './db/iceberg/clone'
 *
 * // O(1) clone - only copies metadata, not data files
 * const result = await cloneDO(bucket, 'payments.do', 'payments-backup.do')
 * console.log(`Cloned ${result.rowCount} rows in O(1) time`)
 * ```
 *
 * @see https://iceberg.apache.org/spec/ - Apache Iceberg specification
 * @see https://iceberg.apache.org/docs/latest/evolution/ - Schema evolution
 * @module db/iceberg
 */

export { IcebergReader } from './reader'

// Parquet reader exports
export {
  ParquetReader,
  readParquetFromR2,
  findRecordInParquet,
  parseParquetBytes,
} from './parquet'

export type {
  ParquetReadOptions,
  ParquetReadResult,
  ParquetFileStats,
} from './parquet'

export type {
  // Metadata types
  IcebergMetadata,
  Snapshot,
  Schema,
  SchemaField,
  SchemaType,
  PartitionSpec,
  PartitionField,
  // Manifest types
  ManifestList,
  ManifestFile,
  DataFileEntry,
  ColumnStats,
  // Options types
  IcebergReaderOptions,
  FindFileOptions,
  GetRecordOptions,
  PartitionFilter,
  // Result types
  FindFileResult,
  IcebergRecord,
} from './types'

// Search manifest exports
export {
  validateSearchManifest,
  parseSearchManifest,
  buildIndexUrl,
  buildDataUrl,
  buildAllDataUrls,
  getAvailableIndexes,
  getIndexConfig,
  hasIndex,
  SearchManifestValidationError,
} from './search-manifest'

export type {
  SearchManifest,
  IndexConfigs,
  BloomIndexConfig,
  RangeIndexConfig,
  VectorIndexConfig,
  InvertedIndexConfig,
  DataConfig,
  CacheConfig,
  VectorMetric,
  IndexType,
} from './search-manifest'

// Inverted index exports
export {
  // Constants
  INVERTED_INDEX_MAGIC,
  INVERTED_INDEX_VERSION,
  HEADER_SIZE,
  MAX_TERM_LENGTH,
  // Varint functions
  encodeVarint,
  decodeVarint,
  varintSize,
  // Posting list functions
  encodePostingList,
  decodePostingList,
  // Classes
  InvertedIndexWriter,
  InvertedIndexReader,
  // Helper functions
  estimateInvertedIndexSize,
  simpleTokenize,
  createInvertedIndex,
} from './inverted-index'

export type {
  Posting,
  TermEntry,
  RangeRequest as InvertedIndexRangeRequest,
  InvertedIndexMetadata,
} from './inverted-index'
