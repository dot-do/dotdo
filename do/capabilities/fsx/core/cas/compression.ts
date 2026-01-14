/**
 * Zlib compression utilities for Content-Addressable Storage
 *
 * Uses the zlib format (RFC 1950) which is:
 * - CMF byte (usually 0x78 for deflate with 32K window)
 * - FLG byte (determines compression level)
 * - Compressed data (deflate algorithm)
 * - ADLER-32 checksum (4 bytes)
 *
 * This format is compatible with git's object storage.
 */

import pako from 'pako'

/**
 * Compression level from 0-9
 * - 0: No compression (store only)
 * - 1: Best speed (fastest compression)
 * - 6: Default (balanced)
 * - 9: Best compression (smallest size)
 */
export type CompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/**
 * Compression strategy options
 * - default: Normal data (most use cases)
 * - filtered: Data produced by a filter (or predictor)
 * - huffmanOnly: Force Huffman encoding only (no string matching)
 * - rle: Run-length encoding for PNG image data
 * - fixed: Use fixed Huffman codes (prevents dynamic trees)
 */
export type CompressionStrategy =
  | 'default'
  | 'filtered'
  | 'huffmanOnly'
  | 'rle'
  | 'fixed'

/**
 * Compression options
 */
export interface CompressionOptions {
  /**
   * Compression level (0-9)
   * @default 6 (balanced)
   */
  level?: CompressionLevel

  /**
   * Compression strategy
   * @default 'default'
   */
  strategy?: CompressionStrategy

  /**
   * Memory level (1-9) - higher uses more memory but is faster
   * @default 8
   */
  memLevel?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
}

/**
 * Compression result with metrics
 */
export interface CompressionResult {
  /** Compressed data */
  data: Uint8Array

  /** Original size in bytes */
  originalSize: number

  /** Compressed size in bytes */
  compressedSize: number

  /** Compression ratio (compressed/original). Values > 1 mean data expanded */
  ratio: number

  /** Whether data expanded (compressed is larger than original) */
  expanded: boolean
}

// Map strategy names to pako constants
const STRATEGY_MAP: Record<CompressionStrategy, number> = {
  default: 0, // Z_DEFAULT_STRATEGY
  filtered: 1, // Z_FILTERED
  huffmanOnly: 2, // Z_HUFFMAN_ONLY
  rle: 3, // Z_RLE
  fixed: 4, // Z_FIXED
}

/** Default compression options */
export const DEFAULT_COMPRESSION_OPTIONS: Required<CompressionOptions> = {
  level: 6,
  strategy: 'default',
  memLevel: 8,
}

/**
 * Compress data using zlib deflate format
 *
 * @param data - The data to compress
 * @param options - Compression options (level, strategy, memLevel)
 * @returns Compressed data in zlib format (header + deflate + adler32)
 */
