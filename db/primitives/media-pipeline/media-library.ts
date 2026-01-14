/**
 * Media Library - File organization with metadata, tags, folders, and search
 *
 * Provides comprehensive media management capabilities:
 * - **Metadata Extraction**: EXIF, dimensions, duration, format detection
 * - **Organization**: Folders, tags, collections
 * - **Search**: Full-text and metadata-based search
 * - **Indexing**: Fast lookups with SQLite-backed storage
 *
 * ## Usage
 *
 * ```typescript
 * import { createMediaLibrary } from './media-library'
 *
 * const library = createMediaLibrary({
 *   bucket: env.R2_BUCKET,
 *   db: env.DB, // D1 database
 * })
 *
 * // Add media with metadata extraction
 * const media = await library.add(imageBuffer, {
 *   filename: 'photo.jpg',
 *   folder: '/vacation/2024',
 *   tags: ['beach', 'family'],
 * })
 *
 * // Search by metadata
 * const results = await library.search({
 *   folder: '/vacation',
 *   tags: ['beach'],
 *   type: 'image',
 *   dateRange: { from: new Date('2024-01-01') },
 * })
 *
 * // Get full metadata
 * const metadata = await library.getMetadata(media.id)
 * console.log(metadata.exif?.gps) // { latitude: 34.05, longitude: -118.25 }
 * ```
 *
 * @module db/primitives/media-pipeline
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Media type categories
 */
export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'unknown'

/**
 * EXIF orientation values
 */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/**
 * GPS coordinates extracted from EXIF
 */
export interface GpsCoordinates {
  latitude: number
  longitude: number
  altitude?: number
  altitudeRef?: 'above' | 'below'
  datestamp?: string
  timestamp?: string
}

/**
 * Camera exposure settings from EXIF
 */
export interface ExposureSettings {
  time?: string
  fNumber?: number
  iso?: number
  mode?: string
  program?: string
  bias?: number
  maxAperture?: number
  meteringMode?: string
  flash?: string
}

/**
 * Lens information from EXIF
 */
export interface LensInfo {
  make?: string
  model?: string
  focalLength?: number
  focalLength35mm?: number
  minFocalLength?: number
  maxFocalLength?: number
  minAperture?: number
  maxAperture?: number
}

/**
 * Full EXIF data extracted from images
 */
export interface ExifData {
  // Camera information
  make?: string
  model?: string
  software?: string
  orientation?: ExifOrientation

  // Date/time
  dateTime?: string
  dateTimeOriginal?: string
  dateTimeDigitized?: string

  // GPS
  gps?: GpsCoordinates

  // Exposure
  exposure?: ExposureSettings

  // Lens
  lens?: LensInfo

  // Image details
  xResolution?: number
  yResolution?: number
  resolutionUnit?: 'inches' | 'centimeters'
  colorSpace?: string
  whiteBalance?: string

  // Copyright
  copyright?: string
  artist?: string

  // Additional fields (passthrough)
  [key: string]: unknown
}

/**
 * Image-specific metadata
 */
export interface ImageMetadata {
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
 * Video-specific metadata
 */
export interface VideoMetadata {
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
 * Audio-specific metadata
 */
export interface AudioMetadata {
  duration: number
  format: string
  codec?: string
  sampleRate?: number
  channels?: number
  bitrate?: number
  title?: string
  artist?: string
  album?: string
  year?: number
  genre?: string
}

/**
 * Document-specific metadata
 */
export interface DocumentMetadata {
  format: string
  pageCount?: number
  title?: string
  author?: string
  subject?: string
  keywords?: string[]
  createdAt?: Date
  modifiedAt?: Date
}

/**
 * Complete media metadata
 */
export interface MediaMetadata {
  /** Unique identifier */
  id: string
  /** Storage key/path */
  key: string
  /** Original filename */
  filename: string
  /** File size in bytes */
  size: number
  /** MIME type */
  mimeType: string
  /** Detected media type */
  type: MediaType
  /** File extension */
  extension: string
  /** Content hash (SHA-256) */
  hash: string
  /** Upload timestamp */
  uploadedAt: Date
  /** Last modified timestamp */
  modifiedAt?: Date

  // Organization
  /** Folder path */
  folder: string
  /** Tags */
  tags: string[]
  /** User-defined title */
  title?: string
  /** Description */
  description?: string
  /** Is starred/favorite */
  starred: boolean
  /** Is in trash */
  trashed: boolean
  /** Trash timestamp */
  trashedAt?: Date

  // Type-specific metadata
  image?: ImageMetadata
  video?: VideoMetadata
  audio?: AudioMetadata
  document?: DocumentMetadata

  // Custom metadata
  custom?: Record<string, unknown>
}

/**
 * Options for adding media
 */
export interface AddMediaOptions {
  /** Filename (auto-detected if not provided) */
  filename?: string
  /** Content type (auto-detected if not provided) */
  contentType?: string
  /** Target folder path */
  folder?: string
  /** Tags to apply */
  tags?: string[]
  /** Title */
  title?: string
  /** Description */
  description?: string
  /** Custom metadata */
  custom?: Record<string, unknown>
  /** Skip metadata extraction */
  skipMetadata?: boolean
  /** Override existing file with same key */
  overwrite?: boolean
}

/**
 * Search query options
 */
export interface SearchOptions {
  /** Full-text search query */
  query?: string
  /** Filter by folder (supports wildcards) */
  folder?: string
  /** Filter by tags (AND logic) */
  tags?: string[]
  /** Filter by any of these tags (OR logic) */
  anyTags?: string[]
  /** Filter by media type */
  type?: MediaType
  /** Filter by MIME type */
  mimeType?: string
  /** Filter by date range */
  dateRange?: {
    from?: Date
    to?: Date
  }
  /** Filter by file size range (bytes) */
  sizeRange?: {
    min?: number
    max?: number
  }
  /** Filter starred items only */
  starred?: boolean
  /** Include trashed items */
  includeTrashed?: boolean
  /** Sort by field */
  sortBy?: 'uploadedAt' | 'modifiedAt' | 'filename' | 'size'
  /** Sort direction */
  sortOrder?: 'asc' | 'desc'
  /** Maximum results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

/**
 * Search result
 */
export interface SearchResult {
  items: MediaMetadata[]
  total: number
  hasMore: boolean
}

/**
 * Folder information
 */
export interface FolderInfo {
  path: string
  name: string
  itemCount: number
  totalSize: number
  children: FolderInfo[]
}

/**
 * Tag information
 */
export interface TagInfo {
  name: string
  count: number
}

/**
 * Media library configuration
 */
export interface MediaLibraryConfig {
  /** R2 bucket for storage */
  bucket: R2Bucket
  /** Optional path prefix for all keys */
  pathPrefix?: string
  /** Maximum file size allowed (default: 5GB) */
  maxFileSize?: number
  /** Allowed MIME types (default: all) */
  allowedMimeTypes?: string[]
  /** Extract EXIF data (default: true) */
  extractExif?: boolean
  /** Generate thumbnails (default: true) */
  generateThumbnails?: boolean
}

/**
 * Media library interface
 */
export interface MediaLibrary {
  // Core operations
  add(data: Uint8Array, options?: AddMediaOptions): Promise<MediaMetadata>
  get(id: string): Promise<MediaMetadata | null>
  getByKey(key: string): Promise<MediaMetadata | null>
  update(id: string, updates: Partial<Pick<MediaMetadata, 'title' | 'description' | 'folder' | 'tags' | 'custom' | 'starred'>>): Promise<MediaMetadata>
  delete(id: string, permanent?: boolean): Promise<void>
  restore(id: string): Promise<MediaMetadata>

