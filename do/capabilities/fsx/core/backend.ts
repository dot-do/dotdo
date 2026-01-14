/**
 * FsBackend Interface
 *
 * The pluggable storage backend interface for @dotdo/fsx.
 * Implement this interface to create custom storage backends
 * (SQLite, R2, Memory, Node.js fs, etc.)
 *
 * @module backend
 */

import type {
  Stats,
  StatsInit,
  Dirent,
  WriteOptions,
  MkdirOptions,
  RmdirOptions,
  ReaddirOptions,
  StorageTier,
} from './types.js'

// =============================================================================
// FileHandle Interface
// =============================================================================

/**
 * File handle for low-level file operations.
 *
 * Provides direct access to file contents with positioned read/write
 * operations, similar to Node.js fs.FileHandle.
 */
export interface FileHandle {
  /** File descriptor number */
  readonly fd: number

  /**
   * Read data from the file.
   *
   * @param buffer - Buffer to read into
   * @param offset - Offset in buffer to start writing
   * @param length - Number of bytes to read
   * @param position - Position in file to read from
   * @returns Bytes read and buffer
   */
  read(
    buffer: Uint8Array,
    offset?: number,
    length?: number,
    position?: number
  ): Promise<{ bytesRead: number; buffer: Uint8Array }>

  /**
   * Write data to the file.
   *
   * @param data - Data to write
   * @param position - Position in file to write at
   * @returns Bytes written
   */
  write(
    data: Uint8Array | string,
    position?: number
  ): Promise<{ bytesWritten: number }>

  /**
   * Read entire file contents.
   */
  readFile(): Promise<Uint8Array>

  /**
   * Replace entire file contents.
   */
  writeFile(data: Uint8Array | string): Promise<void>

  /**
   * Get file statistics.
   */
  stat(): Promise<Stats>

  /**
   * Change file permissions.
   */
  chmod(mode: number): Promise<void>

  /**
   * Change file ownership.
   */
  chown(uid: number, gid: number): Promise<void>

  /**
   * Close the file handle.
   */
  close(): Promise<void>

  /**
   * Synchronize file data and metadata to storage.
   */
  sync(): Promise<void>

  /**
   * Synchronize file data (not metadata) to storage.
   */
  datasync(): Promise<void>

  /**
   * Truncate the file to a specified length.
   *
   * @param length - The new file length in bytes (default: 0)
   */
  truncate(length?: number): Promise<void>
}

// =============================================================================
// Backend Types
// =============================================================================

/**
 * Result of a backend write operation.
 */
export interface BackendWriteResult {
  /** Number of bytes written */
  bytesWritten: number
  /** Storage tier where data was placed */
  tier: StorageTier
}

/**
 * Result of a backend read operation.
 */
export interface BackendReadResult {
  /** Raw data bytes */
  data: Uint8Array
  /** Storage tier from which data was read */
  tier: StorageTier
  /** File size */
  size: number
}

/**
 * Options for backend initialization.
 */
export interface BackendOptions {
  /** Base path or namespace for this backend */
  basePath?: string
  /** Default storage tier for new files */
  defaultTier?: StorageTier
}

// =============================================================================
// FsBackend Interface
// =============================================================================

/**
 * Pluggable storage backend interface.
 *
 * This is the abstraction layer that allows @dotdo/fsx to work with
 * different storage backends without any platform-specific dependencies.
 *
 * Implementations:
 * - `SqliteBackend` - Durable Object SQLite (hot tier)
 * - `R2Backend` - Cloudflare R2 (warm tier)
 * - `TieredBackend` - Combines multiple backends with automatic tiering
 * - `MemoryBackend` - In-memory for testing
 * - `NodeBackend` - Node.js fs module
 *
 * @example
 * ```typescript
 * import { FsBackend, FSx } from '@dotdo/fsx'
 *
 * // Create a custom backend
 * class MyBackend implements FsBackend {
 *   async readFile(path: string): Promise<Uint8Array> {
 *     // Your implementation
 *   }
 *   // ... other methods
 * }
 *
 * // Use with FSx
 * const fs = new FSx(new MyBackend())
 * ```
 */
