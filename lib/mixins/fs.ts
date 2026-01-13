/**
 * withFs Mixin - Filesystem Capability
 *
 * Adds $.fs to the WorkflowContext with filesystem operations:
 * - read, write, exists, delete
 * - list, mkdir, stat
 * - copy, move
 *
 * FsModule wraps fsx's FSx class to provide:
 * - Lazy initialization (only creates FSx when first accessed)
 * - Support for FileSystemDO stub or direct R2 binding
 * - Consistent FsCapability interface
 *
 * Storage Layout:
 * The virtual filesystem uses DurableObjectStorage (SQLite) with these key prefixes:
 * - `fsx:file:/path` - File content (string)
 * - `fsx:meta:/path` - File metadata (FileMetadata JSON)
 * - `fsx:dir:/path`  - Directory marker (boolean)
 *
 * @module lib/mixins/fs
 */

import type { WorkflowContext } from '../../types/WorkflowContext'
import type { DO, Env } from '../../objects/DO'

// Import types from @dotdo/fsx for better type safety and re-export for consumers
import type {
  ReadOptions as FsxReadOptions,
  WriteOptions as FsxWriteOptions,
  MkdirOptions as FsxMkdirOptions,
  Stats as FsxStats,
  Dirent as FsxDirent,
  StorageTier,
  FsCapability as FsxCapability,
} from '@dotdo/fsx'

// Re-export fsx.do types for consumers who want the full fsx API
export type { FsxReadOptions, FsxWriteOptions, FsxMkdirOptions, FsxStats, FsxDirent, StorageTier, FsxCapability }

// ============================================================================
// STORAGE KEY CONSTANTS
// ============================================================================

/**
 * Storage key prefix for file content.
 * Format: `fsx:file:/path/to/file` -> string content
 */
const FS_STORAGE_PREFIX_FILE = 'fsx:file:'

/**
 * Storage key prefix for file metadata.
 * Format: `fsx:meta:/path/to/file` -> FileMetadata JSON
 */
const FS_STORAGE_PREFIX_META = 'fsx:meta:'

/**
 * Storage key prefix for directory markers.
 * Format: `fsx:dir:/path/to/dir` -> true
 */
const FS_STORAGE_PREFIX_DIR = 'fsx:dir:'

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Node.js-compatible filesystem error codes.
 * These match standard POSIX error codes used by Node.js fs module.
 */
export type FsErrorCode =
  | 'ENOENT'    // No such file or directory
  | 'EEXIST'    // File already exists
  | 'EISDIR'    // Is a directory
  | 'ENOTDIR'   // Not a directory
  | 'ENOTEMPTY' // Directory not empty
  | 'EACCES'    // Permission denied
  | 'EINVAL'    // Invalid argument
  | 'ENOSPC'    // No space left on device

/**
 * Filesystem error with Node.js-compatible error codes.
 *
 * Provides a familiar error interface for developers used to Node.js fs errors.
 * The `code` property can be used for programmatic error handling.
 *
 * @example
 * ```typescript
 * try {
 *   await $.fs.read('/missing.txt')
 * } catch (error) {
 *   if (error instanceof FsError && error.code === 'ENOENT') {
 *     console.log('File not found:', error.path)
 *   }
 * }
 * ```
 */
export class FsError extends Error {
  /** POSIX error code (e.g., 'ENOENT', 'EEXIST') */
  readonly code: FsErrorCode

  /** The filesystem path that caused the error */
  readonly path: string

  /** The system call that failed (e.g., 'read', 'write', 'stat') */
  readonly syscall: string

  constructor(code: FsErrorCode, path: string, syscall: string) {
    const message = `${code}: ${FsError.getErrorMessage(code)}: ${path}`
    super(message)
    this.name = 'FsError'
    this.code = code
    this.path = path
    this.syscall = syscall

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, FsError.prototype)
  }

  /**
   * Get human-readable error message for error code.
   */
  private static getErrorMessage(code: FsErrorCode): string {
    switch (code) {
      case 'ENOENT': return 'no such file or directory'
      case 'EEXIST': return 'file already exists'
      case 'EISDIR': return 'illegal operation on a directory'
      case 'ENOTDIR': return 'not a directory'
      case 'ENOTEMPTY': return 'directory not empty'
      case 'EACCES': return 'permission denied'
      case 'EINVAL': return 'invalid argument'
      case 'ENOSPC': return 'no space left on device'
      default: return 'unknown error'
    }
  }
}

