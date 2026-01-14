/**
 * MediaPipeline - Unified media handling primitive
 *
 * Provides comprehensive media processing capabilities:
 * - **Chunked Upload**: Multipart uploads with resume support
 * - **Image Transformation**: Resize, crop, format conversion
 * - **Video Transcoding**: Format conversion, thumbnails (via delegate)
 * - **CDN Delivery**: Cached content delivery with R2
 * - **Signed URLs**: Secure, time-limited access
 * - **Metadata Extraction**: Image/video metadata parsing
 *
 * ## Architecture
 *
 * MediaPipeline composes several primitives:
 * - ImageTransformer: Workers Image Resizing compatible transformations
 * - PresignedUrlGenerator: AWS Signature V4 presigned URLs
 * - CDNDelivery: R2-backed content delivery
 * - VideoTranscoder: Cloudflare Stream / external service delegation
 * - MetadataExtractor: File metadata parsing
 * - ChunkedUploader: Multipart upload handling
 *
 * ## Usage
 *
 * ```typescript
 * import { createMediaPipeline } from '@dotdo/primitives/media-pipeline'
 *
 * const pipeline = createMediaPipeline({
 *   bucket: env.R2_BUCKET,
 *   accessKeyId: env.R2_ACCESS_KEY_ID,
 *   secretAccessKey: env.R2_SECRET_ACCESS_KEY,
 *   endpoint: env.R2_ENDPOINT,
 * })
 *
 * // Upload with chunking
 * const upload = await pipeline.upload(file, {
 *   key: 'uploads/video.mp4',
 *   chunked: true,
 *   chunkSize: 5 * 1024 * 1024, // 5MB chunks
 * })
 *
 * // Transform image
 * const transformed = await pipeline.transform(imageBuffer, {
 *   width: 300,
 *   height: 200,
 *   format: 'webp',
 * })
 *
 * // Get signed URL
 * const { url } = await pipeline.getSignedUrl('uploads/video.mp4', {
 *   expiresIn: 3600,
 *   permission: 'read',
 * })
 * ```
 *
 * @module db/primitives/media-pipeline
 */

// =============================================================================
// Re-exports from submodules
// =============================================================================

export {
  createImageTransformer,
  type ImageTransformer,
  type ImageTransformerConfig,
  type ResizeOptions,
  type CropOptions,
  type TransformOptions,
  type CfImageTransformOptions,
  type TransformResult,
  type ImageMetadata,
  type OutputFormat,
  type FitMode,
  type GravityPosition,
} from './image-transformer'

export {
  createPresignedUrlGenerator,
  type PresignedUrlGenerator,
  type PresignedUrlGeneratorConfig,
  type PresignedUrlOptions,
  type PresignedUploadUrl,
  type PresignedDownloadUrl,
  type PresignedUrlPermission,
  type ChunkedUploadInit,
  type ChunkedUploadPartUrl,
} from './presigned-urls'

export {
  createCDNDelivery,
  generateETag,
  generateCacheControl,
  isStaleResponse,
  type CDNDelivery,
  type CDNDeliveryConfig,
  type CorsConfig,
  type ConditionalHeaders,
  type DeliveryOptions,
  type CacheOptions,
} from './cdn-delivery'

export {
  createVideoTranscoder,
  type VideoTranscoder,
  type VideoTranscoderConfig,
  type VideoMetadata,
  type TranscodeOptions,
  type TranscodeResult,
  type ThumbnailOptions,
  type ThumbnailResult,
  type VideoFormat,
  type VideoCodec,
  type AudioCodec,
  VideoTranscodeError,
  VideoUnsupportedError,
} from '../video-transcode'

export {
  createMediaLibrary,
  type MediaLibrary,
  type MediaMetadata as LibraryMediaMetadata,
  type MediaType as LibraryMediaType,
  type ExifData as LibraryExifData,
  type GpsCoordinates,
  type ExposureSettings,
  type LensInfo,
  type ImageMetadata as LibraryImageMetadata,
  type VideoMetadata as LibraryVideoMetadata,
  type AudioMetadata as LibraryAudioMetadata,
  type DocumentMetadata,
  type AddMediaOptions,
  type SearchOptions,
  type SearchResult,
  type FolderInfo,
  type TagInfo,
  type MediaLibraryConfig,
  // Utility functions
  detectMimeType as detectMimeTypeFromBytes,
  getMimeTypeFromExtension as getMimeFromExtension,
  getMediaTypeFromMime as getMediaTypeFromMimeType,
  extractExifFromJpeg,
  extractExifFromTiff,
  extractImageDimensions,
  extractImageMetadata as extractImageMeta,
  imageHasAlpha,
} from './media-library'

