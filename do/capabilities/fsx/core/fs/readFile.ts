/**
 * readFile - Read the entire contents of a file
 *
 * This module implements Node.js-compatible file reading with support for
 * multiple encodings, abort signals, and optimized handling of various
 * file sizes including empty files and large files.
 *
 * Key features:
 * - Multiple encoding support: utf-8, base64, hex, ascii, latin1/binary
 * - AbortSignal support for cancellation
 * - Proper POSIX error handling (ENOENT, EISDIR, EINVAL)
 * - Optimized for common patterns (reused TextDecoder)
 * - Safe handling of edge cases (empty files, trailing slashes)
 *
 * @module fs/readFile
 */

import type { BufferEncoding } from '../types'
import { ENOENT, EISDIR, EINVAL } from '../errors'
import { normalize, isAbsolute } from '../path'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the readFile function.
 *
 * Controls how file content is read and returned, including encoding
 * for output format and abort signal for cancellation support.
 *
 * @example
 * ```typescript
 * // Read as UTF-8 string (default behavior)
 * const text = await readFile('/config.json')
 *
 * // Read as raw bytes
 * const bytes = await readFile('/image.png', { encoding: null })
 *
 * // Read with cancellation support
 * const controller = new AbortController()
 * const content = await readFile('/file.txt', { signal: controller.signal })
 * ```
 */
export interface ReadFileOptions {
  /**
   * Character encoding for string output.
   *
   * - `'utf-8'` / `'utf8'`: UTF-8 string (default)
   * - `'base64'`: Base64 encoded string
   * - `'hex'`: Hexadecimal string (lowercase)
   * - `'ascii'`: ASCII string (7-bit, treated as UTF-8)
   * - `'latin1'` / `'binary'`: Latin-1 / ISO-8859-1 string
   * - `null`: Return raw Uint8Array
   */
  encoding?: BufferEncoding | null

  /**
   * File open flag for compatibility with Node.js API.
   * Currently only 'r' (read) is meaningful. Default: 'r'
   */
  flag?: string

  /**
   * Abort signal for cancellation support.
   * If the signal is aborted before or during the read,
   * the operation throws an AbortError.
   */
  signal?: AbortSignal
}

/**
 * Storage backend interface for readFile.
 *
 * This abstraction allows readFile to work with different storage
 * implementations (in-memory for testing, SQLite for hot tier,
 * R2 for warm/cold tiers).
 */
export interface ReadFileStorage {
  /**
   * Retrieve file entry by path.
   * @param path - Absolute normalized file path
   * @returns File content and metadata, or undefined if not found
   */
  get(path: string): { content: Uint8Array; isDirectory: boolean } | undefined

  /**
   * Check if a path exists in storage.
   * @param path - Absolute normalized file path
   * @returns true if path exists
   */
  has(path: string): boolean
}

// =============================================================================
// Module State
// =============================================================================

/** Module-level storage backend (set via setStorage for testing/initialization) */
let storage: ReadFileStorage | null = null

/**
 * Cached TextDecoder for UTF-8 decoding.
 * Reusing a single instance avoids repeated allocation overhead for
 * the common case of UTF-8 string reads.
 */
const utf8Decoder = new TextDecoder('utf-8')

// =============================================================================
// Storage Management
// =============================================================================

/**
 * Set the storage backend for readFile.
 *
 * This is primarily used for testing to inject mock storage, or during
 * filesystem module initialization to connect to the actual storage layer.
 *
 * @param s - Storage backend implementation, or null to clear
 *
 * @example
 * ```typescript
 * // Testing setup
 * const mockStorage = new Map()
 * mockStorage.set('/test.txt', { content: new Uint8Array([72, 105]), isDirectory: false })
 * setStorage({ get: (p) => mockStorage.get(p), has: (p) => mockStorage.has(p) })
 * ```
 */
export function setStorage(s: ReadFileStorage | null): void {
  storage = s
}

/**
 * Get the current storage backend.
 *
 * @returns Current storage backend, or null if not configured
 */
export function getStorage(): ReadFileStorage | null {
  return storage
}

// =============================================================================
// Encoding Utilities (Optimized)
// =============================================================================

/**
 * Convert bytes to Base64 string.
 *
 * Optimized for common file sizes using chunked processing to avoid
 * string concatenation performance issues with very large files.
 *
 * @param bytes - Binary data to encode
 * @returns Base64 encoded string
 *
 * @internal
 */
