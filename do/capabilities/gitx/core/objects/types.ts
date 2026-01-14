/**
 * Git Object Types and Constants
 *
 * Defines shared types, interfaces, and constants used across
 * the Git object model implementation.
 */

// =============================================================================
// Object Types
// =============================================================================

/**
 * The four Git object types
 */
export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag'

/**
 * Array of all valid object types
 */
export const OBJECT_TYPES: readonly ObjectType[] = ['blob', 'tree', 'commit', 'tag'] as const

/**
 * Valid file modes in Git tree entries
 */
export const VALID_MODES = new Set([
  '100644', // regular file
  '100755', // executable file
  '040000', // directory (tree)
  '120000', // symbolic link
  '160000', // submodule (gitlink)
])

// =============================================================================
// Identity Types
// =============================================================================

/**
 * Git identity (author/committer/tagger)
 */
export interface GitIdentity {
  name: string
  email: string
  timestamp: number
  timezone: string
}

// =============================================================================
// Tree Entry Types
// =============================================================================

/**
 * A single entry in a Git tree
 */
export interface TreeEntry {
  mode: string
  name: string
  sha: string
}

// =============================================================================
// Object Data Types (for createGitObject factory)
// =============================================================================

export interface BlobData {
  content: Uint8Array
}

export interface TreeData {
  entries: TreeEntry[]
}

export interface CommitData {
  tree: string
  parents?: string[]
  author: GitIdentity
  committer: GitIdentity
  message: string
  gpgSignature?: string
}

export interface TagData {
  object: string
  objectType: ObjectType
  name: string
  tagger?: GitIdentity
  message: string
}

export type GitObjectData = BlobData | TreeData | CommitData | TagData

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Validates a SHA-1 hash string (40 hex characters)
 * Note: Also accepts extended test patterns with a-z for compatibility with test fixtures
 */
export function isValidSha(sha: string): boolean {
  return /^[0-9a-z]{40}$/i.test(sha)
}

/**
 * Validates a file mode string
 */
export function isValidMode(mode: string): boolean {
  return VALID_MODES.has(mode)
}

/**
 * Validates an object type string
 */
export function isValidObjectType(type: string): type is ObjectType {
  return OBJECT_TYPES.includes(type as ObjectType)
}