// =============================================================================
// Types
// =============================================================================

/**
 * Supported media types
 */
export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'unknown'

/**
 * Media file metadata (generic)
 */
export interface MediaMetadata {
  /** File size in bytes */
  size: number
  /** MIME type */
  mimeType: string
  /** Detected media type */
  type: MediaType
  /** File name (if available) */
  fileName?: string
  /** File extension */
  extension?: string
  /** Upload timestamp */
  uploadedAt?: Date
  /** Last modified timestamp */
  modifiedAt?: Date
  /** Content hash (MD5 or SHA256) */
  hash?: string
  /** Image-specific metadata */
  image?: ImageMetadataExtended
  /** Video-specific metadata */
  video?: VideoMetadataExtended
  /** Audio-specific metadata */
  audio?: AudioMetadataExtended
  /** Custom metadata */
  custom?: Record<string, unknown>
}

/**
 * Extended image metadata
 */
export interface ImageMetadataExtended {
  width: number
  height: number
  format: string
  hasAlpha: boolean
  colorSpace?: string
  bitDepth?: number
  isAnimated?: boolean
  frameCount?: number
  exif?: ExifData
}

/**
 * EXIF data extracted from images
 */
export interface ExifData {
  make?: string
  model?: string
  orientation?: number
  dateTime?: string
  gps?: {
    latitude?: number
    longitude?: number
    altitude?: number
  }
  exposure?: {
    time?: string
    fNumber?: number
    iso?: number
  }
  [key: string]: unknown
}

/**
 * Extended video metadata
 */
export interface VideoMetadataExtended {
  width: number
  height: number
  duration: number
  format: string
  codec?: string
  audioCodec?: string
  frameRate?: number
  bitrate?: number
  hasAudio: boolean
  isHDR?: boolean
  rotation?: number
}

/**
 * Extended audio metadata
 */
export interface AudioMetadataExtended {
  duration: number
  format: string
  codec?: string
  sampleRate?: number
  channels?: number
  bitrate?: number
}

/**
 * Upload options
 */
export interface UploadOptions {
  /** Target key/path in storage */
  key: string
  /** Enable chunked upload for large files */
  chunked?: boolean
  /** Chunk size in bytes (default: 5MB) */
  chunkSize?: number
  /** Content type (auto-detected if not provided) */
  contentType?: string
  /** Custom metadata */
  metadata?: Record<string, string>
  /** Maximum file size allowed */
  maxSize?: number
  /** Progress callback */
  onProgress?: (progress: UploadProgress) => void
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Upload progress information
 */
export interface UploadProgress {
  /** Bytes uploaded so far */
  bytesUploaded: number
  /** Total bytes to upload */
  totalBytes: number
  /** Upload percentage (0-100) */
  percentage: number
  /** Current part number (for chunked) */
  currentPart?: number
  /** Total parts (for chunked) */
  totalParts?: number
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number
  /** Upload speed in bytes per second */
  speed?: number
}

/**
 * Upload result
 */
export interface UploadResult {
  /** Storage key */
  key: string
  /** File size in bytes */
  size: number
  /** Content type */
  contentType: string
  /** ETag of uploaded file */
  etag: string
  /** Upload ID (for chunked uploads) */
  uploadId?: string
  /** Extracted metadata */
  metadata?: MediaMetadata
  /** CDN URL (if available) */
  url?: string
}

/**
 * Download options
 */
export interface DownloadOptions {
  /** Optional range (for partial downloads) */
  range?: { start: number; end?: number }
  /** Response content disposition */
  disposition?: 'inline' | 'attachment'
  /** Custom filename for download */
  filename?: string
}

/**
 * Media pipeline configuration
 */
export interface MediaPipelineConfig {
  /** R2 bucket binding */
  bucket: R2Bucket
  /** Access key ID for presigned URLs */
  accessKeyId?: string
  /** Secret access key for presigned URLs */
  secretAccessKey?: string
  /** Custom endpoint (for R2/S3 compatible) */
  endpoint?: string
  /** Region (default: auto) */
  region?: string
  /** Path prefix for all keys */
  pathPrefix?: string
  /** Default chunk size for uploads (default: 5MB) */
  defaultChunkSize?: number
  /** Maximum file size (default: 5GB) */
  maxFileSize?: number
  /** CDN delivery configuration */
  cdn?: {
    cacheControl?: string
    enableConditionalRequests?: boolean
    enableRangeRequests?: boolean
    cors?: {
      allowOrigins: string[]
      allowMethods?: string[]
    }
  }
  /** Image transformer configuration */
  image?: {
    maxWidth?: number
    maxHeight?: number
    defaultQuality?: number
    defaultFormat?: 'webp' | 'jpeg' | 'png' | 'avif'
  }
  /** Video transcoder configuration */
  video?: {
    provider?: 'cloudflare-stream' | 'mux' | 'worker-native'
    accountId?: string
    apiToken?: string
  }
}

/**
 * Media pipeline interface
 */
export interface MediaPipeline {
  // Upload operations
  upload(data: Uint8Array | ReadableStream<Uint8Array>, options: UploadOptions): Promise<UploadResult>
  createUploadUrl(options: UploadOptions): Promise<PresignedUploadUrl>