  // Content access
  getContent(id: string): Promise<Uint8Array>
  getContentStream(id: string): Promise<ReadableStream<Uint8Array>>
  getUrl(id: string, options?: { expiresIn?: number; disposition?: 'inline' | 'attachment' }): Promise<string>

  // Metadata
  getMetadata(id: string): Promise<MediaMetadata>
  extractMetadata(data: Uint8Array, filename?: string): Promise<Partial<MediaMetadata>>

  // Organization
  move(id: string, newFolder: string): Promise<MediaMetadata>
  copy(id: string, newFolder: string, newFilename?: string): Promise<MediaMetadata>
  addTags(id: string, tags: string[]): Promise<MediaMetadata>
  removeTags(id: string, tags: string[]): Promise<MediaMetadata>

  // Search and browse
  search(options?: SearchOptions): Promise<SearchResult>
  listFolder(folder: string): Promise<MediaMetadata[]>
  getFolders(parent?: string): Promise<FolderInfo[]>
  getTags(): Promise<TagInfo[]>

  // Bulk operations
  bulkDelete(ids: string[], permanent?: boolean): Promise<void>
  bulkMove(ids: string[], newFolder: string): Promise<void>
  bulkAddTags(ids: string[], tags: string[]): Promise<void>
  bulkRemoveTags(ids: string[], tags: string[]): Promise<void>

