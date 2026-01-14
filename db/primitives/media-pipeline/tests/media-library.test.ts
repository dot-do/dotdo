/**
 * Media Library Tests
 *
 * Tests for media library with metadata extraction, organization,
 * and search capabilities.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createMediaLibrary,
  type MediaLibrary,
  type MediaMetadata,
  type ExifData,
  type GpsCoordinates,
  type ImageMetadata,
  // Utility exports
  detectMimeType,
  getMimeTypeFromExtension,
  getMediaTypeFromMime,
  extractExifFromJpeg,
  extractImageDimensions,
  extractImageMetadata,
  imageHasAlpha,
} from '../media-library'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Mock R2 bucket for testing
 */
function createMockBucket(): R2Bucket {
  const storage = new Map<string, { data: ArrayBuffer; metadata: R2Object }>()

  return {
    async put(
      key: string,
      data: ArrayBuffer | ArrayBufferView | ReadableStream | string,
      options?: R2PutOptions
    ): Promise<R2Object> {
      let buffer: ArrayBuffer
      if (data instanceof ArrayBuffer) {
        buffer = data
      } else if (ArrayBuffer.isView(data)) {
        buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      } else if (typeof data === 'string') {
        buffer = new TextEncoder().encode(data).buffer
      } else {
        // ReadableStream
        const chunks: Uint8Array[] = []
        const reader = data.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) chunks.push(value)
        }
        const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0))
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }
        buffer = combined.buffer
      }

      const obj: R2Object = {
        key,
        size: buffer.byteLength,
        etag: `"${Math.random().toString(36).slice(2)}"`,
        httpEtag: `"${Math.random().toString(36).slice(2)}"`,
        uploaded: new Date(),
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
        version: crypto.randomUUID(),
        checksums: {
          toJSON: () => ({}),
        },
        writeHttpMetadata: () => {},
        storageClass: 'Standard',
      }

      storage.set(key, { data: buffer, metadata: obj })
      return obj
    },

    async get(key: string): Promise<R2ObjectBody | null> {
      const item = storage.get(key)
      if (!item) return null

      return {
        ...item.metadata,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(item.data))
            controller.close()
          },
        }),
        bodyUsed: false,
        arrayBuffer: async () => item.data,
        text: async () => new TextDecoder().decode(item.data),
        json: async () => JSON.parse(new TextDecoder().decode(item.data)),
        blob: async () => new Blob([item.data]),
      } as R2ObjectBody
    },

    async head(key: string): Promise<R2Object | null> {
      const item = storage.get(key)
      return item?.metadata || null
    },

    async delete(key: string | string[]): Promise<void> {
      const keys = Array.isArray(key) ? key : [key]
      for (const k of keys) {
        storage.delete(k)
      }
    },

    async list(options?: R2ListOptions): Promise<R2Objects> {
      const objects: R2Object[] = []
      for (const [key, item] of storage) {
        if (options?.prefix && !key.startsWith(options.prefix)) continue
        objects.push(item.metadata)
      }

      return {
        objects: objects.slice(0, options?.limit || 1000),
        truncated: false,
        cursor: undefined,
        delimitedPrefixes: [],
      }
    },

    createMultipartUpload: async () => ({ uploadId: '', key: '' }) as unknown as R2MultipartUpload,
    resumeMultipartUpload: () => ({ uploadId: '', key: '' }) as unknown as R2MultipartUpload,
  } as R2Bucket
}

/**
 * Create a test PNG image (1x1 red pixel)
 */
function createTestPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // RGB, no alpha
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe,
    0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, // IEND chunk
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
}

/**
 * Create a test PNG with alpha channel (RGBA)
 */
function createTestPngWithAlpha(): Uint8Array {
  // PNG with RGBA (color type 6)
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk (length 13)
    0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, // 2x2 dimensions
    0x08, 0x06, 0x00, 0x00, 0x00, 0x72, 0xb6, 0x0d, // Bit depth 8, RGBA (color type 6)
    0x24, 0x00, 0x00, 0x00, 0x1d, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x78, 0x9c, 0x62, 0xf8, 0xcf, 0xc0, 0xc0,
    0xc0, 0xc0, 0xc0, 0xf0, 0x1f, 0x08, 0x00, 0x00,
    0x00, 0xff, 0xff, 0x03, 0x00, 0x09, 0x88, 0x02,
    0x01, 0x3a, 0x32, 0x95, 0x24, 0x00, 0x00, 0x00, // IEND chunk
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
    0x82,
  ])
}

/**
 * Create a minimal JPEG image
 */