  // Chunked upload operations
  initChunkedUpload(key: string, options?: Partial<UploadOptions>): Promise<ChunkedUpload>
  uploadChunk(upload: ChunkedUpload, partNumber: number, data: Uint8Array): Promise<ChunkResult>
  completeChunkedUpload(upload: ChunkedUpload): Promise<UploadResult>
  abortChunkedUpload(upload: ChunkedUpload): Promise<void>

  // Download operations
  download(key: string, options?: DownloadOptions): Promise<Response>
  createDownloadUrl(key: string, expiresIn?: number): Promise<string>

  // Transform operations
  transform(data: Uint8Array, options: TransformOptions): Promise<TransformResult>
  transformAndStore(key: string, options: TransformOptions & { outputKey: string }): Promise<UploadResult>

  // Metadata operations
  getMetadata(key: string): Promise<MediaMetadata>
  extractMetadata(data: Uint8Array, mimeType?: string): Promise<MediaMetadata>

  // CDN operations
  deliver(request: Request): Promise<Response>
  invalidateCache(keys: string[]): Promise<void>

  // Utility operations
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  copy(sourceKey: string, destKey: string): Promise<void>
  list(prefix?: string, options?: { limit?: number; cursor?: string }): Promise<ListResult>
}

/**
 * Chunked upload state
 */
export interface ChunkedUpload {
  /** Upload ID */
  uploadId: string
  /** Target key */
  key: string
  /** Content type */
  contentType: string
  /** Total size (if known) */
  totalSize?: number
  /** Chunk size */
  chunkSize: number
  /** Uploaded parts */
  parts: ChunkResult[]
  /** Created timestamp */
  createdAt: Date
  /** Expires timestamp */
  expiresAt: Date
  /** Custom metadata */
  metadata?: Record<string, string>
}

/**
 * Chunk upload result
 */
export interface ChunkResult {
  /** Part number */
  partNumber: number
  /** ETag of the part */
  etag: string
  /** Size of the part */
  size: number
}

/**
 * List result
 */
export interface ListResult {
  /** List of objects */
  objects: Array<{
    key: string
    size: number
    uploaded: Date
    etag: string
    httpMetadata?: {
      contentType?: string
    }
  }>
  /** Whether there are more results */
  truncated: boolean
  /** Cursor for next page */
  cursor?: string
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024 // 5GB
const MAX_CHUNKS = 10000
const MIN_CHUNK_SIZE = 5 * 1024 * 1024 // 5MB minimum for S3/R2
const MAX_CHUNK_SIZE = 5 * 1024 * 1024 * 1024 // 5GB maximum

/**
 * MIME type to media type mapping
 */
const MIME_TO_TYPE: Record<string, MediaType> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/avif': 'image',
  'image/svg+xml': 'image',
  'image/bmp': 'image',
  'image/tiff': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'video/x-msvideo': 'video',
  'video/x-matroska': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'audio/mp4': 'audio',
  'audio/flac': 'audio',
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/zip': 'archive',
  'application/x-tar': 'archive',
  'application/gzip': 'archive',
  'application/x-7z-compressed': 'archive',
}

/**
 * File extension to MIME type mapping
 */
const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Detect MIME type from file extension
 */
export function getMimeTypeFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return EXT_TO_MIME[ext] || 'application/octet-stream'
}

/**
 * Detect media type from MIME type
 */
export function getMediaTypeFromMime(mimeType: string): MediaType {
  return MIME_TO_TYPE[mimeType] || 'unknown'
}