export interface FsBackend {
  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Read file contents.
   *
   * @param path - Absolute path to the file
   * @returns Raw file data as Uint8Array
   * @throws ENOENT if file does not exist
   * @throws EISDIR if path is a directory
   */
  readFile(path: string): Promise<Uint8Array>

  /**
   * Write data to a file, creating it if necessary.
   *
   * @param path - Absolute path to the file
   * @param data - Data to write
   * @param options - Write options (mode, flag, tier)
   * @returns Write result with bytes written and tier
   * @throws ENOENT if parent directory does not exist
   */
  writeFile(
    path: string,
    data: Uint8Array,
    options?: WriteOptions
  ): Promise<BackendWriteResult>

  /**
   * Delete a file.
   *
   * @param path - Absolute path to the file
   * @throws ENOENT if file does not exist
   * @throws EISDIR if path is a directory
   */
  unlink(path: string): Promise<void>

  /**
   * Rename or move a file.
   *
   * @param oldPath - Current path
   * @param newPath - New path
   */
  rename(oldPath: string, newPath: string): Promise<void>

  /**
   * Append data to a file.
   *
   * @param path - Absolute path to the file
   * @param data - Data to append
   * @throws ENOENT if parent directory does not exist (creates file if it doesn't exist)
   */
  appendFile(path: string, data: Uint8Array): Promise<void>

  /**
   * Copy a file.
   *
   * @param src - Source file path
   * @param dest - Destination file path
   */
  copyFile(src: string, dest: string): Promise<void>

  // ===========================================================================
  // Directory Operations
  // ===========================================================================

  /**
   * Create a directory.
   *
   * @param path - Path to the directory
   * @param options - mkdir options (recursive, mode)
   */
  mkdir(path: string, options?: MkdirOptions): Promise<void>

  /**
   * Remove a directory.
   *
   * @param path - Path to the directory
   * @param options - rmdir options (recursive)
   */
  rmdir(path: string, options?: RmdirOptions): Promise<void>

  /**
   * Read directory contents.
   *
   * @param path - Path to the directory
   * @param options - readdir options
   * @returns Array of file names or Dirent objects
   */
  readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>

  // ===========================================================================
  // Metadata Operations
  // ===========================================================================

  /**
   * Get file or directory statistics.
   *
   * @param path - Path to the file or directory
   * @returns Stats object
   * @throws ENOENT if path does not exist
   */
  stat(path: string): Promise<Stats>

  /**
   * Get statistics without following symbolic links.
   *
   * @param path - Path to check
   * @returns Stats object for the link itself
   */
  lstat(path: string): Promise<Stats>

  /**
   * Check if a path exists.
   *
   * @param path - Path to check
   * @returns true if exists, false otherwise
   */
  exists(path: string): Promise<boolean>

  /**
   * Check file accessibility and permissions.
   *
   * @param path - Path to check
   * @param mode - Accessibility mode (F_OK, R_OK, W_OK, X_OK)
   * @throws ENOENT if path does not exist
   * @throws EACCES if access is denied
   */
  access(path: string, mode?: number): Promise<void>

  /**
   * Change file permissions.
   *
   * @param path - Path to the file
   * @param mode - New permissions
   */
  chmod(path: string, mode: number): Promise<void>

  /**
   * Change file ownership.
   *
   * @param path - Path to the file
   * @param uid - User ID
   * @param gid - Group ID
   */
  chown(path: string, uid: number, gid: number): Promise<void>

  /**
   * Update file timestamps.
   *
   * @param path - Path to the file
   * @param atime - Access time
   * @param mtime - Modification time
   */
  utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>

  // ===========================================================================
  // Symbolic Links
  // ===========================================================================

  /**
   * Create a symbolic link.
   *
   * @param target - Target path
   * @param path - Link path
   */
  symlink(target: string, path: string): Promise<void>

  /**
   * Create a hard link.
   *
   * @param existingPath - Existing file path
   * @param newPath - New link path
   */
  link(existingPath: string, newPath: string): Promise<void>

  /**
   * Read the target of a symbolic link.
   *
   * @param path - Path to the symbolic link
   * @returns Target path
   */
  readlink(path: string): Promise<string>

  // ===========================================================================
  // Path Operations
  // ===========================================================================

