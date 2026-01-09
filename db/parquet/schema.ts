/**
 * Parquet Schema Definitions for Vector Storage
 *
 * Defines Arrow schemas for Parquet files used in vector compaction.
 * Uses apache-arrow for schema definition and parquet-wasm for file writing.
 *
 * Target table schema:
 * ```sql
 * CREATE TABLE vectors (
 *   ns VARCHAR NOT NULL,
 *   type VARCHAR NOT NULL,
 *   visibility VARCHAR,
 *   id VARCHAR NOT NULL,
 *   embedding FLOAT[1536],
 *   metadata JSON,
 *   created_at TIMESTAMP
 * )
 * ```
 *
 * @module db/parquet/schema
 */

import {
  Schema,
  Field,
  Utf8,
  Float32,
  FixedSizeList,
  TimestampMillisecond,
} from 'apache-arrow'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default embedding dimension for OpenAI text-embedding-3-small */
export const DEFAULT_EMBEDDING_DIMENSION = 1536

/** Default embedding dimensions for common models */
export const EMBEDDING_DIMENSIONS = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'voyage-3': 1024,
  'voyage-3-lite': 512,
  'cohere-embed-v3': 1024,
} as const

// ============================================================================
// SCHEMA TYPES
// ============================================================================

/**
 * Visibility levels for vectors
 */
export type VectorVisibility = 'public' | 'org' | 'user' | 'unlisted'

/**
 * Vector record structure matching the Parquet schema
 */
export interface VectorRecord {
  /** Namespace (tenant isolation) */
  ns: string
  /** Resource type (e.g., 'Document', 'Chunk', 'Message') */
  type: string
  /** Visibility level */
  visibility: VectorVisibility | null
  /** Unique vector identifier */
  id: string
  /** Embedding values as Float32Array or number[] */
  embedding: Float32Array | number[]
  /** Arbitrary metadata as JSON string */
  metadata: string | null
  /** Creation timestamp (milliseconds since epoch) */
  created_at: number
}

/**
 * Schema configuration options
 */
export interface VectorSchemaOptions {
  /** Embedding dimension (default: 1536) */
  dimension?: number
  /** Include metadata field (default: true) */
  includeMetadata?: boolean
  /** Include visibility field (default: true) */
  includeVisibility?: boolean
}

// ============================================================================
// SCHEMA BUILDERS
// ============================================================================

/**
 * Create Arrow schema for vector storage
 *
 * @param options - Schema configuration options
 * @returns Arrow Schema for vectors
 *
 * @example
 * ```typescript
 * // Default schema (1536 dimensions)
 * const schema = createVectorSchema()
 *
 * // Custom dimension for voyage-3-lite
 * const schema = createVectorSchema({ dimension: 512 })
 * ```
 */
export function createVectorSchema(options: VectorSchemaOptions = {}): Schema {
  const {
    dimension = DEFAULT_EMBEDDING_DIMENSION,
    includeMetadata = true,
    includeVisibility = true,
  } = options

  const fields: Field[] = [
    // Partition keys (first for efficient pruning)
    new Field('ns', new Utf8(), false),
    new Field('type', new Utf8(), false),
  ]

  // Optional visibility field
  if (includeVisibility) {
    fields.push(new Field('visibility', new Utf8(), true))
  }

  // Core vector fields
  fields.push(
    new Field('id', new Utf8(), false),
    new Field(
      'embedding',
      new FixedSizeList(dimension, new Field('value', new Float32(), false)),
      false
    ),
  )

  // Optional metadata field
  if (includeMetadata) {
    fields.push(new Field('metadata', new Utf8(), true))
  }

  // Timestamp
  fields.push(new Field('created_at', new TimestampMillisecond(), false))

  return new Schema(fields)
}

/**
 * Pre-built schema for 1536-dimension embeddings (OpenAI default)
 */
export const VECTOR_SCHEMA_1536 = createVectorSchema({ dimension: 1536 })

/**
 * Pre-built schema for 3072-dimension embeddings (text-embedding-3-large)
 */
export const VECTOR_SCHEMA_3072 = createVectorSchema({ dimension: 3072 })

/**
 * Pre-built schema for 1024-dimension embeddings (voyage-3, cohere)
 */
export const VECTOR_SCHEMA_1024 = createVectorSchema({ dimension: 1024 })

/**
 * Pre-built schema for 512-dimension embeddings (voyage-3-lite)
 */
export const VECTOR_SCHEMA_512 = createVectorSchema({ dimension: 512 })

// ============================================================================
// SCHEMA UTILITIES
// ============================================================================

/**
 * Get the embedding dimension from a schema
 *
 * @param schema - Arrow schema
 * @returns Embedding dimension or null if not found
 */
export function getEmbeddingDimension(schema: Schema): number | null {
  const embeddingField = schema.fields.find((f) => f.name === 'embedding')
  if (!embeddingField) return null

  const type = embeddingField.type
  if (type instanceof FixedSizeList) {
    return type.listSize
  }
  return null
}

/**
 * Validate that a record matches the expected schema
 *
 * @param record - Vector record to validate
 * @param dimension - Expected embedding dimension
 * @returns True if valid, throws on validation error
 */
export function validateVectorRecord(
  record: VectorRecord,
  dimension: number = DEFAULT_EMBEDDING_DIMENSION
): boolean {
  if (!record.ns || typeof record.ns !== 'string') {
    throw new Error('Vector record must have a non-empty ns (namespace) string')
  }

  if (!record.type || typeof record.type !== 'string') {
    throw new Error('Vector record must have a non-empty type string')
  }

  if (!record.id || typeof record.id !== 'string') {
    throw new Error('Vector record must have a non-empty id string')
  }

  const embeddingLength = Array.isArray(record.embedding)
    ? record.embedding.length
    : record.embedding.length

  if (embeddingLength !== dimension) {
    throw new Error(
      `Embedding dimension mismatch: expected ${dimension}, got ${embeddingLength}`
    )
  }

  if (typeof record.created_at !== 'number' || !Number.isFinite(record.created_at)) {
    throw new Error('Vector record must have a valid created_at timestamp')
  }

  return true
}

// ============================================================================
// PARQUET SCHEMA METADATA
// ============================================================================

/**
 * Parquet file metadata keys used for vector files
 */
export const PARQUET_METADATA_KEYS = {
  /** Schema version for forward compatibility */
  SCHEMA_VERSION: 'dotdo:schema_version',
  /** Embedding model used to generate vectors */
  EMBEDDING_MODEL: 'dotdo:embedding_model',
  /** Namespace this file belongs to */
  NAMESPACE: 'dotdo:namespace',
  /** Date partition (YYYY-MM-DD) */
  DATE_PARTITION: 'dotdo:date_partition',
  /** Number of vectors in file */
  VECTOR_COUNT: 'dotdo:vector_count',
  /** Min created_at timestamp */
  MIN_TIMESTAMP: 'dotdo:min_timestamp',
  /** Max created_at timestamp */
  MAX_TIMESTAMP: 'dotdo:max_timestamp',
} as const

/**
 * Current schema version
 */
export const SCHEMA_VERSION = '1.0.0'