// ============================================================================
// CAPABILITY TYPES
// ============================================================================

export interface FsEntry {
  name: string
  isDirectory: boolean
}

export interface FsStat {
  size: number
  isDirectory: boolean
  isFile: boolean
  createdAt: Date
  modifiedAt: Date
}

export interface FsReadOptions {
  encoding?: 'utf8' | 'base64' | 'binary'
}

export interface FsWriteOptions {
  encoding?: 'utf8' | 'base64' | 'binary'
}

export interface FsListOptions {
  filter?: (entry: FsEntry) => boolean
}

export interface FsMkdirOptions {
  recursive?: boolean
}

/**
 * Filesystem capability interface for dotdo workflows.
 *
 * Provides a consistent API for filesystem operations across different backends:
 * - DurableObjectStorage (SQLite) for persistent, transactional storage
 * - FsModule wrapper for external FSx instances
 * - FileSystemDO stubs for cross-DO filesystem access
 *
 * All paths should be absolute (starting with `/`). Paths are automatically
 * normalized to handle trailing slashes and ensure consistency.
 *
 * @example
 * ```typescript
 * // In a DO with withFs mixin
 * await $.fs.write('/config.json', JSON.stringify(config))
 * const data = await $.fs.read('/config.json')
 *
 * // Directory operations
 * await $.fs.mkdir('/data/logs', { recursive: true })
 * const files = await $.fs.list('/data')
 * ```
 */
export interface FsCapability {
  /**
   * Read file content as a string.
   *
   * @param path - Absolute path to the file
   * @param options - Read options (encoding)
   * @returns File content as string
   * @throws {FsError} ENOENT if file does not exist
   *
   * @example
   * ```typescript
   * const content = await $.fs.read('/app/config.json')
   * ```
   */
  read(path: string, options?: FsReadOptions): Promise<string>

  /**
   * Write content to a file, creating it if it doesn't exist.
   *
   * Parent directories are NOT automatically created. Use `mkdir` with
   * `recursive: true` first if needed.
   *
   * @param path - Absolute path to the file
   * @param content - String content to write
   * @param options - Write options (encoding)
   *
   * @example
   * ```typescript
   * await $.fs.write('/app/data.json', JSON.stringify(data))
   * ```
   */
  write(path: string, content: string, options?: FsWriteOptions): Promise<void>

  /**
   * Check if a file or directory exists.
   *
   * @param path - Absolute path to check
   * @returns true if path exists, false otherwise
   *
   * @example
   * ```typescript
   * if (await $.fs.exists('/app/config.json')) {
   *   // Load config
   * }
   * ```
   */
  exists(path: string): Promise<boolean>

  /**
   * Delete a file or empty directory.
   *
   * @param path - Absolute path to delete
   * @throws {FsError} ENOENT if path does not exist (behavior may vary by backend)
   *
   * @example
   * ```typescript
   * await $.fs.delete('/tmp/cache.json')
   * ```
   */
  delete(path: string): Promise<void>

  /**
   * List entries in a directory.
   *
   * @param path - Absolute path to directory
   * @param options - List options (filter function)
   * @returns Array of directory entries with name and isDirectory flag
   *
   * @example
   * ```typescript
   * const entries = await $.fs.list('/app')
   * const files = entries.filter(e => !e.isDirectory)
   * ```
   */
  list(path: string, options?: FsListOptions): Promise<FsEntry[]>

  /**
   * Create a directory.
   *
   * @param path - Absolute path for new directory
   * @param options - mkdir options
   * @param options.recursive - If true, create parent directories as needed
   *
   * @example
   * ```typescript
   * await $.fs.mkdir('/app/data/logs', { recursive: true })
   * ```
   */
  mkdir(path: string, options?: FsMkdirOptions): Promise<void>

  /**
   * Get file or directory metadata.
   *
   * @param path - Absolute path to stat
   * @returns File/directory statistics
   * @throws {FsError} ENOENT if path does not exist
   *
   * @example
   * ```typescript
   * const info = await $.fs.stat('/app/data.json')
   * console.log(`Size: ${info.size}, Modified: ${info.modifiedAt}`)
   * ```
   */
  stat(path: string): Promise<FsStat>

