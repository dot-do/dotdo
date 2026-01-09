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
import type { DO, Env } from '../DO'

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
 * Creates an FsCapability instance
 * This is a stub implementation - actual filesystem operations would be
 * implemented based on the runtime environment (e.g., container-based execution)
 */
function createFsCapability(): FsCapability {
  return {
    async read(path: string, options?: FsReadOptions): Promise<string> {
      // Stub implementation - would be replaced with actual fs operations
      throw new Error(`fs.read not implemented: ${path}`)
    },
    async write(path: string, content: string, options?: FsWriteOptions): Promise<void> {
      // Stub implementation
      throw new Error(`fs.write not implemented: ${path}`)
    },
    async exists(path: string): Promise<boolean> {
      // Stub implementation
      throw new Error(`fs.exists not implemented: ${path}`)
    },
    async delete(path: string): Promise<void> {
      // Stub implementation
      throw new Error(`fs.delete not implemented: ${path}`)
    },
    async list(path: string, options?: FsListOptions): Promise<FsEntry[]> {
      // Stub implementation
      throw new Error(`fs.list not implemented: ${path}`)
    },
    async mkdir(path: string, options?: FsMkdirOptions): Promise<void> {
      // Stub implementation
      throw new Error(`fs.mkdir not implemented: ${path}`)
    },
    async stat(path: string): Promise<FsStat> {
      // Stub implementation
      throw new Error(`fs.stat not implemented: ${path}`)
    },
    async copy(src: string, dest: string): Promise<void> {
      // Stub implementation
      throw new Error(`fs.copy not implemented: ${src} -> ${dest}`)
    },
    async move(src: string, dest: string): Promise<void> {
      // Stub implementation
      throw new Error(`fs.move not implemented: ${src} -> ${dest}`)
    },
  }
}

// ============================================================================
// MIXIN IMPLEMENTATION
// ============================================================================

// Symbol for caching the fs capability instance
const FS_CAPABILITY_CACHE = Symbol('fsCapabilityCache')

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
export function withFs<TBase extends Constructor<{ $: WorkflowContext }>>(Base: TBase) {
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

    /**
     * Lazy-loaded filesystem capability
     */
    private get fsCapability(): FsCapability {
      if (!this[FS_CAPABILITY_CACHE]) {
        this[FS_CAPABILITY_CACHE] = createFsCapability()
      }
      return this[FS_CAPABILITY_CACHE]
    }

    // TypeScript requires any[] for mixin constructors (TS2545)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

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
