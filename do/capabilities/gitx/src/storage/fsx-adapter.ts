/**
 * @fileoverview FSx Storage Adapter for gitx
 *
 * This module provides a storage backend implementation that uses fsx.do for
 * both content-addressable storage (CAS) and file system operations. It bridges
 * gitx's StorageBackend interface with fsx's CAS and fs operations.
 *
 * **Features**:
 * - Content-addressable storage using fsx CAS (putObject, getObject, hasObject)
 * - Reference storage using fsx file operations
 * - Full file system operations for index, config, and other Git files
 *
 * @module storage/fsx-adapter
 *
 * @example
 * ```typescript
 * import { createFSxAdapter } from './storage/fsx-adapter'
 *
 * const storage = createFSxAdapter('/repos/my-repo/.git')
 *
 * // Store a blob
 * const sha = await storage.putObject('blob', content)
 *
 * // Work with refs
 * await storage.setRef('refs/heads/main', {
 *   name: 'refs/heads/main',
 *   target: sha,
 *   type: 'direct'
 * })
 * ```
 */

import type { StorageBackend, StoredObjectResult, ObjectType } from './backend'
import type { Ref } from '../refs/storage'
import { parseRefContent, serializeRefContent } from '../refs/storage'

// Import hash utilities from local utils module
// Note: sha1 is re-exported from fsx.do and works in Workers environment
import { sha1 } from '../utils/hash'

// Import pako for compression (still needed as fsx.do CAS handles this internally)
import * as pako from 'pako'

// ============================================================================
// Git Object Utilities
// ============================================================================

/**
 * Create a Git object with header
 */
function createGitObject(type: string, content: Uint8Array): Uint8Array {
  const header = `${type} ${content.length}\0`
  const headerBytes = new TextEncoder().encode(header)
  const result = new Uint8Array(headerBytes.length + content.length)
  result.set(headerBytes, 0)
  result.set(content, headerBytes.length)
  return result
}

/**
 * Parse a Git object to extract type and content
 */
function parseGitObject(data: Uint8Array): { type: string; content: Uint8Array } {
  // Find null byte separator
  let nullIndex = -1
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      nullIndex = i
      break
    }
  }
  if (nullIndex === -1) {
    throw new Error('Invalid git object: no null byte found')
  }

  const headerStr = new TextDecoder().decode(data.subarray(0, nullIndex))
  const [type] = headerStr.split(' ')
  const content = data.subarray(nullIndex + 1)

  return { type, content }
}

/**
 * Compress data with zlib
 */
async function compress(data: Uint8Array): Promise<Uint8Array> {
  return pako.deflate(data)
}

/**
 * Decompress zlib data
 */
async function decompress(data: Uint8Array): Promise<Uint8Array> {
  return pako.inflate(data)
}

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration options for FSxStorageAdapter
 */
export interface FSxStorageAdapterOptions {
  /**
   * Root path for the Git repository (typically .git directory)
   */
  rootPath: string
}

/**
 * Internal storage interface for file operations
 * This abstracts over different fsx storage backends (R2, SQLite, etc.)
 */
interface FSxFileStorage {
  read(path: string): Promise<Uint8Array | null>
  write(path: string, data: Uint8Array): Promise<void>
  delete(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  readdir(path: string): Promise<string[]>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
}

// ============================================================================
// In-Memory Storage for Development/Testing
// ============================================================================

/**
 * Simple in-memory storage for development and testing
 * In production, this would be backed by fsx's R2 or SQLite storage
 */
class InMemoryStorage implements FSxFileStorage {
  private files = new Map<string, Uint8Array>()
  private directories = new Set<string>()

  constructor() {
    // Initialize root directory
    this.directories.add('/')
  }

