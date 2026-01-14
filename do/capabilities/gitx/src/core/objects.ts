/**
 * @fileoverview Git Object Types and Serialization (Platform Agnostic)
 *
 * Re-exports from the core objects module with backward compatibility layer.
 *
 * @module @dotdo/gitx/objects
 */

// Re-export everything from the core objects module
export {
  // Core Classes
  GitBlob,
  GitTree,
  GitCommit,
  GitTag,

  // Tree utilities
  sortTreeEntries,
  parseTreeEntries,
  serializeTreeEntries,
  type TreeEntry,

  // Commit utilities
  parseIdentity,
  formatIdentity,
  hasGpgSignature,
  parseGpgSignature,
  type GitIdentity,

  // Types
  type ObjectType,
  type GitObjectData,
  type BlobData,
  type TreeData,
  type CommitData,
  type TagData,

  // Constants
  OBJECT_TYPES,
  VALID_MODES,

  // Validation
  isValidSha,
  isValidMode,
  isValidObjectType,

  // Hash utilities
  calculateSha1,
  calculateObjectHash,
  createObjectHeader,
  parseObjectHeader,
  bytesToHex,
  hexToBytes,

  // Loose object format
  compressObject,
  decompressObject,
  writeLooseObject,
  readLooseObject,

  // Object type detection
  detectObjectType,
  parseGitObject,
  createGitObject,
} from '../../core/objects'

// ============================================================================
// Legacy API Compatibility Layer
// ============================================================================

// For backward compatibility with the old API, we provide type aliases and
// adapter functions that map to the new class-based API.

import {
  GitBlob,
  GitTree,
  GitCommit,
  GitTag,
  isValidSha,
  isValidMode,
  isValidObjectType,
  VALID_MODES,
  type ObjectType as CoreObjectType,
  type TreeEntry as CoreTreeEntry,
  type GitIdentity,
} from '../../core/objects'

/**
 * Base interface for all Git objects.
 * @deprecated Use GitBlob, GitTree, GitCommit, or GitTag classes instead
 */
export interface GitObject {
  type: CoreObjectType
  data: Uint8Array
}

/**
 * A Git blob object representing raw file content.
 * @deprecated Use GitBlob class instead
 */
export interface BlobObject extends GitObject {
  type: 'blob'
}

/**
 * A Git tree object representing a directory.
 * @deprecated Use GitTree class instead
 */
export interface TreeObject extends GitObject {
  type: 'tree'
  entries: CoreTreeEntry[]
}

/**
 * Author/committer/tagger information.
 */
export interface Author {
  name: string
  email: string
  timestamp: number
  timezone: string
}

/**
 * A Git commit object representing a snapshot in history.
 * @deprecated Use GitCommit class instead
 */
export interface CommitObject extends GitObject {
  type: 'commit'
  tree: string
  parents: string[]
  author: Author
  committer: Author
  message: string
}

/**
 * A Git tag object (annotated tag).
 * @deprecated Use GitTag class instead
 */
export interface TagObject extends GitObject {
  type: 'tag'
  object: string
  objectType: CoreObjectType
  tagger?: Author
  message: string
  name: string
  tag?: string
}

/**
 * Valid SHA-1 hash pattern (40 lowercase hexadecimal characters).
 */
export const SHA_PATTERN = /^[0-9a-f]{40}$/

// ============================================================================
// Legacy Serialization Functions (Backward Compatible)
// ============================================================================

/**
 * Serialize blob data to Git object format.
 * @deprecated Use new GitBlob(data).serialize() instead
 */
export function serializeBlob(data: Uint8Array): Uint8Array {
  const blob = new GitBlob(data)
  return blob.serialize()
}

/**
 * Serialize tree entries to Git object format.
 * @deprecated Use new GitTree(entries).serialize() instead
 */
export function serializeTree(entries: CoreTreeEntry[]): Uint8Array {
  const tree = new GitTree(entries)
  return tree.serialize()
}

/**
 * Serialize commit to Git object format.
 * @deprecated Use new GitCommit(data).serialize() instead
 */
export function serializeCommit(commit: Omit<CommitObject, 'type' | 'data'>): Uint8Array {
  const gitCommit = new GitCommit({
    tree: commit.tree,
    parents: commit.parents,
    author: commit.author as GitIdentity,
    committer: commit.committer as GitIdentity,
    message: commit.message,
  })
  return gitCommit.serialize()
}

/**
 * Serialize tag to Git object format.
 * @deprecated Use new GitTag(data).serialize() instead
 */
export function serializeTag(tag: Omit<TagObject, 'type' | 'data'>): Uint8Array {
  const gitTag = new GitTag({
    object: tag.object,
    objectType: tag.objectType,
    name: tag.name,
    tagger: tag.tagger as GitIdentity | undefined,
    message: tag.message,
  })
  return gitTag.serialize()
}

// ============================================================================
// Legacy Parsing Functions (Backward Compatible)
// ============================================================================

/**
 * Parse blob from serialized format.
 * @deprecated Use GitBlob.parse(data) instead
 */
export function parseBlob(data: Uint8Array): BlobObject {
  const blob = GitBlob.parse(data)
  return {
    type: 'blob',
    data: blob.content,
  }
}

/**
 * Parse tree from serialized format.
 * @deprecated Use GitTree.parse(data) instead
 */