  // Trash management
  listTrash(): Promise<MediaMetadata[]>
  emptyTrash(): Promise<void>
}

// =============================================================================
// MIME Type Detection
// =============================================================================

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
  'audio/aac': 'audio',
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
 * Extension to MIME type mapping
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
  aac: 'audio/aac',
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

/**
 * Get MIME type from file extension
 */
export function getMimeTypeFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return EXT_TO_MIME[ext] || 'application/octet-stream'
}

/**
 * Get media type from MIME type
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

  // WebP (RIFF....WEBP)
  if (
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) {
    return 'image/webp'
  }

  // AVIF/MP4 (ftyp box)
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
    const brand = String.fromCharCode(data[8], data[9], data[10], data[11])
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (brand === 'isom' || brand === 'mp41' || brand === 'mp42' || brand === 'M4V ') {
      return 'video/mp4'
    }
    if (brand === 'qt  ') return 'video/quicktime'
  }

  // WebM/MKV
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return 'video/webm'
  }

  // MP3 (ID3 or frame sync)
  if (
    (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) ||
    (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)
  ) {
    return 'audio/mpeg'
  }

  // WAV (RIFF....WAVE)
  if (
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x41 && data[10] === 0x56 && data[11] === 0x45
  ) {
    return 'audio/wav'
  }

  // FLAC
  if (data[0] === 0x66 && data[1] === 0x4c && data[2] === 0x61 && data[3] === 0x43) {
    return 'audio/flac'
  }

  // OGG
  if (data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) {
    return 'audio/ogg'
  }

  // PDF
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return 'application/pdf'
  }

  // ZIP (and DOCX, XLSX, etc.)
  if (data[0] === 0x50 && data[1] === 0x4b && (data[2] === 0x03 || data[2] === 0x05)) {
    return 'application/zip'
  }

  // GZIP
  if (data[0] === 0x1f && data[1] === 0x8b) {
    return 'application/gzip'
  }

  // TIFF (little-endian or big-endian)
  if (
    (data[0] === 0x49 && data[1] === 0x49 && data[2] === 0x2a && data[3] === 0x00) ||
    (data[0] === 0x4d && data[1] === 0x4d && data[2] === 0x00 && data[3] === 0x2a)
  ) {
    return 'image/tiff'
  }

  // BMP
  if (data[0] === 0x42 && data[1] === 0x4d) {
    return 'image/bmp'
  }

  return null
}

// =============================================================================
// EXIF Extraction
// =============================================================================

/**
 * EXIF tag IDs for common fields
 */
const EXIF_TAGS: Record<number, string> = {
  // IFD0 (main image)
  0x010f: 'make',
  0x0110: 'model',
  0x0112: 'orientation',
  0x011a: 'xResolution',
  0x011b: 'yResolution',
  0x0128: 'resolutionUnit',
  0x0131: 'software',
  0x0132: 'dateTime',
  0x8298: 'copyright',
  0x8769: 'exifOffset',
  0x8825: 'gpsOffset',

  // EXIF SubIFD
  0x829a: 'exposureTime',
  0x829d: 'fNumber',
  0x8822: 'exposureProgram',
  0x8827: 'iso',
  0x9000: 'exifVersion',
  0x9003: 'dateTimeOriginal',
  0x9004: 'dateTimeDigitized',
  0x9201: 'shutterSpeed',
  0x9202: 'aperture',
  0x9203: 'brightnessValue',
  0x9204: 'exposureBias',
  0x9205: 'maxAperture',
  0x9207: 'meteringMode',
  0x9209: 'flash',
  0x920a: 'focalLength',
  0xa001: 'colorSpace',
  0xa002: 'pixelXDimension',
  0xa003: 'pixelYDimension',
  0xa20e: 'focalPlaneXResolution',
  0xa20f: 'focalPlaneYResolution',
  0xa405: 'focalLengthIn35mm',
  0xa406: 'sceneCaptureType',
  0xa431: 'serialNumber',
  0xa432: 'lensInfo',
  0xa433: 'lensMake',
  0xa434: 'lensModel',

  // GPS IFD
  0x0000: 'gpsVersionID',
  0x0001: 'gpsLatitudeRef',
  0x0002: 'gpsLatitude',
  0x0003: 'gpsLongitudeRef',
  0x0004: 'gpsLongitude',
  0x0005: 'gpsAltitudeRef',
  0x0006: 'gpsAltitude',
  0x0007: 'gpsTimeStamp',
  0x001d: 'gpsDateStamp',
}

/**
 * Read a 16-bit unsigned integer from buffer
 */
function readUint16(data: Uint8Array, offset: number, littleEndian: boolean): number {
  if (littleEndian) {
    return data[offset] | (data[offset + 1] << 8)
  }
  return (data[offset] << 8) | data[offset + 1]
}

/**
 * Read a 32-bit unsigned integer from buffer
 */
function readUint32(data: Uint8Array, offset: number, littleEndian: boolean): number {
  if (littleEndian) {
    return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)
  }
  return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
}

/**
 * Read a rational number (two 32-bit integers)
 */
function readRational(data: Uint8Array, offset: number, littleEndian: boolean): number {
  const numerator = readUint32(data, offset, littleEndian)
  const denominator = readUint32(data, offset + 4, littleEndian)
  return denominator === 0 ? 0 : numerator / denominator
}

/**
 * Read a signed rational number
 */
function readSRational(data: Uint8Array, offset: number, littleEndian: boolean): number {
  let numerator = readUint32(data, offset, littleEndian)
  let denominator = readUint32(data, offset + 4, littleEndian)

  // Convert to signed
  if (numerator > 0x7fffffff) numerator -= 0x100000000
  if (denominator > 0x7fffffff) denominator -= 0x100000000

  return denominator === 0 ? 0 : numerator / denominator
}

/**
 * Read a string from buffer
 */
function readString(data: Uint8Array, offset: number, length: number): string {
  let str = ''
  for (let i = 0; i < length && data[offset + i] !== 0; i++) {
    str += String.fromCharCode(data[offset + i])
  }
  return str.trim()
}

/**
 * Convert GPS coordinates from degrees/minutes/seconds to decimal
 */
function gpsToDecimal(values: number[], ref: string): number {
  if (values.length < 3) return 0

  const degrees = values[0]
  const minutes = values[1]
  const seconds = values[2]

  let decimal = degrees + minutes / 60 + seconds / 3600

  if (ref === 'S' || ref === 'W') {
    decimal = -decimal
  }

  return decimal
}

/**
 * Parse an EXIF IFD (Image File Directory)
 */
function parseIFD(
  data: Uint8Array,
  tiffOffset: number,
  ifdOffset: number,
  littleEndian: boolean,
  isGps: boolean = false
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (ifdOffset + 2 > data.length) return result

  const numEntries = readUint16(data, tiffOffset + ifdOffset, littleEndian)

  for (let i = 0; i < numEntries; i++) {
    const entryOffset = tiffOffset + ifdOffset + 2 + i * 12
    if (entryOffset + 12 > data.length) break

    const tag = readUint16(data, entryOffset, littleEndian)
    const type = readUint16(data, entryOffset + 2, littleEndian)
    const count = readUint32(data, entryOffset + 4, littleEndian)
    const valueOffset = entryOffset + 8

    // Get tag name
    const tagName = isGps ? EXIF_TAGS[tag] : EXIF_TAGS[tag]
    if (!tagName) continue

    // Calculate value size
    const typeSizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }
    const typeSize = typeSizes[type] || 1
    const totalSize = count * typeSize

    // Get actual offset for values > 4 bytes
    let dataOffset: number
    if (totalSize > 4) {
      dataOffset = tiffOffset + readUint32(data, valueOffset, littleEndian)
    } else {
      dataOffset = valueOffset
    }

    if (dataOffset + totalSize > data.length) continue

    // Parse value based on type
    let value: unknown

    switch (type) {
      case 1: // BYTE
      case 7: // UNDEFINED
        if (count === 1) {
          value = data[dataOffset]
        } else {
          value = Array.from(data.slice(dataOffset, dataOffset + count))
        }
        break

      case 2: // ASCII
        value = readString(data, dataOffset, count)
        break

      case 3: // SHORT
        if (count === 1) {
          value = readUint16(data, dataOffset, littleEndian)
        } else {
          const arr: number[] = []
          for (let j = 0; j < count; j++) {
            arr.push(readUint16(data, dataOffset + j * 2, littleEndian))
          }
          value = arr
        }
        break

      case 4: // LONG
        if (count === 1) {
          value = readUint32(data, dataOffset, littleEndian)
        } else {
          const arr: number[] = []
          for (let j = 0; j < count; j++) {
            arr.push(readUint32(data, dataOffset + j * 4, littleEndian))
          }
          value = arr
        }
        break

      case 5: // RATIONAL
        if (count === 1) {
          value = readRational(data, dataOffset, littleEndian)
        } else {
          const arr: number[] = []
          for (let j = 0; j < count; j++) {
            arr.push(readRational(data, dataOffset + j * 8, littleEndian))
          }
          value = arr
        }
        break

      case 9: // SLONG
        if (count === 1) {
          let v = readUint32(data, dataOffset, littleEndian)
          if (v > 0x7fffffff) v -= 0x100000000
          value = v
        }
        break

      case 10: // SRATIONAL
        if (count === 1) {
          value = readSRational(data, dataOffset, littleEndian)
        } else {
          const arr: number[] = []
          for (let j = 0; j < count; j++) {
            arr.push(readSRational(data, dataOffset + j * 8, littleEndian))
          }
          value = arr
        }
        break
    }

    if (value !== undefined) {
      result[tagName] = value
    }
  }

