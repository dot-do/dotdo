/**
 * Compression utilities for primitives
 *
 * Provides gzip, deflate, and deflate-raw compression using the CompressionStream API.
 *
 * @module @dotdo/primitives-core/compression
 */

/**
 * Supported compression formats
 */
export type CompressionFormat = 'gzip' | 'deflate' | 'deflate-raw'

/**
 * Gzip magic bytes (0x1f, 0x8b)
 */
const GZIP_MAGIC = [0x1f, 0x8b] as const

/**
 * Deflate magic bytes (zlib header)
 * Common values: 0x78 0x01, 0x78 0x5e, 0x78 0x9c, 0x78 0xda
 */
const DEFLATE_MAGIC = 0x78

/**
 * Compress data using the specified format.
 *
 * @param data - Data to compress (string or Uint8Array)
 * @param format - Compression format (default: 'gzip')
 * @returns Compressed data as Uint8Array
 *
 * @example
 * ```typescript
 * const compressed = await compress('Hello, World!', 'gzip')
 * ```
 */
export async function compress(
  data: string | Uint8Array,
  format: CompressionFormat = 'gzip'
): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data

  const stream = new CompressionStream(format)
  const writer = stream.writable.getWriter()
  writer.write(bytes)
  writer.close()

  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalLength += value.length
  }

  // Concatenate chunks
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

/**
 * Decompress data using the specified format.
 *
 * @param data - Compressed data
 * @param format - Compression format used
 * @returns Decompressed data as Uint8Array
 * @throws Error if decompression fails (invalid or truncated data)
 *
 * @example
 * ```typescript
 * const compressed = await compress('Hello, World!', 'gzip')
 * const decompressed = await decompress(compressed, 'gzip')
 * const text = new TextDecoder().decode(decompressed)
 * ```
 */
export async function decompress(
  data: Uint8Array,
  format: CompressionFormat
): Promise<Uint8Array> {
  const stream = new DecompressionStream(format)
  const writer = stream.writable.getWriter()
  writer.write(data)
  writer.close()

  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalLength += value.length
  }

  // Concatenate chunks
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

/**
 * Detect the compression format of data by examining magic bytes.
 *
 * @param data - Potentially compressed data
 * @returns Detected format or null if uncompressed
 *
 * @example
 * ```typescript
 * const compressed = await compress('test', 'gzip')
 * const format = detectFormat(compressed) // 'gzip'
 *
 * const plain = new TextEncoder().encode('plain text')
 * const format2 = detectFormat(plain) // null
 * ```
 */
export function detectFormat(data: Uint8Array): CompressionFormat | null {
  if (data.length < 2) return null

  // Check gzip magic bytes
  if (data[0] === GZIP_MAGIC[0] && data[1] === GZIP_MAGIC[1]) {
    return 'gzip'
  }

  // Check deflate/zlib header
  // zlib header: first byte 0x78 followed by specific second bytes
  if (data[0] === DEFLATE_MAGIC) {
    const second = data[1]!
    // Valid zlib CMF/FLG combinations
    if (second === 0x01 || second === 0x5e || second === 0x9c || second === 0xda) {
      return 'deflate'
    }
  }

  return null
}