  async read(path: string): Promise<Uint8Array | null> {
    return this.files.get(path) ?? null
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data)
    // Ensure parent directories exist
    const parts = path.split('/')
    let current = ''
    for (let i = 0; i < parts.length - 1; i++) {
      current += (i === 0 ? '' : '/') + parts[i]
      if (current) {
        this.directories.add(current)
      }
    }
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path)
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path)
  }

  async readdir(path: string): Promise<string[]> {
    const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
    const entries = new Set<string>()

    // Check files
    const fileKeys = Array.from(this.files.keys())
    for (const filePath of fileKeys) {
      if (filePath.startsWith(normalizedPath + '/')) {
        const rest = filePath.slice(normalizedPath.length + 1)
        const firstPart = rest.split('/')[0]
        if (firstPart) {
          entries.add(firstPart)
        }
      }
    }

    // Check directories
    const dirEntries = Array.from(this.directories)
    for (const dirPath of dirEntries) {
      if (dirPath.startsWith(normalizedPath + '/')) {
        const rest = dirPath.slice(normalizedPath.length + 1)
        const firstPart = rest.split('/')[0]
        if (firstPart) {
          entries.add(firstPart)
        }
      }
    }

    return Array.from(entries).sort()
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      const parts = path.split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current += '/' + part
        this.directories.add(current)
      }
    } else {
      this.directories.add(path)
    }
  }
}

// ============================================================================
// FSxStorageAdapter Implementation
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * FSx storage adapter implementing the StorageBackend interface.
 *
 * @description
 * This adapter uses fsx for all storage operations:
 * - CAS operations use fsx's git-compatible object storage
 * - Refs are stored as files at {rootPath}/refs/{refname}
 * - File operations are relative to the rootPath
 */
export class FSxStorageAdapter implements StorageBackend {
  private rootPath: string
  private storage: FSxFileStorage