function toBase64(bytes: Uint8Array): string {
  // Fast path for empty content
  if (bytes.length === 0) return ''

  // For small files (< 32KB), use simple approach
  // String.fromCharCode.apply has a call stack limit (~32KB on most engines)
  if (bytes.length < 32768) {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!)
    }
    return btoa(binary)
  }

  // For larger files, process in chunks to avoid call stack limits
  // and reduce string concatenation overhead
  const chunkSize = 32768
  const chunks: string[] = []

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, bytes.length)
    let chunk = ''
    for (let j = i; j < end; j++) {
      chunk += String.fromCharCode(bytes[j]!)
    }
    chunks.push(chunk)
  }

  return btoa(chunks.join(''))
}

/**
 * Convert bytes to hexadecimal string (lowercase).
 *
 * Optimized with pre-computed hex lookup table to avoid repeated
 * toString(16) and padStart() calls.
 *
 * @param bytes - Binary data to encode
 * @returns Lowercase hexadecimal string
 *
 * @internal
 */
const HEX_CHARS = '0123456789abcdef'
function toHex(bytes: Uint8Array): string {
  // Fast path for empty content
  if (bytes.length === 0) return ''

  // Pre-allocate result array for better performance
  // Each byte becomes 2 hex characters
  const result = new Array<string>(bytes.length * 2)

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!
    result[i * 2] = HEX_CHARS[byte >> 4]!
    result[i * 2 + 1] = HEX_CHARS[byte & 0x0f]!
  }

  return result.join('')
}

/**
 * Convert bytes to Latin-1 (ISO-8859-1) string.
 *
 * Latin-1 is a single-byte encoding where each byte value maps directly
 * to the same Unicode code point (0x00-0xFF).
 *
 * Optimized for larger files using chunked processing.
 *
 * @param bytes - Binary data to decode as Latin-1
 * @returns Latin-1 decoded string
 *
 * @internal
 */
function toLatin1(bytes: Uint8Array): string {
  // Fast path for empty content
  if (bytes.length === 0) return ''

  // For small files, simple loop is efficient
  if (bytes.length < 32768) {
    let result = ''
    for (let i = 0; i < bytes.length; i++) {
      result += String.fromCharCode(bytes[i]!)
    }
    return result
  }

  // For larger files, use chunked processing
  const chunkSize = 32768
  const chunks: string[] = []

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, bytes.length)
    let chunk = ''
    for (let j = i; j < end; j++) {
      chunk += String.fromCharCode(bytes[j]!)
    }
    chunks.push(chunk)
  }

  return chunks.join('')
}

// =============================================================================
// Main Implementation
// =============================================================================

/**
 * Read the entire contents of a file.
 *
 * This function reads a file's complete contents and returns them either
 * as a string (with specified encoding) or as raw bytes (when encoding is null).
 *
 * **Encoding behavior:**
 * - Default (no encoding specified): Returns UTF-8 string
 * - `encoding: null`: Returns Uint8Array (defensive copy)
 * - `encoding: 'utf-8'` or `'utf8'`: Returns UTF-8 decoded string
 * - `encoding: 'base64'`: Returns Base64 encoded string
 * - `encoding: 'hex'`: Returns lowercase hexadecimal string
 * - `encoding: 'ascii'`: Returns string (treated as UTF-8)
 * - `encoding: 'latin1'` or `'binary'`: Returns Latin-1 decoded string
 *
 * **Path handling:**
 * - Path must be absolute (start with '/')
 * - Trailing slashes on file paths throw ENOENT (POSIX behavior)
 * - Double slashes, `.`, and `..` are normalized
 *
 * **Error handling:**
 * - ENOENT: File does not exist or storage not configured
 * - EISDIR: Path refers to a directory
 * - EINVAL: Path is not absolute
 * - AbortError: Operation was aborted via signal
 *
 * @param path - Absolute path to the file (must start with '/')
 * @param options - Encoding string, options object, or null for raw bytes
 * @returns File contents as string (with encoding) or Uint8Array (encoding: null)
 *
 * @throws {ENOENT} If file does not exist
 * @throws {EISDIR} If path is a directory
 * @throws {EINVAL} If path is not absolute
 * @throws {Error} If operation was aborted (AbortError)
 *
 * @example
 * ```typescript
 * // Read text file as UTF-8 string (default)
 * const config = await readFile('/app/config.json')
 * const data = JSON.parse(config)
 *
 * // Read binary file as raw bytes
 * const imageData = await readFile('/images/logo.png', { encoding: null })
 *
 * // Read with encoding shorthand
 * const text = await readFile('/file.txt', 'utf-8')
 *
 * // Read with specific encodings
 * const base64 = await readFile('/image.bin', { encoding: 'base64' })
 * const hex = await readFile('/hash.bin', { encoding: 'hex' })
 *
 * // Read with abort support
 * const controller = new AbortController()
 * setTimeout(() => controller.abort(), 5000)
 * try {
 *   const content = await readFile('/large-file.txt', { signal: controller.signal })
 * } catch (err) {
 *   if (err.name === 'AbortError') console.log('Read was cancelled')
 * }
 * ```
 */
