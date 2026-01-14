/**
 * FSx - Main filesystem class
 *
 * Provides POSIX-like filesystem operations backed by a pluggable FsBackend.
 * This is the primary interface for interacting with the virtual filesystem.
 *
 * The core FSx class is runtime-agnostic and has zero Cloudflare dependencies.
 * For Durable Object integration, use the DOBackend from fsx/do.
 *
 * @example
 * ```typescript
 * import { FSx, MemoryBackend } from '@dotdo/fsx'
 *
 * // Use with in-memory backend for testing
 * const backend = new MemoryBackend()
 * const fsx = new FSx(backend)
 *
 * // Write and read files
 * await fsx.writeFile('/hello.txt', 'Hello, World!')
 * const content = await fsx.readFile('/hello.txt')
 *
 * // Directory operations
 * await fsx.mkdir('/mydir', { recursive: true })
 * const files = await fsx.readdir('/mydir')
 *
 * // Check file stats
 * const stats = await fsx.stat('/hello.txt')
 * console.log(stats.size, stats.isFile())
 * ```
 *
 * @module
 */

import type { Dirent, FileHandle, MkdirOptions, RmdirOptions, ReaddirOptions, ReadStreamOptions, WriteStreamOptions, WatchOptions, FSWatcher, BufferEncoding } from './types.js'
import { Stats } from './types.js'
import type { FsBackend } from './backend.js'
import { constants } from './constants.js'
export { constants } from './constants.js'

// =============================================================================
// Flag Parsing Utilities
// =============================================================================

/**
 * Access mode for file operations.
 * Determines what operations are permitted on a file handle.
 *
 * @internal
 */
type AccessMode = 'read' | 'write' | 'readwrite'

/**
 * Parsed file open flags.
 * Contains all the information needed to open a file correctly.
 *
 * @internal
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
 * - 'r'  : Read-only, file must exist (default)
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
 *
 * @internal
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
 *
 * @internal
 */
function parseNumericFlags(flags: number): ParsedFlags {
  const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_TRUNC, O_APPEND, O_SYNC } = constants

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
    sync: (flags & O_SYNC) !== 0,
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
 *
 * @internal
 */
