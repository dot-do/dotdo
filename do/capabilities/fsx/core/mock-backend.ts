/**
 * MockBackend - Full in-memory filesystem implementation for testing.
 *
 * This module provides a complete FsBackend implementation with support for:
 * - Files and directories
 * - Symbolic links and hard links
 * - File handles with positioned read/write
 * - All POSIX error codes (ENOENT, EEXIST, EISDIR, ENOTDIR, ENOTEMPTY, etc.)
 *
 * @module mock-backend
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
import type { FsBackend, BackendWriteResult, FileHandle } from './backend.js'
import { constants } from './constants.js'

const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_TRUNC, O_APPEND } = constants

// =============================================================================
// Flag Parsing Types and Utilities
// =============================================================================

/**
 * Access mode for file operations.
 * Determines what operations are permitted on a file handle.
 */
type AccessMode = 'read' | 'write' | 'readwrite'

/**
 * Parsed file open flags.
 * Contains all the information needed to open a file correctly.
 */
interface ParsedFlags {
  /** Access mode: read, write, or readwrite */
  accessMode: AccessMode
  /** Create file if it doesn't exist */
  create: boolean
  /** Fail if file already exists (with create) */
  exclusive: boolean
  /** Truncate file to zero length on open */
  truncate: boolean
  /** Append all writes to end of file */
  append: boolean
  /** Synchronous I/O mode (not implemented, for compatibility) */
  sync: boolean
}

/**
 * Parses POSIX file open flags into a structured format.
 *
 * Supports both string flags ('r', 'w+', 'ax', etc.) and numeric flags
 * (O_RDONLY, O_WRONLY | O_CREAT, etc.).
 *
 * @example String flags:
 * - 'r'  : Read-only, file must exist
 * - 'r+' : Read/write, file must exist
 * - 'w'  : Write-only, create/truncate
 * - 'w+' : Read/write, create/truncate
 * - 'a'  : Append-only, create if needed
 * - 'a+' : Append/read, create if needed
 * - 'x'  : Exclusive flag (combine with w/a)
 * - 's'  : Synchronous flag (combine with any)
 *
 * @param flags - String or numeric flags
 * @returns Parsed flag object
 * @throws Error with EINVAL if flags are invalid
 */
function parseFlags(flags: string | number | undefined): ParsedFlags {
  // Default to read-only
  if (flags === undefined || flags === 'r') {
    return {
      accessMode: 'read',
      create: false,
      exclusive: false,
      truncate: false,
      append: false,
      sync: false,
    }
  }

  // Handle numeric flags
  if (typeof flags === 'number' || /^\d+$/.test(flags as string)) {
    const numFlags = typeof flags === 'number' ? flags : parseInt(flags as string, 10)
    return parseNumericFlags(numFlags)
  }

  // Handle string flags
  return parseStringFlags(flags as string)
}

/**
 * Parses numeric POSIX flags (O_RDONLY, O_WRONLY, etc.).
 *
 * @param flags - Numeric flags (can be combined with |)
 * @returns Parsed flag object
 */
function parseNumericFlags(flags: number): ParsedFlags {
  // Extract access mode from lowest 2 bits
  const accessBits = flags & 3 // O_RDONLY=0, O_WRONLY=1, O_RDWR=2

  let accessMode: AccessMode
  switch (accessBits) {
    case O_RDONLY:
      accessMode = 'read'
      break
    case O_WRONLY:
      accessMode = 'write'
      break
    case O_RDWR:
      accessMode = 'readwrite'
      break
    default:
      accessMode = 'read'
  }

  return {
    accessMode,
    create: (flags & O_CREAT) !== 0,
    exclusive: (flags & O_EXCL) !== 0,
    truncate: (flags & O_TRUNC) !== 0,
    append: (flags & O_APPEND) !== 0,
    sync: (flags & constants.O_SYNC) !== 0,
  }
}

/**
 * Parses string flags ('r', 'w+', 'ax', etc.).
 *
 * Valid base flags:
 * - 'r'  : Open for reading (file must exist)
 * - 'r+' : Open for reading and writing (file must exist)
 * - 'w'  : Open for writing (create/truncate)
 * - 'w+' : Open for reading and writing (create/truncate)
 * - 'a'  : Open for appending (create if needed)
 * - 'a+' : Open for reading and appending (create if needed)
 *
 * Modifiers (can appear in any order):
 * - 'x'  : Exclusive - fail if file exists
 * - 's'  : Synchronous mode
 *
 * @param flags - String flags
 * @returns Parsed flag object
 * @throws Error with EINVAL if flags are invalid
 */
