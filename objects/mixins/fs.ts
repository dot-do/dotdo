/**
 * withFs Mixin - Filesystem Capability
 *
 * Adds $.fs to the WorkflowContext with filesystem operations:
 * - read, write, exists, delete
 * - list, mkdir, stat
 * - copy, move
 *
 * This is a stub file - implementation pending.
 * Tests are written to drive implementation (RED TDD).
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