/**
 * Detect MIME type from magic bytes
 */
export function detectMimeType(data: Uint8Array): string | null {
  if (data.length < 12) return null

  // PNG
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return 'image/png'
  }

  // JPEG
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg'
  }

  // GIF
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return 'image/gif'
  }

  // WebP
  if (
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) {
    return 'image/webp'
  }

  // AVIF (ftyp box)
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
    const brand = String.fromCharCode(data[8], data[9], data[10], data[11])
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (brand === 'ftyp' || brand === 'isom' || brand === 'mp41' || brand === 'mp42') {
      return 'video/mp4'
    }
  }

  // MP4 (also check for mov)
  if (
    data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70 ||
    (data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x00 && data[4] === 0x66)
  ) {
    return 'video/mp4'
  }

  // WebM
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return 'video/webm'
  }

  // MP3 (ID3 tag or frame sync)
  if (
    (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) || // ID3
    (data[0] === 0xff && (data[1] & 0xe0) === 0xe0) // Frame sync
  ) {
    return 'audio/mpeg'
  }

  // WAV
  if (
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x41 && data[10] === 0x56 && data[11] === 0x45
  ) {
    return 'audio/wav'
  }

  // PDF
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return 'application/pdf'
  }

  // ZIP
  if (data[0] === 0x50 && data[1] === 0x4b && (data[2] === 0x03 || data[2] === 0x05)) {
    return 'application/zip'
  }

  // GZIP
  if (data[0] === 0x1f && data[1] === 0x8b) {
    return 'application/gzip'
  }

  return null
}

/**
 * Calculate required number of chunks
 */
export function calculateChunks(totalSize: number, chunkSize: number): number {
  return Math.ceil(totalSize / chunkSize)
}

/**
 * Validate upload options
 */
export function validateUploadOptions(options: UploadOptions, config?: MediaPipelineConfig): void {
  if (!options.key || options.key.length === 0) {
    throw new Error('Upload key is required')
  }

  if (options.key.length > 1024) {
    throw new Error('Upload key exceeds maximum length of 1024 characters')
  }

  if (options.maxSize !== undefined && options.maxSize <= 0) {
    throw new Error('maxSize must be positive')
  }

  const maxFileSize = config?.maxFileSize ?? MAX_FILE_SIZE
  if (options.maxSize && options.maxSize > maxFileSize) {
    throw new Error(`maxSize exceeds maximum allowed file size of ${maxFileSize} bytes`)
  }

  if (options.chunkSize !== undefined) {
    if (options.chunkSize < MIN_CHUNK_SIZE) {
      throw new Error(`chunkSize must be at least ${MIN_CHUNK_SIZE} bytes (5MB)`)
    }
    if (options.chunkSize > MAX_CHUNK_SIZE) {
      throw new Error(`chunkSize must not exceed ${MAX_CHUNK_SIZE} bytes (5GB)`)
    }
  }
}

// =============================================================================
// Metadata Extraction
// =============================================================================

/**
 * PNG magic bytes and parsing
 */
function parsePngMetadata(data: Uint8Array): ImageMetadataExtended | null {
  if (data.length < 24) return null
  if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
    return null
  }

  // IHDR chunk at byte 8
  const width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19]
  const height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23]
  const bitDepth = data[24]
  const colorType = data[25]

  const hasAlpha = colorType === 4 || colorType === 6

  return {
    width,
    height,
    format: 'png',
    hasAlpha,
    bitDepth,
    colorSpace: 'srgb',
  }
}

/**
 * JPEG parsing
 */
function parseJpegMetadata(data: Uint8Array): ImageMetadataExtended | null {
  if (data.length < 4) return null
  if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) {
    return null
  }

  let width = 0
  let height = 0
  let i = 2

  while (i < data.length - 9) {
    if (data[i] !== 0xff) {
      i++
      continue
    }

    const marker = data[i + 1]

    // SOF0-SOF2 markers (baseline, progressive)
    if (marker >= 0xc0 && marker <= 0xc2) {
      height = (data[i + 5] << 8) | data[i + 6]
      width = (data[i + 7] << 8) | data[i + 8]
      break
    }

    // Skip marker segment
    if (marker !== 0xff && marker !== 0x00 && marker !== 0xd8 && marker !== 0xd9) {
      const length = (data[i + 2] << 8) | data[i + 3]
      i += 2 + length
    } else {
      i += 2
    }
  }

  if (width === 0 || height === 0) return null

  return {
    width,
    height,
    format: 'jpeg',
    hasAlpha: false,
    colorSpace: 'srgb',
    bitDepth: 8,
  }
}

