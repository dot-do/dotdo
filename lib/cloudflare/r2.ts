/**
 * R2 Object Storage Integration Layer for dotdo
 *
 * Provides a unified, typed interface for Cloudflare R2 operations with:
 * - Typed utility wrapping R2Bucket
 * - Standardized path conventions: {tenant}/{type}/{id}/{timestamp}
 * - Presigned URL generation helpers
 * - Streaming helpers for large files
 * - Metadata management
 * - Content type auto-detection
 *
 * @module lib/cloudflare/r2
 *
 * @example Basic R2 operations
 * ```typescript
 * import { createR2Store } from './r2'
 *
 * const store = createR2Store(env.R2_BUCKET)
 *
 * // Store a file (content type auto-detected from key)
 * await store.put('documents/report.pdf', pdfData)
 *
 * // Get a file
 * const obj = await store.get('documents/report.pdf')
 * if (obj) {
 *   const content = await obj.text()
 *   console.log('Size:', obj.size, 'ETag:', obj.etag)
 * }
 *
 * // Check existence and delete
 * if (await store.exists('documents/old.pdf')) {
 *   await store.delete('documents/old.pdf')
 * }
 * ```
 *
 * @example Tenant-scoped operations
 * ```typescript
 * // Create tenant-scoped store with standardized path conventions
 * const tenantStore = createR2Store(env.R2_BUCKET, {
 *   tenant: 'acme-corp',
 *   publicUrl: 'https://files.acme.com'
 * })
 *
 * // Store: acme-corp/documents/doc-123/report.pdf
 * await tenantStore.putForTenant({
 *   type: 'documents',
 *   id: 'doc-123',
 *   filename: 'report.pdf',
 *   data: pdfBuffer,
 *   contentType: 'application/pdf',
 *   customMetadata: { author: 'Jane Doe' }
 * })
 *
 * // Retrieve tenant-scoped object
 * const doc = await tenantStore.getForTenant({
 *   type: 'documents',
 *   id: 'doc-123',
 *   filename: 'report.pdf'
 * })
 *
 * // List all documents for tenant
 * const list = await tenantStore.listForTenant({ type: 'documents' })
 * ```
 *
 * @example Streaming for large files
 * ```typescript
 * const store = createR2Store(env.R2_BUCKET)
 *
 * // Upload from stream
 * const stream = request.body
 * await store.putStream('uploads/large-file.zip', stream, {
 *   contentType: 'application/zip'
 * })
 *
 * // Download as stream (for proxying)
 * const downloadStream = await store.getStream('uploads/large-file.zip')
 * return new Response(downloadStream, {
 *   headers: { 'Content-Type': 'application/zip' }
 * })
 *
 * // Range requests for partial downloads
 * const partialStream = await store.getStream('videos/movie.mp4', {
 *   range: { offset: 0, length: 1024 * 1024 } // First 1MB
 * })
 * ```
 *
 * @example Listing and iteration
 * ```typescript
 * const store = createR2Store(env.R2_BUCKET)
 *
 * // List with pagination
 * const result = await store.list({
 *   prefix: 'backups/',
 *   limit: 100,
 *   include: ['customMetadata']
 * })
 *
 * // Async iteration over all objects
 * for await (const obj of store.listAll({ prefix: 'logs/' })) {
 *   console.log(obj.key, obj.size)
 *   if (obj.uploaded < oneWeekAgo) {
 *     await store.delete(obj.key)
 *   }
 * }
 *
 * // Directory-like listing with delimiter
 * const dirs = await store.list({
 *   prefix: 'data/',
 *   delimiter: '/'
 * })
 * // dirs.delimitedPrefixes = ['data/2024/', 'data/2025/']
 * ```
 *
 * @example Metadata management
 * ```typescript
 * const store = createR2Store(env.R2_BUCKET)
 *
 * // Get only metadata (no body transfer)
 * const meta = await store.getMetadata('files/image.png')
 * console.log(meta?.httpMetadata?.contentType) // 'image/png'
 * console.log(meta?.customMetadata?.uploadedBy)
 *
 * // Update metadata (requires re-upload internally)
 * await store.updateMetadata('files/image.png', {
 *   cacheControl: 'public, max-age=31536000',
 *   customMetadata: { status: 'approved' }
 * })
 *
 * // Copy with metadata preservation
 * await store.copy('files/original.png', 'files/backup.png')
 * ```
 *
 * @example Signed URLs for direct access
 * ```typescript
 * const store = createR2Store(env.R2_BUCKET, {
 *   publicUrl: 'https://files.example.com'
 * })
 *
 * // Generate download URL (expires in 1 hour)
 * const downloadUrl = await store.getSignedUrl('private/doc.pdf', {
 *   expiresIn: 3600,
 *   action: 'get',
 *   contentDisposition: 'attachment; filename="document.pdf"'
 * })
 *
 * // Generate upload URL for client-side uploads
 * const uploadUrl = await store.getUploadUrl('uploads/user-file.jpg', {
 *   expiresIn: 300, // 5 minutes
 *   contentType: 'image/jpeg',
 *   maxSize: 10 * 1024 * 1024 // 10MB limit
 * })
 * ```
 *
 * @example Path utilities
 * ```typescript
 * import { buildPath, parsePath } from './r2'
 *
 * // Build standardized paths
 * const path = buildPath({
 *   tenant: 'acme',
 *   type: 'backups',
 *   id: 'db-1',
 *   timestamp: '2024-01-15T10:30:00Z',
 *   filename: 'dump.sql'
 * })
 * // path = 'acme/backups/db-1/2024-01-15T10:30:00Z/dump.sql'
 *
 * // Parse paths back to components
 * const components = parsePath('acme/documents/doc-123/report.pdf')
 * // { tenant: 'acme', type: 'documents', id: 'doc-123', filename: 'report.pdf' }
 * ```
 */

