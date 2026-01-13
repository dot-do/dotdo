/**
 * ContentAddressableFS - Git-style object storage layer
 *
 * Provides a content-addressable storage (CAS) layer on top of FSx that enables
 * git-style object storage. Objects are stored with their SHA-1 hash as the identifier,
 * enabling deduplication and content verification.
 *
 * Features:
 * - Compute SHA-1/SHA-256 hash of content on write
 * - Use hash as the blob identifier (not random UUID)
 * - Deduplicate blobs with identical content
 * - Support git object format: `<type> <size>\0<content>`
 * - Store objects in git loose object structure: `objects/xx/yyyy...`
 * - Zlib compression for stored objects
 *
 * @example
 * ```typescript
 * const cas = new ContentAddressableFS(storage)
 *
 * // Store a blob
 * const hash = await cas.putObject(new TextEncoder().encode('hello'), 'blob')
 * console.log(hash) // 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0'
 *
 * // Retrieve the object
 * const obj = await cas.getObject(hash)
 * console.log(obj?.type) // 'blob'
 * console.log(new TextDecoder().decode(obj?.data)) // 'hello'
 *
 * // Check if object exists
 * const exists = await cas.hasObject(hash)
 * console.log(exists) // true
 *
 * // Delete object
 * await cas.deleteObject(hash)
 * ```
 */

import { putObject as putObjectFn } from './put-object.js'
import { getObject as getObjectFn } from './get-object.js'
import { hashToPath } from './path-mapping.js'

/**
 * Git object types supported by the CAS
 */
export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag'

/**
 * Result of retrieving an object from the CAS
 */
export interface CASObject {
  /** Git object type: blob, tree, commit, or tag */
  type: string
  /** Raw object data (uncompressed) */
  data: Uint8Array
}

/**
 * Storage interface required by ContentAddressableFS
 *
 * This interface abstracts the underlying storage mechanism.
 * Implementations can use R2, local filesystem, or in-memory storage.
 */
export interface CASStorage {
  /**
   * Write data to a path
   * @param path - Storage path (e.g., 'objects/ab/cdef...')
   * @param data - Data to write
   */
  write(path: string, data: Uint8Array): Promise<void>

  /**
   * Read data from a path
   * @param path - Storage path
   * @returns Object with data, or null if not found
   */
  get(path: string): Promise<{ data: Uint8Array } | null>

  /**
   * Check if a path exists
   * @param path - Storage path
   * @returns true if the path exists
   */
  exists(path: string): Promise<boolean>

  /**
   * Delete data at a path
   * @param path - Storage path
   */
  delete(path: string): Promise<void>
}

/**
 * ContentAddressableFS - Git-compatible content-addressable storage
 *
 * This class provides a high-level API for storing and retrieving git objects.
 * Objects are stored using their content hash as the identifier, enabling
 * deduplication and content integrity verification.
 */
export class ContentAddressableFS {
  private storage: CASStorage

  /**
   * Create a new ContentAddressableFS instance
   *
   * @param storage - Storage backend implementing CASStorage interface
   *
   * @example
   * ```typescript
   * // With R2 storage
   * const r2Storage = new R2Storage({ bucket: env.BUCKET })
   * const cas = new ContentAddressableFS({
   *   write: (path, data) => r2Storage.put(path, data),
   *   get: (path) => r2Storage.get(path),
   *   exists: (path) => r2Storage.exists(path),
   *   delete: (path) => r2Storage.delete(path),
   * })
   * ```
   */
  constructor(storage: CASStorage) {
    this.storage = storage
  }

