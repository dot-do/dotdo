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
 */

import type { WorkflowContext } from '../../types/WorkflowContext'
import type { DO, Env } from '../../objects/DO'

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

export interface FsCapability {
  read(path: string, options?: FsReadOptions): Promise<string>
  write(path: string, content: string, options?: FsWriteOptions): Promise<void>
  exists(path: string): Promise<boolean>
  delete(path: string): Promise<void>
  list(path: string, options?: FsListOptions): Promise<FsEntry[]>
  mkdir(path: string, options?: FsMkdirOptions): Promise<void>
  stat(path: string): Promise<FsStat>
  copy(src: string, dest: string): Promise<void>
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
 * File metadata stored alongside content
 */
interface FileMetadata {
  size: number
  isDirectory: boolean
  createdAt: string  // ISO string for storage
  modifiedAt: string // ISO string for storage
}

/**
 * Storage key prefixes for the virtual filesystem
 */
const FS_FILE_PREFIX = 'fsx:file:'
const FS_META_PREFIX = 'fsx:meta:'
const FS_DIR_PREFIX = 'fsx:dir:'

/**
 * Normalize path to ensure consistent key format
 */
function normalizePath(path: string): string {
  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path
  }
  // Remove trailing slash except for root
  if (path !== '/' && path.endsWith('/')) {
    path = path.slice(0, -1)
  }
  return path
}

/**
 * Get parent directory path
 */
function getParentDir(path: string): string {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return normalized.slice(0, lastSlash)
}

/**
 * Get file/directory name from path
 */
function getBasename(path: string): string {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  return normalized.slice(lastSlash + 1)
}

/**
 * Creates an FsCapability instance backed by DurableObjectStorage (SQLite)
 *
 * Storage layout:
 * - fsx:file:/path/to/file -> file content (string)
 * - fsx:meta:/path/to/file -> FileMetadata (JSON)
 * - fsx:dir:/path/to/dir -> true (marker for directories)
 */
function createFsCapability(storage: DurableObjectStorage): FsCapability {
  return {
    async read(path: string, options?: FsReadOptions): Promise<string> {
      const normalizedPath = normalizePath(path)
      const content = await storage.get<string>(FS_FILE_PREFIX + normalizedPath)
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory: ${path}`)
      }
      return content
    },

    async write(path: string, content: string, options?: FsWriteOptions): Promise<void> {
      const normalizedPath = normalizePath(path)
      const now = new Date().toISOString()

      // Check if file already exists to preserve createdAt
      const existingMeta = await storage.get<FileMetadata>(FS_META_PREFIX + normalizedPath)

      const metadata: FileMetadata = {
        size: content.length,
        isDirectory: false,
        createdAt: existingMeta?.createdAt ?? now,
        modifiedAt: now,
      }

      // Write file content and metadata atomically
      await storage.put(FS_FILE_PREFIX + normalizedPath, content)
      await storage.put(FS_META_PREFIX + normalizedPath, metadata)
    },

    async exists(path: string): Promise<boolean> {
      const normalizedPath = normalizePath(path)
      // Check for file
      const fileContent = await storage.get(FS_FILE_PREFIX + normalizedPath)
      if (fileContent !== undefined) return true
      // Check for directory marker
      const dirMarker = await storage.get(FS_DIR_PREFIX + normalizedPath)
      if (dirMarker !== undefined) return true
      return false
    },

    async delete(path: string): Promise<void> {
      const normalizedPath = normalizePath(path)
      // Delete file content, metadata, and directory marker
      await storage.delete(FS_FILE_PREFIX + normalizedPath)
      await storage.delete(FS_META_PREFIX + normalizedPath)
      await storage.delete(FS_DIR_PREFIX + normalizedPath)
    },

    async list(path: string, options?: FsListOptions): Promise<FsEntry[]> {
      const normalizedPath = normalizePath(path)
      const prefix = normalizedPath === '/' ? '/' : normalizedPath + '/'

      const entries: FsEntry[] = []
      const seen = new Set<string>()

      // List all file keys
      const fileKeys = await storage.list<string>({ prefix: FS_FILE_PREFIX + prefix })
      for (const [key] of fileKeys) {
        // Extract the path after the prefix
        const fullPath = key.slice(FS_FILE_PREFIX.length)
        const relativePath = fullPath.slice(prefix.length)

        // Get the first segment (immediate child)
        const firstSlash = relativePath.indexOf('/')
        const name = firstSlash === -1 ? relativePath : relativePath.slice(0, firstSlash)

        if (name && !seen.has(name)) {
          seen.add(name)
          // If there's a slash, it's a directory containing this file
          const isDirectory = firstSlash !== -1
          entries.push({ name, isDirectory })
        }
      }

      // List all directory markers
      const dirKeys = await storage.list<boolean>({ prefix: FS_DIR_PREFIX + prefix })
      for (const [key] of dirKeys) {
        const fullPath = key.slice(FS_DIR_PREFIX.length)
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

      if (options?.recursive) {
        // Create all parent directories
        const parts = normalizedPath.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current += '/' + part
          await storage.put(FS_DIR_PREFIX + current, true)
        }
      } else {
        await storage.put(FS_DIR_PREFIX + normalizedPath, true)
      }
    },

    async stat(path: string): Promise<FsStat> {
      const normalizedPath = normalizePath(path)

      // Check for file metadata
      const meta = await storage.get<FileMetadata>(FS_META_PREFIX + normalizedPath)
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
      const isDir = await storage.get(FS_DIR_PREFIX + normalizedPath)
      if (isDir !== undefined) {
        const now = new Date()
        return {
          size: 0,
          isFile: false,
          isDirectory: true,
          createdAt: now,
          modifiedAt: now,
        }
      }

      throw new Error(`ENOENT: no such file or directory: ${path}`)
    },

    async copy(src: string, dest: string): Promise<void> {
      const normalizedSrc = normalizePath(src)
      const normalizedDest = normalizePath(dest)

      const content = await storage.get<string>(FS_FILE_PREFIX + normalizedSrc)
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory: ${src}`)
      }

      const srcMeta = await storage.get<FileMetadata>(FS_META_PREFIX + normalizedSrc)
      const now = new Date().toISOString()

      // Write to destination with new timestamps
      await storage.put(FS_FILE_PREFIX + normalizedDest, content)
      await storage.put(FS_META_PREFIX + normalizedDest, {
        size: content.length,
        isDirectory: false,
        createdAt: now,
        modifiedAt: now,
      } as FileMetadata)
    },

    async move(src: string, dest: string): Promise<void> {
      const normalizedSrc = normalizePath(src)
      const normalizedDest = normalizePath(dest)

      const content = await storage.get<string>(FS_FILE_PREFIX + normalizedSrc)
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory: ${src}`)
      }

      const srcMeta = await storage.get<FileMetadata>(FS_META_PREFIX + normalizedSrc)
      const now = new Date().toISOString()

      // Write to destination preserving original createdAt
      await storage.put(FS_FILE_PREFIX + normalizedDest, content)
      await storage.put(FS_META_PREFIX + normalizedDest, {
        size: content.length,
        isDirectory: false,
        createdAt: srcMeta?.createdAt ?? now,
        modifiedAt: now,
      } as FileMetadata)

      // Delete source
      await storage.delete(FS_FILE_PREFIX + normalizedSrc)
      await storage.delete(FS_META_PREFIX + normalizedSrc)
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
            return value.bind(target)
          }
          return value
        },
      })
    }
  }
}