// ============================================================================
// CLOUDFLARE R2 BUCKET INTERFACE
// ============================================================================

/**
 * R2 Bucket interface (compatible with Cloudflare R2Bucket binding)
 */
export interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: R2PutOptions
  ): Promise<R2ObjectRaw>
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBodyRaw | null>
  head(key: string): Promise<R2ObjectRaw | null>
  delete(keys: string | string[]): Promise<void>
  list(options?: R2ListOptionsRaw): Promise<R2ObjectsRaw>
  createMultipartUpload?(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload>
}

/**
 * Raw R2 object from Cloudflare binding (for internal use)
 */
interface R2ObjectRaw {
  key: string
  version: string
  size: number
  etag: string
  httpMetadata?: R2HTTPMetadata
  customMetadata?: Record<string, string>
  uploaded: Date
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  json<T>(): Promise<T>
  blob(): Promise<Blob>
  writeHttpMetadata(headers: Headers): void
}

/**
 * Raw R2 object with body from Cloudflare binding
 */
interface R2ObjectBodyRaw extends R2ObjectRaw {
  body: ReadableStream
  bodyUsed: boolean
}

/**
 * Raw R2 list options
 */
interface R2ListOptionsRaw {
  prefix?: string
  limit?: number
  cursor?: string
  delimiter?: string
  include?: ('httpMetadata' | 'customMetadata')[]
}

/**
 * Raw R2 list result
 */
interface R2ObjectsRaw {
  objects: R2ObjectRaw[]
  truncated: boolean
  cursor?: string
  delimitedPrefixes: string[]
}

/**
 * R2 put options
 */
interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata
  customMetadata?: Record<string, string>
  md5?: ArrayBuffer | string
  sha1?: ArrayBuffer | string
  sha256?: ArrayBuffer | string
  sha384?: ArrayBuffer | string
  sha512?: ArrayBuffer | string
  onlyIf?: R2Conditional
}

/**
 * R2 get options
 */
interface R2GetOptions {
  range?: R2Range
  onlyIf?: R2Conditional
}

/**
 * R2 range specification
 */
interface R2Range {
  offset?: number
  length?: number
  suffix?: number
}

/**
 * R2 conditional options
 */
interface R2Conditional {
  etagMatches?: string
  etagDoesNotMatch?: string
  uploadedBefore?: Date
  uploadedAfter?: Date
}

/**
 * R2 multipart upload options
 */
interface R2MultipartOptions {
  httpMetadata?: R2HTTPMetadata
  customMetadata?: Record<string, string>
}

/**
 * R2 multipart upload
 */
interface R2MultipartUpload {
  uploadId: string
  key: string
  uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob): Promise<R2UploadedPart>
  abort(): Promise<void>
  complete(uploadedParts: R2UploadedPart[]): Promise<R2ObjectRaw>
}