function parseStringFlags(flags: string): ParsedFlags {
  // Normalize: remove 's' (sync) and sort remaining
  const hasSync = flags.includes('s')
  const hasExclusive = flags.includes('x')
  const baseFlags = flags.replace(/[sx]/g, '')

  // Valid base flag patterns
  const validPatterns: Record<string, Omit<ParsedFlags, 'sync' | 'exclusive'>> = {
    r: { accessMode: 'read', create: false, truncate: false, append: false },
    'r+': { accessMode: 'readwrite', create: false, truncate: false, append: false },
    '+r': { accessMode: 'readwrite', create: false, truncate: false, append: false },
    rs: { accessMode: 'read', create: false, truncate: false, append: false },
    'rs+': { accessMode: 'readwrite', create: false, truncate: false, append: false },
    'sr+': { accessMode: 'readwrite', create: false, truncate: false, append: false },
    w: { accessMode: 'write', create: true, truncate: true, append: false },
    'w+': { accessMode: 'readwrite', create: true, truncate: true, append: false },
    '+w': { accessMode: 'readwrite', create: true, truncate: true, append: false },
    a: { accessMode: 'write', create: true, truncate: false, append: true },
    'a+': { accessMode: 'readwrite', create: true, truncate: false, append: true },
    '+a': { accessMode: 'readwrite', create: true, truncate: false, append: true },
  }

  const pattern = validPatterns[baseFlags]
  if (!pattern) {
    throw new Error(`EINVAL: invalid flags: ${flags}`)
  }

  return {
    ...pattern,
    exclusive: hasExclusive,
    sync: hasSync,
  }
}

// =============================================================================
// MockBackend Implementation
// =============================================================================

/**
 * In-memory filesystem backend for testing.
 *
 * Provides a complete implementation of FsBackend with full support for:
 * - File and directory operations
 * - Symbolic links and hard links
 * - File handles for positioned I/O
 * - Proper POSIX error semantics
 *
 * @example
 * ```typescript
 * import { MockBackend } from '@dotdo/fsx/mock-backend'
 *
 * const backend = new MockBackend()
 *
 * // Create files and directories
 * await backend.mkdir('/src', { recursive: true })
 * await backend.writeFile('/src/index.ts', new TextEncoder().encode('export {}'))
 *
 * // Read back
 * const data = await backend.readFile('/src/index.ts')
 * console.log(new TextDecoder().decode(data))
 * ```
 */
export class MockBackend implements FsBackend {
  private files = new Map<string, { data: Uint8Array; stats: StatsInit }>()
  private directories = new Set<string>(['/'])
  private symlinks = new Map<string, string>()
  private nextFd = 3 // 0, 1, 2 are stdin, stdout, stderr

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

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
   * Create a Stats object from StatsInit.
   */
  private createStats(isDir: boolean, size: number, mode?: number): StatsInit {
    const now = Date.now()
    return {
      dev: 1,
      ino: this.files.size + this.directories.size + 1,
      mode: isDir ? constants.S_IFDIR | 0o755 : constants.S_IFREG | (mode ?? 0o644),
      nlink: isDir ? 2 : 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size: isDir ? 4096 : size,
      blksize: 4096,
      blocks: Math.ceil((isDir ? 4096 : size) / 512),
      atimeMs: now,
      mtimeMs: now,
      ctimeMs: now,
      birthtimeMs: now,
    }
  }