  return result
}

/**
 * Extract EXIF data from JPEG image
 */
export function extractExifFromJpeg(data: Uint8Array): ExifData | null {
  // Verify JPEG header
  if (data[0] !== 0xff || data[1] !== 0xd8) {
    return null
  }

  // Find APP1 marker (EXIF)
  let offset = 2
  while (offset < data.length - 2) {
    if (data[offset] !== 0xff) {
      offset++
      continue
    }

    const marker = data[offset + 1]

    // APP1 marker
    if (marker === 0xe1) {
      const length = (data[offset + 2] << 8) | data[offset + 3]

      // Check for EXIF header
      const exifHeader = String.fromCharCode(
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7]
      )

      if (exifHeader === 'Exif') {
        const tiffOffset = offset + 10 // Skip APP1 marker, length, "Exif\0\0"
        return parseExifFromTiff(data, tiffOffset)
      }
    }

    // Skip to next marker
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2
    } else if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2
    } else {
      const markerLength = (data[offset + 2] << 8) | data[offset + 3]
      offset += 2 + markerLength
    }
  }

  return null
}

/**
 * Parse EXIF from TIFF structure
 */
function parseExifFromTiff(data: Uint8Array, tiffOffset: number): ExifData | null {
  if (tiffOffset + 8 > data.length) return null

  // Check byte order
  const byteOrder = (data[tiffOffset] << 8) | data[tiffOffset + 1]
  const littleEndian = byteOrder === 0x4949 // 'II' = little-endian

  // Verify TIFF magic number
  const magic = readUint16(data, tiffOffset + 2, littleEndian)
  if (magic !== 0x002a) return null

  // Get IFD0 offset
  const ifd0Offset = readUint32(data, tiffOffset + 4, littleEndian)

  // Parse IFD0
  const ifd0 = parseIFD(data, tiffOffset, ifd0Offset, littleEndian)

  const exif: ExifData = {}

  // Extract main fields from IFD0
  if (ifd0.make) exif.make = String(ifd0.make)
  if (ifd0.model) exif.model = String(ifd0.model)
  if (ifd0.software) exif.software = String(ifd0.software)
  if (ifd0.orientation) exif.orientation = Number(ifd0.orientation) as ExifOrientation
  if (ifd0.dateTime) exif.dateTime = String(ifd0.dateTime)
  if (ifd0.copyright) exif.copyright = String(ifd0.copyright)
  if (ifd0.xResolution) exif.xResolution = Number(ifd0.xResolution)
  if (ifd0.yResolution) exif.yResolution = Number(ifd0.yResolution)
  if (ifd0.resolutionUnit) {
    exif.resolutionUnit = Number(ifd0.resolutionUnit) === 2 ? 'inches' : 'centimeters'
  }

  // Parse EXIF SubIFD if present
  if (ifd0.exifOffset) {
    const exifSubIFD = parseIFD(data, tiffOffset, Number(ifd0.exifOffset), littleEndian)

    if (exifSubIFD.dateTimeOriginal) exif.dateTimeOriginal = String(exifSubIFD.dateTimeOriginal)
    if (exifSubIFD.dateTimeDigitized) exif.dateTimeDigitized = String(exifSubIFD.dateTimeDigitized)

    // Exposure settings
    const exposure: ExposureSettings = {}
    if (exifSubIFD.exposureTime) {
      const et = Number(exifSubIFD.exposureTime)
      exposure.time = et < 1 ? `1/${Math.round(1 / et)}` : `${et}`
    }
    if (exifSubIFD.fNumber) exposure.fNumber = Number(exifSubIFD.fNumber)
    if (exifSubIFD.iso) exposure.iso = Number(exifSubIFD.iso)
    if (exifSubIFD.exposureBias) exposure.bias = Number(exifSubIFD.exposureBias)
    if (exifSubIFD.maxAperture) exposure.maxAperture = Number(exifSubIFD.maxAperture)

    if (exifSubIFD.meteringMode) {
      const meteringModes: Record<number, string> = {
        0: 'Unknown', 1: 'Average', 2: 'Center-weighted', 3: 'Spot',
        4: 'Multi-spot', 5: 'Pattern', 6: 'Partial', 255: 'Other'
      }
      exposure.meteringMode = meteringModes[Number(exifSubIFD.meteringMode)] || 'Unknown'
    }

    if (exifSubIFD.flash !== undefined) {
      const flashValue = Number(exifSubIFD.flash)
      const fired = (flashValue & 0x01) !== 0
      exposure.flash = fired ? 'Fired' : 'Did not fire'
    }

    if (Object.keys(exposure).length > 0) {
      exif.exposure = exposure
    }

    // Lens info
    const lens: LensInfo = {}
    if (exifSubIFD.focalLength) lens.focalLength = Number(exifSubIFD.focalLength)
    if (exifSubIFD.focalLengthIn35mm) lens.focalLength35mm = Number(exifSubIFD.focalLengthIn35mm)
    if (exifSubIFD.lensMake) lens.make = String(exifSubIFD.lensMake)
    if (exifSubIFD.lensModel) lens.model = String(exifSubIFD.lensModel)

    if (exifSubIFD.lensInfo && Array.isArray(exifSubIFD.lensInfo)) {
      const lensInfoArr = exifSubIFD.lensInfo as number[]
      if (lensInfoArr.length >= 4) {
        lens.minFocalLength = lensInfoArr[0]
        lens.maxFocalLength = lensInfoArr[1]
        lens.maxAperture = lensInfoArr[2]
        lens.minAperture = lensInfoArr[3]
      }
    }

    if (Object.keys(lens).length > 0) {
      exif.lens = lens
    }

    // Color space
    if (exifSubIFD.colorSpace) {
      exif.colorSpace = Number(exifSubIFD.colorSpace) === 1 ? 'sRGB' : 'Uncalibrated'
    }
  }

  // Parse GPS IFD if present
  if (ifd0.gpsOffset) {
    const gpsIFD = parseIFD(data, tiffOffset, Number(ifd0.gpsOffset), littleEndian, true)

    const gps: GpsCoordinates = {} as GpsCoordinates

    if (gpsIFD.gpsLatitude && gpsIFD.gpsLatitudeRef) {
      const latValues = gpsIFD.gpsLatitude as number[]
      gps.latitude = gpsToDecimal(latValues, String(gpsIFD.gpsLatitudeRef))
    }

    if (gpsIFD.gpsLongitude && gpsIFD.gpsLongitudeRef) {
      const lonValues = gpsIFD.gpsLongitude as number[]
      gps.longitude = gpsToDecimal(lonValues, String(gpsIFD.gpsLongitudeRef))
    }

    if (gpsIFD.gpsAltitude !== undefined) {
      gps.altitude = Number(gpsIFD.gpsAltitude)
      if (gpsIFD.gpsAltitudeRef !== undefined) {
        gps.altitudeRef = Number(gpsIFD.gpsAltitudeRef) === 0 ? 'above' : 'below'
      }
    }

    if (gpsIFD.gpsDateStamp) {
      gps.datestamp = String(gpsIFD.gpsDateStamp)
    }

    if (gpsIFD.gpsTimeStamp && Array.isArray(gpsIFD.gpsTimeStamp)) {
      const ts = gpsIFD.gpsTimeStamp as number[]
      if (ts.length >= 3) {
        gps.timestamp = `${Math.floor(ts[0]).toString().padStart(2, '0')}:${Math.floor(ts[1]).toString().padStart(2, '0')}:${Math.floor(ts[2]).toString().padStart(2, '0')}`
      }
    }

    if (gps.latitude !== undefined && gps.longitude !== undefined) {
      exif.gps = gps
    }
  }

  return Object.keys(exif).length > 0 ? exif : null
}