  /**
   * Copy a file to a new location.
   *
   * @param src - Source file path
   * @param dest - Destination file path
   * @throws {FsError} ENOENT if source does not exist
   *
   * @example
   * ```typescript
   * await $.fs.copy('/app/config.json', '/backup/config.json')
   * ```
   */
  copy(src: string, dest: string): Promise<void>

  /**
   * Move a file to a new location.
   *
   * This is an atomic operation: the source is deleted only after
   * the destination is successfully written.
   *
   * @param src - Source file path
   * @param dest - Destination file path
   * @throws {FsError} ENOENT if source does not exist
   *
   * @example
   * ```typescript
   * await $.fs.move('/tmp/upload.json', '/data/file.json')
   * ```
   */
  move(src: string, dest: string): Promise<void>
}

// ============================================================================
// EXTENDED CONTEXT TYPES
// ============================================================================

export interface WithFsContext extends WorkflowContext {
  fs: FsCapability
}

// ============================================================================
// FSX TYPE DEFINITION (from fsx package)
// ============================================================================

/**
 * Interface representing the fsx FSx class
 * This allows us to accept any FSx-like implementation
 */
interface FSxLike {
  readFile(path: string, encoding?: string): Promise<string | Uint8Array>
  writeFile(path: string, data: string | Uint8Array, options?: { mode?: number; flag?: string }): Promise<void>
  exists(path: string): Promise<boolean>
  unlink(path: string): Promise<void>
  readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>>
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  stat(path: string): Promise<{
    size: number
    mode: number
    mtime: Date
    ctime: Date
    birthtime: Date
    isFile(): boolean
    isDirectory(): boolean
  }>
  copyFile(src: string, dest: string, flags?: number): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
}

// ============================================================================
// FSMODULE OPTIONS
// ============================================================================

/**
 * Options for creating an FsModule instance
 *
 * Supports multiple initialization patterns:
 * - fsx: Direct FSx instance
 * - stub: DurableObjectStub for FileSystemDO
 * - namespace: DurableObjectNamespace to create stub on demand
 * - factory: Lazy factory function
 * - r2: R2 bucket for warm tier storage
 */
export interface FsModuleOptions {
  /** Direct FSx instance */
  fsx?: FSxLike
  /** DurableObjectStub for FileSystemDO */
  stub?: DurableObjectStub
  /** DurableObjectNamespace to create stub on demand */
  namespace?: DurableObjectNamespace
  /** Lazy factory function to create FSx */
  factory?: () => FSxLike
  /** R2 bucket for warm tier storage */
  r2?: R2Bucket
}

// ============================================================================
// FSMODULE CLASS
// ============================================================================

/**
 * FsModule wraps fsx's FSx class to implement the FsCapability interface.
 *
 * Provides:
 * - Lazy initialization (FSx is only created on first operation)
 * - Support for FileSystemDO stub or direct R2 binding
 * - Consistent FsCapability interface for dotdo workflows
 *
 * @example
 * ```typescript
 * // With FSx instance
 * const fsModule = new FsModule({ fsx: new FSx(binding) })
 *
 * // With DurableObjectStub
 * const fsModule = new FsModule({ stub: env.FSX.get(id) })
 *
 * // With namespace (creates stub on demand)
 * const fsModule = new FsModule({ namespace: env.FSX })
 *
 * // With lazy factory
 * const fsModule = new FsModule({
 *   factory: () => new FSx(binding)
 * })
 * ```
 */
export class FsModule implements FsCapability {
  private _fsx: FSxLike | null = null
  private _options: FsModuleOptions

  constructor(options: FsModuleOptions) {
    this._options = options

    // If FSx instance is provided directly, use it immediately
    if (options.fsx) {
      this._fsx = options.fsx
    }
  }

  /**
   * Get the FSx instance, creating it lazily if needed
   */
  private get fsx(): FSxLike {
    if (!this._fsx) {
      if (this._options.factory) {
        this._fsx = this._options.factory()
      } else if (this._options.stub) {
        // Create FSx from stub - this would normally use the FSx constructor
        // For now, create a stub-based adapter
        this._fsx = this.createStubAdapter(this._options.stub)
      } else if (this._options.namespace) {
        // Get stub from namespace and create adapter
        const id = this._options.namespace.idFromName('global')
        const stub = this._options.namespace.get(id)
        this._fsx = this.createStubAdapter(stub)
      } else {
        throw new Error('FsModule: No FSx instance, stub, namespace, or factory provided')
      }
    }
    return this._fsx
  }

