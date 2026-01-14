/**
 * writeFile operation
 *
 * Write data to a file, creating the file if it does not exist,
 * or overwriting it if it does.
 *
 * This implementation supports:
 * - Multiple encodings (utf-8, base64, hex, ascii, latin1, binary)
 * - File flags (w, wx, a, ax) for controlling write behavior
 * - Custom file permissions via mode option
 * - Proper timestamp handling (preserves birthtime on overwrite)
 *
 * @module core/fs/writeFile
 */

import type { BufferEncoding } from '../types'
import { ENOENT, EISDIR, EEXIST, EINVAL } from '../errors'

/**
 * Valid file system flags for writeFile operations.
 *
 * - 'w': Write mode (default) - create or truncate file
 * - 'wx': Exclusive write - fail with EEXIST if file exists
 * - 'a': Append mode - create file or append to existing
 * - 'ax': Exclusive append - fail with EEXIST if file exists, otherwise append
 */
export type WriteFileFlag = 'w' | 'wx' | 'a' | 'ax'

/**
 * Options for writeFile operation.
 *
 * Controls how data is written to the file including encoding,
 * permissions, and write behavior.
 *
 * @example
 * ```typescript
 * // Write with specific permissions
 * await writeFile(storage, '/secret.txt', 'data', { mode: 0o600 })
 *
 * // Write base64 encoded data
 * await writeFile(storage, '/image.bin', base64Data, { encoding: 'base64' })
 *
 * // Exclusive write (fail if exists)
 * await writeFile(storage, '/new.txt', 'content', { flag: 'wx' })
 *
 * // Append to existing file
 * await writeFile(storage, '/log.txt', 'entry\n', { flag: 'a' })
 * ```
 */
export interface WriteFileOptions {
  /**
   * Character encoding for string data.
   *
   * - 'utf-8' / 'utf8': UTF-8 encoding (default)
   * - 'base64': Base64 decode the input string
   * - 'hex': Hex decode the input string
   * - 'ascii': ASCII encoding (7-bit)
   * - 'latin1' / 'binary': Latin-1 encoding (8-bit)
   *
   * @default 'utf-8'
   */
  encoding?: BufferEncoding

  /**
   * File mode (permissions) for the created file.
   *
   * Specified as an octal number (e.g., 0o644 for rw-r--r--).
   * Only applies when creating a new file; existing files retain
   * their current permissions unless explicitly changed.
   *
   * @default 0o644
   */
  mode?: number

  /**
   * File system flag controlling write behavior.
   *
   * - 'w': Write mode (default) - create or truncate
   * - 'wx': Exclusive write - fail if file exists
   * - 'a': Append mode - create or append to existing
   * - 'ax': Exclusive append - fail if file exists
   *
   * @default 'w'
   */
  flag?: string
}

/**
 * Storage interface that writeFile operates on.
 *
 * This interface defines the minimal storage backend requirements
 * for the writeFile operation. Implementations must provide methods
 * for reading files, checking directory status, and writing files.
 */
export interface WriteFileStorage {
  /**
   * Get file content and metadata by path.
   *
   * @param path - Normalized absolute path to the file
   * @returns File entry with content and metadata, or undefined if not found
   */
  getFile(path: string): {
    content: Uint8Array
    metadata: {
      mode: number
      mtime: number
      birthtime: number
      ctime: number
    }
  } | undefined

  /**
   * Create a directory at the specified path.
   *
   * @param path - Normalized absolute path for the new directory
   */
  addDirectory(path: string): void

  /**
   * Write a file with content and metadata.
   *
   * @param path - Normalized absolute path for the file
   * @param content - File content as Uint8Array
   * @param metadata - Optional metadata (mode, birthtime)
   */
  addFile(path: string, content: Uint8Array, metadata?: { mode?: number; birthtime?: number }): void

  /**
   * Check if a path is a directory.
   *
   * @param path - Path to check
   * @returns true if path is a directory, false otherwise
   */
  isDirectory(path: string): boolean

  /**
   * Check if the parent directory exists.
   *
   * @param path - Path whose parent to check
   * @returns true if parent directory exists, false otherwise
   */
  parentExists(path: string): boolean
}