/**
 * Extract EXIF data from TIFF image
 */
export function extractExifFromTiff(data: Uint8Array): ExifData | null {
  // TIFF starts directly with the TIFF header
  return parseExifFromTiff(data, 0)
}

// =============================================================================
// Image Dimension Parsing
// =============================================================================

/**
 * Parse PNG dimensions
 */
function parsePngDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 24) return null
  if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
    return null
  }

  const width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19]
  const height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23]

  return { width, height }
}

/**
 * Parse JPEG dimensions
 */
function parseJpegDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 4) return null
  if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) {
    return null
  }

  let i = 2
  while (i < data.length - 9) {
    if (data[i] !== 0xff) {
      i++
      continue
    }

    const marker = data[i + 1]

    // SOF0-SOF2 markers
    if (marker >= 0xc0 && marker <= 0xc2) {
      const height = (data[i + 5] << 8) | data[i + 6]
      const width = (data[i + 7] << 8) | data[i + 8]
      return { width, height }
    }

    // Skip marker
    if (marker !== 0xff && marker !== 0x00 && marker !== 0xd8 && marker !== 0xd9) {
      const length = (data[i + 2] << 8) | data[i + 3]
      i += 2 + length
    } else {
      i += 2
    }
  }

  return null
}

/**
 * Parse GIF dimensions
 */
function parseGifDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 10) return null
  if (data[0] !== 0x47 || data[1] !== 0x49 || data[2] !== 0x46) {
    return null
  }

  const width = data[6] | (data[7] << 8)
  const height = data[8] | (data[9] << 8)

  return { width, height }
}

/**
 * Parse WebP dimensions
 */
function parseWebpDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 30) return null
  if (
    data[0] !== 0x52 || data[1] !== 0x49 || data[2] !== 0x46 || data[3] !== 0x46 ||
    data[8] !== 0x57 || data[9] !== 0x45 || data[10] !== 0x42 || data[11] !== 0x50
  ) {
    return null
  }

  const chunkType = String.fromCharCode(data[12], data[13], data[14], data[15])

  if (chunkType === 'VP8 ') {
    const width = ((data[26] | (data[27] << 8)) & 0x3fff)
    const height = ((data[28] | (data[29] << 8)) & 0x3fff)
    return { width, height }
  }

  if (chunkType === 'VP8L') {
    const bits = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return { width, height }
  }

  if (chunkType === 'VP8X') {
    const width = ((data[24] | (data[25] << 8) | (data[26] << 16)) & 0xffffff) + 1
    const height = ((data[27] | (data[28] << 8) | (data[29] << 16)) & 0xffffff) + 1
    return { width, height }
  }

  return null
}

/**
 * Parse BMP dimensions
 */
function parseBmpDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 26) return null
  if (data[0] !== 0x42 || data[1] !== 0x4d) {
    return null
  }

  // Width at offset 18, height at offset 22 (little-endian 32-bit)
  const width = data[18] | (data[19] << 8) | (data[20] << 16) | (data[21] << 24)
  let height = data[22] | (data[23] << 8) | (data[24] << 16) | (data[25] << 24)

  // Height can be negative (top-down bitmap)
  if (height > 0x7fffffff) {
    height = -(height - 0x100000000)
  }
  height = Math.abs(height)

  return { width, height }
}

/**
 * Extract image dimensions
 */
export function extractImageDimensions(data: Uint8Array): { width: number; height: number } | null {
  let dims = parsePngDimensions(data)
  if (dims) return dims

  dims = parseJpegDimensions(data)
  if (dims) return dims

  dims = parseGifDimensions(data)
  if (dims) return dims

  dims = parseWebpDimensions(data)
  if (dims) return dims

  dims = parseBmpDimensions(data)
  if (dims) return dims

  return null
}

/**
 * Check if PNG has alpha channel
 */
function pngHasAlpha(data: Uint8Array): boolean {
  if (data.length < 26) return false
  if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
    return false
  }
  const colorType = data[25]
  return colorType === 4 || colorType === 6
}

/**
 * Check if WebP has alpha channel
 */
function webpHasAlpha(data: Uint8Array): boolean {
  if (data.length < 21) return false
  if (
    data[0] !== 0x52 || data[1] !== 0x49 || data[2] !== 0x46 || data[3] !== 0x46 ||
    data[8] !== 0x57 || data[9] !== 0x45 || data[10] !== 0x42 || data[11] !== 0x50
  ) {
    return false
  }

  const chunkType = String.fromCharCode(data[12], data[13], data[14], data[15])

  if (chunkType === 'VP8X') {
    return (data[20] & 0x10) !== 0
  }

  // VP8L always has alpha potential
  if (chunkType === 'VP8L') {
    return true
  }

  return false
}