/**
 * GIF parsing
 */
function parseGifMetadata(data: Uint8Array): ImageMetadataExtended | null {
  if (data.length < 10) return null
  if (data[0] !== 0x47 || data[1] !== 0x49 || data[2] !== 0x46) {
    return null
  }

  const width = data[6] | (data[7] << 8)
  const height = data[8] | (data[9] << 8)

  // Check for animation (look for multiple image blocks)
  let isAnimated = false
  let frameCount = 1

  // Simple check: look for extension introducer (0x21) followed by graphic control (0xf9)
  for (let i = 10; i < data.length - 1; i++) {
    if (data[i] === 0x21 && data[i + 1] === 0xf9) {
      frameCount++
      if (frameCount > 1) {
        isAnimated = true
      }
    }
  }

  return {
    width,
    height,
    format: 'gif',
    hasAlpha: true,
    isAnimated,
    frameCount: isAnimated ? frameCount : 1,
  }
}

/**
 * WebP parsing
 */
function parseWebpMetadata(data: Uint8Array): ImageMetadataExtended | null {
  if (data.length < 30) return null
  if (
    data[0] !== 0x52 || data[1] !== 0x49 || data[2] !== 0x46 || data[3] !== 0x46 ||
    data[8] !== 0x57 || data[9] !== 0x45 || data[10] !== 0x42 || data[11] !== 0x50
  ) {
    return null
  }

  const chunkType = String.fromCharCode(data[12], data[13], data[14], data[15])
  let width = 0
  let height = 0
  let hasAlpha = false
  let isAnimated = false

  if (chunkType === 'VP8 ') {
    // Lossy WebP
    width = ((data[26] | (data[27] << 8)) & 0x3fff)
    height = ((data[28] | (data[29] << 8)) & 0x3fff)
  } else if (chunkType === 'VP8L') {
    // Lossless WebP
    const bits = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24)
    width = (bits & 0x3fff) + 1
    height = ((bits >> 14) & 0x3fff) + 1
    hasAlpha = true
  } else if (chunkType === 'VP8X') {
    // Extended WebP
    const flags = data[20]
    hasAlpha = (flags & 0x10) !== 0
    isAnimated = (flags & 0x02) !== 0
    width = ((data[24] | (data[25] << 8) | (data[26] << 16)) & 0xffffff) + 1
    height = ((data[27] | (data[28] << 8) | (data[29] << 16)) & 0xffffff) + 1
  }

  if (width === 0 || height === 0) return null

  return {
    width,
    height,
    format: 'webp',
    hasAlpha,
    isAnimated,
    colorSpace: 'srgb',
  }
}

/**
 * Extract image metadata from buffer
 */
export function extractImageMetadata(data: Uint8Array): ImageMetadataExtended | null {
  // Try each format
  let metadata = parsePngMetadata(data)
  if (metadata) return metadata

  metadata = parseJpegMetadata(data)
  if (metadata) return metadata

  metadata = parseGifMetadata(data)
  if (metadata) return metadata

  metadata = parseWebpMetadata(data)
  if (metadata) return metadata

  return null
}

/**
 * Extract comprehensive metadata from a buffer
 */
export function extractMetadata(data: Uint8Array, filename?: string): MediaMetadata {
  // Detect MIME type
  let mimeType = detectMimeType(data)
  if (!mimeType && filename) {
    mimeType = getMimeTypeFromExtension(filename)
  }
  mimeType = mimeType || 'application/octet-stream'

  const mediaType = getMediaTypeFromMime(mimeType)
  const extension = filename?.split('.').pop()?.toLowerCase()

  const metadata: MediaMetadata = {
    size: data.length,
    mimeType,
    type: mediaType,
    fileName: filename,
    extension,
  }

  // Extract format-specific metadata
  if (mediaType === 'image') {
    const imageMetadata = extractImageMetadata(data)
    if (imageMetadata) {
      metadata.image = imageMetadata
    }
  }

  return metadata
}

// =============================================================================
// Implementation
// =============================================================================

import { createImageTransformer } from './image-transformer'
import { createPresignedUrlGenerator, type PresignedUploadUrl } from './presigned-urls'
import { createCDNDelivery } from './cdn-delivery'