  /**
   * Create an FSx-like adapter from a DurableObjectStub
   * This makes RPC calls to the FileSystemDO
   */
  private createStubAdapter(stub: DurableObjectStub): FSxLike {
    const request = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
      const response = await stub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ code: 'UNKNOWN', message: response.statusText }))
        throw new Error((error as { message: string }).message || 'Unknown error')
      }

      return response.json()
    }

    return {
      async readFile(path: string, encoding?: string): Promise<string | Uint8Array> {
        const result = await request<{ data: string; encoding: string }>('readFile', { path, encoding })
        return result.data
      },
      async writeFile(path: string, data: string | Uint8Array, options?: { mode?: number; flag?: string }): Promise<void> {
        const encodedData = typeof data === 'string' ? data : btoa(String.fromCharCode(...data))
        const encoding = typeof data === 'string' ? 'utf-8' : 'base64'
        await request('writeFile', { path, data: encodedData, encoding, ...options })
      },
      async exists(path: string): Promise<boolean> {
        try {
          await request('access', { path })
          return true
        } catch {
          return false
        }
      },
      async unlink(path: string): Promise<void> {
        await request('unlink', { path })
      },
      async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>> {
        return request('readdir', { path, ...options })
      },
      async mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
        await request('mkdir', { path, ...options })
      },
      async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
        await request('rmdir', { path, ...options })
      },
      async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
        await request('rm', { path, ...options })
      },
      async stat(path: string): Promise<{
        size: number
        mode: number
        mtime: Date
        ctime: Date
        birthtime: Date
        isFile(): boolean
        isDirectory(): boolean
      }> {
        const stats = await request<{
          size: number
          mode: number
          mtime: string
          ctime: string
          birthtime: string
        }>('stat', { path })
        return {
          ...stats,
          mtime: new Date(stats.mtime),
          ctime: new Date(stats.ctime),
          birthtime: new Date(stats.birthtime),
          isFile: () => true, // Would need mode parsing
          isDirectory: () => false,
        }
      },
      async copyFile(src: string, dest: string, flags?: number): Promise<void> {
        await request('copyFile', { src, dest, flags })
      },
      async rename(oldPath: string, newPath: string): Promise<void> {
        await request('rename', { oldPath, newPath })
      },
    }
  }

  // ========================================================================
  // FsCapability Implementation
  // ========================================================================

  async read(path: string, options?: FsReadOptions): Promise<string> {
    const result = await this.fsx.readFile(path, options?.encoding)
    if (typeof result === 'string') {
      return result
    }
    // Convert Uint8Array to string
    return new TextDecoder().decode(result)
  }

  async write(path: string, content: string, options?: FsWriteOptions): Promise<void> {
    await this.fsx.writeFile(path, content)
  }

  async exists(path: string): Promise<boolean> {
    return this.fsx.exists(path)
  }

  async delete(path: string): Promise<void> {
    await this.fsx.unlink(path)
  }

  async list(path: string, options?: FsListOptions): Promise<FsEntry[]> {
    const entries = await this.fsx.readdir(path, { withFileTypes: true })

    // Handle both string[] and Dirent[] responses
    const fsEntries: FsEntry[] = []

    for (const entry of entries) {
      if (typeof entry === 'string') {
        // If we got string names, we need to stat each to determine if it's a directory
        const fullPath = path === '/' ? `/${entry}` : `${path}/${entry}`
        try {
          const stat = await this.fsx.stat(fullPath)
          fsEntries.push({
            name: entry,
            isDirectory: stat.isDirectory(),
          })
        } catch {
          // If stat fails, assume it's a file
          fsEntries.push({
            name: entry,
            isDirectory: false,
          })
        }
      } else {
        // Dirent-like object
        fsEntries.push({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        })
      }
    }

    // Apply filter if provided
    if (options?.filter) {
      return fsEntries.filter(options.filter)
    }

    return fsEntries
  }

  async mkdir(path: string, options?: FsMkdirOptions): Promise<void> {
    await this.fsx.mkdir(path, { recursive: options?.recursive })
  }

  async stat(path: string): Promise<FsStat> {
    const stats = await this.fsx.stat(path)
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
    }
  }

  async copy(src: string, dest: string): Promise<void> {
    await this.fsx.copyFile(src, dest)
  }

  async move(src: string, dest: string): Promise<void> {
    await this.fsx.rename(src, dest)
  }
}