function createTestJpeg(): Uint8Array {
  // Minimal valid JPEG (8x8 gray)
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, // SOI, APP0
    0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, // DQT
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c,
    0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d,
    0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
    0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34,
    0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, // SOF0: 8x8
    0x00, 0x08, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, // DHT
    0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff,
    0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04,
    0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
    0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
    0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1,
    0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a,
    0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
    0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
    0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65,
    0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85,
    0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
    0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
    0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2,
    0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba,
    0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
    0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
    0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
    0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
    0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda,
    0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0xfb, 0xd5, 0xdb, 0x20, 0xa8, 0xf1, 0xbc, 0xfd,
    0xff, 0xd9, // EOI
  ])
}

/**
 * Create a minimal GIF image
 */
function createTestGif(): Uint8Array {
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x02, 0x00, 0x02, 0x00, // 2x2 dimensions
    0x80, 0x00, 0x00, // GCT flags
    0xff, 0xff, 0xff, 0x00, 0x00, 0x00, // GCT (2 colors)
    0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, // GCE
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, // Image descriptor
    0x02, 0x02, 0x44, 0x01, 0x00, // Image data
    0x3b, // Trailer
  ])
}

/**
 * Create a minimal WebP image
 */
function createTestWebp(): Uint8Array {
  // VP8X extended WebP with 2x2 dimensions
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00, // File size (36 bytes remaining)
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x58, // VP8X
    0x0a, 0x00, 0x00, 0x00, // Chunk size
    0x00, 0x00, 0x00, 0x00, // Flags
    0x01, 0x00, 0x00, // Canvas width - 1
    0x01, 0x00, 0x00, // Canvas height - 1
    0x56, 0x50, 0x38, 0x20, // VP8 (lossy)
    0x04, 0x00, 0x00, 0x00, // Chunk size
    0x00, 0x00, 0x00, 0x00, // VP8 data (placeholder)
  ])
}

/**
 * Create a JPEG with minimal EXIF data
 */
function createJpegWithExif(): Uint8Array {
  // This is a simplified JPEG with EXIF containing camera make/model
  // The EXIF structure is:
  // - APP1 marker (0xFFE1)
  // - EXIF header
  // - TIFF header (little-endian)
  // - IFD0 with Make and Model tags

  const exifData: number[] = []

  // TIFF header (little-endian)
  exifData.push(0x49, 0x49) // 'II' (little-endian)
  exifData.push(0x2a, 0x00) // TIFF magic
  exifData.push(0x08, 0x00, 0x00, 0x00) // IFD0 offset (8)

  // IFD0 with 2 entries
  exifData.push(0x02, 0x00) // 2 entries

  // Entry 1: Make (0x010F)
  exifData.push(0x0f, 0x01) // Tag: Make
  exifData.push(0x02, 0x00) // Type: ASCII
  exifData.push(0x06, 0x00, 0x00, 0x00) // Count: 6
  exifData.push(0x32, 0x00, 0x00, 0x00) // Offset: 50

  // Entry 2: Model (0x0110)
  exifData.push(0x10, 0x01) // Tag: Model
  exifData.push(0x02, 0x00) // Type: ASCII
  exifData.push(0x08, 0x00, 0x00, 0x00) // Count: 8
  exifData.push(0x38, 0x00, 0x00, 0x00) // Offset: 56

  // Next IFD offset (0 = no more)
  exifData.push(0x00, 0x00, 0x00, 0x00)

  // Padding to reach offset 50
  while (exifData.length < 50) {
    exifData.push(0x00)
  }

  // Make value: "Canon\0"
  exifData.push(0x43, 0x61, 0x6e, 0x6f, 0x6e, 0x00)

  // Model value: "EOS 5D\0\0"
  exifData.push(0x45, 0x4f, 0x53, 0x20, 0x35, 0x44, 0x00, 0x00)

  // Build JPEG with EXIF
  const jpeg: number[] = []

  // SOI
  jpeg.push(0xff, 0xd8)

  // APP1 (EXIF)
  jpeg.push(0xff, 0xe1)
  const app1Length = 2 + 6 + exifData.length // length + "Exif\0\0" + exif data
  jpeg.push((app1Length >> 8) & 0xff, app1Length & 0xff)
  jpeg.push(0x45, 0x78, 0x69, 0x66, 0x00, 0x00) // "Exif\0\0"
  jpeg.push(...exifData)

  // SOF0 (required for dimension detection)
  jpeg.push(0xff, 0xc0)
  jpeg.push(0x00, 0x0b) // Length: 11
  jpeg.push(0x08) // Precision: 8 bits
  jpeg.push(0x00, 0x10) // Height: 16
  jpeg.push(0x00, 0x10) // Width: 16
  jpeg.push(0x01) // Components: 1
  jpeg.push(0x01, 0x11, 0x00) // Component data

  // EOI
  jpeg.push(0xff, 0xd9)

  return new Uint8Array(jpeg)
}

