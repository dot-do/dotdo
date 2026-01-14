/**
 * Node.js fs Polyfill for Edge Runtimes
 *
 * Provides a Node.js fs-compatible API backed by fsx.do.
 * All operations are async-only - sync variants throw.
 *
 * Features:
 * - Async-only API (sync throws - not supported in Workers)
 * - Path sandboxing to execution root
 * - Service binding to fsx.do
 * - fs/promises compatible
 *
 * @module npmx/core/npx/polyfills/fs
 */

import type { FSx } from '../../../../fsx/core/fsx.js'
import type { Stats as FsxStats } from '../../../../fsx/core/types.js'
import { ENOENT, EEXIST } from '../../../../fsx/core/errors.js'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Buffer type for polyfill (subset of Node.js Buffer)
 */
export interface FsBuffer extends Uint8Array {
  toString(encoding?: string): string
}

/**
 * File stats interface matching Node.js fs.Stats
 */
export interface FsStats {
  size: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
  mtime: Date
  ctime: Date
  atime: Date
  mode: number
  uid: number
  gid: number
  nlink: number
  dev: number
  ino: number
  rdev: number
  blksize: number
  blocks: number
  birthtime: Date
}

/**
 * File system polyfill interface (subset of Node.js fs)
 */
export interface FsPolyfill {
  // Async methods
  readFile(path: string, encoding?: string): Promise<string | FsBuffer>
  writeFile(path: string, data: string | FsBuffer): Promise<void>
  readdir(path: string): Promise<string[]>
  stat(path: string): Promise<FsStats>
  lstat(path: string): Promise<FsStats>
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>
  unlink(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  copyFile(src: string, dest: string): Promise<void>
  rename(src: string, dest: string): Promise<void>
  access(path: string, mode?: number): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  chown(path: string, uid: number, gid: number): Promise<void>
  utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>
  symlink(target: string, path: string): Promise<void>
  readlink(path: string): Promise<string>
  realpath(path: string): Promise<string>
  appendFile(path: string, data: string | FsBuffer): Promise<void>
  truncate(path: string, len?: number): Promise<void>

  // fs/promises compatibility
  promises: FsPolyfill

  // Constants
  constants: {
    F_OK: number
    R_OK: number
    W_OK: number
    X_OK: number
    COPYFILE_EXCL: number
    COPYFILE_FICLONE: number
    COPYFILE_FICLONE_FORCE: number
  }

  // Sync methods - all throw
  readFileSync: never
  writeFileSync: never
  readdirSync: never
  statSync: never
  lstatSync: never
  mkdirSync: never
  rmSync: never
  rmdirSync: never
  unlinkSync: never
  existsSync: never
  copyFileSync: never
  renameSync: never
  accessSync: never
  chmodSync: never
  chownSync: never
  utimesSync: never
  symlinkSync: never
  readlinkSync: never
  realpathSync: never
  appendFileSync: never
  truncateSync: never
}

/**
 * Options for creating fs polyfill
 */
export interface CreateFsPolyfillOptions {
  /**
   * Root path for sandboxing.
   * All paths are resolved relative to this root.
   * Default: '/'
   */
  root?: string

  /**
   * The fsx instance to use for filesystem operations.
   * If not provided, uses in-memory backend.
   */
  fsx?: FSx

  /**
   * Whether to enforce path sandboxing.
   * When true, prevents access outside root directory.
   * Default: true
   */
  sandbox?: boolean
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates a buffer-like object from Uint8Array
 */
function createBuffer(data: Uint8Array): FsBuffer {
  const buffer = data as FsBuffer
  buffer.toString = (encoding?: string) => {
    if (!encoding || encoding === 'utf-8' || encoding === 'utf8') {
      return new TextDecoder().decode(data)
    }
    if (encoding === 'base64') {
      let binary = ''
      for (const byte of data) {
        binary += String.fromCharCode(byte)
      }
      return btoa(binary)
    }
    if (encoding === 'hex') {
      let hex = ''
      for (const byte of data) {
        hex += byte.toString(16).padStart(2, '0')
      }
      return hex
    }
    // Default to UTF-8
    return new TextDecoder().decode(data)
  }
  return buffer
}

/**
 * Convert fsx Stats to Node.js-compatible Stats
 */
function convertStats(stats: FsxStats): FsStats {
  return {
    size: stats.size,
    isFile: () => stats.isFile(),
    isDirectory: () => stats.isDirectory(),
    isSymbolicLink: () => stats.isSymbolicLink(),
    mtime: stats.mtime,
    ctime: stats.ctime,
    atime: stats.atime,
    mode: stats.mode,
    uid: stats.uid,
    gid: stats.gid,
    nlink: stats.nlink,
    dev: stats.dev,
    ino: stats.ino,
    rdev: stats.rdev,
    blksize: stats.blksize,
    blocks: stats.blocks,
    birthtime: stats.birthtime,
  }
}

/**
 * Create a function that always throws for sync operations
 */
function createSyncThrow(methodName: string): never {
  throw new Error(
    `Synchronous filesystem operations are not supported in Workers. ` +
      `Use the async version: fs.${methodName.replace('Sync', '')}() or fs/promises`
  )
}

/**
 * Normalize and sandbox a path
 */
function sandboxPath(path: string, root: string, enforce: boolean): string {
  // Normalize the path
  let normalized = path

  // Handle relative paths
  if (!normalized.startsWith('/')) {
    normalized = root + '/' + normalized
  }

  // Resolve . and ..
  const parts = normalized.split('/').filter(Boolean)
  const resolved: string[] = []

  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }

