/**
 * db/iceberg - Direct Iceberg Navigation
 *
 * Fast point lookups from R2 Data Catalog without R2 SQL overhead.
 * Achieves 50-150ms latency vs 500ms-2s for R2 SQL queries.
 *
 * @example
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
 */

export { IcebergReader } from './reader'

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
