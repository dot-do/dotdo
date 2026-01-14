/**
 * @fileoverview withFs Mixin for DO Composition
 *
 * This module provides a mixin function that adds filesystem capability
 * to any Durable Object class. The mixin follows the TypeScript mixin pattern
 * and supports lazy initialization of the FsModule.
 *
 * @module do/withFs
 *
 * @example
 * ```typescript
 * import { withFs } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * // Basic usage with defaults
 * class MyDO extends withFs(DO) {
 *   async loadConfig() {
 *     const content = await this.fs.readFile('/config.json', { encoding: 'utf-8' })
 *     return JSON.parse(content as string)
 *   }
 * }
 *
 * // With custom options
 * class StorageDO extends withFs(DO, {
 *   basePath: '/data',
 *   hotMaxSize: 512 * 1024, // 512KB
 *   getR2: (instance) => instance.env?.R2_BUCKET
 * }) {
 *   async saveFile(name: string, data: string) {
 *     await this.fs.writeFile(name, data)
 *   }
 * }
 * ```
 */

import {
  FsModule,
  type FsModuleOptions,
  type SqlStorage,
  type SqlResult,
  type R2BucketLike,
  type Stats,
  type Dirent,
  type ReadOptions,
  type WriteOptions,
  type MkdirOptions,
  type RmdirOptions,
  type RemoveOptions,
  type ReaddirOptions,
  type MoveOptions,
  type CopyOptions,
} from './FsModule'

// ============================================================================
// Types
// ============================================================================

/**
 * Type for a class constructor.
 * Used as the base constraint for mixin composition.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T

/**
 * Interface for DOs that have filesystem capability.
 * Classes extended with withFs will implement this interface.
 */
export interface WithFsCapability {
  /**
   * The FsModule instance providing filesystem functionality.
   * Lazily initialized on first access.
   */
  readonly fs: FsModule
}

/**
 * Options for the withFs mixin.
 * These options configure the FsModule that will be created.
 */
export interface WithFsOptions {
  /**
   * Base path prefix for all filesystem operations.
   * @default '/'
   */
  basePath?: string

  /**
   * Hot tier maximum size in bytes.
   * Files larger than this are stored in R2 when available.
   * @default 1048576 (1MB)
   */
  hotMaxSize?: number

  /**
   * Default file mode (permissions).
   * @default 0o644
   */
  defaultMode?: number

  /**
   * Default directory mode (permissions).
   * @default 0o755
   */
  defaultDirMode?: number

  /**
   * Whether to extend the $ WorkflowContext with fs capability.
   * When true, this.$.fs will be available in addition to this.fs.
   * @default false
   */
  contextMode?: boolean

  /**
   * Whether to auto-initialize the FsModule on construction.
   * When false (default), FsModule is lazily initialized on first access.
   * @default false
   */
  autoInit?: boolean

  /**
   * Factory function to get the SQL storage from the DO instance.
   * This enables lazy binding of the storage based on the DO's context.
   *
   * @param instance - The DO instance
   * @returns The SqlStorage to use, or undefined if none available
   *
   * @example
   * ```typescript
   * withFs(DO, {
   *   getSql: (instance) => instance.ctx?.storage?.sql
   * })
   * ```
   */
  getSql?: (instance: object) => SqlStorage | undefined

  /**
   * Factory function to get the R2 bucket for warm tier storage.
   * This enables lazy binding of R2 based on the DO's environment.
   *
   * @param instance - The DO instance
   * @returns The R2 bucket to use, or undefined if none available
   *
   * @example
   * ```typescript
   * withFs(DO, {
   *   getR2: (instance) => instance.env?.R2_BUCKET
   * })
   * ```
   */
  getR2?: (instance: object) => R2BucketLike | undefined