/**
 * Normalize a filesystem path.
 *
 * - Removes empty segments and '.' references
 * - Resolves '..' parent directory references
 * - Ensures path starts with '/'
 *
 * @param path - Path to normalize
 * @returns Normalized absolute path
 *
 * @example
 * normalizePath('/foo//bar/./baz/../qux') // '/foo/bar/qux'
 * normalizePath('foo/bar') // '/foo/bar'
 *
 * @internal
 */
function normalizePath(path: string): string {
  // Split path into segments and filter out empty ones and '.'
  const segments = path.split('/').filter(s => s !== '' && s !== '.')

  // Process '..' segments
  const result: string[] = []
  for (const segment of segments) {
    if (segment === '..') {
      result.pop()
    } else {
      result.push(segment)
    }
  }

  return '/' + result.join('/')
}

/**
 * Get the parent directory path.
 *
 * @param path - Path to get parent of
 * @returns Parent directory path, or '/' for root-level paths
 *
 * @example
 * getParentPath('/foo/bar/baz.txt') // '/foo/bar'
 * getParentPath('/foo.txt') // '/'
 *
 * @internal
 */
function getParentPath(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return path.substring(0, lastSlash)
}

/**
 * Set of valid buffer encodings for validation.
 * @internal
 */
const VALID_ENCODINGS = new Set<BufferEncoding>([
  'utf-8', 'utf8', 'ascii', 'base64', 'hex', 'binary', 'latin1'
])

/**
 * Validate that an encoding is supported.
 *
 * @param encoding - Encoding to validate
 * @returns true if valid, false otherwise
 * @internal
 */
function isValidEncoding(encoding: string): encoding is BufferEncoding {
  return VALID_ENCODINGS.has(encoding as BufferEncoding)
}

/**
 * Encode string data to Uint8Array based on the specified encoding.
 *
 * Handles various encodings commonly used in file operations:
 * - UTF-8: Standard Unicode text encoding
 * - Base64: Binary-to-text encoding (decodes to binary)
 * - Hex: Hexadecimal representation (decodes to binary)
 * - ASCII/Latin1/Binary: Single-byte encodings
 *
 * @param data - String data to encode
 * @param encoding - Target encoding (default: 'utf-8')
 * @returns Encoded data as Uint8Array
 *
 * @example
 * encodeData('Hello') // UTF-8 bytes
 * encodeData('SGVsbG8=', 'base64') // Decodes to 'Hello' bytes
 * encodeData('48656c6c6f', 'hex') // Decodes to 'Hello' bytes
 *
 * @internal
 */
function encodeData(data: string, encoding: BufferEncoding = 'utf-8'): Uint8Array {
  // Fast path: empty string returns empty array
  if (data.length === 0) {
    return new Uint8Array(0)
  }

  switch (encoding) {
    case 'utf-8':
    case 'utf8':
      return new TextEncoder().encode(data)

    case 'base64': {
      // Decode base64 to binary
      // Handle URL-safe base64 by replacing - and _ with standard chars
      const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
      const binaryString = atob(normalized)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      return bytes
    }

    case 'hex': {
      // Decode hex to binary
      // Handle odd-length hex strings by treating as invalid
      if (data.length % 2 !== 0) {
        throw new Error(`Invalid hex string: odd length (${data.length})`)
      }
      const length = data.length / 2
      const bytes = new Uint8Array(length)
      for (let i = 0; i < length; i++) {
        const byte = parseInt(data.substring(i * 2, i * 2 + 2), 16)
        if (Number.isNaN(byte)) {
          throw new Error(`Invalid hex character at position ${i * 2}`)
        }
        bytes[i] = byte
      }
      return bytes
    }

    case 'ascii':
    case 'latin1':
    case 'binary': {
      const bytes = new Uint8Array(data.length)
      for (let i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i) & 0xff
      }
      return bytes
    }

    default:
      // Fall back to UTF-8 for unknown encodings
      return new TextEncoder().encode(data)
  }
}