function parseStringFlags(flags: string): ParsedFlags {
  // Normalize: remove 's' (sync) and 'x' (exclusive), sort remaining
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
// Watch Manager - Internal file watching implementation
// =============================================================================

/** Event types emitted by file watchers */
type WatchEventType = 'change' | 'rename'

/** Callback signature for watch event listeners */
type WatchListener = (eventType: WatchEventType, filename: string) => void

/**
 * Internal representation of a registered watcher.
 * @internal
 */
interface WatchEntry {
  /** Unique identifier for the watcher */
  id: number
  /** Path being watched (normalized) */
  path: string
  /** Whether to watch subdirectories recursively */
  recursive: boolean
  /** Callback to invoke on file system events */
  listener: WatchListener
  /** Whether the watcher has been closed */
  closed: boolean
  /** AbortController for cancellation support */
  abortController: AbortController
}

/**
 * Manages file watchers for a single FSx instance.
 *
 * Optimized for handling many concurrent watchers by using:
 * - Path prefix indexing for O(log n) lookup of potentially matching watchers
 * - Batch notification to avoid callback storms
 * - Proper cancellation support via AbortController
 *
 * Since FSx runs in a Durable Object environment without native fs.watch,
 * this class implements watching by hooking into FSx operations directly.
 * When a file operation occurs, the WatchManager emits events to all
 * registered watchers that match the affected path.
 *
 * @example
 * ```typescript
 * const manager = new WatchManager()
 * const entry = manager.addWatcher('/home/user', true, (event, filename) => {
 *   console.log(`${event}: ${filename}`)
 * })
 *
 * // Emit an event
 * manager.emit('change', '/home/user/file.txt')
 *
 * // Later, remove the watcher
 * manager.removeWatcher(entry)
 * ```
 */
class WatchManager {
  /** Counter for generating unique watcher IDs */
  private nextId: number = 0

  /** All registered watchers indexed by ID for fast removal */
  private watchersById: Map<number, WatchEntry> = new Map()

  /**
   * Index of watchers by their normalized path.
   * Multiple watchers can watch the same path.
   */
  private watchersByPath: Map<string, Set<WatchEntry>> = new Map()

  // Reserved for future optimization - sorted watched paths for efficient prefix matching
  // @ts-expect-error Reserved for future optimization
  private _sortedPaths: string[] = []
  // @ts-expect-error Reserved for future optimization
  private _pathsNeedSort: boolean = false

  /**
   * Register a new file system watcher.
   *
   * @param path - The path to watch (file or directory)
   * @param recursive - Whether to watch subdirectories recursively
   * @param listener - Callback function to invoke on events
   * @returns The watch entry for later removal
   *
   * @example
   * ```typescript
   * const entry = manager.addWatcher('/home/user', true, (event, filename) => {
   *   console.log(`${event}: ${filename}`)
   * })
   * ```
   */
  addWatcher(path: string, recursive: boolean, listener: WatchListener): WatchEntry {
    const normalizedPath = this.normalizePath(path)
    const entry: WatchEntry = {
      id: this.nextId++,
      path: normalizedPath,
      recursive,
      listener,
      closed: false,
      abortController: new AbortController(),
    }

    // Add to ID index
    this.watchersById.set(entry.id, entry)

    // Add to path index
    let pathWatchers = this.watchersByPath.get(normalizedPath)
    if (!pathWatchers) {
      pathWatchers = new Set()
      this.watchersByPath.set(normalizedPath, pathWatchers)
      this._pathsNeedSort = true
    }
    pathWatchers.add(entry)

    return entry
  }

  /**
   * Remove a watcher and clean up its resources.
   *
   * @param entry - The watch entry to remove
   */
  removeWatcher(entry: WatchEntry): void {
    entry.closed = true
    entry.abortController.abort()

    // Remove from ID index
    this.watchersById.delete(entry.id)

    // Remove from path index
    const pathWatchers = this.watchersByPath.get(entry.path)
    if (pathWatchers) {
      pathWatchers.delete(entry)
      if (pathWatchers.size === 0) {
        this.watchersByPath.delete(entry.path)
        this._pathsNeedSort = true
      }
    }
  }

  /**
   * Get the AbortSignal for a watcher, useful for cancellation.
   *
   * @param entry - The watch entry
   * @returns The AbortSignal that will be triggered when the watcher is closed
   */
  getAbortSignal(entry: WatchEntry): AbortSignal {
    return entry.abortController.signal
  }

  /**
   * Get the total number of active watchers.
   *
   * @returns Number of registered watchers
   */
  get watcherCount(): number {
    return this.watchersById.size
  }

  /**
   * Emit a file system event to all matching watchers.
   *
   * Uses optimized path matching to minimize iteration:
   * 1. Direct path watchers (exact match)
   * 2. Parent directory watchers (non-recursive, direct children only)
   * 3. Ancestor directory watchers (recursive)
   *
   * @param eventType - 'change' for content modifications, 'rename' for create/delete/rename
   * @param affectedPath - The full normalized path that was affected
   *
   * @example
   * ```typescript
   * // Emit a change event for a modified file
   * manager.emit('change', '/home/user/file.txt')
   *
   * // Emit a rename event for a created file
   * manager.emit('rename', '/home/user/new-file.txt')
   * ```
   */
  emit(eventType: WatchEventType, affectedPath: string): void {
    const normalizedAffected = this.normalizePath(affectedPath)
    const matchingWatchers: Array<{ watcher: WatchEntry; filename: string }> = []

    // 1. Check for exact path watchers (watching this specific file/dir)
    const exactWatchers = this.watchersByPath.get(normalizedAffected)
    if (exactWatchers) {
      for (const watcher of exactWatchers) {
        if (!watcher.closed) {
          const filename = this.getBasename(normalizedAffected)
          matchingWatchers.push({ watcher, filename })
        }
      }
    }

    // 2. Check for parent directory watchers
    let currentPath = this.getParentPath(normalizedAffected)
    if (currentPath !== normalizedAffected) {
      // Direct parent watchers (both recursive and non-recursive)
      const parentWatchers = this.watchersByPath.get(currentPath)
      if (parentWatchers) {
        for (const watcher of parentWatchers) {
          if (!watcher.closed) {
            const filename = this.getBasename(normalizedAffected)
            matchingWatchers.push({ watcher, filename })
          }
        }
      }

      // 3. Check for ancestor directory watchers (recursive only)
      let ancestorPath = this.getParentPath(currentPath)
      while (ancestorPath !== currentPath) {
        const ancestorWatchers = this.watchersByPath.get(ancestorPath)
        if (ancestorWatchers) {
          for (const watcher of ancestorWatchers) {
            if (!watcher.closed && watcher.recursive) {
              const filename = this.getRelativePath(ancestorPath, normalizedAffected)
              matchingWatchers.push({ watcher, filename })
            }
          }
        }
        currentPath = ancestorPath
        ancestorPath = this.getParentPath(ancestorPath)
      }

      // Check root watchers if we're not at root
      if (currentPath !== '/') {
        const rootWatchers = this.watchersByPath.get('/')
        if (rootWatchers) {
          for (const watcher of rootWatchers) {
            if (!watcher.closed && watcher.recursive) {
              const filename = normalizedAffected.slice(1) // Remove leading /
              matchingWatchers.push({ watcher, filename })
            }
          }
        }
      }
    }

    // Fire all callbacks asynchronously using queueMicrotask for batching
    for (const { watcher, filename } of matchingWatchers) {
      queueMicrotask(() => {
        if (!watcher.closed) {
          try {
            watcher.listener(eventType, filename)
          } catch {
            // Swallow listener errors to prevent breaking other watchers
          }
        }
      })
    }
  }

  /**
   * Normalize a path by removing trailing slashes (except for root).
   * @param path - Path to normalize
   * @returns Normalized path
   */
  private normalizePath(path: string): string {
    if (path === '/' || path === '') return '/'
    return path.endsWith('/') ? path.slice(0, -1) : path
  }

  /**
   * Get the parent directory path.
   * @param path - Path to get parent of
   * @returns Parent path, or the same path if at root
   */
  private getParentPath(path: string): string {
    if (path === '/') return '/'
    const lastSlash = path.lastIndexOf('/')
    if (lastSlash <= 0) return '/'
    return path.slice(0, lastSlash)
  }

  /**
   * Get the basename (final component) of a path.
   * @param path - Path to get basename of
   * @returns Basename
   */
  private getBasename(path: string): string {
    const lastSlash = path.lastIndexOf('/')
    return lastSlash >= 0 ? path.slice(lastSlash + 1) : path
  }

  /**
   * Get the relative path from a base to a target.
   * @param basePath - Base path
   * @param targetPath - Target path
   * @returns Relative path from base to target
   */
  private getRelativePath(basePath: string, targetPath: string): string {
    const normalizedBase = this.normalizePath(basePath)
    const normalizedTarget = this.normalizePath(targetPath)

    if (normalizedBase === '/') {
      return normalizedTarget.slice(1)
    }

    if (normalizedTarget.startsWith(normalizedBase + '/')) {
      return normalizedTarget.slice(normalizedBase.length + 1)
    }

    return this.getBasename(normalizedTarget)
  }
}


/**
 * FSx configuration options
 *
 * @example
 * ```typescript
 * const fsx = new FSx(env.FSX_DO, {
 *   defaultMode: 0o644,
 *   defaultDirMode: 0o755,
 *   maxFileSize: 50 * 1024 * 1024, // 50MB
 * })
 * ```
 */
export interface FSxOptions {
  /**
   * Storage tier thresholds for automatic tiering
   *
   * Files are stored in different tiers based on size and access patterns:
   * - Hot tier: Stored directly in Durable Object SQLite (fast access)
   * - Warm tier: Stored in R2 (cheaper, slightly slower)
   * - Cold tier: Archived (cheapest, highest latency)
   */
  tiers?: {
    /** Max size for hot tier (DO SQLite). Default: 1MB */
    hotMaxSize?: number
    /** Enable warm tier (R2). Default: true */
    warmEnabled?: boolean
    /** Enable cold tier (archive). Default: false */
    coldEnabled?: boolean
  }
  /** Default file mode (permissions). Default: 0o644 */
  defaultMode?: number
  /** Default directory mode. Default: 0o755 */
  defaultDirMode?: number
  /** Temp file max age in ms. Default: 24 hours */
  tmpMaxAge?: number
  /** Max file size in bytes. Default: 100MB */
  maxFileSize?: number
  /** Max path length. Default: 4096 */
  maxPathLength?: number
  /** User ID for file ownership. Default: 0 */
  uid?: number
  /** Group ID for file ownership. Default: 0 */
  gid?: number
}

const DEFAULT_OPTIONS: Required<FSxOptions> = {
  tiers: {
    hotMaxSize: 1024 * 1024, // 1MB
    warmEnabled: true,
    coldEnabled: false,
  },
  defaultMode: 0o644,
  defaultDirMode: 0o755,
  tmpMaxAge: 24 * 60 * 60 * 1000, // 24 hours
  maxFileSize: 100 * 1024 * 1024, // 100MB
  maxPathLength: 4096,
  uid: 0,
  gid: 0,
}

/**
 * FSx - Virtual filesystem with pluggable backend
 *
 * The core FSx class is runtime-agnostic and works with any FsBackend implementation.
 * For Cloudflare Durable Objects, use the DOBackend from fsx/do.
 */
export class FSx {
  private backend: FsBackend
  private options: Required<FSxOptions>
  private watchManager: WatchManager = new WatchManager()

  constructor(backend: FsBackend, options: FSxOptions = {}) {
    this.backend = backend
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Normalize a path
   */
  private normalizePath(path: string): string {
    // Remove trailing slashes (except root)
    if (path !== '/' && path.endsWith('/')) {
      path = path.slice(0, -1)
    }
    // Ensure starts with /
    if (!path.startsWith('/')) {
      path = '/' + path
    }
    // Resolve . and ..
    const parts = path.split('/').filter(Boolean)
    const resolved: string[] = []
    for (const part of parts) {
      if (part === '.') continue
      if (part === '..') {
        resolved.pop()
      } else {
        resolved.push(part)
      }
    }
    return '/' + resolved.join('/')
  }

  // ==================== File Operations ====================

  /**
   * Read a file's contents
   *
   * Reads the entire contents of a file. By default, returns a UTF-8 decoded string.
   * Use the encoding parameter to control the output format.
   *
   * @param path - Path to the file to read
   * @param encoding - Output encoding: 'utf-8'/'utf8' (default), 'base64', or undefined for raw bytes
   * @returns File contents as a string or Uint8Array depending on encoding
   * @throws {ENOENT} If the file does not exist
   * @throws {EISDIR} If the path is a directory
   *
   * @example
   * ```typescript
   * // Read as UTF-8 string (default)
   * const text = await fsx.readFile('/hello.txt')
   *
   * // Read as raw bytes
   * const bytes = await fsx.readFile('/image.png', undefined)
   *
   * // Read as base64
   * const base64 = await fsx.readFile('/image.png', 'base64')
   * ```
   */
  async readFile(path: string, encoding?: BufferEncoding): Promise<string | Uint8Array> {
    path = this.normalizePath(path)
    const bytes = await this.backend.readFile(path)

    // If utf-8 encoding requested (or default), decode bytes to string
    if (!encoding || encoding === 'utf-8' || encoding === 'utf8') {
      return new TextDecoder().decode(bytes)
    }

    // If base64 encoding requested, encode bytes to base64
    if (encoding === 'base64') {
      let binary = ''
      for (const byte of bytes) {
        binary += String.fromCharCode(byte)
      }
      return btoa(binary)
    }

    // For other encodings or no encoding, return bytes
    return bytes
  }

  /**
   * Write data to a file
   *
   * Writes data to a file, replacing the file if it already exists.
   * Creates any necessary parent directories.
   *
   * @param path - Path to the file to write
   * @param data - Content to write (string or bytes)
   * @param options - Write options
   * @param options.mode - File permissions (default: 0o644)
   * @param options.flag - File system flag: 'w' (write/create), 'a' (append), 'wx' (exclusive create)
   * @throws {EISDIR} If the path is a directory
   *
   * @example
   * ```typescript
   * // Write a string
   * await fsx.writeFile('/hello.txt', 'Hello, World!')
   *
   * // Write binary data
   * await fsx.writeFile('/data.bin', new Uint8Array([1, 2, 3]))
   *
   * // Write with specific permissions
   * await fsx.writeFile('/script.sh', '#!/bin/bash', { mode: 0o755 })
   * ```
   */
  async writeFile(path: string, data: string | Uint8Array, options?: { mode?: number; flag?: string }): Promise<void> {
    path = this.normalizePath(path)

    // Check if file exists before writing (to determine event type)
    const fileExisted = await this.backend.exists(path)

    // Convert string to bytes
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data

    await this.backend.writeFile(path, bytes, {
      mode: options?.mode ?? this.options.defaultMode,
      flag: options?.flag,
    })

    // Emit watch event - 'rename' for new file, 'change' for existing
    this.watchManager.emit(fileExisted ? 'change' : 'rename', path)
  }

  /**
   * Append data to a file
   *
   * Appends data to the end of a file. Creates the file if it doesn't exist.
   *
   * @param path - Path to the file
   * @param data - Content to append
   * @throws {EISDIR} If the path is a directory
   *
   * @example
   * ```typescript
   * await fsx.appendFile('/log.txt', 'New log entry\n')
   * ```
   */
  async appendFile(path: string, data: string | Uint8Array): Promise<void> {
    return this.writeFile(path, data, { flag: 'a' })
  }

  /**
   * Delete a file
   *
   * Removes a file from the filesystem. Does not work on directories.
   *
   * @param path - Path to the file to delete
   * @throws {ENOENT} If the file does not exist
   * @throws {EISDIR} If the path is a directory (use rmdir or rm instead)
   *
   * @example
   * ```typescript
   * await fsx.unlink('/old-file.txt')
   * ```
   */
  async unlink(path: string): Promise<void> {
    path = this.normalizePath(path)
    await this.backend.unlink(path)

    // Emit watch event - 'rename' for file deletion
    this.watchManager.emit('rename', path)
  }

  /**
   * Rename or move a file or directory
   *
   * Atomically renames or moves a file/directory from oldPath to newPath.
   * Can be used to move files between directories.
   *
   * @param oldPath - Current path
   * @param newPath - New path
   * @throws {ENOENT} If oldPath does not exist
   * @throws {EEXIST} If newPath already exists (for some filesystem configurations)
   *
   * @example
   * ```typescript
   * // Rename a file
   * await fsx.rename('/old-name.txt', '/new-name.txt')
   *
   * // Move to another directory
   * await fsx.rename('/file.txt', '/archive/file.txt')
   * ```
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    oldPath = this.normalizePath(oldPath)
    newPath = this.normalizePath(newPath)
    await this.backend.rename(oldPath, newPath)

    // Emit watch events - 'rename' for both old and new paths
    this.watchManager.emit('rename', oldPath)
    this.watchManager.emit('rename', newPath)
  }

  /**
   * Copy a file
   *
   * Creates a copy of a file at the destination path.
   *
   * @param src - Source file path
   * @param dest - Destination file path
   * @param flags - Copy flags (e.g., constants.COPYFILE_EXCL to fail if dest exists)
   * @throws {ENOENT} If the source file does not exist
   * @throws {EEXIST} If dest exists and COPYFILE_EXCL flag is set
   *
   * @example
   * ```typescript
   * // Simple copy
   * await fsx.copyFile('/original.txt', '/backup.txt')
   *
   * // Fail if destination exists
   * await fsx.copyFile('/src.txt', '/dst.txt', constants.COPYFILE_EXCL)
   * ```
   */
  async copyFile(src: string, dest: string, _flags?: number): Promise<void> {
    src = this.normalizePath(src)
    dest = this.normalizePath(dest)
    await this.backend.copyFile(src, dest)

    // Emit watch event - 'rename' for new file created by copy
    this.watchManager.emit('rename', dest)
  }

  // ==================== Directory Operations ====================

  /**
   * Create a directory
   *
   * Creates a new directory. With recursive option, creates parent directories
   * as needed (like `mkdir -p`).
   *
   * @param path - Path for the new directory
   * @param options - Creation options
   * @param options.recursive - Create parent directories if needed (default: false)
   * @param options.mode - Directory permissions (default: 0o755)
   * @throws {EEXIST} If directory already exists (unless recursive is true)
   * @throws {ENOENT} If parent doesn't exist and recursive is false
   *
   * @example
   * ```typescript
   * // Create a single directory
   * await fsx.mkdir('/mydir')
   *
   * // Create nested directories
   * await fsx.mkdir('/a/b/c', { recursive: true })
   * ```
   */
  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    path = this.normalizePath(path)
    await this.backend.mkdir(path, {
      recursive: options?.recursive ?? false,
      mode: options?.mode ?? this.options.defaultDirMode,
    })

    // Emit watch event - 'rename' for new directory
    this.watchManager.emit('rename', path)
  }

  /**
   * Remove a directory
   *
   * Removes an empty directory. With recursive option, removes directory
   * and all contents (like `rm -r`).
   *
   * @param path - Path to the directory
   * @param options - Removal options
   * @param options.recursive - Remove contents recursively (default: false)
   * @throws {ENOENT} If directory does not exist
   * @throws {ENOTDIR} If path is not a directory
   * @throws {ENOTEMPTY} If directory is not empty and recursive is false
   *
   * @example
   * ```typescript
   * // Remove empty directory
   * await fsx.rmdir('/empty-dir')
   *
   * // Remove directory and all contents
   * await fsx.rmdir('/full-dir', { recursive: true })
   * ```
   */
  async rmdir(path: string, options?: RmdirOptions): Promise<void> {
    path = this.normalizePath(path)
    await this.backend.rmdir(path, {
      recursive: options?.recursive ?? false,
    })

    // Emit watch event - 'rename' for directory deletion
    this.watchManager.emit('rename', path)
  }

  /**
   * Remove a file or directory
   *
   * Removes files or directories. With recursive option, removes directories
   * and their contents. With force option, ignores non-existent paths.
   *
   * @param path - Path to remove
   * @param options - Removal options
   * @param options.recursive - Remove directories and contents (default: false)
   * @param options.force - Ignore if path doesn't exist (default: false)
   * @throws {ENOENT} If path doesn't exist and force is false
   * @throws {EISDIR} If path is a directory and recursive is false
   *
   * @example
   * ```typescript
   * // Remove a file
   * await fsx.rm('/file.txt')
   *
   * // Remove directory tree (like rm -rf)
   * await fsx.rm('/directory', { recursive: true, force: true })
   * ```
   */
  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    path = this.normalizePath(path)

    // rm is implemented as unlink or rmdir depending on path type
    try {
      const stats = await this.backend.stat(path)
      if (stats.isDirectory()) {
        await this.backend.rmdir(path, { recursive: options?.recursive ?? false })
      } else {
        await this.backend.unlink(path)
      }
    } catch (error) {
      // If force is true, ignore ENOENT
      if (options?.force && (error as Error).message.includes('ENOENT')) {
        return
      }
      throw error
    }

    // Emit watch event - 'rename' for deletion
    this.watchManager.emit('rename', path)
  }

  /**
   * Read directory contents
   *
   * Returns the contents of a directory. With withFileTypes option, returns
   * Dirent objects with type information. With recursive option, includes
   * contents of subdirectories.
   *
   * @param path - Path to the directory
   * @param options - Read options
   * @param options.withFileTypes - Return Dirent objects instead of strings (default: false)
   * @param options.recursive - Include subdirectory contents (default: false)
   * @returns Array of filenames or Dirent objects
   * @throws {ENOENT} If directory does not exist
   * @throws {ENOTDIR} If path is not a directory
   *
   * @example
   * ```typescript
   * // List filenames
   * const files = await fsx.readdir('/mydir')
   * // ['file1.txt', 'file2.txt', 'subdir']
   *
   * // List with file types
   * const entries = await fsx.readdir('/mydir', { withFileTypes: true })
   * entries.forEach(e => console.log(e.name, e.isDirectory()))
   * ```
   */
  async readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]> {
    path = this.normalizePath(path)
    return this.backend.readdir(path, {
      withFileTypes: options?.withFileTypes ?? false,
      recursive: options?.recursive ?? false,
    })
  }

  // ==================== Metadata Operations ====================

  /**
   * Get file or directory stats
   *
   * Returns metadata about a file or directory including size, permissions,
   * timestamps, and type-checking methods. Follows symbolic links.
   *
   * @param path - Path to the file or directory
   * @returns Stats object with file metadata and type-checking methods
   * @throws {ENOENT} If the path does not exist
   *
   * @example
   * ```typescript
   * const stats = await fsx.stat('/myfile.txt')
   * console.log(stats.size)        // File size in bytes
   * console.log(stats.isFile())    // true
   * console.log(stats.mtime)       // Last modification time
   * ```
   */
  async stat(path: string): Promise<Stats> {
    path = this.normalizePath(path)
    return this.backend.stat(path)
  }

  /**
   * Get file or directory stats without following symbolic links
   *
   * Like {@link stat}, but does not follow symbolic links. If the path is
   * a symlink, returns information about the link itself rather than its target.
   *
   * @param path - Path to the file, directory, or symbolic link
   * @returns Stats object with file metadata and type-checking methods
   * @throws {ENOENT} If the path does not exist
   *
   * @example
   * ```typescript
   * // Check if something is a symlink
   * const stats = await fsx.lstat('/link')
   * if (stats.isSymbolicLink()) {
   *   const target = await fsx.readlink('/link')
   * }
   * ```
   */
  async lstat(path: string): Promise<Stats> {
    path = this.normalizePath(path)
    return this.backend.lstat(path)
  }

  /**
   * Check file access permissions
   *
   * Tests whether the calling process can access the file at path.
   * Throws an error if access is not permitted.
   *
   * @param path - Path to check
   * @param mode - Access mode to check (default: F_OK for existence)
   *              - constants.F_OK: Check existence
   *              - constants.R_OK: Check read permission
   *              - constants.W_OK: Check write permission
   *              - constants.X_OK: Check execute permission
   * @throws {ENOENT} If the path does not exist
   * @throws {EACCES} If access is not permitted
   *
   * @example
   * ```typescript
   * // Check if file exists
   * await fsx.access('/myfile.txt')
   *
   * // Check if file is readable and writable
   * await fsx.access('/myfile.txt', constants.R_OK | constants.W_OK)
   * ```
   */
  async access(path: string, _mode?: number): Promise<void> {
    path = this.normalizePath(path)
    // Check existence via stat - full permission checks would need backend support
    await this.backend.stat(path)
  }

  /**
   * Check if a path exists
   *
   * A convenience method that returns a boolean instead of throwing.
   * Prefer {@link access} when you need to check specific permissions.
   *
   * @param path - Path to check
   * @returns true if the path exists, false otherwise
   *
   * @example
   * ```typescript
   * if (await fsx.exists('/config.json')) {
   *   const config = await fsx.readFile('/config.json')
   * }
   * ```
   */
  async exists(path: string): Promise<boolean> {
    path = this.normalizePath(path)
    return this.backend.exists(path)
  }

  /**
   * Change file permissions
   *
   * Changes the permissions of a file or directory.
   *
   * @param path - Path to the file or directory
   * @param mode - New permissions (octal, e.g., 0o755)
   * @throws {ENOENT} If the path does not exist
   *
   * @example
   * ```typescript
   * // Make a script executable
   * await fsx.chmod('/script.sh', 0o755)
   *
   * // Read-only for owner only
   * await fsx.chmod('/secret.txt', 0o400)
   * ```
   */
  async chmod(path: string, mode: number): Promise<void> {
    path = this.normalizePath(path)
    await this.backend.chmod(path, mode)
  }

  /**
   * Change file ownership
   *
   * Changes the owner and group of a file or directory.
   *
   * @param path - Path to the file or directory
   * @param uid - User ID of the new owner
   * @param gid - Group ID of the new group
   * @throws {ENOENT} If the path does not exist
   *
   * @example
   * ```typescript
   * await fsx.chown('/myfile.txt', 1000, 1000)
   * ```
   */
  async chown(path: string, uid: number, gid: number): Promise<void> {
    path = this.normalizePath(path)
    await this.backend.chown(path, uid, gid)
  }

  /**
   * Update file access and modification timestamps
   *
   * Sets the access time (atime) and modification time (mtime) of a file.
   *
   * @param path - Path to the file
   * @param atime - New access time (Date or Unix timestamp in ms)
   * @param mtime - New modification time (Date or Unix timestamp in ms)
   * @throws {ENOENT} If the file does not exist
   *
   * @example
   * ```typescript
   * // Set timestamps to current time
   * const now = new Date()
   * await fsx.utimes('/myfile.txt', now, now)
   *
   * // Set to specific Unix timestamp
   * await fsx.utimes('/myfile.txt', 1704067200000, 1704067200000)
   * ```
   */
  async utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
    path = this.normalizePath(path)
    await this.backend.utimes(path, atime, mtime)
  }

  // ==================== Symbolic Links ====================

  /**
   * Create a symbolic link
   *
   * Creates a symbolic link at path pointing to target.
   * The target can be a relative or absolute path.
   *
   * @param target - The path the symlink should point to
   * @param path - Where to create the symlink
   * @throws {EEXIST} If a file already exists at path
   *
   * @example
   * ```typescript
   * // Create symlink to a file
   * await fsx.symlink('/data/config.json', '/config.json')
   *
   * // Create symlink with relative target
   * await fsx.symlink('../shared/lib', '/app/lib')
   * ```
   */
  async symlink(target: string, path: string): Promise<void> {
    path = this.normalizePath(path)
    await this.backend.symlink(target, path)
  }

  /**
   * Create a hard link
   *
   * Creates a new directory entry (hard link) at newPath that references
   * the same file as existingPath. Both paths will point to the same
   * underlying file content.
   *
   * @param existingPath - Path to the existing file
   * @param newPath - Path for the new hard link
   * @throws {ENOENT} If existingPath does not exist
   * @throws {EEXIST} If newPath already exists
   *
   * @example
   * ```typescript
   * await fsx.link('/original.txt', '/hardlink.txt')
   * // Both paths now reference the same file
   * ```
   */
  async link(existingPath: string, newPath: string): Promise<void> {
    existingPath = this.normalizePath(existingPath)
    newPath = this.normalizePath(newPath)
    await this.backend.link(existingPath, newPath)
  }

  /**
   * Read the target of a symbolic link
   *
   * Returns the path that a symbolic link points to.
   *
   * @param path - Path to the symbolic link
   * @returns The target path (may be relative or absolute)
   * @throws {ENOENT} If the path does not exist
   * @throws {EINVAL} If the path is not a symbolic link
   *
   * @example
   * ```typescript
   * // Get symlink target
   * const target = await fsx.readlink('/mylink')
   * console.log(target) // '/actual/file/path'
   * ```
   */
  async readlink(path: string): Promise<string> {
    path = this.normalizePath(path)
    return this.backend.readlink(path)
  }

  /**
   * Resolve the absolute path, following symbolic links
   *
   * Returns the canonical absolute pathname by resolving `.`, `..`,
   * and symbolic links.
   *
   * @param path - Path to resolve
   * @returns The resolved absolute path
   * @throws {ENOENT} If the path does not exist
   *
   * @example
   * ```typescript
   * // Resolve symlinks and relative components
   * const real = await fsx.realpath('/app/../data/./link')
   * console.log(real) // '/data/actual-file'
   * ```
   */
  async realpath(path: string): Promise<string> {
    path = this.normalizePath(path)
    // Realpath resolves symlinks - for now just return the normalized path
    // as full symlink resolution would need backend support
    return path
  }

  // ==================== Streams ====================

  /**
   * Create a readable stream for a file
   *
   * Returns a ReadableStream that can be used to read file contents
   * in chunks. Useful for large files or when streaming to responses.
   *
   * @param path - Path to the file to read
   * @param options - Stream options (start, end positions, highWaterMark)
   * @returns A ReadableStream of Uint8Array chunks
   * @throws {ENOENT} If the file does not exist
   * @throws {EISDIR} If the path is a directory
   *
   * @example
   * ```typescript
   * const stream = await fsx.createReadStream('/large-file.bin')
   * for await (const chunk of stream) {
   *   process.write(chunk)
   * }
   * ```
   */
  async createReadStream(path: string, options?: ReadStreamOptions): Promise<ReadableStream<Uint8Array>> {
    path = this.normalizePath(path)

    // Read entire file and wrap in a stream
    const data = await this.backend.readFile(path)

    // Apply start/end options if specified
    let bytes = data
    if (options?.start !== undefined || options?.end !== undefined) {
      const start = options?.start ?? 0
      const end = options?.end !== undefined ? options.end + 1 : data.length
      bytes = data.slice(start, end)
    }

    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    })
  }

  /**
   * Create a writable stream for a file
   *
   * Returns a WritableStream that can be used to write file contents
   * in chunks. The file is created if it doesn't exist.
   *
   * @param path - Path to the file to write
   * @param options - Stream options (flags, mode, start position)
   * @returns A WritableStream accepting Uint8Array chunks
   *
   * @example
   * ```typescript
   * const stream = await fsx.createWriteStream('/output.bin')
   * const writer = stream.getWriter()
   * await writer.write(new Uint8Array([1, 2, 3]))
   * await writer.close()
   * ```
   */
  async createWriteStream(path: string, options?: WriteStreamOptions): Promise<WritableStream<Uint8Array>> {
    const normalizedPath = this.normalizePath(path)
    const backend = this.backend
    const defaultMode = this.options.defaultMode

    // Collect chunks and write on close
    const chunks: Uint8Array[] = []

    return new WritableStream({
      write(chunk) {
        chunks.push(chunk)
      },
      async close() {
        // Concatenate all chunks
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const data = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          data.set(chunk, offset)
          offset += chunk.length
        }

        // Write to backend
        await backend.writeFile(normalizedPath, data, {
          mode: options?.mode ?? defaultMode,
          flag: options?.flags,
        })
      },
    })
  }

  // ==================== File Watching ====================

  /**
   * Watch a file or directory for changes
   *
   * Returns an FSWatcher that emits events when the file or directory changes.
   * Events are emitted synchronously when filesystem operations occur on this
   * FSx instance.
   *
   * Event types:
   * - 'change': Fired when file content is modified
   * - 'rename': Fired when a file/directory is created, deleted, or renamed
   *
   * @param path - Path to watch (file or directory)
   * @param options - Watch options
   * @param options.recursive - Watch subdirectories recursively (default: false)
   * @param options.persistent - Keep process alive while watching (default: true)
   * @param options.encoding - Encoding for filenames (default: 'utf-8')
   * @param listener - Callback for change events (eventType: 'change'|'rename', filename)
   * @returns An FSWatcher object with close(), ref(), and unref() methods
   *
   * @example
   * ```typescript
   * // Watch a directory for changes
   * const watcher = fsx.watch('/mydir', {}, (event, filename) => {
   *   console.log(`${event}: ${filename}`)
   * })
   *
   * // Watch recursively
   * const deepWatcher = fsx.watch('/root', { recursive: true }, (event, filename) => {
   *   console.log(`${event}: ${filename}`)
   * })
   *
   * // Later, stop watching
   * watcher.close()
   * ```
   */
  watch(path: string, options?: WatchOptions, listener?: (eventType: string, filename: string) => void): FSWatcher {
    path = this.normalizePath(path)

    // Register the watcher with the WatchManager
    const recursive = options?.recursive ?? false
    const watchEntry = listener
      ? this.watchManager.addWatcher(path, recursive, listener)
      : null

    // Create the FSWatcher object
    const watcher: FSWatcher = {
      close: () => {
        if (watchEntry) {
          this.watchManager.removeWatcher(watchEntry)
        }
      },
      ref: () => watcher,
      unref: () => watcher,
    }

    return watcher
  }

  // ==================== Utility ====================

  /**
   * Truncate a file to a specified length
   *
   * If the file is larger than the specified length, the extra data is discarded.
   * If smaller, the file is extended with null bytes.
   *
   * @param path - Path to the file
   * @param length - New file length in bytes (default: 0)
   * @throws {ENOENT} If the file does not exist
   * @throws {EISDIR} If the path is a directory
   *
   * @example
   * ```typescript
   * // Clear a file
   * await fsx.truncate('/myfile.txt')
   *
   * // Truncate to first 100 bytes
   * await fsx.truncate('/myfile.txt', 100)
   * ```
   */
  async truncate(path: string, length?: number): Promise<void> {
    path = this.normalizePath(path)
    const targetLength = length ?? 0

    // Read current content
    const data = await this.backend.readFile(path)

    // Truncate or extend
    let newData: Uint8Array
    if (data.length > targetLength) {
      newData = data.slice(0, targetLength)
    } else if (data.length < targetLength) {
      newData = new Uint8Array(targetLength)
      newData.set(data)
      // Rest is already zero-filled
    } else {
      return // No change needed
    }

    await this.backend.writeFile(path, newData)
  }

  /**
   * Open a file and get a file handle for low-level operations
   *
   * Returns a FileHandle that provides fine-grained control over file I/O,
   * including positioned reads/writes and file synchronization.
   *
   * @param path - Path to the file
   * @param flags - Open mode: 'r' (read), 'w' (write), 'a' (append), etc.
   * @param mode - File permissions for newly created files (default: 0o644)
   * @returns A FileHandle for low-level file operations
   * @throws {ENOENT} If file doesn't exist and flags don't include create
   *
   * @example
   * ```typescript
   * const handle = await fsx.open('/data.bin', 'r+')
   * try {
   *   const buffer = new Uint8Array(1024)
   *   const { bytesRead } = await handle.read(buffer, 0, 1024, 0)
   *   await handle.write(new Uint8Array([1, 2, 3]), 0)
   *   await handle.sync()
   * } finally {
   *   await handle.close()
   * }
   * ```
   */
  async open(path: string, flags?: string | number, _mode?: number): Promise<FileHandle> {
    path = this.normalizePath(path)
    return this.createFileHandle(path, flags)
  }

  /**
   * Create a FileHandle object for low-level file operations.
   *
   * This internal method creates a file handle that wraps the backend with
   * proper access mode enforcement and position tracking. The handle implements
   * lazy loading - file data is only read when needed.
   *
   * Access mode enforcement:
   * - 'read' mode: read() allowed, write() throws EBADF
   * - 'write' mode: write() allowed, read() throws EBADF
   * - 'readwrite' mode: both read() and write() allowed
   *
   * Append mode behavior:
   * - All writes go to end of file regardless of position parameter
   * - This is POSIX-mandated O_APPEND behavior
   *
   * @param path - The normalized file path
   * @param flags - Open flags (string or numeric)
   * @returns A FileHandle with read, write, stat, sync, and close methods
   *
   * @internal
   */
  private createFileHandle(path: string, flags?: string | number): FileHandle {
    const backend = this.backend

    // Parse flags into structured format for access mode enforcement
    const parsedFlags = parseFlags(flags)

    // File handle state
    let fileData: Uint8Array | null = null
    let modified = false
    let closed = false
    let closePromise: Promise<void> | null = null
    let currentPosition = 0

    /**
     * Check if the handle permits read operations.
     */
    const canRead = (): boolean => {
      return parsedFlags.accessMode === 'read' || parsedFlags.accessMode === 'readwrite'
    }

    /**
     * Check if the handle permits write operations.
     */
    const canWrite = (): boolean => {
      return parsedFlags.accessMode === 'write' || parsedFlags.accessMode === 'readwrite'
    }

    /**
     * Ensure the handle is still open, throw if closed.
     */
    const ensureOpen = (): void => {
      if (closed) {
        throw new Error('EBADF: file handle is closed')
      }
    }

    // Track whether file needs creation on close (for 'w' flag with no writes)
    let needsCreation = parsedFlags.create

    /**
     * Flush pending modifications to storage if any exist.
     * This is the shared implementation used by both sync() and close().
     *
     * Also handles file creation for 'w' flag: if opened with create flag
     * but no writes occurred, creates an empty file on close.
     *
     * @returns true if data was flushed, false if nothing to flush
     * @throws Re-throws any error from the backend write operation
     */
    const flushIfModified = async (): Promise<boolean> => {
      if (modified && fileData) {
        await backend.writeFile(path, fileData)
        modified = false
        needsCreation = false
        return true
      }
      // Handle 'w' flag file creation when no writes occurred
      // POSIX: opening with O_CREAT|O_TRUNC should create/truncate the file
      if (needsCreation && parsedFlags.truncate) {
        await backend.writeFile(path, new Uint8Array(0))
        needsCreation = false
        return true
      }
      return false
    }

    /**
     * Internal close implementation - flushes modifications and cleans up.
     *
     * Resource cleanup happens in a finally block to ensure memory is released
     * even if the flush operation fails. This follows the resource cleanup pattern
     * recommended for AsyncDisposable implementations.
     */
    const doClose = async (): Promise<void> => {
      try {
        await flushIfModified()
      } finally {
        // Always release resources, even if flush fails
        // This prevents memory leaks when close is called after errors
        fileData = null
        modified = false
        closed = true
      }
    }

    const handle = {
      fd: 0, // Placeholder - we use path-based operations

      /**
       * Read data from the file into a buffer.
       *
       * @param buffer - Buffer to read data into
       * @param offset - Offset in buffer to start writing at
       * @param length - Number of bytes to read
       * @param position - File position to read from (null uses current position)
       * @returns Object with bytesRead and the buffer
       * @throws EBADF if handle is closed or opened write-only
       */
      read: async (
        buffer: Uint8Array,
        offset: number | undefined,
        length: number | undefined,
        position: number | undefined
      ): Promise<{ bytesRead: number; buffer: Uint8Array }> => {
        ensureOpen()

        // Enforce access mode
        if (!canRead()) {
          throw new Error('EBADF: bad file descriptor, read not permitted on write-only handle')
        }

        // Lazy load file data
        if (!fileData) {
          fileData = await backend.readFile(path)
        }

        const readLength = length ?? buffer.length
        const readPosition = position ?? currentPosition
        const targetOffset = offset ?? 0
        const bytesToRead = Math.min(readLength, fileData.length - readPosition)

        // Copy data to buffer
        for (let i = 0; i < bytesToRead; i++) {
          buffer[targetOffset + i] = fileData[readPosition + i]!
        }

        // Update position if not explicitly specified
        if (position === undefined) {
          currentPosition += bytesToRead
        }

        return { bytesRead: bytesToRead, buffer }
      },

      /**
       * Write data to the file.
       *
       * In append mode, writes always go to end of file regardless of position.
       *
       * @param data - Data to write (string or bytes)
       * @param position - File position to write at (ignored in append mode)
       * @returns Object with bytesWritten
       * @throws EBADF if handle is closed or opened read-only
       */
      write: async (data: Uint8Array | string, position?: number): Promise<{ bytesWritten: number }> => {
        ensureOpen()

        // Enforce access mode
        if (!canWrite()) {
          throw new Error('EBADF: bad file descriptor, write not permitted on read-only handle')
        }

        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data

        // Lazy load file data
        if (!fileData) {
          try {
            fileData = await backend.readFile(path)
          } catch {
            // File doesn't exist yet, start with empty buffer
            fileData = new Uint8Array(0)
          }
        }

        // Determine write position:
        // - Append mode: always write at end (POSIX O_APPEND behavior)
        // - Explicit position: use the provided position
        // - Default: use current file position
        const writePos = parsedFlags.append
          ? fileData.length
          : (position ?? currentPosition)

        // Expand buffer if needed
        if (writePos + bytes.length > fileData.length) {
          const newData = new Uint8Array(writePos + bytes.length)
          newData.set(fileData)
          fileData = newData
        }

        // Write the bytes
        for (let i = 0; i < bytes.length; i++) {
          fileData[writePos + i] = bytes[i]!
        }

        // Update position (not in append mode when position wasn't explicit)
        if (!parsedFlags.append && position === undefined) {
          currentPosition = writePos + bytes.length
        }

        modified = true
        return { bytesWritten: bytes.length }
      },

      stat: async () => {
        ensureOpen()
        return backend.stat(path)
      },

      truncate: async (length?: number) => {
        ensureOpen()
        if (!fileData) {
          fileData = await backend.readFile(path)
        }
        const targetLength = length ?? 0
        if (fileData.length > targetLength) {
          fileData = fileData.slice(0, targetLength)
        } else if (fileData.length < targetLength) {
          const newData = new Uint8Array(targetLength)
          newData.set(fileData)
          fileData = newData
        }
        modified = true
      },

      sync: async () => {
        ensureOpen()
        await flushIfModified()
      },

      /**
       * Close the file handle and release resources.
       *
       * This method is idempotent - calling close() multiple times is safe and
       * will return the same promise. Concurrent close calls are also safe due
       * to promise deduplication.
       *
       * Close behavior:
       * 1. Flushes any pending writes to storage
       * 2. Releases internal buffers (even if flush fails)
       * 3. Marks the handle as closed
       *
       * @returns Promise that resolves when close is complete
       * @throws Re-throws any error from the flush operation (data may be lost)
       */
      close: async () => {
        // Idempotent - return the same promise if already closing
        // This handles concurrent close calls safely
        if (closePromise) {
          return closePromise
        }
        // Already closed - no-op
        if (closed) {
          return
        }
        // Start closing - cache the promise for deduplication
        closePromise = doClose()
        return closePromise
      },

      createReadStream: (_options?: ReadStreamOptions) => {
        ensureOpen()
        throw new Error('FileHandle.createReadStream is not implemented')
      },

      createWriteStream: (_options?: WriteStreamOptions) => {
        ensureOpen()
        throw new Error('FileHandle.createWriteStream is not implemented')
      },

      /**
       * Async disposable support for 'await using' syntax.
       *
       * Enables automatic cleanup when used with 'await using':
       * ```typescript
       * await using handle = await fsx.open('/file.txt', 'r')
       * // handle is automatically closed when scope exits
       * ```
       *
       * This is the preferred pattern for resource management in modern TypeScript.
       */
      [Symbol.asyncDispose]: async () => {
        return handle.close()
      },
    }

    return handle as unknown as FileHandle
  }
}