  /**
   * Resolve a path by following symbolic links.
   *
   * @param path - Path to resolve
   * @returns Resolved absolute path
   * @throws ENOENT if path does not exist
   * @throws ELOOP if too many symbolic links
   */
  realpath(path: string): Promise<string>

  /**
   * Create a unique temporary directory.
   *
   * @param prefix - Prefix for the directory name
   * @returns Path to the created directory
   */
  mkdtemp(prefix: string): Promise<string>

  // ===========================================================================
  // File Handle Operations
  // ===========================================================================

  /**
   * Open a file and return a file handle.
   *
   * @param path - Path to the file
   * @param flags - Open flags ('r', 'w', 'a', 'r+', etc.)
   * @param mode - File mode for new files
   * @returns FileHandle for the opened file
   * @throws ENOENT if file does not exist (for read modes)
   * @throws EEXIST if file exists (for exclusive modes)
   */
  open(path: string, flags?: string, mode?: number): Promise<FileHandle>

  // ===========================================================================
  // Optional Tiering Operations
  // ===========================================================================

  /**
   * Get the storage tier for a file.
   *
   * @param path - Path to the file
   * @returns Current storage tier
   */
  getTier?(path: string): Promise<StorageTier>

  /**
   * Move file to a higher tier.
   *
   * @param path - Path to the file
   * @param tier - Target tier
   */
  promote?(path: string, tier: 'hot' | 'warm'): Promise<void>

  /**
   * Move file to a lower tier.
   *
   * @param path - Path to the file
   * @param tier - Target tier
   */
  demote?(path: string, tier: 'warm' | 'cold'): Promise<void>
}

// =============================================================================
// Memory Backend (for testing)
// =============================================================================

/**
 * In-memory filesystem backend for testing.
 *
 * @example
 * ```typescript
 * const backend = new MemoryBackend()
 * const fs = new FSx(backend)
 *
 * await fs.write('/test.txt', 'Hello')
 * const content = await fs.read('/test.txt', { encoding: 'utf-8' })
 * ```
 */
export class MemoryBackend implements FsBackend {
  private files = new Map<string, { data: Uint8Array; stats: StatsInit }>()
  private directories = new Set<string>(['/'])

  /**
   * Normalize a path by resolving . and .., removing duplicate slashes,
   * and stripping trailing slashes (except for root).
   */
  private normalizePath(path: string): string {
    if (!path) {
      throw new Error('ENOENT: path cannot be empty')
    }

    // Handle double slashes by replacing with single slash
    path = path.replace(/\/+/g, '/')

    // Split and resolve . and ..
    const parts = path.split('/')
    const resolved: string[] = []

    for (const part of parts) {
      if (part === '..') {
        resolved.pop()
      } else if (part !== '.' && part !== '') {
        resolved.push(part)
      }
    }

    // Reconstruct path
    let result = '/' + resolved.join('/')

    // Strip trailing slash (except for root)
    if (result !== '/' && result.endsWith('/')) {
      result = result.slice(0, -1)
    }

    return result
  }

  /**
   * Get the parent directory of a path.
   */
  private getParentDir(path: string): string {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return '/'
    const lastSlash = normalized.lastIndexOf('/')
    return lastSlash === 0 ? '/' : normalized.slice(0, lastSlash)
  }

  /**
   * Check if parent directory exists and path components are valid.
   * Returns error type or null if valid.
   */
  private validatePath(path: string): 'ENOENT' | 'ENOTDIR' | null {
    const normalized = this.normalizePath(path)
    if (normalized === '/') return null

    const parts = normalized.split('/').filter(Boolean)
    let current = ''

    // Check all parent components
    for (let i = 0; i < parts.length - 1; i++) {
      current += '/' + parts[i]
      // If a file exists at this path, it's ENOTDIR
      if (this.files.has(current)) {
        return 'ENOTDIR'
      }
      // If neither file nor directory exists, it's ENOENT
      if (!this.directories.has(current)) {
        return 'ENOENT'
      }
    }

    return null
  }