export async function compress(
  data: Uint8Array,
  options?: CompressionOptions
): Promise<Uint8Array> {
  const opts = { ...DEFAULT_COMPRESSION_OPTIONS, ...options }

  // Validate compression level
  if (opts.level < 0 || opts.level > 9) {
    throw new CompressionError(
      `Invalid compression level: ${opts.level}. Must be 0-9`,
      'INVALID_LEVEL'
    )
  }

  // Validate memory level
  if (opts.memLevel < 1 || opts.memLevel > 9) {
    throw new CompressionError(
      `Invalid memory level: ${opts.memLevel}. Must be 1-9`,
      'INVALID_MEM_LEVEL'
    )
  }

  try {
    // pako.deflate produces zlib format by default (not raw deflate, not gzip)
    // This includes the 0x78 header and ADLER-32 checksum
    return pako.deflate(data, {
      level: opts.level,
      strategy: STRATEGY_MAP[opts.strategy],
      memLevel: opts.memLevel,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new CompressionError(
      `Compression failed: ${message}`,
      'COMPRESSION_FAILED'
    )
  }
}

/**
 * Compress data and return detailed metrics
 *
 * Useful for monitoring compression efficiency and detecting
 * data that doesn't compress well (already compressed, random, etc.)
 *
 * @param data - The data to compress
 * @param options - Compression options
 * @returns Compression result with metrics
 */
export async function compressWithMetrics(
  data: Uint8Array,
  options?: CompressionOptions
): Promise<CompressionResult> {
  const compressed = await compress(data, options)

  const originalSize = data.length
  const compressedSize = compressed.length
  const ratio = originalSize > 0 ? compressedSize / originalSize : 1

  return {
    data: compressed,
    originalSize,
    compressedSize,
    ratio,
    expanded: compressedSize > originalSize,
  }
}

/**
 * Error codes for compression/decompression failures
 */
export type CompressionErrorCode =
  | 'INVALID_LEVEL'
  | 'INVALID_MEM_LEVEL'
  | 'COMPRESSION_FAILED'
  | 'DECOMPRESSION_FAILED'
  | 'INVALID_ZLIB_HEADER'
  | 'INVALID_CHECKSUM'
  | 'TRUNCATED_DATA'
  | 'CORRUPTED_DATA'

/**
 * Custom error class for compression failures with error codes
 */
export class CompressionError extends Error {
  readonly code: CompressionErrorCode

  constructor(message: string, code: CompressionErrorCode) {
    super(message)
    this.name = 'CompressionError'
    this.code = code
  }
}

/**
 * Classify a decompression error into a specific error code
 */
function classifyDecompressionError(error: Error): CompressionErrorCode {
  const msg = error.message.toLowerCase()

  if (msg.includes('header') || msg.includes('unknown compression method')) {
    return 'INVALID_ZLIB_HEADER'
  }
  if (msg.includes('checksum') || msg.includes('adler')) {
    return 'INVALID_CHECKSUM'
  }
  if (msg.includes('truncated') || msg.includes('unexpected end')) {
    return 'TRUNCATED_DATA'
  }
  if (msg.includes('corrupt') || msg.includes('invalid')) {
    return 'CORRUPTED_DATA'
  }

  return 'DECOMPRESSION_FAILED'
}

/**
 * Decompress zlib deflate format data
 *
 * @param data - The compressed data in zlib format
 * @returns Decompressed original data
 * @throws CompressionError if data is invalid, corrupted, or truncated
 */
export async function decompress(data: Uint8Array): Promise<Uint8Array> {
  // Edge case: empty input
  if (data.length === 0) {
    throw new CompressionError(
      'Cannot decompress empty data: no zlib header present',
      'TRUNCATED_DATA'
    )
  }

  // Edge case: too short to be valid zlib (minimum: 2 byte header + 4 byte checksum)
  if (data.length < 6) {
    throw new CompressionError(
      `Data too short to be valid zlib: expected at least 6 bytes, got ${data.length}`,
      'TRUNCATED_DATA'
    )
  }

  // Validate zlib header (first byte should be 0x78 for deflate with 32K window)
  // Valid CMF values: 0x08, 0x18, 0x28, 0x38, 0x48, 0x58, 0x68, 0x78
  const cmf = data[0]!
  const flg = data[1]!

  if ((cmf & 0x0f) !== 8) {
    throw new CompressionError(
      `Invalid zlib header: expected deflate compression method (CMF & 0x0F = 8), got ${cmf & 0x0f}. First byte: 0x${cmf.toString(16).padStart(2, '0')}`,
      'INVALID_ZLIB_HEADER'
    )
  }

  // Validate header checksum (CMF * 256 + FLG must be divisible by 31)
  if ((cmf * 256 + flg) % 31 !== 0) {
    throw new CompressionError(
      `Invalid zlib header checksum: (CMF=${cmf} * 256 + FLG=${flg}) % 31 = ${(cmf * 256 + flg) % 31}, expected 0`,
      'INVALID_ZLIB_HEADER'
    )
  }

  try {
    // pako.inflate expects zlib format and validates the ADLER-32 checksum
    const result = pako.inflate(data)

    // pako returns undefined for invalid/truncated data instead of throwing
    if (result === undefined) {
      throw new CompressionError(
        'Decompression returned undefined: data may be truncated or corrupted',
        'CORRUPTED_DATA'
      )
    }

    return result
  } catch (error) {
    // Re-throw CompressionError as-is
    if (error instanceof CompressionError) {
      throw error
    }

    // Classify and wrap other errors
    const message = error instanceof Error ? error.message : 'Unknown error'
    const code = classifyDecompressionError(
      error instanceof Error ? error : new Error(message)
    )

    throw new CompressionError(`Decompression failed: ${message}`, code)
  }
}

/**
 * Check if data appears to be zlib-compressed
 *
 * Performs a quick header check without attempting full decompression.
 * Useful for detecting already-compressed data before compression.
 *
 * @param data - Data to check
 * @returns true if data appears to be valid zlib format
 */
export function isZlibCompressed(data: Uint8Array): boolean {
  if (data.length < 2) return false

  const cmf = data[0]!
  const flg = data[1]!

  // Check compression method (should be 8 for deflate)
  if ((cmf & 0x0f) !== 8) return false

  // Check window size is valid (should be <= 7)
  if ((cmf >> 4) > 7) return false

  // Check header checksum
  return (cmf * 256 + flg) % 31 === 0
}