  /**
   * Create a new FSxStorageAdapter
   *
   * @param rootPath - The root path for the Git repository (typically .git directory)
   */
  constructor(rootPath: string) {
    // Normalize root path - remove trailing slash
    this.rootPath = rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath
    // Use in-memory storage for now - in production this would be injected
    this.storage = new InMemoryStorage()
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Resolve a relative path to an absolute path within the repository
   *
   * @param p - Relative path within the repository
   * @returns Absolute path
   */
  private resolvePath(p: string): string {
    // Handle empty path
    if (!p) {
      return this.rootPath
    }
    // Handle absolute paths - just return as-is if already under rootPath
    if (p.startsWith('/')) {
      if (p.startsWith(this.rootPath)) {
        return p
      }
      // Join with rootPath
      return this.rootPath + p
    }
    // Relative path - join with rootPath
    return this.rootPath + '/' + p
  }

  /**
   * Get the path for an object based on its SHA
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Path in format: objects/xx/yyyy...
   */
  private getObjectPath(sha: string): string {
    const normalizedSha = sha.toLowerCase()
    const dir = normalizedSha.slice(0, 2)
    const filename = normalizedSha.slice(2)
    return this.resolvePath(`objects/${dir}/${filename}`)
  }

  /**
   * Get the path for a ref
   *
   * @param name - Ref name (e.g., 'refs/heads/main', 'HEAD')
   * @returns Absolute path to the ref file
   */
  private getRefPath(name: string): string {
    return this.resolvePath(name)
  }

  // ==========================================================================
  // Content-Addressable Storage (CAS) Operations
  // ==========================================================================

  /**
   * Store a Git object and return its SHA-1 hash.
   *
   * @description
   * Creates a Git object in the format: "{type} {size}\0{content}",
   * computes its SHA-1 hash, compresses it with zlib, and stores it.
   *
   * @param type - Object type: 'blob', 'tree', 'commit', or 'tag'
   * @param content - Raw object content (without Git header)
   * @returns 40-character lowercase hexadecimal SHA-1 hash
   */
  async putObject(type: ObjectType, content: Uint8Array): Promise<string> {
    // Create the git object (header + content)
    const gitObject = createGitObject(type, content)

    // Compute SHA-1 hash of the uncompressed git object
    const hash = await sha1(gitObject)

    // Compress the git object with zlib
    const compressedData = await compress(gitObject)

    // Get the storage path from the hash
    const objectPath = this.getObjectPath(hash)

    // Ensure parent directory exists
    const dirPath = objectPath.substring(0, objectPath.lastIndexOf('/'))
    await this.storage.mkdir(dirPath, { recursive: true })

    // Write the compressed data to storage
    await this.storage.write(objectPath, compressedData)

    // Return the 40-character hex hash
    return hash
  }

  /**
   * Retrieve a Git object by its SHA-1 hash.
   *
   * @param sha - 40-character SHA-1 hash (case-insensitive)
   * @returns Object with type and content, or null if not found
   */
  async getObject(sha: string): Promise<StoredObjectResult | null> {
    // Normalize to lowercase
    const normalizedSha = sha.toLowerCase()

    // Get the storage path
    const objectPath = this.getObjectPath(normalizedSha)

    // Read compressed data from storage
    const compressedData = await this.storage.read(objectPath)
    if (!compressedData) {
      return null
    }

    // Decompress the data
    const decompressed = await decompress(compressedData)

    // Parse git object format
    const { type, content } = parseGitObject(decompressed)

    return {
      type: type as ObjectType,
      content
    }
  }

  /**
   * Check if a Git object exists in storage.
   *
   * @param sha - 40-character SHA-1 hash (case-insensitive)
   * @returns True if the object exists, false otherwise
   */
  async hasObject(sha: string): Promise<boolean> {
    // Validate hash format
    if (!sha || (sha.length !== 40 && sha.length !== 64)) {
      return false
    }
    if (!/^[0-9a-fA-F]+$/.test(sha)) {
      return false
    }

    const normalizedSha = sha.toLowerCase()
    const objectPath = this.getObjectPath(normalizedSha)
    return this.storage.exists(objectPath)
  }

  /**
   * Delete a Git object from storage.
   *
   * @param sha - 40-character SHA-1 hash (case-insensitive)
   */
  async deleteObject(sha: string): Promise<void> {
    const normalizedSha = sha.toLowerCase()
    const objectPath = this.getObjectPath(normalizedSha)
    await this.storage.delete(objectPath)
  }

  // ==========================================================================
  // Reference Operations
  // ==========================================================================

  /**
   * Get a reference by name.
   *
   * @param name - Full ref name (e.g., 'HEAD', 'refs/heads/main')
   * @returns The reference or null if not found
   */
  async getRef(name: string): Promise<Ref | null> {
    const refPath = this.getRefPath(name)
    const data = await this.storage.read(refPath)

    if (!data) {
      return null
    }

    const content = decoder.decode(data)
    const { type, target } = parseRefContent(content)

    return {
      name,
      target,
      type
    }
  }

  /**
   * Create or update a reference.
   *
   * @param name - Full ref name (e.g., 'HEAD', 'refs/heads/main')
   * @param ref - The reference object
   */
  async setRef(name: string, ref: Ref): Promise<void> {
    const refPath = this.getRefPath(name)

    // Ensure parent directory exists
    const dirPath = refPath.substring(0, refPath.lastIndexOf('/'))
    if (dirPath && dirPath !== this.rootPath) {
      await this.storage.mkdir(dirPath, { recursive: true })
    }

    const content = serializeRefContent(ref)
    await this.storage.write(refPath, encoder.encode(content))
  }

  /**
   * Delete a reference.
   *
   * @param name - Full ref name to delete
   */
  async deleteRef(name: string): Promise<void> {
    const refPath = this.getRefPath(name)
    await this.storage.delete(refPath)
  }

  /**
   * List references matching an optional prefix.
   *
   * @param prefix - Optional prefix to filter refs (e.g., 'refs/heads/')
   * @returns Array of matching references
   */
  async listRefs(prefix?: string): Promise<Ref[]> {
    const refs: Ref[] = []

    // Helper function to recursively read refs from a directory
    const readRefsFromDir = async (dirPath: string, refPrefix: string): Promise<void> => {
      const fullDirPath = this.resolvePath(dirPath)
      const exists = await this.storage.exists(fullDirPath)
      if (!exists) {
        return
      }

      const entries = await this.storage.readdir(fullDirPath)

      for (const entry of entries) {
        const entryPath = `${dirPath}/${entry}`
        const fullEntryPath = this.resolvePath(entryPath)
        const refName = `${refPrefix}${entry}`

        // Try to read as a ref file
        const data = await this.storage.read(fullEntryPath)
        if (data) {
          // It's a file - parse as ref
          const content = decoder.decode(data)
          try {
            const { type, target } = parseRefContent(content)
            refs.push({ name: refName, target, type })
          } catch {
            // Not a valid ref file, skip
          }
        } else {
          // It might be a directory - recurse
          await readRefsFromDir(entryPath, refName + '/')
        }
      }
    }

    // Start from refs directory
    const refsDir = prefix ? prefix.replace(/\/$/, '') : 'refs'
    await readRefsFromDir(refsDir, prefix || 'refs/')

    // Also check HEAD if no prefix or if listing all
    if (!prefix) {
      const headRef = await this.getRef('HEAD')
      if (headRef) {
        refs.unshift(headRef)
      }
    }

    return refs
  }

  // ==========================================================================
  // Raw File Operations
  // ==========================================================================

  /**
   * Read a raw file from the repository.
   *
   * @param path - Path relative to Git directory
   * @returns File contents as Uint8Array, or null if not found
   */
  async readFile(path: string): Promise<Uint8Array | null> {
    const fullPath = this.resolvePath(path)
    return this.storage.read(fullPath)
  }

  /**
   * Write a raw file to the repository.
   *
   * @param path - Path relative to Git directory
   * @param content - File contents as Uint8Array
   */
  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const fullPath = this.resolvePath(path)

    // Ensure parent directory exists
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'))
    if (dirPath && dirPath !== this.rootPath) {
      await this.storage.mkdir(dirPath, { recursive: true })
    }

    await this.storage.write(fullPath, content)
  }

