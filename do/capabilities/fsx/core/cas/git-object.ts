/**
 * Git Object Format Implementation
 *
 * Git objects are stored with a header format: `<type> <size>\0<content>`
 * Valid types: blob, tree, commit, tag
 *
 * This module provides:
 * - Header creation and parsing with strict validation
 * - Full git object encoding/decoding
 * - Type guards for runtime type checking
 * - Detailed error messages for debugging malformed objects
 */

/**
 * Valid git object types
 */
export const VALID_TYPES = ['blob', 'tree', 'commit', 'tag'] as const

/**
 * Git object type - one of: blob, tree, commit, tag
 */
export type GitObjectType = (typeof VALID_TYPES)[number]

/**
 * Parsed git object header information
 */
export interface GitObjectHeader {
  /** Git object type: blob, tree, commit, or tag */
  type: GitObjectType
  /** Content size in bytes as declared in header */
  size: number
  /** Byte offset where content begins (after null byte) */
  contentOffset: number
}

/**
 * Parsed git object with type and content
 */
export interface ParsedGitObject {
  /** Git object type: blob, tree, commit, or tag */
  type: GitObjectType
  /** Raw object content (without header) */
  content: Uint8Array
}

/**
 * Error thrown when parsing malformed git objects
 */
export class GitObjectFormatError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'EMPTY_DATA'
      | 'MISSING_NULL_BYTE'
      | 'MISSING_SPACE'
      | 'INVALID_TYPE'
      | 'INVALID_SIZE'
      | 'SIZE_MISMATCH',
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'GitObjectFormatError'
  }
}

/**
 * Type guard to check if a string is a valid git object type
 *
 * @param type - String to check
 * @returns true if type is a valid GitObjectType
 *
 * @example
 * ```typescript
 * if (isGitObjectType(unknownType)) {
 *   // TypeScript now knows unknownType is GitObjectType
 *   handleGitObject(unknownType)
 * }
 * ```
 */
export function isGitObjectType(type: string): type is GitObjectType {
  return VALID_TYPES.includes(type as GitObjectType)
}

/**
 * Assert that a value is a valid git object type, throwing if not
 *
 * @param type - String to validate
 * @throws GitObjectFormatError if type is not valid
 *
 * @example
 * ```typescript
 * assertGitObjectType(userInput) // throws if invalid
 * // TypeScript now knows userInput is GitObjectType
 * ```
 */