  /**
   * Create a Stats-like object from StatsInit.
   */
  private createStatsObject(init: StatsInit): Stats {
    return {
      ...init,
      get atime() {
        return new Date(init.atimeMs)
      },
      get mtime() {
        return new Date(init.mtimeMs)
      },
      get ctime() {
        return new Date(init.ctimeMs)
      },
      get birthtime() {
        return new Date(init.birthtimeMs)
      },
      isFile: () => (init.mode & constants.S_IFMT) === constants.S_IFREG,
      isDirectory: () => (init.mode & constants.S_IFMT) === constants.S_IFDIR,
      isSymbolicLink: () => (init.mode & constants.S_IFMT) === constants.S_IFLNK,
      isBlockDevice: () => (init.mode & constants.S_IFMT) === constants.S_IFBLK,
      isCharacterDevice: () => (init.mode & constants.S_IFMT) === constants.S_IFCHR,
      isFIFO: () => (init.mode & constants.S_IFMT) === constants.S_IFIFO,
      isSocket: () => (init.mode & constants.S_IFMT) === constants.S_IFSOCK,
    } as Stats
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  async readFile(path: string): Promise<Uint8Array> {
    const normalized = this.normalizePath(path)

    // Check if it's a directory
    if (this.directories.has(normalized)) {
      throw new Error(`EISDIR: illegal operation on a directory: ${path}`)
    }

    const file = this.files.get(normalized)
    if (!file) {
      throw new Error(`ENOENT: no such file: ${path}`)
    }
    return file.data
  }

  /**
   * Check if any path component (excluding the final name) is a file.
   * Returns the file path if found, null otherwise.
   */
  private findFileInPath(path: string): string | null {
    const normalized = this.normalizePath(path)
    const parts = normalized.split('/').filter(Boolean)
    let current = ''
    // Check all components except the last (which is the target file/dir name)
    for (let i = 0; i < parts.length - 1; i++) {
      current += '/' + parts[i]
      if (this.files.has(current)) {
        return current
      }
    }
    return null
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

    // Check if any path component is a file (ENOTDIR takes precedence)
    const fileInPath = this.findFileInPath(normalized)
    if (fileInPath) {
      throw new Error(`ENOTDIR: not a directory: ${path}`)
    }

    // Check parent exists
    const parent = this.getParentDir(normalized)
    if (parent !== '/' && !this.directories.has(parent)) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }

    const mode = options?.mode ?? 0o644
    const existing = this.files.get(normalized)

    if (existing) {
      // Update existing file (preserves hard links)
      existing.data = data
      existing.stats.size = data.length
      existing.stats.mtimeMs = Date.now()
      existing.stats.ctimeMs = Date.now()
      if (options?.mode !== undefined) {
        existing.stats.mode = constants.S_IFREG | (mode & 0o777)
      }
    } else {
      // Create new file
      this.files.set(normalized, {
        data,
        stats: this.createStats(false, data.length, mode),
      })
    }

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

    if (!this.files.has(normalized) && !this.symlinks.has(normalized)) {
      throw new Error(`ENOENT: no such file: ${path}`)
    }

    this.files.delete(normalized)
    this.symlinks.delete(normalized)
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
      // Rename directory and all contents
      const oldPrefix = normalizedOld === '/' ? '/' : normalizedOld + '/'

      // Collect all paths to rename
      const filesToRename: Array<{
        old: string
        new: string
        file: { data: Uint8Array; stats: StatsInit }
      }> = []
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
      for (const { old, new: newP, file } of filesToRename) {
        this.files.delete(old)
        this.files.set(newP, file)
      }

      for (const { old, new: newP } of dirsToRename) {
        this.directories.delete(old)
        this.directories.add(newP)
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

  // ===========================================================================
  // Directory Operations
  // ===========================================================================

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

      // Check if any path component is a file (ENOTDIR takes precedence)
      const fileInPath = this.findFileInPath(normalized)
      if (fileInPath) {
        throw new Error(`ENOTDIR: not a directory: ${path}`)
      }

      // Check parent exists
      const parent = this.getParentDir(normalized)
      if (parent !== '/' && !this.directories.has(parent)) {
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
      // Collect files and directories to delete
      const filesToDelete: string[] = []
      for (const file of this.files.keys()) {
        if (file.startsWith(prefix)) {
          filesToDelete.push(file)
        }
      }

      const dirsToDelete: string[] = []
      for (const dir of this.directories) {
        if (dir.startsWith(prefix)) {
          dirsToDelete.push(dir)
        }
      }

      // Delete files in parallel using Promise.all
      // This enables proper async handling and allows for concurrent operations
      await Promise.all(filesToDelete.map((file) => this.unlink(file)))

      // Delete directories (deepest first to handle nesting)
      // Sort by path length descending to delete children before parents
      dirsToDelete.sort((a, b) => b.length - a.length)
      for (const dir of dirsToDelete) {
        this.directories.delete(dir)
      }
    }

    this.directories.delete(normalized)
  }

  async readdir(
    path: string,
    options?: ReaddirOptions
  ): Promise<string[] | Dirent[]> {
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

    // Find direct children - files
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        const relative = file.slice(prefix.length)
        const firstPart = relative.split('/')[0]
        if (firstPart) entries.add(firstPart)
      }
    }