  async readFile(path: string): Promise<Uint8Array> {
    const normalized = this.normalizePath(path)

    // Check if it's a directory first
    if (this.directories.has(normalized)) {
      throw new Error(`EISDIR: illegal operation on a directory: ${path}`)
    }

    const file = this.files.get(normalized)
    if (!file) {
      throw new Error(`ENOENT: no such file: ${path}`)
    }
    return file.data
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    options?: WriteOptions
  ): Promise<BackendWriteResult> {
    const normalized = this.normalizePath(path)

    // Check if path is a directory
    if (this.directories.has(normalized)) {
      throw new Error(`EISDIR: illegal operation on a directory: ${path}`)
    }

    // Validate parent path
    const pathError = this.validatePath(normalized)
    if (pathError === 'ENOTDIR') {
      throw new Error(`ENOTDIR: not a directory: ${path}`)
    }
    if (pathError === 'ENOENT') {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }

    const now = Date.now()
    const mode = options?.mode ?? 0o644

    const existing = this.files.get(normalized)
    const ino = existing?.stats.ino ?? this.files.size + 1
    const birthtimeMs = existing?.stats.birthtimeMs ?? now

    this.files.set(normalized, {
      data,
      stats: {
        dev: 1,
        ino,
        mode: 0o100000 | mode, // S_IFREG | mode
        nlink: 1,
        uid: 0,
        gid: 0,
        rdev: 0,
        size: data.length,
        blksize: 4096,
        blocks: Math.ceil(data.length / 512),
        atimeMs: now,
        mtimeMs: now,
        ctimeMs: now,
        birthtimeMs,
      },
    })

    return { bytesWritten: data.length, tier: 'hot' }
  }

  async appendFile(path: string, data: Uint8Array): Promise<void> {
    const normalized = this.normalizePath(path)
    const existing = this.files.get(normalized)

    if (existing) {
      const newData = new Uint8Array(existing.data.length + data.length)
      newData.set(existing.data)
      newData.set(data, existing.data.length)
      existing.data = newData
      existing.stats.size = newData.length
      existing.stats.mtimeMs = Date.now()
    } else {
      await this.writeFile(path, data)
    }
  }