/**
 * R2 uploaded part
 */
interface R2UploadedPart {
  partNumber: number
  etag: string
}

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Configuration options for R2Store
 */
export interface R2StoreConfig {
  /** Tenant identifier for multi-tenant path prefix */
  tenant?: string
  /** Default content type when not specified or detected */
  defaultContentType?: string
  /** Public URL base for generating signed URLs */
  publicUrl?: string
}

/**
 * R2 Object metadata (returned from get/head operations)
 */
export interface R2Object {
  /** Object key */
  key: string
  /** Object version */
  version: string
  /** Object size in bytes */
  size: number
  /** ETag */
  etag: string
  /** HTTP metadata (content-type, cache-control, etc.) */
  httpMetadata?: R2HTTPMetadata
  /** Custom metadata */
  customMetadata?: Record<string, string>
  /** Upload timestamp */
  uploaded: Date
  /** Body as ReadableStream (null for head operations) */
  body: ReadableStream | null
  /** Whether the body has been consumed */
  bodyUsed: boolean
  /** Read body as ArrayBuffer */
  arrayBuffer(): Promise<ArrayBuffer>
  /** Read body as text */
  text(): Promise<string>
  /** Read body as JSON */
  json<T>(): Promise<T>
  /** Read body as Blob */
  blob(): Promise<Blob>
  /** Write HTTP metadata to headers */
  writeHttpMetadata(headers: Headers): void
}

/**
 * R2 Object metadata (without body)
 */
export interface R2ObjectMetadata {
  /** Object key */
  key: string
  /** Object version */
  version: string
  /** Object size in bytes */
  size: number
  /** ETag */
  etag: string
  /** HTTP metadata */
  httpMetadata?: R2HTTPMetadata
  /** Custom metadata */
  customMetadata?: Record<string, string>
  /** Upload timestamp */
  uploaded: Date
}

/**
 * HTTP metadata for R2 objects
 */
export interface R2HTTPMetadata {
  contentType?: string
  contentLanguage?: string
  contentDisposition?: string
  contentEncoding?: string
  cacheControl?: string
  cacheExpiry?: Date
}

/**
 * Options for put operations
 */
export interface PutOptions {
  /** Content type (overrides auto-detection) */
  contentType?: string
  /** Custom metadata to attach */
  customMetadata?: Record<string, string>
  /** Content disposition header */
  contentDisposition?: string
  /** Content encoding */
  contentEncoding?: string
  /** Cache control header */
  cacheControl?: string
}

/**
 * Options for get operations
 */
export interface GetOptions {
  /** Range request */
  range?: {
    offset?: number
    length?: number
    suffix?: number
  }
  /** Only return if etag matches */
  onlyIf?: {
    etagMatches?: string
    etagDoesNotMatch?: string
    uploadedBefore?: Date
    uploadedAfter?: Date
  }
}

/**
 * Options for list operations
 */
export interface R2ListOptions {
  /** Prefix to filter objects */
  prefix?: string
  /** Maximum number of results */
  limit?: number
  /** Pagination cursor */
  cursor?: string
  /** Delimiter for directory-like listing */
  delimiter?: string
  /** Include metadata in results */
  include?: ('httpMetadata' | 'customMetadata')[]
}

/**
 * Result from list operations
 */
export interface R2ListResult {
  /** Objects matching the query */
  objects: R2Object[]
  /** Whether more results are available */
  truncated: boolean
  /** Cursor for next page */
  cursor?: string
  /** Delimited prefixes (virtual directories) */
  delimitedPrefixes: string[]
}

/**
 * Options for presigned URL generation
 */
export interface PresignedUrlOptions {
  /** URL expiration in seconds */
  expiresIn: number
  /** Action (get for download, put for upload) */
  action?: 'get' | 'put'
  /** Content disposition for downloads */
  contentDisposition?: string
  /** Content type restriction for uploads */
  contentType?: string
  /** Maximum upload size in bytes */
  maxSize?: number
}

/**
 * Options for streaming operations
 */
export interface StreamOptions {
  /** Content type */
  contentType?: string
  /** Content length hint */
  contentLength?: number
  /** Custom metadata */
  customMetadata?: Record<string, string>
  /** Range for partial reads */
  range?: {
    offset?: number
    length?: number
  }
}

/**
 * Path components for tenant-scoped operations
 */