export function parseTree(data: Uint8Array): TreeObject {
  const tree = GitTree.parse(data)
  return {
    type: 'tree',
    data: tree.serialize(),
    entries: [...tree.entries],
  }
}

/**
 * Parse commit from serialized format.
 * @deprecated Use GitCommit.parse(data) instead
 */
export function parseCommit(data: Uint8Array): CommitObject {
  const commit = GitCommit.parse(data)
  return {
    type: 'commit',
    data: commit.serialize(),
    tree: commit.tree,
    parents: [...(commit.parents || [])],
    author: commit.author as Author,
    committer: commit.committer as Author,
    message: commit.message,
  }
}

/**
 * Parse tag from serialized format.
 * @deprecated Use GitTag.parse(data) instead
 */
export function parseTag(data: Uint8Array): TagObject {
  const tag = GitTag.parse(data)
  return {
    type: 'tag',
    data: tag.serialize(),
    object: tag.object,
    objectType: tag.objectType,
    name: tag.name,
    tagger: tag.tagger as Author | undefined,
    message: tag.message,
  }
}

// ============================================================================
// Type Guards
// ============================================================================

export function isBlob(obj: GitObject): obj is BlobObject {
  return obj.type === 'blob'
}

export function isTree(obj: GitObject): obj is TreeObject {
  return obj.type === 'tree'
}

export function isCommit(obj: GitObject): obj is CommitObject {
  return obj.type === 'commit'
}

export function isTag(obj: GitObject): obj is TagObject {
  return obj.type === 'tag'
}

// ============================================================================
// Validation Helpers (Legacy)
// ============================================================================

/**
 * Validate a tree entry object.
 */
export function validateTreeEntry(entry: CoreTreeEntry): { isValid: boolean; error?: string } {
  if (!isValidMode(entry.mode)) {
    return { isValid: false, error: `Invalid mode: ${entry.mode}. Valid modes: ${Array.from(VALID_MODES).join(', ')}` }
  }
  if (!entry.name || typeof entry.name !== 'string') {
    return { isValid: false, error: 'Entry name is required and must be a string' }
  }
  if (entry.name.includes('/') || entry.name.includes('\0')) {
    return { isValid: false, error: 'Entry name cannot contain "/" or null characters' }
  }
  if (!isValidSha(entry.sha)) {
    return { isValid: false, error: `Invalid SHA: ${entry.sha}. Must be 40 lowercase hex characters` }
  }
  return { isValid: true }
}

/**
 * Validate an author object.
 */
export function validateAuthor(author: Author): { isValid: boolean; error?: string } {
  if (!author.name || typeof author.name !== 'string') {
    return { isValid: false, error: 'Author name is required and must be a string' }
  }
  if (!author.email || typeof author.email !== 'string') {
    return { isValid: false, error: 'Author email is required and must be a string' }
  }
  if (typeof author.timestamp !== 'number' || !Number.isInteger(author.timestamp) || author.timestamp < 0) {
    return { isValid: false, error: 'Timestamp must be a non-negative integer (Unix seconds)' }
  }
  if (!/^[+-]\d{4}$/.test(author.timezone)) {
    return { isValid: false, error: `Invalid timezone format: ${author.timezone}. Expected +/-HHMM (e.g., +0530, -0800)` }
  }
  return { isValid: true }
}

/**
 * Validate a commit object (excluding type and data fields).
 */
export function validateCommit(commit: Omit<CommitObject, 'type' | 'data'>): { isValid: boolean; error?: string } {
  if (!isValidSha(commit.tree)) {
    return { isValid: false, error: `Invalid tree SHA: ${commit.tree}` }
  }
  for (let i = 0; i < commit.parents.length; i++) {
    if (!isValidSha(commit.parents[i])) {
      return { isValid: false, error: `Invalid parent SHA at index ${i}: ${commit.parents[i]}` }
    }
  }
  const authorResult = validateAuthor(commit.author)
  if (!authorResult.isValid) {
    return { isValid: false, error: `Invalid author: ${authorResult.error}` }
  }
  const committerResult = validateAuthor(commit.committer)
  if (!committerResult.isValid) {
    return { isValid: false, error: `Invalid committer: ${committerResult.error}` }
  }
  if (typeof commit.message !== 'string') {
    return { isValid: false, error: 'Commit message must be a string' }
  }
  return { isValid: true }
}

/**
 * Validate a tag object (excluding type and data fields).
 */
export function validateTag(tag: Omit<TagObject, 'type' | 'data'>): { isValid: boolean; error?: string } {
  if (!isValidSha(tag.object)) {
    return { isValid: false, error: `Invalid object SHA: ${tag.object}` }
  }
  if (!isValidObjectType(tag.objectType)) {
    return { isValid: false, error: `Invalid object type: ${tag.objectType}` }
  }
  if (!tag.name || typeof tag.name !== 'string') {
    return { isValid: false, error: 'Tag name is required and must be a string' }
  }
  if (tag.tagger) {
    const taggerResult = validateAuthor(tag.tagger)
    if (!taggerResult.isValid) {
      return { isValid: false, error: `Invalid tagger: ${taggerResult.error}` }
    }
  }
  if (typeof tag.message !== 'string') {
    return { isValid: false, error: 'Tag message must be a string' }
  }
  return { isValid: true }
}