  normalized = '/' + resolved.join('/')

  // Enforce sandbox - ensure path stays within root
  if (enforce) {
    const normalizedRoot = root === '/' ? '/' : root.replace(/\/$/, '')
    if (normalizedRoot !== '/' && !normalized.startsWith(normalizedRoot + '/') && normalized !== normalizedRoot) {
      throw new Error(`EACCES: permission denied, access denied outside sandbox: ${path}`)
    }
  }

  return normalized
}

// ============================================================================
// POLYFILL IMPLEMENTATION
// ============================================================================

/**
 * Create an fs polyfill backed by fsx.do
 *
 * @param options - Configuration options
 * @returns Node.js fs-compatible polyfill object
 *
 * @example
 * ```typescript
 * import { createFsPolyfill } from './polyfills/fs'
 * import { createFs } from 'fsx.do'
 *
 * const fs = createFsPolyfill({ fsx: createFs() })
 *
 * await fs.writeFile('/test.txt', 'hello world')
 * const content = await fs.readFile('/test.txt', 'utf-8')
 * ```
 */
export function createFsPolyfill(options: CreateFsPolyfillOptions = {}): FsPolyfill {
  const { root = '/', sandbox = true } = options

  // Get or create fsx instance
  const fsx = options.fsx

  if (!fsx) {
    throw new Error('fsx instance is required for createFsPolyfill')
  }

  // Helper to sandbox paths
  const sp = (path: string) => sandboxPath(path, root, sandbox)

  // Create the polyfill object
  const fsPolyfill: FsPolyfill = {
    // ==================== Async Methods ====================

    async readFile(path: string, encoding?: string): Promise<string | FsBuffer> {
      const normalizedPath = sp(path)

      if (encoding === 'utf-8' || encoding === 'utf8') {
        return await fsx.readFile(normalizedPath, 'utf-8')
      }

      // Read as bytes and wrap in buffer
      const bytes = await fsx.readFile(normalizedPath, null)
      return createBuffer(bytes)
    },

    async writeFile(path: string, data: string | FsBuffer): Promise<void> {
      const normalizedPath = sp(path)

      // Ensure parent directories exist
      const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))
      if (parentPath && parentPath !== '/') {
        try {
          await fsx.mkdir(parentPath, { recursive: true })
        } catch {
          // Ignore if already exists
        }
      }

      if (typeof data === 'string') {
        await fsx.writeFile(normalizedPath, data)
      } else {
        await fsx.writeFile(normalizedPath, data)
      }
    },

    async readdir(path: string): Promise<string[]> {
      const normalizedPath = sp(path)
      const entries = await fsx.readdir(normalizedPath)
      // Ensure we return strings, not Dirent objects
      return entries.map((e) => (typeof e === 'string' ? e : e.name))
    },

    async stat(path: string): Promise<FsStats> {
      const normalizedPath = sp(path)
      const stats = await fsx.stat(normalizedPath)
      return convertStats(stats)
    },

    async lstat(path: string): Promise<FsStats> {
      const normalizedPath = sp(path)
      const stats = await fsx.lstat(normalizedPath)
      return convertStats(stats)
    },

