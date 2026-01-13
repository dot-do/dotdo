/**
 * File/Object Storage Source Connectors - Stubs
 *
 * S3, R2, and GCS source connectors for the connector framework.
 * These stubs define the interface - full implementation pending.
 *
 * @module db/primitives/connector-framework/sources/file
 */

import type { Source, SourceState, Record as SourceRecord } from '../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Supported file formats
 */
export type FileFormat = 'json' | 'jsonl' | 'csv' | 'parquet' | 'avro' | 'xml'

/**
 * File parser configuration
 */
export interface FileParserConfig {
  /** File format */
  format: FileFormat
  /** CSV options */
  csv?: {
    delimiter?: string
    quote?: string
    escape?: string
    header?: boolean
    columns?: string[]
  }
  /** JSON options */
  json?: {
    path?: string
  }
  /** Parquet options */
  parquet?: {
    columns?: string[]
  }
}

/**
 * Base file source configuration
 */
export interface FileSourceConfig {
  /** Bucket name */
  bucket: string
  /** Prefix filter */
  prefix?: string
  /** File pattern (glob) */
  pattern?: string
  /** File format/parser config */
  parser: FileParserConfig
  /** ID field name in records */
  idField?: string
  /** Batch size */
  batchSize?: number
  /** Concurrent file downloads */
  concurrency?: number
}

/**
 * S3 source configuration
 */
export interface S3SourceConfig extends FileSourceConfig {
  /** AWS region */
  region: string
  /** AWS access key ID */
  accessKeyId?: string
  /** AWS secret access key */
  secretAccessKey?: string
  /** Custom endpoint (for S3-compatible storage) */
  endpoint?: string
  /** Force path style */
  forcePathStyle?: boolean
}

/**
 * Cloudflare R2 source configuration
 */
export interface R2SourceConfig extends FileSourceConfig {
  /** Cloudflare account ID */
  accountId: string
  /** R2 access key ID */
  accessKeyId?: string
  /** R2 secret access key */
  secretAccessKey?: string
}

/**
 * Google Cloud Storage source configuration
 */
export interface GCSSourceConfig extends FileSourceConfig {
  /** GCP project ID */
  projectId?: string
  /** Service account key JSON */
  serviceAccountKey?: string | Record<string, unknown>
}

// ============================================================================
// Factory Functions (Stubs)
// ============================================================================

/**
 * Create an S3 source connector
 */
export function createS3Source(_config: S3SourceConfig): Source {
  return {
    name: 's3',

    async initialize(): Promise<void> {
      throw new Error('Not implemented')
    },

    async read(): Promise<{ records: SourceRecord[]; state: SourceState }> {
      throw new Error('Not implemented')
    },

    async getState(): Promise<SourceState> {
      throw new Error('Not implemented')
    },

    async close(): Promise<void> {
      // No-op
    },
  }
}

/**
 * Create a Cloudflare R2 source connector
 */
export function createR2Source(_config: R2SourceConfig): Source {
  return {
    name: 'r2',

    async initialize(): Promise<void> {
      throw new Error('Not implemented')
    },

    async read(): Promise<{ records: SourceRecord[]; state: SourceState }> {
      throw new Error('Not implemented')
    },

    async getState(): Promise<SourceState> {
      throw new Error('Not implemented')
    },

    async close(): Promise<void> {
      // No-op
    },
  }
}

/**
 * Create a Google Cloud Storage source connector
 */
export function createGCSSource(_config: GCSSourceConfig): Source {
  return {
    name: 'gcs',

    async initialize(): Promise<void> {
      throw new Error('Not implemented')
    },

    async read(): Promise<{ records: SourceRecord[]; state: SourceState }> {
      throw new Error('Not implemented')
    },

    async getState(): Promise<SourceState> {
      throw new Error('Not implemented')
    },

    async close(): Promise<void> {
      // No-op
    },
  }
}