/**
 * Check if image has alpha channel
 */
export function imageHasAlpha(data: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') return pngHasAlpha(data)
  if (mimeType === 'image/webp') return webpHasAlpha(data)
  if (mimeType === 'image/gif') return true // GIF always supports transparency
  return false
}

// =============================================================================
// Metadata Extraction
// =============================================================================

/**
 * Extract comprehensive metadata from image data
 */
export function extractImageMetadata(data: Uint8Array, mimeType: string): ImageMetadata | null {
  const dims = extractImageDimensions(data)
  if (!dims) return null

  const format = mimeType.split('/')[1] || 'unknown'
  const hasAlpha = imageHasAlpha(data, mimeType)

  const metadata: ImageMetadata = {
    width: dims.width,
    height: dims.height,
    format,
    hasAlpha,
  }

  // Extract EXIF for JPEG
  if (mimeType === 'image/jpeg') {
    const exif = extractExifFromJpeg(data)
    if (exif) {
      metadata.exif = exif
    }
  }

  // Extract EXIF for TIFF
  if (mimeType === 'image/tiff') {
    const exif = extractExifFromTiff(data)
    if (exif) {
      metadata.exif = exif
    }
  }

  // Check for animation in GIF
  if (mimeType === 'image/gif') {
    let frameCount = 0
    for (let i = 10; i < data.length - 1; i++) {
      if (data[i] === 0x21 && data[i + 1] === 0xf9) {
        frameCount++
      }
    }
    metadata.isAnimated = frameCount > 1
    metadata.frameCount = Math.max(1, frameCount)
  }

  // Check for animation in WebP
  if (mimeType === 'image/webp' && data.length > 20) {
    const chunkType = String.fromCharCode(data[12], data[13], data[14], data[15])
    if (chunkType === 'VP8X') {
      metadata.isAnimated = (data[20] & 0x02) !== 0
    }
  }

  return metadata
}

/**
 * Generate SHA-256 hash of data
 */
async function sha256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a unique ID for media
 */