    // Find direct children - directories
    for (const dir of this.directories) {
      if (dir.startsWith(prefix) && dir !== normalized) {
        const relative = dir.slice(prefix.length)
        const firstPart = relative.split('/')[0]
        if (firstPart) entries.add(firstPart)
      }
    }

    // Find direct children - symlinks
    for (const symlink of this.symlinks.keys()) {
      if (symlink.startsWith(prefix)) {
        const relative = symlink.slice(prefix.length)
        const firstPart = relative.split('/')[0]
        if (firstPart) entries.add(firstPart)
      }
    }

    if (options?.withFileTypes) {
      const result: Dirent[] = []
      for (const name of entries) {
        const fullPath = prefix + name
        const isSymlink = this.symlinks.has(fullPath)
        const isDir = this.directories.has(fullPath)
        const isFile = this.files.has(fullPath)
        result.push({
          name,
          parentPath: normalized,
          isFile: () => isFile && !isSymlink,
          isDirectory: () => isDir && !isSymlink,
          isSymbolicLink: () => isSymlink,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          get path() {
            return fullPath
          },
        } as Dirent)
      }
      return result
    }

    return [...entries]
  }

  // ===========================================================================
  // Metadata Operations
  // ===========================================================================

  async stat(path: string): Promise<Stats> {
    const normalized = this.normalizePath(path)

    // Follow symlinks
    if (this.symlinks.has(normalized)) {
      const target = this.symlinks.get(normalized)!
      return this.stat(target)
    }

    const file = this.files.get(normalized)
    if (file) {
      return this.createStatsObject(file.stats)
    }

    if (this.directories.has(normalized)) {
      return this.createStatsObject(this.createStats(true, 4096))
    }

    throw new Error(`ENOENT: no such file or directory: ${path}`)
  }

  async lstat(path: string): Promise<Stats> {
    const normalized = this.normalizePath(path)

    // Don't follow symlinks
    if (this.symlinks.has(normalized)) {
      const target = this.symlinks.get(normalized)!
      return this.createStatsObject({
        ...this.createStats(false, target.length),
        mode: constants.S_IFLNK | 0o777,
      })
    }

    return this.stat(path)
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path)
    return (
      this.files.has(normalized) ||
      this.directories.has(normalized) ||
      this.symlinks.has(normalized)
    )
  }

  async access(path: string, _mode?: number): Promise<void> {
    const normalized = this.normalizePath(path)
    if (
      !this.files.has(normalized) &&
      !this.directories.has(normalized) &&
      !this.symlinks.has(normalized)
    ) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    // In a full implementation, we'd check mode against file permissions
  }

  async chmod(path: string, mode: number): Promise<void> {
    const normalized = this.normalizePath(path)

    const file = this.files.get(normalized)
    if (file) {
      file.stats.mode = constants.S_IFREG | (mode & 0o777)
      return
    }

    if (this.directories.has(normalized)) {
      // Directories don't store stats in this simple impl
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
      // Directories don't store stats in this simple impl
      return
    }

    throw new Error(`ENOENT: no such file or directory: ${path}`)
  }

  async utimes(
    path: string,
    atime: Date | number,
    mtime: Date | number
  ): Promise<void> {
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
      // Directories don't store stats in this simple impl
      return
    }

    throw new Error(`ENOENT: no such file or directory: ${path}`)
  }

  // ===========================================================================
  // Symbolic Links
  // ===========================================================================

  async readlink(path: string): Promise<string> {
    const normalized = this.normalizePath(path)
    const target = this.symlinks.get(normalized)

    if (!target) {
      if (this.files.has(normalized) || this.directories.has(normalized)) {
        throw new Error(`EINVAL: invalid argument, not a symlink: ${path}`)
      }
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }

    return target
  }

  async symlink(target: string, path: string): Promise<void> {
    const normalized = this.normalizePath(path)

    if (
      this.files.has(normalized) ||
      this.directories.has(normalized) ||
      this.symlinks.has(normalized)
    ) {
      throw new Error(`EEXIST: file already exists: ${path}`)
    }

    const parent = this.getParentDir(normalized)
    if (parent !== '/' && !this.directories.has(parent)) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }

    this.symlinks.set(normalized, target)
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    const normalizedExisting = this.normalizePath(existingPath)
    const normalizedNew = this.normalizePath(newPath)

    if (this.directories.has(normalizedExisting)) {
      throw new Error(
        `EPERM: operation not permitted, hard link to directory: ${existingPath}`
      )
    }

    const file = this.files.get(normalizedExisting)
    if (!file) {
      throw new Error(`ENOENT: no such file: ${existingPath}`)
    }

    if (
      this.files.has(normalizedNew) ||
      this.directories.has(normalizedNew) ||
      this.symlinks.has(normalizedNew)
    ) {
      throw new Error(`EEXIST: file already exists: ${newPath}`)
    }

    const parent = this.getParentDir(normalizedNew)
    if (parent !== '/' && !this.directories.has(parent)) {
      throw new Error(`ENOENT: no such file or directory: ${newPath}`)
    }

    // Hard link shares the same data
    this.files.set(normalizedNew, file)
    file.stats.nlink++
  }

  // ===========================================================================
  // Path Operations
  // ===========================================================================

  async realpath(path: string): Promise<string> {
    const normalized = this.normalizePath(path)
    let current = normalized
    const seen = new Set<string>()

    while (this.symlinks.has(current)) {
      if (seen.has(current)) {
        throw new Error(`ELOOP: too many levels of symbolic links: ${path}`)
      }
      seen.add(current)
      const target = this.symlinks.get(current)!
      current = target.startsWith('/')
        ? this.normalizePath(target)
        : this.normalizePath(this.getParentDir(current) + '/' + target)
    }

    if (!this.files.has(current) && !this.directories.has(current)) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }

    return current
  }

  async mkdtemp(prefix: string): Promise<string> {
    const random = Math.random().toString(36).substring(2, 8)
    const path = `${prefix}${random}`
    await this.mkdir(path)
    return path
  }

  // ===========================================================================
  // File Handle
  // ===========================================================================

  /**
   * Open a file and return a file handle for low-level operations.
   *
   * This method implements POSIX-compatible file opening semantics:
   *
   * **String Flags:**
   * - `'r'`  : Open for reading. File must exist. (default)
   * - `'r+'` : Open for reading and writing. File must exist.
   * - `'w'`  : Open for writing. Creates file or truncates to zero.
   * - `'w+'` : Open for reading and writing. Creates or truncates.
   * - `'a'`  : Open for appending. Creates file if needed.
   * - `'a+'` : Open for reading and appending. Creates if needed.
   * - `'x'`  : Exclusive flag. Combine with w/a to fail if file exists.
   * - `'s'`  : Synchronous mode. Combine with any flag.
   *
   * **Numeric Flags:**
   * - `O_RDONLY` (0): Read-only access
   * - `O_WRONLY` (1): Write-only access
   * - `O_RDWR` (2): Read/write access
   * - `O_CREAT` (64): Create file if it doesn't exist
   * - `O_EXCL` (128): With O_CREAT, fail if file exists
   * - `O_TRUNC` (512): Truncate file to zero length
   * - `O_APPEND` (1024): Append mode - writes go to end
   *
   * @param path - Absolute path to the file
   * @param flags - Open flags (string or numeric), defaults to 'r'
   * @param mode - File mode for newly created files (default 0o644)
   * @returns FileHandle for the opened file
   *
   * @throws ENOENT - File does not exist (for read modes without create)
   * @throws ENOENT - Parent directory does not exist
   * @throws EEXIST - File exists (with exclusive flag)
   * @throws EISDIR - Path is a directory
   * @throws EINVAL - Invalid flag combination
   *
   * @example
   * ```typescript
   * // Read-only
   * const handle = await backend.open('/file.txt', 'r')
   *
   * // Create or truncate for writing
   * const handle = await backend.open('/file.txt', 'w', 0o644)
   *
   * // Exclusive create (fails if exists)
   * const handle = await backend.open('/file.txt', 'wx')
   *
   * // Append mode
   * const handle = await backend.open('/log.txt', 'a')
   * ```
   */
  async open(
    path: string,
    flags?: string,
    mode?: number
  ): Promise<FileHandle> {
    const normalized = this.normalizePath(path)

    // Parse flags into structured format
    const parsedFlags = parseFlags(flags)

    // Resolve symlinks - follow the chain to get the actual target
    let targetPath = normalized
    const seen = new Set<string>()
    while (this.symlinks.has(targetPath)) {
      if (seen.has(targetPath)) {
        throw new Error(`ELOOP: too many levels of symbolic links: ${path}`)
      }
      seen.add(targetPath)
      const target = this.symlinks.get(targetPath)!
      targetPath = target.startsWith('/')
        ? this.normalizePath(target)
        : this.normalizePath(this.getParentDir(targetPath) + '/' + target)
    }

    // Check if path is a directory
    if (this.directories.has(targetPath)) {
      throw new Error(`EISDIR: illegal operation on a directory: ${path}`)
    }

    const fileExists = this.files.has(targetPath)

    // Handle exclusive creation - must fail if file exists
    if (parsedFlags.exclusive && fileExists) {
      throw new Error(`EEXIST: file already exists: ${path}`)
    }

    // Handle read modes that require file to exist
    if (!parsedFlags.create && !fileExists) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }

    // Create file if needed
    if (parsedFlags.create && !fileExists) {
      // Verify parent directory exists
      const parent = this.getParentDir(targetPath)
      if (parent !== '/' && !this.directories.has(parent)) {
        throw new Error(`ENOENT: no such file or directory: ${path}`)
      }
      await this.writeFile(targetPath, new Uint8Array(0), { mode: mode ?? 0o644 })
    }

    // Handle truncation
    if (parsedFlags.truncate && fileExists) {
      const file = this.files.get(targetPath)!
      file.data = new Uint8Array(0)
      file.stats.size = 0
      file.stats.mtimeMs = Date.now()
      file.stats.ctimeMs = Date.now()
    }

    const fd = this.nextFd++
    const file = this.files.get(targetPath)!

    return new MockFileHandle(fd, file, this, targetPath, parsedFlags)
  }

  // ===========================================================================
  // Optional Tiering Operations
  // ===========================================================================

  async getTier(_path: string): Promise<StorageTier> {
    return 'hot'
  }

  async promote(_path: string, _tier: 'hot' | 'warm'): Promise<void> {
    // No-op for memory backend - everything is already "hot"
  }

  async demote(_path: string, _tier: 'warm' | 'cold'): Promise<void> {
    // No-op for memory backend
  }
}