/**
 * Create a larger PNG for testing (100x100)
 */
function createLargePng(): Uint8Array {
  const width = 100
  const height = 100

  // Build IHDR chunk
  const ihdrData = new Uint8Array([
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    8, 2, 0, 0, 0, // Bit depth 8, RGB
  ])

  // CRC32
  function crc32(data: Uint8Array): number {
    let crc = 0xffffffff
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i]
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
      }
    }
    return crc ^ 0xffffffff
  }

  const ihdrChunk = new Uint8Array(4 + 13)
  ihdrChunk[0] = 0x49
  ihdrChunk[1] = 0x48
  ihdrChunk[2] = 0x44
  ihdrChunk[3] = 0x52
  ihdrChunk.set(ihdrData, 4)
  const ihdrCrc = crc32(ihdrChunk)

  // Minimal IDAT
  const idatData = new Uint8Array([0x08, 0xd7, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])
  const idatChunk = new Uint8Array([0x49, 0x44, 0x41, 0x54, ...idatData])
  const idatCrc = crc32(idatChunk)

  // IEND
  const iendChunk = new Uint8Array([0x49, 0x45, 0x4e, 0x44])
  const iendCrc = crc32(iendChunk)

  // Combine - calculate total size needed
  // PNG signature (8) + IHDR (4+17+4=25) + IDAT (4+14+4=22) + IEND (4+4+4=12) = 67 bytes
  const totalSize = 8 + 4 + ihdrChunk.length + 4 + 4 + idatChunk.length + 4 + 4 + iendChunk.length + 4
  const output = new Uint8Array(totalSize)
  let offset = 0

  // Signature
  output.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset)
  offset += 8

  // IHDR
  output[offset++] = 0x00
  output[offset++] = 0x00
  output[offset++] = 0x00
  output[offset++] = 0x0d
  output.set(ihdrChunk, offset)
  offset += ihdrChunk.length
  output[offset++] = (ihdrCrc >> 24) & 0xff
  output[offset++] = (ihdrCrc >> 16) & 0xff
  output[offset++] = (ihdrCrc >> 8) & 0xff
  output[offset++] = ihdrCrc & 0xff

  // IDAT
  output[offset++] = (idatData.length >> 24) & 0xff
  output[offset++] = (idatData.length >> 16) & 0xff
  output[offset++] = (idatData.length >> 8) & 0xff
  output[offset++] = idatData.length & 0xff
  output.set(idatChunk, offset)
  offset += idatChunk.length
  output[offset++] = (idatCrc >> 24) & 0xff
  output[offset++] = (idatCrc >> 16) & 0xff
  output[offset++] = (idatCrc >> 8) & 0xff
  output[offset++] = idatCrc & 0xff

  // IEND
  output[offset++] = 0x00
  output[offset++] = 0x00
  output[offset++] = 0x00
  output[offset++] = 0x00
  output.set(iendChunk, offset)
  offset += iendChunk.length
  output[offset++] = (iendCrc >> 24) & 0xff
  output[offset++] = (iendCrc >> 16) & 0xff
  output[offset++] = (iendCrc >> 8) & 0xff
  output[offset++] = iendCrc & 0xff

  return output
}

// =============================================================================
// MIME Type Detection Tests
// =============================================================================