export interface PathComponents {
  tenant: string
  type: string
  id: string
  timestamp?: string
  filename?: string
}

/**
 * Options for tenant-scoped put operations
 */
export interface TenantPutOptions {
  type: string
  id: string
  data: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob
  timestamp?: string
  filename?: string
  contentType?: string
  customMetadata?: Record<string, string>
}

/**
 * Options for tenant-scoped get operations
 */
export interface TenantGetOptions {
  type: string
  id: string
  timestamp?: string
  filename?: string
}

/**
 * Options for tenant-scoped list operations
 */
export interface TenantListOptions {
  type: string
  id?: string
  limit?: number
  cursor?: string
}

/**
 * Options for tenant-scoped signed URL generation
 */
export interface TenantSignedUrlOptions {
  type: string
  id: string
  timestamp?: string
  filename?: string
  expiresIn: number
  action?: 'get' | 'put'
}

// ============================================================================
// CONTENT TYPE MAPPING
// ============================================================================

/**
 * Map of file extensions to MIME types
 */
const CONTENT_TYPE_MAP: Record<string, string> = {
  // Text
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',

  // JavaScript/TypeScript
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.jsx': 'application/javascript',

  // Data formats
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',

  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.avif': 'image/avif',

  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  // Archives
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',

  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',

  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',

  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',

  // Other
  '.wasm': 'application/wasm',
  '.sql': 'application/sql',
}

/**
 * Detect content type from filename
 */
function detectContentType(filename: string, defaultType: string = 'application/octet-stream'): string {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0]
  if (ext && CONTENT_TYPE_MAP[ext]) {
    return CONTENT_TYPE_MAP[ext]
  }
  return defaultType
}

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Build a standardized path from components
 *
 * Format: {tenant}/{type}/{id}[/{timestamp}][/{filename}]
 *
 * @param components - Path components
 * @returns Constructed path string
 *
 * @example
 * ```typescript
 * buildPath({ tenant: 'acme', type: 'documents', id: 'doc-123' })
 * // Returns: 'acme/documents/doc-123'
 *
 * buildPath({ tenant: 'acme', type: 'backups', id: 'db-1', timestamp: '2024-01-15T10:30:00Z' })
 * // Returns: 'acme/backups/db-1/2024-01-15T10:30:00Z'
 *
 * buildPath({ tenant: 'acme', type: 'uploads', id: 'user-1', filename: 'photo.jpg' })
 * // Returns: 'acme/uploads/user-1/photo.jpg'
 * ```
 */
export function buildPath(components: Omit<PathComponents, 'tenant'> & { tenant: string }): string {
  const parts = [components.tenant, components.type, components.id]

  if (components.timestamp) {
    parts.push(components.timestamp)
  }

  if (components.filename) {
    parts.push(components.filename)
  }

  return parts.join('/')
}

/**
 * Parse a standardized path into components
 *
 * @param path - Path string to parse
 * @returns Parsed components or null if invalid
 *
 * @example
 * ```typescript
 * parsePath('acme/documents/doc-123')
 * // Returns: { tenant: 'acme', type: 'documents', id: 'doc-123' }
 *
 * parsePath('acme/backups/db-1/2024-01-15T10:30:00Z')
 * // Returns: { tenant: 'acme', type: 'backups', id: 'db-1', timestamp: '2024-01-15T10:30:00Z' }
 * ```
 */
export function parsePath(path: string): PathComponents | null {
  const parts = path.split('/')

  if (parts.length < 3) {
    return null
  }

  const [tenant, type, id, ...rest] = parts

  const result: PathComponents = {
    tenant: tenant!,
    type: type!,
    id: id!,
  }

  if (rest.length > 0) {
    // Check if the next part looks like a timestamp (ISO format)
    const isTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(rest[0]!)

    if (isTimestamp) {
      result.timestamp = rest[0]
      if (rest.length > 1) {
        result.filename = rest.slice(1).join('/')
      }
    } else {
      // Assume it's a filename
      result.filename = rest.join('/')
    }
  }

  return result
}

// ============================================================================
// R2STORE CLASS
// ============================================================================

/**
 * R2Store class providing typed R2 operations
 */
export class R2Store {
  private r2: R2Bucket
  private tenant: string | undefined
  private defaultContentType: string
  private publicUrl: string | undefined