  async unlink(path: string): Promise<void> {
    const normalized = this.normalizePath(path)

    // Check if it's a directory
    if (this.directories.has(normalized)) {
      throw new Error(`EISDIR: illegal operation on a directory: ${path}`)
    }

    if (!this.files.has(normalized)) {
      throw new Error(`ENOENT: no such file: ${path}`)
    }
    this.files.delete(normalized)
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const normalizedOld = this.normalizePath(oldPath)
    const normalizedNew = this.normalizePath(newPath)

    // Check destination parent exists
    const destParent = this.getParentDir(normalizedNew)
    if (destParent !== '/' && !this.directories.has(destParent)) {
      throw new Error(`ENOENT: no such file or directory: ${newPath}`)
    }

    // Check if source is a directory
    if (this.directories.has(normalizedOld)) {
      // Rename directory
      const oldPrefix = normalizedOld === '/' ? '/' : normalizedOld + '/'

      // Collect all paths to rename
      const filesToRename: Array<{ old: string; new: string; file: { data: Uint8Array; stats: StatsInit } }> = []
      const dirsToRename: Array<{ old: string; new: string }> = []

      for (const [filePath, file] of this.files) {
        if (filePath.startsWith(oldPrefix)) {
          const newFilePath = normalizedNew + filePath.slice(normalizedOld.length)
          filesToRename.push({ old: filePath, new: newFilePath, file })
        }
      }

      for (const dirPath of this.directories) {
        if (dirPath === normalizedOld || dirPath.startsWith(oldPrefix)) {
          const newDirPath = normalizedNew + dirPath.slice(normalizedOld.length)
          dirsToRename.push({ old: dirPath, new: newDirPath })
        }
      }

      // Apply renames
      for (const { old, new: newPath, file } of filesToRename) {
        this.files.delete(old)
        this.files.set(newPath, file)
      }

      for (const { old, new: newPath } of dirsToRename) {
        this.directories.delete(old)
        this.directories.add(newPath)
      }

      return
    }

    // Rename file
    const file = this.files.get(normalizedOld)
    if (!file) {
      throw new Error(`ENOENT: no such file: ${oldPath}`)
    }

    // Remove destination if it exists (overwrite)
    this.files.delete(normalizedNew)

    this.files.set(normalizedNew, file)
    this.files.delete(normalizedOld)
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const normalizedSrc = this.normalizePath(src)
    const normalizedDest = this.normalizePath(dest)

    // Check if source is a directory
    if (this.directories.has(normalizedSrc)) {
      throw new Error(`EISDIR: illegal operation on a directory: ${src}`)
    }

    const file = this.files.get(normalizedSrc)
    if (!file) {
      throw new Error(`ENOENT: no such file: ${src}`)
    }

    // Check destination parent exists
    const destParent = this.getParentDir(normalizedDest)
    if (destParent !== '/' && !this.directories.has(destParent)) {
      throw new Error(`ENOENT: no such file or directory: ${dest}`)
    }

    const now = Date.now()
    this.files.set(normalizedDest, {
      data: new Uint8Array(file.data),
      stats: { ...file.stats, atimeMs: now, mtimeMs: now, ctimeMs: now },
    })
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const normalized = this.normalizePath(path)

    // Check if file exists at path
    if (this.files.has(normalized)) {
      throw new Error(`EEXIST: file exists: ${path}`)
    }

    if (options?.recursive) {
      // With recursive, we don't throw if directory exists
      if (this.directories.has(normalized)) {
        return
      }

      const parts = normalized.split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current += '/' + part
        // Check if a file exists in the path
        if (this.files.has(current)) {
          throw new Error(`ENOTDIR: not a directory: ${current}`)
        }
        this.directories.add(current)
      }
    } else {
      // Non-recursive: check if already exists
      if (this.directories.has(normalized)) {
        throw new Error(`EEXIST: directory exists: ${path}`)
      }

      // Check parent exists and is valid
      const pathError = this.validatePath(normalized)
      if (pathError === 'ENOTDIR') {
        throw new Error(`ENOTDIR: not a directory: ${path}`)
      }
      if (pathError === 'ENOENT') {
        throw new Error(`ENOENT: no such file or directory: ${path}`)
      }

      this.directories.add(normalized)
    }
  }

  async rmdir(path: string, options?: RmdirOptions): Promise<void> {
    const normalized = this.normalizePath(path)

    // Cannot remove root
    if (normalized === '/') {
      throw new Error('EPERM: operation not permitted: /')
    }

    // Check if it's a file
    if (this.files.has(normalized)) {
      throw new Error(`ENOTDIR: not a directory: ${path}`)
    }

    if (!this.directories.has(normalized)) {
      throw new Error(`ENOENT: no such directory: ${path}`)
    }

    // Check if directory is empty
    const prefix = normalized + '/'
    const hasChildren = [...this.files.keys(), ...this.directories].some(
      (p) => p !== normalized && p.startsWith(prefix)
    )
    if (hasChildren && !options?.recursive) {
      throw new Error(`ENOTEMPTY: directory not empty: ${path}`)
    }
    if (options?.recursive) {
      for (const file of this.files.keys()) {
        if (file.startsWith(prefix)) {
          this.files.delete(file)
        }
      }
      for (const dir of this.directories) {
        if (dir.startsWith(prefix)) {
          this.directories.delete(dir)
        }
      }
    }
    this.directories.delete(normalized)
  }

  async readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]> {
    const normalized = this.normalizePath(path)

    // Check if it's a file
    if (this.files.has(normalized)) {
      throw new Error(`ENOTDIR: not a directory: ${path}`)
    }

    // Check if directory exists
    if (!this.directories.has(normalized)) {
      throw new Error(`ENOENT: no such directory: ${path}`)
    }

    const prefix = normalized === '/' ? '/' : normalized + '/'
    const entries = new Set<string>()

    // Find direct children
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        const relative = file.slice(prefix.length)
        const firstPart = relative.split('/')[0]
        if (firstPart) entries.add(firstPart)
      }
    }
    for (const dir of this.directories) {
      if (dir.startsWith(prefix) && dir !== normalized) {
        const relative = dir.slice(prefix.length)
        const firstPart = relative.split('/')[0]
        if (firstPart) entries.add(firstPart)
      }
    }

    if (options?.withFileTypes) {
      const { Dirent: DirentClass } = await import('./types.js')
      const result: Dirent[] = []
      for (const name of entries) {
        const fullPath = prefix + name
        const isDir = this.directories.has(fullPath)
        result.push(new DirentClass(name, normalized, isDir ? 'directory' : 'file'))
      }
      return result
    }

    return [...entries]
  }

  async stat(path: string): Promise<Stats> {
    const normalized = this.normalizePath(path)

    // Check if it's a file
    const file = this.files.get(normalized)
    if (file) {
      const { Stats } = await import('./types.js')
      return new Stats(file.stats)
    }

    // Check if it's a directory
    if (this.directories.has(normalized)) {
      const { Stats } = await import('./types.js')
      const now = Date.now()
      return new Stats({
        dev: 1,
        ino: 0,
        mode: 0o40755, // S_IFDIR | 0o755
        nlink: 2,
        uid: 0,
        gid: 0,
        rdev: 0,
        size: 4096,
        blksize: 4096,
        blocks: 8,
        atimeMs: now,
        mtimeMs: now,
        ctimeMs: now,
        birthtimeMs: now,
      })
    }

    throw new Error(`ENOENT: no such file or directory: ${path}`)
  }

  async lstat(path: string): Promise<Stats> {
    return this.stat(path)
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path)
    return this.files.has(normalized) || this.directories.has(normalized)
  }

  async access(path: string, _mode?: number): Promise<void> {
    const normalized = this.normalizePath(path)
    if (!this.files.has(normalized) && !this.directories.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    // In a full implementation, we'd check mode against file permissions
  }

  async chmod(path: string, mode: number): Promise<void> {
    const normalized = this.normalizePath(path)

    const file = this.files.get(normalized)
    if (file) {
      file.stats.mode = 0o100000 | (mode & 0o777) // S_IFREG | mode
      return
    }

    if (this.directories.has(normalized)) {
      // Directories don't store stats in our simple implementation
      // but we accept the call
      return
    }

    throw new Error(`ENOENT: no such file or directory: ${path}`)
  }

  async chown(path: string, uid: number, gid: number): Promise<void> {
    const normalized = this.normalizePath(path)

    const file = this.files.get(normalized)
    if (file) {
      file.stats.uid = uid
      file.stats.gid = gid
      return
    }

    if (this.directories.has(normalized)) {
      // Directories don't store stats in our simple implementation
      return
    }

    throw new Error(`ENOENT: no such file or directory: ${path}`)
  }

  async utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
    const normalized = this.normalizePath(path)

    const atimeMs = atime instanceof Date ? atime.getTime() : atime
    const mtimeMs = mtime instanceof Date ? mtime.getTime() : mtime

    const file = this.files.get(normalized)
    if (file) {
      file.stats.atimeMs = atimeMs
      file.stats.mtimeMs = mtimeMs
      return
    }

    if (this.directories.has(normalized)) {
      // Directories don't store stats in our simple implementation
      return
    }

    throw new Error(`ENOENT: no such file or directory: ${path}`)
  }

  async symlink(_target: string, _path: string): Promise<void> {
    throw new Error('Symlinks not supported in memory backend')
  }

  async link(_existingPath: string, _newPath: string): Promise<void> {
    throw new Error('Hard links not supported in memory backend')
  }

  async readlink(_path: string): Promise<string> {
    throw new Error('Symlinks not supported in memory backend')
  }

  async realpath(path: string): Promise<string> {
    const normalized = this.normalizePath(path)
    if (!this.files.has(normalized) && !this.directories.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    return normalized
  }

  async mkdtemp(prefix: string): Promise<string> {
    const random = Math.random().toString(36).substring(2, 8)
    const path = `${prefix}${random}`
    await this.mkdir(path)
    return path
  }

  async open(_path: string, _flags?: string, _mode?: number): Promise<FileHandle> {
    throw new Error('File handles not supported in basic MemoryBackend. Use MockBackend instead.')
  }

  // Optional tiering operations
  async getTier(path: string): Promise<StorageTier> {
    const normalized = this.normalizePath(path)
    if (!this.files.has(normalized)) {
      throw new Error(`ENOENT: no such file: ${path}`)
    }
    return 'hot'
  }

  async promote(_path: string, _tier: 'hot' | 'warm'): Promise<void> {
    // No-op for memory backend - everything is already "hot"
  }

  async demote(_path: string, _tier: 'warm' | 'cold'): Promise<void> {
    // No-op for memory backend
  }
}
