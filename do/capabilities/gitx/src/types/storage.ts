/**
 * @fileoverview Storage Interface Types
 *
 * This module defines the canonical interfaces for object storage and commit providers.
 * All storage-related interfaces are defined here as the single source of truth.
 *
 * The interfaces follow a layered design:
 * - {@link BasicObjectStore} - Core object CRUD operations
 * - {@link RefObjectStore} - Adds ref management capabilities
 * - {@link TreeDiffObjectStore} - Specialized for tree diff operations
 * - {@link ObjectStore} - Full-featured store combining all capabilities
 *
 * Similarly for commit providers:
 * - {@link BasicCommitProvider} - Core commit retrieval
 * - {@link CommitProvider} - Extended with path filtering and tree access
 *
 * @module types/storage
 *
 * @example
 * ```typescript
 * import type { ObjectStore, CommitProvider } from './types/storage'
 *
 * // Implement a storage backend
 * class MyObjectStore implements ObjectStore {
 *   async getObject(sha: string) { ... }
 *   async storeObject(type: string, data: Uint8Array) { ... }
 *   // ... other methods
 * }
 * ```
 */

import type { CommitObject, TreeObject } from './objects'
import { isValidSha, isValidObjectType } from './objects'

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validation result type.
 *
 * @description
 * Standard result type for validation functions.
 * Contains isValid boolean and optional error message.
 */
export interface ValidationResult {
  /** Whether validation passed */
  isValid: boolean
  /** Error message if validation failed */
  error?: string
}

/**
 * Validate a ref name.
 *
 * @description
 * Checks if a ref name follows Git ref naming conventions:
 * - Cannot start with '.' or end with '/'
 * - Cannot contain '..' or '//'
 * - Cannot contain control characters, spaces, or special chars
 * - Cannot end with '.lock'
 *
 * @param refName - The ref name to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * validateRefName('refs/heads/main') // { isValid: true }
 * validateRefName('refs/heads/../foo') // { isValid: false, error: '...' }
 * ```
 */