// ============================================================================
// MIXIN TYPE
// ============================================================================

// Note: TypeScript requires any[] for mixin constructor patterns (TS2545)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = {}> = new (...args: any[]) => T

type DOConstructor<E extends Env = Env> = Constructor<DO<E>> & typeof DO<E>

export interface WithFsDO<E extends Env = Env> extends DO<E> {
  $: WithFsContext
}

// ============================================================================
// CAPABILITY IMPLEMENTATION
// ============================================================================

/**
 * File metadata stored alongside content in DurableObjectStorage.
 * All dates are stored as ISO strings for JSON serialization.
 */
interface FileMetadata {
  /** File size in bytes (string length for text content) */
  size: number
  /** Whether this entry represents a directory */
  isDirectory: boolean
  /** Creation timestamp as ISO 8601 string */
  createdAt: string
  /** Last modification timestamp as ISO 8601 string */
  modifiedAt: string
}

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Normalize a filesystem path to ensure consistent key format.
 *
 * - Ensures path starts with `/`
 * - Removes trailing slash (except for root `/`)
 * - Collapses multiple consecutive slashes into single slash
 *
 * @param path - The path to normalize
 * @returns Normalized path string
 *
 * @example
 * ```typescript
 * normalizePath('foo/bar')    // '/foo/bar'
 * normalizePath('/foo/bar/')  // '/foo/bar'
 * normalizePath('/')          // '/'
 * normalizePath('//foo//bar') // '/foo/bar'
 * ```
 */
function normalizePath(path: string): string {
  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path
  }
  // Collapse multiple consecutive slashes into single slash
  path = path.replace(/\/+/g, '/')
  // Remove trailing slash except for root
  if (path !== '/' && path.endsWith('/')) {
    path = path.slice(0, -1)
  }
  return path
}

/**
 * Get the parent directory path from a file path.
 *
 * @param path - The file or directory path
 * @returns Parent directory path (always at least '/')
 *
 * @example
 * ```typescript
 * getParentDir('/foo/bar/file.txt') // '/foo/bar'
 * getParentDir('/foo')               // '/'
 * getParentDir('/')                  // '/'
 * ```
 */
function getParentDir(path: string): string {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return normalized.slice(0, lastSlash)
}

/**
 * Get the basename (file or directory name) from a path.
 *
 * @param path - The file or directory path
 * @returns The last segment of the path
 *
 * @example
 * ```typescript
 * getBasename('/foo/bar/file.txt') // 'file.txt'
 * getBasename('/foo/bar')          // 'bar'
 * getBasename('/')                 // ''
 * ```
 */
function getBasename(path: string): string {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  return normalized.slice(lastSlash + 1)
}

/**
 * Creates an FsCapability instance backed by DurableObjectStorage (SQLite).
 *
 * This is the core filesystem implementation used by the withFs mixin.
 * All operations are transactional via the underlying SQLite storage.
 *
 * Storage layout (uses constants defined at module top):
 * - `fsx:file:/path` - File content (string)
 * - `fsx:meta:/path` - FileMetadata JSON (size, timestamps, type)
 * - `fsx:dir:/path`  - Directory marker (boolean true)
 *
 * @param storage - DurableObjectStorage instance from the DO state
 * @returns FsCapability implementation
 *
 * @internal
 */