  /**
   * Factory function to get the archive R2 bucket for cold tier storage.
   *
   * @param instance - The DO instance
   * @returns The archive R2 bucket to use, or undefined if none available
   *
   * @example
   * ```typescript
   * withFs(DO, {
   *   getArchive: (instance) => instance.env?.ARCHIVE_BUCKET
   * })
   * ```
   */
  getArchive?: (instance: object) => R2BucketLike | undefined
}

/**
 * Interface for the extended WorkflowContext with fs capability.
 * Used when contextMode is enabled.
 */
export interface WithFsContext {
  fs: FsModule
  [key: string]: unknown
}

// ============================================================================
// Mixin Implementation
// ============================================================================

/**
 * Symbol used to store the FsModule instance for lazy initialization.
 * Using a symbol prevents name collisions with user-defined properties.
 */
const FS_MODULE_SYMBOL = Symbol('fsModule')

/**
 * Symbol used to store the options for lazy initialization.
 */
const FS_OPTIONS_SYMBOL = Symbol('fsOptions')

/**
 * Symbol to track if the module has been initialized.
 */
const FS_INITIALIZED_SYMBOL = Symbol('fsInitialized')

/**
 * Mixin function to add filesystem capability to a DO class.
 *
 * @description
 * Composes filesystem functionality into a Durable Object class.
 * The resulting class will have a `fs` property that provides
 * FsModule functionality for POSIX-like file operations.
 *
 * The FsModule is lazily initialized on first access to the `fs`
 * property. This means:
 * - No overhead if filesystem is never used
 * - Factory functions (getSql, getR2, getArchive) are called at first access
 * - The module can be properly initialized with DO-specific context
 *
 * The mixin supports:
 * - File operations: readFile, writeFile, appendFile, unlink, rename, copyFile
 * - Directory operations: mkdir, rmdir, readdir, rm
 * - Metadata operations: stat, lstat, exists, access, chmod, chown, utimes
 * - Symbolic links: symlink, link, readlink, realpath
 * - Tiered storage: promote, demote, getTier
 *
 * @param Base - Base class to extend
 * @param options - Filesystem configuration options (optional)
 * @returns Extended class with filesystem capability
 *
 * @example
 * ```typescript
 * import { withFs } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * // Basic usage with defaults
 * class MyDO extends withFs(DO) {
 *   async loadConfig() {
 *     const content = await this.fs.readFile('/config.json', { encoding: 'utf-8' })
 *     return JSON.parse(content as string)
 *   }
 * }
 *
 * // With custom options and lazy binding
 * class StorageDO extends withFs(DO, {
 *   basePath: '/data',
 *   hotMaxSize: 512 * 1024,
 *   getSql: (instance) => (instance as any).ctx?.storage?.sql,
 *   getR2: (instance) => (instance as any).env?.R2_BUCKET
 * }) {
 *   async saveDocument(name: string, content: string) {
 *     await this.fs.mkdir('/documents', { recursive: true })
 *     await this.fs.writeFile(`/documents/${name}`, content)
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Combining with withGit and withBash
 * import { withGit, withBash, withFs } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * class DevDO extends withFs(withBash(withGit(DO, { repo: 'org/repo' }), {
 *   cwd: '/workspace'
 * })) {
 *   async setupProject() {
 *     // Sync git repository
 *     await this.git.sync()
 *
 *     // Create workspace directories
 *     await this.fs.mkdir('/workspace/output', { recursive: true })
 *
 *     // Run build commands
 *     await this.bash.exec('npm', ['run', 'build'])
 *
 *     // Read build output
 *     const files = await this.fs.readdir('/workspace/output')
 *     return files
 *   }
 * }
 * ```
 */