describe('MIME Type Detection', () => {
  describe('detectMimeType', () => {
    it('should detect PNG from magic bytes', () => {
      const png = createTestPng()
      expect(detectMimeType(png)).toBe('image/png')
    })

    it('should detect JPEG from magic bytes', () => {
      const jpeg = createTestJpeg()
      expect(detectMimeType(jpeg)).toBe('image/jpeg')
    })

    it('should detect GIF from magic bytes', () => {
      const gif = createTestGif()
      expect(detectMimeType(gif)).toBe('image/gif')
    })

    it('should detect WebP from magic bytes', () => {
      const webp = createTestWebp()
      expect(detectMimeType(webp)).toBe('image/webp')
    })

    it('should return null for unknown format', () => {
      const unknown = new Uint8Array([0x00, 0x01, 0x02, 0x03])
      expect(detectMimeType(unknown)).toBeNull()
    })

    it('should return null for empty buffer', () => {
      const empty = new Uint8Array(0)
      expect(detectMimeType(empty)).toBeNull()
    })

    it('should return null for buffer too small', () => {
      const small = new Uint8Array([0x89, 0x50])
      expect(detectMimeType(small)).toBeNull()
    })
  })

  describe('getMimeTypeFromExtension', () => {
    it('should return correct MIME type for common extensions', () => {
      expect(getMimeTypeFromExtension('photo.jpg')).toBe('image/jpeg')
      expect(getMimeTypeFromExtension('photo.jpeg')).toBe('image/jpeg')
      expect(getMimeTypeFromExtension('image.png')).toBe('image/png')
      expect(getMimeTypeFromExtension('animation.gif')).toBe('image/gif')
      expect(getMimeTypeFromExtension('image.webp')).toBe('image/webp')
      expect(getMimeTypeFromExtension('video.mp4')).toBe('video/mp4')
      expect(getMimeTypeFromExtension('audio.mp3')).toBe('audio/mpeg')
      expect(getMimeTypeFromExtension('document.pdf')).toBe('application/pdf')
    })

    it('should handle uppercase extensions', () => {
      expect(getMimeTypeFromExtension('PHOTO.JPG')).toBe('image/jpeg')
      expect(getMimeTypeFromExtension('IMAGE.PNG')).toBe('image/png')
    })

    it('should return octet-stream for unknown extensions', () => {
      expect(getMimeTypeFromExtension('file.xyz')).toBe('application/octet-stream')
      expect(getMimeTypeFromExtension('noextension')).toBe('application/octet-stream')
    })
  })

  describe('getMediaTypeFromMime', () => {
    it('should categorize image MIME types', () => {
      expect(getMediaTypeFromMime('image/jpeg')).toBe('image')
      expect(getMediaTypeFromMime('image/png')).toBe('image')
      expect(getMediaTypeFromMime('image/gif')).toBe('image')
      expect(getMediaTypeFromMime('image/webp')).toBe('image')
    })

    it('should categorize video MIME types', () => {
      expect(getMediaTypeFromMime('video/mp4')).toBe('video')
      expect(getMediaTypeFromMime('video/webm')).toBe('video')
    })

    it('should categorize audio MIME types', () => {
      expect(getMediaTypeFromMime('audio/mpeg')).toBe('audio')
      expect(getMediaTypeFromMime('audio/wav')).toBe('audio')
    })

    it('should categorize document MIME types', () => {
      expect(getMediaTypeFromMime('application/pdf')).toBe('document')
    })

    it('should categorize archive MIME types', () => {
      expect(getMediaTypeFromMime('application/zip')).toBe('archive')
    })

    it('should return unknown for unrecognized MIME types', () => {
      expect(getMediaTypeFromMime('application/octet-stream')).toBe('unknown')
      expect(getMediaTypeFromMime('text/plain')).toBe('unknown')
    })
  })
})

// =============================================================================
// Image Dimension Extraction Tests
// =============================================================================

describe('Image Dimension Extraction', () => {
  describe('extractImageDimensions', () => {
    it('should extract PNG dimensions', () => {
      const png = createTestPng()
      const dims = extractImageDimensions(png)
      expect(dims).toEqual({ width: 1, height: 1 })
    })

    it('should extract larger PNG dimensions', () => {
      const png = createLargePng()
      const dims = extractImageDimensions(png)
      expect(dims).toEqual({ width: 100, height: 100 })
    })

    it('should extract JPEG dimensions', () => {
      const jpeg = createTestJpeg()
      const dims = extractImageDimensions(jpeg)
      expect(dims).toEqual({ width: 8, height: 8 })
    })

    it('should extract GIF dimensions', () => {
      const gif = createTestGif()
      const dims = extractImageDimensions(gif)
      expect(dims).toEqual({ width: 2, height: 2 })
    })

    it('should extract WebP dimensions', () => {
      const webp = createTestWebp()
      const dims = extractImageDimensions(webp)
      expect(dims).toEqual({ width: 2, height: 2 })
    })

    it('should return null for invalid data', () => {
      const invalid = new Uint8Array([0x00, 0x01, 0x02, 0x03])
      expect(extractImageDimensions(invalid)).toBeNull()
    })
  })
})

// =============================================================================
// Alpha Channel Detection Tests
// =============================================================================

describe('Alpha Channel Detection', () => {
  describe('imageHasAlpha', () => {
    it('should detect PNG without alpha', () => {
      const png = createTestPng()
      expect(imageHasAlpha(png, 'image/png')).toBe(false)
    })

    it('should detect PNG with alpha', () => {
      const pngAlpha = createTestPngWithAlpha()
      expect(imageHasAlpha(pngAlpha, 'image/png')).toBe(true)
    })

    it('should report GIF always has alpha potential', () => {
      const gif = createTestGif()
      expect(imageHasAlpha(gif, 'image/gif')).toBe(true)
    })

    it('should return false for JPEG (never has alpha)', () => {
      const jpeg = createTestJpeg()
      expect(imageHasAlpha(jpeg, 'image/jpeg')).toBe(false)
    })
  })
})

// =============================================================================
// EXIF Extraction Tests
// =============================================================================