export function validateRefName(refName: string): ValidationResult {
  if (!refName || typeof refName !== 'string') {
    return { isValid: false, error: 'Ref name is required and must be a string' }
  }
  if (refName.startsWith('.') || refName.startsWith('/')) {
    return { isValid: false, error: 'Ref name cannot start with "." or "/"' }
  }
  if (refName.endsWith('/') || refName.endsWith('.')) {
    return { isValid: false, error: 'Ref name cannot end with "/" or "."' }
  }
  if (refName.includes('..')) {
    return { isValid: false, error: 'Ref name cannot contain ".."' }
  }
  if (refName.includes('//')) {
    return { isValid: false, error: 'Ref name cannot contain "//"' }
  }
  if (refName.endsWith('.lock')) {
    return { isValid: false, error: 'Ref name cannot end with ".lock"' }
  }
  // Check for control characters and special chars
  if (/[\x00-\x1f\x7f ~^:?*\[\\]/.test(refName)) {
    return { isValid: false, error: 'Ref name contains invalid characters (control chars, space, ~, ^, :, ?, *, [, or \\)' }
  }
  return { isValid: true }
}

/**
 * Validate a ref update operation.
 *
 * @description
 * Validates a reference update operation including:
 * - Ref name format
 * - Old and new SHA validity (or zero SHA for create/delete)
 *
 * @param refName - The ref name to update
 * @param oldSha - The expected current SHA (or zero SHA if creating)
 * @param newSha - The new SHA to set (or zero SHA if deleting)
 * @returns Validation result
 *
 * @example
 * ```typescript
 * // Creating a new ref
 * validateRefUpdate('refs/heads/feature', ZERO_SHA, 'abc123...')
 *
 * // Updating a ref
 * validateRefUpdate('refs/heads/main', 'old123...', 'new456...')
 *
 * // Deleting a ref
 * validateRefUpdate('refs/heads/old', 'abc123...', ZERO_SHA)
 * ```
 */
export function validateRefUpdate(refName: string, oldSha: string, newSha: string): ValidationResult {
  const refResult = validateRefName(refName)
  if (!refResult.isValid) {
    return refResult
  }

  const ZERO_SHA = '0000000000000000000000000000000000000000'

  if (oldSha !== ZERO_SHA && !isValidSha(oldSha)) {
    return { isValid: false, error: `Invalid old SHA: ${oldSha}. Must be 40 hex chars or zero SHA` }
  }
  if (newSha !== ZERO_SHA && !isValidSha(newSha)) {
    return { isValid: false, error: `Invalid new SHA: ${newSha}. Must be 40 hex chars or zero SHA` }
  }
  if (oldSha === ZERO_SHA && newSha === ZERO_SHA) {
    return { isValid: false, error: 'Cannot have both old and new SHA as zero (no-op)' }
  }
  return { isValid: true }
}

/**
 * Validate object storage parameters.
 *
 * @description
 * Validates parameters for storeObject operations:
 * - Object type must be valid
 * - Data must be a Uint8Array
 *
 * @param type - The object type
 * @param data - The object data
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateStoreParams('blob', new Uint8Array([1, 2, 3]))
 * if (!result.isValid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export function validateStoreParams(type: string, data: Uint8Array): ValidationResult {
  if (!isValidObjectType(type)) {
    return { isValid: false, error: `Invalid object type: ${type}. Must be blob, tree, commit, or tag` }
  }
  if (!(data instanceof Uint8Array)) {
    return { isValid: false, error: 'Data must be a Uint8Array' }
  }
  return { isValid: true }
}

/**
 * Assert that a SHA is valid, throwing if not.
 *
 * @description
 * Throws a descriptive error if the SHA is invalid.
 * Use this for input validation in API boundaries.
 *
 * @param sha - The SHA to validate
 * @param context - Optional context for the error message (e.g., 'tree', 'parent')
 * @throws Error if SHA is invalid
 *
 * @example
 * ```typescript
 * assertValidSha(treeSha, 'tree') // Throws: "Invalid tree SHA: ..."
 * ```
 */
export function assertValidSha(sha: string, context?: string): void {
  if (!isValidSha(sha)) {
    const prefix = context ? `Invalid ${context} SHA` : 'Invalid SHA'
    throw new Error(`${prefix}: ${sha}. Must be 40 lowercase hexadecimal characters`)
  }
}

/**
 * Assert that a ref name is valid, throwing if not.
 *
 * @description
 * Throws a descriptive error if the ref name is invalid.
 * Use this for input validation in API boundaries.
 *
 * @param refName - The ref name to validate
 * @throws Error if ref name is invalid
 *
 * @example
 * ```typescript
 * assertValidRefName('refs/heads/main') // OK
 * assertValidRefName('refs/../bad') // Throws
 * ```
 */
export function assertValidRefName(refName: string): void {
  const result = validateRefName(refName)
  if (!result.isValid) {
    throw new Error(result.error)
  }
}

// ============================================================================
// Object Storage Interfaces
// ============================================================================

/**
 * Full-featured interface for Git object storage operations.
 *
 * @description
 * This is the canonical ObjectStore interface that combines all required
 * methods from various modules. Implementations should provide all methods.
 *
 * The interface is organized into three groups:
 * 1. **Core object operations**: Basic CRUD for Git objects
 * 2. **Ref operations**: Managing references (branches, tags, HEAD)
 * 3. **Typed accessors**: Convenient methods for specific object types
 *
 * @example
 * ```typescript
 * const store: ObjectStore = new DurableObjectStore(storage)
 *
 * // Store a blob
 * const sha = await store.storeObject('blob', content)
 *
 * // Retrieve it
 * const obj = await store.getObject(sha)
 *
 * // Work with refs
 * await store.setRef('refs/heads/main', sha)
 * const mainSha = await store.getRef('refs/heads/main')
 * ```
 */
export interface ObjectStore {
  // ─────────────────────────────────────────────────────────────────────────
  // Core object operations (from commit.ts, tag.ts, tree-builder.ts)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Retrieve a Git object by its SHA-1 hash.
   *
   * @description
   * Fetches the raw object data and type for the given SHA.
   * Returns null if the object does not exist.
   *
   * @param sha - 40-character hexadecimal SHA-1 hash
   * @returns The object with type and data, or null if not found
   *
   * @example
   * ```typescript
   * const obj = await store.getObject('abc123...')
   * if (obj) {
   *   console.log(`Type: ${obj.type}, Size: ${obj.data.length}`)
   * }
   * ```
   */
  getObject(sha: string): Promise<{ type: string; data: Uint8Array } | null>

  /**
   * Store a Git object and return its SHA-1 hash.
   *
   * @description
   * Computes the SHA-1 hash of the object in Git format (type + size + content)
   * and stores it. If an object with the same SHA already exists, this is a no-op.
   *
   * @param type - Object type ('blob', 'tree', 'commit', 'tag')
   * @param data - Raw object content (without Git header)
   * @returns The 40-character SHA-1 hash of the stored object
   *
   * @example
   * ```typescript
   * const content = new TextEncoder().encode('Hello, World!')
   * const sha = await store.storeObject('blob', content)
   * console.log(`Stored blob: ${sha}`)
   * ```
   */
  storeObject(type: string, data: Uint8Array): Promise<string>

  /**
   * Check if an object exists in the store.
   *
   * @description
   * Efficiently checks for object existence without fetching the full content.
   *
   * @param sha - 40-character hexadecimal SHA-1 hash
   * @returns True if the object exists, false otherwise
   *
   * @example
   * ```typescript
   * if (await store.hasObject(sha)) {
   *   console.log('Object exists')
   * }
   * ```
   */
  hasObject(sha: string): Promise<boolean>

  // ─────────────────────────────────────────────────────────────────────────
  // Ref operations (from tag.ts)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a reference by its name.
   *
   * @description
   * Retrieves the SHA-1 that a ref points to. For symbolic refs,
   * this returns the resolved SHA (following the chain).
   *
   * @param refName - Full ref name (e.g., 'refs/heads/main', 'HEAD')
   * @returns The SHA-1 hash the ref points to, or null if not found
   *
   * @example
   * ```typescript
   * const mainSha = await store.getRef('refs/heads/main')
   * const headSha = await store.getRef('HEAD')
   * ```
   */
  getRef(refName: string): Promise<string | null>

  /**
   * Set a reference to point to a SHA.
   *
   * @description
   * Creates or updates a ref to point to the given SHA.
   * For atomic operations, consider using compare-and-swap patterns.
   *
   * @param refName - Full ref name (e.g., 'refs/heads/main')
   * @param sha - 40-character SHA-1 hash to point to
   *
   * @example
   * ```typescript
   * await store.setRef('refs/heads/feature', commitSha)
   * ```
   */
  setRef(refName: string, sha: string): Promise<void>

  /**
   * Delete a reference.
   *
   * @description
   * Removes a ref from storage. Returns true if the ref existed
   * and was deleted, false if it didn't exist.
   *
   * @param refName - Full ref name to delete
   * @returns True if deleted, false if ref didn't exist
   *
   * @example
   * ```typescript
   * const deleted = await store.deleteRef('refs/heads/old-branch')
   * ```
   */
  deleteRef(refName: string): Promise<boolean>

  /**
   * List references with a given prefix.
   *
   * @description
   * Returns all refs that start with the given prefix.
   * Commonly used to list branches or tags.
   *
   * @param prefix - Prefix to filter refs (e.g., 'refs/heads/', 'refs/tags/')
   * @returns Array of ref names and their SHA targets
   *
   * @example
   * ```typescript
   * // List all branches
   * const branches = await store.listRefs('refs/heads/')
   * for (const { name, sha } of branches) {
   *   console.log(`${name} -> ${sha}`)
   * }
   *
   * // List all tags
   * const tags = await store.listRefs('refs/tags/')
   * ```
   */
  listRefs(prefix: string): Promise<Array<{ name: string; sha: string }>>

  // ─────────────────────────────────────────────────────────────────────────
  // Typed object accessors (from tree-diff.ts)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a tree object by SHA.
   *
   * @description
   * Retrieves and parses a tree object, returning it with parsed entries.
   * Returns null if the object doesn't exist or isn't a tree.
   *
   * @param sha - 40-character SHA-1 of the tree
   * @returns Parsed TreeObject or null
   *
   * @example
   * ```typescript
   * const tree = await store.getTree(treeSha)
   * if (tree) {
   *   for (const entry of tree.entries) {
   *     console.log(`${entry.mode} ${entry.name}`)
   *   }
   * }
   * ```
   */
  getTree(sha: string): Promise<TreeObject | null>

  /**
   * Get blob content by SHA.
   *
   * @description
   * Retrieves the raw content of a blob object.
   * Returns null if the object doesn't exist or isn't a blob.
   *
   * @param sha - 40-character SHA-1 of the blob
   * @returns Raw blob content or null
   *
   * @example
   * ```typescript
   * const content = await store.getBlob(blobSha)
   * if (content) {
   *   const text = new TextDecoder().decode(content)
   * }
   * ```
   */
  getBlob(sha: string): Promise<Uint8Array | null>

  /**
   * Check if an object exists (alias for hasObject).
   *
   * @description
   * Convenience alias for hasObject, commonly used in tree diff operations.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns True if the object exists
   */
  exists(sha: string): Promise<boolean>
}

/**
 * Minimal ObjectStore interface for basic operations.
 *
 * @description
 * Use this interface when only core object operations are needed,
 * without ref management or typed accessors. This is useful for
 * modules that only need to read/write raw objects.
 *
 * @example
 * ```typescript
 * function processObjects(store: BasicObjectStore) {
 *   const obj = await store.getObject(sha)
 *   if (obj) {
 *     // Process the object
 *     await store.storeObject('blob', processedData)
 *   }
 * }
 * ```
 */
export interface BasicObjectStore {
  /**
   * Get an object by SHA.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Object with type and data, or null if not found
   */
  getObject(sha: string): Promise<{ type: string; data: Uint8Array } | null>

  /**
   * Store an object and return its SHA.
   *
   * @param type - Object type ('blob', 'tree', 'commit', 'tag')
   * @param data - Raw object content
   * @returns 40-character SHA-1 hash of the stored object
   */
  storeObject(type: string, data: Uint8Array): Promise<string>

  /**
   * Check if an object exists.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns True if the object exists
   */
  hasObject(sha: string): Promise<boolean>
}

/**
 * ObjectStore with ref management capabilities.
 *
 * @description
 * Extends BasicObjectStore with ref operations needed for tag management
 * and branch operations. Use this when you need both object storage
 * and reference management.
 *
 * @example
 * ```typescript
 * async function createTag(store: RefObjectStore, name: string, target: string) {
 *   // Store the tag object
 *   const tagSha = await store.storeObject('tag', tagData)
 *   // Create the ref
 *   await store.setRef(`refs/tags/${name}`, tagSha)
 * }
 * ```
 */
export interface RefObjectStore extends BasicObjectStore {
  /**
   * Get a ref by name.
   *
   * @param refName - Full ref name (e.g., 'refs/heads/main')
   * @returns SHA-1 hash or null if not found
   */
  getRef(refName: string): Promise<string | null>

  /**
   * Set a ref to point to a SHA.
   *
   * @param refName - Full ref name
   * @param sha - Target SHA-1 hash
   */
  setRef(refName: string, sha: string): Promise<void>

  /**
   * Delete a ref.
   *
   * @param refName - Full ref name to delete
   * @returns True if deleted, false if not found
   */
  deleteRef(refName: string): Promise<boolean>

  /**
   * List refs with a given prefix.
   *
   * @param prefix - Prefix to filter (e.g., 'refs/heads/')
   * @returns Array of ref names and their targets
   */
  listRefs(prefix: string): Promise<Array<{ name: string; sha: string }>>
}

/**
 * ObjectStore specialized for tree diff operations.
 *
 * @description
 * Provides typed accessors for tree and blob objects, optimized for
 * operations that need to traverse and compare directory trees.
 *
 * @example
 * ```typescript
 * async function compareFiles(store: TreeDiffObjectStore, sha1: string, sha2: string) {
 *   const blob1 = await store.getBlob(sha1)
 *   const blob2 = await store.getBlob(sha2)
 *   // Compare contents...
 * }
 * ```
 */
export interface TreeDiffObjectStore {
  /**
   * Get a tree object by SHA.
   *
   * @param sha - 40-character SHA-1 of the tree
   * @returns Parsed TreeObject or null
   */
  getTree(sha: string): Promise<TreeObject | null>

  /**
   * Get blob content by SHA.
   *
   * @param sha - 40-character SHA-1 of the blob
   * @returns Raw content or null
   */
  getBlob(sha: string): Promise<Uint8Array | null>

  /**
   * Check if an object exists.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns True if the object exists
   */
  exists(sha: string): Promise<boolean>
}

// ============================================================================
// Commit Provider Interfaces
// ============================================================================

/**
 * Interface for retrieving commits from storage.
 *
 * @description
 * This is the canonical CommitProvider interface that combines all required
 * methods for commit traversal and history operations. The base getCommit
 * method is required; path filtering and tree access are optional extensions.
 *
 * Used by: commit-traversal.ts, merge-base.ts
 *
 * @example
 * ```typescript
 * async function walkHistory(provider: CommitProvider, startSha: string) {
 *   const commit = await provider.getCommit(startSha)
 *   if (!commit) return
 *
 *   console.log(commit.message)
 *
 *   for (const parentSha of commit.parents) {
 *     await walkHistory(provider, parentSha)
 *   }
 * }
 * ```
 */
export interface CommitProvider {
  /**
   * Get a commit by SHA.
   *
   * @description
   * Retrieves and parses a commit object. This is the core method
   * required for all commit traversal operations.
   *
   * @param sha - 40-character SHA-1 of the commit
   * @returns Parsed CommitObject or null if not found
   *
   * @example
   * ```typescript
   * const commit = await provider.getCommit(sha)
   * if (commit) {
   *   console.log(`${commit.author.name}: ${commit.message}`)
   * }
   * ```
   */
  getCommit(sha: string): Promise<CommitObject | null>

  /**
   * Get commits that modify a specific path.
   *
   * @description
   * Optional method for efficient path-filtered history traversal.
   * Returns commit SHAs that touched the given file or directory path.
   *
   * @param path - File or directory path (relative to repo root)
   * @returns Array of commit SHAs that modified the path
   *
   * @example
   * ```typescript
   * if (provider.getCommitsForPath) {
   *   const commits = await provider.getCommitsForPath('src/index.ts')
   *   console.log(`File modified in ${commits.length} commits`)
   * }
   * ```
   */
  getCommitsForPath?(path: string): Promise<string[]>

  /**
   * Get the tree for a commit.
   *
   * @description
   * Optional method for accessing the tree associated with a commit.
   * Useful for operations that need to examine file contents.
   *
   * @param commitSha - 40-character SHA-1 of the commit
   * @returns The tree structure (implementation-defined format)
   *
   * @example
   * ```typescript
   * if (provider.getTree) {
   *   const tree = await provider.getTree(commitSha)
   *   // Examine tree contents...
   * }
   * ```
   */
  getTree?(commitSha: string): Promise<unknown>
}

/**
 * Minimal CommitProvider interface for basic operations.
 *
 * @description
 * Use this when only the core getCommit method is needed.
 * Suitable for simple commit lookups without path filtering or tree access.
 *
 * @example
 * ```typescript
 * function findMergeBase(provider: BasicCommitProvider, sha1: string, sha2: string) {
 *   // Only needs getCommit for ancestor traversal
 *   const commit1 = await provider.getCommit(sha1)
 *   const commit2 = await provider.getCommit(sha2)
 *   // ... traverse parents
 * }
 * ```
 */
export interface BasicCommitProvider {
  /**
   * Get a commit by SHA.
   *
   * @param sha - 40-character SHA-1 of the commit
   * @returns Parsed CommitObject or null if not found
   */
  getCommit(sha: string): Promise<CommitObject | null>
}