export function withFs<TBase extends Constructor>(
  Base: TBase,
  options: WithFsOptions = {}
): TBase & Constructor<WithFsCapability> {
  // Create the extended class
  class WithFsClass extends Base implements WithFsCapability {
    /**
     * Static list of capabilities for introspection.
     */
    static capabilities = [...((Base as Record<string, unknown>).capabilities as string[] || []), 'fs']

    /**
     * Internal storage for the lazily initialized FsModule.
     */
    private [FS_MODULE_SYMBOL]: FsModule | undefined

    /**
     * Internal storage for the options.
     */
    private [FS_OPTIONS_SYMBOL]: WithFsOptions

    /**
     * Tracks whether initialization has been attempted.
     */
    private [FS_INITIALIZED_SYMBOL]: boolean = false

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      this[FS_OPTIONS_SYMBOL] = options

      // Extend $ context if contextMode is enabled
      if (options.contextMode) {
        const dollarContext = (this as Record<string, unknown>).$ as Record<string, unknown> | undefined

        if (dollarContext) {
          const self = this

          // Create a proxy that adds fs to the $ context
          ;(this as Record<string, unknown>).$ = new Proxy(dollarContext as WithFsContext, {
            get(target, prop: string | symbol) {
              if (prop === 'fs') {
                return self.fs
              }
              // Forward to original context
              const value = (target as unknown as Record<string | symbol, unknown>)[prop]
              if (typeof value === 'function') {
                return (value as (...args: unknown[]) => unknown).bind(target)
              }
              return value
            },
          })
        }
      }

      // Auto-initialize if requested
      if (options.autoInit) {
        // Access fs to trigger lazy initialization
        void this.fs.initialize()
        this[FS_INITIALIZED_SYMBOL] = true
      }
    }

    /**
     * Get the FsModule instance, creating it lazily on first access.
     *
     * @returns The FsModule instance
     */
    get fs(): FsModule {
      if (!this[FS_MODULE_SYMBOL]) {
        this[FS_MODULE_SYMBOL] = this._createFsModule()
      }
      return this[FS_MODULE_SYMBOL]
    }

    /**
     * Create the FsModule instance with resolved options.
     *
     * @returns A new FsModule instance
     * @private
     */
    private _createFsModule(): FsModule {
      const opts = this[FS_OPTIONS_SYMBOL]

      // Resolve SQL storage
      let sql: SqlStorage | undefined
      if (opts.getSql) {
        sql = opts.getSql(this)
      }

      // If no SQL factory provided, try common patterns
      if (!sql) {
        const ctx = (this as Record<string, unknown>).ctx as Record<string, unknown> | undefined
        const state = (this as Record<string, unknown>).state as Record<string, unknown> | undefined

        // Try ctx.storage.sql (dotdo pattern)
        sql = (ctx?.storage as Record<string, unknown> | undefined)?.sql as SqlStorage | undefined

        // Try state.storage.sql (CF DO pattern)
        if (!sql) {
          sql = (state?.storage as Record<string, unknown> | undefined)?.sql as SqlStorage | undefined
        }
      }

      // Create a mock SQL storage if none available (for testing)
      if (!sql) {
        sql = createMockSqlStorage()
      }

      // Resolve R2 if factory provided
      let r2: R2BucketLike | undefined
      if (opts.getR2) {
        r2 = opts.getR2(this)
      }

      // Resolve archive if factory provided
      let archive: R2BucketLike | undefined
      if (opts.getArchive) {
        archive = opts.getArchive(this)
      }

      // Build module options
      const moduleOptions: FsModuleOptions = {
        sql,
        r2,
        archive,
        basePath: opts.basePath,
        hotMaxSize: opts.hotMaxSize,
        defaultMode: opts.defaultMode,
        defaultDirMode: opts.defaultDirMode,
      }

      return new FsModule(moduleOptions)
    }

    /**
     * Check if this DO class has a specific capability.
     * @param name - Capability name to check
     * @returns True if the capability is available
     */
    hasCapability(name: string): boolean {
      if (name === 'fs') return true
      // Check if parent class has the hasCapability method
      const baseProto = Base.prototype as Record<string, unknown>
      if (baseProto && typeof baseProto.hasCapability === 'function') {
        return (baseProto.hasCapability as (name: string) => boolean).call(this, name)
      }
      return false
    }

    /**
     * Initialize the filesystem module asynchronously.
     * This should be called if you need the schema to be created before operations.
     *
     * @returns Promise that resolves when initialization is complete
     */
    async initializeFs(): Promise<void> {
      if (this[FS_INITIALIZED_SYMBOL]) return

      // Ensure fs module is created
      const fs = this.fs

      // Initialize the module
      await fs.initialize()

      this[FS_INITIALIZED_SYMBOL] = true
    }

    /**
     * Dispose the filesystem module and clean up resources.
     */
    async disposeFs(): Promise<void> {
      if (this[FS_MODULE_SYMBOL]) {
        await this[FS_MODULE_SYMBOL].dispose()
        this[FS_MODULE_SYMBOL] = undefined
        this[FS_INITIALIZED_SYMBOL] = false
      }
    }
  }

  // Return the class with proper typing
  return WithFsClass as TBase & Constructor<WithFsCapability>
}