// =============================================================================
// MockFileHandle Implementation
// =============================================================================

/**
 * File handle implementation for MockBackend.
 *
 * Provides POSIX-compatible file handle operations with proper access mode
 * enforcement. The handle respects the flags used when opening the file:
 *
 * - Read-only ('r', O_RDONLY): read() allowed, write() throws EBADF
 * - Write-only ('w', 'a', O_WRONLY): write() allowed, read() throws EBADF
 * - Read/write ('r+', 'w+', 'a+', O_RDWR): both read() and write() allowed
 *
 * Append mode ('a', 'a+', O_APPEND) always writes to end of file,
 * ignoring any position parameter.
 */
class MockFileHandle implements FileHandle {
  readonly fd: number
  private file: { data: Uint8Array; stats: StatsInit }
  private backend: MockBackend
  private path: string
  private closed = false
  private position = 0
  private readonly flags: ParsedFlags

  constructor(
    fd: number,
    file: { data: Uint8Array; stats: StatsInit },
    backend: MockBackend,
    path: string,
    flags: ParsedFlags
  ) {
    this.fd = fd
    this.file = file
    this.backend = backend
    this.path = path
    this.flags = flags
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('File handle is closed')
    }
  }

  /**
   * Check if the handle permits read operations.
   * Returns true for 'read' and 'readwrite' access modes.
   */
  private canRead(): boolean {
    return this.flags.accessMode === 'read' || this.flags.accessMode === 'readwrite'
  }

  /**
   * Check if the handle permits write operations.
   * Returns true for 'write' and 'readwrite' access modes.
   */
  private canWrite(): boolean {
    return this.flags.accessMode === 'write' || this.flags.accessMode === 'readwrite'
  }

  async read(
    buffer: Uint8Array,
    offset = 0,
    length?: number,
    position?: number
  ): Promise<{ bytesRead: number; buffer: Uint8Array }> {
    this.ensureOpen()

    // Enforce access mode - read not allowed on write-only handles
    if (!this.canRead()) {
      throw new Error(`EBADF: bad file descriptor, read not permitted on write-only handle`)
    }

    const pos = position ?? this.position
    const len =
      length ?? Math.min(buffer.length - offset, this.file.data.length - pos)
    const bytesToRead = Math.min(
      len,
      this.file.data.length - pos,
      buffer.length - offset
    )

    for (let i = 0; i < bytesToRead; i++) {
      buffer[offset + i] = this.file.data[pos + i]!
    }

    if (position === undefined) {
      this.position += bytesToRead
    }

    return { bytesRead: bytesToRead, buffer }
  }

  async write(
    data: Uint8Array | string,
    position?: number
  ): Promise<{ bytesWritten: number }> {
    this.ensureOpen()

    // Enforce access mode - write not allowed on read-only handles
    if (!this.canWrite()) {
      throw new Error(`EBADF: bad file descriptor, write not permitted on read-only handle`)
    }

    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : data

    // In append mode, always write to end of file regardless of position
    // This is POSIX-mandated behavior for O_APPEND
    const pos = this.flags.append ? this.file.data.length : (position ?? this.position)

    if (pos + bytes.length > this.file.data.length) {
      const newData = new Uint8Array(pos + bytes.length)
      newData.set(this.file.data)
      this.file.data = newData
    }

    for (let i = 0; i < bytes.length; i++) {
      this.file.data[pos + i] = bytes[i]!
    }

    this.file.stats.size = this.file.data.length
    this.file.stats.mtimeMs = Date.now()

    // Update position for non-append mode when position wasn't explicitly provided
    if (!this.flags.append && position === undefined) {
      this.position += bytes.length
    }

    return { bytesWritten: bytes.length }
  }

  async readFile(): Promise<Uint8Array> {
    this.ensureOpen()
    return new Uint8Array(this.file.data)
  }

  async writeFile(data: Uint8Array | string): Promise<void> {
    this.ensureOpen()
    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : data
    this.file.data = new Uint8Array(bytes)
    this.file.stats.size = bytes.length
    this.file.stats.mtimeMs = Date.now()
  }

  async stat(): Promise<Stats> {
    this.ensureOpen()
    return this.backend.stat(this.path)
  }

  async chmod(mode: number): Promise<void> {
    this.ensureOpen()
    return this.backend.chmod(this.path, mode)
  }

  async chown(uid: number, gid: number): Promise<void> {
    this.ensureOpen()
    return this.backend.chown(this.path, uid, gid)
  }

  async close(): Promise<void> {
    this.closed = true
  }

  async sync(): Promise<void> {
    this.ensureOpen()
    // No-op in memory backend
  }

  async datasync(): Promise<void> {
    this.ensureOpen()
    // No-op in memory backend
  }

  /**
   * Truncate the file to a specified length.
   *
   * If length < current size, the file is shrunk (data beyond length is lost).
   * If length > current size, the file is extended with null bytes (zero-filled).
   * If length = current size, only timestamps are updated (no data modification).
   *
   * @param length - New file length in bytes (default: 0)
   * @throws EBADF if file handle is closed
   * @throws EBADF if file handle is read-only
   * @throws EINVAL if length is negative
   */
  async truncate(length: number = 0): Promise<void> {
    this.ensureOpen()

    // Enforce access mode - truncate requires write permission
    if (!this.canWrite()) {
      throw new Error('EBADF: bad file descriptor, truncate not permitted on read-only handle')
    }

    // POSIX behavior: floor non-integer values
    const targetLength = Math.floor(length)

    if (targetLength < 0) {
      throw new Error('EINVAL: invalid argument, length cannot be negative')
    }

    const currentSize = this.file.data.length

    // Resize file data if needed
    if (targetLength !== currentSize) {
      // Create new buffer at target size
      // - For shrink: slice preserves content up to targetLength
      // - For extend: Uint8Array constructor zero-fills beyond currentSize
      const newData = new Uint8Array(targetLength)
      newData.set(this.file.data.subarray(0, Math.min(targetLength, currentSize)))
      this.file.data = newData
    }

    // Update stats (POSIX: truncate always updates mtime/ctime)
    const now = Date.now()
    this.file.stats.size = targetLength
    this.file.stats.mtimeMs = now
    this.file.stats.ctimeMs = now

    // Clamp position to EOF if it exceeds new length
    this.position = Math.min(this.position, targetLength)
  }
}
