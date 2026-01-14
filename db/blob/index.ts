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

// Stub export - implementation TBD
// This file exists to allow RED tests to import the module
// All tests should FAIL until implementation is complete

export class BlobStore {
  constructor(..._args: unknown[]) {
    throw new Error('BlobStore not implemented')
  }
}

// Type exports - stubs for now
export type BlobMetadata = never
export type BlobResult = never
export type BlobCDCEvent = never
