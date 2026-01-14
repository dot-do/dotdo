/**
 * @fileoverview Storage Backend Interface for Git Operations
 *
 * This module defines the `StorageBackend` interface that abstracts over different
 * storage implementations. It provides a unified API for:
 * - Content-addressable storage (CAS) for Git objects (blobs, trees, commits, tags)
 * - Reference management (branches, tags, HEAD)
 * - Raw file operations (for index, config, and other Git files)
 * - Directory operations
 *
 * **Implementations**:
 * - `FSStorageBackend` - Uses Node.js `fs/promises` for CLI usage
 * - `DOStorageBackend` - Uses SQLite in Durable Objects for cloud deployment
 *
 * @module storage/backend
 *
 * @example
 * ```typescript
 * import { StorageBackend } from './storage/backend'
 *
 * async function createCommit(backend: StorageBackend) {
 *   // Store a blob
 *   const blobSha = await backend.putObject('blob', content)
 *
 *   // Store a tree referencing the blob
 *   const treeSha = await backend.putObject('tree', treeContent)
 *
 *   // Store the commit
 *   const commitSha = await backend.putObject('commit', commitContent)
 *
 *   // Update the branch ref
 *   await backend.setRef('refs/heads/main', {
 *     name: 'refs/heads/main',
 *     target: commitSha,
 *     type: 'direct'
 *   })
 * }
 * ```
 */

import type { ObjectType } from '../types/objects'
import type { Ref } from '../refs/storage'

// Re-export ObjectType for convenience
export type { ObjectType }

/**
 * The four Git object types.
 *
 * @description
 * - `blob`: Raw file content
 * - `tree`: Directory listing (contains references to blobs and other trees)
 * - `commit`: A snapshot pointing to a tree with metadata (author, message, parents)
 * - `tag`: An annotated tag pointing to another object with metadata
 */
export type ObjectTypeValue = 'blob' | 'tree' | 'commit' | 'tag'

/**
 * Result of retrieving a Git object from storage.
 *
 * @description
 * Contains the object type and raw binary content (without Git header).
 * The content is the object data only - the header is reconstructed when needed.
 */
export interface StoredObjectResult {
  /** The type of Git object */
  type: ObjectType
  /** Raw binary content of the object (excluding Git header) */
  content: Uint8Array
}

/**
 * Storage backend interface for Git operations.
 *
 * @description
 * This interface abstracts over different storage implementations to provide
 * a unified API for Git operations. Implementations must handle:
 *
 * 1. **Content-Addressable Storage (CAS)**: Objects are stored by their SHA-1 hash.
 *    The hash is computed from the Git object format: "{type} {size}\0{content}".
 *    Implementations should compute and verify hashes.
 *
 * 2. **Reference Storage**: Refs can be direct (pointing to a SHA) or symbolic
 *    (pointing to another ref). Implementations must handle both.
 *
 * 3. **Raw File Operations**: For Git files that aren't objects (index, config, etc.),
 *    standard file operations are needed.
 *
 * 4. **Directory Operations**: For managing the repository structure.
 *
 * @example
 * ```typescript
 * // Using the backend for basic operations
 * const backend: StorageBackend = createBackend()
 *
 * // Store an object
 * const content = new TextEncoder().encode('Hello, World!')
 * const sha = await backend.putObject('blob', content)
 *
 * // Retrieve it
 * const obj = await backend.getObject(sha)
 * if (obj) {
 *   console.log(`Type: ${obj.type}, Size: ${obj.content.length}`)
 * }
 *
 * // Work with refs
 * const head = await backend.getRef('HEAD')
 * if (head?.type === 'symbolic') {
 *   console.log(`On branch: ${head.target}`)
 * }
 * ```
 */
export interface StorageBackend {
  // ===========================================================================
  // Content-Addressable Storage (CAS) Operations
  // ===========================================================================

  /**
   * Store a Git object and return its SHA-1 hash.
   *
   * @description
   * Computes the SHA-1 hash of the object in Git format (type + size + content),
   * stores the object, and returns the hash. If an object with the same SHA
   * already exists, this operation is idempotent (no error, returns same SHA).
   *
   * The SHA is computed from: "{type} {size}\0{content}"
   *
   * @param type - Object type: 'blob', 'tree', 'commit', or 'tag'
   * @param content - Raw object content (without Git header)
   * @returns 40-character lowercase hexadecimal SHA-1 hash
   *
   * @example
   * ```typescript
   * // Store a blob
   * const content = new TextEncoder().encode('file content')
   * const sha = await backend.putObject('blob', content)
   * console.log(`Stored as: ${sha}`)
   *
   * // Store a tree (content must be properly formatted)
   * const treeSha = await backend.putObject('tree', treeContent)
   * ```
   */
  putObject(type: ObjectType, content: Uint8Array): Promise<string>