// ============================================================================
// Mock SQL Storage for Testing
// ============================================================================

/**
 * Creates a simple in-memory mock SQL storage for testing.
 * This allows withFs to work even without a real Durable Object context.
 */
function createMockSqlStorage(): SqlStorage {
  const tables: Map<string, unknown[]> = new Map()
  let idCounter = 1

  return {
    exec<T = unknown>(sql: string, ..._params: unknown[]): SqlResult<T> {
      // Simple parsing for basic operations
      const sqlLower = sql.toLowerCase().trim()

      if (sqlLower.startsWith('create table')) {
        // Table creation - no-op in mock
        return {
          one: () => null as T | null,
          toArray: () => [] as T[],
        }
      }

      if (sqlLower.startsWith('create index')) {
        // Index creation - no-op in mock
        return {
          one: () => null as T | null,
          toArray: () => [] as T[],
        }
      }

      if (sqlLower.startsWith('insert')) {
        // Handle INSERT
        const match = sql.match(/INSERT.*INTO\s+(\w+)/i)
        const tableName = match?.[1] || 'unknown'
        if (!tables.has(tableName)) {
          tables.set(tableName, [])
        }
        const table = tables.get(tableName)!
        const id = idCounter++
        const row = { id }
        table.push(row)
        return {
          one: () => row as T | null,
          toArray: () => [row] as T[],
        }
      }

      if (sqlLower.startsWith('select')) {
        // Handle SELECT
        const match = sql.match(/FROM\s+(\w+)/i)
        const tableName = match?.[1] || 'unknown'
        const table = tables.get(tableName) || []
        return {
          one: () => (table[0] as T) || null,
          toArray: () => table as T[],
        }
      }

      if (sqlLower.startsWith('update')) {
        // Handle UPDATE - simplified
        return {
          one: () => null as T | null,
          toArray: () => [] as T[],
        }
      }

      if (sqlLower.startsWith('delete')) {
        // Handle DELETE - simplified
        return {
          one: () => null as T | null,
          toArray: () => [] as T[],
        }
      }

      // Default fallback
      return {
        one: () => null as T | null,
        toArray: () => [] as T[],
      }
    },
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value has filesystem capability.
 *
 * @param value - Value to check
 * @returns True if value has the fs property and it's an FsModule
 *
 * @example
 * ```typescript
 * if (hasFsCapability(instance)) {
 *   const content = await instance.fs.readFile('/config.json')
 * }
 * ```
 */
export function hasFsCapability(value: unknown): value is WithFsCapability {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fs' in value &&
    value.fs instanceof FsModule
  )
}

// ============================================================================
// Re-exports for Convenience
// ============================================================================

export {
  FsModule,
  type FsModuleOptions,
  type SqlStorage,
  type R2BucketLike,
  type Stats,
  type Dirent,
  type ReadOptions,
  type WriteOptions,
  type MkdirOptions,
  type RmdirOptions,
  type RemoveOptions,
  type ReaddirOptions,
  type MoveOptions,
  type CopyOptions,
}