  constructor(r2: R2Bucket, config?: R2StoreConfig) {
    this.r2 = r2
    this.tenant = config?.tenant
    this.defaultContentType = config?.defaultContentType ?? 'application/octet-stream'
    this.publicUrl = config?.publicUrl
  }

  // ==========================================================================
  // Basic Operations
  // ==========================================================================

  /**
   * Store an object in R2
   *
   * @param key - Object key
   * @param data - Object data
   * @param options - Put options
   * @returns Object metadata
   */
  async put(
    key: string,
    data: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob,
    options?: PutOptions
  ): Promise<R2Object> {
    const contentType = options?.contentType ?? detectContentType(key, this.defaultContentType)

    const httpMetadata: R2HTTPMetadata = {
      contentType,
    }

    if (options?.contentDisposition) {
      httpMetadata.contentDisposition = options.contentDisposition
    }
    if (options?.contentEncoding) {
      httpMetadata.contentEncoding = options.contentEncoding
    }
    if (options?.cacheControl) {
      httpMetadata.cacheControl = options.cacheControl
    }

    const r2Object = await this.r2.put(key, data, {
      httpMetadata,
      customMetadata: options?.customMetadata,
    })

    return this.wrapR2Object(r2Object)
  }

  /**
   * Retrieve an object from R2
   *
   * @param key - Object key
   * @param options - Get options
   * @returns Object with body or null if not found
   */
  async get(key: string, options?: GetOptions): Promise<R2Object | null> {
    const r2Options: R2GetOptions = {}

    if (options?.range) {
      r2Options.range = options.range
    }
    if (options?.onlyIf) {
      r2Options.onlyIf = options.onlyIf
    }

    const r2Object = await this.r2.get(key, r2Options)
    if (!r2Object) return null

    return this.wrapR2Object(r2Object)
  }

  /**
   * Get object metadata without body
   *
   * @param key - Object key
   * @returns Object metadata or null if not found
   */
  async head(key: string): Promise<R2Object | null> {
    const r2Object = await this.r2.head(key)
    if (!r2Object) return null

    return this.wrapR2Object(r2Object, true)
  }

  /**
   * Delete one or more objects
   *
   * @param keys - Key or array of keys to delete
   */
  async delete(keys: string | string[]): Promise<void> {
    await this.r2.delete(keys)
  }

  /**
   * Check if an object exists
   *
   * @param key - Object key
   * @returns True if exists
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.r2.head(key)
    return result !== null
  }

  /**
   * List objects in the bucket
   *
   * @param options - List options
   * @returns List result with objects and pagination info
   */
  async list(options: R2ListOptions): Promise<R2ListResult> {
    const r2Options: R2ListOptions = {}

    if (options.prefix !== undefined) r2Options.prefix = options.prefix
    if (options.limit !== undefined) r2Options.limit = options.limit
    if (options.cursor !== undefined) r2Options.cursor = options.cursor
    if (options.delimiter !== undefined) r2Options.delimiter = options.delimiter
    if (options.include !== undefined) r2Options.include = options.include

    const result = await this.r2.list(r2Options)

    return {
      objects: result.objects.map((obj) => this.wrapR2Object(obj, true)),
      truncated: result.truncated,
      cursor: result.cursor,
      delimitedPrefixes: result.delimitedPrefixes,
    }
  }

  /**
   * Async generator for iterating through all objects
   *
   * @param options - List options (excluding cursor)
   * @yields R2Object for each object
   */
  async *listAll(options: Omit<R2ListOptions, 'cursor'>): AsyncGenerator<R2Object> {
    let cursor: string | undefined

    do {
      const result = await this.list({ ...options, cursor })

      for (const obj of result.objects) {
        yield obj
      }

      cursor = result.truncated ? result.cursor : undefined
    } while (cursor)
  }

  // ==========================================================================
  // Tenant-Scoped Operations
  // ==========================================================================

  /**
   * Store an object with tenant path prefix
   */
  async putForTenant(options: TenantPutOptions): Promise<R2Object> {
    if (!this.tenant) {
      throw new Error('R2Store not configured with tenant')
    }

    const path = buildPath({
      tenant: this.tenant,
      type: options.type,
      id: options.id,
      timestamp: options.timestamp,
      filename: options.filename,
    })

    return this.put(path, options.data, {
      contentType: options.contentType,
      customMetadata: options.customMetadata,
    })
  }

