/**
 * Git Blob Object
 *
 * Represents a Git blob object which stores file content.
 * Format: "blob <size>\0<content>"
 */

import { calculateObjectHash, createObjectHeader, parseObjectHeader } from './hash'

// =============================================================================
// Text Encoding Utilities
// =============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// =============================================================================
// GitBlob Class
// =============================================================================

/**
 * Git blob object - stores raw file content
 */
export class GitBlob {
  readonly type = 'blob' as const
  readonly content: Uint8Array

  /**
   * Creates a new GitBlob from raw content
   * @param content - The raw file content as bytes
   */
  constructor(content: Uint8Array) {
    this.content = content
  }

  /**
   * Creates a GitBlob from a string
   * @param str - The string content
   */
  static fromString(str: string): GitBlob {
    return new GitBlob(encoder.encode(str))
  }

  /**
   * Parses a GitBlob from serialized Git object format
   * @param data - The serialized data including header
   * @throws Error if the header is invalid or type is not blob
   */
  static parse(data: Uint8Array): GitBlob {
    let parsed: { type: string; size: number; headerLength: number }
    try {
      parsed = parseObjectHeader(data)
    } catch (e) {
      throw new Error(`Invalid blob header: ${e instanceof Error ? e.message : String(e)}`)
    }

    const { type, size, headerLength } = parsed

    if (type !== 'blob') {
      throw new Error(`Invalid blob header: expected 'blob', got '${type}'`)
    }

    const content = data.slice(headerLength)

    // Validate size matches actual content length
    if (content.length !== size) {
      throw new Error(`Size mismatch: header says ${size} bytes, but content is ${content.length} bytes`)
    }

    return new GitBlob(content)
  }

  /**
   * Returns the size of the content in bytes
   */
  get size(): number {
    return this.content.length
  }

  /**
   * Checks if the blob is empty
   */
  isEmpty(): boolean {
    return this.content.length === 0
  }

  /**
   * Checks if the content appears to be binary (contains null bytes)
   */
  isBinary(): boolean {
    return this.content.includes(0)
  }

  /**
   * Converts the content to a string (UTF-8)
   */
  toString(): string {
    return decoder.decode(this.content)
  }

  /**
   * Serializes the blob to Git object format
   * Format: "blob <size>\0<content>"
   */
  serialize(): Uint8Array {
    const header = createObjectHeader('blob', this.content.length)
    const result = new Uint8Array(header.length + this.content.length)
    result.set(header)
    result.set(this.content, header.length)
    return result
  }

  /**
   * Calculates the SHA-1 hash of this blob object
   * @returns Promise resolving to 40-character hex string
   */
  async hash(): Promise<string> {
    return calculateObjectHash('blob', this.content)
  }
}