describe('EXIF Extraction', () => {
  describe('extractExifFromJpeg', () => {
    it('should extract EXIF data from JPEG with EXIF', () => {
      const jpeg = createJpegWithExif()
      const exif = extractExifFromJpeg(jpeg)

      expect(exif).not.toBeNull()
      expect(exif?.make).toBe('Canon')
      expect(exif?.model).toBe('EOS 5D')
    })

    it('should return null for JPEG without EXIF', () => {
      const jpeg = createTestJpeg()
      const exif = extractExifFromJpeg(jpeg)
      expect(exif).toBeNull()
    })

    it('should return null for non-JPEG data', () => {
      const png = createTestPng()
      const exif = extractExifFromJpeg(png)
      expect(exif).toBeNull()
    })
  })
})

// =============================================================================
// Image Metadata Extraction Tests
// =============================================================================

describe('Image Metadata Extraction', () => {
  describe('extractImageMetadata', () => {
    it('should extract PNG metadata', () => {
      const png = createTestPng()
      const metadata = extractImageMetadata(png, 'image/png')

      expect(metadata).not.toBeNull()
      expect(metadata?.width).toBe(1)
      expect(metadata?.height).toBe(1)
      expect(metadata?.format).toBe('png')
      expect(metadata?.hasAlpha).toBe(false)
    })

    it('should extract PNG with alpha metadata', () => {
      const png = createTestPngWithAlpha()
      const metadata = extractImageMetadata(png, 'image/png')

      expect(metadata).not.toBeNull()
      expect(metadata?.hasAlpha).toBe(true)
    })

    it('should extract JPEG metadata', () => {
      const jpeg = createTestJpeg()
      const metadata = extractImageMetadata(jpeg, 'image/jpeg')

      expect(metadata).not.toBeNull()
      expect(metadata?.width).toBe(8)
      expect(metadata?.height).toBe(8)
      expect(metadata?.format).toBe('jpeg')
      expect(metadata?.hasAlpha).toBe(false)
    })

    it('should extract GIF metadata with animation detection', () => {
      const gif = createTestGif()
      const metadata = extractImageMetadata(gif, 'image/gif')

      expect(metadata).not.toBeNull()
      expect(metadata?.width).toBe(2)
      expect(metadata?.height).toBe(2)
      expect(metadata?.format).toBe('gif')
    })

    it('should extract JPEG metadata with EXIF', () => {
      const jpeg = createJpegWithExif()
      const metadata = extractImageMetadata(jpeg, 'image/jpeg')

      expect(metadata).not.toBeNull()
      expect(metadata?.exif).toBeDefined()
      expect(metadata?.exif?.make).toBe('Canon')
      expect(metadata?.exif?.model).toBe('EOS 5D')
    })

    it('should return null for invalid image data', () => {
      const invalid = new Uint8Array([0x00, 0x01, 0x02, 0x03])
      const metadata = extractImageMetadata(invalid, 'image/png')
      expect(metadata).toBeNull()
    })
  })
})

// =============================================================================
// Media Library Tests
// =============================================================================