  /**
   * Retrieve an object with tenant path prefix
   */
  async getForTenant(options: TenantGetOptions): Promise<R2Object | null> {
    if (!this.tenant) {
      throw new Error('R2Store not configured with tenant')
    }

    const path = buildPath({
      tenant: this.tenant,
      type: options.type,
      id: options.id,
      timestamp: options.timestamp,
      filename: options.filename,
    })

    return this.get(path)
  }

  /**
   * List objects with tenant path prefix
   */
  async listForTenant(options: TenantListOptions): Promise<R2ListResult> {
    if (!this.tenant) {
      throw new Error('R2Store not configured with tenant')
    }

    let prefix = `${this.tenant}/${options.type}/`
    if (options.id) {
      prefix += `${options.id}/`
    }

    return this.list({
      prefix,
      limit: options.limit,
      cursor: options.cursor,
    })
  }

  /**
   * Delete an object with tenant path prefix
   */
  async deleteForTenant(options: TenantGetOptions): Promise<void> {
    if (!this.tenant) {
      throw new Error('R2Store not configured with tenant')
    }

    const path = buildPath({
      tenant: this.tenant,
      type: options.type,
      id: options.id,
      timestamp: options.timestamp,
      filename: options.filename,
    })

    return this.delete(path)
  }

  // ==========================================================================
  // Streaming Operations
  // ==========================================================================

  /**
   * Store data from a ReadableStream
   */
  async putStream(
    key: string,
    stream: ReadableStream,
    options?: StreamOptions
  ): Promise<R2Object> {
    const contentType = options?.contentType ?? detectContentType(key, this.defaultContentType)

    const httpMetadata: R2HTTPMetadata = {
      contentType,
    }

    const r2Object = await this.r2.put(key, stream, {
      httpMetadata,
      customMetadata: options?.customMetadata,
    })

    return this.wrapR2Object(r2Object)
  }

  /**
   * Get object body as ReadableStream
   */
  async getStream(key: string, options?: StreamOptions): Promise<ReadableStream | null> {
    const getOptions: GetOptions = {}

    if (options?.range) {
      getOptions.range = options.range
    }

    const r2Object = await this.get(key, getOptions)
    if (!r2Object) return null

    return r2Object.body
  }

  /**
   * Copy an object to a new key
   */
  async copy(sourceKey: string, destKey: string): Promise<R2Object> {
    const source = await this.get(sourceKey)
    if (!source) {
      throw new Error(`Source object not found: ${sourceKey}`)
    }

    // Read the source body
    const data = await source.arrayBuffer()

    // Put to destination with same metadata
    return this.put(destKey, data, {
      contentType: source.httpMetadata?.contentType,
      customMetadata: source.customMetadata,
      contentDisposition: source.httpMetadata?.contentDisposition,
      contentEncoding: source.httpMetadata?.contentEncoding,
      cacheControl: source.httpMetadata?.cacheControl,
    })
  }

  // ==========================================================================
  // Metadata Management
  // ==========================================================================

  /**
   * Get only metadata for an object (alias for head)
   */
  async getMetadata(key: string): Promise<R2ObjectMetadata | null> {
    const obj = await this.head(key)
    if (!obj) return null

    return {
      key: obj.key,
      version: obj.version,
      size: obj.size,
      etag: obj.etag,
      httpMetadata: obj.httpMetadata,
      customMetadata: obj.customMetadata,
      uploaded: obj.uploaded,
    }
  }

  /**
   * Update metadata on an existing object
   *
   * Note: This requires re-uploading the object since R2 doesn't support
   * in-place metadata updates.
   */
  async updateMetadata(
    key: string,
    metadata: {
      contentType?: string
      cacheControl?: string
      contentDisposition?: string
      contentEncoding?: string
      customMetadata?: Record<string, string>
    }
  ): Promise<R2Object> {
    const existing = await this.get(key)
    if (!existing) {
      throw new Error(`Object not found: ${key}`)
    }

    const data = await existing.arrayBuffer()

    const httpMetadata: R2HTTPMetadata = {
      contentType: metadata.contentType ?? existing.httpMetadata?.contentType,
      cacheControl: metadata.cacheControl ?? existing.httpMetadata?.cacheControl,
      contentDisposition: metadata.contentDisposition ?? existing.httpMetadata?.contentDisposition,
      contentEncoding: metadata.contentEncoding ?? existing.httpMetadata?.contentEncoding,
    }

    const r2Object = await this.r2.put(key, data, {
      httpMetadata,
      customMetadata: metadata.customMetadata ?? existing.customMetadata,
    })

    return this.wrapR2Object(r2Object)
  }

