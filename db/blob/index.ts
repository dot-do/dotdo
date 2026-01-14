/**
 * BlobStore - Binary Object Storage with R2
 *
 * This module provides storage for binary objects (files, images, PDFs, artifacts).
 * Uses R2 as primary storage tier with SQLite metadata index.
 *
 * Features:
 * - Binary storage (images, PDFs, videos, etc.)
 * - Streaming upload/download for large files
 * - Content-addressed deduplication via SHA-256
 * - Metadata index in SQLite for fast lookups
 * - Presigned URLs for direct browser access
 * - CDC event emission for metadata changes
 *
 * @see README.md for full documentation
 */

export { BlobStore } from './store'

export type {
  BlobMetadata,
  BlobResult,
  BlobGetResult,
  ListResult,
  BlobCDCEvent,
  BlobStoreOptions,
  PutOptions,
  PutStreamOptions,
  SignedUrlOptions,
  UploadUrlOptions,
  ListOptions,
  QueryOptions,
  UpdateMetadataOptions,
  R2Bucket,
  Database,
} from './types'

export { computeHash, getContentAddressedKey, getKeyAddressedPath, getHashHex } from './dedup'
export { generateSignedUrl, generateUploadUrl, parseDuration } from './presigned'