  /**
   * Store a git object and return its content hash
   *
   * The object is stored in git format:
   * 1. Create header: `<type> <size>\0`
   * 2. Concatenate header with content
   * 3. Compute SHA-1 hash of the full object
   * 4. Compress with zlib
   * 5. Store at `objects/xx/yyyy...`
   *
   * @param data - Object content as Uint8Array
   * @param type - Object type: 'blob', 'tree', 'commit', or 'tag'
   * @returns 40-character lowercase hex SHA-1 hash
   *
   * @example
   * ```typescript
   * // Store a blob
   * const content = new TextEncoder().encode('hello world')
   * const hash = await cas.putObject(content, 'blob')
   * console.log(hash) // '95d09f2b10159347eece71399a7e2e907ea3df4f'
   *
   * // Store a commit
   * const commitData = new TextEncoder().encode(
   *   'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n' +
   *   'author Test <test@test.com> 1234567890 +0000\n' +
   *   'committer Test <test@test.com> 1234567890 +0000\n\n' +
   *   'Initial commit'
   * )
   * const commitHash = await cas.putObject(commitData, 'commit')
   * ```
   */
  async putObject(data: Uint8Array, type: ObjectType): Promise<string> {
    return putObjectFn(this.storage, type, data)
  }

  /**
   * Retrieve a git object by its hash
   *
   * @param hash - 40 or 64 character hex string (SHA-1 or SHA-256)
   * @returns Object with type and data, or null if not found
   *
   * @example
   * ```typescript
   * const obj = await cas.getObject('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0')
   * if (obj) {
   *   console.log(obj.type) // 'blob'
   *   console.log(new TextDecoder().decode(obj.data)) // 'hello'
   * }
   * ```
   */
  async getObject(hash: string): Promise<CASObject | null> {
    // Validate hash format
    if (!this.isValidHash(hash)) {
      throw new Error(
        `Invalid hash: expected 40 (SHA-1) or 64 (SHA-256) hex characters, got ${hash.length} characters`
      )
    }

    try {
      const result = await getObjectFn(hash, this.storage as any)
      return {
        type: result.type,
        data: result.content,
      }
    } catch (error) {
      // If the object doesn't exist, return null instead of throwing
      if (error instanceof Error && error.message.includes('ENOENT')) {
        return null
      }
      // Check if it's an ENOENT error by code
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const errorWithCode = error as { code: string }
        if (errorWithCode.code === 'ENOENT') {
          return null
        }
      }
      throw error
    }
  }

  /**
   * Check if an object exists in the CAS
   *
   * This is a fast operation that only checks file existence
   * without reading or decompressing content.
   *
   * @param hash - 40 or 64 character hex string (SHA-1 or SHA-256)
   * @returns true if the object exists, false otherwise
   *
   * @example
   * ```typescript
   * if (await cas.hasObject('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0')) {
   *   console.log('Object exists!')
   * }
   * ```
   */
  async hasObject(hash: string): Promise<boolean> {
    // Validate hash format
    if (!this.isValidHash(hash)) {
      throw new Error(
        `Invalid hash: expected 40 (SHA-1) or 64 (SHA-256) hex characters, got ${hash.length} characters`
      )
    }

    const normalizedHash = hash.toLowerCase()
    const path = hashToPath(normalizedHash)

    return this.storage.exists(path)
  }

  /**
   * Delete an object from the CAS
   *
   * @param hash - 40 or 64 character hex string (SHA-1 or SHA-256)
   *
   * @example
   * ```typescript
   * await cas.deleteObject('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0')
   * ```
   */
  async deleteObject(hash: string): Promise<void> {
    // Validate hash format
    if (!this.isValidHash(hash)) {
      throw new Error(
        `Invalid hash: expected 40 (SHA-1) or 64 (SHA-256) hex characters, got ${hash.length} characters`
      )
    }

    const normalizedHash = hash.toLowerCase()
    const path = hashToPath(normalizedHash)

    await this.storage.delete(path)
  }

  /**
   * Validate that a string is a valid hash format
   * Must be exactly 40 (SHA-1) or 64 (SHA-256) hex characters
   */
  private isValidHash(hash: string): boolean {
    if (!hash) return false
    if (hash.length !== 40 && hash.length !== 64) return false
    return /^[0-9a-fA-F]+$/.test(hash)
  }
}