  /**
   * Delete a raw file from the repository.
   *
   * @param path - Path relative to Git directory
   */
  async deleteFile(path: string): Promise<void> {
    const fullPath = this.resolvePath(path)
    await this.storage.delete(fullPath)
  }

  /**
   * Check if a file or directory exists.
   *
   * @param path - Path relative to Git directory
   * @returns True if the path exists
   */
  async exists(path: string): Promise<boolean> {
    const fullPath = this.resolvePath(path)
    return this.storage.exists(fullPath)
  }

  // ==========================================================================
  // Directory Operations
  // ==========================================================================

  /**
   * List contents of a directory.
   *
   * @param path - Path relative to Git directory
   * @returns Array of file and directory names
   */
  async readdir(path: string): Promise<string[]> {
    const fullPath = this.resolvePath(path)
    try {
      return await this.storage.readdir(fullPath)
    } catch {
      // Return empty array if directory doesn't exist
      return []
    }
  }

  /**
   * Create a directory.
   *
   * @param path - Path relative to Git directory
   * @param options - Options for directory creation
   */
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const fullPath = this.resolvePath(path)
    await this.storage.mkdir(fullPath, options)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an FSx storage adapter.
 *
 * @description
 * Factory function for creating an FSxStorageAdapter instance.
 *
 * @param rootPath - The root path for the Git repository (typically .git directory)
 * @returns A StorageBackend instance backed by fsx
 *
 * @example
 * ```typescript
 * const storage = createFSxAdapter('/repos/my-project/.git')
 *
 * // Use the storage backend
 * const sha = await storage.putObject('blob', content)
 * const ref = await storage.getRef('HEAD')
 * ```
 */
export function createFSxAdapter(rootPath: string): StorageBackend {
  return new FSxStorageAdapter(rootPath)
}