  // ==========================================================================
  // Presigned URLs
  // ==========================================================================

  /**
   * Generate a signed URL for an object
   *
   * Note: R2 doesn't natively support presigned URLs in the same way as S3.
   * This generates a URL that can be used with Workers to serve the object.
   * For true presigned URLs, you would need to implement signed URL verification
   * in your Worker or use Cloudflare Access.
   */
  async getSignedUrl(key: string, options: PresignedUrlOptions): Promise<string> {
    if (!this.publicUrl) {
      throw new Error('R2Store not configured with publicUrl for signed URLs')
    }

    const baseUrl = this.publicUrl.replace(/\/$/, '')
    const expires = Math.floor(Date.now() / 1000) + options.expiresIn
    const action = options.action ?? 'get'

    // Build URL with signing parameters
    const url = new URL(`${baseUrl}/${key}`)
    url.searchParams.set('expires', expires.toString())
    url.searchParams.set('action', action)

    if (options.contentDisposition) {
      url.searchParams.set('disposition', options.contentDisposition)
    }

    // Generate a simple signature (in production, use a proper signing mechanism)
    const signatureData = `${key}:${expires}:${action}`
    const signature = await this.generateSignature(signatureData)
    url.searchParams.set('signature', signature)

    return url.toString()
  }

  /**
   * Generate a signed URL for upload
   */
  async getUploadUrl(key: string, options: PresignedUrlOptions): Promise<string> {
    return this.getSignedUrl(key, {
      ...options,
      action: 'put',
    })
  }

  /**
   * Generate a signed URL for a tenant-scoped object
   */
  async getSignedUrlForTenant(options: TenantSignedUrlOptions): Promise<string> {
    if (!this.tenant) {
      throw new Error('R2Store not configured with tenant')
    }

    const path = buildPath({
      tenant: this.tenant,
      type: options.type,
      id: options.id,
      timestamp: options.timestamp,
      filename: options.filename,
    })

    return this.getSignedUrl(path, {
      expiresIn: options.expiresIn,
      action: options.action,
    })
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Wrap an R2Object/R2ObjectBody to match our interface
   */
  private wrapR2Object(
    obj: R2ObjectRaw | R2ObjectBodyRaw,
    headOnly: boolean = false
  ): R2Object {
    const isBody = 'body' in obj && obj.body !== null && !headOnly

    return {
      key: obj.key,
      version: obj.version,
      size: obj.size,
      etag: obj.etag,
      httpMetadata: obj.httpMetadata as R2HTTPMetadata | undefined,
      customMetadata: obj.customMetadata,
      uploaded: obj.uploaded,
      body: isBody ? (obj as R2ObjectBodyRaw).body : null,
      bodyUsed: 'bodyUsed' in obj ? obj.bodyUsed : false,
      arrayBuffer: () => obj.arrayBuffer(),
      text: () => obj.text(),
      json: <T>() => obj.json<T>(),
      blob: () => obj.blob(),
      writeHttpMetadata: (headers: Headers) => obj.writeHttpMetadata(headers),
    }
  }

  /**
   * Generate a simple signature for URLs
   * In production, use a proper HMAC or similar mechanism
   */
  private async generateSignature(data: string): Promise<string> {
    const encoder = new TextEncoder()
    const dataBuffer = encoder.encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an R2Store instance
 *
 * @param r2 - R2Bucket binding
 * @param config - Store configuration
 * @returns R2Store instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const store = createR2Store(env.R2)
 * await store.put('file.txt', 'content')
 *
 * // With tenant configuration
 * const tenantStore = createR2Store(env.R2, {
 *   tenant: 'tenant-123',
 *   publicUrl: 'https://r2.example.com.ai'
 * })
 * await tenantStore.putForTenant({
 *   type: 'documents',
 *   id: 'doc-456',
 *   data: 'document content'
 * })
 * ```
 */
export function createR2Store(r2: R2Bucket, config?: R2StoreConfig): R2Store {
  return new R2Store(r2, config)
}
