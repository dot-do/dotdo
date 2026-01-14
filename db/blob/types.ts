/**
 * BlobStore Types
 *
 * TypeScript type definitions for BlobStore and related functionality.
 *
 * @module db/blob/types
 */

// ============================================================================
// METADATA TYPES
// ============================================================================

export interface BlobMetadata {
  $id: string
  key: string
  r2Key: string
  contentType: string
  size: number
  hash?: string
  refCount?: number
  metadata?: Record<string, unknown>
  $createdAt: number
  $updatedAt: number
}

export interface BlobResult {
  $id: string
  key: string
  size: number
  hash: string
  contentType: string
  url: string
}

export interface BlobGetResult {
  data: ArrayBuffer
  metadata: BlobMetadata
}

export interface ListResult {
  items: BlobMetadata[]
  cursor?: string
  hasMore: boolean
}

// ============================================================================
// CDC EVENT TYPES
// ============================================================================

export interface BlobCDCEvent {
  type: 'cdc.insert' | 'cdc.update' | 'cdc.delete'
  op: 'c' | 'u' | 'd'
  store: 'blob'
  table: 'blobs'
  key: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

// ============================================================================
// OPTIONS TYPES
// ============================================================================

export interface BlobStoreOptions {
  contentAddressed?: boolean
  namespace?: string
}

export interface PutOptions {
  key: string
  data: ArrayBuffer | Blob
  contentType: string
  metadata?: Record<string, unknown>
}

export interface PutStreamOptions {
  key: string
  stream: ReadableStream
  contentType: string
  contentLength: number
  metadata?: Record<string, unknown>
}

export interface SignedUrlOptions {
  expiresIn: string
  disposition?: 'inline' | 'attachment'
}

export interface UploadUrlOptions {
  key: string
  contentType: string
  maxSize?: number
  expiresIn: string
}

export interface ListOptions {
  prefix?: string
  limit?: number
  cursor?: string
}

export interface QueryOptions {
  where?: Record<string, unknown>
  limit?: number
}

export interface UpdateMetadataOptions {
  metadata?: Record<string, unknown>
  contentType?: string
}

// ============================================================================
// R2 BUCKET INTERFACE
// ============================================================================

export interface R2Bucket {
  put(key: string, data: ArrayBuffer | ReadableStream, options?: R2PutOptions): Promise<R2Object | null>
  get(key: string): Promise<R2ObjectBody | null>
  delete(key: string | string[]): Promise<void>
  list(options?: R2ListOptions): Promise<R2Objects>
  createMultipartUpload(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload>
}

export interface R2PutOptions {
  httpMetadata?: {
    contentType?: string
    contentDisposition?: string
  }
  customMetadata?: Record<string, string>
}

export interface R2Object {
  key: string
  size: number
  etag: string
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface R2ListOptions {
  prefix?: string
  cursor?: string
  limit?: number
}

export interface R2Objects {
  objects: R2Object[]
  truncated: boolean
  cursor?: string
}

export interface R2MultipartUpload {
  uploadId: string
  uploadPart(partNumber: number, data: ArrayBuffer | ReadableStream): Promise<R2UploadedPart>
  complete(parts: R2UploadedPart[]): Promise<R2Object>
  abort(): Promise<void>
}

export interface R2UploadedPart {
  partNumber: number
  etag: string
}

export interface R2MultipartOptions {
  httpMetadata?: {
    contentType?: string
  }
  customMetadata?: Record<string, string>
}

// ============================================================================
// DATABASE INTERFACE
// ============================================================================

export interface Database {
  exec(sql: string): void
  prepare(sql: string): Statement
}

export interface Statement {
  run(...params: unknown[]): void
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}
