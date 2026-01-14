/**
 * Git Object Model
 *
 * This module exports all Git object classes and utilities:
 * - GitBlob: File content storage
 * - GitTree: Directory structure
 * - GitCommit: Commit metadata and history
 * - GitTag: Annotated tags
 * - Hash utilities: SHA-1 calculation
 * - Loose object format: Zlib compression
 */

// =============================================================================
// Core Classes
// =============================================================================

export { GitBlob } from './blob'
export { GitTree, sortTreeEntries, parseTreeEntries, serializeTreeEntries } from './tree'
export type { TreeEntry } from './tree'
export { GitCommit, parseIdentity, formatIdentity, hasGpgSignature, parseGpgSignature } from './commit'
export type { GitIdentity } from './commit'
export { GitTag } from './tag'

// =============================================================================
// Types and Constants
// =============================================================================

export { OBJECT_TYPES, VALID_MODES, isValidSha, isValidMode, isValidObjectType } from './types'
export type { ObjectType, GitObjectData, BlobData, TreeData, CommitData, TagData } from './types'

// =============================================================================
// Hash Utilities
// =============================================================================

export {
  calculateSha1,
  calculateObjectHash,
  createObjectHeader,
  parseObjectHeader,
  bytesToHex,
  hexToBytes,
} from './hash'

// =============================================================================
// Loose Object Format (Zlib Compression)
// =============================================================================

import pako from 'pako'
import { GitBlob } from './blob'
import { GitTree } from './tree'
import { GitCommit } from './commit'
import { GitTag } from './tag'
import { parseObjectHeader } from './hash'
import type { ObjectType } from './types'

/**
 * Compresses data using zlib deflate
 */
export async function compressObject(data: Uint8Array): Promise<Uint8Array> {
  return pako.deflate(data)
}

/**
 * Decompresses zlib-compressed data
 * @throws Error if decompression fails (invalid or truncated data)
 */
export async function decompressObject(data: Uint8Array): Promise<Uint8Array> {
  try {
    const result = pako.inflate(data)
    if (!result || result.length === 0) {
      throw new Error('Decompression produced empty result')
    }
    return result
  } catch (e) {
    throw new Error(`Failed to decompress object: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Prepares a Git object for writing as a loose object
 * @returns Object with path and compressed data
 */
export async function writeLooseObject(
  obj: GitBlob | GitTree | GitCommit | GitTag
): Promise<{ path: string; data: Uint8Array }> {
  const serialized = obj.serialize()
  const hash = await obj.hash()
  const compressed = await compressObject(serialized)

  // Path: objects/<first-2-chars>/<remaining-38-chars>
  const path = `objects/${hash.slice(0, 2)}/${hash.slice(2)}`

  return { path, data: compressed }
}

/**
 * Reads and parses a compressed loose object
 */
export async function readLooseObject(
  compressedData: Uint8Array
): Promise<GitBlob | GitTree | GitCommit | GitTag> {
  const decompressed = await decompressObject(compressedData)
  return parseGitObject(decompressed)
}

// =============================================================================
// Object Type Detection and Parsing
// =============================================================================

/**
 * Detects the object type from serialized data
 */
export function detectObjectType(data: Uint8Array): ObjectType {
  const { type } = parseObjectHeader(data)
  return type
}

/**
 * Parses any Git object from serialized format
 */
export function parseGitObject(data: Uint8Array): GitBlob | GitTree | GitCommit | GitTag {
  const type = detectObjectType(data)

  switch (type) {
    case 'blob':
      return GitBlob.parse(data)
    case 'tree':
      return GitTree.parse(data)
    case 'commit':
      return GitCommit.parse(data)
    case 'tag':
      return GitTag.parse(data)
  }
}

// =============================================================================
// Object Factory
// =============================================================================

import type { BlobData, TreeData, CommitData, TagData } from './types'

/**
 * Creates a Git object from type and data
 */
export function createGitObject(type: 'blob', data: BlobData): GitBlob
export function createGitObject(type: 'tree', data: TreeData): GitTree
export function createGitObject(type: 'commit', data: CommitData): GitCommit
export function createGitObject(type: 'tag', data: TagData): GitTag
export function createGitObject(
  type: ObjectType,
  data: BlobData | TreeData | CommitData | TagData
): GitBlob | GitTree | GitCommit | GitTag {
  switch (type) {
    case 'blob':
      return new GitBlob((data as BlobData).content)
    case 'tree':
      return new GitTree((data as TreeData).entries)
    case 'commit':
      return new GitCommit(data as CommitData)
    case 'tag':
      return new GitTag(data as TagData)
  }
}