function createFsCapability(storage: DurableObjectStorage): FsCapability {
  // Helper to check if a path exists as a file
  async function isFile(normalizedPath: string): Promise<boolean> {
    const fileContent = await storage.get(FS_STORAGE_PREFIX_FILE + normalizedPath)
    return fileContent !== undefined
  }

  // Helper to check if a path exists as a directory
  async function isDirectory(normalizedPath: string): Promise<boolean> {
    const dirMarker = await storage.get(FS_STORAGE_PREFIX_DIR + normalizedPath)
    return dirMarker !== undefined
  }

  // Helper to check if a path exists (file or directory)
  async function pathExists(normalizedPath: string): Promise<boolean> {
    return (await isFile(normalizedPath)) || (await isDirectory(normalizedPath))
  }

  // Helper to validate parent directory exists and is not a file
  async function validateParentPath(normalizedPath: string, syscall: string): Promise<void> {
    if (normalizedPath === '/') return

    const parentDir = getParentDir(normalizedPath)

    // Root always exists
    if (parentDir === '/') return

    // Check if parent exists as a file (ENOTDIR)
    if (await isFile(parentDir)) {
      throw new FsError('ENOTDIR', parentDir, syscall)
    }

    // Check if parent exists
    if (!(await pathExists(parentDir))) {
      throw new FsError('ENOENT', parentDir, syscall)
    }
  }

  // Helper to check if directory has any children
  async function hasChildren(normalizedPath: string): Promise<boolean> {
    const prefix = normalizedPath === '/' ? '/' : normalizedPath + '/'

    // Check for files
    const fileKeys = await storage.list<string>({ prefix: FS_STORAGE_PREFIX_FILE + prefix })
    if (fileKeys.size > 0) return true

    // Check for subdirectories
    const dirKeys = await storage.list<boolean>({ prefix: FS_STORAGE_PREFIX_DIR + prefix })
    if (dirKeys.size > 0) return true

    return false
  }

  return {
    async read(path: string, options?: FsReadOptions): Promise<string> {
      const normalizedPath = normalizePath(path)

      // Check if path is a directory
      if (await isDirectory(normalizedPath)) {
        throw new FsError('EISDIR', path, 'read')
      }

      const content = await storage.get<string>(FS_STORAGE_PREFIX_FILE + normalizedPath)
      if (content === undefined) {
        throw new FsError('ENOENT', path, 'read')
      }
      return content
    },

    async write(path: string, content: string, options?: FsWriteOptions): Promise<void> {
      const normalizedPath = normalizePath(path)

      // Check if path is a directory
      if (await isDirectory(normalizedPath)) {
        throw new FsError('EISDIR', path, 'write')
      }

      // Validate parent path exists and is not a file
      await validateParentPath(normalizedPath, 'write')

      const now = new Date().toISOString()

      // Check if file already exists to preserve createdAt
      const existingMeta = await storage.get<FileMetadata>(FS_STORAGE_PREFIX_META + normalizedPath)

      const metadata: FileMetadata = {
        size: content.length,
        isDirectory: false,
        createdAt: existingMeta?.createdAt ?? now,
        modifiedAt: now,
      }

      // Write file content and metadata atomically
      await storage.put(FS_STORAGE_PREFIX_FILE + normalizedPath, content)
      await storage.put(FS_STORAGE_PREFIX_META + normalizedPath, metadata)
    },

    async exists(path: string): Promise<boolean> {
      const normalizedPath = normalizePath(path)
      return pathExists(normalizedPath)
    },

    async delete(path: string): Promise<void> {
      const normalizedPath = normalizePath(path)

      // Check if path exists
      const fileExists = await isFile(normalizedPath)
      const dirExists = await isDirectory(normalizedPath)

      if (!fileExists && !dirExists) {
        throw new FsError('ENOENT', path, 'delete')
      }

      // If it's a directory, check if it's empty
      if (dirExists && (await hasChildren(normalizedPath))) {
        throw new FsError('ENOTEMPTY', path, 'delete')
      }

      // Delete file content, metadata, and directory marker
      await storage.delete(FS_STORAGE_PREFIX_FILE + normalizedPath)
      await storage.delete(FS_STORAGE_PREFIX_META + normalizedPath)
      await storage.delete(FS_STORAGE_PREFIX_DIR + normalizedPath)
    },

    async list(path: string, options?: FsListOptions): Promise<FsEntry[]> {
      const normalizedPath = normalizePath(path)

      // Check if path is a file (ENOTDIR)
      if (await isFile(normalizedPath)) {
        throw new FsError('ENOTDIR', path, 'list')
      }

      // Check if directory exists (root always exists)
      if (normalizedPath !== '/' && !(await isDirectory(normalizedPath))) {
        throw new FsError('ENOENT', path, 'list')
      }

      const prefix = normalizedPath === '/' ? '/' : normalizedPath + '/'

      const entries: FsEntry[] = []
      const seen = new Set<string>()

      // List all file keys
      const fileKeys = await storage.list<string>({ prefix: FS_STORAGE_PREFIX_FILE + prefix })
      for (const [key] of fileKeys) {
        // Extract the path after the prefix
        const fullPath = key.slice(FS_STORAGE_PREFIX_FILE.length)
        const relativePath = fullPath.slice(prefix.length)

        // Get the first segment (immediate child)
        const firstSlash = relativePath.indexOf('/')
        const name = firstSlash === -1 ? relativePath : relativePath.slice(0, firstSlash)

        if (name && !seen.has(name)) {
          seen.add(name)
          // If there's a slash, it's a directory containing this file
          const isDir = firstSlash !== -1
          entries.push({ name, isDirectory: isDir })
        }
      }

      // List all directory markers
      const dirKeys = await storage.list<boolean>({ prefix: FS_STORAGE_PREFIX_DIR + prefix })
      for (const [key] of dirKeys) {
        const fullPath = key.slice(FS_STORAGE_PREFIX_DIR.length)
        const relativePath = fullPath.slice(prefix.length)

        // Get the first segment
        const firstSlash = relativePath.indexOf('/')
        const name = firstSlash === -1 ? relativePath : relativePath.slice(0, firstSlash)

        if (name && !seen.has(name)) {
          seen.add(name)
          entries.push({ name, isDirectory: true })
        }
      }

      // Apply filter if provided
      if (options?.filter) {
        return entries.filter(options.filter)
      }

      return entries
    },

    async mkdir(path: string, options?: FsMkdirOptions): Promise<void> {
      const normalizedPath = normalizePath(path)

      // Root is always valid
      if (normalizedPath === '/') return

      // Check if path already exists as a file
      if (await isFile(normalizedPath)) {
        throw new FsError('EEXIST', path, 'mkdir')
      }

      if (options?.recursive) {
        // Create all parent directories
        const parts = normalizedPath.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current += '/' + part
          // Check if this path component is a file
          if (await isFile(current)) {
            throw new FsError('ENOTDIR', current, 'mkdir')
          }
          await storage.put(FS_STORAGE_PREFIX_DIR + current, true)
        }
      } else {
        // Check if parent exists
        const parentDir = getParentDir(normalizedPath)
        if (parentDir !== '/' && !(await pathExists(parentDir))) {
          throw new FsError('ENOENT', parentDir, 'mkdir')
        }

        await storage.put(FS_STORAGE_PREFIX_DIR + normalizedPath, true)
      }
    },

    async stat(path: string): Promise<FsStat> {
      const normalizedPath = normalizePath(path)

      // Check for file metadata
      const meta = await storage.get<FileMetadata>(FS_STORAGE_PREFIX_META + normalizedPath)
      if (meta) {
        return {
          size: meta.size,
          isFile: !meta.isDirectory,
          isDirectory: meta.isDirectory,
          createdAt: new Date(meta.createdAt),
          modifiedAt: new Date(meta.modifiedAt),
        }
      }

      // Check for directory marker
      const isDirMarker = await storage.get(FS_STORAGE_PREFIX_DIR + normalizedPath)
      if (isDirMarker !== undefined) {
        const now = new Date()
        return {
          size: 0,
          isFile: false,
          isDirectory: true,
          createdAt: now,
          modifiedAt: now,
        }
      }

      throw new FsError('ENOENT', path, 'stat')
    },

    async copy(src: string, dest: string): Promise<void> {
      const normalizedSrc = normalizePath(src)
      const normalizedDest = normalizePath(dest)

      // Check if source is a directory
      if (await isDirectory(normalizedSrc)) {
        throw new FsError('EISDIR', src, 'copy')
      }

      const content = await storage.get<string>(FS_STORAGE_PREFIX_FILE + normalizedSrc)
      if (content === undefined) {
        throw new FsError('ENOENT', src, 'copy')
      }

      // Validate destination parent path exists
      await validateParentPath(normalizedDest, 'copy')

      const now = new Date().toISOString()

      // Write to destination with new timestamps
      await storage.put(FS_STORAGE_PREFIX_FILE + normalizedDest, content)
      await storage.put(FS_STORAGE_PREFIX_META + normalizedDest, {
        size: content.length,
        isDirectory: false,
        createdAt: now,
        modifiedAt: now,
      } as FileMetadata)
    },

    async move(src: string, dest: string): Promise<void> {
      const normalizedSrc = normalizePath(src)
      const normalizedDest = normalizePath(dest)

      const content = await storage.get<string>(FS_STORAGE_PREFIX_FILE + normalizedSrc)
      if (content === undefined) {
        throw new FsError('ENOENT', src, 'move')
      }

      const srcMeta = await storage.get<FileMetadata>(FS_STORAGE_PREFIX_META + normalizedSrc)
      const now = new Date().toISOString()

      // Write to destination preserving original createdAt
      await storage.put(FS_STORAGE_PREFIX_FILE + normalizedDest, content)
      await storage.put(FS_STORAGE_PREFIX_META + normalizedDest, {
        size: content.length,
        isDirectory: false,
        createdAt: srcMeta?.createdAt ?? now,
        modifiedAt: now,
      } as FileMetadata)

      // Delete source
      await storage.delete(FS_STORAGE_PREFIX_FILE + normalizedSrc)
      await storage.delete(FS_STORAGE_PREFIX_META + normalizedSrc)
    },
  }
}