  /**
   * Retrieve a Git object by its SHA-1 hash.
   *
   * @description
   * Fetches an object from storage and returns its type and content.
   * Returns null if the object doesn't exist. The content returned is
   * the raw object data WITHOUT the Git header.
   *
   * @param sha - 40-character SHA-1 hash (case-insensitive)
   * @returns Object with type and content, or null if not found
   *
   * @example
   * ```typescript
   * const obj = await backend.getObject(sha)
   * if (obj) {
   *   if (obj.type === 'blob') {
   *     const text = new TextDecoder().decode(obj.content)
   *     console.log(text)
   *   }
   * }
   * ```
   */
  getObject(sha: string): Promise<StoredObjectResult | null>

  /**
   * Check if a Git object exists in storage.
   *
   * @description
   * Efficiently checks for object existence without fetching the full content.
   * This is useful for connectivity checks and optimizing transfers.
   *
   * @param sha - 40-character SHA-1 hash (case-insensitive)
   * @returns True if the object exists, false otherwise
   *
   * @example
   * ```typescript
   * if (await backend.hasObject(sha)) {
   *   console.log('Object exists')
   * } else {
   *   console.log('Need to fetch object')
   * }
   * ```
   */
  hasObject(sha: string): Promise<boolean>

  /**
   * Delete a Git object from storage.
   *
   * @description
   * Removes an object from storage. This operation should be used with caution
   * as deleting objects that are still referenced by other objects (e.g., blobs
   * referenced by trees) will corrupt the repository.
   *
   * Note: Most Git operations don't delete objects directly. Use garbage
   * collection instead for safe cleanup of unreferenced objects.
   *
   * @param sha - 40-character SHA-1 hash (case-insensitive)
   * @returns Resolves when deletion is complete (no error if object didn't exist)
   *
   * @example
   * ```typescript
   * // Only delete if you're sure nothing references this object
   * await backend.deleteObject(sha)
   * ```
   */
  deleteObject(sha: string): Promise<void>

  // ===========================================================================
  // Reference Operations
  // ===========================================================================

  /**
   * Get a reference by name.
   *
   * @description
   * Retrieves a Git reference (branch, tag, HEAD, etc.) by its full name.
   * Returns null if the reference doesn't exist. Does NOT follow symbolic refs -
   * use the RefStorage class for ref resolution.
   *
   * @param name - Full ref name (e.g., 'HEAD', 'refs/heads/main', 'refs/tags/v1.0.0')
   * @returns The reference or null if not found
   *
   * @example
   * ```typescript
   * const head = await backend.getRef('HEAD')
   * if (head?.type === 'symbolic') {
   *   console.log(`On branch: ${head.target}`)
   * } else if (head?.type === 'direct') {
   *   console.log(`Detached at: ${head.target}`)
   * }
   * ```
   */
  getRef(name: string): Promise<Ref | null>

  /**
   * Create or update a reference.
   *
   * @description
   * Sets a reference to point to a target (SHA for direct refs, ref name for symbolic).
   * Creates the ref if it doesn't exist, updates it if it does.
   *
   * Note: This is a low-level operation. For atomic updates with compare-and-swap,
   * use the RefStorage class instead.
   *
   * @param name - Full ref name (e.g., 'HEAD', 'refs/heads/main')
   * @param ref - The reference object with name, target, and type
   *
   * @example
   * ```typescript
   * // Create/update a branch
   * await backend.setRef('refs/heads/feature', {
   *   name: 'refs/heads/feature',
   *   target: commitSha,
   *   type: 'direct'
   * })
   *
   * // Update HEAD to point to a branch
   * await backend.setRef('HEAD', {
   *   name: 'HEAD',
   *   target: 'refs/heads/main',
   *   type: 'symbolic'
   * })
   * ```
   */
  setRef(name: string, ref: Ref): Promise<void>

  /**
   * Delete a reference.
   *
   * @description
   * Removes a reference from storage. Note that HEAD cannot be deleted.
   * No error is thrown if the ref doesn't exist.
   *
   * @param name - Full ref name to delete
   *
   * @example
   * ```typescript
   * // Delete a branch
   * await backend.deleteRef('refs/heads/old-feature')
   *
   * // Delete a tag
   * await backend.deleteRef('refs/tags/old-release')
   * ```
   */
  deleteRef(name: string): Promise<void>

