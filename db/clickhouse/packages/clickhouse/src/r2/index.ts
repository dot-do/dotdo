/**
 * R2 utilities for Cloudflare R2 storage integration
 *
 * This module provides utilities for configuring and working with
 * Cloudflare R2 buckets, particularly for browser-based WASM access
 * to Parquet files.
 */

// CORS configuration exports
export {
  // Types
  type CorsConfig,

  // Functions
  configureR2Cors,
  createR2Client as createR2CorsClient,
  getR2Endpoint,
  generateCorsXml,
  createProductionCorsConfig,

  // Default configurations
  defaultWasmCorsConfig,
  devCorsConfig,
} from './cors';

// Presigned URL exports
export {
  R2PresignedUrls,
  createR2Client,
  type R2Config,
  type ReadUrlOptions,
  type WriteUrlOptions,
  type MultipartUploadOptions,
  type MultipartUploadInit,
} from './presigned';

// Range request exports for Parquet partial reads
export {
  fetchWithRange,
  getFileSize,
  readParquetFooter,
  readParquetColumnChunk,
  type RangeRequestOptions,
} from './range';