export async function readFile(
  path: string,
  options?: ReadFileOptions | BufferEncoding | null
): Promise<string | Uint8Array> {
  // ==========================================================================
  // Path Validation
  // ==========================================================================

  // Validate path is absolute (POSIX requirement)
  if (!isAbsolute(path)) {
    throw new EINVAL('open', path)
  }

  // Check for trailing slash before normalization
  // In POSIX, a trailing slash means the path must be a directory
  // For readFile on a file path with trailing slash, this is ENOENT
  const hadTrailingSlash = path.length > 1 && path.endsWith('/')

  // Normalize the path (handles //, ., ..)
  const normalizedPath = normalize(path)

  // Trailing slash on a file path should fail
  if (hadTrailingSlash) {
    throw new ENOENT('open', normalizedPath)
  }

  // ==========================================================================
  // Options Parsing
  // ==========================================================================

  let encoding: BufferEncoding | null | undefined
  let signal: AbortSignal | undefined

  if (typeof options === 'string') {
    // Shorthand: readFile(path, 'utf-8')
    encoding = options
  } else if (options === null) {
    // Explicit null for raw bytes: readFile(path, null)
    encoding = null
  } else if (options) {
    // Options object: readFile(path, { encoding, signal })
    encoding = options.encoding
    signal = options.signal
  }

  // Default encoding is UTF-8 (returns string) - matches Node.js behavior
  if (encoding === undefined) {
    encoding = 'utf-8'
  }

  // ==========================================================================
  // Abort Signal Check (Early Exit)
  // ==========================================================================

  // Check for pre-aborted signal (fail fast)
  if (signal?.aborted) {
    const error = new Error('The operation was aborted')
    error.name = 'AbortError'
    throw error
  }

  // ==========================================================================
  // Storage Lookup
  // ==========================================================================

  // Ensure storage is configured
  if (!storage) {
    throw new ENOENT('open', normalizedPath)
  }

  // Retrieve file entry
  const entry = storage.get(normalizedPath)

  if (!entry) {
    throw new ENOENT('open', normalizedPath)
  }

  // Directories cannot be read as files
  if (entry.isDirectory) {
    throw new EISDIR('read', normalizedPath)
  }

  // Get reference to content
  const content = entry.content

  // ==========================================================================
  // Content Encoding and Return
  // ==========================================================================

  // Raw bytes requested - return defensive copy
  if (encoding === null) {
    // Create a copy to prevent mutation of storage data
    // This is intentional for safety - consumers may modify the returned array
    return new Uint8Array(content)
  }

  // Handle empty file fast path for all string encodings
  if (content.length === 0) {
    return ''
  }

  // Convert to string based on requested encoding
  switch (encoding) {
    case 'utf-8':
    case 'utf8':
      // Use cached decoder for performance
      return utf8Decoder.decode(content)

    case 'base64':
      return toBase64(content)

    case 'hex':
      return toHex(content)

    case 'ascii':
      // ASCII is 7-bit subset of UTF-8; decode as UTF-8
      // Invalid bytes (>127) will produce replacement characters
      return utf8Decoder.decode(content)

    case 'latin1':
    case 'binary':
      // Latin-1: each byte maps to same Unicode code point
      return toLatin1(content)

    default:
      // Fallback to UTF-8 for unknown encodings
      // This provides graceful degradation for typos or future encodings
      return utf8Decoder.decode(content)
  }
}