  /**
   * List references matching an optional prefix.
   *
   * @description
   * Returns all references, optionally filtered by a prefix.
   * Does not include symbolic refs in the results by default.
   *
   * @param prefix - Optional prefix to filter refs (e.g., 'refs/heads/', 'refs/tags/')
   * @returns Array of matching references
   *
   * @example
   * ```typescript
   * // List all branches
   * const branches = await backend.listRefs('refs/heads/')
   *
   * // List all tags
   * const tags = await backend.listRefs('refs/tags/')
   *
   * // List all refs
   * const all = await backend.listRefs()
   * ```
   */
  listRefs(prefix?: string): Promise<Ref[]>

  // ===========================================================================
  // Raw File Operations
  // ===========================================================================

  /**
   * Read a raw file from the repository.
   *
   * @description
   * Reads a file that isn't a Git object (e.g., index, config, hooks).
   * Paths are relative to the Git directory (.git/).
   * Returns null if the file doesn't exist.
   *
   * @param path - Path relative to Git directory (e.g., 'index', 'config', 'hooks/pre-commit')
   * @returns File contents as Uint8Array, or null if not found
   *
   * @example
   * ```typescript
   * // Read the index file
   * const indexData = await backend.readFile('index')
   *
   * // Read config
   * const config = await backend.readFile('config')
   * if (config) {
   *   const text = new TextDecoder().decode(config)
   *   console.log(text)
   * }
   * ```
   */
  readFile(path: string): Promise<Uint8Array | null>

  /**
   * Write a raw file to the repository.
   *
   * @description
   * Writes a file that isn't a Git object (e.g., index, config).
   * Paths are relative to the Git directory (.git/).
   * Creates parent directories if they don't exist.
   * Overwrites existing files.
   *
   * @param path - Path relative to Git directory
   * @param content - File contents as Uint8Array
   *
   * @example
   * ```typescript
   * // Write config
   * const config = new TextEncoder().encode('[core]\n\trepositoryformatversion = 0\n')
   * await backend.writeFile('config', config)
   *
   * // Write index
   * await backend.writeFile('index', indexData)
   * ```
   */
  writeFile(path: string, content: Uint8Array): Promise<void>

  /**
   * Delete a raw file from the repository.
   *
   * @description
   * Removes a file from the Git directory. No error if file doesn't exist.
   *
   * @param path - Path relative to Git directory
   *
   * @example
   * ```typescript
   * // Remove index.lock after crash
   * await backend.deleteFile('index.lock')
   * ```
   */
  deleteFile(path: string): Promise<void>

  /**
   * Check if a file or directory exists.
   *
   * @description
   * Checks for the existence of a file or directory at the given path.
   * Paths are relative to the Git directory.
   *
   * @param path - Path relative to Git directory
   * @returns True if the path exists (file or directory), false otherwise
   *
   * @example
   * ```typescript
   * if (await backend.exists('index.lock')) {
   *   throw new Error('Another git process is running')
   * }
   *
   * if (!await backend.exists('objects')) {
   *   console.log('Not a valid git repository')
   * }
   * ```
   */
  exists(path: string): Promise<boolean>

  // ===========================================================================
  // Directory Operations
  // ===========================================================================

  /**
   * List contents of a directory.
   *
   * @description
   * Returns the names of files and directories within the specified directory.
   * Paths are relative to the Git directory. Returns an empty array if the
   * directory doesn't exist.
   *
   * @param path - Path relative to Git directory
   * @returns Array of file and directory names (not full paths)
   *
   * @example
   * ```typescript
   * // List pack files
   * const packDir = await backend.readdir('objects/pack')
   * const packs = packDir.filter(f => f.endsWith('.pack'))
   *
   * // List loose object prefixes
   * const objectDirs = await backend.readdir('objects')
   * ```
   */
  readdir(path: string): Promise<string[]>

  /**
   * Create a directory.
   *
   * @description
   * Creates a directory at the specified path. If `recursive` is true,
   * creates parent directories as needed. No error if directory already exists.
   *
   * @param path - Path relative to Git directory
   * @param options - Options for directory creation
   * @param options.recursive - If true, create parent directories as needed
   *
   * @example
   * ```typescript
   * // Create objects directory structure
   * await backend.mkdir('objects/pack', { recursive: true })
   *
   * // Create refs structure
   * await backend.mkdir('refs/heads', { recursive: true })
   * await backend.mkdir('refs/tags', { recursive: true })
   * ```
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
}