/**
 * Write data to a file.
 *
 * Creates the file if it does not exist, or overwrites it if it does.
 * The storage tier is automatically selected based on file size when
 * used with tiered storage backends.
 *
 * Supported file flags:
 * - 'w' (default): Write mode - create or truncate file
 * - 'wx': Exclusive write - fail with EEXIST if file exists
 * - 'a': Append mode - create file or append to existing
 * - 'ax': Exclusive append - fail with EEXIST if file exists
 *
 * @param storage - Storage backend implementing WriteFileStorage
 * @param path - Absolute path to the file
 * @param data - Data to write (string or Uint8Array)
 * @param options - Write options (encoding, mode, flag)
 * @returns Promise that resolves when write is complete
 *
 * @throws {ENOENT} If parent directory does not exist
 * @throws {EISDIR} If path is a directory
 * @throws {EEXIST} If flag is 'wx' or 'ax' and file already exists
 *
 * @example
 * ```typescript
 * // Write string content
 * await writeFile(storage, '/hello.txt', 'Hello, World!')
 *
 * // Write binary data
 * await writeFile(storage, '/data.bin', new Uint8Array([1, 2, 3]))
 *
 * // Write with specific permissions
 * await writeFile(storage, '/secret.txt', 'data', { mode: 0o600 })
 *
 * // Append to existing file
 * await writeFile(storage, '/log.txt', 'entry\n', { flag: 'a' })
 *
 * // Exclusive write (fail if exists)
 * await writeFile(storage, '/new.txt', 'content', { flag: 'wx' })
 * ```
 */
export async function writeFile(
  storage: WriteFileStorage,
  path: string,
  data: string | Uint8Array,
  options?: WriteFileOptions
): Promise<void> {
  const normalizedPath = normalizePath(path)
  const flag = options?.flag ?? 'w'
  const mode = options?.mode ?? 0o644
  const encoding = options?.encoding ?? 'utf-8'

  // Validate flag
  const validFlags = ['w', 'wx', 'a', 'ax']
  if (!validFlags.includes(flag)) {
    throw new EINVAL('open', normalizedPath)
  }

  // Check if path is root directory
  if (normalizedPath === '/') {
    throw new EISDIR('open', normalizedPath)
  }

  // Check if path is a directory
  if (storage.isDirectory(normalizedPath)) {
    throw new EISDIR('open', normalizedPath)
  }

  // Get the parent path
  const parentPath = getParentPath(normalizedPath)

  // Check if parent exists - need to check parent directory specifically
  // parentExists returns true if parent is a directory OR a file
  // but we need to check if there's a file in the path (intermediate component is a file)
  if (parentPath !== '/' && !storage.parentExists(normalizedPath)) {
    throw new ENOENT('open', parentPath)
  }

  // Also check if parent exists but is a file (not a directory)
  // In this case we should throw ENOENT because you can't create a file inside a file
  if (parentPath !== '/' && !storage.isDirectory(parentPath)) {
    // If parent path has a file there instead of a directory, it's ENOENT
    const parentFile = storage.getFile(parentPath)
    if (parentFile !== undefined) {
      // Parent is a file, not a directory
      throw new ENOENT('open', parentPath)
    }
    // Parent doesn't exist at all
    throw new ENOENT('open', parentPath)
  }

  // Check for exclusive flags (wx, ax) - fail if file exists
  const existingFile = storage.getFile(normalizedPath)
  if ((flag === 'wx' || flag === 'ax') && existingFile !== undefined) {
    throw new EEXIST('open', normalizedPath)
  }

  // Convert data to Uint8Array
  let bytes: Uint8Array
  if (typeof data === 'string') {
    bytes = encodeData(data, encoding)
  } else {
    bytes = data
  }

  // Handle append flags (a, ax)
  // For 'ax', we already checked file doesn't exist above, so this handles 'a' on existing files
  if ((flag === 'a' || flag === 'ax') && existingFile !== undefined) {
    // Append to existing file
    const newContent = new Uint8Array(existingFile.content.length + bytes.length)
    newContent.set(existingFile.content)
    newContent.set(bytes, existingFile.content.length)
    bytes = newContent
  }

  // Write the file with metadata
  // Preserve birthtime if file exists (overwrite), otherwise use current time
  const now = Date.now()
  const birthtime = existingFile?.metadata.birthtime ?? now

  storage.addFile(normalizedPath, bytes, { mode, birthtime })
}