describe('MediaLibrary', () => {
  let library: MediaLibrary
  let mockBucket: R2Bucket

  beforeEach(() => {
    mockBucket = createMockBucket()
    library = createMediaLibrary({
      bucket: mockBucket,
    })
  })

  describe('factory', () => {
    it('should create a media library instance', () => {
      expect(library).toBeDefined()
      expect(typeof library.add).toBe('function')
      expect(typeof library.get).toBe('function')
      expect(typeof library.search).toBe('function')
    })
  })

  describe('add', () => {
    it('should add media with auto-detected metadata', async () => {
      const png = createTestPng()
      const result = await library.add(png, {
        filename: 'test.png',
      })

      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(result.filename).toBe('test.png')
      expect(result.mimeType).toBe('image/png')
      expect(result.type).toBe('image')
      expect(result.size).toBe(png.length)
      expect(result.image).toBeDefined()
      expect(result.image?.width).toBe(1)
      expect(result.image?.height).toBe(1)
    })

    it('should add media with custom folder', async () => {
      const png = createTestPng()
      const result = await library.add(png, {
        filename: 'photo.png',
        folder: '/photos/2024',
      })

      expect(result.folder).toBe('/photos/2024')
      expect(result.key).toContain('photos/2024')
    })

    it('should add media with tags', async () => {
      const png = createTestPng()
      const result = await library.add(png, {
        filename: 'vacation.png',
        tags: ['vacation', 'beach', 'summer'],
      })

      expect(result.tags).toEqual(['vacation', 'beach', 'summer'])
    })

    it('should add media with title and description', async () => {
      const png = createTestPng()
      const result = await library.add(png, {
        filename: 'sunset.png',
        title: 'Beautiful Sunset',
        description: 'Sunset at the beach',
      })

      expect(result.title).toBe('Beautiful Sunset')
      expect(result.description).toBe('Sunset at the beach')
    })

    it('should generate hash for media', async () => {
      const png = createTestPng()
      const result = await library.add(png, {
        filename: 'test.png',
      })

      expect(result.hash).toBeDefined()
      expect(result.hash.length).toBe(64) // SHA-256 hex string
    })

    it('should detect JPEG and extract EXIF', async () => {
      const jpeg = createJpegWithExif()
      const result = await library.add(jpeg, {
        filename: 'photo.jpg',
      })

      expect(result.mimeType).toBe('image/jpeg')
      expect(result.image?.exif).toBeDefined()
      expect(result.image?.exif?.make).toBe('Canon')
    })

    it('should reject files exceeding size limit', async () => {
      const smallLibrary = createMediaLibrary({
        bucket: mockBucket,
        maxFileSize: 10, // 10 bytes
      })

      const png = createTestPng() // ~67 bytes

      await expect(
        smallLibrary.add(png, { filename: 'test.png' })
      ).rejects.toThrow(/size.*exceeds/i)
    })

    it('should reject disallowed MIME types', async () => {
      const restrictedLibrary = createMediaLibrary({
        bucket: mockBucket,
        allowedMimeTypes: ['image/jpeg'],
      })

      const png = createTestPng()

      await expect(
        restrictedLibrary.add(png, { filename: 'test.png' })
      ).rejects.toThrow(/not allowed/i)
    })

    it('should reject duplicate keys without overwrite', async () => {
      const png = createTestPng()

      await library.add(png, { filename: 'test.png' })

      await expect(
        library.add(png, { filename: 'test.png' })
      ).rejects.toThrow(/already exists/i)
    })

    it('should allow overwrite of existing files', async () => {
      const png = createTestPng()

      await library.add(png, { filename: 'test.png' })
      const result = await library.add(png, { filename: 'test.png', overwrite: true })

      expect(result.filename).toBe('test.png')
    })
  })

  describe('get and getByKey', () => {
    it('should get media by ID', async () => {
      const png = createTestPng()
      const added = await library.add(png, { filename: 'test.png' })

      const retrieved = await library.get(added.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(added.id)
      expect(retrieved?.filename).toBe('test.png')
    })

    it('should return null for non-existent ID', async () => {
      const result = await library.get('non-existent-id')
      expect(result).toBeNull()
    })

    it('should get media by key', async () => {
      const png = createTestPng()
      const added = await library.add(png, { filename: 'test.png' })

      const retrieved = await library.getByKey(added.key)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.key).toBe(added.key)
    })
  })

  describe('update', () => {
    it('should update title and description', async () => {
      const png = createTestPng()
      const added = await library.add(png, { filename: 'test.png' })

      const updated = await library.update(added.id, {
        title: 'New Title',
        description: 'New Description',
      })

      expect(updated.title).toBe('New Title')
      expect(updated.description).toBe('New Description')
      expect(updated.modifiedAt).toBeDefined()
    })

    it('should update tags', async () => {
      const png = createTestPng()
      const added = await library.add(png, { filename: 'test.png', tags: ['old'] })

      const updated = await library.update(added.id, {
        tags: ['new', 'tags'],
      })

      expect(updated.tags).toEqual(['new', 'tags'])
    })

    it('should star/unstar media', async () => {
      const png = createTestPng()
      const added = await library.add(png, { filename: 'test.png' })
      expect(added.starred).toBe(false)

      const starred = await library.update(added.id, { starred: true })
      expect(starred.starred).toBe(true)
    })

    it('should throw for non-existent ID', async () => {
      await expect(
        library.update('non-existent', { title: 'New' })
      ).rejects.toThrow(/not found/i)
    })
  })

  describe('delete and restore', () => {
    it('should soft delete media (move to trash)', async () => {
      const png = createTestPng()
      const added = await library.add(png, { filename: 'test.png' })

      await library.delete(added.id)

      const retrieved = await library.get(added.id)
      expect(retrieved?.trashed).toBe(true)
      expect(retrieved?.trashedAt).toBeDefined()
    })

    it('should permanently delete media', async () => {
      const png = createTestPng()
      const added = await library.add(png, { filename: 'test.png' })

      await library.delete(added.id, true)

      const retrieved = await library.get(added.id)
      expect(retrieved).toBeNull()
    })

    it('should restore media from trash', async () => {
      const png = createTestPng()
      const added = await library.add(png, { filename: 'test.png' })

      await library.delete(added.id)
      const restored = await library.restore(added.id)

      expect(restored.trashed).toBe(false)
      expect(restored.trashedAt).toBeUndefined()
    })
  })

  describe('content access', () => {
    it('should get media content as Uint8Array', async () => {
      const png = createTestPng()
      const added = await library.add(png, { filename: 'test.png' })

      const content = await library.getContent(added.id)

      expect(content).toBeInstanceOf(Uint8Array)
      expect(content.length).toBe(png.length)
      expect(content).toEqual(png)
    })

    it('should get media content as stream', async () => {
      const png = createTestPng()
      const added = await library.add(png, { filename: 'test.png' })

      const stream = await library.getContentStream(added.id)

      expect(stream).toBeInstanceOf(ReadableStream)
    })
  })

  describe('organization', () => {
    it('should move media to new folder', async () => {
      const png = createTestPng()
      const added = await library.add(png, {
        filename: 'test.png',
        folder: '/folder1',
      })

      const moved = await library.move(added.id, '/folder2')

      expect(moved.folder).toBe('/folder2')
      expect(moved.key).toContain('folder2')
    })

    it('should copy media to new folder', async () => {
      const png = createTestPng()
      const added = await library.add(png, {
        filename: 'test.png',
        folder: '/folder1',
      })

      const copied = await library.copy(added.id, '/folder2')

      expect(copied.id).not.toBe(added.id)
      expect(copied.folder).toBe('/folder2')

      // Original should still exist
      const original = await library.get(added.id)
      expect(original).not.toBeNull()
    })

    it('should add tags to media', async () => {
      const png = createTestPng()
      const added = await library.add(png, {
        filename: 'test.png',
        tags: ['existing'],
      })

      const updated = await library.addTags(added.id, ['new1', 'new2'])

      expect(updated.tags).toContain('existing')
      expect(updated.tags).toContain('new1')
      expect(updated.tags).toContain('new2')
    })

    it('should remove tags from media', async () => {
      const png = createTestPng()
      const added = await library.add(png, {
        filename: 'test.png',
        tags: ['keep', 'remove1', 'remove2'],
      })

      const updated = await library.removeTags(added.id, ['remove1', 'remove2'])

      expect(updated.tags).toEqual(['keep'])
    })

    it('should not duplicate tags when adding', async () => {
      const png = createTestPng()
      const added = await library.add(png, {
        filename: 'test.png',
        tags: ['existing'],
      })

      const updated = await library.addTags(added.id, ['existing', 'new'])

      expect(updated.tags).toEqual(['existing', 'new'])
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      // Add some test media
      const png = createTestPng()

      await library.add(png, {
        filename: 'photo1.png',
        folder: '/photos/2024',
        tags: ['vacation', 'beach'],
        title: 'Beach Photo',
      })

      await library.add(png, {
        filename: 'photo2.png',
        folder: '/photos/2024',
        tags: ['vacation', 'mountain'],
        title: 'Mountain View',
      })

      await library.add(png, {
        filename: 'doc1.png',
        folder: '/documents',
        tags: ['work'],
        title: 'Work Document',
      })
    })

    it('should search by folder', async () => {
      const result = await library.search({ folder: '/photos/2024' })

      expect(result.items.length).toBe(2)
      expect(result.total).toBe(2)
    })

    it('should search by tags (AND logic)', async () => {
      const result = await library.search({ tags: ['vacation', 'beach'] })

      expect(result.items.length).toBe(1)
      expect(result.items[0].title).toBe('Beach Photo')
    })

    it('should search by any tags (OR logic)', async () => {
      const result = await library.search({ anyTags: ['beach', 'mountain'] })

      expect(result.items.length).toBe(2)
    })

    it('should search by full-text query', async () => {
      const result = await library.search({ query: 'beach' })

      expect(result.items.length).toBe(1)
      expect(result.items[0].title).toBe('Beach Photo')
    })

    it('should search by media type', async () => {
      const result = await library.search({ type: 'image' })

      expect(result.items.length).toBe(3)
    })

    it('should exclude trashed items by default', async () => {
      const items = await library.search()
      const firstItem = items.items[0]

      await library.delete(firstItem.id)

      const result = await library.search()
      expect(result.items.length).toBe(2)
    })

    it('should include trashed items when requested', async () => {
      const items = await library.search()
      const firstItem = items.items[0]

      await library.delete(firstItem.id)

      const result = await library.search({ includeTrashed: true })
      expect(result.items.length).toBe(3)
    })

    it('should filter starred items', async () => {
      const items = await library.search()
      await library.update(items.items[0].id, { starred: true })

      const result = await library.search({ starred: true })
      expect(result.items.length).toBe(1)
    })

    it('should sort by uploadedAt desc by default', async () => {
      const result = await library.search()

      expect(result.items.length).toBe(3)
      // Verify descending order by checking timestamps are in descending order
      for (let i = 0; i < result.items.length - 1; i++) {
        expect(result.items[i].uploadedAt.getTime()).toBeGreaterThanOrEqual(
          result.items[i + 1].uploadedAt.getTime()
        )
      }
    })

    it('should support pagination', async () => {
      const page1 = await library.search({ limit: 2, offset: 0 })
      expect(page1.items.length).toBe(2)
      expect(page1.hasMore).toBe(true)

      const page2 = await library.search({ limit: 2, offset: 2 })
      expect(page2.items.length).toBe(1)
      expect(page2.hasMore).toBe(false)
    })
  })

  describe('folders and tags', () => {
    beforeEach(async () => {
      const png = createTestPng()

      await library.add(png, {
        filename: 'photo1.png',
        folder: '/photos/2024',
        tags: ['vacation', 'beach'],
      })

      await library.add(png, {
        filename: 'photo2.png',
        folder: '/photos/2023',
        tags: ['vacation'],
      })

      await library.add(png, {
        filename: 'doc.png',
        folder: '/documents',
        tags: ['work'],
      })
    })

    it('should list folder contents', async () => {
      const items = await library.listFolder('/photos/2024')

      expect(items.length).toBe(1)
      expect(items[0].filename).toBe('photo1.png')
    })

    it('should get folder structure', async () => {
      const folders = await library.getFolders()

      expect(folders.length).toBe(3)
      expect(folders.some(f => f.path === '/photos/2024')).toBe(true)
      expect(folders.some(f => f.path === '/photos/2023')).toBe(true)
      expect(folders.some(f => f.path === '/documents')).toBe(true)
    })

    it('should get all tags with counts', async () => {
      const tags = await library.getTags()

      expect(tags.find(t => t.name === 'vacation')?.count).toBe(2)
      expect(tags.find(t => t.name === 'beach')?.count).toBe(1)
      expect(tags.find(t => t.name === 'work')?.count).toBe(1)
    })
  })

  describe('bulk operations', () => {
    it('should bulk delete multiple items', async () => {
      const png = createTestPng()
      const item1 = await library.add(png, { filename: 'file1.png' })
      const item2 = await library.add(png, { filename: 'file2.png', overwrite: false })

      await library.bulkDelete([item1.id, item2.id])

      const r1 = await library.get(item1.id)
      const r2 = await library.get(item2.id)
      expect(r1?.trashed).toBe(true)
      expect(r2?.trashed).toBe(true)
    })

    it('should bulk move multiple items', async () => {
      const png = createTestPng()
      const item1 = await library.add(png, { filename: 'file1.png', folder: '/old' })
      const item2 = await library.add(png, { filename: 'file2.png', folder: '/old' })

      await library.bulkMove([item1.id, item2.id], '/new')

      const r1 = await library.get(item1.id)
      const r2 = await library.get(item2.id)
      expect(r1?.folder).toBe('/new')
      expect(r2?.folder).toBe('/new')
    })

    it('should bulk add tags', async () => {
      const png = createTestPng()
      const item1 = await library.add(png, { filename: 'file1.png' })
      const item2 = await library.add(png, { filename: 'file2.png', overwrite: false })

      await library.bulkAddTags([item1.id, item2.id], ['tag1', 'tag2'])

      const r1 = await library.get(item1.id)
      const r2 = await library.get(item2.id)
      expect(r1?.tags).toContain('tag1')
      expect(r2?.tags).toContain('tag2')
    })

    it('should bulk remove tags', async () => {
      const png = createTestPng()
      const item1 = await library.add(png, { filename: 'file1.png', tags: ['remove', 'keep'] })
      const item2 = await library.add(png, { filename: 'file2.png', tags: ['remove', 'keep'], overwrite: false })

      await library.bulkRemoveTags([item1.id, item2.id], ['remove'])

      const r1 = await library.get(item1.id)
      const r2 = await library.get(item2.id)
      expect(r1?.tags).toEqual(['keep'])
      expect(r2?.tags).toEqual(['keep'])
    })
  })

  describe('trash management', () => {
    it('should list trash contents', async () => {
      const png = createTestPng()
      const item1 = await library.add(png, { filename: 'file1.png' })
      await library.add(png, { filename: 'file2.png', overwrite: false })

      await library.delete(item1.id)

      const trash = await library.listTrash()
      expect(trash.length).toBe(1)
      expect(trash[0].id).toBe(item1.id)
    })

    it('should empty trash', async () => {
      const png = createTestPng()
      const item1 = await library.add(png, { filename: 'file1.png' })
      const item2 = await library.add(png, { filename: 'file2.png', overwrite: false })

      await library.delete(item1.id)
      await library.delete(item2.id)

      await library.emptyTrash()

      const trash = await library.listTrash()
      expect(trash.length).toBe(0)

      // Items should be permanently deleted
      expect(await library.get(item1.id)).toBeNull()
      expect(await library.get(item2.id)).toBeNull()
    })
  })
})