function generateMediaId(): string {
  const timestamp = Date.now().toString(36)
  const random = crypto.randomUUID().split('-')[0]
  return `${timestamp}-${random}`
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Creates a MediaLibrary instance
 *
 * @param config - Library configuration
 * @returns MediaLibrary instance
 */
export function createMediaLibrary(config: MediaLibraryConfig): MediaLibrary {
  const {
    bucket,
    pathPrefix = '',
    maxFileSize = 5 * 1024 * 1024 * 1024, // 5GB
    allowedMimeTypes,
    extractExif = true,
  } = config

  // In-memory index (in production, use D1/SQLite)
  const mediaIndex = new Map<string, MediaMetadata>()
  const keyIndex = new Map<string, string>() // key -> id

  /**
   * Build storage key with prefix
   */
  function buildKey(path: string): string {
    return pathPrefix ? `${pathPrefix}${path}` : path
  }

  /**
   * Extract full metadata from data
   */
  async function extractFullMetadata(
    data: Uint8Array,
    filename?: string
  ): Promise<Partial<MediaMetadata>> {
    // Detect MIME type
    let mimeType = detectMimeType(data)
    if (!mimeType && filename) {
      mimeType = getMimeTypeFromExtension(filename)
    }
    mimeType = mimeType || 'application/octet-stream'

    const mediaType = getMediaTypeFromMime(mimeType)
    const extension = filename?.split('.').pop()?.toLowerCase() || ''

    const metadata: Partial<MediaMetadata> = {
      size: data.length,
      mimeType,
      type: mediaType,
      extension,
    }

    // Extract type-specific metadata
    if (mediaType === 'image') {
      const imageMetadata = extractImageMetadata(data, mimeType)
      if (imageMetadata) {
        metadata.image = imageMetadata
      }
    }

    // Hash content
    metadata.hash = await sha256(data)

    return metadata
  }

  /**
   * Add media to library
   */
  async function add(data: Uint8Array, options?: AddMediaOptions): Promise<MediaMetadata> {
    // Validate size
    if (data.length > maxFileSize) {
      throw new Error(`File size ${data.length} exceeds maximum ${maxFileSize}`)
    }

    // Extract metadata
    const extracted = options?.skipMetadata
      ? {}
      : await extractFullMetadata(data, options?.filename)

    // Validate MIME type
    if (allowedMimeTypes && extracted.mimeType) {
      if (!allowedMimeTypes.includes(extracted.mimeType)) {
        throw new Error(`MIME type ${extracted.mimeType} not allowed`)
      }
    }

    const id = generateMediaId()
    const filename = options?.filename || `${id}.${extracted.extension || 'bin'}`
    const folder = options?.folder || '/'
    const key = `${folder}/${filename}`.replace(/\/+/g, '/').replace(/^\//, '')

    // Check for duplicates
    if (!options?.overwrite && keyIndex.has(key)) {
      throw new Error(`File already exists: ${key}`)
    }

    // Build full metadata
    const now = new Date()
    const metadata: MediaMetadata = {
      id,
      key,
      filename,
      size: data.length,
      mimeType: extracted.mimeType || 'application/octet-stream',
      type: extracted.type || 'unknown',
      extension: extracted.extension || '',
      hash: extracted.hash || '',
      uploadedAt: now,
      folder,
      tags: options?.tags || [],
      title: options?.title,
      description: options?.description,
      starred: false,
      trashed: false,
      image: extracted.image,
      video: extracted.video,
      audio: extracted.audio,
      document: extracted.document,
      custom: options?.custom,
    }

    // Store in R2
    const storageKey = buildKey(key)
    await bucket.put(storageKey, data, {
      httpMetadata: {
        contentType: metadata.mimeType,
      },
      customMetadata: {
        id: metadata.id,
        folder: metadata.folder,
        tags: metadata.tags.join(','),
      },
    })

    // Update index
    mediaIndex.set(id, metadata)
    keyIndex.set(key, id)

    return metadata
  }

  /**
   * Get media by ID
   */
  async function get(id: string): Promise<MediaMetadata | null> {
    return mediaIndex.get(id) || null
  }

  /**
   * Get media by key
   */
  async function getByKey(key: string): Promise<MediaMetadata | null> {
    const id = keyIndex.get(key)
    if (!id) return null
    return mediaIndex.get(id) || null
  }

  /**
   * Update media metadata
   */
  async function update(
    id: string,
    updates: Partial<Pick<MediaMetadata, 'title' | 'description' | 'folder' | 'tags' | 'custom' | 'starred'>>
  ): Promise<MediaMetadata> {
    const existing = mediaIndex.get(id)
    if (!existing) {
      throw new Error(`Media not found: ${id}`)
    }

    const updated: MediaMetadata = {
      ...existing,
      ...updates,
      modifiedAt: new Date(),
    }

    // If folder changed, we need to move the file
    if (updates.folder && updates.folder !== existing.folder) {
      const newKey = `${updates.folder}/${existing.filename}`.replace(/\/+/g, '/').replace(/^\//, '')

      // Copy to new location
      const oldStorageKey = buildKey(existing.key)
      const newStorageKey = buildKey(newKey)

      const object = await bucket.get(oldStorageKey)
      if (object) {
        const data = await object.arrayBuffer()
        await bucket.put(newStorageKey, data, {
          httpMetadata: object.httpMetadata,
          customMetadata: {
            id: updated.id,
            folder: updated.folder,
            tags: updated.tags.join(','),
          },
        })
        await bucket.delete(oldStorageKey)
      }

      // Update key index
      keyIndex.delete(existing.key)
      keyIndex.set(newKey, id)
      updated.key = newKey
    }

    mediaIndex.set(id, updated)
    return updated
  }

  /**
   * Delete media
   */
  async function deleteMedia(id: string, permanent = false): Promise<void> {
    const existing = mediaIndex.get(id)
    if (!existing) {
      throw new Error(`Media not found: ${id}`)
    }

    if (permanent) {
      // Permanently delete from R2
      const storageKey = buildKey(existing.key)
      await bucket.delete(storageKey)

      // Remove from index
      mediaIndex.delete(id)
      keyIndex.delete(existing.key)
    } else {
      // Move to trash
      const updated: MediaMetadata = {
        ...existing,
        trashed: true,
        trashedAt: new Date(),
        modifiedAt: new Date(),
      }
      mediaIndex.set(id, updated)
    }
  }

  /**
   * Restore media from trash
   */
  async function restore(id: string): Promise<MediaMetadata> {
    const existing = mediaIndex.get(id)
    if (!existing) {
      throw new Error(`Media not found: ${id}`)
    }

    if (!existing.trashed) {
      return existing
    }

    const restored: MediaMetadata = {
      ...existing,
      trashed: false,
      trashedAt: undefined,
      modifiedAt: new Date(),
    }

    mediaIndex.set(id, restored)
    return restored
  }

  /**
   * Get media content
   */
  async function getContent(id: string): Promise<Uint8Array> {
    const metadata = mediaIndex.get(id)
    if (!metadata) {
      throw new Error(`Media not found: ${id}`)
    }

    const storageKey = buildKey(metadata.key)
    const object = await bucket.get(storageKey)

    if (!object) {
      throw new Error(`File not found in storage: ${metadata.key}`)
    }

    return new Uint8Array(await object.arrayBuffer())
  }

  /**
   * Get media content as stream
   */
  async function getContentStream(id: string): Promise<ReadableStream<Uint8Array>> {
    const metadata = mediaIndex.get(id)
    if (!metadata) {
      throw new Error(`Media not found: ${id}`)
    }

    const storageKey = buildKey(metadata.key)
    const object = await bucket.get(storageKey)

    if (!object || !object.body) {
      throw new Error(`File not found in storage: ${metadata.key}`)
    }

    return object.body
  }

  /**
   * Get signed URL for media
   */
  async function getUrl(
    id: string,
    _options?: { expiresIn?: number; disposition?: 'inline' | 'attachment' }
  ): Promise<string> {
    const metadata = mediaIndex.get(id)
    if (!metadata) {
      throw new Error(`Media not found: ${id}`)
    }

    // In production, generate presigned URL
    // For now, return the storage key as a placeholder
    return buildKey(metadata.key)
  }

  /**
   * Get metadata
   */
  async function getMetadata(id: string): Promise<MediaMetadata> {
    const metadata = mediaIndex.get(id)
    if (!metadata) {
      throw new Error(`Media not found: ${id}`)
    }
    return metadata
  }

  /**
   * Move media to new folder
   */
  async function move(id: string, newFolder: string): Promise<MediaMetadata> {
    return update(id, { folder: newFolder })
  }

  /**
   * Copy media
   */
  async function copy(id: string, newFolder: string, newFilename?: string): Promise<MediaMetadata> {
    const existing = mediaIndex.get(id)
    if (!existing) {
      throw new Error(`Media not found: ${id}`)
    }

    const content = await getContent(id)

    return add(content, {
      filename: newFilename || existing.filename,
      folder: newFolder,
      tags: [...existing.tags],
      title: existing.title,
      description: existing.description,
      custom: existing.custom,
    })
  }

  /**
   * Add tags to media
   */
  async function addTags(id: string, tags: string[]): Promise<MediaMetadata> {
    const existing = mediaIndex.get(id)
    if (!existing) {
      throw new Error(`Media not found: ${id}`)
    }

    const newTags = [...new Set([...existing.tags, ...tags])]
    return update(id, { tags: newTags })
  }

  /**
   * Remove tags from media
   */
  async function removeTags(id: string, tags: string[]): Promise<MediaMetadata> {
    const existing = mediaIndex.get(id)
    if (!existing) {
      throw new Error(`Media not found: ${id}`)
    }

    const newTags = existing.tags.filter(t => !tags.includes(t))
    return update(id, { tags: newTags })
  }

  /**
   * Search media
   */
  async function search(options?: SearchOptions): Promise<SearchResult> {
    let items = Array.from(mediaIndex.values())

    // Filter by folder
    if (options?.folder) {
      const folderPattern = options.folder.replace(/\*/g, '.*')
      const regex = new RegExp(`^${folderPattern}`)
      items = items.filter(m => regex.test(m.folder))
    }

    // Filter by tags (AND)
    if (options?.tags?.length) {
      items = items.filter(m => options.tags!.every(t => m.tags.includes(t)))
    }

    // Filter by any tags (OR)
    if (options?.anyTags?.length) {
      items = items.filter(m => options.anyTags!.some(t => m.tags.includes(t)))
    }

    // Filter by type
    if (options?.type) {
      items = items.filter(m => m.type === options.type)
    }

    // Filter by MIME type
    if (options?.mimeType) {
      items = items.filter(m => m.mimeType === options.mimeType)
    }

    // Filter by date range
    if (options?.dateRange) {
      if (options.dateRange.from) {
        items = items.filter(m => m.uploadedAt >= options.dateRange!.from!)
      }
      if (options.dateRange.to) {
        items = items.filter(m => m.uploadedAt <= options.dateRange!.to!)
      }
    }

    // Filter by size range
    if (options?.sizeRange) {
      if (options.sizeRange.min !== undefined) {
        items = items.filter(m => m.size >= options.sizeRange!.min!)
      }
      if (options.sizeRange.max !== undefined) {
        items = items.filter(m => m.size <= options.sizeRange!.max!)
      }
    }

    // Filter starred
    if (options?.starred !== undefined) {
      items = items.filter(m => m.starred === options.starred)
    }

    // Filter trashed
    if (!options?.includeTrashed) {
      items = items.filter(m => !m.trashed)
    }

    // Full-text search
    if (options?.query) {
      const query = options.query.toLowerCase()
      items = items.filter(m =>
        m.filename.toLowerCase().includes(query) ||
        m.title?.toLowerCase().includes(query) ||
        m.description?.toLowerCase().includes(query) ||
        m.tags.some(t => t.toLowerCase().includes(query))
      )
    }

    // Sort
    const sortBy = options?.sortBy || 'uploadedAt'
    const sortOrder = options?.sortOrder || 'desc'
    items.sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'filename':
          comparison = a.filename.localeCompare(b.filename)
          break
        case 'size':
          comparison = a.size - b.size
          break
        case 'modifiedAt':
          comparison = (a.modifiedAt?.getTime() || 0) - (b.modifiedAt?.getTime() || 0)
          break
        case 'uploadedAt':
        default:
          comparison = a.uploadedAt.getTime() - b.uploadedAt.getTime()
      }
      return sortOrder === 'desc' ? -comparison : comparison
    })

    const total = items.length
    const offset = options?.offset || 0
    const limit = options?.limit || 50

    items = items.slice(offset, offset + limit)

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    }
  }

  /**
   * List folder contents
   */
  async function listFolder(folder: string): Promise<MediaMetadata[]> {
    const result = await search({ folder })
    return result.items
  }

  /**
   * Get folder structure
   */
  async function getFolders(parent?: string): Promise<FolderInfo[]> {
    const items = Array.from(mediaIndex.values()).filter(m => !m.trashed)
    const folderMap = new Map<string, { count: number; size: number }>()

    for (const item of items) {
      const folder = item.folder
      const existing = folderMap.get(folder) || { count: 0, size: 0 }
      existing.count++
      existing.size += item.size
      folderMap.set(folder, existing)
    }

    const folders: FolderInfo[] = []

    for (const [path, stats] of folderMap) {
      // Filter by parent if specified
      if (parent) {
        if (!path.startsWith(parent) || path === parent) continue
      }

      const parts = path.split('/').filter(Boolean)
      const name = parts[parts.length - 1] || '/'

      folders.push({
        path,
        name,
        itemCount: stats.count,
        totalSize: stats.size,
        children: [], // Would need recursive logic for nested folders
      })
    }

    return folders
  }

  /**
   * Get all tags with counts
   */
  async function getTags(): Promise<TagInfo[]> {
    const tagCounts = new Map<string, number>()

    for (const item of mediaIndex.values()) {
      if (item.trashed) continue
      for (const tag of item.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
      }
    }

    const tags: TagInfo[] = []
    for (const [name, count] of tagCounts) {
      tags.push({ name, count })
    }

    return tags.sort((a, b) => b.count - a.count)
  }

  /**
   * Bulk delete
   */
  async function bulkDelete(ids: string[], permanent = false): Promise<void> {
    for (const id of ids) {
      try {
        await deleteMedia(id, permanent)
      } catch {
        // Continue on error
      }
    }
  }

  /**
   * Bulk move
   */
  async function bulkMove(ids: string[], newFolder: string): Promise<void> {
    for (const id of ids) {
      try {
        await move(id, newFolder)
      } catch {
        // Continue on error
      }
    }
  }

  /**
   * Bulk add tags
   */
  async function bulkAddTags(ids: string[], tags: string[]): Promise<void> {
    for (const id of ids) {
      try {
        await addTags(id, tags)
      } catch {
        // Continue on error
      }
    }
  }

  /**
   * Bulk remove tags
   */
  async function bulkRemoveTags(ids: string[], tags: string[]): Promise<void> {
    for (const id of ids) {
      try {
        await removeTags(id, tags)
      } catch {
        // Continue on error
      }
    }
  }

  /**
   * List trash
   */
  async function listTrash(): Promise<MediaMetadata[]> {
    return Array.from(mediaIndex.values()).filter(m => m.trashed)
  }

  /**
   * Empty trash
   */
  async function emptyTrash(): Promise<void> {
    const trashed = await listTrash()
    for (const item of trashed) {
      await deleteMedia(item.id, true)
    }
  }

  return {
    add,
    get,
    getByKey,
    update,
    delete: deleteMedia,
    restore,
    getContent,
    getContentStream,
    getUrl,
    getMetadata,
    extractMetadata: extractFullMetadata,
    move,
    copy,
    addTags,
    removeTags,
    search,
    listFolder,
    getFolders,
    getTags,
    bulkDelete,
    bulkMove,
    bulkAddTags,
    bulkRemoveTags,
    listTrash,
    emptyTrash,
  }
}