export function assertGitObjectType(type: string): asserts type is GitObjectType {
  if (!isGitObjectType(type)) {
    throw new GitObjectFormatError(
      `Invalid object type: "${type}". Must be one of: ${VALID_TYPES.join(', ')}`,
      'INVALID_TYPE',
      { providedType: type, validTypes: [...VALID_TYPES] }
    )
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Create a git object header: `<type> <size>\0`
 *
 * @param type - Git object type (blob, tree, commit, or tag)
 * @param size - Content size in bytes (non-negative integer)
 * @returns Encoded header as Uint8Array
 *
 * @example
 * ```typescript
 * const header = createHeader('blob', 5)
 * // Returns: Uint8Array of "blob 5\0"
 * ```
 */
export function createHeader(type: string, size: number): Uint8Array {
  // Validate type at runtime for safety (allows any string for flexibility,
  // but consumers should use GitObjectType for type safety)
  if (!type || type.includes(' ') || type.includes('\0')) {
    throw new GitObjectFormatError(
      'Invalid type: must be non-empty and cannot contain spaces or null bytes',
      'INVALID_TYPE',
      { providedType: type }
    )
  }

  // Validate size
  if (!Number.isInteger(size) || size < 0) {
    throw new GitObjectFormatError(
      `Invalid size: must be a non-negative integer, got ${size}`,
      'INVALID_SIZE',
      { providedSize: size }
    )
  }

  const headerString = `${type} ${size}\0`
  return encoder.encode(headerString)
}

/**
 * Parse a git object header from data
 *
 * Parses the git object header format: `<type> <size>\0`
 * Uses zero-copy parsing by working directly with byte indices.
 *
 * @param data - Raw git object data (header + content)
 * @returns Parsed header with type, size, and content offset
 * @throws GitObjectFormatError for malformed headers
 *
 * @example
 * ```typescript
 * const data = new Uint8Array([...]) // "blob 5\0hello"
 * const header = parseHeader(data)
 * // { type: 'blob', size: 5, contentOffset: 7 }
 * ```
 */
export function parseHeader(data: Uint8Array): GitObjectHeader {
  // Check for empty data
  if (data.length === 0) {
    throw new GitObjectFormatError(
      'Cannot parse header: empty data',
      'EMPTY_DATA',
      { dataLength: 0 }
    )
  }

  // Find the null byte terminator (zero-copy: just scan indices)
  const nullIndex = data.indexOf(0x00)
  if (nullIndex === -1) {
    throw new GitObjectFormatError(
      'Invalid git object: missing null byte terminator after header. ' +
        `Expected format: "<type> <size>\\0<content>". Got ${Math.min(data.length, 50)} bytes without null byte.`,
      'MISSING_NULL_BYTE',
      { dataLength: data.length, preview: previewBytes(data, 50) }
    )
  }

  // Decode the header string (only decode up to null byte, not full data)
  const headerString = decoder.decode(data.subarray(0, nullIndex))

  // Find the space separator
  const spaceIndex = headerString.indexOf(' ')
  if (spaceIndex === -1) {
    throw new GitObjectFormatError(
      `Invalid git object header: missing space separator between type and size. ` +
        `Expected format: "<type> <size>\\0", got: "${headerString}"`,
      'MISSING_SPACE',
      { header: headerString }
    )
  }

  const type = headerString.slice(0, spaceIndex)
  const sizeString = headerString.slice(spaceIndex + 1)

  // Validate type using the type guard
  if (!isGitObjectType(type)) {
    throw new GitObjectFormatError(
      `Invalid object type: "${type}". Must be one of: ${VALID_TYPES.join(', ')}`,
      'INVALID_TYPE',
      { providedType: type, validTypes: [...VALID_TYPES] }
    )
  }

  // Validate and parse size (must be digits only)
  if (!/^\d+$/.test(sizeString)) {
    throw new GitObjectFormatError(
      `Invalid size in header: "${sizeString}". Size must be a non-negative decimal integer.`,
      'INVALID_SIZE',
      { sizeString, header: headerString }
    )
  }

  const size = parseInt(sizeString, 10)
  if (!Number.isFinite(size)) {
    throw new GitObjectFormatError(
      `Invalid size in header: "${sizeString}" parsed to ${size}. Size must be a finite number.`,
      'INVALID_SIZE',
      { sizeString, parsedSize: size }
    )
  }

  return {
    type,
    size,
    contentOffset: nullIndex + 1,
  }
}

/**
 * Create a preview of bytes for error messages
 */
function previewBytes(data: Uint8Array, maxBytes: number): string {
  const slice = data.subarray(0, Math.min(data.length, maxBytes))
  // Try to decode as text, fall back to hex
  try {
    const text = decoder.decode(slice)
    // If it contains unprintable characters, show hex
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) {
      return Array.from(slice)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ')
    }
    return text
  } catch {
    return Array.from(slice)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ')
  }
}

/**
 * Create a full git object (header + content)
 *
 * Combines a git object header with content to create a complete git object.
 * The result can be hashed with SHA-1 to get the object ID.
 *
 * @param type - Git object type (blob, tree, commit, or tag)
 * @param content - Object content as Uint8Array
 * @returns Complete git object as Uint8Array: `<type> <size>\0<content>`
 *
 * @example
 * ```typescript
 * const content = new TextEncoder().encode('hello')
 * const object = createGitObject('blob', content)
 * // Result: Uint8Array of "blob 5\0hello"
 *
 * // Compute the git hash
 * const hash = await sha1(object)
 * ```
 */
export function createGitObject(type: string, content: Uint8Array): Uint8Array {
  const header = createHeader(type, content.length)
  const result = new Uint8Array(header.length + content.length)
  result.set(header)
  result.set(content, header.length)
  return result
}

/**
 * Parse a full git object and return type and content
 *
 * Parses a complete git object, validating the header and extracting content.
 * Uses zero-copy where possible by returning a subarray view of the original data.
 *
 * @param data - Complete git object data: `<type> <size>\0<content>`
 * @returns Parsed object with validated type and content
 * @throws GitObjectFormatError for malformed objects or size mismatches
 *
 * @example
 * ```typescript
 * const data = new Uint8Array([...]) // "blob 5\0hello"
 * const obj = parseGitObject(data)
 * console.log(obj.type) // 'blob'
 * console.log(new TextDecoder().decode(obj.content)) // 'hello'
 * ```
 */
export function parseGitObject(data: Uint8Array): ParsedGitObject {
  const { type, size, contentOffset } = parseHeader(data)

  const actualContentLength = data.length - contentOffset
  if (actualContentLength !== size) {
    throw new GitObjectFormatError(
      `Content size mismatch: header declares ${size} bytes, but actual content is ${actualContentLength} bytes. ` +
        `Object may be truncated or corrupted.`,
      'SIZE_MISMATCH',
      {
        declaredSize: size,
        actualSize: actualContentLength,
        totalLength: data.length,
        headerLength: contentOffset,
      }
    )
  }

  // Use subarray for zero-copy view (no memory allocation for large objects)
  // Note: If the caller modifies the original data, this view will reflect changes
  const content = data.subarray(contentOffset)

  return {
    type,
    content,
  }
}
