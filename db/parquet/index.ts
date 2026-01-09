/**
 * Parquet Module
 *
 * Provides Parquet file reading and writing for vector storage.
 * Uses apache-arrow for schema definitions and parquet-wasm for
 * WASM-based Parquet file operations.
 *
 * @module db/parquet
 *
 * @example
 * ```typescript
 * import {
 *   ParquetBuilder,
 *   VECTOR_SCHEMA_1536,
 *   writeVectorsToParquet,
 *   generateParquetPath,
 * } from 'dotdo/db/parquet'
 *
 * // Build Parquet file incrementally
 * const builder = new ParquetBuilder({
 *   schema: VECTOR_SCHEMA_1536,
 *   compression: 'ZSTD',
 *   rowGroupSize: 2000,
 * })
 *
 * for (const vector of vectors) {
 *   builder.addRow(vector)
 * }
 *
 * const result = await builder.finish()
 * const path = generateParquetPath('tenant.do', '2026-01-09')
 * await env.R2.put(path, result.buffer)
 * ```
 */

// Schema exports
export {
  // Constants
  DEFAULT_EMBEDDING_DIMENSION,
  EMBEDDING_DIMENSIONS,
  PARQUET_METADATA_KEYS,
  SCHEMA_VERSION,
  // Pre-built schemas
  VECTOR_SCHEMA_512,
  VECTOR_SCHEMA_1024,
  VECTOR_SCHEMA_1536,
  VECTOR_SCHEMA_3072,
  // Schema functions
  createVectorSchema,
  getEmbeddingDimension,
  validateVectorRecord,
  // Types
  type VectorVisibility,
  type VectorRecord,
  type VectorSchemaOptions,
} from './schema'

// Writer exports
export {
  // Classes
  ParquetBuilder,
  // Functions
  writeVectorsToParquet,
  generateParquetPath,
  // Types
  type ParquetCompression,
  type ZstdLevel,
  type ParquetSchema,
  type ParquetBuilderOptions,
  type ParquetWriteResult,
} from './writer'