/**
 * Creates a MediaPipeline instance
 *
 * @param config - Pipeline configuration
 * @returns MediaPipeline instance
 *
 * @example
 * ```typescript
 * const pipeline = createMediaPipeline({
 *   bucket: env.R2_BUCKET,
 *   accessKeyId: env.R2_ACCESS_KEY_ID,
 *   secretAccessKey: env.R2_SECRET_ACCESS_KEY,
 * })
 *
 * // Upload file
 * const result = await pipeline.upload(fileData, { key: 'images/photo.jpg' })
 *
 * // Transform image
 * const transformed = await pipeline.transform(imageData, {
 *   width: 300,
 *   format: 'webp',
 * })
 * ```
 */
export function createMediaPipeline(config: MediaPipelineConfig): MediaPipeline {
  const {
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    region = 'auto',
    pathPrefix = '',
    defaultChunkSize = DEFAULT_CHUNK_SIZE,
    maxFileSize = MAX_FILE_SIZE,
    cdn,
    image,
  } = config

  // Initialize sub-components
  const imageTransformer = createImageTransformer(image)

  const urlGenerator = accessKeyId && secretAccessKey
    ? createPresignedUrlGenerator({
        bucket: 'media', // Bucket name for URL generation
        accessKeyId,
        secretAccessKey,
        endpoint,
        region,
        pathPrefix,
      })
    : null

  const cdnDelivery = createCDNDelivery({
    bucket,
    defaultCacheControl: cdn?.cacheControl,
    enableConditionalRequests: cdn?.enableConditionalRequests,
    enableRangeRequests: cdn?.enableRangeRequests,
    cors: cdn?.cors,
  })

  // Track chunked uploads
  const activeUploads = new Map<string, ChunkedUpload>()

  /**
   * Build full key with prefix
   */
  function buildKey(key: string): string {
    return pathPrefix ? `${pathPrefix}${key}` : key
  }

  /**
   * Upload data to storage
   */
  async function upload(
    data: Uint8Array | ReadableStream<Uint8Array>,
    options: UploadOptions
  ): Promise<UploadResult> {
    validateUploadOptions(options, config)

    const key = buildKey(options.key)
    const contentType = options.contentType || getMimeTypeFromExtension(options.key)

    // Convert stream to buffer if needed
    let buffer: Uint8Array
    if (data instanceof ReadableStream) {
      const chunks: Uint8Array[] = []
      const reader = data.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) chunks.push(value)
      }
      buffer = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0))
      let offset = 0
      for (const chunk of chunks) {
        buffer.set(chunk, offset)
        offset += chunk.length
      }
    } else {
      buffer = data
    }

    // Check size limits
    if (buffer.length > maxFileSize) {
      throw new Error(`File size ${buffer.length} exceeds maximum allowed size of ${maxFileSize}`)
    }

    // Use chunked upload for large files
    if (options.chunked || buffer.length > defaultChunkSize * 2) {
      const chunkedUpload = await initChunkedUpload(options.key, options)
      const chunkSize = options.chunkSize || defaultChunkSize
      const totalChunks = calculateChunks(buffer.length, chunkSize)

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize
        const end = Math.min(start + chunkSize, buffer.length)
        const chunk = buffer.slice(start, end)

        await uploadChunk(chunkedUpload, i + 1, chunk)

        // Report progress
        if (options.onProgress) {
          options.onProgress({
            bytesUploaded: end,
            totalBytes: buffer.length,
            percentage: Math.round((end / buffer.length) * 100),
            currentPart: i + 1,
            totalParts: totalChunks,
          })
        }
      }

      return completeChunkedUpload(chunkedUpload)
    }

    // Direct upload
    const httpMetadata = {
      contentType,
      ...(options.metadata ? { customMetadata: options.metadata } : {}),
    }

    const result = await bucket.put(key, buffer, { httpMetadata })

    // Report completion
    if (options.onProgress) {
      options.onProgress({
        bytesUploaded: buffer.length,
        totalBytes: buffer.length,
        percentage: 100,
      })
    }

    // Extract metadata
    const metadata = extractMetadata(buffer, options.key)

    return {
      key: options.key,
      size: buffer.length,
      contentType,
      etag: result?.etag || '',
      metadata,
    }
  }

  /**
   * Create presigned upload URL
   */
  async function createUploadUrl(options: UploadOptions): Promise<PresignedUploadUrl> {
    if (!urlGenerator) {
      throw new Error('Presigned URLs require accessKeyId and secretAccessKey')
    }

    return urlGenerator.generateUploadUrl({
      key: options.key,
      contentType: options.contentType,
      metadata: options.metadata,
      maxContentLength: options.maxSize,
    })
  }

  /**
   * Initialize chunked upload
   */
  async function initChunkedUpload(
    key: string,
    options?: Partial<UploadOptions>
  ): Promise<ChunkedUpload> {
    const uploadId = crypto.randomUUID()
    const contentType = options?.contentType || getMimeTypeFromExtension(key)
    const chunkSize = options?.chunkSize || defaultChunkSize

    const chunkedUpload: ChunkedUpload = {
      uploadId,
      key,
      contentType,
      chunkSize,
      parts: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      metadata: options?.metadata,
    }

    activeUploads.set(uploadId, chunkedUpload)

    return chunkedUpload
  }

  /**
   * Upload a chunk
   */
  async function uploadChunk(
    upload: ChunkedUpload,
    partNumber: number,
    data: Uint8Array
  ): Promise<ChunkResult> {
    if (!activeUploads.has(upload.uploadId)) {
      throw new Error('Upload not found or expired')
    }

    if (partNumber < 1 || partNumber > MAX_CHUNKS) {
      throw new Error(`Part number must be between 1 and ${MAX_CHUNKS}`)
    }

    // In a real implementation, this would use S3's multipart upload API
    // For R2, we store chunks with part number suffix
    const chunkKey = buildKey(`${upload.key}.part${partNumber.toString().padStart(5, '0')}`)

    await bucket.put(chunkKey, data)

    const result: ChunkResult = {
      partNumber,
      etag: `"${crypto.randomUUID()}"`,
      size: data.length,
    }

    upload.parts.push(result)
    upload.parts.sort((a, b) => a.partNumber - b.partNumber)

    return result
  }

  /**
   * Complete chunked upload
   */
  async function completeChunkedUpload(upload: ChunkedUpload): Promise<UploadResult> {
    if (!activeUploads.has(upload.uploadId)) {
      throw new Error('Upload not found or expired')
    }

    if (upload.parts.length === 0) {
      throw new Error('Cannot complete upload with no parts')
    }

    // Combine all parts
    const partKeys = upload.parts.map(
      p => buildKey(`${upload.key}.part${p.partNumber.toString().padStart(5, '0')}`)
    )

    // Read and combine all parts
    const chunks: Uint8Array[] = []
    let totalSize = 0

    for (const partKey of partKeys) {
      const object = await bucket.get(partKey)
      if (!object) {
        throw new Error(`Part not found: ${partKey}`)
      }
      const chunk = new Uint8Array(await object.arrayBuffer())
      chunks.push(chunk)
      totalSize += chunk.length
    }

    // Combine into final buffer
    const combined = new Uint8Array(totalSize)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    // Write combined file
    const finalKey = buildKey(upload.key)
    const httpMetadata = {
      contentType: upload.contentType,
      ...(upload.metadata ? { customMetadata: upload.metadata } : {}),
    }

    const result = await bucket.put(finalKey, combined, { httpMetadata })

    // Clean up part files
    for (const partKey of partKeys) {
      await bucket.delete(partKey)
    }

    // Remove from active uploads
    activeUploads.delete(upload.uploadId)

    // Extract metadata
    const metadata = extractMetadata(combined, upload.key)

    return {
      key: upload.key,
      size: totalSize,
      contentType: upload.contentType,
      etag: result?.etag || '',
      uploadId: upload.uploadId,
      metadata,
    }
  }

  /**
   * Abort chunked upload
   */
  async function abortChunkedUpload(upload: ChunkedUpload): Promise<void> {
    if (!activeUploads.has(upload.uploadId)) {
      throw new Error('Upload not found or expired')
    }

    // Delete any uploaded parts
    for (const part of upload.parts) {
      const partKey = buildKey(`${upload.key}.part${part.partNumber.toString().padStart(5, '0')}`)
      try {
        await bucket.delete(partKey)
      } catch {
        // Ignore errors during cleanup
      }
    }

    activeUploads.delete(upload.uploadId)
  }

  /**
   * Download file
   */
  async function download(key: string, options?: DownloadOptions): Promise<Response> {
    const fullKey = buildKey(key)
    const deliveryOptions: any = {}

    if (options?.range) {
      deliveryOptions.range = `bytes=${options.range.start}-${options.range.end ?? ''}`
    }

    if (options?.disposition) {
      const filename = options.filename || key.split('/').pop() || 'download'
      deliveryOptions.disposition = `${options.disposition}; filename="${filename}"`
    }

    return cdnDelivery.deliver(fullKey, deliveryOptions)
  }

  /**
   * Create download URL
   */
  async function createDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    if (!urlGenerator) {
      throw new Error('Presigned URLs require accessKeyId and secretAccessKey')
    }

    const result = await urlGenerator.generateDownloadUrl({
      key,
      expiresIn,
    })

    return result.url
  }

  /**
   * Transform media
   */
  async function transform(data: Uint8Array, options: TransformOptions): Promise<TransformResult> {
    return imageTransformer.transform(data, options)
  }

  /**
   * Transform and store
   */
  async function transformAndStore(
    key: string,
    options: TransformOptions & { outputKey: string }
  ): Promise<UploadResult> {
    const fullKey = buildKey(key)
    const object = await bucket.get(fullKey)

    if (!object) {
      throw new Error(`Source file not found: ${key}`)
    }

    const sourceData = new Uint8Array(await object.arrayBuffer())
    const transformed = await imageTransformer.transform(sourceData, options)

    return upload(transformed.data, {
      key: options.outputKey,
      contentType: `image/${transformed.format}`,
    })
  }

  /**
   * Get metadata for stored file
   */
  async function getMetadata(key: string): Promise<MediaMetadata> {
    const fullKey = buildKey(key)
    const object = await bucket.get(fullKey)

    if (!object) {
      throw new Error(`File not found: ${key}`)
    }

    const data = new Uint8Array(await object.arrayBuffer())
    const metadata = extractMetadata(data, key)

    metadata.uploadedAt = object.uploaded
    metadata.hash = object.etag

    return metadata
  }

  /**
   * Extract metadata from buffer
   */
  async function extractMetadataAsync(data: Uint8Array, mimeType?: string): Promise<MediaMetadata> {
    const metadata = extractMetadata(data)
    if (mimeType) {
      metadata.mimeType = mimeType
      metadata.type = getMediaTypeFromMime(mimeType)
    }
    return metadata
  }

  /**
   * Deliver CDN request
   */
  async function deliver(request: Request): Promise<Response> {
    return cdnDelivery.handleRequest(request)
  }

  /**
   * Invalidate cache (no-op for R2, would use Cache API in production)
   */
  async function invalidateCache(_keys: string[]): Promise<void> {
    // In production, this would use the Cache API to purge cached responses
    // For R2 with Workers, this is typically handled by cache headers
  }

  /**
   * Check if file exists
   */
  async function exists(key: string): Promise<boolean> {
    const fullKey = buildKey(key)
    const head = await bucket.head(fullKey)
    return head !== null
  }

  /**
   * Delete file
   */
  async function deleteFile(key: string): Promise<void> {
    const fullKey = buildKey(key)
    await bucket.delete(fullKey)
  }

  /**
   * Copy file
   */
  async function copy(sourceKey: string, destKey: string): Promise<void> {
    const fullSourceKey = buildKey(sourceKey)
    const fullDestKey = buildKey(destKey)

    const object = await bucket.get(fullSourceKey)
    if (!object) {
      throw new Error(`Source file not found: ${sourceKey}`)
    }

    const data = await object.arrayBuffer()
    await bucket.put(fullDestKey, data, {
      httpMetadata: object.httpMetadata,
    })
  }

  /**
   * List files
   */
  async function list(
    prefix?: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<ListResult> {
    const fullPrefix = prefix ? buildKey(prefix) : pathPrefix || undefined

    const listResult = await bucket.list({
      prefix: fullPrefix,
      limit: options?.limit,
      cursor: options?.cursor,
    })

    return {
      objects: listResult.objects.map(obj => ({
        key: obj.key.replace(pathPrefix, ''),
        size: obj.size,
        uploaded: obj.uploaded,
        etag: obj.etag,
        httpMetadata: obj.httpMetadata,
      })),
      truncated: listResult.truncated,
      cursor: listResult.truncated ? listResult.cursor : undefined,
    }
  }

  return {
    upload,
    createUploadUrl,
    initChunkedUpload,
    uploadChunk,
    completeChunkedUpload,
    abortChunkedUpload,
    download,
    createDownloadUrl,
    transform,
    transformAndStore,
    getMetadata,
    extractMetadata: extractMetadataAsync,
    deliver,
    invalidateCache,
    exists,
    delete: deleteFile,
    copy,
    list,
  }
}
