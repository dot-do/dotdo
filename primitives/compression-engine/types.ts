/**
 * CompressionEngine Types
 * Comprehensive compression system for the dotdo platform
 */

/**
 * Supported compression algorithms
 */
export type CompressionAlgorithm = 'gzip' | 'deflate' | 'brotli' | 'lz4' | 'snappy'

/**
 * Compression level - numeric (1-9) or named presets
 */
export type CompressionLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 'fast' | 'default' | 'best'

/**
 * Result of a compression operation
 */
export interface CompressionResult {
  /** Compressed data */
  data: Uint8Array
  /** Original size in bytes */
  originalSize: number
  /** Compressed size in bytes */
  compressedSize: number
  /** Compression ratio (compressedSize / originalSize) */
  ratio: number
}

/**
 * Result of a decompression operation
 */
export interface DecompressionResult {
  /** Decompressed data */
  data: Uint8Array
  /** Compressed size in bytes */
  compressedSize: number
  /** Decompressed size in bytes */
  decompressedSize: number
}

/**
 * Options for streaming compression/decompression
 */
export interface StreamOptions {
  /** Size of chunks to process (default: 16384) */
  chunkSize?: number
  /** Flush mode for streaming */
  flush?: 'none' | 'sync' | 'full' | 'finish'
}

/**
 * Configuration for dictionary-based compression
 */
export interface DictionaryConfig {
  /** Custom dictionary data */
  dictionary?: Uint8Array
  /** Preset dictionary identifier */
  preset?: 'json' | 'html' | 'css' | 'javascript' | 'text'
}

/**
 * Statistics from a compression operation
 */
export interface CompressionStats {
  /** Algorithm used */
  algorithm: CompressionAlgorithm
  /** Compression level used */
  level: CompressionLevel
  /** Duration in milliseconds */
  duration: number
  /** Compression ratio (compressedSize / originalSize) */
  ratio: number
  /** Original size in bytes */
  originalSize: number
  /** Compressed size in bytes */
  compressedSize: number
  /** Throughput in bytes per second */
  throughput: number
}

/**
 * Result of benchmarking multiple algorithms
 */
export interface BenchmarkResult {
  /** Best algorithm for this data */
  bestAlgorithm: CompressionAlgorithm
  /** Best ratio achieved */
  bestRatio: number
  /** Fastest algorithm */
  fastestAlgorithm: CompressionAlgorithm
  /** Fastest duration in ms */
  fastestDuration: number
  /** Stats for each algorithm tested */
  results: CompressionStats[]
}

/**
 * Options for compression operations
 */
export interface CompressionOptions {
  /** Compression level */
  level?: CompressionLevel
  /** Dictionary configuration */
  dictionary?: DictionaryConfig
  /** Stream options */
  stream?: StreamOptions
}

/**
 * Interface for individual compressor implementations
 */
export interface Compressor {
  /** Algorithm this compressor implements */
  algorithm: CompressionAlgorithm
  /** Compress data */
  compress(data: Uint8Array, level?: CompressionLevel): Promise<Uint8Array>
  /** Decompress data */
  decompress(data: Uint8Array): Promise<Uint8Array>
  /** Check if data appears to be compressed with this algorithm */
  detect(data: Uint8Array): boolean
}

/**
 * Error thrown during compression/decompression
 */
export class CompressionError extends Error {
  constructor(
    message: string,
    public readonly algorithm?: CompressionAlgorithm,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'CompressionError'
  }
}