// ============================================================================
// MIXIN IMPLEMENTATION
// ============================================================================

// Symbol for caching the fs capability instance
const FS_CAPABILITY_CACHE = Symbol('fsCapabilityCache')
// Symbol for storing the storage reference
const FS_STORAGE_REF = Symbol('fsStorageRef')

/**
 * Adds filesystem capability to a DO class
 *
 * @example
 * ```typescript
 * class MyDO extends withFs(DO) {
 *   async readConfig() {
 *     return this.$.fs.read('/config.json')
 *   }
 * }
 * ```
 */
export function withFs<TBase extends Constructor<{ $: WorkflowContext }>>(Base: TBase): TBase & Constructor<{ $: WithFsContext }> {
  // @ts-expect-error - Mixin class augments $ type which TypeScript can't verify statically
  return class WithFs extends Base {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static capabilities = [...((Base as any).capabilities || []), 'fs']

    /**
     * Check if this DO class has a specific capability
     */
    hasCapability(name: string): boolean {
      if (name === 'fs') return true
      // Check if parent class has the hasCapability method (base DO class)
      const baseProto = Base.prototype
      if (baseProto && typeof baseProto.hasCapability === 'function') {
        return baseProto.hasCapability.call(this, name)
      }
      return false
    }

    // Cache for the fs capability instance
    private [FS_CAPABILITY_CACHE]?: FsCapability
    // Storage reference from constructor
    private [FS_STORAGE_REF]?: DurableObjectStorage

    /**
     * Lazy-loaded filesystem capability
     */
    private get fsCapability(): FsCapability {
      if (!this[FS_CAPABILITY_CACHE]) {
        const storage = this[FS_STORAGE_REF]
        if (!storage) {
          throw new Error('fsx: DurableObjectStorage not available - fs operations require DO storage')
        }
        this[FS_CAPABILITY_CACHE] = createFsCapability(storage)
      }
      return this[FS_CAPABILITY_CACHE]
    }

    // TypeScript requires any[] for mixin constructors (TS2545)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

      // Extract storage from the DurableObjectState (first constructor arg)
      // DO constructor signature: (state: DurableObjectState, env: Env)
      const state = args[0] as DurableObjectState | undefined
      if (state?.storage) {
        this[FS_STORAGE_REF] = state.storage
      }

      // Extend $ to include fs capability
      const originalContext = this.$
      const self = this

      // Create a new proxy that extends the original $ with fs
      this.$ = new Proxy(originalContext as WithFsContext, {
        get(target, prop: string | symbol) {
          if (prop === 'fs') {
            return self.fsCapability
          }
          // Forward to original context
          const value = (target as any)[prop]
          if (typeof value === 'function') {
            // Only bind if it has a bind method (not a Proxy or capability object)
            if (typeof value.bind === 'function') {
              // Don't bind capability functions that have custom properties
              const customProps = Object.getOwnPropertyNames(value).filter(
                (p) => p !== 'length' && p !== 'name' && p !== 'prototype'
              )
              if (customProps.length > 0) {
                return value
              }
              return value.bind(target)
            }
          }
          return value
        },
      })
    }
  }
}
