/**
 * SHA-1 Hash Utilities
 *
 * Provides hash calculation functions compatible with Git's object hashing.
 * Uses the Web Crypto API for SHA-1 calculation.
 */

import type { ObjectType } from './types'

// =============================================================================
// Text Encoding Utilities
// =============================================================================

const encoder = new TextEncoder()

// =============================================================================
// SHA-1 Calculation
// =============================================================================

/**
 * Calculates SHA-1 hash of raw data
 * @param data - The raw bytes to hash
 * @returns Promise resolving to 40-character lowercase hex string
 */
export async function calculateSha1(data: Uint8Array): Promise<string> {
  // Create a new ArrayBuffer to ensure compatibility with crypto.subtle.digest
  // This handles the case where data.buffer might be a SharedArrayBuffer
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  const hashBuffer = await crypto.subtle.digest('SHA-1', buffer)
  const hashArray = new Uint8Array(hashBuffer)
  return bytesToHex(hashArray)
}

/**
 * Calculates Git object hash (includes header: "type size\0content")
 * @param type - The object type (blob, tree, commit, tag)
 * @param content - The object content (without header)
 * @returns Promise resolving to 40-character lowercase hex string
 */
export async function calculateObjectHash(type: ObjectType, content: Uint8Array): Promise<string> {
  const header = createObjectHeader(type, content.length)
  const fullData = new Uint8Array(header.length + content.length)
  fullData.set(header)
  fullData.set(content, header.length)
  return calculateSha1(fullData)
}

// =============================================================================
// Object Header Utilities
// =============================================================================

/**
 * Creates a Git object header: "type size\0"
 * @param type - The object type
 * @param size - The content size in bytes
 * @returns Uint8Array containing the header bytes
 */
export function createObjectHeader(type: ObjectType, size: number): Uint8Array {
  return encoder.encode(`${type} ${size}\0`)
}

/**
 * Parses a Git object header from serialized data
 * @param data - The serialized object data
 * @returns Object with type, size, and headerLength
 * @throws Error if header is invalid
 */
export function parseObjectHeader(data: Uint8Array): { type: ObjectType; size: number; headerLength: number } {
  // Find the null byte
  const nullIndex = data.indexOf(0)
  if (nullIndex === -1) {
    throw new Error('Invalid object: missing null byte in header')
  }

  // Parse header string
  const headerStr = new TextDecoder().decode(data.slice(0, nullIndex))
  const spaceIndex = headerStr.indexOf(' ')
  if (spaceIndex === -1) {
    throw new Error('Invalid object header: missing space')
  }

  const type = headerStr.slice(0, spaceIndex)
  const sizeStr = headerStr.slice(spaceIndex + 1)

  // Validate type
  if (!['blob', 'tree', 'commit', 'tag'].includes(type)) {
    throw new Error(`Invalid object type: ${type}`)
  }

  // Validate size
  const size = parseInt(sizeStr, 10)
  if (isNaN(size) || size < 0 || sizeStr !== size.toString()) {
    throw new Error(`Invalid object size: ${sizeStr}`)
  }

  return {
    type: type as ObjectType,
    size,
    headerLength: nullIndex + 1,
  }
}

// =============================================================================
// Hex Conversion Utilities
// =============================================================================

/**
 * Converts a Uint8Array to lowercase hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Converts a hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}