    async mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
      const normalizedPath = sp(path)
      await fsx.mkdir(normalizedPath, {
        recursive: options?.recursive ?? false,
        mode: options?.mode,
      })
    },

    async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      const normalizedPath = sp(path)

      try {
        await fsx.rm(normalizedPath, {
          recursive: options?.recursive ?? false,
          force: options?.force ?? false,
        })
      } catch (error) {
        if (options?.force && error instanceof ENOENT) {
          return
        }
        throw error
      }
    },

    async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const normalizedPath = sp(path)
      await fsx.rmdir(normalizedPath, {
        recursive: options?.recursive ?? false,
      })
    },

    async unlink(path: string): Promise<void> {
      const normalizedPath = sp(path)
      await fsx.unlink(normalizedPath)
    },

    async exists(path: string): Promise<boolean> {
      const normalizedPath = sp(path)
      return await fsx.exists(normalizedPath)
    },

    async copyFile(src: string, dest: string): Promise<void> {
      const normalizedSrc = sp(src)
      const normalizedDest = sp(dest)
      await fsx.copyFile(normalizedSrc, normalizedDest)
    },

    async rename(src: string, dest: string): Promise<void> {
      const normalizedSrc = sp(src)
      const normalizedDest = sp(dest)
      await fsx.rename(normalizedSrc, normalizedDest)
    },

    async access(path: string, _mode?: number): Promise<void> {
      const normalizedPath = sp(path)
      await fsx.access(normalizedPath)
    },

    async chmod(path: string, mode: number): Promise<void> {
      const normalizedPath = sp(path)
      await fsx.chmod(normalizedPath, mode)
    },

    async chown(path: string, uid: number, gid: number): Promise<void> {
      const normalizedPath = sp(path)
      await fsx.chown(normalizedPath, uid, gid)
    },

    async utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void> {
      const normalizedPath = sp(path)
      await fsx.utimes(normalizedPath, atime, mtime)
    },

    async symlink(target: string, path: string): Promise<void> {
      const normalizedPath = sp(path)
      await fsx.symlink(target, normalizedPath)
    },

    async readlink(path: string): Promise<string> {
      const normalizedPath = sp(path)
      return await fsx.readlink(normalizedPath)
    },

    async realpath(path: string): Promise<string> {
      const normalizedPath = sp(path)
      return await fsx.realpath(normalizedPath)
    },

    async appendFile(path: string, data: string | FsBuffer): Promise<void> {
      const normalizedPath = sp(path)
      if (typeof data === 'string') {
        await fsx.appendFile(normalizedPath, data)
      } else {
        await fsx.appendFile(normalizedPath, data)
      }
    },

    async truncate(path: string, len?: number): Promise<void> {
      const normalizedPath = sp(path)
      await fsx.truncate(normalizedPath, len ?? 0)
    },

    // ==================== fs/promises compatibility ====================

    get promises(): FsPolyfill {
      return fsPolyfill
    },

    // ==================== Constants ====================

    constants: {
      F_OK: 0,
      R_OK: 4,
      W_OK: 2,
      X_OK: 1,
      COPYFILE_EXCL: 1,
      COPYFILE_FICLONE: 2,
      COPYFILE_FICLONE_FORCE: 4,
    },

    // ==================== Sync Methods (all throw) ====================

    get readFileSync(): never {
      return createSyncThrow('readFileSync')
    },
    get writeFileSync(): never {
      return createSyncThrow('writeFileSync')
    },
    get readdirSync(): never {
      return createSyncThrow('readdirSync')
    },
    get statSync(): never {
      return createSyncThrow('statSync')
    },
    get lstatSync(): never {
      return createSyncThrow('lstatSync')
    },
    get mkdirSync(): never {
      return createSyncThrow('mkdirSync')
    },
    get rmSync(): never {
      return createSyncThrow('rmSync')
    },
    get rmdirSync(): never {
      return createSyncThrow('rmdirSync')
    },
    get unlinkSync(): never {
      return createSyncThrow('unlinkSync')
    },
    get existsSync(): never {
      return createSyncThrow('existsSync')
    },
    get copyFileSync(): never {
      return createSyncThrow('copyFileSync')
    },
    get renameSync(): never {
      return createSyncThrow('renameSync')
    },
    get accessSync(): never {
      return createSyncThrow('accessSync')
    },
    get chmodSync(): never {
      return createSyncThrow('chmodSync')
    },
    get chownSync(): never {
      return createSyncThrow('chownSync')
    },
    get utimesSync(): never {
      return createSyncThrow('utimesSync')
    },
    get symlinkSync(): never {
      return createSyncThrow('symlinkSync')
    },
    get readlinkSync(): never {
      return createSyncThrow('readlinkSync')
    },
    get realpathSync(): never {
      return createSyncThrow('realpathSync')
    },
    get appendFileSync(): never {
      return createSyncThrow('appendFileSync')
    },
    get truncateSync(): never {
      return createSyncThrow('truncateSync')
    },
  }

  return fsPolyfill
}

// ============================================================================
// EXPORTS
// ============================================================================

export type { FsPolyfill as FsPolyfillInterface }
